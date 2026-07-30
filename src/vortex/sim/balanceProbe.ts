/**
 * ARCHITECTURE §9-5 acceptance measurement: is a combo a healthy bonus or a
 * degenerate one?
 *
 * Four legs, identical seeds, seat-swapped so spawn asymmetry cancels:
 *   A     opener + neutral filler        (the pair's first half alone)
 *   B     finisher + neutral filler      (the second half alone)
 *   AB-   both skills, combosEnabled:false  (the pair without the bonus)
 *   AB+   both skills, combos live          (the shipped game)
 *
 * §9-5 bands, measured on AB+ vs AB-:
 *   win-rate lift        +3..10pt
 *   median KO-time drop  ≤15%
 *   finisher success     15..50%   (combo events / opener fires)
 *   combos per 120s      0.5..3
 *
 * This is an on-demand measurement (npm run vortex:balance), not part of
 * vortex:sim-gates — 80 full matches cost minutes, and a gate nobody runs
 * because it is slow protects nothing. It exits 1 outside the bands so a run
 * can be cited as pass/fail.
 *
 * Skills carry their REAL catalog effects (resolved through the same
 * effectsFromCatalog bridge as production) — measuring fixture-flavoured
 * stand-ins is exactly the mistake §12 documents.
 */
import { getActiveSkill } from "../content";
import { RESOLVED_COMBOS } from "./comboAdapter";
import { effectsFromCatalog } from "./catalogAdapter";
import { aiActivation, createVortexSim } from "./index";
import { createSimFixtureBuild } from "./selftestFixture";
import type { ResolvedActiveSkill, SeatIndex } from "./types";

declare const process: { exitCode?: number };

const COMBO = RESOLVED_COMBOS.find((combo) => combo.id === "chain-ignition")!;
/** Filler and opponent skills chosen from OUTSIDE every combo pair. */
const NEUTRAL_IDS = ["overdrive", "aegis-field"] as const;

function realSkill(id: string): ResolvedActiveSkill {
  const def = getActiveSkill(id);
  if (!def) throw new Error(`no such skill: ${id}`);
  return {
    id: def.id,
    name: def.name,
    cooldownSec: def.cooldownSec,
    charges: def.charges ?? -1,
    // Conditions dropped on purpose: the probe measures the combo economy,
    // and a target-near gate would couple the result to spawn geometry.
    conditions: [],
    effects: def.effects.flatMap((effect) => effectsFromCatalog(effect, 1)),
  };
}

interface LegResult {
  readonly wins: number;
  readonly matches: number;
  readonly koTimes: number[];
  readonly openerFires: number;
  readonly comboEvents: number;
}

