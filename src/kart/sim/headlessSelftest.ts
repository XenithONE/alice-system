/**
 * Gate: the race actually gets driven, and it gets driven the same way twice.
 *
 * "The sim ran for 90 seconds without throwing" is not evidence that anything
 * moved — [H8] proves it by running the identical race with the drivers
 * removed and requiring that nobody finishes. Everything above it is only
 * meaningful because that control fails.
 *
 * Run: npx tsx src/kart/sim/headlessSelftest.ts
 */
import { createGate } from "../gate";
import { DRIFT_HOP_SEC, SIM_STEP_SEC } from "./balance";
import { createKartSim } from "./sim";
import {
  angleDelta,
  forwardOf,
  headingOf,
  pointAt,
  querySurface,
  rightOf,
} from "./track";
import { TRACKS } from "./tracks";
import {
  NEUTRAL_INPUT,
  type KartInput,
  type RaceConfig,
  type RaceEvent,
  type RacerSpec,
  type RacerState,
} from "./types";

const gate = createGate();

function field(count: number, level: number, cpu = true): RacerSpec[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `CPU${index + 1}`,
    cpu,
    cpuLevel: level,
    livery: index,
  }));
}

interface RunSummary {
  ticks: number;
  seconds: number;
  finished: number;
  bestLap: number;
  worstLap: number;
  maxStep: number;
  nan: boolean;
  events: Map<string, number>;
  boostSources: Map<string, number>;
  places: Map<number, number>;
}

function run(config: RaceConfig, maxSeconds = 400): RunSummary {
  const sim = createKartSim(config);
  const previous = new Map<number, number>();
  const events = new Map<string, number>();
  const boostSources = new Map<string, number>();
  let maxStep = 0;
  let nan = false;
  let ticks = 0;
  const limit = Math.round(maxSeconds / SIM_STEP_SEC);
  while (ticks < limit) {
    sim.step();
    ticks += 1;
    for (const event of sim.drainEvents() as readonly RaceEvent[]) {
      events.set(event.k, (events.get(event.k) ?? 0) + 1);
      if (event.k === "boost") {
        boostSources.set(
          event.source,
          (boostSources.get(event.source) ?? 0) + 1,
        );
      }
    }
    const state = sim.getState();
    for (const racer of state.racers) {
      if (
        !Number.isFinite(racer.x) ||
        !Number.isFinite(racer.y) ||
        !Number.isFinite(racer.z) ||
        !Number.isFinite(racer.yaw) ||
        !Number.isFinite(racer.speed) ||
        !Number.isFinite(racer.distance)
      ) {
        nan = true;
      }
      const before = previous.get(racer.id);
      if (before !== undefined) {
        maxStep = Math.max(maxStep, Math.abs(racer.distance - before));
      }
      previous.set(racer.id, racer.distance);
    }
    if (state.phase === "finished") break;
  }
  const state = sim.getState();
  const result = sim.result();
  const laps = state.racers
    .map((racer) => racer.bestLap)
    .filter((lap): lap is number => lap !== null);
  const places = new Map<number, number>();
  for (const standing of result?.standings ?? []) {
    places.set(standing.id, standing.place);
  }
  return {
    ticks,
    seconds: state.elapsed,
    finished: state.racers.filter((racer) => racer.finished).length,
    bestLap: laps.length ? Math.min(...laps) : Number.NaN,
    worstLap: laps.length ? Math.max(...laps) : Number.NaN,
    maxStep,
    nan,
    events,
    boostSources,
    places,
  };
}

// [H1] a full grid completes every circuit ──────────────────────────────────
const summaries = TRACKS.map((spec) => {
  const summary = run({
    trackId: spec.id,
    laps: 3,
    seed: 20260801,
    racers: field(8, 2),
  });
  gate.check(
    `[H1:${spec.id}] CPU8台が3周を完走`,
    summary.finished === 8 && summary.seconds < 320,
    `完走 ${summary.finished}/8・${summary.seconds.toFixed(1)}s・最速ラップ ${summary.bestLap.toFixed(2)}s`,
  );
  gate.check(
    `[H2:${spec.id}] ラップタイムが実用域（20〜80秒）`,
    summary.bestLap > 20 && summary.worstLap < 80,
    `${summary.bestLap.toFixed(2)}s 〜 ${summary.worstLap.toFixed(2)}s`,
  );
  gate.check(
    `[H3:${spec.id}] 数値が壊れない・進行が瞬間移動しない`,
    !summary.nan && summary.maxStep <= 2.5001,
    `NaN=${summary.nan} 最大1tick進行 ${summary.maxStep.toFixed(3)}m（上限 2.5）`,
  );
  return { spec, summary };
});

