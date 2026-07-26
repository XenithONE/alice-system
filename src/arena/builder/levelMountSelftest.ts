/*
 * ビルダーの段（storey）が「一つの数字」であることの恒久ゲート。
 *
 * 検査するのは1点だけ: ビルダーが画面に出す高さが、build.ts の
 * levelRises() / riseForLevel() / partLocalPosition(第6引数) から来ていること。
 * このプロジェクトが繰り返し踏んだ事故（横付けタイヤが5cm上・7cm外、ベルトの裏返り、
 * 罠の判定半径と描画半径が別数値）は全部「同じ事実を2箇所で計算した」なので、
 * 段でも同じことをしていないかを数値で確かめる。
 *
 * ⚠ このゲートは「落ちうる」ことに意味がある。mountPlaced から段の補正を外すか、
 * mounting.ts が段を二重に足せば [B] と [D] が落ちる。
 *
 *   npx tsx src/arena/builder/levelMountSelftest.ts
 */
import * as THREE from "three";
import { mountPlaced } from "./builderScene";
import { levelRises, partLocalPosition, riseForLevel } from "../sim/build";
import { partLevelRise } from "../render/mounting";
import type {
  ArmorDef,
  BotSpec,
  Catalog,
  ChassisDef,
  PartDef,
  RiserDef
} from "../sim/types";

const chassis: ChassisDef = {
  id: "selftest-frame", type: "frame", faces: ["deck"], name: "Selftest Frame", nameJa: "検査台",
  category: "chassis", cost: 100, mass: 40, hp: 400, armor: 2,
  cells: [5, 4], deck: [5, 4], groundClearance: 0.06, height: 0.1, heightCells: 2,
  invertible: false, maxLevels: 3, internalGrid: [3, 2],
  stockPowerKw: 8, stockAlternatorKw: 2, stockChargeKj: 40, stockFuelL: 0, stockCoolingKw: 6,
  material: "steel", color: 0x808080, blurb: "検査用"
};
const riser: RiserDef = {
  id: "selftest-riser", type: "riser", faces: ["deck"], name: "Selftest Riser", nameJa: "検査支柱",
  category: "structure", cost: 20, mass: 6, hp: 90, armor: 1,
  cells: [2, 2], height: 0.18, rise: 0.18,
  material: "steel", color: 0x666666, blurb: "検査用"
};
const plate: ArmorDef = {
  id: "selftest-plate", type: "plate", faces: ["deck"], name: "Selftest Plate", nameJa: "検査装甲",
  category: "armor", cost: 30, mass: 9, hp: 200, armor: 6,
  cells: [2, 2], height: 0.04,
  material: "hardox", color: 0x999999, blurb: "検査用"
};

const parts: PartDef[] = [chassis, riser, plate];
const catalog: Catalog = { parts, presets: [], byId: new Map(parts.map((part) => [part.id, part])) };
const spec: BotSpec = {
  v: 3, name: "多段検査", chassisId: chassis.id, paint: 0xc91a09,
  parts: [
    { partId: riser.id, face: "deck", cell: [1, 1], rot: 0 },
    { partId: plate.id, face: "deck", cell: [1, 1], rot: 0, level: 1 }
  ]
};

declare const process: { exitCode?: number };

const failures: string[] = [];
const check = (label: string, ok: boolean, detail: string): void => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label} — ${detail}`);
  if (!ok) failures.push(label);
};

const rises = levelRises(spec, catalog);
const deckY = chassis.groundClearance + chassis.height;
console.log(`levelRises = [${rises.map((value) => value.toFixed(3)).join(", ")}]  船体デッキ y = ${deckY.toFixed(4)} m`);

/*
 * mountPartObject は取り付け法線方向に -height/2 だけ戻すので、置かれた Object3D の
 * 原点は「パーツの中心」ではなく「取り付け面そのもの」に来る（createIndustrialPart が
 * 原点から上に積む造形だから）。つまり deck 面では position.y がそのパーツの底面。
 */
const riserObject = new THREE.Object3D();
mountPlaced(riserObject, chassis, riser, spec.parts[0]!, { rises, hullLift: 0 });
const riserBottom = riserObject.position.y;
const riserTop = riserBottom + riser.height;

const plateObject = new THREE.Object3D();
mountPlaced(plateObject, chassis, plate, spec.parts[1]!, { rises, hullLift: 0 });
const plateBottom = plateObject.position.y;

check(
  "[A] 支柱の底面が船体デッキ・天面が船体デッキ + rise",
  Math.abs(riserBottom - deckY) < 1e-9 && Math.abs(riserTop - (deckY + riser.rise)) < 1e-9,
  `底面 ${riserBottom.toFixed(4)} m / 天面 ${riserTop.toFixed(4)} m / 期待天面 ${(deckY + riser.rise).toFixed(4)} m`
);
check(
  "[B] 1段目のパーツが支柱の天面にちょうど乗る",
  Math.abs(plateBottom - riserTop) < 1e-9,
  `1段目の底面 ${plateBottom.toFixed(4)} m / 隙間 ${(plateBottom - riserTop).toExponential(2)} m（0 でなければ浮くか刺さる）`
);

const flat = new THREE.Object3D();
mountPlaced(flat, chassis, plate, { ...spec.parts[1]!, level: 0 }, { rises, hullLift: 0 });
const applied = plateObject.position.y - flat.position.y;
const viaFormula =
  partLocalPosition(chassis, plate, [1, 1], 0, "deck", { levelRise: riseForLevel(rises, 1) })[1]
  - partLocalPosition(chassis, plate, [1, 1], 0, "deck", {})[1];
check(
  "[C] 段の効き幅が partLocalPosition の第6引数と一致",
  Math.abs(applied - viaFormula) < 1e-9 && Math.abs(applied - riser.rise) < 1e-9,
  `mountPlaced ${applied.toFixed(4)} m / partLocalPosition ${viaFormula.toFixed(4)} m / rise ${riser.rise} m`
);

const twice = new THREE.Object3D();
mountPlaced(twice, chassis, plate, spec.parts[1]!, { rises, hullLift: 0 });
mountPlaced(twice, chassis, plate, spec.parts[1]!, { rises, hullLift: 0 });
check(
  // ホバー中は毎フレーム置き直すので、呼ぶたびに積み上がると幽霊が空へ登っていく。
  "[D] 何度置き直しても同じ高さ（呼び出しが累積しない）",
  Math.abs(twice.position.y - plateObject.position.y) < 1e-9,
  `2回置き ${twice.position.y.toFixed(4)} m / 1回置き ${plateObject.position.y.toFixed(4)} m`
);

const sideways: BotSpec["parts"][number] = { partId: plate.id, face: "left", cell: [1, 0], rot: 0, level: 1 };
check(
  "[E] 上面以外は level を持っていても段が付かない（H1）",
  partLevelRise(rises, sideways) === 0,
  `左側面 level 1 の rise = ${partLevelRise(rises, sideways)} m / 上面 level 1 の rise = ${partLevelRise(rises, spec.parts[1]!)} m`
);

console.log(failures.length === 0
  ? "\nLEVEL MOUNT SELFTEST PASS"
  : `\nLEVEL MOUNT SELFTEST FAIL — ${failures.join(" / ")}`);
if (failures.length > 0) process.exitCode = 1;
