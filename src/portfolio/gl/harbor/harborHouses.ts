import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { HeroQuality } from "../../quality";
import type { HarborMaterials } from "./harborModels";

export interface HouseSpec {
  id: string;
  title: string;
  cover: string;
  color: number;
}

export interface HouseLayoutConstraint {
  forbiddenBand: readonly [number, number];
  collider: { x: number; z: number; r: number };
  playerRadius: number;
}

export interface HouseRuntime {
  id: string;
  root: THREE.Group;
  doorPosition: THREE.Vector3;
  collider: { x: number; z: number; r: number };
  sign: THREE.Mesh;
  setHighlight(on: boolean): void;
  dispose(): void;
}

// The promenade the player can actually walk is z ∈ [-36.4, 1.6] (see
// walkablePosition in harborScene). These centre limits leave the house
// footprint and entry paving inside that range.
const HOUSE_X = -16.4;
const DOOR_X = -13.9;
const WALKABLE_MIN_Z = -36.4;
const WALKABLE_MAX_Z = 1.6;
const FIRST_HOUSE_Z = -33.5;
const LAST_HOUSE_Z = 0;
const MAX_HOUSE_SPACING = 3.35;
const HOUSE_DEPTH = 2.9;
const HOUSE_ACTIVATION_R = 1.9;
const ROOF_TILT = 0.62;
const ROOF_DEPTH_RATIO = 0.772;
const ROOF_OFFSET_RATIO = 0.285;
const ROOF_THICKNESS = 0.34;
const ROOF_GAP = 0.04;
const CORNER_BLOCKS_PER_HOUSE = 2 * 2 * 8;

function markPickable(mesh: THREE.Mesh, houseId: string): THREE.Mesh {
  mesh.userData.houseId = houseId;
  return mesh;
}

function transformedGeometry(
  source: THREE.BufferGeometry,
  position: THREE.Vector3,
  rotation: THREE.Euler
): THREE.BufferGeometry {
  const matrix = new THREE.Matrix4().compose(
    position,
    new THREE.Quaternion().setFromEuler(rotation),
    new THREE.Vector3(1, 1, 1)
  );
  source.applyMatrix4(matrix);
  return source;
}

function mergeNormalized(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // BoxGeometry is indexed while Torus/Cylinder/RoundedBox-derived geometry can
  // be non-indexed. BufferGeometryUtils requires one index state for every part.
  const normalized = parts.map((part) => (part.index ? part.toNonIndexed() : part));
  const merged = mergeGeometries(normalized, false);
  new Set([...parts, ...normalized]).forEach((part) => part.dispose());
  if (!merged) throw new Error("house geometry merge failed");
  return merged;
}

function roofReach(depth: number): number {
  return (
    ROOF_OFFSET_RATIO * depth +
    (ROOF_DEPTH_RATIO * depth / 2) * Math.cos(ROOF_TILT) +
    (ROOF_THICKNESS / 2) * Math.sin(ROOF_TILT)
  );
}

function maxDepthForSpacing(spacing: number): number {
  // reach(depth) = offset*d + (roofDepth*d/2)cos(tilt) + (thickness/2)sin(tilt).
  // Solve reach(depth) ≤ spacing/2 - ROOF_GAP instead of guarding only the body.
  const fixedThicknessReach = (ROOF_THICKNESS / 2) * Math.sin(ROOF_TILT);
  const depthFactor =
    ROOF_OFFSET_RATIO + (ROOF_DEPTH_RATIO / 2) * Math.cos(ROOF_TILT);
  return Math.max(0.4, (spacing / 2 - ROOF_GAP - fixedThicknessReach) / depthFactor);
}

function blockedCenterInterval(constraint: HouseLayoutConstraint): readonly [number, number] {
  const bandMin = Math.min(...constraint.forbiddenBand);
  const bandMax = Math.max(...constraint.forbiddenBand);
  const requiredDistance = constraint.collider.r + HOUSE_ACTIVATION_R + constraint.playerRadius;
  const xDistance = Math.abs(DOOR_X - constraint.collider.x);
  const zClearance = Math.sqrt(Math.max(0, requiredDistance ** 2 - xDistance ** 2));
  return [
    Math.min(bandMin, constraint.collider.z - zClearance),
    Math.max(bandMax, constraint.collider.z + zClearance)
  ];
}

