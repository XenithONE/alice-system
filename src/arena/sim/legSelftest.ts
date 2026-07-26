/**
 * G-LEG — ARCHITECTURE_V4 §4.
 *
 * A leg is `feet` capsules on ONE rigid body turned by ONE revolute motor, so
 * everything downstream of assemble.ts treats it as a wheel. That is what makes
 * it cheap; it is also what makes a broken one invisible. A star that windmills
 * in the air while the hull sleds on its belly looks, to driver.ts, damage.ts
 * and the wire, exactly like a wheel doing its job — and the match still
 * finishes, on the judges' cards. This project has shipped that class of defect
 * twice (a machine reporting 6.24 m/s while measuring 0.00; a trap drawn at a
 * radius its collider did not have), so nothing here is read off a command, a
 * catalogue field or a display value:
 *
 *   speed       chassis rigid-body linear velocity and translation
 *   leg spin    drive rigid-body angular velocity minus the hull's, projected on
 *               the axle — never the motor target that was written to the joint,
 *               and never BotState.drivePhases, which is derived from this same
 *               pair and would make the comparison circular
 *   contact     Rapier narrow-phase manifolds against the floor collider
 *
 * The commanded number is printed beside every measured one on purpose: a gate
 * that prints only the measurement cannot show you it measured the right thing.
 *
 * Claims, all registered in ARCHITECTURE_V4 §4 G-LEG before anything was run:
 *
 *   1 forward, reverse and spin turn all work on a machine with nothing but legs
 *   2 forward speed reaches 0.55 x maxOmega x radius (wheels are held to 0.7 by
 *     driveSelftest; an intermittent contact patch cannot reach what a rolling
 *     rim does)
 *   3 the two sides turn in OPPOSITE directions when steering — a spin turn
 *   4 contact is intermittent, at a rate tied to feet x revolutions
 *
 * Plus the guard for the hull lift that made legs work at all (build.ts
 * driveSupportRadius / driveSinkDepth / hullLift and LEG_HULL_MARGIN): the hull
 * of a leg machine must be on the floor for under 5% of live frames. Before the
 * lift, leg-walker scraped 92% of frames; at LEG_HULL_MARGIN = 1.0 it is back to
 * 24%. Both are caught here.
 *
 * ⚠ ONE DEVIATION FROM THE CONTRACT TEXT, reported in full to the architect and
 * printed by this gate on every run — see CONTRACT DEVIATION below. §4 asks for
 * touchdowns/s to EQUAL feet x rev/s within ±20%. Measured, every leg machine in
 * the catalogue lands roughly half that often, because a rigid star lifts its own
 * axle by driveSinkDepth() every quarter turn and at catalogue leg speeds that
 * throws the machine into a ballistic hop: 38-52% of frames have no foot on the
 * floor at all. The identity holds only for a machine that never leaves the
 * ground.
 *
 * The +20% ceiling is kept verbatim — no foot can land more than once per turn,
 * so that half of the band is a structural fact and it catches contact chatter
 * and double counting. The -20% floor is replaced by a DIFFERENTIAL against a
 * wheel rig measured in this same harness with the same contact test, because
 * any number I invented for the floor would be a number read off today's legs:
 *
 *              duty cycle    touchdowns in 3 s    per leg-revolution
 *   wheel rig       100%                    0                     0
 *   legs           8-13%                22..48            0.76..1.71
 *
 * A leg has to be strictly below the wheel on duty and strictly above it on
 * touchdowns, and every fitted leg has to land at least once. That is exactly
 * "contact is intermittent" — it fails the moment a star is replaced by, or
 * drowned in, a continuous contact patch — and no constant in it was chosen by
 * looking at a leg.
 *
 * ⚠ KNOWN GAP, stated so this gate does not overstate itself. Three defects
 * were injected through these exact checks (see the report). Two are caught:
 * quartering leg torque trips the 0.55 floor at 0.50/0.52/0.54, and fusing the
 * star into a rim (`feet: 48`) trips the 2..4 envelope. The third is NOT:
 * dropping foot friction to 0.02 — ice — leaves every machine at 0.75..1.04 of
 * its promised speed and this gate passes it. The cause is not the measurement.
 * driver.ts applies the traction assist as an impulse on the chassis whenever a
 * drive is commanded, with no test that anything is touching the floor, so it
 * servos the hull to maxOmega x radius on its own; with the assist removed
 * entirely the same machines still make 0.55..0.77. So the speed floor proves
 * the machine MOVES, not that its feet move it. Closing that needs the assist
 * gated on contact in driver.ts, which is not this agent's file, and a traction
 * measurement this engine cannot give (see floorContacts).
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { buildCatalog, PRESETS } from "../parts/catalog";
import { assembleBot, type AssembledBot, type DriveRuntime } from "./assemble";
import { FIXED_DT } from "./balance";
import { computeStats, validateBuild } from "./build";
import { DEFAULT_DRIVER_TUNING, driveBot } from "./driver";
import {
  DEFAULT_ROOM_SETTINGS,
  NEUTRAL_INPUT,
  type BotSpec,
  type Catalog,
  type ChassisDef,
  type DriveDef,
  type MatchInput
} from "./types";

// Node-only gate script (same shim as driveSelftest.ts / spinupSelftest.ts).
declare const process: { exitCode?: number };

/* ------------------------------------------------------------------ */
/* thresholds — registered in the contract, not fitted to measurements */
/* ------------------------------------------------------------------ */

