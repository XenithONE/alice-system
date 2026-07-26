/**
 * G-PHASE — the drawn foot has to be where the physical foot is.
 *
 * A wheel is a solid of revolution: draw its rim at the wrong angle and nobody
 * can tell. A leg is not. Its phase IS its silhouette, so a phase that the
 * renderer worked out for itself — arenaScene used to integrate one out of how
 * far the hull had travelled — puts a foot through the floor while the physical
 * one is in the air. This gate measures that gap in millimetres.
 *
 * The two sides are read from different subsystems on purpose:
 *
 *   physical foot  the leg capsule's own world transform, straight off the
 *                  Rapier collider (translation/rotation/halfHeight/radius).
 *                  Not legSpokeLayout(), not DriveRuntime.phase — both of those
 *                  are inputs to the thing under test.
 *   drawn foot     the real render objects: mountPartObject() places the mount,
 *                  createLeg() builds the rig, applyPhase() turns it, and
 *                  legFootTip() names the tip. Nothing here re-implements the
 *                  renderer's arithmetic; it drives the renderer's own code.
 *   the wire       snapshotFromState() quantises the phase exactly as the host
 *                  does, so the measurement includes the rounding a guest sees.
 *
 * Each side also takes its axle from its own world — physics from the drive
 * rigid body, the renderer from the mount transform — so a foot height is never
 * built from the other side's numbers.
 *
 * Three phase sources are measured, and TWO of them are asserted to FAIL the
 * millimetre bar. A gate that only ever confirms the good path cannot tell you
 * it would have caught the bad one:
 *
 *   wire              production. must be under 1 mm.
 *   hull-integration  the fallback arenaScene used when wp was pinned to 0.
 *                     must be over 20 mm, i.e. the old defect is still visible
 *                     to this measurement.
 *   pre-step          the phase as it stands BEFORE world.step(), which is what
 *                     the snapshot would carry if DamageSystem.stateFor did not
 *                     re-sample. must be over 1 mm, i.e. that re-sample earns
 *                     its keep.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { buildCatalog, PRESETS } from "../parts/catalog";
import {
  assembleBot,
  sampleDrivePhases,
  type AssembledBot
} from "../sim/assemble";
import { FIXED_DT } from "../sim/balance";
import { DEFAULT_DRIVER_TUNING, driveBot } from "../sim/driver";
import { snapshotFromState } from "../net/snapshot";
import {
  NEUTRAL_INPUT,
  type BotSpec,
  type BotState,
  type Catalog,
  type ChassisDef,
  type DriveDef,
  type MatchInput,
  type MatchState,
  type PlacedPart
} from "../sim/types";
import { botMountGeometry, mountPartObject } from "./mounting";
import { createLeg, legFeet, legFootTip } from "./procedural/leg";
import type { ProceduralDrive } from "./procedural/types";

// Node-only gate script (same shim as legSelftest.ts / driveSelftest.ts).
declare const process: { exitCode?: number };

/* ---------------------------------------------------------------- */
/* registered thresholds                                             */
/* ---------------------------------------------------------------- */

/**
 * A millimetre. Chosen because it is roughly the width of the seam between a
 * foot pad and the floor at the camera distance this game plays at, and because
 * the wire's own rounding floor is 0.3 mm (3 dp of a radian on the catalogue's
 * largest leg, 0.30 m), so 1 mm leaves the quantiser three times its own error
 * and still lands two orders of magnitude below the 108 mm defect.
 */
const TOLERANCE_MM = 1;
/** The old hull-integration path has to still read as broken, or this gate is decorative. */
const SABOTAGE_FLOOR_MM = 20;
/** A one-solver-tick lag has to read as broken too. */
const STALE_FLOOR_MM = 1;
/**
 * How far a drive body may swing about the two axes its revolute joint pins.
 * The scalar phase channel cannot represent swing, so it is excluded from the
 * phase measurement — which means it needs a limit of its own or it becomes a
 * place for real defects to hide. 8 deg is above the 5.9 deg the hardest-landing
 * leg preset measures and far below anything a player would read as a wheel
 * hanging off its axle.
 */
const SWING_LIMIT_DEG = 8;

const SETTLE_SEC = 1.5;
const DRIVE_SEC = 4;

