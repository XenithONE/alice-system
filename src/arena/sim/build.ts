import {
  DRIVE_POWER_DUTY,
  FLAME_HEAT_W_PER_DPS,
  FUEL_L_PER_SEC,
  HEAT_CAP_J,
  HEAT_DERATE_MAX,
  HEAT_DERATE_START,
  HEAT_FRACTION,
  IMPACT_SCALE,
  MAX_SPINUP_SEC,
  SELF_RIGHT_CHARGE_KJ
} from "./balance";
import { weaponChargeCostKj } from "./internals";
import {
  CELL,
  type BotSpec,
  type BuildStats,
  type BuildValidation,
  type Catalog,
  type ChassisDef,
  isInternalPart,
  type MountFace,
  type PartDef,
  type RoomSettings,
  type Rot4,
  type WeaponDef
} from "./types";

const VALID_FACES: readonly MountFace[] = [
  "deck",
  "underside",
  "left",
  "right",
  "front",
  "rear",
  "internal"
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
  let weaponPowerMul = 1;
  let hitPower = 0;
  let sustainedDps = 0;
  let primaryId: string | null = null;
  let secondaryId: string | null = null;
  let tertiaryId: string | null = null;
  let hasSelfRight = false;
  let powerKw = chassis?.stockPowerKw ?? 0;
  let chargeKj = chassis?.stockChargeKj ?? 0;
  let fuelL = chassis?.stockFuelL ?? 0;
  let coolingKw = chassis?.stockCoolingKw ?? 0;
  let heatWeightedKw = powerKw;
  let internalCells = 0;
  let drivePowerKw = 0;
  let flameHeatKw = 0;
  let chargeDemandKj = 0;
  const rotaryWeapons: WeaponDef[] = [];

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
      drivePowerKw +=
        DRIVE_POWER_DUTY * part.torque * part.maxOmega / 1000;
    } else if (part.category === "weapon") {
      if (part.slot === "primary") primaryId ??= part.id;
      else if (part.slot === "secondary") secondaryId ??= part.id;
      else tertiaryId ??= part.id;
      hitPower = Math.max(hitPower, part.mass * part.damageMul * IMPACT_SCALE);
      if (part.effect === "grind" || part.effect === "clamp" || part.effect === "flame") {
        sustainedDps += part.dps ?? 0;
      }
      if (part.effect === "spin" || part.effect === "grind") {
        rotaryWeapons.push(part);
      }
      if (part.effect === "flame") {
        flameHeatKw += (part.dps ?? 0) * FLAME_HEAT_W_PER_DPS / 1000;
      }
      if (part.action === "triggered") {
        chargeDemandKj = Math.max(chargeDemandKj, weaponChargeCostKj(part));
      }
    } else if (part.category === "utility") {
      powerMul *= part.powerMul ?? 1;
      weaponPowerMul *= part.weaponPowerMul ?? 1;
      hasSelfRight ||= part.selfRight === true;
      if (isInternalPart(part)) {
        const addedPowerKw = part.powerKw ?? 0;
        powerKw += addedPowerKw;
        chargeKj += part.chargeKj ?? 0;
        fuelL += part.fuelL ?? 0;
        coolingKw += part.coolingKw ?? 0;
        heatWeightedKw += addedPowerKw * (part.heatMul ?? 1);
        internalCells += occupiedCells(part, placed.cell, placed.rot).length;
      }
    }
  }

  drivePowerKw *= powerMul;
  if (hasSelfRight) {
    chargeDemandKj = Math.max(chargeDemandKj, SELF_RIGHT_CHARGE_KJ);
  }
  const rotaryEnergyJ = rotaryWeapons.reduce(
    (sum, weapon) =>
      sum + 0.5 * (weapon.inertia ?? 0) * (weapon.maxOmega ?? 0) ** 2,
    0
  );
  const rotaryTorquePowerW = rotaryWeapons.reduce(
    (sum, weapon) =>
      sum +
      (weapon.spinUpTorque ?? 0) *
        weaponPowerMul *
        (weapon.maxOmega ?? 0),
    0
  );
  const effectiveSpinPowerW = Math.min(powerKw * 1000, rotaryTorquePowerW);
  const spinUpSec =
    rotaryEnergyJ > 0 && effectiveSpinPowerW > 0
      ? rotaryEnergyJ / effectiveSpinPowerW
      : rotaryEnergyJ > 0
        ? Number.POSITIVE_INFINITY
        : 0;
  const rotaryDemandKw = rotaryEnergyJ / MAX_SPINUP_SEC / 1000;
  const heatMul = powerKw > 0 ? heatWeightedKw / powerKw : 1;
  const heatKw = drivePowerKw * HEAT_FRACTION * heatMul + flameHeatKw;

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
    invertible: chassis?.invertible ?? false,
    powerKw,
    powerDemandKw: drivePowerKw + rotaryDemandKw,
    chargeKj,
    chargeDemandKj,
    fuelL,
    fuelBurnSec: fuelL / FUEL_L_PER_SEC,
    coolingKw,
    heatKw,
    spinUpSec,
    internalCells,
    internalCellsMax: chassis ? chassis.internalGrid[0] * chassis.internalGrid[1] : 0
  };
}

