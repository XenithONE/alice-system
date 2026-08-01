/**
 * Where a class, a character and a machine become one set of coefficients.
 *
 * Two rules hold this together, and both are enforced rather than described.
 *
 * The first is that `gripScale` is DERIVED. It is the product of the speed and
 * turn scales — lateral acceleration is v*omega — and the AI's braking model
 * reads it to decide how fast a corner can be taken. A catalog that could
 * write it directly could set a machine's grip apart from its actual cornering
 * ability, and the CPU would brake for a corner it then failed to make. The
 * physics key sets below simply do not contain it, so no data file can.
 *
 * The second is that this runs ONCE, when a kart is built, and the result is
 * held read-only for the race. Floating point multiplication is not
 * associative: `((BASE * s) * w) * c` and `(BASE * (s * w)) * c` differ in the
 * last bit, and a difference in the last bit is a different race after ninety
 * seconds of integration. Weather is deliberately NOT folded in here for that
 * reason — it multiplies at its existing sites in sim.ts, in its existing
 * order, and the lap times stay exactly what they were.
 */

import { SPEED_CLASSES } from "../sim/balance";
import type { CharacterDef } from "./characters";
import type { MachineDef } from "./machines";

/** Shown to the player as stars. The sim never reads these. */
export const DISPLAY_STAT_KEYS = [
  "speed",
  "accel",
  "handling",
  "weight",
  "luck",
] as const;
export type DisplayStatKey = (typeof DISPLAY_STAT_KEYS)[number];
export type DisplayStats = Readonly<Record<DisplayStatKey, 1 | 2 | 3 | 4 | 5>>;

/** Coefficients a machine may carry. Note the absence of `gripScale`. */
export const MACHINE_PHYSICS_KEYS = [
  "speedScale",
  "turnScale",
  "accelScale",
  "offroadScale",
  "bumpScale",
] as const;
export type MachinePhysicsKey = (typeof MACHINE_PHYSICS_KEYS)[number];

/** Coefficients a character may carry: how it is driven, and its luck. */
export const CHARACTER_PHYSICS_KEYS = [
  "driftChargeScale",
  "boostAccelScale",
  "itemLuck",
] as const;
export type CharacterPhysicsKey = (typeof CHARACTER_PHYSICS_KEYS)[number];

export interface KartTuning {
  readonly speedScale: number;
  readonly turnScale: number;
  /** Always speedScale * turnScale. Only this file can produce it. */
  readonly gripScale: number;
  readonly accelScale: number;
  readonly boostAccelScale: number;
  readonly offroadScale: number;
  readonly bumpScale: number;
  readonly driftChargeScale: number;
  readonly itemLuck: number;
}

/** The identity kit: every coefficient exactly 1, so `x * 1 === x` holds. */
export const REFERENCE_TUNING: KartTuning = {
  speedScale: 1,
  turnScale: 1,
  gripScale: 1,
  accelScale: 1,
  boostAccelScale: 1,
  offroadScale: 1,
  bumpScale: 1,
  driftChargeScale: 1,
  itemLuck: 1,
};

export function classTuningFor(speedClass: number): {
  speedScale: number;
  turnScale: number;
} {
  const entry =
    SPEED_CLASSES[Math.max(0, Math.min(SPEED_CLASSES.length - 1, speedClass))]!;
  return { speedScale: entry.speedScale, turnScale: entry.turnScale };
}

export function combineTuning(
  classTuning: { speedScale: number; turnScale: number },
  character: CharacterDef | null,
  machine: MachineDef | null,
): KartTuning {
  const speedScale = classTuning.speedScale * (machine?.physics.speedScale ?? 1);
  const turnScale = classTuning.turnScale * (machine?.physics.turnScale ?? 1);
  return {
    speedScale,
    turnScale,
    gripScale: speedScale * turnScale,
    accelScale: machine?.physics.accelScale ?? 1,
    offroadScale: machine?.physics.offroadScale ?? 1,
    bumpScale: machine?.physics.bumpScale ?? 1,
    boostAccelScale: character?.physics.boostAccelScale ?? 1,
    driftChargeScale: character?.physics.driftChargeScale ?? 1,
    itemLuck: character?.physics.itemLuck ?? 1,
  };
}
