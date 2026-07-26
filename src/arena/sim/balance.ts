/**
 * Every tunable number that is not a property of a specific part lives here.
 * Implementers: do not inline these anywhere else. When a match feels wrong the
 * fix has to be findable in one file, and the headless gate sweeps these.
 */

import type { TrapKind } from "./types";

/** Physics runs at a fixed step. Never pass a wall-clock delta to the sim. */
export const FIXED_DT = 1 / 60;
export const SNAPSHOT_HZ = 20;
export const INPUT_HZ = 30;
/** how far behind live the guest renders remote bots, to hide jitter */
export const INTERP_DELAY = 0.1;

export const MASS_LIMIT = 120;
export const COUNTDOWN_SEC = 3;
export const MATCH_SEC = 180;

/** Newton-seconds to hit points. Tuned so a good spinner hit is ~60-90 damage. */
export const IMPACT_SCALE = 0.42;
/** A single contact can never do more than this, however absurd the impulse. */
export const MAX_HIT_DAMAGE = 140;
/** Impacts below this impulse are scenery, not damage. */
export const MIN_HIT_IMPULSE = 3.5;
/** Same attacker/defender pair cannot be scored again within this window. */
export const CONTACT_COOLDOWN = 0.12;
/** Bodies with no weapon still hurt when rammed hard. */
/*
 * Bare-hull ramming. Kept low on purpose: with the heavy-collision response
 * added in v3, ramming grew to 52% of all damage dealt across the 20-match
 * suite and out-damaged every fitted weapon, which makes a 72-part catalogue
 * pointless. Collisions should still feel heavy — that is what the
 * HEAVY_COLLISION_* constants are for — but the damage should come from what
 * you bolted on.
 */
export const RAM_FACTOR = 0.18;
/** A spinner at rest is nearly harmless; this is the floor of its damage curve. */
export const SPIN_DAMAGE_FLOOR = 0.25;

/* ---------------- weapon systems (v2) ---------------- */

/** Grind and clamp damage is applied on a tick rather than per contact. */
export const SUSTAINED_TICK = 0.2;
/** A flame hit keeps burning after the jet moves off. */
export const BURN_SEC = 2.5;
export const BURN_DPS = 9;
/** Fire ignores plate; only a heat shield helps. */
export const FLAME_ARMOR_FACTOR = 0.15;
/** A clamp releases early if the victim rips free this hard. */
export const CLAMP_BREAK_IMPULSE = 260;
/** Extra damage a spear does for punching a single point. */
export const SPEAR_PIERCE = 1.6;
/** Triggered weapons cannot be spammed mid-stroke. */
export const MIN_TRIGGER_GAP = 0.25;
/** Held weapons that run dry need this long before they can be used again. */
export const DRY_LOCKOUT = 1.5;

/** KO by immobility. */
export const IMMOBILE_SPEED = 0.15;
export const IMMOBILE_WEAPON_OMEGA = 1;
export const IMMOBILE_SEC = 10;
/** Enemy holds freeze the KO clock; after release it resumes from the frozen value. */
export const DISABLE_GRACE_SEC = 1.5;
/** One second of an enemy hold is worth one second of ordinary pushing. */
export const DISABLE_CONTROL_RATE = 1;
/** Below this height the bot has gone into the pit. */
export const PIT_Y = -1.5;
/** Chassis up-vector dot world-up below this counts as inverted. */
export const INVERTED_DOT = -0.2;
export const SELF_RIGHT_COOLDOWN = 8;
export const SELF_RIGHT_IMPULSE = 900;

/** Judge weights, BattleBots style, summing to 10. */
export const JUDGE_DAMAGE = 5;
export const JUDGE_AGGRESSION = 3;
export const JUDGE_CONTROL = 2;
/** Metres of closing movement that counts as one aggression point-unit. */
export const AGGRESSION_UNIT = 1;
/** Seconds of pushing a rival that counts as one control point-unit. */
export const CONTROL_UNIT = 1;
/** A rival must be within this to count as being controlled. */
export const CONTROL_RANGE = 1.4;

