/**
 * Solo, host and guest sessions behind one interface.
 *
 * The renderer never learns which one it has. It calls `tick`, reads `view()`
 * and drains events — on the host that is the live simulation, on a guest it
 * is the interpolated snapshot stream rebuilt into the same `RaceState`. One
 * render path means a bug can only ever be in one of them, and the wire gate
 * drives the guest path on every run.
 */

import { INPUT_HZ, SNAPSHOT_HZ } from "../sim/balance";
import { createKartSim } from "../sim/sim";
import { buildTrack, type Track } from "../sim/track";
import { DEFAULT_TRACK_ID, trackSpecById } from "../sim/tracks";
import {
  MAX_RACERS,
  NEUTRAL_INPUT,
  type KartInput,
  type KartSim,
  type RaceEvent,
  type RaceResult,
  type RaceState,
  type RacerSpec,
} from "../sim/types";
import { SnapshotInterpolator } from "./interpolation";
import {
  NITRO_PROTOCOL_VERSION,
  raceStateFromSnapshot,
  validateInput,
  validateLobby,
  validateResult,
  validateSettings,
  validateSnapshot,
  validateStart,
  type ClientMessage,
  type HostMessage,
  type LobbySeat,
  type NitroLobby,
  type RoomSettings,
  type Roster,
  type SessionEndReason,
  type StartPayload,
  type Wire,
  type WireConn,
} from "./protocol";
import { encodeSnapshot } from "./snapshot";
import { normalizeRoomCode } from "./wire";

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  trackId: DEFAULT_TRACK_ID,
  laps: 3,
  racerCount: 8,
  playerCount: 2,
  cpuLevel: 2,
  items: true,
  seed: 1,
};

const CPU_NAMES = [
  "AURA",
  "BOLTZ",
  "CINDER",
  "DELTA",
  "ECHO",
  "FLINT",
  "GUST",
  "HELIX",
];

export interface SessionCallbacks {
  onLobby?(lobby: NitroLobby): void;
  onStart?(payload: StartPayload): void;
  onResult?(result: RaceResult): void;
  onEnded?(reason: SessionEndReason): void;
  onError?(message: string): void;
}

export interface NitroSession {
  readonly kind: "solo" | "host" | "guest";
  readonly seat: number;
  readonly roomCode: string | null;
  readonly track: Track;
  readonly settings: RoomSettings;
  /** True once the race itself is running (past the lobby). */
  readonly racing: boolean;
  setReady(ready: boolean): void;
  /** Host only. Returns false when the room is not in a startable state. */
  beginRace(): boolean;
  /** Host only. */
  updateSettings(patch: Partial<RoomSettings>): void;
  sendInput(input: KartInput): void;
  tick(dtSec: number): void;
  view(): RaceState | null;
  drainEvents(): readonly RaceEvent[];
  result(): RaceResult | null;
  dispose(): void;
}

export function normalizeSettings(
  patch: Partial<RoomSettings> | undefined,
): RoomSettings {
  const source = { ...DEFAULT_ROOM_SETTINGS, ...patch };
  const racerCount = clampInt(source.racerCount, 2, MAX_RACERS, 8);
  const playerCount = clampInt(source.playerCount, 1, Math.min(4, racerCount), 2);
  return {
    trackId: trackSpecById(source.trackId).id,
    laps: clampInt(source.laps, 1, 9, 3),
    racerCount,
    playerCount,
    cpuLevel: clampInt(source.cpuLevel, 1, 3, 2),
    items: source.items !== false,
    seed: Number.isFinite(source.seed) ? source.seed >>> 0 : 1,
  };
}

function clampInt(
  value: number,
  low: number,
  high: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(low, Math.min(high, Math.round(value)));
}

function inputFlags(input: KartInput): number {
  return (
    (input.drift ? 1 : 0) | (input.item ? 2 : 0) | (input.lookBack ? 4 : 0)
  );
}

function quantizeInput(input: KartInput): {
  t: number;
  b: number;
  s: number;
  f: number;
} {
  const round = (value: number): number => Math.round(value * 100) / 100;
  return {
    t: round(Math.max(0, Math.min(1, input.throttle))),
    b: round(Math.max(0, Math.min(1, input.brake))),
    s: round(Math.max(-1, Math.min(1, input.steer))),
    f: inputFlags(input),
  };
}

