import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createHarborSkiffModel } from "./generated/createHarborSkiffModel";

export type HarborQualityTier = "high" | "balanced" | "low";

export interface HarborMaterials {
  cream: THREE.MeshPhysicalMaterial;
  creamDark: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  stoneDark: THREE.MeshStandardMaterial;
  cobalt: THREE.MeshPhysicalMaterial;
  teal: THREE.MeshPhysicalMaterial;
  terracotta: THREE.MeshPhysicalMaterial;
  foliage: THREE.MeshStandardMaterial;
  foliageDark: THREE.MeshStandardMaterial;
  wood: THREE.MeshPhysicalMaterial;
  brass: THREE.MeshPhysicalMaterial;
  ivory: THREE.MeshPhysicalMaterial;
  window: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
}

export interface HarborFigure {
  root: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  head: THREE.Group;
}

export interface ProjectPortal {
  root: THREE.Group;
  pick: THREE.Mesh;
  frameMaterial: THREE.MeshStandardMaterial;
  coverMaterial: THREE.MeshBasicMaterial;
  dispose: () => void;
}

function roundedBoxGeometry(
  width: number,
  height: number,
  depth: number,
  radius = 0.08,
  segments = 2
): THREE.BufferGeometry {
  return new RoundedBoxGeometry(
    width,
    height,
    depth,
    segments,
    Math.min(radius, width * 0.15, height * 0.15, depth * 0.15)
  );
}

function roundedBox(
  width: number,
  height: number,
  depth: number,
  material: THREE.Material,
  radius = 0.08
): THREE.Mesh {
  const mesh = new THREE.Mesh(roundedBoxGeometry(width, height, depth, radius), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

interface ModelPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

/**
 * One lit window, as loose parts in window-local space (pane facing +Z).
 * createWindow hangs them on a Group for callers that want a node they can move;
 * the castle pushes the very same list into its merge bins. Stated once, so the
 * gatehouse window and a backdrop tower window cannot drift into two designs.
 */
function windowParts(
  materials: HarborMaterials,
  width: number,
  height: number,
  segments = 2
): ModelPart[] {
  const light = roundedBoxGeometry(width, height, 0.2, 0.08, segments);
  light.translate(0, 0, 0.03);
  const mullion = roundedBoxGeometry(0.07, height * 0.86, 0.23, 0.025, segments);
  mullion.translate(0, 0, 0.08);
  const cross = roundedBoxGeometry(width * 0.84, 0.06, 0.23, 0.025, segments);
  cross.translate(0, 0, 0.08);
  return [
    {
      geometry: roundedBoxGeometry(width + 0.18, height + 0.18, 0.16, 0.045, segments),
      material: materials.brass
    },
    { geometry: light, material: materials.window },
    { geometry: mullion, material: materials.brass },
    { geometry: cross, material: materials.brass }
  ];
}

function createWindow(materials: HarborMaterials, width = 0.54, height = 1.05): THREE.Group {
  const root = new THREE.Group();
  for (const part of windowParts(materials, width, height)) {
    const mesh = new THREE.Mesh(part.geometry, part.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  return root;
}

function createRoof(
  material: THREE.Material,
  radius: number,
  height: number,
  tier: HarborQualityTier,
  brass: THREE.Material
): THREE.Group {
  const root = new THREE.Group();
  const segments = tier === "high" ? 12 : tier === "low" ? 8 : 10;
  const layers = tier === "low" ? 2 : 3;
  for (let layer = 0; layer < layers; layer += 1) {
    const t = layer / Math.max(1, layers - 1);
    const cone = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * (0.24 + t * 0.3), radius * (0.58 + t * 0.2), height / layers, segments, 1, false),
      material
    );
    cone.position.y = height - (layer + 0.5) * (height / layers);
    cone.castShadow = true;
    root.add(cone);
  }
  const finial = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.11, 10, 8), brass);
  finial.position.y = height + radius * 0.16;
  root.add(finial);
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.04, radius * 0.06, radius * 0.34, 8), brass);
  pin.position.y = height + radius * 0.03;
  root.add(pin);
  return root;
}

function createTower(
  materials: HarborMaterials,
  tier: HarborQualityTier,
  roofMaterial: THREE.Material,
  height: number,
  radius: number
): THREE.Group {
  const root = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.92, radius, height, tier === "high" ? 16 : 12, tier === "high" ? 7 : 4),
    materials.cream
  );
  body.position.y = height / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  root.add(body);

  const courses = tier === "low" ? 4 : 7;
  for (let i = 1; i < courses; i += 1) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius * (0.93 + (i / courses) * 0.05), 0.055, 6, tier === "high" ? 32 : 20),
      materials.creamDark
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = (i / courses) * height;
    root.add(ring);
  }

  const balcony = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.18, radius * 1.12, 0.36, 16), materials.cream);
  balcony.position.y = height * 0.76;
  balcony.castShadow = true;
  root.add(balcony);

  const windowCount = tier === "low" ? 2 : 3;
  for (let i = 0; i < windowCount; i += 1) {
    const window = createWindow(materials, 0.46, 0.86);
    window.position.set(0, height * (0.34 + i * 0.2), radius * 0.93);
    root.add(window);
  }

  const battlements = tier === "low" ? 8 : 12;
  for (let i = 0; i < battlements; i += 1) {
    const angle = (i / battlements) * Math.PI * 2;
    const block = roundedBox(0.42, 0.45, 0.42, materials.cream, 0.045);
    block.position.set(Math.cos(angle) * radius * 0.98, height + 0.18, Math.sin(angle) * radius * 0.98);
    block.rotation.y = -angle;
    root.add(block);
  }

  const roof = createRoof(roofMaterial, radius * 1.04, radius * 1.75, tier, materials.brass);
  roof.position.y = height + 0.26;
  root.add(roof);
  return root;
}

export function createHarborMaterials(): HarborMaterials {
  const cream = new THREE.MeshPhysicalMaterial({
    color: 0xd8c39d,
    roughness: 0.67,
    clearcoat: 0.035,
    clearcoatRoughness: 0.55
  });
  const creamDark = new THREE.MeshStandardMaterial({ color: 0xb6a17f, roughness: 0.8 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x77808b, roughness: 0.93 });
  const stoneDark = new THREE.MeshStandardMaterial({ color: 0x4f5964, roughness: 0.96 });
  const roof = (color: number) =>
    new THREE.MeshPhysicalMaterial({ color, roughness: 0.36, clearcoat: 0.18, clearcoatRoughness: 0.28 });
  const window = new THREE.MeshStandardMaterial({
    color: 0xffba45,
    emissive: 0xff7b22,
    emissiveIntensity: 1.6,
    roughness: 0.34
  });
  return {
    cream,
    creamDark,
    stone,
    stoneDark,
    cobalt: roof(0x1767aa),
    teal: roof(0x138b88),
    terracotta: roof(0xa9472f),
    foliage: new THREE.MeshStandardMaterial({ color: 0x3a8f47, roughness: 0.86 }),
    foliageDark: new THREE.MeshStandardMaterial({ color: 0x1f6639, roughness: 0.9 }),
    wood: new THREE.MeshPhysicalMaterial({ color: 0x5b2e17, roughness: 0.5, clearcoat: 0.08 }),
    brass: new THREE.MeshPhysicalMaterial({
      color: 0xe0a73d,
      roughness: 0.24,
      metalness: 0.78,
      clearcoat: 0.22
    }),
    ivory: new THREE.MeshPhysicalMaterial({ color: 0xf4dfbc, roughness: 0.45, clearcoat: 0.08 }),
    window,
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xffcb68,
      roughness: 0.12,
      transmission: 0.36,
      transparent: true,
      opacity: 0.78,
      emissive: 0xff8c2b,
      emissiveIntensity: 0.65
    })
  };
}

