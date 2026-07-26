import RAPIER from "@dimforge/rapier3d-compat";
import {
  ARENA_COLLISION_GROUPS,
  assembleBot,
  type AssembledBot
} from "./assemble";
import { validateBuild } from "./build";
import {
  COUNTDOWN_SEC,
  FIXED_DT,
  OIL_TRACTION_MUL,
  SAW_OMEGA,
  WALL_RESTITUTION
} from "./balance";
import { DamageSystem, type DamageBot } from "./damage";
import { DeploySystem } from "./deploy";
import { driveBot } from "./driver";
import {
  internalTelemetry,
  type InternalTelemetry
} from "./internals";
import { mulberry32 } from "./rng";
import { ProjectileSystem } from "./projectile";
import {
  CELL,
  NEUTRAL_INPUT,
  type ArenaDef,
  type ArenaSim,
  type BotState,
  type CreateSimOptions,
  type MatchInput,
  type MatchPhase,
  type MatchResult,
  type MatchState,
  type SeatIndex,
  type SimEvent,
  type WeaponDef
} from "./types";

let initPromise: Promise<void> | null = null;

export async function initPhysics(): Promise<void> {
  initPromise ??= Promise.resolve(RAPIER.init()).then(() => undefined);
  await initPromise;
}

interface SimMetadata {
  readonly arena: ArenaDef;
  readonly weaponsBySeat: ReadonlyMap<SeatIndex, readonly WeaponDef[]>;
  readonly botsBySeat: ReadonlyMap<SeatIndex, AssembledBot>;
  readonly world: RAPIER.World;
  readonly damage: DamageSystem;
  readonly deploy: DeploySystem;
  readonly projectile: ProjectileSystem;
}

const metadata = new WeakMap<ArenaSim, SimMetadata>();

export function arenaForSim(sim: ArenaSim): ArenaDef | null {
  return metadata.get(sim)?.arena ?? null;
}

export function weaponsForSim(sim: ArenaSim, seat: SeatIndex): readonly WeaponDef[] {
  return metadata.get(sim)?.weaponsBySeat.get(seat) ?? [];
}

export function internalsForSim(
  sim: ArenaSim,
  seat: SeatIndex
): InternalTelemetry | null {
  const bot = metadata.get(sim)?.botsBySeat.get(seat);
  return bot ? internalTelemetry(bot) : null;
}

export function deployVersionForSim(sim: ArenaSim): number {
  return metadata.get(sim)?.deploy.deployVersion ?? 0;
}

export function arenaSimDiagnostics(sim: ArenaSim): {
  readonly bodies: number;
  readonly colliders: number;
  readonly impulseJoints: number;
  readonly deploys: number;
  readonly projectiles: number;
  readonly tethers: number;
} | null {
  const value = metadata.get(sim);
  if (!value) return null;
  return {
    bodies: value.world.bodies.len(),
    colliders: value.world.colliders.len(),
    impulseJoints: value.world.impulseJoints.len(),
    deploys: value.deploy.diagnostics().count,
    projectiles: value.projectile.entities().length,
    tethers: value.projectile.tetherCount()
  };
}

/** Narrow white-box access used only by the permanent mechanism gates. */
export function arenaSimTestHooks(sim: ArenaSim): {
  readonly world: RAPIER.World;
  readonly damage: DamageSystem;
  readonly deploy: DeploySystem;
  readonly projectile: ProjectileSystem;
  readonly bots: readonly DamageBot[];
} | null {
  const value = metadata.get(sim);
  if (!value) return null;
  return {
    world: value.world,
    damage: value.damage,
    deploy: value.deploy,
    projectile: value.projectile,
    bots: [...value.botsBySeat.keys()]
      .map((seat) => value.damage.botForSeat(seat))
      .filter((bot): bot is DamageBot => bot !== null)
  };
}

function addFixedBox(
  world: RAPIER.World,
  x: number,
  y: number,
  z: number,
  hx: number,
  hy: number,
  hz: number,
  restitution = 0
): RAPIER.Collider {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
  return world.createCollider(
    RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setRestitution(restitution)
      .setCollisionGroups(ARENA_COLLISION_GROUPS),
    body
  );
}

