import RAPIER from "@dimforge/rapier3d-compat";
import { DEBRIS_COLLISION_GROUPS, type WeaponRuntime } from "./assemble";
import {
  FIXED_DT,
  NET_SEC,
  PROJECTILE_CAP,
  PROJECTILE_TTL,
  TETHER_BREAK_IMPULSE,
  TETHER_MAX_FORCE,
  TETHER_MAX_LEN,
  TETHER_MIN_LEN
} from "./balance";
import type { DamageBot, DamageSystem } from "./damage";
import type { SeatIndex, SimEvent, WorldEntity } from "./types";

type ProjectileKind = "net" | "harpoon";

interface Projectile {
  readonly id: number;
  readonly kind: ProjectileKind;
  readonly owner: SeatIndex;
  readonly born: number;
  readonly maxRange: number;
  readonly originX: number;
  readonly originZ: number;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
}

interface Tether {
  readonly attacker: SeatIndex;
  readonly victim: SeatIndex;
  readonly reelSpeed: number;
}

export interface WinchResult {
  readonly distance: number;
  readonly impulse: number;
  readonly broken: boolean;
}

/**
 * A joint-free, momentum-conserving winch. Equal and opposite impulses make a
 * light attacker move farther than a heavy victim, while remaining resistible.
 */
export function applyWinchImpulse(
  attacker: RAPIER.RigidBody,
  victim: RAPIER.RigidBody,
  reelSpeed: number
): WinchResult {
  const ap = attacker.translation();
  const vp = victim.translation();
  const dx = ap.x - vp.x;
  const dy = ap.y - vp.y;
  const dz = ap.z - vp.z;
  const distance = Math.max(Math.hypot(dx, dy, dz), Number.EPSILON);
  const nx = dx / distance;
  const ny = dy / distance;
  const nz = dz / distance;
  const av = attacker.linvel();
  const vv = victim.linvel();
  const dLengthDt = (av.x - vv.x) * nx + (av.y - vv.y) * ny + (av.z - vv.z) * nz;
  const ma = Math.max(attacker.mass(), Number.EPSILON);
  const mv = Math.max(victim.mass(), Number.EPSILON);
  const reducedMass = ma * mv / (ma + mv);
  const separatingImpulse = Math.max(0, dLengthDt) * reducedMass;
  if (separatingImpulse > TETHER_BREAK_IMPULSE) {
    return { distance, impulse: 0, broken: true };
  }

  const currentClosing = -dLengthDt;
  const targetClosing =
    distance > TETHER_MIN_LEN
      ? Math.min(reelSpeed, Math.max(0, (distance - TETHER_MIN_LEN) / FIXED_DT))
      : 0;
  let deltaClosing = targetClosing - currentClosing;
  if (distance <= TETHER_MAX_LEN && targetClosing === 0 && currentClosing <= 0) {
    deltaClosing = 0;
  }
  const reelImpulse = Math.max(
    -TETHER_MAX_FORCE * FIXED_DT,
    Math.min(TETHER_MAX_FORCE * FIXED_DT, deltaClosing * reducedMass)
  );
  // A taut cable cancels separation in one mass-distributed pair. The break
  // threshold bounds this separately from the powered reel's force limit.
  const impulse =
    distance > TETHER_MAX_LEN && dLengthDt > 0
      ? separatingImpulse
      : reelImpulse;
  if (Math.abs(impulse) > Number.EPSILON) {
    const vector = { x: nx * impulse, y: ny * impulse, z: nz * impulse };
    victim.applyImpulse(vector, true);
    attacker.applyImpulse({ x: -vector.x, y: -vector.y, z: -vector.z }, true);
  }
  return { distance, impulse, broken: false };
}

export class ProjectileSystem {
  private readonly projectiles: Projectile[] = [];
  private readonly projectileByCollider = new Map<number, Projectile>();
  private readonly tetherByAttacker = new Map<SeatIndex, Tether>();
  private readonly ammo = new Map<string, number>();
  private nextId = 10_000;
  private currentTime = 0;

  constructor(
    private readonly world: RAPIER.World,
    private readonly damage: DamageSystem,
    private readonly events: SimEvent[]
  ) {}

  private ammoKey(owner: SeatIndex, weapon: WeaponRuntime): string {
    return `${owner}:${weapon.idx}`;
  }

  private removeProjectile(projectile: Projectile): void {
    this.projectileByCollider.delete(projectile.collider.handle);
    const index = this.projectiles.indexOf(projectile);
    if (index >= 0) this.projectiles.splice(index, 1);
    if (projectile.body.isValid()) this.world.removeRigidBody(projectile.body);
  }