/**
 * Where the castle's towers stand, and how wide they are, in the model's own
 * local units. harborScene builds the west tower's collider from this rather
 * than from a copy: the collider used to repeat `-3.4` and `2.1` by hand, and
 * harborHouses throws at load if a house door ends up inside that circle — so
 * moving a tower without remembering the other two numbers turns a visual tweak
 * into a page that will not start.
 *
 * CASTLE_TOWER_RADIUS is not a suggestion, it is the collision hull. Every part
 * of createCastleTower is expressed as a fraction of it, so the socle (0.99 R)
 * is the widest thing on the tower and the crown corbels/merlons (0.955–0.965 R)
 * step *out from a narrower shaft* rather than out past the circle. The old
 * tower's balcony sat at 1.18 R — 0.38 units of masonry outside the only
 * collider the castle owns.
 */
export const CASTLE_TOWER_OFFSET_X = 3.4;
export const CASTLE_TOWER_RADIUS = 2.1;

// ── the castle's other single sources of truth ──────────────────────────────
/**
 * The towers are the tyrants of this facade. Solid cylinders at ±3.4 whose
 * socle reaches radius 2.079, they swallow every point of the front wall with
 * |x| beyond ≈1.55 at ground and ≈1.85 at the parapet. The previous wall was
 * 3.25 half-wide with its decoration spread across that dead band: 6/6 talus
 * blocks, 10/14 quoins and most of each banner measured 100% inside the tower
 * solids. So the wall now ends at 2.3 — still deep inside the tower interiors
 * at every height and z, so no seam can show — and everything decorative is
 * clustered inside the measured visible band (DECOR_HALF_X / BAND_HALF_X).
 *
 * The gate mouth and wall depth follow a second, harder master: the west
 * tower's collider circle (radius exactly CASTLE_TOWER_RADIUS). Masonry the
 * walking body can reach must not exist outside it, and the tower SOLID fills
 * that circle to within 0.02-0.25 depending on height. The old 1.72 arch put
 * its jambs inside the socle bulge (doors parked there measured 87-90% buried
 * and read as floating fins); pushing anything far enough out of the solid
 * puts it outside the collider instead. GATE_R 1.44 with a 0.60 half-depth is
 * the geometry where the jamb's front corner (hypot(3.4-1.44, 0.68) = 2.075)
 * still sits inside the collider circle, while a door leaf hung just inside
 * the jamb clears the socle almost everywhere.
 */
const WALL_HALF_X = 2.3;
const WALL_HALF_Z = 0.6;
const WALL_TOP = 7.6;
const GATE_SPRING = 2.55;
const GATE_R = 1.44;
const GATE_ARCH_TOP = GATE_SPRING + GATE_R;
/** Small front decoration (corbels, merlons) lives inside this half-width… */
const DECOR_HALF_X = 1.6;
/** …and full-width ledges run to here: into the tower faces, so no gap shows,
 * but with ≥75% of each band's volume still outside the tower cylinders. */
const BAND_HALF_X = 1.95;
/**
 * Local y above which a walking player's body cannot reach. The figure stands
 * at world y 0.72 scaled 0.72, so its hair tops out at world 3.074; the castle
 * sits at world y 0.62 scaled 1.55, which puts that ceiling at local 1.583.
 *
 * This matters because harborScene registers exactly ONE circle for the whole
 * castle (the west tower). Masonry below this line that is not inside that
 * circle is masonry the player strolls through. So everything down here stays
 * inside the wall slab or a tower: the keep starts above the arch, the plinth
 * stays under the feet, and the door leaves hug the jambs outboard of the
 * body-reach line the west collider draws at local x 1.29.
 */
const BODY_REACH_TOP = 1.62;

const byTier = <T,>(tier: HarborQualityTier, high: T, balanced: T, low: T): T =>
  tier === "high" ? high : tier === "low" ? low : balanced;

/**
 * A small masonry block. `rounded` buys the toy-brick edge for 108 triangles;
 * a hard box costs 12. The castle spends the rounding on anything that meets
 * the sky or the eye (merlons, quoins, voussoirs) and skips it on parts that
 * only ever read as a shadow (corbels under a crown, arrow slits, hinges).
 *
 * RoundedBoxGeometry is NOT an option here at 0 segments: it silently returns a
 * 1x1x1 cube and ignores the size you asked for.
 */
function blockGeometry(
  width: number,
  height: number,
  depth: number,
  rounded: boolean,
  radius = 0.05
): THREE.BufferGeometry {
  return rounded
    ? roundedBoxGeometry(width, height, depth, radius, 1)
    : new THREE.BoxGeometry(width, height, depth);
}

/**
 * Collects geometry per material and emits ONE merged mesh per material.
 *
 * The old gate was ~100 separate meshes for a single landmark, most of them
 * 0.4-unit decorations; this is the same idea as brick/brickKit's BrickBatcher,
 * applied to a model that is placed once and never moves.
 */
class MergeBin {
  private readonly bins = new Map<THREE.Material, THREE.BufferGeometry[]>();

  /** Rotation is applied Z, then X, then Y, then the translation. */
  add(
    material: THREE.Material,
    geometry: THREE.BufferGeometry,
    x = 0,
    y = 0,
    z = 0,
    rotZ = 0,
    rotX = 0,
    rotY = 0
  ): void {
    if (rotZ) geometry.rotateZ(rotZ);
    if (rotX) geometry.rotateX(rotX);
    if (rotY) geometry.rotateY(rotY);
    if (x || y || z) geometry.translate(x, y, z);
    const bin = this.bins.get(material);
    if (bin) bin.push(geometry);
    else this.bins.set(material, [geometry]);
  }

  addPart(part: ModelPart, x = 0, y = 0, z = 0, rotZ = 0, rotX = 0, rotY = 0): void {
    this.add(part.material, part.geometry, x, y, z, rotZ, rotX, rotY);
  }

  /**
   * castShadow=false is the trim bin: corbels, slits, portcullis and other
   * small parts whose shadows read as noise at this size. The shadow pass had
   * crept up to 22,944 triangles; the outline shadow only needs the big forms
   * (towers, wall, keep), so everything else renders without casting.
   */
  flush(parent: THREE.Object3D, name: string, castShadow = true): void {
    let index = 0;
    for (const [material, parts] of this.bins) {
      // RoundedBox/Lathe are non-indexed while Cylinder/Box/Torus are indexed,
      // and mergeGeometries needs one index state for every part.
      const normalized = parts.map((part) => (part.index ? part.toNonIndexed() : part));
      const merged = mergeGeometries(normalized, false);
      new Set([...parts, ...normalized]).forEach((part) => part.dispose());
      if (!merged) throw new Error(`${name}: geometry merge failed`);
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = `${name}-${index}`;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      parent.add(mesh);
      index += 1;
    }
    this.bins.clear();
  }
}

/** A ring of blocks whose local +X points away from the axis. */
function ringOfBlocks(
  bin: MergeBin,
  material: THREE.Material,
  count: number,
  centreRadius: number,
  y: number,
  size: { radial: number; height: number; tangential: number },
  rounded: boolean
): void {
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    bin.add(
      material,
      blockGeometry(size.radial, size.height, size.tangential, rounded),
      Math.cos(angle) * centreRadius,
      y,
      Math.sin(angle) * centreRadius,
      0,
      0,
      -angle
    );
  }
}

