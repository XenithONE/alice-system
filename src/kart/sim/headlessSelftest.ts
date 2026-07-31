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
import { SIM_STEP_SEC } from "./balance";
import { createKartSim } from "./sim";
import { TRACKS } from "./tracks";
import type { RaceConfig, RaceEvent, RacerSpec } from "./types";

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
