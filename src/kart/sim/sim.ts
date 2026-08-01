/**
 * NITRO CROWN — the race simulation.
 *
 * Authoritative and deterministic: given the same config and the same input
 * stream it produces the same ticks, which is what lets one machine host and
 * everyone else render snapshots of it. No `Math.random`, no clock reads, no
 * DOM. Everything it needs comes from `RaceConfig` and `setInput`.
 */

import { mulberry32 } from "../../lib/seed";
import {
  AIR_CONTROL,
  BANANA_LIFETIME_SEC,
  BANANA_RADIUS,
  BASE_TOP_SPEED,
  BASE_TURN_RATE,
  BOLT_SHRINK_SEC,
  BOLT_TOP_SPEED_MULT,
  BOMB_BLAST_RADIUS,
  BOMB_FUSE_SEC,
  BOMB_SPEED,
  BOOST_ACCEL,
  BOOST_TOP_SPEED_MULT,
  BRAKE_DECEL,
  BUMP_IMPULSE,
  BUMP_SPEED_TRANSFER,
  CATCHUP_MAX_BONUS,
  COUNTDOWN_SEC,
  DEFAULT_LAPS,
  DRAG_QUADRATIC,
  DRIFT_MIN_SPEED,
  DRIFT_SLIP_ANGLE,
  DRIFT_HOP_SEC,
  DRIFT_LATCH_STEER,
  DRIFT_STEER_INNER,
  DRIFT_STEER_NEUTRAL,
  DRIFT_STEER_OUTER,
  DRIFT_TURN_RATE,
  ENGINE_ACCEL,
  FINISH_GRACE_SEC,
  GRAVITY,
  HIT_GRACE_SEC,
  ITEM_BOX_RESPAWN_SEC,
  ITEM_ROULETTE_SEC,
  ITEM_USE_COOLDOWN_SEC,
  MAX_CATCHUP_STEPS,
  MAX_RACE_SEC,
  MINI_TURBO_BOOST,
  MINI_TURBO_TIERS,
  MUSHROOM_BOOST_SEC,
  OFFROAD_FRICTION,
  OFFROAD_SPEED_MULT,
  PAD_BOOST_SEC,
  RED_SHELL_LOCK_RANGE,
  RED_SHELL_TURN_RATE,
  RESPAWN_SPEED,
  REVERSE_TOP_SPEED,
  ROCKET_BURN_STALL_SEC,
  ROCKET_START_BOOST_SEC,
  ROCKET_START_BURN_SEC,
  ROCKET_START_WINDOW_SEC,
  ROLLING_RESISTANCE,
  SHELL_LIFETIME_SEC,
  SHELL_RADIUS,
  SHELL_SPEED,
  SHOULDER_WIDTH,
  SIM_STEP_SEC,
  SPINOUT_SEC,
  SPINOUT_SPEED_KEEP,
  SPINOUT_SPIN_RATE,
  SQUASH_SEC,
  SQUASH_SPEED_KEEP,
  STAR_ACCEL,
  STAR_SEC,
  STAR_TOP_SPEED_MULT,
  STEER_LERP,
  STUCK_PROGRESS_EPSILON,
  STUCK_RESPAWN_SEC,
  TURN_SPEED_REFERENCE,
  WALL_PUSH,
  WALL_SPEED_KEEP,
  KART_RADIUS,
  WEATHER_GRIP,
  SPEED_CLASSES,
  DRIFT_HOP_VY,
  DRAFT_RANGE,
  DRAFT_HALF_ANGLE,
  DRAFT_CHARGE_SEC,
  DRAFT_BOOST_SEC,
  DRAFT_TOP_SPEED_MULT,
  TRICK_MIN_AIR_SEC,
  TRICK_BOOST_SEC,
  RAMP_LAUNCH_VY,
  TRIPLE_MUSHROOM_CHARGES,
  EMP_RADIUS,
} from "./balance";
import {
  abilityById,
  type AbilityCondition,
  type AbilityEffect,
} from "../content/abilities";
import { characterById } from "../content/characters";
import { machineById } from "../content/machines";
import { combineTuning, type KartTuning } from "../content/tuning";
import { cpuInput, type CpuWorld } from "./ai";
import { itemCharges, rollItem } from "./items";
import type { KartRuntime } from "./runtime";
import {
  angleDelta,
  arcDelta,
  buildTrack,
  forwardOf,
  gridSlot,
  headingOf,
  maybeMirror,
  pointAt,
  querySurface,
  rightOf,
  sampleAt,
  surfaceHeight,
  type Track,
} from "./track";
import { trackSpecById } from "./tracks";
import {
  ITEM_SLOT_COUNT,
  MAX_RACERS,
  NEUTRAL_INPUT,
  type HazardKind,
  type HazardState,
  type HitCause,
  type KartInput,
  type KartSim,
  type ProjectileState,
  type RaceConfig,
  type RaceEvent,
  type RacePhase,
  type RaceResult,
  type RaceStanding,
  type RaceState,
  type RacerId,
  type RacerState,
} from "./types";

interface Projectile {
  id: number;
  kind: "green" | "red" | "bomb";
  owner: RacerId;
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  life: number;
  age: number;
  bounces: number;
  target: RacerId | null;
  hint: number;
}

interface Hazard {
  id: number;
  kind: HazardKind;
  owner: RacerId;
  x: number;
  y: number;
  z: number;
  life: number;
  age: number;
}

const LIVERY_COUNT = 16;
/** Beat between the last person crossing the line and the results screen. */
const HUMAN_FINISH_TAIL_SEC = 3;

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

function wrapAngle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function driftTierFor(charge: number): number {
  let tier = 0;
  for (let i = 0; i < MINI_TURBO_TIERS.length; i += 1) {
    if (charge >= MINI_TURBO_TIERS[i]!) tier = i + 1;
  }
  return tier;
}

