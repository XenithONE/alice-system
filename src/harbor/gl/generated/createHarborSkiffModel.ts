import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

/**
 * Generated through the img2threejs v1.3.0 reference-admission, detail
 * inventory, blockout, and browser-review workflow, then hand-refined for the
 * real-time harbor.
 *
 * The hierarchy, sockets, collider intent, material evidence and review targets
 * remain driven by the quality-gated sculpt spec; this file keeps only the
 * lightweight geometry needed by the production harbor scene.
 */

export interface HarborSkiffOptions {
  quality?: "high" | "balanced" | "low";
  castShadow?: boolean;
}

export interface HarborSkiffRuntime {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh | THREE.InstancedMesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
}

export interface HarborSkiffModel {
  root: THREE.Group;
  runtime: HarborSkiffRuntime;
}

const HULL_BROWN = 0x8b431f;
const HULL_DARK = 0x5c2713;
const HULL_LIGHT = 0xb7622e;
const IVORY = 0xf2dab8;
const IVORY_LIGHT = 0xfff1d7;
const BRASS = 0xc68f34;

function makeHullGeometry(): THREE.BufferGeometry {
  const sections = [
    { z: -3.55, halfWidth: 0.14, top: 0.72, bottom: 0.24 },
    { z: -2.9, halfWidth: 0.86, top: 1.12, bottom: -0.22 },
    { z: -1.75, halfWidth: 1.62, top: 1.28, bottom: -0.58 },
    { z: 0.1, halfWidth: 2.05, top: 1.32, bottom: -0.74 },
    { z: 2.25, halfWidth: 2.08, top: 1.28, bottom: -0.48 },
    { z: 3.18, halfWidth: 1.82, top: 1.12, bottom: -0.06 }
  ];
  const positions: number[] = [];
  const indices: number[] = [];

  // Four vertices per cross-section: port top/bottom, starboard bottom/top.
  for (const section of sections) {
    positions.push(
      -section.halfWidth,
      section.top,
      section.z,
      -section.halfWidth * 0.45,
      section.bottom,
      section.z,
      section.halfWidth * 0.45,
      section.bottom,
      section.z,
      section.halfWidth,
      section.top,
      section.z
    );
  }

  for (let i = 0; i < sections.length - 1; i += 1) {
    const a = i * 4;
    const b = (i + 1) * 4;
    // Port side.
    indices.push(a, a + 1, b + 1, a, b + 1, b);
    // Bottom.
    indices.push(a + 1, a + 2, b + 2, a + 1, b + 2, b + 1);
    // Starboard side.
    indices.push(a + 2, a + 3, b + 3, a + 2, b + 3, b + 2);
  }

  // Bow and transom closures.
  indices.push(0, 3, 2, 0, 2, 1);
  const stern = (sections.length - 1) * 4;
  indices.push(stern, stern + 1, stern + 2, stern, stern + 2, stern + 3);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeTriangularSail(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.22, 5.1);
  shape.lineTo(4.05, 0.18);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.12,
    bevelEnabled: true,
    bevelSize: 0.055,
    bevelThickness: 0.045,
    bevelSegments: 2,
    steps: 1
  });
  geometry.center();
  return geometry;
}

function addSocket(parent: THREE.Object3D, runtime: HarborSkiffRuntime, id: string, position: THREE.Vector3): void {
  const socket = new THREE.Object3D();
  socket.name = id;
  socket.position.copy(position);
  parent.add(socket);
  runtime.sockets[id] = socket;
}

function registerMesh(
  runtime: HarborSkiffRuntime,
  id: string,
  parent: THREE.Object3D,
  mesh: THREE.Mesh | THREE.InstancedMesh
): void {
  mesh.name = id;
  parent.add(mesh);
  runtime.meshes[id] = mesh;
}

