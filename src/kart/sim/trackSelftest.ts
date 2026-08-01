/**
 * Gate: the circuits are drivable, and the projection that measures progress
 * cannot be fooled by the layout.
 *
 * The failure this exists for is specific. `querySurface` finds the nearest
 * centreline sample; if two parts of a circuit ever run close together, a kart
 * on one of them snaps to the other, its arc length jumps, and lap counting
 * quietly breaks — with nothing visibly wrong on screen. [T6] measures the
 * separation directly, and proves itself on a circuit built to fail it.
 *
 * Run: npx tsx src/kart/sim/trackSelftest.ts
 */
import { createGate } from "../gate";
import { KART_RADIUS, SHOULDER_WIDTH } from "./balance";
import {
  arcDelta,
  buildTrack,
  gridSlot,
  mirrorSpec,
  pointAt,
  querySurface,
  type Track,
  type TrackSpec,
} from "./track";
import { TRACKS } from "./tracks";

const gate = createGate();
/*
 * Every structural check runs over the mirrored circuits too — mirror mode
 * ships as a real racing surface, not a novelty, so it earns the same gates.
 */
const SPECS: readonly TrackSpec[] = [
  ...TRACKS,
  ...TRACKS.map((spec) => ({ ...mirrorSpec(spec), id: `${spec.id}@m` })),
];
const built = SPECS.map((spec) => buildTrack(spec));

// [T1] shape ─────────────────────────────────────────────────────────────────
for (const track of built) {
  gate.check(
    `[T1:${track.spec.id}] 周回長とサンプル数が実用域`,
    track.length > 400 &&
      track.length < 4000 &&
      track.samples.length > 150 &&
      track.checkpoints.length > 0,
    `length=${track.length.toFixed(1)}m samples=${track.samples.length}`,
  );
}

// [T2] uniform arc-length spacing (the sim indexes distance by it) ───────────
for (const track of built) {
  let worst = 0;
  for (let i = 0; i < track.samples.length; i += 1) {
    const a = track.samples[i]!;
    const b = track.samples[(i + 1) % track.samples.length]!;
    const gap = Math.hypot(b.x - a.x, b.z - a.z);
    worst = Math.max(worst, Math.abs(gap - track.step) / track.step);
  }
  gate.check(
    `[T2:${track.spec.id}] サンプル間隔が均一（弧長=距離の前提）`,
    worst < 0.06,
    `最大ずれ ${(worst * 100).toFixed(2)}%（許容 6%）`,
  );
}

// [T3] projection round-trip ─────────────────────────────────────────────────
function roundTripError(track: Track, window: number): number {
  let worst = 0;
  for (let i = 0; i < track.samples.length; i += 7) {
    const sample = track.samples[i]!;
    for (const fraction of [-0.8, -0.3, 0, 0.45, 0.9]) {
      const lateral = sample.half * fraction;
      const [x, , z] = pointAt(track, sample.s, lateral);
      const hint = (i + window) % track.samples.length;
      const query = querySurface(track, x, z, hint, SHOULDER_WIDTH);
      worst = Math.max(
        worst,
        Math.abs(query.lateral - lateral),
        Math.abs(arcDelta(track, query.s, sample.s)),
      );
    }
  }
  return worst;
}

for (const track of built) {
  const error = roundTripError(track, 0);
  gate.check(
    `[T3:${track.spec.id}] 逆投影が一致（横位置・弧長）`,
    error < 0.4,
    `最大誤差 ${error.toFixed(3)}m`,
  );
}

// [T4] the hint window is wide enough that a stale hint still lands ──────────
for (const track of built) {
  const error = roundTripError(track, 12);
  gate.check(
    `[T4:${track.spec.id}] 12サンプル古いヒントでも同じ答え`,
    error < 0.4,
    `最大誤差 ${error.toFixed(3)}m`,
  );
}

// [T5] every placed object sits on the road ─────────────────────────────────
for (const track of built) {
  const strayBox = track.itemBoxes.find((box) => {
    const query = querySurface(track, box.x, box.z, -1, SHOULDER_WIDTH);
    return !query.onRoad;
  });
  const strayPad = track.boostPads.find((pad) => {
    const query = querySurface(track, pad.x, pad.z, -1, SHOULDER_WIDTH);
    return !query.onRoad;
  });
  gate.check(
    `[T5:${track.spec.id}] アイテムボックス・ブーストパッドが路面上`,
    !strayBox && !strayPad,
    strayBox
      ? `box ${strayBox.index} が路外`
      : strayPad
        ? `pad s=${strayPad.s.toFixed(1)} が路外`
        : `boxes=${track.itemBoxes.length} pads=${track.boostPads.length}`,
  );
}