/** Merlons along a straight run of parapet, alternating with open crenels. */
function crenellate(
  bin: MergeBin,
  material: THREE.Material,
  count: number,
  from: number,
  to: number,
  y: number,
  height: number,
  z: number,
  depth: number
): void {
  if (count < 1) return;
  const pitch = (to - from) / count;
  for (let i = 0; i < count; i += 1) {
    const x = from + pitch * (i + 0.5);
    // merlons are pure silhouette, so they always keep the rounded edge
    bin.add(material, blockGeometry(pitch * 0.62, height, depth, true), x, y + height / 2, z);
  }
}

/**
 * A vertical arrow slit that reads as an OPENING, not a sticker: the old
 * version was a dark cross of boxes standing 0.07-0.13 proud of the shaft.
 * Now the dark plate's outer face sits AT `faceRadius` (callers pass the wall
 * surface radius plus ~0.01 so it clears z-fighting and the polygon facets),
 * and a small lintel + sill stand 0.025 proud of it, so the plate reads as
 * masonry sunk 0.025 local ≈ 0.04 m world behind its own surround.
 */
function arrowSlit(bin: MergeBin, materials: HarborMaterials, faceRadius: number, y: number, angle: number): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const plate = blockGeometry(0.09, 0.92, 0.14, false);
  bin.add(materials.stoneDark, plate, c * (faceRadius - 0.045), y, s * (faceRadius - 0.045), 0, 0, -angle);
  for (const dy of [-0.505, 0.505]) {
    const cap = blockGeometry(0.09, 0.09, 0.24, false);
    bin.add(materials.creamDark, cap, c * (faceRadius - 0.02), y + dy, s * (faceRadius - 0.02), 0, 0, -angle);
  }
}

/** Conical roof as one lathe: a bell-flared eave reads far better than stacked cones. */
function spireGeometry(baseRadius: number, height: number, segments: number, slender: boolean): THREE.BufferGeometry {
  const profile: [number, number][] = slender
    ? [
        [1.0, 0],
        [0.9, 0.17],
        [0.69, 0.45],
        [0.42, 0.72],
        [0.19, 0.92],
        [0, 1]
      ]
    : [
        [1.0, 0],
        [0.95, 0.05],
        [0.81, 0.18],
        [0.62, 0.41],
        [0.38, 0.69],
        [0.15, 0.9],
        [0, 1]
      ];
  return new THREE.LatheGeometry(
    profile.map(([r, t]) => new THREE.Vector2(r * baseRadius, t * height)),
    segments
  );
}

/** Brass ball + spike, the only place gold is allowed to sit on the skyline. */
function finial(bin: MergeBin, materials: HarborMaterials, y: number, scale: number, segments: number): number {
  bin.add(materials.brass, new THREE.SphereGeometry(0.2 * scale, segments, Math.max(4, segments >> 1)), 0, y + 0.2 * scale, 0);
  bin.add(
    materials.brass,
    new THREE.CylinderGeometry(0.03 * scale, 0.07 * scale, 0.9 * scale, Math.max(5, segments >> 1)),
    0,
    y + 0.85 * scale,
    0
  );
  return y + 1.3 * scale;
}

/**
 * One flanking tower. Silhouette, top to bottom: conical roof, crenellated
 * parapet, machicolation corbels, banded shaft, battered socle — plus a stair
 * turret that breaks the cylinder so the tower reads as a building rather than
 * a post. Nothing here exceeds CASTLE_TOWER_RADIUS.
 */
function createCastleTower(
  materials: HarborMaterials,
  tier: HarborQualityTier,
  roofMaterial: THREE.Material,
  turretAngle: number,
  name: string
): THREE.Group {
  const root = new THREE.Group();
  root.name = name;
  // bin casts shadows (silhouette forms); trim does not (small dressing).
  const bin = new MergeBin();
  const trim = new MergeBin();
  const R = CASTLE_TOWER_RADIUS;
  const seg = byTier(tier, 22, 16, 12);

  const SOCLE_TOP = 1.15;
  const SHAFT_TOP = 8.34;
  const CORBEL_TOP = 8.92;
  const PARAPET_FLOOR = 9.2;
  const MERLON_TOP = 10.15;
  const shaftRadius = (y: number) =>
    THREE.MathUtils.lerp(0.9 * R, 0.845 * R, THREE.MathUtils.clamp((y - SOCLE_TOP) / (SHAFT_TOP - SOCLE_TOP), 0, 1));

  // socle: battered, and the widest thing on the tower at 0.99 R
  bin.add(materials.creamDark, new THREE.CylinderGeometry(0.905 * R, 0.99 * R, SOCLE_TOP, seg, 1), 0, SOCLE_TOP / 2, 0);
  trim.add(materials.stone, new THREE.CylinderGeometry(0.93 * R, 0.95 * R, 0.2, seg, 1), 0, SOCLE_TOP + 0.06, 0);

  // shaft
  bin.add(
    materials.cream,
    new THREE.CylinderGeometry(0.845 * R, 0.9 * R, SHAFT_TOP - SOCLE_TOP + 0.1, seg, 1),
    0,
    (SHAFT_TOP + SOCLE_TOP - 0.1) / 2,
    0
  );

  // string courses. Without them the shaft is a cylinder and the eye has no
  // way to read how big it is.
  const courses = byTier(tier, [3.05, 5.05, 7.05], [3.05, 5.05, 7.05], [3.05, 6.05]);
  for (const y of courses) {
    const r = shaftRadius(y) + 0.06;
    trim.add(materials.creamDark, new THREE.CylinderGeometry(r, r, 0.2, seg, 1), 0, y, 0);
  }

  // openings: one lit window facing the harbour, arrow slits flanking it.
  // Slit azimuths are snapped to the shaft's own vertex grid (π/2 ± 2π/seg)
  // so the near-flush plate face sits over the polygonised surface's TRUE
  // radius at every tier, instead of floating 0.13 proud of a facet centre.
  // One step either side of the window is also the only front sector that
  // clears BOTH stair turrets (west at 0.72π, east at 0.28π, each ±0.31 rad)
  // and both walls: the old π/2+1.75 slits sat inside the gate wall on one
  // tower and behind the wing crenels on the other — invisible decoration.
  // Low tier drops slits entirely; they are not silhouette.
  const windowY = 5.05;
  for (const part of windowParts(materials, 0.5, 0.95, 1)) {
    trim.addPart(part, 0, windowY, shaftRadius(windowY) - 0.03);
  }
  const slitStep = (Math.PI * 2) / seg;
  const slits = byTier<[number, number][]>(
    tier,
    [
      [2.35, -1],
      [2.35, 1],
      [4.05, -1],
      [6.95, -1],
      [6.95, 1]
    ],
    [
      [2.35, -1],
      [2.35, 1],
      [6.95, -1],
      [6.95, 1]
    ],
    []
  );
  for (const [y, k] of slits) {
    arrowSlit(trim, materials, shaftRadius(y) + 0.012, y, Math.PI / 2 + k * slitStep);
  }

  // machicolation: the corbels the crown steps out on. This is the single
  // biggest reason a cylinder reads as "castle".
  const corbels = byTier(tier, 24, 16, 8);
  ringOfBlocks(
    trim,
    materials.creamDark,
    corbels,
    0.955 * R - 0.18,
    (SHAFT_TOP + CORBEL_TOP) / 2 - 0.05,
    { radial: 0.36, height: CORBEL_TOP - SHAFT_TOP + 0.1, tangential: 0.3 },
    false
  );
  bin.add(
    materials.creamDark,
    new THREE.CylinderGeometry(0.96 * R, 0.955 * R, PARAPET_FLOOR - CORBEL_TOP + 0.06, seg, 1),
    0,
    (PARAPET_FLOOR + CORBEL_TOP) / 2,
    0
  );
  trim.add(materials.brass, new THREE.CylinderGeometry(0.962 * R, 0.962 * R, 0.07, seg, 1), 0, PARAPET_FLOOR - 0.12, 0);

  // crenellated parapet — the teeth are the silhouette, so low tier thins them
  // rather than dropping them.
  const merlons = byTier(tier, 16, 12, 8);
  ringOfBlocks(
    bin,
    materials.cream,
    merlons,
    0.965 * R - 0.13,
    (PARAPET_FLOOR + MERLON_TOP) / 2,
    {
      radial: 0.26,
      height: MERLON_TOP - PARAPET_FLOOR,
      tangential: ((2 * Math.PI * 0.9 * R) / merlons) * 0.6
    },
    true
  );

  // roof, tucked inside the parapet
  const roofBase = 9.35;
  bin.add(roofMaterial, spireGeometry(0.83 * R, 4.15, seg, false), 0, roofBase, 0);
  finial(trim, materials, roofBase + 4.15, 1, byTier(tier, 10, 8, 6));

  // stair turret: a half-round tower hugging the shaft, entirely inside R.
  const turretR = 0.42;
  const turretOffset = 1.55;
  const tx = Math.cos(turretAngle) * turretOffset;
  const tz = Math.sin(turretAngle) * turretOffset;
  bin.add(materials.cream, new THREE.CylinderGeometry(turretR, turretR + 0.03, 10.4, byTier(tier, 14, 10, 8), 1), tx, 5.2, tz);
  trim.add(
    materials.creamDark,
    new THREE.CylinderGeometry(turretR + 0.07, turretR + 0.07, 0.16, byTier(tier, 14, 10, 8), 1),
    tx,
    6.6,
    tz
  );
  arrowSlit(trim, materials, turretOffset + turretR + 0.012, 7.9, turretAngle);
  bin.add(roofMaterial, spireGeometry(0.48, 1.35, byTier(tier, 14, 10, 8), true), tx, 10.35, tz);
  trim.add(materials.brass, new THREE.SphereGeometry(0.12, 8, 5), tx, 11.78, tz);

  bin.flush(root, name);
  trim.flush(root, `${name}-trim`, false);

  // The castle owns exactly one collider circle, of CASTLE_TOWER_RADIUS. Masonry
  // outside it is masonry the player walks through, and the old tower's balcony
  // sat 0.38 outside without anyone noticing. Prove it here instead of trusting
  // the fractions above to survive the next edit — harborHouses already throws
  // at load for the same class of mistake.
  let reach = 0;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i += 1) {
      reach = Math.max(reach, Math.hypot(position.getX(i), position.getZ(i)));
    }
  });
  if (reach > CASTLE_TOWER_RADIUS) {
    throw new Error(
      `${name} reaches ${reach.toFixed(3)} beyond CASTLE_TOWER_RADIUS ${CASTLE_TOWER_RADIUS}`
    );
  }
  return root;
}

