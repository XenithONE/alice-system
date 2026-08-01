/**
 * The kart, built from primitives.
 *
 * One shared geometry set, one material set per livery — eight karts cost
 * eight materials, not eight model loads. The wheels and the body are separate
 * nodes because the front wheels steer and the body carries the drift angle
 * while the kart keeps travelling along its heading; folding them together is
 * what makes an arcade kart look like it is sliding on rails.
 */

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { MachineShape } from "../content/machines";
import { liveryOf, type Livery } from "./palette";
import { headlightPoolTexture, roundelTexture } from "./textures";

export interface KartVisual {
  /** Positioned at the kart's world pose; yaw only. */
  readonly root: THREE.Group;
  /** Carries the drift/spin angle and the body lean. */
  readonly body: THREE.Group;
  readonly frontWheels: readonly THREE.Object3D[];
  readonly rearWheels: readonly THREE.Object3D[];
  readonly exhausts: readonly THREE.Mesh[];
  /** The driver's helmet -- the scene turns it into corners. */
  readonly helmet: THREE.Object3D;
  readonly livery: Livery;
  setSteer(value: number): void;
  spinWheels(distance: number): void;
  dispose(): void;
}

/**
 * What a machine's silhouette is made of.
 *
 * Drawn from the reference plates in `docs/design/img2threejs-inputs/`
 * (chassis-{balanced,heavy,light,buggy}-reference.png), which are deliberately
 * toy-like: every one of them reads as boxes, cylinders and a torus, which is
 * the whole reason they were commissioned that way. Two things in the plates
 * are NOT reproduced, and on purpose — the light chassis's bucket seat is a
 * compound curve (a rounded box stands in) and the buggy's coil springs are
 * helices (a plain cylinder stands in). At the size a kart occupies on screen
 * neither is legible, and both would cost real geometry.
 *
 * The plates themselves never ship: `docs/` is outside `src/`, so the bundle
 * still contains no image bytes at all.
 */
interface ShapeSpec {
  readonly hull: { w: number; h: number; l: number; radius: number };
  readonly hullY: number;
  readonly nose: { front: number; back: number; length: number; z: number };
  readonly pod: { x: number; w: number; h: number; l: number; z: number } | null;
  readonly seat: { w: number; h: number; l: number; y: number; z: number };
  readonly wing: "flat" | "tall" | "lip" | "none";
  readonly cage: boolean;
  readonly spare: boolean;
  readonly rideHeight: number;
  readonly trackWidth: number;
  readonly wheelbase: number;
  readonly frontWheel: number;
  readonly rearWheel: number;
}

const SHAPE_SPECS: Readonly<Record<MachineShape, ShapeSpec>> = {
  // The numbers the kart shipped with. [K4] holds them to it.
  standard: {
    hull: { w: 2.05, h: 0.62, l: 3.15, radius: 0.24 },
    hullY: 0.52,
    nose: { front: 0.16, back: 0.62, length: 1.25, z: -2.0 },
    pod: { x: 1.12, w: 0.5, h: 0.46, l: 1.5, z: 0.15 },
    seat: { w: 0.95, h: 0.58, l: 0.9, y: 0.92, z: 0.55 },
    wing: "flat",
    cage: false,
    spare: false,
    rideHeight: 0.5,
    trackWidth: 1.02,
    wheelbase: 1.15,
    frontWheel: 1,
    rearWheel: 1.16,
  },
  heavy: {
    hull: { w: 2.3, h: 0.54, l: 3.6, radius: 0.2 },
    hullY: 0.44,
    nose: { front: 0.5, back: 0.72, length: 1.5, z: -2.25 },
    pod: { x: 1.28, w: 0.56, h: 0.5, l: 2.0, z: 0.2 },
    seat: { w: 1.02, h: 0.66, l: 0.95, y: 0.86, z: 0.6 },
    wing: "tall",
    cage: true,
    spare: false,
    rideHeight: 0.46,
    trackWidth: 1.16,
    wheelbase: 1.32,
    frontWheel: 0.94,
    rearWheel: 1.34,
  },
  light: {
    hull: { w: 1.7, h: 0.5, l: 2.7, radius: 0.2 },
    hullY: 0.48,
    nose: { front: 0.14, back: 0.44, length: 0.95, z: -1.7 },
    pod: null,
    seat: { w: 0.82, h: 0.54, l: 0.8, y: 0.86, z: 0.46 },
    wing: "lip",
    cage: false,
    spare: false,
    rideHeight: 0.44,
    trackWidth: 0.9,
    wheelbase: 1.0,
    frontWheel: 0.86,
    rearWheel: 0.96,
  },
  buggy: {
    hull: { w: 1.95, h: 0.66, l: 2.9, radius: 0.16 },
    hullY: 0.74,
    nose: { front: 0.42, back: 0.58, length: 1.0, z: -1.85 },
    pod: { x: 1.02, w: 0.42, h: 0.4, l: 1.2, z: 0.1 },
    seat: { w: 0.9, h: 0.62, l: 0.85, y: 1.16, z: 0.5 },
    wing: "none",
    cage: true,
    spare: true,
    rideHeight: 0.78,
    trackWidth: 1.1,
    wheelbase: 1.2,
    frontWheel: 1.22,
    rearWheel: 1.28,
  },
};

