/**
 * The performance budget, kept away from the correctness gates.
 *
 * Four selftests used to assert wall-clock time inside checks about whether
 * the game was *correct*. That mixture fails badly in both directions: a busy
 * machine reported a content bug ("[E24] enemy generation is not finite"), and
 * `npm run vortex:gates` sat red for reasons no reader could act on. A gate
 * nobody can keep green is a gate nobody reads.
 *
 * ## Why these numbers and not tighter ones
 *
 * Two attempts at a machine-independent budget failed, and the measurements
 * are worth recording because they rule the approaches out:
 *
 * 1. A scaling ratio (eight tops vs four). Injecting a genuinely quadratic
 *    scan moved it from 1.64 to only 2.15, because fixed per-step cost is 45%
 *    of the eight-top total and swamps the term being measured.
 * 2. Subtracting the fixed cost first. Solving `cost(n) = F + p·n²/2` from the
 *    measured 4/6/8-top points gives F = 3.99ms, p = 0.155ms, and a marginal
 *    ratio of exactly **4.00** for a doubling — the simulation is already,
 *    correctly, quadratic in contact pairs. A gate asserting "not quadratic"
 *    would assert something false about working code.
 *
 * So there is no portable tight bound to be had here. What remains defensible
 * is a **playability floor**: the numbers the game needs in order to be
 * playable at all, with enough headroom that ordinary machine load cannot
 * cross them. These budgets come from the frame rate, not from this laptop.
 *
 * Run: npx tsx src/vortex/sim/perfSelftest.ts
 */
import { FIXED_DT, FIXED_HZ } from "./balance";
import { createVortexSim } from "./index";
import { createSimFixtureBuild } from "./selftestFixture";
import type { SeatIndex } from "./types";

declare const process: { exitCode?: number };

/** One simulation frame at the fixed rate. The sim must fit inside it. */
const FRAME_MS = 1000 / FIXED_HZ;
/** The floor below which the game stops being playable at all. */
const THIRTY_FPS_MS = 1000 / 30;

interface Budget {
  readonly name: string;
  readonly measuredMs: number;
  readonly budgetMs: number;
  readonly why: string;
}

const budgets: Budget[] = [];
const failures: string[] = [];

function record(name: string, measuredMs: number, budgetMs: number, why: string): void {
  budgets.push({ name, measuredMs, budgetMs, why });
  const ok = measuredMs < budgetMs;
  const headroom = budgetMs / Math.max(measuredMs, 1e-9);
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name} — ${measuredMs.toFixed(2)}ms / ${budgetMs.toFixed(2)}ms ` +
      `(余裕 ${headroom.toFixed(1)}倍) — ${why}`
  );
  if (!ok) failures.push(name);
}

/**
 * The same fixture and shape teamSelftest uses, so the two report comparable
 * numbers. Deliberately not imported from there: that file is a correctness
 * gate and must not gain a reason to run a benchmark.
 */
async function measure(allies: number): Promise<{ tops: number; avgStepMs: number }> {
  const count = allies * 2;
  const sim = await createVortexSim({
    seed: 0x7ea01000 + allies,
    builds: Array.from({ length: count }, (_, index) => createSimFixtureBuild(index)),
    teamIds: Array.from({ length: count }, (_, seat) => (seat < allies ? 0 : 1)),
    launchPower: Array.from({ length: count }, (_, seat) => (seat < allies ? 1.25 : 0.25)),
    cpuSeats: Array.from({ length: count }, (_, seat) => seat as SeatIndex),
    arenaId: "wide-dish",
    countdownSec: 0,
    suddenDeathSec: 1,
    maxDurationSec: 2
  });
  try {
    let stepMs = 0;
    let steps = 0;
    const maxSteps = Math.ceil(3 / FIXED_DT);
    for (let step = 0; step < maxSteps && !sim.result(); step += 1) {
      const before = performance.now();
      sim.step();
      stepMs += performance.now() - before;
      steps += 1;
    }
    return { tops: count, avgStepMs: stepMs / Math.max(1, steps) };
  } finally {
    sim.dispose();
  }
}

async function main(): Promise<void> {
  const cases = [await measure(2), await measure(4)];
  const four = cases.find((entry) => entry.tops === 4);
  const eight = cases.find((entry) => entry.tops === 8);

  if (four) {
    record(
      "[P1] 4体が1フレームに収まる",
      four.avgStepMs,
      FRAME_MS,
      `60Hz の1フレーム ${FRAME_MS.toFixed(1)}ms。物理がこれを超えると追いつけない`
    );
  }
  if (eight) {
    record(
      "[P2] 8体でも30fpsを割らない",
      eight.avgStepMs,
      THIRTY_FPS_MS,
      "協力戦の上限構成。描画と分け合っても遊べる下限"
    );
  }

  console.table(
    budgets.map((b) => ({
      budget: b.name,
      measured: Number(b.measuredMs.toFixed(2)),
      limit: Number(b.budgetMs.toFixed(2)),
      headroom: Number((b.budgetMs / b.measuredMs).toFixed(2))
    }))
  );

  if (failures.length > 0) {
    console.log(`VORTEX PERF FAIL — ${failures.join(" / ")}`);
    process.exitCode = 1;
  } else {
    console.log("VORTEX PERF PASS");
  }
}

void main();