  launch(bot: DamageBot, weapon: WeaponRuntime): boolean {
    const kind = weapon.def.effect;
    if (kind !== "net" && kind !== "harpoon") return false;
    const key = this.ammoKey(bot.assembled.seat, weapon);
    const left = this.ammo.get(key) ?? Math.max(0, weapon.def.ammo ?? 1);
    if (left <= 0) return false;
    while (this.projectiles.length >= PROJECTILE_CAP) {
      this.removeProjectile(this.projectiles[0]!);
    }

    const chassis = bot.assembled.chassis;
    const p = chassis.translation();
    const q = chassis.rotation();
    const rawX = -2 * (q.x * q.z + q.w * q.y);
    const rawZ = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const length = Math.max(Math.hypot(rawX, rawZ), Number.EPSILON);
    const dirX = rawX / length;
    const dirZ = rawZ / length;
    const x = p.x + dirX * 0.85;
    const y = p.y + 0.35;
    const z = p.z + dirZ * 0.85;
    const muzzle = Math.max(1, weapon.def.muzzle ?? 12);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setLinvel(
          chassis.linvel().x + dirX * muzzle,
          chassis.linvel().y,
          chassis.linvel().z + dirZ * muzzle
        )
        .setCcdEnabled(true)
        .setLinearDamping(0.05)
    );
    const collider = this.world.createCollider(
      (kind === "net"
        ? RAPIER.ColliderDesc.ball(0.18)
        : RAPIER.ColliderDesc.capsule(0.16, 0.07))
        .setMass(kind === "net" ? 0.5 : 0.8)
        .setCollisionGroups(DEBRIS_COLLISION_GROUPS)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(0),
      body
    );
    const projectile: Projectile = {
      id: this.nextId++,
      kind,
      owner: bot.assembled.seat,
      born: this.currentTime,
      maxRange: Math.max(0.5, weapon.def.range ?? muzzle * PROJECTILE_TTL),
      originX: x,
      originZ: z,
      body,
      collider
    };
    this.projectiles.push(projectile);
    this.projectileByCollider.set(collider.handle, projectile);
    this.ammo.set(key, left - 1);
    this.events.push({ t: "launch", seat: projectile.owner, kind, x, y, z, dirX, dirZ });
    return true;
  }

  private releaseTether(attacker: SeatIndex): void {
    const tether = this.tetherByAttacker.get(attacker);
    if (!tether) return;
    this.tetherByAttacker.delete(attacker);
    const victim = this.damage.botForSeat(tether.victim);
    if (victim?.tetheredBy === attacker) this.damage.setTether(tether.victim, null);
    this.events.push({ t: "tether", seat: tether.victim, by: attacker, on: false });
  }

  private attachTether(attacker: SeatIndex, victim: SeatIndex, reelSpeed: number): void {
    this.releaseTether(attacker);
    for (const [other, tether] of this.tetherByAttacker) {
      if (tether.victim === victim) this.releaseTether(other);
    }
    this.tetherByAttacker.set(attacker, { attacker, victim, reelSpeed });
    this.damage.setTether(victim, attacker);
    this.events.push({ t: "tether", seat: victim, by: attacker, on: true });
  }

  processContact(collider1: number, collider2: number, point: RAPIER.Vector): boolean {
    const projectile =
      this.projectileByCollider.get(collider1) ?? this.projectileByCollider.get(collider2);
    if (!projectile) return false;
    const other = projectile.collider.handle === collider1 ? collider2 : collider1;
    const owner = this.damage.ownerForCollider(other);
    if (!owner || owner.seat === projectile.owner) return true;
    this.damage.applyProjectileDamage(
      owner,
      projectile.kind === "net" ? 6 : 10,
      projectile.owner,
      point,
      projectile.kind
    );
    if (projectile.kind === "net") {
      this.damage.applyNet(owner.seat, projectile.owner, NET_SEC);
    } else {
      const weapon = this.damage
        .botForSeat(projectile.owner)
        ?.assembled.weapons.find((candidate) => candidate.def.effect === "harpoon");
      this.attachTether(projectile.owner, owner.seat, weapon?.def.reelSpeed ?? 1.3);
    }
    this.removeProjectile(projectile);
    return true;
  }

  update(elapsed: number): void {
    this.currentTime = elapsed;
    for (const projectile of [...this.projectiles]) {
      const p = projectile.body.translation();
      if (
        projectile.born + PROJECTILE_TTL <= elapsed ||
        Math.hypot(p.x - projectile.originX, p.z - projectile.originZ) > projectile.maxRange
      ) {
        this.removeProjectile(projectile);
      }
    }
    for (const [attackerSeat, tether] of [...this.tetherByAttacker]) {
      const attacker = this.damage.botForSeat(tether.attacker);
      const victim = this.damage.botForSeat(tether.victim);
      if (!attacker?.alive || !victim?.alive) {
        this.releaseTether(attackerSeat);
        continue;
      }
      const result = applyWinchImpulse(
        attacker.assembled.chassis,
        victim.assembled.chassis,
        tether.reelSpeed
      );
      if (result.broken) this.releaseTether(attackerSeat);
    }
  }

  entities(): WorldEntity[] {
    return this.projectiles.map((projectile) => {
      const p = projectile.body.translation();
      const v = projectile.body.linvel();
      return {
        id: projectile.id,
        kind: projectile.kind,
        owner: projectile.owner,
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: Math.atan2(v.x, v.z),
        state: 0
      };
    });
  }

  tetherCount(): number {
    return this.tetherByAttacker.size;
  }

  dispose(): void {
    for (const attacker of [...this.tetherByAttacker.keys()]) this.releaseTether(attacker);
    for (const projectile of [...this.projectiles]) this.removeProjectile(projectile);
  }
}
