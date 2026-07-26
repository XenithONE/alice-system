import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { buildCatalog, PARTS } from "../parts/catalog";
import { assembleBot, type DriveRuntime } from "../sim/assemble";
import { legSpokeLayout } from "../sim/build";
import {
  CELL,
  type BotSpec,
  type Catalog,
  type ChassisDef,
  type DriveDef,
  type PlacedPart,
  type Rot4
} from "../sim/types";
import { botMountGeometry, mountPartObject } from "./mounting";
import { createLeg, legFeet, legPhaseBias } from "./procedural/leg";
import { createTrack, trackWheelMatrixScratch } from "./procedural/track";
import { createTyre } from "./procedural/tyre";

declare const process: { exitCode?: number };

interface Bounds {
  readonly box: THREE.Box3;
  readonly finite: boolean;
}

function objectBounds(root: THREE.Object3D): Bounds {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  let finite = true;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = object.geometry.getAttribute("position");
    for (let index = 0; index < position.count; index += 1) {
      finite &&= Number.isFinite(position.getX(index)) &&
        Number.isFinite(position.getY(index)) &&
        Number.isFinite(position.getZ(index));
    }
    for (const attribute of Object.values(object.geometry.attributes) as THREE.BufferAttribute[]) {
      const values = attribute.array;
      for (let index = 0; index < values.length; index += 1) {
        if (!Number.isFinite(values[index]!)) finite = false;
      }
    }
    object.geometry.computeBoundingBox();
    const geometryBox = object.geometry.boundingBox!.clone();
    if (object instanceof THREE.InstancedMesh) {
      for (let index = 0; index < object.count; index += 1) {
        const instance = new THREE.Matrix4();
        object.getMatrixAt(index, instance);
        box.union(geometryBox.clone().applyMatrix4(instance).applyMatrix4(object.matrixWorld));
      }
    } else {
      box.union(geometryBox.applyMatrix4(object.matrixWorld));
    }
  });
  return { box, finite };
}

function beltNormalStats(root: THREE.Object3D): { plusX: number; bottomY: number } | null {
  let belt: THREE.BufferGeometry | undefined;
  root.traverse((object) => {
    if (object instanceof THREE.Mesh && object.geometry.name.startsWith("track-belt:")) {
      belt = object.geometry;
    }
  });
  const measuredBelt = belt as THREE.BufferGeometry | undefined;
  if (!measuredBelt) return null;
  const position = measuredBelt.getAttribute("position");
  const normal = measuredBelt.getAttribute("normal");
  const indices = Array.from({ length: position.count }, (_, index) => index);
  const plusX = indices.slice().sort((a, b) => position.getX(b) - position.getX(a)).slice(0, 60);
  const bottom = indices
    .filter((index) => Math.abs(normal.getX(index)) < 0.5)
    .sort((a, b) => position.getY(a) - position.getY(b))
    .slice(0, 60);
  return {
    plusX: plusX.reduce((sum, index) => sum + normal.getX(index), 0) / plusX.length,
    bottomY: bottom.reduce((sum, index) => sum + normal.getY(index), 0) / bottom.length
  };
}

function groundScan(root: THREE.Object3D, length: number, radius: number): number {
  const points: THREE.Vector3[] = [];
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return;
    const position = object.geometry.getAttribute("position");
    for (let index = 0; index < position.count; index += 1) {
      points.push(new THREE.Vector3(
        position.getX(index),
        position.getY(index),
        position.getZ(index)
      ).applyMatrix4(object.matrixWorld));
    }
  });
  let maximumError = 0;
  for (let z = -length / 2 + radius + 0.01; z <= length / 2 - radius - 0.01; z += 0.02) {
    const nearby = points.filter((point) => Math.abs(point.z - z) <= 0.011);
    if (!nearby.length) return Number.POSITIVE_INFINITY;
    const bottom = Math.min(...nearby.map((point) => point.y));
    maximumError = Math.max(maximumError, Math.abs(bottom + radius));
  }
  return maximumError;
}

/**
 * ARCHITECTURE_V4 §1.3 — the six geometry checks apply to legs too, except
 * "the running surface is flat", which a leg cannot satisfy: it touches the
 * floor intermittently by design. In its place: every one of the `feet` tips
 * must sit exactly `radius` from the axle.
 *
 * The spoke directions are NOT taken from the renderer. They come from
 * legSpokeLayout() in sim/build.ts — the same function assemble.ts hands to
 * Rapier — so this measures the drawn mesh against the collider's own star. If
 * the two ever drift apart the gate fails, which is the entire reason the check
 * exists: the last three serious defects in this project were one fact written
 * down twice and only one copy updated.
 */
