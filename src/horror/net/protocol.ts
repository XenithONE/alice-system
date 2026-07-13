// Wire protocol for THE HOLLOW WARD multiplayer.
//
// This module deliberately accepts `unknown` at the network boundary. Every
// message and nested value is copied into a known shape before the room layer
// is allowed to use it.

export const PROTOCOL_VERSION = 2;
export const ROOM_PREFIX = "alice-hw-";
export const ROOM_CODE_LENGTH = 5;
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const MAX_PLAYERS = 3;

export const NETWORK_LIMITS = {
  nameLength: 16,
  idLength: 64,
  sessionIdLength: 64,
  maxTick: 0x7fffffff,
  maxSequence: 0xffffffff,
  maxElapsedMs: 60 * 60 * 1000,
  maxFiles: 64,
  worldXZ: 128,
  worldYMin: -16,
  worldYMax: 64,
  maxVelocity: 16
} as const;

export const ROOM_TIMERS = {
  helloTimeoutMs: 8_000,
  joinTimeoutMs: 15_000,
  presencePollMs: 1_000,
  pingIntervalMs: 2_000,
  // Background tabs may throttle timers to roughly one callback per minute.
  // DataConnection close events still remove peers immediately; this longer
  // watchdog is only for half-open connections that emit no close event.
  heartbeatTimeoutMs: 75_000,
  closeGraceMs: 1_500,
  hostIdRetries: 4
} as const;

export interface PlayerInfo {
  id: string;
  name: string;
  slot: number;
  isHost: boolean;
}

export interface PlayerPose {
  seq: number;
  tick: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  flashlight: boolean;
  hiding: boolean;
}

export interface AuthoritativePlayerState extends PlayerPose {
  id: string;
  fear: number;
  down: boolean;
}

export type WardenMode =
  | "dormant"
  | "roam"
  | "investigate"
  | "stalk"
  | "hunt"
  | "pinned"
  | "drag"
  | "rage";

export interface WardenState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  mode: WardenMode;
  targetId: string | null;
}

export interface AuthoritativeState {
  tick: number;
  elapsedMs: number;
  players: AuthoritativePlayerState[];
  warden: WardenState;
  claimedFiles: number[];
  exitOpen: boolean;
}

export type DownReason = "caught" | "fear";
export type EndReason = "escaped" | "all-down" | "timeout";

export interface EndResult {
  won: boolean;
  reason: EndReason;
  elapsedMs: number;
  escapedIds: string[];
  downPlayerId: string | null;
  lossKind: DownReason | null;
}

export type RejectReason = "version" | "in-game" | "full";

export type Msg =
  | { t: "hello"; v: number; name: string; app: string }
  | { t: "ack"; v: number; sessionId: string; youId: string; players: PlayerInfo[] }
  | { t: "reject"; reason: RejectReason; detail?: string }
  | { t: "lobby"; players: PlayerInfo[] }
  | { t: "start"; seed: number; players: PlayerInfo[] }
  | ({ t: "pose"; from: string } & PlayerPose)
  | ({ t: "state" } & AuthoritativeState)
  | { t: "fileClaim"; from: string; fileId: number }
  | { t: "down"; from: string; reason: DownReason }
  | ({ t: "end" } & EndResult)
  | { t: "leave"; from: string }
  | { t: "ping"; n: number }
  | { t: "pong"; n: number };

type UnknownRecord = Record<string, unknown>;

const WARDEN_MODES = new Set<WardenMode>([
  "dormant",
  "roam",
  "investigate",
  "stalk",
  "hunt",
  "pinned",
  "drag",
  "rage"
]);

function record(value: unknown): UnknownRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as UnknownRecord;
}

function hasExactKeys(
  value: UnknownRecord,
  required: readonly string[],
  optional: readonly string[] = []
): boolean {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) if (!Object.hasOwn(value, key)) return false;
  return Object.keys(value).every((key) => allowed.has(key));
}

function finite(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
}

