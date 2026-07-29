import RAPIER from "@dimforge/rapier3d-compat";
import {
  BASE_GYRO_TORQUE,
  BASE_SPIN_DRAIN,
  BASE_TRACKING_FORCE,
  EDGE_EARLY_GUARD_BONUS,
  EDGE_EARLY_GUARD_SEC,
  EDGE_GUARD_BRAKE_PER_SEC,
  EDGE_GUARD_BRAKE_RADIUS,
  CONTACT_COOLDOWN_SEC,
  CONTACT_DAMAGE_SCALE,
  CONTACT_DAMAGE_THRESHOLD,
  DEFAULT_COUNTDOWN_SEC,
  DEFAULT_MAX_DURATION_SEC,
  DEFAULT_SUDDEN_DEATH_SEC,
  FIXED_DT,
  GRAVITY,
  MAX_CONTACT_DAMAGE,
  MIN_LIVE_SPIN,
  OUTSIDE_FALL_Y,
  OUTSIDE_MARGIN,
} from "./balance";
import { mulberry32 } from "./rng";
import {
  buildRingSurfaceMesh,
  ringArenaById,
  sampleRingHeight,
} from "./rings";
import {
  TOP_SLOTS,
  VORTEX_SEATS,
  type CreateVortexSimOptions,
  type KnockoutReason,
  type MatchPhase,
  type MatchResult,
  type MatchState,
  type ResolvedPassiveEffect,
  type ResolvedPassiveSkill,
  type ResolvedPassiveTrigger,
  type ResolvedActiveSkill,
  type ResolvedTopBuild,
  type ResolvedTopPart,
  type RuntimeModifiers,
  type SeatIndex,
  type SimEvent,
  type SimRingArena,
  type SkillActivationResult,
  type SkillCondition,
  type SkillEffect,
  type SkillRejectReason,
  type SkillRuntimeState,
  type SkillSlot,
  type TopState,
  type VortexSim,
} from "./types";
import { assertNever } from "../assertNever";

let physicsInit: Promise<void> | null = null;

export async function initPhysics(): Promise<void> {
  physicsInit ??= Promise.resolve(RAPIER.init()).then(() => undefined);
  await physicsInit;
}

interface RuntimeSkill {
  readonly slot: SkillSlot;
  readonly members: RuntimeSkillMember[];
}

interface RuntimeSkillMember {
  readonly def: ResolvedActiveSkill;
  cooldownUntil: number;
  charges: number;
}

interface RuntimePassive {
  readonly def: ResolvedPassiveSkill;
  cooldownUntil: number;
  conditionActive: boolean;
  consumed: boolean;
}

type TimedModifierKind =
  | "shield"
  | "attack"
  | "defense"
  | "stamina"
  | "stability"
  | "mobility"
  | "durability"
  | "tracking"
  | "mass"
  | "inertia"
  | "centerOfMass"
  | "friction"
  | "restitution"
  | "drag";

interface TimedModifier {
  readonly kind: TimedModifierKind;
  readonly value: number;
  readonly until: number;
}

interface RuntimeTop<TSource> {
  readonly seat: SeatIndex;
  readonly team: number;
  readonly name: string;
  readonly build: ResolvedTopBuild<TSource>;
  readonly body: RAPIER.RigidBody;
  readonly colliders: readonly RAPIER.Collider[];
  readonly colliderFriction: readonly number[];
  readonly colliderRestitution: readonly number[];
  readonly skills: RuntimeSkill[];
  readonly passives: RuntimePassive[];
  readonly hpMax: number;
  readonly motionBias: number;
  hp: number;
  spinEnergy: number;
  alive: boolean;
  cpu: boolean;
  lastHitAt: number;
  lastAttacker: SeatIndex | null;
  reverseOrbitUntil: number;
  /*
   * Pass-through expiry, in `elapsed` seconds — the same clock every other
   * deadline in this simulation uses. Deliberately NOT a TimedModifier: a
   * modifier is a multiplier applied to a number, and intangibility is not a
   * number. Keeping it here is what stops the old 0.12 damage multiplier from
   * coming back by accident.
   */
  phaseUntil: number;
  /*
   * What the colliders are currently set to. Rapier has no cheap read-back
   * that distinguishes our two masks, and re-issuing setCollisionGroups on ten
   * colliders every frame would wake the body needlessly, so the desired state
   * is compared against this before touching physics.
   */
  phasing: boolean;
  timed: TimedModifier[];
}

