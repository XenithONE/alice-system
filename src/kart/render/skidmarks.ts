/**
 * Tyre marks — the cheapest "this game has physics" signal there is.
 *
 * One pre-allocated ring buffer of quads for the whole grid. The CPU only
 * ever touches quads it writes that frame (uploaded via addUpdateRange); the
 * 8-second fade happens entirely in the shader from a per-vertex birth time,
 * so a track covered in marks costs exactly one draw call and zero per-frame
 * iteration.
 *
 * The writer core below is pure array arithmetic — renderSelftest drives it
 * headless, including the banked-road conformance check with a destructive
 * control (drop the bank term and the check must fail).
 */

import * as THREE from "three";
import {
  querySurface,
  surfaceHeight,
  forwardOf,
  rightOf,
  type SurfaceKind,
  type Track,
} from "../sim/track";
import { SHOULDER_WIDTH } from "../sim/balance";
import type { RacerState } from "../sim/types";

/** Rear axle offset from the kart origin, matching kartModel's rear wheels. */
const REAR_AXLE = 1.15;
const WHEEL_TRACK = 0.95;
/** Segment length before a quad is emitted. */
const MIN_SEGMENT = 0.3;
/** Beyond this the kart teleported (respawn) — break the strip. */
const MAX_SEGMENT = 3.5;
/** Seconds a mark stays visible. */
export const SKID_FADE_SEC = 8;
const LIFT = 0.03;

export interface SkidBuffers {
  readonly capacity: number;
  readonly position: Float32Array;
  readonly birth: Float32Array;
  readonly strength: Float32Array;
  /**
   * 0 = rubber, 1 = dust. Per vertex rather than a material uniform, because
   * a strip laid down across a dirt-to-asphalt joint has to be both — with one
   * uniform the whole scene's marks would change colour at the moment the
   * leading kart crossed, including marks laid minutes ago.
   */
  readonly tint: Float32Array;
  readonly index: Uint32Array;
}

export function createSkidBuffers(capacity: number): SkidBuffers {
  const position = new Float32Array(capacity * 4 * 3);
  const birth = new Float32Array(capacity * 4);
  // Far in the past: an unwritten quad is fully faded, not a flash at t=0.
  birth.fill(-1e9);
  const strength = new Float32Array(capacity * 4);
  const tint = new Float32Array(capacity * 4);
  const index = new Uint32Array(capacity * 6);
  for (let quad = 0; quad < capacity; quad += 1) {
    const v = quad * 4;
    const i = quad * 6;
    index[i] = v;
    index[i + 1] = v + 2;
    index[i + 2] = v + 1;
    index[i + 3] = v + 1;
    index[i + 4] = v + 2;
    index[i + 5] = v + 3;
  }
  return { capacity, position, birth, strength, tint, index };
}

/**
 * Write one quad (prevLeft, prevRight → curLeft, curRight) at the cursor.
 * Returns the next cursor. Pure; wraps.
 */
export function writeSkidQuad(
  buffers: SkidBuffers,
  cursor: number,
  prevLeft: readonly [number, number, number],
  prevRight: readonly [number, number, number],
  curLeft: readonly [number, number, number],
  curRight: readonly [number, number, number],
  time: number,
  strength: number,
  tint = 0,
): number {
  const quad = cursor % buffers.capacity;
  const p = quad * 4 * 3;
  const corners = [prevLeft, prevRight, curLeft, curRight];
  for (let corner = 0; corner < 4; corner += 1) {
    const [x, y, z] = corners[corner]!;
    buffers.position[p + corner * 3] = x;
    buffers.position[p + corner * 3 + 1] = y;
    buffers.position[p + corner * 3 + 2] = z;
    buffers.birth[quad * 4 + corner] = time;
    buffers.strength[quad * 4 + corner] = strength;
    buffers.tint[quad * 4 + corner] = tint;
  }
  return (cursor + 1) % buffers.capacity;
}

/**
 * The rear wheels' road-contact points, conformed to the banked surface.
 *
 * One `querySurface` per call (the same cost the sim pays per kart per tick).
 * Each wheel's height is re-derived from the surface formula at ITS lateral
 * offset — using the kart-centre height for both wheels leaves the outer
 * wheel floating a wheel-width × tan(bank) above a banked corner, which at
 * 0.3 bank is 28 cm of hovering rubber.
 */