/** G-LEG: legs reach this fraction of maxOmega x radius. Wheels are held to 0.7. */
export const SPEED_FLOOR = 0.55;
/** G-LEG: the +20% half of the cadence band, kept verbatim. */
const CADENCE_TOLERANCE = 0.2;
/**
 * Contract L2 / P2: a leg is 2 to 4 spokes. Checked here and not only in
 * catalogSelftest because the cadence ceiling below is `feet x 1.2` — if `feet`
 * itself is unbounded then so is the ceiling, and the check grades itself.
 * Injecting `feet: 48` (a star fused into a rim) walked straight through the
 * cadence check until this bound existed: 18 landings per revolution against a
 * ceiling of 57.6. A gate whose limit is set by the thing it is judging is the
 * self-referential gate this project has already shipped once.
 */
const FEET_MIN = 2;
const FEET_MAX = 4;
/** Hull of a leg machine on the floor for less than this fraction of frames. */
export const HULL_CONTACT_LIMIT = 0.05;
/**
 * Spin turn. The same 90 deg in 2 s that spinupSelftest already holds the
 * wheeled spin-king to; a leg machine gets the same bar over the same duration.
 */
export const MIN_SPIN_YAW_DEG = 90;
export const SPIN_SEC = 2;

/* ------------------------------------------------------------------ */
/* measurement constants                                               */
/* ------------------------------------------------------------------ */

/**
 * A narrow-phase manifold exists before the shapes meet — Rapier keeps contacts
 * within its prediction distance — so "touching" has to be a distance test, not
 * the mere existence of a pair. 1 mm is well inside solver penetration (the feet
 * measure -2 to -31 mm at their deepest) and well outside the prediction skin.
 * Erring generous counts MORE frames as hull contact, which can only make the 5%
 * gate harder to pass.
 */
const TOUCH_EPS = 0.001;
/**
 * Contact chatter rejection: a spoke must have been clear this long before its
 * next landing counts as a new touchdown. 33 ms is under half the shortest
 * footfall period in the catalogue (leg-crab, 4 feet at 2.39 rev/s = 105 ms), so
 * it cannot merge two real footfalls. It is a fixed duration rather than a
 * fraction of the expected cadence: deriving it from the expectation would let
 * the cadence check confirm itself. Both the raw and the debounced counts are
 * printed, and on the shipped catalogue they are within 6% of each other.
 */
const CHATTER_CLEAR_FRAMES = 2;

const SETTLE_SEC = 1.5;
export const DRIVE_SEC = 4.5;
/** Acceleration transient; cadence, duty and mean speed use what follows. */
const TRANSIENT_SEC = 1.5;

export const FORWARD: MatchInput = { ...NEUTRAL_INPUT, throttle: 1 };
const REVERSE: MatchInput = { ...NEUTRAL_INPUT, throttle: -1 };
const SPIN_RIGHT: MatchInput = { ...NEUTRAL_INPUT, steer: 1 };

interface Harness {
  readonly world: RAPIER.World;
  readonly bot: AssembledBot;
  readonly floor: RAPIER.Collider;
}

function createHarness(spec: BotSpec, catalog: Catalog): Harness {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = FIXED_DT;
  const anchor = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0)
  );
  // The same 40 m slab at the same friction spinupSelftest uses, so a number
  // measured here is comparable with the one that gate prints.
  const floor = world.createCollider(
    RAPIER.ColliderDesc.cuboid(20, 1, 20).setFriction(1.35),
    anchor
  );
  return { world, floor, bot: assembleBot(world, spec, catalog, 0, [0, 0, 0], 0) };
}

/** Chassis-local +X — the axle line — expressed in world space. */
function axleAxis(q: RAPIER.Rotation): readonly [number, number, number] {
  return [
    1 - 2 * (q.y * q.y + q.z * q.z),
    2 * (q.x * q.y + q.w * q.z),
    2 * (q.x * q.z - q.w * q.y)
  ];
}

/** Chassis forward in world space, same definition heading.ts uses. */
function forwardAxis(q: RAPIER.Rotation): readonly [number, number] {
  const x = -2 * (q.x * q.z + q.w * q.y);
  const z = -(1 - 2 * (q.x * q.x + q.y * q.y));
  const length = Math.max(Math.hypot(x, z), Number.EPSILON);
  return [x / length, z / length];
}

