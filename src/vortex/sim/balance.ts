export const FIXED_HZ = 60;
export const FIXED_DT = 1 / FIXED_HZ;
export const SNAPSHOT_HZ = 20;
export const SNAPSHOT_EVERY_TICKS = FIXED_HZ / SNAPSHOT_HZ;

export const DEFAULT_COUNTDOWN_SEC = 2.25;
export const DEFAULT_SUDDEN_DEATH_SEC = 120;
export const DEFAULT_MAX_DURATION_SEC = 240;

export const GRAVITY = -18;
export const CONTACT_COOLDOWN_SEC = 0.075;
export const CONTACT_DAMAGE_SCALE = 0.18;
export const CONTACT_DAMAGE_THRESHOLD = 1;
export const MAX_CONTACT_DAMAGE = 42;
export const OUTSIDE_FALL_Y = -2.25;
export const OUTSIDE_MARGIN = 0.35;

export const BASE_TRACKING_FORCE = 3.6;
export const BASE_GYRO_TORQUE = 8;
export const BASE_SPIN_DRAIN = 0.34;
export const MIN_LIVE_SPIN = 0.5;

export const MAX_CATCHUP_STEPS = 5;
export const SKILL_INPUT_HZ = 20;
export const INTERPOLATION_DELAY_SEC = 0.1;
