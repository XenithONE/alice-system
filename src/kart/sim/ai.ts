/**
 * The CPU driver.
 *
 * It is a driver, not a rail. Each tick it re-derives a racing line from the
 * curvature of the road ahead, works out the fastest speed it can still make
 * the next corner at, decides whether the corner is worth a drift, dodges what
 * is in the way, and picks an item target. Everything is deterministic: the
 * only randomness is the simulation's seeded stream, so the same seed and the
 * same inputs replay identically (the twin-sim gate in headlessSelftest holds
 * that line).
 */

import {
  BASE_TOP_SPEED,
  CPU_SKILL,
  DRIFT_HOP_SEC,
  DRIFT_MIN_SPEED,
  EMP_RADIUS,
  MINI_TURBO_TIERS,
  RED_SHELL_LOCK_RANGE,
} from "./balance";
import {
  angleDelta,
  arcDelta,
  forwardOf,
  headingOf,
  pointAt,
  rightOf,
  sampleAt,
  type BoostPad,
  type ItemBoxPlacement,
  type Ramp,
  type Track,
} from "./track";
import { characterById } from "../content/characters";
import { machineById } from "../content/machines";
import type { KartRuntime } from "./runtime";
import type { ItemKind, KartInput, RacerId } from "./types";

export interface CpuHazardView {
  readonly x: number;
  readonly z: number;
  readonly owner: RacerId;
}

export interface CpuProjectileView {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly owner: RacerId;
}

