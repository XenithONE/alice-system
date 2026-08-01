import type { Track } from "./track";

/** Up to eight karts on the grid; at most four of them are people. */
export const MAX_RACERS = 8;
export type RacerId = number;

/**
 * The last four are this game's own, and each one plugs into a mechanic the
 * originals do not have: the drift charge, the slipstream, and a mine that is
 * a banana with teeth. New kinds go on the END — the wire sends the index.
 */
export type ItemKind =
  | "mushroom"
  | "triple"
  | "banana"
  | "green"
  | "red"
  | "bomb"
  | "star"
  | "bolt"
  | "turbine"
  | "slipcall"
  | "mine"
  | "emp";

export const ITEM_KINDS: readonly ItemKind[] = [
  "mushroom",
  "triple",
  "banana",
  "green",
  "red",
  "bomb",
  "star",
  "bolt",
  "turbine",
  "slipcall",
  "mine",
  "emp",
];

/** One inventory slot. Three of them, always — empty reads as `null`. */
export interface ItemSlot {
  readonly kind: ItemKind;
  readonly charges: number;
}

export const ITEM_SLOT_COUNT = 3;

/** "draft" lands with protocol v2; the type carries it early so the audio
 * vocabulary can be total from day one. */
export type BoostSource =
  | "mini"
  | "mushroom"
  | "pad"
  | "rocket"
  | "star"
  | "draft"
  | "trick";
export type HitCause = "banana" | "green" | "red" | "bomb" | "bolt" | "star";
export type RacePhase = "countdown" | "race" | "finished";

/**
 * The three item slots are three independent booleans rather than a
 * `slot: 0|1|2|null`, because the sim watches for the rising edge of a press
 * and an enum cannot say "released". They also let a player mash two at once,
 * which is what a three-button inventory is for.
 */
export interface KartInput {
  /** 0..1 */
  readonly throttle: number;
  /** 0..1 */
  readonly brake: number;
  /** -1 (left) .. 1 (right), and truly the right of the screen — see track.ts */
  readonly steer: number;
  readonly drift: boolean;
  /** Machine gimmick, on a cooldown. Carried on the wire before the abilities
   * that read it exist, so the protocol is bumped once rather than twice. */
  readonly gimmick: boolean;
  /** Character skill, likewise. */
  readonly skill: boolean;
  readonly item0: boolean;
  readonly item1: boolean;
  readonly item2: boolean;
  readonly lookBack: boolean;
}

export const NEUTRAL_INPUT: KartInput = {
  throttle: 0,
  brake: 0,
  steer: 0,
  drift: false,
  gimmick: false,
  skill: false,
  item0: false,
  item1: false,
  item2: false,
  lookBack: false,
};

export type RaceEvent =
  | { readonly k: "countdown"; readonly n: number }
  | { readonly k: "go" }
  | { readonly k: "pickup"; readonly racer: RacerId; readonly box: number }
  | {
      readonly k: "item";
      readonly racer: RacerId;
      readonly item: ItemKind;
      /** Which of the three slots it landed in. */
      readonly slot: number;
    }
  | {
      readonly k: "use";
      readonly racer: RacerId;
      readonly item: ItemKind;
      readonly slot: number;
    }
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
  | { readonly k: "trick"; readonly racer: RacerId }
  /* The hop itself. Its height already rides the wire in `y`; this exists so
   * the sound and the dust land on the frame the kart left the ground. */
  | { readonly k: "hop"; readonly racer: RacerId }
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
  /** Mid-air trick spin in progress (lands into a boost). */
  readonly tricking: boolean;
  /** Sitting in someone's slipstream (charging or bursting). */
  readonly drafting: boolean;
  readonly boostTimer: number;
  readonly boostSource: BoostSource | null;
  readonly spinTimer: number;
  readonly squashTimer: number;
  /** Engine burnt out on the line — smoke, not stars. */
  readonly stalled: boolean;
  readonly starTimer: number;
  readonly boltTimer: number;
  readonly graceTimer: number;
  /** Always ITEM_SLOT_COUNT long; an empty slot is null, never a partial. */
  readonly items: readonly (ItemSlot | null)[];
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

export type HazardKind = "banana" | "mine";

export interface HazardState {
  readonly id: number;
  readonly kind: HazardKind;
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
  /** Index into SPEED_CLASSES; default 1 = 150cc. */
  readonly speedClass?: number;
  /** Mirror the circuit (used only when `track` is not injected). */
  readonly mirror?: boolean;
  readonly weather?: import("./balance").WeatherKind;
  /** Time trial: every human seat starts holding a triple mushroom. */
  readonly startTriple?: boolean;
  /** Test-only override of the class tuning (proves gates measure the dial). */
  readonly classTuning?: {
    readonly speedScale: number;
    readonly turnScale: number;
    readonly gripScale: number;
  };
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
