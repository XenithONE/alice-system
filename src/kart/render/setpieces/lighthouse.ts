/**
 * The lighthouse — SUNSET COAST's landmark, img2threejs-style: a factory
 * returning a `THREE.Group` of primitives with named nodes and a `tick`, the
 * same contract as the harbour's generated skiff (reference image:
 * docs/design/img2threejs-inputs/lighthouse-reference.png — white tower, red
 * bands, gallery, lamp room, rock base). No real light source: the beacon is
 * two opposed additive cones on a pivot, which reads as a rotating beam for
 * a fraction of a spotlight's cost.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { emissiveStrip } from "./index";

export interface Lighthouse {
  readonly root: THREE.Group;
  update(elapsed: number): void;
  dispose(): void;
}

export function createLighthouse(shadows: boolean): Lighthouse {
  const root = new THREE.Group();
  root.name = "lighthouse";
  const disposables: { dispose(): void }[] = [];

  // ── Rock base ─────────────────────────────────────────────────────────────
  const rockGeometry = new THREE.DodecahedronGeometry(7.2, 0);
  rockGeometry.scale(1.35, 0.5, 1.2);
  const rockMaterial = new THREE.MeshStandardMaterial({
    color: 0x5c5350,
    roughness: 0.95,
    flatShading: true,
  });
  const rock = new THREE.Mesh(rockGeometry, rockMaterial);
  rock.position.y = 0.4;
  rock.castShadow = shadows;
  root.add(rock);
  disposables.push(
    { dispose: () => rockGeometry.dispose() },
    { dispose: () => rockMaterial.dispose() },
  );

  // ── Tower: white body with red bands, as merged ring segments ────────────
  const towerParts: THREE.BufferGeometry[] = [];
  const BANDS = 5;
  const baseRadius = 3.1;
  const topRadius = 2.0;
  const towerHeight = 21;
  for (let band = 0; band < BANDS; band += 1) {
    const y0 = (band / BANDS) * towerHeight;
    const y1 = ((band + 1) / BANDS) * towerHeight;
    const r0 = baseRadius + (topRadius - baseRadius) * (band / BANDS);
    const r1 = baseRadius + (topRadius - baseRadius) * ((band + 1) / BANDS);
    const segment = new THREE.CylinderGeometry(r1, r0, y1 - y0, 14);
    segment.translate(0, (y0 + y1) / 2 + 2, 0);
    towerParts.push(segment);
  }
  // Alternate bands into two merged meshes (white / red) — two draw calls.
  const whiteGeometry = mergeGeometries(
    towerParts.filter((_, index) => index % 2 === 0),
  )!;
  const redGeometry = mergeGeometries(
    towerParts.filter((_, index) => index % 2 === 1),
  )!;
  for (const part of towerParts) part.dispose();
  const whiteMaterial = new THREE.MeshStandardMaterial({
    color: 0xf2eee6,
    roughness: 0.6,
  });
  const redMaterial = new THREE.MeshStandardMaterial({
    color: 0xd8453a,
    roughness: 0.62,
  });
  const whiteMesh = new THREE.Mesh(whiteGeometry, whiteMaterial);
  const redMesh = new THREE.Mesh(redGeometry, redMaterial);
  whiteMesh.castShadow = shadows;
  redMesh.castShadow = shadows;
  root.add(whiteMesh, redMesh);
  disposables.push(
    { dispose: () => whiteGeometry.dispose() },
    { dispose: () => redGeometry.dispose() },
    { dispose: () => whiteMaterial.dispose() },
    { dispose: () => redMaterial.dispose() },
  );

  // ── Gallery, lamp room, roof — one merged trim mesh ──────────────────────
  const trimParts: THREE.BufferGeometry[] = [];
  const gallery = new THREE.CylinderGeometry(3.0, 3.0, 0.5, 14);
  gallery.translate(0, towerHeight + 2.3, 0);
  trimParts.push(gallery);
  const railing = new THREE.TorusGeometry(2.9, 0.09, 6, 18);
  railing.rotateX(Math.PI / 2);
  railing.translate(0, towerHeight + 3.3, 0);
  trimParts.push(railing.toNonIndexed());
  const roof = new THREE.ConeGeometry(2.4, 2.6, 12);
  roof.translate(0, towerHeight + 7.3, 0);
  trimParts.push(roof);
  const trimGeometry = mergeGeometries(
    trimParts.map((part) => (part.index ? part.toNonIndexed() : part)),
  )!;
  for (const part of trimParts) part.dispose();
  const trimMaterial = new THREE.MeshStandardMaterial({
    color: 0x37414e,
    roughness: 0.5,
    metalness: 0.35,
  });
  const trim = new THREE.Mesh(trimGeometry, trimMaterial);
  trim.castShadow = shadows;
  root.add(trim);
  disposables.push(
    { dispose: () => trimGeometry.dispose() },
    { dispose: () => trimMaterial.dispose() },
  );

  // ── Lamp room glass (emissive) ────────────────────────────────────────────
  const lampGeometry = new THREE.CylinderGeometry(1.7, 1.7, 2.4, 10);
  lampGeometry.translate(0, towerHeight + 4.9, 0);
  const lampMaterial = emissiveStrip(0xffe9b0, 1.7);
  const lamp = new THREE.Mesh(lampGeometry, lampMaterial);
  root.add(lamp);
  disposables.push(
    { dispose: () => lampGeometry.dispose() },
    { dispose: () => lampMaterial.dispose() },
  );

  // ── The rotating beam: two opposed additive cones on a pivot ─────────────
  const beamPivot = new THREE.Group();
  beamPivot.name = "beacon-pivot";
  beamPivot.position.y = towerHeight + 4.9;
  const beamGeometry = new THREE.ConeGeometry(3.4, 46, 10, 1, true);
  beamGeometry.rotateZ(Math.PI / 2);
  beamGeometry.translate(23, 0, 0);
  const beamMaterial = new THREE.MeshBasicMaterial({
    color: 0xffe9b0,
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  for (const direction of [0, Math.PI]) {
    const beam = new THREE.Mesh(beamGeometry, beamMaterial);
    beam.rotation.y = direction;
    beamPivot.add(beam);
  }
  root.add(beamPivot);
  disposables.push(
    { dispose: () => beamGeometry.dispose() },
    { dispose: () => beamMaterial.dispose() },
  );

  return {
    root,
    update(elapsed) {
      beamPivot.rotation.y = elapsed * 0.55;
      // The lamp breathes in time with the passing beam.
      lampMaterial.color.setHex(0xffe9b0).multiplyScalar(
        1.3 + Math.sin(elapsed * 0.55 * 2) * 0.4,
      );
    },
    dispose() {
      for (const item of disposables) item.dispose();
    },
  };
}