function addBrickPanels(
  root: THREE.Group,
  material: THREE.Material,
  runtime: HarborSkiffRuntime,
  castShadow: boolean,
  quality: HarborSkiffOptions["quality"]
): void {
  const columns = quality === "low" ? 7 : quality === "high" ? 12 : 10;
  const rows = quality === "low" ? 2 : quality === "high" ? 4 : 3;
  const count = columns * rows * 2;
  const geometry = new RoundedBoxGeometry(0.72, 0.31, 0.16, 2, 0.035);
  const panels = new THREE.InstancedMesh(geometry, material, count);
  panels.castShadow = castShadow;
  panels.receiveShadow = true;
  const dummy = new THREE.Object3D();
  let index = 0;
  for (let side = -1; side <= 1; side += 2) {
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const t = column / (columns - 1);
        const z = THREE.MathUtils.lerp(-2.72, 2.72, t);
        const bowFactor = THREE.MathUtils.smoothstep(z, -3.45, -1.15);
        const halfWidth = THREE.MathUtils.lerp(0.7, 2.03, bowFactor) * (1 - Math.max(0, z - 2.15) * 0.08);
        const y = -0.24 + row * 0.34 + Math.sin(t * Math.PI) * 0.08;
        dummy.position.set(side * (halfWidth + 0.01), y, z);
        dummy.rotation.set(0, Math.PI / 2, side * 0.03);
        dummy.scale.set(1, 1, 0.95);
        dummy.updateMatrix();
        panels.setMatrixAt(index, dummy.matrix);
        panels.setColorAt(
          index,
          new THREE.Color((column + row) % 4 === 0 ? HULL_LIGHT : (column + row) % 5 === 0 ? HULL_DARK : HULL_BROWN)
        );
        index += 1;
      }
    }
  }
  panels.instanceMatrix.needsUpdate = true;
  if (panels.instanceColor) panels.instanceColor.needsUpdate = true;
  registerMesh(runtime, "hull-brick-panels", root, panels);
}

function addTransomPanels(
  root: THREE.Group,
  material: THREE.Material,
  runtime: HarborSkiffRuntime,
  castShadow: boolean,
  quality: HarborSkiffOptions["quality"]
): void {
  const columns = quality === "low" ? 5 : 7;
  const rows = quality === "high" ? 4 : 3;
  const geometry = new RoundedBoxGeometry(0.52, 0.3, 0.18, 2, 0.035);
  const panels = new THREE.InstancedMesh(geometry, material, columns * rows);
  panels.castShadow = castShadow;
  panels.receiveShadow = true;
  const dummy = new THREE.Object3D();
  let index = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const t = column / Math.max(1, columns - 1);
      const x = THREE.MathUtils.lerp(-1.52, 1.52, t);
      dummy.position.set(x, -0.12 + row * 0.34, 3.2);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1 - Math.abs(t - 0.5) * 0.08, 1, 1);
      dummy.updateMatrix();
      panels.setMatrixAt(index, dummy.matrix);
      panels.setColorAt(index, new THREE.Color((row + column) % 4 === 0 ? HULL_LIGHT : HULL_BROWN));
      index += 1;
    }
  }
  panels.instanceMatrix.needsUpdate = true;
  if (panels.instanceColor) panels.instanceColor.needsUpdate = true;
  registerMesh(runtime, "transom-brick-panels", root, panels);
}

function addDeckTiles(
  root: THREE.Group,
  material: THREE.Material,
  runtime: HarborSkiffRuntime,
  castShadow: boolean,
  quality: HarborSkiffOptions["quality"]
): void {
  const columns = quality === "low" ? 4 : 5;
  const rows = quality === "low" ? 7 : 9;
  const geometry = new RoundedBoxGeometry(0.58, 0.18, 0.62, 2, 0.025);
  const tiles = new THREE.InstancedMesh(geometry, material, columns * rows);
  tiles.castShadow = castShadow;
  tiles.receiveShadow = true;
  const dummy = new THREE.Object3D();
  let index = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const z = THREE.MathUtils.lerp(-2.45, 2.35, row / Math.max(1, rows - 1));
      const widthAtZ = z < -1.5 ? THREE.MathUtils.lerp(1.15, 3.1, (z + 2.45) / 0.95) : 3.15;
      const x = (column - (columns - 1) / 2) * (widthAtZ / columns);
      dummy.position.set(x, 1.22, z);
      dummy.rotation.set(0, ((row + column) % 2) * 0.012, 0);
      dummy.scale.set(widthAtZ / 3.15, 1, 1);
      dummy.updateMatrix();
      tiles.setMatrixAt(index, dummy.matrix);
      tiles.setColorAt(index, new THREE.Color((row + column) % 3 === 0 ? HULL_LIGHT : HULL_BROWN));
      index += 1;
    }
  }
  tiles.instanceMatrix.needsUpdate = true;
  if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true;
  registerMesh(runtime, "deck-tiles", root, tiles);
}