// [T6] the road is never wider than its own corners ─────────────────────────
/**
 * The projection picks the nearest centreline sample. On a corner of radius R,
 * a kart at lateral offset L on the inside is (R − L) from the centre of
 * curvature — so as soon as L approaches R the nearest sample stops being the
 * one the kart is actually on, and arc length (which is the only progress
 * authority) jumps. The structural guarantee is therefore a ratio, not a
 * distance: every corner must be comfortably wider than the road it carries.
 */
function turnRatio(track: Track): { ratio: number; index: number; radius: number } {
  let worst = Infinity;
  let index = 0;
  let radius = Infinity;
  for (let i = 0; i < track.samples.length; i += 1) {
    const sample = track.samples[i]!;
    const r =
      Math.abs(sample.curvature) < 1e-6 ? Infinity : 1 / Math.abs(sample.curvature);
    const ratio = r / sample.half;
    if (ratio < worst) {
      worst = ratio;
      index = i;
      radius = r;
    }
  }
  return { ratio: worst, index, radius };
}

for (const track of built) {
  const { ratio, index, radius } = turnRatio(track);
  gate.check(
    `[T6:${track.spec.id}] 最小曲率半径が路肩幅を上回る（投影が別区間へ飛ばない条件）`,
    ratio > 2.5,
    `最小 R/half = ${ratio.toFixed(2)}（R=${radius.toFixed(1)}m, sample ${index}）`,
  );
}

// [T8] distant stretches never overlap (protects the un-hinted projection) ──
function selfProximity(track: Track): { gap: number; a: number; b: number } {
  const samples = track.samples;
  let worst = Infinity;
  let worstA = 0;
  let worstB = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const a = samples[i]!;
    for (let j = i + 1; j < samples.length; j += 1) {
      const b = samples[j]!;
      const along = Math.abs(arcDelta(track, a.s, b.s));
      if (along < 120) continue;
      const centre = Math.hypot(b.x - a.x, b.z - a.z);
      const required = a.half + b.half + SHOULDER_WIDTH * 2;
      const slack = centre - required;
      if (slack < worst) {
        worst = slack;
        worstA = i;
        worstB = j;
      }
    }
  }
  return { gap: worst, a: worstA, b: worstB };
}

for (const track of built) {
  const { gap, a, b } = selfProximity(track);
  gate.check(
    `[T8:${track.spec.id}] 離れた区間どうしが重ならない`,
    gap > 2,
    `最小余裕 ${gap.toFixed(2)}m（サンプル ${a}↔${b}）`,
  );
}

// [T8-neg] a circuit deliberately folded onto itself must be rejected ────────
const FOLDED: TrackSpec = {
  ...TRACKS[0]!,
  id: "folded-control",
  points: [
    { x: 0, y: 0, z: 0, width: 30 },
    { x: 0, y: 0, z: 120, width: 30 },
    { x: 6, y: 0, z: 200, width: 30 },
    { x: 14, y: 0, z: 120, width: 30 },
    { x: 14, y: 0, z: 20, width: 30 },
    { x: 60, y: 0, z: -20, width: 30 },
    { x: 100, y: 0, z: 40, width: 30 },
    { x: 60, y: 0, z: 90, width: 30 },
  ],
  itemBoxes: [],
  boostPads: [],
};
gate.expectFail(
  "[T8-neg] 折り返しコースは T8 に落ちる",
  () => selfProximity(buildTrack(FOLDED)).gap > 2,
  "14m 間隔で並走する制御点",
);

// [T6-neg] a wide road on a tight corner must be rejected ───────────────────
const HAIRPIN: TrackSpec = {
  ...TRACKS[0]!,
  id: "hairpin-control",
  points: [
    { x: 0, y: 0, z: 0, width: 30 },
    { x: 0, y: 0, z: 120, width: 30 },
    { x: 30, y: 0, z: 150, width: 30 },
    { x: 60, y: 0, z: 120, width: 30 },
    { x: 60, y: 0, z: 0, width: 30 },
    { x: 30, y: 0, z: -30, width: 30 },
  ],
  itemBoxes: [],
  boostPads: [],
};
gate.expectFail(
  "[T6-neg] 半径30mのヘアピンに幅30mの路面を敷くと T6 に落ちる",
  () => turnRatio(buildTrack(HAIRPIN)).ratio > 2.5,
  "R≈30m / half=15m",
);

