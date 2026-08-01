/**
 * SKY GARDEN's identity: a circuit floating above a sea of cloud.
 *
 * Floating islands (cone + grass cap) hang around and below the track,
 * waterfall ribbons pour off them with a scrolling canvas texture, hot-air
 * balloons drift and bob, and a soft cloud-sea plane closes the world below
 * — without it you could see the haze disc's hard edge from the high
 * sections.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mulberry32 } from "../../../lib/seed";
import { sampleAt, surfaceHeight, type Track } from "../../sim/track";
import type { SetPieceBundle, SetPieceContext } from "./index";

const BALLOON_COLORS = [0xe94f3d, 0x35a7ff, 0xffd23f, 0x4ce08a, 0xec5aa6];

export function buildSkyGarden(
  track: Track,
  context: SetPieceContext,
): SetPieceBundle {
  const group = new THREE.Group();
  group.name = "setpiece:sky-garden";
  const disposables: { dispose(): void }[] = [];
  const random = mulberry32(0x5a9d ^ track.samples.length);
  const centerX = (track.bounds.minX + track.bounds.maxX) / 2;
  const centerZ = (track.bounds.minZ + track.bounds.maxZ) / 2;
  const cloudLevel = track.bounds.minY - 26;

  // ── Floating islands ─────────────────────────────────────────────────────
  {
    const rock = new THREE.ConeGeometry(7, 16, 6);
    rock.rotateX(Math.PI);
    rock.translate(0, -8, 0);
    const grass = new THREE.CylinderGeometry(7.2, 6.4, 2.4, 6);
    grass.translate(0, 1.2, 0);
    const rockMaterial = new THREE.MeshStandardMaterial({
      color: 0x8a7a68,
      roughness: 0.95,
      flatShading: true,
    });
    const grassMaterial = new THREE.MeshStandardMaterial({
      color: 0x63b95a,
      roughness: 0.85,
      flatShading: true,
    });
    const count = context.detail >= 1 ? 12 : context.detail >= 0.5 ? 7 : 4;
    const rocks = new THREE.InstancedMesh(rock, rockMaterial, count);
    const caps = new THREE.InstancedMesh(grass, grassMaterial, count);
    const dummy = new THREE.Object3D();
    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < count * 10) {
      attempts += 1;
      const s = random() * track.length;
      const sample = sampleAt(track, s);
      const side = random() > 0.5 ? 1 : -1;
      const lateral = side * (sample.half + 40 + random() * 90);
      const x = sample.x + sample.rx * lateral;
      const z = sample.z + sample.rz * lateral;
      const y = surfaceHeight(sample, 0) - 14 - random() * 22;
      dummy.position.set(x, y, z);
      const scale = 0.7 + random() * 1.5;
      dummy.scale.setScalar(scale);
      dummy.rotation.y = random() * Math.PI * 2;
      dummy.updateMatrix();
      rocks.setMatrixAt(placed, dummy.matrix);
      caps.setMatrixAt(placed, dummy.matrix);
      placed += 1;
    }
    rocks.count = placed;
    caps.count = placed;
    rocks.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
    rocks.frustumCulled = false;
    caps.frustumCulled = false;
    rocks.castShadow = false;
    group.add(rocks, caps);
    disposables.push(
      { dispose: () => rock.dispose() },
      { dispose: () => grass.dispose() },
      { dispose: () => rockMaterial.dispose() },
      { dispose: () => grassMaterial.dispose() },
      { dispose: () => rocks.dispose() },
      { dispose: () => caps.dispose() },
    );
  }

  // ── Waterfalls off the track's high edges ────────────────────────────────
  const waterfallMaterials: THREE.MeshBasicMaterial[] = [];
  if (context.detail >= 0.5) {
    const texture = context.texture(128, (paint, size) => {
      paint.clearRect(0, 0, size, size);
      for (let i = 0; i < 26; i += 1) {
        const x = (i / 26) * size + Math.sin(i * 3.1) * 3;
        const alpha = 0.25 + ((i * 37) % 10) / 22;
        paint.strokeStyle = `rgba(235, 248, 255, ${alpha.toFixed(2)})`;
        paint.lineWidth = 2 + ((i * 13) % 3);
        paint.beginPath();
        paint.moveTo(x, -4);
        paint.lineTo(x, size + 4);
        paint.stroke();
      }
    });
    texture.wrapT = THREE.RepeatWrapping;
    disposables.push({ dispose: () => texture.dispose() });
    const count = context.detail >= 1 ? 4 : 2;
    for (let i = 0; i < count; i += 1) {
      // Pour from the outer edge of a HIGH section: pick the highest of a few
      // random samples so the falls hang where the track soars.
      let best = sampleAt(track, random() * track.length);
      for (let probe = 0; probe < 5; probe += 1) {
        const candidate = sampleAt(track, random() * track.length);
        if (candidate.y > best.y) best = candidate;
      }
      const side = random() > 0.5 ? 1 : -1;
      const lateral = side * (best.half + 9);
      const top = surfaceHeight(best, lateral) - 2;
      const drop = 26 + random() * 14;
      const geometry = new THREE.PlaneGeometry(6 + random() * 4, drop);
      const material = new THREE.MeshBasicMaterial({
        map: texture.clone(),
        transparent: true,
        opacity: 0.62,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      material.map!.wrapT = THREE.RepeatWrapping;
      material.map!.repeat.set(1, drop / 18);
      const falls = new THREE.Mesh(geometry, material);
      falls.position.set(
        best.x + best.rx * lateral,
        top - drop / 2,
        best.z + best.rz * lateral,
      );
      falls.rotation.y = Math.atan2(best.tx, best.tz) + Math.PI / 2;
      group.add(falls);
      waterfallMaterials.push(material);
      disposables.push(
        { dispose: () => geometry.dispose() },
        { dispose: () => material.map!.dispose() },
        { dispose: () => material.dispose() },
      );
    }
  }

  // ── Hot-air balloons ─────────────────────────────────────────────────────
  const balloons: { group: THREE.Group; phase: number; radius: number; speed: number; baseY: number }[] = [];
  {
    const envelope = new THREE.SphereGeometry(4.2, 10, 8);
    envelope.scale(1, 1.15, 1);
    const basket = new THREE.BoxGeometry(1.4, 1.1, 1.4);
    basket.translate(0, -5.6, 0);
    const count = context.detail >= 1 ? 5 : context.detail >= 0.5 ? 3 : 1;
    for (let i = 0; i < count; i += 1) {
      const color = BALLOON_COLORS[i % BALLOON_COLORS.length]!;
      const parts = [envelope.clone().toNonIndexed(), basket.clone().toNonIndexed()];
      const merged = mergeGeometries(parts)!;
      for (const part of parts) part.dispose();
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.6,
        flatShading: true,
      });
      const balloon = new THREE.Group();
      const mesh = new THREE.Mesh(merged, material);
      balloon.add(mesh);
      const baseY = track.bounds.maxY + 18 + random() * 26;
      balloon.position.set(
        centerX + (random() - 0.5) * 260,
        baseY,
        centerZ + (random() - 0.5) * 260,
      );
      group.add(balloon);
      balloons.push({
        group: balloon,
        phase: random() * Math.PI * 2,
        radius: 30 + random() * 50,
        speed: 0.02 + random() * 0.03,
        baseY,
      });
      disposables.push(
        { dispose: () => merged.dispose() },
        { dispose: () => material.dispose() },
      );
    }
    envelope.dispose();
    basket.dispose();
  }

  // ── The cloud sea below ──────────────────────────────────────────────────
  {
    const texture = context.texture(256, (paint, size) => {
      paint.clearRect(0, 0, size, size);
      for (let i = 0; i < 60; i += 1) {
        const x = ((i * 97) % size) + Math.sin(i) * 8;
        const y = ((i * 53) % size) + Math.cos(i * 2) * 8;
        const radius = 18 + ((i * 29) % 26);
        const gradient = paint.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, "rgba(255,255,255,0.5)");
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        paint.fillStyle = gradient;
        paint.beginPath();
        paint.arc(x, y, radius, 0, Math.PI * 2);
        paint.fill();
      }
    });
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(5, 5);
    const geometry = new THREE.PlaneGeometry(1500, 1500);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const sea = new THREE.Mesh(geometry, material);
    sea.position.set(centerX, cloudLevel + 4, centerZ);
    sea.renderOrder = -1.85;
    group.add(sea);
    disposables.push(
      { dispose: () => geometry.dispose() },
      { dispose: () => material.dispose() },
      { dispose: () => texture.dispose() },
    );
  }

  return {
    group,
    update(elapsed) {
      for (const material of waterfallMaterials) {
        material.map!.offset.y = (elapsed * 0.55) % 1;
      }
      for (const balloon of balloons) {
        const angle = elapsed * balloon.speed + balloon.phase;
        balloon.group.position.x += Math.cos(angle) * 0.02;
        balloon.group.position.z += Math.sin(angle) * 0.02;
        balloon.group.position.y =
          balloon.baseY + Math.sin(elapsed * 0.4 + balloon.phase) * 2.2;
      }
    },
    dispose() {
      for (const item of disposables) item.dispose();
    },
  };
}