/** The rose window over the gate: brass ring, spokes, one warm pane. */
function addRoseWindow(
  bin: MergeBin,
  materials: HarborMaterials,
  y: number,
  radius: number,
  spokes: number,
  z: number
): void {
  bin.add(materials.window, new THREE.CircleGeometry(radius - 0.08, spokes * 2), 0, y, z + 0.02);
  bin.add(materials.brass, new THREE.TorusGeometry(radius, 0.09, 5, spokes * 2), 0, y, z + 0.08);
  for (let i = 0; i < spokes; i += 1) {
    const angle = (i / spokes) * Math.PI;
    bin.add(materials.brass, blockGeometry(radius * 1.9, 0.07, 0.1, false), 0, y, z + 0.08, angle);
  }
  bin.add(materials.brass, new THREE.SphereGeometry(0.16, 8, 6), 0, y, z + 0.1);
  // hood mould: a stone brow so the window is set into masonry, not stuck on it
  const voussoirs = Math.max(5, spokes + 1);
  for (let i = 0; i <= voussoirs; i += 1) {
    const angle = Math.PI * (0.06 + (0.88 * i) / voussoirs);
    bin.add(
      materials.creamDark,
      blockGeometry(0.28, 0.24, 0.16, false),
      Math.cos(angle) * (radius + 0.28),
      y + Math.sin(angle) * (radius + 0.28),
      z,
      angle
    );
  }
}