function layoutHouseZs(count: number, constraint?: HouseLayoutConstraint): number[] {
  if (count <= 0) return [];
  if (count === 1) return [FIRST_HOUSE_Z];

  const blocked = constraint ? blockedCenterInterval(constraint) : null;
  const blockedWidth = blocked
    ? Math.max(0, Math.min(LAST_HOUSE_Z, blocked[1]) - Math.max(FIRST_HOUSE_Z, blocked[0]))
    : 0;
  const usableSpan = LAST_HOUSE_Z - FIRST_HOUSE_Z - blockedWidth;
  const spacing = Math.min(MAX_HOUSE_SPACING, usableSpan / (count - 1));
  if (!(spacing > 0)) throw new Error("not enough promenade space for houses");

  // Lay out equally in a compressed coordinate, then reinsert the forbidden
  // interval. This packs both sides of the castle gap and remains valid when
  // the house count changes.
  const positions: number[] = [];
  for (let index = 0; index < count; index += 1) {
    let z = FIRST_HOUSE_Z + index * spacing;
    if (blocked && z >= blocked[0]) z += blockedWidth;
    positions.push(Math.min(z, LAST_HOUSE_Z));
  }
  return positions;
}

export function createHouses(
  specs: HouseSpec[],
  _materials: HarborMaterials,
  quality: HeroQuality,
  covers: ReadonlyMap<string, THREE.Texture>,
  layoutConstraint?: HouseLayoutConstraint
): { group: THREE.Group; houses: HouseRuntime[]; dispose(): void } {
  const group = new THREE.Group();
  group.name = "game-houses";
  const houses: HouseRuntime[] = [];
  const houseZs = layoutHouseZs(specs.length, layoutConstraint);
  const spacing = houseZs.length > 1
    ? Math.min(...houseZs.slice(1).map((z, index) => z - houseZs[index]!))
    : MAX_HOUSE_SPACING;
  const depth = Math.min(HOUSE_DEPTH, maxDepthForSpacing(spacing));
  if (roofReach(depth) > spacing / 2 - ROOF_GAP + 1e-6) {
    throw new Error("house roof spacing invariant failed");
  }
  const halfDepth = depth / 2;
  const cornerZ = Math.max(0.3, halfDepth - 0.22);
  const windowZ = halfDepth + 0.02;
  const roofDepth = depth * ROOF_DEPTH_RATIO;
  const roofOffsetZ = depth * ROOF_OFFSET_RATIO;

  const cornerGeometry = new THREE.BoxGeometry(0.46, 0.42, 0.46);
  const cornerMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.78,
    vertexColors: true
  });
  const cornerInstances = new THREE.InstancedMesh(
    cornerGeometry,
    cornerMaterial,
    specs.length * CORNER_BLOCKS_PER_HOUSE
  );
  cornerInstances.name = "house-corner-blocks";
  cornerInstances.castShadow = true;
  cornerInstances.receiveShadow = true;
  const instanceTransform = new THREE.Object3D();
  let instanceIndex = 0;

  for (let index = 0; index < specs.length; index += 1) {
    const spec = specs[index]!;
    const houseZ = houseZs[index]!;
    const root = new THREE.Group();
    root.name = `game-house-${spec.id}`;
    root.position.set(HOUSE_X, 0.58, houseZ);

    const geometries = new Set<THREE.BufferGeometry>();
    const ownedMaterials = new Set<THREE.Material>();
    let disposed = false;
    const geometry = <T extends THREE.BufferGeometry>(value: T): T => {
      geometries.add(value);
      return value;
    };
    const material = <T extends THREE.Material>(value: T): T => {
      ownedMaterials.add(value);
      return value;
    };

    const wallMaterial = material(new THREE.MeshStandardMaterial({
      color: spec.color,
      roughness: 0.82,
      metalness: 0.02
    }));
    const trimColor = new THREE.Color(spec.color).offsetHSL(0, -0.06, 0.12);
    const trimMaterial = material(new THREE.MeshStandardMaterial({
      color: trimColor,
      roughness: 0.78
    }));
    const roofMaterial = material(new THREE.MeshStandardMaterial({
      color: 0x152538,
      roughness: 0.9
    }));
    const doorwayMaterial = material(new THREE.MeshStandardMaterial({
      color: 0x07111b,
      roughness: 1,
      emissive: 0x02070c,
      emissiveIntensity: 0.7
    }));
    const windowMaterial = material(new THREE.MeshStandardMaterial({
      color: 0xffd98b,
      emissive: 0xffa62e,
      emissiveIntensity: quality.tier === "low" ? 1.15 : 1.8,
      roughness: 0.35,
      toneMapped: false
    }));
    const signMaterial = material(new THREE.MeshStandardMaterial({
      color: spec.color,
      emissive: new THREE.Color(spec.color).multiplyScalar(0.22),
      emissiveIntensity: 0.18,
      roughness: 0.72,
      map: covers.get(spec.id) ?? null
    }));
    if (signMaterial.map) signMaterial.color.set(0xffffff);
    const pavingMaterial = material(new THREE.MeshStandardMaterial({
      color: 0xffd779,
      emissive: 0xe9a62f,
      emissiveIntensity: 0.32,
      roughness: 0.55,
      toneMapped: false
    }));

    const bodyParts = [
      transformedGeometry(
        new THREE.BoxGeometry(3.4, 4.2, depth),
        new THREE.Vector3(0, 2.1, 0),
        new THREE.Euler()
      )
    ];
    const roofParts = [
      ...[-1, 1].map((side) => transformedGeometry(
        new THREE.BoxGeometry(3.95, ROOF_THICKNESS, roofDepth),
        new THREE.Vector3(0, 4.86, side * roofOffsetZ),
        new THREE.Euler(side * ROOF_TILT, 0, 0)
      )),
      transformedGeometry(
        new THREE.BoxGeometry(4.05, 0.36, 0.38),
        new THREE.Vector3(0, 5.9, 0),
        new THREE.Euler(Math.PI / 4, 0, 0)
      )
    ];
    const trimParts = [
      ...[-1, 1].map((side) => transformedGeometry(
        new THREE.BoxGeometry(0.32, 1.55, 0.32),
        new THREE.Vector3(1.83, 0.78, side * Math.min(0.94, halfDepth - 0.35)),
        new THREE.Euler()
      )),
      transformedGeometry(
        new THREE.TorusGeometry(0.85, 0.17, 6, 18, Math.PI),
        new THREE.Vector3(1.84, 1.55, 0),
        new THREE.Euler(0, Math.PI / 2, 0)
      )
    ];
    const materialGeometries = [
      mergeNormalized(bodyParts),
      mergeNormalized(roofParts),
      mergeNormalized(trimParts)
    ];
    const normalizedMaterialGeometries = materialGeometries.map(
      (part) => (part.index ? part.toNonIndexed() : part)
    );
    const mergedGeometry = mergeGeometries(normalizedMaterialGeometries, true);
    new Set([...materialGeometries, ...normalizedMaterialGeometries]).forEach((part) => part.dispose());
    if (!mergedGeometry) throw new Error("house material-group merge failed");
    const shell = new THREE.Mesh(
      geometry(mergedGeometry),
      [wallMaterial, roofMaterial, trimMaterial]
    );
    shell.castShadow = true;
    shell.receiveShadow = true;
    root.add(shell);

    for (const x of [-1.73, 1.73]) {
      for (const z of [-cornerZ, cornerZ]) {
        for (let row = 0; row < 8; row += 1) {
          // World-space matrices let every house share this one InstancedMesh.
          instanceTransform.position.set(
            HOUSE_X + x,
            0.58 + 0.28 + row * 0.53,
            houseZ + z
          );
          instanceTransform.rotation.set(0, (row % 2) * Math.PI / 4, 0);
          instanceTransform.scale.set(1, 1, 1);
          instanceTransform.updateMatrix();
          cornerInstances.setMatrixAt(instanceIndex, instanceTransform.matrix);
          cornerInstances.setColorAt(instanceIndex, trimColor);
          instanceIndex += 1;
        }
      }
    }

    const doorway = markPickable(
      new THREE.Mesh(geometry(new THREE.PlaneGeometry(1.66, 2.3)), doorwayMaterial),
      spec.id
    );
    doorway.position.set(1.706, 1.15, 0);
    doorway.rotation.y = Math.PI / 2;
    root.add(doorway);

    const sign = markPickable(
      new THREE.Mesh(
        geometry(new THREE.BoxGeometry(0.16, 1.9, Math.min(3.4, depth * 0.94))),
        signMaterial
      ),
      spec.id
    );
    sign.position.set(1.82, 3.16, 0);
    sign.castShadow = true;
    root.add(sign);

    const windowGeometry = geometry(new THREE.BoxGeometry(1.24, 1.05, 0.1));
    for (const side of [-1, 1]) {
      const window = new THREE.Mesh(windowGeometry, windowMaterial);
      window.position.set(-0.15, 2.45, side * windowZ);
      root.add(window);
    }

    const paving = markPickable(
      new THREE.Mesh(geometry(new THREE.BoxGeometry(1.6, 0.12, 1.6)), pavingMaterial),
      spec.id
    );
    paving.position.set(2.5, 0.05, 0);
    paving.receiveShadow = true;
    root.add(paving);

    // Emissive entry trim suggests a porch light without adding PointLights,
    // which would increase NUM_POINT_LIGHTS for every lit shader in the scene.
    const porchGlow = new THREE.Mesh(
      geometry(new THREE.BoxGeometry(0.12, 0.5, 0.5)),
      windowMaterial
    );
    porchGlow.position.set(1.9, 2.35, 0);
    root.add(porchGlow);

    const runtime: HouseRuntime = {
      id: spec.id,
      root,
      doorPosition: new THREE.Vector3(DOOR_X, 0.72, houseZ),
      // r 1.5 at x=-16.4 blocks the walker (r 0.42) only past x=-14.48,
      // west of the promenade edge (-14.15), so the corridor remains open.
      collider: { x: HOUSE_X, z: houseZ, r: 1.5 },
      sign,
      setHighlight(on: boolean) {
        pavingMaterial.emissiveIntensity = on ? 2.6 : 0.32;
        signMaterial.emissiveIntensity = on ? 0.92 : 0.18;
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        // Cover maps are shared with portals and intentionally are not owned.
        geometries.forEach((item) => item.dispose());
        ownedMaterials.forEach((item) => item.dispose());
        root.clear();
      }
    };

    houses.push(runtime);
    group.add(root);
  }

  cornerInstances.instanceMatrix.needsUpdate = true;
  if (cornerInstances.instanceColor) cornerInstances.instanceColor.needsUpdate = true;
  group.add(cornerInstances);

  if (layoutConstraint) {
    const requiredDistance =
      layoutConstraint.collider.r + HOUSE_ACTIVATION_R + layoutConstraint.playerRadius;
    for (const house of houses) {
      const distance = Math.hypot(
        house.doorPosition.x - layoutConstraint.collider.x,
        house.doorPosition.z - layoutConstraint.collider.z
      );
      if (distance + 1e-6 < requiredDistance) {
        throw new Error(`house ${house.id} violates castle tower clearance`);
      }
    }
  }
  for (const house of houses) {
    // Door centres, which drive entry activation, must remain on the promenade.
    if (house.doorPosition.z < WALKABLE_MIN_Z || house.doorPosition.z > WALKABLE_MAX_Z) {
      throw new Error(`house ${house.id} is outside the walkable promenade`);
    }
  }

  let collectionDisposed = false;
  return {
    group,
    houses,
    dispose() {
      if (collectionDisposed) return;
      collectionDisposed = true;
      houses.forEach((house) => house.dispose());
      group.remove(cornerInstances);
      // InstancedMesh.dispose releases instanceMatrix/instanceColor GPU buffers;
      // its shared geometry and material are disposed explicitly as well.
      cornerInstances.dispose();
      cornerGeometry.dispose();
      cornerMaterial.dispose();
      group.clear();
    }
  };
}
