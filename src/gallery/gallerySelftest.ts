/**
 * Gate: the corridor is walkable, every work in it can actually be seen, and
 * the page's scroll and the room's geometry are the same fact.
 *
 * None of this needs a GPU, a canvas or a browser, which is the point. The
 * defects it catches are the ones a screenshot cannot show:
 *
 *   - a plate that is only ever visible on a 16:9 desktop, so one work is
 *     simply missing on a phone and nobody finds out
 *   - a bend tight enough that the wall folds through itself where the frames
 *     hang, which reads as "the picture is inside the wall" from one angle
 *     and looks perfect from every other
 *   - a frame that flips at an inflection so every other cover is mirrored
 *   - a scroll map that drifts from the placement, so the caption says one
 *     work while the reader is standing in front of another
 *
 * Every gate is also run against a deliberately broken corridor in the same
 * execution, and the run fails if the broken one passes. A gate nobody has
 * seen fail is a gate nobody has tested.
 *
 * Run: npx tsx src/gallery/gallerySelftest.ts
 */
import {
  buildCorridor,
  cameraAt,
  corridor,
  dist,
  dot,
  len,
  plateLateral,
  exhibitPoses,
  activeIndexAt,
  progressForExhibit,
  tForProgress,
  sight,
  spacingFor,
  verticalFov,
  FOV,
  GALLERY_SHAPE,
  MAX_VIEW,
  MIN_FACING,
  ROOM,
  PLATE,
  SAMPLES,
  UP,
  WALK,
  type Corridor,
  type Shape
} from "./curve";
import { EXHIBITS, SELF_ID, LOD, derivativeFor, worstCaseTextureBytes } from "./exhibits";
import { CATALOG } from "../portfolio/bento";

/* Node's, under tsx. Declared locally the way bentoSelftest.ts does rather
   than pulling @types/node into a browser tsconfig for one property. */
declare const process: { exitCode?: number };

const COUNT = EXHIBITS.length;
const LANDSCAPE = 16 / 9;
const PORTRAIT = 9 / 16;
const DEG = 180 / Math.PI;

interface Result {
  readonly ok: boolean;
  readonly detail: string;
}

const failures: string[] = [];
function check(id: string, label: string, r: Result): void {
  console.log(`${r.ok ? "PASS" : "FAIL"} ${id} ${label} — ${r.detail}`);
  if (!r.ok) failures.push(id);
}
/** The same gate, on a corridor built to break it. Passing here is a failure. */
function expectFail(id: string, what: string, r: Result): void {
  const ok = !r.ok;
  console.log(`${ok ? "PASS" : "FAIL"} ${id}破壊 ${what} — ${ok ? `期待どおり落ちた: ${r.detail}` : "壊したのに通った"}`);
  if (!ok) failures.push(`${id}破壊`);
}

/* ── [G1] the corridor does not pass through itself ─────────────────────── */
function g1(c: Corridor): Result {
  const stride = 4;
  const step = c.length / SAMPLES;
  /* Points closer together than this along the walk are neighbours; of course
     they are near each other in space. Anything further apart that comes
     within a corridor width is the hall crossing its own path. */
  const ignoreWithin = ROOM.halfWidth * 4;
  const minGap = ROOM.halfWidth * 2;
  let worst = Infinity;
  let where = "";
  for (let i = 0; i <= SAMPLES; i += stride) {
    for (let j = i + Math.ceil(ignoreWithin / step); j <= SAMPLES; j += stride) {
      const d = dist(c.samples[i]!, c.samples[j]!);
      if (d < worst) {
        worst = d;
        where = `${(i * step).toFixed(0)}m と ${(j * step).toFixed(0)}m`;
      }
    }
  }
  return {
    ok: worst >= minGap,
    detail: `最接近 ${worst.toFixed(2)}m（${where}）/ 下限 ${minGap.toFixed(2)}m`
  };
}

