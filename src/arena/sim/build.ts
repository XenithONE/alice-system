import { IMPACT_SCALE } from "./balance";
import {
  CELL,
  type BotSpec,
  type BuildStats,
  type BuildValidation,
  type Catalog,
  type ChassisDef,
  type MountFace,
  type PartDef,
  type RoomSettings,
  type Rot4
} from "./types";

const VALID_FACES: readonly MountFace[] = [
  "deck",
  "underside",
  "left",
  "right",
  "front",
  "rear"
];

export function occupiedCells(
  part: PartDef,
  cell: readonly [number, number],
  rot: Rot4
): [number, number][] {
  const [baseW, baseD] = part.cells;
  const w = rot === 1 || rot === 3 ? baseD : baseW;
  const d = rot === 1 || rot === 3 ? baseW : baseD;
  const result: [number, number][] = [];
  for (let z = 0; z < d; z += 1) {
    for (let x = 0; x < w; x += 1) result.push([cell[0] + x, cell[1] + z]);
  }
  return result;
}

function chassisFor(spec: BotSpec, catalog: Catalog): ChassisDef | null {
  const part = catalog.byId.get(spec.chassisId);
  return part?.category === "chassis" ? part : null;
}

export function computeStats(
  spec: BotSpec,
  catalog: Catalog,
  settings: RoomSettings
): BuildStats {
  const chassis = chassisFor(spec, catalog);
  let cost = chassis?.cost ?? 0;
  let mass = chassis?.mass ?? 0;
  let hp = chassis?.hp ?? 0;
  let armor = chassis?.armor ?? 0;
  let driveCount = 0;
  let topSpeed = Number.POSITIVE_INFINITY;
  let baseTorque = 0;
  let powerMul = 1;
  let hitPower = 0;
  let sustainedDps = 0;
  let primaryId: string | null = null;
  let secondaryId: string | null = null;
  let tertiaryId: string | null = null;
  let hasSelfRight = false;

  for (const placed of spec.parts) {
    const part = catalog.byId.get(placed.partId);
    if (!part || part.category === "chassis") continue;
    cost += part.cost;
    mass += part.mass;
    hp += part.hp;
    armor += part.armor;
    if (part.category === "drive") {
      driveCount += 1;
      topSpeed = Math.min(topSpeed, part.maxOmega * part.radius);
      baseTorque += part.torque;
    } else if (part.category === "weapon") {
      if (part.slot === "primary") primaryId ??= part.id;
      else if (part.slot === "secondary") secondaryId ??= part.id;
      else tertiaryId ??= part.id;
      hitPower = Math.max(hitPower, part.mass * part.damageMul * IMPACT_SCALE);
      if (part.effect === "grind" || part.effect === "clamp" || part.effect === "flame") {
        sustainedDps += part.dps ?? 0;
      }
    } else if (part.category === "utility") {
      powerMul *= part.powerMul ?? 1;
      hasSelfRight ||= part.selfRight === true;
    }
  }

  return {
    cost,
    pointBudget: settings.pointBudget,
    mass,
    hp,
    armor,
    topSpeed: Number.isFinite(topSpeed) ? topSpeed : 0,
    torque: baseTorque * powerMul,
    hitPower,
    sustainedDps,
    driveCount,
    primaryId,
    secondaryId,
    tertiaryId,
    hasSelfRight,
    invertible: chassis?.invertible ?? false
  };
}

