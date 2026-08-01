/**
 * The track — ONE definition, read by the simulation and by the renderer.
 *
 * SCRAP CROWN shipped an arena whose walls and colliders were built by two
 * different loops; they agreed at high detail and drifted 0.747 m at low, so
 * low-spec machines walked through the wall. Nothing here may be duplicated:
 * `buildTrack` is the only thing that turns a `TrackSpec` into geometry, and
 * both the road mesh and the surface query read the same `samples` array.
 */

import { CHECKPOINT_COUNT } from "./balance";

export interface TrackControlPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Full road width at this point (metres). */
  readonly width: number;
}

export interface BoostPadSpec {
  /** Position along the lap, 0..1. */
  readonly at: number;
  /** Lateral offset in half-widths, -1 (left edge) .. 1 (right edge). */
  readonly offset: number;
  /** Pad half-length along the road, metres. */
  readonly length?: number;
  /** Pad half-width across the road, metres. */
  readonly width?: number;
}

export interface ItemBoxRowSpec {
  readonly at: number;
  /** Lateral offsets in half-widths. */
  readonly offsets: readonly number[];
}

export interface RampSpec {
  /** Position along the lap, 0..1. */
  readonly at: number;
  /** Lateral offset in half-widths, -1..1. */
  readonly offset: number;
  /** Half-width across the road, metres. */
  readonly width?: number;
}

export interface TrackSpec {
  readonly id: string;
  readonly name: string;
  readonly nameJa: string;
  readonly blurb: string;
  readonly points: readonly TrackControlPoint[];
  readonly itemBoxes: readonly ItemBoxRowSpec[];
  readonly boostPads: readonly BoostPadSpec[];
  readonly ramps?: readonly RampSpec[];
  /** Visual identity. The renderer reads these; the sim ignores them. */
  readonly theme: TrackTheme;
}

export interface TrackTheme {
  /** Sky gradient, horizon → zenith. */
  readonly skyLow: number;
  readonly skyHigh: number;
  readonly sunColor: number;
  /** Sun direction (will be normalised). */
  readonly sunDir: readonly [number, number, number];
  readonly sunIntensity: number;
  readonly ambient: number;
  readonly fog: number;
  readonly fogDensity: number;
  readonly road: number;
  readonly roadEdge: number;
  readonly rail: number;
  readonly ground: number;
  readonly groundAccent: number;
  /** Roadside prop family the scene builder plants. */
  readonly props: "palm" | "neon" | "topiary";
  readonly bloom: number;
  /** 0..1 starfield density in the sky shader (render-only). */
  readonly stars: number;
  /** Night circuits get kart headlights and emissive-forward dressing. */
  readonly night: boolean;
}

export interface TrackSample {
  /** Centreline position. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Unit tangent (direction of travel) in the XZ plane. */
  readonly tx: number;
  readonly tz: number;
  /** Unit right vector in the XZ plane (tangent rotated -90°). */
  readonly rx: number;
  readonly rz: number;
  /** Half width of the drivable road here. */
  readonly half: number;
  /** Arc length from the start line. */
  readonly s: number;
  /** Signed curvature, 1/metres. Positive turns right. */
  readonly curvature: number;
  /** Banking angle, radians, derived from curvature (never hand-authored). */
  readonly bank: number;
  /** Slope of the centreline, radians. Positive climbs. */
  readonly pitch: number;
}

