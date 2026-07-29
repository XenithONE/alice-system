import type { MatchState, SeatIndex, SkillSlot, VortexSim } from "./types";

/**
 * CPU skill policy. Movement and target selection are intrinsic to the
 * simulation, so this only decides WHEN to spend a numbered active — which
 * is also why difficulty lives here and nowhere else.
 *
 * Three levels, all deterministic (tick arithmetic, no RNG), because CPU
 * decisions run inside the host's authoritative loop and a replay must
 * reproduce them:
 *
 * 1 — hesitant. Acts only in alternating half-second windows, so roughly
 *     half of its opportunities pass unused.
 * 2 — the historical behaviour, unchanged: rotate through ready skills,
 *     spend finite charges first. Every existing selftest and probe that
 *     calls aiActivation without a level measures exactly this.
 * 3 — deliberate. Reads the same MatchState the player sees: holds an
 *     obviously offensive skill while the nearest enemy is out of reach
 *     (3.2m — the catalogue's own target-within convention) and prefers
 *     repair/defence when its own hp is under 45%.
 */
export type CpuLevel = 1 | 2 | 3;

function nearestEnemyDistance(state: MatchState, seat: SeatIndex): number {
  const self = state.tops.find((top) => top.seat === seat);
  if (!self) return Number.POSITIVE_INFINITY;
  let nearest = Number.POSITIVE_INFINITY;
  for (const other of state.tops) {
    if (other.seat === seat || !other.alive) continue;
    const dx = other.position[0] - self.position[0];
    const dz = other.position[2] - self.position[2];
    nearest = Math.min(nearest, Math.hypot(dx, dz));
  }
  return nearest;
}

export function aiActivation(
  sim: VortexSim,
  seat: SeatIndex,
  level: CpuLevel = 2,
): SkillSlot | null {
  if (!sim.isCpu(seat) || sim.phase !== "live") return null;
  const state = sim.getState();
  const top = state.tops.find((candidate) => candidate.seat === seat);
  if (!top?.alive) return null;

  if (level === 1) {
    // Alternating half-second windows, offset per seat so weak CPUs do not
    // all wake up on the same frame.
    if (Math.floor(sim.tick / 30) % 2 !== seat % 2) return null;
  }

  const ready = top.skills.filter((skill) => skill.ready);
  if (ready.length === 0) return null;

  // Stable rotation avoids Math.random and makes headless replays reproducible.
  const offset = (Math.floor(sim.tick / 12) + seat * 3) % ready.length;
  const ordered = ready.slice(offset).concat(ready.slice(0, offset));
  // Spend condition-gated and finite-charge abilities first. Their legal
  // windows are usually narrower than an unlimited "always" skill.
  ordered.sort((first, second) => {
    const firstFinite = first.chargesRemaining >= 0 ? 0 : 1;
    const secondFinite = second.chargesRemaining >= 0 ? 0 : 1;
    return firstFinite - secondFinite;
  });

  if (level < 3) return ordered[0]?.slot ?? null;

  const distance = nearestEnemyDistance(state, seat);
  const hurting = top.hp < top.hpMax * 0.45;
  const scored = ordered
    .map((skill, index) => {
      /*
       * Names are display data, so this reads them loosely and falls back
       * to neutral — a classification miss degrades to level-2 behaviour,
       * never to an error. Effects would be the principled source, but the
       * runtime skill state deliberately does not carry them across the
       * wire; the name heuristic keeps level 3 host-side-only data free.
       */
      const name = skill.name ?? "";
      const offensive = /dash|burst|lance|strike|pulse|drive|charge|blitz|ram/iu.test(name);
      const defensive = /aegis|shield|guard|repair|regen|mend|ward|brake|anchor/iu.test(name);
      let score = ordered.length - index;
      if (offensive && distance > 3.2) score -= 100;
      if (defensive && hurting) score += 100;
      if (defensive && !hurting) score -= 40;
      return { slot: skill.slot, score };
    })
    .sort((first, second) => second.score - first.score);
  const best = scored[0];
  // Everything legal is currently pointless — hold fire this window.
  if (!best || best.score <= -50) return null;
  return best.slot;
}