// [H4] the drift chain and the pads are actually reachable ──────────────────
for (const { spec, summary } of summaries) {
  const mini = summary.boostSources.get("mini") ?? 0;
  const pad = summary.boostSources.get("pad") ?? 0;
  gate.check(
    `[H4:${spec.id}] ミニターボとブーストパッドが実際に発火`,
    mini > 10 && pad > 3,
    `mini=${mini} pad=${pad} mushroom=${summary.boostSources.get("mushroom") ?? 0} rocket=${summary.boostSources.get("rocket") ?? 0}`,
  );
}

// [H5] items connect, and turning them off silences them ────────────────────
{
  const withItems = summaries[0]!.summary;
  const without = run({
    trackId: TRACKS[0]!.id,
    laps: 2,
    seed: 20260801,
    racers: field(8, 2),
    items: false,
  });
  const hits = withItems.events.get("hit") ?? 0;
  const silent = without.events.get("hit") ?? 0;
  gate.check(
    "[H5] アイテムON で命中が起き、OFF で完全に消える",
    hits > 5 && silent === 0,
    `ON=${hits}件 / OFF=${silent}件（pickup ON=${withItems.events.get("pickup") ?? 0} OFF=${without.events.get("pickup") ?? 0}）`,
  );
}

// [H6] determinism — the whole point of host authority ──────────────────────
{
  const config: RaceConfig = {
    trackId: TRACKS[1]!.id,
    laps: 2,
    seed: 7717,
    racers: field(6, 3),
  };
  const a = createKartSim(config);
  const b = createKartSim(config);
  let divergedAt = -1;
  for (let i = 0; i < 3600; i += 1) {
    a.step();
    b.step();
    if (i % 30 !== 0) continue;
    if (JSON.stringify(a.getState()) !== JSON.stringify(b.getState())) {
      divergedAt = i;
      break;
    }
  }
  gate.check(
    "[H6] 同じ種で2つのシムが完全一致（60秒・30tickごとに全状態を比較）",
    divergedAt < 0,
    divergedAt < 0 ? "3600tick 一致" : `tick ${divergedAt} で分岐`,
  );
}

// [H6-neg] a one-bit seed change must diverge ───────────────────────────────
gate.expectFail(
  "[H6-neg] 種を1変えると一致しなくなる",
  () => {
    const base: RaceConfig = {
      trackId: TRACKS[1]!.id,
      laps: 2,
      seed: 7717,
      racers: field(6, 3),
    };
    const a = createKartSim(base);
    const b = createKartSim({ ...base, seed: 7718 });
    for (let i = 0; i < 900; i += 1) {
      a.step();
      b.step();
    }
    return JSON.stringify(a.getState()) === JSON.stringify(b.getState());
  },
  "seed 7717 vs 7718",
);

// [H7] the difficulty dial does something measurable ────────────────────────
{
  const seeds = [11, 29, 43, 61, 83, 97];
  let rivalPlaces = 0;
  let touristPlaces = 0;
  for (const seed of seeds) {
    const racers: RacerSpec[] = [];
    for (let i = 0; i < 3; i += 1) {
      racers.push({ name: `RIVAL${i}`, cpu: true, cpuLevel: 3, livery: i });
    }
    for (let i = 0; i < 3; i += 1) {
      racers.push({ name: `TOUR${i}`, cpu: true, cpuLevel: 1, livery: 3 + i });
    }
    const summary = run(
      { trackId: TRACKS[0]!.id, laps: 2, seed, racers, items: false },
      300,
    );
    for (const [id, place] of summary.places) {
      if (id < 3) rivalPlaces += place;
      else touristPlaces += place;
    }
  }
  const rivalAverage = rivalPlaces / (seeds.length * 3);
  const touristAverage = touristPlaces / (seeds.length * 3);
  gate.check(
    "[H7] Lv3 が Lv1 に明確に勝つ（6シード×3対3・アイテムOFF）",
    touristAverage - rivalAverage > 1.4,
    `Lv3 平均 ${rivalAverage.toFixed(2)}位 / Lv1 平均 ${touristAverage.toFixed(2)}位（差 ${(touristAverage - rivalAverage).toFixed(2)}）`,
  );
}

