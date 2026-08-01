/**
 * Billboard clouds: one Points draw call, drifting in the shader.
 *
 * Points instead of instanced planes because the billboarding then costs
 * nothing — a point sprite always faces the camera — and the drift is an
 * attribute phase evaluated in the vertex shader, so after construction the
 * CPU never touches this layer again.
 */

import * as THREE from "three";
import { mulberry32 } from "../../lib/seed";
import type { Track } from "../sim/track";
import { cloudTexture } from "./textures";

export interface CloudLayer {
  readonly object: THREE.Object3D;
  update(elapsed: number): void;
  dispose(): void;
}

export function createClouds(
  track: Track,
  count: number,
  tint: number,
  texture: THREE.Texture = cloudTexture(),
): CloudLayer {
  const random = mulberry32(0xc10d ^ track.samples.length);
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const centerX = (track.bounds.minX + track.bounds.maxX) / 2;
  const centerZ = (track.bounds.minZ + track.bounds.maxZ) / 2;
  const spread =
    Math.max(
      track.bounds.maxX - track.bounds.minX,
      track.bounds.maxZ - track.bounds.minZ,
    ) * 1.4;
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = centerX + (random() - 0.5) * spread * 2;
    positions[i * 3 + 1] = track.bounds.maxY + 60 + random() * 90;
    positions[i * 3 + 2] = centerZ + (random() - 0.5) * spread * 2;
    sizes[i] = 90 + random() * 160;
    phases[i] = random() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("phase", new THREE.BufferAttribute(phases, 1));
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(centerX, 120, centerZ),
    spread * 3,
  );

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: texture },
      uTint: { value: new THREE.Color(tint) },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float size;
      attribute float phase;
      uniform float uTime;
      void main() {
        vec3 drifted = position;
        drifted.x += sin(uTime * 0.014 + phase) * 26.0;
        drifted.z += cos(uTime * 0.011 + phase * 1.7) * 18.0;
        vec4 mv = modelViewMatrix * vec4(drifted, 1.0);
        gl_PointSize = size * (1.0 / max(0.001, -mv.z)) * 320.0;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uTint;
      void main() {
        vec4 tex = texture2D(uMap, gl_PointCoord);
        if (tex.a < 0.01) discard;
        gl_FragColor = vec4(uTint, tex.a * 0.8);
      }
    `,
    transparent: true,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  points.renderOrder = -1.8;

  return {
    object: points,
    update(elapsed) {
      (material.uniforms.uTime as { value: number }).value = elapsed;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
