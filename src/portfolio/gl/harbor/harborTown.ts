import * as THREE from "three";
import type { HeroQuality } from "../../quality";
import { BRICK, BrickBatcher, PLATE_H } from "../brick/brickKit";
import type { HarborMaterials } from "./harborModels";

export interface TownRuntime {
  group: THREE.Group;
  colliders: { x: number; z: number; r: number }[];
  arenaDoor: THREE.Vector3;
  setArenaHighlight(on: boolean): void;
  dispose(): void;
}

interface Building {
  x: number;
  z: number;
  color: number;
  kind: "shop" | "home" | "clock";
}

const BUILDINGS: Building[] = [
  { x: -18.0, z: -38.6, color: BRICK.red, kind: "shop" },
  { x: -21.0, z: -38.6, color: BRICK.tan, kind: "home" },
  { x: -24.0, z: -38.6, color: BRICK.blue, kind: "shop" },
  { x: -27.0, z: -38.6, color: BRICK.sand, kind: "home" },
  { x: -30.0, z: -38.6, color: BRICK.red, kind: "shop" },
  { x: -27.0, z: -44.7, color: BRICK.azure, kind: "clock" },
  { x: -30.0, z: -44.7, color: BRICK.tan, kind: "home" },
  { x: -21.0, z: -50.3, color: BRICK.sand, kind: "home" },
  { x: -25.5, z: -50.3, color: BRICK.red, kind: "shop" },
  { x: -30.0, z: -50.3, color: BRICK.blue, kind: "home" }
];

function addBuilding(
  batch: BrickBatcher,
  trim: BrickBatcher,
  building: Building,
  index: number
): void {
  const isClock = building.kind === "clock";
  const floors = isClock ? 6 : 3 + (index % 2);
  const footprintX = isClock ? 3 : 3;
  const footprintZ = isClock ? 3 : 4;
  for (let floor = 0; floor < floors; floor += 1) {
    batch.add(
      footprintX,
      footprintZ,
      "brick",
      building.x,
      floor * 0.96,
      building.z,
      floor % 2 === 0 ? building.color : new THREE.Color(building.color).offsetHSL(0, 0, 0.045).getHex()
    );
  }

  const roofY = floors * 0.96;
  trim.add(4, footprintZ + 1, "plate", building.x, roofY, building.z, index % 3 === 0 ? BRICK.orange : BRICK.darkGray);
  trim.add(3, footprintZ, "brick", building.x, roofY + PLATE_H, building.z, index % 3 === 0 ? BRICK.orange : BRICK.darkGray);

  const southFaceZ = building.z + footprintZ * 0.4 + 0.05;
  trim.add(1, 1, "tile", building.x, 0.03, southFaceZ, BRICK.darkGray);
  for (let floor = 1; floor < Math.min(floors, 4); floor += 1) {
    for (const side of [-0.72, 0.72]) {
      trim.add(1, 1, "tile", building.x + side, floor * 0.96 + 0.25, southFaceZ, BRICK.yellow);
    }
  }

  if (building.kind === "shop") {
    trim.add(3, 1, "plate", building.x, 1.22, southFaceZ + 0.32, index % 2 ? BRICK.yellow : BRICK.white);
    trim.add(1, 1, "brick", building.x - 0.75, 0.28, southFaceZ + 0.05, BRICK.medAzure);
    trim.add(1, 1, "brick", building.x + 0.75, 0.28, southFaceZ + 0.05, BRICK.medAzure);
  } else {
    trim.add(1, 1, "brick", building.x + 0.76, roofY + 0.35, building.z - 0.45, BRICK.darkGray);
  }

  if (isClock) {
    trim.add(2, 1, "tile", building.x, 5.08, building.z + 1.23, BRICK.ivory);
    trim.add(1, 1, "tile", building.x, 5.18, building.z + 1.28, BRICK.gold);
  }
}