export function validateBuild(
  spec: BotSpec,
  catalog: Catalog,
  settings: RoomSettings
): BuildValidation {
  const errors: string[] = [];
  const stats = computeStats(spec, catalog, settings);
  const chassis = chassisFor(spec, catalog);
  if (!chassis) errors.push("有効なシャーシが必要です。");
  if (spec.v !== 3) errors.push("未対応の機体データ形式です。");

  let weaponCount = 0;
  let primaryCount = 0;
  let secondaryCount = 0;
  let tertiaryCount = 0;
  let leftDrive = 0;
  let rightDrive = 0;
  const occupied = new Set<string>();
  const faceSize = (face: MountFace): readonly [number, number] => {
    if (!chassis) return [0, 0];
    if (face === "deck" || face === "underside") return chassis.deck;
    if (face === "left" || face === "right") return [chassis.deck[1], chassis.heightCells];
    return [chassis.deck[0], chassis.heightCells];
  };

  for (const [partIdx, placed] of spec.parts.entries()) {
    const part = catalog.byId.get(placed.partId);
    if (!part) {
      errors.push(`パーツ${partIdx + 1}「${placed.partId}」がカタログにありません。`);
      continue;
    }
    if (part.category === "chassis") {
      errors.push(`パーツ${partIdx + 1}にシャーシを重ねて配置できません。`);
      continue;
    }
    if (!VALID_FACES.includes(placed.face)) {
      errors.push(`パーツ${partIdx + 1}の取り付け面が不正です。`);
      continue;
    }
    if (!part.faces.includes(placed.face)) {
      errors.push(`「${part.nameJa}」は${faceLabel(placed.face)}に取り付けできません。`);
      continue;
    }
    if (!Number.isInteger(placed.cell[0]) || !Number.isInteger(placed.cell[1])) {
      errors.push(`パーツ${partIdx + 1}の配置座標が不正です。`);
      continue;
    }
    if (![0, 1, 2, 3].includes(placed.rot)) {
      errors.push(`パーツ${partIdx + 1}の回転値が不正です。`);
      continue;
    }

    const cells = occupiedCells(part, placed.cell, placed.rot);
    const [gridW, gridH] = faceSize(placed.face);
    const outOfFace = cells.some(([i, j]) => i < 0 || j < 0 || i >= gridW || j >= gridH);
    if (outOfFace) errors.push(`「${part.nameJa}」が${faceLabel(placed.face)}の範囲からはみ出しています。`);
    let overlaps = false;
    for (const [i, j] of cells) {
      const key = `${placed.face}:${i},${j}`;
      if (occupied.has(key)) overlaps = true;
      occupied.add(key);
    }
    if (overlaps) errors.push(`「${part.nameJa}」が別のパーツと重なっています。`);

    const [baseW, baseD] = part.cells;
    const w = placed.rot === 1 || placed.rot === 3 ? baseD : baseW;
    if (part.category === "drive") {
      const side = driveSide(chassis, placed.face, placed.cell, w);
      if (side < 0) leftDrive += 1;
      else if (side > 0) rightDrive += 1;
    }
    if (part.category === "weapon") {
      weaponCount += 1;
      // Passive mechanisms ignore buttons, so sharing their display slot does
      // not create an ambiguous control binding.
      if (part.action !== "passive") {
        if (part.slot === "primary") primaryCount += 1;
        else if (part.slot === "secondary") secondaryCount += 1;
        else tertiaryCount += 1;
      }
    }
  }

  if (stats.cost > settings.pointBudget) {
    errors.push(`合計コストがポイント上限${settings.pointBudget}を超えています。`);
  }
  if (stats.driveCount < 2) errors.push("駆動パーツを2個以上取り付けてください。");
  if (leftDrive === 0 || rightDrive === 0) {
    errors.push("機体の左右それぞれに駆動パーツが必要です。");
  }
  if (weaponCount > 3) errors.push("武装は3個までしか取り付けられません。");
  if (primaryCount > 1) errors.push("primary武装は1個までです。");
  if (secondaryCount > 1) errors.push("secondary武装は1個までです。");
  if (tertiaryCount > 1) errors.push("tertiary武装は1個までです。");

  return { ok: errors.length === 0, errors, stats };
}

function faceLabel(face: MountFace): string {
  switch (face) {
    case "deck": return "上面";
    case "underside": return "底面";
    case "left": return "左側面";
    case "right": return "右側面";
    case "front": return "前面";
    case "rear": return "背面";
  }
}

/** Resolves which differential-drive channel owns a mounted drive part. */
export function driveSide(
  chassis: ChassisDef | null,
  face: MountFace,
  cell: readonly [number, number],
  rotatedWidth: number
): -1 | 0 | 1 {
  if (face === "left") return -1;
  if (face === "right") return 1;
  if (!chassis) return 0;
  if (face === "deck" || face === "underside") {
    const centerX = cell[0] + rotatedWidth / 2;
    return centerX < chassis.deck[0] / 2 ? -1 : centerX > chassis.deck[0] / 2 ? 1 : 0;
  }
  return 0;
}

/** Converts a face-grid part centre to chassis-local metres. */
export function partLocalPosition(
  chassis: ChassisDef,
  part: PartDef,
  cell: readonly [number, number],
  rot: Rot4,
  face: MountFace = "deck"
): [number, number, number] {
  const [baseW, baseD] = part.cells;
  const w = rot === 1 || rot === 3 ? baseD : baseW;
  const d = rot === 1 || rot === 3 ? baseW : baseD;
  const u = cell[0] + w / 2;
  const v = cell[1] + d / 2;
  const deckY = chassis.groundClearance + chassis.height;
  switch (face) {
    case "deck":
      return [
        (u - chassis.deck[0] / 2) * CELL,
        deckY + part.height / 2,
        (v - chassis.deck[1] / 2) * CELL
      ];
    case "underside":
      return [
        (u - chassis.deck[0] / 2) * CELL,
        chassis.groundClearance - part.height / 2,
        (v - chassis.deck[1] / 2) * CELL
      ];
    case "left":
    case "right":
      return [
        (face === "left" ? -1 : 1) * (chassis.deck[0] * CELL / 2 + part.height / 2),
        chassis.groundClearance + v * CELL,
        (u - chassis.deck[1] / 2) * CELL
      ];
    case "front":
    case "rear":
      return [
        (u - chassis.deck[0] / 2) * CELL,
        chassis.groundClearance + v * CELL,
        (face === "front" ? -1 : 1) * (chassis.deck[1] * CELL / 2 + part.height / 2)
      ];
  }
}
