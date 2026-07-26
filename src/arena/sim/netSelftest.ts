import { DRIVE_ANGULAR_DAMPING, DRIVE_LINEAR_DAMPING, FIXED_DT } from "./balance";
import { driveBot } from "./driver";
import { createMechanismHarness } from "./mechanismSelftestHarness";
import { arenaSimTestHooks } from "./world";

declare const process: { exitCode?: number };

const checks: Record<string, boolean | number> = {};
const assert = (name: string, value: boolean): void => {
  checks[name] = value;
  if (!value) throw new Error(name);
};

async function main(): Promise<void> {
  const { sim } = await createMechanismHarness();
  try {
    const hooks = arenaSimTestHooks(sim);
    if (!hooks) throw new Error("missing test hooks");
    const attacker = hooks.bots[0]!;
    const victim = hooks.bots[1]!;
    const input = {
      throttle: 1,
      steer: 0,
      primary: true,
      secondary: true,
      tertiary: true,
      selfRight: false
    };
    victim.assembled.chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
    driveBot(
      victim.assembled,
      input,
      "live",
      { inverted: false, alive: true, driveDisabled: true },
      []
    );
    assert(
      "weapons-alive",
      victim.assembled.weapons.some((weapon) => weapon.active)
    );
    hooks.world.step();
    const disabledSpeed = Math.hypot(
      victim.assembled.chassis.linvel().x,
      victim.assembled.chassis.linvel().z
    );
    assert("drive-disabled", disabledSpeed < 0.15);
    for (const weapon of victim.assembled.weapons) {
      if (weapon.body.isValid()) weapon.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    victim.immobileFor = 9.4;
    const controlBefore = attacker.control;
    hooks.damage.applyNet(victim.assembled.seat, attacker.assembled.seat, 0.35);
    let elapsed = 0;
    for (let step = 0; step < 18; step += 1) {
      elapsed += FIXED_DT;
      for (const bot of hooks.bots) {
        if (bot !== victim) bot.assembled.chassis.setLinvel({ x: 1, y: 0, z: 0 }, true);
      }
      hooks.damage.update(elapsed);
    }
    assert("immobile-frozen", Math.abs(victim.immobileFor - 9.4) < 1e-6);
    assert("no-immobile-ko", victim.alive);
    assert("control-credit", attacker.control > controlBefore);

    for (let step = 0; step < 8; step += 1) {
      elapsed += FIXED_DT;
      hooks.damage.update(elapsed);
    }
    assert(
      "damping-restored-first",
      Math.abs(victim.assembled.chassis.linearDamping() - DRIVE_LINEAR_DAMPING) < 1e-6 &&
        Math.abs(victim.assembled.chassis.angularDamping() - DRIVE_ANGULAR_DAMPING) < 1e-6
    );
    hooks.damage.applyNet(victim.assembled.seat, attacker.assembled.seat, 0.12);
    elapsed += FIXED_DT;
    hooks.damage.update(elapsed);
    assert("second-net-raised", victim.assembled.chassis.linearDamping() > DRIVE_LINEAR_DAMPING);
    for (let step = 0; step < 12; step += 1) {
      elapsed += FIXED_DT;
      hooks.damage.update(elapsed);
    }
    assert(
      "damping-restored-second",
      Math.abs(victim.assembled.chassis.linearDamping() - DRIVE_LINEAR_DAMPING) < 1e-6 &&
        Math.abs(victim.assembled.chassis.angularDamping() - DRIVE_ANGULAR_DAMPING) < 1e-6
    );

    const frozen = victim.immobileFor;
    for (let step = 0; step < 70; step += 1) {
      elapsed += FIXED_DT;
      hooks.damage.update(elapsed);
    }
    assert("release-grace", Math.abs(victim.immobileFor - frozen) < 0.05);
    checks.controlEarned = Number((attacker.control - controlBefore).toFixed(3));
    checks.frozenAt = frozen;
    console.log(`G-NET PASS ${JSON.stringify(checks)}`);
  } finally {
    sim.dispose();
  }
}

main().catch((error) => {
  console.error(`G-NET FAIL: ${String(error)}`);
  process.exitCode = 1;
});
