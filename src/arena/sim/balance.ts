/**
 * Every tunable number that is not a property of a specific part lives here.
 * Implementers: do not inline these anywhere else. When a match feels wrong the
 * fix has to be findable in one file, and the headless gate sweeps these.
 */

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
export const RAM_FACTOR = 0.35;
/** A spinner at rest is nearly harmless; this is the floor of its damage curve. */
export const SPIN_DAMAGE_FLOOR = 0.25;

/** KO by immobility. */
export const IMMOBILE_SPEED = 0.15;
export const IMMOBILE_WEAPON_OMEGA = 1;
export const IMMOBILE_SEC = 10;
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

/** Arena hazards. */
export const SAW_OMEGA = 46;
export const SAW_DAMAGE = 14;
export const WALL_RESTITUTION = 0.18;

/** Debris cleanup so long matches do not accumulate bodies forever. */
export const DEBRIS_LIFETIME = 12;
export const MAX_DEBRIS = 24;
