/**
 * NITRO CROWN — every tuning number, in one place.
 *
 * The sim, the CPU, the renderer and the gates all read from here. A constant
 * that exists twice is a constant that will disagree with itself (see
 * ARCHITECTURE.md §"one fact, one place"), so nothing below may be re-typed
 * into a scene file or a probe.
 */

/** Fixed simulation step. The host advances in whole steps only. */
export const SIM_STEP_SEC = 1 / 60;
/** Guard against a tab that was backgrounded for a minute. */
export const MAX_CATCHUP_STEPS = 8;

/** Snapshots per second the host broadcasts. */
export const SNAPSHOT_HZ = 20;
/** Guest input sends per second. */
export const INPUT_HZ = 30;
/**
 * Guests render this far behind the host's clock so a late packet holds a real
 * pose instead of extrapolating one. Same value as VORTEX CROWN.
 */
export const INTERPOLATION_DELAY_SEC = 0.1;

// ── Drive model ────────────────────────────────────────────────────────────────

/** Top speed on tarmac, units/sec. One unit ≈ one metre. */
export const BASE_TOP_SPEED = 42;
/** Engine force falls off as the kart approaches its cap. */
export const ENGINE_ACCEL = 30;
/** Braking deceleration while the brake is held. */
export const BRAKE_DECEL = 46;
/** Coasting drag (quadratic term) and rolling resistance (linear term). */
export const DRAG_QUADRATIC = 0.0075;
export const ROLLING_RESISTANCE = 1.9;
/** Reverse cap when the brake is held at a standstill. */
export const REVERSE_TOP_SPEED = 12;

/** Steering, radians/sec at the reference speed. */
export const BASE_TURN_RATE = 2.05;
/** Steering authority scales with speed: none parked, full by this fraction. */
export const TURN_SPEED_REFERENCE = 0.42;
/**
 * How fast the steering input eases toward the stick (per second).
 *
 * This is now the ONLY easing on the path. input.ts used to ramp the keyboard
 * as well, which put ~300 ms between a key and full lock and — worse — did it
 * in a variable that only existed on the machine pressing the key, so a host
 * and a guest smoothed the same driver differently. 8 rather than 9.5 because
 * removing the first stage made the wheel feel abrupt.
 */
export const STEER_LERP = 8;

/** Drift multiplies turn rate and pins the kart into a fixed rotation sense. */
export const DRIFT_TURN_RATE = 2.9;
/**
 * Steering authority while drifting, as a bent line through three points.
 *
 * A single slope could not do this. At 0.28 the outer end still turned at
 * 0.81 rad/s where a fast 50 m corner needs 0.7, so every drift over-rotated
 * and [H4] counted zero mini-turbos; dropping it to 0.06 fixed the count and
 * left the driver with no way to catch a slide at all — hold the wrong way and
 * the kart kept turning, which is most of what "the controls fight me" meant.
 *
 * So: NEUTRAL is what the drift does on its own, INNER tightens it, and OUTER
 * is negative — the wheel actually winds the slide back. Only the neutral-to-
 * inner half is what [H4] measures, so the counter-steer half is free.
 */
export const DRIFT_STEER_INNER = 1;
export const DRIFT_STEER_NEUTRAL = 0.45;
export const DRIFT_STEER_OUTER = -0.15;
/** Steering needed at touchdown to commit a hop into a drift. */
export const DRIFT_LATCH_STEER = 0.12;
/** Minimum speed required to hold a drift. Below it the drift breaks. */
export const DRIFT_MIN_SPEED = 16;
/** Slip angle the body carries while drifting — the visual "sideways" look. */
export const DRIFT_SLIP_ANGLE = 0.52;
/** Charge seconds required per mini-turbo tier. */
export const MINI_TURBO_TIERS: readonly number[] = [0.85, 1.85, 3.05];
/** Boost seconds granted per tier (index matches MINI_TURBO_TIERS). */
export const MINI_TURBO_BOOST: readonly number[] = [0.75, 1.25, 1.95];

/** Boost raises the speed cap and adds a shove. */
export const BOOST_TOP_SPEED_MULT = 1.42;
export const BOOST_ACCEL = 58;
/** Item boost (mushroom) duration. */
export const MUSHROOM_BOOST_SEC = 1.5;
/** Pad boost duration. */
export const PAD_BOOST_SEC = 1.15;
/** A perfect countdown release. */
export const ROCKET_START_BOOST_SEC = 1.6;
/** The window before GO! in which holding accelerate earns the rocket start. */
export const ROCKET_START_WINDOW_SEC = 0.42;
/** Holding accelerate earlier than this burns the engine: a stall instead. */
export const ROCKET_START_BURN_SEC = 1.5;
export const ROCKET_BURN_STALL_SEC = 1.4;

