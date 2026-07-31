/**
 * Wire protocol.
 *
 * Same shape as VORTEX CROWN: one host owns the simulation, guests send input
 * and render snapshots of it. Two things are copied deliberately —
 *
 *  1. A version handshake. A guest one version behind does not degrade
 *     gracefully; it silently drops the fields it does not know and freezes on
 *     the last good frame. Refusing the join is the honest version of that.
 *  2. Strict validation. Every field is range-checked on arrival, because a
 *     NaN that reaches the renderer takes the whole canvas with it.
 *
 * Snapshot keys are single characters. Eight karts at 20 Hz with readable
 * names came to ~3.4 KB per frame, which is 550 kbps up for a host with three
 * guests; compacting them is the difference between playable and not.
 */

import type {
  BoostSource,
  HitCause,
  ItemKind,
  RaceEvent,
  RacePhase,
  RaceResult,
  RaceState,
  RacerState,
} from "../sim/types";

export const NITRO_PROTOCOL_VERSION = 1;
export const NITRO_ROOM_PREFIX = "nk-";

export type SessionEndReason = "host-left" | "host-ended";

export interface RoomSettings {
  readonly trackId: string;
  readonly laps: number;
  /** Total karts on the grid, humans + CPU. */
  readonly racerCount: number;
  /** Human seats the room will hold open. */
  readonly playerCount: number;
  readonly cpuLevel: number;
  readonly items: boolean;
  readonly seed: number;
}

export interface LobbySeat {
  readonly seat: number;
  readonly name: string;
  readonly occupant: "host" | "guest" | "cpu" | "empty";
  readonly ready: boolean;
  readonly livery: number;
}

export interface NitroLobby {
  readonly roomCode: string | null;
  readonly settings: RoomSettings;
  readonly seats: readonly LobbySeat[];
}

export interface StartPayload {
  readonly settings: RoomSettings;
  readonly names: readonly string[];
  readonly cpu: readonly boolean[];
  readonly liveries: readonly number[];
}

// ── Snapshot ─────────────────────────────────────────────────────────────────

export const BOOST_SOURCE_CODES: readonly BoostSource[] = [
  "mini",
  "mushroom",
  "pad",
  "rocket",
  "star",
];

export const ITEM_CODES: readonly ItemKind[] = [
  "mushroom",
  "triple",
  "banana",
  "green",
  "red",
  "bomb",
  "star",
  "bolt",
];

export const PHASE_CODES: readonly RacePhase[] = [
  "countdown",
  "race",
  "finished",
];

/** Flag bits packed into `RacerFrame.f`. */
export const FLAG_FINISHED = 1;
export const FLAG_WRONG_WAY = 2;
export const FLAG_OFF_ROAD = 4;
export const FLAG_AIRBORNE = 8;
export const FLAG_GRACE = 16;
/** Engine burnt out on the line — smoke, not stars, and no body spin. */
export const FLAG_STALL = 32;

export interface RacerFrame {
  /** seat */ readonly i: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** yaw */ readonly a: number;
  /** slip */ readonly l: number;
  /** speed */ readonly v: number;
  /** drift direction, -1/0/1 */ readonly d: number;
  /** drift charge seconds */ readonly h: number;
  /** drift tier */ readonly t: number;
  /** boost seconds left */ readonly b: number;
  /** boost source, index into BOOST_SOURCE_CODES, -1 for none */ readonly u: number;
  /** spin seconds */ readonly p: number;
  /** squash seconds */ readonly q: number;
  /** star seconds */ readonly r: number;
  /** bolt seconds */ readonly o: number;
  /** item, index into ITEM_CODES, -1 for none */ readonly m: number;
  /** item charges */ readonly c: number;
  /** roulette seconds */ readonly w: number;
  /** distance travelled */ readonly g: number;
  /** lap */ readonly k: number;
  /** place */ readonly e: number;
  /** flags */ readonly f: number;
  /** finish time, -1 when still running */ readonly n: number;
  /** best lap, -1 when none */ readonly s: number;
  /** last lap, -1 when none */ readonly j: number;
}

