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

interface SharedGeometry {
  body: THREE.BufferGeometry;
  spoiler: THREE.BufferGeometry;
  wheel: THREE.BufferGeometry;
  helmet: THREE.BufferGeometry;
  torso: THREE.BufferGeometry;
  exhaust: THREE.BufferGeometry;
  shadow: THREE.BufferGeometry;
  dispose(): void;
}

let shared: SharedGeometry | null = null;

function sharedGeometry(): SharedGeometry {
  if (shared) return shared;

  // Chassis: a rounded slab, a tapered nose, and two side pods, merged so the
  // whole hull is one draw call per kart.
  const parts: THREE.BufferGeometry[] = [];
  const hull = new RoundedBoxGeometry(2.05, 0.62, 3.15, 3, 0.24).toNonIndexed();
  hull.translate(0, 0.52, 0);
  parts.push(hull);
  const nose = new THREE.CylinderGeometry(0.16, 0.62, 1.25, 8).toNonIndexed();
  nose.rotateX(Math.PI / 2);
  nose.translate(0, 0.48, -2.0);
  parts.push(nose);
  for (const side of [1, -1] as const) {
    const pod = new RoundedBoxGeometry(0.5, 0.46, 1.5, 2, 0.16).toNonIndexed();
    pod.translate(side * 1.12, 0.46, 0.15);
    parts.push(pod);
  }
  const seat = new RoundedBoxGeometry(0.95, 0.58, 0.9, 2, 0.18).toNonIndexed();
  seat.translate(0, 0.92, 0.55);
  parts.push(seat);
  const body = mergeGeometries(parts)!;
  for (const part of parts) part.dispose();

  const spoilerParts: THREE.BufferGeometry[] = [];
  const wing = new RoundedBoxGeometry(2.1, 0.12, 0.62, 2, 0.05).toNonIndexed();
  wing.translate(0, 1.32, 1.62);
  spoilerParts.push(wing);
  for (const side of [1, -1] as const) {
    const strut = new THREE.BoxGeometry(0.12, 0.6, 0.14).toNonIndexed();
    strut.translate(side * 0.78, 1.02, 1.6);
    spoilerParts.push(strut);
  }
  const spoiler = mergeGeometries(spoilerParts)!;
  for (const part of spoilerParts) part.dispose();

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
  const exhaust = new THREE.ConeGeometry(0.2, 0.9, 8, 1, true);
  exhaust.rotateX(Math.PI / 2);

  const shadow = new THREE.CircleGeometry(1.35, 20);
  shadow.rotateX(-Math.PI / 2);

  shared = {
    body,
    spoiler,
    wheel,
    helmet,
    torso,
    exhaust,
    shadow,
    dispose() {
      body.dispose();
      spoiler.dispose();
      wheel.dispose();
      helmet.dispose();
      torso.dispose();
      exhaust.dispose();
      shadow.dispose();
      shared = null;
    },
  };
  return shared;
}

/** Releases the process-wide kart geometry. Only the scene teardown calls it. */
export function disposeSharedKartGeometry(): void {
  shared?.dispose();
}

export function createKartVisual(
  liveryIndex: number,
  castShadow: boolean,
  raceNumber?: number,
  headlights = false,
): KartVisual {
  const geometry = sharedGeometry();
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

  const torso = new THREE.Mesh(geometry.torso, suit);
  torso.position.set(0, 1.28, 0.5);
  torso.castShadow = castShadow;
  body.add(torso);

  const helmet = new THREE.Mesh(geometry.helmet, trim);
  helmet.position.set(0, 1.78, 0.46);
  helmet.castShadow = castShadow;
  body.add(helmet);

  // Race-number roundel on the nose. Texture is per-kart, so it is owned and
  // disposed here rather than shared like the geometry set.
  if (raceNumber !== undefined) {
    const accent = "#" + livery.body.toString(16).padStart(6, "0");
    const roundelMap = roundelTexture(raceNumber, accent);
    const roundelGeometry = new THREE.CircleGeometry(0.36, 24);
    const roundelMaterial = new THREE.MeshBasicMaterial({
      map: roundelMap,
      transparent: true,
    });
    const roundel = new THREE.Mesh(roundelGeometry, roundelMaterial);
    roundel.position.set(0, 0.86, -1.52);
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
    steerPivot.position.set(side * 1.02, 0.5, -1.15);
    const front = new THREE.Mesh(geometry.wheel, rubber);
    front.castShadow = castShadow;
    steerPivot.add(front);
    body.add(steerPivot);
    frontWheels.push(steerPivot);

    const rear = new THREE.Mesh(geometry.wheel, rubber);
    rear.position.set(side * 1.08, 0.56, 1.12);
    rear.scale.setScalar(1.16);
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
      map: headlightPoolTexture(),
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
      for (const pivot of frontWheels) pivot.rotation.y = value * 0.45;
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
