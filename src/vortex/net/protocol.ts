import type { TopBuildSpec, VortexRoomSettings } from "../types";
import type {
  KnockoutReason,
  MatchPhase,
  SeatIndex,
  SimEvent,
  SimRingArena,
  SkillRejectReason,
  SkillSlot,
} from "../sim/types";

export const VORTEX_PROTOCOL_VERSION = 1;
export const VORTEX_ROOM_PREFIX = "vc-";

export interface SkillSnapshot {
  readonly slot: SkillSlot;
  readonly skillId: string | null;
  readonly cooldown: number;
  readonly charges: number;
  readonly ready: boolean;
  readonly blocked: SkillRejectReason | null;
}

export interface TopSnapshot {
  readonly seat: SeatIndex;
  readonly alive: boolean;
  readonly hp: number;
  readonly hpMax: number;
  readonly spin: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly qx: number;
  readonly qy: number;
  readonly qz: number;
  readonly qw: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly skills: readonly SkillSnapshot[];
}

export interface VortexSnapshot {
  readonly tick: number;
  readonly elapsed: number;
  readonly phase: MatchPhase;
  readonly suddenDeathStage: number;
  readonly arenaId: SimRingArena["id"];
  readonly tops: readonly TopSnapshot[];
  readonly events: readonly SimEvent[];
}

export interface VortexResult {
  readonly winner: SeatIndex | null;
  readonly reason: KnockoutReason | "draw";
  readonly durationSec: number;
  readonly knockouts: readonly {
    readonly seat: SeatIndex;
    readonly reason: KnockoutReason;
    readonly at: number;
  }[];
}

export interface LobbySeat {
  readonly seat: SeatIndex;
  readonly name: string;
  readonly occupant: "host" | "guest" | "cpu" | "empty";
  readonly ready: boolean;
  readonly build: TopBuildSpec | null;
}

export interface VortexLobby {
  readonly roomCode: string | null;
  readonly settings: VortexRoomSettings;
  readonly seats: readonly LobbySeat[];
}

export type ClientMessage =
  | {
      readonly t: "hello";
      readonly v: number;
      readonly name: string;
      readonly build: TopBuildSpec;
    }
  | { readonly t: "build"; readonly build: TopBuildSpec }
  | { readonly t: "ready"; readonly ready: boolean }
  | {
      readonly t: "skill";
      readonly seq: number;
      readonly slot: SkillSlot;
    }
  | { readonly t: "rematch" };

export type HostMessage =
  | {
      readonly t: "welcome";
      readonly v: number;
      readonly seat: SeatIndex;
      readonly settings: VortexRoomSettings;
    }
  | { readonly t: "lobby"; readonly lobby: VortexLobby }
  | {
      readonly t: "start";
      readonly seed: number;
      readonly settings: VortexRoomSettings;
      readonly builds: readonly TopBuildSpec[];
      readonly names: readonly string[];
    }
  | { readonly t: "snapshot"; readonly snapshot: VortexSnapshot }
  | { readonly t: "result"; readonly result: VortexResult }
  | { readonly t: "reject"; readonly reason: string }
  | { readonly t: "ended"; readonly reason: "host-left" | "host-ended" };

export interface WireConn {
  readonly id: string;
  send(payload: unknown): void;
  onMessage(callback: (payload: unknown) => void): void;
  onClose(callback: () => void): void;
  close(): void;
}

export interface Wire {
  host(roomCode: string, onConnection: (connection: WireConn) => void): Promise<void>;
  join(roomCode: string): Promise<WireConn>;
  dispose(): void;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isTopBuildMessage(value: unknown): value is TopBuildSpec {
  return (
    isRecord(value) &&
    value.v === 1 &&
    typeof value.name === "string" &&
    typeof value.paint === "number" &&
    isRecord(value.parts)
  );
}

export function isClientMessage(value: unknown): value is ClientMessage {
  if (!isRecord(value) || typeof value.t !== "string") return false;
  switch (value.t) {
    case "hello":
      return (
        typeof value.v === "number" &&
        typeof value.name === "string" &&
        isTopBuildMessage(value.build)
      );
    case "build":
      return isTopBuildMessage(value.build);
    case "ready":
      return typeof value.ready === "boolean";
    case "skill":
      return (
        Number.isSafeInteger(value.seq) &&
        Number.isSafeInteger(value.slot) &&
        (value.slot as number) >= 1 &&
        (value.slot as number) <= 7
      );
    case "rematch":
      return true;
    default:
      return false;
  }
}

export function isHostMessage(value: unknown): value is HostMessage {
  return (
    isRecord(value) &&
    typeof value.t === "string" &&
    [
      "welcome",
      "lobby",
      "start",
      "snapshot",
      "result",
      "reject",
      "ended",
    ].includes(value.t)
  );
}
