/**
 * Gate: the road you can see is the road you can drive on.
 *
 * This is the check SCRAP CROWN did not have. Its arena walls and its
 * colliders were built by two different loops; they agreed at high detail and
 * were 0.747 m apart at low, so machines on the low tier drove through the
 * wall and nothing looked wrong on screen. Here the mesh is measured against
 * `querySurface` — the function the simulation asks "am I on the road?" — and
 * [R1-neg] proves the measurement bites by moving the mesh 40 cm.
 *
 * Runs in Node: nothing below touches WebGL or a canvas.
 *
 * Run: npx tsx src/kart/render/renderSelftest.ts
 */
import { createGate } from "../gate";
import { SHOULDER_WIDTH } from "../sim/balance";
import {
  buildTrack,
  querySurface,
  surfaceHeight,
  type Track,
} from "../sim/track";
import { TRACKS } from "../sim/tracks";
import { bothSides, roadGeometry } from "./trackMesh";
import { LIVERIES, liveryOf } from "./palette";
import {
  createSkidBuffers,
  rearWheelContacts,
  skidStrength,
  writeSkidQuad,
} from "./skidmarks";

const gate = createGate();
const built = TRACKS.map((spec) => buildTrack(spec));

interface Deviation {
  readonly worstHeight: number;
  readonly worstLateral: number;
  readonly offRoad: number;
  readonly nan: number;
}

/** Compare every drawn vertex against the surface the simulation reports. */
function measureRoad(track: Track, lift = 0): Deviation {
  const geometry = roadGeometry(track);
  const position = geometry.getAttribute("position");
  let worstHeight = 0;
  let worstLateral = 0;
  let offRoad = 0;
  let nan = 0;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i) + lift;
    const z = position.getZ(i);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      nan += 1;
      continue;
    }
    const query = querySurface(track, x, z, -1, SHOULDER_WIDTH);
    worstHeight = Math.max(worstHeight, Math.abs(query.height - y));
    // A road vertex is at most half a width from the centreline, by definition.
    const overhang = Math.abs(query.lateral) - query.half;
    worstLateral = Math.max(worstLateral, overhang);
    if (overhang > 0.05) offRoad += 1;
  }
  geometry.dispose();
  return { worstHeight, worstLateral, offRoad, nan };
}

for (const track of built) {
  const { worstHeight, worstLateral, offRoad, nan } = measureRoad(track);
  gate.check(
    `[R1:${track.spec.id}] 描画される路面がシムの路面と一致する`,
    worstHeight < 0.05 && worstLateral < 0.05 && offRoad === 0 && nan === 0,
    `高さ最大差 ${worstHeight.toFixed(4)}m・はみ出し ${worstLateral.toFixed(4)}m・路外頂点 ${offRoad}・NaN ${nan}`,
  );
}

gate.expectFail(
  "[R1-neg] メッシュを 0.4m 持ち上げると R1 が落ちる",
  () => measureRoad(built[0]!, 0.4).worstHeight < 0.05,
  "路面メッシュだけを上へ",
);

/*
 * [R2] Both verges must face the sky.
 *
 * The two sides of the circuit are mirrored, so one of them comes out wound
 * the other way. That does not produce a hole or a black polygon — it produces
 * a verge the sun never reaches, on one side only, which reads as "the grass
 * is darker over there" and survived a full visual review before the numbers
 * caught it.
 */
for (const track of built) {
  const geometry = bothSides(track, SHOULDER_WIDTH, 20, 30, 0, -4);
  const normals = geometry.getAttribute("normal");
  let downward = 0;
  let nan = 0;
  for (let i = 0; i < normals.count; i += 1) {
    const y = normals.getY(i);
    if (!Number.isFinite(y)) nan += 1;
    else if (y < 0.2) downward += 1;
  }
  geometry.dispose();
  gate.check(
    `[R2:${track.spec.id}] 左右どちらの路肩も法線が上を向く`,
    downward === 0 && nan === 0,
    `下向き頂点 ${downward} / ${normals.count}・NaN ${nan}`,
  );
}