function legTipErrors(root: THREE.Object3D, def: DriveDef): number[] {
  root.updateMatrixWorld(true);
  const points: THREE.Vector3[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = object.geometry.getAttribute("position");
    for (let index = 0; index < position.count; index += 1) {
      points.push(new THREE.Vector3(
        position.getX(index),
        position.getY(index),
        position.getZ(index)
      ).applyMatrix4(object.matrixWorld));
    }
  });
  // side -1 carries no phase bias, which is the pose createLeg() builds; the
  // right side's half-step offset is applied by mounting.ts and is checked
  // separately below.
  return legSpokeLayout(def, -1).angles.map((theta) => {
    const normal = new THREE.Vector3(0, Math.cos(theta), Math.sin(theta));
    let reach = Number.NEGATIVE_INFINITY;
    for (const point of points) reach = Math.max(reach, point.dot(normal));
    return (reach - def.radius) * 1000;
  });
}

/* ===================================================================== *
 * G-DRIVE-GEO, leg half: the drawn star against the star Rapier BUILT.
 *
 * legTipErrors() above compares the mesh with `def.radius`, a number both
 * sides read from the catalogue. That is a weak test in two ways, and this
 * section closes both:
 *
 *  a) it never looks at assemble.ts. The capsule descriptors there — the
 *     quaternion `(sin θ/2, 0, 0, cos θ/2)` and the centre `(0, cos θ, sin θ)·d`
 *     — could name the wrong axis or swap cos/sin and the comparison against a
 *     catalogue scalar would not move. So the physics side here is read back
 *     OUT OF THE RAPIER WORLD after assembleBot() has run: shape type,
 *     half-height, radius and the collider's own transform, plus a
 *     containsPoint() probe either side of the tip so the solver itself
 *     confirms how far the shape reaches.
 *
 *  b) it is second order in rotation. Projecting the mesh onto the physics
 *     spoke direction and taking the maximum measures `radius·cos δ`, so a
 *     drawn star turned δ = 0.05 rad off its colliders reads only
 *     radius·(1 − cos δ) ≈ 0.22 mm of error and sails through a 0.5 mm budget
 *     while every foot is actually 9 mm from where it collides. The tips are
 *     therefore located as POINTS — angle and distance — and compared as
 *     points. The `drawnStarRotated` injection at the bottom prints all three
 *     numbers side by side so the blind spot is on the record.
 * ===================================================================== */

/** 2D convex hull (Andrew's monotone chain) over the axle-plane projection. */
function hull2d(points: readonly (readonly [number, number])[]): [number, number][] {
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const unique: [number, number][] = [];
  for (const point of sorted) {
    const last = unique[unique.length - 1];
    if (!last || last[0] !== point[0] || last[1] !== point[1]) unique.push([point[0], point[1]]);
  }
  if (unique.length < 3) return unique;
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (source: readonly [number, number][]): [number, number][] => {
    const chain: [number, number][] = [];
    for (const point of source) {
      while (chain.length >= 2 && cross(chain[chain.length - 2]!, chain[chain.length - 1]!, point) <= 0) {
        chain.pop();
      }
      chain.push(point);
    }
    chain.pop();
    return chain;
  };
  return build(unique).concat(build(unique.slice().reverse()));
}

interface StarTip {
  /** angle about the axle, atan2(z, y), radians */
  readonly angle: number;
  /** distance from the axle in the axle plane, metres */
  readonly radius: number;
}

/**
 * The feet of the DRAWN star, found without being told where to look.
 *
 * A foot tip is a point of the mesh that is locally farthest from the axle, and
 * every such point is a vertex of the convex hull of the axle-plane projection
 * whose distance beats both of its hull neighbours. Nothing here reads `feet`,
 * `radius` or a spoke angle, so the count and the placement are measurements of
 * the mesh rather than a restatement of the catalogue.
 */