/** Off-road (grass/sand) speed cap and extra scrub. */
export const OFFROAD_SPEED_MULT = 0.46;
export const OFFROAD_FRICTION = 14;
/** How far past the road edge the surface is still solid before the wall. */
export const SHOULDER_WIDTH = 2.6;
/** Wall contact scrubs this fraction of speed and pushes back in. */
export const WALL_SPEED_KEEP = 0.62;
export const WALL_PUSH = 6;

/** Kart-to-kart contact. */
export const KART_RADIUS = 1.35;
export const BUMP_IMPULSE = 9.5;
/** A kart travelling this much faster than the one it hits shoves it aside. */
export const BUMP_SPEED_TRANSFER = 0.22;

/** Gravity for airborne karts (ramps and jumps). */
export const GRAVITY = 34;
/** Steering authority retained in the air. */
export const AIR_CONTROL = 0.35;

// ── Hazards ────────────────────────────────────────────────────────────────────

/** Spin-out: the kart is uncontrollable and decays to this speed. */
export const SPINOUT_SEC = 1.35;
export const SPINOUT_SPEED_KEEP = 0.22;
export const SPINOUT_SPIN_RATE = 13;
/** A squash (bomb, bolt) is longer and harder. */
export const SQUASH_SEC = 2.1;
export const SQUASH_SPEED_KEEP = 0.08;
/** Invulnerability after recovering, so a pile-up is not a death sentence. */
export const HIT_GRACE_SEC = 1.1;

/** Star: untouchable, faster, and it flattens whoever it touches. */
export const STAR_SEC = 6.5;
export const STAR_TOP_SPEED_MULT = 1.3;
export const STAR_ACCEL = 40;

// ── Items ──────────────────────────────────────────────────────────────────────

/** Item boxes go dark for this long after a pickup. */
export const ITEM_BOX_RESPAWN_SEC = 4.5;
/** Roulette spin the winner watches before the item locks in. */
export const ITEM_ROULETTE_SEC = 0.55;

/** Shells. */
export const SHELL_SPEED = 58;
export const SHELL_LIFETIME_SEC = 9;
export const SHELL_RADIUS = 0.85;
/** Red shells steer toward the target at this rate (rad/sec). */
export const RED_SHELL_TURN_RATE = 4.2;
/** Beyond this the red shell has no lock and flies straight. */
export const RED_SHELL_LOCK_RANGE = 170;

/** Bananas sit still until touched. */
export const BANANA_LIFETIME_SEC = 45;
export const BANANA_RADIUS = 1.1;

/** Bombs travel then detonate. */
export const BOMB_SPEED = 40;
export const BOMB_FUSE_SEC = 2.6;
export const BOMB_BLAST_RADIUS = 9.5;

/** The bolt hits everyone ahead of the user. */
export const BOLT_SHRINK_SEC = 5;
export const BOLT_TOP_SPEED_MULT = 0.62;

/** Triple mushroom stock. */
export const TRIPLE_MUSHROOM_CHARGES = 3;

/** Item use is rate-limited so a held trigger cannot empty a stack in a frame. */
export const ITEM_USE_COOLDOWN_SEC = 0.28;

// ── Race ───────────────────────────────────────────────────────────────────────

export const COUNTDOWN_SEC = 3.6;
export const DEFAULT_LAPS = 3;
/** Once the leader finishes, everyone else has this long before a forced end. */
export const FINISH_GRACE_SEC = 24;
/** Hard cap so a stuck race cannot run forever. */
export const MAX_RACE_SEC = 12 * 60;
/** A kart that has not gained progress in this long is respawned on the line. */
export const STUCK_RESPAWN_SEC = 6;
/** Progress (metres) below which "no progress" is still true. */
export const STUCK_PROGRESS_EPSILON = 4;
/** Respawn drops the kart back on the racing line with this much speed. */
export const RESPAWN_SPEED = 8;

/** Checkpoint gates per lap. Passing them out of order does not count. */
export const CHECKPOINT_COUNT = 12;
/**
 * A lap only counts if at least this fraction of the gates were taken in
 * order. Anything less is a cut, and the lap line is ignored.
 */
export const LAP_CHECKPOINT_FRACTION = 0.75;

// ── Weather ────────────────────────────────────────────────────────────────────

export type WeatherKind = "clear" | "rain";
export const WEATHER_KINDS: readonly WeatherKind[] = ["clear", "rain"];
/**
 * Grip multipliers per weather. Ships stage 1 with rain = all ones so the
 * headless gate can prove the field cannot leak into the sim; stage 2 (with
 * protocol v2) turns the real values on and the gate flips to "rain laps
 * are slower".
 */
export const WEATHER_GRIP: Record<
  WeatherKind,
  {
    readonly turn: number;
    readonly brake: number;
    readonly offroad: number;
    /** Top-speed multiplier — spray drag. Without it, careful wet driving
     * (the AI braking earlier) came out FASTER than dry laps. */
    readonly top: number;
  }
