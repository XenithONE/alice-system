import RAPIER from "@dimforge/rapier3d-compat";
import {
  MIN_HIT_IMPULSE,
  DRIVE_ANGULAR_DAMPING,
  DRIVE_LINEAR_DAMPING,
  FIXED_DT
} from "./balance";
import { partLocalPosition } from "./build";
import {
  CELL,
  type BotSpec,
  type Catalog,
  type ChassisDef,
  type DriveDef,
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
  detached: boolean;
}

export interface DriveRuntime extends RuntimePart {
  readonly def: DriveDef;
  readonly joint: RAPIER.RevoluteImpulseJoint;
  readonly side: -1 | 1;
}

export interface WeaponRuntime extends RuntimePart {
  readonly def: WeaponDef;
  readonly joint: RAPIER.RevoluteImpulseJoint | null;
  cooldownLeft: number;
  swinging: boolean;
  swingTarget: number;
}

export interface AssembledBot {
  readonly seat: SeatIndex;
  readonly spec: BotSpec;
  readonly chassisDef: ChassisDef;
  readonly chassis: RAPIER.RigidBody;
  readonly chassisCollider: RAPIER.Collider;
  readonly parts: RuntimePart[];
  readonly drives: DriveRuntime[];
  readonly weapon: WeaponRuntime | null;
  readonly colliderOwners: Map<number, ColliderOwner>;
  readonly powerMul: number;
  readonly hasSelfRight: boolean;
  selfRightCooldown: number;
}

const qIdentity = { x: 0, y: 0, z: 0, w: 1 };

/*
 * Collision groups. A robot must never collide with itself: wheels sit inside
 * the deck footprint and weapons swing across it, so with self-collision on,
 * a bot's own wheels jam against its weapon and against each other. Measured
 * before this was added: four wheels commanded to the same speed settled at
 * +3.4, -44.7, -51.3 rad/s, so the machine spun on the spot at 0.0 m/s
 * forward while the workshop promised 6.2 m/s.
 *
 * Rapier packs memberships in the high 16 bits and the filter in the low 16.
 * Two colliders interact only if each one's membership passes the other's
 * filter, so leaving our own bit out of our own filter disables self-contact
 * without touching anything else.
 */
const ARENA_BIT = 1 << 4;
const DEBRIS_BIT = 1 << 5;
const ALL_BOTS = 0b1111;

const pack = (memberships: number, filter: number): number =>
  ((memberships & 0xffff) << 16) | (filter & 0xffff);

/** Colliders belonging to one robot: everything except that same robot. */
export const botCollisionGroups = (seat: number): number =>
  pack(1 << seat, (ALL_BOTS & ~(1 << seat)) | ARENA_BIT | DEBRIS_BIT);

/** Floor, walls, hazards. */
export const ARENA_COLLISION_GROUPS = pack(ARENA_BIT, ALL_BOTS | DEBRIS_BIT);

/** Torn-off parts: they bounce around and can trip anyone, including the owner. */
export const DEBRIS_COLLISION_GROUPS = pack(DEBRIS_BIT, ALL_BOTS | ARENA_BIT | DEBRIS_BIT);

function enableContactEvents(collider: RAPIER.Collider, seat?: number): void {
  collider.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
  collider.setContactForceEventThreshold(MIN_HIT_IMPULSE / FIXED_DT);
  if (seat !== undefined) collider.setCollisionGroups(botCollisionGroups(seat));
}

