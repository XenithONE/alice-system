import * as THREE from "three";
import type { MachineMaterials } from "../machines/types";

export interface Placement {
  x: number;
  z: number;
  y: number;
  scale: number;
  rot: number;
}

export interface Flora {
  group: THREE.Group;
  dispose(): void;
}

interface Pose {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  rx: number;
  ry: number;
  rz: number;
}

export function buildFlora(
  placements: Placement[],
  m: MachineMaterials,
  rand: () => number,
): Flora {
  const group = new THREE.Group();
  group.name = "flora";

  const dummy = new THREE.Object3D();
  const matrix = new THREE.Matrix4();

  const foliageMats: THREE.MeshStandardMaterial[] = [
    new THREE.MeshStandardMaterial({
      color: 0x4fae55,
      flatShading: true,
      roughness: 1,
      metalness: 0,
    }),
    new THREE.MeshStandardMaterial({
      color: 0x2f7d46,
      flatShading: true,
      roughness: 1,
      metalness: 0,
    }),
    new THREE.MeshStandardMaterial({
      color: 0x69c95e,
      flatShading: true,
      roughness: 1,
      metalness: 0,
    }),
  ];
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x8b909b,
    flatShading: true,
    roughness: 1,
    metalness: 0,
  });
  const grassMat = new THREE.MeshStandardMaterial({
    color: 0x7cc64e,
    flatShading: true,
    roughness: 1,
    metalness: 0,
  });

  const trunkGeo = new THREE.CylinderGeometry(0.09, 0.13, 1.1, 6);
  const coneGeo = new THREE.ConeGeometry(0.6, 0.9, 7);
  const rockGeo = new THREE.IcosahedronGeometry(0.4, 0);
  const bladeGeo = new THREE.ConeGeometry(0.05, 0.3, 4);

  const trunksWood: Pose[] = [];
  const trunksDark: Pose[] = [];
  const foliageByGreen: Pose[][] = [[], [], []];
  const rocks: Pose[] = [];
  const blades: Pose[] = [];

  for (let pi = 0; pi < placements.length; pi++) {
    const p = placements[pi]!;
    // Keep the scatter disc inside the island's grass crown (~1.0x scale) and sand
    // skirt (1.22x). The old 1.6x flung ~a quarter of the props out over open water.
    const radius = p.scale * 0.95;
    const treeCount = 2 + Math.floor(rand() * 3);
    const rockCount = 2 + Math.floor(rand() * 2);
    const tuftCount = 4 + Math.floor(rand() * 3);

    for (let t = 0; t < treeCount; t++) {
      const ang = rand() * Math.PI * 2;
      const dist = rand() * radius;
      const x = p.x + Math.cos(ang) * dist;
      const z = p.z + Math.sin(ang) * dist;
      const y = p.y;
      const s = p.scale * (0.7 + rand() * 0.6);
      const rotY = rand() * Math.PI * 2;
      const tiltX = (rand() - 0.5) * 0.22;
      const tiltZ = (rand() - 0.5) * 0.22;
      const useDark = rand() < 0.55;
      const green = Math.min(2, Math.floor(rand() * 3));
      const coneCount = rand() < 0.45 ? 1 : 2;

      const trunkPose: Pose = {
        x,
        y: y + 0.55 * s,
        z,
        sx: s,
        sy: s,
        sz: s,
        rx: tiltX,
        ry: rotY,
        rz: tiltZ,
      };
      if (useDark) {
        trunksDark.push(trunkPose);
      } else {
        trunksWood.push(trunkPose);
      }

      for (let c = 0; c < coneCount; c++) {
        const shrink = 1 - c * 0.18;
        foliageByGreen[green]!.push({
          x,
          y: y + (0.95 + c * 0.48) * s,
          z,
          sx: s * shrink,
          sy: s * (0.95 - c * 0.08),
          sz: s * shrink,
          rx: tiltX * 0.45,
          ry: rotY + c * 0.55,
          rz: tiltZ * 0.45,
        });
      }
    }

    for (let r = 0; r < rockCount; r++) {
      const ang = rand() * Math.PI * 2;
      const dist = rand() * radius;
      const s = p.scale * (0.7 + rand() * 0.6);
      const sx = s * (0.65 + rand() * 0.7);
      const sy = s * (0.45 + rand() * 0.55);
      const sz = s * (0.65 + rand() * 0.7);
      rocks.push({
        x: p.x + Math.cos(ang) * dist,
        y: p.y - 0.14 * sy,
        z: p.z + Math.sin(ang) * dist,
        sx,
        sy,
        sz,
        rx: rand() * Math.PI,
        ry: rand() * Math.PI * 2,
        rz: rand() * Math.PI,
      });
    }

    for (let g = 0; g < tuftCount; g++) {
      const ang = rand() * Math.PI * 2;
      const dist = rand() * radius;
      const cx = p.x + Math.cos(ang) * dist;
      const cz = p.z + Math.sin(ang) * dist;
      const s = p.scale * (0.7 + rand() * 0.6);
      for (let b = 0; b < 3; b++) {
        const bladeAng = (b / 3) * Math.PI * 2 + (rand() - 0.5) * 0.5;
        const spread = 0.045 * s;
        blades.push({
          x: cx + Math.cos(bladeAng) * spread,
          y: p.y + 0.15 * s,
          z: cz + Math.sin(bladeAng) * spread,
          sx: s * (0.75 + rand() * 0.45),
          sy: s * (0.8 + rand() * 0.5),
          sz: s * (0.75 + rand() * 0.45),
          rx: (rand() - 0.5) * 0.4,
          ry: bladeAng,
          rz: (rand() - 0.5) * 0.4,
        });
      }
    }
  }

  function writeInstances(mesh: THREE.InstancedMesh, poses: Pose[]): void {
    for (let i = 0; i < poses.length; i++) {
      const pose = poses[i]!;
      dummy.position.set(pose.x, pose.y, pose.z);
      dummy.rotation.set(pose.rx, pose.ry, pose.rz);
      dummy.scale.set(pose.sx, pose.sy, pose.sz);
      dummy.updateMatrix();
      matrix.copy(dummy.matrix);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  const meshes: THREE.InstancedMesh[] = [];

  function addMesh(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    poses: Pose[],
    castShadow: boolean,
  ): void {
    if (poses.length === 0) return;
    const mesh = new THREE.InstancedMesh(geo, mat, poses.length);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    writeInstances(mesh, poses);
    group.add(mesh);
    meshes.push(mesh);
  }

  addMesh(trunkGeo, m.wood, trunksWood, true);
  addMesh(trunkGeo, m.woodDark, trunksDark, true);
  for (let g = 0; g < 3; g++) {
    addMesh(coneGeo, foliageMats[g]!, foliageByGreen[g]!, true);
  }
  addMesh(rockGeo, rockMat, rocks, true);
  addMesh(bladeGeo, grassMat, blades, false);

  return {
    group,
    dispose(): void {
      for (let i = 0; i < meshes.length; i++) {
        group.remove(meshes[i]!);
      }
      trunkGeo.dispose();
      coneGeo.dispose();
      rockGeo.dispose();
      bladeGeo.dispose();
      for (let i = 0; i < foliageMats.length; i++) {
        foliageMats[i]!.dispose();
      }
      rockMat.dispose();
      grassMat.dispose();
    },
  };
}
