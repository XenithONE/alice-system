import {
  DRIVE_POWER_DUTY,
  FLAME_HEAT_W_PER_DPS,
  FUEL_L_PER_SEC,
  HEAT_CAP_J,
  HEAT_DERATE_MAX,
  HEAT_DERATE_START,
  HEAT_FRACTION,
  IMPACT_SCALE,
  LEG_HUB_FRAC,
  LEG_HULL_MARGIN,
  LEG_SPOKE_RADIUS_FRAC,
  MAX_BUILD_LEVEL,
  MAX_DRIVES,
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
  type DriveDef,
  isInternalPart,
  type MountFace,
  type PartDef,
  type PlacedPart,
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

  /*
   * What height costs (H7). comMoment/comMassSum is the mass-weighted centre of
   * the whole machine above the floor and trackWidth is the span between the
   * outermost contact patches on opposite sides; stability falls out of the two.
   * Every y here comes from partLocalPosition — the same call assemble.ts makes
   * — so the number the builder prints is the height the physics actually has.
   */
  const rises = levelRises(spec, catalog);
  // Same hull lift the collider uses, so comHeight follows the machine up.
  const lift = hullLift(spec, catalog);
  let comMoment = chassis ? chassis.mass * (chassis.groundClearance + chassis.height / 2) : 0;
  let comMassSum = chassis?.mass ?? 0;
  let leftMost = Number.POSITIVE_INFINITY;
  let rightMost = Number.NEGATIVE_INFINITY;
  let topLevel = 0;

  for (const placed of spec.parts) {
    const part = catalog.byId.get(placed.partId);
    if (!part || part.category === "chassis") continue;
    cost += part.cost;
    mass += part.mass;
    hp += part.hp;
    armor += part.armor;
    topLevel = Math.max(topLevel, Math.max(0, Math.trunc(placed.level ?? 0)));
    const local = chassis
      ? partLocalPosition(
          chassis,
          part,
          placed.cell,
          placed.rot,
          placed.face,
          { levelRise: placedRise(rises, placed), hullLift: lift }
        )
      : null;
    // A drive hangs off its axle, so its centre of mass is one radius up
    // whatever cell it was bolted to — the same override assemble.ts applies.
    const partY = local ? (part.category === "drive" ? part.radius : local[1]) : 0;
    comMoment += part.mass * partY;
    comMassSum += part.mass;
    if (part.category === "drive") {
      driveCount += 1;
      topSpeed = Math.min(topSpeed, part.maxOmega * part.radius);
      baseTorque += part.torque;
      drivePowerKw +=
        DRIVE_POWER_DUTY * part.torque * part.maxOmega / 1000;
      const localX = local?.[0] ?? 0;
      const rotatedWidth =
        placed.rot === 1 || placed.rot === 3 ? part.cells[1] : part.cells[0];
      // Same tie-break assemble.ts uses, so the width measured here is the
      // width between the wheels the driver actually commands.
      const side = driveSide(chassis, placed.face, placed.cell, rotatedWidth)
        || (localX < 0 ? -1 : 1);
      if (side < 0) leftMost = Math.min(leftMost, localX);
      else rightMost = Math.max(rightMost, localX);
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
  const comHeight = comMassSum > 0 ? comMoment / comMassSum : 0;
  // Needs a drive on BOTH sides: one flank of wheels is not a track width, it
  // is a unicycle, and reporting half a span as the full one would tell the
  // player a tall build is stable when it will roll onto its side.
  const trackWidth =
    Number.isFinite(leftMost) && Number.isFinite(rightMost)
      ? Math.max(0, rightMost - leftMost)
      : 0;

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
    comHeight,
    trackWidth,
    stability: comHeight > 0 ? trackWidth / (2 * comHeight) : 0,
    topLevel,
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

  /*
   * Risers first, because H4 asks a question about the storey BELOW a part and
   * the parts arrive in whatever order the builder appended them.
   *
   * Two facts per storey: which deck cells its risers cover (what the next
   * storey may stand on), and the rise they all agreed on. H6 rejects a storey
   * whose risers disagree, and it has to, because levelRises() collapses a
   * mixed storey to its tallest riser — the parts above would then sit on air
   * above the short ones.
   */
  const riserCells = new Map<number, Set<string>>();
  const riserRise = new Map<number, { rise: number; nameJa: string }>();
  const mixedRiseReported = new Set<number>();
  for (const placed of spec.parts) {
    const part = catalog.byId.get(placed.partId);
    if (part?.category !== "structure" || placed.face !== "deck") continue;
    const level = Math.max(0, Math.trunc(placed.level ?? 0));
    let cellsAt = riserCells.get(level);
    if (!cellsAt) {
      cellsAt = new Set<string>();
      riserCells.set(level, cellsAt);
    }
    for (const [i, j] of occupiedCells(part, placed.cell, placed.rot)) {
      cellsAt.add(`${i},${j}`);
    }
    const first = riserRise.get(level);
    if (!first) {
      riserRise.set(level, { rise: part.rise, nameJa: part.nameJa });
    } else if (Math.abs(first.rise - part.rise) > 1e-9 && !mixedRiseReported.has(level)) {
      mixedRiseReported.add(level);
      errors.push(
        `${level}段目の支柱の高さが揃っていません。「${first.nameJa}」（${formatNumber(first.rise * 100)}cm）と「${part.nameJa}」（${formatNumber(part.rise * 100)}cm）は同じ段には混在できません。`
      );
    }
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
      // Storey is part of the key or the second floor reads as a collision
      // with the first and a multi-level build becomes unbuildable.
      const key = `${placed.face}:${placed.level ?? 0}:${i},${j}`;
      if (occupied.has(key)) overlaps = true;
      occupied.add(key);
    }
    if (overlaps) errors.push(`「${part.nameJa}」が別のパーツと重なっています。`);

    /*
     * Storeys. Every message names the part AND the storey on purpose: a build
     * saved before v4 can become invalid the moment a chassis' maxLevels is
     * published, and "パーツ7が不正です" gives the player nothing to fix.
     *
     * One message per part, most specific first — a part on storey 2 of a
     * single-storey frame is an H5 problem, and also telling it there is no
     * riser under it (H4) would just be noise.
     */
    const level = placed.level ?? 0;
    if (!Number.isInteger(level) || level < 0) {
      errors.push(
        `「${part.nameJa}」の段数（${level}）が不正です。段は0以上の整数で指定してください。`
      );
    } else if (placed.face !== "deck" && level > 0) {
      errors.push(
        `「${part.nameJa}」は${faceLabel(placed.face)}に取り付けられているため${level}段目に置けません。段を積めるのは上面だけです。`
      );
    } else if (chassis && level >= chassis.maxLevels) {
      errors.push(
        `「${part.nameJa}」を${level}段目に置いていますが、シャーシ「${chassis.nameJa}」は${chassis.maxLevels}段構造（0〜${chassis.maxLevels - 1}段目）までです。`
      );
    } else if (level >= 1) {
      const support = riserCells.get(level - 1);
      const floating = cells.filter(([i, j]) => !support?.has(`${i},${j}`)).length;
      if (floating > 0) {
        errors.push(
          `「${part.nameJa}」（${level}段目）が宙に浮いています。${cells.length}セル中${floating}セルの下に${level - 1}段目の支柱がありません。`
        );
      }
    }

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
  if (stats.driveCount > MAX_DRIVES) {
    errors.push(`駆動パーツは${MAX_DRIVES}個までです（現在${stats.driveCount}個）。`);
  }
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
/**
 * How far above the hull deck each storey's floor sits, indexed by level.
 * Entry 0 is always 0; entry L is the sum of the rises of every storey below.
 *
 * This is the ONLY place a storey height is computed. assemble.ts and
 * render/mounting.ts both call it and pass the result into
 * partLocalPosition — neither is allowed to add up rises itself. The three
 * worst defects in this project so far (side wheels 5 cm high and 7 cm
 * outboard, a belt rendered inside out, a trap drawn at a radius the collider
 * did not have) were all one fact written down twice, and a storey height is
 * exactly that kind of fact.
 *
 * A level with no riser under it contributes 0, which makes an unsupported
 * storey sit flush with the one below rather than float. That is a build
 * validateBuild rejects (H4); this function must still return a finite number
 * for it, because the builder previews illegal placements while you drag.
 */
export function levelRises(spec: BotSpec, catalog: Catalog): number[] {
  const rises: number[] = [0];
  // Risers of one storey must all share a rise (H6 rejects mixtures), so the
  // tallest present is the right answer for a build that passed validation and
  // a stable one for a build that has not.
  const tallest = new Map<number, number>();
  for (const placed of spec.parts) {
    const part = catalog.byId.get(placed.partId);
    if (!part || part.category !== "structure") continue;
    const level = Math.min(Math.max(0, Math.trunc(placed.level ?? 0)), MAX_BUILD_LEVEL);
    tallest.set(level, Math.max(tallest.get(level) ?? 0, part.rise));
  }
  /*
   * Clamped, because this runs on the host against a guest's unvalidated spec:
   * validateBuild calls computeStats first, so H5 has not rejected a silly
   * level yet when we get here. Unclamped, `level: 1e9` is a 8 GB allocation
   * and a dead room. riseForLevel saturates at the last entry, so a clamped
   * array still returns a finite height for the illegal part that H5 is about
   * to reject anyway.
   */
  const requested = tallest.size === 0 ? 0 : Math.max(...tallest.keys());
  const top = Math.min(Math.max(0, Math.trunc(requested)), MAX_BUILD_LEVEL);
  for (let level = 0; level <= top; level += 1) {
    rises.push(rises[level]! + (tallest.get(level) ?? 0));
  }
  return rises;
}

/** Storey floor offset for one part, safe for any level including missing ones. */
export function riseForLevel(rises: readonly number[], level: number): number {
  return rises[Math.max(0, Math.trunc(level))] ?? rises[rises.length - 1] ?? 0;
}

/**
 * The storey offset to hand partLocalPosition for one placed part. Off the deck
 * a level has no meaning (contract H1), so it is always 0 there — callers must
 * not decide that for themselves.
 */
export function placedRise(
  rises: readonly number[],
  placed: Pick<PlacedPart, "face" | "level">
): number {
  return placed.face === "deck" ? riseForLevel(rises, placed.level ?? 0) : 0;
}

/**
 * Where the capsules of one leg sit on its hub (ARCHITECTURE_V4 §6.4).
 *
 * A leg is `feet` capsules on ONE rigid body turned by ONE revolute motor, so
 * it is a wheel as far as driver.ts, damage.ts and the wire are concerned. The
 * only thing that makes it a leg is this layout, and it lives here — beside
 * partLocalPosition and driveSide — so the collider and the mesh read the SAME
 * numbers. Deriving the tip from radius rather than tuning it is the point:
 * `d = radius - halfHeight - capsuleRadius` puts the farthest point of every
 * capsule at exactly `def.radius`, which is the outline contract wheels obey.
 *
 * The phase bias offsets the right side by half a step so the two sides land
 * alternately and the machine walks instead of hopping (contract L4).
 */
export interface LegSpokeLayout {
  readonly feet: number;
  readonly capsuleRadius: number;
  readonly halfHeight: number;
  /** axle to capsule centre */
  readonly d: number;
  /** rotation about chassis-local X for each spoke, radians */
  readonly angles: readonly number[];
}

export function legSpokeLayout(def: DriveDef, side: -1 | 1): LegSpokeLayout {
  const feet = Math.max(2, Math.round(def.feet ?? 2));
  const capsuleRadius = Math.max(def.radius * LEG_SPOKE_RADIUS_FRAC, 1e-4);
  // The spoke spans from LEG_HUB_FRAC * radius out to the tip; the clamp only
  // matters for an absurdly fat capsule, and it never moves the tip.
  const halfHeight = Math.max(
    def.radius * (1 - LEG_HUB_FRAC) / 2 - capsuleRadius,
    def.radius * 0.02
  );
  const bias = side < 0 ? 0 : Math.PI / feet;
  const angles: number[] = [];
  for (let k = 0; k < feet; k += 1) angles.push(2 * Math.PI * k / feet + bias);
  return {
    feet,
    capsuleRadius,
    halfHeight,
    d: def.radius - halfHeight - capsuleRadius,
    angles
  };
}

/**
 * The radius at which a drive is GUARANTEED to be carrying the machine.
 *
 * A wheel touches the floor at `radius` no matter how it is turned. A leg is a
 * star of `feet` spokes, and between two footfalls the deepest thing under the
 * axle is the star's inscribed circle, not its tip — so the axle drops. Reading
 * `def.radius` as the support height for a leg is what put the hull on the
 * floor for 92% of frames: the machines were sledding on their bellies with
 * their legs windmilling in the air.
 */
export function driveSupportRadius(def: DriveDef): number {
  if (def.kind !== "leg") return def.radius;
  const feet = Math.max(2, Math.trunc(def.feet ?? 4));
  const capsule = def.radius * LEG_SPOKE_RADIUS_FRAC;
  return (def.radius - capsule) * Math.cos(Math.PI / feet) + capsule;
}

/** How far the axle sinks between footfalls. Zero for wheels and tracks. */
export function driveSinkDepth(def: DriveDef): number {
  return Math.max(0, def.radius - driveSupportRadius(def));
}

/**
 * How far the hull has to be raised off its axles so the machine rides on its
 * drives rather than its belly. Zero for anything wheeled, which is why this
 * changes nothing for the fourteen machines that shipped before v4.
 *
 * Like levelRises, this is derived once and consumed everywhere: the collider
 * in assemble.ts, the mesh in render/mounting.ts and the centre of mass in
 * computeStats all take it from here. A second copy of this number would put
 * the drawn hull and the physical hull at different heights, which is the
 * defect this project has now shipped three times.
 */
export function hullLift(spec: BotSpec, catalog: Catalog): number {
  let lift = 0;
  for (const placed of spec.parts) {
    const part = catalog.byId.get(placed.partId);
    if (!part || part.category !== "drive") continue;
    lift = Math.max(lift, driveSinkDepth(part) * LEG_HULL_MARGIN);
  }
  return lift;
}

export function partLocalPosition(
  chassis: ChassisDef,
  part: PartDef,
  cell: readonly [number, number],
  rot: Rot4,
  face: MountFace = "deck",
  /*
   * Two build-wide vertical facts, passed as an object so a caller cannot get
   * them the wrong way round. Both default to 0, which is exactly the v3
   * geometry: a single-storey machine on wheels is placed identically to
   * before.
   */
  offsets: {
    /** metres this part's storey floor sits above the hull deck; deck face only */
    readonly levelRise?: number;
    /** metres the whole hull is raised so leg drives carry it, not the belly */
    readonly hullLift?: number;
  } = {}
): [number, number, number] {
  const levelRise = offsets.levelRise ?? 0;
  const lift = offsets.hullLift ?? 0;
  const [baseW, baseD] = part.cells;
  const w = rot === 1 || rot === 3 ? baseD : baseW;
  const d = rot === 1 || rot === 3 ? baseW : baseD;
  const u = cell[0] + w / 2;
  const v = cell[1] + d / 2;
  const clearance = chassis.groundClearance + lift;
  const deckY = clearance + chassis.height;
  switch (face) {
    case "deck":
      return [
        (u - chassis.deck[0] / 2) * CELL,
        deckY + levelRise + part.height / 2,
        (v - chassis.deck[1] / 2) * CELL
      ];
    case "underside":
      return [
        (u - chassis.deck[0] / 2) * CELL,
        clearance - part.height / 2,
        (v - chassis.deck[1] / 2) * CELL
      ];
    case "internal":
      return [
        (u - chassis.deck[0] / 2) * CELL,
        clearance + chassis.height / 2,
        (v - chassis.deck[1] / 2) * CELL
      ];
    case "left":
    case "right":
      return [
        (face === "left" ? -1 : 1) * (chassis.deck[0] * CELL / 2 + part.height / 2),
        clearance + v * CELL,
        (u - chassis.deck[1] / 2) * CELL
      ];
    case "front":
    case "rear":
      return [
        (u - chassis.deck[0] / 2) * CELL,
        clearance + v * CELL,
        (face === "front" ? -1 : 1) * (chassis.deck[1] * CELL / 2 + part.height / 2)
      ];
  }
}