export function createCastleGate(materials: HarborMaterials, tier: HarborQualityTier): THREE.Group {
  const root = new THREE.Group();
  root.name = "castle-gate";
  // bin casts shadows (plinth, wall, keep, crenellation); trim does not.
  const bin = new MergeBin();
  const trim = new MergeBin();
  const low = tier === "low";
  // Oxidised copper, held against the terracotta hip roof directly below it.
  // Local to the castle, and disposed with it by disposeHarborObject.
  const verdigris = new THREE.MeshPhysicalMaterial({
    color: 0x5ea590,
    roughness: 0.44,
    clearcoat: 0.16,
    clearcoatRoughness: 0.34
  });

  // The stair turret faces out and forward on each side, so the pair mirrors.
  for (const [side, angle, name] of [
    [-1, Math.PI * 0.72, "castle-tower-west"],
    [1, Math.PI * 0.28, "castle-tower-east"]
  ] as const) {
    const tower = createCastleTower(materials, tier, materials.terracotta, angle, name);
    tower.position.x = side * CASTLE_TOWER_OFFSET_X;
    root.add(tower);
  }

  // ── 1. plinth ────────────────────────────────────────────────────────────
  // The gate used to start at local y 0 and the island terrace tops out below
  // it, so the whole castle grew straight out of the paving. Three steps, all
  // BELOW y 0 — the walker's feet are at local 0.174, so a step that rose above
  // the base would be a kerb the player floats over inside the archway.
  const plinth: [number, number, number, number, number][] = [
    // [top y, bottom y, wall half x, wall half z, tower disc radius]
    [0.0, -0.18, WALL_HALF_X + 0.3, WALL_HALF_Z + 0.42, 0.99 * CASTLE_TOWER_RADIUS - 0.11],
    [-0.18, -0.36, WALL_HALF_X + 0.6, WALL_HALF_Z + 0.64, 0.99 * CASTLE_TOWER_RADIUS - 0.05],
    [-0.36, -0.58, WALL_HALF_X + 0.9, WALL_HALF_Z + 0.86, 0.99 * CASTLE_TOWER_RADIUS - 0.01]
  ];
  const plinthSeg = byTier(tier, 20, 16, 12);
  plinth.forEach(([top, bottom, halfX, halfZ, discR], index) => {
    const material = index === 0 ? materials.stone : materials.stoneDark;
    bin.add(material, new THREE.BoxGeometry(halfX * 2, top - bottom, halfZ * 2), 0, (top + bottom) / 2, 0);
    for (const sign of [-1, 1]) {
      bin.add(
        material,
        new THREE.CylinderGeometry(discR, discR, top - bottom, plinthSeg, 1),
        sign * CASTLE_TOWER_OFFSET_X,
        (top + bottom) / 2,
        0
      );
      bin.add(
        material,
        new THREE.BoxGeometry(2.0 + index * 0.24, top - bottom, halfZ * 1.5),
        sign * 5.4,
        (top + bottom) / 2,
        0
      );
    }
  });

  // ── 2. curtain wall ──────────────────────────────────────────────────────
  const gateShape = new THREE.Shape();
  gateShape.moveTo(-WALL_HALF_X, 0);
  gateShape.lineTo(-WALL_HALF_X, WALL_TOP);
  gateShape.lineTo(WALL_HALF_X, WALL_TOP);
  gateShape.lineTo(WALL_HALF_X, 0);
  gateShape.closePath();
  const opening = new THREE.Path();
  opening.moveTo(-GATE_R, 0);
  opening.lineTo(-GATE_R, GATE_SPRING);
  opening.absarc(0, GATE_SPRING, GATE_R, Math.PI, 0, true);
  opening.lineTo(GATE_R, 0);
  opening.closePath();
  gateShape.holes.push(opening);
  const wall = new THREE.ExtrudeGeometry(gateShape, {
    depth: WALL_HALF_Z * 2,
    bevelEnabled: true,
    bevelSize: 0.08,
    bevelThickness: 0.08,
    bevelSegments: 1,
    curveSegments: byTier(tier, 16, 12, 8)
  });
  bin.add(materials.cream, wall, 0, 0, -WALL_HALF_Z);

  // NO battered talus on the wall base any more: it lived at |x| 2.0-3.25,
  // which is 100% inside the tower solids (6/6 blocks measured buried).
  // The tower socles themselves are the gate's battered feet now.

  // gate surround. NO quoins any more: the tower solids reach inward to
  // x 1.32 at ground and ≈1.52 at the spring, so jamb quoins beside a 1.44
  // arch measure at best ~55% outside the towers (the old 7-course pairs
  // measured 10/14 fully inside). The surround is the archivolt alone, and
  // only the arc of it that clears the towers: the springers would be ~half
  // buried, so the arch dies into the towers the way a real arch dies into
  // its abutments.
  const archivolt = byTier(tier, 11, 8, 5);
  for (let i = 0; i <= archivolt; i += 1) {
    const angle = Math.PI * (0.15 + (0.7 * i) / archivolt);
    const wide = i % 2 === 0;
    trim.add(
      wide ? materials.creamDark : materials.cream,
      blockGeometry(0.4, (Math.PI * 0.7 * (GATE_R + 0.2)) / archivolt + 0.06, WALL_HALF_Z * 2 + 0.18, true),
      Math.cos(angle) * (GATE_R + 0.2),
      GATE_SPRING + Math.sin(angle) * (GATE_R + 0.2),
      0,
      angle
    );
  }

  // string course, rose window, corbel table, crenellated parapet — all
  // clustered inside the band the towers leave visible.
  trim.add(
    materials.creamDark,
    blockGeometry(BAND_HALF_X * 2, 0.24, WALL_HALF_Z * 2 + 0.4, true),
    0,
    GATE_ARCH_TOP + 0.62,
    0
  );
  addRoseWindow(trim, materials, 5.95, 0.8, byTier(tier, 10, 8, 5), WALL_HALF_Z + 0.06);

  const wallCorbels = byTier(tier, 8, 6, 4);
  for (let i = 0; i < wallCorbels; i += 1) {
    const x = -DECOR_HALF_X + 0.02 + ((DECOR_HALF_X * 2 - 0.04) * (i + 0.5)) / wallCorbels;
    for (const z of low ? [WALL_HALF_Z + 0.14] : [WALL_HALF_Z + 0.14, -WALL_HALF_Z - 0.14]) {
      trim.add(materials.creamDark, blockGeometry(0.3, 0.5, 0.36, false), x, WALL_TOP - 0.4, z);
    }
  }
  trim.add(
    materials.creamDark,
    blockGeometry(BAND_HALF_X * 2 + 0.06, 0.24, WALL_HALF_Z * 2 + 0.5, true),
    0,
    WALL_TOP - 0.03,
    0
  );
  crenellate(
    bin,
    materials.cream,
    byTier(tier, 5, 4, 3),
    -DECOR_HALF_X,
    DECOR_HALF_X,
    WALL_TOP + 0.09,
    0.95,
    0,
    WALL_HALF_Z * 2 + 0.24
  );

  // ── 3. gate furniture ────────────────────────────────────────────────────
  // Portcullis, raised. Its lowest bar sits at local 2.62 = world 4.68, well
  // clear of the 3.07 the walker's head reaches, so the passage stays open.
  const bars = byTier(tier, 7, 5, 3);
  for (let i = 0; i < bars; i += 1) {
    const x = -GATE_R * 0.82 + ((GATE_R * 1.64) * i) / (bars - 1);
    const topY = GATE_SPRING + Math.sqrt(Math.max(0, GATE_R * GATE_R - x * x)) - 0.12;
    trim.add(materials.brass, new THREE.BoxGeometry(0.09, topY - 2.62, 0.09), x, (topY + 2.62) / 2, 0);
  }
  for (const y of low ? [2.72] : [2.72, 3.32, 3.86]) {
    const halfSpan = Math.sqrt(Math.max(0.04, GATE_R * GATE_R - (y - GATE_SPRING) ** 2)) * 0.86;
    trim.add(materials.brass, new THREE.BoxGeometry(halfSpan * 2, 0.09, 0.09), 0, y, 0);
  }

  // door leaves, swung open against the jambs. The old leaves at ±1.62 were
  // 87-90% inside the tower solids and read as floating dark fins. The two
  // sides obey different masters and so get different leaves:
  //  - EAST: the walk boxes end at world x -7.65, a full leaf-width west of
  //    the east jamb, so nobody can ever touch it. It only has to clear the
  //    tower solid: a 0.10 x 1.10 leaf at x 1.29..1.39 measures ~3% buried
  //    (the sliver is the socle's foot at ankle height).
  //  - WEST: every reachable-body test reduces to "stay inside the west
  //    collider circle" (radius CASTLE_TOWER_RADIUS about the tower axis),
  //    and the free gap between that circle and the tower solid is 0.02-0.25
  //    wide. The largest leaf whose corners fit the circle is 0.07 x 0.80 at
  //    x -1.42..-1.35 (corner hypot(2.05, 0.40) = 2.089 < 2.1), which keeps
  //    the walk-through penetration at exactly 0.0000.
  // No studs: on the west they would poke through the circle into body space.
  trim.add(materials.wood, blockGeometry(0.1, 2.55, 1.1, true, 0.04), GATE_R - 0.1, 1.3, -0.05);
  trim.add(materials.wood, blockGeometry(0.07, 2.55, 0.8, true, 0.03), -(GATE_R - 0.055), 1.3, 0);
  for (const y of [2.35, 0.42]) {
    // straps bridge the small reveal between each leaf and its jamb
    trim.add(materials.brass, blockGeometry(0.2, 0.14, 1.0, false), GATE_R - 0.07, y, -0.05);
    trim.add(materials.brass, blockGeometry(0.14, 0.14, 0.6, false), -(GATE_R - 0.03), y, 0);
  }

  // lanterns inside the arch
  for (const sign of [-1, 1]) {
    trim.add(materials.brass, blockGeometry(0.34, 0.09, 0.09, false), sign * (GATE_R - 0.2), 3.02, 0.34);
    trim.add(materials.window, blockGeometry(0.22, 0.3, 0.22, true), sign * (GATE_R - 0.34), 2.84, 0.34);
    trim.add(materials.brass, blockGeometry(0.28, 0.08, 0.28, false), sign * (GATE_R - 0.34), 3.03, 0.34);
  }
  if (!low) {
    const archLight = new THREE.PointLight(0xffb45c, 2.4, 9, 2);
    archLight.position.set(0, 2.9, 0.2);
    root.add(archLight);
  }

  // banners: three offset panels plus a rod and hem, so it is not one board.
  // They flank the rose window at ±1.45: at the old ±2.32 the towers left
  // 5.9% of the cloth visible and the banner read as a blue vertical line.
  // Inside |x| ≲ 1.85 the whole assembly clears both tower cylinders.
  for (const sign of [-1, 1]) {
    const x = sign * 1.45;
    // The string course reaches z WALL_HALF_Z + 0.2; hang the cloth clear of it.
    const bannerZ = WALL_HALF_Z + 0.28;
    trim.add(materials.brass, new THREE.CylinderGeometry(0.07, 0.07, 0.8, 6), x, 6.42, bannerZ, Math.PI / 2);
    const panels: [number, number, number][] = low
      ? [[0, 0.6, 0.0]]
      : [
          [-0.21, 0.24, 0.0],
          [0, 0.26, 0.05],
          [0.21, 0.24, 0.0]
        ];
    for (const [dx, width, dz] of panels) {
      trim.add(
        materials.cobalt,
        blockGeometry(width, 2.4, 0.07, false),
        x + dx,
        5.18,
        bannerZ + dz,
        sign * 0.022
      );
    }
    trim.add(materials.brass, blockGeometry(0.72, 0.12, 0.11, false), x, 3.99, bannerZ + 0.02, sign * 0.022);
    trim.add(materials.cobalt, blockGeometry(0.34, 0.42, 0.07, false), x, 3.78, bannerZ + 0.02, Math.PI / 4);
  }

  // ── 4. keep, carried over the gate ───────────────────────────────────────
  // It starts above the arch on purpose: below BODY_REACH_TOP the only masonry
  // the colliders cover is the wall slab and the towers.
  const KEEP_BASE = 4.3;
  const KEEP_HALF_X = 1.55;
  const KEEP_FRONT = 0.55;
  const KEEP_BACK = -1.9;
  const keepHalfZ = (KEEP_FRONT - KEEP_BACK) / 2;
  const keepZ = (KEEP_FRONT + KEEP_BACK) / 2;
  if (KEEP_BASE < BODY_REACH_TOP) throw new Error("keep would hang inside the walkway");

  // Only the keep's REAR overhangs; its front and flanks are swallowed by the wall
  // slab up to the parapet, so corbels there would be masonry inside masonry.
  const keepCorbels = byTier(tier, 7, 5, 4);
  for (let i = 0; i < keepCorbels; i += 1) {
    const x = -KEEP_HALF_X + 0.16 + ((KEEP_HALF_X * 2 - 0.32) * (i + 0.5)) / keepCorbels;
    trim.add(materials.creamDark, blockGeometry(0.28, 0.62, 0.4, false), x, KEEP_BASE + 0.28, KEEP_BACK + 0.12);
  }
  bin.add(
    materials.cream,
    blockGeometry(KEEP_HALF_X * 2, 5.8, keepHalfZ * 2, true, 0.12),
    0,
    KEEP_BASE + 2.9,
    keepZ
  );
  // WALL_TOP + parapet = 8.55 local, so keep detail below that is buried masonry.
  // One course sets the floor of the exposed storey; the corbel cornice at 10.35
  // closes it. A second band would land inside the 8.81-9.99 window opening.
  trim.add(
    materials.creamDark,
    blockGeometry(KEEP_HALF_X * 2 + 0.16, 0.2, keepHalfZ * 2 + 0.16, true),
    0,
    8.62,
    keepZ
  );
  for (const dx of [-0.72, 0.72]) {
    for (const part of windowParts(materials, 0.5, 1.0, 1)) trim.addPart(part, dx, 9.4, KEEP_FRONT - 0.02);
  }
  for (const sign of [-1, 1]) {
    for (const part of windowParts(materials, 0.46, 0.9, 1)) {
      trim.addPart(part, sign * (KEEP_HALF_X - 0.02), 9.3, keepZ, 0, 0, sign * Math.PI * 0.5);
    }
  }
  // stage-1 crown
  bin.add(
    materials.creamDark,
    blockGeometry(KEEP_HALF_X * 2 + 0.34, 0.5, keepHalfZ * 2 + 0.34, true),
    0,
    10.35,
    keepZ
  );
  crenellate(bin, materials.cream, byTier(tier, 5, 4, 3), -KEEP_HALF_X - 0.17, KEEP_HALF_X + 0.17, 10.6, 0.9, KEEP_FRONT + 0.06, 0.34);
  crenellate(bin, materials.cream, byTier(tier, 5, 4, 3), -KEEP_HALF_X - 0.17, KEEP_HALF_X + 0.17, 10.6, 0.9, KEEP_BACK - 0.06, 0.34);

  // stage 2, set back
  const KEEP2_HALF_X = 1.2;
  const KEEP2_HALF_Z = 1.15;
  bin.add(materials.cream, blockGeometry(KEEP2_HALF_X * 2, 2.6, KEEP2_HALF_Z * 2, true, 0.1), 0, 11.65, keepZ);
  bin.add(
    materials.creamDark,
    blockGeometry(KEEP2_HALF_X * 2 + 0.32, 0.45, KEEP2_HALF_Z * 2 + 0.32, true),
    0,
    13.17,
    keepZ
  );
  for (const z of [keepZ + KEEP2_HALF_Z + 0.1, keepZ - KEEP2_HALF_Z - 0.1]) {
    crenellate(bin, materials.cream, byTier(tier, 4, 3, 3), -KEEP2_HALF_X - 0.16, KEEP2_HALF_X + 0.16, 13.4, 0.75, z, 0.3);
  }

  // hip roof (terracotta) → lantern drum and spire (verdigris) → weathervane
  const hip = new THREE.ConeGeometry(1.24 * Math.SQRT2, 2.3, 4, 1);
  bin.add(materials.terracotta, hip, 0, 14.55, keepZ, 0, 0, Math.PI / 4);
  bin.add(
    materials.terracotta,
    new THREE.ConeGeometry(1.44 * Math.SQRT2, 0.55, 4, 1),
    0,
    13.66,
    keepZ,
    0,
    0,
    Math.PI / 4
  );
  bin.add(verdigris, new THREE.CylinderGeometry(0.44, 0.48, 0.9, 8, 1), 0, 15.9, keepZ);
  trim.add(materials.brass, new THREE.CylinderGeometry(0.5, 0.5, 0.08, 8, 1), 0, 16.31, keepZ);
  bin.add(verdigris, spireGeometry(0.52, 3.25, byTier(tier, 14, 10, 8), true), 0, 16.35, keepZ);
  const spireTop = finial(trim, materials, 19.6, 0.85, byTier(tier, 10, 8, 6));
  if (!low) {
    trim.add(materials.brass, blockGeometry(0.86, 0.06, 0.06, false), 0, spireTop - 0.42, keepZ);
    trim.add(materials.brass, blockGeometry(0.4, 0.28, 0.05, false), 0.42, spireTop - 0.28, keepZ);
  }

  // ── 5. flanking wing walls, the lowest step of the silhouette ────────────
  for (const sign of [-1, 1]) {
    const from = sign > 0 ? 4.6 : -6.35;
    const to = sign > 0 ? 6.35 : -4.6;
    bin.add(materials.cream, blockGeometry(to - from, 3.6, 1.55, true, 0.1), (from + to) / 2, 1.8, 0);
    bin.add(materials.creamDark, blockGeometry(to - from + 0.2, 0.9, 1.95, true), (from + to) / 2, 0.45, 0);
    trim.add(materials.creamDark, blockGeometry(to - from + 0.16, 0.22, 1.9, true), (from + to) / 2, 3.6, 0);
    crenellate(bin, materials.cream, byTier(tier, 3, 3, 2), from, to, 3.71, 0.7, 0, 1.7);
    for (const part of windowParts(materials, 0.46, 0.86, 1)) {
      trim.addPart(part, (from + to) / 2, 2.1, 0.82);
    }
  }

  bin.flush(root, "castle");
  trim.flush(root, "castle-trim", false);
  root.userData.landmark = "studio";
  return root;
}

