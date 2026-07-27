import RAPIER from "@dimforge/rapier3d-compat";
import {
  BASE_GYRO_TORQUE,
  BASE_SPIN_DRAIN,
  BASE_TRACKING_FORCE,
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
  type CreateVortexSimOptions,
  type KnockoutReason,
  type MatchPhase,
  type MatchResult,
  type MatchState,
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

let physicsInit: Promise<void> | null = null;

export async function initPhysics(): Promise<void> {
  physicsInit ??= Promise.resolve(RAPIER.init()).then(() => undefined);
  await physicsInit;
}

interface RuntimeSkill {
  readonly slot: SkillSlot;
  readonly def: ResolvedTopPart["activeSkill"];
  cooldownUntil: number;
  charges: number;
}

type TimedModifierKind =
  | "shield"
  | "attack"
  | "stability"
  | "tracking"
  | "friction";

interface TimedModifier {
  readonly kind: TimedModifierKind;
  readonly value: number;
  readonly until: number;
}

interface RuntimeTop<TSource> {
  readonly seat: SeatIndex;
  readonly name: string;
  readonly build: ResolvedTopBuild<TSource>;
  readonly body: RAPIER.RigidBody;
  readonly colliders: readonly RAPIER.Collider[];
  readonly skills: RuntimeSkill[];
  readonly hpMax: number;
  readonly motionBias: number;
  hp: number;
  spinEnergy: number;
  alive: boolean;
  cpu: boolean;
  lastHitAt: number;
  lastAttacker: SeatIndex | null;
  reverseOrbitUntil: number;
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
      .setRestitution(arena.restitution),
    body,
  );
}