function drawnStarTips(root: THREE.Object3D): StarTip[] {
  root.updateMatrixWorld(true);
  const projected: [number, number][] = [];
  const vertex = new THREE.Vector3();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = object.geometry.getAttribute("position");
    for (let index = 0; index < position.count; index += 1) {
      vertex.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld);
      projected.push([vertex.y, vertex.z]);
    }
  });
  const ring = hull2d(projected);
  if (ring.length < 3) return [];
  const radii = ring.map(([y, z]) => Math.hypot(y, z));
  const tips: StarTip[] = [];
  for (let index = 0; index < ring.length; index += 1) {
    const here = radii[index]!;
    const before = radii[(index - 1 + ring.length) % ring.length]!;
    const after = radii[(index + 1) % ring.length]!;
    if (here >= before && here >= after && !(here === before && here === after)) {
      tips.push({ angle: Math.atan2(ring[index]![1], ring[index]![0]), radius: here });
    }
  }
  return tips;
}

interface PhysicsSpoke extends StarTip {
  /** RAPIER.ShapeType — 2 is Capsule. Printed so a shape swap is visible. */
  readonly shapeType: number;
  readonly halfHeight: number;
  readonly capsuleRadius: number;
  /**
   * How far the capsule leaves the axle plane: max(|centre.x|, |axis.x|·halfHeight)
   * in mm. Rotating the capsule about the wrong body axis shows up here even
   * though the axle-plane projection would hide it.
   */
  readonly planeErrorMm: number;
  /** solver-level: the shape contains a point 0.5 mm inside the measured tip */
  readonly solidJustInside: boolean;
  /** solver-level: and does not contain one 0.5 mm outside it */
  readonly hollowJustOutside: boolean;
}

/**
 * The feet of the star RAPIER HOLDS, read back out of the world.
 *
 * `collider.translation()` / `.rotation()` are absolute, so they are pulled
 * back into the drive body's own frame — that frame is what the renderer mounts
 * the leg mesh into, so the two are directly comparable. The farthest point of
 * a capsule from any origin is the far end cap: the endpoint of the segment
 * with the larger magnitude, pushed out by the capsule radius.
 */
function physicsStarSpokes(drive: DriveRuntime): PhysicsSpoke[] {
  const bodyPosition = drive.body.translation();
  const bodyRotation = drive.body.rotation();
  const intoBody = new THREE.Quaternion(
    bodyRotation.x, bodyRotation.y, bodyRotation.z, bodyRotation.w
  ).invert();
  const outOfBody = intoBody.clone().invert();
  const colliders = [drive.collider, ...(drive.legColliders ?? [])];
  return colliders.map((collider) => {
    const worldTranslation = collider.translation();
    const worldRotation = collider.rotation();
    const centre = new THREE.Vector3(
      worldTranslation.x - bodyPosition.x,
      worldTranslation.y - bodyPosition.y,
      worldTranslation.z - bodyPosition.z
    ).applyQuaternion(intoBody);
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(
      intoBody.clone().multiply(
        new THREE.Quaternion(worldRotation.x, worldRotation.y, worldRotation.z, worldRotation.w)
      )
    );
    const halfHeight = collider.halfHeight();
    const capsuleRadius = collider.radius();
    const ends = [
      centre.clone().addScaledVector(axis, halfHeight),
      centre.clone().addScaledVector(axis, -halfHeight)
    ];
    const far = ends[0]!.length() >= ends[1]!.length() ? ends[0]! : ends[1]!;
    const angle = Math.atan2(far.z, far.y);
    const radius = Math.hypot(far.y, far.z) + capsuleRadius;
    const probe = (distance: number): boolean => {
      const local = new THREE.Vector3(0, Math.cos(angle), Math.sin(angle)).multiplyScalar(distance);
      const world = local.applyQuaternion(outOfBody);
      return collider.containsPoint({
        x: world.x + bodyPosition.x,
        y: world.y + bodyPosition.y,
        z: world.z + bodyPosition.z
      });
    };
    return {
      angle,
      radius,
      shapeType: collider.shapeType() as number,
      halfHeight,
      capsuleRadius,
      planeErrorMm: Math.max(Math.abs(centre.x), Math.abs(axis.x) * halfHeight) * 1000,
      solidJustInside: probe(radius - 0.0005),
      hollowJustOutside: probe(radius + 0.0005)
    };
  });
}

/** signed shortest angular distance, radians */
const angleDelta = (a: number, b: number): number => Math.atan2(Math.sin(a - b), Math.cos(a - b));

