import { getPartsForSlot } from "./catalog";
import {
  TOP_LINEAGES,
  TOP_ROLES,
  TOP_SLOTS,
  type BuildCostLimit,
  type TopBuildSpec,
  type TopPartDef,
  type TopSlot,
} from "../types";

/*
 * Lived in App.tsx until v3. It moved here the day a headless measurement
 * needed the same picker and the obvious shortcut was to paste it — which is
 * how this codebase gets two copies of one fact, and the pasted copy had
 * already drifted (its guessed partScore weights were 0.98/1.04 against the
 * real 0.88/0.54, i.e. it measured a different population than live play).
 * One module, imported by the app, the gates, and anything else.
 */

export function partScore(part: TopPartDef): number {
  const stats = part.stats;
  return (
    stats.attack * 1.05 +
    stats.defense +
    stats.stamina * 0.92 +
    stats.stability +
    stats.mobility * 0.88 +
    stats.durability * 0.54
  );
}

export function makeCpuBuild(
  seat: number,
  budget: BuildCostLimit,
  seed: number
): TopBuildSpec {
  const parts = {} as Record<TopSlot, string>;
  let spent = 0;
  for (let slotIndex = 0; slotIndex < TOP_SLOTS.length; slotIndex += 1) {
    const slot = TOP_SLOTS[slotIndex]!;
    const remainingSlots = TOP_SLOTS.slice(slotIndex + 1);
    const reserve = remainingSlots.reduce(
      (total, remaining) =>
        total + Math.min(...getPartsForSlot(remaining).map((part) => part.cost)),
      0
    );
    const preferredLineage = TOP_LINEAGES[(seat * 2 + slotIndex + seed) % TOP_LINEAGES.length]!;
    const preferredRole = TOP_ROLES[(seat + slotIndex + seed) % TOP_ROLES.length]!;
    const choices = [...getPartsForSlot(slot)]
      .filter(
        (part) =>
          !Number.isFinite(budget) ||
          spent + part.cost + reserve <= budget
      )
      .sort((first, second) => {
        const firstTheme =
          (first.lineage === preferredLineage ? 70 : 0) +
          (first.role === preferredRole ? 35 : 0);
        const secondTheme =
          (second.lineage === preferredLineage ? 70 : 0) +
          (second.role === preferredRole ? 35 : 0);
        const firstValue = firstTheme + partScore(first) / Math.max(1, first.cost) * 50;
        const secondValue = secondTheme + partScore(second) / Math.max(1, second.cost) * 50;
        return secondValue - firstValue || first.id.localeCompare(second.id);
      });
    /*
     * A budget below the cheapest completable build empties `choices`, and
     * modulo zero is NaN — the original then dereferenced undefined.
     * Falling back to the slot's cheapest parts keeps the picker total: it
     * may overrun an impossible budget, but a CPU with a build always
     * beats a crash, and validateBuild still reports the overrun.
     */
    const pool = choices.length > 0
      ? choices
      : [...getPartsForSlot(slot)].sort((first, second) => first.cost - second.cost);
    const chosen = pool[(seed + seat + slotIndex) % Math.min(4, pool.length)] ?? pool[0]!;
    parts[slot] = chosen.id;
    spent += chosen.cost;
  }
  return {
    v: 1,
    name: `CPU-${String(seat).padStart(2, "0")} ${TOP_LINEAGES[(seat + seed) % TOP_LINEAGES.length]!.toUpperCase()}`,
    paint: 0,
    parts
  };
}