/* ---------------- deployables and projectiles (v5) ---------------- */

export const DEPLOY_PAD_HALF_HEIGHT = 0.012;
/**
 * Footprint of each trap, in metres. The collider and the mesh both read this
 * table, and entityVisualSelftest fails if they ever disagree by more than a
 * millimetre: a trap the player can see but not the size of is a trap that
 * punishes them for reading the screen correctly.
 */
export const TRAP_RADIUS: Record<TrapKind, number> = {
  caltrop: 0.22,
  mine: 0.3,
  oil: 0.55,
  glue: 0.42
};
export const DEPLOY_CAP_PER_SEAT = 5;
export const DEPLOY_CAP_GLOBAL = 20;
export const DEPLOY_TTL = 25;
export const DEPLOY_MIN_SPACING = 0.45;
export const CALTROP_DAMAGE = 15;
export const CALTROP_HITS = 6;
export const MINE_ARM_SEC = 1;
export const MINE_DAMAGE = 120;
export const MINE_IMPULSE = 720;
export const GLUE_SEC = 3;
export const OIL_CONTACT_SEC = 0.12;
export const OIL_TRACTION_MUL = 0.18;

export const PROJECTILE_CAP = 4;
export const PROJECTILE_TTL = 2.2;
export const NET_SEC = 3;
export const NET_LINEAR_DAMPING = 5.5;
export const NET_ANGULAR_DAMPING = 4;
export const TETHER_MIN_LEN = 0.9;
export const TETHER_MAX_LEN = 4;
export const TETHER_MAX_FORCE = 1800;
export const TETHER_BREAK_IMPULSE = 340;

/** Five-second deployable keyframes at the 20 Hz snapshot cadence. */
export const DEP_KEYFRAME_TICKS = 100;

/**
 * Stalemate breaking. Two robots pressed together generate almost no contact
 * force, so nobody scores and the match dies on its feet. When a bot has been
 * this close for this long with no damage either way, it backs off and charges
 * again — which is also the only way a spinner gets its speed back.
 */
export const STALEMATE_RANGE = 2.6;
export const STALEMATE_SEC = 1.6;
export const DISENGAGE_SEC = 1.1;

/** Drive model. */
export const STEER_TORQUE = 42;
export const DRIVE_LINEAR_DAMPING = 0.18;
export const DRIVE_ANGULAR_DAMPING = 0.9;
/**
 * Rapier's point contacts can lose all motor traction when another fitted
 * collider brushes the floor. This bounded assist represents the tyre/track
 * contact patch and is still limited by fitted axle torque and top speed.
 */
export const DRIVE_TRACTION_ASSIST = 0.35;
/**
 * Legs (v4). A leg is a hub carrying `DriveDef.feet` capsule spokes on ONE
 * rigid body with ONE revolute joint — physically identical topology to a
 * wheel, so driver.ts, damage.ts and the wire format need no leg branch.
 *
 * These two fractions of DriveDef.radius are the only free numbers in the spoke:
 * the capsule's thickness, and how far in toward the axle its inner end reaches.
 * The tip distance is NOT tuned — ARCHITECTURE_V4 §6.4 fixes it at exactly
 * `radius` and legSpokeLayout() in build.ts derives the centre offset
 * `d = radius - halfHeight - capsuleRadius` from that. One formula, one file.
 */
export const LEG_SPOKE_RADIUS_FRAC = 0.17;
export const LEG_HUB_FRAC = 0.22;
/**
 * What a leg's `DriveDef.tractionAssist` should be (contract L5). It is
 * catalogue data, not a fallback: assemble/driver read
 * `def.tractionAssist ?? DRIVE_TRACTION_ASSIST` exactly as the contract states,
 * so a leg that omits the field gets the wheel value and skates through the air
 * between footfalls. This constant exists so the catalogue has one number to
 * copy rather than five guesses.
 */