export interface ProjectileFrame {
  readonly i: number;
  /** 0 green, 1 red, 2 bomb */ readonly t: number;
  readonly o: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly a: number;
}

export interface HazardFrame {
  readonly i: number;
  readonly o: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface NitroSnapshot {
  readonly tick: number;
  readonly elapsed: number;
  /** index into PHASE_CODES */ readonly ph: number;
  readonly cd: number;
  readonly racers: readonly RacerFrame[];
  readonly shots: readonly ProjectileFrame[];
  readonly drops: readonly HazardFrame[];
  /** Item box cooldowns, one per box. */
  readonly boxes: readonly number[];
  readonly events: readonly RaceEvent[];
}

// ── Messages ─────────────────────────────────────────────────────────────────

export interface InputFrame {
  /** monotonic sequence; the host ignores anything older than it has seen */
  readonly q: number;
  /** throttle 0..1 */ readonly t: number;
  /** brake 0..1 */ readonly b: number;
  /** steer -1..1 */ readonly s: number;
  /** bit 1 drift, 2 item, 4 look back */ readonly f: number;
}

export type ClientMessage =
  | { readonly t: "hello"; readonly v: number; readonly name: string }
  | { readonly t: "ready"; readonly ready: boolean }
  | { readonly t: "input"; readonly input: InputFrame };

export type HostMessage =
  | {
      readonly t: "welcome";
      readonly v: number;
      readonly seat: number;
      readonly settings: RoomSettings;
    }
  | { readonly t: "lobby"; readonly lobby: NitroLobby }
  | ({ readonly t: "start" } & StartPayload)
  | { readonly t: "snapshot"; readonly snapshot: NitroSnapshot }
  | { readonly t: "result"; readonly result: RaceResult }
  | { readonly t: "reject"; readonly reason: string }
  | { readonly t: "ended"; readonly reason: SessionEndReason };

// ── Transport ────────────────────────────────────────────────────────────────

export interface WireConn {
  readonly id: string;
  send(payload: unknown): void;
  onMessage(callback: (payload: unknown) => void): void;
  onClose(callback: () => void): void;
  close(): void;
}

export interface Wire {
  host(roomCode: string, onConnection: (conn: WireConn) => void): Promise<void>;
  join(roomCode: string): Promise<WireConn>;
  dispose(): void;
}

// ── Validation ───────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown, low: number, high: number): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= low &&
    value <= high
    ? value
    : null;
}

