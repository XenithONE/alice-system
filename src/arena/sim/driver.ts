import type RAPIER from "@dimforge/rapier3d-compat";
import {
  FIXED_DT,
  SELF_RIGHT_COOLDOWN,
  SELF_RIGHT_IMPULSE
} from "./balance";
import type { AssembledBot } from "./assemble";
import type { MatchInput, MatchPhase } from "./types";

export interface DriverFrame {
  readonly inverted: boolean;
}

function clamp(value: number): number {
  return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
}

function worldAxis(body: RAPIER.RigidBody, axis: "x" | "y"): readonly [number, number, number] {
  const q = body.rotation();
  if (axis === "y") {
    return [
      2 * (q.x * q.y - q.w * q.z),
      1 - 2 * (q.x * q.x + q.z * q.z),
      2 * (q.y * q.z + q.w * q.x)
    ];
  }
  return [
    1 - 2 * (q.y * q.y + q.z * q.z),
    2 * (q.x * q.y + q.w * q.z),
    2 * (q.x * q.z - q.w * q.y)
  ];
}

export function driveBot(
  bot: AssembledBot,
  input: MatchInput,
  phase: MatchPhase,
  frame: DriverFrame
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

  const weapon = bot.weapon;
  if (weapon && !weapon.detached && weapon.joint) {
    if (weapon.def.motion === "spin") {
      const target = enabled && input.weapon ? weapon.def.maxOmega ?? 0 : 0;
      const motorFactor =
        enabled && input.weapon
          ? weapon.def.spinUpTorque ?? 0
          : (weapon.def.spinUpTorque ?? 0) * FIXED_DT;
      weapon.joint.configureMotorVelocity(target, motorFactor);
    } else if (weapon.def.motion === "swing") {
      weapon.cooldownLeft = Math.max(0, weapon.cooldownLeft - FIXED_DT);
      if (weapon.swinging && weapon.cooldownLeft <= (weapon.def.cooldown ?? 0) - FIXED_DT) {
        weapon.swinging = false;
        weapon.swingTarget = 0;
        weapon.joint.configureMotorPosition(0, weapon.def.impulse ?? 0, weapon.def.mass);
      }
      if (enabled && input.weapon && weapon.cooldownLeft === 0) {
        weapon.cooldownLeft = weapon.def.cooldown ?? 0;
        weapon.swinging = true;
        weapon.swingTarget = weapon.def.sweep ?? 0;
        weapon.joint.configureMotorPosition(
          weapon.swingTarget,
          (weapon.def.impulse ?? 0) / FIXED_DT,
          weapon.def.mass / FIXED_DT
        );
        const axis = worldAxis(bot.chassis, "x");
        const impulse = weapon.def.impulse ?? 0;
        weapon.body.applyTorqueImpulse(
          { x: axis[0] * impulse, y: axis[1] * impulse, z: axis[2] * impulse },
          true
        );
      }
    }
  }

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
