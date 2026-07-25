import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { buildBrickGeo, U } from "../../portfolio/gl/brick/brickKit";
import { occupiedCells, partLocalPosition, validateBuild } from "../sim/build";
import {
  CELL,
  type BotSpec,
  type Catalog,
  type ChassisDef,
  type PartDef,
  type Rot4
} from "../sim/types";

export interface BuilderScene {
  setSpec(spec: BotSpec): void;
  setHoveredPart(partId: string | null): void;
  onChange(cb: (spec: BotSpec) => void): void;
  /** QA seam: このペインでは rAF が回らない。必ず用意すること */
  debugTick(dt: number): void;
  getDebugState(): {
    partCount: number;
    camYaw: number;
    hoverCell: [number, number] | null;
    valid: boolean;
  };
  captureFrame(): string;
  dispose(): void;
}

type DisposableObject = THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };

const cloneSpec = (spec: BotSpec): BotSpec => ({
  ...spec,
  parts: spec.parts.map((part) => ({ ...part, cell: [...part.cell] as [number, number] }))
});

function disposeTree(root: THREE.Object3D): void {
  root.traverse((object) => {
    const item = object as DisposableObject;
    item.geometry?.dispose();
    if (Array.isArray(item.material)) item.material.forEach((material) => material.dispose());
    else item.material?.dispose();
  });
  root.clear();
}

function dimensions(part: PartDef, rot: Rot4): [number, number] {
  return rot === 1 || rot === 3 ? [part.cells[1], part.cells[0]] : [part.cells[0], part.cells[1]];
}

function wornMaterial(color: number, transparent = false): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.78,
    metalness: 0.52,
    transparent,
    opacity: transparent ? 0.48 : 1,
    depthWrite: !transparent
  });
}

function createPartObject(
  part: PartDef,
  color: number,
  rot: Rot4,
  transparent = false
): THREE.Group {
  const group = new THREE.Group();
  const [w, d] = dimensions(part, rot);
  const material = wornMaterial(color, transparent);
  const geometry = buildBrickGeo(w, d, part.category === "armor" ? "tile" : "plate", 8);
  geometry.scale(CELL / U, Math.max(part.height, 0.025) / (U * 0.4), CELL / U);
  const body = new THREE.Mesh(geometry, material);
  body.castShadow = !transparent;
  body.receiveShadow = true;
  group.add(body);

  const edgeGeometry = new THREE.EdgesGeometry(
    new THREE.BoxGeometry(w * CELL * 0.94, Math.max(part.height, 0.025), d * CELL * 0.94)
  );
  const edges = new THREE.LineSegments(
    edgeGeometry,
    new THREE.LineBasicMaterial({
      color: transparent ? 0xffffff : 0x17191a,
      transparent,
      opacity: transparent ? 0.75 : 0.45
    })
  );
  edges.position.y = Math.max(part.height, 0.025) * 0.5;
  group.add(edges);

  if (part.category === "drive") {
    const radius = part.radius;
    const wheelGeometry =
      part.kind === "track"
        ? new RoundedBoxGeometry(w * CELL * 0.82, radius * 1.3, d * CELL * 0.78, 2, 0.018)
        : new THREE.CylinderGeometry(radius, radius, Math.min(w, d) * CELL * 0.7, 16);
    const wheel = new THREE.Mesh(wheelGeometry, wornMaterial(0x202224, transparent));
    if (part.kind === "wheel") wheel.rotation.z = Math.PI / 2;
    wheel.position.y = Math.max(radius * 0.55, part.height * 0.45);
    group.add(wheel);
  } else if (part.category === "weapon" && part.motion === "spin") {
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(Math.min(w * CELL, d * CELL) * 0.43, Math.min(w * CELL, d * CELL) * 0.43, 0.026, 24),
      wornMaterial(0x7b7f80, transparent)
    );
    disc.position.y = part.height + 0.025;
    group.add(disc);
  }
  return group;
}