function quarterTurn(rot: number): RAPIER.Rotation {
  const angle = -rot * Math.PI / 2;
  return { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
}

function rotatedSize(part: PartDef, rot: number): readonly [number, number] {
  return rot === 1 || rot === 3 ? [part.cells[1], part.cells[0]] : part.cells;
}

function worldOffset(x: number, z: number, yaw: number): readonly [number, number] {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return [cos * x + sin * z, -sin * x + cos * z];
}

function createBoxCollider(
  world: RAPIER.World,
  body: RAPIER.RigidBody,
  part: PartDef,
  local: readonly [number, number, number],
  rot: number,
  seat: number
): RAPIER.Collider {
  const [w, d] = rotatedSize(part, rot);
  const desc = RAPIER.ColliderDesc.cuboid(w * CELL / 2, part.height / 2, d * CELL / 2)
    .setTranslation(local[0], local[1], local[2])
    .setRotation(quarterTurn(rot))
    .setMass(part.mass);
  const collider = world.createCollider(desc, body);
  enableContactEvents(collider, seat);
  return collider;
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
  const chassis = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(origin[0], origin[1], origin[2])
      .setRotation({ x: 0, y: Math.sin(facing / 2), z: 0, w: Math.cos(facing / 2) })
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
      .setMass(chassisDef.mass),
    chassis
  );
  enableContactEvents(chassisCollider, seat);

  const colliderOwners = new Map<number, ColliderOwner>([
    [chassisCollider.handle, { seat, partIdx: null }]
  ]);
  const parts: RuntimePart[] = [];
  const drives: DriveRuntime[] = [];
  let weapon: WeaponRuntime | null = null;
  let powerMul = 1;
  let hasSelfRight = false;

  for (const [idx, placed] of spec.parts.entries()) {
    const def = catalog.byId.get(placed.partId);
    if (!def || def.category === "chassis") continue;
    const [localX, localZ] = partLocalPosition(chassisDef, def, placed.cell, placed.rot);
    const deckY = chassisDef.groundClearance + chassisDef.height;
    const local: [number, number, number] = [localX, deckY + def.height / 2, localZ];

    if (
      def.category === "armor" ||
      def.category === "utility" ||
      (def.category === "weapon" && def.motion === "none")
    ) {
      const collider = createBoxCollider(world, chassis, def, local, placed.rot, seat);
      const runtime: RuntimePart = {
        idx,
        def,
        hp: def.hp,
        collider,
        body: chassis,
        joint: null,
        local,
        detached: false
      };
      parts.push(runtime);
      colliderOwners.set(collider.handle, { seat, partIdx: idx });
      if (def.category === "utility") {
        powerMul *= def.powerMul ?? 1;
        hasSelfRight ||= def.selfRight === true;
      }
      if (def.category === "weapon") {
        weapon = {
          ...runtime,
          def,
          joint: null,
          cooldownLeft: 0,
          swinging: false,
          swingTarget: 0
        };
      }
      continue;
    }

    if (def.category === "drive") {
      const radius = def.radius;
      const halfWidth = Math.max(def.height, CELL) / 2;
      const driveLocal: [number, number, number] = [localX, radius, localZ];
      const [worldX, worldZ] = worldOffset(localX, localZ, facing);
      const chassisRotation = {
        x: 0,
        y: Math.sin(facing / 2),
        z: 0,
        w: Math.cos(facing / 2)
      };
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
        detached: false,
        side: localX < 0 ? -1 : 1
      };
      parts.push(runtime);
      drives.push(runtime);
      colliderOwners.set(collider.handle, { seat, partIdx: idx });
      continue;
    }

    const spinHorizontal = def.id.includes("disc") || def.id.includes("saw");
    const localRotation = spinHorizontal
      ? qIdentity
      : { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };
    const chassisRotation = {
      x: 0,
      y: Math.sin(facing / 2),
      z: 0,
      w: Math.cos(facing / 2)
    };
    const [worldX, worldZ] = worldOffset(localX, localZ, facing);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(origin[0] + worldX, origin[1] + local[1], origin[2] + worldZ)
        .setRotation(chassisRotation)
        .setCcdEnabled(true)
    );
    let collider: RAPIER.Collider;
    if (def.motion === "spin") {
      const radius = Math.max(def.cells[0], def.cells[1]) * CELL / 2 + def.reach;
      const desc = RAPIER.ColliderDesc.cylinder(def.height / 2, radius)
        .setRotation(localRotation)
        .setMass(def.mass);
      collider = world.createCollider(desc, body);
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
      const [w, d] = rotatedSize(def, placed.rot);
      collider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(w * CELL / 2, def.height / 2, (d * CELL + def.reach) / 2)
          .setMass(def.mass),
        body
      );
    }
    enableContactEvents(collider, seat);
    const axis = spinHorizontal ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    const joint = world.createImpulseJoint(
      RAPIER.JointData.revolute(
        { x: local[0], y: local[1], z: local[2] },
        { x: 0, y: 0, z: 0 },
        axis
      ),
      chassis,
      body,
      true
    ) as RAPIER.RevoluteImpulseJoint;
    joint.setContactsEnabled(false);
    if (def.motion === "spin") {
      joint.configureMotorVelocity(0, def.spinUpTorque ?? 0);
    } else {
      joint.setLimits(0, def.sweep ?? 0);
      joint.configureMotorPosition(0, def.impulse ?? 0, def.mass);
    }
    const runtime: WeaponRuntime = {
      idx,
      def,
      hp: def.hp,
      collider,
      body,
      joint,
      local,
      detached: false,
      cooldownLeft: 0,
      swinging: false,
      swingTarget: 0
    };
    parts.push(runtime);
    weapon = runtime;
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
    weapon,
    colliderOwners,
    powerMul,
    hasSelfRight,
    selfRightCooldown: 0
  };
}
