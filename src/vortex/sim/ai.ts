import type { SeatIndex, SkillSlot, VortexSim } from "./types";

/**
 * Picks one currently legal active skill for a CPU seat. Movement and target
 * selection are intrinsic to the simulation, so CPU policy only decides when
 * to spend a numbered active.
 */
export function aiActivation(sim: VortexSim, seat: SeatIndex): SkillSlot | null {
  if (!sim.isCpu(seat) || sim.phase !== "live") return null;
  const top = sim.getState().tops.find((candidate) => candidate.seat === seat);
  if (!top?.alive) return null;
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
  return ordered[0]?.slot ?? null;
}
