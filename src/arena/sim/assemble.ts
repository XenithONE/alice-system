import RAPIER from "@dimforge/rapier3d-compat";
import {
  DRIVE_ANGULAR_DAMPING,
  DRIVE_LINEAR_DAMPING,
  BOT_COLLISION_FRICTION,
  BOT_COLLISION_RESTITUTION,
  FUEL_L_PER_SEC,
  FIXED_DT,
  MIN_HIT_IMPULSE
} from "./balance";
import {
  driveSide,
  legSpokeLayout,
  hullLift,
  levelRises,
  partLocalPosition,
  placedRise
} from "./build";
import {
  CELL,
  type BotSpec,
  type Catalog,
  type ChassisDef,
  type DriveDef,
  type MountFace,
  type PartDef,
  type SeatIndex,
  type WeaponDef
} from "./types";
import { isInternalPart } from "./types";

export interface ColliderOwner {
  seat: SeatIndex;
  partIdx: number | null;
}

export interface RuntimePart {
  readonly idx: number;
  readonly def: PartDef;
  hp: number;
  readonly collider: RAPIER.Collider;
  readonly body: RAPIER.RigidBody;
  readonly joint: RAPIER.ImpulseJoint | null;
  readonly local: readonly [number, number, number];
  readonly face: MountFace;
  /** Elongated floor contact used by side-mounted tracks. */
  readonly trackContact?: RAPIER.Collider;
  /*
   * Legs only: the spoke capsules after the first. `collider` is spoke 0, so a
   * leg looks exactly like a wheel to every consumer of RuntimePart; these are
   * the rest of the same star on the same rigid body.
   */
  readonly legColliders?: readonly RAPIER.Collider[];
  detached: boolean;
}

export interface DriveRuntime extends RuntimePart {
  readonly def: DriveDef;
  readonly joint: RAPIER.RevoluteImpulseJoint;
  readonly side: -1 | 1;
  /*
   * Accumulated rotation about the axle, measured against the chassis, in
   * radians and continuous across turns. This is the ONLY place the number
   * lives: BotState.drivePhases copies it, BotSnap.wp quantises that copy, and
   * the renderer reads the copy. The renderer used to integrate it from how far
   * the hull had travelled, which is a different fact wearing the same name.
   */
  phase: number;
  /*
   * Last axle angle sampled, wrapped to (-PI, PI]. Kept so `phase` can be built
   * out of wrapped deltas — the raw angle folds at +/-PI and a leg turning
   * through the fold would otherwise jump a whole revolution.
   */
  phaseAngle: number;
}

export interface WeaponRuntime extends RuntimePart {
  readonly def: WeaponDef;
  readonly joint:
    | RAPIER.RevoluteImpulseJoint
    | RAPIER.PrismaticImpulseJoint
    | null;
  readonly spear: boolean;
  /** Chassis-local direction in which this mount attacks. */
  readonly mountDir: readonly [number, number, number];
  active: boolean;
  /** Motor velocity command after applying the symmetric spin-up/down ramp. */
  spinTarget: number;
  cooldownLeft: number;
  triggerGapLeft: number;
  strokeLeft: number;
  fuelLeft: number;
  dryLockoutLeft: number;
  wasPressed: boolean;
  clamping: SeatIndex | null;
  clampLeft: number;
  readonly impulseVictims: Set<SeatIndex>;
}

export interface AssembledBot {
  readonly seat: SeatIndex;
  readonly spec: BotSpec;
  readonly chassisDef: ChassisDef;
  readonly chassis: RAPIER.RigidBody;
  readonly chassisCollider: RAPIER.Collider;
  readonly parts: RuntimePart[];
  readonly drives: DriveRuntime[];
  readonly weapons: WeaponRuntime[];
  readonly colliderOwners: Map<number, ColliderOwner>;
  readonly powerMul: number;
  readonly weaponPowerMul: number;
  readonly hasSelfRight: boolean;
  readonly spinnerResist: number;
  readonly flameResist: number;
  readonly powerKw: number;
  readonly alternatorKw: number;
  readonly chargeCapacityKj: number;
  readonly fuelCapacityL: number;
  readonly coolingKw: number;
  readonly heatMul: number;
  heatJ: number;
  chargeKj: number;
  fuelL: number;
  usedW: number;
  selfRightCooldown: number;
}

