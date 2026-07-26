import type RAPIER from "@dimforge/rapier3d-compat";
import {
  DRY_LOCKOUT,
  DRIVE_TRACTION_ASSIST,
  FIXED_DT,
  FUEL_L_PER_SEC,
  MIN_TRIGGER_GAP,
  SELF_RIGHT_CHARGE_KJ,
  SELF_RIGHT_COOLDOWN,
  SELF_RIGHT_IMPULSE,
  WEAPON_SPINUP_SEC,
  YAW_HOLD_ASSIST
} from "./balance";
import type { AssembledBot, WeaponRuntime } from "./assemble";
import { chassisForward } from "./heading";
import { updateInternals, weaponChargeCostKj } from "./internals";
import { allocatePower, rotaryTorqueLimit } from "./power";
import type { MatchInput, MatchPhase, SimEvent } from "./types";

export interface DriverFrame {
  readonly inverted: boolean;
  readonly alive?: boolean;
  /** Enemy holds stop only the drive; weapons deliberately remain enabled. */
  readonly driveDisabled?: boolean;
  /** Oil leaves steering available but weakens the non-contact traction assist. */
  readonly tractionMul?: number;
}

export interface DriverTuning {
  readonly yawHoldAssist: number;
  readonly weaponSpinupSec: number;
}

export const DEFAULT_DRIVER_TUNING: DriverTuning = {
  yawHoldAssist: YAW_HOLD_ASSIST,
  weaponSpinupSec: WEAPON_SPINUP_SEC
};

function clamp(value: number): number {
  return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
}

function buttonFor(input: MatchInput, weapon: WeaponRuntime): boolean {
  if (weapon.def.slot === "primary") return input.primary;
  if (weapon.def.slot === "secondary") return input.secondary;
  return input.tertiary;
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
  events: SimEvent[],
  tuning: DriverTuning,
  allocatedW: number
): void {
  weapon.cooldownLeft = Math.max(0, weapon.cooldownLeft - FIXED_DT);
  weapon.triggerGapLeft = Math.max(0, weapon.triggerGapLeft - FIXED_DT);
  weapon.dryLockoutLeft = Math.max(0, weapon.dryLockoutLeft - FIXED_DT);
  const pressed = enabled && buttonFor(input, weapon);

  if (weapon.detached) {
    weapon.active = false;
    weapon.spinTarget = 0;
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
    }
  } else {
    const rising = pressed && !weapon.wasPressed;
    const chargeCostKj = weaponChargeCostKj(weapon.def);
    if (
      rising &&
      weapon.cooldownLeft === 0 &&
      weapon.triggerGapLeft === 0 &&
      bot.chargeKj >= chargeCostKj
    ) {
      bot.chargeKj -= chargeCostKj;
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
    const maxOmega = weapon.def.maxOmega ?? 0;
    const desired = weapon.active ? maxOmega : 0;
    const torque =
      desired > 0
        ? rotaryTorqueLimit(weapon, allocatedW, bot.weaponPowerMul)
        : (weapon.def.spinUpTorque ?? 0) * bot.weaponPowerMul;
    const inertia = Math.max(weapon.def.inertia ?? 0, Number.EPSILON);
    const delta = torque / inertia * FIXED_DT;
    weapon.spinTarget =
      desired > weapon.spinTarget
        ? Math.min(desired, weapon.spinTarget + delta)
        : Math.max(desired, weapon.spinTarget - delta);
    weapon.joint.configureMotorVelocity(weapon.spinTarget, torque);
  }
  weapon.wasPressed = pressed;
}

