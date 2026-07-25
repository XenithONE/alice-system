import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export function mergeParts(parts: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const normalized = parts.map((geometry) => {
    const result = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (!result.getAttribute("normal")) result.computeVertexNormals();
    return result;
  });
  const merged = mergeGeometries(normalized, false);
  normalized.forEach((geometry) => geometry.dispose());
  if (!merged) throw new Error("Unable to merge procedural geometry");
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

export function transformed(
  geometry: THREE.BufferGeometry,
  matrix: THREE.Matrix4
): THREE.BufferGeometry {
  return geometry.clone().applyMatrix4(matrix);
}
