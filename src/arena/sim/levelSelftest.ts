/*
 * G-HEIGHT — 段（storey）の恒久ゲート。ARCHITECTURE_V4 §4。
 *
 * 既存の builder/levelMountSelftest.ts は「1段だけ」の機体しか組まないので、
 * levelRises() が2段目の rise を落としても気づけない、とレビューで指摘された。
 * このゲートは必ず**2段以上**を積み、しかも1段目と2段目で **rise を変える**
 * （0.18m の上に 0.10m）。同じ数字を2回使う機体だと「rises[1] を2回読む」種類の
 * バグが素通りするからで、段が違えば高さも違う機体でしか検出できない。
 *
 * 検査は4系統。どれも「同じ式を2回読む」ことを避け、別経路で測った2値を突き合わせる:
 *
 *  [A] H1/H4/H5/H6 違反を validateBuild が**日本語**で、しかも**パーツ名と段数**を
 *      含めて弾くこと（H6 の契約要求）。合法な機体が通ることも同時に見る——
 *      「全部エラーにする」実装でも通ってしまうゲートは無価値なので。
 *
 *  [B] ⭐ 段の上のパーツの**物理位置と描画位置**が ±1mm で一致すること。
 *      物理側は assembleBot が作った Rapier のコライダーから
 *      （world 変換も halfExtents も Rapier が持っている値）、
 *      描画側は render/mounting.ts の mountPartObject が置いた three.js の
 *      Object3D のワールド座標から、**別々に**取る。
 *      機体は原点でも無回転でもない位置に置く（ORIGIN / FACING）ので、
 *      「剛体の姿勢 × コライダーのローカル」（Rapier）と
 *      「グループ行列 × 子の行列」（three.js）という2つの合成を実際に通る。
 *
 *  [C] 支柱の**天面**が、ちょうど次の段の**基準面**であること。
 *      天面はその支柱自身のコライダーの実寸（中心 + halfExtents）から、
 *      基準面は段の上のパーツのコライダー下面から測る。段の差分が
 *      カタログの `rise` そのものであることまで見るので、levelRises() が
 *      2段目を落とせば必ず落ちる。船体デッキの高さも
 *      シャーシコライダーの天面から測る（定数の再掲をしない）。
 *
 *  [D] 支柱を1段足すと `comHeight` が上がり `stability` が下がること（H7）。
 *
 *  [E] ハルの持ち上げ（hullLift）が、脚の**実際の沈み込み**以上であること。
 *      沈み込みは Rapier に入っている脚カプセルの位置・姿勢・寸法だけから
 *      数値サンプリングで求める（星形を1回転させて最下点の最小値＝内接円、
 *      最大値＝足先）。build.ts の driveSupportRadius を読まないので、
 *      hullLift を 0 に潰すとここが落ちる。
 *      ⚠ [B][C] は物理と描画が「一緒に」ずれる改変（build.ts の共有式の破壊）を
 *      検出できない。[E] はその穴を埋めるためにある。
 *
 *   npx tsx src/arena/sim/levelSelftest.ts
 */
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { buildCatalog } from "../parts/catalog";
import { botMountGeometry, mountPartObject } from "../render/mounting";
import { assembleBot, type RuntimePart } from "./assemble";
import { computeStats, validateBuild } from "./build";
import { initPhysics } from "./world";
import type {
  BotSpec,
  Catalog,
  ChassisDef,
  DriveDef,
  PartDef,
  PlacedPart,
  RiserDef,
  RoomSettings
} from "./types";

// Node-only gate script (same shim as buildSelftest.ts / driveSelftest.ts).
declare const process: { exitCode?: number };

const SETTINGS: RoomSettings = { pointBudget: 1500, arenaId: "the-box", matchSec: 180 };

/*
 * Deliberately not the origin and not axis aligned. At (0,0,0) with facing 0
 * both transforms collapse to "add the local offset" and [B] would compare two
 * identical additions; here Rapier composes body pose x collider local while
 * three.js composes group matrix x child matrix, which is the disagreement the
 * side wheels (5 cm high, 7 cm outboard) actually shipped as.
 */
