import RAPIER from "@dimforge/rapier3d-compat";
import { DEBRIS_COLLISION_GROUPS } from "./assemble";
import type {
  AssembledBot,
  ColliderOwner,
  RuntimePart,
  WeaponRuntime
} from "./assemble";
import {
  AGGRESSION_UNIT,
  BURN_DPS,
  BURN_SEC,
  CLAMP_BREAK_IMPULSE,
  CONTACT_COOLDOWN,
  CONTROL_RANGE,
  CONTROL_UNIT,
  DEBRIS_LIFETIME,
  FIXED_DT,
  FLAME_ARMOR_FACTOR,
  IMMOBILE_SEC,
  IMMOBILE_SPEED,
  IMMOBILE_WEAPON_OMEGA,
  IMPACT_SCALE,
  HEAVY_COLLISION_ANGULAR_IMPULSE,
  HEAVY_COLLISION_IMPULSE,
  HEAVY_COLLISION_SPEED_LOSS,
  INVERTED_DOT,
  JUDGE_AGGRESSION,
  JUDGE_CONTROL,
  JUDGE_DAMAGE,
  MAX_DEBRIS,
  MAX_HIT_DAMAGE,
  MIN_HIT_IMPULSE,
  PIT_Y,
  RAM_FACTOR,
  SAW_DAMAGE,
  SPEAR_PIERCE,
  SPIN_DAMAGE_FLOOR,
  SUSTAINED_TICK
} from "./balance";
import {
  CELL,
  type ArenaDef,
  type BotState,
  type JudgeScore,
  type KoReason,
  type MatchResult,
  type RoomSettings,
  type SeatIndex,
  type SimEvent,
  type WeaponDef,
  type WeaponEffect,
  type WeaponState
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
  burningFor: number;
  burningBy: SeatIndex | null;
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

function chassisForward(bot: DamageBot): readonly [number, number] {
  const q = bot.assembled.chassis.rotation();
  const x = -2 * (q.x * q.z + q.w * q.y);
  const z = -(1 - 2 * (q.x * q.x + q.y * q.y));
  const length = Math.hypot(x, z);
  return length > Number.EPSILON ? [x / length, z / length] : [0, -1];
}

function mountedDirection(
  bot: DamageBot,
  local: readonly [number, number, number]
): readonly [number, number, number] {
  const q = bot.assembled.chassis.rotation();
  const tx = 2 * (q.y * local[2] - q.z * local[1]);
  const ty = 2 * (q.z * local[0] - q.x * local[2]);
  const tz = 2 * (q.x * local[1] - q.y * local[0]);
  return [
    local[0] + q.w * tx + (q.y * tz - q.z * ty),
    local[1] + q.w * ty + (q.z * tx - q.x * tz),
    local[2] + q.w * tz + (q.x * ty - q.y * tx)
  ];
}

export class DamageSystem {
  private readonly ownerByCollider = new Map<number, ColliderOwner>();
  private readonly botBySeat = new Map<SeatIndex, DamageBot>();
  private readonly sawColliders = new Set<number>();
  private readonly cooldowns = new Map<string, number>();
  private readonly sustainedNext = new Map<string, number>();
  private readonly pendingAttacks = new Map<string, PendingAttack>();
  private readonly heavyCollisionNext = new Map<string, number>();
  private readonly debris: Debris[] = [];
  private readonly kos: { seat: SeatIndex; reason: KoReason; at: number }[] = [];
  private currentTime = 0;

  constructor(
    private readonly world: RAPIER.World,
    readonly bots: readonly DamageBot[],
    private readonly events: SimEvent[],
    private readonly arena: ArenaDef,
    private readonly settings: RoomSettings
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

  private weaponFor(owner: ColliderOwner): WeaponRuntime | null {
    const part = this.partFor(owner);
    if (part?.def.category !== "weapon") return null;
    return (
      this.botBySeat
        .get(owner.seat)
        ?.assembled.weapons.find((weapon) => weapon.idx === owner.partIdx) ?? null
    );
  }

  private weaponOmega(weapon: WeaponRuntime): number {
    return !weapon.detached && weapon.body.isValid() ? magnitude(weapon.body.angvel()) : 0;
  }

  private maximumWeaponOmega(bot: DamageBot): number {
    let omega = 0;
    for (const weapon of bot.assembled.weapons) omega = Math.max(omega, this.weaponOmega(weapon));
    return omega;
  }

  private attackFactor(owner: ColliderOwner): {
    factor: number;
    selfMul: number;
    effect: WeaponEffect;
  } {
    const weapon = this.weaponFor(owner);
    if (!weapon) return { factor: RAM_FACTOR, selfMul: 0, effect: "static" };
    if (weapon.def.effect === "spin") {
      return {
        factor: spinnerFactor(weapon.def, this.weaponOmega(weapon)),
        selfMul: weapon.def.selfDamageMul,
        effect: "spin"
      };
    }
    return {
      factor: weapon.def.damageMul,
      selfMul: weapon.def.selfDamageMul,
      effect: weapon.def.effect
    };
  }

  private damageTarget(
    defender: DamageBot,
    owner: ColliderOwner,
    amount: number,
    by: SeatIndex,
    point: RAPIER.Vector,
    effect: WeaponEffect,
    options: {
      creditAttacker?: boolean;
      armorFactor?: number;
      resist?: number;
    } = {}
  ): number {
    const part = this.partFor(owner);
    const armor = part?.def.armor ?? defender.assembled.chassisDef.armor;
    const resisted = amount * (options.resist ?? 1);
    const damage = Math.min(
      MAX_HIT_DAMAGE,
      Math.max(0, resisted - armor * (options.armorFactor ?? 1))
    );
    if (damage <= 0) return 0;
    if (part && !part.detached) {
      part.hp -= damage;
      if (part.hp <= 0) this.detach(defender, part, point);
    } else if (!part) {
      defender.chassisHp -= damage;
    }
    defender.damageTaken += damage;
    const attacker = options.creditAttacker === false ? null : this.botBySeat.get(by);
    if (attacker) attacker.damageDealt += damage;
    this.events.push({
      t: "hit",
      seat: defender.assembled.seat,
      by,
      x: point.x,
      y: point.y,
      z: point.z,
      power: damage,
      effect
    });
    return damage;
  }

  private detach(bot: DamageBot, part: RuntimePart, point: RAPIER.Vector): void {
    if (part.detached) return;
    part.detached = true;
    bot.detached.push(part.idx);
    this.ownerByCollider.delete(part.collider.handle);
    bot.assembled.colliderOwners.delete(part.collider.handle);
    if (part.trackContact?.isValid()) {
      this.ownerByCollider.delete(part.trackContact.handle);
      bot.assembled.colliderOwners.delete(part.trackContact.handle);
      this.world.removeCollider(part.trackContact, true);
    }

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
    if (!owner1 || !owner2 || owner1.seat === owner2.seat) return;
    this.applyHeavyCollision(owner1, owner2, impulse, point);

    const special1 = this.processWeaponContact(owner1, owner2, impulse, point);
    const special2 = this.processWeaponContact(owner2, owner1, impulse, point);
    if (impulse < MIN_HIT_IMPULSE) return;
    if (!special1) this.queueAttack(owner1, owner2, impulse, point);
    if (!special2) this.queueAttack(owner2, owner1, impulse, point);
  }

  private applyHeavyCollision(
    owner1: ColliderOwner,
    owner2: ColliderOwner,
    impulse: number,
    point: RAPIER.Vector
  ): void {
    if (impulse < HEAVY_COLLISION_IMPULSE) return;
    const first = this.botBySeat.get(owner1.seat);
    const second = this.botBySeat.get(owner2.seat);
    if (!first?.alive || !second?.alive) return;
    const key = owner1.seat < owner2.seat
      ? `${owner1.seat}:${owner2.seat}`
      : `${owner2.seat}:${owner1.seat}`;
    if ((this.heavyCollisionNext.get(key) ?? -Infinity) > this.currentTime) return;
    this.heavyCollisionNext.set(key, this.currentTime + CONTACT_COOLDOWN);
    const severity = Math.min(1, impulse / (HEAVY_COLLISION_IMPULSE * 4));
    const retain = 1 - HEAVY_COLLISION_SPEED_LOSS * (0.5 + severity);
    for (const bot of [first, second]) {
      const body = bot.assembled.chassis;
      const velocity = body.linvel();
      body.setLinvel(
        { x: velocity.x * retain, y: velocity.y * retain, z: velocity.z * retain },
        true
      );
      const center = body.translation();
      const sign = bot === first ? 1 : -1;
      body.applyTorqueImpulse(
        {
          x: (point.z - center.z) * impulse * HEAVY_COLLISION_ANGULAR_IMPULSE * sign,
          y: ((point.x - center.x) - (point.z - center.z)) *
            impulse * HEAVY_COLLISION_ANGULAR_IMPULSE * sign,
          z: -(point.x - center.x) * impulse * HEAVY_COLLISION_ANGULAR_IMPULSE * sign
        },
        true
      );
    }
  }

  private processWeaponContact(
    attackerOwner: ColliderOwner,
    defenderOwner: ColliderOwner,
    impulse: number,
    point: RAPIER.Vector
  ): boolean {
    const weapon = this.weaponFor(attackerOwner);
    const attacker = this.botBySeat.get(attackerOwner.seat);
    const defender = this.botBySeat.get(defenderOwner.seat);
    if (!weapon || !attacker?.alive || !defender?.alive) return false;

    if (weapon.def.effect === "grind") {
      if (weapon.active) {
        const key = `grind:${weapon.idx}:${attackerOwner.seat}>${defenderOwner.seat}`;
        if ((this.sustainedNext.get(key) ?? -Infinity) <= this.currentTime) {
          this.sustainedNext.set(key, this.currentTime + SUSTAINED_TICK);
          this.damageTarget(
            defender,
            defenderOwner,
            (weapon.def.dps ?? 0) * SUSTAINED_TICK,
            attackerOwner.seat,
            point,
            "grind",
            { armorFactor: SUSTAINED_TICK }
          );
        }
      }
      return true;
    }

    if (weapon.def.effect === "clamp") {
      if (weapon.active && weapon.clamping === null) {
        weapon.clamping = defenderOwner.seat;
        weapon.clampLeft = weapon.def.holdSec ?? 0;
        this.events.push({
          t: "clamp",
          seat: attackerOwner.seat,
          victim: defenderOwner.seat
        });
      } else if (weapon.clamping === defenderOwner.seat && impulse > CLAMP_BREAK_IMPULSE) {
        this.releaseClamp(weapon);
      }
      return true;
    }

    if (weapon.def.effect === "impulse") {
      if (!weapon.active || weapon.impulseVictims.has(defenderOwner.seat)) return true;
      weapon.impulseVictims.add(defenderOwner.seat);
      const amount = weapon.def.impulse ?? 0;
      const [forwardX, forwardY, forwardZ] = mountedDirection(attacker, weapon.mountDir);
      const flipper = weapon.def.launch === "flip";
      const vertical =
        (flipper ? amount * 0.85 : weapon.spear ? amount * 0.08 : amount * 0.35) +
        forwardY * amount * 0.5;
      const horizontal = flipper ? amount * 0.45 : amount * 0.9;
      defender.assembled.chassis.applyImpulse(
        { x: forwardX * horizontal, y: vertical, z: forwardZ * horizontal },
        true
      );
      this.damageTarget(
        defender,
        defenderOwner,
        amount * weapon.def.damageMul * IMPACT_SCALE * (weapon.spear ? SPEAR_PIERCE : 1),
        attackerOwner.seat,
        point,
        "impulse"
      );
      return true;
    }

    return weapon.def.effect === "flame";
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

  private processAttack(attack: PendingAttack): void {
    const { attackerOwner, defenderOwner, impulse, point } = attack;
    const attacker = this.botBySeat.get(attackerOwner.seat);
    const defender = this.botBySeat.get(defenderOwner.seat);
    if (!attacker?.alive || !defender?.alive) return;
    const key = `${attackerOwner.seat}>${defenderOwner.seat}`;
    if ((this.cooldowns.get(key) ?? -Infinity) + CONTACT_COOLDOWN > this.currentTime) return;
    this.cooldowns.set(key, this.currentTime);
    attacker.contactCount += 1;
    const factor = this.attackFactor(attackerOwner);
    const raw = impulse * factor.factor * IMPACT_SCALE;
    this.damageTarget(defender, defenderOwner, raw, attackerOwner.seat, point, factor.effect, {
      resist: factor.effect === "spin" ? defender.assembled.spinnerResist : 1
    });

    const attackerPart = this.partFor(attackerOwner);
    if (attackerPart && factor.selfMul > 0 && !attackerPart.detached) {
      const selfDamage = Math.min(MAX_HIT_DAMAGE, raw * factor.selfMul);
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
    this.damageTarget(bot, owner, SAW_DAMAGE, owner.seat, point, "static", {
      creditAttacker: false
    });
    this.events.push({ t: "hazard", seat: owner.seat, x: point.x, y: point.y, z: point.z });
  }

  private releaseClamp(weapon: WeaponRuntime): void {
    weapon.clamping = null;
    weapon.clampLeft = 0;
    weapon.active = false;
    if (weapon.joint?.isValid()) {
      const stroke = Math.max(weapon.def.strokeSec ?? 0.25, FIXED_DT);
      weapon.joint.configureMotorPosition(
        0,
        weapon.def.mass * 4 / (stroke * stroke),
        4 * weapon.def.mass / stroke
      );
    }
  }

  private updateClamps(): void {
    for (const attacker of this.bots) {
      if (!attacker.alive) continue;
      for (const weapon of attacker.assembled.weapons) {
        if (weapon.clamping === null) continue;
        const victim = this.botBySeat.get(weapon.clamping);
        weapon.clampLeft = Math.max(0, weapon.clampLeft - FIXED_DT);
        if (!victim?.alive || weapon.detached || weapon.clampLeft === 0) {
          this.releaseClamp(weapon);
          continue;
        }
        const av = attacker.assembled.chassis.linvel();
        const vv = victim.assembled.chassis.linvel();
        const relativeImpulse =
          Math.hypot(vv.x - av.x, vv.y - av.y, vv.z - av.z) *
          Math.min(attacker.assembled.chassis.mass(), victim.assembled.chassis.mass());
        if (relativeImpulse > CLAMP_BREAK_IMPULSE) {
          this.releaseClamp(weapon);
          continue;
        }
        const ap = attacker.assembled.chassis.translation();
        const vp = victim.assembled.chassis.translation();
        victim.assembled.chassis.setLinvel(
          {
            x: av.x + (ap.x - vp.x) * 3,
            y: av.y + (ap.y - vp.y) * 3,
            z: av.z + (ap.z - vp.z) * 3
          },
          true
        );
        const key = `clamp:${weapon.idx}:${attacker.assembled.seat}>${victim.assembled.seat}`;
        if ((this.sustainedNext.get(key) ?? -Infinity) <= this.currentTime) {
          this.sustainedNext.set(key, this.currentTime + SUSTAINED_TICK);
          this.damageTarget(
            victim,
            { seat: victim.assembled.seat, partIdx: null },
            (weapon.def.dps ?? 0) * SUSTAINED_TICK,
            attacker.assembled.seat,
            vp,
            "clamp",
            { armorFactor: SUSTAINED_TICK }
          );
        }
      }
    }
  }

  private ignite(
    victim: DamageBot,
    by: SeatIndex,
    point: RAPIER.Vector,
    directDamage: number
  ): void {
    this.damageTarget(
      victim,
      { seat: victim.assembled.seat, partIdx: null },
      directDamage,
      by,
      point,
      "flame",
      {
        armorFactor: FLAME_ARMOR_FACTOR * FIXED_DT,
        resist: victim.assembled.flameResist
      }
    );
    victim.burningFor = BURN_SEC;
    victim.burningBy = by;
  }

  private updateFlames(): void {
    for (const attacker of this.bots) {
      if (!attacker.alive) continue;
      const ap = attacker.assembled.chassis.translation();
      for (const weapon of attacker.assembled.weapons) {
        if (!weapon.active || weapon.detached || weapon.def.effect !== "flame") continue;
        const [forwardX, , forwardZ] = mountedDirection(attacker, weapon.mountDir);
        const horizontalLength = Math.hypot(forwardX, forwardZ);
        const dirX = horizontalLength > Number.EPSILON ? forwardX / horizontalLength : 0;
        const dirZ = horizontalLength > Number.EPSILON ? forwardZ / horizontalLength : -1;
        const range = weapon.def.coneRange ?? weapon.def.reach;
        const cosine = Math.cos(weapon.def.coneAngle ?? 0);
        this.events.push({
          t: "flame",
          seat: attacker.assembled.seat,
          x: ap.x,
          y: ap.y,
          z: ap.z,
          dirX,
          dirZ
        });
        for (const victim of this.bots) {
          if (!victim.alive || victim === attacker) continue;
          const vp = victim.assembled.chassis.translation();
          const dx = vp.x - ap.x;
          const dz = vp.z - ap.z;
          const distance = Math.hypot(dx, dz);
          const dot =
            distance > Number.EPSILON ? (dx * dirX + dz * dirZ) / distance : 1;
          if (distance <= range && dot >= cosine) {
            this.ignite(victim, attacker.assembled.seat, vp, (weapon.def.dps ?? 0) * FIXED_DT);
          }
        }
      }
    }
  }

  private updateBurning(): void {
    for (const bot of this.bots) {
      if (!bot.alive || bot.burningFor <= 0) continue;
      bot.burningFor = Math.max(0, bot.burningFor - FIXED_DT);
      const point = bot.assembled.chassis.translation();
      this.damageTarget(
        bot,
        { seat: bot.assembled.seat, partIdx: null },
        BURN_DPS * FIXED_DT,
        bot.burningBy ?? bot.assembled.seat,
        point,
        "flame",
        {
          creditAttacker: bot.burningBy !== null,
          armorFactor: FLAME_ARMOR_FACTOR * FIXED_DT,
          resist: bot.assembled.flameResist
        }
      );
      if (bot.chassisHp <= 0) this.ko(bot, "fire");
      if (bot.burningFor === 0) bot.burningBy = null;
    }
  }

  private updateFlameJets(): void {
    const cycle = this.currentTime % 5;
    if (cycle >= 1.25) return;
    for (const jet of this.arena.flameJets) {
      for (const bot of this.bots) {
        if (!bot.alive) continue;
        const p = bot.assembled.chassis.translation();
        if (Math.hypot(p.x - jet.x, p.z - jet.z) > 0.9) continue;
        this.ignite(bot, bot.assembled.seat, p, BURN_DPS * 1.5 * FIXED_DT);
        this.events.push({ t: "hazard", seat: bot.assembled.seat, x: jet.x, y: 0, z: jet.z });
      }
    }
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
    for (const attack of this.pendingAttacks.values()) this.processAttack(attack);
    this.pendingAttacks.clear();
    for (const [key, time] of this.cooldowns) {
      if (time + CONTACT_COOLDOWN < elapsed) this.cooldowns.delete(key);
    }
    this.updateClamps();
    this.updateFlames();
    this.updateFlameJets();
    this.updateBurning();
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      const body = bot.assembled.chassis;
      const position = body.translation();
      const speed = magnitude(body.linvel());
      if (speed < IMMOBILE_SPEED && this.maximumWeaponOmega(bot) < IMMOBILE_WEAPON_OMEGA) {
        bot.immobileFor += FIXED_DT;
      } else {
        bot.immobileFor = 0;
      }
      if (bot.chassisHp <= 0) this.ko(bot, bot.burningFor > 0 ? "fire" : "damage");
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
    const weapons: WeaponState[] = bot.assembled.weapons.map((weapon) => {
      const rotation =
        !weapon.detached && weapon.body.isValid() ? weapon.body.rotation() : qIdentity;
      const angle =
        2 * Math.atan2(
          Math.hypot(rotation.x, rotation.y, rotation.z),
          rotation.w
        );
      const cooldown = Math.max(weapon.def.cooldown ?? 0, Number.EPSILON);
      const capacity = weapon.def.fuel ?? 0;
      return {
        partIdx: weapon.idx,
        slot: weapon.def.slot,
        active: weapon.active,
        omega:
          weapon.def.effect === "spin" || weapon.def.effect === "grind"
            ? this.weaponOmega(weapon)
            : 0,
        angle,
        charge:
          weapon.def.action === "triggered"
            ? Math.max(0, Math.min(1, 1 - weapon.cooldownLeft / cooldown))
            : 1,
        fuel: capacity > 0 ? Math.max(0, Math.min(1, weapon.fuelLeft / capacity)) : 1,
        clamping: weapon.clamping
      };
    });
    return {
      seat: bot.assembled.seat,
      name: bot.name,
      alive: bot.alive,
      chassisHp: Math.max(0, bot.chassisHp),
      chassisHpMax: bot.chassisHpMax,
      pos: [p.x, p.y, p.z],
      quat: [q.x, q.y, q.z, q.w],
      vel: [v.x, v.y, v.z],
      weapons,
      detached: bot.detached,
      partCondition: bot.assembled.spec.parts.map((_, index) => {
        const part = bot.assembled.parts.find((candidate) => candidate.idx === index);
        if (!part || part.detached) return 0;
        return Math.max(0, Math.min(1, part.hp / Math.max(part.def.hp, Number.EPSILON)));
      }),
      immobileFor: bot.immobileFor,
      damageDealt: bot.damageDealt,
      damageTaken: bot.damageTaken,
      inverted: upDot < INVERTED_DOT,
      burningFor: bot.burningFor,
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
    if (elapsed < this.settings.matchSec) return null;
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

const qIdentity = { x: 0, y: 0, z: 0, w: 1 };
