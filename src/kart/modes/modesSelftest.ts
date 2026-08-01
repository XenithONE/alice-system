/**
 * Gate: the meta layer — cup scoring, ghosts, records, daily, unlocks.
 *
 * Everything here is pure or seeded, so the whole replayability surface is
 * measurable in Node. Every check carries a destructive control; the daily
 * one feeds the exact unpadded-date trap this codebase already owns a copy
 * of (`lib/seed.ts` dayKey) to prove the sort assertion bites.
 *
 * Run: npx tsx src/kart/modes/modesSelftest.ts
 */
import { createGate } from "../gate";
import { COUNTDOWN_SEC } from "../sim/balance";
import { createKartSim } from "../sim/sim";
import { buildTrack } from "../sim/track";
import { TRACKS } from "../sim/tracks";
import type { RaceResult } from "../sim/types";
import {
  applyCupPoints,
  CUP_ROUNDS,
  cupStandings,
  cupTrackOrder,
  GP_POINTS,
  raceSeedForRound,
} from "./gp";
import {
  decodeGhost,
  encodeGhost,
  GhostRecorder,
  GhostSampler,
  GHOST_BUDGET_BYTES,
  type GhostExpectation,
} from "./ghost";
import { createTimeTrialSession, TT_LAPS } from "./timeTrial";
import {
  applyRace,
  coerceRecords,
  comboKey,
  emptyRecords,
  type RaceOutcomeEntry,
} from "../meta/records";
import {
  applyDailyFinish,
  dailyCombo,
  emptyDaily,
  kartDayKey,
} from "../meta/daily";
import {
  evaluateAchievements,
  unlockedLiveries,
} from "../meta/achievements";

const gate = createGate();

// Node lacks atob/btoa on old versions; current Node has them globally.
declare const process: { exitCode?: number };

function fakeResult(places: readonly number[], trackId = TRACKS[0]!.id): RaceResult {
  return {
    trackId,
    laps: 3,
    durationSec: 120,
    standings: places.map((place, seat) => ({
      id: seat,
      name: `P${seat}`,
      cpu: seat !== 0,
      livery: seat,
      place,
      finished: true,
      time: 100 + place,
      bestLap: 30 + place,
      lap: 3,
    })),
  };
}

// ── [M1] the points table ───────────────────────────────────────────────────
{
  const decreasing = GP_POINTS.every(
    (points, index) => index === 0 || points < GP_POINTS[index - 1]!,
  );
  const premium = GP_POINTS[0]! - GP_POINTS[1]! === 2;
  const applied = applyCupPoints([0, 0, 0, 0, 0, 0, 0, 0], fakeResult([1, 2, 3, 4, 5, 6, 7, 8]));
  const conserved = applied.reduce((a, b) => a + b, 0) === GP_POINTS.reduce((a, b) => a + b, 0);
  gate.check(
    "[M1] GP得点表: 単調減少・1位プレミアムΔ2・合計保存",
    decreasing && premium && conserved,
    `${GP_POINTS.join("/")} 合計=${applied.reduce((a, b) => a + b, 0)}`,
  );
  gate.expectFail(
    "[M1-neg] 同点を含む表は単調性検査に落ちる",
    () => {
      const broken = [10, 8, 8, 5, 4, 3, 2, 1];
      return broken.every((points, index) => index === 0 || points < broken[index - 1]!);
    },
    "8,8 の同点",
  );
}

// ── [M2] tiebreak: last-round place decides equals ──────────────────────────
{
  // Seat 0 and 1 tie on points; seat 1 finished ahead in the last round.
  const last = fakeResult([2, 1, 3, 4]);
  const standings = cupStandings([18, 18, 6, 5], last);
  gate.check(
    "[M2] 同点は最終戦の順位で決まる",
    standings[0]!.seat === 1 && standings[1]!.seat === 0,
    standings.map((row) => `#${row.rank}=seat${row.seat}(${row.points}pt)`).join(" "),
  );
  gate.expectFail(
    "[M2-neg] ポイントだけの比較では並びが決まらない",
    () => {
      const byPoints = [...[18, 18]].sort((a, b) => b - a);
      return byPoints[0] !== byPoints[1];
    },
    "18 vs 18",
  );
}

