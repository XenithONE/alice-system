import RAPIER from "@dimforge/rapier3d-compat";
import { ARENAS } from "../parts/arenas";
import { buildCatalog, PRESETS } from "../parts/catalog";
import { assembleBot, type AssembledBot } from "./assemble";
import {
  FIXED_DT,
  FUEL_L_PER_SEC,
  HEAT_CAP_J,
  HEAT_DERATE_START
} from "./balance";
import { validateBuild } from "./build";
import { driveBot } from "./driver";
import {
  createArenaSim,
  initPhysics,
  internalsForSim
} from "./world";
import {
  DEFAULT_ROOM_SETTINGS,
  NEUTRAL_INPUT,
  type BotSpec,
  type MatchInput,
  type PlacedPart
} from "./types";

declare const process: { exitCode?: number };

const catalog = buildCatalog();
const gateSettings = {
  ...DEFAULT_ROOM_SETTINGS,
  pointBudget: 3_200,
  matchSec: 40
};
const failures: string[] = [];

function requireClaim(label: string, value: boolean, detail: unknown): void {
  if (!value) failures.push(`${label}: ${JSON.stringify(detail)}`);
}

function hotSpec(extraInternals: readonly PlacedPart[] = []): BotSpec {
  return {
    v: 3,
    name: "plant-hot",
    chassisId: "chassis-heavy",
    paint: 0xc8102e,
    parts: [
      { partId: "wheel-small", face: "underside", cell: [0, 9], rot: 0 },
      { partId: "wheel-small", face: "underside", cell: [8, 9], rot: 0 },
      { partId: "mooneater", face: "deck", cell: [1, 0], rot: 0 },
      { partId: "mooneater", face: "front", cell: [1, 0], rot: 0 },
      ...extraInternals
    ]
  };
}

function spinnerSpec(engineId: "eng-titan" | null): BotSpec {
  return {
    v: 3,
    name: `power-${engineId ?? "stock"}`,
    chassisId: "feather-frame",
    paint: 0x1b4a8f,
    parts: [
      { partId: "wheel-small", face: "underside", cell: [0, 4], rot: 0 },
      { partId: "wheel-small", face: "underside", cell: [4, 4], rot: 0 },
      { partId: "disc-heavy", face: "deck", cell: [0, 0], rot: 0 },
      ...(engineId
        ? [{
            partId: engineId,
            face: "internal" as const,
            cell: [0, 0] as const,
            rot: 1 as const
          }]
        : [])
    ]
  };
}

function fuelSpec(tankId: "tank-small" | "tank-drum"): BotSpec {
  const pyro = PRESETS.find((preset) => preset.name === "pyro")!;
  return {
    ...pyro,
    name: `fuel-${tankId}`,
    parts: [
      ...pyro.parts,
      { partId: tankId, face: "internal", cell: [0, 0], rot: 0 }
    ]
  };
}

function createHarness(spec: BotSpec): {
  readonly world: RAPIER.World;
  readonly bot: AssembledBot;
} {
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
    bot: assembleBot(world, spec, catalog, 0, [0, 0, 0], 0)
  };
}

function omega(bot: AssembledBot): number {
  const weapon = bot.weapons[0]!;
  const value = weapon.body.angvel();
  return Math.hypot(value.x, value.y, value.z);
}

function measureSpin90(spec: BotSpec): number {
  const harness = createHarness(spec);
  const target = (harness.bot.weapons[0]!.def.maxOmega ?? 0) * 0.9;
  let elapsed = Number.POSITIVE_INFINITY;
  for (let step = 1; step <= Math.ceil(30 / FIXED_DT); step += 1) {
    driveBot(
      harness.bot,
      NEUTRAL_INPUT,
      "live",
      { inverted: false, alive: true },
      []
    );
    harness.world.step();
    if (omega(harness.bot) >= target) {
      elapsed = step * FIXED_DT;
      break;
    }
  }
  harness.world.free();
  return elapsed;
}