function addGunwales(
  root: THREE.Group,
  ivoryMaterial: THREE.Material,
  runtime: HarborSkiffRuntime,
  castShadow: boolean,
  quality: HarborSkiffOptions["quality"]
): void {
  const segments = quality === "low" ? 9 : 13;
  const geometry = new RoundedBoxGeometry(0.43, 0.25, 0.56, 2, 0.03);
  const mesh = new THREE.InstancedMesh(geometry, ivoryMaterial, segments * 2);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  const dummy = new THREE.Object3D();
  let index = 0;
  for (let side = -1; side <= 1; side += 2) {
    for (let segment = 0; segment < segments; segment += 1) {
      const t = segment / Math.max(1, segments - 1);
      const z = THREE.MathUtils.lerp(-2.82, 2.78, t);
      const bowFactor = THREE.MathUtils.smoothstep(z, -3.35, -1.15);
      const halfWidth = THREE.MathUtils.lerp(0.62, 2.05, bowFactor) * (1 - Math.max(0, z - 2.2) * 0.07);
      dummy.position.set(side * halfWidth, 1.37, z);
      dummy.rotation.set(0, Math.PI / 2, side * 0.015);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      mesh.setColorAt(index, new THREE.Color((segment + (side > 0 ? 1 : 0)) % 5 === 0 ? IVORY_LIGHT : IVORY));
      index += 1;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  registerMesh(runtime, "cream-gunwale", root, mesh);
}

function addStudField(
  root: THREE.Group,
  material: THREE.Material,
  runtime: HarborSkiffRuntime,
  quality: HarborSkiffOptions["quality"]
): void {
  const count = quality === "low" ? 18 : 34;
  const geometry = new THREE.CylinderGeometry(0.105, 0.105, 0.075, quality === "high" ? 12 : 8);
  const studs = new THREE.InstancedMesh(geometry, material, count);
  const dummy = new THREE.Object3D();
  let placed = 0;
  for (let row = 0; row < 8 && placed < count; row += 1) {
    for (let column = -2; column <= 2 && placed < count; column += 1) {
      if ((row < 5 && Math.abs(column) < 2) || (row === 4 && column === 0)) continue;
      const z = -2.35 + row * 0.64;
      dummy.position.set(column * 0.56, 1.37, z);
      dummy.updateMatrix();
      studs.setMatrixAt(placed, dummy.matrix);
      placed += 1;
    }
  }
  studs.count = placed;
  studs.instanceMatrix.needsUpdate = true;
  registerMesh(runtime, "deck-studs", root, studs);
}

function makeWheel(brassMaterial: THREE.Material, quality: HarborSkiffOptions["quality"]): THREE.Group {
  const wheel = new THREE.Group();
  wheel.name = "steering-wheel";
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.53, 0.085, quality === "high" ? 10 : 8, quality === "high" ? 32 : 20),
    brassMaterial
  );
  wheel.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.22, 16), brassMaterial);
  hub.rotation.x = Math.PI / 2;
  wheel.add(hub);
  const spokeGeometry = new THREE.CylinderGeometry(0.038, 0.048, 0.86, 8);
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const spoke = new THREE.Mesh(spokeGeometry, brassMaterial);
    spoke.position.set(Math.cos(angle) * 0.22, Math.sin(angle) * 0.22, 0);
    spoke.rotation.z = angle - Math.PI / 2;
    wheel.add(spoke);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.19, 8), brassMaterial);
    handle.position.set(Math.cos(angle) * 0.66, Math.sin(angle) * 0.66, 0);
    handle.rotation.z = angle - Math.PI / 2;
    wheel.add(handle);
  }
  return wheel;
}

function makeMinifigurePlaceholder(
  hullMaterial: THREE.Material,
  ivoryMaterial: THREE.Material,
  brassMaterial: THREE.Material
): THREE.Group {
  const figure = new THREE.Group();
  figure.name = "skipper-placeholder";
  const legs = new THREE.Mesh(new RoundedBoxGeometry(0.52, 0.52, 0.32, 2, 0.04), hullMaterial);
  legs.position.y = 0.26;
  figure.add(legs);
  const torso = new THREE.Mesh(new RoundedBoxGeometry(0.72, 0.72, 0.4, 2, 0.05), ivoryMaterial);
  torso.position.y = 0.83;
  figure.add(torso);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.34, 16), brassMaterial);
  head.position.y = 1.37;
  figure.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hullMaterial);
  hair.position.y = 1.56;
  figure.add(hair);
  return figure;
}

