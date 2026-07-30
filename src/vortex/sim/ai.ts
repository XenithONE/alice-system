import { RESOLVED_COMBOS_BY_OPENER } from "./comboAdapter";
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

/*
 * Whole id-segments, so substrings cannot misfire. aiSelftest measures these
 * against the live catalog and fails if either list stops matching — the
 * exact way the previous name-based version died silently.
 */
export const OFFENSIVE_SEGMENTS = [
  "dash", "lunge", "drive", "breaker", "spike", "lance", "burst",
  "charge", "strike", "blitz", "execution", "crusher", "bite",
] as const;
export const DEFENSIVE_SEGMENTS = [
  "aegis", "guard", "repair", "brake", "anchor", "shield", "reboot",
  "armor", "veil", "shell", "ballast",
] as const;

function nearestEnemyDistance(state: MatchState, seat: SeatIndex): number {
  const self = state.tops.find((top) => top.seat === seat);
  if (!self) return Number.POSITIVE_INFINITY;
  let nearest = Number.POSITIVE_INFINITY;
  for (const other of state.tops) {
    if (other.seat === seat || !other.alive) continue;
    // Team-blind distance made a co-op CPU read its own wingmate as "in
    // range" and dump offence at a teammate-shaped shadow. `team` is
    // host-side state (not serialized); when absent, fall back to
    // everyone-is-an-enemy, which is correct for the FFA default.
    if (
      self.team !== undefined &&
      other.team !== undefined &&
      other.team === self.team
    ) {
      continue;
    }
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
  const window = top.comboWindow;
  /*
   * Ids this top has equipped, for the finisher-hold rule below. Without it
   * the probe measured the policy WASTING finishers: at spawn range the
   * offence-hold fired the neutral finisher first, so by the time its
   * opener created a window the finisher was deep in cooldown — 14 opener
   * fires, zero combos, again, with combo-seeking supposedly on.
   */
  const equippedIds = new Set(
    top.skills.map((slot) => slot.skillId).filter((id) => id !== null),
  );
  const scored = ordered
    .map((skill, index) => {
      /*
       * Classified on the skill ID, not the display name. The first version
       * matched English words against `skill.name` — which the adapter
       * replaces with nameJa, so against the real catalog the regexes
       * matched ZERO of 57 skills and level 3 was byte-identical to level 2.
       * IDs are Latin, stable, and matched as whole hyphen-segments so
       * "emergency-ramen" does not read as /ram/ and get held at range
       * while its owner bleeds out. A miss still degrades to level-2
       * behaviour, never to an error.
       */
      const segments = new Set((skill.skillId ?? "").split("-"));
      const offensive = OFFENSIVE_SEGMENTS.some((word) => segments.has(word));
      const defensive = DEFENSIVE_SEGMENTS.some((word) => segments.has(word));
      let score = ordered.length - index;
      if (offensive && distance > 3.2) score -= 100;
      if (defensive && hurting) score += 100;
      if (defensive && !hurting) score -= 40;
      /*
       * Finishing an open combo beats everything else. Without this rule a
       * CPU never combos at all except by cooldown coincidence — measured:
       * 98 opener fires, zero combos across twenty matches.
       */
      if (window) {
        const finishes = (
          RESOLVED_COMBOS_BY_OPENER.get(window.opener) ?? []
        ).some(
          (combo) =>
            combo.finisher === skill.skillId &&
            state.elapsed - window.openedAt <= combo.windowSec,
        );
        if (finishes) score += 300;
      }
      /*
       * The mirror of the window bonus: a finisher whose PAIRED opener is
       * also equipped is worth more inside a window than outside one, so
       * outside one it waits — mildly, not absolutely, or a build with
       * nothing else would deadlock into passivity.
       */
      const wastesFinisher =
        skill.skillId !== null &&
        (!window ||
          !(RESOLVED_COMBOS_BY_OPENER.get(window.opener) ?? []).some(
            (combo) => combo.finisher === skill.skillId,
          )) &&
        [...RESOLVED_COMBOS_BY_OPENER.values()].some((combos) =>
          combos.some(
            (combo) =>
              combo.finisher === skill.skillId &&
              equippedIds.has(combo.opener),
          ),
        );
      /*
       * -12, not a lockout: at -60 the hold outweighed every positional
       * reason to fire, and the probe showed the pilot losing MORE games
       * than the combo bonus won back — kinetic skills have value beyond
       * their pair. A mild preference keeps ~half the finishers for their
       * windows without distorting the fight.
       */
      if (wastesFinisher) score -= 12;
      return { slot: skill.slot, score };
    })
    .sort((first, second) => second.score - first.score);
  const best = scored[0];
  // Everything legal is currently pointless — hold fire this window.
  if (!best || best.score <= -50) return null;
  return best.slot;
}