const FORWARD: MatchInput = { ...NEUTRAL_INPUT, throttle: 1 };
const SPIN_RIGHT: MatchInput = { ...NEUTRAL_INPUT, steer: 1 };

type PhaseSource = "wire" | "hull-integration" | "pre-step";

/* ---------------------------------------------------------------- */
/* the wire                                                          */
/* ---------------------------------------------------------------- */

const BLANK: Omit<BotState, "drivePhases"> = {
  seat: 0,
  name: "phase",
  alive: true,
  chassisHp: 100,
  chassisHpMax: 100,
  pos: [0, 0, 0],
  quat: [0, 0, 0, 1],
  vel: [0, 0, 0],
  weapons: [],
  detached: [],
  partCondition: [],
  immobileFor: 0,
  damageDealt: 0,
  damageTaken: 0,
  inverted: false,
  burningFor: 0,
  selfRightCooldown: 0,
  plant: { heat: 0, charge: 1, fuel: 1, load: 0 },
  nettedFor: 0,
  pinnedFor: 0,
  oiledFor: 0,
  tetheredBy: null,
  disabledBy: null
};

/**
 * Push the phases through the real host encoder. Rounding them here with a
 * local `toFixed(3)` would test this file's opinion of the wire format instead
 * of the wire format.
 */
function overTheWire(phases: readonly number[]): readonly number[] {
  const state: MatchState = {
    tick: 0,
    elapsed: 0,
    phase: "live",
    bots: [{ ...BLANK, drivePhases: phases }],
    entities: []
  };
  return snapshotFromState(state, 0, [], false).bots[0]!.wp;
}

/* ---------------------------------------------------------------- */
/* physics side                                                      */
/* ---------------------------------------------------------------- */

function toChassisFrame(
  bot: AssembledBot,
  point: RAPIER.Vector,
  scratch: THREE.Vector3
): THREE.Vector3 {
  const p = bot.chassis.translation();
  const q = bot.chassis.rotation();
  return scratch
    .set(point.x - p.x, point.y - p.y, point.z - p.z)
    .applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w).invert());
}

/**
 * Height of every foot of one leg above its own axle, in the chassis frame,
 * measured off the capsules Rapier is actually colliding with.
 *
 * Both capsule ends are computed and the one farther from the axle is taken as
 * the foot, so this does not depend on which way round assemble.ts happened to
 * orient the capsule.
 */
function physicalFootHeights(bot: AssembledBot, driveIndex: number): number[] {
  const drive = bot.drives[driveIndex]!;
  const axle = toChassisFrame(bot, drive.body.translation(), new THREE.Vector3());
  const heights: number[] = [];
  for (const collider of [drive.collider, ...(drive.legColliders ?? [])]) {
    const centre = toChassisFrame(bot, collider.translation(), new THREE.Vector3());
    const r = collider.rotation();
    const axis = new THREE.Vector3(0, collider.halfHeight() + collider.radius(), 0)
      .applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w))
      // The capsule axis is expressed in world space here; rotate it into the
      // chassis frame the same way the points were.
      .applyQuaternion(
        new THREE.Quaternion(
          bot.chassis.rotation().x,
          bot.chassis.rotation().y,
          bot.chassis.rotation().z,
          bot.chassis.rotation().w
        ).invert()
      );
    const a = centre.clone().add(axis);
    const b = centre.clone().sub(axis);
    const tip = a.distanceTo(axle) >= b.distanceTo(axle) ? a : b;
    heights.push(tip.y - axle.y);
  }
  return heights;
}

/**
 * The reference phase: the exact twist, recomputed from the two rigid bodies
 * every frame, with no accumulator, no wrapping and no quantisation.
 *
 * This is what makes the headline number non-circular. DriveRuntime.phase is
 * built the hard way — a wrapped delta per sample, summed over thousands of
 * frames, rounded to 3 dp on the wire — and every one of those steps can go
 * wrong on its own: a missed sample aliases, a bad wrap jumps a revolution, a
 * mis-indexed drive shows another leg's angle. None of that can hide behind
 * this reference, because this reference shares no state with it.
 *
 * It is also the ceiling for a one-scalar-per-drive channel. A revolute joint
 * is a solver constraint rather than a weld, so the drive body also SWINGS
 * about the two axes the joint pins; the renderer turns the leg about the axle
 * and nothing else, because that is the whole of BotSnap.wp. Feeding this
 * perfect twist in and still comparing against the raw capsules therefore
 * leaves exactly the swing, and that difference is reported as the floor.
 */
