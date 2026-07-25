// Host-owned deterministic RNG. sim/ NEVER calls Math.random — every random
// decision flows through an injected Rng so headless selftests replay exactly.
// Physics itself is not assumed deterministic (see ARCHITECTURE.md); this only
// keeps spawn order, AI jitter and hazard timing reproducible.
import type { Rng } from "./types";

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = next as Rng;
  rng.int = (maxExclusive: number): number => Math.floor(next() * maxExclusive);
  rng.range = (min: number, max: number): number => min + next() * (max - min);
  return rng;
}

export const pick = <T>(rng: Rng, arr: readonly T[]): T => arr[rng.int(arr.length)]!;