export function createLighthouse(materials: HarborMaterials, tier: HarborQualityTier): THREE.Group {
  const root = new THREE.Group();
  root.name = "lighthouse";

  const rockCount = tier === "low" ? 9 : 18;
  for (let i = 0; i < rockCount; i += 1) {
    const angle = (i / rockCount) * Math.PI * 2;
    const radius = 1.25 + (i % 4) * 0.34;
    const rock = roundedBox(
      0.9 + (i % 3) * 0.24,
      0.65 + (i % 4) * 0.25,
      0.9 + ((i + 1) % 3) * 0.22,
      i % 3 === 0 ? materials.stoneDark : materials.stone,
      0.08
    );
    rock.position.set(Math.cos(angle) * radius, rock.geometry.boundingBox?.max.y ?? 0.35, Math.sin(angle) * radius);
    rock.position.y = 0.35 + (i % 4) * 0.12;
    rock.rotation.y = angle + (i % 2) * 0.18;
    root.add(rock);
  }

  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(1.04, 1.46, 8.3, tier === "high" ? 20 : 14, tier === "high" ? 8 : 5),
    materials.cream
  );
  tower.position.y = 5.05;
  tower.castShadow = true;
  tower.receiveShadow = true;
  root.add(tower);

  for (const y of [3.25, 6.1]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.35 - y * 0.035, 1.38 - y * 0.035, 0.55, 16), materials.cobalt);
    band.position.y = y;
    band.castShadow = true;
    root.add(band);
  }

  const balcony = new THREE.Mesh(new THREE.CylinderGeometry(1.42, 1.28, 0.38, 18), materials.cream);
  balcony.position.y = 9.28;
  balcony.castShadow = true;
  root.add(balcony);
  const railingCount = tier === "low" ? 10 : 16;
  for (let i = 0; i < railingCount; i += 1) {
    const angle = (i / railingCount) * Math.PI * 2;
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.72, 7), materials.cream);
    rail.position.set(Math.cos(angle) * 1.24, 9.72, Math.sin(angle) * 1.24);
    root.add(rail);
  }
  const railRing = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.055, 6, railingCount * 2), materials.cream);
  railRing.rotation.x = Math.PI / 2;
  railRing.position.y = 10.02;
  root.add(railRing);

  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 0.86, 1.55, 10), materials.glass);
  lantern.position.y = 10.28;
  root.add(lantern);
  const glow = new THREE.PointLight(0xffb449, tier === "low" ? 5 : 12, 18, 2);
  glow.position.y = 10.3;
  root.add(glow);
  const roof = createRoof(materials.teal, 1.15, 1.55, tier, materials.brass);
  roof.position.y = 11.08;
  root.add(roof);

  const greenery = tier === "low" ? 5 : 11;
  for (let i = 0; i < greenery; i += 1) {
    const leaf = roundedBox(0.42, 0.18, 0.42, i % 3 === 0 ? materials.foliageDark : materials.foliage, 0.08);
    const angle = (i / greenery) * Math.PI * 2;
    leaf.position.set(Math.cos(angle) * (1.55 + (i % 2) * 0.35), 0.85 + (i % 3) * 0.14, Math.sin(angle) * 1.55);
    root.add(leaf);
  }
  root.userData.landmark = "ai-lab";
  return root;
}

