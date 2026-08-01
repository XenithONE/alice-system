/**
 * Grandstands on the start straight, with a canvas crowd and swaying flags.
 *
 * Placement is derived from the track (samples around s = 0, outside the
 * shoulder), never hand-positioned. Axis convention, stated once because the
 * first build got it backwards and parked a 34 m wall across the grid:
 * with `rotation.y = yaw`, local +Z is the DIRECTION OF TRAVEL and local +X
 * is the ROAD'S RIGHT. A stand therefore runs its LENGTH along local Z and
 * climbs its tiers outward along local +X; the side = -1 stand flips by
 * adding π to yaw, which flips both axes at once.
 *
 * Cost: ~4 draw calls per stand.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { SHOULDER_WIDTH } from "../sim/balance";
import { headingOf, sampleAt, surfaceHeight, type Track } from "../sim/track";
import { crowdTexture } from "./textures";

export interface Grandstands {
  readonly group: THREE.Group;
  update(elapsed: number): void;
  dispose(): void;
}

const STAND_LENGTH = 34;
const TIERS = 4;
const TIER_DEPTH = 2.4;
const TIER_RISE = 1.1;
const FLAG_COLORS = [0xe94f3d, 0x35d7ff, 0xffd23f, 0x4ce08a, 0xec5aa6, 0xf2f4f6];

export function createGrandstands(
  track: Track,
  count: number,
  shadows: boolean,
  crowd: THREE.Texture = crowdTexture(),
): Grandstands {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [{ dispose: () => crowd.dispose() }];
  if (count <= 0) {
    return { group, update: () => undefined, dispose: () => undefined };
  }

  const structureMaterial = new THREE.MeshStandardMaterial({
    color: 0x51565f,
    roughness: 0.7,
    metalness: 0.25,
  });
  const crowdMaterial = new THREE.MeshBasicMaterial({ map: crowd });
  const roofMaterial = new THREE.MeshStandardMaterial({
    color: 0xe6e9ee,
    roughness: 0.45,
    metalness: 0.2,
  });
  disposables.push(
    { dispose: () => structureMaterial.dispose() },
    { dispose: () => crowdMaterial.dispose() },
    { dispose: () => roofMaterial.dispose() },
  );

  // Sway is a vertex-shader bend anchored at the pole edge (uv.x = 0).
  const flagMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute float phase;
      attribute vec3 tint;
      varying vec2 vUv;
      varying vec3 vTint;
      void main() {
        vUv = uv;
        vTint = tint;
        vec3 bent = position;
        bent.z += sin(uTime * 3.2 + phase + uv.x * 4.0) * 0.24 * uv.x;
        bent.y += sin(uTime * 2.1 + phase) * 0.05 * uv.x;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(bent, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vTint;
      void main() {
        float stripe = step(0.5, fract(vUv.y * 2.0)) * 0.16;
        gl_FragColor = vec4(vTint * (0.92 - stripe), 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });
  const flagGeometry = new THREE.PlaneGeometry(2.6, 1.5, 6, 1);
  flagGeometry.translate(1.3, 0, 0);
  disposables.push(
    { dispose: () => flagMaterial.dispose() },
    { dispose: () => flagGeometry.dispose() },
  );

  const sides: (1 | -1)[] = count >= 2 ? [1, -1] : [1];

  for (const side of sides) {
    // Straddle the start line; a little offset so the two stands interleave.
    const sample = sampleAt(track, side === 1 ? 4 : -12);
    const lateral = side * (sample.half + SHOULDER_WIDTH + 3.2);
    const yaw = headingOf(sample.tx, sample.tz) + (side === 1 ? 0 : Math.PI);

    const stand = new THREE.Group();
    stand.position.set(
      sample.x + sample.rx * lateral,
      surfaceHeight(sample, lateral) - 0.3,
      sample.z + sample.rz * lateral,
    );
    stand.rotation.y = yaw;

    // Tiered steps: length along local Z, climbing outward along local +X.
    const steps: THREE.BufferGeometry[] = [];
    for (let tier = 0; tier < TIERS; tier += 1) {
      const step = new THREE.BoxGeometry(TIER_DEPTH, TIER_RISE, STAND_LENGTH);
      step.translate(
        TIER_DEPTH / 2 + tier * TIER_DEPTH,
        TIER_RISE / 2 + tier * TIER_RISE,
        0,
      );
      steps.push(step);
    }
    const stepGeometry = mergeGeometries(steps)!;
    for (const step of steps) step.dispose();
    const stepMesh = new THREE.Mesh(stepGeometry, structureMaterial);
    stepMesh.castShadow = shadows;
    stepMesh.receiveShadow = shadows;
    stand.add(stepMesh);
    disposables.push({ dispose: () => stepGeometry.dispose() });

    // The crowd: one inclined plane draped over the tiers, facing the road.
    const crowdGeometry = new THREE.PlaneGeometry(STAND_LENGTH - 1.2, 10.2);
    const crowdMap = crowdMaterial;
    const crowdMesh = new THREE.Mesh(crowdGeometry, crowdMap);
    const slope = Math.atan2(TIERS * TIER_RISE, TIERS * TIER_DEPTH);
    crowdMesh.position.set(
      (TIERS * TIER_DEPTH) / 2 + 0.2,
      (TIERS * TIER_RISE) / 2 + 1.1,
      0,
    );
    // Face the road (local -X) and lie back along the tier slope.
    crowdMesh.rotation.set(0, -Math.PI / 2, 0);
    crowdMesh.rotateX(-slope);
    stand.add(crowdMesh);
    disposables.push({ dispose: () => crowdGeometry.dispose() });

    const roofGeometry = new THREE.BoxGeometry(TIERS * TIER_DEPTH + 3, 0.5, STAND_LENGTH + 2);
    const roofMesh = new THREE.Mesh(roofGeometry, roofMaterial);
    roofMesh.position.set((TIERS * TIER_DEPTH) / 2, TIERS * TIER_RISE + 3.4, 0);
    roofMesh.rotation.z = 0.09;
    roofMesh.castShadow = shadows;
    stand.add(roofMesh);
    disposables.push({ dispose: () => roofGeometry.dispose() });

    // Flags along the roof's road-side edge, instanced in STAND-LOCAL space
    // (the instance matrix composes with the stand's world matrix).
    const flagCount = 6;
    const flagMesh = new THREE.InstancedMesh(flagGeometry, flagMaterial, flagCount);
    const tintArray = new Float32Array(flagCount * 3);
    const phaseArray = new Float32Array(flagCount);
    const color = new THREE.Color();
    const dummy = new THREE.Object3D();
    for (let i = 0; i < flagCount; i += 1) {
      dummy.position.set(0.4, TIERS * TIER_RISE + 4.2, (i - (flagCount - 1) / 2) * 5.6);
      dummy.rotation.set(0, Math.PI / 2, 0);
      dummy.updateMatrix();
      flagMesh.setMatrixAt(i, dummy.matrix);
      color.setHex(FLAG_COLORS[i % FLAG_COLORS.length]!);
      tintArray[i * 3] = color.r;
      tintArray[i * 3 + 1] = color.g;
      tintArray[i * 3 + 2] = color.b;
      phaseArray[i] = i * 1.37 + (side === 1 ? 0 : 0.9);
    }
    flagMesh.geometry = flagGeometry.clone();
    flagMesh.geometry.setAttribute(
      "tint",
      new THREE.InstancedBufferAttribute(tintArray, 3),
    );
    flagMesh.geometry.setAttribute(
      "phase",
      new THREE.InstancedBufferAttribute(phaseArray, 1),
    );
    flagMesh.instanceMatrix.needsUpdate = true;
    flagMesh.frustumCulled = false;
    const ownedFlagGeometry = flagMesh.geometry;
    stand.add(flagMesh);
    disposables.push(
      { dispose: () => ownedFlagGeometry.dispose() },
      { dispose: () => flagMesh.dispose() },
    );

    group.add(stand);
  }

  return {
    group,
    update(elapsed) {
      (flagMaterial.uniforms.uTime as { value: number }).value = elapsed;
    },
    dispose() {
      for (const item of disposables) item.dispose();
    },
  };
}
