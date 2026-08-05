/**
 * Gate: the field's arithmetic, checked without a GPU.
 *
 * Three defect classes, none of which a screenshot shows:
 *
 *   heading — a sign error in facing() or strafe() makes W walk sideways or A
 *   walk backwards. Every individual line looks plausible; only the
 *   combination is wrong. ARENA shipped exactly this once and it is why its
 *   headingSelftest exists.
 *
 *   sampling — heightAt() is what the player stands on. If its bilinear
 *   weights are wrong the reader sinks into slopes, and on a noisy field a
 *   half-cell error is invisible until someone walks a ridge.
 *
 *   budget — a blade count that overflows a storage buffer, or a tier ladder
 *   that is not actually a ladder, fails on someone else's machine.
 *
 * Run: npx tsx src/windfield/fieldSelftest.ts
 */
import {
  FIELD,
  bladeBytes,
  bladeCount,
  buildQuality,
  cellSize,
  facing,
  heightAt,
  slopeAt,
  strafe,
  turnTo,
  yawTowards
} from "./field";
import { PACE, RESCUE_RADIUS, createWalker, step } from "./scene/walker";

declare const process: { exitCode?: number };

const failures: string[] = [];
function check(id: string, label: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${label} — ${detail}`);
  if (!ok) failures.push(id);
}
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

/* ── [W1] the heading convention is self-consistent ─────────────────────── */
{
  const problems: string[] = [];
  /* Yaw 0 faces -Z, the way three.js points an object that has not been
     rotated. Everything else is measured from that. */
  const f0 = facing(0);
  if (!near(f0.x, 0) || !near(f0.z, -1)) problems.push(`facing(0) = (${f0.x}, ${f0.z})`);
  const s0 = strafe(0);
  if (!near(s0.x, 1) || !near(s0.z, 0)) problems.push(`strafe(0) = (${s0.x}, ${s0.z})`);

  for (let i = 0; i < 32; i++) {
    const yaw = -Math.PI + (i / 32) * Math.PI * 2;
    const f = facing(yaw);
    const s = strafe(yaw);
    if (!near(Math.hypot(f.x, f.z), 1, 1e-9)) problems.push(`facing not unit at ${yaw.toFixed(2)}`);
    if (!near(f.x * s.x + f.z * s.z, 0, 1e-9)) problems.push(`facing/strafe not perpendicular at ${yaw.toFixed(2)}`);
    /* Round trip: the yaw that faces a direction must face that direction. */
    const back = yawTowards(f.x, f.z);
    if (!near(Math.abs(turnTo(yaw, back)), 0, 1e-9)) problems.push(`round trip fails at ${yaw.toFixed(2)}`);
    /*
     * Right hand, not left. cross(facing, up) for facing (fx, 0, fz) and up
     * (0, 1, 0) is (-fz, 0, fx), so the whole convention reduces to one exact
     * identity: strafe.x = -facing.z and strafe.z = facing.x. An identity
     * rather than a sign test, because a sign test passes for a strafe that is
     * on the correct side and the wrong length.
     */
    if (!near(s.x, -f.z, 1e-9) || !near(s.z, f.x, 1e-9)) {
      problems.push(`strafe != cross(facing, up) at ${yaw.toFixed(2)}: (${s.x.toFixed(3)}, ${s.z.toFixed(3)}) vs (${(-f.z).toFixed(3)}, ${f.x.toFixed(3)})`);
    }
  }
  check("[W1]", "前後左右の規約が一貫している（Dが左に歩かない）", problems.length === 0,
    problems.length === 0 ? "32方位すべてで単位長・直交・右手・往復一致" : problems.slice(0, 3).join(" / "));
}

/* ── [W2] the shortest turn is the shortest turn ────────────────────────── */
{
  const cases: [number, number, number][] = [
    [0, 0.1, 0.1],
    [3.0, -3.0, 0.2831853071795862],
    [-3.0, 3.0, -0.2831853071795862],
    [0, Math.PI, Math.PI]
  ];
  const bad = cases.filter(([a, b, want]) => !near(turnTo(a, b), want, 1e-9));
  check("[W2]", "最短回頭が π を跨いでも最短のまま", bad.length === 0,
    bad.length === 0 ? "境界4件一致" : bad.map(([a, b, w]) => `${a}->${b} 期待${w} 実際${turnTo(a, b)}`).join(" / "));
}

/* ── [W3] heightAt is a correct bilinear sample ─────────────────────────── */
{
  /* A synthetic field where the right answer is known exactly: a plane. Any
     bilinear scheme reproduces a plane perfectly, so any deviation is an
     indexing or weighting error rather than interpolation error. */
  const n = FIELD.grid;
  const plane = new Float32Array(n * n);
  const step = cellSize();
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const x = -FIELD.size / 2 + ix * step;
      const z = -FIELD.size / 2 + iz * step;
      plane[iz * n + ix] = 0.3 * x - 0.17 * z + 2;
    }
  }
  let worst = 0;
  for (let i = 0; i < 400; i++) {
    /* Deterministic sweep of awkward positions: off-lattice, near the border,
       and exactly on posts. */
    const x = -FIELD.size / 2 + ((i * 7.331) % FIELD.size);
    const z = -FIELD.size / 2 + ((i * 3.917) % FIELD.size);
    worst = Math.max(worst, Math.abs(heightAt(plane, x, z) - (0.3 * x - 0.17 * z + 2)));
  }
  const s = slopeAt(plane, 3.3, -7.1);
  const slopeOk = near(s.dx, 0.3, 1e-3) && near(s.dz, -0.17, 1e-3);
  check("[W3]", "heightAt が平面を誤差なく再現する（添字と重みが正しい）", worst < 1e-3 && slopeOk,
    `最大誤差 ${worst.toExponential(2)} m / 勾配 (${s.dx.toFixed(4)}, ${s.dz.toFixed(4)}) 期待 (0.3, -0.17)`);

  /* Outside the field must clamp rather than read past the array — an
     out-of-range index returns undefined and poisons the walk with NaN. */
  const outside = [heightAt(plane, 1e6, 1e6), heightAt(plane, -1e6, 0), heightAt(plane, 0, 1e6)];
  check("[W3b]", "場外を引いても NaN にならない（配列外参照でNaNが伝播しない）",
    outside.every((h) => Number.isFinite(h)), outside.map((h) => h.toFixed(2)).join(", "));
}

/* ── [W4] walking does what the keys say ────────────────────────────────── */
{
  const n = FIELD.grid;
  const flat = new Float32Array(n * n);
  const problems: string[] = [];

  /* Facing -Z (yaw 0), W must decrease Z and D must increase X. */
  const w = createWalker(0, 0, flat);
  for (let i = 0; i < 60; i++) step(w, { forward: 1, strafe: 0, run: false }, 0, 1 / 60, flat);
  if (!(w.z < -0.5)) problems.push(`W did not walk forward: z=${w.z.toFixed(3)}`);
  if (Math.abs(w.x) > 0.05) problems.push(`W drifted sideways: x=${w.x.toFixed(3)}`);

  const d = createWalker(0, 0, flat);
  for (let i = 0; i < 60; i++) step(d, { forward: 0, strafe: 1, run: false }, 0, 1 / 60, flat);
  if (!(d.x > 0.5)) problems.push(`D did not walk right: x=${d.x.toFixed(3)}`);

  /* Running is faster than walking, and neither exceeds its own top speed. */
  const r = createWalker(0, 0, flat);
  for (let i = 0; i < 240; i++) step(r, { forward: 1, strafe: 0, run: true }, 0, 1 / 60, flat);
  if (r.speed > PACE.run + 1e-6) problems.push(`run overshot: ${r.speed.toFixed(3)}`);
  if (r.speed < PACE.run * 0.98) problems.push(`run never reached top: ${r.speed.toFixed(3)}`);

  /* The edge of the world holds. */
  const e = createWalker(0, 0, flat);
  for (let i = 0; i < 1200; i++) step(e, { forward: 1, strafe: 0, run: true }, 0, 1 / 60, flat);
  if (Math.abs(e.z) > FIELD.size / 2) problems.push(`walked off the field: z=${e.z.toFixed(2)}`);

  check("[W4]", "W前 / D右 / 走りが歩きより速い / 場外に出ない", problems.length === 0,
    problems.length === 0
      ? `W z=${w.z.toFixed(2)} · D x=${d.x.toFixed(2)} · 走り ${r.speed.toFixed(2)}m/s · 端 ${e.z.toFixed(2)}m`
      : problems.join(" / "));
}

/* ── [W5] the rescue never fires during normal play ─────────────────────── */
{
  const flat = new Float32Array(FIELD.grid * FIELD.grid);
  const w = createWalker(0, 0, flat);
  let maxRadius = 0;
  for (let i = 0; i < 60 * 120; i++) {
    /* Two minutes of running in a slowly turning direction — as far from the
       origin as the field allows anyone to get. */
    step(w, { forward: 1, strafe: Math.sin(i / 400), run: true }, i / 900, 1 / 60, flat);
    maxRadius = Math.max(maxRadius, Math.hypot(w.x, w.z));
  }
  check("[W5]", "救済が通常プレイで絶対に発火しない（半径がしきい値のはるか内側）",
    maxRadius < RESCUE_RADIUS * 0.5,
    `2分間走って最大半径 ${maxRadius.toFixed(1)}m / しきい値 ${RESCUE_RADIUS}m`);
}

/* ── [W6] the tier ladder is a ladder, and fits in the buffers ──────────── */
{
  const tiers = (["low", "balanced", "high"] as const).map((t) => buildQuality(t, false, false, 1));
  const problems: string[] = [];
  for (let i = 1; i < tiers.length; i++) {
    if (bladeCount(tiers[i]!) <= bladeCount(tiers[i - 1]!)) problems.push(`${tiers[i]!.tier} has no more blades`);
    if (tiers[i]!.bladeRange <= tiers[i - 1]!.bladeRange) problems.push(`${tiers[i]!.tier} draws no further`);
  }
  /* The WebGPU default maxStorageBufferBindingSize is 128 MiB, and this page
     asks for no requiredLimits on purpose — so every tier has to fit inside
     the guaranteed minimum rather than inside what one machine happens to
     allow. Three buffers of this size are bound at once. */
  const CAP = 128 * 1024 * 1024;
  const worst = bladeBytes(tiers[tiers.length - 1]!);
  if (worst > CAP) problems.push(`${(worst / 1048576).toFixed(0)} MB over the 128 MiB guarantee`);

  /* Reduced motion freezes the wind and NOTHING ELSE. */
  const still = buildQuality("high", true, false, 1);
  if (still.motionScale !== 0) problems.push("reduced motion did not stop the wind");
  if (bladeCount(still) !== bladeCount(tiers[2]!)) problems.push("reduced motion removed grass");

  check("[W6]", "ティアが単調で、既定の128MiB保証に収まり、モーションOFFが草を消さない",
    problems.length === 0,
    problems.length === 0
      ? `${tiers.map((t) => `${t.tier} ${bladeCount(t).toLocaleString()}本`).join(" < ")} · 最大 ${(worst / 1048576).toFixed(1)}MB/本`
      : problems.join(" / "));
}

/*
 * Sabotage. The heading gate is the one worth proving, because it is the one
 * whose failure looks like a control problem rather than a bug.
 */
console.log("");
{
  const flipped = (yaw: number): { x: number; z: number } => ({ x: Math.sin(yaw), z: -Math.cos(yaw) });
  let caught = false;
  for (let i = 0; i < 32; i++) {
    const yaw = -Math.PI + (i / 32) * Math.PI * 2;
    const f = flipped(yaw);
    const s = strafe(yaw);
    if (Math.abs(s.x - -f.z) > 1e-9 || Math.abs(s.z - f.x) > 1e-9) caught = true;
  }
  console.log(`${caught ? "PASS" : "FAIL"} [W1]破壊 facing の X を反転する — ${caught ? "期待どおり右手系の判定が落ちた" : "壊したのに通った"}`);
  if (!caught) failures.push("[W1]破壊");
}
{
  /* A half-cell offset in the sampler: the classic off-by-one that leaves the
     player sunk into every slope by a fraction of a cell. */
  const n = FIELD.grid;
  const plane = new Float32Array(n * n);
  const step = cellSize();
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      plane[iz * n + ix] = 0.3 * (-FIELD.size / 2 + ix * step) - 0.17 * (-FIELD.size / 2 + iz * step) + 2;
    }
  }
  const shifted = (x: number, z: number): number => heightAt(plane, x + step / 2, z);
  let worst = 0;
  for (let i = 0; i < 200; i++) {
    const x = -FIELD.size / 2 + ((i * 7.331) % FIELD.size);
    const z = -FIELD.size / 2 + ((i * 3.917) % FIELD.size);
    worst = Math.max(worst, Math.abs(shifted(x, z) - (0.3 * x - 0.17 * z + 2)));
  }
  const caught = worst >= 1e-3;
  console.log(`${caught ? "PASS" : "FAIL"} [W3]破壊 サンプル位置を半セルずらす — ${caught ? `期待どおり落ちた: 誤差 ${worst.toExponential(2)} m` : "壊したのに通った"}`);
  if (!caught) failures.push("[W3]破壊");
}

console.log(failures.length === 0 ? "\nFIELD SELFTEST PASS" : `\nFIELD SELFTEST FAIL — ${failures.join(", ")}`);
if (failures.length > 0) process.exitCode = 1;
