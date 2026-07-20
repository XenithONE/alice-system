import * as THREE from "three";
import type { Machine, MachineMaterials } from "./types";

export function buildOrnithopter(m: MachineMaterials): Machine {
  const group = new THREE.Group();
  group.name = "Leonardo Ornithopter";

  const keelGroup = new THREE.Group();
  const wingL = new THREE.Group();
  const wingR = new THREE.Group();
  const tailGroup = new THREE.Group();
  const riggingGroup = new THREE.Group();
  keelGroup.name = "keelGroup";
  wingL.name = "wingL";
  wingR.name = "wingR";
  tailGroup.name = "tailGroup";
  riggingGroup.name = "riggingGroup";
  group.add(keelGroup, wingL, wingR, tailGroup, riggingGroup);

  const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 8);
  const fineCylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
  const sphere = new THREE.SphereGeometry(1, 10, 7);
  const box = new THREE.BoxGeometry(1, 1, 1, 2, 1, 2);
  const pointA = new THREE.Vector3();
  const pointB = new THREE.Vector3();
  const midpoint = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);

  function beam(
    parent: THREE.Object3D,
    a: THREE.Vector3,
    b: THREE.Vector3,
    radius: number,
    material: THREE.Material,
    geometry = unitCylinder,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    pointA.copy(a);
    pointB.copy(b);
    midpoint.addVectors(pointA, pointB).multiplyScalar(0.5);
    direction.subVectors(pointB, pointA);
    mesh.position.copy(midpoint);
    mesh.quaternion.setFromUnitVectors(yAxis, direction.clone().normalize());
    mesh.scale.set(radius, direction.length(), radius);
    parent.add(mesh);
    return mesh;
  }

  function fitting(parent: THREE.Object3D, position: THREE.Vector3, radius = 0.045, iron = false): THREE.Mesh {
    const mesh = new THREE.Mesh(sphere, iron ? m.iron : m.brass);
    mesh.position.copy(position);
    mesh.scale.setScalar(radius);
    parent.add(mesh);
    return mesh;
  }

  // Long, subtly faceted central keel and its forged straps.
  const keel = new THREE.Mesh(box, m.woodDark);
  keel.position.set(0, 0, 0.04);
  keel.scale.set(0.15, 0.13, 2.55);
  keel.rotation.z = 0.025;
  keelGroup.add(keel);
  const keelCap = new THREE.Mesh(box, m.wood);
  keelCap.position.set(0, 0.095, -0.04);
  keelCap.scale.set(0.105, 0.075, 2.38);
  keelCap.rotation.z = -0.025;
  keelGroup.add(keelCap);
  [-0.72, 0.02, 0.69].forEach((z) => {
    const strap = new THREE.Mesh(box, m.iron);
    strap.position.set(0, 0.005, z);
    strap.scale.set(0.185, 0.17, 0.045);
    keelGroup.add(strap);
    fitting(keelGroup, new THREE.Vector3(0.19, 0.01, z), 0.025, true);
    fitting(keelGroup, new THREE.Vector3(-0.19, 0.01, z), 0.025, true);
  });

  // Pilot cradle: laminated curved ribs, cross rails, and a parchment sling.
  const cradleZ = [-0.48, -0.2, 0.08, 0.36];
  cradleZ.forEach((z, ribIndex) => {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i += 1) {
      const t = -1 + i / 3;
      points.push(new THREE.Vector3(t * 0.37, 0.13 + 0.23 * t * t, z + 0.015 * ribIndex));
    }
    for (let i = 0; i < points.length - 1; i += 1) beam(keelGroup, points[i], points[i + 1], 0.025, m.woodDark);
  });
  [-0.34, 0.34].forEach((x) => beam(keelGroup, new THREE.Vector3(x, 0.34, -0.48), new THREE.Vector3(x, 0.34, 0.42), 0.024, m.wood));
  const slingGeometry = new THREE.BufferGeometry();
  slingGeometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -0.31, 0.27, -0.44, 0.31, 0.27, -0.44, -0.28, 0.23, 0.36,
    0.31, 0.27, -0.44, 0.28, 0.23, 0.36, -0.28, 0.23, 0.36,
  ], 3));
  slingGeometry.computeVertexNormals();
  keelGroup.add(new THREE.Mesh(slingGeometry, m.canvas));

  // Foot bar and paired brass stirrups.
  beam(keelGroup, new THREE.Vector3(-0.42, -0.02, -0.68), new THREE.Vector3(0.42, -0.02, -0.68), 0.025, m.wood);
  [-0.27, 0.27].forEach((x) => {
    beam(keelGroup, new THREE.Vector3(x, -0.02, -0.68), new THREE.Vector3(x, -0.22, -0.76), 0.014, m.brass, fineCylinder);
    beam(keelGroup, new THREE.Vector3(x - 0.09, -0.22, -0.76), new THREE.Vector3(x + 0.09, -0.22, -0.76), 0.014, m.brass, fineCylinder);
    beam(keelGroup, new THREE.Vector3(x - 0.09, -0.22, -0.76), new THREE.Vector3(x - 0.06, -0.1, -0.72), 0.014, m.brass, fineCylinder);
    beam(keelGroup, new THREE.Vector3(x + 0.09, -0.22, -0.76), new THREE.Vector3(x + 0.06, -0.1, -0.72), 0.014, m.brass, fineCylinder);
  });

  // Front windlass, ratchet, crank and hauling line.
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.32, 16), m.wood);
  drum.position.set(0, 0.18, -0.89);
  drum.rotation.z = Math.PI / 2;
  keelGroup.add(drum);
  const axle = beam(keelGroup, new THREE.Vector3(-0.24, 0.18, -0.89), new THREE.Vector3(0.28, 0.18, -0.89), 0.025, m.brass, fineCylinder);
  axle.name = "windlass axle";
  beam(keelGroup, new THREE.Vector3(0.28, 0.18, -0.89), new THREE.Vector3(0.39, 0.31, -0.89), 0.018, m.brass, fineCylinder);
  beam(keelGroup, new THREE.Vector3(0.39, 0.31, -0.89), new THREE.Vector3(0.52, 0.31, -0.89), 0.025, m.wood, fineCylinder);
  for (let i = 0; i < 10; i += 1) {
    const angle = (i / 10) * Math.PI * 2;
    fitting(keelGroup, new THREE.Vector3(-0.18, 0.18 + Math.sin(angle) * 0.14, -0.89 + Math.cos(angle) * 0.14), 0.018);
  }

  // A-frame mast above the shoulder pivot.
  beam(keelGroup, new THREE.Vector3(-0.3, 0.08, -0.08), new THREE.Vector3(0, 0.88, 0.02), 0.035, m.woodDark);
  beam(keelGroup, new THREE.Vector3(0.3, 0.08, -0.08), new THREE.Vector3(0, 0.88, 0.02), 0.035, m.woodDark);
  beam(keelGroup, new THREE.Vector3(-0.3, 0.08, -0.08), new THREE.Vector3(0.3, 0.08, -0.08), 0.032, m.wood);
  fitting(keelGroup, new THREE.Vector3(0, 0.88, 0.02), 0.055);

  type WingAssembly = { outer: THREE.Group };
  function buildWing(side: -1 | 1, root: THREE.Group): WingAssembly {
    root.position.set(side * 0.16, 0.13, -0.05);
    const outer = new THREE.Group();
    outer.name = side < 0 ? "wingLOuter" : "wingROuter";
    outer.position.set(side * 0.94, 0, 0.08);
    root.add(outer);

    const innerSign = side;
    beam(root, new THREE.Vector3(0, 0, 0), new THREE.Vector3(innerSign * 0.94, 0, 0.08), 0.045, m.wood);
    beam(root, new THREE.Vector3(0.04 * innerSign, -0.015, 0.08), new THREE.Vector3(innerSign * 0.9, -0.04, 0.44), 0.026, m.woodDark);
    beam(outer, new THREE.Vector3(0, 0, 0), new THREE.Vector3(innerSign * 1.03, -0.03, 0.3), 0.038, m.wood);
    beam(outer, new THREE.Vector3(0, -0.04, 0.36), new THREE.Vector3(innerSign * 0.98, -0.08, 0.62), 0.022, m.woodDark);

    function membrane(parent: THREE.Object3D, start: number, end: number, trailingStart: number, trailingEnd: number): void {
      const vertices: number[] = [];
      const indices: number[] = [];
      const steps = 6;
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        const x = innerSign * THREE.MathUtils.lerp(start, end, t);
        const trailing = THREE.MathUtils.lerp(trailingStart, trailingEnd, t);
        const camber = Math.sin(t * Math.PI) * 0.045;
        vertices.push(x, camber, THREE.MathUtils.lerp(0, 0.3, t));
        vertices.push(x, camber - 0.02, trailing);
        if (i < steps) {
          const n = i * 2;
          indices.push(n, n + 1, n + 2, n + 2, n + 1, n + 3);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      parent.add(new THREE.Mesh(geometry, m.canvas));
    }
    membrane(root, 0.06, 0.91, 0.14, 0.45);
    membrane(outer, 0.03, 1.0, 0.37, 0.64);

    // Six bowed ribs across the ruled canvas.
    for (let rib = 0; rib < 6; rib += 1) {
      const u = (rib + 0.35) / 6;
      const parent = u < 0.52 ? root : outer;
      const localU = u < 0.52 ? u / 0.52 : (u - 0.52) / 0.48;
      const span = u < 0.52 ? 0.9 * localU : 0.98 * localU;
      const leadZ = u < 0.52 ? 0.08 * localU : 0.3 * localU;
      const trailZ = u < 0.52 ? THREE.MathUtils.lerp(0.14, 0.45, localU) : THREE.MathUtils.lerp(0.37, 0.64, localU);
      const p0 = new THREE.Vector3(innerSign * span, 0, leadZ);
      const p1 = new THREE.Vector3(innerSign * span, 0.055, (leadZ + trailZ) * 0.5);
      const p2 = new THREE.Vector3(innerSign * span, -0.02, trailZ);
      beam(parent, p0, p1, 0.013, m.woodDark);
      beam(parent, p1, p2, 0.012, m.woodDark);
      fitting(parent, p0, 0.023);
    }
    fitting(root, new THREE.Vector3(0, 0, 0), 0.065, true);
    fitting(root, new THREE.Vector3(innerSign * 0.94, 0, 0.08), 0.052);
    fitting(outer, new THREE.Vector3(innerSign * 1.03, -0.03, 0.3), 0.035);
    return { outer };
  }

  const left = buildWing(-1, wingL);
  const right = buildWing(1, wingR);

  // Static-looking rigging is rebuilt as stretchable cylinders; their length hint
  // follows the mechanism while their upper anchor remains at the masthead.
  const riggingRopes: THREE.Mesh[] = [];
  [-1, 1].forEach((side) => {
    [0.58, 1.1, 1.62].forEach((span, index) => {
      const rope = beam(riggingGroup, new THREE.Vector3(0, 0.86, 0.02), new THREE.Vector3(side * span, 0.12 - index * 0.025, 0.02 + index * 0.13), 0.009, m.rope, fineCylinder);
      riggingRopes.push(rope);
      const bucklePoint = new THREE.Vector3(side * span * 0.82, 0.24, 0.02 + index * 0.11);
      beam(riggingGroup, bucklePoint.clone().add(new THREE.Vector3(0, -0.045, 0)), bucklePoint.clone().add(new THREE.Vector3(0, 0.045, 0)), 0.016, m.brass, fineCylinder);
    });
  });
  beam(riggingGroup, new THREE.Vector3(0, 0.12, -0.89), new THREE.Vector3(0, 0.82, 0.02), 0.011, m.rope, fineCylinder);

  // Cruciform tail with wooden perimeter, parchment planes and hinge hardware.
  tailGroup.position.set(0, 0.02, 1.17);
  beam(tailGroup, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.02, 0.33), 0.035, m.wood);
  const tailH = new THREE.Mesh(new THREE.BufferGeometry(), m.canvas);
  const tailHGeometry = new THREE.BufferGeometry();
  tailHGeometry.setAttribute("position", new THREE.Float32BufferAttribute([
    0, 0, 0.12, -0.48, 0, 0.4, 0, 0.015, 0.34,
    0, 0, 0.12, 0, 0.015, 0.34, 0.48, 0, 0.4,
  ], 3));
  tailHGeometry.computeVertexNormals();
  tailH.geometry = tailHGeometry;
  tailGroup.add(tailH);
  beam(tailGroup, new THREE.Vector3(-0.48, 0, 0.4), new THREE.Vector3(0.48, 0, 0.4), 0.018, m.woodDark);
  beam(tailGroup, new THREE.Vector3(0, 0, 0.12), new THREE.Vector3(-0.48, 0, 0.4), 0.016, m.woodDark);
  beam(tailGroup, new THREE.Vector3(0, 0, 0.12), new THREE.Vector3(0.48, 0, 0.4), 0.016, m.woodDark);
  const finGeometry = new THREE.BufferGeometry();
  finGeometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0.12, 0, 0.46, 0.35, 0, 0, 0.42], 3));
  finGeometry.computeVertexNormals();
  tailGroup.add(new THREE.Mesh(finGeometry, m.canvas));
  beam(tailGroup, new THREE.Vector3(0, 0, 0.12), new THREE.Vector3(0, 0.46, 0.35), 0.018, m.woodDark);
  beam(tailGroup, new THREE.Vector3(0, 0.46, 0.35), new THREE.Vector3(0, 0, 0.42), 0.018, m.woodDark);
  const hinge = new THREE.Mesh(box, m.iron);
  hinge.position.set(0, 0.01, 0.1);
  hinge.scale.set(0.16, 0.045, 0.09);
  tailGroup.add(hinge);
  fitting(tailGroup, new THREE.Vector3(-0.08, 0.04, 0.1), 0.023);
  fitting(tailGroup, new THREE.Vector3(0.08, 0.04, 0.1), 0.023);
  const riggingRestLengths = riggingRopes.map((rope) => rope.scale.y);

  function update(time: number, drive: number): void {
    const engagement = 0.25 + 0.75 * THREE.MathUtils.clamp(drive, 0, 1);
    const phase = time === 0 ? -0.78 : time * Math.PI * 3.2 - 0.78;
    const stroke = Math.sin(phase) * 0.45 * engagement;
    wingL.rotation.z = stroke - 0.025;
    wingR.rotation.z = -stroke - 0.012;
    const delayed = Math.sin(phase - 0.35);
    const upstrokeFold = Math.max(0, delayed) * 0.2 * engagement;
    left.outer.rotation.z = -0.08 + upstrokeFold;
    right.outer.rotation.z = 0.08 - upstrokeFold;
    left.outer.rotation.y = delayed * 0.045 * engagement;
    right.outer.rotation.y = -delayed * 0.045 * engagement;
    tailGroup.rotation.x = 0.025 + Math.sin(phase * 0.5 + 0.6) * 0.055 * engagement;
    riggingRopes.forEach((rope, index) => {
      rope.scale.y = riggingRestLengths[index] * (1 + Math.sin(phase + index * 0.18) * 0.003 * engagement);
    });
    group.rotation.z = Math.sin(time * 0.55) * 0.02;
    group.rotation.x = Math.sin(time * 0.31 + 0.4) * 0.008;
  }

  update(0, 0);
  return { group, update };
}