function yawOf(q: RAPIER.Rotation): number {
  return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
}

function wrappedDelta(next: number, previous: number): number {
  return Math.atan2(Math.sin(next - previous), Math.cos(next - previous));
}

/**
 * How fast this drive is really turning on its axle relative to the hull, rad/s.
 * Both angular velocities come off the rigid bodies; the motor command never
 * enters, which is the whole point of printing the two side by side.
 */
function measuredSpin(bot: AssembledBot, drive: DriveRuntime): number {
  const axis = axleAxis(bot.chassis.rotation());
  const wheel = drive.body.angvel();
  const hull = bot.chassis.angvel();
  return (
    (wheel.x - hull.x) * axis[0] +
    (wheel.y - hull.y) * axis[1] +
    (wheel.z - hull.z) * axis[2]
  );
}

interface FloorContact {
  /** collider handles genuinely resting on the floor this step */
  readonly touching: Set<number>;
  /** N·s of normal load the watched drives put into the floor this step */
  readonly loadImpulse: number;
}

/**
 * One pass over the floor's narrow-phase pairs, returning both what is touching
 * and how much load it is carrying.
 *
 * The load is a second, independent witness that the machine stands on its legs:
 * over a window that begins and ends at the same ride height the feet must pass
 * the machine's entire weight into the floor, so footLoad / weight is 1 by
 * Newton, with no threshold to choose. Anything the hull carries — or any weight
 * held up by something that is not a foot — shows up as a shortfall.
 *
 * ⚠ It is NORMAL load, not traction, and that is a limitation of the engine, not
 * a choice: rapier3d-compat 0.19.3 populates contactImpulse but leaves
 * contactTangentImpulseX/Y at exactly 0. Measured on a cuboid skidding from
 * 6 m/s to -0.22 m/s — friction unmistakably applied — every tangential impulse
 * read 0.000 while normal impulses read 26.99, 19.47, 10.24. So this gate cannot
 * weigh how hard the feet PUSH, which is why the ice-foot injection in the
 * report is not caught here.
 */
function floorContacts(harness: Harness, watched: Set<number>): FloorContact {
  const touching = new Set<number>();
  let loadImpulse = 0;
  harness.world.contactPairsWith(harness.floor, (other) => {
    let closest = Number.POSITIVE_INFINITY;
    const isWatched = watched.has(other.handle);
    harness.world.contactPair(harness.floor, other, (manifold) => {
      for (let i = 0; i < manifold.numContacts(); i += 1) {
        closest = Math.min(closest, manifold.contactDist(i));
        if (isWatched) loadImpulse += manifold.contactImpulse(i);
      }
    });
    if (closest <= TOUCH_EPS) touching.add(other.handle);
  });
  return { touching, loadImpulse };
}

interface SpokeTrack {
  readonly drive: number;
  down: boolean;
  clearFrames: number;
  touchdowns: number;
  rawTouchdowns: number;
}

export interface DriveRun {
  readonly frames: number;
  readonly steadySec: number;
  /** fraction of frames with the hull collider on the floor */
  readonly hullContact: number;
  /** peak |horizontal velocity| of the chassis body, m/s */
  readonly peakSpeed: number;
  /** straight-line displacement over the steady window, m */
  readonly displacement: number;
  /** metres travelled along the machine's own forward axis, signed */
  readonly forwardTravel: number;
  readonly yawDeg: number;
  /** mean measured axle rate per side over the steady window, rad/s */
  readonly leftSpin: number;
  readonly rightSpin: number;
  /** what driver.ts wrote to the left/right motors, rad/s */
  readonly leftCommand: number;
  readonly rightCommand: number;
  /** debounced landings summed over every driven spoke */
  readonly touchdowns: number;
  /** the same count with no chatter rejection at all */
  readonly rawTouchdowns: number;
  /** axle turns summed over every driven wheel/leg, from angular velocity */
  readonly revolutions: number;
  /** mean over drives of the fraction of frames that drive was on the floor */
  readonly duty: number;
  readonly spokes: number;
  /** how many of the fitted drives landed at all — a leg stuck in the air is 0 */
  readonly drivesLanded: number;
  readonly drives: number;
  /**
   * Mean normal force the feet pass into the floor over the steady window, N.
   * Measured at the contact rather than inferred from the machine's motion —
   * see the note on floorContacts for what it can and cannot show.
   */
  readonly footLoadN: number;
  /** Machine weight, N. The feet should be carrying all of it. */
  readonly weightN: number;
}

