import RAPIER from "@dimforge/rapier3d-compat";
import { buildCatalog, PRESETS } from "../parts/catalog";
import { assembleBot, type AssembledBot } from "./assemble";
import {
  FIXED_DT,
  MAX_SPINUP_SEC,
  WEAPON_SPINUP_SEC,
  YAW_HOLD_ASSIST
} from "./balance";
import {
  DEFAULT_DRIVER_TUNING,
  driveBot,
  type DriverTuning
} from "./driver";
import {
  NEUTRAL_INPUT,
  type BotSpec,
  type MatchInput,
  type MatchPhase
} from "./types";

declare const process: { exitCode?: number };

const LIVE_STEPS = Math.round(3 / FIXED_DT);
const STEER_STEPS = Math.round(2 / FIXED_DT);
const MAX_NEUTRAL_YAW_DEG = 25;
const MIN_STEER_YAW_DEG = 90;
const LEGACY_TUNING: DriverTuning = {
  yawHoldAssist: 0,
  weaponSpinupSec: 0
};
const STEER_RIGHT: MatchInput = {
  ...NEUTRAL_INPUT,
  steer: 1
};

interface Harness {
  readonly world: RAPIER.World;
  readonly bot: AssembledBot;
}

function createHarness(spec: BotSpec): Harness {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = FIXED_DT;
  const floor = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0)
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(20, 1, 20).setFriction(1.35),
    floor
  );
  return {
    world,
    bot: assembleBot(world, spec, buildCatalog(), 0, [0, 0, 0], 0)
  };
}

function yaw(rotation: RAPIER.Rotation): number {
  return Math.atan2(
    2 * (rotation.w * rotation.y + rotation.x * rotation.z),
    1 - 2 * (rotation.y * rotation.y + rotation.z * rotation.z)
  );
}

function wrappedDelta(next: number, previous: number): number {
  return Math.atan2(Math.sin(next - previous), Math.cos(next - previous));
}

function stepHarness(
  harness: Harness,
  input: MatchInput,
  tuning: DriverTuning,
  phase: MatchPhase = "live"
): void {
  driveBot(harness.bot, input, phase, { inverted: false }, [], tuning);
  harness.world.step();
}

function measureYaw(
  spec: BotSpec,
  steps: number,
  input: MatchInput,
  tuning: DriverTuning
): number {
  const harness = createHarness(spec);
  let previous = yaw(harness.bot.chassis.rotation());
  let cumulative = 0;
  for (let step = 0; step < steps; step += 1) {
    stepHarness(harness, input, tuning);
    const current = yaw(harness.bot.chassis.rotation());
    cumulative += wrappedDelta(current, previous);
    previous = current;
  }
  harness.world.free();
  return cumulative * 180 / Math.PI;
}

function measureSpinTargets(): {
  readonly rows: {
    preset: string;
    weapon: string;
    spin95Sec: number | null;
    spinDown95Sec: number | null;
    pass: boolean;
  }[];
  readonly pass: boolean;
} {
  const rows = PRESETS.flatMap((preset) => {
    const harness = createHarness(preset);
    const passive = harness.bot.weapons.filter(
      (weapon) =>
        weapon.def.action === "passive" &&
        (weapon.def.effect === "spin" || weapon.def.effect === "grind")
    );
    const reached = new Map<number, number>();
    for (let step = 1; step <= Math.ceil(MAX_SPINUP_SEC / FIXED_DT); step += 1) {
      stepHarness(harness, NEUTRAL_INPUT, DEFAULT_DRIVER_TUNING);
      for (const weapon of passive) {
        const maxOmega = weapon.def.maxOmega ?? 0;
        if (!reached.has(weapon.idx) && weapon.spinTarget >= maxOmega * 0.95) {
          reached.set(weapon.idx, step * FIXED_DT);
        }
      }
    }
    const downStart = passive.map((weapon) => weapon.spinTarget);
    const downReached = new Map<number, number>();
    for (let step = 1; step <= Math.ceil(MAX_SPINUP_SEC / FIXED_DT); step += 1) {
      stepHarness(harness, NEUTRAL_INPUT, DEFAULT_DRIVER_TUNING, "countdown");
      for (const weapon of passive) {
        if (
          !downReached.has(weapon.idx) &&
          weapon.spinTarget <= downStart[passive.indexOf(weapon)]! * 0.05
        ) {
          downReached.set(weapon.idx, step * FIXED_DT);
        }
      }
    }
    const presetRows = passive.map((weapon) => {
      const spin95Sec = reached.get(weapon.idx) ?? null;
      const spinDown95Sec = downReached.get(weapon.idx) ?? null;
      return {
        preset: preset.name,
        weapon: weapon.def.id,
        spin95Sec,
        spinDown95Sec,
        pass:
          spin95Sec !== null &&
          spin95Sec > FIXED_DT &&
          spin95Sec <= MAX_SPINUP_SEC &&
          spinDown95Sec !== null &&
          spinDown95Sec > FIXED_DT &&
          spinDown95Sec <= MAX_SPINUP_SEC
      };
    });
    harness.world.free();
    return presetRows;
  });
  return { rows, pass: rows.length > 0 && rows.every((row) => row.pass) };
}

