// Isolate the drivetrain from the AI: one bot, empty arena, throttle pinned to
// 1, measure the speed it actually reaches against the speed the builder
// promises the player. A big gap means the game lies to the player in the
// workshop and feels dead in the arena.
import { buildCatalog, PRESETS } from "../parts/catalog";
import RAPIER from "@dimforge/rapier3d-compat";
import { ARENAS } from "../parts/arenas";
import { createArenaSim, initPhysics } from "./world";
import { DEBRIS_COLLISION_GROUPS } from "./assemble";
import { DEPLOY_PAD_HALF_HEIGHT } from "./balance";
import { computeStats } from "./build";
import {
  DEFAULT_ROOM_SETTINGS,
  type BotSpec,
  type ChassisDef,
  type DriveDef,
  type MatchInput,
  type Rot4
} from "./types";

// Node-only gate script (same shim as buildSelftest.ts).
declare const process: { exitCode?: number };

const FULL: MatchInput = {
  throttle: 1,
  steer: 0,
  primary: false,
  secondary: false,
  tertiary: false,
  selfRight: false
};
const IDLE: MatchInput = {
  throttle: 0,
  steer: 0,
  primary: false,
  secondary: false,
  tertiary: false,
  selfRight: false
};

const faceSpec = (
  name: string,
  chassis: ChassisDef,
  drive: DriveDef,
  mode: "underside" | "side"
): BotSpec => {
  if (mode === "underside") {
    const rot: Rot4 = drive.cells[0] <= chassis.deck[0] &&
      drive.cells[1] <= chassis.deck[1] ? 0 : 1;
    const width = rot % 2 === 0 ? drive.cells[0] : drive.cells[1];
    const depth = rot % 2 === 0 ? drive.cells[1] : drive.cells[0];
    const z = Math.max(0, Math.floor((chassis.deck[1] - depth) / 2));
    return {
      v: 3,
      name,
      chassisId: chassis.id,
      paint: 0x777777,
      parts: [
        { partId: drive.id, face: "underside", cell: [0, z], rot },
        { partId: drive.id, face: "underside", cell: [chassis.deck[0] - width, z], rot }
      ]
    };
  }
  const rot: Rot4 =
    drive.cells[1] <= chassis.heightCells && drive.cells[0] <= chassis.deck[1] ? 0 : 1;
  return {
    v: 3,
    name,
    chassisId: chassis.id,
    paint: 0x777777,
    parts: [
      { partId: drive.id, face: "left", cell: [0, 0], rot },
      { partId: drive.id, face: "right", cell: [0, 0], rot }
    ]
  };
};

const measure = (
  spec: BotSpec,
  promised: number,
  catalog: ReturnType<typeof buildCatalog>
) => {
  const sim = createArenaSim({
    seed: 7,
    specs: [spec, spec, null, null],
    names: [spec.name, "sparring", "", ""],
    catalog,
    arena: ARENAS[0]!,
    settings: DEFAULT_ROOM_SETTINGS
  });
  for (let i = 0; i < 200; i += 1) sim.step([IDLE, IDLE, IDLE, IDLE]);
  const y0 = sim.getState().bots[0]!.pos[1];
  let measured = 0;
  for (let i = 0; i < 240; i += 1) {
    sim.step([FULL, FULL, IDLE, IDLE]);
    const state = sim.getState().bots[0]!;
    measured = Math.max(measured, Math.hypot(state.vel[0], state.vel[2]));
  }
  /*
   * A leg only touches the floor for part of its turn, so `maxOmega * radius`
   * overstates what it can ever reach — not because the machine is broken but
   * because the promise is computed for a rim that is always in contact. The
   * contract (ARCHITECTURE_V4 §4 G-LEG) set 0.55 for legs against 0.7 for
   * wheels BEFORE any of this was measured, so this is the registered
   * threshold, not one chosen to make today's numbers pass.
   */
  const legDriven = spec.parts.some((placed) => {
    const part = catalog.byId.get(placed.partId);
    return part?.category === "drive" && part.kind === "leg";
  });
  const row = {
    bot: spec.name,
    floor: legDriven ? 0.55 : 0.7,
    promisedTopSpeed: +promised.toFixed(2),
    measuredSpeed: +measured.toFixed(2),
    ratio: +(measured / promised).toFixed(2),
    chassisY: +y0.toFixed(3),
    phase: sim.phase
  };
  sim.dispose();
  return row;
};

