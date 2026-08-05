/**
 * The corridor. Its shape, its poses, and the map between a scroll position
 * and a place in it.
 *
 * ── why this file has no three.js in it ──────────────────────────────────
 *
 * Every fact about where the camera is and where a picture hangs is decided
 * here, in arithmetic, so that gallerySelftest can check all of it in Node in
 * a few milliseconds without a GPU, a canvas or a bundler. A curve authored as
 * a list of Vector3 literals in a scene file cannot be checked against
 * anything: you can read the numbers back but there is nothing to compare
 * them to. A generator plus a gate is a fact that can be wrong out loud.
 *
 * ── frameAt(t) is the only definition of pose ────────────────────────────
 *
 * The scene builds walls from it, the picker hit-tests with it, the caption
 * rail reads it, and the headless gate below measures it. SCRAP CROWN built
 * its walls in one loop and its colliders in another; at low detail they
 * disagreed by 0.747 m and players on weak machines walked through a wall
 * that was visibly there. One function, four callers, no second opinion.
 *
 * ── the frame is horizontal, not Frenet ──────────────────────────────────
 *
 * A Frenet frame flips 180 degrees through an inflection point — the picture
 * would jump to the opposite wall mid-corridor — and its normal is undefined
 * where curvature is zero, which for a hallway is most of it. The corridor's
 * right vector is instead the horizontal one, normalize(cross(tangent, UP)):
 * stable, never flipping, and undefined only if the corridor points straight
 * up. [G7b] asserts it never comes close, which is the precondition of the
 * method actually used rather than a property of one nobody calls.
 */

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const add = (a: Vec3, b: Vec3): Vec3 => v(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a: Vec3, b: Vec3): Vec3 => v(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a: Vec3, s: number): Vec3 => v(a.x * s, a.y * s, a.z * s);
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 =>
  v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const len = (a: Vec3): number => Math.sqrt(dot(a, a));
const dist = (a: Vec3, b: Vec3): number => len(sub(a, b));
const norm = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 1e-9 ? mul(a, 1 / l) : v(0, 0, -1);
};
const lerp3 = (a: Vec3, b: Vec3, s: number): Vec3 =>
  v(a.x + (b.x - a.x) * s, a.y + (b.y - a.y) * s, a.z + (b.z - a.z) * s);

export const UP: Vec3 = v(0, 1, 0);
export { v as vec3, add, sub, mul, dot, cross, len, dist, norm };

/* ── the room ───────────────────────────────────────────────────────────── */

/** Metres. The corridor is a rectangular tube swept along the centreline. */
export const ROOM = {
  /** Centreline to wall. A picture 3.2 m wide needs the wall to be flat
      enough to hold it, which [G7] enforces as a curvature bound. */
  halfWidth: 3.4,
  ceiling: 3.9,
  /** Where the reader's eyes are. The centreline is the floor. */
  eye: 1.62,
  /** The hinged edge stands a touch proud so light can catch it. */
  proud: 0.09
} as const;

/**
 * Metres and radians. Every cover is 16:10, so one size fits the lot.
 *
 * ── toe ──────────────────────────────────────────────────────────────────
 *
 * The plates do not lie flat on the wall. They are hinged at their downstream
 * edge and swung 30 degrees into the corridor, so each one faces back at the
 * reader walking toward it.
 *
 * This is not decoration, it is the difference between a gallery and a
 * corridor with pictures in it. Flat on the wall, a plate 11 m ahead and 2.5 m
 * to the side is seen 77 degrees off its normal — foreshortened to a fifth of
 * its width, a sliver. [G4] measured exactly that and refused to pass: the
 * gate's whole claim is "stopping on a row puts you in front of that work",
 * and a sliver is not in front of anything. Toed in, the same plate is seen 47
 * degrees off normal and reads as a picture. Long galleries with bays have
 * done this since the sixteenth century for the same reason.
 */
export const PLATE = {
  width: 3.2,
  height: 2.0,
  /** Centre height above the floor — a hair above eye level, as hung. */
  centreY: 1.72,
  toe: (30 * Math.PI) / 180
} as const;

/*
 * The walk, in arc length.
 *
 *   lead-in     the reader arrives, sees the corridor bend away, no frame yet
 *   viewLead    how far ahead of the reader a frame sits when its row is the
 *               one being read. A frame level with the camera is at 90 deg to
 *               it and therefore invisible — the whole reason this constant
 *               exists, and the thing [G4] checks.
 *   run-out     somewhere to arrive, so the last frame is not the last pixel
 */
