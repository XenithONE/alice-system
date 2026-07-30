/**
 * Explicit, directed skill pairs — the v3 answer to "組み合わせのシナジー".
 *
 * Directed and enumerated on purpose. A derived system ("any mobility skill
 * chains into any attack skill") reads as magic in play and is impossible to
 * balance: nobody can list what it produces. Twelve authored pairs can be
 * learned, hunted for in the builder, and each carries its own reward.
 *
 * `withinTicks` is authored in ticks because content thinks in frames, but
 * the simulation's clock is `elapsed` seconds — the adapter converts ONCE at
 * resolve time (ticks are cadence, never deadlines; see ARCHITECTURE_V2 §7).
 *
 * Windows were tightened x0.6 in v3.1 (3s -> ~1.1-1.8s): a deliberate
 * sequencer measured 92% finisher success against the original windows,
 * which made the "combo" a formality rather than a timing skill.
 *
 * The pair (opener, finisher) must be two DIFFERENT skills. Same-slot
 * self-pairs are structurally impossible in the simulation anyway — the
 * window is written after detection runs — but the gate refuses them here
 * too, so the invariant is stated where authors look.
 */
import type { SkillEffectDef } from "../types";

export interface ComboDef {
  readonly id: string;
  readonly nameJa: string;
  /** Skill id that must fire first. */
  readonly opener: string;
  /** Skill id that must fire while the window is open. */
  readonly finisher: string;
  /** Window length, in simulation ticks (60/s). */
  readonly withinTicks: number;
  /** Bonus effects, applied to the comboing top when the finisher lands. */
  readonly effects: readonly SkillEffectDef[];
}

export const COMBOS: readonly ComboDef[] = [
  {
    id: "spiral-blast",
    nameJa: "旋回爆圏",
    opener: "vortex-dash",
    finisher: "shock-ring",
    withinTicks: 90,
    effects: [{ kind: "radial-damage", amount: 26, radius: 2.6 }],
  },
  {
    id: "hunters-verdict",
    nameJa: "狩王の裁き",
    opener: "hunter-lunge",
    finisher: "crown-breaker",
    withinTicks: 72,
    effects: [
      { kind: "stat-multiplier", stat: "attack", multiplier: 1.35, durationSec: 3 },
    ],
  },
  {
    id: "phase-riposte",
    nameJa: "位相反撃",
    opener: "phase-skid",
    finisher: "counter-spin",
    withinTicks: 66,
    effects: [
      { kind: "shield", amount: 60, durationSec: 2.2 },
      { kind: "spin", amount: 9 },
    ],
  },
  {
    id: "anchored-singularity",
    nameJa: "重錨特異点",
    opener: "anchor-drop",
    finisher: "gravity-well",
    withinTicks: 96,
    effects: [
      { kind: "stat-multiplier", stat: "stability", multiplier: 1.4, durationSec: 3 },
    ],
  },
  {
    id: "chain-ignition",
    nameJa: "連鎖起動",
    opener: "burst-drive",
    finisher: "kinetic-pulse",
    withinTicks: 78,
    effects: [{ kind: "spin", amount: 14 }],
  },
  {
    id: "rim-return",
    nameJa: "縁の返し",
    opener: "rim-brake",
    finisher: "edge-reversal",
    withinTicks: 84,
    effects: [
      { kind: "impulse", direction: "toward-center", strength: 7 },
      { kind: "stat-multiplier", stat: "mobility", multiplier: 1.2, durationSec: 2.5 },
    ],
  },
  {
    id: "harvest-execution",
    nameJa: "収奪処刑",
    opener: "momentum-siphon",
    finisher: "execution-drive",
    withinTicks: 90,
    effects: [
      { kind: "stat-multiplier", stat: "attack", multiplier: 1.25, durationSec: 2.5 },
      { kind: "spin", amount: 8 },
    ],
  },
  {
    id: "periapsis-strike",
    nameJa: "近点強襲",
    opener: "slipstream",
    finisher: "periapsis-lance",
    withinTicks: 72,
    effects: [{ kind: "impulse", direction: "toward-target", strength: 8 }],
  },
  {
    id: "morning-rush",
    nameJa: "モーニングラッシュ",
    opener: "coffee-overfill",
    finisher: "deadline-dash",
    withinTicks: 108,
    effects: [
      { kind: "spin", amount: 10 },
      { kind: "stat-multiplier", stat: "mobility", multiplier: 1.3, durationSec: 2 },
    ],
  },
  {
    id: "overheat-resonance",
    nameJa: "過熱共鳴",
    opener: "heat-vent",
    finisher: "resonance-burst",
    withinTicks: 90,
    effects: [{ kind: "radial-damage", amount: 20, radius: 2.2 }],
  },
  {
    id: "double-reboot",
    nameJa: "二段再起",
    opener: "gyroscopic-reset",
    finisher: "core-reboot",
    withinTicks: 102,
    effects: [{ kind: "durability", amount: 26 }],
  },
  {
    id: "eclipse-impact",
    nameJa: "蝕の激突",
    opener: "eclipse-step",
    finisher: "torque-spike",
    withinTicks: 72,
    effects: [
      { kind: "stat-multiplier", stat: "attack", multiplier: 1.3, durationSec: 2 },
    ],
  },
];

export const COMBO_BY_ID: ReadonlyMap<string, ComboDef> = new Map(
  COMBOS.map((combo) => [combo.id, combo]),
);

/** Openers indexed for the simulation's per-activation lookup. */
export const COMBOS_BY_OPENER: ReadonlyMap<string, readonly ComboDef[]> = (() => {
  const map = new Map<string, ComboDef[]>();
  for (const combo of COMBOS) {
    const list = map.get(combo.opener) ?? [];
    list.push(combo);
    map.set(combo.opener, list);
  }
  return map;
})();