interface TipPair {
  readonly foot: number;
  readonly physAngle: number;
  readonly drawnAngle: number;
  /** |drawn| − |physics| along the spoke, mm — the check the contract names */
  readonly radialErrorMm: number;
  /** across the spoke, mm — physRadius · Δangle; this is the rotation the old check missed */
  readonly tangentialErrorMm: number;
  /** what the projection-only measure would have reported, mm */
  readonly projectionErrorMm: number;
}

interface LegStarRow {
  readonly id: string;
  readonly chassisId: string;
  readonly side: -1 | 1;
  readonly physFeet: number;
  readonly drawnFeet: number;
  /** distinct drawn feet that a capsule claimed; short of physFeet means two
   * capsules landed on the same foot, which a bare count would not notice */
  readonly matchedFeet: number;
  readonly axleOffsetMm: number;
  readonly worstPlaneErrorMm: number;
  readonly shapeTypes: readonly number[];
  readonly solverProbesOk: boolean;
  readonly worstRadialMm: number;
  readonly worstTangentialMm: number;
  readonly worstProjectionMm: number;
  readonly pairs: readonly TipPair[];
}

/** Budgets. Radial is the contract's (§1.3); tangential is the same distance
 * applied across the spoke instead of along it, because a foot 9 mm to the side
 * of its collider is exactly as wrong as one 9 mm too long. */
const TIP_BUDGET_MM = 0.5;

function measureLegStar(
  def: DriveDef,
  chassis: ChassisDef,
  spec: BotSpec,
  catalog: Catalog,
  drive: DriveRuntime,
  /** radians of deliberate sabotage applied to the drawn star; 0 in production */
  sabotageRad: number
): LegStarRow {
  const placed = spec.parts[drive.idx]!;
  // The render path, unabridged: createLeg() for the mesh and mountPartObject()
  // for where it goes. Writing the phase bias out by hand here would be the
  // third copy of it and would test nothing.
  const holder = new THREE.Group();
  holder.add(createLeg(def, rubber, metal).root);
  mountPartObject(holder, chassis, def, placed, 0, botMountGeometry(spec, catalog));
  const drawnAxle = holder.position.clone();
  if (sabotageRad !== 0) holder.rotateX(sabotageRad);
  // Measure in the axle frame: the mount translation is compared separately so
  // a displaced axle cannot hide inside a tip error.
  holder.position.set(0, 0, 0);
  const drawnTips = drawnStarTips(holder);
  const physicsTips = physicsStarSpokes(drive);

  const bodyTranslation = drive.body.translation();
  const axleOffsetMm = drawnAxle.distanceTo(
    new THREE.Vector3(bodyTranslation.x, bodyTranslation.y, bodyTranslation.z)
  ) * 1000;

  // The drawn cloud once more, unprojected, for the legacy projection measure.
  holder.updateMatrixWorld(true);
  const cloud: THREE.Vector3[] = [];
  holder.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = object.geometry.getAttribute("position");
    for (let index = 0; index < position.count; index += 1) {
      cloud.push(new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld));
    }
  });

  const claimed = new Set<number>();
  const pairs: TipPair[] = physicsTips.map((physics, foot) => {
    let best = -1;
    let bestDelta = Number.POSITIVE_INFINITY;
    drawnTips.forEach((drawn, index) => {
      const delta = Math.abs(angleDelta(drawn.angle, physics.angle));
      if (delta < bestDelta) {
        bestDelta = delta;
        best = index;
      }
    });
    const drawn = drawnTips[best];
    if (best >= 0) claimed.add(best);
    const direction = new THREE.Vector3(0, Math.cos(physics.angle), Math.sin(physics.angle));
    let reach = Number.NEGATIVE_INFINITY;
    for (const point of cloud) reach = Math.max(reach, point.dot(direction));
    return {
      foot,
      physAngle: physics.angle,
      drawnAngle: drawn?.angle ?? Number.NaN,
      radialErrorMm: drawn ? (drawn.radius - physics.radius) * 1000 : Number.NaN,
      tangentialErrorMm: drawn ? angleDelta(drawn.angle, physics.angle) * physics.radius * 1000 : Number.NaN,
      projectionErrorMm: (reach - physics.radius) * 1000
    };
  });
  const worst = (pick: (pair: TipPair) => number): number =>
    pairs.reduce((carry, pair) => Math.abs(pick(pair)) > Math.abs(carry) ? pick(pair) : carry, 0);

  return {
    id: def.id,
    chassisId: chassis.id,
    side: drive.side,
    physFeet: physicsTips.length,
    drawnFeet: drawnTips.length,
    matchedFeet: claimed.size,
    axleOffsetMm: +axleOffsetMm.toFixed(5),
    worstPlaneErrorMm: +physicsTips.reduce((carry, spoke) => Math.max(carry, spoke.planeErrorMm), 0).toFixed(5),
    shapeTypes: physicsTips.map((spoke) => spoke.shapeType),
    solverProbesOk: physicsTips.every((spoke) => spoke.solidJustInside && !spoke.hollowJustOutside),
    worstRadialMm: +worst((pair) => pair.radialErrorMm).toFixed(5),
    worstTangentialMm: +worst((pair) => pair.tangentialErrorMm).toFixed(5),
    worstProjectionMm: +worst((pair) => pair.projectionErrorMm).toFixed(5),
    pairs: pairs.map((pair) => ({
      ...pair,
      physAngle: +pair.physAngle.toFixed(9),
      drawnAngle: +pair.drawnAngle.toFixed(9),
      radialErrorMm: +pair.radialErrorMm.toFixed(5),
      tangentialErrorMm: +pair.tangentialErrorMm.toFixed(5),
      projectionErrorMm: +pair.projectionErrorMm.toFixed(5)
    }))
  };
}