/* ── [G2] the frames are in order and not crowded ───────────────────────── */
function g2(c: Corridor, count: number): Result {
  const poses = exhibitPoses(count, c);
  const spacing = spacingFor(count, c.length);
  const problems: string[] = [];
  if (spacing < 12 || spacing > 24) problems.push(`間隔 ${spacing.toFixed(2)}m が 12–24m の外`);

  let closest = Infinity;
  for (let i = 1; i < poses.length; i++) {
    const a = poses[i - 1]!;
    const b = poses[i]!;
    if (b.t <= a.t) problems.push(`t が単調でない: #${i - 1}=${a.t.toFixed(4)} #${i}=${b.t.toFixed(4)}`);
    /* Centre-to-centre in space, not along the curve. On the inside of a bend
       the wall arc is shorter than the centreline's, so evenly spaced in arc
       length is not evenly spaced on the wall. */
    closest = Math.min(closest, dist(a.centre, b.centre));
  }
  /* Two plates 3.2 m wide need more than 3.2 m between their centres or they
     touch. Half a plate of air either side is the least that reads as hung. */
  const minCentres = PLATE.width * 1.5;
  if (closest < minCentres) problems.push(`最近接 ${closest.toFixed(2)}m < ${minCentres.toFixed(2)}m`);
  if (poses.some((p) => p.t < 0 || p.t > 1)) problems.push("t が [0,1] の外");

  /*
   * The plate's basis, checked rather than assumed. right and facing are
   * derived from each other through a cross product, so a sign error does not
   * produce a broken-looking result — it produces a mirrored cover, or a
   * picture painted on the back of its own panel, both of which render
   * perfectly.
   */
  for (const p of poses) {
    const problemsBefore = problems.length;
    if (Math.abs(len(p.right) - 1) > 1e-6) problems.push(`#${p.index} right が単位長でない`);
    if (Math.abs(len(p.facing) - 1) > 1e-6) problems.push(`#${p.index} facing が単位長でない`);
    if (Math.abs(dot(p.right, p.facing)) > 1e-6) problems.push(`#${p.index} right と facing が直交しない`);
    if (Math.abs(dot(p.right, p.up)) > 1e-6) problems.push(`#${p.index} right と up が直交しない`);
    /* The toe turns the plate back down the corridor, toward the reader
       walking up it — not forward, away from them. */
    const back = -dot(p.facing, c.frameAt(p.t).tangent);
    if (back < 0.2) problems.push(`#${p.index} 正面が読者側を向いていない (${back.toFixed(3)})`);
    if (problems.length > problemsBefore) break;
  }

  return {
    ok: problems.length === 0,
    detail:
      problems.length === 0
        ? `${count}点・間隔 ${spacing.toFixed(2)}m・最近接 ${closest.toFixed(2)}m・額の基底は正規直交`
        : summarise(problems)
  };
}

/* ── [G3] every work is visible, in both orientations ───────────────────── */
function bestSighting(c: Corridor, count: number, index: number, aspect: number) {
  const poses = exhibitPoses(count, c);
  const pose = poses[index]!;
  /* Only the stretch of corridor from which the plate could possibly be in
     range is worth sweeping. */
  const from = Math.max(0, (pose.metres - MAX_VIEW) / c.length);
  const to = Math.min(1, (pose.metres + 2) / c.length);
  const steps = Math.max(8, Math.round(((to - from) * c.length) / 0.4));
  let best: ReturnType<typeof sight> | null = null;
  let bestT = 0;
  let visible = false;
  /*
   * The whole approach is swept and the most CENTRED sighting kept, not the
   * first one that squeaks into frame. Returning early would report every
   * plate as sitting at 90% of the frustum — true, and true of the instant it
   * appears at the edge of the screen, which says nothing about whether the
   * reader ever gets a look at it.
   */
  const score = (view: ReturnType<typeof sight>): number =>
    Math.max(view.hFrac, view.vFrac) +
    (view.facing > MIN_FACING ? 0 : 2) +
    (view.distance > MAX_VIEW ? 2 : 0);
  for (let s = 0; s <= steps; s++) {
    const t = from + ((to - from) * s) / steps;
    const view = sight(cameraAt(t, c), pose, aspect);
    if (!best || score(view) < score(best)) {
      best = view;
      bestT = t;
    }
    visible ||= view.whole;
  }
  return { view: best!, t: bestT, visible };
}

/** Long failure lists are unreadable; the first few and a count are not. */
function summarise(problems: string[], limit = 4): string {
  return problems.length <= limit
    ? problems.join(" / ")
    : `${problems.slice(0, limit).join(" / ")} … 他 ${problems.length - limit} 件`;
}

