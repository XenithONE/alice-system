/**
 * DUST BASIN's identity: the mesa the road falls off, and the dust it kicks up.
 *
 * The circuit starts on a paved farm road across the top of a plateau, drops
 * 24 m over a cliff lip, and spends the rest of the lap on the basin floor. So
 * the two things worth building are the wall the road came down, and the empty
 * horizon it left behind:
 *
 *   - layered mesa walls ringing the basin, banded so the strata read
 *   - buttes standing free on the floor, instanced
 *   - a wind pump on the farm road, turning
 *   - dust devils: thin columns that drift, reusing the lighthouse's trick of
 *     a cheap additive shape doing atmospheric work
 *   - a rock arch across the road at 9 m, the second legal use of the corridor
 *     gate's above-4.2 m allowance
 */

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mulberry32 } from "../../../lib/seed";
import { sampleAt, type Track } from "../../sim/track";
import type { SetPieceBundle, SetPieceContext } from "./index";

interface Devil {
  readonly mesh: THREE.Mesh;
  readonly baseX: number;
  readonly baseZ: number;
  readonly phase: number;
  readonly drift: number;
}

export function buildDustBasin(
  track: Track,
  context: SetPieceContext,
): SetPieceBundle {
  const group = new THREE.Group();
  group.name = "setpiece:dust-basin";
  const disposables: { dispose(): void }[] = [];
  const theme = track.spec.theme;
  const random = mulberry32(0xd05b ^ track.samples.length);

  const centerX = (track.bounds.minX + track.bounds.maxX) / 2;
  const centerZ = (track.bounds.minZ + track.bounds.maxZ) / 2;
  const floorY = track.bounds.minY - 2;
  const outerRadius =
    Math.max(
      track.bounds.maxX - track.bounds.minX,
      track.bounds.maxZ - track.bounds.minZ,
    ) *
      0.5 +
    150;

  // ── Mesa walls and free-standing buttes ──────────────────────────────────
  {
    const count = Math.max(16, Math.round(52 * context.detail));
    /*
     * Three stacked cylinders per landform with slightly different radii, so
     * the silhouette steps the way sedimentary rock does. One tapered cone
     * would have been a hill; the steps are what make it a mesa.
     */
    const BANDS: { color: number; from: number; to: number }[] = [
      { color: 0x9c6f47, from: 0, to: 0.44 },
      { color: 0xb4834f, from: 0.44 , to: 0.78 },
      { color: 0xcb9b60, from: 0.78, to: 1 },
    ];
    for (const band of BANDS) {
      const geometry = new THREE.CylinderGeometry(0.92, 1, 1, 7, 1);
      const material = new THREE.MeshStandardMaterial({
        color: band.color,
        roughness: 0.97,
        flatShading: true,
      });
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      const dummy = new THREE.Object3D();
      // Same stream order for every band, so the three stack on one another.
      const seeded = mulberry32(0x5c1f ^ track.samples.length);
      for (let i = 0; i < count; i += 1) {
        const angle =
          (i / count) * Math.PI * 2 +
          (seeded() - 0.5) * ((Math.PI * 2) / count);
        // A third stand free on the floor as buttes; the rest ring the basin.
        const butte = i % 3 === 0;
        const radius = butte
          ? outerRadius * (0.62 + seeded() * 0.16)
          : outerRadius + seeded() * 320;
        const height = butte ? 26 + seeded() * 34 : 64 + seeded() * 90;
        const wide = butte ? 14 + seeded() * 16 : 46 + seeded() * 70;
        const x = centerX + Math.cos(angle) * radius;
        const z = centerZ + Math.sin(angle) * radius;
        const bandHeight = height * (band.to - band.from);
        dummy.position.set(
          x,
          floorY + height * band.from + bandHeight / 2,
          z,
        );
        dummy.rotation.set(0, seeded() * Math.PI, 0);
        dummy.scale.set(
          wide * (1 - band.from * 0.18),
          bandHeight,
          wide * (1 - band.from * 0.18),
        );
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = context.shadows && band.from === 0;
      mesh.frustumCulled = false;
      group.add(mesh);
      disposables.push(
        { dispose: () => geometry.dispose() },
        { dispose: () => material.dispose() },
        { dispose: () => mesh.dispose() },
      );
    }
  }

  // ── The rock arch over the road ──────────────────────────────────────────
  {
    const sample = sampleAt(track, track.length * 0.71);
    const parts: THREE.BufferGeometry[] = [];
    const legOut = sample.half + 7;
    for (const side of [1, -1] as const) {
      const leg = new THREE.BoxGeometry(7, 9, 11);
      leg.translate(side * legOut, 4.5, 0);
      parts.push(leg.toNonIndexed());
    }
    // The span sits at 9 m, clear of a kart and its chase camera by design.
    const span = new THREE.BoxGeometry(legOut * 2 + 7, 5, 11);
    span.translate(0, 11.5, 0);
    parts.push(span.toNonIndexed());
    const merged = mergeGeometries(parts)!;
    for (const part of parts) part.dispose();
    const material = new THREE.MeshStandardMaterial({
      color: 0xa87a4c,
      roughness: 0.96,
      flatShading: true,
    });
    const arch = new THREE.Mesh(merged, material);
    arch.castShadow = context.shadows;
    arch.position.set(sample.x, sample.y, sample.z);
    arch.rotation.y = Math.atan2(sample.tx, sample.tz);
    group.add(arch);
    disposables.push(
      { dispose: () => merged.dispose() },
      { dispose: () => material.dispose() },
    );
  }

  // ── The wind pump on the farm road ───────────────────────────────────────
  let blades: THREE.Mesh | null = null;
  {
    const sample = sampleAt(track, track.length * 0.08);
    const lateral = sample.half + 26;
    const towerParts: THREE.BufferGeometry[] = [];
    for (const [dx, dz] of [
      [-1.6, -1.6],
      [1.6, -1.6],
      [-1.6, 1.6],
      [1.6, 1.6],
    ] as const) {
      const leg = new THREE.BoxGeometry(0.5, 16, 0.5);
      leg.translate(dx * 0.55, 8, dz * 0.55);
      towerParts.push(leg.toNonIndexed());
    }
    const towerGeometry = mergeGeometries(towerParts)!;
    for (const part of towerParts) part.dispose();
    const towerMaterial = new THREE.MeshStandardMaterial({
      color: 0x6b5f4e,
      roughness: 0.9,
      metalness: 0.3,
    });
    const tower = new THREE.Mesh(towerGeometry, towerMaterial);
    tower.castShadow = context.shadows;
    tower.position.set(
      sample.x + sample.rx * lateral,
      sample.y,
      sample.z + sample.rz * lateral,
    );
    group.add(tower);

    const bladeParts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 12; i += 1) {
      const blade = new THREE.BoxGeometry(0.4, 3.4, 0.08);
      blade.translate(0, 2.2, 0);
      blade.rotateZ((i / 12) * Math.PI * 2);
      bladeParts.push(blade.toNonIndexed());
    }
    const bladeGeometry = mergeGeometries(bladeParts)!;
    for (const part of bladeParts) part.dispose();
    const bladeMaterial = new THREE.MeshStandardMaterial({
      color: 0xd9cbb2,
      roughness: 0.7,
      metalness: 0.25,
      side: THREE.DoubleSide,
    });
    blades = new THREE.Mesh(bladeGeometry, bladeMaterial);
    blades.castShadow = context.shadows;
    blades.position.set(tower.position.x, sample.y + 16.5, tower.position.z);
    group.add(blades);
    disposables.push(
      { dispose: () => towerGeometry.dispose() },
      { dispose: () => towerMaterial.dispose() },
      { dispose: () => bladeGeometry.dispose() },
      { dispose: () => bladeMaterial.dispose() },
    );
  }

  // ── Dust devils ──────────────────────────────────────────────────────────
  const devils: Devil[] = [];
  {
    const count = Math.max(2, Math.round(6 * context.detail));
    const geometry = new THREE.ConeGeometry(3.4, 30, 7, 1, true);
    const material = new THREE.MeshBasicMaterial({
      color: theme.groundAccent,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < count; i += 1) {
      const angle = random() * Math.PI * 2;
      const radius = outerRadius * (0.3 + random() * 0.4);
      const mesh = new THREE.Mesh(geometry, material);
      const baseX = centerX + Math.cos(angle) * radius;
      const baseZ = centerZ + Math.sin(angle) * radius;
      mesh.position.set(baseX, floorY + 15, baseZ);
      mesh.renderOrder = -1;
      group.add(mesh);
      devils.push({
        mesh,
        baseX,
        baseZ,
        phase: random() * Math.PI * 2,
        drift: 18 + random() * 26,
      });
    }
    disposables.push(
      { dispose: () => geometry.dispose() },
      { dispose: () => material.dispose() },
    );
  }

  return {
    group,
    update(elapsed) {
      if (blades) blades.rotation.z = elapsed * 1.1;
      for (const devil of devils) {
        // Wandering, not orbiting: two frequencies that do not divide evenly,
        // so the path never visibly repeats within a race.
        devil.mesh.position.x =
          devil.baseX + Math.sin(elapsed * 0.11 + devil.phase) * devil.drift;
        devil.mesh.position.z =
          devil.baseZ + Math.cos(elapsed * 0.07 + devil.phase) * devil.drift;
        devil.mesh.rotation.y = elapsed * 2.6 + devil.phase;
      }
    },
    dispose() {
      for (const item of disposables) item.dispose();
    },
  };
}