export function createKartSim(config: RaceConfig): KartSim {
  const track: Track =
    config.track ??
    buildTrack(maybeMirror(trackSpecById(config.trackId), config.mirror === true));
  const laps = Math.max(1, Math.min(9, Math.round(config.laps || DEFAULT_LAPS)));
  const itemsOn = config.items !== false;
  const random = mulberry32(config.seed >>> 0);
  const tuning =
    config.classTuning ??
    SPEED_CLASSES[Math.max(0, Math.min(SPEED_CLASSES.length - 1, config.speedClass ?? 1))]!;
  const weather = WEATHER_GRIP[config.weather ?? "clear"];

  const specs = config.racers.slice(0, MAX_RACERS);
  if (specs.length === 0) throw new Error("A race needs at least one racer");

  const karts: KartRuntime[] = specs.map((spec, index) => {
    const slot = gridSlot(track, index);
    const startS = -(6 + Math.floor(index / 2) * 5.5);
    const query = querySurface(track, slot.x, slot.z, -1, SHOULDER_WIDTH);
    /*
     * Folded once, here, and held read-only for the race. Multiplying these
     * every tick would work and would also mean the evaluation order of a
     * chain of floats is decided by whoever last edited a line in driveKart —
     * and a last-bit difference is a different race after ninety seconds.
     */
    const character = characterById(spec.characterId);
    const machine = machineById(spec.machineId);
    return {
      id: index,
      name: spec.name,
      cpu: spec.cpu,
      cpuLevel: clamp(Math.round(spec.cpuLevel ?? 2), 1, 3),
      livery: (spec.livery ?? index) % LIVERY_COUNT,
      characterId: character.id,
      machineId: machine.id,
      tuning: combineTuning(tuning, character, machine),
      skillCooldown: 0,
      gimmickCooldown: 0,
      skillHeld: false,
      gimmickHeld: false,
      mulSpeedTimer: 0,
      mulSpeedValue: 1,
      mulTurnTimer: 0,
      mulTurnValue: 1,
      mulAccelTimer: 0,
      mulAccelValue: 1,
      mulOffroadTimer: 0,
      mulOffroadValue: 1,
      mulAirTimer: 0,
      mulAirValue: 1,
      magnetTimer: 0,
      brakeSlideTimer: 0,
      x: slot.x,
      y: slot.y,
      z: slot.z,
      vy: 0,
      yaw: slot.yaw,
      slip: 0,
      speed: 0,
      airborne: false,
      offRoad: false,
      steer: 0,
      drifting: false,
      driftDir: 0,
      driftCharge: 0,
      driftTier: 0,
      boostTimer: 0,
      boostSource: null,
      spinTimer: 0,
      squashTimer: 0,
      stallTimer: 0,
      starTimer: 0,
      boltTimer: 0,
      graceTimer: 0,
      items:
        config.startTriple === true && !spec.cpu
          ? [{ kind: "triple", charges: TRIPLE_MUSHROOM_CHARGES }, null, null]
          : [null, null, null],
      rouletteTimer: 0,
      itemCooldown: 0,
      itemHeld: [false, false, false],
      lastS: query.s,
      lastLateral: query.lateral,
      lastHalf: query.half,
      distance: startS,
      sampleHint: query.index,
      lap: 1,
      place: index + 1,
      wrongWay: false,
      finished: false,
      finishTime: null,
      lapStartTime: 0,
      bestLap: null,
      lastLap: null,
      stuckTimer: 0,
      stuckMark: startS,
      wallCooldown: 0,
      hopTimer: 0,
      driftHeld: false,
      driftArmed: false,
      airTime: 0,
      trickQueued: false,
      rampCooldown: 0,
      draftCharge: 0,
      drafting: false,
      countdownHold: 0,
      input: NEUTRAL_INPUT,
      cpuItemTimer: 1.2,
      cpuDriftHold: 0,
      cpuDriftIntent: 0,
      // Seeded here so the rocket-start jitter differs per driver on the very
      // first tick, before the wander timer has ever run.
      cpuWander: random() * 2 - 1,
      cpuWanderTimer: 0,
    } satisfies KartRuntime;
  });

  const boxCooldowns = track.itemBoxes.map(() => 0);
  const projectiles: Projectile[] = [];
  const hazards: Hazard[] = [];
  let entityId = 1;

  let tick = 0;
  let elapsed = 0;
  let phase: RacePhase = "countdown";
  let countdown = COUNTDOWN_SEC;
  let announced = 4;
  let finishGrace: number | null = null;
  let finishedCount = 0;
  let events: RaceEvent[] = [];
  let accumulator = 0;
  let result: RaceResult | null = null;

  function emit(event: RaceEvent): void {
    events.push(event);
  }

  /** `phase` is closed over and mutated; a direct comparison narrows wrongly. */
  function isFinished(): boolean {
    return phase === "finished";
  }

  function boost(kart: KartRuntime, seconds: number, source: KartRuntime["boostSource"], tier = 0): void {
    if (source === null) return;
    kart.boostTimer = Math.max(kart.boostTimer, seconds);
    kart.boostSource = source;
    emit({ k: "boost", racer: kart.id, source, tier });
  }

  function applyHit(
    victim: KartRuntime,
    cause: HitCause,
    by: RacerId | null,
    heavy: boolean,
  ): boolean {
    if (victim.finished) return false;
    if (victim.starTimer > 0) return false;
    if (victim.graceTimer > 0) return false;
    if (heavy) victim.squashTimer = SQUASH_SEC;
    else victim.spinTimer = SPINOUT_SEC;
    victim.speed *= heavy ? 0.18 : 0.42;
    victim.drifting = false;
    victim.driftCharge = 0;
    victim.driftTier = 0;
    victim.driftDir = 0;
    victim.boostTimer = 0;
    victim.boostSource = null;
    if (heavy) {
      /*
       * One slot, not the whole inventory. A bolt used to cost its victims a
       * single item because a single item was all anyone could carry; emptying
       * three slots would triple the reach of one pickup without anyone having
       * decided that it should.
       */
      const first = victim.items.findIndex((slot) => slot !== null);
      if (first >= 0) victim.items[first] = null;
      victim.rouletteTimer = 0;
    }
    emit({
      k: "hit",
      racer: victim.id,
      by,
      cause,
      x: victim.x,
      y: victim.y,
      z: victim.z,
    });
    return true;
  }

  function detonate(x: number, y: number, z: number, owner: RacerId | null): void {
    emit({ k: "blast", x, y, z });
    for (const kart of karts) {
      const distance = Math.hypot(kart.x - x, kart.z - z);
      if (distance > BOMB_BLAST_RADIUS) continue;
      applyHit(kart, "bomb", owner, true);
    }
  }

  function racerAhead(kart: KartRuntime): KartRuntime | null {
    let best: KartRuntime | null = null;
    let bestGap = Infinity;
    for (const other of karts) {
      if (other.id === kart.id || other.finished) continue;
      const gap = other.distance - kart.distance;
      if (gap <= 0) continue;
      if (gap < bestGap) {
        bestGap = gap;
        best = other;
      }
    }
    return best;
  }

  /**
   * The kit as this tick sees it. `airControlScale` has no home in the catalog
   * — only an ability can bend it — so it lives here rather than in KartTuning.
   */
  interface EffectiveTuning extends KartTuning {
    readonly airControlScale: number;
  }

  function effectiveTuning(kart: KartRuntime): EffectiveTuning {
    const base = kart.tuning;
    return {
      ...base,
      speedScale:
        base.speedScale * (kart.mulSpeedTimer > 0 ? kart.mulSpeedValue : 1),
      turnScale:
        base.turnScale * (kart.mulTurnTimer > 0 ? kart.mulTurnValue : 1),
      accelScale:
        base.accelScale * (kart.mulAccelTimer > 0 ? kart.mulAccelValue : 1),
      offroadScale:
        base.offroadScale *
        (kart.mulOffroadTimer > 0 ? kart.mulOffroadValue : 1),
      airControlScale: kart.mulAirTimer > 0 ? kart.mulAirValue : 1,
    };
  }

  /** Is the kart in the state this ability asks for? */
  function conditionMet(kart: KartRuntime, condition: AbilityCondition): boolean {
    switch (condition.kind) {
      case "always":
        return true;
      case "grounded":
        return !kart.airborne;
      case "airborne":
        return kart.airborne;
      case "drifting":
        return kart.drifting;
      case "offroad":
        return kart.offRoad;
      case "moving-above":
        return kart.speed > condition.speed;
      case "place-behind":
        return kart.place > condition.place;
      case "recently-hit":
        return (
          kart.spinTimer > 0 ||
          kart.squashTimer > 0 ||
          kart.graceTimer > HIT_GRACE_SEC - condition.withinSec
        );
    }
  }

  /**
   * The interpreter. Abilities are data (see content/abilities.ts) and this is
   * the only thing that turns them into changes — a closed switch, so a new
   * effect kind is a compile error here rather than a silent no-op.
   */
  function applyEffect(kart: KartRuntime, effect: AbilityEffect): void {
    switch (effect.kind) {
      case "boost":
        boost(kart, effect.seconds, effect.source);
        break;
      case "invuln":
        kart.graceTimer = Math.max(kart.graceTimer, effect.seconds);
        break;
      case "star":
        kart.starTimer = Math.max(kart.starTimer, effect.seconds);
        emit({ k: "boost", racer: kart.id, source: "star", tier: 0 });
        break;
      case "hazard": {
        const [hfx, hfz] = forwardOf(kart.yaw);
        const x = kart.x + hfx * effect.offset;
        const z = kart.z + hfz * effect.offset;
        const query = querySurface(track, x, z, kart.sampleHint, SHOULDER_WIDTH);
        hazards.push({
          id: entityId++,
          kind: effect.hazard,
          owner: kart.id,
          x,
          y: query.height,
          z,
          life: BANANA_LIFETIME_SEC,
          age: 0,
        });
        break;
      }
      case "hop":
        if (!kart.airborne) {
          kart.airborne = true;
          kart.airTime = 0;
          kart.vy = effect.vy;
        }
        break;
      case "cleanse":
        kart.spinTimer = 0;
        kart.squashTimer = 0;
        kart.stallTimer = 0;
        kart.boltTimer = 0;
        break;
      case "tuning-mul":
        switch (effect.stat) {
          case "speed":
            kart.mulSpeedTimer = effect.seconds;
            kart.mulSpeedValue = effect.multiplier;
            break;
          case "turn":
            kart.mulTurnTimer = effect.seconds;
            kart.mulTurnValue = effect.multiplier;
            break;
          case "accel":
            kart.mulAccelTimer = effect.seconds;
            kart.mulAccelValue = effect.multiplier;
            break;
          case "offroad":
            kart.mulOffroadTimer = effect.seconds;
            kart.mulOffroadValue = effect.multiplier;
            break;
        }
        break;
      case "air-control":
        kart.mulAirTimer = effect.seconds;
        kart.mulAirValue = effect.multiplier;
        break;
      case "magnet":
        kart.magnetTimer = effect.seconds;
        break;
      case "brake-slide":
        kart.brakeSlideTimer = effect.seconds;
        break;
    }
  }

  function tryAbility(kart: KartRuntime, which: "skill" | "gimmick"): void {
    if (kart.finished || phase !== "race") return;
    const cooldown = which === "skill" ? kart.skillCooldown : kart.gimmickCooldown;
    if (cooldown > 0) return;
    const source =
      which === "skill"
        ? characterById(kart.characterId).skillId
        : machineById(kart.machineId).gimmickId;
    const ability = abilityById(source);
    if (!ability || !conditionMet(kart, ability.condition)) return;
    for (const effect of ability.effects) applyEffect(kart, effect);
    if (which === "skill") kart.skillCooldown = ability.cooldownSec;
    else kart.gimmickCooldown = ability.cooldownSec;
    emit({ k: which, racer: kart.id, ability: ability.id });
  }

  function useItem(kart: KartRuntime, slot: number): void {
    const held = kart.items[slot];
    if (!held) return;
    const item = held.kind;
    const [fx, fz] = forwardOf(kart.yaw);
    emit({ k: "use", racer: kart.id, item, slot });
    switch (item) {
      case "mushroom":
      case "triple":
        boost(kart, MUSHROOM_BOOST_SEC, "mushroom");
        break;
      case "banana": {
        const x = kart.x - fx * 3.2;
        const z = kart.z - fz * 3.2;
        const query = querySurface(track, x, z, kart.sampleHint, SHOULDER_WIDTH);
        hazards.push({
          id: entityId++,
          kind: "banana",
          owner: kart.id,
          x,
          y: query.height,
          z,
          life: BANANA_LIFETIME_SEC,
          age: 0,
        });
        break;
      }
      case "green":
      case "red":
      case "bomb": {
        const forward = item === "green" || item === "red";
        const offset = forward ? 3.4 : 3.4;
        const x = kart.x + fx * offset;
        const z = kart.z + fz * offset;
        const query = querySurface(track, x, z, kart.sampleHint, SHOULDER_WIDTH);
        const target =
          item === "red" ? (racerAhead(kart)?.id ?? null) : null;
        projectiles.push({
          id: entityId++,
          kind: item,
          owner: kart.id,
          x,
          y: query.height + 0.6,
          z,
          yaw: kart.yaw,
          speed: item === "bomb" ? BOMB_SPEED : SHELL_SPEED,
          life: item === "bomb" ? BOMB_FUSE_SEC : SHELL_LIFETIME_SEC,
          age: 0,
          bounces: 0,
          target,
          hint: query.index,
        });
        break;
      }
      case "star":
        kart.starTimer = STAR_SEC;
        emit({ k: "boost", racer: kart.id, source: "star", tier: 0 });
        break;
      case "bolt": {
        for (const other of karts) {
          if (other.id === kart.id) continue;
          if (other.distance <= kart.distance) continue;
          if (applyHit(other, "bolt", kart.id, true)) {
            other.boltTimer = BOLT_SHRINK_SEC;
          }
        }
        break;
      }
      /*
       * Turbine: cash a drift in early. It pays the top tier, so it is only
       * worth anything to someone who was already committed to a corner —
       * used on a straight it does nothing at all, which is the point.
       */
      case "turbine": {
        if (kart.drifting && kart.speed > DRIFT_MIN_SPEED) {
          const top = MINI_TURBO_BOOST[MINI_TURBO_BOOST.length - 1] ?? 0;
          boost(kart, top, "mini", MINI_TURBO_TIERS.length);
          kart.drifting = false;
          kart.driftDir = 0;
          kart.driftCharge = 0;
          kart.driftTier = 0;
        }
        break;
      }
      /** Slipcall: the tow you would have had to earn by sitting in a wake. */
      case "slipcall":
        kart.drafting = true;
        kart.draftCharge = DRAFT_CHARGE_SEC;
        boost(kart, DRAFT_BOOST_SEC, "draft");
        break;
      /** Mine: a banana that answers with the weight of a bomb. */
      case "mine": {
        const x = kart.x - fx * 3.2;
        const z = kart.z - fz * 3.2;
        const query = querySurface(track, x, z, kart.sampleHint, SHOULDER_WIDTH);
        hazards.push({
          id: entityId++,
          kind: "mine",
          owner: kart.id,
          x,
          y: query.height,
          z,
          life: BANANA_LIFETIME_SEC,
          age: 0,
        });
        break;
      }
      /*
       * EMP: strips boost and drift charge from everyone close by, in both
       * directions. The bolt reaches the whole field and is therefore a
       * lottery win; this reaches a few lengths and is therefore a decision.
       */
      case "emp": {
        for (const other of karts) {
          if (other.id === kart.id) continue;
          const distance = Math.hypot(other.x - kart.x, other.z - kart.z);
          if (distance > EMP_RADIUS) continue;
          other.boostTimer = 0;
          other.boostSource = null;
          other.driftCharge = 0;
          other.driftTier = 0;
          applyHit(other, "bolt", kart.id, false);
        }
        break;
      }
    }
    const remaining = held.charges - 1;
    kart.items[slot] = remaining > 0 ? { kind: item, charges: remaining } : null;
    kart.itemCooldown = ITEM_USE_COOLDOWN_SEC;
  }

  function respawn(kart: KartRuntime): void {
    const sample = sampleAt(track, kart.lastS);
    kart.x = sample.x;
    kart.z = sample.z;
    kart.y = surfaceHeight(sample, 0);
    kart.vy = 0;
    kart.airborne = false;
    kart.yaw = headingOf(sample.tx, sample.tz);
    kart.speed = RESPAWN_SPEED;
    kart.drifting = false;
    kart.driftCharge = 0;
    kart.driftTier = 0;
    kart.driftDir = 0;
    kart.spinTimer = 0;
    kart.squashTimer = 0;
    kart.stallTimer = 0;
    kart.slip = 0;
    kart.graceTimer = HIT_GRACE_SEC;
    kart.stuckTimer = 0;
    kart.stuckMark = kart.distance;
    emit({ k: "respawn", racer: kart.id });
  }

  function cpuWorld(): CpuWorld {
    return {
      track,
      speedScale: tuning.speedScale * weather.top,
      // Rain reduces the turn rate; the braking model must plan for the
      // reduced lateral authority or every CPU overshoots wet corners.
      gripScale: tuning.gripScale * weather.turn,
      racers: karts,
      hazards,
      projectiles,
      boxes: track.itemBoxes,
      boxCooldowns,
      pads: track.boostPads,
      ramps: track.ramps,
      random,
      racing: phase === "race",
      countdown,
    };
  }

  function driveKart(kart: KartRuntime, dt: number, world: CpuWorld): void {
    const input = kart.cpu ? cpuInput(kart, world, dt) : kart.input;
    if (kart.cpu) kart.input = input;

    kart.boostTimer = Math.max(0, kart.boostTimer - dt);
    if (kart.boostTimer <= 0) kart.boostSource = null;
    kart.starTimer = Math.max(0, kart.starTimer - dt);
    kart.boltTimer = Math.max(0, kart.boltTimer - dt);
    kart.graceTimer = Math.max(0, kart.graceTimer - dt);
    kart.itemCooldown = Math.max(0, kart.itemCooldown - dt);
    kart.wallCooldown = Math.max(0, kart.wallCooldown - dt);
    kart.rampCooldown = Math.max(0, kart.rampCooldown - dt);

    if (phase === "countdown") {
      if (input.throttle > 0.5) kart.countdownHold += dt;
      else kart.countdownHold = 0;
      kart.input = input;
      return;
    }

    // Item roulette resolves even while spun out.
    if (kart.rouletteTimer > 0) {
      kart.rouletteTimer -= dt;
      if (kart.rouletteTimer <= 0) {
        kart.rouletteTimer = 0;
        const kind = rollItem(random, kart.place, karts.length);
        const free = kart.items.findIndex((slot) => slot === null);
        if (free >= 0) {
          kart.items[free] = { kind, charges: itemCharges(kind) };
          emit({ k: "item", racer: kart.id, item: kind, slot: free });
        }
      }
    }

    /*
     * One press edge per slot, but a single cooldown for the kart: three keys
     * pressed on the same frame should still fire one item, not three.
     */
    const buttons = [input.item0, input.item1, input.item2];
    for (let slot = 0; slot < ITEM_SLOT_COUNT; slot += 1) {
      const down = buttons[slot] ?? false;
      const pressed = down && !kart.itemHeld[slot];
      kart.itemHeld[slot] = down;
      if (
        pressed &&
        kart.items[slot] &&
        kart.rouletteTimer <= 0 &&
        kart.itemCooldown <= 0 &&
        !kart.finished
      ) {
        useItem(kart, slot);
      }
    }

    // ── Abilities ──────────────────────────────────────────────────────────
    kart.skillCooldown = Math.max(0, kart.skillCooldown - dt);
    kart.gimmickCooldown = Math.max(0, kart.gimmickCooldown - dt);
    kart.mulSpeedTimer = Math.max(0, kart.mulSpeedTimer - dt);
    kart.mulTurnTimer = Math.max(0, kart.mulTurnTimer - dt);
    kart.mulAccelTimer = Math.max(0, kart.mulAccelTimer - dt);
    kart.mulOffroadTimer = Math.max(0, kart.mulOffroadTimer - dt);
    kart.mulAirTimer = Math.max(0, kart.mulAirTimer - dt);
    kart.magnetTimer = Math.max(0, kart.magnetTimer - dt);
    kart.brakeSlideTimer = Math.max(0, kart.brakeSlideTimer - dt);
    {
      const skillPressed = input.skill && !kart.skillHeld;
      kart.skillHeld = input.skill;
      if (skillPressed) tryAbility(kart, "skill");
      const gimmickPressed = input.gimmick && !kart.gimmickHeld;
      kart.gimmickHeld = input.gimmick;
      if (gimmickPressed) tryAbility(kart, "gimmick");
    }
    /*
     * The coefficients this tick sees: the kit, bent by whatever abilities are
     * live. Built once here rather than read at each site, so a chain of
     * multiplications has one evaluation order for the whole frame.
     */
    const T = effectiveTuning(kart);

    const stunned =
      kart.spinTimer > 0 || kart.squashTimer > 0 || kart.stallTimer > 0;
    if (stunned) {
      const wasSpinning = kart.spinTimer > 0;
      const stalling = kart.spinTimer <= 0 && kart.squashTimer <= 0;
      kart.spinTimer = Math.max(0, kart.spinTimer - dt);
      kart.squashTimer = Math.max(0, kart.squashTimer - dt);
      kart.stallTimer = Math.max(0, kart.stallTimer - dt);
      /*
       * The spin is a BODY rotation, not a change of travel direction.
       * Rotating `yaw` scrambled where the kart was pointed when it recovered,
       * so a single banana could leave you driving into the scenery with no
       * way to tell what happened — and a burnt-out start span the kart 1.6
       * times before the lights had even gone out.
       */
      if (!stalling) {
        kart.slip = wrapAngle(
          kart.slip + SPINOUT_SPIN_RATE * dt * (wasSpinning ? 1 : 0.6),
        );
      } else {
        kart.slip += (0 - kart.slip) * Math.min(1, 8 * dt);
      }
      const keep = stalling
        ? SQUASH_SPEED_KEEP
        : wasSpinning
          ? SPINOUT_SPEED_KEEP
          : SQUASH_SPEED_KEEP;
      kart.speed *= Math.pow(keep, dt);
      if (
        kart.spinTimer <= 0 &&
        kart.squashTimer <= 0 &&
        kart.stallTimer <= 0
      ) {
        kart.graceTimer = HIT_GRACE_SEC;
        kart.slip = 0;
      }
    } else {
      const steerTarget = clamp(input.steer, -1, 1);
      kart.steer += (steerTarget - kart.steer) * Math.min(1, STEER_LERP * dt);

      // ── Tricks: drift press in the air queues a spin ─────────────────────
      if (
        kart.airborne &&
        input.drift &&
        !kart.trickQueued &&
        kart.airTime > 0.12 &&
        phase === "race"
      ) {
        kart.trickQueued = true;
        emit({ k: "trick", racer: kart.id });
      }

      /*
       * ── Hop, then drift ──────────────────────────────────────────────────
       *
       * Press and the kart hops, always — no steering required, no speed
       * required. The direction of the drift is decided when it lands. That
       * ordering is the whole feel: the old code demanded 0.12 of lock at the
       * instant of the press, so tapping the button while pointed straight did
       * nothing at all, not even the hop, and the control read as broken.
       *
       * The hop still refuses to set `airborne` — airborne breaks drifts and
       * grants tricks, and a hop must do neither. It is weight, not flight,
       * and `hopTimer > 0` is the flag that says so.
       */
      const driftPressed = input.drift && !kart.driftHeld;
      kart.driftHeld = input.drift;
      if (driftPressed && !kart.airborne && !kart.drifting && kart.hopTimer <= 0) {
        kart.hopTimer = DRIFT_HOP_SEC;
        kart.driftArmed = true;
        emit({ k: "hop", racer: kart.id });
      }
      if (!input.drift) kart.driftArmed = false;
      if (
        kart.driftArmed &&
        !kart.drifting &&
        !kart.airborne &&
        kart.hopTimer <= 0 &&
        kart.speed >= DRIFT_MIN_SPEED &&
        Math.abs(steerTarget) > DRIFT_LATCH_STEER
      ) {
        kart.drifting = true;
        kart.driftDir = Math.sign(steerTarget);
        kart.driftCharge = 0;
        kart.driftTier = 0;
      }
      if (kart.drifting) {
        const broken =
          !input.drift || kart.speed < DRIFT_MIN_SPEED * 0.75 || kart.airborne;
        if (broken) {
          if (kart.driftTier > 0) {
            boost(
              kart,
              MINI_TURBO_BOOST[kart.driftTier - 1] ?? 0,
              "mini",
              kart.driftTier,
            );
          }
          kart.drifting = false;
          kart.driftDir = 0;
          kart.driftCharge = 0;
          kart.driftTier = 0;
        } else {
          kart.driftCharge += dt;
          const tier = driftTierFor(kart.driftCharge);
          if (tier > kart.driftTier) {
            kart.driftTier = tier;
            emit({ k: "drift", racer: kart.id, tier });
          }
        }
      }

      // ── Steering ─────────────────────────────────────────────────────────
      const speedFactor = clamp(
        Math.abs(kart.speed) /
          (BASE_TOP_SPEED * T.speedScale * TURN_SPEED_REFERENCE),
        0,
        1,
      );
      let turn: number;
      if (kart.drifting) {
        // Bent at neutral: winding into the slide tightens it, winding out of
        // it goes past zero and unwinds. See balance.ts for why one slope
        // could not be both.
        const alignment = clamp(kart.steer * kart.driftDir, -1, 1);
        const authority =
          alignment >= 0
            ? DRIFT_STEER_NEUTRAL +
              (DRIFT_STEER_INNER - DRIFT_STEER_NEUTRAL) * alignment
            : DRIFT_STEER_NEUTRAL * (1 + alignment) +
              DRIFT_STEER_OUTER * -alignment;
        turn = DRIFT_TURN_RATE * kart.driftDir * authority * speedFactor;
      } else {
        turn = BASE_TURN_RATE * kart.steer * speedFactor;
      }
      turn *= T.turnScale * weather.turn;
      if (kart.airborne) turn *= AIR_CONTROL * T.airControlScale;
      if (kart.speed < 0) turn = -turn;
      /*
       * Subtracted, not added: `turn` is a rate toward `rightOf`, and yaw
       * increases to the LEFT because three.js's Ry sends local -Z that way.
       * The frame is stated in track.ts; this is the one line that pays for it.
       */
      kart.yaw -= turn * dt;

      /*
       * Body angle. Positive slip swings the nose toward -rightOf (left), so a
       * right-hand drift wants a negative one — in a slide the nose points into
       * the corner while the kart keeps travelling along its heading.
       */
      const slipTarget = kart.drifting
        ? -kart.driftDir *
          DRIFT_SLIP_ANGLE *
          Math.min(1, 0.4 + kart.driftCharge * 1.6)
        : 0;
      kart.slip += (slipTarget - kart.slip) * Math.min(1, 9 * dt);

      // ── Longitudinal ─────────────────────────────────────────────────────
      const catchup =
        1 +
        (CATCHUP_MAX_BONUS * (kart.place - 1)) / Math.max(1, karts.length - 1);
      let topSpeed = BASE_TOP_SPEED * T.speedScale * weather.top * catchup;
      if (kart.drafting && kart.boostSource === "draft") {
        topSpeed *= DRAFT_TOP_SPEED_MULT;
      }
      if (kart.offRoad) topSpeed *= OFFROAD_SPEED_MULT;
      if (kart.boltTimer > 0) topSpeed *= BOLT_TOP_SPEED_MULT;
      if (kart.starTimer > 0) topSpeed *= STAR_TOP_SPEED_MULT;
      if (kart.boostTimer > 0) topSpeed *= BOOST_TOP_SPEED_MULT;

      let accel = ENGINE_ACCEL;
      if (kart.boostTimer > 0) accel = BOOST_ACCEL;
      else if (kart.starTimer > 0) accel = STAR_ACCEL;

      const throttle = kart.finished ? 0.6 : clamp(input.throttle, 0, 1);
      const brake = kart.finished ? 0 : clamp(input.brake, 0, 1);
      if (throttle > 0.02 && kart.speed < topSpeed) {
        const headroom = 1 - clamp(kart.speed / topSpeed, 0, 1) * 0.55;
        kart.speed += accel * throttle * headroom * dt;
      }
      if (brake > 0.02) {
        kart.speed -= BRAKE_DECEL * weather.brake * brake * dt;
        if (kart.speed < -REVERSE_TOP_SPEED) kart.speed = -REVERSE_TOP_SPEED;
      }
      const rolling =
        ROLLING_RESISTANCE * (throttle > 0.02 ? 0.28 : 1) * Math.sign(kart.speed);
      kart.speed -=
        (DRAG_QUADRATIC * kart.speed * Math.abs(kart.speed) + rolling) * dt;
      if (kart.offRoad && kart.speed > 0) {
        kart.speed = Math.max(
          0,
          kart.speed - OFFROAD_FRICTION * weather.offroad * dt,
        );
      }
      if (kart.speed > topSpeed) {
        kart.speed -= (kart.speed - topSpeed) * Math.min(1, 3.2 * dt);
      }
      if (Math.abs(kart.speed) < 0.02) kart.speed = 0;
    }

    // ── Integrate position ────────────────────────────────────────────────────
    const [fx, fz] = forwardOf(kart.yaw);
    kart.x += fx * kart.speed * dt;
    kart.z += fz * kart.speed * dt;

    const query = querySurface(track, kart.x, kart.z, kart.sampleHint, SHOULDER_WIDTH);
    kart.sampleHint = query.index;
    kart.offRoad = !query.onRoad;
    kart.lastHalf = query.half;

    if (!query.onGround) {
      const limit = query.half + SHOULDER_WIDTH;
      const side = Math.sign(query.lateral) || 1;
      const excess = Math.abs(query.lateral) - limit;
      const sample = track.samples[query.index]!;
      kart.x -= sample.rx * side * (excess + WALL_PUSH * dt);
      kart.z -= sample.rz * side * (excess + WALL_PUSH * dt);
      const [rx, rz] = rightOf(kart.yaw);
      const into = Math.abs(rx * sample.rx * side + rz * sample.rz * side);
      const headOn = clamp(1 - into, 0, 1);
      kart.speed *= 1 - (1 - WALL_SPEED_KEEP) * headOn;
      if (kart.drifting) {
        kart.drifting = false;
        kart.driftCharge = 0;
        kart.driftTier = 0;
        kart.driftDir = 0;
      }
      if (kart.wallCooldown <= 0 && headOn > 0.25 && Math.abs(kart.speed) > 8) {
        kart.wallCooldown = 0.4;
        emit({ k: "wall", racer: kart.id, speed: Math.abs(kart.speed) });
      }
    }

    kart.lastLateral = query.lateral;

    // ── Vertical ─────────────────────────────────────────────────────────────
    const groundY = query.height;
    const desiredVy = kart.speed * Math.sin(query.pitch);

    // Ramps: aligned, grounded and fast enough → launch.
    if (
      !kart.airborne &&
      kart.rampCooldown <= 0 &&
      kart.speed > 12 &&
      phase === "race"
    ) {
      for (const ramp of track.ramps) {
        const along = arcDelta(track, ramp.s, query.s);
        if (Math.abs(along) > 2.2) continue;
        if (Math.abs(query.lateral - ramp.lateral) > ramp.halfWidth) continue;
        kart.airborne = true;
        /*
         * ADDED to the slope-following vertical speed, not assigned over it.
         * On a 20% climb the road itself rises at ~7 u/s under the kart;
         * assigning 8.8 left a launch of 1.6 relative to the surface and the
         * "jump" lasted one tick. The ramp throws you off the road you were
         * ON, whatever that road was doing.
         */
        kart.vy =
          desiredVy +
          RAMP_LAUNCH_VY *
            clamp(kart.speed / (BASE_TOP_SPEED * kart.tuning.speedScale), 0.55, 1.15);
        kart.rampCooldown = 1.2;
        kart.hopTimer = 0;
        break;
      }
    }

    if (kart.airborne) {
      kart.airTime += dt;
      kart.vy -= GRAVITY * dt;
      kart.y += kart.vy * dt;
      if (kart.y <= groundY) {
        kart.y = groundY;
        kart.vy = 0;
        kart.airborne = false;
        // Trick landing: queued in the air, paid on the ground.
        if (kart.trickQueued && kart.airTime > TRICK_MIN_AIR_SEC) {
          boost(kart, TRICK_BOOST_SEC, "trick");
        }
        kart.trickQueued = false;
        kart.airTime = 0;
      }
    } else if (kart.hopTimer > 0) {
      // Drift hop: pure parabola over the local surface; drift rules never
      // see it because `airborne` stays false.
      kart.hopTimer = Math.max(0, kart.hopTimer - dt);
      const total = DRIFT_HOP_SEC;
      const t = total - kart.hopTimer;
      const lift = Math.max(0, DRIFT_HOP_VY * t - 0.5 * GRAVITY * t * t);
      kart.vy = desiredVy;
      kart.y = groundY + lift;
    } else if (kart.vy - desiredVy > 6 && kart.speed > 14) {
      kart.airborne = true;
      kart.airTime = 0;
      kart.y += kart.vy * dt;
    } else {
      kart.vy = desiredVy;
      kart.y = groundY;
      kart.airTime = 0;
    }

    // ── Progress ─────────────────────────────────────────────────────────────
    const ds = clamp(arcDelta(track, kart.lastS, query.s), -2.5, 2.5);
    kart.distance += ds;
    kart.lastS = query.s;

    const sample = track.samples[query.index]!;
    kart.wrongWay =
      phase === "race" &&
      !kart.finished &&
      kart.speed > 3 &&
      fx * sample.tx + fz * sample.tz < -0.15;

    if (!kart.finished) {
      const lapIndex = Math.floor(Math.max(0, kart.distance) / track.length);
      const nextLap = Math.min(laps, lapIndex + 1);
      if (nextLap > kart.lap) {
        const lapTime = elapsed - kart.lapStartTime;
        kart.lastLap = lapTime;
        kart.bestLap =
          kart.bestLap === null ? lapTime : Math.min(kart.bestLap, lapTime);
        kart.lapStartTime = elapsed;
        emit({ k: "lap", racer: kart.id, lap: kart.lap, lapTime });
        kart.lap = nextLap;
      }
      if (kart.distance >= laps * track.length) {
        const lapTime = elapsed - kart.lapStartTime;
        kart.lastLap = lapTime;
        kart.bestLap =
          kart.bestLap === null ? lapTime : Math.min(kart.bestLap, lapTime);
        kart.finished = true;
        kart.finishTime = elapsed;
        finishedCount += 1;
        emit({ k: "lap", racer: kart.id, lap: laps, lapTime });
        emit({
          k: "finish",
          racer: kart.id,
          place: finishedCount,
          time: elapsed,
        });
        if (finishGrace === null) finishGrace = FINISH_GRACE_SEC;
      }
    }

    // ── Slipstream ───────────────────────────────────────────────────────────
    if (phase === "race" && !kart.finished && !kart.offRoad && kart.speed > 14) {
      let inWake = false;
      const [fx2, fz2] = forwardOf(kart.yaw);
      for (const leader of karts) {
        if (leader.id === kart.id || leader.finished) continue;
        const dx = leader.x - kart.x;
        const dz = leader.z - kart.z;
        const range = Math.hypot(dx, dz);
        if (range < 3 || range > DRAFT_RANGE) continue;
        const ahead = (dx * fx2 + dz * fz2) / range;
        if (ahead < Math.cos(DRAFT_HALF_ANGLE)) continue;
        if (leader.speed < 16) continue;
        inWake = true;
        break;
      }
      if (inWake) {
        kart.draftCharge += dt;
        kart.drafting = true;
        if (kart.draftCharge >= DRAFT_CHARGE_SEC) {
          kart.draftCharge = 0;
          boost(kart, DRAFT_BOOST_SEC, "draft");
        }
      } else {
        kart.draftCharge = Math.max(0, kart.draftCharge - dt * 2);
        kart.drafting = kart.boostSource === "draft" && kart.boostTimer > 0;
      }
    } else {
      kart.draftCharge = 0;
      kart.drafting = kart.boostSource === "draft" && kart.boostTimer > 0;
    }

    // ── Stuck watchdog ───────────────────────────────────────────────────────
    if (phase === "race" && !kart.finished) {
      if (kart.distance - kart.stuckMark > STUCK_PROGRESS_EPSILON) {
        kart.stuckMark = kart.distance;
        kart.stuckTimer = 0;
      } else {
        kart.stuckTimer += dt;
        if (kart.stuckTimer > STUCK_RESPAWN_SEC) respawn(kart);
      }
    }
  }

  function resolveKartContacts(): void {
    for (let i = 0; i < karts.length; i += 1) {
      for (let j = i + 1; j < karts.length; j += 1) {
        const a = karts[i]!;
        const b = karts[j]!;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const distance = Math.hypot(dx, dz);
        const minimum = KART_RADIUS * 2;
        if (distance >= minimum || distance < 1e-4) continue;
        if (Math.abs(a.y - b.y) > 3) continue;
        const nx = dx / distance;
        const nz = dz / distance;
        const overlap = (minimum - distance) / 2;
        a.x -= nx * overlap;
        a.z -= nz * overlap;
        b.x += nx * overlap;
        b.z += nz * overlap;
        const transfer =
          (a.speed - b.speed) * BUMP_SPEED_TRANSFER * 0.5;
        a.speed -= transfer;
        b.speed += transfer;
        const shove = BUMP_IMPULSE * 0.02;
        a.x -= nx * shove;
        a.z -= nz * shove;
        b.x += nx * shove;
        b.z += nz * shove;
        if (a.starTimer > 0 && b.starTimer <= 0) applyHit(b, "star", a.id, true);
        else if (b.starTimer > 0 && a.starTimer <= 0) applyHit(a, "star", b.id, true);
      }
    }
  }

  function updateProjectiles(dt: number): void {
    for (let index = projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = projectiles[index]!;
      projectile.age += dt;
      projectile.life -= dt;

      if (projectile.kind === "red" && projectile.target !== null) {
        const target = karts[projectile.target];
        if (target && !target.finished) {
          const range = Math.hypot(
            target.x - projectile.x,
            target.z - projectile.z,
          );
          if (range < RED_SHELL_LOCK_RANGE) {
            /*
             * Follow the ROAD to the target, not the straight line. The
             * straight-line chase died against the outside wall of every
             * hairpin between shooter and victim; aiming at a point on the
             * centreline a little ahead of the shell hugs the corridor and
             * only converges onto the kart itself for the final metres.
             */
            const shellQuery = querySurface(
              track,
              projectile.x,
              projectile.z,
              projectile.hint,
              SHOULDER_WIDTH,
            );
            const gap = arcDelta(track, shellQuery.s, target.lastS);
            const chaseDirect = Math.abs(gap) < 16;
            let desired: number;
            if (chaseDirect) {
              desired = headingOf(
                target.x - projectile.x,
                target.z - projectile.z,
              );
            } else {
              const aheadS =
                shellQuery.s + Math.sign(gap) * Math.min(Math.abs(gap), 14);
              const [aimX, , aimZ] = pointAt(
                track,
                aheadS,
                target.lastLateral * 0.4,
              );
              desired = headingOf(aimX - projectile.x, aimZ - projectile.z);
            }
            const delta = angleDelta(projectile.yaw, desired);
            projectile.yaw +=
              clamp(delta, -RED_SHELL_TURN_RATE * dt, RED_SHELL_TURN_RATE * dt);
          }
        }
      }

      const [fx, fz] = forwardOf(projectile.yaw);
      projectile.x += fx * projectile.speed * dt;
      projectile.z += fz * projectile.speed * dt;
      const query = querySurface(
        track,
        projectile.x,
        projectile.z,
        projectile.hint,
        SHOULDER_WIDTH,
      );
      projectile.hint = query.index;
      projectile.y = query.height + 0.6;

      if (!query.onGround) {
        if (projectile.kind === "green" && projectile.bounces < 4) {
          const sample = track.samples[query.index]!;
          const side = Math.sign(query.lateral) || 1;
          // Reflect the heading about the wall (which runs along the tangent).
          const wall = headingOf(sample.tx, sample.tz);
          // Reflection about a line of heading α is 2α − θ (see track.ts for
          // the heading convention). Wrapped so the value stays in (−π, π].
          const reflected = 2 * wall - projectile.yaw;
          projectile.yaw = Math.atan2(
            Math.sin(reflected),
            Math.cos(reflected),
          );
          const limit = query.half + SHOULDER_WIDTH - 0.4;
          projectile.x =
            sample.x + sample.rx * side * limit;
          projectile.z =
            sample.z + sample.rz * side * limit;
          projectile.bounces += 1;
        } else {
          if (projectile.kind === "bomb") {
            detonate(projectile.x, projectile.y, projectile.z, projectile.owner);
          }
          projectiles.splice(index, 1);
          continue;
        }
      }

      let consumed = false;
      for (const kart of karts) {
        if (kart.finished) continue;
        if (kart.id === projectile.owner && projectile.age < 0.35) continue;
        if (kart.id === projectile.owner && projectile.kind === "red") continue;
        const distance = Math.hypot(kart.x - projectile.x, kart.z - projectile.z);
        if (distance > SHELL_RADIUS + KART_RADIUS) continue;
        if (Math.abs(kart.y - projectile.y) > 3) continue;
        if (projectile.kind === "bomb") {
          detonate(projectile.x, projectile.y, projectile.z, projectile.owner);
          consumed = true;
        } else if (applyHit(kart, projectile.kind, projectile.owner, false)) {
          consumed = true;
        } else if (kart.starTimer > 0) {
          consumed = true;
        }
        if (consumed) break;
      }
      if (consumed) {
        projectiles.splice(index, 1);
        continue;
      }

      if (projectile.life <= 0) {
        if (projectile.kind === "bomb") {
          detonate(projectile.x, projectile.y, projectile.z, projectile.owner);
        }
        projectiles.splice(index, 1);
      }
    }
  }

  function updateHazards(dt: number): void {
    for (let index = hazards.length - 1; index >= 0; index -= 1) {
      const hazard = hazards[index]!;
      hazard.age += dt;
      hazard.life -= dt;
      let consumed = false;
      for (const kart of karts) {
        if (kart.finished) continue;
        if (kart.id === hazard.owner && hazard.age < 0.7) continue;
        const distance = Math.hypot(kart.x - hazard.x, kart.z - hazard.z);
        if (distance > BANANA_RADIUS + KART_RADIUS) continue;
        if (Math.abs(kart.y - hazard.y) > 3) continue;
        if (kart.starTimer > 0) {
          consumed = true;
          break;
        }
        // A mine is a banana that answers with the weight of a bomb.
        const heavy = hazard.kind === "mine";
        if (applyHit(kart, heavy ? "bomb" : "banana", hazard.owner, heavy)) {
          consumed = true;
          break;
        }
      }
      if (consumed || hazard.life <= 0) hazards.splice(index, 1);
    }
  }

  function updatePickups(dt: number): void {
    for (let index = 0; index < track.itemBoxes.length; index += 1) {
      if (boxCooldowns[index]! > 0) {
        boxCooldowns[index] = Math.max(0, boxCooldowns[index]! - dt);
        continue;
      }
      const box = track.itemBoxes[index]!;
      for (const kart of karts) {
        /*
         * "Is there room?", not "are you empty?". The old condition refused a
         * box the moment a single item was held, which was correct when one
         * was the maximum and is the difference between three slots and a
         * decorative pair of them now — and it fails silently, because a kart
         * that never picks anything up looks exactly like a kart that never
         * drove past a box.
         */
        if (kart.finished || kart.rouletteTimer > 0) continue;
        if (kart.items.every((held) => held !== null)) continue;
        if (Math.abs(kart.y - box.y) > 4) continue;
        const distance = Math.hypot(kart.x - box.x, kart.z - box.z);
        if (distance > 3) continue;
        kart.rouletteTimer = ITEM_ROULETTE_SEC;
        boxCooldowns[index] = ITEM_BOX_RESPAWN_SEC;
        emit({ k: "pickup", racer: kart.id, box: index });
        break;
      }
    }
  }

  function updateBoostPads(): void {
    for (const pad of track.boostPads) {
      for (const kart of karts) {
        if (kart.finished) continue;
        const along = arcDelta(track, pad.s, kart.lastS);
        if (Math.abs(along) > pad.halfLength) continue;
        if (Math.abs(kart.lastLateral - pad.lateral) > pad.halfWidth) continue;
        if (kart.boostSource === "pad" && kart.boostTimer > PAD_BOOST_SEC * 0.6) {
          continue;
        }
        boost(kart, PAD_BOOST_SEC, "pad");
      }
    }
  }

  function updateRanking(): void {
    const order = karts.slice().sort((a, b) => {
      if (a.finished && b.finished) {
        return (a.finishTime ?? 0) - (b.finishTime ?? 0);
      }
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.distance - a.distance;
    });
    for (let index = 0; index < order.length; index += 1) {
      order[index]!.place = index + 1;
    }
  }

  function buildResult(): RaceResult {
    const standings: RaceStanding[] = karts
      .slice()
      .sort((a, b) => a.place - b.place)
      .map((kart) => ({
        id: kart.id,
        name: kart.name,
        cpu: kart.cpu,
        livery: kart.livery,
        place: kart.place,
        finished: kart.finished,
        time: kart.finishTime,
        bestLap: kart.bestLap,
        lap: kart.lap,
      }));
    return {
      trackId: track.spec.id,
      laps,
      durationSec: elapsed,
      standings,
    };
  }

  function stepOnce(): void {
    const dt = SIM_STEP_SEC;
    tick += 1;
    elapsed += dt;

    if (phase === "countdown") {
      countdown = Math.max(0, countdown - dt);
      const remaining = Math.ceil(countdown);
      if (remaining < announced && remaining >= 1) {
        announced = remaining;
        emit({ k: "countdown", n: remaining });
      }
      const world = cpuWorld();
      for (const kart of karts) driveKart(kart, dt, world);
      if (countdown <= 0) {
        phase = "race";
        emit({ k: "go" });
        for (const kart of karts) {
          kart.lapStartTime = elapsed;
          if (kart.countdownHold <= 0) continue;
          if (kart.countdownHold <= ROCKET_START_WINDOW_SEC) {
            boost(kart, ROCKET_START_BOOST_SEC, "rocket");
          } else if (kart.countdownHold >= ROCKET_START_BURN_SEC) {
            kart.stallTimer = ROCKET_BURN_STALL_SEC;
          }
        }
      }
      return;
    }

    if (phase === "finished") return;

    const world = cpuWorld();
    for (const kart of karts) driveKart(kart, dt, world);
    resolveKartContacts();
    if (itemsOn) {
      updateProjectiles(dt);
      updateHazards(dt);
      updatePickups(dt);
    }
    updateBoostPads();
    updateRanking();

    if (finishGrace !== null) finishGrace = Math.max(0, finishGrace - dt);
    const everyoneDone = karts.every((kart) => kart.finished);
    // Only meaningful when somebody is actually watching from a kart. In an
    // all-CPU race (the headless gate, the attract loop) this was true from
    // the first tick, so the race ended three seconds after the leader and
    // most of the grid never finished.
    const humansDone =
      karts.some((kart) => !kart.cpu) &&
      karts.every((kart) => kart.cpu || kart.finished);
    // Once no person is still driving there is nothing left to watch — but
    // give the finish line a beat before the results wipe the screen.
    if (humansDone && finishGrace !== null && finishGrace > HUMAN_FINISH_TAIL_SEC) {
      finishGrace = HUMAN_FINISH_TAIL_SEC;
    }
    if (everyoneDone || finishGrace === 0 || elapsed > MAX_RACE_SEC) {
      phase = "finished";
      updateRanking();
      result = buildResult();
    }
  }

  function snapshotRacer(kart: KartRuntime): RacerState {
    return {
      id: kart.id,
      name: kart.name,
      cpu: kart.cpu,
      livery: kart.livery,
      x: kart.x,
      y: kart.y,
      z: kart.z,
      yaw: kart.yaw,
      slip: kart.slip,
      speed: kart.speed,
      airborne: kart.airborne,
      offRoad: kart.offRoad,
      driftDir: kart.driftDir,
      driftCharge: kart.driftCharge,
      driftTier: kart.driftTier,
      tricking: kart.trickQueued && kart.airborne,
      drafting: kart.drafting,
      boostTimer: kart.boostTimer,
      boostSource: kart.boostSource,
      spinTimer: kart.spinTimer,
      squashTimer: kart.squashTimer,
      stalled: kart.stallTimer > 0,
      starTimer: kart.starTimer,
      boltTimer: kart.boltTimer,
      graceTimer: kart.graceTimer,
      characterId: kart.characterId,
      machineId: kart.machineId,
      items: kart.items.map((held) => (held ? { ...held } : null)),
      rouletteTimer: kart.rouletteTimer,
      distance: kart.distance,
      lap: kart.lap,
      place: kart.place,
      wrongWay: kart.wrongWay,
      finished: kart.finished,
      finishTime: kart.finishTime,
      bestLap: kart.bestLap,
      lastLap: kart.lastLap,
    };
  }

  return {
    track,
    setInput(racer: RacerId, input: KartInput): void {
      const kart = karts[racer];
      if (!kart || kart.cpu) return;
      kart.input = input;
    },
    setAutopilot(racer: RacerId, enabled: boolean): void {
      const kart = karts[racer];
      if (!kart) return;
      kart.cpu = enabled;
      if (enabled) return;
      kart.input = NEUTRAL_INPUT;
      kart.itemHeld = [false, false, false];
    },
    advance(dtSec: number): number {
      if (isFinished()) return 0;
      accumulator += Math.max(0, Math.min(0.5, dtSec));
      let steps = 0;
      while (accumulator >= SIM_STEP_SEC && steps < MAX_CATCHUP_STEPS) {
        accumulator -= SIM_STEP_SEC;
        stepOnce();
        steps += 1;
        if (isFinished()) break;
      }
      if (steps >= MAX_CATCHUP_STEPS) accumulator = 0;
      return steps;
    },
    step(): void {
      stepOnce();
    },
    getState(): RaceState {
      return {
        tick,
        elapsed,
        phase,
        trackId: track.spec.id,
        laps,
        racers: karts.map(snapshotRacer),
        projectiles: projectiles.map(
          (projectile): ProjectileState => ({
            id: projectile.id,
            kind: projectile.kind,
            owner: projectile.owner,
            x: projectile.x,
            y: projectile.y,
            z: projectile.z,
            yaw: projectile.yaw,
          }),
        ),
        hazards: hazards.map(
          (hazard): HazardState => ({
            id: hazard.id,
            kind: hazard.kind,
            owner: hazard.owner,
            x: hazard.x,
            y: hazard.y,
            z: hazard.z,
          }),
        ),
        boxCooldowns: boxCooldowns.slice(),
        countdown,
        finishGrace,
      };
    },
    drainEvents(): readonly RaceEvent[] {
      const drained = events;
      events = [];
      return drained;
    },
    result(): RaceResult | null {
      return result;
    },
  };
}