export function faceSize(
  chassis: ChassisDef | null,
  face: MountFace
): readonly [number, number] {
  if (!chassis) return [0, 0];
  if (face === "internal") return chassis.internalGrid;
  if (face === "deck" || face === "underside") return chassis.deck;
  if (face === "left" || face === "right") return [chassis.deck[1], chassis.heightCells];
  return [chassis.deck[0], chassis.heightCells];
}

export function validateBuild(
  spec: BotSpec,
  catalog: Catalog,
  settings: RoomSettings
): BuildValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
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
    if ((placed.face === "internal") !== isInternalPart(part)) {
      errors.push(
        isInternalPart(part)
          ? `「${part.nameJa}」は機関室にしか搭載できません。`
          : `「${part.nameJa}」は機関室に搭載できません。`
      );
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
    const [gridW, gridH] = faceSize(chassis, placed.face);
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

  if (chassis) {
    const driveNeedKw = spec.parts.reduce((sum, placed) => {
      const part = catalog.byId.get(placed.partId);
      return part?.category === "drive"
        ? sum + DRIVE_POWER_DUTY * part.torque * part.maxOmega / 1000
        : sum;
    }, 0) * spec.parts.reduce((mul, placed) => {
      const part = catalog.byId.get(placed.partId);
      return part?.category === "utility" ? mul * (part.powerMul ?? 1) : mul;
    }, 1);
    if (driveNeedKw > stats.powerKw) {
      errors.push(
        `駆動に ${formatNumber(driveNeedKw)} kW 必要ですが、機関出力は ${formatNumber(stats.powerKw)} kW しかありません。（${formatNumber(driveNeedKw - stats.powerKw)} kW 不足）`
      );
    }

    for (const placed of spec.parts) {
      const part = catalog.byId.get(placed.partId);
      if (part?.category !== "weapon") continue;
      if (part.effect === "spin" || part.effect === "grind") {
        const energyJ = 0.5 * (part.inertia ?? 0) * (part.maxOmega ?? 0) ** 2;
        const torquePowerW =
          (part.spinUpTorque ?? 0) *
          spec.parts.reduce((mul, candidate) => {
            const utility = catalog.byId.get(candidate.partId);
            return utility?.category === "utility"
              ? mul * (utility.weaponPowerMul ?? 1)
              : mul;
          }, 1) *
          (part.maxOmega ?? 0);
        const availableW = Math.min(stats.powerKw * 1000, torquePowerW);
        const spinSec =
          energyJ > 0 && availableW > 0
            ? energyJ / availableW
            : Number.POSITIVE_INFINITY;
        if (spinSec > MAX_SPINUP_SEC) {
          const needKw = energyJ / MAX_SPINUP_SEC / 1000;
          errors.push(
            `「${part.nameJa}」の加速に ${formatNumber(spinSec)} 秒かかります（上限 ${MAX_SPINUP_SEC} 秒）。約 ${formatNumber(needKw)} kW のエンジンが必要です。（現在 ${formatNumber(stats.powerKw)} kW）`
          );
        }
      }
      if (part.action === "triggered") {
        const need = weaponChargeCostKj(part);
        if (need > stats.chargeKj) {
          errors.push(
            `「${part.nameJa}」の作動に ${formatNumber(need)} kJ 必要ですが、蓄電容量は ${formatNumber(stats.chargeKj)} kJ です。バッテリーを追加してください。`
          );
        }
      }
      if ((part.fuel ?? 0) > 0 && stats.fuelL <= 0) {
        errors.push(
          `「${part.nameJa}」は燃料を必要とします。燃料タンクを機関室に搭載してください。`
        );
      }
    }
    if (stats.hasSelfRight && stats.chargeKj < SELF_RIGHT_CHARGE_KJ) {
      errors.push(
        `自立機構の作動に ${SELF_RIGHT_CHARGE_KJ} kJ 必要ですが、蓄電容量は ${formatNumber(stats.chargeKj)} kJ です。`
      );
    }
    if (stats.internalCells > stats.internalCellsMax) {
      const [w, h] = chassis.internalGrid;
      errors.push(
        `機関室が満杯です。機関室は ${w}×${h} セル（${stats.internalCellsMax}）ですが、${stats.internalCells} セル使っています。`
      );
    }
    if (stats.heatKw > stats.coolingKw) {
      const derateSec =
        HEAT_CAP_J * HEAT_DERATE_START /
        ((stats.heatKw - stats.coolingKw) * 1000);
      const pct = Math.round((1 - HEAT_DERATE_MAX) * 100);
      warnings.push(
        `冷却が不足しています。連続出力 ${formatNumber(stats.heatKw)} kW に対し冷却 ${formatNumber(stats.coolingKw)} kW — 約 ${formatNumber(derateSec)} 秒で出力が ${pct}% まで低下します。`
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings, stats };
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "∞";
  return Number(value.toFixed(1)).toString();
}

function faceLabel(face: MountFace): string {
  switch (face) {
    case "deck": return "上面";
    case "underside": return "底面";
    case "left": return "左側面";
    case "right": return "右側面";
    case "front": return "前面";
    case "rear": return "背面";
    case "internal": return "機関室";
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
  if (face === "internal") return 0;
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
    case "internal":
      return [
        (u - chassis.deck[0] / 2) * CELL,
        chassis.groundClearance + chassis.height / 2,
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