function integer(value: unknown, min: number, max: number): number | null {
  const parsed = finite(value, min, max);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) return null;
  if (value.trim().length === 0) return null;
  return value;
}

function peerId(value: unknown): string | null {
  const id = text(value, NETWORK_LIMITS.idLength);
  return id && /^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/.test(id) ? id : null;
}

function sessionId(value: unknown): string | null {
  const id = text(value, NETWORK_LIMITS.sessionIdLength);
  return id && /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : null;
}

function boolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function uniqueStrings(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const id = peerId(item);
    if (!id || seen.has(id)) return null;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function parsePlayer(value: unknown): PlayerInfo | null {
  const source = record(value);
  if (!source || !hasExactKeys(source, ["id", "name", "slot", "isHost"])) return null;
  const id = peerId(source.id);
  const name = text(source.name, NETWORK_LIMITS.nameLength);
  const slot = integer(source.slot, 0, MAX_PLAYERS - 1);
  const isHost = boolean(source.isHost);
  if (!id || !name || slot === null || isHost === null) return null;
  return { id, name, slot, isHost };
}

function parsePlayers(value: unknown): PlayerInfo[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PLAYERS) return null;
  const players: PlayerInfo[] = [];
  const ids = new Set<string>();
  const slots = new Set<number>();
  let hosts = 0;
  for (const raw of value) {
    const player = parsePlayer(raw);
    if (!player || ids.has(player.id) || slots.has(player.slot)) return null;
    ids.add(player.id);
    slots.add(player.slot);
    if (player.isHost) hosts += 1;
    players.push(player);
  }
  if (hosts !== 1) return null;
  const host = players.find((player) => player.isHost);
  if (!host || host.slot !== 0) return null;
  return players.sort((a, b) => a.slot - b.slot);
}

function parsePoseFields(source: UnknownRecord): PlayerPose | null {
  const seq = integer(source.seq, 0, NETWORK_LIMITS.maxSequence);
  const tick = integer(source.tick, 0, NETWORK_LIMITS.maxTick);
  const x = finite(source.x, -NETWORK_LIMITS.worldXZ, NETWORK_LIMITS.worldXZ);
  const y = finite(source.y, NETWORK_LIMITS.worldYMin, NETWORK_LIMITS.worldYMax);
  const z = finite(source.z, -NETWORK_LIMITS.worldXZ, NETWORK_LIMITS.worldXZ);
  const vx = finite(source.vx, -NETWORK_LIMITS.maxVelocity, NETWORK_LIMITS.maxVelocity);
  const vy = finite(source.vy, -NETWORK_LIMITS.maxVelocity, NETWORK_LIMITS.maxVelocity);
  const vz = finite(source.vz, -NETWORK_LIMITS.maxVelocity, NETWORK_LIMITS.maxVelocity);
  const yaw = finite(source.yaw, -Math.PI * 2, Math.PI * 2);
  const pitch = finite(source.pitch, -Math.PI / 2, Math.PI / 2);
  const flashlight = boolean(source.flashlight);
  const hiding = boolean(source.hiding);
  if (
    seq === null || tick === null || x === null || y === null || z === null ||
    vx === null || vy === null || vz === null || yaw === null || pitch === null ||
    flashlight === null || hiding === null
  ) return null;
  return { seq, tick, x, y, z, vx, vy, vz, yaw, pitch, flashlight, hiding };
}

function parseAuthoritativePlayer(value: unknown): AuthoritativePlayerState | null {
  const source = record(value);
  if (!source || !hasExactKeys(source, [
    "id", "seq", "tick", "x", "y", "z", "vx", "vy", "vz", "yaw", "pitch",
    "flashlight", "hiding", "fear", "down"
  ])) return null;
  const id = peerId(source.id);
  const pose = parsePoseFields(source);
  const fear = finite(source.fear, 0, 100);
  const down = boolean(source.down);
  if (!id || !pose || fear === null || down === null) return null;
  return { id, ...pose, fear, down };
}

