import { EDGE_EARLY_GUARD_SEC, FIXED_DT } from "./balance";
import { createDefaultBuild, deriveBuildStats } from "../content";
import {
  aiActivation,
  createVortexSim,
  resolvedBuildFromDerived,
  RING_ARENAS,
} from "./index";
import {
  NEUTRAL_MODIFIERS,
  TOP_SLOTS,
  type ResolvedTopBuild,
  type ResolvedTopPart,
  type SeatIndex,
} from "./types";

declare const process: {
  stdout: { write(value: string): void };
  exitCode?: number;
};

function fixtureBuild(index: number): ResolvedTopBuild<{ readonly id: string }> {
  const parts: ResolvedTopPart[] = TOP_SLOTS.map((slot, partIndex) => ({
    id: `fixture-${index}-${slot}`,
    slot,
    radius:
      slot === "edge"
        ? 0.72 + index * 0.025
        : slot === "tip"
          ? 0.2
          : 0.34 + (partIndex % 3) * 0.06,
    height: slot === "weight" ? 0.11 : 0.065,
    mass: slot === "weight" ? 0.72 : 0.19 + partIndex * 0.025,
    friction: slot === "tip" ? 0.72 : 0.43,
    restitution: slot === "edge" ? 0.48 : 0.17,
    activeSkill:
      partIndex === 0
        ? {
            id: `surge-${index}`,
            name: "Surge",
            cooldownSec: 1.8,
            charges: -1,
            conditions: [{ type: "always" }],
            effects: [
              { type: "dash", impulse: 2.8 + index * 0.1 },
              { type: "spin-boost", radiansPerSec: 2 },
            ],
          }
        : partIndex === 2
          ? {
              id: `burst-${index}`,
              name: "Burst",
              cooldownSec: index === 0 ? 0.35 : 4,
              charges: index === 0 ? 5 : 3,
              conditions: [
                { type: "target-within", distance: index === 0 ? 10 : 3.2 },
              ],
              effects: [
                {
                  type: "shockwave",
                  radius: index === 0 ? 10 : 3.2,
                  impulse: index === 0 ? 1.5 : 3.4,
                  damage: index === 0 ? 82 : 8,
                },
              ],
            }
          : null,
  }));
  const mass = parts.reduce((sum, part) => sum + part.mass, 0);
  return {
    source: { id: `fixture-${index}` },
    name: `Fixture ${index + 1}`,
    cost: 920 + index * 10,
    stats: {
      attack: 88 + index * 5,
      defense: 70 + (3 - index) * 3,
      stamina: 74,
      stability: 76,
      mobility: 82 + index * 2,
      durability: 58,
    },
    physics: {
      mass,
      inertia: 1.1,
      centerOfMass: -0.035,
      friction: 0.56,
      restitution: 0.33,
      drag: 0.3,
      launchSpin: 92 + index * 2,
    },
    parts,
    passives: [],
    modifiers: NEUTRAL_MODIFIERS,
    synergyIds: [],
  };
}

function allFinite(values: readonly number[]): boolean {
  return values.every(Number.isFinite);
}

