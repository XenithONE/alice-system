import * as THREE from "three";
import type { Machine, MachineMaterials } from "./types";

export function buildBallista(m: MachineMaterials): Machine {
  const group = new THREE.Group();
  group.name = "ballista";

  const box = new THREE.BoxGeometry(1, 1, 1);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
  const ropeCylinder = new THREE.CylinderGeometry(1, 1, 1, 8);
  const sphere = new THREE.SphereGeometry(1, 10, 7);
  const torus = new THREE.TorusGeometry(1, 0.12, 6, 20);
  const cone = new THREE.ConeGeometry(1, 1, 10);
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
    return mesh;
  }

  function beamBetween(
    parent: THREE.Object3D,
    a: THREE.Vector3,
    b: THREE.Vector3,
    radius: number,
    material: THREE.MeshStandardMaterial,
    geometry: THREE.BufferGeometry = cylinder,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    const direction = new THREE.Vector3().subVectors(b, a);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.scale.set(radius, direction.length(), radius);
    mesh.quaternion.setFromUnitVectors(up, direction.normalize());
    parent.add(mesh);
    return mesh;
  }

  function pin(parent: THREE.Object3D, x: number, y: number, z: number, r = 0.025): void {
    parent.add(part(sphere, m.brass, [x, y, z], [r, r, r]));
  }

  const stockGroup = new THREE.Group();
  stockGroup.name = "stockGroup";
  const stockY = 0.66;
  for (const x of [-0.15, 0.15]) {
    stockGroup.add(part(box, m.wood, [x, stockY, -0.05], [0.22, 0.18, 3.5]));
    stockGroup.add(part(box, m.woodDark, [x, stockY, 1.73], [0.25, 0.21, 0.12]));
    stockGroup.add(part(box, m.woodDark, [x, stockY, -1.82], [0.25, 0.21, 0.18], [0, x * 0.6, 0]));
  }
  for (const z of [-1.35, -0.55, 0.25, 1.05]) {
    stockGroup.add(part(box, m.woodDark, [0, stockY - 0.02, z], [0.42, 0.13, 0.11]));
  }
  stockGroup.add(part(box, m.woodDark, [0, stockY + 0.1, 0], [0.075, 0.035, 3.1]));
  for (const z of [-1.12, 0, 1.12]) {
    stockGroup.add(part(box, m.iron, [-0.22, stockY, z], [0.025, 0.22, 0.09]));
    stockGroup.add(part(box, m.iron, [0.22, stockY, z], [0.025, 0.22, 0.09]));
    stockGroup.add(part(box, m.iron, [0, stockY - 0.1, z], [0.46, 0.025, 0.09]));
    pin(stockGroup, -0.235, stockY + 0.06, z);
    pin(stockGroup, 0.235, stockY + 0.06, z);
  }
  group.add(stockGroup);

  const frameGroup = new THREE.Group();
  frameGroup.name = "frameGroup";
  frameGroup.position.z = 1.05;
  const pivotX = 0.42;
  for (const x of [-0.58, 0.58]) {
    frameGroup.add(part(box, m.woodDark, [x, 0.85, 0], [0.18, 1.18, 0.24]));
    frameGroup.add(part(box, m.iron, [x, 0.58, 0.13], [0.21, 0.07, 0.025]));
    frameGroup.add(part(box, m.iron, [x, 1.1, 0.13], [0.21, 0.07, 0.025]));
    pin(frameGroup, x, 0.58, 0.17);
    pin(frameGroup, x, 1.1, 0.17);
  }
  frameGroup.add(part(box, m.woodDark, [0, 1.37, 0], [1.35, 0.18, 0.25]));
  frameGroup.add(part(box, m.woodDark, [0, 0.32, 0], [1.35, 0.18, 0.25]));
  beamBetween(frameGroup, new THREE.Vector3(-0.56, 0.38, -0.13), new THREE.Vector3(0.56, 1.3, -0.13), 0.045, m.wood);
  beamBetween(frameGroup, new THREE.Vector3(0.56, 0.38, -0.14), new THREE.Vector3(-0.56, 1.3, -0.14), 0.045, m.wood);

  function buildSkein(side: number): THREE.Group {
    const skein = new THREE.Group();
    skein.name = side < 0 ? "skeinL" : "skeinR";
    skein.position.set(side * pivotX, 0.84, 0);
    for (const x of [-0.045, 0, 0.045]) {
      beamBetween(skein, new THREE.Vector3(x, -0.36, 0), new THREE.Vector3(-x, 0.36, 0), 0.025, m.rope, ropeCylinder);
    }
    for (let i = 0; i < 5; i++) {
      const ring = part(torus, m.rope, [0, -0.25 + i * 0.125, 0], [0.07, 0.07, 0.07], [Math.PI / 2, i * 0.38, 0]);
      skein.add(ring);
    }
    for (const y of [-0.39, 0.39]) {
      skein.add(part(cylinder, m.brass, [0, y, 0], [0.1, 0.028, 0.1]));
      skein.add(part(cylinder, m.iron, [0, y + Math.sign(y) * 0.025, 0], [0.052, 0.035, 0.052]));
    }
    return skein;
  }
  const skeinL = buildSkein(-1);
  const skeinR = buildSkein(1);
  frameGroup.add(skeinL, skeinR);

  function buildArm(side: number): { arm: THREE.Group; tip: THREE.Object3D } {
    const arm = new THREE.Group();
    arm.name = side < 0 ? "armL" : "armR";
    arm.position.set(side * pivotX, 0.84, 0);
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= 7; i++) {
      const t = i / 7;
      points.push(new THREE.Vector3(side * 1.08 * t, 0.07 * Math.sin(t * Math.PI), 0.22 * t * t));
    }
    for (let i = 0; i < 7; i++) {
      const t = i / 7;
      const material = i % 2 === 0 ? m.wood : m.woodDark;
      beamBetween(arm, points[i], points[i + 1], 0.064 - t * 0.025, material);
      if (i === 1 || i === 3 || i === 5) {
        const band = part(torus, m.rope, [0, 0, 0], [0.055, 0.055, 0.055]);
        band.position.copy(points[i + 1]);
        band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), points[i + 1].clone().sub(points[i]).normalize());
        arm.add(band);
      }
    }
    beamBetween(arm, points[7].clone().add(new THREE.Vector3(0, -0.035, 0)), points[7].clone().add(new THREE.Vector3(0, 0.035, 0)), 0.034, m.iron);
    arm.add(part(box, m.iron, [side * 0.06, 0, 0], [0.14, 0.11, 0.09]));
    pin(arm, side * 0.12, 0, 0.07, 0.022);
    const tip = new THREE.Object3D();
    tip.name = side < 0 ? "tipAnchorL" : "tipAnchorR";
    tip.position.copy(points[7]);
    arm.add(tip);
    return { arm, tip };
  }
  const left = buildArm(-1);
  const right = buildArm(1);
  frameGroup.add(left.arm, right.arm);
  group.add(frameGroup);

  const sliderGroup = new THREE.Group();
  sliderGroup.name = "sliderGroup";
  sliderGroup.add(part(box, m.woodDark, [0, 0, 0], [0.25, 0.12, 0.32]));
  sliderGroup.add(part(box, m.iron, [0, 0.075, 0], [0.16, 0.025, 0.26]));
  sliderGroup.add(part(cylinder, m.brass, [0, 0.13, 0.08], [0.075, 0.06, 0.075], [0, 0, Math.PI / 2]));
  sliderGroup.add(part(box, m.iron, [0, -0.12, -0.05], [0.035, 0.22, 0.055], [0.28, 0, 0]));
  pin(sliderGroup, -0.09, 0.11, -0.08, 0.02);
  pin(sliderGroup, 0.09, 0.11, -0.08, 0.02);
  const bolt = new THREE.Group();
  bolt.name = "bolt";
  bolt.position.set(0, 0.17, 0.42);
  bolt.add(part(cylinder, m.wood, [0, 0, 0], [0.018, 0.95, 0.018], [Math.PI / 2, 0, 0]));
  bolt.add(part(cone, m.iron, [0, 0, 0.535], [0.045, 0.13, 0.045], [Math.PI / 2, 0, 0]));
  for (let i = 0; i < 3; i++) {
    const angle = i * Math.PI * 2 / 3;
    const fin = part(box, m.canvas, [Math.cos(angle) * 0.028, Math.sin(angle) * 0.028, -0.38], [0.008, 0.085, 0.17], [0, 0, angle]);
    bolt.add(fin);
  }
  sliderGroup.add(bolt);
  group.add(sliderGroup);

  const stringGroup = new THREE.Group();
  stringGroup.name = "stringGroup";
  const stringLeft = part(ropeCylinder, m.rope, [0, 0, 0], [0.012, 1, 0.012]);
  const stringRight = part(ropeCylinder, m.rope, [0, 0, 0], [0.012, 1, 0.012]);
  stringGroup.add(stringLeft, stringRight);
  group.add(stringGroup);

  const windlassGroup = new THREE.Group();
  windlassGroup.name = "windlassGroup";
  windlassGroup.position.set(0, 0.85, -1.35);
  const crank = new THREE.Group();
  crank.name = "crank";
  crank.add(part(cylinder, m.wood, [0, 0, 0], [0.13, 0.34, 0.13], [0, 0, Math.PI / 2]));
  crank.add(part(cylinder, m.iron, [0, 0, 0], [0.035, 0.62, 0.035], [0, 0, Math.PI / 2]));
  for (const x of [-0.22, 0.22]) {
    crank.add(part(cylinder, m.woodDark, [x, 0.18, 0], [0.025, 0.42, 0.025]));
    crank.add(part(cylinder, m.woodDark, [x, -0.18, 0], [0.025, 0.42, 0.025]));
    pin(crank, x, 0.39, 0, 0.035);
    pin(crank, x, -0.39, 0, 0.035);
  }
  windlassGroup.add(crank);
  windlassGroup.add(part(box, m.woodDark, [-0.31, 0, 0], [0.1, 0.56, 0.18]));
  windlassGroup.add(part(box, m.woodDark, [0.31, 0, 0], [0.1, 0.56, 0.18]));
  const drawRope = part(ropeCylinder, m.rope, [0, 0, 0], [0.011, 1, 0.011]);
  windlassGroup.add(drawRope);
  group.add(windlassGroup);

  const wheelsGroup = new THREE.Group();
  wheelsGroup.name = "wheelsGroup";
  function wheel(x: number, z: number, radius: number): void {
    const wheelGroup = new THREE.Group();
    wheelGroup.position.set(x, radius, z);
    wheelGroup.rotation.y = Math.PI / 2;
    wheelGroup.add(part(torus, m.woodDark, [0, 0, 0], [radius, radius, radius]));
    wheelGroup.add(part(torus, m.iron, [0, 0, 0], [radius * 1.03, radius * 1.03, radius * 1.03]));
    wheelGroup.children[1].scale.z *= 0.48;
    wheelGroup.add(part(cylinder, m.woodDark, [0, 0, 0], [0.07, 0.1, 0.07], [Math.PI / 2, 0, 0]));
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      beamBetween(wheelGroup, new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(a) * radius * 0.88, Math.sin(a) * radius * 0.88, 0), 0.018, m.wood);
    }
    pin(wheelGroup, 0, 0, 0.07, 0.04);
    wheelsGroup.add(wheelGroup);
  }
  for (const z of [-1.05, 0.62]) {
    wheelsGroup.add(part(cylinder, m.iron, [0, 0.31, z], [0.035, 1.55, 0.035], [0, 0, Math.PI / 2]));
    wheel(-0.72, z, 0.31);
    wheel(0.72, z, 0.31);
  }
  wheel(-0.56, -0.2, 0.23);
  wheel(0.56, -0.2, 0.23);
  for (const x of [-0.34, 0.34]) {
    wheelsGroup.add(part(box, m.wood, [x, 0.28, -0.2], [0.09, 0.1, 2.55]));
    beamBetween(wheelsGroup, new THREE.Vector3(x * 0.45, 0.6, -0.85), new THREE.Vector3(x * 1.8, 0.12, -0.85), 0.055, m.woodDark);
    beamBetween(wheelsGroup, new THREE.Vector3(x * 0.45, 0.6, 0.65), new THREE.Vector3(x * 1.8, 0.12, 0.65), 0.055, m.woodDark);
  }
  for (const z of [-1.05, -0.2, 0.62]) {
    wheelsGroup.add(part(box, m.woodDark, [0, 0.34, z], [0.85, 0.11, 0.13]));
    pin(wheelsGroup, -0.34, 0.41, z);
    pin(wheelsGroup, 0.34, 0.41, z);
  }
  group.add(wheelsGroup);

  const tipL = new THREE.Vector3();
  const tipR = new THREE.Vector3();
  const nut = new THREE.Vector3();
  const drum = new THREE.Vector3();
  const hook = new THREE.Vector3();
  const stretchDir = new THREE.Vector3();
  function stretch(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, radius = 0.012): void {
    stretchDir.subVectors(b, a);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.scale.set(radius, stretchDir.length(), radius);
    mesh.quaternion.setFromUnitVectors(up, stretchDir.normalize());
  }

  function update(time: number, drive: number): void {
    const d = THREE.MathUtils.clamp(drive, 0, 1);
    group.rotation.z = Math.sin(time) * 0.006;
    group.rotation.x = Math.sin(time * 0.67) * 0.0025;
    left.arm.rotation.y = d * 0.5;
    right.arm.rotation.y = -d * 0.5;
    skeinL.rotation.z = d * 1.2;
    skeinR.rotation.z = -d * 1.2;
    sliderGroup.position.set(0, stockY + 0.13, 0.62 - d * 1.05);
    crank.rotation.x = d * 6 + Math.sin(time * 2.2) * 0.025;

    left.tip.getWorldPosition(tipL);
    right.tip.getWorldPosition(tipR);
    sliderGroup.localToWorld(nut.set(0, 0.13, 0.08));
    stringGroup.worldToLocal(tipL);
    stringGroup.worldToLocal(tipR);
    stringGroup.worldToLocal(nut);
    stretch(stringLeft, tipL, nut);
    stretch(stringRight, tipR, nut);

    windlassGroup.localToWorld(drum.set(0, 0, 0.08));
    sliderGroup.localToWorld(hook.set(0, -0.02, -0.15));
    windlassGroup.worldToLocal(drum);
    windlassGroup.worldToLocal(hook);
    stretch(drawRope, drum, hook, 0.011);
  }

  update(0, 0);
  return { group, update };
}