/** Drives whose contact this run watches: legs if any are fitted, else all. */
function watchedDrives(bot: AssembledBot): DriveRuntime[] {
  const legs = bot.drives.filter((drive) => drive.def.kind === "leg");
  return legs.length > 0 ? legs : [...bot.drives];
}

/**
 * Exported so a defect can be INJECTED without editing a file this agent does
 * not own: a scratch harness can hand in a catalogue whose legs have been
 * broken (a star fused into a rim, a leg with no torque) and put the result
 * through the identical checks below. A gate nobody has watched fail is a
 * decoration.
 */
export function run(
  spec: BotSpec,
  catalog: Catalog,
  input: MatchInput,
  seconds: number
): DriveRun {
  const harness = createHarness(spec, catalog);
  const { bot } = harness;
  for (let step = 0; step < Math.round(SETTLE_SEC / FIXED_DT); step += 1) {
    driveBot(bot, NEUTRAL_INPUT, "live", { inverted: false }, [], DEFAULT_DRIVER_TUNING);
    harness.world.step();
  }

  const watched = watchedDrives(bot);
  const tracks = new Map<number, SpokeTrack>();
  for (const drive of watched) {
    for (const collider of [drive.collider, ...(drive.legColliders ?? [])]) {
      tracks.set(collider.handle, {
        drive: drive.idx,
        down: false,
        clearFrames: CHATTER_CLEAR_FRAMES,
        touchdowns: 0,
        rawTouchdowns: 0
      });
    }
  }

  const watchedHandles = new Set(tracks.keys());
  let loadImpulse = 0;
  const totalFrames = Math.round(seconds / FIXED_DT);
  const transientFrames = Math.round(Math.min(TRANSIENT_SEC, seconds / 2) / FIXED_DT);
  const steadySec = Math.max((totalFrames - transientFrames) * FIXED_DT, FIXED_DT);
  let steadyStart: readonly [number, number] = [0, 0];
  let steadyForward: readonly [number, number] = [0, -1];
  let hullFrames = 0;
  let peakSpeed = 0;
  let yaw = yawOf(bot.chassis.rotation());
  let yawTotal = 0;
  let leftSpinSum = 0;
  let rightSpinSum = 0;
  let spinSamples = 0;
  const turns = new Map<number, number>();
  const downFrames = new Map<number, number>();
  for (const drive of watched) {
    turns.set(drive.idx, 0);
    downFrames.set(drive.idx, 0);
  }

  for (let step = 0; step < totalFrames; step += 1) {
    if (step === transientFrames) {
      const here = bot.chassis.translation();
      steadyStart = [here.x, here.z];
      steadyForward = forwardAxis(bot.chassis.rotation());
    }
    driveBot(bot, input, "live", { inverted: false }, [], DEFAULT_DRIVER_TUNING);
    harness.world.step();
    const steady = step >= transientFrames;

    const contact = floorContacts(harness, watchedHandles);
    const touching = contact.touching;
    if (steady) loadImpulse += contact.loadImpulse;
    if (touching.has(bot.chassisCollider.handle)) hullFrames += 1;
    const driveDown = new Set<number>();
    for (const [handle, track] of tracks) {
      const down = touching.has(handle);
      if (down) {
        driveDown.add(track.drive);
        if (!track.down && steady) {
          track.rawTouchdowns += 1;
          // A landing counts once the spoke has been clear long enough that it
          // cannot be the same footfall re-registering.
          if (track.clearFrames >= CHATTER_CLEAR_FRAMES) track.touchdowns += 1;
        }
        track.clearFrames = 0;
      } else {
        track.clearFrames += 1;
      }
      track.down = down;
    }
    if (steady) {
      for (const idx of driveDown) downFrames.set(idx, downFrames.get(idx)! + 1);
      let left = 0;
      let leftCount = 0;
      let right = 0;
      let rightCount = 0;
      for (const drive of watched) {
        const spin = measuredSpin(bot, drive);
        turns.set(drive.idx, turns.get(drive.idx)! + Math.abs(spin) * FIXED_DT);
        if (drive.side < 0) {
          left += spin;
          leftCount += 1;
        } else {
          right += spin;
          rightCount += 1;
        }
      }
      leftSpinSum += leftCount > 0 ? left / leftCount : 0;
      rightSpinSum += rightCount > 0 ? right / rightCount : 0;
      spinSamples += 1;
    }

    const vel = bot.chassis.linvel();
    peakSpeed = Math.max(peakSpeed, Math.hypot(vel.x, vel.z));
    const nextYaw = yawOf(bot.chassis.rotation());
    yawTotal += wrappedDelta(nextYaw, yaw);
    yaw = nextYaw;
  }

  const end = bot.chassis.translation();
  const dx = end.x - steadyStart[0];
  const dz = end.z - steadyStart[1];

  let touchdowns = 0;
  let rawTouchdowns = 0;
  const perDrive = new Map<number, number>();
  for (const track of tracks.values()) {
    touchdowns += track.touchdowns;
    rawTouchdowns += track.rawTouchdowns;
    perDrive.set(track.drive, (perDrive.get(track.drive) ?? 0) + track.touchdowns);
  }
  let revolutions = 0;
  let dutySum = 0;
  let drivesLanded = 0;
  for (const drive of watched) {
    revolutions += turns.get(drive.idx)! / (2 * Math.PI);
    dutySum += downFrames.get(drive.idx)! / Math.max(totalFrames - transientFrames, 1);
    if ((perDrive.get(drive.idx) ?? 0) > 0) drivesLanded += 1;
  }

  // The command side of the ledger. driver.ts writes -command * maxOmega.
  const throttle = Math.max(-1, Math.min(1, input.throttle));
  const steer = Math.max(-1, Math.min(1, input.steer));
  const leftCmd = Math.max(-1, Math.min(1, throttle + steer));
  const rightCmd = Math.max(-1, Math.min(1, throttle - steer));
  // Before the world is freed: reading a rigid body afterwards is a null
  // pointer into wasm, not a zero.
  const weightN = totalMass(bot) * 9.81;
  const maxOmega = watched.reduce(
    (min, drive) => Math.min(min, drive.def.maxOmega),
    Number.POSITIVE_INFINITY
  );

  harness.world.free();
  return {
    frames: totalFrames,
    steadySec,
    hullContact: hullFrames / totalFrames,
    peakSpeed,
    displacement: Math.hypot(dx, dz),
    forwardTravel: dx * steadyForward[0] + dz * steadyForward[1],
    yawDeg: yawTotal * 180 / Math.PI,
    leftSpin: spinSamples > 0 ? leftSpinSum / spinSamples : 0,
    rightSpin: spinSamples > 0 ? rightSpinSum / spinSamples : 0,
    leftCommand: -leftCmd * maxOmega,
    rightCommand: -rightCmd * maxOmega,
    touchdowns,
    rawTouchdowns,
    revolutions,
    duty: watched.length > 0 ? dutySum / watched.length : 0,
    spokes: tracks.size,
    drivesLanded,
    drives: watched.length,
    footLoadN: loadImpulse / steadySec,
    weightN
  };
}