function addTownProps(batch: BrickBatcher, low: boolean): void {
  // Market stalls and crates occupy the small square without closing either
  // cross street. All are deliberately below knee height or outside its path.
  for (const [x, z, color] of [
    [-21.5, -44.0, BRICK.orange],
    [-23.6, -45.4, BRICK.blue],
    [-21.4, -46.0, BRICK.red]
  ] as const) {
    batch.add(2, 2, "plate", x, 0, z, BRICK.tan);
    batch.add(2, 2, "plate", x, 1.0, z, color);
    batch.add(1, 1, "brick", x - 0.55, 0.32, z, BRICK.tan);
    batch.add(1, 1, "brick", x + 0.55, 0.32, z, BRICK.tan);
  }

  // Fountain / well in the square.
  for (let index = 0; index < 8; index += 1) {
    const angle = index / 8 * Math.PI * 2;
    batch.add(1, 1, "brick", -23.1 + Math.cos(angle) * 1.0, 0, -44.7 + Math.sin(angle) * 1.0, BRICK.gray, angle);
  }
  batch.add(1, 1, "brick", -23.1, 0.42, -44.7, BRICK.medAzure);

  const lampPositions = low
    ? [[-15.2, -39.4], [-15.2, -47.0], [-20.0, -41.7]]
    : [[-15.2, -39.4], [-15.2, -43.0], [-15.2, -47.0], [-20.0, -41.7], [-25.0, -41.7], [-20.0, -47.7]];
  for (const [x, z] of lampPositions) {
    batch.add(1, 1, "brick", x!, 0, z!, BRICK.darkGray);
    batch.add(1, 1, "brick", x!, 0.96, z!, BRICK.darkGray);
    batch.add(1, 1, "brick", x!, 1.92, z!, BRICK.yellow);
  }

  if (!low) {
    // Benches, planters, barrels, and a geometric (textless) hanging sign.
    for (const [x, z, rot] of [[-19.0, -42.0, 0], [-25.0, -47.5, Math.PI / 2]] as const) {
      batch.add(3, 1, "plate", x, 0.45, z, BRICK.tan, rot);
      batch.add(1, 1, "brick", x - Math.cos(rot) * 0.7, 0, z + Math.sin(rot) * 0.7, BRICK.darkGray);
      batch.add(1, 1, "brick", x + Math.cos(rot) * 0.7, 0, z - Math.sin(rot) * 0.7, BRICK.darkGray);
    }
    for (const [x, z] of [[-17.0, -41.8], [-29.0, -47.6], [-24.0, -36.9]] as const) {
      batch.add(1, 1, "brick", x, 0, z, BRICK.red);
      batch.add(1, 1, "plate", x, 0.96, z, BRICK.green);
    }
    batch.add(1, 1, "brick", -17.0, 2.0, -38.2, BRICK.darkGray);
    batch.add(2, 1, "tile", -16.85, 2.85, -38.2, BRICK.gold, Math.PI / 2);
  }
}