export const LEG_TRACTION_ASSIST = 0.12;
/**
 * Extra hull clearance beyond a leg's static sink depth.
 *
 * The inscribed-circle figure driveSinkDepth() returns is the worst case for
 * ONE axle held still. A walking machine also pitches, because the front and
 * rear legs on a side are half a step apart, so the hull corners dip below what
 * the static number predicts. Measured on the three shipped leg presets,
 * percentage of live frames with the hull touching the floor:
 *
 *   margin   leg-walker   leg-stomper   leg-spire
 *   1.00        24.2%         3.1%         5.3%
 *   1.35         9.4%         2.2%         0.0%
 *   1.70         0.8%         0.6%         0.0%
 *
 * 1.7 is where the sparsest star in the catalogue (leg-walker, 3 feet) stops
 * scraping. Travel over the same six seconds does not drop.
 */
export const LEG_HULL_MARGIN = 1.7;
/**
 * Hard ceiling on PlacedPart.level, well above any chassis maxLevels. This is
 * not balance — it is the bound that keeps a storey number from being a lever.
 * levelRises() builds one array entry per storey, and the host runs it on a
 * guest's spec before any validation rejects the level, so an unbounded
 * `level: 1e9` would allocate gigabytes on the host and hang the room.
 */
export const MAX_BUILD_LEVEL = 8;
/**
 * Most drives one machine may fit. The shipped presets use two to four; twelve
 * leaves room for a hexapod and then some.
 *
 * This is a wire bound as much as a design one. BotSnap.wp carries one float
 * per drive, and the deck of chassis-fortress geometrically takes 231
 * one-cell wheels — so without a cap the size of every snapshot in the room is
 * set by whatever a guest chose to build, which is the same shape of defect as
 * an unbounded storey number.
 */
export const MAX_DRIVES = 12;
/** DC motors deliver peak mechanical output at one quarter stall torque × free speed. */
export const DRIVE_POWER_DUTY = 0.25;
/** Even under a spinner load, this fraction of plant output remains available to drive. */
export const POWER_DRIVE_RESERVE = 0.45;
/** Avoid the P/omega singularity while a rotary weapon is starting from rest. */
export const OMEGA_KNEE_MIN = 1.0;
/** Builder limit for the energy-based rotary-weapon acceleration estimate. */
export const MAX_SPINUP_SEC = 12;
export const SELF_RIGHT_CHARGE_KJ = 6;
export const IMPULSE_KJ_DIVISOR = 200;
export const FUEL_L_PER_SEC = 0.25;
export const HEAT_FRACTION = 0.30;
export const FLAME_HEAT_W_PER_DPS = 25;
export const HEAT_CAP_J = 45_000;
export const HEAT_DERATE_START = 0.60;
export const HEAT_DERATE_MAX = 0.55;
/**
 * Fraction of fitted tyre/track yaw grip reserved for cancelling unintended
 * chassis rotation while the driver is not steering.
 */
export const YAW_HOLD_ASSIST = 0.55;

/**
 * Seconds for a rotary weapon's commanded speed to travel from zero to its
 * configured maximum (and back to zero). R2 replaces this with a power-based
 * calculation, so driver.ts must read this single value rather than embedding
 * a ramp rate.
 */
export const WEAPON_SPINUP_SEC = 2.2;

/** Bot-on-bot contacts should lose speed like heavy steel, not billiard balls. */
export const BOT_COLLISION_RESTITUTION = 0.04;
export const BOT_COLLISION_FRICTION = 1.35;
/** Minimum impact before the extra heavy-collision response is applied. */
export const HEAVY_COLLISION_IMPULSE = 18;
/** Fractional velocity loss at a threshold impact (stronger hits lose more). */
export const HEAVY_COLLISION_SPEED_LOSS = 0.22;
/** Converts an off-centre impact impulse into visible pitch/roll/yaw. */
export const HEAVY_COLLISION_ANGULAR_IMPULSE = 0.16;

/** Arena hazards. */
export const SAW_OMEGA = 46;
export const SAW_DAMAGE = 14;
export const WALL_RESTITUTION = 0.18;

/** Debris cleanup so long matches do not accumulate bodies forever. */
export const DEBRIS_LIFETIME = 12;
export const MAX_DEBRIS = 24;