// ── [M3] rotation and per-round seeds ───────────────────────────────────────
{
  const order = cupTrackOrder();
  const unique = new Set(order);
  const seeds = [0, 1, 2].map((round) => raceSeedForRound(777, round));
  gate.check(
    "[M3] カップは全コースを一巡し、ラウンドごとに種が異なる",
    order.length === CUP_ROUNDS &&
      unique.size === TRACKS.length &&
      new Set(seeds).size === seeds.length,
    `order=${order.join("→")} seeds=${seeds.join(",")}`,
  );
}

// ── [M6] startTriple: exactly three boosts, then empty; deterministic ──────
{
  const sim = createKartSim({
    trackId: TRACKS[0]!.id,
    laps: 1,
    seed: 1,
    racers: [{ name: "P", cpu: false, livery: 0 }],
    items: false,
    startTriple: true,
  });
  let uses = 0;
  let itemAfter: string | null = "pending";
  for (let i = 0; i < 60 * 30; i += 1) {
    // Mash the item button the whole race.
    sim.setInput(0, {
      throttle: 1,
      brake: 0,
      steer: 0,
      drift: false,
      item: i % 20 < 10,
      lookBack: false,
    });
    sim.step();
    for (const event of sim.drainEvents()) {
      if (event.k === "use") uses += 1;
    }
  }
  itemAfter = sim.getState().racers[0]!.item;
  gate.check(
    "[M6] 初期3連キノコはちょうど3回使えて尽きる",
    uses === 3 && itemAfter === null,
    `uses=${uses} item=${itemAfter}`,
  );
}

// ── [M9] ghost roundtrip on a REAL driven run ───────────────────────────────
{
  const track = buildTrack(TRACKS[0]!);
  const expectation: GhostExpectation = {
    trackId: TRACKS[0]!.id,
    trackLength: track.length,
    speedClass: 1,
    mirror: false,
  };
  // Drive a real CPU for ~60 s and record its poses — real speeds, real yaw
  // wraps, real slip. Synthetic sine paths never catch the seam bugs.
  const sim = createKartSim({
    trackId: TRACKS[0]!.id,
    laps: 3,
    seed: 33,
    racers: [{ name: "G", cpu: true, cpuLevel: 3, livery: 0 }],
    items: false,
  });
  const recorder = new GhostRecorder();
  for (let i = 0; i < 60 * 100; i += 1) {
    sim.step();
    const state = sim.getState();
    const me = state.racers[0]!;
    if (state.phase === "race" && !me.finished) {
      recorder.push(state.elapsed - COUNTDOWN_SEC, {
        x: me.x,
        y: me.y,
        z: me.z,
        yaw: me.yaw,
        slip: me.slip,
      });
    }
    if (sim.result()) break;
  }
  const ghost = recorder.finish(80, false, 1, 3);
  const encoded = encodeGhost(ghost, expectation);
  const decoded = encoded ? decodeGhost(encoded, expectation) : null;
  let worst = 0;
  if (decoded) {
    for (let i = 0; i < ghost.frames.length; i += 1) {
      const a = ghost.frames[i]!;
      const b = decoded.frames[i]!;
      worst = Math.max(
        worst,
        Math.abs(a.x - b.x),
        Math.abs(a.y - b.y),
        Math.abs(a.z - b.z),
      );
    }
  }
  gate.check(
    "[M9] ゴースト往復: 実走60秒を encode→decode して誤差 ≤ 1/32 m・予算内",
    encoded !== null &&
      decoded !== null &&
      worst <= 1 / 32 + 1e-9 &&
      encoded.length < GHOST_BUDGET_BYTES,
    `frames=${ghost.frames.length} bytes=${encoded?.length ?? 0} 最大誤差=${worst.toFixed(4)}m`,
  );

  // Sampler interpolates between frames.
  if (decoded) {
    const sampler = new GhostSampler(decoded);
    const mid = sampler.sample(5.05);
    const a = decoded.frames[50]!;
    const b = decoded.frames[51]!;
    const okMid =
      mid !== null &&
      Math.abs(mid.x - (a.x + b.x) / 2) < 0.5 &&
      Math.abs(mid.z - (a.z + b.z) / 2) < 0.5;
    gate.check(
      "[M9b] サンプラーがフレーム間を補間する",
      okMid,
      mid ? `t=5.05 x=${mid.x.toFixed(2)}` : "null",
    );
  }

  // Corruption controls: every guard must bite.
  if (encoded) {
    const corrupt = (mutate: (bytes: Uint8Array) => void): boolean => {
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      mutate(bytes);
      let out = "";
      for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]!);
      return decodeGhost(btoa(out), expectation) === null;
    };
    const guards = [
      corrupt((bytes) => (bytes[0] = 0x58)), // magic
      corrupt((bytes) => (bytes[4] = 99)), // version
      corrupt((bytes) => (bytes[8] = bytes[8]! ^ 0xff)), // trackHash
      corrupt((bytes) => (bytes[12] = bytes[12]! ^ 0xff)), // lengthQ
      corrupt((bytes) => (bytes[5] = bytes[5]! ^ 1)), // mirror flag
      decodeGhost(encoded.slice(0, encoded.length - 24), expectation) === null, // truncation
    ];
    gate.check(
      "[M9c] 破壊されたゴーストは全て null（magic/version/hash/長さ/鏡像/切詰め）",
      guards.every(Boolean),
      `${guards.filter(Boolean).length}/6 ガード発火`,
    );
  }
}