export interface BoostPad {
  readonly s: number;
  readonly lateral: number;
  readonly halfLength: number;
  readonly halfWidth: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

export interface ItemBoxPlacement {
  readonly index: number;
  readonly s: number;
  readonly lateral: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Ramp {
  readonly s: number;
  readonly lateral: number;
  readonly halfWidth: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

export interface Track {
  readonly spec: TrackSpec;
  readonly samples: readonly TrackSample[];
  /** Arc length of one lap. */
  readonly length: number;
  /** Spacing between samples (metres). */
  readonly step: number;
  readonly checkpoints: readonly number[];
  readonly itemBoxes: readonly ItemBoxPlacement[];
  readonly boostPads: readonly BoostPad[];
  readonly ramps: readonly Ramp[];
  /** Widest half width anywhere — used to size the render bounds. */
  readonly maxHalf: number;
  readonly bounds: {
    readonly minX: number;
    readonly maxX: number;
    readonly minZ: number;
    readonly maxZ: number;
    readonly minY: number;
    readonly maxY: number;
  };
}

export interface SurfaceQuery {
  /** Index of the nearest sample. */
  readonly index: number;
  /** Arc length at the projection, 0..length. */
  readonly s: number;
  /** Signed distance right of the centreline. */
  readonly lateral: number;
  /** Road half width at the projection. */
  readonly half: number;
  /** Surface height under the query point (includes banking). */
  readonly height: number;
  /** Centreline heading, radians (atan2(tx, tz) convention below). */
  readonly heading: number;
  readonly curvature: number;
  readonly bank: number;
  readonly pitch: number;
  /** |lateral| <= half */
  readonly onRoad: boolean;
  /** |lateral| <= half + shoulder — still ground, but slow. */
  readonly onGround: boolean;
}

/** Sample spacing. Fine enough that a 42 u/s kart never skips a sample. */
export const TRACK_STEP = 2;
/** Subdivisions per control-point segment before arc-length resampling. */
const SPLINE_SUBDIVISIONS = 48;
/**
 * Banking: a corner of curvature k banks toward the inside, capped so the road
 * never becomes a wall. Derived, never authored — a hand-written bank angle is
 * a second source of truth for the same corner.
 */
const BANK_PER_CURVATURE = 5.2;
const MAX_BANK = 0.3;

function catmullRom(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

interface DensePoint {
  x: number;
  y: number;
  z: number;
  width: number;
  s: number;
}

/**
 * The heading convention, stated once so nothing re-derives it.
 * A kart at yaw θ faces (sin θ, cos θ). Its right hand is (cos θ, -sin θ).
 * `headingOf` and `forwardOf` are inverses; every consumer must use them
 * rather than writing its own trigonometry (VORTEX/HARBOR both shipped a
 * sign-flipped copy of exactly this).
 */
export function headingOf(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

export function forwardOf(yaw: number): readonly [number, number] {
  return [Math.sin(yaw), Math.cos(yaw)];
}

export function rightOf(yaw: number): readonly [number, number] {
  return [Math.cos(yaw), -Math.sin(yaw)];
}

/** Shortest signed angle from `from` to `to`, in (-π, π]. */
export function angleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta <= -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function buildTrack(spec: TrackSpec, step = TRACK_STEP): Track {
  const control = spec.points;
  if (control.length < 4) {
    throw new Error(`Track ${spec.id} needs at least 4 control points`);
  }

  // 1. Dense polyline through the closed Catmull-Rom spline.
  const dense: DensePoint[] = [];
  let running = 0;
  for (let i = 0; i < control.length; i += 1) {
    const p0 = control[(i - 1 + control.length) % control.length]!;
    const p1 = control[i]!;
    const p2 = control[(i + 1) % control.length]!;
    const p3 = control[(i + 2) % control.length]!;
    for (let sub = 0; sub < SPLINE_SUBDIVISIONS; sub += 1) {
      const t = sub / SPLINE_SUBDIVISIONS;
      const x = catmullRom(p0.x, p1.x, p2.x, p3.x, t);
      const y = catmullRom(p0.y, p1.y, p2.y, p3.y, t);
      const z = catmullRom(p0.z, p1.z, p2.z, p3.z, t);
      const width = catmullRom(p0.width, p1.width, p2.width, p3.width, t);
      const previous = dense[dense.length - 1];
      if (previous) {
        running += Math.hypot(x - previous.x, z - previous.z);
      }
      dense.push({ x, y, z, width, s: running });
    }
  }
  const first = dense[0]!;
  const last = dense[dense.length - 1]!;
  const total = running + Math.hypot(first.x - last.x, first.z - last.z);

  // 2. Resample at uniform arc length so the sim can index by distance.
  const count = Math.max(16, Math.round(total / step));
  const spacing = total / count;
  const positions: { x: number; y: number; z: number; width: number }[] = [];
  let cursor = 0;
  for (let i = 0; i < count; i += 1) {
    const target = i * spacing;
    while (
      cursor < dense.length - 1 &&
      dense[cursor + 1]!.s <= target
    ) {
      cursor += 1;
    }
    const a = dense[cursor]!;
    const b = dense[(cursor + 1) % dense.length]!;
    const segment = (b.s > a.s ? b.s : total) - a.s;
    const t = segment <= 1e-6 ? 0 : (target - a.s) / segment;
    positions.push({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
      width: a.width + (b.width - a.width) * t,
    });
  }

  // 3. Tangents, curvature, banking. Central differences on the closed ring.
  const samples: TrackSample[] = [];
  const headings: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const prev = positions[(i - 1 + count) % count]!;
    const next = positions[(i + 1) % count]!;
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    headings.push(headingOf(dx, dz));
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let maxHalf = 0;
  for (let i = 0; i < count; i += 1) {
    const point = positions[i]!;
    const heading = headings[i]!;
    const [tx, tz] = forwardOf(heading);
    const [rx, rz] = rightOf(heading);
    const nextHeading = headings[(i + 1) % count]!;
    const prevHeading = headings[(i - 1 + count) % count]!;
    const curvature = angleDelta(prevHeading, nextHeading) / (2 * spacing);
    const prev = positions[(i - 1 + count) % count]!;
    const next = positions[(i + 1) % count]!;
    const pitch = Math.atan2(next.y - prev.y, 2 * spacing);
    const half = point.width / 2;
    maxHalf = Math.max(maxHalf, half);
    minX = Math.min(minX, point.x - half);
    maxX = Math.max(maxX, point.x + half);
    minZ = Math.min(minZ, point.z - half);
    maxZ = Math.max(maxZ, point.z + half);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
    samples.push({
      x: point.x,
      y: point.y,
      z: point.z,
      tx,
      tz,
      rx,
      rz,
      half,
      s: i * spacing,
      curvature,
      bank: Math.max(
        -MAX_BANK,
        Math.min(MAX_BANK, curvature * BANK_PER_CURVATURE),
      ),
      pitch,
    });
  }

  const length = count * spacing;

  const checkpoints: number[] = [];
  for (let i = 0; i < CHECKPOINT_COUNT; i += 1) {
    checkpoints.push(Math.round((i / CHECKPOINT_COUNT) * count) % count);
  }

  const partial: Track = {
    spec,
    samples,
    length,
    step: spacing,
    checkpoints,
    itemBoxes: [],
    boostPads: [],
    ramps: [],
    maxHalf,
    bounds: { minX, maxX, minZ, maxZ, minY, maxY },
  };

  const itemBoxes: ItemBoxPlacement[] = [];
  for (const row of spec.itemBoxes) {
    for (const offset of row.offsets) {
      const s = ((row.at % 1) + 1) % 1 * length;
      const sample = sampleAt(partial, s);
      const lateral = offset * sample.half;
      itemBoxes.push({
        index: itemBoxes.length,
        s,
        lateral,
        x: sample.x + sample.rx * lateral,
        y: surfaceHeight(sample, lateral),
        z: sample.z + sample.rz * lateral,
      });
    }
  }

  const boostPads: BoostPad[] = spec.boostPads.map((pad) => {
    const s = ((pad.at % 1) + 1) % 1 * length;
    const sample = sampleAt(partial, s);
    const lateral = pad.offset * sample.half;
    return {
      s,
      lateral,
      halfLength: pad.length ?? 4,
      halfWidth: pad.width ?? Math.max(1.6, sample.half * 0.33),
      x: sample.x + sample.rx * lateral,
      y: surfaceHeight(sample, lateral),
      z: sample.z + sample.rz * lateral,
      yaw: headingOf(sample.tx, sample.tz),
    };
  });

  const ramps: Ramp[] = (spec.ramps ?? []).map((ramp) => {
    const s = ((ramp.at % 1) + 1) % 1 * length;
    const sample = sampleAt(partial, s);
    const lateral = ramp.offset * sample.half;
    return {
      s,
      lateral,
      halfWidth: ramp.width ?? Math.max(2.2, sample.half * 0.3),
      x: sample.x + sample.rx * lateral,
      y: surfaceHeight(sample, lateral),
      z: sample.z + sample.rz * lateral,
      yaw: headingOf(sample.tx, sample.tz),
    };
  });

  return { ...partial, itemBoxes, boostPads, ramps };
}

/**
 * The true world mirror of a circuit.
 *
 * Negating the control points' x is NOT enough: the tangent flips to
 * (-tx, tz), so the derived right-vector flips too, and every lateral
 * offset (item boxes, pads, ramps) would land on the mirror image of the
 * WRONG side. The offsets must negate together with the points — [T10]
 * proves it by comparing world positions against the x-negated originals.
 */
export function mirrorSpec(spec: TrackSpec): TrackSpec {
  return {
    ...spec,
    points: spec.points.map((point) => ({ ...point, x: -point.x })),
    itemBoxes: spec.itemBoxes.map((row) => ({
      at: row.at,
      offsets: row.offsets.map((offset) => -offset),
    })),
    boostPads: spec.boostPads.map((pad) => ({ ...pad, offset: -pad.offset })),
    ramps: (spec.ramps ?? []).map((ramp) => ({ ...ramp, offset: -ramp.offset })),
  };
}

export function maybeMirror(spec: TrackSpec, mirrored: boolean): TrackSpec {
  return mirrored ? mirrorSpec(spec) : spec;
}

/** Height of the banked road surface `lateral` metres right of centre. */
export function surfaceHeight(sample: TrackSample, lateral: number): number {
  return sample.y + Math.tan(sample.bank) * lateral;
}

export function sampleIndexAt(track: Track, s: number): number {
  const wrapped = ((s % track.length) + track.length) % track.length;
  const index = Math.round(wrapped / track.step);
  return index % track.samples.length;
}

export function sampleAt(track: Track, s: number): TrackSample {
  return track.samples[sampleIndexAt(track, s)]!;
}

/** Centreline point plus lateral offset, in world space. */
export function pointAt(
  track: Track,
  s: number,
  lateral: number,
): readonly [number, number, number] {
  const sample = sampleAt(track, s);
  return [
    sample.x + sample.rx * lateral,
    surfaceHeight(sample, lateral),
    sample.z + sample.rz * lateral,
  ];
}

/** Shortest signed arc-length difference from `from` to `to`. */
export function arcDelta(track: Track, from: number, to: number): number {
  let delta = (to - from) % track.length;
  if (delta > track.length / 2) delta -= track.length;
  if (delta < -track.length / 2) delta += track.length;
  return delta;
}

/**
 * Project a world point onto the track.
 *
 * `hint` is the caller's last known sample index. Karts move continuously, so
 * a window search around the hint is exact and cheap; without a hint the whole
 * ring is scanned. The window is wide enough for one full simulation step at
 * any legal speed, plus the widest legal off-road excursion.
 */
export function querySurface(
  track: Track,
  x: number,
  z: number,
  hint = -1,
  shoulder = 0,
): SurfaceQuery {
  const count = track.samples.length;
  const window = Math.max(24, Math.ceil(60 / track.step));
  let bestIndex = 0;
  let bestDistance = Infinity;
  if (hint >= 0) {
    for (let offset = -window; offset <= window; offset += 1) {
      const index = (((hint + offset) % count) + count) % count;
      const sample = track.samples[index]!;
      const distance =
        (sample.x - x) * (sample.x - x) + (sample.z - z) * (sample.z - z);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
  } else {
    for (let index = 0; index < count; index += 1) {
      const sample = track.samples[index]!;
      const distance =
        (sample.x - x) * (sample.x - x) + (sample.z - z) * (sample.z - z);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
  }

  // Refine between the winner and whichever neighbour the point leans toward.
  const sample = track.samples[bestIndex]!;
  const dx = x - sample.x;
  const dz = z - sample.z;
  const along = dx * sample.tx + dz * sample.tz;
  const clampedAlong = Math.max(
    -track.step / 2,
    Math.min(track.step / 2, along),
  );
  const neighbourIndex =
    (((bestIndex + (along >= 0 ? 1 : -1)) % count) + count) % count;
  const neighbour = track.samples[neighbourIndex]!;
  const blend = Math.min(1, Math.abs(clampedAlong) / track.step);
  const half = sample.half + (neighbour.half - sample.half) * blend;
  const bank = sample.bank + (neighbour.bank - sample.bank) * blend;
  const lateral = dx * sample.rx + dz * sample.rz;
  const s =
    ((sample.s + clampedAlong) % track.length + track.length) % track.length;
  const baseY =
    sample.y + (neighbour.y - sample.y) * blend * (along >= 0 ? 1 : -1);

  return {
    index: bestIndex,
    s,
    lateral,
    half,
    height: baseY + Math.tan(bank) * lateral,
    heading: headingOf(sample.tx, sample.tz),
    curvature: sample.curvature,
    bank,
    pitch: sample.pitch,
    onRoad: Math.abs(lateral) <= half,
    onGround: Math.abs(lateral) <= half + shoulder,
  };
}

/**
 * Starting grid: two columns, staggered, behind the line. Derived from the
 * track so a layout change moves the grid with it.
 */
export function gridSlot(
  track: Track,
  slot: number,
): { x: number; y: number; z: number; yaw: number } {
  const row = Math.floor(slot / 2);
  const column = slot % 2 === 0 ? -0.42 : 0.42;
  const s = -(6 + row * 5.5);
  const sample = sampleAt(track, s);
  const lateral = column * sample.half;
  return {
    x: sample.x + sample.rx * lateral,
    y: surfaceHeight(sample, lateral),
    z: sample.z + sample.rz * lateral,
    yaw: headingOf(sample.tx, sample.tz),
  };
}
