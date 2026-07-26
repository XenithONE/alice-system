import {
  DRIVE_POWER_DUTY,
  OMEGA_KNEE_MIN,
  POWER_DRIVE_RESERVE
} from "./balance";
import type { AssembledBot, WeaponRuntime } from "./assemble";
import { availablePowerW } from "./internals";
import type { MatchInput, MatchPhase } from "./types";

export interface PowerAllocation {
  readonly driveScale: number;
  readonly weaponW: readonly number[];
  readonly usedW: number;
  readonly surplusW: number;
}

function buttonFor(input: MatchInput, weapon: WeaponRuntime): boolean {
  if (weapon.def.slot === "primary") return input.primary;
  if (weapon.def.slot === "secondary") return input.secondary;
  return input.tertiary;
}

function rotaryCommanded(
  weapon: WeaponRuntime,
  input: MatchInput,
  enabled: boolean
): boolean {
  if (!enabled || weapon.detached || !weapon.body.isValid()) return false;
  if (weapon.def.action === "passive") return true;
  return weapon.def.action === "held" && buttonFor(input, weapon);
}

function angularSpeed(body: { angvel(): { x: number; y: number; z: number } }): number {
  const value = body.angvel();
  return Math.hypot(value.x, value.y, value.z);
}

export function allocatePower(
  bot: AssembledBot,
  input: MatchInput,
  phase: MatchPhase,
  alive = true
): PowerAllocation {
  const enabled = phase === "live" && alive;
  const supplyW = enabled ? availablePowerW(bot) : 0;
  const throttle = enabled ? Math.max(-1, Math.min(1, input.throttle)) : 0;
  const steer = enabled ? Math.max(-1, Math.min(1, input.steer)) : 0;
  const left = Math.max(-1, Math.min(1, throttle + steer));
  const right = Math.max(-1, Math.min(1, throttle - steer));

  let driveNeedW = 0;
  for (const drive of bot.drives) {
    if (drive.detached || !drive.body.isValid()) continue;
    const command = drive.side < 0 ? left : right;
    driveNeedW +=
      DRIVE_POWER_DUTY *
      Math.abs(command) *
      drive.def.torque *
      bot.powerMul *
      angularSpeed(drive.body);
  }

  const weaponNeedW = bot.weapons.map((weapon) => {
    if (
      (weapon.def.effect !== "spin" && weapon.def.effect !== "grind") ||
      !rotaryCommanded(weapon, input, enabled)
    ) {
      return 0;
    }
    const omega = angularSpeed(weapon.body);
    const maxOmega = weapon.def.maxOmega ?? 0;
    if (omega >= maxOmega * 0.999) return 0;
    return (
      (weapon.def.spinUpTorque ?? 0) *
      bot.weaponPowerMul *
      Math.max(omega, OMEGA_KNEE_MIN)
    );
  });
  const totalWeaponNeedW = weaponNeedW.reduce((sum, value) => sum + value, 0);
  const driveAllocW = Math.min(
    driveNeedW,
    Math.max(supplyW * POWER_DRIVE_RESERVE, supplyW - totalWeaponNeedW)
  );
  const remainingW = Math.max(0, supplyW - driveAllocW);
  const weaponW =
    totalWeaponNeedW > 0
      ? weaponNeedW.map((need) =>
          Math.min(need, remainingW * need / totalWeaponNeedW)
        )
      : weaponNeedW;
  const weaponUsedW = weaponW.reduce((sum, value) => sum + value, 0);
  const usedW = driveAllocW + weaponUsedW;
  return {
    driveScale: driveNeedW > 0 ? Math.min(1, driveAllocW / driveNeedW) : 1,
    weaponW,
    usedW,
    surplusW: Math.max(0, supplyW - usedW)
  };
}

export function rotaryTorqueLimit(
  weapon: WeaponRuntime,
  allocatedW: number,
  weaponPowerMul: number
): number {
  if (weapon.detached || !weapon.body.isValid()) return 0;
  const torqueLimit = (weapon.def.spinUpTorque ?? 0) * weaponPowerMul;
  const omega = angularSpeed(weapon.body);
  return Math.min(
    torqueLimit,
    Math.max(0, allocatedW) / Math.max(omega, OMEGA_KNEE_MIN)
  );
}