export function createHarborSkiffModel(options: HarborSkiffOptions = {}): HarborSkiffModel {
  const quality = options.quality ?? "balanced";
  const castShadow = options.castShadow ?? quality !== "low";
  const root = new THREE.Group();
  root.name = "harbor-skiff";

  const hullMaterial = new THREE.MeshPhysicalMaterial({
    color: HULL_BROWN,
    roughness: 0.36,
    metalness: 0,
    clearcoat: 0.16,
    clearcoatRoughness: 0.28
  });
  const hullPanelMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.48,
    metalness: 0
  });
  const ivoryMaterial = new THREE.MeshPhysicalMaterial({
    color: IVORY,
    roughness: 0.43,
    clearcoat: 0.08,
    clearcoatRoughness: 0.34,
    side: THREE.DoubleSide
  });
  const brassMaterial = new THREE.MeshPhysicalMaterial({
    color: BRASS,
    roughness: 0.24,
    metalness: 0.78,
    clearcoat: 0.3,
    clearcoatRoughness: 0.18
  });

  const runtime: HarborSkiffRuntime = {
    nodes: { root },
    meshes: {},
    sockets: {},
    colliders: {
      hull: { type: "compound", boxes: [[0, 0.2, 0, 4.3, 1.7, 6.8]] },
      dockTrigger: { type: "box-trigger", offset: [0, 0.6, 0], size: [5.1, 2.2, 8.3] }
    },
    destructionGroups: { "hull-shell": [] }
  };

  const hull = new THREE.Mesh(makeHullGeometry(), hullMaterial);
  hull.castShadow = castShadow;
  hull.receiveShadow = true;
  registerMesh(runtime, "hull-shell", root, hull);
  runtime.nodes["hull-shell"] = hull;

  addBrickPanels(root, hullPanelMaterial, runtime, castShadow, quality);
  addTransomPanels(root, hullPanelMaterial, runtime, castShadow, quality);
  addDeckTiles(root, hullPanelMaterial, runtime, castShadow, quality);
  addGunwales(root, ivoryMaterial, runtime, castShadow, quality);
  addStudField(root, hullPanelMaterial, runtime, quality);

  const mastPivot = new THREE.Group();
  mastPivot.name = "mast";
  mastPivot.position.set(0.1, 1.35, -0.45);
  root.add(mastPivot);
  runtime.nodes.mast = mastPivot;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 5.95, quality === "high" ? 16 : 10), hullMaterial);
  mast.position.y = 2.95;
  mast.castShadow = castShadow;
  registerMesh(runtime, "mast-mesh", mastPivot, mast);

  const collarGeometry = new THREE.CylinderGeometry(0.24, 0.24, 0.13, quality === "high" ? 16 : 10);
  const collars = new THREE.InstancedMesh(collarGeometry, hullMaterial, quality === "low" ? 4 : 6);
  const collarDummy = new THREE.Object3D();
  for (let i = 0; i < collars.count; i += 1) {
    collarDummy.position.set(0, 0.38 + i * 0.91, 0);
    collarDummy.updateMatrix();
    collars.setMatrixAt(i, collarDummy.matrix);
  }
  collars.instanceMatrix.needsUpdate = true;
  registerMesh(runtime, "mast-bands", mastPivot, collars);

  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 4.25, quality === "high" ? 12 : 8), hullMaterial);
  boom.rotation.z = Math.PI / 2;
  boom.position.set(2.02, 1.12, 0);
  boom.castShadow = castShadow;
  registerMesh(runtime, "boom", mastPivot, boom);

  const sailPivot = new THREE.Group();
  sailPivot.name = "sail-main";
  sailPivot.position.set(1.9, 3.62, -0.08);
  mastPivot.add(sailPivot);
  runtime.nodes["sail-main"] = sailPivot;
  const sail = new THREE.Mesh(makeTriangularSail(), ivoryMaterial);
  sail.castShadow = castShadow;
  sail.receiveShadow = true;
  registerMesh(runtime, "sail-panel", sailPivot, sail);

  // Real raised seam strips keep the triangular panel visibly toy-brick.
  const sailSeams = new THREE.Group();
  sailSeams.position.z = 0.1;
  for (let i = 1; i <= 4; i += 1) {
    const y = -2.32 + i * 0.86;
    const width = THREE.MathUtils.lerp(3.35, 0.85, i / 5);
    const seam = new THREE.Mesh(new RoundedBoxGeometry(width, 0.035, 0.035, 1, 0.01), ivoryMaterial);
    seam.position.set((3.35 - width) * -0.18, y, 0);
    sailSeams.add(seam);
  }
  sail.add(sailSeams);

  const wheelPivot = makeWheel(brassMaterial, quality);
  wheelPivot.position.set(-0.78, 1.86, 1.62);
  root.add(wheelPivot);
  runtime.nodes["steering-wheel"] = wheelPivot;
  wheelPivot.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
    }
  });

  const rudderPivot = new THREE.Group();
  rudderPivot.name = "rudder";
  rudderPivot.position.set(0, 0.65, 3.2);
  root.add(rudderPivot);
  runtime.nodes.rudder = rudderPivot;
  const rudderShape = new THREE.Shape();
  rudderShape.moveTo(-0.28, 0.08);
  rudderShape.lineTo(0.28, 0.08);
  rudderShape.lineTo(0.2, -1.25);
  rudderShape.lineTo(-0.16, -1.5);
  rudderShape.closePath();
  const rudder = new THREE.Mesh(
    new THREE.ExtrudeGeometry(rudderShape, {
      depth: 0.2,
      bevelEnabled: true,
      bevelSize: 0.03,
      bevelThickness: 0.03,
      bevelSegments: 1
    }),
    hullMaterial
  );
  rudder.position.z = -0.1;
  rudder.castShadow = castShadow;
  registerMesh(runtime, "rudder-blade", rudderPivot, rudder);
  const hingePin = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 12), brassMaterial);
  hingePin.rotation.z = Math.PI / 2;
  hingePin.position.set(0, 0.08, 0);
  registerMesh(runtime, "rudder-hinge", rudderPivot, hingePin);

  const bollards = new THREE.Group();
  bollards.name = "stern-bollards";
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.4, 12), brassMaterial);
    post.position.set(side * 1.38, 1.55, 2.72);
    bollards.add(post);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.1, 12), brassMaterial);
    cap.position.set(side * 1.38, 1.78, 2.72);
    bollards.add(cap);
  }
  root.add(bollards);
  runtime.nodes["stern-bollards"] = bollards;

  const bench = new THREE.Mesh(new RoundedBoxGeometry(2.75, 0.34, 0.72, 2, 0.045), hullMaterial);
  bench.position.set(0, 1.56, 2.35);
  bench.castShadow = castShadow;
  registerMesh(runtime, "stern-bench", root, bench);
  const bowDeck = new THREE.Mesh(new RoundedBoxGeometry(2.4, 0.28, 0.92, 2, 0.04), hullMaterial);
  bowDeck.position.set(0, 1.48, -2.63);
  bowDeck.castShadow = castShadow;
  registerMesh(runtime, "bow-deck", root, bowDeck);

  const skipper = makeMinifigurePlaceholder(hullMaterial, ivoryMaterial, brassMaterial);
  skipper.position.set(0.32, 1.46, 1.63);
  skipper.rotation.y = Math.PI;
  root.add(skipper);
  runtime.nodes.skipper = skipper;

  addSocket(root, runtime, "camera-chase", new THREE.Vector3(0, 3.4, 7.9));
  addSocket(root, runtime, "character-seat", new THREE.Vector3(0.32, 1.46, 1.63));
  addSocket(root, runtime, "dock-port", new THREE.Vector3(-2.55, 1.1, 0.4));
  addSocket(root, runtime, "wake-emitter", new THREE.Vector3(0, -0.1, 3.35));

  runtime.destructionGroups["hull-shell"] = [hull, bench, bowDeck];
  root.userData.sculptRuntime = runtime;
  root.userData.referenceAsset = "docs/design/img2threejs-inputs/skiff-reference.png";
  root.userData.img2threejsVersion = "1.3.0";
  root.userData.materialEvidenceConfidence = 0.86;

  return { root, runtime };
}