/** A hull with this leg on both flanks, so the biased side is exercised too. */
function legRig(def: DriveDef, catalog: Catalog): { chassis: ChassisDef; spec: BotSpec } | null {
  for (const part of catalog.parts) {
    if (part.category !== "chassis") continue;
    const grid: readonly [number, number] = [part.deck[1], part.heightCells];
    const rot: Rot4 | null =
      def.cells[0] <= grid[0] && def.cells[1] <= grid[1] ? 0
        : def.cells[1] <= grid[0] && def.cells[0] <= grid[1] ? 1
          : null;
    if (rot === null) continue;
    const parts: PlacedPart[] = [
      { partId: def.id, face: "left", cell: [0, 0], rot },
      { partId: def.id, face: "right", cell: [0, 0], rot }
    ];
    return {
      chassis: part,
      spec: { v: 3, name: `geo-${def.id}`, chassisId: part.id, paint: 0x777777, parts }
    };
  }
  return null;
}

const rubber = new THREE.MeshStandardMaterial();
const metal = new THREE.MeshStandardMaterial();
const rows: {
  id: string;
  kind: string;
  radius: number;
  maxRadius: number;
  excessMm: number;
  centerMm: [number, number, number];
  width: number;
  expectedWidth: number;
  groundErrorMm: number | null;
  normalX: number | null;
  normalY: number | null;
  feet: number | null;
  worstTipErrorMm: number | null;
  phaseBiasErrorRad: number | null;
  finite: boolean;
}[] = [];
const problems: string[] = [];