function refillHeldWeapons(
  bot: AssembledBot,
  input: MatchInput,
  enabled: boolean
): void {
  if (!enabled || bot.fuelL <= 0) return;
  const demands = bot.weapons.map((weapon) => {
    const capacity = weapon.def.fuel ?? 0;
    if (
      weapon.detached ||
      weapon.def.action !== "held" ||
      capacity <= 0 ||
      buttonFor(input, weapon)
    ) {
      return 0;
    }
    const refillSecondsPerSecond = Math.max(
      weapon.def.refuelRate ?? 1,
      FIXED_DT
    );
    const recoverSec = Math.min(
      capacity - weapon.fuelLeft,
      FIXED_DT / refillSecondsPerSecond
    );
    return Math.max(0, recoverSec) * FUEL_L_PER_SEC;
  });
  const totalNeedL = demands.reduce((sum, value) => sum + value, 0);
  if (totalNeedL <= 0) return;
  let spentL = 0;
  for (const [index, needL] of demands.entries()) {
    if (needL <= 0) continue;
    const allocatedL = Math.min(
      needL,
      bot.fuelL * needL / totalNeedL
    );
    bot.weapons[index]!.fuelLeft += allocatedL / FUEL_L_PER_SEC;
    spentL += allocatedL;
  }
  bot.fuelL = Math.max(0, bot.fuelL - spentL);
}

function totalBotMass(bot: AssembledBot): number {
  let mass = bot.chassis.mass();
  const bodies = new Set<number>([bot.chassis.handle]);
  for (const part of [...bot.drives, ...bot.weapons]) {
    if (part.detached || !part.body.isValid() || bodies.has(part.body.handle)) continue;
    bodies.add(part.body.handle);
    mass += part.body.mass();
  }
  return Math.max(mass, Number.EPSILON);
}

/**
 * The reaction brake: the path a weapon's spin-up torque takes into the floor.
 *
 * Without it a passive rotor's reaction goes straight into the chassis and the
 * machine turns itself — measured at -146 deg in the first second for a heavy
 * disc and -178 for a front drum. The linear traction assist could never have
 * helped, because it is an impulse along the forward axis with y pinned to zero.
 *
 * All three axes, not just yaw. A rotor's reaction lands on the axis its joint
 * turns about, and that depends on the mount face: a horizontal spinner on the
 * deck reacts in yaw, but the same weapon on the front or the rear reacts in
 * ROLL, and a vertical spinner reacts in PITCH about the wheels' own axle line —
 * the one rotation the drivetrain does not constrain at all. A yaw-only brake
 * leaves those two free, and a yaw-only gate cannot even see them: the tire-shred
 * preset, which carries a low saw front and back, rolled 1,075 degrees.
 *
 * Each axis is capped by what the machine could actually resist through its
 * contact patches — yaw by the tyres' grip across the track, pitch and roll by
 * the moment that would tip it — so a machine with no wheels gets no help and a
 * machine with one side of them gets half. Steering suppresses yaw only; you
 * should still be able to spin turn while the brake holds the other two.
 */
function applyReactionBrake(bot: AssembledBot, steer: number, tuning: DriverTuning): void {
  if (tuning.yawHoldAssist <= 0) return;
  const drives = bot.drives.filter((drive) => !drive.detached);
  if (drives.length < 2) return;

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let tractionForce = 0;
  for (const drive of drives) {
    minX = Math.min(minX, drive.local[0]);
    maxX = Math.max(maxX, drive.local[0]);
    minZ = Math.min(minZ, drive.local[2]);
    maxZ = Math.max(maxZ, drive.local[2]);
    tractionForce +=
      drive.def.torque * bot.powerMul /
      Math.max(drive.def.radius, Number.EPSILON);
  }
  const trackHalf = Math.max(0, maxX - minX) / 2;
  const baseHalf = Math.max(0, maxZ - minZ) / 2;

  // chassis.mass() counts the hull only; every wheel is its own rigid body, and
  // it is exactly the light machines that flip worst.
  let totalMass = bot.chassis.mass();
  for (const part of bot.parts) {
    if (part.detached || part.body === bot.chassis) continue;
    if (part.body.isValid()) totalMass += part.body.mass();
  }
  const weight = totalMass * 9.81;

  // No traction to push against while the machine is off the ground.
  const grounded = Math.max(0, 1 - Math.abs(bot.chassis.linvel().y) / 2);
  if (grounded <= 0) return;

  const caps = {
    x: weight * baseHalf,                       // pitch: the tipping moment
    y: tractionForce * trackHalf,               // yaw: what the tyres can bite
    z: weight * trackHalf                       // roll: the tipping moment
  };
  const rate = bot.chassis.angvel();
  const inertia = bot.chassis.principalInertia();
  const scale = tuning.yawHoldAssist * grounded;
  const brake = (axisRate: number, axisInertia: number, cap: number): number => {
    const limit = Math.max(0, cap) * scale;
    if (limit <= 0) return 0;
    const requested = -axisRate * Math.max(axisInertia, Number.EPSILON) / FIXED_DT;
    return Math.max(-limit, Math.min(limit, requested));
  };
  bot.chassis.addTorque(
    {
      x: brake(rate.x, inertia.x, caps.x),
      y: Math.abs(steer) >= 0.05 ? 0 : brake(rate.y, inertia.y, caps.y),
      z: brake(rate.z, inertia.z, caps.z)
    },
    true
  );
}