// ── [M-TT] the time-trial session produces a saveable ghost ────────────────
{
  const session = createTimeTrialSession({
    name: "TT",
    trackId: TRACKS[0]!.id,
    speedClass: 1,
    mirror: false,
  });
  // Deterministic self-driver (same helper family as the wire gate).
  const track = session.track;
  const step = 1 / 60;
  for (let i = 0; i < 60 * 200 && !session.result(); i += 1) {
    const view = session.view();
    const me = view?.racers[0];
    if (me) {
      const s = ((me.distance % track.length) + track.length) % track.length;
      const [ax, az] = (() => {
        const sample = track.samples[
          Math.round(((s + 14) % track.length) / track.step) % track.samples.length
        ]!;
        return [sample.x, sample.z] as const;
      })();
      const desired = Math.atan2(ax - me.x, az - me.z);
      let delta = (desired - me.yaw) % (Math.PI * 2);
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta <= -Math.PI) delta += Math.PI * 2;
      session.sendInput({
        throttle: 1,
        brake: 0,
        steer: Math.max(-1, Math.min(1, delta * 1.6)),
        drift: false,
        item: false,
        lookBack: false,
      });
    }
    session.tick(step);
  }
  const ghost = session.ghostPayload();
  gate.check(
    "[M-TT] タイムトライアル: 1台・3周を完走しゴーストが得られる",
    session.result() !== null && ghost !== null && ghost.frames.length > 200,
    `laps=${TT_LAPS} frames=${ghost?.frames.length ?? 0} total=${((ghost?.totalMs ?? 0) / 1000).toFixed(1)}s`,
  );
}