function inputFromFrame(frame: {
  t: number;
  b: number;
  s: number;
  f: number;
}): KartInput {
  return {
    throttle: frame.t,
    brake: frame.b,
    steer: frame.s,
    drift: (frame.f & 1) !== 0,
    item: (frame.f & 2) !== 0,
    lookBack: (frame.f & 4) !== 0,
  };
}

function buildRacerSpecs(
  settings: RoomSettings,
  humans: readonly (string | null)[],
): RacerSpec[] {
  const specs: RacerSpec[] = [];
  for (let seat = 0; seat < settings.racerCount; seat += 1) {
    const human = seat < settings.playerCount ? (humans[seat] ?? null) : null;
    specs.push({
      name: human ?? CPU_NAMES[seat % CPU_NAMES.length]!,
      cpu: human === null,
      cpuLevel: settings.cpuLevel,
      livery: seat,
    });
  }
  return specs;
}

function rosterOf(settings: RoomSettings, specs: readonly RacerSpec[]): Roster {
  return {
    names: specs.map((spec) => spec.name),
    cpu: specs.map((spec) => spec.cpu),
    liveries: specs.map((spec, index) => spec.livery ?? index),
    trackId: settings.trackId,
    laps: settings.laps,
  };
}

// ── Solo ─────────────────────────────────────────────────────────────────────

export interface SoloConfig {
  readonly name: string;
  readonly settings?: Partial<RoomSettings>;
}

export function createSoloSession(config: SoloConfig): NitroSession {
  const settings = normalizeSettings({
    ...config.settings,
    playerCount: 1,
  });
  const specs = buildRacerSpecs(settings, [config.name]);
  const track = buildTrack(trackSpecById(settings.trackId));
  const sim = createKartSim({
    trackId: settings.trackId,
    laps: settings.laps,
    seed: settings.seed,
    racers: specs,
    items: settings.items,
    track,
  });
  let events: RaceEvent[] = [];
  return {
    kind: "solo",
    seat: 0,
    roomCode: null,
    track,
    settings,
    racing: true,
    setReady() {},
    beginRace() {
      return false;
    },
    updateSettings() {},
    sendInput(input) {
      sim.setInput(0, input);
    },
    tick(dtSec) {
      sim.advance(dtSec);
      events.push(...sim.drainEvents());
    },
    view() {
      return sim.getState();
    },
    drainEvents() {
      const drained = events;
      events = [];
      return drained;
    },
    result() {
      return sim.result();
    },
    dispose() {},
  };
}

// ── Host ─────────────────────────────────────────────────────────────────────

interface GuestRecord {
  readonly connection: WireConn;
  seat: number | null;
  name: string;
  ready: boolean;
  lastInputSeq: number;
  helloed: boolean;
}

export interface HostConfig {
  readonly roomCode: string;
  readonly name: string;
  readonly settings?: Partial<RoomSettings>;
  readonly wire: Wire;
  readonly callbacks?: SessionCallbacks;
}

