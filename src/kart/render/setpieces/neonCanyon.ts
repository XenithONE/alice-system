/**
 * NEON CANYON's identity: a night gorge full of signs.
 *
 * Canyon walls are vertical ribbons extruded from the track's own samples
 * (offset outward, jagged top from seeded noise) — the same "derive from the
 * centreline" rule as every other band, so a relayout moves the gorge.
 * Japanese neon boards hang on the walls, arch gates cross the road above
 * head height with light strips, and rock pillars fill the middle distance.
 * All emissive values go through `emissiveStrip` (bloom threshold 1.15).
 */

import * as THREE from "three";
import { mulberry32 } from "../../../lib/seed";
import { SHOULDER_WIDTH } from "../../sim/balance";
import { sampleAt, surfaceHeight, type Track } from "../../sim/track";
import { emissiveStrip, type SetPieceBundle, type SetPieceContext } from "./index";

const WALL_OFFSET = 24;
const WALL_BASE_DROP = 12;

/** Vertical ribbon along the track at a lateral offset, jagged top. */
function wallGeometry(
  track: Track,
  side: 1 | -1,
  random: () => number,
): THREE.BufferGeometry {
  const samples = track.samples;
  const count = samples.length;
  const positions: number[] = [];
  const indices: number[] = [];
  // Coarser than the road: every 3rd sample keeps the wall under 400 verts.
  const step = 3;
  const ring: number[] = [];
  for (let i = 0; i < count; i += step) ring.push(i);
  const heights = ring.map(() => 15 + random() * 12);
  // Smooth the ridge once so it reads as rock, not noise.
  const smoothed = heights.map((height, index) => {
    const previous = heights[(index - 1 + heights.length) % heights.length]!;
    const next = heights[(index + 1) % heights.length]!;
    return (previous + height * 2 + next) / 4;
  });
  for (let index = 0; index <= ring.length; index += 1) {
    const i = ring[index % ring.length]!;
    const sample = samples[i]!;
    const lateral = side * (sample.half + WALL_OFFSET);
    const x = sample.x + sample.rx * lateral;
    const z = sample.z + sample.rz * lateral;
    const base = surfaceHeight(sample, lateral) - WALL_BASE_DROP;
    const top = base + WALL_BASE_DROP + smoothed[index % ring.length]!;
    positions.push(x, base, z, x, top, z);
  }
  for (let index = 0; index < ring.length; index += 1) {
    const a = index * 2;
    if (side === 1) indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    else indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

const SIGN_TEXTS: readonly { text: string; color: number }[] = [
  { text: "ニトロ", color: 0x35f5ff },
  { text: "最速", color: 0xff2d8f },
  { text: "王冠", color: 0xffd23f },
  { text: "加速", color: 0x7a2bd8 },
  { text: "夜間走行", color: 0x4ce08a },
  { text: "危険", color: 0xff5a3c },
  { text: "峡谷", color: 0x35a7ff },
  { text: "全開", color: 0xff8ae0 },
];

export function buildNeonCanyon(
  track: Track,
  context: SetPieceContext,
): SetPieceBundle {
  const group = new THREE.Group();
  group.name = "setpiece:neon-canyon";
  const disposables: { dispose(): void }[] = [];
  const random = mulberry32(0x2e02 ^ track.samples.length);
  const flickers: { material: THREE.MeshBasicMaterial; base: THREE.Color; phase: number }[] = [];

  // ── Canyon walls ─────────────────────────────────────────────────────────
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: 0x241a38,
    roughness: 0.92,
    flatShading: true,
  });
  for (const side of [1, -1] as const) {
    const geometry = wallGeometry(track, side, random);
    const wall = new THREE.Mesh(geometry, wallMaterial);
    wall.receiveShadow = context.shadows;
    group.add(wall);
    disposables.push({ dispose: () => geometry.dispose() });
  }
  disposables.push({ dispose: () => wallMaterial.dispose() });

  // ── Neon boards on the walls ─────────────────────────────────────────────
  const signCount = context.detail >= 1 ? 8 : context.detail >= 0.5 ? 5 : 3;
  for (let i = 0; i < signCount; i += 1) {
    const spec = SIGN_TEXTS[i % SIGN_TEXTS.length]!;
    const texture = context.texture(256, (paint, size) => {
      paint.fillStyle = "#0a0714";
      paint.fillRect(0, 0, size, size);
      const hex = `#${spec.color.toString(16).padStart(6, "0")}`;
      paint.strokeStyle = hex;
      paint.lineWidth = 10;
      paint.strokeRect(14, 14, size - 28, size - 28);
      paint.fillStyle = hex;
      const vertical = spec.text.length > 2;
      paint.font = `bold ${vertical ? 64 : 96}px 'Noto Sans JP', system-ui, sans-serif`;
      paint.textAlign = "center";
      paint.textBaseline = "middle";
      if (vertical) {
        const characters = [...spec.text];
        characters.forEach((character, index) => {
          paint.fillText(
            character,
            size / 2,
            size / 2 + (index - (characters.length - 1) / 2) * 58,
          );
        });
      } else {
        paint.fillText(spec.text, size / 2, size / 2 + 6);
      }
    });
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      toneMapped: false,
    });
    // Lift the sign into bloom territory without blowing out the glyphs.
    material.color.setScalar(1.5);
    const tall = spec.text.length > 2;
    const geometry = new THREE.PlaneGeometry(tall ? 5.5 : 8, tall ? 11 : 8);
    const sign = new THREE.Mesh(geometry, material);
    const s = ((i + 0.5) / signCount) * track.length;
    const sample = sampleAt(track, s);
    const side = i % 2 === 0 ? 1 : -1;
    const lateral = side * (sample.half + WALL_OFFSET - 1.2);
    sign.position.set(
      sample.x + sample.rx * lateral,
      surfaceHeight(sample, lateral) + 9 + random() * 5,
      sample.z + sample.rz * lateral,
    );
    // Face the road: toward -lateral.
    sign.lookAt(sample.x, sign.position.y - 1.5, sample.z);
    group.add(sign);
    flickers.push({
      material,
      base: new THREE.Color(1.5, 1.5, 1.5),
      phase: random() * Math.PI * 2,
    });
    disposables.push(
      { dispose: () => geometry.dispose() },
      { dispose: () => material.dispose() },
      { dispose: () => texture.dispose() },
    );
  }

  // ── Arch gates with light strips ─────────────────────────────────────────
  {
    const archCount = context.detail >= 1 ? 4 : 2;
    const pillarGeometry = new THREE.BoxGeometry(1.4, 12, 1.4);
    const pillarMaterial = new THREE.MeshStandardMaterial({
      color: 0x191325,
      roughness: 0.55,
      metalness: 0.5,
    });
    const stripMaterial = emissiveStrip(0x35f5ff, 1.8);
    disposables.push(
      { dispose: () => pillarGeometry.dispose() },
      { dispose: () => pillarMaterial.dispose() },
      { dispose: () => stripMaterial.dispose() },
    );
    for (let i = 0; i < archCount; i += 1) {
      const s = ((i + 0.35) / archCount) * track.length;
      const sample = sampleAt(track, s);
      const arch = new THREE.Group();
      arch.position.set(sample.x, 0, sample.z);
      arch.rotation.y = Math.atan2(sample.tx, sample.tz);
      const clearance = sample.half + SHOULDER_WIDTH + 1.6;
      for (const side of [1, -1] as const) {
        const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
        pillar.position.set(side * clearance, surfaceHeight(sample, side * clearance) + 6, 0);
        pillar.castShadow = context.shadows;
        arch.add(pillar);
      }
      // Beam bottom at +6.4: above the corridor cap AND the chase camera.
      const beamGeometry = new THREE.BoxGeometry(clearance * 2 + 1.4, 1.2, 1.6);
      const beam = new THREE.Mesh(beamGeometry, pillarMaterial);
      beam.position.set(0, sample.y + 7.0, 0);
      arch.add(beam);
      const stripGeometry = new THREE.BoxGeometry(clearance * 2 + 0.6, 0.22, 0.4);
      const strip = new THREE.Mesh(stripGeometry, stripMaterial);
      strip.position.set(0, sample.y + 6.35, 0.6);
      arch.add(strip);
      const stripBack = new THREE.Mesh(stripGeometry, stripMaterial);
      stripBack.position.set(0, sample.y + 6.35, -0.6);
      arch.add(stripBack);
      group.add(arch);
      disposables.push(
        { dispose: () => beamGeometry.dispose() },
        { dispose: () => stripGeometry.dispose() },
      );
    }
  }

  // ── Rock pillars in the middle distance ──────────────────────────────────
  if (context.detail >= 0.5) {
    const pillarGeometry = new THREE.ConeGeometry(4.5, 30, 6);
    const pillarMaterial = new THREE.MeshStandardMaterial({
      color: 0x1d1430,
      roughness: 0.95,
      flatShading: true,
    });
    const count = context.detail >= 1 ? 16 : 8;
    const pillars = new THREE.InstancedMesh(pillarGeometry, pillarMaterial, count);
    const dummy = new THREE.Object3D();
    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < count * 8) {
      attempts += 1;
      const s = random() * track.length;
      const sample = sampleAt(track, s);
      const side = random() > 0.5 ? 1 : -1;
      const lateral = side * (sample.half + WALL_OFFSET + 14 + random() * 40);
      dummy.position.set(
        sample.x + sample.rx * lateral,
        surfaceHeight(sample, lateral) - 10,
        sample.z + sample.rz * lateral,
      );
      dummy.scale.set(0.7 + random(), 0.8 + random() * 1.4, 0.7 + random());
      dummy.rotation.y = random() * Math.PI;
      dummy.updateMatrix();
      pillars.setMatrixAt(placed, dummy.matrix);
      placed += 1;
    }
    pillars.count = placed;
    pillars.instanceMatrix.needsUpdate = true;
    pillars.frustumCulled = false;
    group.add(pillars);
    disposables.push(
      { dispose: () => pillarGeometry.dispose() },
      { dispose: () => pillarMaterial.dispose() },
      { dispose: () => pillars.dispose() },
    );
  }

  return {
    group,
    update(elapsed) {
      for (const flicker of flickers) {
        // Mostly steady; a couple of dips a second, one deep stutter cycle.
        const steady = 0.92 + Math.sin(elapsed * 7 + flicker.phase) * 0.05;
        const stutter =
          Math.sin(elapsed * 1.7 + flicker.phase * 3) > 0.965 ? 0.35 : 1;
        flicker.material.color
          .copy(flicker.base)
          .multiplyScalar(steady * stutter);
      }
    },
    dispose() {
      for (const item of disposables) item.dispose();
    },
  };
}
