/**
 * Gate: `phase` passes through TOPS, and through nothing else.
 *
 * Six skills promise すり抜け / 位相移動 in their Japanese text. None of them
 * did it. The active path was rewritten into `{ type: "shield",
 * damageMultiplier: 0.12 }` at the catalog boundary, and the passive path kept
 * the name but landed in a separate 0.12 bucket — so the two paths disagreed,
 * and stacking a real shield on the passive version multiplied the two
 * separately-clamped reductions together.
 *
 * Nothing caught it because nothing measured contact. A damage gate cannot:
 * taking 12% damage and taking no damage because you were never touched look
 * identical in a damage total. The measurable that was wrong is [P1] below.
 *
 * ## The check that actually matters is [P3]
 *
 * Passing through other tops is the feature. Passing through the FLOOR or the
 * RIM would be a disaster: a phasing top would leave the world, and the
 * ring-out rules would be measuring an escape rather than a knockout. So the
 * gate spends more effort proving the arena is untouched than proving the
 * feature works.
 *
 * Run: npx tsx src/vortex/sim/phaseSelftest.ts
 */
import { createVortexSim } from "./index";
import { sampleRingHeight } from "./rings";
import { createSimFixtureBuild } from "./selftestFixture";
import type {
  ResolvedActiveSkill,
  ResolvedPassiveSkill,
  SeatIndex,
  SimRingArena,
  VortexSim,
} from "./types";

declare const process: { exitCode?: number };

const failures: string[] = [];
const check = (name: string, ok: boolean, detail: string): void => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
  if (!ok) failures.push(name);
};

/** Drives seat 0 straight into seat 1 hard enough to guarantee a meeting. */
const CHARGE: ResolvedActiveSkill = {
  id: "gate-charge",
  name: "Gate Charge",
  cooldownSec: 60,
  charges: -1,
  conditions: [],
  effects: [{ type: "dash", impulse: 26 }],
};

/** Long enough that the whole observation window is inside the phase. */
const GHOST: ResolvedActiveSkill = {
  id: "gate-ghost",
  name: "Gate Ghost",
  cooldownSec: 60,
  charges: -1,
  conditions: [],
  effects: [{ type: "phase", durationSec: 6 }],
};

/*
 * Throws seat 0 outward, away from its enemy. The impulse is 20 by
 * measurement, not by taste: at 24 and above the two tops end up meeting
 * (minGap 1.27 < the 1.44 contact distance), which would let pass-through
 * contaminate a test that is supposed to isolate the arena; at 28 and above
 * the top clears the lip entirely and dies, so "the rim stopped it" would be
 * asserted about a run where the rim stopped nothing. At 20 it climbs to
 * r=7.24 and is pushed back down to 5.22, with the two tops never closer than
 * 8.58m.
 */
const HURL: ResolvedActiveSkill = {
  id: "gate-hurl",
  name: "Gate Hurl",
  cooldownSec: 60,
  charges: -1,
  conditions: [],
  effects: [{ type: "recoil", impulse: 20 }],
};

/** Short enough to expire well inside the observation window. */
const BLINK: ResolvedActiveSkill = {
  id: "gate-blink",
  name: "Gate Blink",
  cooldownSec: 60,
  charges: -1,
  conditions: [],
  effects: [{ type: "phase", durationSec: 0.5 }],
};

interface Cue {
  readonly atStep: number;
  readonly slot: number;
}

interface Trace {
  /** Contacts between the two tops, which is what pass-through must remove. */
  readonly impacts: number;
  /** Closest the two centres ever came. Proves they actually met. */
  readonly minGap: number;
  /** Smallest (top y − arena surface y). Negative means through the floor. */
  readonly minClearance: number;
  /** Furthest SEAT 0 got from the centre. Proves the rim was reached. */
  readonly maxRadius: number;
  /** Where seat 0 ended up radially. */
  readonly finalRadius: number;
  /*
   * Activations the sim turned down. Recorded rather than thrown: an early
   * version threw here, and when a sabotage made a phasing top fall out of the
   * world the match ended, the next activation was refused, and the harness
   * died with a stack trace — taking four unrun checks and the summary line
   * with it. A gate that stops reporting halfway is indistinguishable from a
   * gate that passed, to anyone reading the tail of the log.
   */
  readonly refusals: readonly string[];
}

/**
 * Runs one scenario and reports every quantity the gate needs. Deliberately
 * one function: the phasing and non-phasing runs must be measured by identical
 * code, or a difference in the harness could pass for a difference in physics.
 */
