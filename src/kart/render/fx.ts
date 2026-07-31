/**
 * Particles and one-shot effects.
 *
 * A single pre-allocated pool: no allocation happens during a race, and the
 * count is fixed so a pile-up cannot make the frame budget worse than the
 * quiet parts of the lap. Everything is additive points on one draw call.
 *
 * VORTEX CROWN shipped a `switch` over effect families with no `assertNever`,
 * and a newly added family rendered nothing at all, silently. `spawn` here
 * takes an explicit kind and `KIND_SPECS` is a total record — a new kind that
 * forgets its spec is a compile error, not an invisible effect.
 */

import * as THREE from "three";
import { sparkTexture } from "./textures";

export type FxKind =
  | "drift"
  | "boost"
  | "dust"
  | "impact"
  | "blast"
  | "pickup"
  | "star";

interface FxSpec {
  /** Seconds a particle lives. */
  readonly life: number;
  /** Initial speed, metres/second. */
  readonly speed: number;
  /** Downward acceleration. */
  readonly gravity: number;
  /** Point size in world units at unit distance. */
  readonly size: number;
  /** How much the particle shrinks over its life. */
  readonly shrink: number;
}

const KIND_SPECS: Readonly<Record<FxKind, FxSpec>> = {
  drift: { life: 0.42, speed: 5.5, gravity: 6, size: 26, shrink: 0.85 },
  boost: { life: 0.5, speed: 7, gravity: -2, size: 34, shrink: 0.7 },
  dust: { life: 0.8, speed: 3.2, gravity: 2.6, size: 30, shrink: -0.35 },
  impact: { life: 0.7, speed: 9, gravity: 10, size: 30, shrink: 0.6 },
  blast: { life: 0.95, speed: 22, gravity: 12, size: 54, shrink: 0.5 },
  pickup: { life: 0.55, speed: 6.5, gravity: -1, size: 28, shrink: 0.6 },
  star: { life: 0.6, speed: 4.5, gravity: -3, size: 30, shrink: 0.5 },
};

const MAX_PARTICLES = 1600;

export interface FxSystem {
  readonly object: THREE.Object3D;
  spawn(
    kind: FxKind,
    x: number,
    y: number,
    z: number,
    color: number,
    count: number,
    spreadX?: number,
    spreadY?: number,
    spreadZ?: number,
  ): void;
  update(dt: number): void;
  /** Live particle count — renderSelftest reads it. */
  readonly active: number;
  dispose(): void;
}

/**
 * `soft` swaps additive blending for ordinary alpha.
 *
 * Sparks and flame add light, so additive is right for them. Dirt does not —
 * additively blended dust clumped into a white blob with a rainbow rim every
 * time a kart put two wheels on the grass, which is most laps.
 */
export function createFxSystem(
  budget = MAX_PARTICLES,
  soft = false,
): FxSystem {
  const capacity = Math.max(64, Math.floor(budget));
  const positions = new Float32Array(capacity * 3);
  const colors = new Float32Array(capacity * 3);
  const sizes = new Float32Array(capacity);
  const alphas = new Float32Array(capacity);
  const velocities = new Float32Array(capacity * 3);
  const life = new Float32Array(capacity);
  const maxLife = new Float32Array(capacity);
  const gravity = new Float32Array(capacity);
  const shrink = new Float32Array(capacity);
  const baseSize = new Float32Array(capacity);
  let cursor = 0;
  let active = 0;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("alpha", new THREE.BufferAttribute(alphas, 1));
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(),
    Number.POSITIVE_INFINITY,
  );

  const map = sparkTexture();
  const material = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: map } },
    vertexShader: /* glsl */ `
      attribute float size;
      attribute float alpha;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = color;
        vAlpha = alpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (1.0 / max(0.001, -mv.z)) * 12.0;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec4 tex = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(vColor, tex.a * vAlpha);
        if (gl_FragColor.a < 0.01) discard;
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: soft ? THREE.NormalBlending : THREE.AdditiveBlending,
    vertexColors: true,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = soft ? 3 : 4;

  const color = new THREE.Color();

  return {
    object: points,
    get active() {
      return active;
    },
    spawn(kind, x, y, z, hex, count, spreadX = 1, spreadY = 1, spreadZ = 1) {
      const spec = KIND_SPECS[kind];
      color.setHex(hex);
      for (let i = 0; i < count; i += 1) {
        const index = cursor;
        cursor = (cursor + 1) % capacity;
        if (life[index]! <= 0) active += 1;
        const p = index * 3;
        positions[p] = x + (Math.random() - 0.5) * spreadX;
        positions[p + 1] = y + Math.random() * spreadY;
        positions[p + 2] = z + (Math.random() - 0.5) * spreadZ;
        velocities[p] = (Math.random() - 0.5) * spec.speed;
        velocities[p + 1] = Math.random() * spec.speed * 0.7;
        velocities[p + 2] = (Math.random() - 0.5) * spec.speed;
        colors[p] = color.r;
        colors[p + 1] = color.g;
        colors[p + 2] = color.b;
        const jitter = 0.75 + Math.random() * 0.5;
        life[index] = spec.life * jitter;
        maxLife[index] = spec.life * jitter;
        gravity[index] = spec.gravity;
        shrink[index] = spec.shrink;
        baseSize[index] = spec.size * jitter;
        sizes[index] = baseSize[index]!;
        alphas[index] = 1;
      }
      geometry.attributes.position!.needsUpdate = true;
      geometry.attributes.color!.needsUpdate = true;
      geometry.attributes.size!.needsUpdate = true;
      geometry.attributes.alpha!.needsUpdate = true;
    },
    update(dt) {
      if (active === 0) return;
      active = 0;
      for (let index = 0; index < capacity; index += 1) {
        const remaining = life[index]!;
        if (remaining <= 0) {
          alphas[index] = 0;
          continue;
        }
        const next = remaining - dt;
        life[index] = next;
        if (next <= 0) {
          alphas[index] = 0;
          continue;
        }
        active += 1;
        const p = index * 3;
        velocities[p + 1] = velocities[p + 1]! - gravity[index]! * dt;
        positions[p] = positions[p]! + velocities[p]! * dt;
        positions[p + 1] = positions[p + 1]! + velocities[p + 1]! * dt;
        positions[p + 2] = positions[p + 2]! + velocities[p + 2]! * dt;
        const t = next / maxLife[index]!;
        alphas[index] = Math.min(1, t * 1.6);
        sizes[index] = baseSize[index]! * (1 - shrink[index]! * (1 - t));
      }
      geometry.attributes.position!.needsUpdate = true;
      geometry.attributes.size!.needsUpdate = true;
      geometry.attributes.alpha!.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      map.dispose();
    },
  };
}

/** The colour a spark takes for a given drift charge tier. */
export const FX_KINDS: readonly FxKind[] = [
  "drift",
  "boost",
  "dust",
  "impact",
  "blast",
  "pickup",
  "star",
];