export const WALK = {
  leadIn: 10,
  viewLead: 11,
  runOut: 15
} as const;

/* ── the shape ──────────────────────────────────────────────────────────── */

export interface Shape {
  /** Straight-line extent along -Z, metres. */
  readonly extent: number;
  /** Sideways swing, metres. */
  readonly sway: number;
  /** How many full serpentine periods across the extent. */
  readonly turns: number;
  /** Vertical undulation, metres, and its period count. */
  readonly rise: number;
  readonly waves: number;
  /** Control points along the shape. */
  readonly controls: number;
}

/*
 * Authored numbers, and why they are these numbers.
 *
 *   sway 9 over a 100 m period is a curvature radius near 28 m: enough that
 *   the far end of the hall is hidden behind the bend from the entrance, and
 *   gentle enough that the wall the pictures hang on stays flat under a 3.2 m
 *   plate. [G7] fails below 1.5 x the corridor half-width.
 *
 *   rise 1.7 is the difference between a corridor and a tunnel — the floor
 *   tilting under the reader is what makes the space feel walked rather than
 *   flown. It is small enough that the horizontal frame never degenerates,
 *   which is [G7b].
 */
export const GALLERY_SHAPE: Shape = {
  extent: 292,
  sway: 9,
  turns: 2.9,
  rise: 1.7,
  waves: 2.4,
  controls: 46
};

function controlPoints(shape: Shape): Vec3[] {
  const points: Vec3[] = [];
  const TAU = Math.PI * 2;
  for (let i = 0; i < shape.controls; i++) {
    const u = i / (shape.controls - 1);
    points.push(
      v(
        shape.sway * Math.sin(TAU * shape.turns * u),
        shape.rise * Math.sin(TAU * shape.waves * u + 0.7),
        -shape.extent * u
      )
    );
  }
  return points;
}

/*
 * Centripetal Catmull-Rom (Barry-Goldman form, alpha = 0.5).
 *
 * Uniform Catmull-Rom overshoots and can loop back on itself where control
 * points bunch up; centripetal provably cannot. alpha is not a taste
 * parameter here, it is the reason [G1] can be satisfied at all.
 */
function segment(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, s: number): Vec3 {
  const alpha = 0.5;
  const knot = (prev: number, a: Vec3, b: Vec3): number => prev + Math.pow(Math.max(dist(a, b), 1e-6), alpha);
  const t0 = 0;
  const t1 = knot(t0, p0, p1);
  const t2 = knot(t1, p1, p2);
  const t3 = knot(t2, p2, p3);
  const t = t1 + s * (t2 - t1);

  const mix = (a: Vec3, b: Vec3, ta: number, tb: number): Vec3 =>
    lerp3(a, b, (t - ta) / (tb - ta));

  const a1 = mix(p0, p1, t0, t1);
  const a2 = mix(p1, p2, t1, t2);
  const a3 = mix(p2, p3, t2, t3);
  const b1 = lerp3(a1, a2, (t - t0) / (t2 - t0));
  const b2 = lerp3(a2, a3, (t - t1) / (t3 - t1));
  return lerp3(b1, b2, (t - t1) / (t2 - t1));
}

/**
 * How many samples the arc-length table holds.
 *
 * Not a round number picked for looks: 4000 over a ~300 m corridor is a 7.5 cm
 * step. three's CatmullRomCurve3 defaults to 200 divisions, which over this
 * length is 1.5 m per step — the reader would feel the camera speed pulse
 * once per step as the table's linear inversion over- and under-shot the real
 * arc length. [G7] measures the pulse that remains.
 */
export const SAMPLES = 4000;

export interface Corridor {
  readonly length: number;
  readonly samples: readonly Vec3[];
  /** Position on the centreline. t is arc length, normalised to [0,1]. */
  pointAt(t: number): Vec3;
  /** Unit direction of travel at t. */
  tangentAt(t: number): Vec3;
  /** The one definition of pose: position + an orthonormal basis. */
  frameAt(t: number): Frame;
  /** Arc-length metres -> t. */
  tAt(metres: number): number;
}

