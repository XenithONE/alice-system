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
import {
  applyCupPoints,
  CUP_ROUNDS,
  cupStandings,
  cupTrackOrder,
  raceSeedForRound,
  type CupStanding,
} from "../modes/gp";
import { createKartSim } from "../sim/sim";
import { buildTrack, maybeMirror, type Track } from "../sim/track";
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
import { CHARACTERS, REFERENCE_CHARACTER_ID } from "../content/characters";
import { MACHINES, REFERENCE_MACHINE_ID } from "../content/machines";
import { SnapshotInterpolator } from "./interpolation";
import {
  IN_DRIFT,
  IN_GIMMICK,
  IN_ITEM0,
  IN_ITEM1,
  IN_ITEM2,
  IN_LOOKBACK,
  IN_SKILL,
  NITRO_PROTOCOL_VERSION,
  raceStateFromSnapshot,
  validateCup,
  validateInput,
  validateKit,
  validateLobby,
  validateResult,
  validateSettings,
  validateSnapshot,
  validateStart,
  WEATHER_CODES,
  type ClientMessage,
  type CupBlock,
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
  speedClass: 1,
  mirror: false,
  weather: 0,
  gp: false,
  freeKit: false,
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

export interface CupView {
  readonly round: number;
  readonly rounds: number;
  readonly points: readonly number[];
  readonly standings: readonly CupStanding[];
  readonly finished: boolean;
}

export interface NitroSession {
  readonly kind: "solo" | "host" | "guest";
  readonly seat: number;
  readonly roomCode: string | null;
  readonly track: Track;
  readonly settings: RoomSettings;
  /** True once the race itself is running (past the lobby). */
  readonly racing: boolean;
  /** Grand-prix state, or null outside a cup. */
  cup(): CupView | null;
  setReady(ready: boolean): void;
  /**
   * Change kit from the lobby. A guest sends it to the host; a host applies it
   * to seat 0 and republishes. Solo has no lobby, so it does nothing there —
   * the pick arrives through `SoloConfig` before the race is built.
   */
  setKit(kit: SeatKit, livery: number): void;
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
    speedClass: clampInt(source.speedClass, 0, 2, 1),
    mirror: source.mirror === true,
    weather: clampInt(source.weather, 0, WEATHER_CODES.length - 1, 0),
    gp: source.gp === true,
    // `=== true`, not `!== false`: a uniform grid is what an absent flag means.
    freeKit: source.freeKit === true,
  };
}

/** ONE place turns settings into a circuit — mirror included. */
export function buildTrackFor(settings: RoomSettings): Track {
  return buildTrack(
    maybeMirror(trackSpecById(settings.trackId), settings.mirror),
  );
}

/** Settings → the sim options they imply (weather decode included). */
export function raceOptionsFrom(settings: RoomSettings): {
  speedClass: number;
  weather: (typeof WEATHER_CODES)[number];
} {
  return {
    speedClass: settings.speedClass,
    weather: WEATHER_CODES[settings.weather] ?? "clear",
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
    (input.drift ? IN_DRIFT : 0) |
    (input.item0 ? IN_ITEM0 : 0) |
    (input.lookBack ? IN_LOOKBACK : 0) |
    (input.item1 ? IN_ITEM1 : 0) |
    (input.item2 ? IN_ITEM2 : 0) |
    (input.skill ? IN_SKILL : 0) |
    (input.gimmick ? IN_GIMMICK : 0)
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
    drift: (frame.f & IN_DRIFT) !== 0,
    item0: (frame.f & IN_ITEM0) !== 0,
    lookBack: (frame.f & IN_LOOKBACK) !== 0,
    item1: (frame.f & IN_ITEM1) !== 0,
    item2: (frame.f & IN_ITEM2) !== 0,
    skill: (frame.f & IN_SKILL) !== 0,
    gimmick: (frame.f & IN_GIMMICK) !== 0,
  };
}

/** What one seat is driving. `null` in a kit list means "use the default". */
export interface SeatKit {
  readonly characterId: string;
  readonly machineId: string;
}

export const REFERENCE_KIT: SeatKit = {
  characterId: REFERENCE_CHARACTER_ID,
  machineId: REFERENCE_MACHINE_ID,
};

