/**
 * ALPINE PASS's identity: the valley the road is cut into.
 *
 * The circuit descends 44 m over the first half of the lap, so most of what a
 * driver sees is below them. That makes the far side of the valley the most
 * valuable thing to build, not the roadside — a ring of peaks and a bank of
 * mist do more work here than any amount of detail within ten metres of the
 * tarmac.
 *
 *   - a rock wall lofted along the uphill shoulder of the descent
 *   - a peak ring on the horizon, instanced cones
 *   - a suspension bridge across the low point, with its towers off the
 *     shoulder and its main cable above head height by design
 *   - a waterfall on the wall, and a mist plane in the valley floor
 *
 * All of it placed off `track.samples` and `track.bounds`, so a relayout takes
 * the landscape with it.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mulberry32 } from "../../../lib/seed";
import { sampleAt, type Track } from "../../sim/track";
import type { SetPieceBundle, SetPieceContext } from "./index";

export function buildAlpinePass(
  track: Track,
  context: SetPieceContext,
): SetPieceBundle {
  const group = new THREE.Group();
  group.name = "setpiece:alpine-pass";
  const disposables: { dispose(): void }[] = [];
  const theme = track.spec.theme;
  const random = mulberry32(0xa19e ^ track.samples.length);

  const centerX = (track.bounds.minX + track.bounds.maxX) / 2;
  const centerZ = (track.bounds.minZ + track.bounds.maxZ) / 2;
  const floorY = track.bounds.minY - 26;
  const outerRadius =
    Math.max(
      track.bounds.maxX - track.bounds.minX,
      track.bounds.maxZ - track.bounds.minZ,
    ) *
      0.5 +
    220;

  // ── The peak ring ────────────────────────────────────────────────────────
  {
    const count = Math.max(12, Math.round(40 * context.detail));
    const geometry = new THREE.ConeGeometry(1, 1, 5, 1, false);
    const material = new THREE.MeshStandardMaterial({
      color: 0x5d6b78,
      roughness: 0.94,
      flatShading: true,
    });
    const peaks = new THREE.InstancedMesh(geometry, material, count);
    const capGeometry = new THREE.ConeGeometry(1, 1, 5, 1, false);
    const capMaterial = new THREE.MeshStandardMaterial({
      color: 0xeef4fa,
      roughness: 0.7,
      flatShading: true,
    });
    const caps = new THREE.InstancedMesh(capGeometry, capMaterial, count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i += 1) {
      const angle =
        (i / count) * Math.PI * 2 + (random() - 0.5) * ((Math.PI * 2) / count);
      const radius = outerRadius + random() * 420;
      const height = 150 + random() * 260;
      const spread = height * (0.7 + random() * 0.5);
      const x = centerX + Math.cos(angle) * radius;
      const z = centerZ + Math.sin(angle) * radius;
      dummy.position.set(x, floorY + height / 2, z);
      dummy.rotation.set(0, random() * Math.PI, 0);
      dummy.scale.set(spread, height, spread);
      dummy.updateMatrix();
      peaks.setMatrixAt(i, dummy.matrix);
      // Snowline: a smaller cone sharing the apex, so it reads as one mountain.
      dummy.position.set(x, floorY + height * 0.82, z);
      dummy.scale.set(spread * 0.34, height * 0.34, spread * 0.34);
      dummy.updateMatrix();
      caps.setMatrixAt(i, dummy.matrix);
    }
    peaks.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
    peaks.frustumCulled = false;
    caps.frustumCulled = false;
    group.add(peaks, caps);
    disposables.push(
      { dispose: () => geometry.dispose() },
      { dispose: () => material.dispose() },
      { dispose: () => peaks.dispose() },
      { dispose: () => capGeometry.dispose() },
      { dispose: () => capMaterial.dispose() },
      { dispose: () => caps.dispose() },
    );
  }

  // ── The rock wall along the descent ──────────────────────────────────────
  {
    /*
     * Lofted along one shoulder of the descending half. It starts beyond the
     * apron so [BG3] — which rejects geometry in the driving corridor below
     * 4.2 m — has nothing to complain about, and the wall's base follows the
     * road down rather than sitting on a flat plane.
     */
    const from = 0.04;
    const to = 0.46;
    const steps = Math.max(14, Math.round(46 * context.detail));
    const positions: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= steps; i += 1) {
      const at = from + ((to - from) * i) / steps;
      const sample = sampleAt(track, track.length * at);
      const out = sample.half + 16;
      const jitter = 8 + random() * 26;
      const height = 26 + random() * 40;
      const baseX = sample.x + sample.rx * out;
      const baseZ = sample.z + sample.rz * out;
      const topX = sample.x + sample.rx * (out + jitter);
      const topZ = sample.z + sample.rz * (out + jitter);
      positions.push(baseX, sample.y - 4, baseZ);
      positions.push(topX, sample.y + height, topZ);
    }
    for (let i = 0; i < steps; i += 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      color: 0x6a6357,
      roughness: 0.97,
      flatShading: true,
      side: THREE.DoubleSide,
    });
    const wall = new THREE.Mesh(geometry, material);
    wall.castShadow = context.shadows;
    group.add(wall);
    disposables.push(
      { dispose: () => geometry.dispose() },
      { dispose: () => material.dispose() },
    );
  }

  // ── The suspension bridge over the low point ─────────────────────────────
  {
    /*
     * The towers stand outside the shoulder and the main cable is 9 m up, both
     * decided here rather than discovered by the corridor gate: a bridge is the
     * easiest set piece to accidentally build a wall across the road with.
     */
    const sample = sampleAt(track, track.length * 0.56);
    const parts: THREE.BufferGeometry[] = [];
    const towerOut = sample.half + 9;
    for (const side of [1, -1] as const) {
      for (const along of [-34, 34]) {
        const tower = new THREE.BoxGeometry(3, 30, 3);
        tower.translate(side * towerOut, 15, along);
        parts.push(tower.toNonIndexed());
      }
      // Main cable: a flat bar 9 m up, well clear of a kart and its camera.
      const cable = new THREE.BoxGeometry(1.2, 0.5, 72);
      cable.translate(side * towerOut, 24, 0);
      parts.push(cable.toNonIndexed());
    }
    const merged = mergeGeometries(parts)!;
    for (const part of parts) part.dispose();
    const material = new THREE.MeshStandardMaterial({
      color: 0x8d3f34,
      roughness: 0.82,
      metalness: 0.2,
    });
    const bridge = new THREE.Mesh(merged, material);
    bridge.castShadow = context.shadows;
    bridge.position.set(sample.x, sample.y, sample.z);
    bridge.rotation.y = Math.atan2(sample.tx, sample.tz);
    group.add(bridge);
    disposables.push(
      { dispose: () => merged.dispose() },
      { dispose: () => material.dispose() },
    );
  }

  // ── Valley mist ──────────────────────────────────────────────────────────
  let mist: THREE.Mesh | null = null;
  {
    const geometry = new THREE.PlaneGeometry(1800, 1800, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: theme.fog,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    mist = new THREE.Mesh(geometry, material);
    mist.position.set(centerX, floorY + 14, centerZ);
    mist.renderOrder = -2;
    group.add(mist);
    disposables.push(
      { dispose: () => geometry.dispose() },
      { dispose: () => material.dispose() },
    );
  }

  return {
    group,
    update(elapsed) {
      // The mist breathes. Two centimetres a second is under the threshold of
      // noticing it move and over the threshold of the valley feeling still.
      if (mist) {
        mist.position.y = floorY + 14 + Math.sin(elapsed * 0.13) * 2.2;
      }
    },
    dispose() {
      for (const item of disposables) item.dispose();
    },
  };
}
