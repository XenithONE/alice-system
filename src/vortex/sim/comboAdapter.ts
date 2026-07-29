/**
 * Content combos, resolved once for the simulation.
 *
 * Two conversions happen here and nowhere else:
 * - `withinTicks` becomes SECONDS. Every deadline inside the simulation is
 *   compared against `elapsed`; ticks are cadence, never deadlines
 *   (ARCHITECTURE_V2 §7). Converting at the boundary means world.ts never
 *   sees a tick count it might be tempted to compare against `tick`.
 * - `SkillEffectDef` (catalog dialect) becomes `SkillEffect` (sim dialect)
 *   through the same `effectsFromCatalog` every skill goes through, so a
 *   combo bonus cannot drift into a private third dialect.
 */
import { COMBOS } from "../content/combos";
import { FIXED_HZ } from "./balance";
import { effectsFromCatalog } from "./catalogAdapter";
import type { SkillEffect } from "./types";

export interface ResolvedCombo {
  readonly id: string;
  readonly nameJa: string;
  readonly opener: string;
  readonly finisher: string;
  readonly windowSec: number;
  readonly effects: readonly SkillEffect[];
}

export const RESOLVED_COMBOS: readonly ResolvedCombo[] = COMBOS.map(
  (combo) => ({
    id: combo.id,
    nameJa: combo.nameJa,
    opener: combo.opener,
    finisher: combo.finisher,
    windowSec: combo.withinTicks / FIXED_HZ,
    effects: combo.effects.flatMap((effect) => effectsFromCatalog(effect, 1)),
  }),
);

export const RESOLVED_COMBOS_BY_OPENER: ReadonlyMap<
  string,
  readonly ResolvedCombo[]
> = (() => {
  const map = new Map<string, ResolvedCombo[]>();
  for (const combo of RESOLVED_COMBOS) {
    const list = map.get(combo.opener) ?? [];
    list.push(combo);
    map.set(combo.opener, list);
  }
  return map;
})();