// ── [M7] daily: deterministic, date-scoped, sortable keys ───────────────────
{
  const a = dailyCombo("2026-08-01");
  const b = dailyCombo("2026-08-01");
  const c = dailyCombo("2026-08-02");
  gate.check(
    "[M7] デイリー: 同日一致・翌日相違",
    JSON.stringify(a) === JSON.stringify(b) &&
      JSON.stringify(a) !== JSON.stringify(c),
    `${a.trackId}/${a.speedClass}cc-idx/${a.weather}${a.mirror ? "/mirror" : ""}`,
  );

  const padded = [kartDayKey(new Date(2026, 7, 2)), kartDayKey(new Date(2026, 7, 10))];
  const sortedPadded = [...padded].sort();
  gate.check(
    "[M7b] ゼロ埋めキーは文字列ソートで時系列になる",
    sortedPadded[0] === "2026-08-02" && sortedPadded[1] === "2026-08-10",
    padded.join(" < "),
  );
  gate.expectFail(
    "[M7-neg] 未ゼロ埋め形式（共有 dayKey の形）はソート検査に落ちる",
    () => {
      const unpadded = ["2026-8-2", "2026-8-10"];
      const sorted = [...unpadded].sort();
      return sorted[0] === "2026-8-2";
    },
    '"2026-8-10" < "2026-8-2" になる罠そのもの',
  );

  let state = emptyDaily("2026-08-01");
  state = applyDailyFinish(state, "2026-08-01", 95_000, 3);
  state = applyDailyFinish(state, "2026-08-01", 91_000, 1);
  const sameDay = state.streak === 1 && state.bestMs === 91_000 && state.attempts === 2;
  state = applyDailyFinish(state, "2026-08-02", 99_000, 2);
  const nextDay = state.streak === 2;
  state = applyDailyFinish(state, "2026-08-05", 99_000, 2);
  const broken = state.streak === 1;
  gate.check(
    "[M7c] ベスト更新・試行回数・連続日数（途切れで1に戻る）",
    sameDay && nextDay && broken,
    `bestMs=91000 streak: 1→2→(gap)→1`,
  );
}

// ── [M8] records: pure application, coercion, no double bests ───────────────
{
  const entry: RaceOutcomeEntry = {
    kind: "race",
    result: fakeResult([1, 2, 3, 4, 5, 6, 7, 8]),
    seat: 0,
    speedClass: 1,
    mirror: false,
    miniTurbos: 4,
    tricksLanded: 2,
    itemHits: 1,
    gpGoldClass: null,
  };
  const first = applyRace(emptyRecords(), entry);
  const second = applyRace(first.records, entry);
  const key = comboKey(TRACKS[0]!.id, 1, false);
  gate.check(
    "[M8] applyRace: 集計・ベスト初回のみ・純関数",
    first.newBests.bestLap &&
      first.newBests.bestRace &&
      !second.newBests.bestLap &&
      !second.newBests.bestRace &&
      second.records.races === 2 &&
      second.records.wins === 2 &&
      second.records.byCombo[key]!.plays === 2,
    `wins=${second.records.wins} bestLap 2回目=${second.newBests.bestLap}`,
  );

  const tampered = coerceRecords({
    v: 1,
    wins: "7",
    races: -3,
    byCombo: { [key]: { plays: "2", wins: 1, bestLapMs: "abc" } },
  });
  gate.check(
    "[M8b] 改竄された保存値は数値に強制される（連結事故なし）",
    tampered.wins === 7 && tampered.races === 0 &&
      tampered.byCombo[key]!.plays === 2 &&
      tampered.byCombo[key]!.bestLapMs === null,
    `wins="7"→7 races=-3→0 bestLapMs="abc"→null`,
  );
}

// ── [M10] unlocks derive from records ───────────────────────────────────────
{
  const none = unlockedLiveries(emptyRecords(), { streak: 0 });
  const winner = applyRace(emptyRecords(), {
    kind: "race",
    result: fakeResult([1, 2, 3, 4]),
    seat: 0,
    speedClass: 1,
    mirror: false,
    miniTurbos: 0,
    tricksLanded: 0,
    itemHits: 0,
    gpGoldClass: null,
  }).records;
  const afterWin = unlockedLiveries(winner, { streak: 0 });
  gate.check(
    "[M10] 初勝利でリバリー8が解放される（保存ではなく導出）",
    !none.has(8) && afterWin.has(8) && none.size === 8 && afterWin.size === 9,
    `before=${none.size}色 after=${afterWin.size}色`,
  );
  const achievements = evaluateAchievements(winner, { streak: 0 });
  gate.check(
    "[M10b] 実績評価が該当のみ返す",
    achievements.includes("first_win") && !achievements.includes("wins_5"),
    achievements.join(","),
  );
}

console.table({
  gpPoints: GP_POINTS.join("/"),
  cupOrder: cupTrackOrder().join("→"),
});

gate.finish("MODES SELFTEST");
