/**
 * SUNSET COAST's identity: the sea.
 *
 * A faceted ocean surrounds the whole circuit below the apron line, a
 * lighthouse stands off the big western sweeper with its beam turning, three
 * sailboats ride the actual `waveHeight()` (the same CPU mirror the atelier's
 * ship uses), and a few rock stacks give the horizon a silhouette. Everything
 * is placed relative to the track's bounds/samples so a relayout moves the
 * coast with it.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mulberry32 } from "../../../lib/seed";
import { sampleAt, type Track } from "../../sim/track";
import { buildNkOcean, type NkOcean } from "./nkOcean";
import { createLighthouse, type Lighthouse } from "./lighthouse";
import type { SetPieceBundle, SetPieceContext } from "./index";

const SEA_LEVEL_BELOW_MIN = 6;

interface Boat {
  readonly group: THREE.Group;
  readonly x: number;
  readonly z: number;
  readonly phase: number;
}

export function buildSunsetCoast(
  track: Track,
  context: SetPieceContext,
): SetPieceBundle {
  const group = new THREE.Group();
  group.name = "setpiece:sunset-coast";
  const disposables: { dispose(): void }[] = [];
  const theme = track.spec.theme;
  const random = mulberry32(0x5ea5 ^ track.samples.length);

  const seaLevel = track.bounds.minY - SEA_LEVEL_BELOW_MIN;
  const centerX = (track.bounds.minX + track.bounds.maxX) / 2;
  const centerZ = (track.bounds.minZ + track.bounds.maxZ) / 2;

  // ── The sea ───────────────────────────────────────────────────────────────
  const segments = context.detail >= 1 ? 150 : context.detail >= 0.5 ? 100 : 56;
  const ocean: NkOcean = buildNkOcean(1500, segments, {
    shallow: 0x3fa7b8,
    deep: 0x1d4f86,
    sky: theme.skyLow,
    foam: 0xfff3e4,
    fog: theme.fog,
    fogDensity: theme.fogDensity,
    sunDir: theme.sunDir,
  });
  ocean.mesh.position.set(centerX, seaLevel, centerZ);
  group.add(ocean.mesh);
  disposables.push(ocean);

  // ── The lighthouse, off the western sweeper ──────────────────────────────
  let lighthouse: Lighthouse | null = null;
  {
    // 62% around the lap is the seaward straight; 60 m outboard puts the
    // rock in open water regardless of layout tweaks.
    const sample = sampleAt(track, track.length * 0.62);
    const lateral = (sample.half + 60) * 1;
    lighthouse = createLighthouse(context.shadows);
    lighthouse.root.position.set(
      sample.x + sample.rx * lateral,
      seaLevel + 0.6,
      sample.z + sample.rz * lateral,
    );
    group.add(lighthouse.root);
    disposables.push(lighthouse);
  }

  // ── Sailboats riding the real wave field ─────────────────────────────────
  const boats: Boat[] = [];
  if (context.detail >= 0.5) {
    const hullGeometry = (() => {
      const hull = new THREE.CylinderGeometry(0.0001, 1.4, 1.6, 4);
      hull.scale(1, 1, 2.4);
      hull.rotateY(Math.PI / 4);
      const parts: THREE.BufferGeometry[] = [hull.toNonIndexed()];
      const mast = new THREE.CylinderGeometry(0.08, 0.1, 5.4, 5);
      mast.translate(0, 3.2, 0);
      parts.push(mast.toNonIndexed());
      const sail = new THREE.ConeGeometry(1.7, 4.4, 3, 1, true);
      sail.rotateY(Math.PI);
      sail.translate(0.4, 3.4, 0);
      parts.push(sail.toNonIndexed());
      const merged = mergeGeometries(parts)!;
      for (const part of parts) part.dispose();
      return merged;
    })();
    const hullMaterial = new THREE.MeshStandardMaterial({
      color: 0xf3ede2,
      roughness: 0.7,
      flatShading: true,
    });
    disposables.push(
      { dispose: () => hullGeometry.dispose() },
      { dispose: () => hullMaterial.dispose() },
    );
    const count = context.detail >= 1 ? 3 : 2;
    for (let i = 0; i < count; i += 1) {
      const angle = random() * Math.PI * 2;
      const radius = 240 + random() * 160;
      const x = centerX + Math.cos(angle) * radius;
      const z = centerZ + Math.sin(angle) * radius;
      const boat = new THREE.Group();
      const mesh = new THREE.Mesh(hullGeometry, hullMaterial);
      mesh.castShadow = false;
      boat.add(mesh);
      boat.position.set(x, seaLevel, z);
      boat.rotation.y = random() * Math.PI * 2;
      group.add(boat);
      boats.push({ group: boat, x, z, phase: random() * Math.PI * 2 });
    }
  }

  // ── Rock stacks for the horizon ──────────────────────────────────────────
  if (context.detail >= 0.5) {
    const stackGeometry = new THREE.ConeGeometry(6, 22, 5);
    const stackMaterial = new THREE.MeshStandardMaterial({
      color: 0x6b5b54,
      roughness: 0.95,
      flatShading: true,
    });
    const count = context.detail >= 1 ? 7 : 4;
    const stacks = new THREE.InstancedMesh(stackGeometry, stackMaterial, count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i += 1) {
      const angle = random() * Math.PI * 2;
      const radius = 320 + random() * 260;
      dummy.position.set(
        centerX + Math.cos(angle) * radius,
        seaLevel + 2,
        centerZ + Math.sin(angle) * radius,
      );
      dummy.scale.set(
        0.8 + random() * 1.6,
        0.7 + random() * 1.8,
        0.8 + random() * 1.6,
      );
      dummy.rotation.y = random() * Math.PI;
      dummy.updateMatrix();
      stacks.setMatrixAt(i, dummy.matrix);
    }
    stacks.instanceMatrix.needsUpdate = true;
    stacks.frustumCulled = false;
    group.add(stacks);
    disposables.push(
      { dispose: () => stackGeometry.dispose() },
      { dispose: () => stackMaterial.dispose() },
      { dispose: () => stacks.dispose() },
    );
  }

  return {
    group,
    update(elapsed) {
      ocean.update(elapsed);
      lighthouse?.update(elapsed);
      for (const boat of boats) {
        const height = ocean.waveHeight(boat.x, boat.z, elapsed);
        boat.group.position.y = seaLevel + height;
        boat.group.rotation.z = Math.sin(elapsed * 0.7 + boat.phase) * 0.06;
        boat.group.rotation.x = Math.cos(elapsed * 0.55 + boat.phase) * 0.05;
      }
    },
    dispose() {
      for (const item of disposables) item.dispose();
    },
  };
}
