/**
 * Gate: an effect lands on whoever it says it lands on.
 *
 * `cooldown-shift` had one implementation and two meanings. Both handlers
 * walked `top.skills` — the caster's own slots — while `pulse-jammer`'s text
 * promises to delay 周囲の相手. So the skill spent a 30s cooldown and two
 * charges to add +4s to all seven of the caster's own slots, scaled by rank,
 * including itself. Its sibling `radial-damage` did hit enemies, which is why
 * the skill looked half-alive rather than broken.
 *
 * Nothing caught it because nothing measured who an effect reached. A win-rate
 * gate would not: the skill still did damage, and a self-inflicted cooldown on
 * one skill is invisible in aggregate. The measurable that was wrong is the
 * one below.
 *
 * Run: npx tsx src/vortex/sim/targetingSelftest.ts
 */
import { createVortexSim } from "./index";
import { createSimFixtureBuild } from "./selftestFixture";
import type { ResolvedActiveSkill, SeatIndex } from "./types";

declare const process: { exitCode?: number };

const failures: string[] = [];
const check = (name: string, ok: boolean, detail: string): void => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
  if (!ok) failures.push(name);
};

/** Stands in for pulse-jammer: the enemy-targeting shape, nothing else. */
const JAMMER: ResolvedActiveSkill = {
  id: "gate-jammer",
  name: "Gate Jammer",
  cooldownSec: 30,
  charges: 2,
  conditions: [],
  effects: [
    { type: "cooldown-shift", seconds: 4, target: "enemies", radius: 40 },
  ],
};

/** A slot that exists only to have its cooldown observed. */
const WITNESS: ResolvedActiveSkill = {
  id: "gate-witness",
  name: "Gate Witness",
  cooldownSec: 12,
  charges: -1,
  conditions: [],
  effects: [{ type: "spin-boost", radiansPerSec: 1 }],
};

/** Every slot's remaining cooldown, so a shift anywhere is visible. */
function cooldowns(
  state: { tops: readonly { seat: number; skills: readonly { cooldownRemaining: number }[] }[] },
  seat: number,
): number[] {
  return (
    state.tops
      .find((top) => top.seat === seat)
      ?.skills.map((skill) => Number(skill.cooldownRemaining.toFixed(3))) ?? []
  );
}

async function main(): Promise<void> {
  const sim = await createVortexSim({
    seed: 0x7a46e7,
    builds: [
      createSimFixtureBuild(0, { activeGroups: { crest: [JAMMER], crown: [WITNESS] } }),
      createSimFixtureBuild(1, { activeGroups: { crown: [WITNESS] } }),
    ],
    teamIds: [0, 1],
    launchPower: [1, 1],
    cpuSeats: [],
    arenaId: "wide-dish",
    countdownSec: 0,
    suddenDeathSec: 30,
    maxDurationSec: 60,
  });

  try {
    // Settle so both tops are live and the witness slots are off cooldown.
    for (let step = 0; step < 30; step += 1) sim.step();

    const casterBefore = cooldowns(sim.getState(), 0);
    const victimBefore = cooldowns(sim.getState(), 1);

    const fired = sim.activate(0 as SeatIndex, 1);
    check("[T0] 発動そのものが成立する", fired.ok, fired.ok ? "ok" : String(fired.reason));

    sim.step();
    const casterAfter = cooldowns(sim.getState(), 0);
    const victimAfter = cooldowns(sim.getState(), 1);

    /*
     * Slot 1 is the jammer itself and legitimately goes on cooldown when fired.
     * Slot 2 is the witness: it was not fired, so nothing may touch it. Under
     * the old implementation it gained +4s.
     */
    const witnessCaster = { before: casterBefore[1] ?? 0, after: casterAfter[1] ?? 0 };
    check(
      "[T1] 敵狙いの cooldown-shift が自分の他スロットを遅らせない",
      witnessCaster.after <= witnessCaster.before + 0.05,
      `発動者の未使用スロット ${witnessCaster.before} -> ${witnessCaster.after} 秒`
    );

    const witnessVictim = { before: victimBefore[1] ?? 0, after: victimAfter[1] ?? 0 };
    check(
      "[T2] 射程内の敵のクールダウンが実際に伸びる",
      witnessVictim.after >= witnessVictim.before + 3.5,
      `敵の未使用スロット ${witnessVictim.before} -> ${witnessVictim.after} 秒（+4 を期待）`
    );

    console.table([
      { who: "caster slot2 (witness)", before: witnessCaster.before, after: witnessCaster.after },
      { who: "enemy  slot2 (witness)", before: witnessVictim.before, after: witnessVictim.after },
    ]);
  } finally {
    sim.dispose();
  }

  // Out of reach must mean out of reach, or "radius" is decoration.
  const far = await createVortexSim({
    seed: 0x7a46e8,
    builds: [
      createSimFixtureBuild(0, {
        activeGroups: {
          crest: [{ ...JAMMER, effects: [{ type: "cooldown-shift", seconds: 4, target: "enemies", radius: 0.01 }] }],
          crown: [WITNESS],
        },
      }),
      createSimFixtureBuild(1, { activeGroups: { crown: [WITNESS] } }),
    ],
    teamIds: [0, 1],
    launchPower: [1, 1],
    cpuSeats: [],
    arenaId: "wide-dish",
    countdownSec: 0,
    suddenDeathSec: 30,
    maxDurationSec: 60,
  });
  try {
    for (let step = 0; step < 30; step += 1) far.step();
    const before = cooldowns(far.getState(), 1)[1] ?? 0;
    far.activate(0 as SeatIndex, 1);
    far.step();
    const after = cooldowns(far.getState(), 1)[1] ?? 0;
    check(
      "[T3] 射程外の敵には届かない",
      after <= before + 0.05,
      `半径0.01での敵スロット ${before} -> ${after} 秒`
    );
  } finally {
    far.dispose();
  }

  if (failures.length > 0) {
    console.log(`TARGETING SELFTEST FAIL — ${failures.join(" / ")}`);
    process.exitCode = 1;
  } else {
    console.log("TARGETING SELFTEST PASS");
  }
}

void main();