async function trace(
  seed: number,
  script: readonly Cue[],
  steps: number,
  seatZeroPassives: readonly ResolvedPassiveSkill[] = [],
): Promise<Trace> {
  const sim: VortexSim = await createVortexSim({
    seed,
    builds: [
      createSimFixtureBuild(0, {
        activeGroups: {
          crest: [CHARGE],
          crown: [GHOST],
          edge: [BLINK],
          weight: [HURL],
        },
        passives: seatZeroPassives,
      }),
      createSimFixtureBuild(1),
    ],
    teamIds: [0, 1],
    launchPower: [1, 1],
    cpuSeats: [],
    arenaId: "wide-dish",
    countdownSec: 0,
    suddenDeathSec: 600,
    maxDurationSec: 600,
  });
  const arena: SimRingArena = sim.arena;
  let impacts = 0;
  let minGap = Number.POSITIVE_INFINITY;
  let minClearance = Number.POSITIVE_INFINITY;
  let maxRadius = 0;
  const refusals: string[] = [];
  try {
    // Settle first so the launch transient is not mistaken for the effect.
    for (let step = 0; step < 30; step += 1) {
      sim.step();
      sim.drainEvents();
    }
    let finalRadius = 0;
    for (let step = 0; step < steps; step += 1) {
      // Fired before the step so a cue at step 0 is live on the first frame.
      for (const cue of script) {
        if (cue.atStep !== step) continue;
        const fired = sim.activate(0 as SeatIndex, cue.slot as 1);
        if (!fired.ok) {
          refusals.push(`step ${step} slot ${cue.slot}: ${fired.reason}`);
        }
      }
      sim.step();
      for (const event of sim.drainEvents()) {
        if (event.type === "impact") impacts += 1;
      }
      const state = sim.getState();
      const positions = state.tops.map((top) => top.position);
      const [first, second] = positions;
      if (first && second) {
        minGap = Math.min(
          minGap,
          Math.hypot(first[0] - second[0], first[2] - second[2]),
        );
      }
      for (const position of positions) {
        const radius = Math.hypot(position[0], position[2]);
        minClearance = Math.min(
          minClearance,
          position[1] - sampleRingHeight(arena, radius, Math.atan2(position[2], position[0])),
        );
      }
      if (first) {
        finalRadius = Math.hypot(first[0], first[2]);
        maxRadius = Math.max(maxRadius, finalRadius);
      }
    }
    return { impacts, minGap, minClearance, maxRadius, finalRadius, refusals };
  } finally {
    sim.dispose();
  }
}

const round = (value: number): number => Number(value.toFixed(4));

/** wide-dish. Named here so the assertions read as claims, not as numbers. */
const ARENA_OUT_RADIUS = 8.78;

function report(label: string, runs: Record<string, Trace>): void {
  console.table(
    Object.entries(runs).map(([name, run]) => ({
      run: `${label} / ${name}`,
      impacts: run.impacts,
      minGap: round(run.minGap),
      minClearance: round(run.minClearance),
      maxRadius: round(run.maxRadius),
      finalRadius: round(run.finalRadius),
      refused: run.refusals.length,
    }))
  );
}

