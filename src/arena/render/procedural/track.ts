import * as THREE from "three";
import { CELL, type DriveDef } from "../../sim/types";
import { cachedGeometry } from "./geometryCache";
import { mergeParts, transformed } from "./merge";
import type { ProceduralDrive } from "./types";

interface Point {
  readonly z: number;
  readonly y: number;
}

const GROUSER_STAND = 0.0085;
export const trackWheelMatrixScratch = new THREE.Object3D();

function hullPoints(c1: number, r1: number, c2: number, r2: number, segments = 44): Point[] {
  const distance = Math.max(c2 - c1, 1e-6);
  const normalZ = THREE.MathUtils.clamp((r1 - r2) / distance, -0.98, 0.98);
  const tangentAngle = Math.acos(normalZ);
  const arcSteps = Math.max(6, Math.floor((segments - 4) / 2));
  const points: Point[] = [];
  for (let index = 0; index <= arcSteps; index += 1) {
    const angle = -tangentAngle + index / arcSteps * tangentAngle * 2;
    points.push({ z: c2 + Math.cos(angle) * r2, y: Math.sin(angle) * r2 });
  }
  const top2 = points[points.length - 1]!;
  const top1 = { z: c1 + normalZ * r1, y: Math.sin(tangentAngle) * r1 };
  points.push(
    { z: THREE.MathUtils.lerp(top2.z, top1.z, 0.34), y: THREE.MathUtils.lerp(top2.y, top1.y, 0.34) },
    { z: THREE.MathUtils.lerp(top2.z, top1.z, 0.62), y: THREE.MathUtils.lerp(top2.y, top1.y, 0.62) },
    top1
  );
  for (let index = 1; index <= arcSteps; index += 1) {
    const angle = tangentAngle + index / arcSteps * (Math.PI * 2 - tangentAngle * 2);
    points.push({ z: c1 + Math.cos(angle) * r1, y: Math.sin(angle) * r1 });
  }
  const bottom1 = points[points.length - 1]!;
  const bottom2 = { z: c2 + normalZ * r2, y: -Math.sin(tangentAngle) * r2 };
  points.push(
    { z: THREE.MathUtils.lerp(bottom1.z, bottom2.z, 0.5), y: THREE.MathUtils.lerp(bottom1.y, bottom2.y, 0.5) },
    bottom2
  );
  return points;
}

function perimeter(points: readonly Point[]): { lengths: number[]; total: number } {
  const lengths = [0];
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    total += Math.hypot(b.z - a.z, b.y - a.y);
    lengths.push(total);
  }
  return { lengths, total };
}

function samplePerimeter(points: readonly Point[], spacing: number): Point[] {
  const { lengths, total } = perimeter(points);
  const count = Math.max(16, Math.ceil(total / spacing));
  return Array.from({ length: count }, (_, sampleIndex) => {
    const distance = sampleIndex / count * total;
    let segment = 0;
    while (segment + 1 < lengths.length && lengths[segment + 1]! < distance) segment += 1;
    const a = points[segment]!;
    const b = points[(segment + 1) % points.length]!;
    const segmentLength = lengths[segment + 1]! - lengths[segment]!;
    const t = segmentLength > 0 ? (distance - lengths[segment]!) / segmentLength : 0;
    return {
      z: THREE.MathUtils.lerp(a.z, b.z, t),
      y: THREE.MathUtils.lerp(a.y, b.y, t)
    };
  });
}

function nearestProgress(point: THREE.Vector3, points: readonly Point[], lengths: readonly number[], total: number): number {
  let closest = Number.POSITIVE_INFINITY;
  let progress = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    const dz = b.z - a.z;
    const dy = b.y - a.y;
    const scale = THREE.MathUtils.clamp(
      ((point.x - a.z) * dz + (point.y - a.y) * dy) / Math.max(dz * dz + dy * dy, 1e-8),
      0,
      1
    );
    const z = a.z + dz * scale;
    const y = a.y + dy * scale;
    const distance = (point.x - z) ** 2 + (point.y - y) ** 2;
    if (distance < closest) {
      closest = distance;
      progress = (lengths[index]! + Math.hypot(dz, dy) * scale) / total;
    }
  }
  return progress;
}