function parseStatePlayers(value: unknown): AuthoritativePlayerState[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PLAYERS) return null;
  const players: AuthoritativePlayerState[] = [];
  const ids = new Set<string>();
  for (const raw of value) {
    const player = parseAuthoritativePlayer(raw);
    if (!player || ids.has(player.id)) return null;
    ids.add(player.id);
    players.push(player);
  }
  return players;
}

function parseWarden(value: unknown): WardenState | null {
  const source = record(value);
  if (!source || !hasExactKeys(source, ["x", "y", "z", "yaw", "mode", "targetId"])) return null;
  const x = finite(source.x, -NETWORK_LIMITS.worldXZ, NETWORK_LIMITS.worldXZ);
  const y = finite(source.y, NETWORK_LIMITS.worldYMin, NETWORK_LIMITS.worldYMax);
  const z = finite(source.z, -NETWORK_LIMITS.worldXZ, NETWORK_LIMITS.worldXZ);
  const yaw = finite(source.yaw, -Math.PI * 2, Math.PI * 2);
  const mode = typeof source.mode === "string" && WARDEN_MODES.has(source.mode as WardenMode)
    ? source.mode as WardenMode
    : null;
  const targetId = source.targetId === null ? null : peerId(source.targetId);
  if (x === null || y === null || z === null || yaw === null || !mode || targetId === null && source.targetId !== null) return null;
  return { x, y, z, yaw, mode, targetId };
}

function parseClaimedFiles(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length > NETWORK_LIMITS.maxFiles) return null;
  const out: number[] = [];
  const seen = new Set<number>();
  for (const raw of value) {
    const fileId = integer(raw, 0, NETWORK_LIMITS.maxFiles - 1);
    if (fileId === null || seen.has(fileId)) return null;
    seen.add(fileId);
    out.push(fileId);
  }
  return out;
}

function parseState(source: UnknownRecord): AuthoritativeState | null {
  const tick = integer(source.tick, 0, NETWORK_LIMITS.maxTick);
  const elapsedMs = finite(source.elapsedMs, 0, NETWORK_LIMITS.maxElapsedMs);
  const players = parseStatePlayers(source.players);
  const warden = parseWarden(source.warden);
  const claimedFiles = parseClaimedFiles(source.claimedFiles);
  const exitOpen = boolean(source.exitOpen);
  if (tick === null || elapsedMs === null || !players || !warden || !claimedFiles || exitOpen === null) return null;
  return { tick, elapsedMs, players, warden, claimedFiles, exitOpen };
}

/** Return a normalized room code, or `null` without touching PeerJS. */
export function normalizeRoomCode(value: string): string | null {
  const code = value.trim().toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const char of code) if (!ROOM_CODE_ALPHABET.includes(char)) return null;
  return code;
}

export function normalizePlayerName(value: string): string {
  const name = value.trim().slice(0, NETWORK_LIMITS.nameLength);
  return name.length > 0 ? name : "PLAYER";
}

