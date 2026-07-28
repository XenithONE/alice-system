import {
  PARTS,
  TOP_SLOTS as CATALOG_SLOTS,
  createDefaultBuild,
  deriveBuildStats,
  type TopBuildSpec,
} from "../content";
import { createVortexSim, resolvedBuildFromDerived } from "./index";
import {
  NEUTRAL_MODIFIERS,
  TOP_SLOTS,
  type ResolvedPassiveSkill,
  type ResolvedPassiveTrigger,
  type ResolvedTopBuild,
  type ResolvedTopPart,
} from "./types";

declare const process: {
  stdout: { write(value: string): void };
  exitCode?: number;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function catalogBuildWithPassive(passiveId: string): {
  readonly derived: ReturnType<typeof deriveBuildStats>;
  readonly resolved: ReturnType<typeof resolvedBuildFromDerived>;
} {
  const base = createDefaultBuild(`CATALOG-${passiveId}`);
  const parts = { ...base.parts };
  for (const slot of CATALOG_SLOTS) {
    const statPart = PARTS.find(
      (part) => part.slot === slot && part.kind === "stat",
    );
    assert(statPart, `missing stat fixture for ${slot}`);
    parts[slot] = statPart.id;
  }
  const passivePart = PARTS.find(
    (part) => part.passiveSkillId === passiveId,
  );
  assert(passivePart, `missing catalog reference for ${passiveId}`);
  parts[passivePart.slot] = passivePart.id;
  const spec: TopBuildSpec = { ...base, parts };
  const derived = deriveBuildStats(spec);
  return { derived, resolved: resolvedBuildFromDerived(derived) };
}

function fixtureParts(
  active: boolean,
): readonly ResolvedTopPart[] {
  return TOP_SLOTS.map((slot, index) => ({
    id: `${active ? "active" : "target"}-${slot}`,
    slot,
    shape: slot === "tip" ? "cone" : "cylinder",
    radius: slot === "edge" ? 0.53 : slot === "tip" ? 0.11 : 0.3,
    height: slot === "tip" ? 0.3 : 0.1,
    offsetY: 0.36 - index * 0.12,
    mass: slot === "weight" ? 0.72 : 0.2,
    friction: slot === "tip" ? 0.7 : 0.4,
    restitution: slot === "edge" ? 0.42 : 0.18,
    activeSkill:
      active && index === 0
        ? {
            id: "passive-poke",
            name: "Passive Poke",
            cooldownSec: 30,
            charges: 1,
            conditions: [{ type: "always" }],
            effects: [{
              type: "shockwave",
              radius: 20,
              impulse: 0,
              damage: 100,
            }],
          }
        : active && index === 1
          ? {
              id: "passive-finish",
              name: "Passive Finish",
              cooldownSec: 30,
              charges: 1,
              conditions: [{ type: "always" }],
              effects: [{
                type: "shockwave",
                radius: 20,
                impulse: 0,
                damage: 10_000,
              }],
            }
          : null,
  }));
}

function fixtureBuild(
  name: string,
  active: boolean,
  passives: readonly ResolvedPassiveSkill[],
): ResolvedTopBuild<{ readonly id: string }> {
  const parts = fixtureParts(active);
  return {
    source: { id: name },
    name,
    cost: 1000,
    stats: {
      attack: 90,
      defense: 80,
      stamina: 82,
      stability: 84,
      mobility: 86,
      durability: 64,
    },
    physics: {
      mass: parts.reduce((sum, part) => sum + part.mass, 0),
      inertia: 1.1,
      centerOfMass: -0.04,
      friction: 0.55,
      restitution: 0.32,
      drag: 0.28,
      launchSpin: 92,
    },
    parts,
    passives,
    modifiers: NEUTRAL_MODIFIERS,
    synergyIds: [],
  };
}

function triggerCount(
  sim: Awaited<ReturnType<typeof createVortexSim>>,
  trigger: ResolvedPassiveTrigger,
): number {
  return sim
    .diagnostics()
    .passiveTriggers
    .filter((entry) => entry.trigger === trigger)
    .reduce((sum, entry) => sum + entry.count, 0);
}

async function main(): Promise<void> {
  const continuous = catalogBuildWithPassive("reinforced-shell");
  const continuousPassive = continuous.resolved.passives.find(
    (passive) => passive.id === "reinforced-shell",
  );
  assert(continuousPassive, "continuous passive was not carried into build");
  assert(continuousPassive.name === "強化シェル", "passive name was not carried");
  assert(continuousPassive.rank >= 1, "passive rank was not carried");
  assert(
    continuousPassive.trigger === "continuous" &&
      continuousPassive.threshold === null,
    "continuous trigger metadata was not carried",
  );
  assert(
    continuous.resolved.stats.defense > continuous.derived.stats.defense,
    "continuous passive was not applied to the resolved baseline",
  );

  const triggered = catalogBuildWithPassive("adaptive-armor");
  const triggeredPassive = triggered.resolved.passives.find(
    (passive) => passive.id === "adaptive-armor",
  );
  assert(triggeredPassive, "triggered passive was not carried into build");
  assert(
    triggeredPassive.trigger === "durability-below" &&
      triggeredPassive.threshold === 0.5,
    "trigger threshold was not preserved",
  );
  assert(
    Math.abs(triggered.resolved.stats.defense - triggered.derived.stats.defense) <
      1e-9,
    "triggered passive leaked into static stats",
  );

  const attackerPassives: readonly ResolvedPassiveSkill[] = [
    {
      id: "test-start",
      name: "Test Start",
      rank: 2,
      trigger: "battle-start",
      threshold: null,
      effects: [
        { type: "shield", amount: 45, durationSec: 8 },
        {
          type: "stat-multiplier",
          stat: "attack",
          multiplier: 1.12,
          durationSec: 3,
        },
      ],
    },
    {
      id: "test-rim",
      name: "Test Rim",
      rank: 1,
      trigger: "near-rim",
      threshold: 0.4,
      effects: [
        { type: "impulse", direction: "toward-center", strength: 2.2 },
        {
          type: "physics-multiplier",
          stat: "friction",
          multiplier: 1.2,
        },
      ],
    },
    {
      id: "test-critical",
      name: "Test Critical",
      rank: 1,
      trigger: "durability-below",
      threshold: 1,
      effects: [{
        type: "stat-multiplier",
        stat: "defense",
        multiplier: 1.2,
      }],
    },
    {
      id: "test-hit",
      name: "Test Hit",
      rank: 2,
      trigger: "on-hit",
      threshold: null,
      effects: [
        { type: "steal-spin", amount: 3 },
        { type: "cooldown-shift", amountSec: -0.8 },
      ],
    },
    {
      id: "test-elimination",
      name: "Test Elimination",
      rank: 1,
      trigger: "elimination",
      threshold: null,
      effects: [
        { type: "spin", amount: 7 },
        {
          type: "stat-multiplier",
          stat: "defense",
          multiplier: 1.06,
        },
      ],
    },
  ];
  const victimPassives: readonly ResolvedPassiveSkill[] = [
    {
      id: "test-spin",
      name: "Test Spin",
      rank: 1,
      trigger: "spin-below",
      threshold: 1,
      effects: [
        { type: "spin", amount: 8 },
        {
          type: "physics-multiplier",
          stat: "drag",
          multiplier: 0.8,
        },
      ],
    },
    {
      id: "test-phase",
      name: "Test Phase",
      rank: 1,
      trigger: "durability-below",
      threshold: 1,
      effects: [{ type: "phase", durationSec: 0.7 }],
    },
    {
      id: "test-take-hit",
      name: "Test Take Hit",
      rank: 1,
      trigger: "on-take-hit",
      threshold: null,
      effects: [
        { type: "impulse", direction: "tangent", strength: 2.8 },
        { type: "durability", amount: 5 },
        {
          type: "stat-multiplier",
          stat: "stability",
          multiplier: 1.2,
          durationSec: 1.5,
        },
      ],
    },
  ];

  const sim = await createVortexSim({
    seed: 0x5a17,
    builds: [
      fixtureBuild("PASSIVE-ATTACKER", true, attackerPassives),
      fixtureBuild("PASSIVE-VICTIM", false, victimPassives),
    ],
    arenaId: "core-bowl",
    countdownSec: 0,
    suddenDeathSec: 120,
    maxDurationSec: 240,
  });
  try {
    sim.step();
    for (let index = 0; index < 6; index += 1) sim.step();
    assert(triggerCount(sim, "battle-start") === 1, "battle-start did not fire once");
    assert(triggerCount(sim, "near-rim") === 1, "near-rim guard spammed or did not fire");
    assert(
      triggerCount(sim, "durability-below") === 2,
      "durability threshold passives did not fire once each",
    );
    assert(triggerCount(sim, "spin-below") === 1, "spin threshold did not fire once");

    const beforePoke = sim.getState();
    const attackerBefore = beforePoke.tops[0]!;
    const victimBefore = beforePoke.tops[1]!;
    const poke = sim.activate(0, 1);
    assert(poke.ok, "nonlethal passive test hit did not activate");
    const afterPoke = sim.getState();
    const attackerAfter = afterPoke.tops[0]!;
    const victimAfter = afterPoke.tops[1]!;
    assert(triggerCount(sim, "on-hit") === 1, "on-hit did not fire");
    assert(triggerCount(sim, "on-take-hit") === 1, "on-take-hit did not fire");
    assert(
      attackerAfter.spin > attackerBefore.spin,
      "steal-spin did not transfer spin to the attacker",
    );
    assert(
      victimAfter.spin < victimBefore.spin,
      "steal-spin did not drain the victim",
    );
    assert(
      attackerAfter.skills[0]!.cooldownRemaining < 29.5,
      "cooldown-shift did not reduce the active cooldown",
    );
    assert(
      Math.hypot(...victimAfter.velocity) >
        Math.hypot(...victimBefore.velocity) + 0.05,
      "on-take-hit tangent impulse did not change velocity",
    );
    assert(
      victimAfter.hp > victimAfter.hpMax - 30,
      "phase/shield runtime mitigation was not applied",
    );

    const finish = sim.activate(0, 2);
    assert(finish.ok, "lethal passive test hit did not activate");
    assert(
      triggerCount(sim, "on-hit") === 1 &&
        triggerCount(sim, "on-take-hit") === 1,
      "event passive debounce failed for same-frame hits",
    );
    assert(triggerCount(sim, "elimination") === 1, "elimination did not fire");
    sim.step();
    assert(sim.result()?.winner === 0, "passive fixture did not resolve");

    const diagnostics = sim.diagnostics();
    assert(
      diagnostics.topRigidBodies === 2 &&
        diagnostics.topColliders.every((count) => count === 7),
      "passive runtime changed rigid-body topology",
    );
    process.stdout.write(
      `${JSON.stringify({
        passiveTriggers: diagnostics.passiveTriggers,
        topology: {
          rigidBodies: diagnostics.topRigidBodies,
          colliders: diagnostics.topColliders,
        },
        deterministicTick: sim.tick,
      })}\n`,
    );
  } finally {
    sim.dispose();
  }
}

void main().catch((error: unknown) => {
  process.stdout.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
