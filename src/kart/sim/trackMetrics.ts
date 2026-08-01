/**
 * The measurements a circuit has to survive, in one place.
 *
 * These lived inside `trackSelftest.ts`. They moved because a layout tool now
 * needs them too, and a tool that re-implements the gate's arithmetic is not a
 * tool — it is a second opinion that will eventually disagree with the first,
 * at which point a course passes the forge and fails CI with no way to tell
 * which one is wrong. The gate imports these; the forge imports these; there
 * is one definition of "too tight" and one of "too close".
 */

import { SHOULDER_WIDTH } from "./balance";
import { arcDelta, pointAt, querySurface, type Track } from "./track";

/**
 * Worst radius-to-half-width ratio on the lap.
 *
 * Below about 2.5 the un-hinted projection in `querySurface` can pick a sample
 * from the far side of the corner, because the road is wider than the arc is
 * long. The fix on a real layout is not always a bigger radius — narrowing the
 * road through that one corner raises the ratio just as well, and `buildTrack`
 * interpolates width, so it can be done over three control points.
 */
export function turnRatio(track: Track): {
  ratio: number;
  index: number;
  radius: number;
} {
  let worst = Infinity;
  let index = 0;
  let radius = Infinity;
  for (let i = 0; i < track.samples.length; i += 1) {
    const sample = track.samples[i]!;
    const r =
      Math.abs(sample.curvature) < 1e-6 ? Infinity : 1 / Math.abs(sample.curvature);
    const ratio = r / sample.half;
    if (ratio < worst) {
      worst = ratio;
      index = i;
      radius = r;
    }
  }
  return { ratio: worst, index, radius };
}

/**
 * Smallest clearance between two stretches more than 120 m apart along the lap.
 *
 * This is what forbids figure-eights, flyovers and long parallel straights: the
 * projection has no way to tell which of two nearby stretches a point belongs
 * to. Height does not help — the test is in plan view, because the projection
 * is. Hairpins are fine; the 120 m window excludes the apex's own neighbours.
 *
 * Design rule that follows: keep stretches 120 m apart in arc length at least
 * 35 m apart on the ground.
 */
export function selfProximity(track: Track): {
  gap: number;
  a: number;
  b: number;
} {
  const samples = track.samples;
  let worst = Infinity;
  let worstA = 0;
  let worstB = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const a = samples[i]!;
    for (let j = i + 1; j < samples.length; j += 1) {
      const b = samples[j]!;
      const along = Math.abs(arcDelta(track, a.s, b.s));
      if (along < 120) continue;
      const centre = Math.hypot(b.x - a.x, b.z - a.z);
      const required = a.half + b.half + SHOULDER_WIDTH * 2;
      const slack = centre - required;
      if (slack < worst) {
        worst = slack;
        worstA = i;
        worstB = j;
      }
    }
  }
  return { gap: worst, a: worstA, b: worstB };
}

/**
 * Worst disagreement between "put a point here" and "where is this point".
 *
 * `window` staleness is deliberate: the sim carries a sample hint from the
 * previous tick, so the projection must land on the same answer from a hint
 * that is a dozen samples out of date.
 */
export function roundTripError(track: Track, window: number): number {
  let worst = 0;
  for (let i = 0; i < track.samples.length; i += 7) {
    const sample = track.samples[i]!;
    for (const fraction of [-0.8, -0.3, 0, 0.45, 0.9]) {
      const lateral = sample.half * fraction;
      const [x, , z] = pointAt(track, sample.s, lateral);
      const hint = (i + window) % track.samples.length;
      const query = querySurface(track, x, z, hint, SHOULDER_WIDTH);
      worst = Math.max(
        worst,
        Math.abs(query.lateral - lateral),
        Math.abs(arcDelta(track, query.s, sample.s)),
      );
    }
  }
  return worst;
}

/**
 * How far the verge mesh reaches beyond the road edge. `bothSides` lofts it
 * out to 20 m no matter how wide the road is, so on the INSIDE of a corner it
 * reaches `radius − half − 20` from the centre of curvature — and once that
 * goes negative the band folds through itself and comes out facing the ground.
 */
export const VERGE_EXTENT = 20;

/**
 * The tightest corner whose inside verge still lies flat.
 *
 * [T6]'s ratio does not cover this. A ratio is scale-free and the verge is
 * not: narrowing the road raises R/half and lowers this floor by only half as
 * much, so a corner can satisfy [T6] comfortably and still fold. Found on
 * ALPINE PASS, where a 23.5 m hairpin passed [T6] at 3.15 and produced exactly
 * one downward normal out of 3632 — which reads on screen as a single dark
 * polygon on one verge, if it reads at all.
 */
export function vergeFloor(track: Track): {
  worst: number;
  required: number;
  index: number;
} {
  let worst = Infinity;
  let required = 0;
  let index = 0;
  for (let i = 0; i < track.samples.length; i += 1) {
    const sample = track.samples[i]!;
    const r =
      Math.abs(sample.curvature) < 1e-6 ? Infinity : 1 / Math.abs(sample.curvature);
    const slack = r - sample.half - VERGE_EXTENT;
    if (slack < worst) {
      worst = slack;
      required = sample.half + VERGE_EXTENT;
      index = i;
    }
  }
  return { worst, required, index };
}

/** The thresholds the gates hold circuits to. One copy, imported by both. */
export const TRACK_LIMITS = {
  /** [T6] */ minTurnRatio: 2.5,
  /** [T8] */ minSelfGap: 2,
  /** [T3] */ maxRoundTrip: 0.4,
  /** [T14] metres of clearance the inside verge needs beyond folding. */
  minVergeSlack: 1.5,
} as const;

/** Everything at once: what a layout tool needs to accept or reject a candidate. */
export function trackMetrics(track: Track): {
  turn: ReturnType<typeof turnRatio>;
  proximity: ReturnType<typeof selfProximity>;
  verge: ReturnType<typeof vergeFloor>;
  roundTrip: number;
  staleRoundTrip: number;
  passes: boolean;
} {
  const turn = turnRatio(track);
  const proximity = selfProximity(track);
  const roundTrip = roundTripError(track, 0);
  const staleRoundTrip = roundTripError(track, 12);
  const verge = vergeFloor(track);
  return {
    turn,
    proximity,
    verge,
    roundTrip,
    staleRoundTrip,
    passes:
      turn.ratio > TRACK_LIMITS.minTurnRatio &&
      proximity.gap > TRACK_LIMITS.minSelfGap &&
      verge.worst > TRACK_LIMITS.minVergeSlack &&
      roundTrip < TRACK_LIMITS.maxRoundTrip &&
      staleRoundTrip < TRACK_LIMITS.maxRoundTrip,
  };
}
