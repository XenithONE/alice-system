import type RAPIER from "@dimforge/rapier3d-compat";
import {
  DRY_LOCKOUT,
  FIXED_DT,
  MIN_TRIGGER_GAP,
  SELF_RIGHT_COOLDOWN,
  SELF_RIGHT_IMPULSE
} from "./balance";
import type { AssembledBot, WeaponRuntime } from "./assemble";
import type { MatchInput, MatchPhase, SimEvent } from "./types";

export interface DriverFrame {
  readonly inverted: boolean;
}

function clamp(value: number): number {
  return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
}

function buttonFor(input: MatchInput, weapon: WeaponRuntime): boolean {
  return weapon.def.slot === "primary" ? input.primary : input.secondary;
}

function positionMotor(weapon: WeaponRuntime, target: number): void {
  if (!weapon.joint) return;
  const stroke = Math.max(weapon.def.strokeSec ?? 0.25, FIXED_DT);
  const stiffness = weapon.def.mass * 4 / (stroke * stroke);
  const damping = 4 * weapon.def.mass / stroke;
  weapon.joint.configureMotorPosition(target, stiffness, damping);
}

function updateWeapon(
  bot: AssembledBot,
  weapon: WeaponRuntime,
  input: MatchInput,
  enabled: boolean,
  events: SimEvent[]
): void {
  weapon.cooldownLeft = Math.max(0, weapon.cooldownLeft - FIXED_DT);
  weapon.triggerGapLeft = Math.max(0, weapon.triggerGapLeft - FIXED_DT);
  weapon.dryLockoutLeft = Math.max(0, weapon.dryLockoutLeft - FIXED_DT);
  const pressed = enabled && buttonFor(input, weapon);

  if (weapon.detached) {
    weapon.active = false;
    weapon.wasPressed = pressed;
    return;
  }

  if (weapon.def.action === "passive") {
    weapon.active = enabled;
  } else if (weapon.def.action === "held") {
    const capacity = weapon.def.fuel ?? 0;
    const unlimited = capacity <= 0;
    weapon.active =
      pressed && weapon.dryLockoutLeft === 0 && (unlimited || weapon.fuelLeft > 0);
    if (weapon.active && !unlimited) {
      weapon.fuelLeft = Math.max(0, weapon.fuelLeft - FIXED_DT);
      if (weapon.fuelLeft === 0) {
        weapon.active = false;
        weapon.dryLockoutLeft = DRY_LOCKOUT;
      }
    } else if (!pressed && !unlimited) {
      const refillSecondsPerSecond = Math.max(weapon.def.refuelRate ?? 1, FIXED_DT);
      weapon.fuelLeft = Math.min(capacity, weapon.fuelLeft + FIXED_DT / refillSecondsPerSecond);
    }
  } else {
    const rising = pressed && !weapon.wasPressed;
    if (rising && weapon.cooldownLeft === 0 && weapon.triggerGapLeft === 0) {
      weapon.active = true;
      weapon.cooldownLeft = Math.max(weapon.def.cooldown ?? 0, MIN_TRIGGER_GAP);
      weapon.triggerGapLeft = MIN_TRIGGER_GAP;
      weapon.strokeLeft =
        weapon.def.effect === "clamp"
          ? Math.max(weapon.def.holdSec ?? 0, weapon.def.strokeSec ?? 0)
          : Math.max(weapon.def.strokeSec ?? 0.25, FIXED_DT);
      weapon.impulseVictims.clear();
      positionMotor(weapon, weapon.def.sweep ?? 0);
      events.push({
        t: "fire",
        seat: bot.seat,
        slot: weapon.def.slot,
        effect: weapon.def.effect
      });
    }
    if (weapon.active) {
      weapon.strokeLeft = Math.max(0, weapon.strokeLeft - FIXED_DT);
      if (weapon.strokeLeft === 0 && weapon.clamping === null) {
        weapon.active = false;
        positionMotor(weapon, 0);
      }
    }
  }

  if (weapon.joint && (weapon.def.effect === "spin" || weapon.def.effect === "grind")) {
    const torque = (weapon.def.spinUpTorque ?? 0) * bot.weaponPowerMul;
    weapon.joint.configureMotorVelocity(weapon.active ? weapon.def.maxOmega ?? 0 : 0, torque);
  }
  weapon.wasPressed = pressed;
}

export function driveBot(
  bot: AssembledBot,
  input: MatchInput,
  phase: MatchPhase,
  frame: DriverFrame,
  events: SimEvent[]
): boolean {
  bot.selfRightCooldown = Math.max(0, bot.selfRightCooldown - FIXED_DT);
  const enabled = phase === "live";
  const throttle = enabled ? clamp(input.throttle) : 0;
  const steer = enabled ? clamp(input.steer) : 0;
  const left = clamp(throttle + steer);
  const right = clamp(throttle - steer);

  for (const drive of bot.drives) {
    if (drive.detached) continue;
    const command = drive.side < 0 ? left : right;
    drive.joint.configureMotorVelocity(
      -command * drive.def.maxOmega,
      drive.def.torque * bot.powerMul
    );
  }
  for (const weapon of bot.weapons) updateWeapon(bot, weapon, input, enabled, events);

  if (
    enabled &&
    input.selfRight &&
    frame.inverted &&
    bot.hasSelfRight &&
    bot.selfRightCooldown === 0
  ) {
    bot.chassis.applyImpulse({ x: 0, y: SELF_RIGHT_IMPULSE, z: 0 }, true);
    bot.selfRightCooldown = SELF_RIGHT_COOLDOWN;
    return true;
  }
  return false;
}