async function main(): Promise<void> {
  await RAPIER.init();

  const yawRows = PRESETS.map((preset) => {
    const fixedYawDeg = measureYaw(
      preset,
      LIVE_STEPS,
      NEUTRAL_INPUT,
      DEFAULT_DRIVER_TUNING
    );
    const legacyYawDeg = measureYaw(
      preset,
      LIVE_STEPS,
      NEUTRAL_INPUT,
      LEGACY_TUNING
    );
    return {
      preset: preset.name,
      fixedYawDeg: Number(fixedYawDeg.toFixed(1)),
      fixedPass: Math.abs(fixedYawDeg) <= MAX_NEUTRAL_YAW_DEG,
      legacyYawDeg: Number(legacyYawDeg.toFixed(1)),
      legacyPass: Math.abs(legacyYawDeg) <= MAX_NEUTRAL_YAW_DEG
    };
  });
  const neutralPass = yawRows.every((row) => row.fixedPass);
  const legacyGatePass = yawRows.every((row) => row.legacyPass);
  console.log("1 NEUTRAL YAW / 2 LEGACY INJECTION");
  console.table(yawRows);
  console.log("NEUTRAL YAW GATE", {
    limitDeg: MAX_NEUTRAL_YAW_DEG,
    pass: neutralPass
  });
  console.log("OLD BEHAVIOR INJECTION", {
    injected: "yawHoldAssist=0, weaponSpinupSec=0",
    gatePass: legacyGatePass,
    expected: false
  });

  const spinTargets = measureSpinTargets();
  console.log("3 POWER-LIMITED SPIN TARGET");
  console.table(spinTargets.rows);
  console.log("POWER SPIN GATE", {
    legacyWeaponSpinupSec: WEAPON_SPINUP_SEC,
    maximumSec: MAX_SPINUP_SEC,
    pass: spinTargets.pass
  });

  const steeringPreset = PRESETS.find((preset) => preset.name === "spin-king")!;
  const steeringYawDeg = measureYaw(
    steeringPreset,
    STEER_STEPS,
    STEER_RIGHT,
    DEFAULT_DRIVER_TUNING
  );
  const steeringPass = Math.abs(steeringYawDeg) >= MIN_STEER_YAW_DEG;
  console.log("4 STEERING AUTHORITY", {
    preset: steeringPreset.name,
    steer: 1,
    durationSec: STEER_STEPS * FIXED_DT,
    yawDeg: Number(steeringYawDeg.toFixed(1)),
    minimumDeg: MIN_STEER_YAW_DEG,
    pass: steeringPass
  });
  console.log("BALANCE CONSTANTS", {
    YAW_HOLD_ASSIST,
    WEAPON_SPINUP_SEC
  });

  const passed =
    neutralPass &&
    !legacyGatePass &&
    spinTargets.pass &&
    steeringPass;
  console.log(passed ? "SPINUP SELFTEST PASS" : "SPINUP SELFTEST FAIL");
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error("SPINUP SELFTEST FAIL:", error);
  process.exitCode = 1;
});
