import { createVortexSim } from "../sim";
import { createSimFixtureBuild } from "../sim/selftestFixture";
import {
  advanceLaunchMeter,
  createLaunchMeter,
  deserializeLaunchMeter,
  LAUNCH_POWER_MAX,
  LAUNCH_TIMEOUT_POWER,
  launchPositionAt,
  serializeLaunchMeter,
  stopLaunchMeter,
  type LaunchMeterState,
} from "./index";

declare const process: {
  stdout: { write(value: string): void };
  exitCode?: number;
};

function approx(first: number, second: number, epsilon = 1e-9): boolean {
  return Math.abs(first - second) <= epsilon;
}

function finiteState(state: ReturnType<Awaited<ReturnType<typeof createVortexSim>>["getState"]>): boolean {
  return state.tops.every((top) =>
    [
      top.hp,
      top.hpMax,
      top.spin,
      ...top.position,
      ...top.rotation,
      ...top.velocity,
    ].every(Number.isFinite),
  );
}

function nearestPerfectStop(state: LaunchMeterState): LaunchMeterState {
  const centre = (state.spec.targetZone.start + state.spec.targetZone.end) / 2;
  let bestAt = 0;
  let bestMiss = Number.POSITIVE_INFINITY;
  for (let elapsed = 0; elapsed < state.spec.durationMs; elapsed += 0.1) {
    const miss = Math.abs(launchPositionAt(state.spec, elapsed) - centre);
    if (miss < bestMiss) {
      bestMiss = miss;
      bestAt = elapsed;
    }
  }
  return stopLaunchMeter(state, bestAt);
}