async function main(): Promise<void> {
  const builds = [0, 1, 2, 3].map(fixtureBuild);
  let matches = 0;
  let finished = 0;
  let exceptions = 0;
  let nonFiniteFrames = 0;
  let ringOuts = 0;
  let destroyed = 0;
  let skillFires = 0;
  let stepCount = 0;
  let stepMs = 0;
  let catalogTopology = false;

  for (const arena of RING_ARENAS) {
    for (const playerCount of [2, 3, 4] as const) {
      matches += 1;
      let sim: Awaited<ReturnType<typeof createVortexSim>> | null = null;
      try {
        sim = await createVortexSim({
          seed: matches * 7919,
          builds: builds.slice(0, playerCount),
          names: builds.slice(0, playerCount).map((build) => build.name),
          arena,
          cpuSeats: Array.from(
            { length: playerCount },
            (_, seat) => seat as SeatIndex,
          ),
          countdownSec: 0,
          suddenDeathSec: 5,
          maxDurationSec: 14,
        });
        const diagnostics = sim.diagnostics();
        if (
          diagnostics.topRigidBodies !== playerCount ||
          diagnostics.rigidBodies !== playerCount + 1 ||
          diagnostics.topColliders.some((count) => count !== 7)
        ) {
          throw new Error("one-body/seven-collider topology gate failed");
        }
        const maxSteps = Math.ceil(15 / FIXED_DT);
        for (let step = 0; step < maxSteps && !sim.result(); step += 1) {
          if (step % 12 === 0) {
            for (let seat = 0; seat < playerCount; seat += 1) {
              const slot = aiActivation(sim, seat as SeatIndex);
              if (slot && sim.activate(seat as SeatIndex, slot).ok) skillFires += 1;
            }
          }
          const before = performance.now();
          sim.step();
          stepMs += performance.now() - before;
          stepCount += 1;
          for (const top of sim.getState().tops) {
            if (
              !allFinite([
                top.hp,
                top.spin,
                ...top.position,
                ...top.rotation,
                ...top.velocity,
              ])
            ) {
              nonFiniteFrames += 1;
            }
          }
        }
        const result = sim.result();
        if (result) {
          finished += 1;
          ringOuts += result.knockouts.filter(
            (knockout) => knockout.reason === "ring-out",
          ).length;
          destroyed += result.knockouts.filter(
            (knockout) => knockout.reason === "destroyed",
          ).length;
        }
      } catch {
        exceptions += 1;
      } finally {
        sim?.dispose();
      }
    }
  }

  let catalogSim: Awaited<ReturnType<typeof createVortexSim>> | null = null;
  try {
    const catalogBuild = resolvedBuildFromDerived(
      deriveBuildStats(createDefaultBuild("CATALOG-GATE")),
    );
    catalogSim = await createVortexSim({
      seed: 0xca7a10,
      builds: [catalogBuild, catalogBuild],
      names: ["Catalog A", "Catalog B"],
      arenaId: "core-bowl",
      countdownSec: 0,
      suddenDeathSec: 120,
      maxDurationSec: 240,
    });
    const diagnostics = catalogSim.diagnostics();
    catalogTopology =
      diagnostics.topRigidBodies === 2 &&
      diagnostics.rigidBodies === 3 &&
      diagnostics.topColliders.every((count) => count === 10) &&
      diagnostics.colliders === 21;
    for (let step = 0; step < 30 && !catalogSim.result(); step += 1) {
      catalogSim.step();
    }
    if (
      !catalogTopology ||
      catalogSim
        .getState()
        .tops.some((top) => !allFinite([...top.position, ...top.rotation]))
    ) {
      throw new Error("catalog compound-collider integration failed");
    }
  } catch {
    exceptions += 1;
  } finally {
    catalogSim?.dispose();
  }

  // A deterministic destruction case complements the free-running ring-out
  // batch and proves that durability-zero is an independent victory path.
  let destructionSim: Awaited<ReturnType<typeof createVortexSim>> | null = null;
  try {
    const strikerBase = fixtureBuild(0);
    const striker: ResolvedTopBuild<{ readonly id: string }> = {
      ...strikerBase,
      parts: strikerBase.parts.map((part, index) =>
        index === 2
          ? {
              ...part,
              activeSkill: {
                id: "destruction-gate",
                name: "Destruction Gate",
                cooldownSec: 30,
                charges: 1,
                conditions: [{ type: "always" }],
                effects: [
                  {
                    type: "shockwave",
                    radius: 12,
                    impulse: 0,
                    damage: 500,
                  },
                ],
              },
            }
          : part,
      ),
    };
    destructionSim = await createVortexSim({
      seed: 0xd357,
      builds: [striker, fixtureBuild(1)],
      names: ["Striker", "Target"],
      arenaId: "wide-dish",
      countdownSec: 0,
      suddenDeathSec: 120,
      maxDurationSec: 240,
    });
    const fired = destructionSim.activate(0, 3);
    if (!fired.ok) throw new Error("destruction skill did not activate");
    destructionSim.step();
    const result = destructionSim.result();
    destroyed +=
      result?.knockouts.filter(
        (knockout) => knockout.reason === "destroyed",
      ).length ?? 0;
  } catch {
    exceptions += 1;
  } finally {
    destructionSim?.dispose();
  }

  // A high-energy, zero-damage launch proves that the retaining lip still
  // permits a genuine physical ring-out rather than turning every result into
  // a durability knockout.
  let ringoutSim: Awaited<ReturnType<typeof createVortexSim>> | null = null;
  try {
    const launcherBase = fixtureBuild(0);
    const launcher: ResolvedTopBuild<{ readonly id: string }> = {
      ...launcherBase,
      parts: launcherBase.parts.map((part, index) =>
        index === 2
          ? {
              ...part,
              activeSkill: {
                id: "ringout-gate",
                name: "Ringout Gate",
                cooldownSec: 30,
                charges: 1,
                conditions: [{ type: "always" }],
                effects: [
                  {
                    type: "shockwave",
                    radius: 20,
                    impulse: 42,
                    damage: 0,
                  },
                ],
              },
            }
          : part,
      ),
    };
    ringoutSim = await createVortexSim({
      seed: 0xa11ce,
      builds: [launcher, fixtureBuild(1)],
      names: ["Launcher", "Target"],
      arenaId: "pressure-crater",
      countdownSec: 0,
      suddenDeathSec: 120,
      maxDurationSec: 240,
    });
    /*
     * Fired AFTER the launch guard on purpose. For the first
     * EDGE_EARLY_GUARD_SEC the rim brakes outward momentum (finishSelftest
     * owns that guarantee), so a t=0 blast now proves nothing — this case
     * fired at t=0 for one version and correctly went red. The property it
     * guards is that once the guard is over, a clean blast still produces a
     * genuine physical ring-out rather than a durability kill.
     */
    const guardSteps = Math.ceil(EDGE_EARLY_GUARD_SEC / FIXED_DT) + 5;
    for (let step = 0; step < guardSteps && !ringoutSim.result(); step += 1) {
      ringoutSim.step();
    }
    const fired = ringoutSim.activate(0, 3);
    if (!fired.ok) throw new Error("ring-out skill did not activate");
    for (let step = 0; step < 300 && !ringoutSim.result(); step += 1) {
      ringoutSim.step();
    }
    const result = ringoutSim.result();
    ringOuts +=
      result?.knockouts.filter(
        (knockout) => knockout.reason === "ring-out",
      ).length ?? 0;
    if (!result || ringOuts < 1) {
      throw new Error("physical ring-out path did not complete");
    }
  } catch {
    exceptions += 1;
  } finally {
    ringoutSim?.dispose();
  }

  const output = {
    matches,
    finished,
    exceptions,
    nonFiniteFrames,
    ringOuts,
    destroyed,
    skillFires,
    catalogTopology,
    avgStepMs: Number((stepMs / Math.max(1, stepCount)).toFixed(3)),
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
  if (
    finished !== matches ||
    exceptions !== 0 ||
    nonFiniteFrames !== 0 ||
    skillFires < matches ||
    ringOuts < 1 ||
    destroyed < 1 ||
    !catalogTopology
    // avgStepMs was part of this condition. It measured 3.79-3.81 idle and
    // 4.229 under load against a 4ms wall - a 5% margin, so this gate went
    // red whenever the machine was busy and reported it as a correctness
    // failure. The number is still in the output; the budget is in
    // `npm run vortex:perf`.
  ) {
    process.exitCode = 1;
  }
}

void main();
