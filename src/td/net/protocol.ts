// SIGNAL SIEGE wire protocol. Every timer/limit lives here. All inbound traffic
// goes through validateMsg() — a hostile peer may still cheat its own board (no
// authority exists by design) but must never be able to crash or freeze us.

import { SEND_KINDS, GRID_W, GRID_H, type SendKind } from "../engine/balance";

export const PROTO_V = 1;
export const ROOM_PREFIX = "alice-td-";
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
export const CODE_LEN = 5;
export const MAX_PLAYERS = 3;

export const TIMERS = {
  lobbyPingMs: 2000,
  lobbyTimeoutMs: 8000,
  statusHz: 2,
  heartbeatTimeoutMs: 10000,
  hardCloseGraceMs: 3000,
  joinTimeoutMs: 15000,
  hostIdRetries: 3,
  presencePollMs: 1000
} as const;

export interface PlayerInfo {
  id: string;
  name: string;
  isHost: boolean;
}

export type Msg =
  | { t: "hello"; v: number; name: string; app: string }
  | { t: "helloAck"; v: number; youId: string; players: PlayerInfo[] }
  | { t: "reject"; reason: "version" | "in-game" | "full"; detail?: string }
  | { t: "lobby"; players: PlayerInfo[] }
  | { t: "start"; seed: number; players: PlayerInfo[] }
  | { t: "creeps"; from: string; target: string; kind: SendKind; wave: number; sendId: number }
  | { t: "status"; from: string; lives: number; income: number; wave: number; creeps: number }
  | { t: "board"; from: string; grid: number[]; creeps: number }
  | { t: "waveTick"; wave: number }
  | { t: "over"; from: string; reason: "dead" | "disconnect" | "leave" }
  | { t: "win"; winner: string }
  | { t: "rematch"; from: string }
  | { t: "rematchVotes"; votes: string[] }
  | { t: "rematchStart"; seed: number }
  | { t: "leave"; from: string }
  | { t: "ping" }
  | { t: "pong" };

const NAME_MAX = 16;

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
}
function num(v: unknown, min: number, max: number): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;
}
function playerList(v: unknown): PlayerInfo[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_PLAYERS) return null;
  const out: PlayerInfo[] = [];
  for (const p of v) {
    const o = p as Record<string, unknown>;
    const id = str(o?.id, 64);
    const name = str(o?.name, NAME_MAX);
    if (!id || !name || typeof o.isHost !== "boolean") return null;
    out.push({ id, name, isHost: o.isHost });
  }
  return out;
}

/** Parse + clamp an inbound raw message. Returns null for anything malformed. */
export function validateMsg(raw: unknown): Msg | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case "hello": {
      const v = num(m.v, 0, 999);
      const name = str(m.name, NAME_MAX);
      const app = str(m.app, 32) ?? "?";
      if (v === null || !name) return null;
      return { t: "hello", v, name, app };
    }
    case "helloAck": {
      const v = num(m.v, 0, 999);
      const youId = str(m.youId, 64);
      const players = playerList(m.players);
      if (v === null || !youId || !players) return null;
      return { t: "helloAck", v, youId, players };
    }
    case "reject": {
      if (m.reason !== "version" && m.reason !== "in-game" && m.reason !== "full") return null;
      return { t: "reject", reason: m.reason, detail: str(m.detail, 32) ?? undefined };
    }
    case "lobby": {
      const players = playerList(m.players);
      return players ? { t: "lobby", players } : null;
    }
    case "start": {
      const seed = num(m.seed, 0, 0xffffffff);
      const players = playerList(m.players);
      if (seed === null || !players) return null;
      return { t: "start", seed, players };
    }
    case "creeps": {
      const from = str(m.from, 64);
      const target = str(m.target, 64);
      const wave = num(m.wave, 0, 999);
      const sendId = num(m.sendId, 1, 1e6);
      const kind = SEND_KINDS.includes(m.kind as SendKind) ? (m.kind as SendKind) : null;
      if (!from || !target || wave === null || sendId === null || !kind) return null;
      return { t: "creeps", from, target, kind, wave, sendId };
    }
    case "status": {
      const from = str(m.from, 64);
      const lives = num(m.lives, 0, 999);
      const income = num(m.income, 0, 1e6);
      const wave = num(m.wave, 0, 999);
      const creeps = num(m.creeps, 0, 4096);
      if (!from || lives === null || income === null || wave === null || creeps === null) return null;
      return { t: "status", from, lives, income, wave, creeps };
    }
    case "board": {
      const from = str(m.from, 64);
      const creeps = num(m.creeps, 0, 4096);
      if (!from || creeps === null || !Array.isArray(m.grid) || m.grid.length !== GRID_W * GRID_H) return null;
      const grid: number[] = [];
      for (const cell of m.grid) {
        const c = num(cell, 0, 255);
        if (c === null) return null;
        grid.push(c);
      }
      return { t: "board", from, grid, creeps };
    }
    case "waveTick": {
      const wave = num(m.wave, 0, 999);
      return wave === null ? null : { t: "waveTick", wave };
    }
    case "over": {
      const from = str(m.from, 64);
      if (!from || (m.reason !== "dead" && m.reason !== "disconnect" && m.reason !== "leave")) return null;
      return { t: "over", from, reason: m.reason };
    }
    case "win": {
      const winner = str(m.winner, 64);
      return winner ? { t: "win", winner } : null;
    }
    case "rematch": {
      const from = str(m.from, 64);
      return from ? { t: "rematch", from } : null;
    }
    case "rematchVotes": {
      if (!Array.isArray(m.votes) || m.votes.length > MAX_PLAYERS) return null;
      const votes: string[] = [];
      for (const v of m.votes) {
        const s = str(v, 64);
        if (!s) return null;
        votes.push(s);
      }
      return { t: "rematchVotes", votes };
    }
    case "rematchStart": {
      const seed = num(m.seed, 0, 0xffffffff);
      return seed === null ? null : { t: "rematchStart", seed };
    }
    case "leave": {
      const from = str(m.from, 64);
      return from ? { t: "leave", from } : null;
    }
    case "ping":
      return { t: "ping" };
    case "pong":
      return { t: "pong" };
    default:
      return null;
  }
}

export function makeRoomCode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < CODE_LEN; i += 1) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return code;
}
