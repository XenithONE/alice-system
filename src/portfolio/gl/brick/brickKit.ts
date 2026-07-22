import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Toy-brick kit. A brick TYPE (footprint fx×fy studs, kind brick/plate/tile) is a
// single merged geometry: a rounded-box body + real stud cylinders on top (the
// silhouette + stud contact shadow are what sell "toy brick"). Colour is set
// PER INSTANCE via InstancedMesh.setColorAt, so one InstancedMesh per type serves
// every colour — the whole logo renders in a handful of draw calls. Textureless,
// matching the rest of the low-poly GL. Generalises props/flora.ts's batching.

export const U = 0.8; // stud pitch (world units)
export const PLATE_H = U * 0.4;
export const BRICK_H = PLATE_H * 3;
export const STUD_R = U * 0.3;
export const STUD_H = U * 0.2;
const BEVEL = U * 0.055;

/** Curated toy-brick palette (real-ABS-ish hex). Scarcity reads premium. */
export const BRICK = {
  white: 0xf4f4f4,
  ivory: 0xede6d2,
  black: 0x1b1b1b,
  gray: 0xa0a5a9,
  darkGray: 0x6c6e68,
  tan: 0xe4cd9e,
  sand: 0xa0bcac,
  red: 0xc91a09,
  blue: 0x0055bf,
  azure: 0x078bc9,
  medAzure: 0x36aebf,
  yellow: 0xf2cd37,
  orange: 0xfe8a18,
  green: 0x4b9f4a,
  lime: 0xbbe90b,
  purple: 0x3f3691,
  gold: 0xd8c27a
} as const;

export type BrickKind = "brick" | "plate" | "tile";

export interface BrickMaterials {
  glossy: THREE.MeshStandardMaterial; // logo bricks (per-instance colour)
  matte: THREE.MeshStandardMaterial; // baseplate / ground
  dispose(): void;
}

export function makeBrickMaterials(): BrickMaterials {
  const glossy = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0 });
  const matte = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0 });
  return {
    glossy,
    matte,
    dispose() {
      glossy.dispose();
      matte.dispose();
    }
  };
}

export function buildBrickGeo(fx: number, fy: number, kind: BrickKind, studSeg: number): THREE.BufferGeometry {
  const w = fx * U;
  const d = fy * U;
  const h = kind === "brick" ? BRICK_H : PLATE_H;
  const body = new RoundedBoxGeometry(w, h, d, 2, BEVEL);
  body.translate(0, h / 2, 0); // base sits at y = 0
  const parts: THREE.BufferGeometry[] = [body];
  if (kind !== "tile") {
    for (let i = 0; i < fx; i += 1) {
      for (let j = 0; j < fy; j += 1) {
        const stud = new THREE.CylinderGeometry(STUD_R, STUD_R, STUD_H, studSeg);
        stud.translate((i + 0.5 - fx / 2) * U, h + STUD_H / 2, (j + 0.5 - fy / 2) * U);
        parts.push(stud);
      }
    }
  }
  // RoundedBoxGeometry is non-indexed while CylinderGeometry is indexed;
  // mergeGeometries requires a consistent index state, so normalize to non-indexed.
  const norm = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const merged = mergeGeometries(norm, false);
  new Set([...parts, ...norm]).forEach((p) => p.dispose());
  if (!merged) throw new Error("brick geometry merge failed");
  return merged;
}

interface Placement {
  x: number;
  y: number;
  z: number;
  rot: number;
  color: THREE.Color;
}

/** Accumulate brick placements per type, then build one InstancedMesh per type. */
export class BrickBatcher {
  private groups = new Map<string, { geo: THREE.BufferGeometry; items: Placement[] }>();
  private readonly dummy = new THREE.Object3D();

  constructor(
    private readonly material: THREE.MeshStandardMaterial,
    private readonly studSeg = 12
  ) {}

  /** x,y,z = world position of the footprint centre at the brick's BASE. */
  add(fx: number, fy: number, kind: BrickKind, x: number, y: number, z: number, color: number, rot = 0): void {
    const key = `${fx}x${fy}:${kind}`;
    let g = this.groups.get(key);
    if (!g) {
      g = { geo: buildBrickGeo(fx, fy, kind, this.studSeg), items: [] };
      this.groups.set(key, g);
    }
    g.items.push({ x, y, z, rot, color: new THREE.Color(color) });
  }

  build(castShadow: boolean): { group: THREE.Group; dispose(): void } {
    const group = new THREE.Group();
    const meshes: THREE.InstancedMesh[] = [];
    const geos: THREE.BufferGeometry[] = [];
    for (const { geo, items } of this.groups.values()) {
      const mesh = new THREE.InstancedMesh(geo, this.material, items.length);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      for (let i = 0; i < items.length; i += 1) {
        const it = items[i]!;
        this.dummy.position.set(it.x, it.y, it.z);
        this.dummy.rotation.set(0, it.rot, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);
        mesh.setColorAt(i, it.color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      group.add(mesh);
      meshes.push(mesh);
      geos.push(geo);
    }
    return {
      group,
      dispose() {
        meshes.forEach((m) => {
          group.remove(m);
          m.dispose(); // frees instanceMatrix / instanceColor buffers
        });
        geos.forEach((g) => g.dispose());
      }
    };
  }

  /** Total brick count accumulated (for perf logging / tests). */
  get count(): number {
    let n = 0;
    for (const g of this.groups.values()) n += g.items.length;
    return n;
  }
}
