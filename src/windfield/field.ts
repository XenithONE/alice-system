/**
 * The field's dimensions, its quality tiers, and the one function that decides
 * which way "forward" is.
 *
 * No three.js in here, for the same reason src/gallery/curve.ts has none: the
 * headless gates below have to be able to check every one of these facts in
 * Node, without a GPU. What cannot be checked cannot be trusted, and a walking
 * control that is wrong by a sign is not something a screenshot will tell you.
 */

/* ── the ground ─────────────────────────────────────────────────────────── */

export const FIELD = {
  /** Metres across, square, centred on the origin. */
  size: 96,
  /**
   * Heightfield resolution — and the resolution of the visible ground mesh,
   * which is the same number on purpose.
   *
   * A 1024-post field with a 256-post mesh would have been cheaper and would
   * have put the player's feet at a different height from the ground they can
   * see, on every slope, by up to the sag of a 37 cm span. That is the SCRAP
   * CROWN defect with the numbers changed. One resolution, one surface: 512
   * posts over 96 m is 18.8 cm apart, finer than a footstep, 1 MB read back
   * exactly once, and 522,242 triangles of ground.
   */
  grid: 512,
  /** Peak-to-trough of the terrain, metres. */
  relief: 5.2
} as const;

export const cellSize = (): number => FIELD.size / (FIELD.grid - 1);

/** World X/Z of a grid post. */
export function postAt(ix: number, iz: number): { x: number; z: number } {
  const step = cellSize();
  return { x: -FIELD.size / 2 + ix * step, z: -FIELD.size / 2 + iz * step };
}

/**
 * Ground height at a world position, by bilinear interpolation of the
 * heightfield.
 *
 * ⭐ This is THE definition of where the ground is. The terrain is generated
 * once by a compute shader, read back once, and this reads that array — the
 * CPU never re-derives the FBM. It cannot: there is no second implementation
 * to drift from the first.
 *
 * SCRAP CROWN built its walls and its colliders in two loops that "did the
 * same thing"; at low detail they disagreed by 0.747 m and players on weak
 * machines walked through a wall they could see. The player's feet and the
 * roots of the grass come out of the same bytes here, so the only way they can
 * disagree is if this function is wrong for both of them at once — which is
 * visible rather than silent.
 */
export function heightAt(field: Float32Array, x: number, z: number): number {
  const step = cellSize();
  const fx = (x + FIELD.size / 2) / step;
  const fz = (z + FIELD.size / 2) / step;
  const max = FIELD.grid - 1;
  const x0 = Math.min(Math.max(Math.floor(fx), 0), max);
  const z0 = Math.min(Math.max(Math.floor(fz), 0), max);
  const x1 = Math.min(x0 + 1, max);
  const z1 = Math.min(z0 + 1, max);
  const tx = Math.min(Math.max(fx - x0, 0), 1);
  const tz = Math.min(Math.max(fz - z0, 0), 1);

  const h00 = field[z0 * FIELD.grid + x0]!;
  const h10 = field[z0 * FIELD.grid + x1]!;
  const h01 = field[z1 * FIELD.grid + x0]!;
  const h11 = field[z1 * FIELD.grid + x1]!;
  return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
}

/** Uphill direction and steepness at a world position, from the same array. */
export function slopeAt(field: Float32Array, x: number, z: number): { dx: number; dz: number } {
  const h = cellSize();
  return {
    dx: (heightAt(field, x + h, z) - heightAt(field, x - h, z)) / (2 * h),
    dz: (heightAt(field, x, z + h) - heightAt(field, x, z - h)) / (2 * h)
  };
}

/* ── which way is forward ───────────────────────────────────────────────── */

/**
 * Every trigonometric fact about walking, in one place.
 *
 * Yaw is measured the way three.js measures it for an object looking down its
 * own -Z: 0 faces -Z, and it increases toward -X (counter-clockwise seen from
 * above). Scattering `Math.sin(yaw)` and `Math.cos(yaw)` through a movement
 * file, a camera file and an animation file is how a game ends up strafing
 * into the screen — every one of them is individually plausible and only the
 * combination is wrong. ARENA already learned this and has a headingSelftest;
 * this is the same shape.
 */
