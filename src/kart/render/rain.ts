/**
 * Rain streaks: one Points system wrapped in a box that re-centres on the
 * camera, so a few hundred particles read as a whole sky of rain.
 */

import * as THREE from "three";

export interface RainLayer {
  readonly object: THREE.Object3D;
  update(dt: number, cameraX: number, cameraY: number, cameraZ: number): void;
  dispose(): void;
}

const BOX = 46;
const FALL_SPEED = 34;

export function createRain(count: number): RainLayer {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * BOX;
    positions[i * 3 + 1] = Math.random() * BOX;
    positions[i * 3 + 2] = (Math.random() - 0.5) * BOX;
  }
  const geometry = new THREE.BufferGeometry();
  const attribute = new THREE.BufferAttribute(positions, 3);
  attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", attribute);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), BOX * 2);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {},
    vertexShader: /* glsl */ `
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        /*
         * Clamped: the naive 42/z gives a 4 px sprite at 10 m, and the
         * sliver below keeps ~12% of that — a sub-pixel streak that renders
         * as nothing at all. The floor keeps every drop at least visible.
         */
        gl_PointSize = clamp(130.0 / max(0.001, -mv.z), 7.0, 30.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      void main() {
        // A vertical sliver of the point sprite = a streak.
        vec2 p = gl_PointCoord - 0.5;
        if (abs(p.x) > 0.09) discard;
        float a = (0.5 - abs(p.y)) * 0.85;
        gl_FragColor = vec4(0.72, 0.78, 0.88, a);
      }
    `,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 5;

  return {
    object: points,
    update(dt, cameraX, cameraY, cameraZ) {
      points.position.set(cameraX, cameraY, cameraZ);
      for (let i = 0; i < count; i += 1) {
        let y = positions[i * 3 + 1]! - FALL_SPEED * dt;
        if (y < -BOX / 2) y += BOX;
        positions[i * 3 + 1] = y;
      }
      attribute.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