export async function createHostSession(
  config: HostConfig,
): Promise<NitroSession> {
  const roomCode = normalizeRoomCode(config.roomCode);
  let settings = normalizeSettings(config.settings);
  let track = buildTrack(trackSpecById(settings.trackId));
  const callbacks = config.callbacks ?? {};
  const guests = new Set<GuestRecord>();
  let sim: KartSim | null = null;
  let roster: Roster | null = null;
  let localEvents: RaceEvent[] = [];
  let wireEvents: RaceEvent[] = [];
  let snapshotTimer = 0;
  let hostReady = false;
  let finalResult: RaceResult | null = null;
  let disposed = false;

  function seatOwners(): (string | null)[] {
    const owners: (string | null)[] = new Array(settings.playerCount).fill(null);
    owners[0] = config.name;
    for (const guest of guests) {
      if (guest.seat !== null && guest.seat < owners.length) {
        owners[guest.seat] = guest.name;
      }
    }
    return owners;
  }

  function lobby(): NitroLobby {
    const owners = seatOwners();
    const seats: LobbySeat[] = [];
    for (let seat = 0; seat < settings.racerCount; seat += 1) {
      if (seat >= settings.playerCount) {
        seats.push({
          seat,
          name: CPU_NAMES[seat % CPU_NAMES.length]!,
          occupant: "cpu",
          ready: true,
          livery: seat,
        });
        continue;
      }
      const owner = owners[seat] ?? null;
      const guest = [...guests].find((entry) => entry.seat === seat);
      seats.push({
        seat,
        name: owner ?? "OPEN",
        occupant: owner === null ? "empty" : seat === 0 ? "host" : "guest",
        ready: seat === 0 ? hostReady : (guest?.ready ?? false),
        livery: seat,
      });
    }
    return { roomCode, settings, seats };
  }

  function broadcast(message: HostMessage): void {
    for (const guest of guests) {
      if (guest.helloed) guest.connection.send(message);
    }
  }

  function publishLobby(): void {
    const view = lobby();
    broadcast({ t: "lobby", lobby: view });
    callbacks.onLobby?.(view);
  }

  function freeSeat(): number | null {
    const taken = new Set<number>([0]);
    for (const guest of guests) {
      if (guest.seat !== null) taken.add(guest.seat);
    }
    for (let seat = 1; seat < settings.playerCount; seat += 1) {
      if (!taken.has(seat)) return seat;
    }
    return null;
  }

  function handleClientMessage(guest: GuestRecord, payload: unknown): void {
    if (typeof payload !== "object" || payload === null) return;
    const message = payload as ClientMessage;
    switch (message.t) {
      case "hello": {
        if (guest.helloed) return;
        if (message.v !== NITRO_PROTOCOL_VERSION) {
          guest.connection.send({
            t: "reject",
            reason: `プロトコル不一致（ホスト v${NITRO_PROTOCOL_VERSION} / ゲスト v${message.v}）`,
          } satisfies HostMessage);
          guest.connection.close();
          return;
        }
        if (sim) {
          guest.connection.send({
            t: "reject",
            reason: "レース進行中です",
          } satisfies HostMessage);
          guest.connection.close();
          return;
        }
        const seat = freeSeat();
        if (seat === null) {
          guest.connection.send({
            t: "reject",
            reason: "満席です",
          } satisfies HostMessage);
          guest.connection.close();
          return;
        }
        guest.helloed = true;
        guest.seat = seat;
        guest.name =
          typeof message.name === "string" && message.name.trim().length > 0
            ? message.name.trim().slice(0, 12)
            : `P${seat + 1}`;
        guest.connection.send({
          t: "welcome",
          v: NITRO_PROTOCOL_VERSION,
          seat,
          settings,
        } satisfies HostMessage);
        publishLobby();
        return;
      }
      case "ready": {
        if (!guest.helloed) return;
        guest.ready = message.ready === true;
        publishLobby();
        return;
      }
      case "input": {
        if (!guest.helloed || guest.seat === null || !sim) return;
        const frame = validateInput(message.input);
        if (!frame || frame.q <= guest.lastInputSeq) return;
        guest.lastInputSeq = frame.q;
        sim.setInput(guest.seat, inputFromFrame(frame));
        return;
      }
      default:
        return;
    }
  }

  await config.wire.host(roomCode, (connection) => {
    if (disposed) {
      connection.close();
      return;
    }
    const guest: GuestRecord = {
      connection,
      seat: null,
      name: "GUEST",
      ready: false,
      lastInputSeq: -1,
      helloed: false,
    };
    guests.add(guest);
    connection.onMessage((payload) => handleClientMessage(guest, payload));
    connection.onClose(() => {
      guests.delete(guest);
      // Mid-race the seat keeps driving itself rather than becoming a wall.
      if (sim && guest.seat !== null) sim.setAutopilot(guest.seat, true);
      publishLobby();
    });
  });

  publishLobby();

  return {
    kind: "host",
    seat: 0,
    roomCode,
    get track() {
      return track;
    },
    get settings() {
      return settings;
    },
    get racing() {
      return sim !== null;
    },
    setReady(ready) {
      hostReady = ready;
      publishLobby();
    },
    beginRace() {
      if (sim) return false;
      const owners = seatOwners();
      const specs = buildRacerSpecs(settings, owners);
      track = buildTrack(trackSpecById(settings.trackId));
      roster = rosterOf(settings, specs);
      sim = createKartSim({
        trackId: settings.trackId,
        laps: settings.laps,
        seed: settings.seed,
        racers: specs,
        items: settings.items,
        track,
      });
      // A human seat nobody claimed drives itself.
      for (let seat = 0; seat < settings.playerCount; seat += 1) {
        if (owners[seat] === null) sim.setAutopilot(seat, true);
      }
      const payload: StartPayload = {
        settings,
        names: roster.names,
        cpu: roster.cpu,
        liveries: roster.liveries,
      };
      broadcast({ t: "start", ...payload });
      callbacks.onStart?.(payload);
      return true;
    },
    updateSettings(patch) {
      if (sim) return;
      settings = normalizeSettings({ ...settings, ...patch });
      track = buildTrack(trackSpecById(settings.trackId));
      for (const guest of guests) {
        if (guest.seat !== null && guest.seat >= settings.playerCount) {
          guest.seat = freeSeat();
        }
      }
      publishLobby();
    },
    sendInput(input) {
      sim?.setInput(0, input);
    },
    tick(dtSec) {
      if (!sim) return;
      sim.advance(dtSec);
      const drained = sim.drainEvents();
      if (drained.length > 0) {
        localEvents.push(...drained);
        wireEvents.push(...drained);
      }
      snapshotTimer += dtSec;
      const interval = 1 / SNAPSHOT_HZ;
      if (snapshotTimer >= interval) {
        snapshotTimer = snapshotTimer % interval;
        const snapshot = {
          ...encodeSnapshot(sim.getState()),
          events: wireEvents,
        };
        wireEvents = [];
        broadcast({ t: "snapshot", snapshot });
      }
      const outcome = sim.result();
      if (outcome && !finalResult) {
        finalResult = outcome;
        broadcast({ t: "result", result: outcome });
        callbacks.onResult?.(outcome);
      }
    },
    view() {
      return sim ? sim.getState() : null;
    },
    drainEvents() {
      const drained = localEvents;
      localEvents = [];
      return drained;
    },
    result() {
      return finalResult;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      broadcast({ t: "ended", reason: "host-left" });
      for (const guest of guests) guest.connection.close();
      guests.clear();
      config.wire.dispose();
    },
  };
}