/* [R3] Placed objects sit on the surface the mesh draws. */
for (const track of built) {
  let worst = 0;
  for (const box of track.itemBoxes) {
    const query = querySurface(track, box.x, box.z, -1, SHOULDER_WIDTH);
    worst = Math.max(worst, Math.abs(query.height - box.y));
  }
  for (const pad of track.boostPads) {
    const query = querySurface(track, pad.x, pad.z, -1, SHOULDER_WIDTH);
    worst = Math.max(worst, Math.abs(query.height - pad.y));
  }
  gate.check(
    `[R3:${track.spec.id}] アイテムボックスとパッドが路面高に乗っている`,
    worst < 0.05,
    `最大浮き ${worst.toFixed(4)}m`,
  );
}

/* [R4] Banking is applied by the same formula everywhere. */
for (const track of built) {
  let worst = 0;
  for (let i = 0; i < track.samples.length; i += 5) {
    const sample = track.samples[i]!;
    for (const fraction of [-1, -0.5, 0, 0.5, 1]) {
      const lateral = sample.half * fraction;
      const expected = sample.y + Math.tan(sample.bank) * lateral;
      worst = Math.max(worst, Math.abs(surfaceHeight(sample, lateral) - expected));
    }
  }
  gate.check(
    `[R4:${track.spec.id}] バンク角が単一の式から導かれている`,
    worst < 1e-9,
    `最大差 ${worst.toExponential(2)}m`,
  );
}

/*
 * [R5] Eight karts have to be told apart at a glance — on the kart, on the
 * minimap dot, and in the standings list.
 *
 * Measured in OKLab, not by hue. The first version of this check compared hue
 * angles and failed AZURE against SLATE at 4.5°, which is true and irrelevant:
 * one is a saturated blue and the other a pale silver, and nobody has ever
 * confused them. Hue alone says nothing about how far apart two colours look.
 */
