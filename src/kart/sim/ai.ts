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
  DRIFT_MIN_SPEED,
  MINI_TURBO_TIERS,
  RED_SHELL_LOCK_RANGE,
} from "./balance";
import {
  angleDelta,
  arcDelta,
  forwardOf,
  headingOf,
  pointAt,
  sampleAt,
  type BoostPad,
  type ItemBoxPlacement,
  type Track,
} from "./track";
import type { KartRuntime } from "./runtime";
import type { KartInput, RacerId } from "./types";

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
  readonly racers: readonly KartRuntime[];
  readonly hazards: readonly CpuHazardView[];
  readonly projectiles: readonly CpuProjectileView[];
  readonly boxes: readonly ItemBoxPlacement[];
  readonly boxCooldowns: readonly number[];
  readonly pads: readonly BoostPad[];
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
function speedLimit(track: Track, s: number, skill: number): number {
  let limit = BASE_TOP_SPEED * 1.6;
  for (const distance of BRAKE_HORIZON) {
    const k = Math.abs(curvatureAt(track, s + distance));
    if (k < 1e-4) continue;
    const corner = Math.sqrt(LATERAL_GRIP / k);
    // Room to shed speed on the way in: roughly a third of a g of braking.
    limit = Math.min(limit, corner + distance * 0.34);
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
    return {
      throttle:
        self.countdownHold > 0 || world.countdown <= aim + jitter ? 1 : 0,
      brake: 0,
      steer: 0,
      drift: false,
      item: false,
      lookBack: false,
    };
  }

  const s = self.lastS;
  const half = self.lastHalf;

  // ── Aim point ───────────────────────────────────────────────────────────────
  const speedFraction = clamp(self.speed / BASE_TOP_SPEED, 0, 1.3);
  const look = skill.look * (0.55 + 0.55 * speedFraction);
  const aimS = s + look;
  let targetLateral = lineLateral(track, aimS, 1);

  // ── Detours worth taking ────────────────────────────────────────────────────
  // An item box when the slot is empty, or a boost pad when it is close to the
  // line already. Never worth leaving the road for.
  if (!self.item && self.rouletteTimer <= 0) {
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
    const side = dx * Math.cos(self.yaw) - dz * Math.sin(self.yaw);
    if (Math.abs(side) > 4.2) continue;
    const urgency = (26 - ahead) / 26;
    dodge += (side >= 0 ? -1 : 1) * urgency * 3.4;
  }
  targetLateral = clamp(targetLateral + dodge, -half * 0.94, half * 0.94);

  const [tx, , tz] = pointAt(track, aimS, targetLateral);
  let steer = clamp(
    angleDelta(self.yaw, headingOf(tx - self.x, tz - self.z)) * 1.75,
    -1,
    1,
  );

  // ── Recovery ────────────────────────────────────────────────────────────────
  if (self.wrongWay) {
    const sample = sampleAt(track, s);
    steer = clamp(
      angleDelta(self.yaw, headingOf(sample.tx, sample.tz)) * 2.4,
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
  const limit = speedLimit(track, s, skill.speed);
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
      drift = world.random() < skill.drift;
    } else {
      drift = false;
    }
  } else {
    self.cpuDriftHold = 0;
  }

  // ── Items ───────────────────────────────────────────────────────────────────
  self.cpuItemTimer -= dt;
  let useItem = false;
  if (self.item && self.rouletteTimer <= 0 && self.cpuItemTimer <= 0) {
    useItem = wantsItem(self, world, skill, cornerSoon);
    if (useItem) self.cpuItemTimer = skill.itemDelay * 0.5 + 0.2;
  } else if (self.item && self.rouletteTimer <= 0 && self.cpuItemTimer > 0) {
    // Freshly acquired: the delay is the CPU's "reaction time".
  } else {
    self.cpuItemTimer = skill.itemDelay;
  }

  return {
    throttle,
    brake,
    steer,
    drift,
    item: useItem,
    lookBack: false,
  };
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

function wantsItem(
  self: KartRuntime,
  world: CpuWorld,
  skill: (typeof CPU_SKILL)[number],
  cornerSoon: number,
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

  switch (self.item) {
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
      return closestBehind < 12 && world.random() < 0.5;
    case "bomb":
      return alignedAhead < 60 || closestBehind < 10;
    case "banana":
      // A dragged banana is a shield; drop it when it will actually land on
      // someone, or when the corner ahead makes it hard to avoid.
      if (closestBehind < 16) return true;
      return cornerSoon > 0.018 && world.random() < 0.35;
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
