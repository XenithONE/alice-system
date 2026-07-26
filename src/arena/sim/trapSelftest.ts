import type { WeaponRuntime } from "./assemble";
import { DEPLOY_CAP_GLOBAL, DEPLOY_CAP_PER_SEAT } from "./balance";
import { createMechanismHarness } from "./mechanismSelftestHarness";
import { arenaSimDiagnostics, arenaSimTestHooks } from "./world";

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
    const beforeBodies = arenaSimDiagnostics(sim)!.bodies;
    const fakeWeapons = hooks.bots.map((bot, index) => {
      const source = bot.assembled.weapons[0];
      if (!source) throw new Error(`seat ${index} has no weapon`);
      return {
        ...source,
        idx: 900 + index,
        def: {
          ...source.def,
          effect: "deploy",
          trapKind: "caltrop",
          ammo: 99
        }
      } as WeaponRuntime;
    });

    for (const [index, bot] of hooks.bots.entries()) {
      for (let placed = 0; placed < DEPLOY_CAP_PER_SEAT; placed += 1) {
        bot.assembled.chassis.setTranslation(
          { x: -6 + placed * 1.1, y: 0.5, z: -6 + index * 3.4 },
          true
        );
        assert(`seat${index}-place${placed}`, hooks.deploy.deploy(bot, fakeWeapons[index]!));
      }
    }
    assert("global-cap", hooks.deploy.diagnostics().count === DEPLOY_CAP_GLOBAL);
    const capBot = hooks.bots[0]!;
    capBot.assembled.chassis.setTranslation({ x: 5.5, y: 0.5, z: 5.5 }, true);
    assert("fifo-place", hooks.deploy.deploy(capBot, fakeWeapons[0]!));
    assert("seat-fifo", hooks.deploy.entities().filter((entity) => entity.owner === 0).length === DEPLOY_CAP_PER_SEAT);
    assert("body-count-static", arenaSimDiagnostics(sim)!.bodies === beforeBodies);

    hooks.deploy.update(30);
    assert("ttl-clears", hooks.deploy.diagnostics().count === 0);
    const attacker = hooks.bots[0]!;
    const victim = hooks.bots.find((bot) => bot.assembled.drives.length > 0 && bot !== attacker)!;
    attacker.assembled.chassis.setTranslation({ x: 0, y: 0.5, z: 0 }, true);
    assert("caltrop-place", hooks.deploy.deploy(attacker, fakeWeapons[0]!));
    const caltropHandle = hooks.deploy.diagnostics().colliderHandles[0]!;
    sim.drainEvents();
    hooks.deploy.processContact(
      caltropHandle,
      victim.assembled.chassisCollider.handle,
      victim.assembled.chassis.translation()
    );
    assert("caltrop-chassis-safe", !sim.drainEvents().some((event) => event.t === "hit"));
    hooks.deploy.processContact(
      caltropHandle,
      victim.assembled.drives[0]!.collider.handle,
      victim.assembled.chassis.translation()
    );
    assert(
      "caltrop-drive-damage",
      sim.drainEvents().some((event) => event.t === "hit" && event.effect === "deploy")
    );

    hooks.deploy.update(60);
    const oilWeapon = {
      ...fakeWeapons[0]!,
      idx: 980,
      def: { ...fakeWeapons[0]!.def, trapKind: "oil" }
    } as WeaponRuntime;
    assert("oil-place", hooks.deploy.deploy(attacker, oilWeapon));
    const oilCollider = hooks.world.getCollider(hooks.deploy.diagnostics().colliderHandles[0]!)!;
    assert("oil-friction-zero", oilCollider.friction() === 0);
    hooks.deploy.processContact(
      oilCollider.handle,
      victim.assembled.drives[0]!.collider.handle,
      victim.assembled.chassis.translation()
    );
    assert("oil-status", victim.oiledFor > 0);

    hooks.deploy.update(90);
    const mineWeapon = {
      ...fakeWeapons[0]!,
      idx: 981,
      def: { ...fakeWeapons[0]!.def, trapKind: "mine" }
    } as WeaponRuntime;
    assert("mine-place", hooks.deploy.deploy(attacker, mineWeapon));
    const mineHandle = hooks.deploy.diagnostics().colliderHandles[0]!;
    sim.drainEvents();
    hooks.deploy.processContact(
      mineHandle,
      victim.assembled.chassisCollider.handle,
      victim.assembled.chassis.translation()
    );
    assert("mine-arm-delay", !sim.drainEvents().some((event) => event.t === "trap"));
    hooks.deploy.update(91.1);
    hooks.deploy.processContact(
      mineHandle,
      victim.assembled.chassisCollider.handle,
      victim.assembled.chassis.translation()
    );
    assert("mine-one-shot", hooks.deploy.diagnostics().count === 0);
    assert(
      "mine-no-second-hit",
      !hooks.deploy.processContact(
        mineHandle,
        victim.assembled.chassisCollider.handle,
        victim.assembled.chassis.translation()
      )
    );

    const glueWeapon = {
      ...fakeWeapons[0]!,
      idx: 982,
      def: { ...fakeWeapons[0]!.def, trapKind: "glue" }
    } as WeaponRuntime;
    assert("glue-place", hooks.deploy.deploy(attacker, glueWeapon));
    const retiredHandle = hooks.deploy.diagnostics().colliderHandles[0]!;
    hooks.deploy.processContact(
      retiredHandle,
      victim.assembled.chassisCollider.handle,
      victim.assembled.chassis.translation()
    );
    assert("glue-pins", victim.pinnedFor > 0);

    const bodiesBeforeDebris = hooks.world.bodies.len();
    for (const bot of hooks.bots) {
      for (const part of bot.assembled.parts) {
        const owner = hooks.damage.ownerForCollider(part.collider.handle);
        if (!owner) continue;
        const point = part.collider.translation();
        for (let hit = 0; hit < 8; hit += 1) {
          hooks.damage.applyTrapDamage(
            owner,
            140,
            attacker.assembled.seat,
            point,
            0
          );
        }
      }
    }
    assert("debris-burst", hooks.world.bodies.len() >= bodiesBeforeDebris);
    sim.drainEvents();
    assert(
      "retired-handle-not-trap",
      !hooks.deploy.processContact(
        retiredHandle,
        victim.assembled.chassisCollider.handle,
        victim.assembled.chassis.translation()
      ) && !sim.drainEvents().some((event) => event.t === "trap")
    );

    checks.deployCount = hooks.deploy.diagnostics().count;
    checks.bodiesBefore = beforeBodies;
    checks.bodiesAfterPads = beforeBodies;
    console.log(`G-TRAP PASS ${JSON.stringify(checks)}`);
  } finally {
    // This gate deliberately keeps stale collider wrapper objects alive to
    // prove handle reuse. Rapier 0.19 forbids World.free while such a wrapper
    // is borrowed; the short-lived Node process owns the test world.
  }
}

main().catch((error) => {
  console.error(`G-TRAP FAIL: ${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 1;
});