> = {
  clear: { turn: 1, brake: 1, offroad: 1, top: 1 },
  rain: { turn: 0.9, brake: 0.8, offroad: 1.3, top: 0.94 },
};

// ── Road surface ───────────────────────────────────────────────────────────────

/**
 * What the road itself is made of, distinct from the weather on top of it.
 * "asphalt" is the surface every circuit had before this existed and its
 * entries are all exactly 1 — a track with no `surfaceZones` is bit-identical
 * to the one that shipped.
 *
 * Discrete on purpose. The road is asphalt or it is dirt; there is no 40 %
 * gravel. `buildTrack` derives the kind per sample once and `querySurface`
 * hands it back without interpolating, because an interpolated surface would
 * be a second source of truth that disagrees with the first at every joint.
 */
export type SurfaceKind = "asphalt" | "dirt" | "gravel" | "wet";

export const SURFACE: Record<
  SurfaceKind,
  {
    /** Top-speed multiplier on this surface. */
    readonly top: number;
    /** Cornering multiplier. Below ~0.86 a 200cc kart cannot hold the line. */
    readonly turn: number;
    /** Extra lateral scrub, added to the base friction. */
    readonly friction: number;
    /** Multiplies the off-road penalty; loose surfaces blur the edge. */
    readonly offroadTop: number;
  }
> = {
  asphalt: { top: 1, turn: 1, friction: 0, offroadTop: 1 },
  dirt: { top: 0.93, turn: 0.9, friction: 1.6, offroadTop: 1.12 },
  gravel: { top: 0.88, turn: 0.86, friction: 2.8, offroadTop: 1.2 },
  wet: { top: 0.95, turn: 0.88, friction: 0.8, offroadTop: 1.05 },
};

// ── Speed classes ──────────────────────────────────────────────────────────────

/**
 * Three numbers per class, not one. Corner radius grows linearly with speed,
 * so a top-speed dial alone sends every CPU (and most humans) off at 200cc;
 * turnScale compensates, and gripScale = speed x turn is what the AI's
 * braking model reads (lateral acceleration is v*omega).
 */
export const SPEED_CLASSES: readonly {
  readonly label: string;
  readonly speedScale: number;
  readonly turnScale: number;
  readonly gripScale: number;
}[] = [
  { label: "100cc", speedScale: 0.85, turnScale: 1.0, gripScale: 0.85 },
  { label: "150cc", speedScale: 1.0, turnScale: 1.0, gripScale: 1.0 },
  { label: "200cc", speedScale: 1.15, turnScale: 1.12, gripScale: 1.288 },
];

// ── Drift hop / slipstream / tricks ────────────────────────────────────────────

/** Small hop when a drift starts (visual weight; physics-neutral progress). */
export const DRIFT_HOP_VY = 5.2;
/**
 * How long that hop lasts. Derived from the arc, never authored — and shared,
 * because the CPU has to know it: the drift now commits on touchdown, so a
 * driver that lets go before then buys a hop and nothing else.
 */
export const DRIFT_HOP_SEC = (2 * DRIFT_HOP_VY) / GRAVITY;
/**
 * EMP reach. Small on purpose: the bolt covers the whole field and is a
 * lottery win, so the thing that strips a boost at close range has to be a
 * decision about who is near you rather than a second bolt.
 */
export const EMP_RADIUS = 22;

/** Slipstream: sit in this cone behind a kart to charge a draft. */
export const DRAFT_RANGE = 13;
export const DRAFT_HALF_ANGLE = 0.42;
export const DRAFT_CHARGE_SEC = 1.0;
export const DRAFT_BOOST_SEC = 1.4;
export const DRAFT_TOP_SPEED_MULT = 1.16;
/** Trick: press drift airborne, land inside the window for a boost. */
export const TRICK_MIN_AIR_SEC = 0.24;
export const TRICK_BOOST_SEC = 0.85;
/** Ramps launch with this vertical speed at full alignment. */
export const RAMP_LAUNCH_VY = 11;

// ── Rubber banding ─────────────────────────────────────────────────────────────

/** Trailing karts get a small draft. 1 = leader, 0 = last place. */
export const CATCHUP_MAX_BONUS = 0.11;
/** CPU skill by level: 1 = tourist, 2 = racer, 3 = rival. */
export const CPU_SKILL: readonly {
  readonly speed: number;
  readonly look: number;
  readonly drift: number;
  readonly itemDelay: number;
  readonly error: number;
}[] = [
  { speed: 0.86, look: 16, drift: 0.35, itemDelay: 1.7, error: 0.34 },
  { speed: 0.95, look: 22, drift: 0.72, itemDelay: 0.9, error: 0.16 },
  { speed: 1.0, look: 27, drift: 0.95, itemDelay: 0.35, error: 0.05 },
];