async function runLeg(
  skillsForSubject: readonly ResolvedActiveSkill[],
  combosEnabled: boolean,
  seeds: readonly number[],
): Promise<LegResult> {
  let wins = 0;
  let matches = 0;
  let openerFires = 0;
  let comboEvents = 0;
  const koTimes: number[] = [];
  for (const seed of seeds) {
    for (const subjectSeat of [0, 1] as const) {
      matches += 1;
      const neutral = NEUTRAL_IDS.map(realSkill);
      const subjectBuild = createSimFixtureBuild(subjectSeat, {
        activeGroups: {
          crest: [skillsForSubject[0]!],
          crown: skillsForSubject[1] ? [skillsForSubject[1]] : undefined,
        },
      });
      const opponentBuild = createSimFixtureBuild(1 - subjectSeat, {
        activeGroups: { crest: [neutral[0]!], crown: [neutral[1]!] },
      });
      const builds =
        subjectSeat === 0
          ? [subjectBuild, opponentBuild]
          : [opponentBuild, subjectBuild];
      const sim = await createVortexSim({
        seed,
        builds,
        teamIds: [0, 1],
        launchPower: [1, 1],
        cpuSeats: [0, 1] as SeatIndex[],
        arenaId: "wide-dish",
        countdownSec: 0,
        suddenDeathSec: 120,
        maxDurationSec: 240,
        combosEnabled,
      });
      try {
        let guard = 0;
        while (!sim.result() && guard < 240 * 60) {
          for (const seat of [0, 1] as const) {
            // Subject plays the shipped combo-capable level 3; the opponent
            // stays level 2 so the measured lift is the pair + the policy,
            // exactly what a player choosing CPU強度3 gets.
            const slot = aiActivation(sim, seat, seat === subjectSeat ? 3 : 2);
            if (slot !== null) sim.activate(seat, slot);
          }
          sim.step();
          for (const event of sim.drainEvents()) {
            if (
              event.type === "skill" &&
              event.seat === subjectSeat &&
              event.skillId === COMBO.opener
            ) {
              openerFires += 1;
            }
            if (event.type === "combo" && event.seat === subjectSeat) {
              comboEvents += 1;
            }
          }
          guard += 1;
        }
        const result = sim.result();
        if (result?.winner === subjectSeat) wins += 1;
        if (result && result.winner !== null) koTimes.push(result.durationSec);
      } finally {
        sim.dispose();
      }
    }
  }
  return { wins, matches, koTimes, openerFires, comboEvents };
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

async function main(): Promise<void> {
  const seeds = Array.from({ length: 10 }, (_, index) => 0xba1a + index * 7919);
  const opener = realSkill(COMBO.opener);
  const finisher = realSkill(COMBO.finisher);
  const filler = realSkill(NEUTRAL_IDS[0]);

  const [legA, legB, legOff, legOn] = [
    await runLeg([opener, filler], true, seeds),
    await runLeg([finisher, filler], true, seeds),
    await runLeg([opener, finisher], false, seeds),
    await runLeg([opener, finisher], true, seeds),
  ];

  const rate = (leg: LegResult): number => (leg.wins / leg.matches) * 100;
  const table = [
    { leg: "A  opener+filler", win: rate(legA).toFixed(0) + "%", medianKO: median(legA.koTimes).toFixed(0) + "s" },
    { leg: "B  finisher+filler", win: rate(legB).toFixed(0) + "%", medianKO: median(legB.koTimes).toFixed(0) + "s" },
    { leg: "AB combos OFF", win: rate(legOff).toFixed(0) + "%", medianKO: median(legOff.koTimes).toFixed(0) + "s" },
    { leg: "AB combos ON", win: rate(legOn).toFixed(0) + "%", medianKO: median(legOn.koTimes).toFixed(0) + "s" },
  ];
  console.table(table);

  const lift = rate(legOn) - rate(legOff);
  const koDrop =
    median(legOff.koTimes) > 0
      ? (1 - median(legOn.koTimes) / median(legOff.koTimes)) * 100
      : 0;
  const finisherSuccess =
    legOn.openerFires > 0 ? (legOn.comboEvents / legOn.openerFires) * 100 : 0;
  const totalLiveSec = legOn.koTimes.reduce((sum, t) => sum + t, 0);
  const per120 = totalLiveSec > 0 ? (legOn.comboEvents / totalLiveSec) * 120 : 0;

  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail: string): void => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
    if (!ok) failures.push(name);
  };

  check(
    "[B1] コンボの勝率寄与が +3〜10pt（ボーナスであって主役でない）",
    lift >= 3 && lift <= 10,
    `AB+ ${rate(legOn).toFixed(0)}% vs AB- ${rate(legOff).toFixed(0)}% = +${lift.toFixed(1)}pt`,
  );
  check(
    "[B2] KO時間の短縮が15%以内",
    koDrop <= 15,
    `中央値 ${median(legOff.koTimes).toFixed(0)}s -> ${median(legOn.koTimes).toFixed(0)}s（-${koDrop.toFixed(0)}%）`,
  );
  check(
    "[B3] finisher成功率 15〜50%",
    finisherSuccess >= 15 && finisherSuccess <= 50,
    `opener ${legOn.openerFires} 回中 combo ${legOn.comboEvents} 回 = ${finisherSuccess.toFixed(0)}%`,
  );
  check(
    "[B4] 成立頻度 0.5〜3回/120秒",
    per120 >= 0.5 && per120 <= 3,
    `${per120.toFixed(2)} 回/120s（実戦 ${totalLiveSec.toFixed(0)}s で ${legOn.comboEvents} 回）`,
  );

  if (failures.length > 0) {
    console.log(`BALANCE PROBE FAIL — ${failures.join(" / ")}`);
    process.exitCode = 1;
  } else {
    console.log("BALANCE PROBE PASS");
  }
}

void main();