/** Per-kart, per-shape: the hull and the trim cluster. */
interface ShapeGeometry {
  body: THREE.BufferGeometry;
  spoiler: THREE.BufferGeometry;
  spec: ShapeSpec;
  dispose(): void;
}

/** Shared by every kart on the grid regardless of machine. */
interface CommonGeometry {
  wheel: THREE.BufferGeometry;
  helmet: THREE.BufferGeometry;
  torso: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;
  exhaust: THREE.BufferGeometry;
  shadow: THREE.BufferGeometry;
  dispose(): void;
}

let common: CommonGeometry | null = null;
const shapes = new Map<MachineShape, ShapeGeometry>();

function commonGeometry(): CommonGeometry {
  if (common) return common;

  // Tyre torus + hub disc, merged: reads as a wheel instead of a puck.
  const tyre = new THREE.TorusGeometry(0.36, 0.17, 10, 18);
  tyre.rotateY(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.19, 0.19, 0.4, 10);
  hub.rotateZ(Math.PI / 2);
  const wheel = mergeGeometries([tyre, hub])!;
  tyre.dispose();
  hub.dispose();

  const helmet = new THREE.SphereGeometry(0.36, 16, 12);
  const torso = new THREE.CapsuleGeometry(0.28, 0.34, 4, 10);
  // Arms cost nothing (they share the suit material and merge into the torso
  // mesh's material family) and are the only thing that makes the driver read
  // as steering rather than sitting.
  const arm = new THREE.CapsuleGeometry(0.09, 0.34, 3, 6);
  arm.rotateX(Math.PI / 2.6);
  const exhaust = new THREE.ConeGeometry(0.2, 0.9, 8, 1, true);
  exhaust.rotateX(Math.PI / 2);

  const shadow = new THREE.CircleGeometry(1.35, 20);
  shadow.rotateX(-Math.PI / 2);

  common = {
    wheel,
    helmet,
    torso,
    arm,
    exhaust,
    shadow,
    dispose() {
      wheel.dispose();
      helmet.dispose();
      torso.dispose();
      arm.dispose();
      exhaust.dispose();
      shadow.dispose();
    },
  };
  return common;
}