interface PendingContact {
  readonly first: RuntimeTop<unknown>;
  readonly second: RuntimeTop<unknown>;
  readonly impulse: number;
  readonly point: readonly [number, number, number];
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function seatIndex(value: number): SeatIndex {
  return value as SeatIndex;
}

function skillSlot(value: number): SkillSlot {
  return value as SkillSlot;
}

function normaliseTeam(value: number | undefined, seat: number): number {
  return value !== undefined && Number.isFinite(value)
    ? Math.trunc(value)
    : seat;
}

function normaliseLaunchPower(value: number | undefined): number {
  return clamp(
    value !== undefined && Number.isFinite(value) ? value : 1,
    0,
    1.25,
  );
}

function areEnemies(
  first: Pick<RuntimeTop<unknown>, "team">,
  second: Pick<RuntimeTop<unknown>, "team">,
): boolean {
  return first.team !== second.team;
}

function assertBuild(build: ResolvedTopBuild<unknown>, seat: number): void {
  if (build.parts.length !== TOP_SLOTS.length) {
    throw new Error(`Seat ${seat} must resolve exactly seven top parts`);
  }
  const seen = new Set<string>();
  for (let index = 0; index < TOP_SLOTS.length; index += 1) {
    const part = build.parts[index]!;
    const expected = TOP_SLOTS[index]!;
    if (part.slot !== expected) {
      throw new Error(`Seat ${seat} part ${index + 1} must be ${expected}`);
    }
    if (!part.id || seen.has(part.id)) {
      throw new Error(`Seat ${seat} has an invalid or duplicate part id`);
    }
    seen.add(part.id);
    for (const value of [
      part.radius,
      part.height,
      part.mass,
      part.friction,
      part.restitution,
      ...(part.offsetY === undefined ? [] : [part.offsetY]),
      ...(part.lobes === undefined ? [] : [part.lobes]),
    ]) {
      if (!Number.isFinite(value)) {
        throw new Error(`Seat ${seat} part ${part.id} has non-finite physics`);
      }
    }
  }
  for (const passive of build.passives) {
    if (
      !passive.id ||
      !passive.name ||
      passive.rank < 1 ||
      passive.rank > 3 ||
      (passive.threshold !== null && !Number.isFinite(passive.threshold))
    ) {
      throw new Error(`Seat ${seat} has an invalid resolved passive`);
    }
  }
}

interface PartColliderLayout {
  readonly part: ResolvedTopPart;
  readonly radius: number;
  readonly height: number;
  readonly y: number;
}

function colliderLayouts(
  build: ResolvedTopBuild<unknown>,
): readonly PartColliderLayout[] {
  const centerOfMass = finite(build.physics.centerOfMass, 0);
  const explicit = build.parts.every(
    (part) => part.offsetY !== undefined && Number.isFinite(part.offsetY),
  );
  if (explicit) {
    return build.parts.map((part) => ({
      part,
      radius: clamp(part.radius, 0.07, 1.05),
      height: clamp(part.height, 0.035, 0.45),
      y: part.offsetY! - centerOfMass,
    }));
  }
  const heights = new Map(
    build.parts.map((part) => [
      part.slot,
      clamp(part.height, 0.035, 0.45),
    ]),
  );
  const totalHeight = [...heights.values()].reduce(
    (sum, height) => sum + height,
    0,
  );
  let bottom = -totalHeight / 2 - centerOfMass;
  const bySlot = new Map<ResolvedTopPart["slot"], PartColliderLayout>();
  for (const part of build.parts.slice().reverse()) {
    const height = heights.get(part.slot)!;
    bySlot.set(part.slot, {
      part,
      radius: clamp(part.radius, 0.07, 1.05),
      height,
      y: bottom + height / 2,
    });
    bottom += height;
  }
  return build.parts.map((part) => bySlot.get(part.slot)!);
}

function compoundHull(
  halfHeight: number,
  radius: number,
  lobes: number,
): RAPIER.ColliderDesc {
  const sides = Math.max(3, Math.min(16, Math.round(lobes)));
  const points = new Float32Array(sides * 2 * 3);
  let cursor = 0;
  for (const y of [-halfHeight, halfHeight]) {
    for (let index = 0; index < sides; index += 1) {
      const angle = index / sides * Math.PI * 2;
      points[cursor++] = Math.cos(angle) * radius;
      points[cursor++] = y;
      points[cursor++] = Math.sin(angle) * radius;
    }
  }
  return (
    RAPIER.ColliderDesc.roundConvexHull(
      points,
      Math.min(0.018, halfHeight * 0.16, radius * 0.045),
    ) ?? RAPIER.ColliderDesc.cylinder(halfHeight, radius)
  );
}

/*
 * Collision filtering for pass-through.
 *
 * Rapier tests a pair with a symmetric AND: they interact only if
 * `A.membership & B.filter` AND `B.membership & A.filter` are both non-zero.
 * So clearing ONE side's bit is enough to make a pair pass through, which is
 * what makes the safety property below expressible.
 *
 * `phase` must let a top pass through other TOPS ONLY. If it could also pass
 * the floor or the rim, a phasing top would fall out of the world and the
 * ring-out rules would be built on a lie. That is guaranteed structurally
 * rather than by care: a top's membership never changes, and both of its two
 * possible filters are built by OR-ing onto GROUP_ARENA — the arena bit cannot
 * be absent from a filter that is defined as containing it.
 */
const GROUP_ARENA = 0x0001;
const GROUP_TOP = 0x0002;

/** membership in the high half, filter in the low half. */
const groups = (membership: number, filter: number): number =>
  ((membership & 0xffff) << 16) | (filter & 0xffff);

/** The arena collides with everything that exists. */
const ARENA_GROUPS = groups(GROUP_ARENA, GROUP_ARENA | GROUP_TOP);
/** Normal: floor, rim, and other tops. */
const TOP_GROUPS_SOLID = groups(GROUP_TOP, GROUP_ARENA | GROUP_TOP);
/** Phasing: floor and rim, and nothing else. */
const TOP_GROUPS_PHASING = groups(GROUP_TOP, GROUP_ARENA);

function addRing(world: RAPIER.World, arena: SimRingArena): RAPIER.Collider {
  // The bowl and its low retaining lip live in one trimesh collider. The lip
  // catches ordinary orbital drift while still allowing a sufficiently hard
  // upward impact to produce a ring-out.
  const floor = buildRingSurfaceMesh(arena, 6, 36);
  const wallSegments = 48;
  const wallVertexCount = wallSegments * 4;
  const floorVertexCount = floor.vertices.length / 3;
  const vertices = new Float32Array(floor.vertices.length + wallVertexCount * 3);
  vertices.set(floor.vertices);
  for (let segment = 0; segment < wallSegments; segment += 1) {
    const angle = segment / wallSegments * Math.PI * 2;
    const height = sampleRingHeight(arena, arena.outRadius, angle);
    const innerRadius = arena.outRadius - 0.08;
    const outerRadius = arena.outRadius + 0.08;
    const bottom = height - 0.035;
    const top = height + 0.36;
    const base = floor.vertices.length + segment * 12;
    vertices[base] = Math.cos(angle) * innerRadius;
    vertices[base + 1] = bottom;
    vertices[base + 2] = Math.sin(angle) * innerRadius;
    vertices[base + 3] = Math.cos(angle) * innerRadius;
    vertices[base + 4] = top;
    vertices[base + 5] = Math.sin(angle) * innerRadius;
    vertices[base + 6] = Math.cos(angle) * outerRadius;
    vertices[base + 7] = bottom;
    vertices[base + 8] = Math.sin(angle) * outerRadius;
    vertices[base + 9] = Math.cos(angle) * outerRadius;
    vertices[base + 10] = top;
    vertices[base + 11] = Math.sin(angle) * outerRadius;
  }
  const indices = new Uint32Array(floor.indices.length + wallSegments * 18);
  indices.set(floor.indices);
  let cursor = floor.indices.length;
  const vertex = (segment: number, offset: number): number =>
    floorVertexCount + (segment % wallSegments) * 4 + offset;
  for (let segment = 0; segment < wallSegments; segment += 1) {
    const next = segment + 1;
    const innerBottom = vertex(segment, 0);
    const innerTop = vertex(segment, 1);
    const outerBottom = vertex(segment, 2);
    const outerTop = vertex(segment, 3);
    const nextInnerBottom = vertex(next, 0);
    const nextInnerTop = vertex(next, 1);
    const nextOuterBottom = vertex(next, 2);
    const nextOuterTop = vertex(next, 3);
    indices[cursor++] = innerBottom;
    indices[cursor++] = nextInnerTop;
    indices[cursor++] = nextInnerBottom;
    indices[cursor++] = innerBottom;
    indices[cursor++] = innerTop;
    indices[cursor++] = nextInnerTop;
    indices[cursor++] = outerBottom;
    indices[cursor++] = nextOuterBottom;
    indices[cursor++] = nextOuterTop;
    indices[cursor++] = outerBottom;
    indices[cursor++] = nextOuterTop;
    indices[cursor++] = outerTop;
    indices[cursor++] = innerTop;
    indices[cursor++] = outerTop;
    indices[cursor++] = nextOuterTop;
    indices[cursor++] = innerTop;
    indices[cursor++] = nextOuterTop;
    indices[cursor++] = nextInnerTop;
  }
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  return world.createCollider(
    RAPIER.ColliderDesc.trimesh(vertices, indices)
      .setFriction(arena.friction)
      .setRestitution(arena.restitution)
      .setCollisionGroups(ARENA_GROUPS),
    body,
  );
}

function spawnTop<TSource>(
  world: RAPIER.World,
  build: ResolvedTopBuild<TSource>,
  name: string,
  seat: SeatIndex,
  team: number,
  spawnIndex: number,
  playerCount: number,
  arena: SimRingArena,
  startAngle: number,
  motionBias: number,
  launchPower: number,
  cpu: boolean,
): RuntimeTop<TSource> {
  assertBuild(build as ResolvedTopBuild<unknown>, seat);
  const angle = startAngle + spawnIndex / playerCount * Math.PI * 2;
  const radius = arena.spawnRadius;
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  const surface = sampleRingHeight(arena, radius, angle);
  const layouts = colliderLayouts(build as ResolvedTopBuild<unknown>);
  const lowest = Math.min(...layouts.map((layout) => layout.y - layout.height / 2));
  const baseLaunchSpin = clamp(finite(build.physics.launchSpin, 82), 30, 190);
  const power = normaliseLaunchPower(launchPower);
  const launchSpin = clamp(baseLaunchSpin * power, 0, 220);
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, surface - lowest + 0.045, z)
      .setLinearDamping(clamp(build.physics.drag * 0.1, 0.015, 0.28))
      .setAngularDamping(clamp(build.physics.drag * 0.006, 0.001, 0.06))
      .setCcdEnabled(true),
  );
  body.setAngvel(
    {
      x: 0,
      y: launchSpin,
      z: 0,
    },
    true,
  );
  // Seeded sub-centimetre launch variation prevents identical builds from
  // remaining in a perfectly mirrored orbit. It is deterministic for replay
  // and host-authoritative networking, while being visually imperceptible.
  const tangentSpeed = (0.11 + motionBias * 0.045) * power;
  const radialSpeed = motionBias * 0.028 * power;
  body.setLinvel(
    {
      x: -Math.sin(angle) * tangentSpeed + Math.cos(angle) * radialSpeed,
      y: 0,
      z: Math.cos(angle) * tangentSpeed + Math.sin(angle) * radialSpeed,
    },
    true,
  );

  const partMassTotal = build.parts.reduce(
    (sum, part) => sum + Math.max(0.01, part.mass),
    0,
  );
  const desiredMass = clamp(finite(build.physics.mass, partMassTotal), 0.35, 8);
  const massScale = desiredMass / Math.max(0.01, partMassTotal);
  const rawFriction = build.parts.reduce(
    (sum, part) => sum + part.friction * Math.max(0.01, part.mass),
    0,
  ) / Math.max(0.01, partMassTotal);
  const rawRestitution = build.parts.reduce(
    (sum, part) => sum + part.restitution * Math.max(0.01, part.mass),
    0,
  ) / Math.max(0.01, partMassTotal);
  const resolvedFrictionScale = clamp(
    build.physics.friction / Math.max(0.01, rawFriction),
    0.25,
    4,
  );
  const resolvedRestitutionScale = clamp(
    build.physics.restitution / Math.max(0.01, rawRestitution),
    0.25,
    4,
  );
  const colliders: RAPIER.Collider[] = [];
  const configure = (
    descriptor: RAPIER.ColliderDesc,
    part: ResolvedTopPart,
    mass: number,
  ): RAPIER.ColliderDesc =>
    descriptor
      .setMass(mass)
      // A spinning point contact must not behave like a locked car tyre.
      // Side impacts still transfer momentum through restitution.
      .setFriction(
        clamp(
          part.friction * (part.slot === "tip" ? 0.008 : 0.004),
          0.001,
          0.008,
        ) * resolvedFrictionScale,
      )
      .setRestitution(
        clamp(part.restitution * resolvedRestitutionScale, 0, 0.95),
      )
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(0)
      .setCollisionGroups(TOP_GROUPS_SOLID);

  for (const layout of layouts) {
    const { part, height, radius: partRadius, y: localY } = layout;
    const partMass = Math.max(0.01, part.mass) * massScale;
    const isBladedEdge = part.shape === "compound" && part.slot === "edge";
    let descriptor: RAPIER.ColliderDesc;
    if (part.shape === "cone") {
      const border = Math.min(0.018, height * 0.08, partRadius * 0.12);
      descriptor = RAPIER.ColliderDesc.roundCone(
        Math.max(0.02, height / 2 - border),
        Math.max(0.035, partRadius - border),
        border,
      ).setRotation({ x: 1, y: 0, z: 0, w: 0 });
    } else if (part.slot === "tip" && !part.shape) {
      descriptor = RAPIER.ColliderDesc.ball(
        clamp(partRadius * 0.54, 0.045, 0.3),
      );
    } else if (part.shape === "compound" && !isBladedEdge) {
      descriptor = compoundHull(height / 2, partRadius, part.lobes ?? 6);
    } else {
      const baseRadius = isBladedEdge ? partRadius * 0.76 : partRadius;
      const border = Math.min(0.014, height * 0.09, baseRadius * 0.04);
      descriptor = RAPIER.ColliderDesc.roundCylinder(
        Math.max(0.015, height / 2 - border),
        Math.max(0.04, baseRadius - border),
        border,
      );
    }
    const baseMass = partMass * (isBladedEdge ? 0.7 : 1);
    const collider = world.createCollider(
      configure(
        descriptor.setTranslation(0, localY, 0),
        part,
        baseMass,
      ),
      body,
    );
    colliders.push(collider);

    // Three swept blade proxies plus the seven part bodies reach the hard
    // topology cap of ten colliders. They give Edge/Signature geometry a real
    // gameplay footprint without introducing joints or extra rigid bodies.
    if (isBladedEdge) {
      const bladeCount = 3;
      const inner = partRadius * 0.52;
      const outer = partRadius;
      const halfLength = (outer - inner) / 2;
      const centre = (outer + inner) / 2;
      for (let blade = 0; blade < bladeCount; blade += 1) {
        const bladeAngle =
          blade / bladeCount * Math.PI * 2 +
          ((part.lobes ?? 6) % 2) * Math.PI / 12;
        const bladeDescriptor = RAPIER.ColliderDesc.cuboid(
          halfLength,
          height * 0.36,
          Math.max(0.035, partRadius * 0.075),
        )
          .setTranslation(
            Math.cos(bladeAngle) * centre,
            localY,
            Math.sin(bladeAngle) * centre,
          )
          .setRotation({
            x: 0,
            y: Math.sin(-bladeAngle / 2),
            z: 0,
            w: Math.cos(-bladeAngle / 2),
          });
        colliders.push(
          world.createCollider(
            configure(bladeDescriptor, part, partMass * 0.1),
            body,
          ),
        );
      }
    }
  }

  const durability = clamp(build.stats.durability, 0, 200);
  const hpMax = 72 + durability * 2.15;
  const skills: RuntimeSkill[] = build.parts.map((part, index) => {
    const slot = TOP_SLOTS[index]!;
    const configured = build.activeGroups?.[slot];
    const definitions =
      configured === undefined
        ? part.activeSkill === null
          ? []
          : [part.activeSkill]
        : configured;
    return {
      slot: skillSlot(index + 1),
      members: definitions.map((def) => ({
        def,
        cooldownUntil: 0,
        charges: def.charges,
      })),
    };
  });
  const passives: RuntimePassive[] = build.passives.map((def) => ({
    def,
    cooldownUntil: 0,
    conditionActive: false,
    consumed: false,
  }));

  return {
    seat,
    team,
    name,
    build,
    body,
    colliders,
    colliderFriction: colliders.map((collider) => collider.friction()),
    colliderRestitution: colliders.map((collider) => collider.restitution()),
    skills,
    passives,
    hpMax,
    motionBias,
    hp: hpMax,
    spinEnergy: launchSpin,
    alive: true,
    cpu,
    lastHitAt: Number.NEGATIVE_INFINITY,
    lastAttacker: null,
    reverseOrbitUntil: 0,
    phaseUntil: 0,
    phasing: false,
    timed: [],
  };
}

