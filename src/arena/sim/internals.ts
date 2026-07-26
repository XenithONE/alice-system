import {
  FIXED_DT,
  FLAME_HEAT_W_PER_DPS,
  FUEL_L_PER_SEC,
  HEAT_CAP_J,
  HEAT_DERATE_MAX,
  HEAT_DERATE_START,
  HEAT_FRACTION,
  IMPULSE_KJ_DIVISOR
} from "./balance";
import type { AssembledBot } from "./assemble";
import type { PlantState, WeaponDef } from "./types";

export interface InternalTelemetry {
  readonly powerKw: number;
  readonly coolingKw: number;
  readonly heatJ: number;
  readonly chargeKj: number;
  readonly fuelL: number;
  readonly powerScale: number;
  readonly usedW: number;
}

export function weaponChargeCostKj(def: WeaponDef): number {
  return def.chargeKj ?? (def.impulse ?? 0) / IMPULSE_KJ_DIVISOR;
}

export function heatPowerScale(heatJ: number): number {
  const ratio = Math.max(0, Math.min(1, heatJ / HEAT_CAP_J));
  const over =
    Math.max(0, ratio - HEAT_DERATE_START) /
    Math.max(1 - HEAT_DERATE_START, Number.EPSILON);
  return 1 - HEAT_DERATE_MAX * over;
}

export function availablePowerW(bot: AssembledBot): number {
  return bot.powerKw * 1000 * heatPowerScale(bot.heatJ);
}

export function updateInternals(
  bot: AssembledBot,
  usedW: number,
  surplusW: number,
  enabled: boolean
): void {
  const flameHeatW = enabled
    ? bot.weapons.reduce(
        (sum, weapon) =>
          sum +
          (!weapon.detached && weapon.active && weapon.def.effect === "flame"
            ? (weapon.def.dps ?? 0) * FLAME_HEAT_W_PER_DPS
            : 0),
        0
      )
    : 0;
  const heatInW = enabled
    ? usedW * HEAT_FRACTION * bot.heatMul + flameHeatW
    : 0;
  const heatOutW = bot.coolingKw * 1000;
  bot.heatJ = Math.max(
    0,
    Math.min(HEAT_CAP_J, bot.heatJ + (heatInW - heatOutW) * FIXED_DT)
  );
  if (enabled) {
    const rechargeKw = Math.min(bot.alternatorKw, Math.max(0, surplusW) / 1000);
    bot.chargeKj = Math.min(
      bot.chargeCapacityKj,
      bot.chargeKj + rechargeKw * FIXED_DT
    );
  }
  bot.usedW = enabled ? Math.max(0, usedW) : 0;
}

export function internalTelemetry(bot: AssembledBot): InternalTelemetry {
  return {
    powerKw: bot.powerKw,
    coolingKw: bot.coolingKw,
    heatJ: bot.heatJ,
    chargeKj: bot.chargeKj,
    fuelL: bot.fuelL,
    powerScale: heatPowerScale(bot.heatJ),
    usedW: bot.usedW
  };
}

export function plantState(bot: AssembledBot): PlantState {
  const fuelInLinesL = bot.weapons.reduce(
    (sum, weapon) => sum + Math.max(0, weapon.fuelLeft) * FUEL_L_PER_SEC,
    0
  );
  const availableW = availablePowerW(bot);
  return {
    heat: Math.max(0, Math.min(1, bot.heatJ / HEAT_CAP_J)),
    charge:
      bot.chargeCapacityKj > 0
        ? Math.max(0, Math.min(1, bot.chargeKj / bot.chargeCapacityKj))
        : 1,
    fuel:
      bot.fuelCapacityL > 0
        ? Math.max(0, Math.min(1, (bot.fuelL + fuelInLinesL) / bot.fuelCapacityL))
        : 1,
    load:
      availableW > 0
        ? Math.max(0, Math.min(1, bot.usedW / availableW))
        : bot.usedW > 0
          ? 1
          : 0
  };
}