export function driveBot(
  bot: AssembledBot,
  input: MatchInput,
  phase: MatchPhase,
  frame: DriverFrame,
  events: SimEvent[],
  tuning: DriverTuning = DEFAULT_DRIVER_TUNING
): boolean {
  bot.selfRightCooldown = Math.max(0, bot.selfRightCooldown - FIXED_DT);
  const alive = frame.alive !== false;
  const enabled = phase === "live" && alive;
  const driveEnabled = enabled && frame.driveDisabled !== true;
  const alloc = allocatePower(bot, input, phase, alive);
  const throttle = driveEnabled ? clamp(input.throttle) : 0;
  const steer = driveEnabled ? clamp(input.steer) : 0;
  const left = clamp(throttle + steer);
  const right = clamp(throttle - steer);
  let driveCommand = 0;
  let driveCount = 0;
  let tractionAcceleration = 0;
  let targetSpeed = Number.POSITIVE_INFINITY;

  for (const drive of bot.drives) {
    if (drive.detached) continue;
    const command = drive.side < 0 ? left : right;
    driveCommand += command;
    driveCount += 1;
    tractionAcceleration += drive.def.torque / Math.max(drive.def.radius, Number.EPSILON);
    targetSpeed = Math.min(targetSpeed, drive.def.maxOmega * drive.def.radius);
    drive.joint.configureMotorVelocity(
      -command * drive.def.maxOmega,
      driveEnabled ? drive.def.torque * bot.powerMul * alloc.driveScale : 0
    );
  }
  if (driveCount > 0 && Math.abs(driveCommand) > Number.EPSILON) {
    const averageCommand = driveCommand / driveCount;
    const q = bot.chassis.rotation();
    const forward = chassisForward(q);
    const dirX = forward.x;
    const dirZ = forward.z;
    const velocity = bot.chassis.linvel();
    const current = velocity.x * dirX + velocity.z * dirZ;
    const desired = averageCommand * targetSpeed;
    // chassis.mass() excludes the separately simulated wheels and rotors.
    const mass = totalBotMass(bot);
    const maxDelta =
      tractionAcceleration * bot.powerMul * alloc.driveScale /
      mass * DRIVE_TRACTION_ASSIST * (frame.tractionMul ?? 1) * FIXED_DT;
    const delta = Math.max(-maxDelta, Math.min(maxDelta, desired - current));
    bot.chassis.applyImpulse(
      { x: dirX * delta * mass, y: 0, z: dirZ * delta * mass },
      true
    );
  }
  if (driveEnabled) applyReactionBrake(bot, steer, tuning);
  refillHeldWeapons(bot, input, enabled);
  for (const [index, weapon] of bot.weapons.entries()) {
    updateWeapon(bot, weapon, input, enabled, events, tuning, alloc.weaponW[index] ?? 0);
  }

  let flipped = false;
  if (
    enabled &&
    input.selfRight &&
    frame.inverted &&
    bot.hasSelfRight &&
    bot.selfRightCooldown === 0 &&
    bot.chargeKj >= SELF_RIGHT_CHARGE_KJ
  ) {
    bot.chargeKj -= SELF_RIGHT_CHARGE_KJ;
    bot.chassis.applyImpulse({ x: 0, y: SELF_RIGHT_IMPULSE, z: 0 }, true);
    bot.selfRightCooldown = SELF_RIGHT_COOLDOWN;
    flipped = true;
  }
  updateInternals(bot, alloc.usedW, alloc.surplusW, enabled);
  return flipped;
}
