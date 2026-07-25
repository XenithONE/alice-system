import RAPIER from "@dimforge/rapier3d-compat";
import { DEBRIS_COLLISION_GROUPS } from "./assemble";
import type { AssembledBot, ColliderOwner, RuntimePart } from "./assemble";
import {
  AGGRESSION_UNIT,
  CONTACT_COOLDOWN,
  CONTROL_RANGE,
  CONTROL_UNIT,
  DEBRIS_LIFETIME,
  FIXED_DT,
  IMMOBILE_SEC,
  IMMOBILE_SPEED,
  IMMOBILE_WEAPON_OMEGA,
  IMPACT_SCALE,
  INVERTED_DOT,
  JUDGE_AGGRESSION,
  JUDGE_CONTROL,
  JUDGE_DAMAGE,
  MATCH_SEC,
  MAX_DEBRIS,
  MAX_HIT_DAMAGE,
  MIN_HIT_IMPULSE,
  PIT_Y,
  RAM_FACTOR,
  SAW_DAMAGE,
  SPIN_DAMAGE_FLOOR
} from "./balance";
import {
  CELL,
  type BotState,
  type JudgeScore,
  type KoReason,
  type MatchResult,
  type SeatIndex,
  type SimEvent,
  type WeaponDef
} from "./types";

export interface DamageBot {
  readonly assembled: AssembledBot;
  readonly name: string;
  alive: boolean;
  chassisHp: number;
  readonly chassisHpMax: number;
  readonly detached: number[];
  immobileFor: number;
  damageDealt: number;
  damageTaken: number;
  aggression: number;
  control: number;
  contactCount: number;
  lastNearestDistance: number;
}

interface Debris {
  readonly born: number;
  readonly body: RAPIER.RigidBody;
}

interface PendingAttack {
  readonly attackerOwner: ColliderOwner;
  readonly defenderOwner: ColliderOwner;
  readonly impulse: number;
  readonly point: RAPIER.Vector;
  readonly strength: number;
}

function magnitude(vector: RAPIER.Vector): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function spinnerFactor(def: WeaponDef, omega: number): number {
  const maxOmega = def.maxOmega ?? 0;
  const ratio = maxOmega > 0 ? Math.min(1, Math.abs(omega) / maxOmega) : 0;
  return def.damageMul * (SPIN_DAMAGE_FLOOR + (1 - SPIN_DAMAGE_FLOOR) * ratio);
}

function scoreShares(
  bots: readonly DamageBot[],
  value: (bot: DamageBot) => number,
  points: number
): number[] {
  const values = bots.map((bot) => Math.max(0, value(bot)));
  const total = values.reduce((sum, current) => sum + current, 0);
  if (total <= Number.EPSILON) return values.map(() => 0);
  return values.map((current) => current / total * points);
}

export class DamageSystem {
  private readonly ownerByCollider = new Map<number, ColliderOwner>();
  private readonly botBySeat = new Map<SeatIndex, DamageBot>();
  private readonly sawColliders = new Set<number>();
  private readonly cooldowns = new Map<string, number>();
  private readonly pendingAttacks = new Map<string, PendingAttack>();
  private readonly debris: Debris[] = [];
  private readonly kos: { seat: SeatIndex; reason: KoReason; at: number }[] = [];

  constructor(
    private readonly world: RAPIER.World,
    readonly bots: readonly DamageBot[],
    private readonly events: SimEvent[]
  ) {
    for (const bot of bots) {
      this.botBySeat.set(bot.assembled.seat, bot);
      for (const [handle, owner] of bot.assembled.colliderOwners) {
        this.ownerByCollider.set(handle, owner);
      }
    }
  }

  registerSaw(handle: number): void {
    this.sawColliders.add(handle);
  }

  private partFor(owner: ColliderOwner): RuntimePart | null {
    if (owner.partIdx === null) return null;
    return (
      this.botBySeat
        .get(owner.seat)
        ?.assembled.parts.find((part) => part.idx === owner.partIdx) ?? null
    );
  }

  private weaponOmega(bot: DamageBot): number {
    const weapon = bot.assembled.weapon;
    return weapon && !weapon.detached ? magnitude(weapon.body.angvel()) : 0;
  }

