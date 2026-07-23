// RELIC ROAD — wire protocol. ARCHITECT-OWNED (Claude).
// Host-authoritative: guests send Intents; the host runs the engine and
// broadcasts filtered views. Hidden information (hands/decks) never leaves
// the host except to its owner.
import type { ClassId, GameState, Intent, PlayerState } from "../engine/types";

export const PROTO_VERSION = 1;
export const ROOM_PREFIX = "alice-rr-"; // + 5 chars, no I/O/0/1 (td convention)

// ── lobby ───────────────────────────────────────────────────────────────────
export interface LobbySeat {
  seat: number;
  name: string;
  cls: ClassId;
  ready: boolean;
  bot: boolean;
  connected: boolean;
}
export interface LobbyView {
  seats: LobbySeat[]; // length 4; empty seats are bot placeholders
  hostSeat: 0;
  roundLimit: number;
}

// ── guest → host ────────────────────────────────────────────────────────────
export type C2H =
  | { t: "hello"; proto: number; name: string }
  | { t: "cfg"; cls?: ClassId; ready?: boolean } // lobby config
  | { t: "intent"; seq: number; intent: Intent }
  | { t: "ping"; at: number };

// ── host → guest ────────────────────────────────────────────────────────────
// PlayerView hides rivals' hand/deck/discard order — counts only.
export interface RivalView
  extends Omit<PlayerState, "deck" | "hand" | "discard" | "exhaust" | "pendingChoice"> {
  deckN: number;
  handN: number;
  discardN: number;
}
export interface StateView {
  you: number; // your seat
  state: Omit<GameState, "players"> & { players: RivalView[] };
  yours: Pick<PlayerState, "deck" | "hand" | "discard" | "exhaust" | "pendingChoice">;
  // NOTE: `yours.deck` is sent as a COUNT-preserving shuffle-safe form:
  // the host sends deck length only via deckN in players; the full array here
  // is sorted alphabetically so the owner cannot read draw order either.
}
export type H2C =
  | { t: "welcome"; seat: number; proto: number }
  | { t: "lobby"; lobby: LobbyView }
  | { t: "state"; seq: number; view: StateView }
  | { t: "denied"; seq: number; reason: string }
  | { t: "toast"; msgJa: string }
  | { t: "pong"; at: number }
  | { t: "bye"; reason: string };

// ── Wire abstraction (so a match can run over PeerJS OR BroadcastChannel) ───
export interface Wire {
  /** host side: start listening; onConn fires per guest connection */
  host(room: string, onConn: (conn: WireConn) => void): Promise<void>;
  /** guest side: connect to a room's host */
  join(room: string): Promise<WireConn>;
  close(): void;
}
export interface WireConn {
  id: string;
  send(msg: unknown): void;
  onMessage(cb: (msg: unknown) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

export function makeRoomCode(rng: () => number): string {
  const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
  let s = "";
  for (let i = 0; i < 5; i += 1) s += alpha[Math.floor(rng() * alpha.length)];
  return s;
}