export interface CpuWorld {
  readonly track: Track;
  /** Speed-class scales; the braking model reads real grip, not 150cc's. */
  readonly speedScale: number;
  readonly gripScale: number;
  readonly racers: readonly KartRuntime[];
  readonly hazards: readonly CpuHazardView[];
  readonly projectiles: readonly CpuProjectileView[];
  readonly boxes: readonly ItemBoxPlacement[];
  readonly boxCooldowns: readonly number[];
  readonly pads: readonly BoostPad[];
  readonly ramps: readonly Ramp[];
  readonly random: () => number;
  /** False during the countdown; the driver only revs the engine then. */
  readonly racing: boolean;
  /** Seconds left on the countdown — the rocket start needs to see it. */
  readonly countdown: number;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * Cornering limit. A corner of curvature k can be taken at sqrt(a/k); `a` is
 * the lateral grip the arcade model actually delivers, measured by
 * aiSelftest [AI1] rather than guessed.
 */
const LATERAL_GRIP = 34;

/** How far ahead the driver looks for braking points, in metres. */
const BRAKE_HORIZON: readonly number[] = [6, 12, 20, 30, 42, 56, 72];

/** Racing line: how much of the half width the driver is willing to use. */
const LINE_REACH = 0.62;

function curvatureAt(track: Track, s: number): number {
  return sampleAt(track, s).curvature;
}

/**
 * The CPU's controls, spelled out in one place.
 *
 * Every field is written explicitly so a new button shows up here as a
 * compile error and gets a deliberate answer, rather than defaulting to
 * "never pressed" through a spread and being forgotten. The ability buttons
 * are that: not wired yet, and this is where they will be.
 */
function cpuControls(partial: {
  throttle: number;
  brake: number;
  steer: number;
  drift: boolean;
  itemSlot?: number | null;
  skill?: boolean;
  gimmick?: boolean;
}): KartInput {
  const slot = partial.itemSlot ?? null;
  return {
    throttle: partial.throttle,
    brake: partial.brake,
    steer: partial.steer,
    drift: partial.drift,
    gimmick: partial.gimmick ?? false,
    skill: partial.skill ?? false,
    item0: slot === 0,
    item1: slot === 1,
    item2: slot === 2,
    lookBack: false,
  };
}

/**
 * Where the fast line runs at arc length `s`.
 *
 * Two probes: what the road is doing here, and what it is doing a corner
 * ahead. Inside on the apex, outside on the approach — the out-in shape,
 * without a hand-drawn line that would rot the moment a control point moves.
 */
function lineLateral(track: Track, s: number, entryBias: number): number {
  const here = curvatureAt(track, s);
  const ahead = curvatureAt(track, s + 22);
  const half = sampleAt(track, s).half;
  const apex = -Math.sign(here) * clamp(Math.abs(here) * 34, 0, 1) * LINE_REACH;
  const entering =
    Math.sign(ahead) * clamp(Math.abs(ahead) * 34, 0, 1) * LINE_REACH * 0.55;
  const blend = apex + entering * entryBias;
  return clamp(blend, -LINE_REACH, LINE_REACH) * half;
}

/** Fastest speed that still makes every corner inside the horizon. */
function speedLimit(
  track: Track,
  s: number,
  skill: number,
  gripScale = 1,
  speedScale = 1,
): number {
  let limit = BASE_TOP_SPEED * speedScale * 1.6;
  for (const distance of BRAKE_HORIZON) {
    const k = Math.abs(curvatureAt(track, s + distance));
    if (k < 1e-4) continue;
    const corner = Math.sqrt((LATERAL_GRIP * gripScale) / k);
    // Room to shed speed on the way in: roughly a third of a g of braking.
    limit = Math.min(limit, corner + distance * 0.34 * speedScale);
  }
  return limit * skill;
}

export function cpuInput(
  self: KartRuntime,
  world: CpuWorld,
  dt: number,
): KartInput {
  const skill = CPU_SKILL[clamp(self.cpuLevel, 1, 3) - 1]!;
  const track = world.track;

  if (!world.racing) {
    /*
     * Rocket start. The accelerator has to go down inside a narrow window
     * before GO; too early and the engine burns out. A driver aims at a
     * moment, so this compares against the countdown clock — the first
     * version counted how long it had been holding, which meant every CPU
     * started holding almost immediately and stalled on the line, every race.
     */
    // Aimed at ROCKET_START_WINDOW_SEC: a rival lands it nearly every time, a
    // racer about half, a tourist misses but is never early enough to burn.
    const aim = skill.drift > 0.85 ? 0.22 : skill.drift > 0.5 ? 0.31 : 0.9;
    const spread = skill.drift > 0.85 ? 0.13 : skill.drift > 0.5 ? 0.24 : 0.4;
    const jitter = (self.cpuWander * 0.5 + 0.5) * spread;
    return cpuControls({
      throttle:
        self.countdownHold > 0 || world.countdown <= aim + jitter ? 1 : 0,
      brake: 0,
      steer: 0,
      drift: false,
    });
  }

  const s = self.lastS;
  const half = self.lastHalf;

  // ── Mid-air: queue a trick, keep the wheel straight-ish ────────────────────
  if (self.airborne) {
    const wantsTrick = skill.drift > 0.4 && self.airTime > 0.14 && !self.trickQueued;
    return cpuControls({
      throttle: 1,
      brake: 0,
      steer: clamp(self.steer * 0.4, -0.4, 0.4),
      drift: wantsTrick,
    });
  }

  // ── Aim point ───────────────────────────────────────────────────────────────
  const speedFraction = clamp(self.speed / (BASE_TOP_SPEED * world.speedScale), 0, 1.3);
  const look = skill.look * (0.55 + 0.55 * speedFraction);
  const aimS = s + look;
  let targetLateral = lineLateral(track, aimS, 1);

  // ── Detours worth taking ────────────────────────────────────────────────────
  // An item box when the slot is empty, or a boost pad when it is close to the
  // line already. Never worth leaving the road for.
  if (self.items.some((held) => held === null) && self.rouletteTimer <= 0) {
    const box = nearestAhead(
      world.boxes.filter((_, index) => (world.boxCooldowns[index] ?? 0) <= 0),
      track,
      s,
      look * 1.4,
    );
    if (box) {
      const cost = Math.abs(box.lateral - targetLateral) / Math.max(1, half);
      if (cost < 0.85) targetLateral = box.lateral;
    }
  }
  if (self.boostTimer <= 0) {
    const pad = nearestAhead(world.pads, track, s, look * 1.3);
    if (pad) {
      const cost = Math.abs(pad.lateral - targetLateral) / Math.max(1, half);
      if (cost < 0.7) targetLateral = pad.lateral;
    }
  }
  // A ramp is a trick is a boost: better drivers line up for them earlier.
  if (skill.drift > 0.4 && self.rampCooldown <= 0) {
    const ramp = nearestAhead(world.ramps, track, s, look * 1.5);
    if (ramp) {
      const cost = Math.abs(ramp.lateral - targetLateral) / Math.max(1, half);
      if (cost < 0.9) targetLateral = ramp.lateral;
    }
  }

  // ── Things to miss ──────────────────────────────────────────────────────────
  const [fx, fz] = forwardOf(self.yaw);
  let dodge = 0;
  const threats: { x: number; z: number }[] = [];
  for (const hazard of world.hazards) threats.push(hazard);
  for (const projectile of world.projectiles) {
    if (projectile.owner === self.id) continue;
    threats.push(projectile);
  }
  for (const rival of world.racers) {
    if (rival.id === self.id || rival.finished) continue;
    threats.push({ x: rival.x, z: rival.z });
  }
  for (const threat of threats) {
    const dx = threat.x - self.x;
    const dz = threat.z - self.z;
    const ahead = dx * fx + dz * fz;
    if (ahead < 0.5 || ahead > 26) continue;
    const [rx, rz] = rightOf(self.yaw);
    const side = dx * rx + dz * rz;
    if (Math.abs(side) > 4.2) continue;
    const urgency = (26 - ahead) / 26;
    dodge += (side >= 0 ? -1 : 1) * urgency * 3.4;
  }
  targetLateral = clamp(targetLateral + dodge, -half * 0.94, half * 0.94);

  /*
   * Negated: `angleDelta` says how far yaw must INCREASE to face the aim
   * point, and yaw increases to the left, while steer is positive to the
   * right. See the heading convention in track.ts.
   */
  const [tx, , tz] = pointAt(track, aimS, targetLateral);
  let steer = clamp(
    -angleDelta(self.yaw, headingOf(tx - self.x, tz - self.z)) * 1.75,
    -1,
    1,
  );

  // ── Recovery ────────────────────────────────────────────────────────────────
  if (self.wrongWay) {
    const sample = sampleAt(track, s);
    steer = clamp(
      -angleDelta(self.yaw, headingOf(sample.tx, sample.tz)) * 2.4,
      -1,
      1,
    );
  } else if (self.offRoad) {
    const back = clamp(-self.lastLateral / Math.max(1, half), -1, 1);
    steer = clamp(steer * 0.5 + back * 1.4, -1, 1);
  }

  // ── Personality ─────────────────────────────────────────────────────────────
  self.cpuWanderTimer -= dt;
  if (self.cpuWanderTimer <= 0) {
    self.cpuWanderTimer = 0.6 + world.random() * 0.8;
    self.cpuWander = (world.random() * 2 - 1) * skill.error;
  }
  steer = clamp(steer + self.cpuWander, -1, 1);

  // ── Pace ────────────────────────────────────────────────────────────────────
  const limit = speedLimit(track, s, skill.speed, world.gripScale, world.speedScale);
  const over = self.speed - limit;
  let throttle = 1;
  let brake = 0;
  if (over > limit * 0.22) brake = 1;
  else if (over > 0) throttle = 0.15;
  if (self.offRoad || self.wrongWay) {
    throttle = 1;
    brake = 0;
  }
  if (self.speed < 4 && self.spinTimer <= 0 && self.squashTimer <= 0) {
    throttle = 1;
    brake = 0;
  }

  // ── Drift ───────────────────────────────────────────────────────────────────
  // Commit to a corner, hold until the charge lands, then let go on exit.
  const cornerNow = Math.abs(curvatureAt(track, s + 8));
  const cornerSoon = Math.abs(curvatureAt(track, s + 26));
  const wantsDrift =
    self.speed > DRIFT_MIN_SPEED + 3 &&
    !self.airborne &&
    !self.offRoad &&
    Math.abs(steer) > 0.22 &&
    cornerNow > 0.009;
  let drift = false;
  if (self.drifting) {
    const targetTier = skill.drift > 0.85 ? 2 : 1;
    const charged = self.driftTier >= targetTier;
    const cornerEnding = cornerSoon < cornerNow * 0.45 || cornerSoon < 0.006;
    // Counter-steering is how a drift is held, not a sign it went wrong. Only
    // a sustained hard input against the drift means the driver wants out.
    const wrongSide = self.driftDir !== 0 && steer * self.driftDir < -0.9;
    drift = !(charged && cornerEnding) && !wrongSide;
    // Never hold past a full charge — the third tier is where the time is.
    if (
      self.driftCharge >
      (MINI_TURBO_TIERS[MINI_TURBO_TIERS.length - 1] ?? 3) + 0.4
    ) {
      drift = false;
    }
  } else if (wantsDrift) {
    self.cpuDriftHold -= dt;
    if (self.cpuDriftHold <= 0) {
      self.cpuDriftHold = 0.35;
      /*
       * A drift now commits on TOUCHDOWN, so the button has to stay down
       * across the hop. This used to be a single-tick press, which was
       * enough when the press itself started the drift and is enough for
       * exactly nothing now: [H4] counted zero mini-turbos on every circuit
       * until the CPU learned to hold.
       */
      if (world.random() < skill.drift) {
        self.cpuDriftIntent = DRIFT_HOP_SEC + 0.12;
      }
    }
    if (self.cpuDriftIntent > 0) {
      self.cpuDriftIntent = Math.max(0, self.cpuDriftIntent - dt);
      drift = true;
    }
  } else {
    self.cpuDriftHold = 0;
    self.cpuDriftIntent = 0;
  }

  // ── Items ───────────────────────────────────────────────────────────────────
  self.cpuItemTimer -= dt;
  const carrying = self.items.some((held) => held !== null);
  let slot: number | null = null;
  if (carrying && self.rouletteTimer <= 0 && self.cpuItemTimer <= 0) {
    slot = pickItemSlot(self, world, skill, cornerSoon);
    if (slot !== null) self.cpuItemTimer = skill.itemDelay * 0.5 + 0.2;
  } else if (carrying && self.rouletteTimer <= 0 && self.cpuItemTimer > 0) {
    // Freshly acquired: the delay is the CPU's "reaction time".
  } else {
    self.cpuItemTimer = skill.itemDelay;
  }

  // ── Abilities ───────────────────────────────────────────────────────────────
  /*
   * Same shape as the item decision, and deliberately no random draw: every
   * branch is a state test, so adding abilities cannot shift the field's
   * shared random stream the way an extra roll would.
   */
  const useSkill =
    self.skillCooldown <= 0 &&
    wantsAbility(characterById(self.characterId).skillId, self, cornerSoon);
  const useGimmick =
    self.gimmickCooldown <= 0 &&
    wantsAbility(machineById(self.machineId).gimmickId, self, cornerSoon);

  return cpuControls({
    throttle,
    brake,
    steer,
    drift,
    itemSlot: slot,
    skill: useSkill,
    gimmick: useGimmick,
  });
}

function nearestAhead<T extends { readonly s: number; readonly lateral: number }>(
  candidates: readonly T[],
  track: Track,
  s: number,
  range: number,
): T | null {
  let best: T | null = null;
  let bestGap = Infinity;
  for (const candidate of candidates) {
    const gap = arcDelta(track, s, candidate.s);
    if (gap < 2 || gap > range) continue;
    if (gap < bestGap) {
      bestGap = gap;
      best = candidate;
    }
  }
  return best;
}

/**
 * Which slot to fire, if any.
 *
 * The roll is drawn ONCE, unconditionally, and shared by every slot the driver
 * considers. It used to be drawn inside two of the branches, which meant the
 * number of draws per tick depended on what the kart happened to be carrying —
 * with one slot that was survivable, with three it would give each seat a
 * different number of draws and pull the whole field's random stream apart.
 */
function pickItemSlot(
  self: KartRuntime,
  world: CpuWorld,
  skill: (typeof CPU_SKILL)[number],
  cornerSoon: number,
): number | null {
  const roll = world.random();
  for (let slot = 0; slot < self.items.length; slot += 1) {
    const held = self.items[slot];
    if (!held) continue;
    if (wantsItem(held.kind, self, world, skill, cornerSoon, roll)) return slot;
  }
  return null;
}

function wantsItem(
  kind: ItemKind,
  self: KartRuntime,
  world: CpuWorld,
  skill: (typeof CPU_SKILL)[number],
  cornerSoon: number,
  roll: number,
): boolean {
  const track = world.track;
  const [fx, fz] = forwardOf(self.yaw);
  let closestAhead = Infinity;
  let alignedAhead = Infinity;
  let closestBehind = Infinity;
  let rivalsAhead = 0;
  for (const rival of world.racers) {
    if (rival.id === self.id || rival.finished) continue;
    const gap = rival.distance - self.distance;
    if (gap > 0) rivalsAhead += 1;
    const dx = rival.x - self.x;
    const dz = rival.z - self.z;
    const range = Math.hypot(dx, dz);
    const ahead = (dx * fx + dz * fz) / Math.max(1e-3, range);
    if (ahead > 0.2) {
      closestAhead = Math.min(closestAhead, range);
      if (ahead > 0.94) alignedAhead = Math.min(alignedAhead, range);
    } else if (ahead < -0.2) {
      closestBehind = Math.min(closestBehind, range);
    }
  }

  switch (kind) {
    case "star":
      // Best spent where there is traffic, but never hoarded.
      return closestAhead < 60 || closestBehind < 30 || skill.drift < 0.5;
    case "bolt":
      return rivalsAhead > 0 && (rivalsAhead > 1 || closestAhead < 90);
    case "mushroom":
    case "triple":
      if (self.offRoad) return true;
      if (self.boostTimer > 0) return false;
      // A straight, or a corner exit that has already been taken.
      return cornerSoon < 0.009 && self.speed > 18;
    case "red":
      return alignedAhead < RED_SHELL_LOCK_RANGE || closestAhead < 90;
    case "green":
      if (alignedAhead < 46) return true;
      // Otherwise keep it as a shield unless someone is on the bumper.
      return closestBehind < 12 && roll < 0.5;
    case "bomb":
      return alignedAhead < 60 || closestBehind < 10;
    case "banana":
      // A dragged banana is a shield; drop it when it will actually land on
      // someone, or when the corner ahead makes it hard to avoid.
      if (closestBehind < 16) return true;
      return cornerSoon > 0.018 && roll < 0.35;
    case "mine":
      // Same shield logic, but worth spending sooner: it actually stops them.
      return closestBehind < 20 || (cornerSoon > 0.015 && roll < 0.5);
    case "turbine":
      // Only ever worth anything mid-drift, and only once it has charge.
      return self.drifting && self.driftTier < MINI_TURBO_TIERS.length;
    case "slipcall":
      // A tow needs someone to tow off, and room to use the speed.
      return alignedAhead < 60 && cornerSoon < 0.012 && self.boostTimer <= 0;
    case "emp":
      // Close-range, so wait until it will actually catch someone.
      return closestAhead < EMP_RADIUS * 0.9 || closestBehind < EMP_RADIUS * 0.7;
    default:
      return false;
  }
}

/**
 * Should the CPU press this ability now?
 *
 * A switch on the id rather than an interpretation of the effect list: the
 * catalog stays declarative (no callbacks, see content/abilities.ts) and the
 * driver's opinion about when a thing is worth using stays here, where the
 * rest of its opinions are. The sim re-checks the ability's own condition, so
 * a wrong answer here wastes a press rather than breaking a rule.
 */
function wantsAbility(
  id: string,
  self: KartRuntime,
  cornerSoon: number,
): boolean {
  switch (id) {
    case "nitro-pulse":
    case "thrust-vector":
      // Straights only, and never on top of a boost already running.
      return self.boostTimer <= 0 && cornerSoon < 0.009 && self.speed > 18;
    case "phase-veil":
    case "spike-guard":
      return self.place > 1 && self.speed > DRIFT_MIN_SPEED;
    case "gyro-lock":
    case "hover-jump":
      return self.airborne ? self.airTime > 0.2 : cornerSoon < 0.007;
    case "hard-brake":
    case "ballast-shift":
      return cornerSoon > 0.018 && self.speed > 24;
    case "scrap-drop":
      return self.place < 4;
    case "item-magnet":
      return self.items.some((held) => held === null);
    case "second-wind":
      return self.spinTimer > 0 || self.squashTimer > 0;
    case "slip-call":
      return self.place > 2 && self.boostTimer <= 0;
    case "turbo-tap":
      return self.drifting && self.driftTier >= 1;
    case "mud-tread":
      return self.offRoad;
    default:
      return false;
  }
}

/** Exposed for aiSelftest: the pace model the driver is holding itself to. */
export function cpuSpeedLimit(
  track: Track,
  s: number,
  level: number,
): number {
  const skill = CPU_SKILL[clamp(level, 1, 3) - 1]!;
  return speedLimit(track, s, skill.speed);
}

/** Exposed for aiSelftest: the line the driver is aiming at. */
export function cpuLineLateral(track: Track, s: number): number {
  return lineLateral(track, s, 1);
}