export interface Frame {
  readonly t: number;
  readonly position: Vec3;
  readonly tangent: Vec3;
  /** Horizontal, points at the right-hand wall. */
  readonly right: Vec3;
  /** cross(right, tangent) — leans with the floor rather than fighting it. */
  readonly up: Vec3;
}

function build(shape: Shape): Corridor {
  const control = controlPoints(shape);
  /* Reflected phantom ends, so the first and last segments have the same
     tangent continuity as the middle ones instead of flattening. */
  const first = add(control[0]!, sub(control[0]!, control[1]!));
  const last = add(control[control.length - 1]!, sub(control[control.length - 1]!, control[control.length - 2]!));
  const pts = [first, ...control, last];
  const spans = pts.length - 3;

  const raw = (u: number): Vec3 => {
    const clamped = Math.min(Math.max(u, 0), spans);
    const i = Math.min(Math.floor(clamped), spans - 1);
    return segment(pts[i]!, pts[i + 1]!, pts[i + 2]!, pts[i + 3]!, clamped - i);
  };

  /* Dense walk of the raw parameter, then a cumulative length table. */
  const WALK_STEPS = SAMPLES * 4;
  const walk: Vec3[] = [];
  const cumulative: number[] = [0];
  for (let i = 0; i <= WALK_STEPS; i++) {
    const p = raw((i / WALK_STEPS) * spans);
    walk.push(p);
    if (i > 0) cumulative.push(cumulative[i - 1]! + dist(walk[i - 1]!, p));
  }
  const length = cumulative[WALK_STEPS]!;

  /* Resample uniformly in arc length. Every later question — where is the
     camera, where does the next frame hang, how fast does the walk feel — is
     asked of this table, so "t" means the same thing to all of them. */
  const samples: Vec3[] = [];
  let cursor = 0;
  for (let j = 0; j <= SAMPLES; j++) {
    const target = (j / SAMPLES) * length;
    while (cursor < WALK_STEPS && cumulative[cursor + 1]! < target) cursor++;
    const a = cumulative[cursor]!;
    const b = cumulative[cursor + 1] ?? a;
    const f = b > a ? (target - a) / (b - a) : 0;
    samples.push(lerp3(walk[cursor]!, walk[Math.min(cursor + 1, WALK_STEPS)]!, f));
  }

  const pointAt = (t: number): Vec3 => {
    const x = Math.min(Math.max(t, 0), 1) * SAMPLES;
    const i = Math.min(Math.floor(x), SAMPLES - 1);
    return lerp3(samples[i]!, samples[i + 1]!, x - i);
  };

  const tangentAt = (t: number): Vec3 => {
    /* Central difference over one sample step. A smaller window would read
       the linear interpolation between two samples and return a constant. */
    const h = 1 / SAMPLES;
    const a = pointAt(Math.max(0, t - h));
    const b = pointAt(Math.min(1, t + h));
    return norm(sub(b, a));
  };

  const frameAt = (t: number): Frame => {
    const tangent = tangentAt(t);
    const right = norm(cross(tangent, UP));
    return { t, position: pointAt(t), tangent, right, up: norm(cross(right, tangent)) };
  };

  return { length, samples, pointAt, tangentAt, frameAt, tAt: (m) => Math.min(Math.max(m / length, 0), 1) };
}

/* One corridor per shape, built once. The gate builds sabotaged variants of
   its own, which is why build() is exported rather than only the singleton. */
export { build as buildCorridor };

let cached: Corridor | null = null;
export function corridor(): Corridor {
  if (!cached) cached = build(GALLERY_SHAPE);
  return cached;
}

/* ── where the pictures hang ────────────────────────────────────────────── */

export interface ExhibitPose {
  readonly index: number;
  readonly side: -1 | 1;
  /** Arc length of the plate's own position, metres. */
  readonly metres: number;
  readonly t: number;
  /** Centre of the picture, on the wall. */
  readonly centre: Vec3;
  /** Unit normal, pointing into the corridor. */
  readonly facing: Vec3;
  /** The picture's own axes, for building its quad and its frame. */
  readonly right: Vec3;
  readonly up: Vec3;
}

/**
 * Spacing is derived, not authored.
 *
 * The corridor's length is a consequence of its shape; dividing what is left
 * after the lead-in, the view lead and the run-out is the only way the two
 * cannot drift apart. [G2] bounds the result, so a change to the shape that
 * crams the frames together fails out loud instead of quietly hanging them
 * 4 m apart.
 */