/**
 * What a seat drives when nobody has said otherwise. A person gets the
 * reference kit — nobody should be handed a machine they did not choose — and
 * a CPU gets one drawn by seat index, so eight characters across eight seats
 * make a varied field with no modulo bias.
 */
export function defaultKitForSeat(seat: number, human: boolean): SeatKit {
  if (human) return REFERENCE_KIT;
  return {
    characterId: CHARACTERS[seat % CHARACTERS.length]!.id,
    machineId: MACHINES[seat % MACHINES.length]!.id,
  };
}

function buildRacerSpecs(
  settings: RoomSettings,
  humans: readonly (string | null)[],
  kits?: readonly SeatKit[],
): RacerSpec[] {
  const specs: RacerSpec[] = [];
  for (let seat = 0; seat < settings.racerCount; seat += 1) {
    const human = seat < settings.playerCount ? (humans[seat] ?? null) : null;
    const kit =
      kits?.[seat] ?? defaultKitForSeat(seat, seat < settings.playerCount);
    specs.push({
      name: human ?? CPU_NAMES[seat % CPU_NAMES.length]!,
      cpu: human === null,
      cpuLevel: settings.cpuLevel,
      livery: seat,
      characterId: kit.characterId,
      machineId: kit.machineId,
    });
  }
  return specs;
}

function rosterOf(settings: RoomSettings, specs: readonly RacerSpec[]): Roster {
  return {
    names: specs.map((spec) => spec.name),
    cpu: specs.map((spec) => spec.cpu),
    liveries: specs.map((spec, index) => spec.livery ?? index),
    characters: specs.map((spec) => spec.characterId ?? REFERENCE_CHARACTER_ID),
    machines: specs.map((spec) => spec.machineId ?? REFERENCE_MACHINE_ID),
    trackId: settings.trackId,
    laps: settings.laps,
  };
}

// ── Solo ─────────────────────────────────────────────────────────────────────

export interface SoloConfig {
  readonly name: string;
  readonly settings?: Partial<RoomSettings>;
  /** Local player's livery 0..15; the CPU whose default it displaces takes 0. */
  readonly livery?: number;
  /** v4: what the player picked in the garage. Solo ignores `freeKit`. */
  readonly characterId?: string;
  readonly machineId?: string;
}