function g3(c: Corridor, count: number): Result {
  const misses: string[] = [];
  let tightest = 0;
  for (const [name, aspect] of [
    ["16:9", LANDSCAPE],
    ["9:16", PORTRAIT]
  ] as const) {
    for (let i = 0; i < count; i++) {
      const r = bestSighting(c, count, i, aspect);
      if (!r.visible) {
        misses.push(
          `${name} #${i}: 最善でも四隅の最大 横${(r.view.hFrac * 100).toFixed(0)}% ` +
            `縦${(r.view.vFrac * 100).toFixed(0)}% 距離${r.view.distance.toFixed(1)}m ` +
            `正対${r.view.facing.toFixed(2)}`
        );
      } else {
        tightest = Math.max(tightest, Math.max(r.view.hFrac, r.view.vFrac));
      }
    }
  }
  return {
    ok: misses.length === 0,
    detail:
      misses.length === 0
        ? `${count}点 x 2画角すべて四隅まで収まる（最も収まりが悪い一点で枠の ${(tightest * 100).toFixed(0)}%・` +
          `9:16の垂直画角 ${(verticalFov(PORTRAIT) * DEG).toFixed(0)}度）`
        : summarise(misses)
  };
}

/* ── [G4] stopping on a row puts you in front of that work ──────────────── */
function g4(c: Corridor, count: number): Result {
  const poses = exhibitPoses(count, c);
  const problems: string[] = [];
  let far = 0;
  for (let i = 0; i < count; i++) {
    const t = tForProgress(progressForExhibit(i, count), count, c);
    const active = activeIndexAt(t, count, c);
    if (active !== i) problems.push(`行${i} で active=${active}`);
    for (const [name, aspect] of [
      ["16:9", LANDSCAPE],
      ["9:16", PORTRAIT]
    ] as const) {
      const view = sight(cameraAt(t, c), poses[i]!, aspect);
      if (!view.centred) {
        problems.push(
          `行${i} ${name}: 中心 横${(view.centreH * 100).toFixed(0)}% 縦${(view.centreV * 100).toFixed(0)}% ` +
            `距離${view.distance.toFixed(1)}m 正対${view.facing.toFixed(2)}`
        );
      }
      far = Math.max(far, view.distance);
    }
  }
  return {
    ok: problems.length === 0,
    detail: problems.length === 0 ? `${count}行すべて一致・最遠 ${far.toFixed(1)}m` : summarise(problems)
  };
}

/* ── [G5] the wall and the DOM list show the same works ─────────────────── */
function g5(): Result {
  /*
   * Re-derived from CATALOG rather than compared against a number written
   * here, and phrased so it is true before and after this page joins the
   * catalogue itself: the wall shows everything except this page, whether or
   * not this page has been added yet. Writing `CATALOG.length - 1` would have
   * made the gate red for five stages, and a gate that is expected to be red
   * is a gate nobody reads.
   */
  const registered = CATALOG.some((w) => w.id === SELF_ID);
  const expected = CATALOG.filter((w) => w.id !== SELF_ID).length;
  const ids = new Set(CATALOG.map((w) => w.id));
  const strays = EXHIBITS.filter((w) => !ids.has(w.id)).map((w) => w.id);
  const selfHung = EXHIBITS.some((w) => w.id === SELF_ID);
  const poses = exhibitPoses(COUNT);
  const ok = COUNT === expected && COUNT > 0 && !selfHung && strays.length === 0 && poses.length === COUNT;
  return {
    ok,
    detail: ok
      ? `CATALOG ${CATALOG.length} 件 → 展示 ${COUNT} 点・額 ${poses.length} 枚` +
        (registered ? "（自分はカタログに登録済み・展示からは除外）" : "（自分はまだ works.ts 未登録 — A7で追加）")
      : `展示 ${COUNT} / 期待 ${expected} / 自己展示=${selfHung} / カタログ外=${strays.join(",") || "なし"} / 額 ${poses.length}`
  };
}