// [H9] the rocket start is reachable, and nobody burns the engine ──────────
{
  let rivalRockets = 0;
  let stalls = 0;
  const seeds = [3, 19, 37, 55, 71];
  for (const seed of seeds) {
    const sim = createKartSim({
      trackId: TRACKS[0]!.id,
      laps: 1,
      seed,
      racers: field(6, 3),
    });
    for (let i = 0; i < 260; i += 1) {
      sim.step();
      for (const event of sim.drainEvents()) {
        if (event.k === "boost" && event.source === "rocket") rivalRockets += 1;
      }
    }
    stalls += sim
      .getState()
      .racers.filter((racer) => racer.squashTimer > 0).length;
  }
  gate.check(
    "[H9] Lv3 はロケットスタートを決め、エンジンを焼かない",
    rivalRockets >= seeds.length * 4 && stalls === 0,
    `ロケット ${rivalRockets}/${seeds.length * 6}・スタート直後の失速 ${stalls}`,
  );
}

// [H10] the new mechanics actually fire in real racing ──────────────────────
{
  const sim = createKartSim({
    trackId: TRACKS[2]!.id, // sky-garden: three ramps
    laps: 2,
    seed: 515151,
    racers: field(8, 3),
  });
  let tricks = 0;
  let trickBoosts = 0;
  let draftBoosts = 0;
  for (let i = 0; i < 60 * 120 && !sim.result(); i += 1) {
    sim.step();
    for (const event of sim.drainEvents()) {
      if (event.k === "trick") tricks += 1;
      if (event.k === "boost" && event.source === "trick") trickBoosts += 1;
      if (event.k === "boost" && event.source === "draft") draftBoosts += 1;
    }
  }
  gate.check(
    "[H10] トリック（発動→着地ブースト）とスリップストリームが実戦で発火する",
    tricks > 3 && trickBoosts > 2 && draftBoosts > 1,
    `trick=${tricks} trick-boost=${trickBoosts} draft-boost=${draftBoosts}`,
  );
}

// [H11] speed classes are monotonic, and the dial is what the gate measures ─
{
  function bestLapFor(classTuning: { speedScale: number; turnScale: number; gripScale: number } | undefined, speedClass: number): number {
    const sim = createKartSim({
      trackId: TRACKS[0]!.id,
      laps: 2,
      seed: 909090,
      racers: field(4, 3),
      items: false,
      speedClass,
      classTuning,
    });
    for (let i = 0; i < 60 * 220 && !sim.result(); i += 1) sim.step();
    const laps = sim
      .getState()
      .racers.map((racer) => racer.bestLap)
      .filter((lap): lap is number => lap !== null);
    return laps.length ? Math.min(...laps) : Number.NaN;
  }
  const lap100 = bestLapFor(undefined, 0);
  const lap150 = bestLapFor(undefined, 1);
  const lap200 = bestLapFor(undefined, 2);
  gate.check(
    "[H11] クラスが速いほどラップが速い（150→200 ≥2.5%・100→150 ≥8%）",
    lap200 < lap150 * 0.975 && lap150 < lap100 * 0.92,
    `100cc=${lap100.toFixed(2)}s 150cc=${lap150.toFixed(2)}s 200cc=${lap200.toFixed(2)}s`,
  );
  gate.expectFail(
    "[H11-neg] クラス係数を全て1にすると差が消える（計測がダイヤルを見ている証明）",
    () => {
      const ones = { speedScale: 1, turnScale: 1, gripScale: 1 };
      const a = bestLapFor(ones, 0);
      const b = bestLapFor(ones, 2);
      return Math.abs(a - b) > a * 0.02;
    },
    "全1 tuning で 100cc vs 200cc",
  );
}

// [H12] 200cc: the full grid still finishes on every circuit ────────────────
for (const spec of TRACKS) {
  const sim = createKartSim({
    trackId: spec.id,
    laps: 2,
    seed: 616161,
    racers: field(8, 2),
    speedClass: 2,
  });
  for (let i = 0; i < 60 * 260 && !sim.result(); i += 1) sim.step();
  const finished = sim.getState().racers.filter((racer) => racer.finished).length;
  gate.check(
    `[H12:${spec.id}] 200cc で 8/8 完走（クラス補償が効いている）`,
    finished === 8,
    `完走 ${finished}/8`,
  );
}