export function spacingFor(count: number, corridorLength: number): number {
  return (corridorLength - WALK.leadIn - WALK.viewLead - WALK.runOut) / count;
}

/**
 * How far the plate's centre sits from the centreline.
 *
 * The plate is hinged at its downstream edge, which stays on the wall; swinging
 * it in by `toe` therefore carries its centre half a width x sin(toe) away from
 * the wall. Deriving this rather than writing 2.5 is what keeps the hinge on
 * the wall when someone retunes the angle.
 */
export function plateLateral(): number {
  return ROOM.halfWidth - ROOM.proud - (PLATE.width / 2) * Math.sin(PLATE.toe);
}

export function exhibitPoses(count: number, c: Corridor = corridor()): ExhibitPose[] {
  const spacing = spacingFor(count, c.length);
  const lateral = plateLateral();
  const cos = Math.cos(PLATE.toe);
  const sin = Math.sin(PLATE.toe);
  const poses: ExhibitPose[] = [];
  for (let i = 0; i < count; i++) {
    const side: -1 | 1 = i % 2 === 0 ? -1 : 1;
    const metres = WALK.leadIn + (i + 0.5) * spacing + WALK.viewLead;
    const t = c.tAt(metres);
    const f = c.frameAt(t);
    const centre = add(add(f.position, mul(f.right, side * lateral)), mul(f.up, PLATE.centreY));

    /*
     * The plate's own right, and its normal derived from it.
     *
     * Untoed it is -side x tangent, and the sign is not cosmetic: on the
     * right-hand wall a viewer's right is +Z while the corridor runs -Z, so
     * taking the tangent unreversed mirrors every second cover — the kind of
     * defect that looks like a different crop rather than like a bug. The toe
     * then rotates it about `up`, and because normal = cross(right, up) the
     * normal comes along for free instead of being rotated a second time by
     * hand and drifting out of orthogonality.
     */
    const right = sub(mul(f.right, sin), mul(f.tangent, side * cos));
    poses.push({
      index: i,
      side,
      metres,
      t,
      centre,
      facing: cross(right, f.up),
      right,
      up: f.up
    });
  }
  return poses;
}

/* ── camera ─────────────────────────────────────────────────────────────── */

export interface CameraPose {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly up: Vec3;
}

/** How far up the corridor the camera looks. Metres. */
export const LOOK_AHEAD = 7;

/**
 * The camera, from one number.
 *
 * It looks at a point on the same curve rather than along the tangent: a
 * quaternion built from the tangent rolls visibly through every inflection,
 * where a look-at target simply moves. Both are "correct"; only one of them
 * is watchable.
 */
export function cameraAt(t: number, c: Corridor = corridor()): CameraPose {
  const f = c.frameAt(t);
  const ahead = c.frameAt(Math.min(1, t + LOOK_AHEAD / c.length));
  return {
    position: add(f.position, mul(f.up, ROOM.eye)),
    target: add(ahead.position, mul(ahead.up, ROOM.eye)),
    up: UP
  };
}

/* ── the map between the page and the room ──────────────────────────────── */

/**
 * The reader's progress through the DOM list, 0..1, turned into a place in
 * the corridor. This is the whole of the scroll handling: no wheel listener,
 * no preventDefault, no easing library. The browser scrolls the document, the
 * document says how far along it is, and the camera stands there.
 */
export function tForProgress(progress: number, count: number, c: Corridor = corridor()): number {
  const spacing = spacingFor(count, c.length);
  const metres = WALK.leadIn + Math.min(Math.max(progress, 0), 1) * count * spacing;
  return c.tAt(metres);
}

/** The progress at which row i is the row being read. */
export function progressForExhibit(i: number, count: number): number {
  return (i + 0.5) / count;
}

/** Which frame the reader is at, from a place in the corridor. */
export function activeIndexAt(t: number, count: number, c: Corridor = corridor()): number {
  const spacing = spacingFor(count, c.length);
  const metres = t * c.length;
  const i = Math.floor((metres - WALK.leadIn) / spacing);
  return Math.min(Math.max(i, 0), count - 1);
}

/* ── what the camera can see ────────────────────────────────────────────── */