export function createPromenade(materials: HarborMaterials, tier: HarborQualityTier): THREE.Group {
  const root = new THREE.Group();
  root.name = "promenade";
  const base = roundedBox(8.6, 0.72, 39, materials.cream, 0.14);
  base.position.set(-10.9, 0.12, -18.4);
  root.add(base);
  const seawall = roundedBox(1.1, 2.15, 39.5, materials.stone, 0.12);
  seawall.position.set(-6.9, -0.45, -18.4);
  root.add(seawall);

  const tileRows = tier === "low" ? 3 : 5;
  const tileCols = tier === "low" ? 18 : 32;
  const tileGeometry = new RoundedBoxGeometry(1.22, 0.18, 1.02, 2, 0.035);
  const tiles = new THREE.InstancedMesh(tileGeometry, materials.creamDark, tileRows * tileCols);
  const dummy = new THREE.Object3D();
  let index = 0;
  for (let row = 0; row < tileRows; row += 1) {
    for (let col = 0; col < tileCols; col += 1) {
      dummy.position.set(-14.45 + row * 1.55 + (col % 2) * 0.18, 0.56, -36.5 + col * 1.14);
      dummy.rotation.y = ((row + col) % 2) * 0.02;
      dummy.updateMatrix();
      tiles.setMatrixAt(index, dummy.matrix);
      index += 1;
    }
  }
  tiles.instanceMatrix.needsUpdate = true;
  tiles.receiveShadow = true;
  root.add(tiles);

  const bollards = tier === "low" ? 8 : 15;
  for (let i = 0; i < bollards; i += 1) {
    const post = roundedBox(0.38, 1.05, 0.38, materials.stoneDark, 0.055);
    post.position.set(-6.95, 1.15, -35.4 + i * (35 / Math.max(1, bollards - 1)));
    root.add(post);
    const cap = roundedBox(0.52, 0.17, 0.52, materials.brass, 0.05);
    cap.position.set(-6.95, 1.74, post.position.z);
    root.add(cap);
  }

  const dock = new THREE.Group();
  dock.name = "arrival-dock";
  for (let i = 0; i < 9; i += 1) {
    const plank = roundedBox(0.82, 0.2, 5.4, materials.wood, 0.045);
    plank.position.set(-6.3 + i * 0.84, 0.38, 1.05);
    dock.add(plank);
  }
  for (const x of [-6.5, 0.4]) {
    for (const z of [-1.05, 3.1]) {
      const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 2.1, 8), materials.wood);
      pile.position.set(x, -0.24, z);
      dock.add(pile);
    }
  }
  root.add(dock);
  return root;
}

export function createMarket(materials: HarborMaterials, tier: HarborQualityTier): THREE.Group {
  const root = new THREE.Group();
  root.name = "prompt-market";
  const colors = [materials.cobalt, materials.teal, materials.terracotta];
  const count = tier === "low" ? 3 : 5;
  for (let i = 0; i < count; i += 1) {
    const stall = new THREE.Group();
    const counter = roundedBox(2.3, 0.32, 1.1, materials.wood, 0.05);
    counter.position.y = 1.15;
    stall.add(counter);
    for (const x of [-0.95, 0.95]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 2.35, 8), materials.wood);
      post.position.set(x, 1.4, 0);
      stall.add(post);
    }
    const canopy = roundedBox(2.55, 0.18, 1.55, colors[i % colors.length]!, 0.08);
    canopy.position.y = 2.45;
    canopy.rotation.z = (i % 2 ? 1 : -1) * 0.04;
    stall.add(canopy);
    stall.position.set(-17.1, 0.55, -4.5 - i * 5.5);
    stall.rotation.y = Math.PI / 2;
    root.add(stall);
  }
  root.userData.landmark = "prompts";
  return root;
}

