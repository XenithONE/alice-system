/**
 * Grand-prix scoring, pure.
 *
 * The points table is the MKDS-style 8-racer classic. The first-place premium
 * (Δ2 vs Δ1 everywhere else) is the design: two wins and a fourth (25) beats
 * three seconds (24), so racing for the win is worth a risk. An F1-style
 * 25/18/15 was rejected — over a three-race cup one bad race becomes
 * unrecoverable and kills the retry loop this mode exists to create.
 */

import { hashStr } from "../../lib/seed";
import type { RaceResult } from "../sim/types";
import { TRACKS } from "../sim/tracks";

export const GP_POINTS: readonly number[] = [10, 8, 6, 5, 4, 3, 2, 1];

/**
 * A cup is three races. Fixed, not `TRACKS.length` — that was the same number
 * by coincidence while there were exactly three circuits, and the moment a
 * fourth landed a grand prix silently became four races and twenty minutes
 * long. The comment above explains why three is the number: it is short enough
 * that a bad race gets retried instead of abandoned.
 *
 * `[M3]` could not have caught that. It compared the round count against
 * `TRACKS.length` on both sides of the assertion, so it agreed with whatever
 * the code did.
 */
export const CUP_ROUNDS = 3;

/**
 * Which circuits the cup runs, in order.
 *
 * Still the first three, so an existing `gpGold` record keeps meaning what it
 * meant. The plan's split into two named cups needs a key migration on that
 * record — otherwise winning the easy cup unlocks the achievement for both —
 * and that belongs with the migration, not with a new circuit.
 */
export function cupTrackOrder(): readonly string[] {
  return TRACKS.slice(0, CUP_ROUNDS).map((spec) => spec.id);
}

/** Per-round race seed, derived so every round differs but replays match. */
export function raceSeedForRound(cupSeed: number, round: number): number {
  return hashStr(`nk-cup:${cupSeed >>> 0}:${round}`) >>> 0;
}

/** Add one race's points into the running, seat-indexed tally. */
export function applyCupPoints(
  points: readonly number[],
  result: RaceResult,
): number[] {
  const next = points.slice();
  for (const standing of result.standings) {
    while (next.length <= standing.id) next.push(0);
    next[standing.id] =
      (next[standing.id] ?? 0) + (GP_POINTS[standing.place - 1] ?? 0);
  }
  return next;
}

export interface CupStanding {
  readonly seat: number;
  readonly points: number;
  /** Finishing place in the most recent round — the tiebreak. */
  readonly lastPlace: number;
  readonly rank: number;
}

/**
 * Rank a cup. Tiebreak: total points, then place in the most recent round,
 * then seat index — deterministic on every client.
 */
export function cupStandings(
  points: readonly number[],
  lastResult: RaceResult | null,
): CupStanding[] {
  const lastPlace = new Map<number, number>();
  for (const standing of lastResult?.standings ?? []) {
    lastPlace.set(standing.id, standing.place);
  }
  const rows = points.map((total, seat) => ({
    seat,
    points: total,
    lastPlace: lastPlace.get(seat) ?? 99,
  }));
  rows.sort((a, b) => {
    if (a.points !== b.points) return b.points - a.points;
    if (a.lastPlace !== b.lastPlace) return a.lastPlace - b.lastPlace;
    return a.seat - b.seat;
  });
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}