function spawnTop<TSource>(
  world: RAPIER.World,
  build: ResolvedTopBuild<TSource>,
  name: string,
  seat: SeatIndex,
  playerCount: number,
  arena: SimRingArena,
  startAngle: number,
  motionBias: number,
  cpu: boolean,
): RuntimeTop<TSource> {
  assertBuild(build as ResolvedTopBuild<unknown>, seat);
  const angle = startAngle + seat / playerCount * Math.PI * 2;
  const radius = arena.spawnRadius;
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  const surface = sampleRingHeight(arena, radius, angle);
  const layouts = colliderLayouts(build as ResolvedTopBuild<unknown>);
  const lowest = Math.min(...layouts.map((layout) => layout.y - layout.height / 2));
  const launchSpin = clamp(finite(build.physics.launchSpin, 82), 30, 190);
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
  const tangentSpeed = 0.11 + motionBias * 0.045;
  const radialSpeed = motionBias * 0.028;
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
        ),
      )
      .setRestitution(clamp(part.restitution, 0, 0.95))
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(0);

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
  const skills: RuntimeSkill[] = build.parts.map((part, index) => ({
    slot: skillSlot(index + 1),
    def: part.activeSkill,
    cooldownUntil: 0,
    charges: part.activeSkill?.charges ?? 0,
  }));

  return {
    seat,
    name,
    build,
    body,
    colliders,
    skills,
    hpMax,
    motionBias,
    hp: hpMax,
    spinEnergy: launchSpin,
    alive: true,
    cpu,
    lastHitAt: Number.NEGATIVE_INFINITY,
    lastAttacker: null,
    reverseOrbitUntil: 0,
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
    if (!target.alive || target === source) continue;
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
      return tops.filter((candidate) => candidate.alive).length <= 2;
    case "outnumbered":
      return tops.filter((candidate) => candidate.alive && candidate !== top).length >= 2;
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
    .slice(0, 4)
    .map((build, seat) => ({ build, seat }))
    .filter(
      (
        entry,
      ): entry is { readonly build: ResolvedTopBuild<TSource>; readonly seat: number } =>
        entry.build !== null,
    );
  if (activeBuilds.length < 2 || activeBuilds.length > 4) {
    throw new Error("VORTEX CROWN requires two to four resolved builds");
  }
  const arena = opts.arena ?? ringArenaById(opts.arenaId ?? "core-bowl");
  const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  world.timestep = FIXED_DT;
  const queue = new RAPIER.EventQueue(true);
  addRing(world, arena);
  const rng = mulberry32(opts.seed);
  const cpuSeats = new Set(opts.cpuSeats ?? []);
  const startAngle = rng.range(0, Math.PI * 2);
  const tops = activeBuilds.map(({ build, seat }) =>
    spawnTop(
      world,
      build,
      opts.names?.[seat] ?? build.name,
      seatIndex(seat),
      activeBuilds.length,
      arena,
      startAngle,
      rng.range(-1, 1),
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
  let tick = 0;
  let countdownElapsed = 0;
  let elapsed = 0;
  let phase: MatchPhase = countdownSec > 0 ? "countdown" : "live";
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

  function activationCheck(seat: number, slot: number): SkillActivationResult {
    if (phase !== "live") return reject(seat, slot, "match-not-live");
    const top = topBySeat(seat);
    if (!top) return reject(seat, slot, "invalid-seat");
    if (!top.alive) return reject(seat, slot, "knocked-out");
    const runtime = top.skills[slot - 1];
    if (!runtime?.def) return reject(seat, slot, "empty-slot");
    if (runtime.cooldownUntil > elapsed + 1e-8) {
      return reject(seat, slot, "cooldown");
    }
    if (runtime.charges === 0) return reject(seat, slot, "no-charges");
    if (
      !runtime.def.conditions.every((condition) =>
        conditionSatisfied(condition, top, tops, arena, elapsed),
      )
    ) {
      return reject(seat, slot, "condition");
    }
    return {
      ok: true,
      seat: top.seat,
      slot: runtime.slot,
      skillId: runtime.def.id,
    };
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

  function dealDamage(
    victim: RuntimeTop<TSource>,
    rawDamage: number,
    attacker: RuntimeTop<TSource> | null,
  ): number {
    if (!victim.alive) return 0;
    const victimMods = normalizedModifiers.get(victim.seat)!;
    const shield = modifierAt(
      victim as RuntimeTop<unknown>,
      "shield",
      elapsed,
    );
    const defense = 0.7 + clamp(victim.build.stats.defense, 0, 200) / 115;
    // Sudden death deliberately turns every clean hit into a serious threat.
    // The first 120 seconds retain the normal defensive identity of a build.
    const suddenMultiplier = 1 + suddenDeathStage * 0.65;
    const damage = Math.max(
      0,
      rawDamage * victimMods.damageTaken * shield * suddenMultiplier / defense,
    );
    victim.hp = Math.max(0, victim.hp - damage);
    if (damage > 0) {
      victim.lastHitAt = elapsed;
      victim.lastAttacker = attacker?.seat ?? victim.lastAttacker;
      victim.spinEnergy = Math.max(0, victim.spinEnergy - damage * 0.055);
    }
    return damage;
  }

  function applyEffect(top: RuntimeTop<TSource>, effect: SkillEffect): void {
    const target = nearestTarget(top, tops);
    const position = top.body.translation();
    switch (effect.type) {
      case "spin-boost": {
        const angular = top.body.angvel();
        const sign = angular.y < 0 ? -1 : 1;
        top.spinEnergy = clamp(
          top.spinEnergy + effect.radiansPerSec,
          0,
          220,
        );
        top.body.setAngvel(
          {
            x: angular.x,
            y: sign * top.spinEnergy,
            z: angular.z,
          },
          true,
        );
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
          if (!other.alive || other === top) continue;
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
          if (!other.alive || other === top) continue;
          if (horizontalDistance(position, other.body.translation()) > radius) continue;
          const angular = other.body.angvel();
          const sign = angular.y < 0 ? -1 : 1;
          other.spinEnergy = Math.max(
            0,
            other.spinEnergy - Math.max(0, effect.radiansPerSec),
          );
          other.body.setAngvel(
            {
              x: angular.x,
              y: sign * other.spinEnergy,
              z: angular.z,
            },
            true,
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
        for (const runtime of top.skills) {
          runtime.cooldownUntil = Math.max(
            elapsed,
            runtime.cooldownUntil + effect.seconds,
          );
        }
        return;
      case "cleanse":
        top.timed = top.timed.filter(
          (modifier) =>
            modifier.kind !== "friction" || modifier.value <= 1,
        );
        return;
      case "reverse-orbit":
        top.reverseOrbitUntil = Math.max(
          top.reverseOrbitUntil,
          elapsed + clamp(effect.durationSec, 0, 30),
        );
        return;
    }
  }

  function activate(seat: SeatIndex, slot: SkillSlot): SkillActivationResult {
    const checked = activationCheck(seat, slot);
    if (!checked.ok) return checked;
    const top = topBySeat(seat)!;
    const runtime = top.skills[slot - 1]!;
    const definition = runtime.def!;
    runtime.cooldownUntil = elapsed + clamp(definition.cooldownSec, 0.05, 120);
    if (runtime.charges > 0) runtime.charges -= 1;
    for (const effect of definition.effects) applyEffect(top, effect);
    events.push({
      type: "skill",
      seat,
      slot,
      skillId: definition.id,
    });
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
    const rotation = top.body.rotation();
    const upX = 2 * (rotation.x * rotation.y - rotation.z * rotation.w);
    const upZ = 2 * (rotation.y * rotation.z + rotation.x * rotation.w);
    const stability =
      (0.55 + clamp(top.build.stats.stability, 0, 200) / 90) *
      modifiers.stability *
      modifierAt(top as RuntimeTop<unknown>, "stability", elapsed) *
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
      const recovery = clamp(0.65 + modifiers.edgeRecovery, 0.65, 1.65);
      directionX = directionX * (1 - edgeFactor) - position.x / radial * edgeFactor * recovery;
      directionZ = directionZ * (1 - edgeFactor) - position.z / radial * edgeFactor * recovery;
    }
    const mobility = 0.48 + clamp(top.build.stats.mobility, 0, 200) / 95;
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

    const stamina = 0.58 + clamp(top.build.stats.stamina, 0, 200) / 90;
    const friction =
      clamp(top.build.physics.friction, 0.05, 1.5) *
      modifierAt(top as RuntimeTop<unknown>, "friction", elapsed);
    const drain =
      BASE_SPIN_DRAIN *
      friction *
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
    const attack =
      (0.68 + clamp(attacker.build.stats.attack, 0, 200) / 92) *
      attackerMods.damageDealt *
      modifierAt(attacker as RuntimeTop<unknown>, "attack", elapsed);
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
    if (alive.length > 1) return;
    const last = knockouts[knockouts.length - 1];
    matchResult = {
      winner: alive[0]?.seat ?? null,
      reason: last?.reason ?? "draw",
      durationSec: elapsed,
      knockouts: knockouts.slice(),
    };
    phase = "over";
  }

  function enforceSafetyCeiling(): void {
    if (elapsed < maxDurationSec || phase !== "live") return;
    const alive = tops.filter((top) => top.alive);
    if (alive.length <= 1) return;
    const sorted = alive.slice().sort((first, second) => {
      const firstScore =
        first.hp / first.hpMax + first.spinEnergy * 0.001;
      const secondScore =
        second.hp / second.hpMax + second.spinEnergy * 0.001;
      return secondScore - firstScore;
    });
    const winner = sorted[0]!;
    const runnerUp = sorted[1]!;
    const winnerScore =
      winner.hp / winner.hpMax + winner.spinEnergy * 0.001;
    const runnerScore =
      runnerUp.hp / runnerUp.hpMax + runnerUp.spinEnergy * 0.001;
    if (Math.abs(winnerScore - runnerScore) < 1e-6) {
      for (const top of alive) knockout(top, "destroyed", null);
      return;
    }
    for (const top of alive) {
      if (top !== winner) knockout(top, "destroyed", winner.seat);
    }
  }

  function skillState(top: RuntimeTop<TSource>, runtime: RuntimeSkill): SkillRuntimeState {
    const check = activationCheck(top.seat, runtime.slot);
    return {
      slot: runtime.slot,
      skillId: runtime.def?.id ?? null,
      name: runtime.def?.name ?? null,
      cooldownRemaining: Math.max(0, runtime.cooldownUntil - elapsed),
      chargesRemaining: runtime.charges,
      ready: check.ok,
      blockedReason: check.ok ? null : check.reason,
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
        for (const top of tops) applyTrackingAndSpin(top);
      }
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