/* ── [G6] the wall fits in memory, at widths that exist ─────────────────── */
function g6(): Result {
  const CAP = 40 * 1024 * 1024;
  const worst = worstCaseTextureBytes();
  const missing = EXHIBITS.filter((w) => !derivativeFor(w.cover, LOD.base, "/").derived).map((w) => w.id);
  const undersized = EXHIBITS.filter((w) => derivativeFor(w.cover, LOD.near, "/").width < LOD.near).map(
    (w) => w.id
  );
  const ok = worst <= CAP && missing.length === 0 && undersized.length === 0;
  return {
    ok,
    detail: ok
      ? `最悪同時 ${(worst / 1048576).toFixed(1)}MB / 上限 40MB（全${COUNT}点が ${LOD.base} と ${LOD.near} を持つ）`
      : `${(worst / 1048576).toFixed(1)}MB / 派生なし: ${missing.join(",") || "なし"} / ` +
        `${LOD.near}未満: ${undersized.join(",") || "なし"}`
  };
}

/* ── [G7] the walk is smooth and the wall is flat enough to hang on ─────── */
function g7(c: Corridor): Result {
  /* Curvature from three samples 2 m apart. Reading it off adjacent 7.5 cm
     samples measures floating-point noise, not the corridor. */
  const stride = Math.round(2 / (c.length / SAMPLES));
  let minRadius = Infinity;
  let at = 0;
  for (let i = stride; i + stride <= SAMPLES; i += stride) {
    const a = c.samples[i - stride]!;
    const b = c.samples[i]!;
    const d = c.samples[i + stride]!;
    const ab = dist(a, b);
    const bd = dist(b, d);
    const ad = dist(a, d);
    /* Menger curvature: 4 x triangle area / product of the sides. */
    const s = (ab + bd + ad) / 2;
    const area = Math.sqrt(Math.max(0, s * (s - ab) * (s - bd) * (s - ad)));
    const radius = area > 1e-9 ? (ab * bd * ad) / (4 * area) : Infinity;
    if (radius < minRadius) {
      minRadius = radius;
      at = (i / SAMPLES) * c.length;
    }
  }
  /* The wall is the centreline offset sideways by halfWidth. Offset a curve by
     more than its radius and it folds through itself, so the plate would sit
     behind the wall it hangs on. 1.5x keeps a margin. */
  const floor = ROOM.halfWidth * 1.5;

  /* Speed. t is arc length, so equal steps in t must be equal steps in space;
     a step size that is not a whole number of samples is used on purpose, so
     the measurement crosses table entries at every phase instead of landing
     on them. */
  const probes = 997;
  let fastest = 0;
  let slowest = Infinity;
  for (let i = 0; i < probes; i++) {
    const t = i / probes;
    const d = dist(c.pointAt(t), c.pointAt(t + 1 / probes));
    fastest = Math.max(fastest, d);
    slowest = Math.min(slowest, d);
  }
  const ripple = fastest / slowest;

  const ok = minRadius >= floor && ripple < 1.02;
  return {
    ok,
    detail: ok
      ? `最小曲率半径 ${minRadius.toFixed(1)}m（下限 ${floor.toFixed(1)}m）・速度リップル ${ripple.toFixed(4)}`
      : `最小曲率半径 ${minRadius.toFixed(2)}m @${at.toFixed(0)}m（下限 ${floor.toFixed(2)}m）・` +
        `速度リップル ${ripple.toFixed(4)}（上限 1.02）`
  };
}

/* ── [G7b] the horizontal frame never degenerates ───────────────────────── */
function g7b(c: Corridor): Result {
  const steps = 2000;
  let steepest = 0;
  let at = 0;
  let worstFlip = 1;
  let previous = c.frameAt(0).right;
  for (let i = 1; i <= steps; i++) {
    const f = c.frameAt(i / steps);
    const slope = Math.abs(dot(f.tangent, UP));
    if (slope > steepest) {
      steepest = slope;
      at = (i / steps) * c.length;
    }
    worstFlip = Math.min(worstFlip, dot(f.right, previous));
    previous = f.right;
  }
  /* cross(tangent, UP) loses precision as the corridor approaches vertical and
     is undefined at it. Half is a 30 degree floor — well past anything a
     gallery should do, and far from the cliff. */
  const ok = steepest <= 0.5 && worstFlip > 0.999;
  return {
    ok,
    detail: ok
      ? `最大傾斜 ${(Math.asin(steepest) * DEG).toFixed(1)}度・隣接rightの最小内積 ${worstFlip.toFixed(5)}`
      : `最大傾斜 ${(Math.asin(Math.min(1, steepest)) * DEG).toFixed(1)}度 @${at.toFixed(0)}m（上限30度）・` +
        `隣接rightの最小内積 ${worstFlip.toFixed(5)}（下限0.999）`
  };
}