// ── Guest ────────────────────────────────────────────────────────────────────

export interface GuestConfig {
  readonly roomCode: string;
  readonly name: string;
  readonly wire: Wire;
  readonly callbacks?: SessionCallbacks;
}

export async function createGuestSession(
  config: GuestConfig,
): Promise<NitroSession> {
  const roomCode = normalizeRoomCode(config.roomCode);
  const callbacks = config.callbacks ?? {};
  const connection = await config.wire.join(roomCode);
  const interpolator = new SnapshotInterpolator();
  let settings = DEFAULT_ROOM_SETTINGS;
  let track = buildTrack(trackSpecById(settings.trackId));
  let seat = -1;
  let roster: Roster | null = null;
  let started = false;
  let events: RaceEvent[] = [];
  let finalResult: RaceResult | null = null;
  let latestView: RaceState | null = null;
  let pendingInput: KartInput = NEUTRAL_INPUT;
  let inputTimer = 0;
  let inputSeq = 0;
  let disposed = false;

  /*
   * ONE message handler for the whole life of the connection, including the
   * handshake. The two transports disagree about what `onMessage` means —
   * PeerJS adds a listener, BroadcastChannel replaces one — so registering it
   * twice would deliver every frame twice on WebRTC and drop the handshake
   * handler on BroadcastChannel. Neither shows up until you are online.
   */
  let settleWelcome:
    | ((value: { seat: number; settings: RoomSettings }) => void)
    | null = null;
  let failWelcome: ((error: Error) => void) | null = null;

  connection.onMessage((payload) => {
    if (typeof payload !== "object" || payload === null) return;
    const message = payload as HostMessage;
    if (message.t === "welcome") {
      if (!settleWelcome) return;
      const resolve = settleWelcome;
      const reject = failWelcome;
      settleWelcome = null;
      failWelcome = null;
      if (message.v !== NITRO_PROTOCOL_VERSION) {
        reject?.(
          new Error(
            `プロトコル不一致（ホスト v${message.v} / こちら v${NITRO_PROTOCOL_VERSION}）`,
          ),
        );
        connection.close();
        return;
      }
      const parsed = validateSettings(message.settings);
      if (parsed === null || typeof message.seat !== "number") {
        reject?.(new Error("ホストの応答が壊れています"));
        connection.close();
        return;
      }
      resolve({ seat: message.seat, settings: parsed });
      return;
    }
    if (message.t === "reject") {
      const reject = failWelcome;
      settleWelcome = null;
      failWelcome = null;
      const reason =
        typeof message.reason === "string" ? message.reason : "接続を拒否されました";
      if (reject) reject(new Error(reason));
      else callbacks.onError?.(reason);
      return;
    }
    switch (message.t) {
      case "lobby": {
        const parsed = validateLobby(message.lobby);
        if (!parsed) {
          callbacks.onError?.("ロビー情報が壊れています");
          return;
        }
        settings = parsed.settings;
        if (!started) track = buildTrack(trackSpecById(settings.trackId));
        callbacks.onLobby?.(parsed);
        return;
      }
      case "start": {
        const parsed = validateStart(message);
        if (!parsed) {
          callbacks.onError?.("開始情報が壊れています");
          return;
        }
        settings = parsed.settings;
        track = buildTrack(trackSpecById(settings.trackId));
        roster = {
          names: parsed.names,
          cpu: parsed.cpu,
          liveries: parsed.liveries,
          trackId: settings.trackId,
          laps: settings.laps,
        };
        interpolator.clear();
        started = true;
        callbacks.onStart?.(parsed);
        return;
      }
      case "snapshot": {
        const parsed = validateSnapshot(message.snapshot);
        if (!parsed) {
          callbacks.onError?.("スナップショットを拒否しました");
          return;
        }
        interpolator.push(parsed);
        return;
      }
      case "result": {
        const parsed = validateResult(message.result);
        if (!parsed) {
          callbacks.onError?.("リザルトが壊れています");
          return;
        }
        finalResult = parsed;
        callbacks.onResult?.(parsed);
        return;
      }
      case "ended": {
        callbacks.onEnded?.(
          message.reason === "host-ended" ? "host-ended" : "host-left",
        );
        return;
      }
      default:
        return;
    }
  });

  connection.onClose(() => {
    if (failWelcome) {
      const reject = failWelcome;
      settleWelcome = null;
      failWelcome = null;
      reject(new Error("ホストとの接続が切れました"));
      return;
    }
    if (!disposed) callbacks.onEnded?.("host-left");
  });

  const welcome = await new Promise<{ seat: number; settings: RoomSettings }>(
    (resolve, reject) => {
      const timeout = setTimeout(() => {
        settleWelcome = null;
        failWelcome = null;
        reject(new Error("ホストが応答しませんでした"));
      }, 8_000);
      settleWelcome = (value) => {
        clearTimeout(timeout);
        resolve(value);
      };
      failWelcome = (error) => {
        clearTimeout(timeout);
        reject(error);
      };
      connection.send({
        t: "hello",
        v: NITRO_PROTOCOL_VERSION,
        name: config.name,
      } satisfies ClientMessage);
    },
  );

  seat = welcome.seat;
  settings = welcome.settings;
  track = buildTrack(trackSpecById(settings.trackId));

  return {
    kind: "guest",
    get seat() {
      return seat;
    },
    roomCode,
    get track() {
      return track;
    },
    get settings() {
      return settings;
    },
    get racing() {
      return started;
    },
    setReady(ready) {
      connection.send({ t: "ready", ready } satisfies ClientMessage);
    },
    beginRace() {
      return false;
    },
    updateSettings() {},
    sendInput(input) {
      pendingInput = input;
    },
    tick(dtSec) {
      inputTimer += dtSec;
      const interval = 1 / INPUT_HZ;
      if (inputTimer >= interval) {
        inputTimer = inputTimer % interval;
        inputSeq += 1;
        connection.send({
          t: "input",
          input: { q: inputSeq, ...quantizeInput(pendingInput) },
        } satisfies ClientMessage);
      }
      if (!roster) return;
      const frame = interpolator.sample();
      if (!frame) return;
      latestView = raceStateFromSnapshot(frame, roster);
      if (frame.events.length > 0) events.push(...frame.events);
    },
    view() {
      return latestView;
    },
    drainEvents() {
      const drained = events;
      events = [];
      return drained;
    },
    result() {
      return finalResult;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      connection.close();
      config.wire.dispose();
    },
  };
}
