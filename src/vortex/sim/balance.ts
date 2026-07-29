export const FIXED_HZ = 60;
export const FIXED_DT = 1 / FIXED_HZ;
export const SNAPSHOT_HZ = 20;
export const SNAPSHOT_EVERY_TICKS = FIXED_HZ / SNAPSHOT_HZ;

export const DEFAULT_COUNTDOWN_SEC = 2.25;
export const DEFAULT_SUDDEN_DEATH_SEC = 120;
export const DEFAULT_MAX_DURATION_SEC = 240;

export const GRAVITY = -18;
export const CONTACT_COOLDOWN_SEC = 0.075;
/*
 * 0.18 made destruction a fiction. Measured over 20 representative 1v1s
 * (makeCpuBuild picks, 1000 cost, all five arenas): median contact damage 5
 * against 502 hp — one percent per solid hit. 47 impacts across a full match
 * failed to destroy anyone; the only two destructions happened at the 240s
 * sudden-death chassis-stress wall. Every attack stat, every heavy build,
 * every aggressive line of play was cosmetic. At 0.5 a committed aggressor
 * lands ~14 per hit and can actually finish a tank inside regulation, while
 * ring-out remains the faster kill for mobile builds.
 */
export const CONTACT_DAMAGE_SCALE = 0.5;
export const CONTACT_DAMAGE_THRESHOLD = 1;
export const MAX_CONTACT_DAMAGE = 60;
export const OUTSIDE_FALL_Y = -2.25;
export const OUTSIDE_MARGIN = 0.35;

export const BASE_TRACKING_FORCE = 3.6;
/*
 * Launch guard. The same 20-match measurement found seven regulation matches
 * decided in under 8 seconds — several at 1.5-3s on one impact, because the
 * launch transient carries enough momentum that the first touch flings a top
 * over the lip before the match has meant anything. For the first
 * EDGE_EARLY_GUARD_SEC the centre rescue is reinforced; after that the rim
 * is exactly as lethal as before. All 18 measured ring-outs followed a hit
 * (0.4-5.0s after), so mid-game lethality is the identity being preserved,
 * not the defect being fixed.
 */
export const EDGE_EARLY_GUARD_SEC = 8;
export const EDGE_EARLY_GUARD_BONUS = 0.55;
/*
 * The steering bonus alone measured 7 → 6 sub-8s finishes: a launch fling is
 * momentum, and a steering force cannot cancel momentum in the half second
 * before the lip. During the guard window the rim therefore also BRAKES:
 * beyond 86% radius, outward radial velocity is damped with this per-second
 * coefficient. Zero effect on inward motion, on the mid-game, or on anything
 * after EDGE_EARLY_GUARD_SEC.
 */
export const EDGE_GUARD_BRAKE_RADIUS = 0.8;
export const EDGE_GUARD_BRAKE_PER_SEC = 16;
export const BASE_GYRO_TORQUE = 8;
export const BASE_SPIN_DRAIN = 0.34;
export const MIN_LIVE_SPIN = 0.5;

export const MAX_CATCHUP_STEPS = 5;
export const SKILL_INPUT_HZ = 20;
export const INTERPOLATION_DELAY_SEC = 0.1;