  private attackFactor(owner: ColliderOwner): { factor: number; selfMul: number } {
    const part = this.partFor(owner);
    if (part?.def.category !== "weapon") return { factor: RAM_FACTOR, selfMul: 0 };
    if (part.def.motion === "spin") {
      const bot = this.botBySeat.get(owner.seat)!;
      return {
        factor: spinnerFactor(part.def, this.weaponOmega(bot)),
        selfMul: part.def.selfDamageMul
      };
    }
    return { factor: part.def.damageMul, selfMul: part.def.selfDamageMul };
  }

  private damageTarget(
    defender: DamageBot,
    owner: ColliderOwner,
    amount: number,
    by: SeatIndex,
    point: RAPIER.Vector,
    creditAttacker = true
  ): number {
    const part = this.partFor(owner);
    const armor = part?.def.armor ?? defender.assembled.chassisDef.armor;
    const damage = Math.min(MAX_HIT_DAMAGE, Math.max(0, amount - armor));
    if (damage <= 0) return 0;
    if (part && !part.detached) {
      part.hp -= damage;
      if (part.hp <= 0) this.detach(defender, part, point);
    } else if (!part) {
      defender.chassisHp -= damage;
    }
    defender.damageTaken += damage;
    const attacker = creditAttacker ? this.botBySeat.get(by) : null;
    if (attacker) attacker.damageDealt += damage;
    this.events.push({
      t: "hit",
      seat: defender.assembled.seat,
      by,
      x: point.x,
      y: point.y,
      z: point.z,
      power: damage
    });
    return damage;
  }

