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
  RoomSettings,
  SeatIndex,
  SimEvent,
  WeaponSlot
} from "../sim/types";

export const PROTOCOL_VERSION = 4;

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
  /** one entry per fitted weapon, in slot order */
  readonly w: readonly WeaponSnap[];
  /** accumulated wheel rotation, rad */
  readonly wp: number;
  /** bit i set means BotSpec.parts[i] has fallen off */
  readonly detach: number;
  /**
   * Condition of each part, 0..255, indexed like BotSpec.parts. Damage has to
   * be visible before something falls off or the fight reads as flat: this is
   * what lets the renderer dent, scorch and smoke a part as it is worn down.
   */
  readonly pc: readonly number[];
  /** seconds of fire damage still burning, for the flame VFX */
  readonly burn: number;
  /**
   * Plant meters as bytes 0..255: [heat, charge, fuel, load]. Four bytes per
   * bot per snapshot — 320 B/s for a full room, which buys the player a HUD
   * that says why the spinner is not coming up to speed.
   */
  readonly pl: readonly [number, number, number, number];
}

/** Enough to draw a weapon and its readiness without re-deriving anything. */
export interface WeaponSnap {
  readonly idx: number;
  readonly slot: WeaponSlot;
  readonly on: boolean;
  /** angle, rad, or extension in metres for a spear */
  readonly a: number;
  /** angular speed, rad/s — the renderer needs it for blur and audio pitch */
  readonly o: number;
  /** 0..1 cooldown meter */
  readonly c: number;
  /** 0..1 fuel */
  readonly f: number;
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
  /** host only; guests sending this are ignored */
  | { readonly t: "settings"; readonly settings: RoomSettings }
  /** untrusted: the host re-validates every build against its own catalog */
  | { readonly t: "build"; readonly spec: BotSpec }
  | { readonly t: "ready"; readonly ready: boolean }
  | { readonly t: "input"; readonly seq: number; readonly input: MatchInput }
  | { readonly t: "rematch" };

/* ---------------------------------------------------------------- */
/* host -> guest                                                     */
/* ---------------------------------------------------------------- */

export type HostMessage =
  | {
      readonly t: "welcome";
      readonly v: number;
      readonly seat: SeatIndex;
      readonly arena: ArenaDef;
      readonly settings: RoomSettings;
    }
  /** the budget travels with every lobby update so the builder can re-validate */
  | { readonly t: "lobby"; readonly seats: readonly SeatInfo[]; readonly settings: RoomSettings }
  /** authoritative build list; guests rebuild their meshes from exactly this */
  | {
      readonly t: "start";
      readonly specs: readonly (BotSpec | null)[];
      readonly names: readonly string[];
      readonly seed: number;
      readonly settings: RoomSettings;
    }
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