function idealTwist(bot: AssembledBot, driveIndex: number): number {
  const c = bot.chassis.rotation();
  const d = bot.drives[driveIndex]!.body.rotation();
  const w = c.w * d.w + c.x * d.x + c.y * d.y + c.z * d.z;
  const x = c.w * d.x - c.x * d.w - c.y * d.z + c.z * d.y;
  return w < 0 ? 2 * Math.atan2(-x, -w) : 2 * Math.atan2(x, w);
}

/** Angle the drive body has swung about the two axes the revolute joint pins, rad. */
function jointSwing(bot: AssembledBot, driveIndex: number): number {
  const c = bot.chassis.rotation();
  const d = bot.drives[driveIndex]!.body.rotation();
  const rel = new THREE.Quaternion(c.x, c.y, c.z, c.w)
    .invert()
    .multiply(new THREE.Quaternion(d.x, d.y, d.z, d.w));
  const twistNorm = Math.hypot(rel.x, rel.w) || 1;
  const twist = new THREE.Quaternion(rel.x / twistNorm, 0, 0, rel.w / twistNorm);
  const swing = rel.clone().multiply(twist.invert());
  return 2 * Math.acos(Math.min(1, Math.abs(swing.w)));
}

/* ---------------------------------------------------------------- */
/* render side                                                       */
/* ---------------------------------------------------------------- */

interface RenderDrive {
  readonly def: DriveDef;
  readonly rig: ProceduralDrive;
  readonly mount: THREE.Group;
  readonly radius: number;
  phase: number;
}

function buildRenderDrives(spec: BotSpec, catalog: Catalog): RenderDrive[] {
  const chassis = catalog.byId.get(spec.chassisId) as ChassisDef;
  const geometry = botMountGeometry(spec, catalog);
  const metal = new THREE.MeshStandardMaterial();
  const rubber = new THREE.MeshStandardMaterial();
  const out: RenderDrive[] = [];
  for (const placed of spec.parts) {
    const part = catalog.byId.get(placed.partId);
    if (!part || part.category !== "drive" || part.kind !== "leg") continue;
    const mount = new THREE.Group();
    // Exactly what createBot does: the outer group carries the mount transform
    // (including the L4 half-step bias), the ProceduralDrive is its child, and
    // applyPhase turns the child.
    mountPartObject(mount, chassis, part, placed as PlacedPart, 0, geometry);
    const rig = createLeg(part, rubber, metal);
    mount.add(rig.root);
    out.push({ def: part, rig, mount, radius: part.radius, phase: 0 });
  }
  return out;
}

/**
 * Every drawn foot as a 3-D offset from its own drawn axle.
 *
 * Heights alone cannot see a sign error. For a uniform star the SET of foot
 * heights is invariant under phase -> -phase, because {cos(theta_k + p)} and
 * {cos(theta_k - p)} are the same multiset when the spoke angles are closed
 * under negation — which they are, at both the left bias (0) and the right
 * bias (pi/feet). This gate was written to certify that the phase now comes
 * from the physics, and until this function existed it passed bit-identically
 * with the phase applied backwards.
 */
function drawnFootOffsets(drive: RenderDrive): THREE.Vector3[] {
  drive.rig.applyPhase(drive.phase);
  drive.mount.updateMatrixWorld(true);
  const offsets: THREE.Vector3[] = [];
  for (let k = 0; k < legFeet(drive.def); k += 1) {
    offsets.push(
      legFootTip(drive.def, k)
        .applyMatrix4(drive.rig.root.matrixWorld)
        .sub(drive.mount.position)
    );
  }
  return offsets;
}

/** Height of every drawn foot above its own drawn axle, in the chassis frame. */
function drawnFootHeights(drive: RenderDrive): number[] {
  drive.rig.applyPhase(drive.phase);
  drive.mount.updateMatrixWorld(true);
  const heights: number[] = [];
  for (let k = 0; k < legFeet(drive.def); k += 1) {
    const tip = legFootTip(drive.def, k).applyMatrix4(drive.rig.root.matrixWorld);
    heights.push(tip.y - drive.mount.position.y);
  }
  return heights;
}

