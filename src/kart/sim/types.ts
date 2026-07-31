import type { Track } from "./track";

/** Up to eight karts on the grid; at most four of them are people. */
export const MAX_RACERS = 8;
export type RacerId = number;

export type ItemKind =
  | "mushroom"
  | "triple"
  | "banana"
  | "green"
  | "red"
  | "bomb"
  | "star"
  | "bolt";

export const ITEM_KINDS: readonly ItemKind[] = [
  "mushroom",
  "triple",
  "banana",
  "green",
  "red",
  "bomb",
  "star",
  "bolt",
];

export type BoostSource = "mini" | "mushroom" | "pad" | "rocket" | "star";
export type HitCause = "banana" | "green" | "red" | "bomb" | "bolt" | "star";
export type RacePhase = "countdown" | "race" | "finished";

export interface KartInput {
  /** 0..1 */
  readonly throttle: number;
  /** 0..1 */
  readonly brake: number;
  /** -1 (left) .. 1 (right) */
  readonly steer: number;
  readonly drift: boolean;
  readonly item: boolean;
  readonly lookBack: boolean;
}

export const NEUTRAL_INPUT: KartInput = {
  throttle: 0,
  brake: 0,
  steer: 0,
  drift: false,
  item: false,
  lookBack: false,
};

export type RaceEvent =
  | { readonly k: "countdown"; readonly n: number }
  | { readonly k: "go" }
  | { readonly k: "pickup"; readonly racer: RacerId; readonly box: number }
  | { readonly k: "item"; readonly racer: RacerId; readonly item: ItemKind }
  | { readonly k: "use"; readonly racer: RacerId; readonly item: ItemKind }
  | {
      readonly k: "hit";
      readonly racer: RacerId;
      readonly by: RacerId | null;
      readonly cause: HitCause;
      readonly x: number;
      readonly y: number;
      readonly z: number;
    }
  | {
      readonly k: "boost";
      readonly racer: RacerId;
      readonly source: BoostSource;
      readonly tier: number;
    }
  | { readonly k: "drift"; readonly racer: RacerId; readonly tier: number }
  | { readonly k: "wall"; readonly racer: RacerId; readonly speed: number }
  | { readonly k: "respawn"; readonly racer: RacerId }
  | {
      readonly k: "lap";
      readonly racer: RacerId;
      readonly lap: number;
      readonly lapTime: number;
    }
  | {
      readonly k: "finish";
      readonly racer: RacerId;
      readonly place: number;
      readonly time: number;
    }
  | {
      readonly k: "blast";
      readonly x: number;
      readonly y: number;
      readonly z: number;
    };

export interface RacerState {
  readonly id: RacerId;
  readonly name: string;
  readonly cpu: boolean;
  /** Livery index; the renderer maps it to a palette entry. */
  readonly livery: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Travel direction. */
  readonly yaw: number;
  /** Extra body rotation from drifting — the sideways look. */
  readonly slip: number;
  readonly speed: number;
  readonly airborne: boolean;
  readonly offRoad: boolean;
  readonly driftDir: number;
  readonly driftCharge: number;
  readonly driftTier: number;
  readonly boostTimer: number;
  readonly boostSource: BoostSource | null;
  readonly spinTimer: number;
  readonly squashTimer: number;
  /** Engine burnt out on the line — smoke, not stars. */
  readonly stalled: boolean;
  readonly starTimer: number;
  readonly boltTimer: number;
  readonly graceTimer: number;
  readonly item: ItemKind | null;
  readonly itemCharges: number;
  readonly rouletteTimer: number;
  /** Total distance travelled along the centreline, metres (can be negative). */
  readonly distance: number;
  readonly lap: number;
  readonly place: number;
  readonly wrongWay: boolean;
  readonly finished: boolean;
  readonly finishTime: number | null;
  readonly bestLap: number | null;
  readonly lastLap: number | null;
}

export interface ProjectileState {
  readonly id: number;
  readonly kind: "green" | "red" | "bomb";
  readonly owner: RacerId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

export interface HazardState {
  readonly id: number;
  readonly kind: "banana";
  readonly owner: RacerId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface RaceState {
  readonly tick: number;
  readonly elapsed: number;
  readonly phase: RacePhase;
  readonly trackId: string;
  readonly laps: number;
  readonly racers: readonly RacerState[];
  readonly projectiles: readonly ProjectileState[];
  readonly hazards: readonly HazardState[];
  /** Remaining dark time per item box; 0 means it is available. */
  readonly boxCooldowns: readonly number[];
  /** Countdown seconds remaining, or 0 once racing. */
  readonly countdown: number;
  /** Seconds left before the race is force-ended after the leader finished. */
  readonly finishGrace: number | null;
}

export interface RaceStanding {
  readonly id: RacerId;
  readonly name: string;
  readonly cpu: boolean;
  readonly livery: number;
  readonly place: number;
  readonly finished: boolean;
  readonly time: number | null;
  readonly bestLap: number | null;
  readonly lap: number;
}

export interface RaceResult {
  readonly trackId: string;
  readonly laps: number;
  readonly durationSec: number;
  readonly standings: readonly RaceStanding[];
}

export interface RacerSpec {
  readonly name: string;
  readonly cpu: boolean;
  /** 1..3; ignored for humans. */
  readonly cpuLevel?: number;
  readonly livery?: number;
}

export interface RaceConfig {
  readonly trackId: string;
  readonly laps: number;
  readonly seed: number;
  readonly racers: readonly RacerSpec[];
  /** Overrides the built track (tests inject a stub circuit). */
  readonly track?: Track;
  /** Items off makes a clean time-trial style race. */
  readonly items?: boolean;
}

export interface KartSim {
  readonly track: Track;
  setInput(racer: RacerId, input: KartInput): void;
  /** Hand a kart to (or take it back from) the CPU driver. */
  setAutopilot(racer: RacerId, enabled: boolean): void;
  /** Advance by whole fixed steps; returns the number of steps taken. */
  advance(dtSec: number): number;
  /** Advance exactly one fixed step (deterministic test seam). */
  step(): void;
  getState(): RaceState;
  drainEvents(): readonly RaceEvent[];
  result(): RaceResult | null;
}
