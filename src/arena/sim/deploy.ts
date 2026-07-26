import RAPIER from "@dimforge/rapier3d-compat";
import { DEBRIS_COLLISION_GROUPS, type WeaponRuntime } from "./assemble";
import {
  CALTROP_DAMAGE,
  CALTROP_HITS,
  DEPLOY_CAP_GLOBAL,
  DEPLOY_CAP_PER_SEAT,
  DEPLOY_MIN_SPACING,
  DEPLOY_PAD_HALF_HEIGHT,
  TRAP_RADIUS,
  DEPLOY_TTL,
  FIXED_DT,
  GLUE_SEC,
  MINE_ARM_SEC,
  MINE_DAMAGE,
  MINE_IMPULSE,
  OIL_CONTACT_SEC
} from "./balance";
import type { DamageBot, DamageSystem } from "./damage";
import type { SeatIndex, SimEvent, TrapKind, WorldEntity } from "./types";

interface DeployedTrap {
  readonly id: number;
  readonly kind: TrapKind;
  readonly owner: SeatIndex;
  readonly born: number;
  readonly collider: RAPIER.Collider;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  hitsLeft: number;
  state: number;
}

export interface DeployDiagnostics {
  readonly count: number;
  readonly version: number;
  readonly anchorHandle: number;
  readonly colliderHandles: readonly number[];
}

export class DeploySystem {
  private readonly anchor: RAPIER.RigidBody;
  private readonly traps: DeployedTrap[] = [];
  /** Never share this with DamageSystem's combat-debris pool. */
  private readonly trapByCollider = new Map<number, DeployedTrap>();
  private readonly ammo = new Map<string, number>();
  private nextId = 1;
  private version = 0;
  private currentTime = 0;

  constructor(
    private readonly world: RAPIER.World,
    private readonly damage: DamageSystem,
    private readonly events: SimEvent[]
  ) {
    this.anchor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  }

  private ammoKey(owner: SeatIndex, weapon: WeaponRuntime): string {
    return `${owner}:${weapon.idx}`;
  }

  private remove(trap: DeployedTrap): void {
    // Rapier reuses collider handles. Delete first, before this step creates
    // anything else, or a new debris collider can masquerade as an old mine.
    this.trapByCollider.delete(trap.collider.handle);
    const index = this.traps.indexOf(trap);
    if (index >= 0) this.traps.splice(index, 1);
    if (trap.collider.isValid()) this.world.removeCollider(trap.collider, true);
    this.version += 1;
  }

  update(elapsed: number): void {
    this.currentTime = elapsed;
    for (const trap of [...this.traps]) {
      if (trap.born + DEPLOY_TTL <= elapsed) this.remove(trap);
    }
  }