for (const part of PARTS) {
  if (part.category !== "drive") continue;
  const def = part as DriveDef;
  // Legs are drawn by createLeg in industrialKit.ts. Measuring createTyre here
  // would audit a mesh the game never puts on screen.
  const drive = def.kind === "track"
    ? createTrack(def, rubber, metal)
    : def.kind === "leg"
      ? createLeg(def, rubber, metal)
      : createTyre(def, rubber, metal);
  const { box, finite } = objectBounds(drive.root);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxRadius = def.kind === "track"
    ? Math.max(Math.abs(box.min.y), box.max.y)
    : Math.max(Math.abs(box.min.y), box.max.y, Math.abs(box.min.z), box.max.z);
  const expectedWidth = def.kind === "track" ? Math.max(def.height, 0.08) : Math.max(def.height, CELL);
  const length = Math.max(...def.cells) * CELL;
  const normals = def.kind === "track" ? beltNormalStats(drive.root) : null;
  const groundError = def.kind === "track" ? groundScan(drive.root, length, def.radius) : null;
  const tipErrors = def.kind === "leg" ? legTipErrors(drive.root, def) : null;
  // The right side starts half a step out of phase (L4). The renderer keeps its
  // own legPhaseBias(); this asserts it still equals the offset the physics star
  // actually has, so the duplicate cannot silently diverge.
  const layoutBias = def.kind === "leg"
    ? legSpokeLayout(def, 1).angles[0]! - legSpokeLayout(def, -1).angles[0]!
    : null;
  const row = {
    id: def.id,
    kind: def.kind,
    radius: def.radius,
    maxRadius,
    excessMm: (maxRadius - def.radius) * 1000,
    centerMm: [center.x * 1000, center.y * 1000, center.z * 1000] as [number, number, number],
    width: size.x,
    expectedWidth,
    groundErrorMm: groundError === null ? null : groundError * 1000,
    normalX: normals?.plusX ?? null,
    normalY: normals?.bottomY ?? null,
    feet: tipErrors === null ? null : tipErrors.length,
    worstTipErrorMm: tipErrors === null
      ? null
      : tipErrors.reduce((worst, value) => Math.abs(value) > Math.abs(worst) ? value : worst, 0),
    phaseBiasErrorRad: layoutBias === null ? null : legPhaseBias(def, 1) - layoutBias,
    finite
  };
  rows.push(row);
  /*
   * "Centred on the axle". A wheel and a track are surfaces of revolution, so
   * their bounding box is centred when the mesh is. A leg with an ODD number of
   * feet never is: tips at 0/120/240 deg put the box between +radius and
   * -0.5*radius, so its centre sits at +0.25*radius in Y no matter how
   * perfectly the star is placed. Checking Y and Z there would be measuring
   * three-fold symmetry, not centring.
   *
   * The axle direction (X) is still checked at the same 2 mm for every drive.
   * Y and Z centring on an odd star is enforced instead by the tip check below,
   * which pins every foot to `radius` in its own direction to 0.5 mm — four
   * times tighter than the box test it replaces, and it fires on a translation
   * the box test would not see. This is a narrowing, not a relaxation.
   */
  const oddStar = def.kind === "leg" && tipErrors !== null && tipErrors.length % 2 === 1;
  const centreAxes = oddStar ? row.centerMm.slice(0, 1) : row.centerMm;
  if (centreAxes.some((value) => Math.abs(value) > 2)) problems.push(`${def.id}: off-center ${row.centerMm}`);
  if (row.excessMm > 0.5) problems.push(`${def.id}: radius excess ${row.excessMm.toFixed(3)}mm`);
  if (Math.abs(row.width - row.expectedWidth) > 0.002) {
    problems.push(`${def.id}: width ${(row.width * 1000).toFixed(3)}mm expected ${(row.expectedWidth * 1000).toFixed(3)}mm`);
  }
  if (row.groundErrorMm !== null && row.groundErrorMm > 1) {
    problems.push(`${def.id}: ground error ${row.groundErrorMm.toFixed(3)}mm`);
  }
  if (row.normalX !== null && row.normalX <= 0.5) problems.push(`${def.id}: +X normal ${row.normalX.toFixed(6)}`);
  if (row.normalY !== null && row.normalY >= -0.5) problems.push(`${def.id}: bottom normal ${row.normalY.toFixed(6)}`);
  if (tipErrors !== null) {
    // tipErrors.length is the PHYSICS spoke count (legSpokeLayout). Both the
    // catalogue and the renderer's own legFeet() must agree with it: the two
    // clamp differently (build.ts has no upper bound, leg.ts caps at 8), so a
    // catalogue leg with many feet would collide on angles the mesh never draws.
    if (tipErrors.length !== Math.max(2, Math.round(def.feet ?? 2))) {
      problems.push(`${def.id}: physics built ${tipErrors.length} spokes, catalogue says ${def.feet}`);
    }
    if (legFeet(def) !== tipErrors.length) {
      problems.push(`${def.id}: renderer draws ${legFeet(def)} feet, physics collides ${tipErrors.length}`);
    }
    tipErrors.forEach((error, index) => {
      if (Math.abs(error) > 0.5) {
        problems.push(`${def.id}: foot ${index} tip off by ${error.toFixed(3)}mm (budget 0.5mm)`);
      }
    });
  }
  if (row.phaseBiasErrorRad !== null && Math.abs(row.phaseBiasErrorRad) > 1e-9) {
    problems.push(
      `${def.id}: render phase bias differs from legSpokeLayout by ${row.phaseBiasErrorRad.toExponential(3)} rad`
    );
  }
  if (!finite) problems.push(`${def.id}: NaN/Infinity`);
  if (def.kind === "track") {
    const scratch = trackWheelMatrixScratch;
    for (let index = 0; index < 100; index += 1) drive.applyPhase(index * 0.1);
    if (scratch !== trackWheelMatrixScratch) problems.push(`${def.id}: applyPhase replaced scratch Object3D`);
  }
}