/**
 * Vertical field of view for an aspect ratio, in radians.
 *
 * A fixed vertical FOV is the usual choice and it is wrong for a corridor: at
 * 9:16 it leaves a 29 degree horizontal view, and a picture 3 m to the side
 * only enters it 11 m away and a few degrees wide. Widening the vertical FOV
 * on tall viewports keeps the horizontal one usable. The cap is what stops
 * that turning into a fisheye. [G3] is the check that this function is
 * generous enough, in both orientations, for every single work.
 */
export const FOV = { base: 50, minHorizontal: 62, maxVertical: 76 } as const;
const RAD = Math.PI / 180;

export function verticalFov(aspect: number): number {
  const base = FOV.base * RAD;
  const horizontal = 2 * Math.atan(Math.tan(base / 2) * aspect);
  if (horizontal >= FOV.minHorizontal * RAD) return base;
  const wanted = 2 * Math.atan(Math.tan((FOV.minHorizontal * RAD) / 2) / aspect);
  return Math.min(wanted, FOV.maxVertical * RAD);
}

/**
 * What the camera makes of one plate.
 *
 * Two verdicts, because they are two different promises:
 *
 *   whole    all four corners inside the frustum. This is "the reader gets to
 *            see the work", and it is the one that has to be true SOMEWHERE
 *            along the approach for every work in every orientation.
 *   centred  the middle of the plate is in frame, close, and turned toward
 *            the camera. This is "the reader is standing in front of it", and
 *            it is what the reading position promises.
 *
 * The first draft had only one verdict and it tested the CENTRE. That passes
 * while a phone shows two thirds of a picture with the rest off the left edge
 * — measured, at exactly the reading position — because a point has no width.
 * A gate that tests a point cannot see a crop.
 */
export interface Sighting {
  readonly whole: boolean;
  readonly centred: boolean;
  readonly distance: number;
  /** Worst corner, as a fraction of the frustum half-angle. 1 = on the edge. */
  readonly hFrac: number;
  readonly vFrac: number;
  /** The centre, same units. */
  readonly centreH: number;
  readonly centreV: number;
  /** Positive when the picture's front is turned toward the camera. */
  readonly facing: number;
}

/** How far away a plate may be and still count as shown. Metres. */
export const MAX_VIEW = 26;
/** How much of the frustum half-angle a corner may use. */
export const EDGE_MARGIN = 0.96;
/** How much of it the centre may use, at the reading position. */
export const CENTRE_MARGIN = 0.9;
/** How square-on the plate must be to count as looked at rather than skimmed. */
export const MIN_FACING = 0.15;

export function sight(camera: CameraPose, pose: ExhibitPose, aspect: number): Sighting {
  const forward = norm(sub(camera.target, camera.position));
  const right = norm(cross(forward, camera.up));
  const up = cross(right, forward);

  const vFov = verticalFov(aspect);
  const halfV = Math.tan(vFov / 2);
  const halfH = halfV * aspect;

  /* Fractions of the half-angle for one world point. Behind the camera is
     Infinity rather than a large number, so "in front" needs no separate
     test at every call site. */
  const frac = (point: Vec3): { h: number; v: number; z: number } => {
    const rel = sub(point, camera.position);
    const z = dot(rel, forward);
    if (z <= 0.05) return { h: Infinity, v: Infinity, z };
    return { h: Math.abs(dot(rel, right) / z) / halfH, v: Math.abs(dot(rel, up) / z) / halfV, z };
  };

  const centre = frac(pose.centre);
  const rel = sub(pose.centre, camera.position);
  const distance = len(rel);
  const facing = dot(pose.facing, norm(mul(rel, -1)));

  let hFrac = centre.h;
  let vFrac = centre.v;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const corner = add(
        add(pose.centre, mul(pose.right, (sx * PLATE.width) / 2)),
        mul(pose.up, (sy * PLATE.height) / 2)
      );
      const f = frac(corner);
      hFrac = Math.max(hFrac, f.h);
      vFrac = Math.max(vFrac, f.v);
    }
  }

  const inRange = distance <= MAX_VIEW && facing > MIN_FACING;
  return {
    whole: inRange && hFrac <= EDGE_MARGIN && vFrac <= EDGE_MARGIN,
    centred: inRange && centre.h <= CENTRE_MARGIN && centre.v <= CENTRE_MARGIN,
    distance,
    hFrac,
    vFrac,
    centreH: centre.h,
    centreV: centre.v,
    facing
  };
}
