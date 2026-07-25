import { IMPACT_SCALE, MASS_LIMIT } from "./balance";
import {
  CELL,
  type BotSpec,
  type BuildStats,
  type BuildValidation,
  type Catalog,
  type ChassisDef,
  type PartDef,
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

export function computeStats(spec: BotSpec, catalog: Catalog): BuildStats {
  const chassis = chassisFor(spec, catalog);
  let mass = chassis?.mass ?? 0;
  let hp = chassis?.hp ?? 0;
  let armor = chassis?.armor ?? 0;
  let driveCount = 0;
  let topSpeed = Number.POSITIVE_INFINITY;
  let baseTorque = 0;
  let powerMul = 1;
  let hitPower = 0;
  let weaponId: string | null = null;
  let hasSelfRight = false;

  for (const placed of spec.parts) {
    const part = catalog.byId.get(placed.partId);
    if (!part || part.category === "chassis") continue;
    mass += part.mass;
    hp += part.hp;
    armor += part.armor;
    if (part.category === "drive") {
      driveCount += 1;
      topSpeed = Math.min(topSpeed, part.maxOmega * part.radius);
      baseTorque += part.torque;
    } else if (part.category === "weapon") {
      weaponId ??= part.id;
      hitPower = Math.max(hitPower, part.mass * part.damageMul * IMPACT_SCALE);
    } else if (part.category === "utility") {
      powerMul *= part.powerMul ?? 1;
      hasSelfRight ||= part.selfRight === true;
    }
  }

  return {
    mass,
    massLimit: MASS_LIMIT,
    hp,
    armor,
    topSpeed: Number.isFinite(topSpeed) ? topSpeed : 0,
    torque: baseTorque * powerMul,
    hitPower,
    driveCount,
    weaponId,
    hasSelfRight
  };
}

type Point = readonly [number, number];

function cross(o: Point, a: Point, b: Point): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const unique = sorted.filter(
    (point, index) =>
      index === 0 || point[0] !== sorted[index - 1]![0] || point[1] !== sorted[index - 1]![1]
  );
  if (unique.length <= 2) return unique;
  const lower: Point[] = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: Point[] = [];
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const point = unique[index]!;
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function insideConvex(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  let sign = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const value = cross(polygon[index]!, polygon[(index + 1) % polygon.length]!, point);
    if (Math.abs(value) <= Number.EPSILON) continue;
    const nextSign = Math.sign(value);
    if (sign !== 0 && nextSign !== sign) return false;
    sign = nextSign;
  }
  return true;
}

export function validateBuild(spec: BotSpec, catalog: Catalog): BuildValidation {
  const errors: string[] = [];
  const stats = computeStats(spec, catalog);
  const chassis = chassisFor(spec, catalog);
  if (!chassis) errors.push("有効なシャーシが必要です。");
  if (spec.v !== 1) errors.push("未対応の機体データ形式です。");

  let weaponCount = 0;
  let leftDrive = 0;
  let rightDrive = 0;
  const occupied = new Set<string>();
  const supportPoints: Point[] = [];
  let weightedX = 0;
  let weightedZ = 0;
  let knownMass = chassis?.mass ?? 0;
  const deckW = chassis?.deck[0] ?? 0;
  const deckD = chassis?.deck[1] ?? 0;
  if (chassis) {
    weightedX = chassis.mass * deckW / 2;
    weightedZ = chassis.mass * deckD / 2;
  }

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
    const d = placed.rot === 1 || placed.rot === 3 ? baseW : baseD;
    const centerX = placed.cell[0] + w / 2;
    const centerZ = placed.cell[1] + d / 2;
    knownMass += part.mass;
    weightedX += part.mass * centerX;
    weightedZ += part.mass * centerZ;
    if (part.category === "drive") {
      if (centerX < deckW / 2) leftDrive += 1;
      else if (centerX > deckW / 2) rightDrive += 1;
      supportPoints.push(
        [placed.cell[0], placed.cell[1]],
        [placed.cell[0] + w, placed.cell[1]],
        [placed.cell[0] + w, placed.cell[1] + d],
        [placed.cell[0], placed.cell[1] + d]
      );
    }
    if (part.category === "weapon") weaponCount += 1;
  }

  if (stats.driveCount < 2) errors.push("駆動パーツを2個以上取り付けてください。");
  if (leftDrive === 0 || rightDrive === 0) {
    errors.push("機体の左右それぞれに駆動パーツが必要です。");
  }
  if (weaponCount > 1) errors.push("武器は1個までしか取り付けられません。");
  if (stats.mass > MASS_LIMIT) {
    errors.push(`総質量が上限${MASS_LIMIT}kgを超えています。`);
  }
  if (chassis && knownMass > 0) {
    const centerOfMass: Point = [weightedX / knownMass, weightedZ / knownMass];
    if (!insideConvex(centerOfMass, convexHull(supportPoints))) {
      errors.push("重心が駆動パーツの接地範囲から外れています。");
    }
  }

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
