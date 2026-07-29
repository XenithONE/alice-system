/**
 * Gate: how matches END, measured on the builds live play actually produces.
 *
 * Two prior beliefs about finishes were both measurement artifacts:
 *
 * - "Ring-outs barely happen (1 in 32)" came from headlessSelftest's
 *   fixtures, whose Burst skill nukes for 82 damage in a 10m radius — a
 *   destruction generator, not the game. Representative builds measure the
 *   opposite: ring-out was already 90% of finishes.
 * - The real defects were invisible until instrumented: seven of twenty
 *   matches ended inside 8 seconds (launch momentum + first touch, several
 *   at 1.5-3s on exactly one impact), and destruction NEVER happened in
 *   regulation — median contact damage was 5 against 502 hp, so 47 clean
 *   hits could not finish anyone and every attack stat was cosmetic.
 *
 * The fixes this file guards: a launch-window rim brake (no finish before
 * the guard elapses) and CONTACT_DAMAGE_SCALE 0.18 → 0.5 (destruction is a
 * real path). Ring-out staying the PRIMARY finish is the user's decision and
 * is asserted, not assumed.
 *
 * Builds come from the same makeCpuBuild live play uses — content/cpuBuild —
 * because a pasted copy of that picker already drifted once (guessed weights
 * 0.98/1.04 against the real 0.88/0.54, a different population entirely).
 *
 * Run: npx tsx src/vortex/sim/finishSelftest.ts
 */
import { makeCpuBuild } from "../content/cpuBuild";
import { deriveBuildStats } from "../content";
import { EDGE_EARLY_GUARD_SEC } from "./balance";
import {
  aiActivation,
  createVortexSim,
  resolvedBuildFromDerived,
} from "./index";
import type { SeatIndex } from "./types";

declare const process: { exitCode?: number };

const failures: string[] = [];
const check = (name: string, ok: boolean, detail: string): void => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
  if (!ok) failures.push(name);
};

interface Finish {
  readonly arena: string;
  readonly reason: string;
  readonly atSec: number;
}

/**
 * The two ends of the arena spectrum: pressure-crater is the smallest and
 * produced every sub-2s fluke; wide-dish is the largest and the only place
 * regulation destruction was observed. A gate that passes on both bounds
 * the middle three.
 */
const ARENAS = ["pressure-crater", "wide-dish"] as const;
const SEEDS_PER_ARENA = 5;

async function main(): Promise<void> {
  const finishes: Finish[] = [];
  const damageSamples: number[] = [];
  let unresolved = 0;

  for (const arenaId of ARENAS) {
    for (let round = 0; round < SEEDS_PER_ARENA; round += 1) {
      const seed = 0xf1215 + arenaId.length * 131 + round * 7919;
      const builds = [0, 1].map((seat) =>
        resolvedBuildFromDerived(
          deriveBuildStats(makeCpuBuild(seat, 1000, seed + seat * 101)),
        ),
      );
      const sim = await createVortexSim({
        seed,
        builds,
        teamIds: [0, 1],
        launchPower: [0.75 + (seed % 5) * 0.1, 0.75 + ((seed >> 3) % 5) * 0.1],
        cpuSeats: [0, 1] as SeatIndex[],
        arenaId,
        countdownSec: 0,
        suddenDeathSec: 120,
        maxDurationSec: 240,
      });
      try {
        let guard = 0;
        while (!sim.result() && guard < 240 * 60) {
          for (const seat of [0, 1] as const) {
            const slot = aiActivation(sim, seat);
            if (slot !== null) sim.activate(seat, slot);
          }
          sim.step();
          for (const event of sim.drainEvents()) {
            if (event.type === "impact") damageSamples.push(event.damage);
          }
          guard += 1;
        }
        const result = sim.result();
        if (!result) {
          unresolved += 1;
          continue;
        }
        for (const knockout of result.knockouts) {
          finishes.push({
            arena: arenaId,
            reason: knockout.reason,
            atSec: knockout.at,
          });
        }
      } finally {
        sim.dispose();
      }
    }
  }

  console.table(
    finishes.map((finish) => ({
      arena: finish.arena,
      reason: finish.reason,
      at: Number(finish.atSec.toFixed(1)),
    })),
  );

  const ringOuts = finishes.filter((finish) => finish.reason === "ring-out").length;
  const earliest = Math.min(...finishes.map((finish) => finish.atSec));
  const sortedDamage = [...damageSamples].sort((left, right) => left - right);
  const medianDamage = sortedDamage[Math.floor(sortedDamage.length / 2)] ?? 0;

  check(
    "[F0] 全試合が決着する",
    unresolved === 0 && finishes.length >= ARENAS.length * SEEDS_PER_ARENA,
    `未決着 ${unresolved} 件・ノックアウト ${finishes.length} 件`,
  );

  /*
   * The launch-guard guarantee. Before the rim brake the panel contained
   * finishes at 1.5s, 1.7s, 2.4s, 3.0s — matches decided by the first touch
   * while the launch transient was still carrying both tops.
   */
  check(
    "[F1] ガード時間内の決着が存在しない",
    earliest >= EDGE_EARLY_GUARD_SEC,
    `最速の決着 ${earliest.toFixed(1)}s（ガード ${EDGE_EARLY_GUARD_SEC}s）`,
  );

  // ユーザー決定：場外は主要な決着手段であり続ける。
  check(
    "[F2] 場外が決着の過半数",
    ringOuts * 2 >= finishes.length,
    `場外 ${ringOuts}/${finishes.length}`,
  );

  /*
   * Destruction viability, asserted on the damage pipeline rather than on a
   * destruction happening — whether a given panel contains one is luck, but
   * the median hit either can or cannot add up to a health bar. At the old
   * 0.18 scale this measured 5.0; the floor here is comfortably above that
   * and comfortably below the tuned ~13-15.
   */
  check(
    "[F3] 接触ダメージが破壊経路として成立する",
    medianDamage >= 9,
    `中央値 ${medianDamage.toFixed(1)}/hit（サンプル ${damageSamples.length} 件）`,
  );

  if (failures.length > 0) {
    console.log(`FINISH SELFTEST FAIL — ${failures.join(" / ")}`);
    process.exitCode = 1;
  } else {
    console.log("FINISH SELFTEST PASS");
  }
}

void main();