function addFloor(world: RAPIER.World, arena: ArenaDef): void {
  const half = arena.size / 2;
  const thickness = CELL;
  if (!arena.pit) {
    addFixedBox(world, 0, -thickness, 0, half, thickness, half);
    return;
  }
  const pit = arena.pit;
  const left = Math.max(-half, pit.x - pit.r);
  const right = Math.min(half, pit.x + pit.r);
  const bottom = Math.max(-half, pit.z - pit.r);
  const top = Math.min(half, pit.z + pit.r);
  const leftWidth = left + half;
  const rightWidth = half - right;
  const bottomDepth = bottom + half;
  const topDepth = half - top;
  if (leftWidth > 0) {
    addFixedBox(world, -half + leftWidth / 2, -thickness, 0, leftWidth / 2, thickness, half);
  }
  if (rightWidth > 0) {
    addFixedBox(world, right + rightWidth / 2, -thickness, 0, rightWidth / 2, thickness, half);
  }
  if (bottomDepth > 0) {
    addFixedBox(
      world,
      pit.x,
      -thickness,
      -half + bottomDepth / 2,
      pit.r,
      thickness,
      bottomDepth / 2
    );
  }
  if (topDepth > 0) {
    addFixedBox(
      world,
      pit.x,
      -thickness,
      top + topDepth / 2,
      pit.r,
      thickness,
      topDepth / 2
    );
  }
}

function addWalls(world: RAPIER.World, arena: ArenaDef): void {
  const half = arena.size / 2;
  const wallHalf = CELL / 2;
  const y = arena.wallHeight / 2;
  addFixedBox(world, -half - wallHalf, y, 0, wallHalf, y, half, WALL_RESTITUTION);
  addFixedBox(world, half + wallHalf, y, 0, wallHalf, y, half, WALL_RESTITUTION);
  addFixedBox(world, 0, y, -half - wallHalf, half, y, wallHalf, WALL_RESTITUTION);
  addFixedBox(world, 0, y, half + wallHalf, half, y, wallHalf, WALL_RESTITUTION);
}

function spawnFor(
  arena: ArenaDef,
  seat: SeatIndex,
  cornerOffset: number,
  offsetJitter: number,
  facingJitter: number
): { origin: readonly [number, number, number]; facing: number } {
  const offset = arena.size * 11 / 32;
  const signs: readonly (readonly [number, number])[] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1]
  ];
  // Corners are not equivalent: the pit sits off-centre and the flame jets are
  // not symmetric, so a fixed seat-to-corner mapping hands one seat a
  // permanent disadvantage. Measured over 20 matches with the mapping fixed,
  // seat 3 won 0. Rotating the mapping per match averages the arena out.
  const [sx, sz] = signs[(seat + cornerOffset) % 4]!;
  const x = sx * (offset + offsetJitter);
  const z = sz * (offset - offsetJitter);
  const facing = Math.atan2(x, z) + facingJitter;
  return { origin: [x, 0, z], facing };
}