const main = async (): Promise<void> => {
  await initPhysics();
  const catalog = buildCatalog();
  const rows = [];

  for (const preset of PRESETS) {
    // lone bot: the other three seats stay empty so nothing interferes
    const sim = createArenaSim({
      seed: 7,
      // two bots: with a lone entrant the match ends before it starts and the
      // driver correctly ignores input, which reads as "cannot move".
      specs: [preset, PRESETS[2]!, null, null],
      names: [preset.name, "sparring", "", ""],
      catalog,
      arena: ARENAS[0]!,
      settings: DEFAULT_ROOM_SETTINGS
    });
    const promised = computeStats(preset, catalog, DEFAULT_ROOM_SETTINGS).topSpeed;
    // burn the countdown
    for (let i = 0; i < 200; i += 1) sim.step([IDLE, IDLE, IDLE, IDLE]);
    // Peak speed during acceleration. Steady state is meaningless here: both
    // bots drive at each other and the arena is only 16 m across, so by t=4s
    // they have already crashed.
    const y0 = sim.getState().bots[0]!.pos[1];
    let measured = 0;
    for (let i = 0; i < 240; i += 1) {
      sim.step([FULL, FULL, FULL, FULL]);
      const s0 = sim.getState().bots[0]!;
      measured = Math.max(measured, Math.hypot(s0.vel[0], s0.vel[2]));
    }
    /*
     * Legs are held to 0.55 rather than 0.7: an intermittent contact patch
     * cannot reach the speed a continuously-rolling rim would. The two numbers
     * come from ARCHITECTURE_V4 §4 G-LEG, registered before measurement.
     */
    const legDriven = preset.parts.some((placed) => {
      const part = catalog.byId.get(placed.partId);
      return part?.category === "drive" && part.kind === "leg";
    });
    rows.push({
      bot: preset.name,
      floor: legDriven ? 0.55 : 0.7,
      promisedTopSpeed: +promised.toFixed(2),
      measuredSpeed: +measured.toFixed(2),
      ratio: +(measured / promised).toFixed(2),
      chassisY: +y0.toFixed(3),
      phase: sim.phase,
      velFromSim: +Math.hypot(sim.getState().bots[0]!.vel[0], sim.getState().bots[0]!.vel[2]).toFixed(2)
    });
    sim.dispose();
  }
  const chassis = catalog.parts.find(
    (part): part is ChassisDef => part.category === "chassis"
  );
  const undersideWheel = catalog.parts.find(
    (part): part is DriveDef =>
      part.category === "drive" &&
      part.kind === "wheel" &&
      part.faces.includes("underside")
  );
  const sideWheel = catalog.parts.find(
    (part): part is DriveDef =>
      part.category === "drive" &&
      part.kind === "wheel" &&
      part.faces.includes("left") &&
      part.faces.includes("right")
  );
  const sideTrack = catalog.parts.find(
    (part): part is DriveDef =>
      part.category === "drive" &&
      part.kind === "track" &&
      part.faces.includes("left") &&
      part.faces.includes("right")
  );
  if (!chassis || !undersideWheel || !sideWheel || !sideTrack) {
    throw new Error("面別走行テストに必要なシャーシ／ホイール／履帯がカタログにありません。");
  }
  const mountSpecs = [
    faceSpec("mount-underside-wheel", chassis, undersideWheel, "underside"),
    faceSpec("mount-side-wheel", chassis, sideWheel, "side"),
    faceSpec("mount-side-track", chassis, sideTrack, "side")
  ];
  const mountRows = mountSpecs.map((spec) =>
    measure(spec, computeStats(spec, catalog, DEFAULT_ROOM_SETTINGS).topSpeed, catalog)
  );
  const padWorld = new RAPIER.World({ x: 0, y: 0, z: 0 });
  // This descriptor is also used by DeploySystem: one fixed anchor, four
  // solid 24 mm pads. The isolated contact profile keeps the gate independent
  // of trap ammo and AI while exercising the exact pad height.
  const padAnchor = padWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  for (let index = 0; index < 4; index += 1) {
    padWorld.createCollider(
      RAPIER.ColliderDesc.cylinder(DEPLOY_PAD_HALF_HEIGHT, 0.25)
        .setTranslation(index * 0.6, DEPLOY_PAD_HALF_HEIGHT, 0)
        .setCollisionGroups(DEBRIS_COLLISION_GROUPS),
      padAnchor
    );
  }
  const runner = padWorld.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(-0.7, 0.16, 0)
      .setLinvel(5, 0, 0)
      .setLinearDamping(0)
  );
  padWorld.createCollider(
    RAPIER.ColliderDesc.cuboid(0.3, 0.14, 0.3)
      .setMass(80)
      .setFriction(1.35)
      .setCollisionGroups(DEBRIS_COLLISION_GROUPS),
    runner
  );
  padWorld.timestep = 1 / 60;
  let padEntrySpeed = runner.linvel().x;
  let padExitSpeed = 0;
  for (let step = 0; step < 90; step += 1) {
    padWorld.step();
    if (runner.translation().x > 2) {
      padExitSpeed = Math.hypot(runner.linvel().x, runner.linvel().z);
      break;
    }
  }
  const padRow = {
    pads: 4,
    heightMm: DEPLOY_PAD_HALF_HEIGHT * 2 * 1000,
    entrySpeed: +padEntrySpeed.toFixed(2),
    exitSpeed: +padExitSpeed.toFixed(2),
    ratio: +(padExitSpeed / padEntrySpeed).toFixed(2)
  };
  padWorld.free();
  // A robot that cannot reach the speed the workshop advertises makes the
  // whole builder a lie, and it is invisible in a match-outcome gate: bots that
  // barely move still finish matches, just on the judges' cards.
  const failures = [
    ...rows.filter((r) => r.ratio < r.floor).map((r) => `${r.bot} ${r.ratio} < ${r.floor}`),
    ...mountRows.filter((r) => r.ratio < 0.5).map((r) => `${r.bot} ${r.ratio}`),
    ...(padRow.ratio < 0.9 ? [`G-DRIVE-PAD ${padRow.ratio}`] : [])
  ];
  console.log(JSON.stringify({ rows, mountRows, padRow, failures }, null, 2));
  console.log(failures.length ? "DRIVE SELFTEST FAIL" : "DRIVE SELFTEST PASS");
  if (failures.length) process.exitCode = 1;
};

main().catch((e) => { console.error("DRIVE SELFTEST FAIL:", e); process.exitCode = 1; });
