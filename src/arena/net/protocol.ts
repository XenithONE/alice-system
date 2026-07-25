/**
 * SCRAP CROWN — frozen wire contract.
 *
 * Owned by the architect. Implementers must not edit this file.
 *
 * The host is authoritative: it owns the only physics world in the match and
 * publishes snapshots. Guests send intent and render what they are told. No
 * lockstep, no shared RNG, no client-side physics — Rapier is not guaranteed to
 * reproduce bit-identical results across machines, so nothing may depend on it.
 */

import type {
  ArenaDef,
  BotSpec,
  JudgeScore,
  KoReason,
  MatchInput,
  MatchPhase,
  SeatIndex,
  SimEvent
} from "../sim/types";

export const PROTOCOL_VERSION = 1;

/** One bot, one snapshot. Quaternion is sent whole; 4 floats beat unpack bugs. */
export interface BotSnap {
  readonly seat: SeatIndex;
  readonly alive: boolean;
  readonly hp: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly qx: number;
  readonly qy: number;
  readonly qz: number;
  readonly qw: number;
  /** weapon angle, rad */
  readonly wa: number;
  /** weapon angular speed, rad/s — the renderer needs it for blur and pitch */
  readonly wo: number;
  /** accumulated wheel rotation, rad */
  readonly wp: number;
  /** bit i set means BotSpec.parts[i] has fallen off */
  readonly detach: number;
}

export interface Snapshot {
  readonly tick: number;
  readonly elapsed: number;
  readonly phase: MatchPhase;
  readonly bots: readonly BotSnap[];
  /** everything that happened since the previous snapshot, for VFX only */
  readonly events: readonly SimEvent[];
}

export interface SeatInfo {
  readonly seat: SeatIndex;
  readonly name: string;
  readonly occupant: "host" | "guest" | "ai" | "empty";
  readonly ready: boolean;
  /** null until the player has committed a build */
  readonly spec: BotSpec | null;
}

/* ---------------------------------------------------------------- */
/* guest -> host                                                     */
/* ---------------------------------------------------------------- */

export type ClientMessage =
  | { readonly t: "hello"; readonly v: number; readonly name: string }
  /** untrusted: the host re-validates every build against its own catalog */
  | { readonly t: "build"; readonly spec: BotSpec }
  | { readonly t: "ready"; readonly ready: boolean }
  | { readonly t: "input"; readonly seq: number; readonly input: MatchInput }
  | { readonly t: "rematch" };

/* ---------------------------------------------------------------- */
/* host -> guest                                                     */
/* ---------------------------------------------------------------- */

export type HostMessage =
  | { readonly t: "welcome"; readonly v: number; readonly seat: SeatIndex; readonly arena: ArenaDef }
  | { readonly t: "lobby"; readonly seats: readonly SeatInfo[] }
  /** authoritative build list; guests rebuild their meshes from exactly this */
  | { readonly t: "start"; readonly specs: readonly (BotSpec | null)[]; readonly names: readonly string[]; readonly seed: number }
  | { readonly t: "snap"; readonly s: Snapshot }
  | {
      readonly t: "result";
      readonly winner: SeatIndex | null;
      readonly reason: "ko" | "judges" | "draw";
      readonly scores: readonly JudgeScore[];
      readonly kos: readonly { readonly seat: SeatIndex; readonly reason: KoReason; readonly at: number }[];
    }
  | { readonly t: "reject"; readonly reason: string };

/* ---------------------------------------------------------------- */
/* transport                                                         */
/* ---------------------------------------------------------------- */

export interface WireConn {
  readonly id: string;
  send(payload: unknown): void;
  onMessage(cb: (msg: unknown) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

export interface Wire {
  /** open a room and accept guests */
  host(roomId: string, onConn: (conn: WireConn) => void): Promise<void>;
  /** join someone else's room */
  join(roomId: string): Promise<WireConn>;
  dispose(): void;
}