export function createSoloSession(config: SoloConfig): NitroSession {
  const settings = normalizeSettings({
    ...config.settings,
    playerCount: 1,
  });
  const soloKit = validateKit(config.characterId, config.machineId);
  const specs = buildRacerSpecs(
    settings,
    [config.name],
    // Seat 0 only; the CPUs keep their by-seat variety. `freeKit` is a room
    // rule about players racing each other, and solo has no other player.
    soloKit ? [soloKit] : undefined,
  );
  const chosen = config.livery ?? 0;
  if (Number.isInteger(chosen) && chosen > 0 && chosen < 16 && specs[0]) {
    specs[0] = { ...specs[0], livery: chosen };
    // CPU liveries default to their seat index, so an unlocked pick <8 can
    // collide with one CPU — hand that CPU the vacated 0.
    if (chosen < specs.length && specs[chosen]) {
      specs[chosen] = { ...specs[chosen], livery: 0 };
    }
  }
  const cupOrder = cupTrackOrder();
  let round = 0;
  let cupPoints: number[] = specs.map(() => 0);
  let lastResult: RaceResult | null = null;

  function trackForRound(): Track {
    const trackId = settings.gp ? cupOrder[round]! : settings.trackId;
    return buildTrack(maybeMirror(trackSpecById(trackId), settings.mirror));
  }

  let track = trackForRound();

  function makeSim() {
    const options = raceOptionsFrom(settings);
    return createKartSim({
      trackId: track.spec.id,
      laps: settings.laps,
      seed: settings.gp ? raceSeedForRound(settings.seed, round) : settings.seed,
      racers: specs,
      items: settings.items,
      track,
      speedClass: options.speedClass,
      weather: options.weather,
    });
  }

  let sim = makeSim();
  let events: RaceEvent[] = [];
  let scoredResult: RaceResult | null = null;

  function maybeScore(): void {
    const outcome = sim.result();
    if (!outcome || scoredResult === outcome) return;
    scoredResult = outcome;
    lastResult = outcome;
    if (settings.gp) cupPoints = applyCupPoints(cupPoints, outcome);
  }

  return {
    kind: "solo",
    seat: 0,
    roomCode: null,
    get track() {
      return track;
    },
    settings,
    racing: true,
    cup() {
      if (!settings.gp) return null;
      return {
        round,
        rounds: CUP_ROUNDS,
        points: cupPoints,
        standings: cupStandings(cupPoints, lastResult),
        finished: round >= CUP_ROUNDS - 1 && sim.result() !== null,
      };
    },
    setReady() {},
    setKit() {},
    beginRace() {
      // Next cup round. Refused mid-race and outside a cup.
      if (!settings.gp) return false;
      if (!sim.result()) return false;
      if (round >= CUP_ROUNDS - 1) return false;
      maybeScore();
      round += 1;
      track = trackForRound();
      sim = makeSim();
      events = [];
      scoredResult = null;
      return true;
    },
    updateSettings() {},
    sendInput(input) {
      sim.setInput(0, input);
    },
    tick(dtSec) {
      sim.advance(dtSec);
      events.push(...sim.drainEvents());
      maybeScore();
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
  /** v2: preferred livery, validated 0..15; -1 = none sent. */
  livery: number;
  /** v4: requested kit, validated against the catalog. Honoured only when the
   * room runs with `freeKit`; otherwise it is displayed and then overruled. */
  characterId: string;
  machineId: string;
}

export interface HostConfig {
  readonly roomCode: string;
  readonly name: string;
  readonly settings?: Partial<RoomSettings>;
  readonly wire: Wire;
  readonly callbacks?: SessionCallbacks;
  /** Host's own livery preference, 0..15. */
  readonly livery?: number;
  /** v4: the host's garage pick. Applied only when the room has `freeKit`. */
  readonly characterId?: string;
  readonly machineId?: string;
}

export async function createHostSession(
  config: HostConfig,
): Promise<NitroSession> {
  const roomCode = normalizeRoomCode(config.roomCode);
  let settings = normalizeSettings(config.settings);
  let track = buildTrackFor(settings);
  const callbacks = config.callbacks ?? {};
  const guests = new Set<GuestRecord>();
  let sim: KartSim | null = null;
  let roster: Roster | null = null;
  let localEvents: RaceEvent[] = [];
  let wireEvents: RaceEvent[] = [];
  let snapshotTimer = 0;
  let hostReady = false;
  // Seat 0's own preferences, mutable because the host keeps browsing the
  // garage while the room is open.
  let hostKit: SeatKit =
    validateKit(config.characterId, config.machineId) ?? REFERENCE_KIT;
  let hostLivery = config.livery;
  let finalResult: RaceResult | null = null;
  let disposed = false;
  // Grand prix state (host-authoritative).
  const cupOrder = cupTrackOrder();
  let cupRound = 0;
  let cupPoints: number[] = [];
  let cupScored: RaceResult | null = null;
  let lastCupResult: RaceResult | null = null;

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

  /**
   * The kit each seat will actually race, `freeKit` already applied. ONE
   * function answers this, so the lobby cannot advertise a machine the race
   * then refuses to build — the disagreement players would notice as "it
   * showed me a buggy and gave me a standard".
   */
  function seatKits(): SeatKit[] {
    const kits: SeatKit[] = [];
    for (let seat = 0; seat < settings.racerCount; seat += 1) {
      kits.push(defaultKitForSeat(seat, seat < settings.playerCount));
    }
    if (!settings.freeKit) return kits.map(() => REFERENCE_KIT);
    kits[0] = hostKit;
    for (const guest of guests) {
      if (guest.seat === null || guest.seat >= settings.racerCount) continue;
      kits[guest.seat] = {
        characterId: guest.characterId,
        machineId: guest.machineId,
      };
    }
    return kits;
  }

  function lobby(): NitroLobby {
    const owners = seatOwners();
    const kits = seatKits();
    const seats: LobbySeat[] = [];
    for (let seat = 0; seat < settings.racerCount; seat += 1) {
      const kit = kits[seat]!;
      if (seat >= settings.playerCount) {
        seats.push({
          seat,
          name: CPU_NAMES[seat % CPU_NAMES.length]!,
          occupant: "cpu",
          ready: true,
          livery: seat,
          characterId: kit.characterId,
          machineId: kit.machineId,
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
        livery: resolveLivery(seat),
        characterId: kit.characterId,
        machineId: kit.machineId,
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

  /**
   * Seat-order clash resolution: earlier seats keep their preference, later
   * clashes shift +1 mod 16 until free — deterministic on every client.
   */
  function resolveLivery(seat: number): number {
    const wanted: number[] = [];
    for (let index = 0; index < settings.racerCount; index += 1) {
      let want = index;
      if (index === 0 && typeof hostLivery === "number") want = hostLivery;
      const guest = [...guests].find((entry) => entry.seat === index);
      if (guest && guest.livery >= 0) want = guest.livery;
      while (wanted.includes(want % 16)) want += 1;
      wanted.push(want % 16);
    }
    return wanted[seat] ?? seat;
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
        const preferred = (message as { livery?: unknown }).livery;
        guest.livery =
          typeof preferred === "number" &&
          Number.isInteger(preferred) &&
          preferred >= 0 &&
          preferred <= 15
            ? preferred
            : -1;
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
      case "pick": {
        // Changing kit mid-race would swap a car out from under its driver.
        if (!guest.helloed || sim) return;
        const kit = validateKit(message.characterId, message.machineId);
        if (kit) {
          guest.characterId = kit.characterId;
          guest.machineId = kit.machineId;
        }
        const livery = message.livery;
        if (
          typeof livery === "number" &&
          Number.isInteger(livery) &&
          livery >= 0 &&
          livery <= 15
        ) {
          guest.livery = livery;
        }
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
      livery: -1,
      characterId: REFERENCE_CHARACTER_ID,
      machineId: REFERENCE_MACHINE_ID,
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
    cup() {
      if (!settings.gp || cupPoints.length === 0) return null;
      return {
        round: cupRound,
        rounds: CUP_ROUNDS,
        points: cupPoints,
        standings: cupStandings(cupPoints, lastCupResult),
        finished: cupRound >= CUP_ROUNDS - 1 && finalResult !== null,
      };
    },
    setReady(ready) {
      hostReady = ready;
      publishLobby();
    },
    setKit(kit, livery) {
      if (sim) return;
      const checked = validateKit(kit.characterId, kit.machineId);
      if (checked) hostKit = checked;
      if (Number.isInteger(livery) && livery >= 0 && livery <= 15) {
        hostLivery = livery;
      }
      publishLobby();
    },
    beginRace() {
      /*
       * Restartable: `if (sim)` alone made one race the room's lifetime.
       * A finished race may be replaced (grand-prix next round); a RUNNING
       * race may not. The guest-side twin of this is clearing finalResult
       * on "start" — without it round 2 bounces guests straight back to the
       * results screen one frame in.
       */
      if (sim && !finalResult) return false;
      const isCup = settings.gp;
      if (sim && finalResult) {
        if (!isCup) return false;
        if (cupRound >= CUP_ROUNDS - 1) return false;
        cupRound += 1;
      }
      const owners = seatOwners();
      const specs = buildRacerSpecs(settings, owners, seatKits()).map(
        (spec, index) => ({ ...spec, livery: resolveLivery(index) }),
      );
      const trackId = isCup ? cupOrder[cupRound]! : settings.trackId;
      track = buildTrack(
        maybeMirror(trackSpecById(trackId), settings.mirror),
      );
      roster = { ...rosterOf(settings, specs), trackId: track.spec.id };
      const options = raceOptionsFrom(settings);
      sim = createKartSim({
        trackId: track.spec.id,
        laps: settings.laps,
        seed: isCup ? raceSeedForRound(settings.seed, cupRound) : settings.seed,
        racers: specs,
        items: settings.items,
        track,
        speedClass: options.speedClass,
        weather: options.weather,
      });
      if (cupPoints.length === 0) cupPoints = specs.map(() => 0);
      finalResult = null;
      cupScored = null;
      wireEvents = [];
      localEvents = [];
      snapshotTimer = 0;
      // A human seat nobody claimed drives itself.
      for (let seat = 0; seat < settings.playerCount; seat += 1) {
        if (owners[seat] === null) sim.setAutopilot(seat, true);
      }
      const payload: StartPayload = {
        settings,
        names: roster.names,
        cpu: roster.cpu,
        liveries: roster.liveries,
        characters: roster.characters,
        machines: roster.machines,
        round: isCup ? cupRound : 0,
        rounds: isCup ? CUP_ROUNDS : 1,
      };
      broadcast({ t: "start", ...payload });
      callbacks.onStart?.(payload);
      return true;
    },
    updateSettings(patch) {
      if (sim) return;
      settings = normalizeSettings({ ...settings, ...patch });
      track = buildTrackFor(settings);
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
        lastCupResult = outcome;
        let cupBlock: CupBlock | undefined;
        if (settings.gp && cupScored !== outcome) {
          cupScored = outcome;
          cupPoints = applyCupPoints(cupPoints, outcome);
          cupBlock = {
            r: cupRound + 1,
            n: CUP_ROUNDS,
            p: cupPoints.slice(),
            f: cupRound >= CUP_ROUNDS - 1,
          };
        }
        broadcast(
          cupBlock
            ? { t: "result", result: outcome, cup: cupBlock }
            : { t: "result", result: outcome },
        );
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
  /** Preferred livery 0..15. */
  readonly livery?: number;
}

export async function createGuestSession(
  config: GuestConfig,
): Promise<NitroSession> {
  const roomCode = normalizeRoomCode(config.roomCode);
  const callbacks = config.callbacks ?? {};
  const connection = await config.wire.join(roomCode);
  const interpolator = new SnapshotInterpolator();
  let settings = DEFAULT_ROOM_SETTINGS;
  let track = buildTrackFor(settings);
  let guestCup: CupView | null = null;
  let roundInfo = { round: 0, rounds: 1 };
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
        if (!started) track = buildTrackFor(settings);
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
        roundInfo = { round: parsed.round, rounds: parsed.rounds };
        /*
         * Grand prix: round 2..n arrive on the SAME connection. The stale
         * result/view from the previous round must go, or the App's result
         * poll bounces this guest straight back to the results screen one
         * frame after the new race starts.
         */
        finalResult = null;
        latestView = null;
        const isCup = settings.gp;
        const trackId = isCup
          ? (cupTrackOrder()[parsed.round] ?? settings.trackId)
          : settings.trackId;
        track = buildTrack(
          maybeMirror(trackSpecById(trackId), settings.mirror),
        );
        roster = {
          names: parsed.names,
          cpu: parsed.cpu,
          liveries: parsed.liveries,
          characters: parsed.characters,
          machines: parsed.machines,
          trackId: track.spec.id,
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
        const cupRaw = (message as { cup?: unknown }).cup;
        if (cupRaw !== undefined) {
          const cup = validateCup(cupRaw, parsed.standings.length);
          if (!cup) {
            callbacks.onError?.("カップ情報が壊れています");
            return;
          }
          guestCup = {
            round: cup.r - 1,
            rounds: cup.n,
            points: cup.p,
            standings: cupStandings(cup.p, parsed),
            finished: cup.f,
          };
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
        livery: config.livery,
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
    cup() {
      if (roundInfo.rounds <= 1) return guestCup;
      /*
       * The round number comes from "start" (present from the first frame of
       * every round); points and standings only exist once a result has
       * carried a cup block. Merging the two keeps the HUD's ROUND 2/3 alive
       * during a round while the standings stay those of the last result.
       */
      return {
        round: roundInfo.round,
        rounds: roundInfo.rounds,
        points: guestCup?.points ?? (roster?.names ?? []).map(() => 0),
        standings: guestCup?.standings ?? [],
        finished: guestCup?.finished ?? false,
      };
    },
    setReady(ready) {
      connection.send({ t: "ready", ready } satisfies ClientMessage);
    },
    setKit(kit, livery) {
      connection.send({
        t: "pick",
        characterId: kit.characterId,
        machineId: kit.machineId,
        livery,
      } satisfies ClientMessage);
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