export function createProjectPortal(
  texture: THREE.Texture,
  materials: HarborMaterials,
  tier: HarborQualityTier
): ProjectPortal {
  const root = new THREE.Group();
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0x70431f,
    roughness: 0.58,
    emissive: 0x000000,
    emissiveIntensity: 0
  });
  const coverMaterial = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  const back = roundedBox(2.72, 2.08, 0.22, frameMaterial, 0.07);
  back.position.y = 1.65;
  root.add(back);
  const cover = new THREE.Mesh(new THREE.PlaneGeometry(2.36, 1.48), coverMaterial);
  cover.position.set(0, 1.68, 0.125);
  root.add(cover);
  const brassRule = roundedBox(2.52, 0.07, 0.12, materials.brass, 0.025);
  brassRule.position.set(0, 2.5, 0.16);
  root.add(brassRule);
  const legs = tier === "low" ? [-0.75, 0.75] : [-0.86, 0.86];
  for (const x of legs) {
    const leg = roundedBox(0.18, 1.5, 0.22, materials.wood, 0.035);
    leg.position.set(x, 0.5, 0);
    leg.rotation.z = x < 0 ? -0.08 : 0.08;
    root.add(leg);
  }
  const pick = new THREE.Mesh(
    new THREE.BoxGeometry(3, 2.7, 0.9),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  pick.position.y = 1.55;
  root.add(pick);
  return {
    root,
    pick,
    frameMaterial,
    coverMaterial,
    dispose() {
      root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
      });
      frameMaterial.dispose();
      coverMaterial.dispose();
      (pick.material as THREE.Material).dispose();
    }
  };
}

export function createBlockFigure(materials: HarborMaterials): HarborFigure {
  const root = new THREE.Group();
  root.name = "harbor-explorer";
  const blue = new THREE.MeshPhysicalMaterial({ color: 0x1767aa, roughness: 0.42, clearcoat: 0.08 });
  const skin = new THREE.MeshPhysicalMaterial({ color: 0xe3ad5d, roughness: 0.46, clearcoat: 0.06 });
  const hairMaterial = new THREE.MeshStandardMaterial({ color: 0x5a2b18, roughness: 0.82 });

  const torso = roundedBox(0.88, 1.02, 0.48, blue, 0.09);
  torso.position.y = 1.72;
  root.add(torso);
  const belt = roundedBox(0.92, 0.16, 0.52, materials.brass, 0.04);
  belt.position.y = 1.25;
  root.add(belt);

  const head = new THREE.Group();
  head.position.y = 2.56;
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.52, 16), skin);
  head.add(face);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.41, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.62), hairMaterial);
  hair.position.y = 0.3;
  head.add(hair);
  root.add(head);

  const limb = (material: THREE.Material, length: number, width: number) => {
    const pivot = new THREE.Group();
    const mesh = roundedBox(width, length, width, material, 0.07);
    mesh.position.y = -length / 2;
    pivot.add(mesh);
    return pivot;
  };
  const leftArm = limb(skin, 0.86, 0.28);
  leftArm.position.set(-0.58, 2.08, 0);
  root.add(leftArm);
  const rightArm = limb(skin, 0.86, 0.28);
  rightArm.position.set(0.58, 2.08, 0);
  root.add(rightArm);
  const leftLeg = limb(blue, 0.92, 0.36);
  leftLeg.position.set(-0.24, 1.16, 0);
  root.add(leftLeg);
  const rightLeg = limb(blue, 0.92, 0.36);
  rightLeg.position.set(0.24, 1.16, 0);
  root.add(rightLeg);

  root.scale.setScalar(0.72);
  root.userData.materials = [blue, skin, hairMaterial];
  return { root, leftArm, rightArm, leftLeg, rightLeg, head };
}

export function createCityBackdrop(materials: HarborMaterials, tier: HarborQualityTier): THREE.Group {
  const root = new THREE.Group();
  root.name = "city-backdrop";
  const count = tier === "low" ? 8 : tier === "high" ? 18 : 13;
  const palette = [materials.cobalt, materials.teal, materials.terracotta];
  for (let i = 0; i < count; i += 1) {
    const x = -24 + (i % 6) * 6.6 + (i % 2) * 1.3;
    const z = -29 - Math.floor(i / 6) * 8.5 - (i % 3) * 1.2;
    const height = 4.5 + (i % 4) * 1.3;
    const radius = 1.05 + (i % 3) * 0.24;
    const tower = createTower(materials, "low", palette[i % palette.length]!, height, radius);
    tower.position.set(x, 0.2, z);
    tower.scale.setScalar(0.82 + (i % 3) * 0.08);
    root.add(tower);
  }
  return root;
}

export function createFloatingIslands(materials: HarborMaterials, tier: HarborQualityTier): THREE.Group {
  const root = new THREE.Group();
  const count = tier === "low" ? 2 : 4;
  for (let i = 0; i < count; i += 1) {
    const island = new THREE.Group();
    const rockGeometry = new THREE.ConeGeometry(
      1.8 + i * 0.2,
      3.8 + i * 0.35,
      tier === "high" ? 9 : 7,
      4
    );
    const rockPositions = rockGeometry.attributes.position as THREE.BufferAttribute;
    const rockRadius = 1.8 + i * 0.2;
    for (let vertex = 0; vertex < rockPositions.count; vertex += 1) {
      const x = rockPositions.getX(vertex);
      const y = rockPositions.getY(vertex);
      const z = rockPositions.getZ(vertex);
      const radius = Math.hypot(x, z);
      if (radius < 0.08) continue;
      const angle = Math.atan2(z, x);
      const taper = THREE.MathUtils.clamp(radius / rockRadius, 0.2, 1);
      const jitter = 1 + Math.sin(angle * 3 + i * 1.7 + y * 1.8) * 0.13 * taper;
      rockPositions.setXYZ(vertex, x * jitter, y + Math.cos(angle * 2 + y) * 0.08, z * jitter);
    }
    rockPositions.needsUpdate = true;
    rockGeometry.computeVertexNormals();
    const rock = new THREE.Mesh(
      rockGeometry,
      materials.stoneDark
    );
    rock.rotation.z = Math.PI;
    rock.position.y = -1.8;
    island.add(rock);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.75 + i * 0.2, 1.45 + i * 0.16, 0.58, 9), materials.foliage);
    top.position.y = 0.15;
    island.add(top);
    const shrine = createTower(materials, "low", i % 2 ? materials.teal : materials.cobalt, 2.6, 0.55);
    shrine.scale.setScalar(0.55);
    shrine.position.y = 0.42;
    island.add(shrine);
    island.position.set(14 + i * 9, 17 + (i % 2) * 5, -39 - i * 8);
    island.scale.setScalar(0.82 + i * 0.08);
    root.add(island);
  }
  return root;
}

export function createPlayableSkiff(tier: HarborQualityTier, castShadow: boolean) {
  return createHarborSkiffModel({ quality: tier, castShadow });
}

export function disposeHarborObject(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    source.forEach((material) => materials.add(material));
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  const customMaterials = root.userData.materials;
  if (Array.isArray(customMaterials)) {
    customMaterials.forEach((material) => {
      if (material && typeof material.dispose === "function") material.dispose();
    });
  }
}