/* ---------------------------------------------------------------- */
/* the run                                                           */
/* ---------------------------------------------------------------- */

export interface PhaseRun {
  readonly frames: number;
  /*
   * THE HEADLINE. Worst gap, in mm, between the foot the renderer draws from
   * the phase that travelled the wire and the foot it would draw from the exact
   * twist recomputed off the bodies. Same render path, same frame, same drive —
   * the only difference is the number, so this is the error the accumulate /
   * wrap / quantise / index chain adds and nothing else.
   */
  readonly worstPhaseFootMm: number;
  /**
   * The same comparison in 3-D rather than by height, foot k against foot k.
   * Heights are blind to the sign of the phase; positions are not.
   */
  readonly worstPhaseTipMm: number;
  /** worst |lowest drawn foot - lowest physical capsule|, mm — the reviewer's metric */
  readonly worstLowestFootMm: number;
  /** the same comparison fed the exact twist: what is left is joint swing, mm */
  readonly worstSwingFloorMm: number;
  /** worst elementwise gap after sorting both height sets, mm — index-free and stricter */
  readonly worstSortedFootMm: number;
  /** how far the physical axle sits from where the renderer puts it, mm */
  readonly worstAxleDriftMm: number;
  /** largest revolute-joint swing seen, degrees */
  readonly worstSwingDeg: number;
  /** largest per-drive change in wp between consecutive snapshots, rad */
  readonly maxWireStepRad: number;
  readonly leftPhase: number;
  readonly rightPhase: number;
  /** true when BotSnap.wp had no entry for a fitted drive */
  readonly wireMissing: boolean;
}