function beltGeometry(def: DriveDef, width: number, length: number): THREE.BufferGeometry {
  return cachedGeometry(`track-belt:${def.id}:${width}:${length}`, () => {
    const outerRadius = Math.max(def.radius - GROUSER_STAND, def.radius * 0.7);
    const c1 = -length / 2 + def.radius;
    const c2 = length / 2 - def.radius;
    const outer = hullPoints(c1, outerRadius, c2, outerRadius, 44);
    const thickness = Math.min(def.radius * 0.24, 0.026);
    const innerRadius = Math.max(outerRadius - thickness, outerRadius * 0.66);
    const inner = hullPoints(c1, innerRadius, c2, innerRadius);
    const shape = new THREE.Shape();
    shape.moveTo(outer[0]!.z, outer[0]!.y);
    outer.slice(1).forEach((point) => shape.lineTo(point.z, point.y));
    shape.closePath();
    const hole = new THREE.Path();
    const reversed = [...inner].reverse();
    hole.moveTo(reversed[0]!.z, reversed[0]!.y);
    reversed.slice(1).forEach((point) => hole.lineTo(point.z, point.y));
    hole.closePath();
    shape.holes.push(hole);
    const { lengths, total } = perimeter(outer);
    const uvGenerator: THREE.UVGenerator = {
      generateTopUV(_geometry, vertices, a, b, c) {
        return [a, b, c].map((index) => {
          const point = new THREE.Vector3(
            vertices[index * 3]!,
            vertices[index * 3 + 1]!,
            vertices[index * 3 + 2]!
          );
          return new THREE.Vector2(
            (point.x + length / 2) / length,
            (point.y + def.radius) / (2 * def.radius)
          );
        });
      },
      generateSideWallUV(_geometry, vertices, a, b, c, d) {
        return [a, b, c, d].map((index) => {
          const point = new THREE.Vector3(
            vertices[index * 3]!,
            vertices[index * 3 + 1]!,
            vertices[index * 3 + 2]!
          );
          return new THREE.Vector2(point.z / width, nearestProgress(point, outer, lengths, total));
        });
      }
    };
    const belt = new THREE.ExtrudeGeometry(shape, {
      depth: width,
      bevelEnabled: false,
      curveSegments: 1,
      UVGenerator: uvGenerator
    });
    belt.rotateY(Math.PI / 2);
    belt.translate(-width / 2, 0, 0);
    belt.computeVertexNormals();
    return belt;
  });
}

function grouserGeometry(def: DriveDef, width: number, length: number): THREE.BufferGeometry {
  return cachedGeometry(`track-grousers:${def.id}:${width}:${length}`, () => {
    const outerRadius = Math.max(def.radius - GROUSER_STAND, def.radius * 0.7);
    const c1 = -length / 2 + def.radius;
    const c2 = length / 2 - def.radius;
    const hull = hullPoints(
      c1,
      outerRadius,
      c2,
      outerRadius,
      THREE.MathUtils.clamp(Math.round(length / 0.024), 16, 36)
    );
    const points = samplePerimeter(hull, 0.018);
    const parts: THREE.BufferGeometry[] = [];
    for (let index = 0; index < points.length; index += 1) {
      const previous = points[(index - 1 + points.length) % points.length]!;
      const next = points[(index + 1) % points.length]!;
      const point = points[index]!;
      const tangentZ = next.z - previous.z;
      const tangentY = next.y - previous.y;
      const normalLength = Math.hypot(tangentY, tangentZ);
      const ny = -tangentZ / normalLength;
      const nz = tangentY / normalLength;
      const angle = Math.atan2(nz, ny);
      const bar = new THREE.BoxGeometry(width, 0.009, Math.min(0.014, length / points.length * 0.9));
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(
          0,
          point.y + ny * (GROUSER_STAND - 0.009 / 2),
          point.z + nz * (GROUSER_STAND - 0.009 / 2)
        ),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle),
        new THREE.Vector3(1, 1, 1)
      );
      parts.push(transformed(bar, matrix));
      bar.dispose();
    }
    return mergeParts(parts);
  });
}