// [T3-neg] a projection window of one sample must break the round trip ──────
gate.expectFail(
  "[T3-neg] ヒント窓を潰すと逆投影が壊れる",
  () => {
    const track = built[0]!;
    let worst = 0;
    for (let i = 0; i < track.samples.length; i += 7) {
      const sample = track.samples[i]!;
      const [x, , z] = pointAt(track, sample.s, sample.half * 0.9);
      // A hint half a lap away with the real window would still be wrong only
      // if the window is finite — which is exactly what we are asserting.
      const hint = (i + Math.floor(track.samples.length / 2)) % track.samples.length;
      const query = querySurface(track, x, z, hint, SHOULDER_WIDTH);
      worst = Math.max(worst, Math.abs(arcDelta(track, query.s, sample.s)));
    }
    return worst < 0.4;
  },
  "半周ずれたヒント",
);

// [T7] starting grid ────────────────────────────────────────────────────────
for (const track of built) {
  const slots = Array.from({ length: 8 }, (_, index) => gridSlot(track, index));
  let minimumGap = Infinity;
  for (let i = 0; i < slots.length; i += 1) {
    for (let j = i + 1; j < slots.length; j += 1) {
      minimumGap = Math.min(
        minimumGap,
        Math.hypot(slots[i]!.x - slots[j]!.x, slots[i]!.z - slots[j]!.z),
      );
    }
  }
  const offRoad = slots.filter(
    (slot) => !querySurface(track, slot.x, slot.z, -1, SHOULDER_WIDTH).onRoad,
  );
  gate.check(
    `[T7:${track.spec.id}] グリッド8台が路面上で重ならない`,
    offRoad.length === 0 && minimumGap > KART_RADIUS * 2,
    `最小間隔 ${minimumGap.toFixed(2)}m / 路外 ${offRoad.length}台`,
  );
}

/* ── [T9] mirroring is an involution ───────────────────────────────────────── */
{
  const spec = TRACKS[0]!;
  const twice = mirrorSpec(mirrorSpec(spec));
  gate.check(
    "[T9] 鏡像の鏡像は元のコースに戻る（対合）",
    JSON.stringify(twice) === JSON.stringify({ ...spec, ramps: spec.ramps ?? [] }) ||
      JSON.stringify({ ...twice, ramps: twice.ramps ?? [] }) ===
        JSON.stringify({ ...spec, ramps: spec.ramps ?? [] }),
    "mirror∘mirror = id",
  );
}

/* ── [T10] mirrored furniture sits at the x-negated world position ─────────── */
{
  const original = buildTrack(TRACKS[0]!);
  const mirrored = buildTrack(mirrorSpec(TRACKS[0]!));
  let worst = 0;
  for (let i = 0; i < original.itemBoxes.length; i += 1) {
    const a = original.itemBoxes[i]!;
    const b = mirrored.itemBoxes[i]!;
    worst = Math.max(worst, Math.hypot(-a.x - b.x, a.z - b.z));
  }
  for (let i = 0; i < original.boostPads.length; i += 1) {
    const a = original.boostPads[i]!;
    const b = mirrored.boostPads[i]!;
    worst = Math.max(worst, Math.hypot(-a.x - b.x, a.z - b.z));
  }
  for (let i = 0; i < original.ramps.length; i += 1) {
    const a = original.ramps[i]!;
    const b = mirrored.ramps[i]!;
    worst = Math.max(worst, Math.hypot(-a.x - b.x, a.z - b.z));
  }
  gate.check(
    "[T10] 鏡像コースの設置物が世界座標で正確に x 反転している",
    worst < 0.05,
    `最大ずれ ${worst.toFixed(4)}m（boxes/pads/ramps）`,
  );

  gate.expectFail(
    "[T10-neg] 横オフセットを反転し忘れた鏡像は T10 に落ちる",
    () => {
      const broken: TrackSpec = {
        ...TRACKS[0]!,
        points: TRACKS[0]!.points.map((point) => ({ ...point, x: -point.x })),
        // offsets NOT negated — the exact bug this gate exists for.
      };
      const badMirror = buildTrack(broken);
      let error = 0;
      for (let i = 0; i < original.itemBoxes.length; i += 1) {
        const a = original.itemBoxes[i]!;
        const b = badMirror.itemBoxes[i]!;
        error = Math.max(error, Math.hypot(-a.x - b.x, a.z - b.z));
      }
      return error < 0.05;
    },
    "points だけ反転した偽鏡像",
  );
}

console.table(
  built.map((track) => ({
    id: track.spec.id,
    length: Number(track.length.toFixed(1)),
    samples: track.samples.length,
    boxes: track.itemBoxes.length,
    pads: track.boostPads.length,
    maxHalf: Number(track.maxHalf.toFixed(1)),
  })),
);

gate.finish("TRACK SELFTEST");
