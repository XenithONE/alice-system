import {
  FIXED_DT,
  OUTSIDE_FALL_Y,
  OUTSIDE_MARGIN,
} from "./balance";
import { createVortexSim } from "./index";
import { createSimFixtureBuild } from "./selftestFixture";
import type {
  ResolvedActiveSkill,
  ResolvedPassiveSkill,
  SeatIndex,
} from "./types";

declare const process: {
  stdout: { write(value: string): void };
  exitCode?: number;
};

function allFinite(values: readonly number[]): boolean {
  return values.every(Number.isFinite);
}

function stateIsFinite(
  state: ReturnType<Awaited<ReturnType<typeof createVortexSim>>["getState"]>,
): boolean {
  return state.tops.every((top) =>
    allFinite([
      top.hp,
      top.hpMax,
      top.spin,
      ...top.position,
      ...top.rotation,
      ...top.velocity,
    ]),
  );
}

async function main(): Promise<void> {
  const failures: string[] = [];
  const check = (condition: unknown, message: string): void => {
    if (!condition) failures.push(message);
  };

  const burst: ResolvedActiveSkill = {
    id: "team-gate-burst",
    name: "Team Gate Burst",
    cooldownSec: 5,
    charges: 1,
    conditions: [{ type: "always" }],
    effects: [{ type: "shockwave", radius: 20, impulse: 3, damage: 60 }],
  };
  const drain: ResolvedActiveSkill = {
    id: "team-gate-drain",
    name: "Team Gate Drain",
    cooldownSec: 4,
    charges: 2,
    conditions: [{ type: "target-within", distance: 20 }],
    effects: [{ type: "target-spin-drain", radius: 20, radiansPerSec: 9 }],
  };
  const dormant: ResolvedActiveSkill = {
    id: "team-gate-dormant",
    name: "Dormant Repair",
    cooldownSec: 1,
    charges: -1,
    conditions: [{ type: "hp-below", ratio: 0.1 }],
    effects: [{ type: "repair", amount: 20 }],
  };
  const hitPassives: readonly ResolvedPassiveSkill[] = [
    {
      id: "team-gate-on-hit",
      name: "Enemy Hit Probe",
      rank: 1,
      trigger: "on-hit",
      threshold: null,
      effects: [{ type: "spin", amount: 0.1 }],
    },
    {
      id: "team-gate-on-take-hit",
      name: "Enemy Taken Hit Probe",
      rank: 1,
      trigger: "on-take-hit",
      threshold: null,
      effects: [{ type: "durability", amount: 0.1 }],
    },
  ];
  const activeGroups = {
    crest: [burst, drain, dormant],
  } as const;
  const skillBuilds = Array.from({ length: 4 }, (_, index) =>
    createSimFixtureBuild(index, { activeGroups, passives: hitPassives }),
  );
  const skillSim = await createVortexSim({
    seed: 0x7ea00001,
    builds: skillBuilds,
    teamIds: [10, 10, 20, 20],
    countdownSec: 0,
    suddenDeathSec: 120,
    maxDurationSec: 240,
  });
  try {
    const before = skillSim.getState();
    const groupBefore = before.tops[0]!.skills[0]!;
    check(
      groupBefore.groupSize === 3 && groupBefore.readyCount === 2,
      "stacked slot did not expose 3 members / 2 ready members",
    );
    const allyBefore = before.tops[1]!;
    const enemyBefore = before.tops[2]!;
    const activation = skillSim.activate(0, 1);
    check(
      activation.ok && activation.skillId === burst.id,
      "stacked slot activation was rejected",
    );
    const after = skillSim.getState();
    const allyAfter = after.tops[1]!;
    const enemyAfter = after.tops[2]!;
    check(
      allyAfter.hp === allyBefore.hp &&
        allyAfter.spin === allyBefore.spin &&
        allyAfter.velocity.every(
          (value, index) => value === allyBefore.velocity[index],
        ),
      "shockwave/spin-drain modified an allied top",
    );
    check(
      enemyAfter.hp < enemyBefore.hp && enemyAfter.spin < enemyBefore.spin,
      "stacked skills did not affect enemy tops",
    );
    const skillEvents = skillSim
      .drainEvents()
      .filter((event) => event.type === "skill");
    check(
      skillEvents.length === 2 &&
        skillEvents.some((event) => event.skillId === burst.id) &&
        skillEvents.some((event) => event.skillId === drain.id) &&
        !skillEvents.some((event) => event.skillId === dormant.id),
      "activate(slot) did not fire exactly every ready group member",
    );
    const passiveCounts = skillSim.diagnostics().passiveTriggers;
    check(
      !passiveCounts.some(
        (entry) =>
          entry.seat === 1 && entry.trigger === "on-take-hit",
      ),
      "allied contact fired an on-take-hit passive",
    );
    check(
      passiveCounts.some(
        (entry) =>
          entry.seat === 2 && entry.trigger === "on-take-hit",
      ),
      "enemy damage did not fire an on-take-hit passive",
    );
    const groupAfter = after.tops[0]!.skills[0]!;
    check(
      groupAfter.groupSize === 3 &&
        groupAfter.readyCount === 0 &&
        groupAfter.name?.includes(" + "),
      "stacked slot runtime state was not aggregated",
    );
  } finally {
    skillSim.dispose();
  }

  let totalStepMs = 0;
  let totalSteps = 0;
  const teamCases: {
    allies: number;
    winnerTeam: number | null | undefined;
    colliderCount: number;
    avgStepMs: number;
    nonFiniteFrames: number;
    tunnelingFrames: number;
    maxStepDisplacement: number;
  }[] = [];
  for (const allies of [2, 3, 4]) {
    const count = allies * 2;
    const builds = Array.from({ length: count }, (_, index) =>
      createSimFixtureBuild(index),
    );
    const teamIds = Array.from(
      { length: count },
      (_, seat) => (seat < allies ? 0 : 1),
    );
    const launchPower = Array.from(
      { length: count },
      (_, seat) => (seat < allies ? 1.25 : 0.25),
    );
    const sim = await createVortexSim({
      seed: 0x7ea01000 + allies,
      builds,
      teamIds,
      launchPower,
      cpuSeats: Array.from({ length: count }, (_, seat) => seat as SeatIndex),
      arenaId: "wide-dish",
      countdownSec: 0,
      suddenDeathSec: 1,
      maxDurationSec: 2,
    });
    try {
      let caseStepMs = 0;
      let caseSteps = 0;
      let caseNonFiniteFrames = 0;
      let caseTunnelingFrames = 0;
      let maxStepDisplacement = 0;
      let previousPositions = new Map(
        sim
          .getState()
          .tops.map((top) => [top.seat, top.position] as const),
      );
      const diagnostics = sim.diagnostics();
      check(
        diagnostics.topRigidBodies === count &&
          diagnostics.rigidBodies === count + 1 &&
          diagnostics.topColliders.every((entry) => entry === 10) &&
          diagnostics.colliders === count * 10 + 1,
        `${allies}v${allies} changed one-body/ten-collider topology`,
      );
      const maxSteps = Math.ceil(3 / FIXED_DT);
      for (let step = 0; step < maxSteps && !sim.result(); step += 1) {
        const before = performance.now();
        sim.step();
        const duration = performance.now() - before;
        totalStepMs += duration;
        caseStepMs += duration;
        totalSteps += 1;
        caseSteps += 1;
        const state = sim.getState();
        if (!stateIsFinite(state)) caseNonFiniteFrames += 1;
        for (const top of state.tops) {
          const previous = previousPositions.get(top.seat);
          if (previous) {
            const displacement = Math.hypot(
              top.position[0] - previous[0],
              top.position[1] - previous[1],
              top.position[2] - previous[2],
            );
            maxStepDisplacement = Math.max(maxStepDisplacement, displacement);
            if (displacement > sim.arena.outRadius) {
              caseTunnelingFrames += 1;
            }
          }
          const radius = Math.hypot(top.position[0], top.position[2]);
          if (
            top.alive &&
            (radius > sim.arena.outRadius + OUTSIDE_MARGIN + 1e-6 ||
              top.position[1] < OUTSIDE_FALL_Y - 1e-6)
          ) {
            caseTunnelingFrames += 1;
          }
        }
        previousPositions = new Map(
          state.tops.map((top) => [top.seat, top.position] as const),
        );
      }
      const result = sim.result();
      check(result !== null, `${allies}v${allies} did not reach a result`);
      check(
        caseNonFiniteFrames === 0,
        `${allies}v${allies} produced ${caseNonFiniteFrames} non-finite frames`,
      );
      check(
        caseTunnelingFrames === 0,
        `${allies}v${allies} produced ${caseTunnelingFrames} tunneling frames`,
      );
      check(
        result?.winnerTeam === 0 &&
          result.winner !== null &&
          result.winner < allies,
        `${allies}v${allies} did not preserve the winning allied team`,
      );
      check(
        sim
          .getState()
          .tops.filter((top) => top.alive)
          .every((top) => top.seat < allies),
        `${allies}v${allies} safety ceiling removed a winning teammate`,
      );
      teamCases.push({
        allies,
        winnerTeam: result?.winnerTeam,
        colliderCount: diagnostics.colliders,
        avgStepMs: Number((caseStepMs / Math.max(1, caseSteps)).toFixed(3)),
        nonFiniteFrames: caseNonFiniteFrames,
        tunnelingFrames: caseTunnelingFrames,
        maxStepDisplacement: Number(maxStepDisplacement.toFixed(4)),
      });
    } finally {
      sim.dispose();
    }
  }

  const ffaBuilds = Array.from({ length: 4 }, (_, index) =>
    createSimFixtureBuild(20 + index),
  );
  const implicitFfa = await createVortexSim({
    seed: 0xffa01234,
    builds: ffaBuilds,
    countdownSec: 0,
    suddenDeathSec: 120,
    maxDurationSec: 240,
  });
  const explicitFfa = await createVortexSim({
    seed: 0xffa01234,
    builds: ffaBuilds,
    teamIds: [0, 1, 2, 3],
    countdownSec: 0,
    suddenDeathSec: 120,
    maxDurationSec: 240,
  });
  try {
    for (let step = 0; step < 120; step += 1) {
      implicitFfa.step();
      explicitFfa.step();
    }
    check(
      JSON.stringify(implicitFfa.getState()) ===
        JSON.stringify(explicitFfa.getState()) &&
        JSON.stringify(implicitFfa.result()) ===
          JSON.stringify(explicitFfa.result()),
      "omitted teamIds did not preserve exact free-for-all behaviour",
    );
  } finally {
    implicitFfa.dispose();
    explicitFfa.dispose();
  }

  let rejectedSingleTeam = false;
  try {
    const invalid = await createVortexSim({
      seed: 1,
      builds: [createSimFixtureBuild(40), createSimFixtureBuild(41)],
      teamIds: [5, 5],
    });
    invalid.dispose();
  } catch {
    rejectedSingleTeam = true;
  }
  check(rejectedSingleTeam, "single-team match was not rejected");

  const avgStepMs = totalStepMs / Math.max(1, totalSteps);
  // This gate measures the full 2v2, 3v3 and 4v4 fixed-step batches including
  // the 81-collider maximum case. The existing four-top gate retains its 4ms
  // target; the eight-top co-op extension stays comfortably inside a 60Hz
  // physics budget while leaving browser/render headroom for a 30fps device.
  const eightTopStepMs =
    teamCases.find((entry) => entry.allies === 4)?.avgStepMs ??
    Number.POSITIVE_INFINITY;
  check(
    avgStepMs < 8 && eightTopStepMs < 12,
    `team simulation averaged ${avgStepMs.toFixed(3)}ms (${eightTopStepMs.toFixed(3)}ms at eight tops)`,
  );

  const output = {
    teamCases,
    maxTops: 8,
    maxTopColliders: 10,
    stackedActives: 3,
    avgStepMs: Number(avgStepMs.toFixed(3)),
    nonFiniteFrames: teamCases.reduce(
      (sum, entry) => sum + entry.nonFiniteFrames,
      0,
    ),
    tunnelingFrames: teamCases.reduce(
      (sum, entry) => sum + entry.tunnelingFrames,
      0,
    ),
    ffaCompatible: !failures.some((entry) => entry.includes("free-for-all")),
    failures,
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
  if (failures.length > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(`${JSON.stringify({ failures: [message] })}\n`);
  process.exitCode = 1;
});
