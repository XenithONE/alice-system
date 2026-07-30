/**
 * Gate: the three CPU levels are actually three different players.
 *
 * Level 3 already died once without anyone noticing: its classifier matched
 * English words against a field the adapter had replaced with Japanese, so
 * it matched ZERO of 57 skills and was byte-identical to level 2 — and every
 * selftest called aiActivation without a level, so nothing measured the
 * difference. This file is that measurement.
 *
 * Run: npx tsx src/vortex/sim/aiSelftest.ts
 */
import { ACTIVE_SKILLS } from "../content/skills";
import {
  aiActivation,
  DEFENSIVE_SEGMENTS,
  OFFENSIVE_SEGMENTS,
} from "./ai";
import { RESOLVED_COMBOS } from "./comboAdapter";
import { createVortexSim } from "./index";
import { createSimFixtureBuild } from "./selftestFixture";
import type { ResolvedActiveSkill, SeatIndex } from "./types";

declare const process: { exitCode?: number };

const failures: string[] = [];
const check = (name: string, ok: boolean, detail: string): void => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
  if (!ok) failures.push(name);
};

/* 1 — the classifier bites on the LIVE catalog ------------------------- */

const classify = (list: readonly string[]): string[] =>
  ACTIVE_SKILLS.filter((skill) => {
    const segments = new Set(skill.id.split("-"));
    return list.some((word) => segments.has(word));
  }).map((skill) => skill.id);

const offensive = classify(OFFENSIVE_SEGMENTS);
const defensive = classify(DEFENSIVE_SEGMENTS);
const overlap = offensive.filter((id) => defensive.includes(id));

check(
  "[AI0] 分類が実カタログに実際に当たる（攻≥8・守≥6・重複0）",
  offensive.length >= 8 && defensive.length >= 6 && overlap.length === 0,
  `攻 ${offensive.length} 本・守 ${defensive.length} 本・重複 ${overlap.length}` +
    `（旧・表示名ベースの版は 0/0 で L3=L2 だった）`,
);

/* 2 — behaviour actually differs by level ------------------------------ */

const COMBO = RESOLVED_COMBOS.find((combo) => combo.id === "chain-ignition")!;

function skill(id: string, cooldownSec = 1): ResolvedActiveSkill {
  return {
    id,
    name: id,
    cooldownSec,
    charges: -1,
    conditions: [],
    effects: [{ type: "attack-boost", durationSec: 0.1, multiplier: 1.01 }],
  };
}

async function main(): Promise<void> {
  /*
   * L3 finishes an open combo. Setup: window opened by firing the opener,
   * finisher parked in slot 3 where level-2 rotation would not necessarily
   * pick it next. Level 3 must pick it; the same state at level 2 measures
   * the difference exists at all.
   */
  const sim = await createVortexSim({
    seed: 0xa15e,
    builds: [
      createSimFixtureBuild(0, {
        activeGroups: {
          crest: [skill(COMBO.opener)],
          crown: [skill("neutral-a")],
          edge: [skill(COMBO.finisher)],
        },
      }),
      createSimFixtureBuild(1),
    ],
    teamIds: [0, 1],
    launchPower: [1, 1],
    cpuSeats: [0] as SeatIndex[],
    arenaId: "wide-dish",
    countdownSec: 0,
    suddenDeathSec: 300,
    maxDurationSec: 600,
  });
  try {
    for (let step = 0; step < 12; step += 1) sim.step();
    const opened = sim.activate(0 as SeatIndex, 1);
    if (!opened.ok) throw new Error(`opener refused: ${opened.reason}`);
    sim.step();

    /*
     * L2's rotation drifts with the tick, so at any single tick it may
     * coincide with L3's choice (the first draft asserted at one tick and
     * failed on exactly that coincidence). Instead: across the window, L3
     * must pick the finisher EVERY tick; L2 must diverge on at least one —
     * which is the actual claim "the levels are different players".
     */
    let l3Always = true;
    let l2Diverged = false;
    for (let step = 0; step < 24; step += 1) {
      const pickL3 = aiActivation(sim, 0 as SeatIndex, 3);
      const pickL2 = aiActivation(sim, 0 as SeatIndex, 2);
      if (pickL3 !== 3) l3Always = false;
      if (pickL2 !== 3) l2Diverged = true;
      sim.step();
    }
    check(
      "[AI1] L3 は窓が開いている間つねにfinisherを選ぶ",
      l3Always,
      l3Always ? "24tick全てで slot 3" : "窓内でfinisher以外を選んだ",
    );
    check(
      "[AI2] L2 は同じ窓内で別の選択をする（レベルが実在する）",
      l2Diverged,
      l2Diverged ? "L2の輪番はfinisher固定でない" : "L2まで常時finisher＝収斂している",
    );
  } finally {
    sim.dispose();
  }

  /*
   * L1 thins. Count non-null decisions over a fixed window of live play —
   * the alternating half-second gate must refuse roughly half of them.
   */
  const sim2 = await createVortexSim({
    seed: 0xa15f,
    builds: [
      createSimFixtureBuild(0, {
        activeGroups: { crest: [skill("spam-a", 0.2)] },
      }),
      createSimFixtureBuild(1),
    ],
    teamIds: [0, 1],
    launchPower: [1, 1],
    cpuSeats: [0] as SeatIndex[],
    arenaId: "wide-dish",
    countdownSec: 0,
    suddenDeathSec: 300,
    maxDurationSec: 600,
  });
  try {
    let decisionsL1 = 0;
    let decisionsL2 = 0;
    for (let step = 0; step < 240; step += 1) {
      sim2.step();
      if (aiActivation(sim2, 0 as SeatIndex, 1) !== null) decisionsL1 += 1;
      if (aiActivation(sim2, 0 as SeatIndex, 2) !== null) decisionsL2 += 1;
    }
    check(
      "[AI3] L1 は L2 より明確に手数が少ない",
      decisionsL1 < decisionsL2 * 0.7 && decisionsL2 > 0,
      `4秒間の発動判断 L1=${decisionsL1} / L2=${decisionsL2}`,
    );
  } finally {
    sim2.dispose();
  }

  if (failures.length > 0) {
    console.log(`AI SELFTEST FAIL — ${failures.join(" / ")}`);
    process.exitCode = 1;
  } else {
    console.log("AI SELFTEST PASS");
  }
}

void main();