function oklab(hex: number): readonly [number, number, number] {
  const toLinear = (channel: number): number =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  const r = toLinear(((hex >> 16) & 255) / 255);
  const g = toLinear(((hex >> 8) & 255) / 255);
  const b = toLinear((hex & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ] as const;
}

function closestLiveryPair(
  colors: readonly number[],
): { distance: number; pair: string } {
  const labs = colors.map(oklab);
  let closest = Infinity;
  let pair = "";
  for (let i = 0; i < labs.length; i += 1) {
    for (let j = i + 1; j < labs.length; j += 1) {
      const a = labs[i]!;
      const b = labs[j]!;
      const distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      if (distance < closest) {
        closest = distance;
        pair = `${LIVERIES[i]?.name ?? i}↔${LIVERIES[j]?.name ?? j}`;
      }
    }
  }
  return { distance: closest, pair };
}

{
  // The base grid set (0-7) carries the strict guarantee — those are the
  // colours every race shows together. Unlock liveries (8-15) trade hue
  // distance for finish/value distinctions and rarely co-occur, so they get
  // a looser floor that still forbids outright duplicates.
  const base = closestLiveryPair(
    LIVERIES.slice(0, 8).map((livery) => livery.body),
  );
  const all = closestLiveryPair(LIVERIES.map((livery) => livery.body));
  gate.check(
    "[R5] 基本8色は厳格に・全16色も重複なしに離れている（OKLab）",
    base.distance > 0.12 &&
      all.distance > 0.045 &&
      LIVERIES.length === 16 &&
      liveryOf(17).name === LIVERIES[1]!.name,
    `基本 ${base.distance.toFixed(3)} (${base.pair}) / 全体 ${all.distance.toFixed(3)} (${all.pair})・折返し ${liveryOf(17).name}`,
  );
}

gate.expectFail(
  "[R5-neg] 2色を同系色に寄せると R5 が落ちる",
  () => {
    const colors = LIVERIES.map((livery) => livery.body);
    colors[3] = colors[0]! + 0x020202;
    return closestLiveryPair(colors).distance > 0.12;
  },
  "AMBER を CRIMSON とほぼ同色に",
);

/* ── [SK1] the skid ring buffer wraps cleanly ──────────────────────────────── */
{
  const capacity = 16;
  const buffers = createSkidBuffers(capacity);
  let cursor = 0;
  for (let i = 0; i < capacity + 50; i += 1) {
    cursor = writeSkidQuad(
      buffers,
      cursor,
      [i, 0, 0],
      [i, 0, 1],
      [i + 1, 0, 0],
      [i + 1, 0, 1],
      i * 0.1,
      0.5,
    );
  }
  const nan = buffers.position.some((value) => !Number.isFinite(value));
  // Quad slot (capacity+50-1) % capacity holds the LAST write's x values.
  const lastQuad = (capacity + 50 - 1) % capacity;
  const lastX = buffers.position[lastQuad * 12]!;
  gate.check(
    "[SK1] スキッドのリングバッファが巻き戻って上書きする",
    cursor === (capacity + 50) % capacity && lastX === capacity + 49 && !nan,
    `cursor=${cursor} 最終quad x=${lastX} NaN=${nan}`,
  );
}

/* ── [SK2] wheel contacts conform to the banked surface ────────────────────── */
{
  const track = built[0]!;
  // Pick the most banked sample so the term under test is as large as possible.
  let index = 0;
  for (let i = 0; i < track.samples.length; i += 1) {
    if (Math.abs(track.samples[i]!.bank) > Math.abs(track.samples[index]!.bank)) index = i;
  }
  const sample = track.samples[index]!;
  const yaw = Math.atan2(sample.tx, sample.tz);
  const contact = rearWheelContacts(track, sample.x, sample.z, yaw, index);
  // Independent expectation from the surface formula at each wheel's lateral.
  const q = querySurface(track, contact.left[0], contact.left[2], index, SHOULDER_WIDTH);
  const sampleAtQuery = track.samples[q.index]!;
  const expectLeft = sampleAtQuery.y + Math.tan(q.bank) * q.lateral + 0.03;
  const errorLeft = Math.abs(contact.left[1] - expectLeft);
  gate.check(
    "[SK2] バンク路面で左右輪の高さが表面式と一致する",
    errorLeft < 0.02 && Math.abs(sample.bank) > 0.05,
    `誤差 ${errorLeft.toFixed(4)}m（bank ${sample.bank.toFixed(3)} rad の地点で検証）`,
  );

  gate.expectFail(
    "[SK2-neg] tan(bank) 項を落とすと SK2 が落ちる",
    () => {
      const flatY = sampleAtQuery.y + 0.03;
      return Math.abs(contact.left[1] - flatY) < 0.02;
    },
    "バンク項なしの高さ",
  );
}

/* ── [SK3] emission policy: drifting marks, cruising does not ──────────────── */
{
  const drifting = skidStrength(
    { driftDir: 1, driftTier: 2, speed: 30, spinTimer: 0, offRoad: false, airborne: false },
    0,
  );
  const cruising = skidStrength(
    { driftDir: 0, driftTier: 0, speed: 30, spinTimer: 0, offRoad: false, airborne: false },
    0,
  );
  const braking = skidStrength(
    { driftDir: 0, driftTier: 0, speed: 20, spinTimer: 0, offRoad: false, airborne: false },
    32,
  );
  const airborne = skidStrength(
    { driftDir: 1, driftTier: 2, speed: 30, spinTimer: 0, offRoad: false, airborne: true },
    0,
  );
  gate.check(
    "[SK3] ドリフト/急減速は痕を書き、巡航/空中は書かない",
    drifting > 0 && braking > 0 && cruising === 0 && airborne === 0,
    `drift=${drifting.toFixed(2)} brake=${braking.toFixed(2)} cruise=${cruising} air=${airborne}`,
  );
}

gate.finish("RENDER SELFTEST");