const qIdentity = { x: 0, y: 0, z: 0, w: 1 };
const ARENA_BIT = 1 << 4;
const DEBRIS_BIT = 1 << 5;
const ALL_BOTS = 0b1111;

const pack = (memberships: number, filter: number): number =>
  ((memberships & 0xffff) << 16) | (filter & 0xffff);

/** Colliders belonging to one robot: everything except that same robot. */
export const botCollisionGroups = (seat: number): number =>
  pack(1 << seat, (ALL_BOTS & ~(1 << seat)) | ARENA_BIT | DEBRIS_BIT);

export const ARENA_COLLISION_GROUPS = pack(ARENA_BIT, ALL_BOTS | DEBRIS_BIT);
export const DEBRIS_COLLISION_GROUPS = pack(DEBRIS_BIT, ALL_BOTS | ARENA_BIT | DEBRIS_BIT);

function enableContactEvents(collider: RAPIER.Collider, seat?: number): void {
  collider.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
  collider.setContactForceEventThreshold(MIN_HIT_IMPULSE / FIXED_DT);
  if (seat !== undefined) collider.setCollisionGroups(botCollisionGroups(seat));
}

function rotatedSize(part: PartDef, rot: number): readonly [number, number] {
  return rot === 1 || rot === 3 ? [part.cells[1], part.cells[0]] : part.cells;
}

function worldOffset(x: number, z: number, yaw: number): readonly [number, number] {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return [cos * x + sin * z, -sin * x + cos * z];
}

function faceNormal(face: MountFace): readonly [number, number, number] {
  switch (face) {
    case "deck": return [0, 1, 0];
    case "underside": return [0, -1, 0];
    case "left": return [-1, 0, 0];
    case "right": return [1, 0, 0];
    case "front": return [0, 0, -1];
    case "rear": return [0, 0, 1];
    case "internal": return [0, 1, 0];
  }
}