function wheelGeometry(radius: number, width: number, teeth = 0): THREE.BufferGeometry {
  const key = `track-wheel:${radius}:${width}:${teeth}`;
  return cachedGeometry(key, () => {
    const parts: THREE.BufferGeometry[] = [];
    const wheel = new THREE.CylinderGeometry(radius, radius, width, 18);
    wheel.rotateZ(Math.PI / 2);
    parts.push(wheel);
    const hub = new THREE.CylinderGeometry(radius * 0.28, radius * 0.28, width * 1.05, 12);
    hub.rotateZ(Math.PI / 2);
    parts.push(hub);
    for (let index = 0; index < teeth; index += 1) {
      const angle = index / teeth * Math.PI * 2;
      const tooth = new THREE.BoxGeometry(width * 1.02, radius * 0.12, radius * 0.16);
      tooth.translate(0, radius * 1.02, 0);
      tooth.rotateX(angle);
      parts.push(tooth);
    }
    return mergeParts(parts);
  });
}

function setWheelInstances(
  mesh: THREE.InstancedMesh,
  positions: readonly Point[],
  phase: number,
  ratios: readonly number[]
): void {
  positions.forEach((point, index) => {
    trackWheelMatrixScratch.position.set(0, point.y, point.z);
    trackWheelMatrixScratch.rotation.set(phase * (ratios[index] ?? 1), 0, 0);
    trackWheelMatrixScratch.updateMatrix();
    mesh.setMatrixAt(index, trackWheelMatrixScratch.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
}

export function createTrack(
  def: DriveDef,
  beltMaterial: THREE.MeshStandardMaterial,
  metal: THREE.Material
): ProceduralDrive {
  const width = Math.max(def.height, 0.08);
  const length = Math.max(def.cells[0], def.cells[1]) * CELL;
  const r1 = def.radius;
  const r2 = def.radius;
  const c1 = -length / 2 + r1;
  const c2 = length / 2 - r2;
  const root = new THREE.Group();
  root.name = `track-${def.id}`;

  const scrollingMaterial = beltMaterial.clone();
  scrollingMaterial.map = beltMaterial.map?.clone() ?? null;
  scrollingMaterial.normalMap = beltMaterial.normalMap?.clone() ?? null;
  for (const texture of [scrollingMaterial.map, scrollingMaterial.normalMap]) {
    if (!texture) continue;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1.5, 3);
    texture.needsUpdate = true;
  }
  const belt = new THREE.Mesh(beltGeometry(def, width, length), scrollingMaterial);
  const grousers = new THREE.Mesh(grouserGeometry(def, width, length), scrollingMaterial);
  belt.castShadow = belt.receiveShadow = grousers.castShadow = grousers.receiveShadow = true;
  root.add(belt, grousers);

  const sprocketPositions: Point[] = [{ z: c1, y: 0 }, { z: c2, y: 0 }];
  const sprockets = new THREE.InstancedMesh(wheelGeometry(r1 * 0.72, width * 0.82, 10), metal, 2);
  const roadRadius = Math.min(r1, r2) * 0.43;
  const roadCount = length > 0.35 ? 4 : 3;
  const roadPositions: Point[] = Array.from({ length: roadCount }, (_, index) => ({
    z: THREE.MathUtils.lerp(c1 + r1 * 0.72, c2 - r2 * 0.72, index / (roadCount - 1)),
    y: -r1 + roadRadius + 0.006 + (index === 1 || index === 2 ? 0.003 : 0)
  }));
  const roadWheels = new THREE.InstancedMesh(wheelGeometry(roadRadius, width * 0.76), metal, roadCount);
  sprockets.castShadow = roadWheels.castShadow = true;
  root.add(sprockets, roadWheels);

  const applyPhase = (phase: number) => {
    setWheelInstances(sprockets, sprocketPositions, phase, [1, r1 / r2]);
    setWheelInstances(roadWheels, roadPositions, phase * r1 / roadRadius, roadPositions.map(() => 1));
    if (scrollingMaterial.map) scrollingMaterial.map.offset.y = phase / (Math.PI * 2);
    if (scrollingMaterial.normalMap) scrollingMaterial.normalMap.offset.y = phase / (Math.PI * 2);
  };
  applyPhase(0);
  return { root, applyPhase };
}