export function facing(yaw: number): { x: number; z: number } {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/** The walker's right hand. cross(facing, up) for a Y-up right-handed world. */
export function strafe(yaw: number): { x: number; z: number } {
  return { x: Math.cos(yaw), z: -Math.sin(yaw) };
}

/** The yaw that would face a world direction. Inverse of facing(). */
export function yawTowards(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/** Shortest signed turn from a to b, in radians. */
export function turnTo(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/* ── quality ────────────────────────────────────────────────────────────── */

/**
 * A type of its own, not an extension of HeroQuality.
 *
 * HeroQuality speaks in `radialSegments` and `tubularSegments` — the language
 * of a torus knot, and meaningless to a field of grass. kart/render/quality.ts
 * made the same call for the same reason. What a grassland needs to know is
 * how many blades it can afford and how far it can draw them.
 */
export interface GpuQuality {
  readonly tier: "high" | "balanced" | "low";
  /** Square root of the blade count: 1024 means 1,048,576 blades. */
  readonly bladeRoot: number;
  /** Metres. Past this there is no grass, only the ground. */
  readonly bladeRange: number;
  readonly dpr: number;
  /** Multisampling on the scene pass. 0 disables it. */
  readonly samples: 0 | 4;
  readonly post: boolean;
  readonly maxFps: 60 | 30;
  /** 0 freezes the wind, the clouds and the camera drift — never the walking. */
  readonly motionScale: 0 | 1;
  readonly coarse: boolean;
}

const TIERS: Record<GpuQuality["tier"], Omit<GpuQuality, "tier" | "motionScale" | "coarse" | "dpr">> = {
  /*
   * 1,048,576 blades over 96 m is 9.4 cm apart. The estimate that justified it:
   * compute 1.5-2.0 ms + vertex 1.5-2.5 + raster 1.5-2.5 + fragment 1.5-2.0 +
   * post 2.0-2.5 = 8.0-11.5 ms against a 16.6 ms budget. Estimates are not
   * measurements, which is why the tier ladder below exists and why the page
   * ships at the balanced root until a p95 has been recorded.
   */
  high: { bladeRoot: 1024, bladeRange: 46, samples: 4, post: true, maxFps: 60 },
  balanced: { bladeRoot: 896, bladeRange: 38, samples: 4, post: true, maxFps: 60 },
  /* No MSAA and no post: the two whole passes a weak GPU should not be running
     at all. The grass thins rather than disappearing — a field with no grass in
     it is not a cheaper version of this page, it is a different one. */
  low: { bladeRoot: 512, bladeRange: 26, samples: 0, post: false, maxFps: 30 }
};

export function buildQuality(
  tier: GpuQuality["tier"],
  reducedMotion: boolean,
  coarse: boolean,
  devicePixelRatio: number
): GpuQuality {
  const table = TIERS[tier];
  return {
    tier,
    ...table,
    /* A grass blade is a two-triangle sliver; past 1.5x the extra fragments buy
       almost nothing and cost linearly. Phones get the same ceiling rather than
       a bump, because unlike a still hero this page is already GPU-bound. */
    dpr: Math.min(coarse ? 1.5 : 1.6, devicePixelRatio || 1),
    maxFps: reducedMotion ? 30 : table.maxFps,
    /*
     * ⭐ What motionScale 0 means here, precisely: the wind stops, the clouds
     * stop, the camera stops drifting. WALKING DOES NOT. A reader who presses
     * a key has asked for that motion; reduced-motion is about movement they
     * did not ask for. Turning the page into a poster would be answering a
     * different request.
     */
    motionScale: reducedMotion ? 0 : 1,
    coarse
  };
}

/** Blades at a given tier. Exported so the gate can check the arithmetic. */
export const bladeCount = (q: GpuQuality): number => q.bladeRoot * q.bladeRoot;

/**
 * GPU bytes for the blade buffer: four vec4 per blade, one packed buffer.
 *
 * One buffer rather than four, because the WebGPU default limit is eight
 * storage buffers per shader stage and the compute pass already needs the
 * heightfield, the trail and two counters. Four separate attribute buffers
 * would have made eleven bindings — over the limit, on every device, and
 * discovered at run time.
 */
export const bladeBytes = (q: GpuQuality): number => bladeCount(q) * 4 * 4 * 4;