  deploy(bot: DamageBot, weapon: WeaponRuntime): boolean {
    const kind = weapon.def.trapKind;
    if (!kind) return false;
    const key = this.ammoKey(bot.assembled.seat, weapon);
    const left = this.ammo.get(key) ?? Math.max(0, weapon.def.ammo ?? 0);
    if (left <= 0) return false;

    const chassis = bot.assembled.chassis;
    const p = chassis.translation();
    const q = chassis.rotation();
    const forwardX = -2 * (q.x * q.z + q.w * q.y);
    const forwardZ = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const length = Math.max(Math.hypot(forwardX, forwardZ), Number.EPSILON);
    const x = p.x - forwardX / length * 0.7;
    const z = p.z - forwardZ / length * 0.7;
    const yaw = Math.atan2(forwardX, forwardZ);
    if (
      this.traps.some(
        (trap) =>
          trap.owner === bot.assembled.seat &&
          Math.hypot(trap.x - x, trap.z - z) < DEPLOY_MIN_SPACING
      )
    ) {
      return false;
    }

    // Seat FIFO is enforced before the global FIFO, and all retirement occurs
    // before creating the new collider so stale handles cannot be observed.
    const owned = this.traps.filter((trap) => trap.owner === bot.assembled.seat);
    if (owned.length >= DEPLOY_CAP_PER_SEAT) this.remove(owned[0]!);
    while (this.traps.length >= DEPLOY_CAP_GLOBAL) this.remove(this.traps[0]!);

    const radius = TRAP_RADIUS[kind];
    const desc = RAPIER.ColliderDesc.cylinder(DEPLOY_PAD_HALF_HEIGHT, radius)
      .setTranslation(x, DEPLOY_PAD_HALF_HEIGHT, z)
      .setCollisionGroups(DEBRIS_COLLISION_GROUPS)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(0);
    if (kind === "oil") {
      desc
        .setFriction(0)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);
    } else {
      desc.setFriction(1.1);
    }
    const collider = this.world.createCollider(desc, this.anchor);
    const trap: DeployedTrap = {
      id: this.nextId++,
      kind,
      owner: bot.assembled.seat,
      born: this.currentTime,
      collider,
      x,
      y: DEPLOY_PAD_HALF_HEIGHT,
      z,
      yaw,
      hitsLeft: CALTROP_HITS,
      state: 0
    };
    this.traps.push(trap);
    this.trapByCollider.set(collider.handle, trap);
    this.ammo.set(key, left - 1);
    this.version += 1;
    this.events.push({
      t: "deploy",
      seat: trap.owner,
      kind,
      id: trap.id,
      x,
      y: trap.y,
      z
    });
    return true;
  }

  /**
   * Returns true whenever either handle belongs to a trap. This must run
   * before ordinary collider-owner resolution in DamageSystem.
   */
  processContact(collider1: number, collider2: number, point: RAPIER.Vector): boolean {
    const trap = this.trapByCollider.get(collider1) ?? this.trapByCollider.get(collider2);
    if (!trap) return false;
    const other = trap.collider.handle === collider1 ? collider2 : collider1;
    const owner = this.damage.ownerForCollider(other);
    if (!owner) return true;

    if (trap.kind === "oil") {
      this.damage.applyOil(owner.seat, OIL_CONTACT_SEC + FIXED_DT);
      return true;
    }
    if (trap.kind === "caltrop") {
      if (!this.damage.isDriveOwner(owner)) return true;
      const dealt = this.damage.applyTrapDamage(owner, CALTROP_DAMAGE, trap.owner, point, 0.5);
      if (dealt <= 0) return true;
      trap.hitsLeft -= 1;
      trap.state = trap.hitsLeft <= 2 ? 1 : 0;
      this.events.push({
        t: "trap",
        seat: owner.seat,
        by: trap.owner,
        kind: trap.kind,
        id: trap.id,
        x: trap.x,
        y: trap.y,
        z: trap.z
      });
      if (trap.hitsLeft <= 0) this.remove(trap);
      return true;
    }
    if (trap.kind === "mine") {
      if (this.currentTime - trap.born < MINE_ARM_SEC) return true;
      this.damage.applyTrapDamage(owner, MINE_DAMAGE, trap.owner, point, 1);
      const victim = this.damage.botForSeat(owner.seat);
      if (victim?.alive) {
        const bp = victim.assembled.chassis.translation();
        const dx = bp.x - trap.x;
        const dz = bp.z - trap.z;
        const horizontal = Math.max(Math.hypot(dx, dz), Number.EPSILON);
        victim.assembled.chassis.applyImpulse(
          {
            x: dx / horizontal * MINE_IMPULSE * 0.38,
            y: MINE_IMPULSE,
            z: dz / horizontal * MINE_IMPULSE * 0.38
          },
          true
        );
      }
      this.events.push({
        t: "trap",
        seat: owner.seat,
        by: trap.owner,
        kind: trap.kind,
        id: trap.id,
        x: trap.x,
        y: trap.y,
        z: trap.z
      });
      this.remove(trap);
      return true;
    }

    this.damage.applyPin(owner.seat, trap.owner, GLUE_SEC);
    this.events.push({
      t: "trap",
      seat: owner.seat,
      by: trap.owner,
      kind: trap.kind,
      id: trap.id,
      x: trap.x,
      y: trap.y,
      z: trap.z
    });
    this.remove(trap);
    return true;
  }

  entities(): WorldEntity[] {
    return this.traps.map((trap) => ({
      id: trap.id,
      kind: trap.kind,
      owner: trap.owner,
      x: trap.x,
      y: trap.y,
      z: trap.z,
      yaw: trap.yaw,
      state: trap.state
    }));
  }

  diagnostics(): DeployDiagnostics {
    return {
      count: this.traps.length,
      version: this.version,
      anchorHandle: this.anchor.handle,
      colliderHandles: this.traps.map((trap) => trap.collider.handle)
    };
  }

  get deployVersion(): number {
    return this.version;
  }

  dispose(): void {
    this.trapByCollider.clear();
    this.traps.length = 0;
    // The enclosing simulation frees the world immediately afterwards. Rapier
    // 0.19 may reject removing a fixed body whose child colliders were removed
    // in the same JS borrow; letting World.free own the anchor avoids that
    // unsafe alias without leaking beyond the world lifetime.
  }
}
