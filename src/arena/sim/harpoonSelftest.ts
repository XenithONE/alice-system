import RAPIER from "@dimforge/rapier3d-compat";
import { FIXED_DT, TETHER_MIN_LEN } from "./balance";
import { applyWinchImpulse } from "./projectile";
import { initPhysics } from "./world";

declare const process: { exitCode?: number };

const checks: Record<string, boolean | number> = {};
const assert = (name: string, value: boolean): void => {
  checks[name] = value;
  if (!value) throw new Error(name);
};

function body(
  world: RAPIER.World,
  x: number,
  mass: number
): RAPIER.RigidBody {
  const rigidBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, 0, 0)
      .setLinearDamping(0)
      .setAngularDamping(0)
  );
  world.createCollider(RAPIER.ColliderDesc.ball(0.1).setMass(mass), rigidBody);
  return rigidBody;
}

async function main(): Promise<void> {
  await initPhysics();
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  world.timestep = FIXED_DT;
  try {
    const jointsBefore = world.impulseJoints.len();
    const attacker = body(world, -2, 40);
    const victim = body(world, 2, 120);
    const attackerStart = attacker.translation().x;
    const victimStart = victim.translation().x;
    let previous = 4;
    let monotonic = true;
    for (let step = 0; step < 240; step += 1) {
      applyWinchImpulse(attacker, victim, 1.2);
      world.step();
      const distance = Math.abs(attacker.translation().x - victim.translation().x);
      if (distance > previous + 0.002) monotonic = false;
      previous = distance;
    }
    const attackerMove = Math.abs(attacker.translation().x - attackerStart);
    const victimMove = Math.abs(victim.translation().x - victimStart);
    assert("distance-monotonic", monotonic);
    assert("stops-at-min", Math.abs(previous - TETHER_MIN_LEN) < 0.04);
    assert("mass-reaction", attackerMove >= victimMove * 2);

    attacker.setTranslation({ x: -2.1, y: 0, z: 0 }, true);
    victim.setTranslation({ x: 2.1, y: 0, z: 0 }, true);
    attacker.setLinvel({ x: -5, y: 0, z: 0 }, true);
    victim.setLinvel({ x: 5, y: 0, z: 0 }, true);
    const tautBefore = Math.abs(attacker.translation().x - victim.translation().x);
    const tension = applyWinchImpulse(attacker, victim, 0);
    world.step();
    const tautAfter = Math.abs(attacker.translation().x - victim.translation().x);
    assert("tension-holds", !tension.broken && tautAfter <= tautBefore + 0.005);

    attacker.setLinvel({ x: -20, y: 0, z: 0 }, true);
    victim.setLinvel({ x: 20, y: 0, z: 0 }, true);
    const cut = applyWinchImpulse(attacker, victim, 1.2);
    assert("break-releases", cut.broken);
    assert("no-impulse-joint", world.impulseJoints.len() === jointsBefore);
    checks.attackerMove = Number(attackerMove.toFixed(3));
    checks.victimMove = Number(victimMove.toFixed(3));
    checks.finalDistance = Number(previous.toFixed(3));
    checks.jointsBefore = jointsBefore;
    checks.jointsAfter = world.impulseJoints.len();
    console.log(`G-HARPOON PASS ${JSON.stringify(checks)}`);
  } finally {
    world.free();
  }
}

main().catch((error) => {
  console.error(`G-HARPOON FAIL: ${String(error)}`);
  process.exitCode = 1;
});