// [H13] weather: same seed, rain slower than clear; both self-deterministic ─
{
  function raceTime(weather: "clear" | "rain"): number {
    const sim = createKartSim({
      trackId: TRACKS[0]!.id,
      laps: 2,
      seed: 727272,
      racers: field(4, 3),
      items: false,
      weather,
    });
    for (let i = 0; i < 60 * 260 && !sim.result(); i += 1) sim.step();
    return sim.result()?.durationSec ?? Number.NaN;
  }
  const clear = raceTime("clear");
  const rain = raceTime("rain");
  gate.check(
    "[H13] 雨は晴れより遅い（グリップ低下が実測に出る）",
    rain > clear * 1.01,
    `clear=${clear.toFixed(1)}s rain=${rain.toFixed(1)}s`,
  );

  const twinA = createKartSim({ trackId: TRACKS[0]!.id, laps: 1, seed: 828282, racers: field(4, 2), weather: "rain" });
  const twinB = createKartSim({ trackId: TRACKS[0]!.id, laps: 1, seed: 828282, racers: field(4, 2), weather: "rain" });
  let diverged = false;
  for (let i = 0; i < 1800; i += 1) {
    twinA.step();
    twinB.step();
    if (i % 60 === 0 && JSON.stringify(twinA.getState()) !== JSON.stringify(twinB.getState())) {
      diverged = true;
      break;
    }
  }
  gate.check(
    "[H13b] 雨でも twin-sim が完全一致（天候は決定論の内側）",
    !diverged,
    "1800 tick 一致",
  );
}

// [H8] the control: with nobody driving, nothing finishes ───────────────────
gate.expectFail(
  "[H8] 操作しない人間8台は完走しない（H1が『走行』を測っている証明）",
  () => {
    const summary = run(
      {
        trackId: TRACKS[0]!.id,
        laps: 3,
        seed: 20260801,
        racers: field(8, 2, false),
      },
      90,
    );
    return summary.finished > 0;
  },
  "入力ゼロで90秒",
);

// [H14] steering has a direction, and it is the one the camera calls right ──
/*
 * Nothing in this suite measured the SIGN of steering — [H1] only asks that
 * karts finish, and a kart that turns the wrong way finishes just as happily.
 *
 * This one is green from the day it was written, and that is the point: it
 * pins steering to the heading frame, so the frame can be corrected underneath
 * it without the sim quietly drifting out of step. Whether the frame itself is
 * right-handed is [T11c]'s job, and whether the camera agrees is [R6]'s.
 */
{
  function steerRun(steer: number): { before: number; after: number } {
    const sim = createKartSim({
      trackId: TRACKS[0]!.id,
      laps: 3,
      seed: 5,
      racers: [{ name: "P", cpu: false, livery: 0 }],
      items: false,
    });
    const drive = (throttle: number, value: number, seconds: number): void => {
      const ticks = Math.round(seconds / SIM_STEP_SEC);
      for (let i = 0; i < ticks; i += 1) {
        sim.setInput(0, {
          throttle,
          brake: 0,
          steer: value,
          drift: false,
          gimmick: false,
          skill: false,
          item0: false,
          item1: false,
          item2: false,
          lookBack: false,
        });
        sim.step();
      }
    };
    // Coast through the countdown: holding throttle for its whole length is a
    // burnout stall, and a stalled kart skips the steering block entirely.
    drive(0, 0, 4);
    drive(1, 0, 2);
    const before = sim.getState().racers[0]!.yaw;
    drive(1, steer, 0.4);
    return { before, after: sim.getState().racers[0]!.yaw };
  }
  const project = (
    run: { before: number; after: number },
    sign: number,
  ): number => {
    const [fx, fz] = forwardOf(run.after);
    const [rx, rz] = rightOf(run.before);
    return (fx * rx + fz * rz) * sign;
  };
  const right = steerRun(1);
  const left = steerRun(-1);
  gate.check(
    "[H14] steer=+1 は rightOf 側へ、steer=-1 は逆へ向く",
    project(right, 1) > 0.05 && project(left, 1) < -0.05,
    `右 ${project(right, 1).toFixed(3)} / 左 ${project(left, 1).toFixed(3)}`,
  );
  gate.expectFail(
    "[H14-neg] 期待する右を反転すると一致しない",
    () => project(right, -1) > 0.05 && project(left, -1) < -0.05,
    "rightOf を反転した基準",
  );
}

