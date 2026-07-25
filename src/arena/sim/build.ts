import { IMPACT_SCALE } from "./balance";
import {
  CELL,
  type BotSpec,
  type BuildStats,
  type BuildValidation,
  type Catalog,
  type ChassisDef,
  type PartDef,
  type RoomSettings,
  type Rot4
} from "./types";

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
      else secondaryId ??= part.id;
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
  if (spec.v !== 2) errors.push("未対応の機体データ形式です。");

  let weaponCount = 0;
  let primaryCount = 0;
  let secondaryCount = 0;
  let leftDrive = 0;
  let rightDrive = 0;
  const occupied = new Set<string>();
  const deckW = chassis?.deck[0] ?? 0;
  const deckD = chassis?.deck[1] ?? 0;

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
    if (!Number.isInteger(placed.cell[0]) || !Number.isInteger(placed.cell[1])) {
      errors.push(`パーツ${partIdx + 1}の配置座標が不正です。`);
      continue;
    }
    if (![0, 1, 2, 3].includes(placed.rot)) {
      errors.push(`パーツ${partIdx + 1}の回転値が不正です。`);
      continue;
    }

    const cells = occupiedCells(part, placed.cell, placed.rot);
    const outOfDeck = cells.some(([x, z]) => x < 0 || z < 0 || x >= deckW || z >= deckD);
    if (outOfDeck) errors.push(`「${part.nameJa}」がデッキからはみ出しています。`);
    let overlaps = false;
    for (const [x, z] of cells) {
      const key = `${x},${z}`;
      if (occupied.has(key)) overlaps = true;
      occupied.add(key);
    }
    if (overlaps) errors.push(`「${part.nameJa}」が別のパーツと重なっています。`);

    const [baseW, baseD] = part.cells;
    const w = placed.rot === 1 || placed.rot === 3 ? baseD : baseW;
    const centerX = placed.cell[0] + w / 2;
    if (part.category === "drive") {
      if (centerX < deckW / 2) leftDrive += 1;
      else if (centerX > deckW / 2) rightDrive += 1;
    }
    if (part.category === "weapon") {
      weaponCount += 1;
      if (part.slot === "primary") primaryCount += 1;
      else secondaryCount += 1;
    }
  }

  if (stats.cost > settings.pointBudget) {
    errors.push(`合計コストがポイント上限${settings.pointBudget}を超えています。`);
  }
  if (stats.driveCount < 2) errors.push("駆動パーツを2個以上取り付けてください。");
  if (leftDrive === 0 || rightDrive === 0) {
    errors.push("機体の左右それぞれに駆動パーツが必要です。");
  }
  if (weaponCount > 2) errors.push("武装は2個までしか取り付けられません。");
  if (primaryCount > 1) errors.push("primary武装は1個までです。");
  if (secondaryCount > 1) errors.push("secondary武装は1個までです。");

  return { ok: errors.length === 0, errors, stats };
}

/** Converts a cell-space part centre to chassis-local metres. */
export function partLocalPosition(
  chassis: ChassisDef,
  part: PartDef,
  cell: readonly [number, number],
  rot: Rot4
): [number, number] {
  const [baseW, baseD] = part.cells;
  const w = rot === 1 || rot === 3 ? baseD : baseW;
  const d = rot === 1 || rot === 3 ? baseW : baseD;
  return [
    (cell[0] + w / 2 - chassis.deck[0] / 2) * CELL,
    (cell[1] + d / 2 - chassis.deck[1] / 2) * CELL
  ];
}
