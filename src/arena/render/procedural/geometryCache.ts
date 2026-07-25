import * as THREE from "three";

const geometryCache = new Map<string, THREE.BufferGeometry>();

export function cachedGeometry<T extends THREE.BufferGeometry>(
  key: string,
  create: () => T
): T {
  const cached = geometryCache.get(key);
  if (cached) return cached as T;
  const geometry = create();
  geometry.name = key;
  geometry.userData.scShared = true;
  geometryCache.set(key, geometry);
  return geometry;
}

export function geometryCacheSize(): number {
  return geometryCache.size;
}

export function disposeSharedGeometry(): void {
  for (const geometry of geometryCache.values()) geometry.dispose();
  geometryCache.clear();
}

export function triangleCount(geometry: THREE.BufferGeometry): number {
  return geometry.index
    ? geometry.index.count / 3
    : (geometry.getAttribute("position")?.count ?? 0) / 3;
}