// [H15] the hop is unconditional, the drift is decided on touchdown ────────
/*
 * Three properties of the rebuilt drift, from one scripted lap each:
 *   (a) pressing with the wheel straight still hops — the old code demanded
 *       0.12 of lock at the instant of the press and did nothing without it,
 *   (b) the direction comes from the wheel AT TOUCHDOWN, not at the press,
 *   (c) winding out of a slide unwinds it, which is what "counter-steer"
 *       means and what a positive-only authority curve could not do.
 */
{
  interface Probe {
    hopped: boolean;
    airborneDuringHop: boolean;
    driftingDuringHop: boolean;
    dirAfterLatch: number;
    slipAfterLatch: number;
    yawWithSteer: number;
    yawAgainstSteer: number;
  }

  function driftProbe(latchSteer: number, release: boolean): Probe {
    const sim = createKartSim({
      trackId: TRACKS[0]!.id,
      laps: 3,
      seed: 11,
      racers: [{ name: "P", cpu: false, livery: 0 }],
      items: false,
    });
    const set = (partial: Partial<KartInput>): void => {
      sim.setInput(0, { ...NEUTRAL_INPUT, ...partial });
    };
    const run = (ticks: number): void => {
      for (let i = 0; i < ticks; i += 1) sim.step();
    };
    const me = (): RacerState => sim.getState().racers[0]!;
    const ground = (): number =>
      querySurface(sim.track, me().x, me().z, -1, 4).height;

    /*
     * Get to the drift centred and at speed. Holding a straight wheel out of
     * the grid runs the kart off a circuit that curves, and an off-road kart
     * scrubs below DRIFT_MIN_SPEED before the hop ends — which reads exactly
     * like "the latch is broken" while proving nothing about the latch.
     */
    const follow = (seconds: number, throttle: number): void => {
      const ticks = Math.round(seconds / SIM_STEP_SEC);
      for (let i = 0; i < ticks; i += 1) {
        const racer = me();
        const length = sim.track.length;
        const s = ((racer.distance % length) + length) % length;
        const [aimX, , aimZ] = pointAt(sim.track, s + 14, 0);
        const steer = Math.max(
          -1,
          Math.min(
            1,
            -angleDelta(racer.yaw, headingOf(aimX - racer.x, aimZ - racer.z)) *
              1.6,
          ),
        );
        set({ throttle, steer });
        sim.step();
      }
    };
    follow(4, 0); // coast out the countdown
    follow(2, 1); // build speed, on the racing surface

    // (a) press with zero steering.
    set({ throttle: 1, drift: true });
    let hopped = false;
    let airborneDuringHop = false;
    let driftingDuringHop = false;
    for (let i = 0; i < 10; i += 1) {
      sim.step();
      const racer = me();
      if (racer.y > ground() + 0.05) hopped = true;
      if (racer.airborne) airborneDuringHop = true;
      if (racer.driftDir !== 0) driftingDuringHop = true;
    }

    /*
     * (b) let go before touchdown, or steer into the landing. Read the
     * direction as soon as the hop is over — hold this hard for half a second
     * and the kart is off the circuit, the drift breaks on speed, and the
     * measurement reports "never latched" for reasons of its own making.
     */
    if (release) set({ throttle: 1 });
    else set({ throttle: 1, drift: true, steer: latchSteer });
    run(Math.round((DRIFT_HOP_SEC + 0.08) / SIM_STEP_SEC));
    const dirAfterLatch = me().driftDir;
    run(12); // let the body angle build before reading it
    const slipAfterLatch = me().slip;

    /*
     * (c) into the slide, then out of it. Both rates are sampled AFTER the
     * wheel has had time to travel: the steering lerps at 8/s, so averaging
     * across the transition buries the reversal under the half-second it took
     * to get there.
     */
    set({ throttle: 1, drift: true, steer: latchSteer });
    run(20);
    const yaw0 = me().yaw;
    run(10);
    const yawWithSteer = me().yaw - yaw0;
    set({ throttle: 1, drift: true, steer: -latchSteer });
    run(24);
    const yaw1 = me().yaw;
    run(10);
    const yawAgainstSteer = me().yaw - yaw1;

    return {
      hopped,
      airborneDuringHop,
      driftingDuringHop,
      dirAfterLatch,
      slipAfterLatch,
      yawWithSteer,
      yawAgainstSteer,
    };
  }

  const right = driftProbe(1, false);
  const left = driftProbe(-1, false);
  gate.check(
    "[H15a] 無舵でもホップは出る（airborne は立てない・まだドリフトでもない）",
    right.hopped && !right.airborneDuringHop && !right.driftingDuringHop,
    `hop=${right.hopped} airborne=${right.airborneDuringHop} drift=${right.driftingDuringHop}`,
  );
  gate.check(
    "[H15b] 着地時の舵でドリフト方向が決まる",
    right.dirAfterLatch === 1 && left.dirAfterLatch === -1,
    `右 ${right.dirAfterLatch} / 左 ${left.dirAfterLatch}`,
  );
  gate.check(
    "[H15c] 逆に倒すとドリフトが巻き戻る（カウンターが効く）",
    right.yawWithSteer * right.yawAgainstSteer < 0 &&
      left.yawWithSteer * left.yawAgainstSteer < 0,
    `右 ${right.yawWithSteer.toFixed(3)}→${right.yawAgainstSteer.toFixed(3)} / ` +
      `左 ${left.yawWithSteer.toFixed(3)}→${left.yawAgainstSteer.toFixed(3)}`,
  );
  /*
   * The body angle carries the whole drift read: the nose points INTO the
   * corner, and the camera's outward swing is written as `+rightOf * slip`,
   * so getting this sign wrong points the kart the wrong way AND swings the
   * camera to the inside, hiding the corner the player is trying to see.
   */
  gate.check(
    "[H15d] ドリフト中の車体角は旋回方向と逆符号（ノーズがコーナー内側）",
    Math.sign(right.slipAfterLatch) === -right.dirAfterLatch &&
      Math.sign(left.slipAfterLatch) === -left.dirAfterLatch,
    `右 dir=${right.dirAfterLatch} slip=${right.slipAfterLatch.toFixed(3)} / ` +
      `左 dir=${left.dirAfterLatch} slip=${left.slipAfterLatch.toFixed(3)}`,
  );
  gate.expectFail(
    "[H15-neg1] ドリフトを押さなければホップもドリフトも起きない",
    () => {
      const sim = createKartSim({
        trackId: TRACKS[0]!.id,
        laps: 3,
        seed: 11,
        racers: [{ name: "P", cpu: false, livery: 0 }],
        items: false,
      });
      let hopped = false;
      for (let i = 0; i < Math.round(7 / SIM_STEP_SEC); i += 1) {
        const racer = sim.getState().racers[0]!;
        const length = sim.track.length;
        const s = ((racer.distance % length) + length) % length;
        const [aimX, , aimZ] = pointAt(sim.track, s + 14, 0);
        const steer = Math.max(
          -1,
          Math.min(
            1,
            -angleDelta(racer.yaw, headingOf(aimX - racer.x, aimZ - racer.z)) *
              1.6,
          ),
        );
        sim.setInput(0, {
          ...NEUTRAL_INPUT,
          throttle: i > 240 ? 1 : 0,
          steer,
        });
        sim.step();
        const after = sim.getState().racers[0]!;
        const height = querySurface(sim.track, after.x, after.z, -1, 4).height;
        if (after.y > height + 0.05 && !after.airborne) hopped = true;
      }
      return hopped;
    },
    "ドリフト未押下",
  );
  gate.expectFail(
    "[H15-neg2] 着地前に離すとその後どれだけ舵を入れてもドリフトしない",
    () => driftProbe(1, true).dirAfterLatch !== 0,
    "ホップ中にボタンを離す",
  );
}

console.table(
  summaries.map(({ spec, summary }) => ({
    track: spec.id,
    seconds: Number(summary.seconds.toFixed(1)),
    bestLap: Number(summary.bestLap.toFixed(2)),
    worstLap: Number(summary.worstLap.toFixed(2)),
    hits: summary.events.get("hit") ?? 0,
    pickups: summary.events.get("pickup") ?? 0,
    mini: summary.boostSources.get("mini") ?? 0,
    pad: summary.boostSources.get("pad") ?? 0,
    respawns: summary.events.get("respawn") ?? 0,
    walls: summary.events.get("wall") ?? 0,
  })),
);

gate.finish("HEADLESS SELFTEST");