/* ── run ────────────────────────────────────────────────────────────────── */

const real = corridor();
console.log(
  `回廊 全長 ${real.length.toFixed(1)}m / 展示 ${COUNT}点 / 間隔 ${spacingFor(COUNT, real.length).toFixed(2)}m / ` +
    `幅 ${(ROOM.halfWidth * 2).toFixed(1)}m / 先読み ${WALK.viewLead}m / ` +
    `額の振り ${((PLATE.toe * 180) / Math.PI).toFixed(0)}度・中心線から ${plateLateral().toFixed(2)}m\n`
);

check("[G1]", "回廊が自分自身を貫通しない", g1(real));
check("[G2]", "展示が順序どおりで詰まっていない", g2(real, COUNT));
check("[G3]", "全作品が四隅まで16:9と9:16の両方で見える", g3(real, COUNT));
check("[G4]", "その行で止まるとその作品の正面に立つ", g4(real, COUNT));
check("[G5]", "壁とDOM一覧が同じ作品を指す", g5());
check("[G6]", "テクスチャが実在する幅で予算内に収まる", g6());
check("[G7]", "歩きが滑らかで壁が平ら", g7(real));
check("[G7b]", "水平フレームが破綻しない", g7b(real));

/*
 * Sabotage. Each variant breaks exactly one property, and the gate that owns
 * that property must be the one that notices.
 *
 * The CRLF lesson from v14 applies: a destructive test that did not actually
 * destroy anything printed PASS and proved nothing. These variants are built
 * from a different Shape rather than by editing a file, so there is no way for
 * the edit to silently not apply.
 */
console.log("");
const broken = (name: string, patch: Partial<Shape>): [string, Corridor] => [
  name,
  buildCorridor({ ...GALLERY_SHAPE, ...patch })
];

const [foldName, folded] = broken("急カーブ（sway 30 / turns 9）", { sway: 30, turns: 9 });
expectFail("[G7]", foldName, g7(folded));

const [steepName, steep] = broken("縦揺れ 40m（rise 40 / waves 5）", { rise: 40, waves: 5 });
expectFail("[G7b]", steepName, g7b(steep));

const [crossName, crossing] = broken("短く大きく蛇行（extent 60 / sway 34 / turns 4）", {
  extent: 60,
  sway: 34,
  turns: 4
});
expectFail("[G1]", crossName, g1(crossing));

const [shortName, shortRoom] = broken("全長を半分に（extent 130）", { extent: 130 });
expectFail("[G2]", shortName, g2(shortRoom, COUNT));

/*
 * The one that matters most: turn the lead off. With the frame level with the
 * camera it is at 90 degrees to the view and cannot be seen, which is exactly
 * the mistake the constant exists to prevent — and exactly the kind that looks
 * fine in a screenshot taken while scrolling past.
 */
{
  const saved = WALK.viewLead;
  (WALK as { viewLead: number }).viewLead = 0;
  expectFail("[G4]", "先読みを 0m にする", g4(real, COUNT));
  (WALK as { viewLead: number }).viewLead = saved;
}

/*
 * And the other load-bearing choice: widening the vertical field of view on a
 * tall viewport. Turn that off and 9:16 falls back to a fixed 50 degrees, which
 * is a 29 degree horizontal view — the plates are still there, still lit, still
 * hung correctly, and a phone never sees one whole.
 */
{
  const saved = FOV.minHorizontal;
  (FOV as { minHorizontal: number }).minHorizontal = 0;
  expectFail("[G3]", "縦長画面の画角拡張を止める", g3(real, COUNT));
  (FOV as { minHorizontal: number }).minHorizontal = saved;
}

console.log(failures.length === 0 ? "\nGALLERY SELFTEST PASS" : `\nGALLERY SELFTEST FAIL — ${failures.join(", ")}`);
if (failures.length > 0) process.exitCode = 1;