function horizontalDistance(
  first: RAPIER.Vector,
  second: RAPIER.Vector,
): number {
  return Math.hypot(first.x - second.x, first.z - second.z);
}

function modifierAt(
  top: RuntimeTop<unknown>,
  kind: TimedModifierKind,
  elapsed: number,
): number {
  let result = 1;
  for (const modifier of top.timed) {
    if (modifier.kind === kind && modifier.until > elapsed) result *= modifier.value;
  }
  for (const passive of top.passives) {
    if (!passive.conditionActive) continue;
    for (const effect of passive.def.effects) {
      if (
        (effect.type !== "stat-multiplier" &&
          effect.type !== "physics-multiplier") ||
        effect.durationSec !== undefined ||
        effect.stat !== kind
      ) {
        continue;
      }
      const scale = 1 + (passive.def.rank - 1) * 0.12;
      result *= 1 + (effect.multiplier - 1) * scale;
    }
  }
  return clamp(result, 0.12, 5);
}

function nearestTarget<TSource>(
  source: RuntimeTop<TSource>,
  tops: readonly RuntimeTop<TSource>[],
): RuntimeTop<TSource> | null {
  const origin = source.body.translation();
  let nearest: RuntimeTop<TSource> | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const target of tops) {
    if (!target.alive || target === source || !areEnemies(source, target)) continue;
    const distance = horizontalDistance(origin, target.body.translation());
    if (distance < nearestDistance) {
      nearest = target;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function conditionSatisfied<TSource>(
  condition: SkillCondition,
  top: RuntimeTop<TSource>,
  tops: readonly RuntimeTop<TSource>[],
  arena: SimRingArena,
  elapsed: number,
): boolean {
  const position = top.body.translation();
  const radius = Math.hypot(position.x, position.z);
  const spin = top.spinEnergy;
  const target = nearestTarget(top, tops);
  switch (condition.type) {
    case "always":
      return true;
    case "hp-below":
      return top.hp / top.hpMax <= clamp(condition.ratio, 0, 1);
    case "hp-above":
      return top.hp / top.hpMax >= clamp(condition.ratio, 0, 1);
    case "spin-below":
      return spin <= Math.max(0, condition.radiansPerSec);
    case "spin-above":
      return spin >= Math.max(0, condition.radiansPerSec);
    case "near-edge":
      return arena.outRadius - radius <= Math.max(0, condition.distance);
    case "near-center":
      return radius <= Math.max(0, condition.radius);
    case "target-within":
      return (
        target !== null &&
        horizontalDistance(position, target.body.translation()) <=
          Math.max(0, condition.distance)
      );
    case "recently-hit":
      return elapsed - top.lastHitAt <= Math.max(0, condition.withinSec);
    case "elapsed":
      return elapsed >= Math.max(0, condition.seconds);
    case "airborne": {
      const surface = sampleRingHeight(arena, radius, Math.atan2(position.z, position.x));
      return position.y - surface >= Math.max(0.05, condition.heightAboveSurface);
    }
    case "final-duel":
      return tops.filter(
        (candidate) => candidate.alive && areEnemies(top, candidate),
      ).length <= 1;
    case "outnumbered":
      return tops.filter(
        (candidate) => candidate.alive && areEnemies(top, candidate),
      ).length >= 2;
    case "all":
      return condition.conditions.every((entry) =>
        conditionSatisfied(entry, top, tops, arena, elapsed),
      );
    case "any":
      return condition.conditions.some((entry) =>
        conditionSatisfied(entry, top, tops, arena, elapsed),
      );
  }
}

function buildModifiers(build: ResolvedTopBuild<unknown>): RuntimeModifiers {
  const value = build.modifiers;
  return {
    damageDealt: clamp(finite(value.damageDealt, 1), 0.2, 4),
    damageTaken: clamp(finite(value.damageTaken, 1), 0.2, 4),
    spinDrain: clamp(finite(value.spinDrain, 1), 0.2, 4),
    tracking: clamp(finite(value.tracking, 1), 0.2, 4),
    stability: clamp(finite(value.stability, 1), 0.2, 4),
    edgeRecovery: clamp(finite(value.edgeRecovery, 0), 0, 1),
    thorns: clamp(finite(value.thorns, 0), 0, 1),
    lifesteal: clamp(finite(value.lifesteal, 0), 0, 1),
  };
}

export function createVortexSim<TSource = unknown>(
  opts: CreateVortexSimOptions<TSource>,
): VortexSim {
  const activeBuilds = opts.builds
    .slice(0, VORTEX_SEATS)
    .map((build, seat) => ({
      build,
      seat,
      team: normaliseTeam(opts.teamIds?.[seat], seat),
      launchPower: normaliseLaunchPower(opts.launchPower?.[seat]),
    }))
    .filter(
      (
        entry,
      ): entry is {
        readonly build: ResolvedTopBuild<TSource>;
        readonly seat: number;
        readonly team: number;
        readonly launchPower: number;
      } =>
        entry.build !== null,
    );
  if (activeBuilds.length < 2 || activeBuilds.length > VORTEX_SEATS) {
    throw new Error("VORTEX CROWN requires two to eight resolved builds");
  }
  if (new Set(activeBuilds.map((entry) => entry.team)).size < 2) {
    throw new Error("VORTEX CROWN requires at least two opposing teams");
  }
  const arena = opts.arena ?? ringArenaById(opts.arenaId ?? "core-bowl");
  const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  world.timestep = FIXED_DT;
  const queue = new RAPIER.EventQueue(true);
  addRing(world, arena);
  const rng = mulberry32(opts.seed);
  const cpuSeats = new Set(opts.cpuSeats ?? []);
  const startAngle = rng.range(0, Math.PI * 2);
  const tops = activeBuilds.map(({ build, seat, team, launchPower }, spawnIndex) =>
    spawnTop(
      world,
      build,
      opts.names?.[seat] ?? build.name,
      seatIndex(seat),
      team,
      spawnIndex,
      activeBuilds.length,
      arena,
      startAngle,
      rng.range(-1, 1),
      launchPower,
      cpuSeats.has(seatIndex(seat)),
    ),
  );
  tops.sort((first, second) => first.seat - second.seat);

  const colliderOwner = new Map<number, RuntimeTop<TSource>>();
  for (const top of tops) {
    for (const collider of top.colliders) colliderOwner.set(collider.handle, top);
  }
  const normalizedModifiers = new Map(
    tops.map((top) => [
      top.seat,
      buildModifiers(top.build as ResolvedTopBuild<unknown>),
    ]),
  );
  const countdownSec = Math.max(0, opts.countdownSec ?? DEFAULT_COUNTDOWN_SEC);
  const suddenDeathSec = Math.max(1, opts.suddenDeathSec ?? DEFAULT_SUDDEN_DEATH_SEC);
  const maxDurationSec = Math.max(
    suddenDeathSec + 1,
    opts.maxDurationSec ?? DEFAULT_MAX_DURATION_SEC,
  );
  const events: SimEvent[] = [];
  const knockouts: {
    seat: SeatIndex;
    reason: KnockoutReason;
    at: number;
  }[] = [];
  const pairCooldown = new Map<string, number>();
  const passiveTriggerCounts = new Map<
    string,
    {
      seat: SeatIndex;
      passiveId: string;
      trigger: ResolvedPassiveTrigger;
      count: number;
    }
  >();
  let tick = 0;
  let countdownElapsed = 0;
  let elapsed = 0;
  let phase: MatchPhase = countdownSec > 0 ? "countdown" : "live";
  let battleStartApplied = false;
  let suddenDeathStage = 0;
  let matchResult: MatchResult | null = null;
  let disposed = false;

  function topBySeat(seat: number): RuntimeTop<TSource> | null {
    return tops.find((top) => top.seat === seat) ?? null;
  }

  function reject(
    seat: number,
    slot: number,
    reason: SkillRejectReason,
  ): SkillActivationResult {
    return { ok: false, seat, slot, reason };
  }

  function memberReject(
    top: RuntimeTop<TSource>,
    member: RuntimeSkillMember,
  ): Extract<SkillRejectReason, "cooldown" | "no-charges" | "condition"> | null {
    if (member.cooldownUntil > elapsed + 1e-8) return "cooldown";
    if (member.charges === 0) return "no-charges";
    if (
      !member.def.conditions.every((condition) =>
        conditionSatisfied(condition, top, tops, arena, elapsed),
      )
    ) {
      return "condition";
    }
    return null;
  }

  function readyMembers(
    top: RuntimeTop<TSource>,
    runtime: RuntimeSkill,
  ): readonly RuntimeSkillMember[] {
    return runtime.members.filter((member) => memberReject(top, member) === null);
  }

  function activationCheck(seat: number, slot: number): SkillActivationResult {
    if (phase !== "live") return reject(seat, slot, "match-not-live");
    const top = topBySeat(seat);
    if (!top) return reject(seat, slot, "invalid-seat");
    if (!top.alive) return reject(seat, slot, "knocked-out");
    const runtime = top.skills[slot - 1];
    if (!runtime || runtime.members.length === 0) {
      return reject(seat, slot, "empty-slot");
    }
    const ready = readyMembers(top, runtime);
    if (ready.length === 0) {
      const reasons = runtime.members.map((member) => memberReject(top, member));
      const reason: SkillRejectReason = reasons.every(
        (entry) => entry === "no-charges",
      )
        ? "no-charges"
        : reasons.includes("condition")
          ? "condition"
          : "cooldown";
      return reject(seat, slot, reason);
    }
    return {
      ok: true,
      seat: top.seat,
      slot: runtime.slot,
      skillId: ready[0]!.def.id,
    };
  }

  /**
   * Opens the pass-through window. Both the active and the passive path call
   * this, so the two cannot drift apart again — that split is exactly how the
   * active path ended up silently rewritten into a shield.
   */
  function applyPhase(top: RuntimeTop<TSource>, durationSec: number): void {
    top.phaseUntil = Math.max(
      top.phaseUntil,
      elapsed + clamp(finite(durationSec, 0), 0, 12),
    );
  }

  /**
   * Pushes the phase window down to Rapier. Called once per step before the
   * solver runs, so a skill fired between steps takes effect on the very next
   * frame rather than one frame late.
   */
  function syncPhaseColliders(): void {
    for (const top of tops) {
      const wanted = top.alive && top.phaseUntil > elapsed;
      if (wanted === top.phasing) continue;
      top.phasing = wanted;
      const mask = wanted ? TOP_GROUPS_PHASING : TOP_GROUPS_SOLID;
      for (const collider of top.colliders) collider.setCollisionGroups(mask);
    }
  }

  function addTimed(
    top: RuntimeTop<TSource>,
    kind: TimedModifierKind,
    value: number,
    durationSec: number,
  ): void {
    top.timed.push({
      kind,
      value: clamp(finite(value, 1), 0.12, 5),
      until: elapsed + clamp(finite(durationSec, 0), 0, 30),
    });
  }

  function addPassiveModifier(
    top: RuntimeTop<TSource>,
    kind: TimedModifierKind,
    value: number,
    durationSec: number | undefined,
  ): void {
    top.timed.push({
      kind,
      value: clamp(finite(value, 1), 0.12, 5),
      until:
        durationSec === undefined
          ? Number.POSITIVE_INFINITY
          : elapsed + clamp(finite(durationSec, 0), 0, 120),
    });
  }

  function setSpinEnergy(top: RuntimeTop<TSource>, value: number): void {
    const angular = top.body.angvel();
    const sign = angular.y < 0 ? -1 : 1;
    top.spinEnergy = clamp(finite(value, top.spinEnergy), 0, 220);
    top.body.setAngvel(
      {
        x: angular.x,
        y: sign * top.spinEnergy,
        z: angular.z,
      },
      true,
    );
  }

  function dealDamage(
    victim: RuntimeTop<TSource>,
    rawDamage: number,
    attacker: RuntimeTop<TSource> | null,
  ): number {
    if (!victim.alive) return 0;
    if (attacker && attacker !== victim && !areEnemies(attacker, victim)) {
      return 0;
    }
    const victimMods = normalizedModifiers.get(victim.seat)!;
    const shield = modifierAt(
      victim as RuntimeTop<unknown>,
      "shield",
      elapsed,
    );
    const defenseStat =
      victim.build.stats.defense *
      modifierAt(victim as RuntimeTop<unknown>, "defense", elapsed);
    const defense = 0.7 + clamp(defenseStat, 0, 400) / 115;
    const durabilityGuard = modifierAt(
      victim as RuntimeTop<unknown>,
      "durability",
      elapsed,
    );
    // Sudden death deliberately turns every clean hit into a serious threat.
    // The first 120 seconds retain the normal defensive identity of a build.
    const suddenMultiplier = 1 + suddenDeathStage * 0.65;
    const damage = Math.max(
      0,
      rawDamage *
        victimMods.damageTaken *
        shield *
        suddenMultiplier /
        defense /
        durabilityGuard,
    );
    victim.hp = Math.max(0, victim.hp - damage);
    if (damage > 0) {
      victim.lastHitAt = elapsed;
      victim.lastAttacker = attacker?.seat ?? victim.lastAttacker;
      victim.spinEnergy = Math.max(0, victim.spinEnergy - damage * 0.055);
      if (attacker && attacker !== victim) {
        firePassiveTrigger(attacker, "on-hit", victim);
        firePassiveTrigger(victim, "on-take-hit", attacker);
      }
    }
    return damage;
  }

  /**
   * Shifts cooldowns on whoever the effect names.
   *
   * Both handlers used to walk `top.skills` unconditionally — the caster's own
   * slots — so pulse-jammer, which promises to delay 周囲の相手, delayed itself.
   * The enemy branch reuses the radius fan-out that shockwave and
   * target-spin-drain already use, guard for guard.
   */
  function shiftCooldowns(
    top: RuntimeTop<TSource>,
    seconds: number,
    target: "self" | "enemies",
    radius: number,
  ): void {
    const shiftOne = (victim: RuntimeTop<TSource>): void => {
      for (const runtime of victim.skills) {
        for (const member of runtime.members) {
          /*
           * A penalty counts from now; a discount counts from the existing
           * deadline.
           *
           * The old formula was `max(elapsed, cooldownUntil + seconds)` for
           * both. A ready skill has a cooldownUntil in the past, so +4s on it
           * resolved to max(now, past + 4) — which is just `now` once the match
           * is more than four seconds old. The jammer would have delayed
           * nothing at all for all but the opening seconds, and the targeting
           * gate is what surfaced it: the victim gained 3.483s instead of 4.
           *
           * A discount keeps the old shape deliberately: shortening a cooldown
           * that already expired must not push a ready skill into the future.
           */
          const base =
            seconds >= 0 ? Math.max(elapsed, member.cooldownUntil) : member.cooldownUntil;
          member.cooldownUntil = Math.max(elapsed, base + seconds);
        }
      }
    };
    if (target === "self") {
      shiftOne(top);
      return;
    }
    const reach = Math.max(0, radius);
    const origin = top.body.translation();
    for (const other of tops) {
      if (!other.alive || other === top || !areEnemies(top, other)) continue;
      const position = other.body.translation();
      if (Math.hypot(position.x - origin.x, position.z - origin.z) > reach) continue;
      shiftOne(other);
    }
  }

  function applyEffect(top: RuntimeTop<TSource>, effect: SkillEffect): void {
    const target = nearestTarget(top, tops);
    const position = top.body.translation();
    switch (effect.type) {
      case "spin-boost": {
        setSpinEnergy(top, top.spinEnergy + effect.radiansPerSec);
        return;
      }
      case "dash": {
        if (!target) return;
        const other = target.body.translation();
        const dx = other.x - position.x;
        const dz = other.z - position.z;
        const length = Math.max(1e-6, Math.hypot(dx, dz));
        top.body.applyImpulse(
          {
            x: dx / length * effect.impulse,
            y: Math.max(0, effect.impulse * 0.025),
            z: dz / length * effect.impulse,
          },
          true,
        );
        return;
      }
      case "shield":
        addTimed(top, "shield", effect.damageMultiplier, effect.durationSec);
        return;
      case "repair":
        top.hp = Math.min(top.hpMax, top.hp + Math.max(0, effect.amount));
        return;
      case "shockwave": {
        const radius = Math.max(0.1, effect.radius);
        for (const other of tops) {
          if (!other.alive || other === top || !areEnemies(top, other)) continue;
          const otherPosition = other.body.translation();
          const dx = otherPosition.x - position.x;
          const dz = otherPosition.z - position.z;
          const distance = Math.hypot(dx, dz);
          if (distance > radius) continue;
          const falloff = 1 - distance / radius * 0.55;
          const length = Math.max(1e-6, distance);
          other.body.applyImpulse(
            {
              x: dx / length * effect.impulse * falloff,
              y: effect.impulse * 0.08 * falloff,
              z: dz / length * effect.impulse * falloff,
            },
            true,
          );
          dealDamage(other, Math.max(0, effect.damage) * falloff, top);
          if (other.hp <= 0) knockout(other, "destroyed", top.seat);
        }
        events.push({ type: "shockwave", seat: top.seat, radius });
        return;
      }
      case "attack-boost":
        addTimed(top, "attack", effect.multiplier, effect.durationSec);
        return;
      case "stability-boost":
        addTimed(top, "stability", effect.multiplier, effect.durationSec);
        return;
      case "tracking-boost":
        addTimed(top, "tracking", effect.multiplier, effect.durationSec);
        return;
      case "friction-shift":
        addTimed(top, "friction", effect.multiplier, effect.durationSec);
        return;
      case "target-spin-drain": {
        const radius = Math.max(0, effect.radius);
        for (const other of tops) {
          if (!other.alive || other === top || !areEnemies(top, other)) continue;
          if (horizontalDistance(position, other.body.translation()) > radius) continue;
          setSpinEnergy(
            other,
            other.spinEnergy - Math.max(0, effect.radiansPerSec),
          );
        }
        return;
      }
      case "recoil": {
        if (!target) return;
        const other = target.body.translation();
        const dx = position.x - other.x;
        const dz = position.z - other.z;
        const length = Math.max(1e-6, Math.hypot(dx, dz));
        top.body.applyImpulse(
          {
            x: dx / length * effect.impulse,
            y: effect.impulse * 0.03,
            z: dz / length * effect.impulse,
          },
          true,
        );
        return;
      }
      case "center-pull": {
        const length = Math.max(1e-6, Math.hypot(position.x, position.z));
        top.body.applyImpulse(
          {
            x: -position.x / length * effect.impulse,
            y: 0,
            z: -position.z / length * effect.impulse,
          },
          true,
        );
        return;
      }
      case "orbit-dash": {
        const radial = Math.max(1e-6, Math.hypot(position.x, position.z));
        const sign = top.reverseOrbitUntil > elapsed ? -1 : 1;
        top.body.applyImpulse(
          {
            x: -position.z / radial * effect.impulse * sign,
            y: effect.impulse * 0.015,
            z: position.x / radial * effect.impulse * sign,
          },
          true,
        );
        return;
      }
      case "cooldown-shift":
        shiftCooldowns(top, effect.seconds, effect.target, effect.radius);
        return;
      case "cleanse":
        top.timed = top.timed.filter(
          (modifier) =>
            modifier.kind !== "friction" || modifier.value <= 1,
        );
        return;
      case "phase":
        applyPhase(top, effect.durationSec);
        return;
      case "reverse-orbit":
        top.reverseOrbitUntil = Math.max(
          top.reverseOrbitUntil,
          elapsed + clamp(effect.durationSec, 0, 30),
        );
        return;
      default:
        /*
         * This function returns void, and tsconfig does not set
         * noImplicitReturns, so until this arm existed a new SkillEffect
         * member could be added, adapted, shipped — and silently do nothing.
         * The effect would exist in the catalogue, pass every content gate,
         * and simply never happen. Now it is a build error.
         */
        assertNever(effect);
    }
  }

  function passiveRankScale(passive: ResolvedPassiveSkill): number {
    return 1 + (passive.rank - 1) * 0.12;
  }

  function scaledPassiveMultiplier(
    multiplier: number,
    passive: ResolvedPassiveSkill,
  ): number {
    return 1 + (multiplier - 1) * passiveRankScale(passive);
  }

  function passiveConditionBoundEffect(
    passive: ResolvedPassiveSkill,
    effect: ResolvedPassiveEffect,
  ): boolean {
    return (
      (passive.trigger === "near-rim" ||
        passive.trigger === "durability-below" ||
        passive.trigger === "spin-below") &&
      (effect.type === "stat-multiplier" ||
        effect.type === "physics-multiplier") &&
      effect.durationSec === undefined
    );
  }

  function passiveConditionSatisfied(
    top: RuntimeTop<TSource>,
    passive: ResolvedPassiveSkill,
  ): boolean {
    if (!top.alive) return false;
    const threshold = clamp(
      finite(
        passive.threshold ?? (
          passive.trigger === "near-rim"
            ? 0.72
            : passive.trigger === "durability-below"
              ? 0.5
              : 0.35
        ),
        0.5,
      ),
      0,
      1,
    );
    if (passive.trigger === "durability-below") {
      return top.hp / Math.max(1, top.hpMax) <= threshold;
    }
    if (passive.trigger === "spin-below") {
      return (
        top.spinEnergy / Math.max(1, top.build.physics.launchSpin) <= threshold
      );
    }
    if (passive.trigger === "near-rim") {
      const position = top.body.translation();
      return Math.hypot(position.x, position.z) / arena.outRadius >= threshold;
    }
    return false;
  }

  function passiveCooldownSec(passive: ResolvedPassiveSkill): number {
    switch (passive.trigger) {
      case "on-hit":
      case "on-take-hit":
        return 0.25;
      case "near-rim":
        return 1.25;
      case "spin-below":
        return 4;
      case "durability-below":
        return passive.effects.some((effect) => effect.type === "phase")
          ? Number.POSITIVE_INFINITY
          : 2;
      case "elimination":
        return 0;
      case "battle-start":
      case "continuous":
        return Number.POSITIVE_INFINITY;
    }
  }

  function passiveIsOneShot(passive: ResolvedPassiveSkill): boolean {
    return (
      passive.trigger === "battle-start" ||
      (passive.trigger === "durability-below" &&
        passive.effects.some((effect) => effect.type === "phase"))
    );
  }

  function applyPassiveImpulse(
    top: RuntimeTop<TSource>,
    effect: Extract<ResolvedPassiveEffect, { readonly type: "impulse" }>,
    target: RuntimeTop<TSource> | null,
    scale: number,
  ): void {
    const position = top.body.translation();
    const other = target?.body.translation();
    let dx = 0;
    let dz = 0;
    if (effect.direction === "toward-center") {
      dx = -position.x;
      dz = -position.z;
    } else if (effect.direction === "tangent") {
      const radial = Math.max(1e-6, Math.hypot(position.x, position.z));
      const sign = top.reverseOrbitUntil > elapsed ? -1 : 1;
      dx = -position.z / radial * sign;
      dz = position.x / radial * sign;
    } else if (other) {
      const direction = effect.direction === "away-from-target" ? -1 : 1;
      dx = (other.x - position.x) * direction;
      dz = (other.z - position.z) * direction;
    } else {
      return;
    }
    const length = Math.max(1e-6, Math.hypot(dx, dz));
    const impulse = Math.max(0, effect.strength) * scale;
    top.body.applyImpulse(
      {
        x: dx / length * impulse,
        y: impulse * 0.02,
        z: dz / length * impulse,
      },
      true,
    );
  }

  function applyPassiveEffect(
    top: RuntimeTop<TSource>,
    passive: ResolvedPassiveSkill,
    effect: ResolvedPassiveEffect,
    target: RuntimeTop<TSource> | null,
  ): void {
    const scale = passiveRankScale(passive);
    switch (effect.type) {
      case "stat-multiplier":
      case "physics-multiplier":
        addPassiveModifier(
          top,
          effect.stat,
          scaledPassiveMultiplier(effect.multiplier, passive),
          effect.durationSec,
        );
        return;
      case "impulse":
        applyPassiveImpulse(top, effect, target, scale);
        return;
      case "spin":
        setSpinEnergy(top, top.spinEnergy + effect.amount * scale);
        return;
      case "durability":
        top.hp = Math.min(top.hpMax, top.hp + Math.max(0, effect.amount) * scale);
        return;
      case "shield":
        addPassiveModifier(
          top,
          "shield",
          clamp(1 - effect.amount * scale / 300, 0.2, 0.92),
          effect.durationSec,
        );
        return;
      case "radial-damage":
        applyEffect(top, {
          type: "shockwave",
          radius: effect.radius,
          impulse: effect.amount * 0.055 * scale,
          damage: effect.amount * scale,
        });
        return;
      case "cooldown-shift":
        shiftCooldowns(top, effect.amountSec * scale, effect.target, effect.radius);
        return;
      case "cleanse":
        top.timed = top.timed.filter(
          (modifier) =>
            modifier.kind !== "friction" || modifier.value <= 1,
        );
        return;
      case "phase":
        applyPhase(top, effect.durationSec * (1 + (passive.rank - 1) * 0.08));
        return;
      case "steal-spin": {
        const victim =
          target &&
          target.alive &&
          target !== top &&
          areEnemies(top, target)
            ? target
            : nearestTarget(top, tops);
        if (!victim) return;
        const amount = Math.max(0, effect.amount) * scale;
        setSpinEnergy(victim, victim.spinEnergy - amount);
        setSpinEnergy(top, top.spinEnergy + amount);
        return;
      }
      case "reverse-orbit":
        top.reverseOrbitUntil = Math.max(
          top.reverseOrbitUntil,
          elapsed + effect.durationSec * (1 + (passive.rank - 1) * 0.08),
        );
        return;
      default:
        // Same silent hole as applyEffect, on the passive side.
        assertNever(effect);
    }
  }

  function recordPassiveTrigger(
    top: RuntimeTop<TSource>,
    passive: ResolvedPassiveSkill,
  ): void {
    const key = `${top.seat}:${passive.id}:${passive.trigger}`;
    const existing = passiveTriggerCounts.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }
    passiveTriggerCounts.set(key, {
      seat: top.seat,
      passiveId: passive.id,
      trigger: passive.trigger,
      count: 1,
    });
  }

  function activatePassive(
    top: RuntimeTop<TSource>,
    runtime: RuntimePassive,
    target: RuntimeTop<TSource> | null,
  ): void {
    if (!top.alive || runtime.consumed) return;
    if (runtime.cooldownUntil > elapsed + 1e-8) return;
    const passive = runtime.def;
    const cooldown = passiveCooldownSec(passive);
    runtime.cooldownUntil = Number.isFinite(cooldown)
      ? elapsed + cooldown
      : Number.POSITIVE_INFINITY;
    if (passiveIsOneShot(passive)) runtime.consumed = true;
    recordPassiveTrigger(top, passive);
    for (const effect of passive.effects) {
      if (passiveConditionBoundEffect(passive, effect)) continue;
      applyPassiveEffect(top, passive, effect, target);
    }
  }

  function firePassiveTrigger(
    top: RuntimeTop<TSource>,
    trigger: ResolvedPassiveTrigger,
    target: RuntimeTop<TSource> | null,
  ): void {
    if (!top.alive) return;
    for (const passive of top.passives) {
      if (passive.def.trigger === trigger) {
        activatePassive(top, passive, target);
      }
    }
  }

  function updateConditionalPassives(top: RuntimeTop<TSource>): void {
    for (const passive of top.passives) {
      const trigger = passive.def.trigger;
      if (
        trigger !== "near-rim" &&
        trigger !== "durability-below" &&
        trigger !== "spin-below"
      ) {
        continue;
      }
      const wasActive = passive.conditionActive;
      passive.conditionActive = passiveConditionSatisfied(top, passive.def);
      if (!passive.conditionActive) continue;
      const hasInstantOrTimedEffect = passive.def.effects.some(
        (effect) => !passiveConditionBoundEffect(passive.def, effect),
      );
      if (
        !wasActive ||
        (hasInstantOrTimedEffect &&
          passive.cooldownUntil <= elapsed + 1e-8)
      ) {
        activatePassive(top, passive, nearestTarget(top, tops));
      }
    }
  }

  function activate(seat: SeatIndex, slot: SkillSlot): SkillActivationResult {
    const checked = activationCheck(seat, slot);
    if (!checked.ok) return checked;
    const top = topBySeat(seat)!;
    const runtime = top.skills[slot - 1]!;
    // Resolve the group once so effects from an earlier member cannot change
    // whether a later member was ready at the instant the button was pressed.
    const members = readyMembers(top, runtime);
    for (const member of members) {
      member.cooldownUntil =
        elapsed + clamp(member.def.cooldownSec, 0.05, 120);
      if (member.charges > 0) member.charges -= 1;
    }
    for (const member of members) {
      for (const effect of member.def.effects) applyEffect(top, effect);
      events.push({
        type: "skill",
        seat,
        slot,
        skillId: member.def.id,
      });
    }
    return checked;
  }

  function knockout(
    top: RuntimeTop<TSource>,
    reason: KnockoutReason,
    by: SeatIndex | null,
  ): void {
    if (!top.alive) return;
    top.alive = false;
    top.hp = Math.max(0, top.hp);
    top.body.setEnabled(false);
    knockouts.push({ seat: top.seat, reason, at: elapsed });
    events.push({ type: "knockout", seat: top.seat, reason, by });
    for (const survivor of tops) {
      if (
        survivor.alive &&
        survivor !== top &&
        areEnemies(survivor, top)
      ) {
        firePassiveTrigger(survivor, "elimination", top);
      }
    }
  }

  function applyTrackingAndSpin(top: RuntimeTop<TSource>): void {
    if (!top.alive) return;
    // Rapier user forces persist until explicitly cleared. Rebuilding the
    // controller force each fixed step prevents tracking/gyro force from
    // accumulating into runaway acceleration.
    top.body.resetForces(true);
    top.body.resetTorques(true);
    top.timed = top.timed.filter((modifier) => modifier.until > elapsed);
    const modifiers = normalizedModifiers.get(top.seat)!;
    const angular = top.body.angvel();
    const spin = top.spinEnergy;
    const spinRatio = clamp(spin / Math.max(1, top.build.physics.launchSpin), 0.05, 1.25);
    const frictionModifier = modifierAt(
      top as RuntimeTop<unknown>,
      "friction",
      elapsed,
    );
    const restitutionModifier = modifierAt(
      top as RuntimeTop<unknown>,
      "restitution",
      elapsed,
    );
    for (let index = 0; index < top.colliders.length; index += 1) {
      top.colliders[index]!.setFriction(
        clamp(
          top.colliderFriction[index]! * frictionModifier,
          0.0005,
          0.04,
        ),
      );
      top.colliders[index]!.setRestitution(
        clamp(
          top.colliderRestitution[index]! * restitutionModifier,
          0,
          0.98,
        ),
      );
    }
    const dragModifier = modifierAt(
      top as RuntimeTop<unknown>,
      "drag",
      elapsed,
    );
    top.body.setLinearDamping(
      clamp(top.build.physics.drag * 0.1 * dragModifier, 0.008, 0.45),
    );
    top.body.setAngularDamping(
      clamp(top.build.physics.drag * 0.006 * dragModifier, 0.0005, 0.09),
    );
    const rotation = top.body.rotation();
    const upX = 2 * (rotation.x * rotation.y - rotation.z * rotation.w);
    const upZ = 2 * (rotation.y * rotation.z + rotation.x * rotation.w);
    const stabilityStat =
      top.build.stats.stability *
      modifierAt(top as RuntimeTop<unknown>, "stability", elapsed);
    const inertiaModifier = modifierAt(
      top as RuntimeTop<unknown>,
      "inertia",
      elapsed,
    );
    const centerOfMassModifier = modifierAt(
      top as RuntimeTop<unknown>,
      "centerOfMass",
      elapsed,
    );
    const stability =
      (0.55 + clamp(stabilityStat, 0, 400) / 90) *
      modifiers.stability *
      Math.sqrt(inertiaModifier) /
      Math.sqrt(centerOfMassModifier) *
      clamp(spinRatio, 0.15, 1);
    top.body.addTorque(
      {
        x:
          -upZ * BASE_GYRO_TORQUE * stability -
          angular.x * (1.4 + stability * 0.2),
        y: 0,
        z:
          upX * BASE_GYRO_TORQUE * stability -
          angular.z * (1.4 + stability * 0.2),
      },
      true,
    );

    const target = nearestTarget(top, tops);
    const position = top.body.translation();
    const radial = Math.hypot(position.x, position.z);
    let directionX = radial > 1e-6 ? -position.x / radial : 0;
    let directionZ = radial > 1e-6 ? -position.z / radial : 0;
    if (target) {
      const targetPosition = target.body.translation();
      const targetVelocity = target.body.linvel();
      const dx = targetPosition.x + targetVelocity.x * 0.12 - position.x;
      const dz = targetPosition.z + targetVelocity.z * 0.12 - position.z;
      const distance = Math.max(1e-6, Math.hypot(dx, dz));
      const baseOrbitSign = top.seat % 2 === 0 ? 1 : -1;
      const orbitSign =
        top.reverseOrbitUntil > elapsed ? -baseOrbitSign : baseOrbitSign;
      // Normal play has a visible orbit/chase rhythm. During sudden death the
      // orbit collapses into increasingly direct charges so a symmetric pair
      // cannot circle forever without making contact.
      const orbitStrength =
        0.46 * (1 + top.motionBias * 0.16) /
        (1 + suddenDeathStage * 0.55);
      directionX = dx / distance + -dz / distance * orbitSign * orbitStrength;
      directionZ = dz / distance + dx / distance * orbitSign * orbitStrength;
      const normalized = Math.max(1, Math.hypot(directionX, directionZ));
      directionX /= normalized;
      directionZ /= normalized;
    }
    const edgeStart = arena.outRadius * 0.77;
    if (radial > edgeStart) {
      const edgeFactor = clamp((radial - edgeStart) / (arena.outRadius - edgeStart), 0, 1);
      // Reinforced during the launch transient — see balance.ts.
      const earlyGuard =
        elapsed < EDGE_EARLY_GUARD_SEC ? EDGE_EARLY_GUARD_BONUS : 0;
      const recovery =
        clamp(0.65 + modifiers.edgeRecovery, 0.65, 1.65) + earlyGuard;
      if (
        elapsed < EDGE_EARLY_GUARD_SEC &&
        radial > arena.outRadius * EDGE_GUARD_BRAKE_RADIUS
      ) {
        const velocity = top.body.linvel();
        const outwardSpeed =
          (velocity.x * position.x + velocity.z * position.z) / radial;
        if (outwardSpeed > 0) {
          const brake =
            outwardSpeed * top.body.mass() * EDGE_GUARD_BRAKE_PER_SEC;
          top.body.addForce(
            {
              x: -position.x / radial * brake,
              y: 0,
              z: -position.z / radial * brake,
            },
            true,
          );
        }
      }
      directionX = directionX * (1 - edgeFactor) - position.x / radial * edgeFactor * recovery;
      directionZ = directionZ * (1 - edgeFactor) - position.z / radial * edgeFactor * recovery;
    }
    const mobilityStat =
      top.build.stats.mobility *
      modifierAt(top as RuntimeTop<unknown>, "mobility", elapsed);
    const mobility = 0.48 + clamp(mobilityStat, 0, 400) / 95;
    const tracking =
      modifiers.tracking *
      modifierAt(top as RuntimeTop<unknown>, "tracking", elapsed) *
      (1 + suddenDeathStage * 0.22);
    top.body.addForce(
      {
        x: directionX * BASE_TRACKING_FORCE * mobility * tracking * spinRatio,
        y: 0,
        z: directionZ * BASE_TRACKING_FORCE * mobility * tracking * spinRatio,
      },
      true,
    );

    const staminaStat =
      top.build.stats.stamina *
      modifierAt(top as RuntimeTop<unknown>, "stamina", elapsed);
    const stamina = 0.58 + clamp(staminaStat, 0, 400) / 90;
    const friction =
      clamp(top.build.physics.friction, 0.05, 1.5) *
      frictionModifier;
    const drain =
      BASE_SPIN_DRAIN *
      friction *
      dragModifier /
      Math.sqrt(inertiaModifier) *
      modifiers.spinDrain *
      (1 + suddenDeathStage * 1.15) /
      stamina;
    const nextSpin = Math.max(0, spin - drain * FIXED_DT);
    top.spinEnergy = nextSpin;
    const sign = angular.y < 0 ? -1 : 1;
    top.body.setAngvel(
      { x: angular.x, y: sign * nextSpin, z: angular.z },
      true,
    );
    const exhaustion = clamp(
      1 -
        nextSpin /
          Math.max(MIN_LIVE_SPIN, top.build.physics.launchSpin * 0.18),
      0,
      1,
    );
    if (suddenDeathStage > 0 && exhaustion > 0) {
      // A top entering its final 18% rotational reserve becomes increasingly
      // unstable. The resulting chassis stress gives sudden death a physical,
      // deterministic finish even when one survivor is isolated by a bank.
      dealDamage(top, suddenDeathStage * 18 * exhaustion * FIXED_DT, null);
    }
  }

  function impactKey(first: RuntimeTop<TSource>, second: RuntimeTop<TSource>): string {
    return first.seat < second.seat
      ? `${first.seat}:${second.seat}`
      : `${second.seat}:${first.seat}`;
  }

  function processImpact(contact: PendingContact): void {
    const first = contact.first as RuntimeTop<TSource>;
    const second = contact.second as RuntimeTop<TSource>;
    if (!first.alive || !second.alive) return;
    // Rapier has already resolved the physical contact. Teammates therefore
    // still bump and block one another, but combat damage and hit passives are
    // deliberately suppressed.
    if (!areEnemies(first, second)) return;
    const key = impactKey(first, second);
    if ((pairCooldown.get(key) ?? Number.NEGATIVE_INFINITY) > elapsed) return;
    pairCooldown.set(key, elapsed + CONTACT_COOLDOWN_SEC);
    const firstVelocity = first.body.linvel();
    const secondVelocity = second.body.linvel();
    const firstSpin = first.spinEnergy;
    const secondSpin = second.spinEnergy;
    const firstThreat =
      Math.hypot(firstVelocity.x, firstVelocity.z) +
      firstSpin * Math.max(...first.build.parts.map((part) => part.radius)) * 0.08 +
      first.build.stats.attack * 0.015;
    const secondThreat =
      Math.hypot(secondVelocity.x, secondVelocity.z) +
      secondSpin * Math.max(...second.build.parts.map((part) => part.radius)) * 0.08 +
      second.build.stats.attack * 0.015;
    const attacker = firstThreat >= secondThreat ? first : second;
    const victim = attacker === first ? second : first;
    const attackerMods = normalizedModifiers.get(attacker.seat)!;
    const attackStat =
      attacker.build.stats.attack *
      modifierAt(attacker as RuntimeTop<unknown>, "attack", elapsed);
    const contactPhysics =
      Math.sqrt(
        modifierAt(attacker as RuntimeTop<unknown>, "mass", elapsed) *
        modifierAt(attacker as RuntimeTop<unknown>, "restitution", elapsed),
      );
    const attack =
      (0.68 + clamp(attackStat, 0, 400) / 92) *
      attackerMods.damageDealt *
      contactPhysics;
    const raw = Math.min(
      MAX_CONTACT_DAMAGE * 1.7,
      Math.max(0, contact.impulse - CONTACT_DAMAGE_THRESHOLD) *
        CONTACT_DAMAGE_SCALE *
        attack,
    );
    if (raw <= 0) return;
    const damage = dealDamage(victim, raw, attacker);
    const selfDamage = dealDamage(attacker, raw * 0.16, victim);
    if (attackerMods.lifesteal > 0) {
      attacker.hp = Math.min(
        attacker.hpMax,
        attacker.hp + damage * attackerMods.lifesteal,
      );
    }
    const victimMods = normalizedModifiers.get(victim.seat)!;
    if (victimMods.thorns > 0) {
      dealDamage(attacker, damage * victimMods.thorns, victim);
    }
    events.push({
      type: "impact",
      attacker: attacker.seat,
      victim: victim.seat,
      damage,
      impulse: contact.impulse,
      point: contact.point,
    });
    if (victim.hp <= 0) knockout(victim, "destroyed", attacker.seat);
    if (attacker.hp <= 0) {
      knockout(attacker, "destroyed", selfDamage > 0 ? victim.seat : null);
    }
  }

  function updateKnockouts(): void {
    for (const top of tops) {
      if (!top.alive) continue;
      if (top.hp <= 0) {
        knockout(top, "destroyed", top.lastAttacker);
        continue;
      }
      const position = top.body.translation();
      const radius = Math.hypot(position.x, position.z);
      if (
        position.y < OUTSIDE_FALL_Y ||
        radius > arena.outRadius + OUTSIDE_MARGIN
      ) {
        knockout(top, "ring-out", top.lastAttacker);
      }
    }
  }

  function concludeIfNeeded(): void {
    if (phase !== "live" || matchResult) return;
    const alive = tops.filter((top) => top.alive);
    const aliveTeams = new Set(alive.map((top) => top.team));
    if (aliveTeams.size > 1) return;
    const last = knockouts[knockouts.length - 1];
    matchResult = {
      winner: alive[0]?.seat ?? null,
      winnerTeam: alive[0]?.team ?? null,
      reason: last?.reason ?? "draw",
      durationSec: elapsed,
      knockouts: knockouts.slice(),
    };
    phase = "over";
  }

  function enforceSafetyCeiling(): void {
    if (elapsed < maxDurationSec || phase !== "live") return;
    const alive = tops.filter((top) => top.alive);
    const teamScores = new Map<number, number>();
    for (const top of alive) {
      const score = top.hp / top.hpMax + top.spinEnergy * 0.001;
      teamScores.set(top.team, (teamScores.get(top.team) ?? 0) + score);
    }
    if (teamScores.size <= 1) return;
    const rankedTeams = [...teamScores.entries()].sort(
      ([firstTeam, firstScore], [secondTeam, secondScore]) =>
        secondScore - firstScore || firstTeam - secondTeam,
    );
    const [winnerTeam, winnerScore] = rankedTeams[0]!;
    const runnerScore = rankedTeams[1]![1];
    if (Math.abs(winnerScore - runnerScore) < 1e-6) {
      for (const top of alive) knockout(top, "destroyed", null);
      return;
    }
    const creditedWinner = alive
      .filter((top) => top.team === winnerTeam)
      .sort(
        (first, second) =>
          second.hp / second.hpMax +
            second.spinEnergy * 0.001 -
            (first.hp / first.hpMax + first.spinEnergy * 0.001) ||
          first.seat - second.seat,
      )[0]!;
    for (const top of alive) {
      if (top.team !== winnerTeam) {
        knockout(top, "destroyed", creditedWinner.seat);
      }
    }
  }

  function skillState(top: RuntimeTop<TSource>, runtime: RuntimeSkill): SkillRuntimeState {
    const check = activationCheck(top.seat, runtime.slot);
    const first = runtime.members[0];
    const ready =
      phase === "live" && top.alive ? readyMembers(top, runtime) : [];
    const cooldownRemaining =
      runtime.members.length === 0
        ? 0
        : Math.min(
            ...runtime.members.map((member) =>
              Math.max(0, member.cooldownUntil - elapsed),
            ),
          );
    const chargesRemaining = runtime.members.some(
      (member) => member.charges < 0,
    )
      ? -1
      : runtime.members.reduce((sum, member) => sum + member.charges, 0);
    return {
      slot: runtime.slot,
      skillId: first?.def.id ?? null,
      name:
        runtime.members.length === 0
          ? null
          : runtime.members.map((member) => member.def.name).join(" + "),
      cooldownRemaining,
      chargesRemaining,
      ready: check.ok,
      blockedReason: check.ok ? null : check.reason,
      groupSize: runtime.members.length,
      readyCount: ready.length,
    };
  }

  function stateFor(top: RuntimeTop<TSource>): TopState {
    const position = top.body.translation();
    const rotation = top.body.rotation();
    const velocity = top.body.linvel();
    return {
      seat: top.seat,
      name: top.name,
      alive: top.alive,
      hp: top.hp,
      hpMax: top.hpMax,
      spin: top.spinEnergy,
      position: [position.x, position.y, position.z],
      rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
      velocity: [velocity.x, velocity.y, velocity.z],
      skills: top.skills.map((runtime) => skillState(top, runtime)),
      lastHitAt: top.lastHitAt,
      cpu: top.cpu,
    };
  }

  const sim: VortexSim = {
    get tick() {
      return tick;
    },
    get elapsed() {
      return elapsed;
    },
    get phase() {
      return phase;
    },
    arena,
    step(): void {
      if (disposed) throw new Error("VortexSim is disposed");
      if (phase === "over") return;
      if (phase === "live") {
        if (!battleStartApplied) {
          battleStartApplied = true;
          for (const top of tops) {
            firePassiveTrigger(top, "battle-start", null);
          }
        }
        for (const top of tops) updateConditionalPassives(top);
        for (const top of tops) applyTrackingAndSpin(top);
      }
      syncPhaseColliders();
      world.step(queue);
      tick += 1;
      if (phase === "countdown") {
        countdownElapsed += FIXED_DT;
        queue.clear();
        if (countdownElapsed >= countdownSec) phase = "live";
        return;
      }
      elapsed += FIXED_DT;
      const nextStage =
        elapsed < suddenDeathSec
          ? 0
          : Math.min(6, Math.floor((elapsed - suddenDeathSec) / 20) + 1);
      if (nextStage !== suddenDeathStage) {
        suddenDeathStage = nextStage;
        events.push({ type: "sudden-death", stage: nextStage });
      }

      const pending = new Map<string, PendingContact>();
      queue.drainContactForceEvents((event) => {
        const first = colliderOwner.get(event.collider1());
        const second = colliderOwner.get(event.collider2());
        if (!first || !second || first === second) return;
        const firstCollider = world.getCollider(event.collider1());
        const secondCollider = world.getCollider(event.collider2());
        if (!firstCollider || !secondCollider) return;
        const firstPosition = firstCollider.translation();
        const secondPosition = secondCollider.translation();
        const contact: PendingContact = {
          first: first as RuntimeTop<unknown>,
          second: second as RuntimeTop<unknown>,
          impulse: event.totalForceMagnitude() * FIXED_DT,
          point: [
            (firstPosition.x + secondPosition.x) / 2,
            (firstPosition.y + secondPosition.y) / 2,
            (firstPosition.z + secondPosition.z) / 2,
          ],
        };
        const key = impactKey(first, second);
        const previous = pending.get(key);
        if (!previous || previous.impulse < contact.impulse) pending.set(key, contact);
      });
      for (const contact of pending.values()) processImpact(contact);
      updateKnockouts();
      enforceSafetyCeiling();
      concludeIfNeeded();
    },
    activate,
    canActivate(seat: SeatIndex, slot: SkillSlot): SkillActivationResult {
      return activationCheck(seat, slot);
    },
    setCpu(seat: SeatIndex, cpu: boolean): void {
      const top = topBySeat(seat);
      if (top) top.cpu = cpu;
    },
    isCpu(seat: SeatIndex): boolean {
      return topBySeat(seat)?.cpu ?? false;
    },
    getState(): MatchState {
      return {
        tick,
        elapsed,
        phase,
        suddenDeathStage,
        arenaId: arena.id,
        tops: tops.map(stateFor),
      };
    },
    drainEvents(): readonly SimEvent[] {
      const result = events.slice();
      events.length = 0;
      return result;
    },
    result(): MatchResult | null {
      return matchResult;
    },
    diagnostics() {
      return {
        rigidBodies: world.bodies.len(),
        colliders: world.colliders.len(),
        topRigidBodies: tops.length,
        topColliders: tops.map((top) => top.colliders.length),
        passiveTriggers: [...passiveTriggerCounts.values()]
          .map((entry) => ({ ...entry }))
          .sort(
            (first, second) =>
              first.seat - second.seat ||
              first.passiveId.localeCompare(second.passiveId) ||
              first.trigger.localeCompare(second.trigger),
          ),
        stepCount: tick,
      };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      colliderOwner.clear();
      queue.free();
      world.free();
    },
  };
  return sim;
}