  private detach(bot: DamageBot, part: RuntimePart, point: RAPIER.Vector): void {
    if (part.detached) return;
    part.detached = true;
    bot.detached.push(part.idx);
    this.ownerByCollider.delete(part.collider.handle);
    bot.assembled.colliderOwners.delete(part.collider.handle);

    if (part.joint) {
      if (part.joint.isValid()) this.world.removeImpulseJoint(part.joint, true);
      this.debris.push({ born: this.currentTime, body: part.body });
    } else {
      const translation = part.collider.translation();
      const rotation = part.collider.rotation();
      if (part.collider.isValid()) this.world.removeCollider(part.collider, true);
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(translation.x, translation.y, translation.z)
          .setRotation(rotation)
          .setCcdEnabled(true)
      );
      const [baseW, baseD] = part.def.cells;
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(
          baseW * CELL / 2,
          part.def.height / 2,
          baseD * CELL / 2
        )
          .setMass(part.def.mass)
          .setCollisionGroups(DEBRIS_COLLISION_GROUPS),
        body
      );
      collider.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
      collider.setContactForceEventThreshold(MIN_HIT_IMPULSE / FIXED_DT);
      this.debris.push({ born: this.currentTime, body });
    }
    this.events.push({
      t: "detach",
      seat: bot.assembled.seat,
      partIdx: part.idx,
      x: point.x,
      y: point.y,
      z: point.z
    });
  }

  private currentTime = 0;

  processContact(
    collider1: number,
    collider2: number,
    totalForceMagnitude: number,
    point: RAPIER.Vector
  ): void {
    const impulse = totalForceMagnitude * FIXED_DT;
    const owner1 = this.ownerByCollider.get(collider1);
    const owner2 = this.ownerByCollider.get(collider2);

    if (this.sawColliders.has(collider1) && owner2) {
      this.processHazard(owner2, point);
      return;
    }
    if (this.sawColliders.has(collider2) && owner1) {
      this.processHazard(owner1, point);
      return;
    }
    if (impulse < MIN_HIT_IMPULSE || !owner1 || !owner2 || owner1.seat === owner2.seat) return;
    this.queueAttack(owner1, owner2, impulse, point);
    this.queueAttack(owner2, owner1, impulse, point);
  }

  private queueAttack(
    attackerOwner: ColliderOwner,
    defenderOwner: ColliderOwner,
    impulse: number,
    point: RAPIER.Vector
  ): void {
    const key = `${attackerOwner.seat}>${defenderOwner.seat}`;
    if ((this.cooldowns.get(key) ?? -Infinity) + CONTACT_COOLDOWN > this.currentTime) return;
    const strength = impulse * this.attackFactor(attackerOwner).factor;
    const previous = this.pendingAttacks.get(key);
    if (!previous || strength > previous.strength) {
      this.pendingAttacks.set(key, {
        attackerOwner,
        defenderOwner,
        impulse,
        point: { x: point.x, y: point.y, z: point.z },
        strength
      });
    }
  }

  private processAttack(
    attackerOwner: ColliderOwner,
    defenderOwner: ColliderOwner,
    impulse: number,
    point: RAPIER.Vector
  ): void {
    const attacker = this.botBySeat.get(attackerOwner.seat);
    const defender = this.botBySeat.get(defenderOwner.seat);
    if (!attacker?.alive || !defender?.alive) return;
    const key = `${attackerOwner.seat}>${defenderOwner.seat}`;
    if ((this.cooldowns.get(key) ?? -Infinity) + CONTACT_COOLDOWN > this.currentTime) return;
    this.cooldowns.set(key, this.currentTime);
    attacker.contactCount += 1;
    const attack = this.attackFactor(attackerOwner);
    const raw = impulse * attack.factor * IMPACT_SCALE;
    this.damageTarget(defender, defenderOwner, raw, attackerOwner.seat, point);

    const attackerPart = this.partFor(attackerOwner);
    if (attackerPart && attack.selfMul > 0 && !attackerPart.detached) {
      const selfDamage = Math.min(MAX_HIT_DAMAGE, raw * attack.selfMul);
      attackerPart.hp -= selfDamage;
      attacker.damageTaken += selfDamage;
      if (attackerPart.hp <= 0) this.detach(attacker, attackerPart, point);
    }
  }

  private processHazard(owner: ColliderOwner, point: RAPIER.Vector): void {
    const bot = this.botBySeat.get(owner.seat);
    if (!bot?.alive) return;
    const key = `saw>${owner.seat}`;
    if ((this.cooldowns.get(key) ?? -Infinity) + CONTACT_COOLDOWN > this.currentTime) return;
    this.cooldowns.set(key, this.currentTime);
    this.damageTarget(bot, owner, SAW_DAMAGE, owner.seat, point, false);
    this.events.push({ t: "hazard", seat: owner.seat, x: point.x, y: point.y, z: point.z });
  }

  private ko(bot: DamageBot, reason: KoReason): void {
    if (!bot.alive) return;
    bot.alive = false;
    bot.assembled.chassis.setEnabled(false);
    for (const part of bot.assembled.parts) {
      if (part.body.isValid()) part.body.setEnabled(false);
    }
    const record = { seat: bot.assembled.seat, reason, at: this.currentTime };
    this.kos.push(record);
    this.events.push({ t: "ko", seat: record.seat, reason });
  }

  update(elapsed: number): void {
    this.currentTime = elapsed;
    for (const attack of this.pendingAttacks.values()) {
      this.processAttack(
        attack.attackerOwner,
        attack.defenderOwner,
        attack.impulse,
        attack.point
      );
    }
    this.pendingAttacks.clear();
    for (const [key, time] of this.cooldowns) {
      if (time + CONTACT_COOLDOWN < elapsed) this.cooldowns.delete(key);
    }
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      const body = bot.assembled.chassis;
      const position = body.translation();
      const velocity = body.linvel();
      const speed = magnitude(velocity);
      const weaponOmega = this.weaponOmega(bot);
      if (speed < IMMOBILE_SPEED && weaponOmega < IMMOBILE_WEAPON_OMEGA) {
        bot.immobileFor += FIXED_DT;
      } else {
        bot.immobileFor = 0;
      }
      if (bot.chassisHp <= 0) this.ko(bot, "damage");
      else if (position.y < PIT_Y) this.ko(bot, "pit");
      else if (bot.immobileFor >= IMMOBILE_SEC) this.ko(bot, "immobile");
    }
    this.updateJudging();
    this.cleanupDebris();
  }

  private updateJudging(): void {
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      const pos = bot.assembled.chassis.translation();
      let nearest = Number.POSITIVE_INFINITY;
      let nearEnemy = false;
      for (const rival of this.bots) {
        if (!rival.alive || rival === bot) continue;
        const other = rival.assembled.chassis.translation();
        const distance = Math.hypot(other.x - pos.x, other.z - pos.z);
        nearest = Math.min(nearest, distance);
        nearEnemy ||= distance <= CONTROL_RANGE;
      }
      if (Number.isFinite(nearest) && Number.isFinite(bot.lastNearestDistance)) {
        bot.aggression += Math.max(0, bot.lastNearestDistance - nearest) / AGGRESSION_UNIT;
      }
      bot.lastNearestDistance = nearest;
      if (nearEnemy && magnitude(bot.assembled.chassis.linvel()) >= IMMOBILE_SPEED) {
        bot.control += FIXED_DT / CONTROL_UNIT;
      }
    }
  }

  private cleanupDebris(): void {
    while (
      this.debris.length > 0 &&
      (this.debris.length > MAX_DEBRIS ||
        this.debris[0]!.born + DEBRIS_LIFETIME <= this.currentTime)
    ) {
      const debris = this.debris.shift()!;
      if (debris.body.isValid()) this.world.removeRigidBody(debris.body);
    }
  }

  stateFor(bot: DamageBot): BotState {
    const body = bot.assembled.chassis;
    const p = body.translation();
    const q = body.rotation();
    const v = body.linvel();
    const upDot = 1 - 2 * (q.x * q.x + q.z * q.z);
    const weapon = bot.assembled.weapon;
    const omega = this.weaponOmega(bot);
    const weaponRotation =
      weapon && !weapon.detached && weapon.body.isValid() ? weapon.body.rotation() : null;
    const weaponAngle = weaponRotation
      ? 2 * Math.atan2(Math.hypot(weaponRotation.x, weaponRotation.y, weaponRotation.z), weaponRotation.w)
      : 0;
    return {
      seat: bot.assembled.seat,
      name: bot.name,
      alive: bot.alive,
      chassisHp: Math.max(0, bot.chassisHp),
      chassisHpMax: bot.chassisHpMax,
      pos: [p.x, p.y, p.z],
      quat: [q.x, q.y, q.z, q.w],
      vel: [v.x, v.y, v.z],
      weaponOmega: omega,
      weaponAngle,
      detached: bot.detached,
      immobileFor: bot.immobileFor,
      damageDealt: bot.damageDealt,
      damageTaken: bot.damageTaken,
      inverted: upDot < INVERTED_DOT,
      selfRightCooldown: bot.assembled.selfRightCooldown
    };
  }

  result(elapsed: number): MatchResult | null {
    const survivors = this.bots.filter((bot) => bot.alive);
    if (survivors.length <= 1) {
      return {
        winner: survivors[0]?.assembled.seat ?? null,
        reason: survivors.length === 1 ? "ko" : "draw",
        scores: this.scores(),
        durationSec: elapsed,
        kos: [...this.kos]
      };
    }
    if (elapsed < MATCH_SEC) return null;
    const scores = this.scores();
    const ranked = [...this.bots].sort((a, b) => {
      const scoreA = scores.find((score) => score.seat === a.assembled.seat)!.total;
      const scoreB = scores.find((score) => score.seat === b.assembled.seat)!.total;
      return (
        scoreB - scoreA ||
        b.damageDealt - a.damageDealt ||
        b.chassisHp - a.chassisHp ||
        a.assembled.seat - b.assembled.seat
      );
    });
    return {
      winner: ranked[0]?.assembled.seat ?? null,
      reason: "judges",
      scores,
      durationSec: elapsed,
      kos: [...this.kos]
    };
  }

  private scores(): JudgeScore[] {
    const damage = scoreShares(this.bots, (bot) => bot.damageDealt, JUDGE_DAMAGE);
    const aggression = scoreShares(
      this.bots,
      (bot) => bot.aggression + bot.contactCount,
      JUDGE_AGGRESSION
    );
    const control = scoreShares(this.bots, (bot) => bot.control, JUDGE_CONTROL);
    return this.bots.map((bot, index) => ({
      seat: bot.assembled.seat,
      damage: damage[index]!,
      aggression: aggression[index]!,
      control: control[index]!,
      total: damage[index]! + aggression[index]! + control[index]!
    }));
  }
}