export function createBuilderScene(canvas: HTMLCanvasElement, catalog: Catalog): BuilderScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x101416, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x101416, 2.6, 5.5);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.02, 20);
  const buildRoot = new THREE.Group();
  const ghostRoot = new THREE.Group();
  const floorRoot = new THREE.Group();
  scene.add(floorRoot, buildRoot, ghostRoot);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(2.5, 48),
    new THREE.MeshStandardMaterial({ color: 0x171c1e, roughness: 0.9, metalness: 0.25 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.035;
  floor.receiveShadow = true;
  floorRoot.add(floor);
  const grid = new THREE.GridHelper(4.4, 44, 0x3b4548, 0x252d30);
  grid.position.y = -0.03;
  floorRoot.add(grid);

  scene.add(new THREE.HemisphereLight(0xaac7d2, 0x281e18, 1.25));
  const key = new THREE.DirectionalLight(0xffe1bd, 3.2);
  key.position.set(-2.4, 3.6, 2.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x4f9db6, 2.1);
  rim.position.set(2.2, 1.8, -2.6);
  scene.add(rim);

  let spec = cloneSpec(catalog.presets[0] ?? {
    v: 1,
    name: "新規機体",
    chassisId: catalog.parts.find((part) => part.category === "chassis")?.id ?? "",
    paint: 0xc91a09,
    parts: []
  });
  let hoveredPartId: string | null = null;
  let hoverCell: [number, number] | null = null;
  let rot: Rot4 = 0;
  let camYaw = -0.72;
  let camPitch = 0.72;
  let camDistance = 2.25;
  let dragging = false;
  let dragged = false;
  let pointerX = 0;
  let pointerY = 0;
  let disposed = false;
  let changeCallback: (spec: BotSpec) => void = () => undefined;
  let frame = 0;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const deckPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const planeHit = new THREE.Vector3();

  function chassis(): ChassisDef | null {
    const part = catalog.byId.get(spec.chassisId);
    return part?.category === "chassis" ? part : null;
  }

  function updateCamera(): void {
    const cosPitch = Math.cos(camPitch);
    camera.position.set(
      Math.sin(camYaw) * cosPitch * camDistance,
      Math.sin(camPitch) * camDistance,
      Math.cos(camYaw) * cosPitch * camDistance
    );
    camera.lookAt(0, 0.08, 0);
  }

  function rebuild(): void {
    disposeTree(buildRoot);
    const frame = chassis();
    if (!frame) return;
    const chassisMaterial = wornMaterial(spec.paint);
    const chassisGeo = new RoundedBoxGeometry(frame.deck[0] * CELL, frame.height, frame.deck[1] * CELL, 3, 0.025);
    const chassisMesh = new THREE.Mesh(chassisGeo, chassisMaterial);
    chassisMesh.position.y = frame.height * 0.5;
    chassisMesh.castShadow = true;
    chassisMesh.receiveShadow = true;
    buildRoot.add(chassisMesh);

    const linePositions: number[] = [];
    for (let x = 0; x <= frame.deck[0]; x += 1) {
      const px = (x - frame.deck[0] / 2) * CELL;
      linePositions.push(px, frame.height + 0.002, -frame.deck[1] * CELL / 2, px, frame.height + 0.002, frame.deck[1] * CELL / 2);
    }
    for (let z = 0; z <= frame.deck[1]; z += 1) {
      const pz = (z - frame.deck[1] / 2) * CELL;
      linePositions.push(-frame.deck[0] * CELL / 2, frame.height + 0.002, pz, frame.deck[0] * CELL / 2, frame.height + 0.002, pz);
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
    buildRoot.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0x2a3032, transparent: true, opacity: 0.72 })));

    for (const placed of spec.parts) {
      const part = catalog.byId.get(placed.partId);
      if (!part || part.category === "chassis") continue;
      const object = createPartObject(part, part.color, placed.rot);
      const [x, z] = partLocalPosition(frame, part, placed.cell, placed.rot);
      object.position.set(x, frame.height, z);
      buildRoot.add(object);
    }
    rebuildGhost();
  }

  function candidateSpec(part: PartDef, cell: [number, number]): BotSpec {
    return {
      ...spec,
      parts: [...spec.parts, { partId: part.id, cell, rot }]
    };
  }

  function placementValid(part: PartDef, cell: [number, number]): boolean {
    const before = validateBuild(spec, catalog);
    const after = validateBuild(candidateSpec(part, cell), catalog);
    const remaining = [...after.errors];
    for (const error of before.errors) {
      const index = remaining.indexOf(error);
      if (index >= 0) remaining.splice(index, 1);
    }
    return remaining.length === 0;
  }

  function rebuildGhost(): void {
    disposeTree(ghostRoot);
    const frame = chassis();
    const part = hoveredPartId ? catalog.byId.get(hoveredPartId) : null;
    if (!frame || !part) return;
    if (part.category === "chassis") {
      const mesh = new THREE.Mesh(
        new RoundedBoxGeometry(part.deck[0] * CELL, part.height, part.deck[1] * CELL, 3, 0.025),
        wornMaterial(part.color, true)
      );
      mesh.position.y = part.height * 0.5 + 0.004;
      ghostRoot.add(mesh);
      return;
    }
    if (!hoverCell) return;
    const valid = placementValid(part, hoverCell);
    const object = createPartObject(part, valid ? 0x55d68a : 0xe24338, rot, true);
    const [x, z] = partLocalPosition(frame, part, hoverCell, rot);
    object.position.set(x, frame.height + 0.004, z);
    ghostRoot.add(object);
  }

  function locateCell(clientX: number, clientY: number): void {
    const frame = chassis();
    if (!frame) {
      hoverCell = null;
      return;
    }
    const rect = canvas.getBoundingClientRect();
    pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    deckPlane.constant = -frame.height;
    if (!raycaster.ray.intersectPlane(deckPlane, planeHit)) {
      hoverCell = null;
    } else {
      hoverCell = [
        Math.floor(planeHit.x / CELL + frame.deck[0] / 2),
        Math.floor(planeHit.z / CELL + frame.deck[1] / 2)
      ];
    }
    rebuildGhost();
  }

  function removeAtHover(): void {
    if (!hoverCell) return;
    for (let index = spec.parts.length - 1; index >= 0; index -= 1) {
      const placed = spec.parts[index]!;
      const part = catalog.byId.get(placed.partId);
      if (!part) continue;
      if (occupiedCells(part, placed.cell, placed.rot).some(([x, z]) => x === hoverCell![0] && z === hoverCell![1])) {
        spec = { ...spec, parts: spec.parts.filter((_, partIndex) => partIndex !== index) };
        rebuild();
        changeCallback(cloneSpec(spec));
        return;
      }
    }
  }

  function placeHovered(): void {
    const part = hoveredPartId ? catalog.byId.get(hoveredPartId) : null;
    if (!part) return;
    if (part.category === "chassis") {
      spec = { ...spec, chassisId: part.id, parts: [] };
    } else {
      if (!hoverCell || !placementValid(part, hoverCell)) return;
      spec = candidateSpec(part, hoverCell);
    }
    rebuild();
    changeCallback(cloneSpec(spec));
  }

  function render(dt: number): void {
    if (!reducedMotion && !dragging && hoveredPartId === null) camYaw += Math.min(Math.max(dt, 0), 0.05) * 0.09;
    updateCamera();
    renderer.render(scene, camera);
  }

  function resize(): void {
    const width = Math.max(canvas.clientWidth, 1);
    const height = Math.max(canvas.clientHeight, 1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    render(0);
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);

  function loop(now: number): void {
    const last = Number(canvas.dataset.scFrameTime ?? now);
    canvas.dataset.scFrameTime = String(now);
    render((now - last) / 1000);
    if (!disposed) frame = requestAnimationFrame(loop);
  }

  const onPointerDown = (event: PointerEvent): void => {
    canvas.focus();
    pointerX = event.clientX;
    pointerY = event.clientY;
    dragging = event.button === 0;
    dragged = false;
    canvas.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent): void => {
    locateCell(event.clientX, event.clientY);
    if (!dragging) return;
    const dx = event.clientX - pointerX;
    const dy = event.clientY - pointerY;
    if (Math.abs(dx) + Math.abs(dy) > 2) dragged = true;
    camYaw -= dx * 0.007;
    camPitch = THREE.MathUtils.clamp(camPitch + dy * 0.005, 0.24, 1.28);
    pointerX = event.clientX;
    pointerY = event.clientY;
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (event.button === 0 && !dragged) placeHovered();
    dragging = false;
    canvas.releasePointerCapture(event.pointerId);
  };
  const onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    locateCell(event.clientX, event.clientY);
    removeAtHover();
  };
  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    camDistance = THREE.MathUtils.clamp(camDistance + event.deltaY * 0.0015, 1.15, 4);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key.toLowerCase() === "r") {
      rot = ((rot + 1) % 4) as Rot4;
      rebuildGhost();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      removeAtHover();
    }
  };
  const onPointerLeave = (): void => {
    dragging = false;
    hoverCell = null;
    rebuildGhost();
  };
  canvas.tabIndex = 0;
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("contextmenu", onContextMenu);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("keydown", onKeyDown);
  rebuild();
  resize();
  frame = requestAnimationFrame(loop);

  return {
    setSpec(nextSpec) {
      spec = cloneSpec(nextSpec);
      hoverCell = null;
      rebuild();
    },
    setHoveredPart(partId) {
      hoveredPartId = partId;
      rebuildGhost();
    },
    onChange(cb) {
      changeCallback = cb;
    },
    debugTick(dt) {
      render(dt);
    },
    getDebugState() {
      return {
        partCount: spec.parts.length,
        camYaw,
        hoverCell: hoverCell ? [...hoverCell] as [number, number] : null,
        valid: validateBuild(spec, catalog).ok
      };
    },
    captureFrame() {
      render(0);
      return canvas.toDataURL("image/png");
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKeyDown);
      disposeTree(buildRoot);
      disposeTree(ghostRoot);
      disposeTree(floorRoot);
      renderer.dispose();
      scene.clear();
    }
  };
}