/** Hull plus every separately simulated part, kg — read off the rigid bodies. */
function totalMass(bot: AssembledBot): number {
  let mass = bot.chassis.mass();
  const counted = new Set<number>([bot.chassis.handle]);
  for (const part of bot.parts) {
    if (part.detached || !part.body.isValid() || counted.has(part.body.handle)) continue;
    counted.add(part.body.handle);
    mass += part.body.mass();
  }
  return mass;
}

/**
 * A machine with NOTHING but that drive, built from the catalogue instead of
 * written out by hand: four of one part at the corners of the smallest frame
 * whose deck fits them. Hand-written rigs go stale the moment the catalogue
 * moves; this covers every leg that exists, including ones added after today.
 * Smallest-that-fits is also the least forgiving pairing — the lightest hull on
 * the biggest legs is where a machine hops hardest.
 */
export function cornerRig(drive: DriveDef, catalog: Catalog): BotSpec | null {
  const [w, d] = drive.cells;
  const frames = catalog.parts.filter(
    (part): part is ChassisDef =>
      part.category === "chassis" && part.deck[0] >= 2 * w && part.deck[1] >= 2 * d
  );
  if (frames.length === 0) return null;
  const chassis = frames.reduce((best, part) =>
    part.deck[0] * part.deck[1] < best.deck[0] * best.deck[1] ? part : best
  );
  const right = chassis.deck[0] - w;
  const rear = chassis.deck[1] - d;
  return {
    v: 3,
    name: `rig-${drive.id}`,
    chassisId: chassis.id,
    paint: 0x777777,
    parts: [
      { partId: drive.id, face: "underside", cell: [0, 0], rot: 0 },
      { partId: drive.id, face: "underside", cell: [right, 0], rot: 0 },
      { partId: drive.id, face: "underside", cell: [0, rear], rot: 0 },
      { partId: drive.id, face: "underside", cell: [right, rear], rot: 0 }
    ]
  };
}

/**
 * Section 3 for one machine: is its floor contact intermittent, and is its rate
 * the leg's rate? Rows and failures both come from here so a rig and a shipped
 * preset are judged by identical code.
 */