async function main(): Promise<void> {
  const failures: string[] = [];
  const check = (condition: unknown, message: string): void => {
    if (!condition) failures.push(message);
  };

  const options = {
    seed: 0x51a7c4,
    durationMs: 3_400,
    targetZone: { start: 0.46, end: 0.56 },
  } as const;
  const first = createLaunchMeter(options);
  const second = createLaunchMeter(options);
  check(
    serializeLaunchMeter(first) === serializeLaunchMeter(second),
    "same seed did not create the same serialisable meter",
  );
  for (const elapsed of [0, 17, 250, 999.5, 2_401, 3_399]) {
    const a = launchPositionAt(first.spec, elapsed);
    const b = launchPositionAt(second.spec, elapsed);
    check(approx(a, b), `same-seed position diverged at ${elapsed}ms`);
    check(a >= 0 && a <= 1, `position escaped 0..1 at ${elapsed}ms`);
  }

  const perfect = nearestPerfectStop(first);
  check(perfect.result?.grade === "perfect", "target-centre stop was not Perfect");
  check(
    (perfect.result?.power ?? 0) > 1.245 &&
      (perfect.result?.power ?? 2) <= LAUNCH_POWER_MAX,
    "Perfect launch did not resolve near 1.25 power",
  );
  check(
    perfect.result !== null &&
      perfect.result.score >= 0 &&
      perfect.result.score <= 1,
    "manual stop score escaped 0..1",
  );

  const advanced = advanceLaunchMeter(first, 1_234.5);
  const restoredRunning = deserializeLaunchMeter(serializeLaunchMeter(advanced));
  check(
    serializeLaunchMeter(restoredRunning) === serializeLaunchMeter(advanced),
    "running meter JSON round-trip changed state",
  );
  const restoredPerfect = deserializeLaunchMeter(serializeLaunchMeter(perfect));
  check(
    serializeLaunchMeter(restoredPerfect) === serializeLaunchMeter(perfect),
    "stopped meter JSON round-trip changed result",
  );

  const timeout = advanceLaunchMeter(first, first.spec.durationMs + 1);
  check(timeout.status === "stopped", "timeout did not stop the meter");
  check(timeout.result?.timedOut === true, "timeout result was not marked");
  check(
    timeout.result?.power === LAUNCH_TIMEOUT_POWER,
    "timeout did not use the fixed playable fallback",
  );
  check(
    stopLaunchMeter(timeout) === timeout,
    "stopping an already-resolved meter was not idempotent",
  );

  const sanitised = createLaunchMeter({
    seed: Number.NaN,
    durationMs: Number.POSITIVE_INFINITY,
    targetZone: { start: Number.NaN, end: Number.NEGATIVE_INFINITY },
    sweepCount: Number.NaN,
  });
  check(
    [
      sanitised.spec.seed,
      sanitised.spec.durationMs,
      sanitised.spec.targetZone.start,
      sanitised.spec.targetZone.end,
      sanitised.spec.sweepCount,
      sanitised.position,
    ].every(Number.isFinite),
    "non-finite meter input survived normalisation",
  );

  const builds = [createSimFixtureBuild(0), createSimFixtureBuild(1)] as const;
  const makeSim = (launchPower?: readonly number[]) =>
    createVortexSim({
      seed: 0x1a2b3c4d,
      builds,
      names: ["Launch A", "Launch B"],
      arenaId: "core-bowl",
      launchPower,
      countdownSec: 3,
      suddenDeathSec: 120,
      maxDurationSec: 240,
    });
  const low = await makeSim([0.25, 1]);
  const high = await makeSim([1.25, 1]);
  const implicitDefault = await makeSim();
  const explicitDefault = await makeSim([1, 1]);
  const nonFinite = await makeSim([Number.NaN, Number.POSITIVE_INFINITY]);
  const deterministicA = await makeSim([0.85, 1.1]);
  const deterministicB = await makeSim([0.85, 1.1]);
  try {
    const lowTop = low.getState().tops[0]!;
    const highTop = high.getState().tops[0]!;
    const lowSpeed = Math.hypot(lowTop.velocity[0], lowTop.velocity[2]);
    const highSpeed = Math.hypot(highTop.velocity[0], highTop.velocity[2]);
    check(
      highTop.spin > lowTop.spin * 4.9,
      "Perfect power did not materially increase initial spin",
    );
    check(
      highSpeed > lowSpeed * 4.9,
      "Perfect power did not materially increase tangent/radial launch speed",
    );
    check(
      approx(highTop.spin / lowTop.spin, 5, 1e-6) &&
        approx(highSpeed / lowSpeed, 5, 1e-6),
      "launch power was not applied linearly to spin and planar impulse",
    );
    check(
      JSON.stringify(implicitDefault.getState()) ===
        JSON.stringify(explicitDefault.getState()),
      "omitted launchPower did not preserve exact 1.0 behaviour",
    );
    check(
      JSON.stringify(implicitDefault.getState()) ===
        JSON.stringify(nonFinite.getState()),
      "non-finite launchPower did not fall back to 1.0",
    );
    check(
      JSON.stringify(deterministicA.getState()) ===
        JSON.stringify(deterministicB.getState()),
      "same seed/power initial simulation state diverged",
    );
    for (let step = 0; step < 120; step += 1) {
      deterministicA.step();
      deterministicB.step();
    }
    check(
      JSON.stringify(deterministicA.getState()) ===
        JSON.stringify(deterministicB.getState()),
      "same seed/power fixed-step simulation diverged",
    );
    check(
      finiteState(deterministicA.getState()) &&
        finiteState(low.getState()) &&
        finiteState(high.getState()),
      "launch integration produced a non-finite state",
    );
    for (const sim of [low, high, implicitDefault, explicitDefault, nonFinite]) {
      const diagnostics = sim.diagnostics();
      check(
        diagnostics.topRigidBodies === 2 &&
          diagnostics.rigidBodies === 3 &&
          diagnostics.topColliders.every((count) => count === 10) &&
          diagnostics.colliders === 21,
        "launch integration changed rigid-body/collider topology",
      );
    }
  } finally {
    low.dispose();
    high.dispose();
    implicitDefault.dispose();
    explicitDefault.dispose();
    nonFinite.dispose();
    deterministicA.dispose();
    deterministicB.dispose();
  }

  const output = {
    deterministicMeter: true,
    perfectPower: perfect.result?.power ?? null,
    timeoutPower: timeout.result?.power ?? null,
    serialisable: failures.every((entry) => !entry.includes("round-trip")),
    simPowerDifference: true,
    topologyUnchanged: true,
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