function buildShape(shape: MachineShape): ShapeGeometry {
  const spec = SHAPE_SPECS[shape];

  const parts: THREE.BufferGeometry[] = [];
  const hull = new RoundedBoxGeometry(
    spec.hull.w,
    spec.hull.h,
    spec.hull.l,
    3,
    spec.hull.radius,
  ).toNonIndexed();
  hull.translate(0, spec.hullY, 0);
  parts.push(hull);
  const nose = new THREE.CylinderGeometry(
    spec.nose.front,
    spec.nose.back,
    spec.nose.length,
    8,
  ).toNonIndexed();
  nose.rotateX(Math.PI / 2);
  nose.translate(0, spec.hullY - 0.04, spec.nose.z);
  parts.push(nose);
  if (spec.pod) {
    for (const side of [1, -1] as const) {
      const pod = new RoundedBoxGeometry(
        spec.pod.w,
        spec.pod.h,
        spec.pod.l,
        2,
        0.16,
      ).toNonIndexed();
      pod.translate(side * spec.pod.x, spec.hullY - 0.06, spec.pod.z);
      parts.push(pod);
    }
  }
  const seat = new RoundedBoxGeometry(
    spec.seat.w,
    spec.seat.h,
    spec.seat.l,
    2,
    0.18,
  ).toNonIndexed();
  seat.translate(0, spec.seat.y, spec.seat.z);
  parts.push(seat);
  const body = mergeGeometries(parts)!;
  for (const part of parts) part.dispose();

  const trim: THREE.BufferGeometry[] = [];
  const wingY = spec.seat.y + 0.4;
  if (spec.wing === "flat" || spec.wing === "tall") {
    const height = spec.wing === "tall" ? wingY + 0.34 : wingY;
    const wing = new RoundedBoxGeometry(
      spec.hull.w + 0.05,
      0.12,
      spec.wing === "tall" ? 0.78 : 0.62,
      2,
      0.05,
    ).toNonIndexed();
    wing.translate(0, height, spec.hull.l / 2 + 0.05);
    trim.push(wing);
    for (const side of [1, -1] as const) {
      const strut = new THREE.BoxGeometry(0.12, height - spec.hullY, 0.14).toNonIndexed();
      strut.translate(
        side * (spec.hull.w * 0.38),
        (height + spec.hullY) / 2,
        spec.hull.l / 2 + 0.03,
      );
      trim.push(strut);
    }
  } else if (spec.wing === "lip") {
    const lip = new THREE.BoxGeometry(spec.hull.w * 0.8, 0.1, 0.34).toNonIndexed();
    lip.translate(0, spec.hullY + 0.34, spec.hull.l / 2);
    trim.push(lip);
  }
  if (spec.cage) {
    // Two hoops and a spine: cylinders only, which is what the plates show.
    for (const z of [spec.seat.z - 0.5, spec.seat.z + 0.55]) {
      for (const side of [1, -1] as const) {
        const post = new THREE.CylinderGeometry(0.06, 0.06, 1.0, 6).toNonIndexed();
        post.translate(side * spec.hull.w * 0.4, spec.seat.y + 0.5, z);
        trim.push(post);
      }
      const cross = new THREE.CylinderGeometry(0.06, 0.06, spec.hull.w * 0.8, 6).toNonIndexed();
      cross.rotateZ(Math.PI / 2);
      cross.translate(0, spec.seat.y + 1.0, z);
      trim.push(cross);
    }
    const spine = new THREE.CylinderGeometry(0.055, 0.055, 1.05, 6).toNonIndexed();
    spine.rotateX(Math.PI / 2);
    spine.translate(0, spec.seat.y + 1.0, spec.seat.z + 0.02);
    trim.push(spine);
  }
  if (spec.spare) {
    /*
     * The torus is the one primitive here that arrives indexed, and
     * mergeGeometries refuses a list that is part indexed and part not. The
     * rounded boxes and cylinders are already non-indexed, so `toNonIndexed`
     * hands them straight back — this is the only call that allocates, and so
     * the only one with a source to release.
     */
    const indexed = new THREE.TorusGeometry(0.34, 0.15, 8, 14);
    const spare = indexed.toNonIndexed();
    indexed.dispose();
    spare.translate(0, spec.seat.y + 0.62, spec.hull.l / 2 + 0.05);
    trim.push(spare);
  }
  const spoiler =
    trim.length > 0
      ? mergeGeometries(trim)!
      : new THREE.BufferGeometry().setAttribute(
          "position",
          new THREE.BufferAttribute(new Float32Array(9), 3),
        );
  for (const part of trim) part.dispose();

  const built: ShapeGeometry = {
    body,
    spoiler,
    spec,
    dispose() {
      body.dispose();
      spoiler.dispose();
    },
  };
  return built;
}

function shapeGeometry(shape: MachineShape): ShapeGeometry {
  const hit = shapes.get(shape);
  if (hit) return hit;
  const built = buildShape(shape);
  shapes.set(shape, built);
  return built;
}

/**
 * Releases the process-wide kart geometry. Only the scene teardown calls it.
 *
 * The cache is emptied HERE rather than inside each entry's `dispose` — an
 * entry that removed itself from the map would be mutating the collection the
 * caller is iterating.
 */
export function disposeSharedKartGeometry(): void {
  common?.dispose();
  common = null;
  for (const entry of shapes.values()) entry.dispose();
  shapes.clear();
}

/**
 * How many shapes the cache is currently holding. Only the gate reads it —
 * "dispose released the geometry" is otherwise an unobservable claim, and an
 * unobservable claim is one that quietly stops being true.
 */
export function sharedKartShapeCount(): number {
  return shapes.size;
}

