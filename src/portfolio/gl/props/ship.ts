import * as THREE from "three";
import type { Machine, MachineMaterials } from "../machines/types";
import { buildOrnithopter } from "../machines/ornithopter";
import { buildBallista } from "../machines/ballista";

export interface Ship {
  group: THREE.Group;
  machines: Machine[];
  update(time: number, drive: number): void;
}

export function buildShip(m: MachineMaterials): Ship {
  const group = new THREE.Group();
  group.name = "Fantasy cargo caravel";

  const box = new THREE.BoxGeometry(1, 1, 1);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 8);
  const ropeCylinder = new THREE.CylinderGeometry(1, 1, 1, 6);
  const pinGeometry = new THREE.IcosahedronGeometry(1, 0);
  const up = new THREE.Vector3(0, 1, 0);

  function part(
    geometry: THREE.BufferGeometry,
    material: THREE.MeshStandardMaterial,
    position: [number, number, number],
    scale: [number, number, number],
    rotation: [number, number, number] = [0, 0, 0],
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.scale.set(...scale);
    mesh.rotation.set(...rotation);
    group.add(mesh);
    return mesh;
  }

  function beam(
    a: THREE.Vector3,
    b: THREE.Vector3,
    radius: number,
    material: THREE.MeshStandardMaterial,
    geometry: THREE.BufferGeometry = cylinder,
    parent: THREE.Object3D = group,
  ): THREE.Mesh {
    const direction = b.clone().sub(a);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.scale.set(radius, direction.length(), radius);
    mesh.quaternion.setFromUnitVectors(up, direction.normalize());
    parent.add(mesh);
    return mesh;
  }

  function hullSection(
    topY: number,
    bottomY: number,
    topWidths: number[],
    bottomWidths: number[],
    material: THREE.MeshStandardMaterial,
  ): void {
    const zs = [-3, -1.8, 0, 1.8, 3];
    const vertices: number[] = [];
    for (let i = 0; i < zs.length; i += 1) {
      vertices.push(-topWidths[i], topY, zs[i], topWidths[i], topY, zs[i]);
      vertices.push(-bottomWidths[i], bottomY, zs[i], bottomWidths[i], bottomY, zs[i]);
    }
    const indices: number[] = [];
    for (let i = 0; i < zs.length - 1; i += 1) {
      const n = i * 4;
      const q = n + 4;
      indices.push(n, q, n + 2, q, q + 2, n + 2);
      indices.push(n + 1, n + 3, q + 1, q + 1, n + 3, q + 3);
      indices.push(n + 2, q + 2, n + 3, q + 2, q + 3, n + 3);
    }
    indices.push(0, 2, 1, 1, 2, 3);
    const last = (zs.length - 1) * 4;
    indices.push(last, last + 1, last + 2, last + 1, last + 3, last + 2);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    group.add(new THREE.Mesh(geometry, material));
  }

  // Two bold faceted hull color bands: broad at the stern and pinched to a high bow.
  hullSection(0.9, 0.12, [1.02, 1.18, 1.22, 0.9, 0.04], [0.78, 0.92, 0.96, 0.65, 0.02], m.wood);
  hullSection(0.12, -0.72, [0.78, 0.92, 0.96, 0.65, 0.02], [0.25, 0.38, 0.42, 0.25, 0.01], m.woodDark);
  part(box, m.woodDark, [0, -0.75, -0.05], [0.16, 0.18, 5.45]);

  // Deck, perimeter bulwarks, stern quarterdeck, and chunky steps.
  part(box, m.wood, [0, 0.88, -0.08], [1.82, 0.12, 4.95]);
  for (const side of [-1, 1]) {
    part(box, m.woodDark, [side * 1.02, 1.08, -0.55], [0.13, 0.32, 3.9], [0, side * -0.045, 0]);
    for (const z of [-2.35, -1.35, -0.35, 0.65, 1.55]) {
      part(box, m.woodDark, [side * (1.04 - Math.max(z, 0) * 0.13), 1.25, z], [0.1, 0.42, 0.1]);
    }
  }
  part(box, m.woodDark, [0, 1.12, -2.72], [1.92, 0.5, 0.18]);
  part(box, m.wood, [0, 1.18, -2.18], [1.76, 0.5, 0.92]);
  part(box, m.woodDark, [0, 1.5, -2.5], [1.85, 0.18, 0.75]);
  part(box, m.wood, [0, 1.02, -1.58], [0.62, 0.16, 0.28]);
  part(box, m.wood, [0, 1.11, -1.76], [0.72, 0.16, 0.25]);

  // Keel continuation, curved rising stem, rudder, tiller, and lantern.
  beam(new THREE.Vector3(0, -0.62, 2.45), new THREE.Vector3(0, 0.28, 3.1), 0.1, m.woodDark);
  beam(new THREE.Vector3(0, 0.28, 3.1), new THREE.Vector3(0, 1.18, 3.18), 0.09, m.woodDark);
  part(box, m.woodDark, [0, 0.05, -3.12], [0.12, 0.9, 0.38], [-0.1, 0, 0]);
  beam(new THREE.Vector3(0, 0.55, -3.05), new THREE.Vector3(0, 1.18, -2.25), 0.055, m.woodDark);
  part(pinGeometry, m.brass, [0, 0.5, -3.12], [0.09, 0.09, 0.09]);
  part(box, m.brass, [0.7, 1.72, -2.65], [0.2, 0.3, 0.2]);
  part(box, m.woodDark, [0.7, 1.93, -2.65], [0.28, 0.08, 0.28]);

  // Mast, yard, sail, standing rigging, and pennant.
  const mast = part(new THREE.CylinderGeometry(0.1, 0.16, 1, 8), m.wood, [0, 3.18, 0.15], [1, 4.7, 1]);
  mast.name = "main mast";
  beam(new THREE.Vector3(-1.55, 4.45, 0.12), new THREE.Vector3(1.55, 4.45, 0.12), 0.075, m.wood);
  part(pinGeometry, m.brass, [0, 1.03, 0.15], [0.14, 0.14, 0.14]);

  const sailGeometry = new THREE.BufferGeometry();
  const sailVertices: number[] = [];
  const sailIndices: number[] = [];
  const columns = 4;
  const rows = 3;
  for (let y = 0; y <= rows; y += 1) {
    for (let x = 0; x <= columns; x += 1) {
      const u = x / columns;
      const v = y / rows;
      sailVertices.push(THREE.MathUtils.lerp(-1.48, 1.48, u), THREE.MathUtils.lerp(2.0, 4.38, v), 0.13 + Math.sin(u * Math.PI) * 0.18);
      if (x < columns && y < rows) {
        const n = y * (columns + 1) + x;
        sailIndices.push(n, n + 1, n + columns + 1, n + 1, n + columns + 2, n + columns + 1);
      }
    }
  }
  sailGeometry.setAttribute("position", new THREE.Float32BufferAttribute(sailVertices, 3));
  sailGeometry.setIndex(sailIndices);
  sailGeometry.computeVertexNormals();
  const sail = new THREE.Mesh(sailGeometry, m.sail);
  sail.name = "full square sail";
  group.add(sail);
  beam(new THREE.Vector3(0, 5.45, 0.15), new THREE.Vector3(0, 1.15, 2.75), 0.022, m.rope, ropeCylinder);
  beam(new THREE.Vector3(0, 5.45, 0.15), new THREE.Vector3(0, 1.5, -2.55), 0.022, m.rope, ropeCylinder);
  beam(new THREE.Vector3(-1.55, 4.45, 0.12), new THREE.Vector3(-0.9, 1.15, -1.55), 0.018, m.rope, ropeCylinder);
  beam(new THREE.Vector3(1.55, 4.45, 0.12), new THREE.Vector3(0.9, 1.15, -1.55), 0.018, m.rope, ropeCylinder);

  const pennantGeometry = new THREE.BufferGeometry();
  pennantGeometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, -0.42, 0, 0.85, -0.22, 0], 3));
  pennantGeometry.computeVertexNormals();
  const pennant = new THREE.Mesh(pennantGeometry, m.canvas);
  pennant.position.set(0, 5.5, 0.15);
  group.add(pennant);

  // Cargo pallets and the two hero machines.
  part(box, m.wood, [0, 1.04, 1.45], [1.65, 0.18, 1.25]);
  part(box, m.wood, [0, 1.04, -0.82], [1.55, 0.18, 1.45]);
  const ornithopter = buildOrnithopter(m);
  ornithopter.group.scale.setScalar(0.46);
  ornithopter.group.position.set(0, 1.28, 1.35);
  ornithopter.group.rotation.y = Math.PI;
  group.add(ornithopter.group);
  const ballista = buildBallista(m);
  ballista.group.scale.setScalar(0.4);
  ballista.group.position.set(0, 1.18, -0.95);
  group.add(ballista.group);
  const machines: Machine[] = [ornithopter, ballista];
  for (const z of [1.1, 1.65, -0.65, -1.2]) {
    beam(new THREE.Vector3(-0.82, 1.17, z), new THREE.Vector3(0.82, 1.72, z), 0.018, m.rope, ropeCylinder);
  }

  // Large, sparse supporting cargo: two barrels, two framed crates, and a coil.
  for (const [x, z] of [[-0.72, 2.25], [0.73, -1.88]] as const) {
    part(new THREE.CylinderGeometry(0.28, 0.32, 0.58, 8), m.wood, [x, 1.25, z], [1, 1, 1]);
    for (const y of [1.02, 1.48]) part(new THREE.CylinderGeometry(0.33, 0.33, 0.06, 8), m.woodDark, [x, y, z], [1, 1, 1]);
  }
  for (const [x, z] of [[0.72, 2.2], [-0.7, -1.82]] as const) {
    part(box, m.wood, [x, 1.25, z], [0.55, 0.55, 0.55], [0, 0.12, 0]);
    part(box, m.woodDark, [x, 1.25, z], [0.62, 0.1, 0.62], [0, 0.12, 0]);
  }
  part(new THREE.TorusGeometry(0.24, 0.045, 6, 10), m.rope, [-0.72, 1.04, 0.1], [1, 1, 1], [Math.PI / 2, 0, 0]);

  const sailPositions = sailGeometry.getAttribute("position") as THREE.BufferAttribute;
  function update(time: number, drive: number): void {
    const pulse = time === 0 ? 1 : 1 + Math.sin(time * 1.15) * 0.055;
    for (let i = 0; i < sailPositions.count; i += 1) {
      const u = (i % (columns + 1)) / columns;
      sailPositions.setZ(i, 0.13 + Math.sin(u * Math.PI) * 0.18 * pulse);
    }
    sailPositions.needsUpdate = true;
    sailGeometry.computeVertexNormals();
    pennant.rotation.y = time === 0 ? 0.08 : Math.sin(time * 3) * 0.2;
    machines.forEach((machine) => machine.update(time, drive));
  }

  update(0, 0.5);
  return { group, machines, update };
}