async function main(): Promise<void> {
  // Slot order follows TOP_SLOTS: crest 1, crown 2, edge 3, weight 4.
  const solid = await trace(0x9c31a1, [{ atStep: 0, slot: 1 }], 200);
  const phasing = await trace(
    0x9c31a1,
    [{ atStep: 0, slot: 2 }, { atStep: 0, slot: 1 }],
    200,
  );

  report("突撃", { solid, phasing });

  check(
    "[P0] 対照実験が実際に接触している",
    solid.impacts > 0 && solid.minGap < 1.5,
    `すり抜けなしで接触 ${solid.impacts} 回・最接近 ${round(solid.minGap)}m`
  );

  check(
    "[P1] すり抜け中は敵と接触イベントが出ない",
    phasing.impacts === 0,
    `すり抜け中の接触 ${phasing.impacts} 回（0 を期待／対照は ${solid.impacts} 回）`
  );

  /*
   * Compared against the control rather than against a distance derived from
   * the part radii. A first attempt asserted "closer than 1.44m (0.72 edge
   * radius twice)" and passed while phasing was disabled: two SOLID tops
   * already reach 1.02m, because every collider is built smaller than its
   * nominal radius (round-shape borders, and the blade proxies sit at 0.76×).
   * The ratio needs no such assumption and cannot be wrong about geometry.
   */
  check(
    "[P2] すり抜けは「当たらなかった」ではなく「重なった」",
    phasing.minGap < solid.minGap * 0.6,
    `最接近 ${round(phasing.minGap)}m vs 対照 ${round(solid.minGap)}m ` +
      `＝対照の ${round(phasing.minGap / solid.minGap)} 倍（0.6倍未満を要求）`
  );

  check(
    "[P3] すり抜け中も床を抜けない",
    phasing.minClearance > 0,
    `床からの最小クリアランス ${round(phasing.minClearance)}m（対照 ${round(solid.minClearance)}m）`
  );

  /*
   * A permanent phase would be a far worse bug than the one being fixed, and
   * nothing else in this file would notice it: every check above is satisfied
   * by a top that is intangible forever.
   */
  const expiring = await trace(
    0x9c31a1,
    [{ atStep: 0, slot: 3 }, { atStep: 60, slot: 1 }],
    200,
  );
  check(
    "[P4] すり抜けは期限で戻る（永久すり抜けでない）",
    expiring.impacts > 0,
    `0.5秒のすり抜け後に突撃 → 接触 ${expiring.impacts} 回（1回以上を期待）`
  );

  /*
   * Everything below isolates the arena. Seat 0 is thrown outward while its
   * enemy stays far away, so the ONLY body it can still interact with is the
   * dish — which means any difference between the two runs is an arena leak,
   * and no difference proves the mask never reached the arena.
   */
  const rimSolid = await trace(0x9c31a2, [{ atStep: 0, slot: 4 }], 260);
  const rimPhasing = await trace(
    0x9c31a2,
    [{ atStep: 0, slot: 2 }, { atStep: 0, slot: 4 }],
    260,
  );

  report("リム", { solid: rimSolid, phasing: rimPhasing });

  check(
    "[P5] 対照がリムに登り、押し戻されている",
    rimSolid.maxRadius > 7 &&
      rimSolid.maxRadius < ARENA_OUT_RADIUS &&
      rimSolid.finalRadius < rimSolid.maxRadius - 1.5,
    `最大半径 ${round(rimSolid.maxRadius)}m → 最終 ${round(rimSolid.finalRadius)}m ` +
      `（リム ${ARENA_OUT_RADIUS}m の内側で反転している）`
  );

  check(
    "[P6] リム試行では両者が一度も接触圏に入らない",
    rimPhasing.minGap > 2 && rimPhasing.impacts === 0,
    `最接近 ${round(rimPhasing.minGap)}m・接触 ${rimPhasing.impacts} 回` +
      `＝以下の差はアリーナ由来しかありえない`
  );

  check(
    "[P7] すり抜け中もリムに止められる",
    rimPhasing.maxRadius < ARENA_OUT_RADIUS && rimPhasing.minClearance > 0,
    `最大半径 ${round(rimPhasing.maxRadius)}m（リム ${ARENA_OUT_RADIUS}m）` +
      `／床クリアランス ${round(rimPhasing.minClearance)}m`
  );

  check(
    "[P8] アリーナとの相互作用がすり抜けで一切変化しない",
    Math.abs(rimPhasing.finalRadius - rimSolid.finalRadius) < 1e-9 &&
      Math.abs(rimPhasing.minClearance - rimSolid.minClearance) < 1e-9,
    `最終半径の差 ${rimPhasing.finalRadius - rimSolid.finalRadius}m・` +
      `床クリアランスの差 ${rimPhasing.minClearance - rimSolid.minClearance}m`
  );

  /*
   * The passive path, measured by contact like everything else. It shares
   * applyPhase with the active path, but "shares the helper" is a reading of
   * the source, not a measurement — passiveSelftest's old phase check was
   * exactly this kind of assumption and guarded the wrong meaning for a
   * whole version.
   */
  const passivePhasing = await trace(
    0x9c31a1,
    [{ atStep: 0, slot: 1 }],
    200,
    [
      {
        id: "gate-veil",
        name: "Gate Veil",
        rank: 1,
        trigger: "battle-start",
        threshold: null,
        effects: [{ type: "phase", durationSec: 6 }],
      },
    ],
  );
  check(
    "[P10] パッシブ経路のすり抜けも接触ゼロ",
    passivePhasing.impacts === 0 && passivePhasing.minGap < solid.minGap * 0.6,
    `battle-start パッシブ phase で接触 ${passivePhasing.impacts} 回・` +
      `最接近 ${round(passivePhasing.minGap)}m（対照 ${round(solid.minGap)}m）`
  );

  const allRuns: Record<string, Trace> = {
    solid, phasing, expiring, rimSolid, rimPhasing, passivePhasing,
  };
  const refused = Object.entries(allRuns).flatMap(([name, run]) =>
    run.refusals.map((reason) => `${name}: ${reason}`)
  );
  check(
    "[P9] 全試行が指示どおりに発動できている",
    refused.length === 0,
    refused.length === 0
      ? "発動拒否なし＝上の数値は意図した実験のもの"
      : refused.join(" / ")
  );

  if (failures.length > 0) {
    console.log(`PHASE SELFTEST FAIL — ${failures.join(" / ")}`);
    process.exitCode = 1;
  } else {
    console.log("PHASE SELFTEST PASS");
  }
}

void main();