export function rearWheelContacts(
  track: Track,
  x: number,
  z: number,
  yaw: number,
  hint: number,
): {
  readonly left: readonly [number, number, number];
  readonly right: readonly [number, number, number];
  readonly hint: number;
  readonly onGround: boolean;
} {
  const [fx, fz] = forwardOf(yaw);
  const [rx, rz] = rightOf(yaw);
  const axleX = x - fx * REAR_AXLE;
  const axleZ = z - fz * REAR_AXLE;
  const query = querySurface(track, axleX, axleZ, hint, SHOULDER_WIDTH);
  const sample = track.samples[query.index]!;
  // Lateral offset of each wheel along the ROAD's right vector.
  const wheelLateral = rx * sample.rx + rz * sample.rz;
  const leftLateral = query.lateral - wheelLateral * WHEEL_TRACK;
  const rightLateral = query.lateral + wheelLateral * WHEEL_TRACK;
  const leftY = sample.y + Math.tan(query.bank) * leftLateral + LIFT;
  const rightY = sample.y + Math.tan(query.bank) * rightLateral + LIFT;
  return {
    left: [axleX - rx * WHEEL_TRACK, leftY, axleZ - rz * WHEEL_TRACK] as const,
    right: [axleX + rx * WHEEL_TRACK, rightY, axleZ + rz * WHEEL_TRACK] as const,
    hint: query.index,
    onGround: query.onGround,
  };
}

/** Skid strength for a racer this frame; 0 = not skidding. */
export function skidStrength(
  racer: Pick<
    RacerState,
    "driftDir" | "driftTier" | "speed" | "spinTimer" | "offRoad" | "airborne"
  >,
  decel: number,
): number {
  if (racer.airborne) return 0;
  if (racer.driftDir !== 0 && Math.abs(racer.speed) > 8) {
    return 0.5 + racer.driftTier * 0.16;
  }
  if (racer.spinTimer > 0 && Math.abs(racer.speed) > 4) return 0.85;
  // `brake` is not on the wire; hard deceleration on tarmac is the proxy.
  if (decel > 25 && Math.abs(racer.speed) > 6 && !racer.offRoad) return 0.6;
  if (racer.offRoad && Math.abs(racer.speed) > 6) return 0.3;
  return 0;
}

/** How much dust a mark on each surface carries. Asphalt is pure rubber. */
const SKID_TINT: Record<SurfaceKind, number> = {
  asphalt: 0,
  dirt: 1,
  gravel: 0.85,
  wet: 0.15,
};

interface EmitterState {
  lastLeft: [number, number, number];
  lastRight: [number, number, number];
  active: boolean;
  hint: number;
  prevSpeed: number;
}

export interface SkidMarks {
  readonly mesh: THREE.Mesh;
  /** Feed every racer every frame; emission rules live inside. */
  note(racer: RacerState, dt: number, time: number): void;
  update(time: number): void;
  dispose(): void;
}