function measureFuel(tankId: "tank-small" | "tank-drum"): {
  readonly activeSec: number;
  readonly budgetSec: number;
} {
  const spec = fuelSpec(tankId);
  const harness = createHarness(spec);
  let activeSec = 0;
  const primary = harness.bot.weapons.find(
    (weapon) => weapon.def.slot === "primary"
  )!;
  for (let step = 0; step < Math.round(180 / FIXED_DT); step += 1) {
    const withinSecond = (step * FIXED_DT) % 1;
    const input: MatchInput = {
      ...NEUTRAL_INPUT,
      primary: withinSecond < 0.5
    };
    driveBot(
      harness.bot,
      input,
      "live",
      { inverted: false, alive: true },
      []
    );
    if (primary.active) activeSec += FIXED_DT;
    harness.world.step();
  }
  const tank = catalog.byId.get(tankId);
  const chassis = catalog.byId.get(spec.chassisId);
  const budgetSec =
    ((chassis?.category === "chassis" ? chassis.stockFuelL : 0) +
      (tank?.category === "utility" ? tank.fuelL ?? 0 : 0)) /
    FUEL_L_PER_SEC;
  harness.world.free();
  return { activeSec, budgetSec };
}

function measureHeat(spec: BotSpec): {
  readonly maxHeatRatio: number;
  readonly minPowerScale: number;
} {
  const arena = ARENAS[0]!;
  const guard = PRESETS.find((preset) => preset.name === "spin-king")!;
  const sim = createArenaSim({
    seed: 91,
    specs: [spec, guard, null, null],
    names: [spec.name, guard.name],
    catalog,
    arena,
    settings: { ...gateSettings, pointBudget: 10_000, arenaId: arena.id }
  });
  let maxHeatRatio = 0;
  let minPowerScale = 1;
  const maxSteps = Math.ceil((30 + 3.1) / FIXED_DT);
  for (let step = 0; step < maxSteps && sim.phase !== "over"; step += 1) {
    sim.step([NEUTRAL_INPUT, NEUTRAL_INPUT]);
    if (sim.phase !== "live") continue;
    const plant = internalsForSim(sim, 0);
    if (!plant) continue;
    maxHeatRatio = Math.max(maxHeatRatio, plant.heatJ / HEAT_CAP_J);
    minPowerScale = Math.min(minPowerScale, plant.powerScale);
  }
  sim.dispose();
  return { maxHeatRatio, minPowerScale };
}

function deterministicState(seed: number): string {
  const arena = ARENAS[0]!;
  const poweredPreset: BotSpec = {
    ...PRESETS[0]!,
    parts: [
      ...PRESETS[0]!.parts,
      { partId: "eng-titan", face: "internal", cell: [0, 0], rot: 0 }
    ]
  };
  const specs = [poweredPreset, poweredPreset, null, null];
  const sim = createArenaSim({
    seed,
    specs,
    names: ["a", "b"],
    catalog,
    arena,
    settings: { ...gateSettings, arenaId: arena.id }
  });
  while (sim.phase !== "over" && sim.elapsed < 5) {
    sim.step([
      { ...NEUTRAL_INPUT, throttle: 0.7, steer: 0.2 },
      { ...NEUTRAL_INPUT, throttle: -0.4, steer: -0.3 }
    ]);
  }
  const state = JSON.stringify(sim.getState());
  sim.dispose();
  return state;
}

