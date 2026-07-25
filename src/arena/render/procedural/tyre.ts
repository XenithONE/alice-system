import * as THREE from "three";
import { CELL, type DriveDef } from "../../sim/types";
import { cachedGeometry } from "./geometryCache";
import { mergeParts, transformed } from "./merge";
import type { ProceduralDrive } from "./types";

function tyreGeometry(def: DriveDef, axleWidth: number): THREE.BufferGeometry {
  return cachedGeometry(`tyre:${def.id}:${axleWidth}`, () => {
    const radius = def.radius;
    const crown = radius * 0.94;
    const shoulder = radius * 0.88;
    const inner = radius * 0.55;
    const half = axleWidth / 2;
    const profile = [
      new THREE.Vector2(inner, -half * 0.88),
      new THREE.Vector2(shoulder, -half),
      new THREE.Vector2(crown, -half * 0.42),
      new THREE.Vector2(crown, 0),
      new THREE.Vector2(crown, half * 0.42),
      new THREE.Vector2(shoulder, half),
      new THREE.Vector2(inner, half * 0.88)
    ];
    const crownGeometry = new THREE.LatheGeometry(profile, 28);
    crownGeometry.rotateZ(Math.PI / 2);
    const beadParts = [-1, 1].map((side) => {
      const bead = new THREE.TorusGeometry(inner * 1.04, radius * 0.035, 5, 24);
      bead.rotateY(Math.PI / 2);
      bead.translate(side * half * 0.9, 0, 0);
      return bead;
    });
    const count = THREE.MathUtils.clamp(Math.round(2 * Math.PI * radius / 0.035), 14, 36);
    const treadParts: THREE.BufferGeometry[] = [];
    const treadHeight = radius * 0.06;
    const tangent = 2 * Math.PI * radius / count * 0.68;
    const treadCenter = Math.sqrt(radius ** 2 - (tangent / 2) ** 2) - treadHeight / 2;
    for (let index = 0; index < count; index += 1) {
      const angle = index / count * Math.PI * 2;
      const block = new THREE.BoxGeometry(axleWidth * 0.46, treadHeight, tangent);
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(
          (index % 2 === 0 ? -1 : 1) * axleWidth * 0.2,
          Math.cos(angle) * treadCenter,
          Math.sin(angle) * treadCenter
        ),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle),
        new THREE.Vector3(1, 1, 1)
      );
      treadParts.push(transformed(block, matrix));
      block.dispose();
    }
    return mergeParts([crownGeometry, ...beadParts, ...treadParts]);
  });
}

function rimGeometry(def: DriveDef, axleWidth: number): THREE.BufferGeometry {
  return cachedGeometry(`rim:${def.id}:${axleWidth}`, () => {
    const radius = def.radius;
    const parts: THREE.BufferGeometry[] = [];
    const barrel = new THREE.CylinderGeometry(radius * 0.49, radius * 0.49, axleWidth * 0.78, 20, 1, true);
    barrel.rotateZ(Math.PI / 2);
    parts.push(barrel);
    for (const side of [-1, 1]) {
      const ring = new THREE.TorusGeometry(radius * 0.43, radius * 0.055, 5, 20);
      ring.rotateY(Math.PI / 2);
      ring.translate(side * axleWidth * 0.4, 0, 0);
      parts.push(ring);
    }
    const spokes = def.mass <= 4 ? 6 : 5;
    for (let index = 0; index < spokes; index += 1) {
      const angle = index / spokes * Math.PI * 2;
      const spoke = new THREE.BoxGeometry(axleWidth * 0.68, radius * 0.08, radius * 0.36);
      spoke.translate(0, radius * 0.25, 0);
      spoke.rotateX(angle);
      parts.push(spoke);
    }
    const hub = new THREE.CylinderGeometry(radius * 0.19, radius * 0.19, axleWidth * 0.92, 16);
    hub.rotateZ(Math.PI / 2);
    parts.push(hub);
    for (let index = 0; index < 6; index += 1) {
      const angle = index / 6 * Math.PI * 2;
      const bolt = new THREE.CylinderGeometry(radius * 0.026, radius * 0.026, axleWidth * 0.05, 6);
      bolt.rotateZ(Math.PI / 2);
      bolt.translate(
        axleWidth * 0.475,
        Math.cos(angle) * radius * 0.27,
        Math.sin(angle) * radius * 0.27
      );
      parts.push(bolt);
    }
    return mergeParts(parts);
  });
}

export function createTyre(
  def: DriveDef,
  rubber: THREE.Material,
  metal: THREE.Material
): ProceduralDrive {
  const axleWidth = Math.max(def.height, CELL);
  const root = new THREE.Group();
  root.name = `tyre-${def.id}`;
  const tyre = new THREE.Mesh(tyreGeometry(def, axleWidth), rubber);
  const rim = new THREE.Mesh(rimGeometry(def, axleWidth), metal);
  tyre.castShadow = tyre.receiveShadow = true;
  rim.castShadow = rim.receiveShadow = true;
  root.add(tyre, rim);
  return {
    root,
    applyPhase(phase) {
      root.rotation.x = phase;
    }
  };
}