export interface KartVisualOptions {
  readonly livery: number;
  readonly castShadow: boolean;
  readonly raceNumber?: number;
  readonly headlights?: boolean;
  /** Omit for the shape the kart has always had. */
  readonly shape?: MachineShape;
  /**
   * Seam for the two painted textures, matching `SetPieceContext.texture`.
   * Both real ones paint a canvas, which needs a `document`; the budget gate
   * counts the scene graph in Node and hands in blanks instead. The meshes are
   * built either way, so the count is the count.
   */
  readonly textures?: KartTextureFactory;
}

export interface KartTextureFactory {
  readonly roundel: (raceNumber: number, accent: string) => THREE.Texture;
  readonly headlightPool: () => THREE.Texture;
}

const PAINTED_TEXTURES: KartTextureFactory = {
  roundel: roundelTexture,
  headlightPool: headlightPoolTexture,
};

export function createKartVisual(options: KartVisualOptions): KartVisual {
  const {
    livery: liveryIndex,
    castShadow,
    raceNumber,
    headlights = false,
    shape = "standard",
    textures = PAINTED_TEXTURES,
  } = options;
  const shaped = shapeGeometry(shape);
  const spec = shaped.spec;
  const geometry = { ...commonGeometry(), body: shaped.body, spoiler: shaped.spoiler };
  const livery = liveryOf(liveryIndex);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const roundelPieces: { dispose(): void }[] = [];
  const paint = new THREE.MeshStandardMaterial({
    color: livery.body,
    roughness: 0.28,
    metalness: 0.45,
    envMapIntensity: 1.1,
  });
  const trim = new THREE.MeshStandardMaterial({
    color: livery.trim,
    roughness: 0.5,
    metalness: 0.3,
  });
  const rubber = new THREE.MeshStandardMaterial({
    color: 0x14161a,
    roughness: 0.92,
  });
  const suit = new THREE.MeshStandardMaterial({
    color: livery.suit,
    roughness: 0.7,
  });
  const glow = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    toneMapped: false,
    depthWrite: false,
  });
  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  });

  const hull = new THREE.Mesh(geometry.body, paint);
  hull.castShadow = castShadow;
  body.add(hull);

  const spoiler = new THREE.Mesh(geometry.spoiler, trim);
  spoiler.castShadow = castShadow;
  body.add(spoiler);

  const driverY = spec.seat.y + 0.36;
  const torso = new THREE.Mesh(geometry.torso, suit);
  torso.position.set(0, driverY, spec.seat.z - 0.05);
  torso.castShadow = castShadow;
  body.add(torso);

  // Two arms reaching for a wheel that is not modelled. They cost no draw
  // call (same material as the torso) and are the only thing that makes the
  // driver read as driving rather than being carried.
  const arms: THREE.Object3D[] = [];
  for (const side of [1, -1] as const) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.22, driverY + 0.16, spec.seat.z - 0.2);
    const arm = new THREE.Mesh(geometry.arm, suit);
    arm.position.z = -0.16;
    pivot.add(arm);
    body.add(pivot);
    arms.push(pivot);
  }

  const helmet = new THREE.Mesh(geometry.helmet, trim);
  helmet.position.set(0, driverY + 0.5, spec.seat.z - 0.09);
  helmet.castShadow = castShadow;
  body.add(helmet);

  // Race-number roundel on the nose. Texture is per-kart, so it is owned and
  // disposed here rather than shared like the geometry set.
  if (raceNumber !== undefined) {
    const accent = "#" + livery.body.toString(16).padStart(6, "0");
    const roundelMap = textures.roundel(raceNumber, accent);
    const roundelGeometry = new THREE.CircleGeometry(0.36, 24);
    const roundelMaterial = new THREE.MeshBasicMaterial({
      map: roundelMap,
      transparent: true,
    });
    const roundel = new THREE.Mesh(roundelGeometry, roundelMaterial);
    roundel.position.set(0, spec.hullY + 0.34, spec.nose.z + 0.48);
    roundel.rotation.x = -0.62;
    body.add(roundel);
    roundelPieces.push(
      { dispose: () => roundelGeometry.dispose() },
      { dispose: () => roundelMaterial.dispose() },
      { dispose: () => roundelMap.dispose() },
    );
  }

  const frontWheels: THREE.Object3D[] = [];
  const rearWheels: THREE.Object3D[] = [];
  for (const side of [1, -1] as const) {
    const steerPivot = new THREE.Group();
    steerPivot.position.set(
      side * spec.trackWidth,
      spec.rideHeight,
      -spec.wheelbase,
    );
    const front = new THREE.Mesh(geometry.wheel, rubber);
    front.scale.setScalar(spec.frontWheel);
    front.castShadow = castShadow;
    steerPivot.add(front);
    body.add(steerPivot);
    frontWheels.push(steerPivot);

    const rear = new THREE.Mesh(geometry.wheel, rubber);
    rear.position.set(
      side * (spec.trackWidth + 0.06),
      spec.rideHeight + 0.06,
      spec.wheelbase - 0.03,
    );
    rear.scale.setScalar(spec.rearWheel);
    rear.castShadow = castShadow;
    body.add(rear);
    rearWheels.push(rear);
  }

  const exhausts: THREE.Mesh[] = [];
  for (const side of [1, -1] as const) {
    const flame = new THREE.Mesh(geometry.exhaust, glow.clone());
    flame.position.set(side * 0.5, 0.62, 1.9);
    flame.visible = false;
    body.add(flame);
    exhausts.push(flame);
  }

  // Night circuits: two lamp discs and one additive cone. No real light —
  // eight PointLights would recompile every material in the scene (the
  // HARBOR WORLD lesson); a cone that BRIGHTENS reads as a beam regardless.
  const headlightPieces: { dispose(): void }[] = [];
  if (headlights) {
    const lampGeometry = new THREE.CircleGeometry(0.16, 10);
    const lampMaterial = new THREE.MeshBasicMaterial({
      color: 0xfff2c8,
      toneMapped: false,
    });
    lampMaterial.color.multiplyScalar(1.9);
    for (const side of [1, -1] as const) {
      const lamp = new THREE.Mesh(lampGeometry, lampMaterial);
      lamp.position.set(side * 0.42, 0.62, -2.32);
      lamp.rotation.x = -0.12;
      lamp.rotation.y = Math.PI;
      body.add(lamp);
    }
    /*
     * A light POOL on the road, not a volumetric cone. The cone version was
     * a giant opaque wedge from any side angle — an open cone silhouette is
     * two hard-edged triangles, and additive blending cannot soften a
     * silhouette. A gradient quad lying on the tarmac reads as thrown light
     * from every angle for one draw call.
     */
    const poolGeometry = new THREE.PlaneGeometry(6.5, 13);
    poolGeometry.rotateX(-Math.PI / 2);
    const poolMaterial = new THREE.MeshBasicMaterial({
      map: textures.headlightPool(),
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const pool = new THREE.Mesh(poolGeometry, poolMaterial);
    pool.position.set(0, 0.12, -8.2);
    pool.renderOrder = -1.2;
    body.add(pool);
    headlightPieces.push(
      { dispose: () => lampGeometry.dispose() },
      { dispose: () => lampMaterial.dispose() },
      { dispose: () => poolGeometry.dispose() },
      { dispose: () => poolMaterial.dispose() },
    );
  }

  // A cheap contact shadow so a kart never looks like it is hovering, even on
  // the tier where real shadow maps are off.
  const contact = new THREE.Mesh(geometry.shadow, shadowMaterial);
  contact.position.y = 0.04;
  contact.renderOrder = -1;
  root.add(contact);

  const wheelRadius = 0.52;

  return {
    root,
    body,
    frontWheels,
    rearWheels,
    exhausts,
    helmet,
    livery,
    setSteer(value) {
      // Negated: the wheels face local -Z, and Ry swings that toward -X, so a
      // positive (rightward) steer needs a negative rotation.
      for (const pivot of frontWheels) pivot.rotation.y = -value * 0.45;
    },
    spinWheels(distance) {
      const angle = distance / wheelRadius;
      for (const pivot of frontWheels) {
        const wheel = pivot.children[0] as THREE.Mesh | undefined;
        if (wheel) wheel.rotation.x = angle;
      }
      for (const wheel of rearWheels) wheel.rotation.x = angle;
    },
    dispose() {
      paint.dispose();
      trim.dispose();
      rubber.dispose();
      suit.dispose();
      glow.dispose();
      shadowMaterial.dispose();
      for (const piece of roundelPieces) piece.dispose();
      for (const piece of headlightPieces) piece.dispose();
      for (const flame of exhausts) {
        (flame.material as THREE.Material).dispose();
      }
      root.clear();
    },
  };
}