export function createArenaSim(opts: CreateSimOptions): ArenaSim {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = FIXED_DT;
  const queue = new RAPIER.EventQueue(true);
  const rng = mulberry32(opts.seed);
  const events: SimEvent[] = [];
  addFloor(world, opts.arena);
  addWalls(world, opts.arena);

  const bots: DamageBot[] = [];
  const cornerOffset = rng.int(4);
  const assemblyOrder: SeatIndex[] = [0, 1, 2, 3];
  for (let index = assemblyOrder.length - 1; index > 0; index -= 1) {
    const other = rng.int(index + 1);
    [assemblyOrder[index], assemblyOrder[other]] = [assemblyOrder[other]!, assemblyOrder[index]!];
  }
  for (const rawSeat of assemblyOrder) {
    const seat = rawSeat as SeatIndex;
    const spec = opts.specs[seat] ?? null;
    if (!spec) continue;
    const validation = validateBuild(spec, opts.catalog, opts.settings);
    if (!validation.ok) {
      throw new Error(`Invalid bot for seat ${seat}: ${validation.errors.join(" / ")}`);
    }
    const spawn = spawnFor(
      opts.arena,
      seat,
      cornerOffset,
      rng.range(-CELL * 4, CELL * 4),
      rng.range(-CELL * 2, CELL * 2)
    );
    const assembled = assembleBot(
      world,
      spec,
      opts.catalog,
      seat,
      spawn.origin,
      spawn.facing
    );
    bots.push({
      assembled,
      name: opts.names[seat] ?? spec.name,
      alive: true,
      chassisHp: assembled.chassisDef.hp,
      chassisHpMax: assembled.chassisDef.hp,
      detached: [],
      immobileFor: 0,
      damageDealt: 0,
      damageTaken: 0,
      aggression: 0,
      control: 0,
      contactCount: 0,
      lastNearestDistance: Number.POSITIVE_INFINITY,
      burningFor: 0,
      burningBy: null,
      nettedFor: 0,
      pinnedFor: 0,
      oiledFor: 0,
      tetheredBy: null,
      disabledBy: null,
      disableGraceFor: 0,
      wasDisabled: false,
      netDampingApplied: false
    });
  }
  bots.sort((a, b) => a.assembled.seat - b.assembled.seat);

  const damage = new DamageSystem(world, bots, events, opts.arena, opts.settings);
  const deploy = new DeploySystem(world, damage, events);
  const projectile = new ProjectileSystem(world, damage, events);
  for (const saw of opts.arena.saws) {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicVelocityBased().setTranslation(saw.x, CELL / 2, saw.z)
    );
    body.setAngvel({ x: 0, y: SAW_OMEGA, z: 0 }, true);
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cylinder(CELL / 2, saw.r)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(0)
        .setCollisionGroups(ARENA_COLLISION_GROUPS),
      body
    );
    damage.registerSaw(collider.handle);
  }

  let tick = 0;
  let countdownElapsed = 0;
  let liveElapsed = 0;
  let phase: MatchPhase = "countdown";
  let matchResult: MatchResult | null = null;
  let disposed = false;

  const sim: ArenaSim = {
    get tick() {
      return tick;
    },
    get elapsed() {
      return liveElapsed;
    },
    get phase() {
      return phase;
    },
    step(inputs: readonly MatchInput[]): void {
      if (disposed) throw new Error("ArenaSim is disposed");
      if (phase === "over") return;
      deploy.update(liveElapsed);
      projectile.update(liveElapsed);
      for (const bot of bots) {
        const state = damage.stateFor(bot);
        const input = inputs[bot.assembled.seat] ?? NEUTRAL_INPUT;
        const eventStart = events.length;
        const flipped = driveBot(
          bot.assembled,
          input,
          phase,
          {
            inverted: state.inverted,
            alive: bot.alive,
            driveDisabled:
              bot.nettedFor > 0 || bot.pinnedFor > 0,
            tractionMul: bot.oiledFor > 0 ? OIL_TRACTION_MUL : 1
          },
          events
        );
        for (const event of events.slice(eventStart)) {
          if (event.t !== "fire" || event.seat !== bot.assembled.seat) continue;
          const weapon = bot.assembled.weapons.find(
            (candidate) => candidate.def.slot === event.slot
          );
          if (!weapon || weapon.detached) continue;
          if (event.effect === "deploy") deploy.deploy(bot, weapon);
          else if (event.effect === "net" || event.effect === "harpoon") {
            projectile.launch(bot, weapon);
          }
        }
        if (flipped) events.push({ t: "flip", seat: bot.assembled.seat });
      }
      world.step(queue);
      tick += 1;

      if (phase === "countdown") {
        countdownElapsed += FIXED_DT;
        queue.clear();
        if (countdownElapsed >= COUNTDOWN_SEC) phase = "live";
        return;
      }

      liveElapsed += FIXED_DT;
      queue.drainContactForceEvents((event) => {
        const collider1 = world.getCollider(event.collider1());
        const collider2 = world.getCollider(event.collider2());
        if (!collider1 || !collider2) return;
        const point1 = collider1.translation();
        const point2 = collider2.translation();
        const point = {
          x: (point1.x + point2.x) / 2,
          y: (point1.y + point2.y) / 2,
          z: (point1.z + point2.z) / 2
        };
        if (deploy.processContact(event.collider1(), event.collider2(), point)) return;
        if (projectile.processContact(event.collider1(), event.collider2(), point)) return;
        damage.processContact(event.collider1(), event.collider2(), event.totalForceMagnitude(), {
          ...point
        });
      });
      damage.update(liveElapsed);
      matchResult = damage.result(liveElapsed);
      if (matchResult) phase = "over";
    },
    getState(): MatchState {
      const states: BotState[] = bots.map((bot) => damage.stateFor(bot));
      return {
        tick,
        elapsed: liveElapsed,
        phase,
        bots: states,
        entities: [...deploy.entities(), ...projectile.entities()]
      };
    },
    drainEvents(): readonly SimEvent[] {
      const drained = events.slice();
      events.length = 0;
      return drained;
    },
    result(): MatchResult | null {
      return matchResult;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      projectile.dispose();
      deploy.dispose();
      queue.free();
      world.free();
      metadata.delete(sim);
    }
  };
  metadata.set(sim, {
    arena: opts.arena,
    weaponsBySeat: new Map(
      bots.map((bot) => [
        bot.assembled.seat,
        bot.assembled.weapons.map((weapon) => weapon.def)
      ])
    ),
    botsBySeat: new Map(
      bots.map((bot) => [bot.assembled.seat, bot.assembled])
    ),
    world,
    damage,
    deploy,
    projectile
  });
  return sim;
}