/*
 * A gate only means something once you have watched it fail. Both of these
 * inject a defect this file has actually shipped and confirm the check fires.
 *
 *  1. legs drawn by createTyre — what this gate did until the leg dispatch was
 *     added. The tyre's bead torus pushes past the axle width on a large radius,
 *     so the width check catches it.
 *  2. the whole star shifted 5 mm off the axle — the "side wheels 5 cm high,
 *     7 cm outboard" defect in miniature. The tip check catches it; the
 *     bounding-box centre check on an odd star would not.
 */
const legDefs = PARTS.filter((part) => part.category === "drive" && part.kind === "leg") as DriveDef[];
const drawnAsTyre = legDefs.map((def) => {
  const tyre = createTyre(def, rubber, metal);
  const width = objectBounds(tyre.root).box.getSize(new THREE.Vector3()).x;
  const widthErrorMm = (width - Math.max(def.height, CELL)) * 1000;
  return { id: def.id, widthErrorMm: +widthErrorMm.toFixed(4), caught: Math.abs(widthErrorMm) > 2 };
});
const starShifted5mm = legDefs.map((def) => {
  const shifted = createLeg(def, rubber, metal);
  shifted.root.position.y = 0.005;
  const worstMm = legTipErrors(shifted.root, def)
    .reduce((worst, value) => Math.abs(value) > Math.abs(worst) ? value : worst, 0);
  return { id: def.id, worstTipErrorMm: +worstMm.toFixed(4), caught: Math.abs(worstMm) > 0.5 };
});
/*
 * 3. the drawn star turned 0.05 rad off its colliders. This is the injection
 *    the reviewer asked for, and it is kept permanently because it is the one
 *    that proves the NEW check earns its keep: the same defect is printed
 *    through all three measures, and only the tangential one exceeds its
 *    budget. Whatever else changes here, that column has to keep failing.
 */
const SABOTAGE_RAD = 0.05;

const legStarRows: LegStarRow[] = [];
const starRotated: {
  id: string;
  side: -1 | 1;
  radialMm: number;
  projectionMm: number;
  tangentialMm: number;
  caughtByRadial: boolean;
  caughtByProjection: boolean;
  caughtByTangential: boolean;
}[] = [];