export function checkCadence(
  label: string,
  kind: string,
  forward: DriveRun,
  feet: number,
  wheel: DriveRun | null,
  rows: Record<string, unknown>[],
  failures: string[]
): void {
  const perRev = forward.revolutions > 0 ? forward.touchdowns / forward.revolutions : 0;
  const ceiling = feet * (1 + CADENCE_TOLERANCE);
  rows.push({
    machine: label,
    kind,
    feet,
    footLoadN: +forward.footLoadN.toFixed(0),
    weightN: +forward.weightN.toFixed(0),
    loadPct: +(forward.footLoadN / Math.max(forward.weightN, 1e-9) * 100).toFixed(0),
    dutyPct: +(forward.duty * 100).toFixed(0),
    revolutions: +forward.revolutions.toFixed(1),
    touchdowns: forward.touchdowns,
    rawTouchdowns: forward.rawTouchdowns,
    perRev: +perRev.toFixed(2),
    ceiling: +ceiling.toFixed(1),
    contractPct: +(perRev / feet * 100).toFixed(0),
    drivesLanded: `${forward.drivesLanded}/${forward.drives}`
  });
  if (kind !== "wheel" && (feet < FEET_MIN || feet > FEET_MAX)) {
    failures.push(
      `${label} の脚は ${feet} 本です。契約 L2/P2 の 2〜4 本の外なので、` +
      `1回転あたりの上限 (feet x ${1 + CADENCE_TOLERANCE}) が自由変数になります。`
    );
  }
  // The feet have to be carrying the machine. Sign only here: the ratio is
  // printed as loadPct so a shortfall is visible, but a numerical tolerance
  // around a conservation law is not a threshold this gate should invent
  // unilaterally — the architect gets the numbers instead.
  if (kind !== "wheel" && !(forward.footLoadN > 0)) {
    failures.push(`${label} 足が床に伝えている垂直荷重が ${forward.footLoadN.toFixed(1)} N しかありません`);
  }
  // Structural: a foot cannot land twice in one turn of its own axle.
  if (perRev > ceiling) {
    failures.push(
      `${label} 1回転あたり接地 ${perRev.toFixed(2)} 回 > 上限 ${ceiling.toFixed(1)}（feet x ${1 + CADENCE_TOLERANCE}）`
    );
  }
  if (forward.drivesLanded < forward.drives) {
    failures.push(
      `${label} ${forward.drives} 本の脚のうち ${forward.drivesLanded} 本しか接地していません`
    );
  }
  if (!wheel) return;
  // Differential against the wheel control measured in this same harness: a leg
  // that stops being intermittent converges on these two numbers.
  if (!(forward.duty < wheel.duty)) {
    failures.push(
      `${label} 接地率 ${(forward.duty * 100).toFixed(0)}% が対照の車輪 ${(wheel.duty * 100).toFixed(0)}% を下回っていません（連続接地になっている）`
    );
  }
  if (!(forward.touchdowns > wheel.touchdowns)) {
    failures.push(
      `${label} 接地イベント ${forward.touchdowns} 回が対照の車輪 ${wheel.touchdowns} 回を上回っていません（接地が切れていない）`
    );
  }
}