function rotationFromY(axis: readonly [number, number, number]): RAPIER.Rotation {
  if (axis[0] === 1) return { x: 0, y: 0, z: -Math.SQRT1_2, w: Math.SQRT1_2 };
  if (axis[0] === -1) return { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };
  if (axis[1] === -1) return { x: 1, y: 0, z: 0, w: 0 };
  if (axis[2] === 1) return { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
  if (axis[2] === -1) return { x: -Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
  return qIdentity;
}

function faceHalfExtents(
  part: PartDef,
  rot: number,
  face: MountFace
): readonly [number, number, number] {
  const [w, d] = rotatedSize(part, rot);
  if (face === "deck" || face === "underside" || face === "internal") {
    return [w * CELL / 2, part.height / 2, d * CELL / 2];
  }
  if (face === "left" || face === "right") {
    return [part.height / 2, d * CELL / 2, w * CELL / 2];
  }
  return [w * CELL / 2, d * CELL / 2, part.height / 2];
}

function createBoxCollider(
  world: RAPIER.World,
  body: RAPIER.RigidBody,
  part: PartDef,
  local: readonly [number, number, number],
  rot: number,
  face: MountFace,
  seat: number
): RAPIER.Collider {
  const [hx, hy, hz] = faceHalfExtents(part, rot, face);
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(local[0], local[1], local[2])
      .setMass(part.mass),
    body
  );
  enableContactEvents(collider, seat);
  return collider;
}

function isSpear(def: WeaponDef): boolean {
  return def.effect === "impulse" && def.mechanism === "prismatic";
}

/**
 * The twist of a chassis-relative rotation about the axle, wrapped to
 * (-PI, PI].
 *
 * Every drive's revolute joint turns about chassis-local X (see the JointData
 * below), so the twist component of conj(chassis) * drive about X is exactly
 * how far that drive has turned in its mount. Only the x and w components of
 * the relative quaternion take part: the y and z components are the swing the
 * joint is not supposed to have.
 */
function axleTwist(
  chassis: RAPIER.Rotation,
  drive: RAPIER.Rotation
): number {
  // conj(chassis) * drive, x and w only.
  const w =
    chassis.w * drive.w + chassis.x * drive.x + chassis.y * drive.y + chassis.z * drive.z;
  const x =
    chassis.w * drive.x - chassis.x * drive.w - chassis.y * drive.z + chassis.z * drive.y;
  // q and -q are the same rotation; pinning w >= 0 keeps 2*atan2 inside one turn.
  return w < 0 ? 2 * Math.atan2(-x, -w) : 2 * Math.atan2(x, w);
}

/**
 * Re-sync every drive's accumulated axle rotation with the bodies.
 *
 * Safe to call more than once per step and safe to call more often than the
 * solver runs: each call adds the wrapped difference since the previous call,
 * so the sum telescopes and extra calls contribute exactly zero. It is called
 * from driveBot, which guarantees at least one sample per physics step (so a
 * turn can never alias past PI), and again from DamageSystem.stateFor, so the
 * state published AFTER world.step() carries the post-step angle rather than a
 * frame-old one. A one-step lag is not cosmetic here: at a leg's 16 rad/s it is
 * 0.27 rad, which puts the drawn foot 58 mm from the physical one.
 */
export function sampleDrivePhases(bot: AssembledBot): void {
  const chassisRotation = bot.chassis.rotation();
  for (const drive of bot.drives) {
    if (drive.detached || !drive.body.isValid()) continue;
    const angle = axleTwist(chassisRotation, drive.body.rotation());
    let delta = angle - drive.phaseAngle;
    if (delta > Math.PI) delta -= 2 * Math.PI;
    else if (delta < -Math.PI) delta += 2 * Math.PI;
    drive.phase += delta;
    drive.phaseAngle = angle;
  }
}

export function assembleBot(
  world: RAPIER.World,
  spec: BotSpec,
  catalog: Catalog,
  seat: SeatIndex,
  origin: readonly [number, number, number],
  facing: number
): AssembledBot {
  const chassisDef = catalog.byId.get(spec.chassisId);
  if (!chassisDef || chassisDef.category !== "chassis") {
    throw new Error(`Invalid chassis: ${spec.chassisId}`);
  }
  const chassisRotation = {
    x: 0,
    y: Math.sin(facing / 2),
    z: 0,
    w: Math.cos(facing / 2)
  };
  /*
   * How far the hull rides above its axles. Zero unless a leg is fitted: a star
   * of spokes only guarantees its inscribed circle between footfalls, so
   * without this the hull is on the floor for most of the match and the machine
   * sleds on its belly with its legs turning in the air. Derived in build.ts so
   * the mesh, the centre of mass and this collider cannot disagree.
   */
  const lift = hullLift(spec, catalog);
  const chassis = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(origin[0], origin[1], origin[2])
      .setRotation(chassisRotation)
      .setLinearDamping(DRIVE_LINEAR_DAMPING)
      .setAngularDamping(DRIVE_ANGULAR_DAMPING)
      .setCcdEnabled(true)
  );
  const chassisCollider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(
      chassisDef.deck[0] * CELL / 2,
      chassisDef.height / 2,
      chassisDef.deck[1] * CELL / 2
    )
      .setTranslation(0, chassisDef.groundClearance + lift + chassisDef.height / 2, 0)
      .setMass(chassisDef.mass)
      .setFriction(BOT_COLLISION_FRICTION)
      .setRestitution(BOT_COLLISION_RESTITUTION),
    chassis
  );
  enableContactEvents(chassisCollider, seat);

  const colliderOwners = new Map<number, ColliderOwner>([
    [chassisCollider.handle, { seat, partIdx: null }]
  ]);
  const parts: RuntimePart[] = [];
  const drives: DriveRuntime[] = [];
  const weapons: WeaponRuntime[] = [];
  let powerMul = 1;
  let weaponPowerMul = 1;
  let hasSelfRight = false;
  let spinnerResist = 1;
  let flameResist = 1;
  let powerKw = chassisDef.stockPowerKw;
  let alternatorKw = chassisDef.stockAlternatorKw;
  let chargeCapacityKj = chassisDef.stockChargeKj;
  let fuelCapacityL = chassisDef.stockFuelL;
  let coolingKw = chassisDef.stockCoolingKw;
  let heatWeightedKw = chassisDef.stockPowerKw;

  /*
   * Storey heights, resolved ONCE for the whole machine. levelRises() in
   * build.ts is the only place a rise is summed; assemble and render both feed
   * its answer into partLocalPosition. Adding rises here instead would be the
   * same defect that put the side wheels 5 cm high and 7 cm outboard: one fact,
   * written down twice, drifting apart.
   */
  const rises = levelRises(spec, catalog);

  for (const [idx, placed] of spec.parts.entries()) {
    const def = catalog.byId.get(placed.partId);
    if (!def || def.category === "chassis") continue;
    const local = partLocalPosition(
      chassisDef,
      def,
      placed.cell,
      placed.rot,
      placed.face,
      { levelRise: placedRise(rises, placed), hullLift: lift }
    );

    if (
      def.category === "armor" ||
      // A riser is structure, but physically it is a plate welded to the hull:
      // a fixed collider on the chassis body, no second rigid body (H8). Rapier
      // composes its mass into the hull, so the centre of mass the builder
      // prints and the one the solver uses come out of the same geometry.
      def.category === "structure" ||
      def.category === "utility" ||
      (def.category === "weapon" &&
        (def.effect === "flame" ||
          def.effect === "static" ||
          def.effect === "deploy" ||
          def.effect === "net" ||
          def.effect === "harpoon"))
    ) {
      const collider = createBoxCollider(world, chassis, def, local, placed.rot, placed.face, seat);
      const runtime: RuntimePart = {
        idx,
        def,
        hp: def.hp,
        collider,
        body: chassis,
        joint: null,
        local,
        face: placed.face,
        detached: false
      };
      parts.push(runtime);
      colliderOwners.set(collider.handle, { seat, partIdx: idx });
      if (def.category === "armor") {
        spinnerResist = Math.min(spinnerResist, def.spinnerResist ?? 1);
        flameResist = Math.min(flameResist, def.flameResist ?? 1);
      } else if (def.category === "utility") {
        powerMul *= def.powerMul ?? 1;
        weaponPowerMul *= def.weaponPowerMul ?? 1;
        hasSelfRight ||= def.selfRight === true;
        if (isInternalPart(def)) {
          const addedPowerKw = def.powerKw ?? 0;
          powerKw += addedPowerKw;
          alternatorKw += def.alternatorKw ?? 0;
          chargeCapacityKj += def.chargeKj ?? 0;
          fuelCapacityL += def.fuelL ?? 0;
          coolingKw += def.coolingKw ?? 0;
          heatWeightedKw += addedPowerKw * (def.heatMul ?? 1);
        }
      } else if (def.category === "weapon") {
        weapons.push({
          ...runtime,
          def,
          joint: null,
          spear: false,
          mountDir: faceNormal(placed.face),
          active: false,
          spinTarget: 0,
          cooldownLeft: 0,
          triggerGapLeft: 0,
          strokeLeft: 0,
          fuelLeft: def.fuel ?? 0,
          dryLockoutLeft: 0,
          wasPressed: false,
          clamping: null,
          clampLeft: 0,
          impulseVictims: new Set()
        });
      }
      continue;
    }

    if (def.category === "drive") {
      const radius = def.radius;
      const halfWidth = Math.max(def.height, CELL) / 2;
      const driveLocal: [number, number, number] = [local[0], radius, local[2]];
      const [worldX, worldZ] = worldOffset(driveLocal[0], driveLocal[2], facing);
      // Needed before the colliders because a leg's phase bias depends on it:
      // the right side starts half a step out of phase so the machine walks
      // rather than hops (L4).
      const side: -1 | 1 =
        driveSide(
          chassisDef,
          placed.face,
          placed.cell,
          rotatedSize(def, placed.rot)[0]
        ) || (local[0] < 0 ? -1 : 1);
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(origin[0] + worldX, origin[1] + radius, origin[2] + worldZ)
          .setRotation(chassisRotation)
          .setCcdEnabled(true)
      );
      /*
       * A leg is `feet` capsules on this ONE body, turned by the ONE revolute
       * motor built below — identical physical topology to a wheel, which is
       * why driver.ts, damage.ts and the wire format carry no leg branch at all.
       * legSpokeLayout() (build.ts) owns the geometry so the renderer draws the
       * same star the solver collides with.
       */
      const spokes: RAPIER.Collider[] = [];
      if (def.kind === "leg") {
        const layout = legSpokeLayout(def, side);
        for (const theta of layout.angles) {
          // Rotation about chassis-local X by theta sends the capsule's own +Y
          // axis to (0, cos, sin); the centre rides out along that same
          // direction by `d`, so the tip lands exactly on `radius` (§6.4).
          const half = theta / 2;
          const spoke = world.createCollider(
            RAPIER.ColliderDesc.capsule(layout.halfHeight, layout.capsuleRadius)
              .setRotation({ x: Math.sin(half), y: 0, z: 0, w: Math.cos(half) })
              .setTranslation(
                0,
                Math.cos(theta) * layout.d,
                Math.sin(theta) * layout.d
              )
              .setMass(def.mass / layout.feet)
              .setFriction(def.friction),
            body
          );
          enableContactEvents(spoke, seat);
          spokes.push(spoke);
        }
      } else {
        const wheel = world.createCollider(
          RAPIER.ColliderDesc.cylinder(halfWidth, radius)
            .setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 })
            .setMass(def.mass)
            .setFriction(def.friction),
          body
        );
        enableContactEvents(wheel, seat);
        spokes.push(wheel);
      }
      const collider = spokes[0]!;
      let trackContact: RAPIER.Collider | undefined;
      if (
        def.kind === "track" &&
        (placed.face === "left" || placed.face === "right")
      ) {
        const contactHeight = Math.max(def.height * 0.45, 0.035);
        const contactLength = Math.max(def.cells[0], def.cells[1]) * CELL;
        trackContact = world.createCollider(
          RAPIER.ColliderDesc.cuboid(
            Math.max(def.height / 2, 0.04),
            contactHeight / 2,
            contactLength / 2
          )
            .setTranslation(driveLocal[0], contactHeight / 2, driveLocal[2])
            // The shoe itself slides while the motorized sprocket plus the
            // bounded traction model supply belt motion.
            .setFriction(0.05)
            .setDensity(0),
          chassis
        );
        enableContactEvents(trackContact, seat);
      }
      const joint = world.createImpulseJoint(
        RAPIER.JointData.revolute(
          { x: driveLocal[0], y: driveLocal[1], z: driveLocal[2] },
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 }
        ),
        chassis,
        body,
        true
      ) as RAPIER.RevoluteImpulseJoint;
      joint.setContactsEnabled(false);
      joint.configureMotorVelocity(0, def.torque);
      const runtime: DriveRuntime = {
        idx,
        def,
        hp: def.hp,
        collider,
        body,
        joint,
        local: driveLocal,
        face: placed.face,
        trackContact,
        legColliders: spokes.length > 1 ? spokes.slice(1) : undefined,
        detached: false,
        side,
        /*
         * Zero because the body is created with the chassis' own rotation, so
         * the relative twist really is zero here — and because a leg's spoke
         * angles already carry the L4 half-step bias inside legSpokeLayout(),
         * exactly like the renderer carries it in driveMountQuaternion(). The
         * phase is the turning on top of that mounting, not the mounting.
         */
        phase: 0,
        phaseAngle: 0
      };
      parts.push(runtime);
      drives.push(runtime);
      // Every spoke, not just the first: a leg struck on its third foot has to
      // take the damage, and a leg standing on a caltrop with its second foot
      // has to trip over it.
      for (const spoke of spokes) {
        colliderOwners.set(spoke.handle, { seat, partIdx: idx });
      }
      if (trackContact) colliderOwners.set(trackContact.handle, { seat, partIdx: idx });
      continue;
    }

    const spear = isSpear(def);
    const spinHorizontal = def.spinAxis !== "vertical";
    const mountDir = faceNormal(placed.face);
    const [worldX, worldZ] = worldOffset(local[0], local[2], facing);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(origin[0] + worldX, origin[1] + local[1], origin[2] + worldZ)
        .setRotation(chassisRotation)
        .setCcdEnabled(true)
    );
    let collider: RAPIER.Collider;
    if (def.effect === "spin" || def.effect === "grind") {
      const baseRadius = Math.max(def.cells[0], def.cells[1]) * CELL / 2 + def.reach;
      const drill = def.type === "drill";
      const radius = drill
        ? Math.max(def.height / 2, CELL * 0.2)
        :
        def.pairMount === true
          ? Math.max(baseRadius, chassisDef.deck[0] * CELL / 2 + def.reach)
          : baseRadius;
      const spinAxis: readonly [number, number, number] = spinHorizontal
        ? mountDir
        : placed.face === "left" || placed.face === "right"
          ? [0, 1, 0]
          : [1, 0, 0];
      collider = world.createCollider(
        RAPIER.ColliderDesc.cylinder(
          drill ? Math.max(def.height / 2, def.reach / 2) : def.height / 2,
          radius
        )
          .setRotation(rotationFromY(spinAxis))
          .setMass(def.mass),
        body
      );
      if (def.inertia !== undefined) {
        const radial = Math.max(def.inertia / 2, Number.EPSILON);
        collider.setMassProperties(
          def.mass,
          { x: 0, y: 0, z: 0 },
          spinHorizontal
            ? { x: radial, y: def.inertia, z: radial }
            : { x: def.inertia, y: radial, z: radial },
          qIdentity
        );
      }
    } else {
      const [hx, hy, hz] = faceHalfExtents(def, placed.rot, placed.face);
      collider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy, hz).setMass(def.mass),
        body
      );
    }
    enableContactEvents(collider, seat);
    if (def.effect === "grind" || def.effect === "clamp") {
      collider.setContactForceEventThreshold(0);
    }

    let joint: RAPIER.RevoluteImpulseJoint | RAPIER.PrismaticImpulseJoint;
    if (spear) {
      joint = world.createImpulseJoint(
        RAPIER.JointData.prismatic(
          { x: local[0], y: local[1], z: local[2] },
          { x: 0, y: 0, z: 0 },
          { x: mountDir[0], y: mountDir[1], z: mountDir[2] }
        ),
        chassis,
        body,
        true
      ) as RAPIER.PrismaticImpulseJoint;
      joint.setLimits(0, def.sweep ?? 0);
    } else {
      const axis =
        def.effect === "spin" || def.effect === "grind"
          ? spinHorizontal
            ? { x: mountDir[0], y: mountDir[1], z: mountDir[2] }
            : placed.face === "left" || placed.face === "right"
              ? { x: 0, y: 1, z: 0 }
              : { x: 1, y: 0, z: 0 }
          : { x: 1, y: 0, z: 0 };
      joint = world.createImpulseJoint(
        RAPIER.JointData.revolute(
          { x: local[0], y: local[1], z: local[2] },
          { x: 0, y: 0, z: 0 },
          axis
        ),
        chassis,
        body,
        true
      ) as RAPIER.RevoluteImpulseJoint;
      if (def.effect === "impulse" || def.effect === "clamp") {
        joint.setLimits(0, def.sweep ?? 0);
      }
    }
    joint.setContactsEnabled(false);
    if (def.effect === "spin" || def.effect === "grind") {
      joint.configureMotorVelocity(0, def.spinUpTorque ?? 0);
    } else {
      const stroke = Math.max(def.strokeSec ?? 0.25, FIXED_DT);
      const stiffness = def.mass * 4 / (stroke * stroke);
      const damping = 4 * def.mass / stroke;
      joint.configureMotorPosition(0, stiffness, damping);
    }
    const runtime: WeaponRuntime = {
      idx,
      def,
      hp: def.hp,
      collider,
      body,
      joint,
      local,
      face: placed.face,
      detached: false,
      spear,
      mountDir,
      active: false,
      spinTarget: 0,
      cooldownLeft: 0,
      triggerGapLeft: 0,
      strokeLeft: 0,
      fuelLeft: def.fuel ?? 0,
      dryLockoutLeft: 0,
      wasPressed: false,
      clamping: null,
      clampLeft: 0,
      impulseVictims: new Set()
    };
    parts.push(runtime);
    weapons.push(runtime);
    colliderOwners.set(collider.handle, { seat, partIdx: idx });
  }

  const initialFuelInLinesL = weapons.reduce(
    (sum, weapon) => sum + Math.max(0, weapon.fuelLeft) * FUEL_L_PER_SEC,
    0
  );
  if (initialFuelInLinesL > fuelCapacityL && initialFuelInLinesL > 0) {
    const fillScale = fuelCapacityL / initialFuelInLinesL;
    for (const weapon of weapons) weapon.fuelLeft *= fillScale;
  }
  const fuelL = Math.max(0, fuelCapacityL - initialFuelInLinesL);

  return {
    seat,
    spec,
    chassisDef,
    chassis,
    chassisCollider,
    parts,
    drives,
    weapons,
    colliderOwners,
    powerMul,
    weaponPowerMul,
    hasSelfRight,
    spinnerResist,
    flameResist,
    powerKw,
    alternatorKw,
    chargeCapacityKj,
    fuelCapacityL,
    coolingKw,
    heatMul: powerKw > 0 ? heatWeightedKw / powerKw : 1,
    heatJ: 0,
    chargeKj: chargeCapacityKj,
    fuelL,
    usedW: 0,
    selfRightCooldown: 0
  };
}