const ORIGIN: readonly [number, number, number] = [1.3, 0.4, -2.1];
const FACING = 0.7;

/** 3D 距離で ±1mm。y だけでなく x/z のずれも同じ物差しで見る。 */
const MOUNT_TOL_M = 1e-3;
/** 段の積み上げは同じ剛体の上の話なので、f32 の読み戻し誤差ぶんだけ許す。 */
const STACK_TOL_M = 1e-5;
const JAPANESE = /[぀-ヿ一-鿿]/;

const failures: string[] = [];
const check = (label: string, ok: boolean, detail: string): void => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label} — ${detail}`);
  if (!ok) failures.push(label);
};

const CHASSIS_ID = "chassis-pagoda";
const LEG_ID = "leg-crab";
/** 0段目 3x3 rise 0.18 */
const RISER_A_ID = "riser-armored";
/** 1段目 2x2 rise 0.10 — A とわざと違う高さにする */
const RISER_B_ID = "riser-light";
/** 別の rise を持つ支柱。H6（同一段の rise 混在）を作るためだけに使う */
const RISER_C_ID = "riser-post";
const PLATE_ID = "plate-steel";
const CAP_ID = "plate-nose";

const LEGS: readonly PlacedPart[] = [
  { partId: LEG_ID, face: "underside", cell: [0, 2], rot: 0 },
  { partId: LEG_ID, face: "underside", cell: [7, 2], rot: 0 }
];

/*
 * 2段機。deck は 9x9。
 *   level 0: 装甲支柱 3x3 @ (1,3) -> x1-3 z3-5 ／ 3x3 @ (5,3) -> x5-7 z3-5
 *   level 1: 軽量支柱 2x2 @ (1,3) -> x1-2 z3-4  （左の支柱の上・H4 OK）
 *            鋼板    3x2 @ (5,3) -> x5-7 z3-4  （右の支柱の上・H4 OK）
 *   level 2: ノーズキャップ 2x2 @ (1,3)        （軽量支柱の上・H4 OK）
 * 1段目にも2段目にもパーツがあるので、[B] は両方の段で測れる。
 */
const TOWER: BotSpec = {
  v: 3,
  name: "G-HEIGHT 二段機",
  chassisId: CHASSIS_ID,
  paint: 0x2f6f4f,
  parts: [
    ...LEGS,
    { partId: RISER_A_ID, face: "deck", cell: [1, 3], rot: 0, level: 0 },
    { partId: RISER_A_ID, face: "deck", cell: [5, 3], rot: 0, level: 0 },
    { partId: RISER_B_ID, face: "deck", cell: [1, 3], rot: 0, level: 1 },
    { partId: PLATE_ID, face: "deck", cell: [5, 3], rot: 0, level: 1 },
    { partId: CAP_ID, face: "deck", cell: [1, 3], rot: 0, level: 2 }
  ]
};

const withExtra = (name: string, extra: PlacedPart): BotSpec => ({
  ...TOWER,
  name,
  parts: [...TOWER.parts, extra]
});

/** H6 専用。上に何も載せないので、出るエラーは rise 混在の1件だけになる。 */
const MIXED_RISE: BotSpec = {
  v: 3,
  name: "G-HEIGHT 混在段",
  chassisId: CHASSIS_ID,
  paint: 0x2f6f4f,
  parts: [
    ...LEGS,
    { partId: RISER_A_ID, face: "deck", cell: [1, 3], rot: 0, level: 0 },
    { partId: RISER_C_ID, face: "deck", cell: [5, 3], rot: 0, level: 0 }
  ]
};

/** [D] の対。支柱1本ぶんだけ違う。駆動が同一なので trackWidth は動かない。 */
const ONE_STOREY: BotSpec = {
  v: 3,
  name: "G-HEIGHT 一段機",
  chassisId: CHASSIS_ID,
  paint: 0x2f6f4f,
  parts: [
    ...LEGS,
    { partId: RISER_A_ID, face: "deck", cell: [1, 3], rot: 0, level: 0 },
    { partId: CAP_ID, face: "deck", cell: [1, 3], rot: 0, level: 1 }
  ]
};
const TWO_STOREY: BotSpec = {
  ...ONE_STOREY,
  name: "G-HEIGHT 二段機（比較用）",
  parts: [
    ...LEGS,
    { partId: RISER_A_ID, face: "deck", cell: [1, 3], rot: 0, level: 0 },
    { partId: RISER_B_ID, face: "deck", cell: [1, 3], rot: 0, level: 1 },
    { partId: CAP_ID, face: "deck", cell: [1, 3], rot: 0, level: 2 }
  ]
};

/*
 * A mass-matched pair. TWO_STOREY above adds a riser, and a riser has mass and
 * sits at a height, so comHeight rises whether or not computeStats respects
 * storeys at all — the direction check passes on the extra mass alone.
 *
 * These two carry the IDENTICAL multiset of parts. The only difference is that
 * the cap sits on the riser in one and beside it on the hull deck in the other,
 * so the whole comHeight difference has to come from the storey, and its size
 * is predictable: capMass * rise / totalMass.
 */
const CAP_ON_DECK: BotSpec = {
  v: 3,
  name: "G-HEIGHT 質量同一・平置き",
  chassisId: CHASSIS_ID,
  paint: 0x2f6f4f,
  parts: [
    ...LEGS,
    { partId: RISER_A_ID, face: "deck", cell: [1, 3], rot: 0, level: 0 },
    { partId: CAP_ID, face: "deck", cell: [5, 3], rot: 0, level: 0 }
  ]
};
const CAP_ON_RISER: BotSpec = {
  ...CAP_ON_DECK,
  name: "G-HEIGHT 質量同一・段上",
  parts: [
    ...LEGS,
    { partId: RISER_A_ID, face: "deck", cell: [1, 3], rot: 0, level: 0 },
    { partId: CAP_ID, face: "deck", cell: [1, 3], rot: 0, level: 1 }
  ]
};

const mm = (metres: number): string => `${(metres * 1000).toFixed(4)}mm`;

const main = async (): Promise<void> => {
  await initPhysics();
  const catalog: Catalog = buildCatalog();
  const lookup = <T extends PartDef>(id: string): T => {
    const part = catalog.byId.get(id);
    if (!part) throw new Error(`G-HEIGHT: カタログに「${id}」がありません。`);
    return part as T;
  };
  const chassisDef = lookup<ChassisDef>(CHASSIS_ID);
  const riserA = lookup<RiserDef>(RISER_A_ID);
  const riserB = lookup<RiserDef>(RISER_B_ID);
  const legDef = lookup<DriveDef>(LEG_ID);

  console.log(
    `シャーシ「${chassisDef.nameJa}」 deck ${chassisDef.deck.join("x")} maxLevels ${chassisDef.maxLevels}` +
    ` / 支柱 ${riserA.nameJa} rise ${riserA.rise}m ＋ ${riserB.nameJa} rise ${riserB.rise}m` +
    ` / 脚 ${legDef.nameJa} radius ${legDef.radius}m feet ${legDef.feet}`
  );
  // Two identical rises would let "read rises[1] twice" pass; refuse to run.
  if (Math.abs(riserA.rise - riserB.rise) < 1e-6) {
    throw new Error("G-HEIGHT: 1段目と2段目の rise が同じでは段落ちバグを検出できません。");
  }

  /* ---------------------------------------------------------------- */
  /* [A] 契約違反の日本語エラー                                        */
  /* ---------------------------------------------------------------- */
  const control = validateBuild(TOWER, catalog, SETTINGS);
  check(
    "[A0] 合法な2段機は通る（違反検査が空振りでないことの担保）",
    control.ok && control.errors.length === 0,
    `errors=${control.errors.length} ${JSON.stringify(control.errors)} / cost ${control.stats.cost} <= ${SETTINGS.pointBudget}`
  );

  /*
   * 一致条件はどれも「契約が入れろと言っている中身」だけで書く:
   * パーツ名・段数に加えて、H1 は取り付け面、H4 は足りない支柱、
   * H5 はシャーシ名（＝上限の出所）、H6 は衝突している2本の支柱名。
   * これが無いと、たとえば H5 の分岐を消して H4 に落ちた機体でも
   * 「名前＋N段目」だけは揃ってしまい、ゲートが素通りする。
   */
  const violation = (
    label: string,
    spec: BotSpec,
    needles: readonly string[]
  ): void => {
    const result = validateBuild(spec, catalog, SETTINGS);
    const hits = result.errors.filter((error) =>
      needles.every((needle) => error.includes(needle))
    );
    const japanese = hits.every((error) => JAPANESE.test(error));
    check(
      label,
      !result.ok && result.errors.length === 1 && hits.length === 1 && japanese,
      `errors=${result.errors.length} 条件一致=${hits.length} 日本語=${japanese}` +
      ` 必須語=${JSON.stringify(needles)} :: ${JSON.stringify(result.errors)}`
    );
  };

  violation(
    "[A1] H1 垂直面の level>0 を弾く（面・パーツ名・段数入り）",
    withExtra("H1違反", { partId: PLATE_ID, face: "left", cell: [0, 0], rot: 0, level: 1 }),
    ["鋼板", "1段目", "左側面"]
  );
  violation(
    "[A2] H4 宙に浮いた段を弾く（パーツ名・段数・支柱の不在）",
    withExtra("H4違反", { partId: CAP_ID, face: "deck", cell: [7, 7], rot: 0, level: 1 }),
    ["ノーズキャップ", "1段目", "支柱"]
  );
  violation(
    "[A3] H5 maxLevels 超過を弾く（パーツ名・段数・シャーシ名）",
    withExtra("H5違反", { partId: CAP_ID, face: "deck", cell: [1, 3], rot: 0, level: 3 }),
    ["ノーズキャップ", "3段目", chassisDef.nameJa]
  );
  violation(
    "[A4] H6 同一段の rise 混在を弾く（段数・混在した支柱名2本）",
    MIXED_RISE,
    ["0段目", riserA.nameJa, lookup<RiserDef>(RISER_C_ID).nameJa]
  );

  /* ---------------------------------------------------------------- */
  /* [D] H7 高さの代償                                                 */
  /* ---------------------------------------------------------------- */
  const low = validateBuild(ONE_STOREY, catalog, SETTINGS);
  const high = validateBuild(TWO_STOREY, catalog, SETTINGS);
  const lowStats = computeStats(ONE_STOREY, catalog, SETTINGS);
  const highStats = computeStats(TWO_STOREY, catalog, SETTINGS);
  check(
    "[D0] 比較に使う一段機・二段機がどちらも合法",
    low.ok && high.ok,
    `一段機 errors=${JSON.stringify(low.errors)} / 二段機 errors=${JSON.stringify(high.errors)}`
  );
  check(
    "[D1] 支柱を1段足すと comHeight が上がる",
    highStats.comHeight > lowStats.comHeight,
    `一段 ${lowStats.comHeight.toFixed(5)}m -> 二段 ${highStats.comHeight.toFixed(5)}m` +
    ` （差 ${((highStats.comHeight - lowStats.comHeight) * 1000).toFixed(2)}mm）`
  );
  /*
   * The quantitative arm. Same parts, same total mass, one of them a storey
   * higher: the centre of mass must move by exactly that part's share of the
   * rise. If computeStats ignored the storey the difference would be 0, and if
   * it applied it to the wrong part the magnitude would be wrong.
   */
  const flatStats = computeStats(CAP_ON_DECK, catalog, SETTINGS);
  const raisedStats = computeStats(CAP_ON_RISER, catalog, SETTINGS);
  const capPart = lookup<PartDef>(CAP_ID);
  const riserPart = lookup<PartDef>(RISER_A_ID);
  const rise = riserPart.category === "structure" ? riserPart.rise : NaN;
  const predicted = (capPart.mass * rise) / raisedStats.mass;
  const observed = raisedStats.comHeight - flatStats.comHeight;
  check(
    "[D0b] 質量同一の対になっている（質量差が comHeight を動かしていない）",
    Math.abs(raisedStats.mass - flatStats.mass) < 1e-9 &&
      validateBuild(CAP_ON_DECK, catalog, SETTINGS).ok &&
      validateBuild(CAP_ON_RISER, catalog, SETTINGS).ok,
    `平置き ${flatStats.mass.toFixed(6)}kg / 段上 ${raisedStats.mass.toFixed(6)}kg`
  );
  check(
    "[D3] 段だけを1段上げた分の comHeight 変化が理論値と一致（段の高さを無視していたら 0 になる）",
    Number.isFinite(predicted) && Math.abs(observed - predicted) < 1e-6 && predicted > 1e-4,
    `理論 ${(predicted * 1000).toFixed(4)}mm（cap ${capPart.mass}kg × rise ${(rise * 1000).toFixed(0)}mm ÷ 総質量 ${raisedStats.mass.toFixed(3)}kg）` +
    ` / 実測 ${(observed * 1000).toFixed(4)}mm / 差 ${((observed - predicted) * 1000).toFixed(6)}mm`
  );
  check(
    "[D2] 支柱を1段足すと stability が下がる",
    highStats.stability < lowStats.stability &&
      Math.abs(highStats.trackWidth - lowStats.trackWidth) < 1e-9,
    `一段 ${lowStats.stability.toFixed(5)} -> 二段 ${highStats.stability.toFixed(5)}` +
    ` / trackWidth 一段 ${lowStats.trackWidth.toFixed(5)}m 二段 ${highStats.trackWidth.toFixed(5)}m（駆動は同一なので不変であるべき）`
  );

  /* ---------------------------------------------------------------- */
  /* 2段機を実際に組む                                                 */
  /* ---------------------------------------------------------------- */
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const bot = assembleBot(world, TOWER, catalog, 0, ORIGIN, FACING);
  const runtimeByIdx = new Map<number, RuntimePart>(
    bot.parts.map((part) => [part.idx, part])
  );

  // 描画側。剛体の姿勢を root に載せ、パーツは mountPartObject に任せる。
  // ⚠ 第6引数 botMountGeometry を渡さないと段もハルの持ち上げも 0 になる。
  const root = new THREE.Group();
  const bodyT = bot.chassis.translation();
  const bodyR = bot.chassis.rotation();
  root.position.set(bodyT.x, bodyT.y, bodyT.z);
  root.quaternion.set(bodyR.x, bodyR.y, bodyR.z, bodyR.w);
  const geometry = botMountGeometry(TOWER, catalog);
  const drawn = new Map<number, THREE.Object3D>();
  TOWER.parts.forEach((placed, idx) => {
    const part = catalog.byId.get(placed.partId);
    if (!part || part.category === "chassis") return;
    const object = new THREE.Object3D();
    mountPartObject(object, chassisDef, part, placed, 0, geometry);
    root.add(object);
    drawn.set(idx, object);
  });
  root.updateMatrixWorld(true);

  /* ---------------------------------------------------------------- */
  /* [B] 物理位置 vs 描画位置                                          */
  /* ---------------------------------------------------------------- */
  /*
   * 比較点は「取り付け面そのもの」。mountPartObject は法線方向に -height/2
   * 戻した位置に Object3D の原点を置くので、上面のパーツなら原点＝底面。
   * 物理側の底面は Rapier のコライダー中心から、Rapier が持っている
   * halfExtents ぶんだけ、Rapier が持っている姿勢の -Y 方向へ降ろして作る。
   * 駆動だけは例外で、剛体そのものが車軸なので車軸中心どうしを比べる。
   */
  const rows: Record<string, unknown>[] = [];
  let worstMountErr = 0;
  let worstMountLabel = "";
  for (const [idx, placed] of TOWER.parts.entries()) {
    const part = catalog.byId.get(placed.partId);
    const runtime = runtimeByIdx.get(idx);
    const object = drawn.get(idx);
    if (!part || !runtime || !object) continue;

    const physics = new THREE.Vector3();
    if (part.category === "drive") {
      const axle = runtime.body.translation();
      physics.set(axle.x, axle.y, axle.z);
    } else {
      const centre = runtime.collider.translation();
      const half = runtime.collider.halfExtents();
      const rotation = runtime.collider.rotation();
      physics
        .set(centre.x, centre.y, centre.z)
        .add(
          new THREE.Vector3(0, -half.y, 0).applyQuaternion(
            new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w)
          )
        );
    }
    const render = object.getWorldPosition(new THREE.Vector3());
    const errorM = render.distanceTo(physics);
    if (errorM > worstMountErr) {
      worstMountErr = errorM;
      worstMountLabel = `${part.nameJa}(level ${placed.level ?? 0})`;
    }
    rows.push({
      part: part.nameJa,
      face: placed.face,
      level: placed.level ?? 0,
      physicsY: +physics.y.toFixed(6),
      renderY: +render.y.toFixed(6),
      dyMm: +((render.y - physics.y) * 1000).toFixed(4),
      d3Mm: +(errorM * 1000).toFixed(4)
    });
  }
  console.log(JSON.stringify(rows, null, 2));

  const levelsSeen = new Set(
    TOWER.parts
      .filter((placed) => placed.face === "deck")
      .map((placed) => placed.level ?? 0)
  );
  check(
    "[B0] 2段以上を実際に積んでいる（1段しか無い機体では段落ちを検出できない）",
    levelsSeen.has(1) && levelsSeen.has(2),
    `deck に載っている段 = [${[...levelsSeen].sort().join(", ")}]`
  );
  /*
   * Without this, [B1] is vacuous: the comparison loop skips any part it
   * cannot find a body for, and if it skipped every one the worst error would
   * still be 0 and the arm would pass. A gate has to say how much it looked at.
   */
  check(
    "[B1a] 物理と描画を突き合わせた点数が、機体のパーツ数と一致（1点も飛ばしていない）",
    rows.length === TOWER.parts.length && rows.length > 0,
    `比較した点数 ${rows.length} / 機体のパーツ ${TOWER.parts.length}`
  );
  const levelsCompared = new Set(rows.map((row) => row.level));
  check(
    "[B1b] 比較が 0/1/2 段すべてに及んでいる",
    levelsCompared.has(0) && levelsCompared.has(1) && levelsCompared.has(2),
    `比較に現れた段 = [${[...levelsCompared].sort().join(", ")}]`
  );
  check(
    `[B1] 物理と描画が全パーツ ±${MOUNT_TOL_M * 1000}mm 以内`,
    worstMountErr < MOUNT_TOL_M,
    `最悪 ${mm(worstMountErr)} @ ${worstMountLabel}（${rows.length}点・ORIGIN=${JSON.stringify(ORIGIN)} FACING=${FACING}rad）`
  );

  /* ---------------------------------------------------------------- */
  /* [C] 支柱の天面＝次の段の基準面                                     */
  /* ---------------------------------------------------------------- */
  const deckHalf = bot.chassisCollider.halfExtents();
  const deckTop = bot.chassisCollider.translation().y + deckHalf.y;

  const bottomsAtLevel = (level: number): number[] =>
    TOWER.parts
      .map((placed, idx) => ({ placed, runtime: runtimeByIdx.get(idx) }))
      .filter(
        (entry) =>
          entry.placed.face === "deck" &&
          (entry.placed.level ?? 0) === level &&
          entry.runtime !== undefined
      )
      .map((entry) => {
        const collider = entry.runtime!.collider;
        return collider.translation().y - collider.halfExtents().y;
      });

  const topOfRiser = (level: number): number => {
    const entry = TOWER.parts
      .map((placed, idx) => ({ placed, runtime: runtimeByIdx.get(idx) }))
      .find(
        (candidate) =>
          candidate.placed.face === "deck" &&
          (candidate.placed.level ?? 0) === level &&
          catalog.byId.get(candidate.placed.partId)?.category === "structure"
      );
    if (!entry?.runtime) throw new Error(`G-HEIGHT: ${level}段目に支柱がありません。`);
    const collider = entry.runtime.collider;
    return collider.translation().y + collider.halfExtents().y;
  };

  const base0 = Math.min(...bottomsAtLevel(0));
  const base1 = Math.min(...bottomsAtLevel(1));
  const base2 = Math.min(...bottomsAtLevel(2));
  const spread1 = Math.max(...bottomsAtLevel(1)) - base1;
  const top0 = topOfRiser(0);
  const top1 = topOfRiser(1);

  console.log(
    JSON.stringify(
      {
        船体デッキ天面: +deckTop.toFixed(6),
        "0段目の底面": +base0.toFixed(6),
        "0段目の支柱天面": +top0.toFixed(6),
        "1段目の底面": +base1.toFixed(6),
        "1段目の底面のばらつき": +spread1.toFixed(9),
        "1段目の支柱天面": +top1.toFixed(6),
        "2段目の底面": +base2.toFixed(6),
        "実測 rise 0->1": +(base1 - base0).toFixed(6),
        "カタログ rise 0->1": riserA.rise,
        "実測 rise 1->2": +(base2 - base1).toFixed(6),
        "カタログ rise 1->2": riserB.rise
      },
      null,
      2
    )
  );

  check(
    "[C0] 0段目の基準面が船体デッキの天面",
    Math.abs(base0 - deckTop) < STACK_TOL_M,
    `0段目底面 ${base0.toFixed(6)}m / デッキ天面 ${deckTop.toFixed(6)}m / 差 ${mm(base0 - deckTop)}`
  );
  check(
    "[C1] 0段目の支柱の天面がちょうど1段目の基準面",
    Math.abs(top0 - base1) < STACK_TOL_M && spread1 < STACK_TOL_M,
    `支柱天面 ${top0.toFixed(6)}m / 1段目底面 ${base1.toFixed(6)}m / 差 ${mm(top0 - base1)}` +
    ` / 1段目の複数パーツの高さのばらつき ${mm(spread1)}`
  );
  check(
    "[C2] 1段目の支柱の天面がちょうど2段目の基準面",
    Math.abs(top1 - base2) < STACK_TOL_M,
    `支柱天面 ${top1.toFixed(6)}m / 2段目底面 ${base2.toFixed(6)}m / 差 ${mm(top1 - base2)}`
  );
  check(
    "[C3] 段の上がり幅がカタログの rise と一致（2段目を落とすとここが落ちる）",
    Math.abs(base1 - base0 - riserA.rise) < STACK_TOL_M &&
      Math.abs(base2 - base1 - riserB.rise) < STACK_TOL_M,
    `0->1 実測 ${(base1 - base0).toFixed(6)}m / 契約 ${riserA.rise}m ・` +
    ` 1->2 実測 ${(base2 - base1).toFixed(6)}m / 契約 ${riserB.rise}m`
  );

  /* ---------------------------------------------------------------- */
  /* [E] ハルの持ち上げ vs 脚の実測の沈み込み                           */
  /* ---------------------------------------------------------------- */
  /*
   * 星形の脚を車軸まわりに1回転させ、各位相での最下点までの深さを測る。
   * 最大＝足先（＝外形半径）、最小＝足と足の間で保証される支え（内接円）。
   * その差が「1回転のうちに車軸が沈みうる量」で、ハルはそれ以上持ち上がって
   * いなければ腹を擦る。カプセルの位置・姿勢・寸法は全部 Rapier から読むので、
   * build.ts の driveSupportRadius / hullLift の式は一度も参照していない。
   */
  const leg = bot.drives[0];
  if (!leg) throw new Error("G-HEIGHT: 脚駆動が組み上がっていません。");
  const capsules = [leg.collider, ...(leg.legColliders ?? [])];
  const ends: THREE.Vector3[] = [];
  let capsuleRadius = 0;
  for (const capsule of capsules) {
    const local = capsule.translationWrtParent();
    const rotation = capsule.rotationWrtParent();
    // Null only for a collider with no parent body; a spoke always has one, and
    // if that ever stops being true the gate must say so rather than guess 0.
    if (!local || !rotation) {
      throw new Error("G-HEIGHT: 脚のカプセルが剛体に付いていません。");
    }
    const axis = new THREE.Vector3(0, capsule.halfHeight(), 0).applyQuaternion(
      new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w)
    );
    const centre = new THREE.Vector3(local.x, local.y, local.z);
    ends.push(centre.clone().add(axis), centre.clone().sub(axis));
    capsuleRadius = Math.max(capsuleRadius, capsule.radius());
  }
  let inscribed = Number.POSITIVE_INFINITY;
  let tip = 0;
  const SAMPLES = 3600;
  for (let step = 0; step < SAMPLES; step += 1) {
    const phi = (2 * Math.PI * step) / SAMPLES;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    let lowest = Number.POSITIVE_INFINITY;
    for (const end of ends) lowest = Math.min(lowest, end.y * cos - end.z * sin);
    const depth = -(lowest - capsuleRadius);
    inscribed = Math.min(inscribed, depth);
    tip = Math.max(tip, depth);
  }
  const sink = tip - inscribed;
  const hullBottomLocal =
    bot.chassisCollider.translation().y - deckHalf.y - ORIGIN[1];
  const measuredLift = hullBottomLocal - chassisDef.groundClearance;
  console.log(
    JSON.stringify(
      {
        脚: leg.def.nameJa,
        カプセル本数: capsules.length,
        "足先（実測）": +tip.toFixed(6),
        "def.radius": leg.def.radius,
        "内接円（実測）": +inscribed.toFixed(6),
        沈み込み: +sink.toFixed(6),
        ハルの持ち上げ実測: +measuredLift.toFixed(6),
        持ち上げ倍率: +(sink > 0 ? measuredLift / sink : 0).toFixed(4)
      },
      null,
      2
    )
  );
  check(
    "[E0] 脚が実際に断続接地している（沈み込み > 1mm。ここが 0 だと [E1] が空振り）",
    sink > 1e-3,
    `足先 ${tip.toFixed(6)}m / 内接円 ${inscribed.toFixed(6)}m / 沈み込み ${mm(sink)}`
  );
  check(
    "[E1] ハルが脚の沈み込み以上に持ち上がっている（hullLift を 0 に潰すと落ちる）",
    measuredLift + 1e-6 >= sink && measuredLift <= sink * 3,
    `持ち上げ ${measuredLift.toFixed(6)}m / 必要 ${sink.toFixed(6)}m 以上・${(sink * 3).toFixed(6)}m 以下` +
    ` / 倍率 ${(sink > 0 ? measuredLift / sink : 0).toFixed(4)}`
  );

  world.free();

  console.log(
    failures.length === 0
      ? "\nLEVEL SELFTEST PASS"
      : `\nLEVEL SELFTEST FAIL — ${failures.join(" / ")}`
  );
  if (failures.length > 0) process.exitCode = 1;
};

main().catch((error) => {
  console.error("LEVEL SELFTEST FAIL:", error);
  process.exitCode = 1;
});
