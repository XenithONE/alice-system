import RAPIER from "@dimforge/rapier3d-compat";
import {
  DRIVE_ANGULAR_DAMPING,
  DRIVE_LINEAR_DAMPING,
  BOT_COLLISION_FRICTION,
  BOT_COLLISION_RESTITUTION,
  FIXED_DT,
  MIN_HIT_IMPULSE
} from "./balance";
import { driveSide, partLocalPosition } from "./build";
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
  detached: boolean;
}

export interface DriveRuntime extends RuntimePart {
  readonly def: DriveDef;
  readonly joint: RAPIER.RevoluteImpulseJoint;
  readonly side: -1 | 1;
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
  if (face === "deck" || face === "underside") {
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
      .setTranslation(0, chassisDef.groundClearance + chassisDef.height / 2, 0)
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

  for (const [idx, placed] of spec.parts.entries()) {
    const def = catalog.byId.get(placed.partId);
    if (!def || def.category === "chassis") continue;
    const local = partLocalPosition(
      chassisDef,
      def,
      placed.cell,
      placed.rot,
      placed.face
    );

    if (
      def.category === "armor" ||
      def.category === "utility" ||
      (def.category === "weapon" && (def.effect === "flame" || def.effect === "static"))
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
      } else {
        weapons.push({
          ...runtime,
          def,
          joint: null,
          spear: false,
          mountDir: faceNormal(placed.face),
          active: false,
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
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(origin[0] + worldX, origin[1] + radius, origin[2] + worldZ)
          .setRotation(chassisRotation)
          .setCcdEnabled(true)
      );
      const collider = world.createCollider(
        RAPIER.ColliderDesc.cylinder(halfWidth, radius)
          .setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 })
          .setMass(def.mass)
          .setFriction(def.friction),
        body
      );
      enableContactEvents(collider, seat);
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
        detached: false,
        side: driveSide(
          chassisDef,
          placed.face,
          placed.cell,
          rotatedSize(def, placed.rot)[0]
        ) || (local[0] < 0 ? -1 : 1)
      };
      parts.push(runtime);
      drives.push(runtime);
      colliderOwners.set(collider.handle, { seat, partIdx: idx });
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
    selfRightCooldown: 0
  };
}