export function createSkidMarks(track: Track, capacity: number): SkidMarks {
  const buffers = createSkidBuffers(capacity);
  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(buffers.position, 3);
  const birthAttribute = new THREE.BufferAttribute(buffers.birth, 1);
  const strengthAttribute = new THREE.BufferAttribute(buffers.strength, 1);
  const tintAttribute = new THREE.BufferAttribute(buffers.tint, 1);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  birthAttribute.setUsage(THREE.DynamicDrawUsage);
  strengthAttribute.setUsage(THREE.DynamicDrawUsage);
  tintAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("birth", birthAttribute);
  geometry.setAttribute("strength", strengthAttribute);
  geometry.setAttribute("tint", tintAttribute);
  geometry.setIndex(new THREE.BufferAttribute(buffers.index, 1));
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(),
    Number.POSITIVE_INFINITY,
  );

  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float birth;
      attribute float strength;
      attribute float tint;
      varying float vBirth;
      varying float vStrength;
      varying float vTint;
      void main() {
        vBirth = birth;
        vStrength = strength;
        vTint = tint;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying float vBirth;
      varying float vStrength;
      varying float vTint;
      void main() {
        float age = uTime - vBirth;
        float fade = clamp(1.0 - age / ${SKID_FADE_SEC.toFixed(1)}, 0.0, 1.0);
        // Dust scatters rather than stains, so it also sits lighter than rubber.
        float alpha = vStrength * mix(0.52, 0.38, vTint) * fade;
        if (alpha < 0.012) discard;
        vec3 rubber = vec3(0.055, 0.06, 0.07);
        vec3 dust = vec3(0.46, 0.34, 0.20);
        gl_FragColor = vec4(mix(rubber, dust, vTint), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1.5;

  const emitters = new Map<number, EmitterState>();
  let cursor = 0;
  let dirtyFrom = -1;
  let dirtyTo = -1;

  function markDirty(quad: number): void {
    if (dirtyFrom < 0) {
      dirtyFrom = quad;
      dirtyTo = quad;
    } else {
      dirtyFrom = Math.min(dirtyFrom, quad);
      dirtyTo = Math.max(dirtyTo, quad);
    }
  }

  return {
    mesh,
    note(racer, dt, time) {
      let state = emitters.get(racer.id);
      if (!state) {
        state = {
          lastLeft: [0, 0, 0],
          lastRight: [0, 0, 0],
          active: false,
          hint: -1,
          prevSpeed: racer.speed,
        };
        emitters.set(racer.id, state);
      }
      const decel = dt > 1e-4 ? (state.prevSpeed - racer.speed) / dt : 0;
      state.prevSpeed = racer.speed;
      const strength = skidStrength(racer, decel);
      if (strength <= 0) {
        state.active = false;
        return;
      }
      const contact = rearWheelContacts(track, racer.x, racer.z, racer.yaw, state.hint);
      state.hint = contact.hint;
      if (!contact.onGround) {
        state.active = false;
        return;
      }
      if (!state.active) {
        state.active = true;
        state.lastLeft = [...contact.left] as [number, number, number];
        state.lastRight = [...contact.right] as [number, number, number];
        return;
      }
      const moved = Math.hypot(
        contact.left[0] - state.lastLeft[0],
        contact.left[2] - state.lastLeft[2],
      );
      if (moved < MIN_SEGMENT) return;
      if (moved > MAX_SEGMENT) {
        // Respawn/teleport: restart the strip rather than smear across it.
        state.lastLeft = [...contact.left] as [number, number, number];
        state.lastRight = [...contact.right] as [number, number, number];
        return;
      }
      const quad = cursor;
      cursor = writeSkidQuad(
        buffers,
        cursor,
        state.lastLeft,
        state.lastRight,
        contact.left,
        contact.right,
        time,
        strength,
        SKID_TINT[
          querySurface(track, racer.x, racer.z, state.hint, SHOULDER_WIDTH)
            .surface
        ],
      );
      markDirty(quad);
      state.lastLeft = [...contact.left] as [number, number, number];
      state.lastRight = [...contact.right] as [number, number, number];
    },
    update(time) {
      (material.uniforms.uTime as { value: number }).value = time;
      if (dirtyFrom < 0) return;
      const vertexFrom = dirtyFrom * 4;
      const vertexCount = (dirtyTo - dirtyFrom + 1) * 4;
      positionAttribute.clearUpdateRanges();
      positionAttribute.addUpdateRange(vertexFrom * 3, vertexCount * 3);
      positionAttribute.needsUpdate = true;
      birthAttribute.clearUpdateRanges();
      birthAttribute.addUpdateRange(vertexFrom, vertexCount);
      birthAttribute.needsUpdate = true;
      strengthAttribute.clearUpdateRanges();
      strengthAttribute.addUpdateRange(vertexFrom, vertexCount);
      strengthAttribute.needsUpdate = true;
      tintAttribute.clearUpdateRanges();
      tintAttribute.addUpdateRange(vertexFrom, vertexCount);
      tintAttribute.needsUpdate = true;
      dirtyFrom = -1;
      dirtyTo = -1;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** Test seam: the surface height the conformance check compares against. */
export function expectedWheelHeight(
  track: Track,
  x: number,
  z: number,
  lateral: number,
): number {
  const query = querySurface(track, x, z, -1, SHOULDER_WIDTH);
  const sample = track.samples[query.index]!;
  return surfaceHeight(sample, lateral) + LIFT;
}