export function makeRoomCode(random: () => number = Math.random): string {
  let code = "";
  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    const sample = Math.max(0, Math.min(0.999999999999, random()));
    code += ROOM_CODE_ALPHABET[Math.floor(sample * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/** Parse and copy an inbound message. Malformed or oversized shapes return null. */
export function validateMsg(raw: unknown): Msg | null {
  const source = record(raw);
  if (!source || typeof source.t !== "string") return null;

  switch (source.t) {
    case "hello": {
      if (!hasExactKeys(source, ["t", "v", "name", "app"])) return null;
      const v = integer(source.v, 0, 999);
      const name = text(source.name, NETWORK_LIMITS.nameLength);
      const app = text(source.app, 32);
      return v === null || !name || !app ? null : { t: "hello", v, name, app };
    }
    case "ack": {
      if (!hasExactKeys(source, ["t", "v", "sessionId", "youId", "players"])) return null;
      const v = integer(source.v, 0, 999);
      const parsedSessionId = sessionId(source.sessionId);
      const youId = peerId(source.youId);
      const players = parsePlayers(source.players);
      return v === null || !parsedSessionId || !youId || !players
        ? null
        : { t: "ack", v, sessionId: parsedSessionId, youId, players };
    }
    case "reject": {
      if (!hasExactKeys(source, ["t", "reason"], ["detail"])) return null;
      if (source.reason !== "version" && source.reason !== "in-game" && source.reason !== "full") return null;
      const detail = source.detail === undefined ? undefined : text(source.detail, 64);
      if (source.detail !== undefined && !detail) return null;
      return { t: "reject", reason: source.reason, detail: detail ?? undefined };
    }
    case "lobby": {
      if (!hasExactKeys(source, ["t", "players"])) return null;
      const players = parsePlayers(source.players);
      return players ? { t: "lobby", players } : null;
    }
    case "start": {
      if (!hasExactKeys(source, ["t", "seed", "players"])) return null;
      const seed = integer(source.seed, 0, 0xffffffff);
      const players = parsePlayers(source.players);
      return seed === null || !players ? null : { t: "start", seed, players };
    }
    case "pose": {
      if (!hasExactKeys(source, [
        "t", "from", "seq", "tick", "x", "y", "z", "vx", "vy", "vz", "yaw", "pitch",
        "flashlight", "hiding"
      ])) return null;
      const from = peerId(source.from);
      const pose = parsePoseFields(source);
      return from && pose ? { t: "pose", from, ...pose } : null;
    }
    case "state": {
      if (!hasExactKeys(source, ["t", "tick", "elapsedMs", "players", "warden", "claimedFiles", "exitOpen"])) return null;
      const state = parseState(source);
      return state ? { t: "state", ...state } : null;
    }
    case "fileClaim": {
      if (!hasExactKeys(source, ["t", "from", "fileId"])) return null;
      const from = peerId(source.from);
      const fileId = integer(source.fileId, 0, NETWORK_LIMITS.maxFiles - 1);
      return !from || fileId === null ? null : { t: "fileClaim", from, fileId };
    }
    case "down": {
      if (!hasExactKeys(source, ["t", "from", "reason"])) return null;
      const from = peerId(source.from);
      if (!from || (source.reason !== "caught" && source.reason !== "fear")) return null;
      return { t: "down", from, reason: source.reason };
    }
    case "end": {
      if (!hasExactKeys(source, ["t", "won", "reason", "elapsedMs", "escapedIds", "downPlayerId", "lossKind"])) return null;
      const won = boolean(source.won);
      const reason = source.reason === "escaped" || source.reason === "all-down" || source.reason === "timeout"
        ? source.reason
        : null;
      const elapsedMs = finite(source.elapsedMs, 0, NETWORK_LIMITS.maxElapsedMs);
      const escapedIds = uniqueStrings(source.escapedIds, MAX_PLAYERS);
      const downPlayerId = source.downPlayerId === null ? null : peerId(source.downPlayerId);
      const lossKind = source.lossKind === "caught" || source.lossKind === "fear" ? source.lossKind : null;
      if (won === null || !reason || elapsedMs === null || !escapedIds) return null;
      if (source.downPlayerId !== null && !downPlayerId) return null;
      if (source.lossKind !== null && !lossKind) return null;
      if (won !== (reason === "escaped")) return null;
      if (won && (downPlayerId !== null || lossKind !== null)) return null;
      if (!won && reason === "all-down" && (!downPlayerId || !lossKind)) return null;
      if (reason === "timeout" && (downPlayerId !== null || lossKind !== null)) return null;
      return { t: "end", won, reason, elapsedMs, escapedIds, downPlayerId, lossKind };
    }
    case "leave": {
      if (!hasExactKeys(source, ["t", "from"])) return null;
      const from = peerId(source.from);
      return from ? { t: "leave", from } : null;
    }
    case "ping":
    case "pong": {
      if (!hasExactKeys(source, ["t", "n"])) return null;
      const n = integer(source.n, 0, NETWORK_LIMITS.maxSequence);
      return n === null ? null : { t: source.t, n };
    }
    default:
      return null;
  }
}