const main = async (): Promise<void> => {
  await RAPIER.init();
  const catalog = buildCatalog();
  for (const def of legDefs) {
    const rig = legRig(def, catalog);
    if (!rig) {
      problems.push(`${def.id}: no chassis in the catalogue takes this leg on a flank`);
      continue;
    }
    // No gravity and never stepped: the colliders stay exactly where
    // assembleBot() put them, which is the thing under measurement.
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const bot = assembleBot(world, rig.spec, catalog, 0, [0, 0, 0], 0);
    for (const drive of bot.drives) {
      if (drive.def.kind !== "leg") continue;
      const row = measureLegStar(def, rig.chassis, rig.spec, catalog, drive, 0);
      legStarRows.push(row);
      const where = `${def.id}[side ${row.side}]`;
      if (row.physFeet !== legFeet(def)) {
        problems.push(`${where}: Rapier holds ${row.physFeet} capsules, renderer draws ${legFeet(def)} feet`);
      }
      if (row.drawnFeet !== row.physFeet || row.matchedFeet !== row.physFeet) {
        problems.push(
          `${where}: drawn star has ${row.drawnFeet} tips and ${row.matchedFeet} of them were claimed,` +
          ` against ${row.physFeet} capsules`
        );
      }
      if (row.shapeTypes.some((type) => type !== (RAPIER.ShapeType.Capsule as number))) {
        problems.push(`${where}: spoke colliders are not capsules: ${row.shapeTypes}`);
      }
      if (!row.solverProbesOk) {
        problems.push(
          `${where}: containsPoint says the collider does not reach exactly to the measured tip`
        );
      }
      if (row.worstPlaneErrorMm > 0.05) {
        problems.push(`${where}: capsule off the axle plane by ${row.worstPlaneErrorMm}mm`);
      }
      if (row.axleOffsetMm > TIP_BUDGET_MM) {
        problems.push(`${where}: drawn axle ${row.axleOffsetMm}mm from the drive body`);
      }
      for (const pair of row.pairs) {
        // NaN would slip through every `> budget` test below, so it is named.
        if (!Number.isFinite(pair.radialErrorMm) || !Number.isFinite(pair.tangentialErrorMm)) {
          problems.push(`${where}: foot ${pair.foot} has no drawn tip to compare against`);
          continue;
        }
        if (Math.abs(pair.radialErrorMm) > TIP_BUDGET_MM) {
          problems.push(
            `${where}: foot ${pair.foot} is ${pair.radialErrorMm}mm off the capsule tip along the spoke` +
            ` (budget ${TIP_BUDGET_MM}mm)`
          );
        }
        if (Math.abs(pair.tangentialErrorMm) > TIP_BUDGET_MM) {
          problems.push(
            `${where}: foot ${pair.foot} is ${pair.tangentialErrorMm}mm off the capsule tip across the spoke` +
            ` (drawn ${pair.drawnAngle} rad vs collider ${pair.physAngle} rad, budget ${TIP_BUDGET_MM}mm)`
          );
        }
      }
      const turned = measureLegStar(def, rig.chassis, rig.spec, catalog, drive, SABOTAGE_RAD);
      starRotated.push({
        id: def.id,
        side: row.side,
        radialMm: turned.worstRadialMm,
        projectionMm: turned.worstProjectionMm,
        tangentialMm: turned.worstTangentialMm,
        caughtByRadial: Math.abs(turned.worstRadialMm) > TIP_BUDGET_MM,
        caughtByProjection: Math.abs(turned.worstProjectionMm) > TIP_BUDGET_MM,
        caughtByTangential: Math.abs(turned.worstTangentialMm) > TIP_BUDGET_MM
      });
    }
    world.free();
  }

  const injections = {
    drawnAsTyre: { budgetMm: 2, caughtCount: drawnAsTyre.filter((r) => r.caught).length, rows: drawnAsTyre },
    starShifted5mm: {
      budgetMm: 0.5,
      caughtCount: starShifted5mm.filter((r) => r.caught).length,
      rows: starShifted5mm
    },
    starRotated: {
      radians: SABOTAGE_RAD,
      budgetMm: TIP_BUDGET_MM,
      caughtByTangential: starRotated.filter((r) => r.caughtByTangential).length,
      // Kept in the output on purpose: these are the columns that let the
      // defect through before the tips were compared as points.
      caughtByRadial: starRotated.filter((r) => r.caughtByRadial).length,
      caughtByProjection: starRotated.filter((r) => r.caughtByProjection).length,
      rows: starRotated
    }
  };
  // The tyre mesh is only wrong on the wide-radius legs — leg-scout's bead lands
  // inside the axle width by luck, which is exactly why the broken gate passed it.
  // So this asks that the check catches the ones it should, not all five.
  if (legDefs.length && injections.drawnAsTyre.caughtCount === 0) {
    problems.push("injection drawnAsTyre: width check never fired");
  }
  // A 5 mm shift is off-axle for every leg, so this one must catch all of them.
  /*
   * Coverage. Every arm above is inside a loop that `continue`s when a leg
   * cannot be placed or has no capsules in the physics world, so a leg that
   * silently failed to build would be skipped and the suite would still be
   * green. Say out loud how many were actually measured against Rapier.
   */
  const legsMeasured = new Set(legStarRows.map((row) => row.id));
  const legsMissed = legDefs.filter((def) => !legsMeasured.has(def.id)).map((def) => def.id);
  if (legsMissed.length > 0) {
    problems.push(
      `leg coverage: ${legsMissed.length} of ${legDefs.length} legs never reached the Rapier` +
        ` comparison (${legsMissed.join(", ")}). A leg that fails to place is skipped by every` +
        ` loop above, so without this the suite stays green while it goes unmeasured.`
    );
  }
  if (injections.starShifted5mm.caughtCount !== legDefs.length) {
    problems.push(
      `injection starShifted5mm: tip check fired for ${injections.starShifted5mm.caughtCount}/${legDefs.length} legs`
    );
  }
  // Every measured star, both flanks, must fail once it is turned.
  if (injections.starRotated.caughtByTangential !== starRotated.length || !starRotated.length) {
    problems.push(
      `injection starRotated: tangential check fired for ` +
      `${injections.starRotated.caughtByTangential}/${starRotated.length} stars`
    );
  }

  console.log(JSON.stringify({
    drivesMeasured: rows.length,
    trackWheelScratchReused: true,
    legTipBudgetMm: TIP_BUDGET_MM,
    injections,
    rows,
    legStarRows,
    problems
  }, null, 2));
  if (problems.length) process.exitCode = 1;
};

main().catch((error) => {
  console.error("DRIVE GEOMETRY SELFTEST FAIL:", error);
  process.exitCode = 1;
});