function integer(value: unknown, low: number, high: number): number | null {
  const parsed = num(value, low, high);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

const WORLD_LIMIT = 4000;
const TIMER_LIMIT = 600;

export function validateSettings(value: unknown): RoomSettings | null {
  if (!isRecord(value)) return null;
  const laps = integer(value.laps, 1, 9);
  const racerCount = integer(value.racerCount, 2, 8);
  const playerCount = integer(value.playerCount, 1, 4);
  const cpuLevel = integer(value.cpuLevel, 1, 3);
  const seed = integer(value.seed, 0, 0xffffffff);
  if (
    typeof value.trackId !== "string" ||
    value.trackId.length === 0 ||
    value.trackId.length > 64 ||
    laps === null ||
    racerCount === null ||
    playerCount === null ||
    cpuLevel === null ||
    seed === null ||
    typeof value.items !== "boolean" ||
    playerCount > racerCount
  ) {
    return null;
  }
  return {
    trackId: value.trackId,
    laps,
    racerCount,
    playerCount,
    cpuLevel,
    items: value.items,
    seed,
  };
}

export function validateInput(value: unknown): InputFrame | null {
  if (!isRecord(value)) return null;
  const q = integer(value.q, 0, Number.MAX_SAFE_INTEGER);
  const t = num(value.t, 0, 1);
  const b = num(value.b, 0, 1);
  const s = num(value.s, -1, 1);
  const f = integer(value.f, 0, 7);
  if (q === null || t === null || b === null || s === null || f === null) {
    return null;
  }
  return { q, t, b, s, f };
}

function validateEvent(value: unknown): RaceEvent | null {
  if (!isRecord(value) || typeof value.k !== "string") return null;
  const racer = () => integer(value.racer, 0, 7);
  switch (value.k) {
    case "countdown": {
      const n = integer(value.n, 0, 9);
      return n === null ? null : { k: "countdown", n };
    }
    case "go":
      return { k: "go" };
    case "pickup": {
      const seat = racer();
      const box = integer(value.box, 0, 512);
      return seat === null || box === null
        ? null
        : { k: "pickup", racer: seat, box };
    }
    case "item":
    case "use": {
      const seat = racer();
      const item = typeof value.item === "string" ? value.item : "";
      if (seat === null || !ITEM_CODES.includes(item as ItemKind)) return null;
      return value.k === "item"
        ? { k: "item", racer: seat, item: item as ItemKind }
        : { k: "use", racer: seat, item: item as ItemKind };
    }
    case "hit": {
      const seat = racer();
      const by = value.by === null ? null : integer(value.by, 0, 7);
      const cause = typeof value.cause === "string" ? value.cause : "";
      const x = num(value.x, -WORLD_LIMIT, WORLD_LIMIT);
      const y = num(value.y, -WORLD_LIMIT, WORLD_LIMIT);
      const z = num(value.z, -WORLD_LIMIT, WORLD_LIMIT);
      const causes: readonly HitCause[] = [
        "banana",
        "green",
        "red",
        "bomb",
        "bolt",
        "star",
      ];
      if (
        seat === null ||
        (value.by !== null && by === null) ||
        !causes.includes(cause as HitCause) ||
        x === null ||
        y === null ||
        z === null
      ) {
        return null;
      }
      return { k: "hit", racer: seat, by, cause: cause as HitCause, x, y, z };
    }
    case "boost": {
      const seat = racer();
      const source = typeof value.source === "string" ? value.source : "";
      const tier = integer(value.tier, 0, 3);
      if (
        seat === null ||
        tier === null ||
        !BOOST_SOURCE_CODES.includes(source as BoostSource)
      ) {
        return null;
      }
      return { k: "boost", racer: seat, source: source as BoostSource, tier };
    }
    case "drift": {
      const seat = racer();
      const tier = integer(value.tier, 0, 3);
      return seat === null || tier === null
        ? null
        : { k: "drift", racer: seat, tier };
    }
    case "wall": {
      const seat = racer();
      const speed = num(value.speed, 0, 200);
      return seat === null || speed === null
        ? null
        : { k: "wall", racer: seat, speed };
    }
    case "respawn": {
      const seat = racer();
      return seat === null ? null : { k: "respawn", racer: seat };
    }
    case "lap": {
      const seat = racer();
      const lap = integer(value.lap, 0, 9);
      const lapTime = num(value.lapTime, 0, 3600);
      return seat === null || lap === null || lapTime === null
        ? null
        : { k: "lap", racer: seat, lap, lapTime };
    }
    case "finish": {
      const seat = racer();
      const place = integer(value.place, 1, 8);
      const time = num(value.time, 0, 3600);
      return seat === null || place === null || time === null
        ? null
        : { k: "finish", racer: seat, place, time };
    }
    case "blast": {
      const x = num(value.x, -WORLD_LIMIT, WORLD_LIMIT);
      const y = num(value.y, -WORLD_LIMIT, WORLD_LIMIT);
      const z = num(value.z, -WORLD_LIMIT, WORLD_LIMIT);
      return x === null || y === null || z === null
        ? null
        : { k: "blast", x, y, z };
    }
    default:
      return null;
  }
}

function validateRacerFrame(value: unknown): RacerFrame | null {
  if (!isRecord(value)) return null;
  const i = integer(value.i, 0, 7);
  const x = num(value.x, -WORLD_LIMIT, WORLD_LIMIT);
  const y = num(value.y, -WORLD_LIMIT, WORLD_LIMIT);
  const z = num(value.z, -WORLD_LIMIT, WORLD_LIMIT);
  const a = num(value.a, -100, 100);
  const l = num(value.l, -4, 4);
  const v = num(value.v, -200, 200);
  const d = integer(value.d, -1, 1);
  const h = num(value.h, 0, TIMER_LIMIT);
  const t = integer(value.t, 0, 3);
  const b = num(value.b, 0, TIMER_LIMIT);
  const u = integer(value.u, -1, BOOST_SOURCE_CODES.length - 1);
  const p = num(value.p, 0, TIMER_LIMIT);
  const q = num(value.q, 0, TIMER_LIMIT);
  const r = num(value.r, 0, TIMER_LIMIT);
  const o = num(value.o, 0, TIMER_LIMIT);
  const m = integer(value.m, -1, ITEM_CODES.length - 1);
  const c = integer(value.c, 0, 9);
  const w = num(value.w, 0, TIMER_LIMIT);
  const g = num(value.g, -WORLD_LIMIT * 4, WORLD_LIMIT * 4);
  const k = integer(value.k, 1, 9);
  const e = integer(value.e, 1, 8);
  const f = integer(value.f, 0, 63);
  const n = num(value.n, -1, 3600);
  const s = num(value.s, -1, 3600);
  const j = num(value.j, -1, 3600);
  if (
    i === null || x === null || y === null || z === null || a === null ||
    l === null || v === null || d === null || h === null || t === null ||
    b === null || u === null || p === null || q === null || r === null ||
    o === null || m === null || c === null || w === null || g === null ||
    k === null || e === null || f === null || n === null || s === null ||
    j === null
  ) {
    return null;
  }
  return { i, x, y, z, a, l, v, d, h, t, b, u, p, q, r, o, m, c, w, g, k, e, f, n, s, j };
}

export function validateSnapshot(value: unknown): NitroSnapshot | null {
  if (!isRecord(value)) return null;
  const tick = integer(value.tick, 0, 1e9);
  const elapsed = num(value.elapsed, 0, 7200);
  const ph = integer(value.ph, 0, PHASE_CODES.length - 1);
  const cd = num(value.cd, 0, 60);
  if (
    tick === null ||
    elapsed === null ||
    ph === null ||
    cd === null ||
    !Array.isArray(value.racers) ||
    !Array.isArray(value.shots) ||
    !Array.isArray(value.drops) ||
    !Array.isArray(value.boxes) ||
    !Array.isArray(value.events) ||
    value.racers.length === 0 ||
    value.racers.length > 8 ||
    value.shots.length > 64 ||
    value.drops.length > 64 ||
    value.boxes.length > 512 ||
    value.events.length > 256
  ) {
    return null;
  }
  const racers: RacerFrame[] = [];
  for (const entry of value.racers) {
    const frame = validateRacerFrame(entry);
    if (!frame) return null;
    racers.push(frame);
  }
  const shots: ProjectileFrame[] = [];
  for (const entry of value.shots) {
    if (!isRecord(entry)) return null;
    const i = integer(entry.i, 0, 1e9);
    const t = integer(entry.t, 0, 2);
    const o = integer(entry.o, 0, 7);
    const x = num(entry.x, -WORLD_LIMIT, WORLD_LIMIT);
    const y = num(entry.y, -WORLD_LIMIT, WORLD_LIMIT);
    const z = num(entry.z, -WORLD_LIMIT, WORLD_LIMIT);
    const a = num(entry.a, -100, 100);
    if (i === null || t === null || o === null || x === null || y === null || z === null || a === null) {
      return null;
    }
    shots.push({ i, t, o, x, y, z, a });
  }
  const drops: HazardFrame[] = [];
  for (const entry of value.drops) {
    if (!isRecord(entry)) return null;
    const i = integer(entry.i, 0, 1e9);
    const o = integer(entry.o, 0, 7);
    const x = num(entry.x, -WORLD_LIMIT, WORLD_LIMIT);
    const y = num(entry.y, -WORLD_LIMIT, WORLD_LIMIT);
    const z = num(entry.z, -WORLD_LIMIT, WORLD_LIMIT);
    if (i === null || o === null || x === null || y === null || z === null) {
      return null;
    }
    drops.push({ i, o, x, y, z });
  }
  const boxes: number[] = [];
  for (const entry of value.boxes) {
    const cooldown = num(entry, 0, TIMER_LIMIT);
    if (cooldown === null) return null;
    boxes.push(cooldown);
  }
  const events: RaceEvent[] = [];
  for (const entry of value.events) {
    const event = validateEvent(entry);
    if (!event) return null;
    events.push(event);
  }
  return { tick, elapsed, ph, cd, racers, shots, drops, boxes, events };
}

export function validateResult(value: unknown): RaceResult | null {
  if (!isRecord(value)) return null;
  const laps = integer(value.laps, 1, 9);
  const durationSec = num(value.durationSec, 0, 7200);
  if (
    typeof value.trackId !== "string" ||
    laps === null ||
    durationSec === null ||
    !Array.isArray(value.standings) ||
    value.standings.length === 0 ||
    value.standings.length > 8
  ) {
    return null;
  }
  const standings = [];
  for (const entry of value.standings) {
    if (!isRecord(entry)) return null;
    const id = integer(entry.id, 0, 7);
    const place = integer(entry.place, 1, 8);
    const lap = integer(entry.lap, 1, 9);
    const time = entry.time === null ? null : num(entry.time, 0, 7200);
    const bestLap = entry.bestLap === null ? null : num(entry.bestLap, 0, 7200);
    const livery = integer(entry.livery, 0, 15);
    if (
      id === null ||
      place === null ||
      lap === null ||
      livery === null ||
      typeof entry.name !== "string" ||
      typeof entry.cpu !== "boolean" ||
      typeof entry.finished !== "boolean" ||
      (entry.time !== null && time === null) ||
      (entry.bestLap !== null && bestLap === null)
    ) {
      return null;
    }
    standings.push({
      id,
      name: entry.name.slice(0, 24),
      cpu: entry.cpu,
      livery,
      place,
      finished: entry.finished,
      time,
      bestLap,
      lap,
    });
  }
  return { trackId: value.trackId, laps, durationSec, standings };
}

export function validateLobby(value: unknown): NitroLobby | null {
  if (!isRecord(value)) return null;
  const settings = validateSettings(value.settings);
  if (!settings || !Array.isArray(value.seats) || value.seats.length > 8) {
    return null;
  }
  const seats: LobbySeat[] = [];
  for (const entry of value.seats) {
    if (!isRecord(entry)) return null;
    const seat = integer(entry.seat, 0, 7);
    const livery = integer(entry.livery, 0, 15);
    const occupant = entry.occupant;
    if (
      seat === null ||
      livery === null ||
      typeof entry.name !== "string" ||
      typeof entry.ready !== "boolean" ||
      (occupant !== "host" &&
        occupant !== "guest" &&
        occupant !== "cpu" &&
        occupant !== "empty")
    ) {
      return null;
    }
    seats.push({
      seat,
      name: entry.name.slice(0, 24),
      occupant,
      ready: entry.ready,
      livery,
    });
  }
  return {
    roomCode:
      typeof value.roomCode === "string" ? value.roomCode.slice(0, 16) : null,
    settings,
    seats,
  };
}

export function validateStart(value: unknown): StartPayload | null {
  if (!isRecord(value)) return null;
  const settings = validateSettings(value.settings);
  if (
    !settings ||
    !Array.isArray(value.names) ||
    !Array.isArray(value.cpu) ||
    !Array.isArray(value.liveries) ||
    value.names.length !== settings.racerCount ||
    value.cpu.length !== settings.racerCount ||
    value.liveries.length !== settings.racerCount
  ) {
    return null;
  }
  const names: string[] = [];
  for (const entry of value.names) {
    if (typeof entry !== "string") return null;
    names.push(entry.slice(0, 24));
  }
  const cpu: boolean[] = [];
  for (const entry of value.cpu) {
    if (typeof entry !== "boolean") return null;
    cpu.push(entry);
  }
  const liveries: number[] = [];
  for (const entry of value.liveries) {
    const livery = integer(entry, 0, 15);
    if (livery === null) return null;
    liveries.push(livery);
  }
  return { settings, names, cpu, liveries };
}

/** Static roster the guest merges into every snapshot to rebuild a RaceState. */
export interface Roster {
  readonly names: readonly string[];
  readonly cpu: readonly boolean[];
  readonly liveries: readonly number[];
  readonly trackId: string;
  readonly laps: number;
}

export function raceStateFromSnapshot(
  snapshot: NitroSnapshot,
  roster: Roster,
): RaceState {
  const racers: RacerState[] = snapshot.racers.map((frame) => ({
    id: frame.i,
    name: roster.names[frame.i] ?? `P${frame.i + 1}`,
    cpu: roster.cpu[frame.i] ?? true,
    livery: roster.liveries[frame.i] ?? frame.i,
    x: frame.x,
    y: frame.y,
    z: frame.z,
    yaw: frame.a,
    slip: frame.l,
    speed: frame.v,
    airborne: (frame.f & FLAG_AIRBORNE) !== 0,
    offRoad: (frame.f & FLAG_OFF_ROAD) !== 0,
    driftDir: frame.d,
    driftCharge: frame.h,
    driftTier: frame.t,
    boostTimer: frame.b,
    boostSource: frame.u < 0 ? null : (BOOST_SOURCE_CODES[frame.u] ?? null),
    spinTimer: frame.p,
    squashTimer: frame.q,
    stalled: (frame.f & FLAG_STALL) !== 0,
    starTimer: frame.r,
    boltTimer: frame.o,
    graceTimer: (frame.f & FLAG_GRACE) !== 0 ? 1 : 0,
    item: frame.m < 0 ? null : (ITEM_CODES[frame.m] ?? null),
    itemCharges: frame.c,
    rouletteTimer: frame.w,
    distance: frame.g,
    lap: frame.k,
    place: frame.e,
    wrongWay: (frame.f & FLAG_WRONG_WAY) !== 0,
    finished: (frame.f & FLAG_FINISHED) !== 0,
    finishTime: frame.n < 0 ? null : frame.n,
    bestLap: frame.s < 0 ? null : frame.s,
    lastLap: frame.j < 0 ? null : frame.j,
  }));
  return {
    tick: snapshot.tick,
    elapsed: snapshot.elapsed,
    phase: PHASE_CODES[snapshot.ph] ?? "race",
    trackId: roster.trackId,
    laps: roster.laps,
    racers,
    projectiles: snapshot.shots.map((shot) => ({
      id: shot.i,
      kind: shot.t === 0 ? "green" : shot.t === 1 ? "red" : "bomb",
      owner: shot.o,
      x: shot.x,
      y: shot.y,
      z: shot.z,
      yaw: shot.a,
    })),
    hazards: snapshot.drops.map((drop) => ({
      id: drop.i,
      kind: "banana" as const,
      owner: drop.o,
      x: drop.x,
      y: drop.y,
      z: drop.z,
    })),
    boxCooldowns: snapshot.boxes,
    countdown: snapshot.cd,
    finishGrace: null,
  };
}