function run(
  spec: BotSpec,
  catalog: Catalog,
  input: MatchInput,
  seconds: number,
  source: PhaseSource
): PhaseRun {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = FIXED_DT;
  const ground = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0)
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(20, 1, 20).setFriction(1.35), ground);
  const bot = assembleBot(world, spec, catalog, 0, [0, 0, 0], 0);
  const drawn = buildRenderDrives(spec, catalog);

  // Which entries of bot.drives are legs, in fitted order — the same ordinal
  // BotSnap.wp is keyed by, counted here by walking spec.parts rather than by
  // trusting the renderer and the sim to agree.
  const legFitted: number[] = [];
  let fitted = 0;
  for (const placed of spec.parts) {
    const part = catalog.byId.get(placed.partId);
    if (!part || part.category === "chassis") continue;
    if (part.category !== "drive") continue;
    if (part.kind === "leg") legFitted.push(fitted);
    fitted += 1;
  }

  for (let step = 0; step < Math.round(SETTLE_SEC / FIXED_DT); step += 1) {
    driveBot(bot, NEUTRAL_INPUT, "live", { inverted: false }, [], DEFAULT_DRIVER_TUNING);
    world.step();
    sampleDrivePhases(bot);
  }

  const totalFrames = Math.round(seconds / FIXED_DT);
  let worstPhaseFoot = 0;
  let worstPhaseTip = 0;
  let worstLowestFoot = 0;
  let worstSwingFloor = 0;
  let worstSortedFoot = 0;
  let worstAxleDrift = 0;
  let worstSwing = 0;
  let maxWireStep = 0;
  let previousWire: readonly number[] | null = null;
  let hullX = bot.chassis.translation().x;
  let hullZ = bot.chassis.translation().z;

  for (let step = 0; step < totalFrames; step += 1) {
    driveBot(bot, input, "live", { inverted: false }, [], DEFAULT_DRIVER_TUNING);
    // Snapshot of the accumulator BEFORE the solver runs. This is what a
    // renderer would receive if nothing re-sampled after world.step().
    const stale = bot.drives.map((drive) => drive.phase);
    world.step();
    // The same call DamageSystem.stateFor makes before it publishes BotState.
    sampleDrivePhases(bot);

    const wire = overTheWire(bot.drives.map((drive) => drive.phase));
    const staleWire = overTheWire(stale);
    if (previousWire) {
      for (const [index, value] of wire.entries()) {
        maxWireStep = Math.max(maxWireStep, Math.abs(value - (previousWire[index] ?? value)));
      }
    }
    previousWire = wire;

    const here = bot.chassis.translation();
    const q = bot.chassis.rotation();
    // arenaScene's fallback measures travel along the hull's own forward axis.
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(
      new THREE.Quaternion(q.x, q.y, q.z, q.w)
    );
    const travelled = (here.x - hullX) * forward.x + (here.z - hullZ) * forward.z;
    hullX = here.x;
    hullZ = here.z;

    for (const [slot, driveIndex] of legFitted.entries()) {
      const target = drawn[slot]!;
      /*
       * The same decision arenaScene.applyBots makes, in the same order: take
       * the host's number when the wire carried one, otherwise integrate the
       * hull's travel. Written this way rather than as `wire[i]!` so that
       * emptying BotSnap.wp in snapshot.ts drops this gate into the fallback
       * and fails it, instead of quietly assigning undefined and reporting NaN.
       */
      const authoritative =
        source === "wire" ? wire[driveIndex]
          : source === "pre-step" ? staleWire[driveIndex]
            : undefined;
      if (authoritative !== undefined) target.phase = authoritative;
      // `+=`, matching arenaScene: `travelled` is measured along chassis +Z,
      // which is BACKWARD (sim/heading.ts defines forward as -Z), and driving
      // forward turns a drive negative. A gate that models the production
      // fallback with the opposite sign is not measuring the fallback.
      else target.phase += travelled / Math.max(target.radius, 0.03);
      worstSwing = Math.max(worstSwing, jointSwing(bot, driveIndex));

      const physical = physicalFootHeights(bot, driveIndex);
      const drawnHeights = drawnFootHeights(target);
      // The same rig, the same frame, turned instead by the exact twist. Kept
      // and restored so the hull-integration source keeps accumulating its own
      // running phase across frames rather than being reset by the reference.
      const drawnOffsets = drawnFootOffsets(target);
      const keep = target.phase;
      target.phase = idealTwist(bot, driveIndex);
      const referenceHeights = drawnFootHeights(target);
      const referenceOffsets = drawnFootOffsets(target);
      target.phase = keep;

      /*
       * Foot k against foot k, in three dimensions. Same rig, same frame, same
       * index — the only difference is the number that turned it, so any gap
       * is the phase and nothing else. This is the arm that sees a sign error:
       * a foot at -p sits on the far side of the circle from the same foot at
       * +p even when the two are at identical heights.
       */
      for (let k = 0; k < drawnOffsets.length; k += 1) {
        worstPhaseTip = Math.max(worstPhaseTip, drawnOffsets[k]!.distanceTo(referenceOffsets[k]!));
      }

      worstPhaseFoot = Math.max(
        worstPhaseFoot,
        Math.abs(Math.min(...drawnHeights) - Math.min(...referenceHeights))
      );
      worstLowestFoot = Math.max(
        worstLowestFoot,
        Math.abs(Math.min(...drawnHeights) - Math.min(...physical))
      );
      worstSwingFloor = Math.max(
        worstSwingFloor,
        Math.abs(Math.min(...referenceHeights) - Math.min(...physical))
      );
      const sortedPhysical = [...physical].sort((a, b) => a - b);
      const sortedDrawn = [...drawnHeights].sort((a, b) => a - b);
      const sortedReference = [...referenceHeights].sort((a, b) => a - b);
      for (const [index, value] of sortedDrawn.entries()) {
        worstSortedFoot = Math.max(worstSortedFoot, Math.abs(value - sortedPhysical[index]!));
        worstPhaseFoot = Math.max(worstPhaseFoot, Math.abs(value - sortedReference[index]!));
      }
      const axle = toChassisFrame(
        bot,
        bot.drives[driveIndex]!.body.translation(),
        new THREE.Vector3()
      );
      worstAxleDrift = Math.max(worstAxleDrift, axle.distanceTo(target.mount.position));
    }
  }

  const finalWire = overTheWire(bot.drives.map((drive) => drive.phase));
  let leftPhase = 0;
  let rightPhase = 0;
  let wireMissing = false;
  for (const driveIndex of legFitted) {
    const value = finalWire[driveIndex];
    // Recorded rather than asserted with `!`: a wire that carries nothing has
    // to be reported as "carries nothing", not as NaN.
    if (value === undefined) {
      wireMissing = true;
      continue;
    }
    if (bot.drives[driveIndex]!.side < 0) leftPhase += value;
    else rightPhase += value;
  }
  world.free();
  return {
    frames: totalFrames,
    worstPhaseFootMm: worstPhaseFoot * 1000,
    worstPhaseTipMm: worstPhaseTip * 1000,
    worstLowestFootMm: worstLowestFoot * 1000,
    worstSwingFloorMm: worstSwingFloor * 1000,
    worstSortedFootMm: worstSortedFoot * 1000,
    worstAxleDriftMm: worstAxleDrift * 1000,
    worstSwingDeg: worstSwing * 180 / Math.PI,
    maxWireStepRad: maxWireStep,
    leftPhase,
    rightPhase,
    wireMissing
  };
}