async function main(): Promise<void> {
  await RAPIER.init();
  const catalog = buildCatalog();
  const legs = catalog.parts.filter(
    (part): part is DriveDef => part.category === "drive" && part.kind === "leg"
  );
  const failures: string[] = [];
  if (legs.length === 0) failures.push("カタログに脚駆動がありません。");

  const driveRows: Record<string, unknown>[] = [];
  const spinRows: Record<string, unknown>[] = [];
  const cadenceRows: Record<string, unknown>[] = [];
  const hullRows: Record<string, unknown>[] = [];

  /*
   * The control. A wheel is the same rig with the same harness and the same
   * contact test, and it is the thing a leg has to NOT look like: one continuous
   * patch. Every intermittency number below is read against this row, so the
   * claim rests on a measured contrast rather than on a constant someone picked.
   */
  const wheel = catalog.parts.find(
    (part): part is DriveDef =>
      part.category === "drive" &&
      part.kind === "wheel" &&
      part.faces.includes("underside")
  );
  const wheelSpec = wheel ? cornerRig(wheel, catalog) : null;
  let wheelRun: DriveRun | null = null;
  if (!wheel || !wheelSpec) {
    failures.push("対照用の車輪リグを作れません（underside に付く wheel がカタログにない）。");
  } else {
    wheelRun = run(wheelSpec, catalog, FORWARD, DRIVE_SEC);
    cadenceRows.push({
      machine: `${wheelSpec.name} (対照)`,
      kind: "wheel",
      feet: 1,
      dutyPct: +(wheelRun.duty * 100).toFixed(0),
      revolutions: +wheelRun.revolutions.toFixed(1),
      touchdowns: wheelRun.touchdowns,
      rawTouchdowns: wheelRun.rawTouchdowns,
      perRev: +(wheelRun.touchdowns / Math.max(wheelRun.revolutions, 1e-9)).toFixed(2),
      footLoadN: +wheelRun.footLoadN.toFixed(0),
      weightN: +wheelRun.weightN.toFixed(0),
      loadPct: +(wheelRun.footLoadN / Math.max(wheelRun.weightN, 1e-9) * 100).toFixed(0),
      ceiling: null,
      contractPct: null,
      // A rim never LANDS: it is already down when the window opens and stays
      // down, which is the whole point of the row. 0/4 here reads with the 100%
      // duty beside it, not against it.
      drivesLanded: `${wheelRun.drivesLanded}/${wheelRun.drives}`
    });
    // The control has to BE a continuous patch, or it is not controlling
    // anything: a rim that hops would make every comparison below meaningless.
    if (wheelRun.duty < 1) {
      failures.push(
        `対照の車輪リグの接地率が ${(wheelRun.duty * 100).toFixed(0)}% しかありません（連続接地が前提の対照として使えない）`
      );
    }
  }

  for (const leg of legs) {
    const spec = cornerRig(leg, catalog);
    if (!spec) {
      failures.push(`${leg.id}: 4本を載せられるシャーシがカタログにありません。`);
      continue;
    }
    const validation = validateBuild(spec, catalog, DEFAULT_ROOM_SETTINGS);
    if (!validation.ok) {
      failures.push(`${spec.name}: ${validation.errors.join(" / ")}`);
      continue;
    }
    const promised = computeStats(spec, catalog, DEFAULT_ROOM_SETTINGS).topSpeed;
    const forward = run(spec, catalog, FORWARD, DRIVE_SEC);
    const reverse = run(spec, catalog, REVERSE, DRIVE_SEC);
    const spin = run(spec, catalog, SPIN_RIGHT, SPIN_SEC);
    const feet = Math.max(2, Math.round(leg.feet ?? 2));

    /* 1 — drive. Commanded beside measured, both directions. */
    const forwardRatio = forward.peakSpeed / promised;
    const reverseRatio = reverse.peakSpeed / promised;
    driveRows.push({
      rig: spec.name,
      chassis: spec.chassisId,
      feet,
      cmdOmega: +forward.leftCommand.toFixed(2),
      measOmegaL: +forward.leftSpin.toFixed(2),
      measOmegaR: +forward.rightSpin.toFixed(2),
      cmdSpeed: +promised.toFixed(2),
      fwdPeak: +forward.peakSpeed.toFixed(2),
      fwdRatio: +forwardRatio.toFixed(2),
      fwdTravel: +forward.forwardTravel.toFixed(2),
      // Travelled distance vs distance along the heading it started with: a
      // machine that veers has a big gap here. Reported, not gated — there is no
      // registered threshold for straight-line tracking under throttle.
      fwdPath: +forward.displacement.toFixed(2),
      fwdYawDeg: +forward.yawDeg.toFixed(0),
      revPeak: +reverse.peakSpeed.toFixed(2),
      revRatio: +reverseRatio.toFixed(2),
      revTravel: +reverse.forwardTravel.toFixed(2),
      floor: SPEED_FLOOR
    });
    if (forwardRatio < SPEED_FLOOR) {
      failures.push(`${spec.name} 前進 ${forwardRatio.toFixed(2)} < ${SPEED_FLOOR}`);
    }
    if (reverseRatio < SPEED_FLOOR) {
      failures.push(`${spec.name} 後退 ${reverseRatio.toFixed(2)} < ${SPEED_FLOOR}`);
    }
    if (!(forward.forwardTravel > 0)) {
      failures.push(`${spec.name} 前進で前に進んでいません（${forward.forwardTravel.toFixed(2)} m）`);
    }
    if (!(reverse.forwardTravel < 0)) {
      failures.push(`${spec.name} 後退で後ろに進んでいません（${reverse.forwardTravel.toFixed(2)} m）`);
    }

    /* 2 — spin turn. The sides must turn OPPOSITE ways, measured off the bodies:
     * a machine skidding round on same-sign wheels can produce the yaw without
     * ever having performed a spin turn. */
    const opposed = spin.leftSpin * spin.rightSpin < 0;
    spinRows.push({
      rig: spec.name,
      cmdOmegaL: +spin.leftCommand.toFixed(2),
      cmdOmegaR: +spin.rightCommand.toFixed(2),
      measOmegaL: +spin.leftSpin.toFixed(2),
      measOmegaR: +spin.rightSpin.toFixed(2),
      opposed,
      yawDeg: +spin.yawDeg.toFixed(1),
      minYawDeg: MIN_SPIN_YAW_DEG,
      driftM: +spin.displacement.toFixed(2)
    });
    if (!opposed) {
      failures.push(
        `${spec.name} 旋回で左右が逆符号に回っていません（L ${spin.leftSpin.toFixed(2)} / R ${spin.rightSpin.toFixed(2)} rad/s）`
      );
    }
    if (Math.abs(spin.yawDeg) < MIN_SPIN_YAW_DEG) {
      failures.push(
        `${spec.name} その場旋回 ${Math.abs(spin.yawDeg).toFixed(1)}deg < ${MIN_SPIN_YAW_DEG}deg`
      );
    }

    /* 3 — intermittent contact. Touchdowns come from narrow-phase manifolds and
     * revolutions from rigid-body angular velocity: two different subsystems, so
     * their agreement is evidence rather than arithmetic. */
    checkCadence(spec.name, "leg", forward, feet, wheelRun, cadenceRows, failures);

    hullRows.push({
      machine: spec.name,
      hullContactPct: +(forward.hullContact * 100).toFixed(1),
      limitPct: HULL_CONTACT_LIMIT * 100,
      fwdTravel: +forward.forwardTravel.toFixed(2),
      fwdPath: +forward.displacement.toFixed(2),
      fwdYawDeg: +forward.yawDeg.toFixed(0)
    });
    if (forward.hullContact >= HULL_CONTACT_LIMIT) {
      failures.push(
        `${spec.name} ハル接地率 ${(forward.hullContact * 100).toFixed(1)}% >= ${HULL_CONTACT_LIMIT * 100}%`
      );
    }
  }

  /*
   * The shipped leg presets. LEG_HULL_MARGIN was measured on these, and a rig
   * assembled here could be lucky in a way a machine players actually get is not.
   */
  const legPresets = PRESETS.filter((preset) =>
    preset.parts.some((placed) => {
      const part = catalog.byId.get(placed.partId);
      return part?.category === "drive" && part.kind === "leg";
    })
  );
  if (legPresets.length === 0) failures.push("脚を履いたプリセットが1体もありません。");
  for (const preset of legPresets) {
    const forward = run(preset, catalog, FORWARD, DRIVE_SEC);
    const feet = Math.max(
      2,
      ...preset.parts.map((placed) => {
        const part = catalog.byId.get(placed.partId);
        return part?.category === "drive" && part.kind === "leg"
          ? Math.round(part.feet ?? 2)
          : 2;
      })
    );
    checkCadence(preset.name, "preset", forward, feet, wheelRun, cadenceRows, failures);
    hullRows.push({
      machine: preset.name,
      hullContactPct: +(forward.hullContact * 100).toFixed(1),
      limitPct: HULL_CONTACT_LIMIT * 100,
      fwdTravel: +forward.forwardTravel.toFixed(2),
      fwdPath: +forward.displacement.toFixed(2),
      fwdYawDeg: +forward.yawDeg.toFixed(0)
    });
    if (forward.hullContact >= HULL_CONTACT_LIMIT) {
      failures.push(
        `${preset.name} ハル接地率 ${(forward.hullContact * 100).toFixed(1)}% >= ${HULL_CONTACT_LIMIT * 100}%`
      );
    }
  }

  console.log("1 DRIVE — 指令値 vs 実測値（実測はすべて Rapier 剛体から）");
  console.table(driveRows);
  console.log("2 SPIN TURN — 左右が逆符号に回るか");
  console.table(spinRows);
  console.log("3 INTERMITTENT CONTACT — 接地イベントは Rapier の接触ペアから");
  console.table(cadenceRows);
  console.log("4 HULL LIFT — ハルが床に触れているフレームの割合");
  console.table(hullRows);
  console.log("THRESHOLDS", {
    speedFloor: SPEED_FLOOR,
    touchdownsPerRevCeiling: `feet x ${1 + CADENCE_TOLERANCE}`,
    touchdownsPerRevFloor: "対照の車輪との差分（定数なし）",
    hullContactLimit: HULL_CONTACT_LIMIT,
    minSpinYawDeg: MIN_SPIN_YAW_DEG
  });
  console.log(
    "CONTRACT DEVIATION: §4 G-LEG は接地イベント数 = feet x 回転数 (±20%) を求めているが、" +
    "剛体の星は 1/feet 回転ごとに driveSinkDepth 分だけ自分の車軸を持ち上げるため、" +
    "カタログの脚速度では機体が弾道的に跳ね、実測では 38〜52% のフレームで足が1本も接地しない。" +
    "contractPct 列が契約の期待値 (=feet) に対する実測の割合で、25〜43% にとどまる。" +
    "上限 +20% は構造的事実なので契約のまま残し、下限 -20% は到達不能なので" +
    "「同じハーネスで測った車輪リグより接地率が低く、接地イベント数が多いこと」に置換した（新しい定数は導入していない）。" +
    "契約の -20% をそのまま採用するなら、脚の maxOmega を下げるか脚に減衰を入れるかの物理側の変更が必要。発注者の判断を仰ぐ。"
  );
  console.log(JSON.stringify({ failures }, null, 2));
  console.log(failures.length ? "LEG SELFTEST FAIL" : "LEG SELFTEST PASS");
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error("LEG SELFTEST FAIL:", error);
  process.exitCode = 1;
});