export function createTown(
  materials: HarborMaterials,
  quality: HeroQuality
): TownRuntime {
  const group = new THREE.Group();
  group.name = "harbor-town";
  const ownedGeometries: THREE.BufferGeometry[] = [];
  const ownedMaterials: THREE.Material[] = [];

  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(24.35, 0.42, 15.6),
    materials.stoneDark
  );
  ground.name = "town-base";
  ground.position.set(-19.825, 0.35, -44.2);
  ground.receiveShadow = true;
  group.add(ground);
  ownedGeometries.push(ground.geometry);

  const pavingGeometry = new THREE.BoxGeometry(1, 0.12, 1);
  const pavingMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    vertexColors: true
  });
  const paving: Array<{ x: number; z: number; sx: number; sz: number; color: number }> = [
    { x: -11.9, z: -44.2, sx: 5.1, sz: 15.6, color: 0xc9b48d },
    { x: -20.2, z: -41.7, sx: 16.8, sz: 2.8, color: 0xb7a985 },
    { x: -23.2, z: -47.7, sx: 15.2, sz: 2.8, color: 0xb7a985 },
    { x: -23.1, z: -44.7, sx: 4.7, sz: 4.4, color: 0xd1c39c }
  ];
  const pavingMesh = new THREE.InstancedMesh(pavingGeometry, pavingMaterial, paving.length);
  const dummy = new THREE.Object3D();
  paving.forEach((item, index) => {
    dummy.position.set(item.x, 0.62, item.z);
    dummy.scale.set(item.sx, 1, item.sz);
    dummy.updateMatrix();
    pavingMesh.setMatrixAt(index, dummy.matrix);
    pavingMesh.setColorAt(index, new THREE.Color(item.color));
  });
  pavingMesh.instanceMatrix.needsUpdate = true;
  if (pavingMesh.instanceColor) pavingMesh.instanceColor.needsUpdate = true;
  pavingMesh.receiveShadow = true;
  group.add(pavingMesh);
  ownedGeometries.push(pavingGeometry);
  ownedMaterials.push(pavingMaterial);

  const brickMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.66,
    metalness: 0,
    vertexColors: true
  });
  const trimMaterial = brickMaterial.clone();
  trimMaterial.roughness = 0.52;
  ownedMaterials.push(brickMaterial, trimMaterial);
  const buildings = new BrickBatcher(brickMaterial, quality.tier === "low" ? 6 : 8);
  const trim = new BrickBatcher(trimMaterial, quality.tier === "low" ? 6 : 8);
  BUILDINGS.forEach((building, index) => addBuilding(buildings, trim, building, index));
  addTownProps(trim, quality.tier === "low");

  const arenaCenter = new THREE.Vector2(-13.0, -47.1);
  const arenaRadius = 5.0;
  const arenaSegments = quality.tier === "low" ? 14 : 18;
  for (let index = 0; index < arenaSegments; index += 1) {
    const angle = index / arenaSegments * Math.PI * 2;
    // +Z is south. Leave a 2.7m-wide opening centered on the avenue.
    if (Math.abs(Math.atan2(Math.sin(angle - Math.PI / 2), Math.cos(angle - Math.PI / 2))) < 0.29) continue;
    const x = arenaCenter.x + Math.cos(angle) * arenaRadius;
    const z = arenaCenter.y + Math.sin(angle) * arenaRadius;
    buildings.add(1, 2, "brick", x, 0, z, BRICK.tan, -angle);
    buildings.add(1, 2, "brick", x, 0.96, z, BRICK.tan, -angle);
    buildings.add(1, 2, "brick", x, 1.92, z, BRICK.ivory, -angle);
    trim.add(2, 2, "plate", x, 2.88, z, index % 2 ? BRICK.red : BRICK.blue, -angle);
  }
  // Gate piers, upper arch suggestion, and flags (no sign or title).
  for (const x of [-14.5, -11.5]) {
    buildings.add(1, 2, "brick", x, 0, -42.55, BRICK.tan);
    buildings.add(1, 2, "brick", x, 0.96, -42.55, BRICK.tan);
    buildings.add(1, 2, "brick", x, 1.92, -42.55, BRICK.ivory);
  }
  trim.add(4, 1, "brick", -13, 3.0, -42.55, BRICK.ivory);
  for (const x of [-15.8, -10.2]) {
    trim.add(1, 1, "brick", x, 3.2, -43.0, BRICK.darkGray);
    trim.add(2, 1, "tile", x + 0.35, 4.15, -43.0, x < -13 ? BRICK.red : BRICK.blue);
  }

  const buildingBatch = buildings.build(quality.tier !== "low");
  const trimBatch = trim.build(false);
  group.add(buildingBatch.group, trimBatch.group);

  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd58a,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    toneMapped: false
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.25, 2.65), glowMaterial);
  glow.name = "arena-gate-glow";
  glow.position.set(-13, 1.55, -42.7);
  group.add(glow);
  ownedGeometries.push(glow.geometry);
  ownedMaterials.push(glowMaterial);

  const arenaLight = new THREE.PointLight(
    0xffb85c,
    quality.tier === "low" ? 0.55 : 1.1,
    7,
    2
  );
  arenaLight.position.set(-13, 1.7, -43.3);
  group.add(arenaLight);

  const colliders = BUILDINGS.map((building) => ({
    x: building.x,
    z: building.z,
    r: building.kind === "clock" ? 1.62 : 1.55
  }));
  for (let index = 0; index < 18; index += 1) {
    const angle = index / 18 * Math.PI * 2;
    const fromSouth = Math.abs(
      Math.atan2(Math.sin(angle - Math.PI / 2), Math.cos(angle - Math.PI / 2))
    );
    if (fromSouth < 0.34) continue;
    colliders.push({
      x: arenaCenter.x + Math.cos(angle) * arenaRadius,
      z: arenaCenter.y + Math.sin(angle) * arenaRadius,
      r: 0.62
    });
  }
  colliders.push(
    { x: -14.5, z: -42.55, r: 0.62 },
    { x: -11.5, z: -42.55, r: 0.62 },
    { x: -23.1, z: -44.7, r: 1.05 }
  );

  let disposed = false;
  return {
    group,
    colliders,
    arenaDoor: new THREE.Vector3(-13, 0.72, -41.9),
    setArenaHighlight(on: boolean) {
      glowMaterial.opacity = on ? 0.82 : 0.34;
      arenaLight.intensity = on
        ? (quality.tier === "low" ? 1.25 : 2.8)
        : (quality.tier === "low" ? 0.55 : 1.1);
      glow.scale.setScalar(on ? 1.12 : 1);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      buildingBatch.dispose();
      trimBatch.dispose();
      ownedGeometries.forEach((geometry) => geometry.dispose());
      ownedMaterials.forEach((material) => material.dispose());
      group.clear();
    }
  };
}