async function main(): Promise<void> {
  await initPhysics();

  const moonWithoutEngine = validateBuild(
    hotSpec(),
    catalog,
    gateSettings
  );
  const titanPlacement: PlacedPart = {
    partId: "eng-titan",
    face: "internal",
    cell: [0, 0],
    rot: 0
  };
  const moonWithTitan = validateBuild(
    hotSpec([titanPlacement]),
    catalog,
    gateSettings
  );
  const overflow = validateBuild(
    hotSpec(Array.from({ length: 6 }, () => titanPlacement)),
    catalog,
    { ...gateSettings, pointBudget: 10_000 }
  );
  const presetRows = PRESETS.map((preset) => {
    const validation = validateBuild(preset, catalog, DEFAULT_ROOM_SETTINGS);
    return {
      name: preset.name,
      ok: validation.ok,
      warnings: validation.warnings.length
    };
  });
  const i1a =
    !moonWithoutEngine.ok &&
    moonWithoutEngine.errors.some(
      (error) => error.includes("kW") && error.includes("秒")
    );
  const i1b = moonWithTitan.ok;
  const i1c =
    !overflow.ok &&
    overflow.errors.some(
      (error) => error.includes("セル") && error.includes("72")
    );
  const i1d = presetRows.every((row) => row.ok && row.warnings === 0);
  requireClaim("I1(a) low plant rejects mooneater", i1a, moonWithoutEngine);
  requireClaim("I1(b) titan accepts mooneater", i1b, moonWithTitan);
  requireClaim("I1(c) overflowing bay rejects", i1c, overflow.errors);
  requireClaim("I1(d) eight stock presets stay clean", i1d, presetRows);
  console.log("I1 BUILD", {
    lowRejectedWithKwAndSec: i1a,
    titanAccepted: i1b,
    overflowRejectedWithCells: i1c,
    presetsClean: i1d,
    presets: presetRows
  });

  const tSmall = measureSpin90(spinnerSpec(null));
  const tLarge = measureSpin90(spinnerSpec("eng-titan"));
  const i2SlowArm = tSmall > tLarge * 1.6;
  const i2FastArm = tLarge < 5;
  requireClaim("I2 low output is slower", i2SlowArm, { tSmall, tLarge });
  requireClaim("I2 high output remains fast", i2FastArm, { tSmall, tLarge });
  console.log("I2 POWER", {
    tSmall: Number(tSmall.toFixed(3)),
    tLarge: Number(tLarge.toFixed(3)),
    ratio: Number((tSmall / tLarge).toFixed(3)),
    slowArm: i2SlowArm,
    fastArm: i2FastArm
  });

  const hot = measureHeat(hotSpec([titanPlacement]));
  const cool = measureHeat(
    hotSpec([
      titanPlacement,
      { partId: "rad-stack", face: "internal", cell: [4, 0], rot: 0 },
      { partId: "rad-std", face: "internal", cell: [4, 2], rot: 0 }
    ])
  );
  const i3Hot =
    hot.maxHeatRatio >= 0.999 && hot.minPowerScale < 0.6;
  const i3Cool = cool.maxHeatRatio <= HEAT_DERATE_START;
  requireClaim("I3 hot arm derates", i3Hot, hot);
  requireClaim("I3 cooled arm stays below threshold", i3Cool, cool);
  console.log("I3 HEAT", {
    hot,
    cool,
    hotArm: i3Hot,
    coolArm: i3Cool
  });

  const smallFuel = measureFuel("tank-small");
  const drumFuel = measureFuel("tank-drum");
  const i4SizeArm = drumFuel.activeSec > smallFuel.activeSec;
  const i4BudgetArm =
    smallFuel.activeSec <= smallFuel.budgetSec + FIXED_DT &&
    drumFuel.activeSec <= drumFuel.budgetSec + FIXED_DT;
  requireClaim("I4 larger tank lasts longer", i4SizeArm, {
    smallFuel,
    drumFuel
  });
  requireClaim("I4 neither tank exceeds its budget", i4BudgetArm, {
    smallFuel,
    drumFuel
  });
  console.log("I4 FUEL", {
    small: {
      activeSec: Number(smallFuel.activeSec.toFixed(3)),
      budgetSec: smallFuel.budgetSec
    },
    drum: {
      activeSec: Number(drumFuel.activeSec.toFixed(3)),
      budgetSec: drumFuel.budgetSec
    },
    sizeArm: i4SizeArm,
    budgetArm: i4BudgetArm
  });

  const stateA = deterministicState(777);
  const stateB = deterministicState(777);
  const stateDifferentSeed = deterministicState(778);
  const i5SameArm = stateA === stateB;
  const i5DifferentArm = stateA !== stateDifferentSeed;
  requireClaim("I5 same seed and inputs match", i5SameArm, {
    aLength: stateA.length,
    bLength: stateB.length
  });
  requireClaim("I5 different seed is distinguishable", i5DifferentArm, {
    aLength: stateA.length,
    differentLength: stateDifferentSeed.length
  });
  console.log("I5 DETERMINISM", {
    sameSeedEqual: i5SameArm,
    differentSeedDifferent: i5DifferentArm
  });

  console.log(
    failures.length === 0
      ? "INTERNALS SELFTEST PASS"
      : `INTERNALS SELFTEST FAIL\n${failures.join("\n")}`
  );
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("INTERNALS SELFTEST FAIL:", error);
  process.exitCode = 1;
});
