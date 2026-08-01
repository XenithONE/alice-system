import type { BoostSource, ItemKind, KartInput, RacerId } from "./types";

/**
 * The mutable per-kart record the simulation owns.
 *
 * It lives in its own module so the CPU driver can read it without importing
 * the simulation (which imports the driver). Nothing outside `sim.ts` may
 * write to it.
 */
export interface KartRuntime {
  readonly id: RacerId;
  readonly name: string;
  /**
   * Mutable: a guest who drops mid-race hands their kart to the CPU. A kart
   * left on a dead input stream simply stops, which turns one person's network
   * problem into a roadblock for everybody behind them.
   */
  cpu: boolean;
  readonly cpuLevel: number;
  readonly livery: number;

  x: number;
  y: number;
  z: number;
  vy: number;
  yaw: number;
  slip: number;
  speed: number;
  airborne: boolean;
  offRoad: boolean;

  /** Smoothed steering, -1..1. */
  steer: number;
  drifting: boolean;
  driftDir: number;
  driftCharge: number;
  driftTier: number;

  boostTimer: number;
  boostSource: BoostSource | null;
  spinTimer: number;
  squashTimer: number;
  /** Burnt-out start: no drive, but the kart keeps its heading and its item. */
  stallTimer: number;
  starTimer: number;
  boltTimer: number;
  graceTimer: number;

  item: ItemKind | null;
  itemCharges: number;
  rouletteTimer: number;
  itemCooldown: number;
  itemHeld: boolean;

  /** Arc length of the last projection, 0..trackLength. */
  lastS: number;
  /** Signed lateral offset of the last projection (right of centre). */
  lastLateral: number;
  /** Road half width at the last projection. */
  lastHalf: number;
  /** Signed total distance along the centreline; the only progress authority. */
  distance: number;
  sampleHint: number;
  lap: number;
  place: number;
  wrongWay: boolean;
  finished: boolean;
  finishTime: number | null;
  lapStartTime: number;
  bestLap: number | null;
  lastLap: number | null;

  stuckTimer: number;
  stuckMark: number;
  wallCooldown: number;
  /** Drift-start hop: seconds remaining of the ballistic arc. */
  hopTimer: number;
  /** Continuous airborne seconds (tricks need real air, not a kerb blip). */
  airTime: number;
  /** A trick was queued mid-air; landing converts it to a boost. */
  trickQueued: boolean;
  rampCooldown: number;
  /** Slipstream charge, seconds in the cone. */
  draftCharge: number;
  /** True while this kart is visibly in someone's wake. */
  drafting: boolean;
  /** Accumulated accelerator hold during the countdown (rocket start). */
  countdownHold: number;

  input: KartInput;

  /** CPU scratch — unused for humans. */
  cpuItemTimer: number;
  cpuDriftHold: number;
  cpuWander: number;
  cpuWanderTimer: number;
}