async function main(): Promise<void> {
  await RAPIER.init();
  const catalog = buildCatalog();
  const failures: string[] = [];
  const legPresets = PRESETS.filter((preset) =>
    preset.parts.some((placed) => {
      const part = catalog.byId.get(placed.partId);
      return part?.category === "drive" && part.kind === "leg";
    })
  );
  if (legPresets.length === 0) failures.push("脚を履いたプリセットが1体もありません。");

  const rows: Record<string, unknown>[] = [];
  const spinRows: Record<string, unknown>[] = [];
  for (const preset of legPresets) {
    const wire = run(preset, catalog, FORWARD, DRIVE_SEC, "wire");
    const sabotage = run(preset, catalog, FORWARD, DRIVE_SEC, "hull-integration");
    const stale = run(preset, catalog, FORWARD, DRIVE_SEC, "pre-step");
    rows.push({
      preset: preset.name,
      frames: wire.frames,
      phaseMm: +wire.worstPhaseFootMm.toFixed(3),
      phaseTipMm: +wire.worstPhaseTipMm.toFixed(3),
      absoluteMm: +wire.worstLowestFootMm.toFixed(3),
      swingFloorMm: +wire.worstSwingFloorMm.toFixed(3),
      swingDeg: +wire.worstSwingDeg.toFixed(2),
      // Two numbers per broken path: the index-free worst pairing, and the
      // lowest-foot-vs-lowest-foot figure the original review reported (108.5 mm
      // on leg-walker), so this gate can be checked against that report.
      hullIntegrationMm: +sabotage.worstPhaseFootMm.toFixed(1),
      hullIntegLowestMm: +sabotage.worstLowestFootMm.toFixed(1),
      preStepMm: +stale.worstPhaseFootMm.toFixed(1),
      preStepLowestMm: +stale.worstLowestFootMm.toFixed(1),
      axleDriftMm: +wire.worstAxleDriftMm.toFixed(2),
      /*
       * Sign of the phase after driving FORWARD. Negative, because driver.ts
       * commands -command * maxOmega about chassis-local +X. The renderer's old
       * fallback added +travel/radius, i.e. it turned every wheel the wrong way
       * — free to get wrong on a rim, not on a tread or a leg.
       */
      fwdPhaseRad: +wire.leftPhase.toFixed(1),
      maxWireStepRad: +wire.maxWireStepRad.toFixed(3),
      toleranceMm: TOLERANCE_MM
    });
    if (wire.worstPhaseTipMm >= TOLERANCE_MM) {
      failures.push(
        `${preset.name} 位相由来の足先位置差 ${wire.worstPhaseTipMm.toFixed(3)} mm >= ${TOLERANCE_MM} mm（3次元。高さだけでは符号の誤りが見えない）`
      );
    }
    if (wire.worstPhaseFootMm >= TOLERANCE_MM) {
      failures.push(
        `${preset.name} 位相由来の足先高さ差 ${wire.worstPhaseFootMm.toFixed(3)} mm >= ${TOLERANCE_MM} mm`
      );
    }
    /*
     * The absolute gap against the raw capsules cannot beat the joint swing, so
     * it is held to the swing floor plus the tolerance rather than to the
     * tolerance alone. Held all the same: if the swing floor itself ever grows
     * past the tolerance the machine has a different problem, and SWING_LIMIT_DEG
     * below is what catches that.
     */
    if (wire.worstLowestFootMm >= wire.worstSwingFloorMm + TOLERANCE_MM) {
      failures.push(
        `${preset.name} 描画と物理の足先高さ差 ${wire.worstLowestFootMm.toFixed(2)} mm が関節スイング下限 ${wire.worstSwingFloorMm.toFixed(2)} mm ＋ ${TOLERANCE_MM} mm を超えました`
      );
    }
    if (wire.worstSortedFootMm >= wire.worstSwingFloorMm + TOLERANCE_MM) {
      failures.push(
        `${preset.name} 足先高さ差(整列比較) ${wire.worstSortedFootMm.toFixed(2)} mm >= ${(wire.worstSwingFloorMm + TOLERANCE_MM).toFixed(2)} mm`
      );
    }
    /*
     * The swing floor is physics this channel does not carry, but it is not a
     * blank cheque: a revolute joint that has gone soft enough to move a foot a
     * centimetre is a defect in its own right, and without this the two checks
     * above would quietly absorb it.
     */
    if (wire.worstSwingDeg >= SWING_LIMIT_DEG) {
      failures.push(
        `${preset.name} 駆動関節のスイングが ${wire.worstSwingDeg.toFixed(2)}deg >= ${SWING_LIMIT_DEG}deg。revolute が緩みすぎています。`
      );
    }
    if (sabotage.worstPhaseFootMm <= SABOTAGE_FLOOR_MM) {
      failures.push(
        `${preset.name} 距離積分フォールバックが ${sabotage.worstPhaseFootMm.toFixed(1)} mm しかずれていません。この計測は旧欠陥を検出できていません。`
      );
    }
    if (stale.worstPhaseFootMm <= STALE_FLOOR_MM) {
      failures.push(
        `${preset.name} step前の位相でも ${stale.worstPhaseFootMm.toFixed(2)} mm しかずれません。stateFor の再サンプルが無意味になっています。`
      );
    }
    /*
     * Plain lerp between two snapshots is only safe while a drive turns less
     * than PI between them. Snapshots go out at 20 Hz, so measure against a
     * 20 Hz budget rather than the 60 Hz step this loop runs at.
     */
    if (wire.maxWireStepRad * 3 >= Math.PI) {
      failures.push(
        `${preset.name} 位相が1スナップショットで ${(wire.maxWireStepRad * 3).toFixed(2)} rad 進みます。補間が折り返します。`
      );
    }

    const spin = run(preset, catalog, SPIN_RIGHT, 2, "wire");
    const opposed = !spin.wireMissing && spin.leftPhase * spin.rightPhase < 0;
    spinRows.push({
      preset: preset.name,
      leftPhaseRad: +spin.leftPhase.toFixed(2),
      rightPhaseRad: +spin.rightPhase.toFixed(2),
      wireMissing: spin.wireMissing,
      opposed,
      phaseMm: +spin.worstPhaseFootMm.toFixed(3)
    });
    if (wire.wireMissing || spin.wireMissing) {
      failures.push(`${preset.name} BotSnap.wp に装着済み駆動ぶんの値がありません。`);
    }
    if (!opposed) {
      failures.push(
        `${preset.name} その場旋回でワイヤ上の位相が逆符号になっていません (L ${spin.leftPhase.toFixed(2)} / R ${spin.rightPhase.toFixed(2)})`
      );
    }
    if (spin.worstPhaseFootMm >= TOLERANCE_MM) {
      failures.push(
        `${preset.name} 旋回中の位相由来の足先高さ差 ${spin.worstPhaseFootMm.toFixed(3)} mm >= ${TOLERANCE_MM} mm`
      );
    }
  }

  console.log("1 FOOT HEIGHT — phaseMm=位相由来のずれ(本命) / absoluteMm=対Rapierコライダー実測 / swingFloorMm=関節スイングの下限");
  console.table(rows);
  console.log("2 SPIN TURN — ワイヤに載った位相が左右で逆符号か");
  console.table(spinRows);
  console.log("THRESHOLDS", {
    toleranceMm: TOLERANCE_MM,
    sabotageFloorMm: SABOTAGE_FLOOR_MM,
    staleFloorMm: STALE_FLOOR_MM,
    swingLimitDeg: SWING_LIMIT_DEG
  });
  console.log(JSON.stringify({ failures }, null, 2));
  console.log(failures.length ? "DRIVE PHASE SELFTEST FAIL" : "DRIVE PHASE SELFTEST PASS");
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error("DRIVE PHASE SELFTEST FAIL:", error);
  process.exitCode = 1;
});
