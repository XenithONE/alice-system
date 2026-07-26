import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { createIndustrialPart, industrialMaterial } from "../render/industrialKit";
import { faceGridSize, mountPartObject } from "../render/mounting";
import { configureRenderer, installStudioEnvironment } from "../render/renderEnv";
import { occupiedCells, validateBuild } from "../sim/build";
import {
  CELL,
  type BotSpec,
  type Catalog,
  type ChassisDef,
  type MountFace,
  type PartDef,
  type RoomSettings,
  type Rot4
} from "../sim/types";

export interface BuilderScene {
  setSpec(spec: BotSpec): void;
  setFace(face: MountFace): void;
  setHoveredPart(partId: string | null): void;
  onChange(cb: (spec: BotSpec) => void): void;
  /** QA seam: このペインでは rAF が回らない。必ず用意すること */
  debugTick(dt: number): void;
  getDebugState(): {
    partCount: number;
    camYaw: number;
    hoverCell: [number, number] | null;
    valid: boolean;
    render: { calls: number; triangles: number };
    memory: { geometries: number; textures: number };
    env: boolean;
    toneMapping: number;
    shadowCasters: number;
  };
  captureFrame(): string;
  setEnvironmentEnabled(enabled: boolean): void;
  dispose(): void;
}

type DisposableObject = THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };

const cloneSpec = (spec: BotSpec): BotSpec => ({
  ...spec,
  parts: spec.parts.map((part) => ({ ...part, cell: [...part.cell] as [number, number] }))
});

export function disposeTree(root: THREE.Object3D): void {
  root.traverse((object) => {
    const item = object as DisposableObject;
    if (item.geometry?.userData.scShared !== true) item.geometry?.dispose();
    if (Array.isArray(item.material)) item.material.forEach((material) => material.dispose());
    else item.material?.dispose();
  });
  root.clear();
}

function createPartObject(
  part: PartDef,
  color: number,
  rot: Rot4,
  transparent = false,
  face: MountFace = "deck"
): THREE.Group {
  return createIndustrialPart(part, rot, color, transparent, face).root;
}

export function createBuilderScene(canvas: HTMLCanvasElement, catalog: Catalog, settings: RoomSettings): BuilderScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  configureRenderer(renderer, { shadows: true, pixelRatio: Math.min(devicePixelRatio, 2), exposure: 1.03 });
  renderer.shadowMap.autoUpdate = false;
  renderer.setClearColor(0x101416, 1);

  const scene = new THREE.Scene();
  const environment = installStudioEnvironment(renderer, scene);
  const studioEnvironment = scene.environment;
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

  scene.add(new THREE.HemisphereLight(0xaac7d2, 0x281e18, 0.45));
  const key = new THREE.DirectionalLight(0xffe1bd, 1.6);
  key.position.set(-2.4, 3.6, 2.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x4f9db6, 1.2);
  rim.position.set(2.2, 1.8, -2.6);
  scene.add(rim);

  let spec = cloneSpec(catalog.presets[0] ?? {
    v: 3,
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
  let targetCamYaw = camYaw;
  let targetCamPitch = camPitch;
  let selectedFace: MountFace = "deck";
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
  const mountPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
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
    const chassisMaterial = industrialMaterial(
      frame.material,
      spec.paint,
      selectedFace === "internal" ? { transparent: true, opacity: 0.24 } : undefined
    );
    const chassisGeo = new RoundedBoxGeometry(frame.deck[0] * CELL, frame.height, frame.deck[1] * CELL, 2, 0.009);
    const chassisMesh = new THREE.Mesh(chassisGeo, chassisMaterial);
    chassisMesh.position.y = frame.groundClearance + frame.height * 0.5;
    chassisMesh.castShadow = true;
    chassisMesh.receiveShadow = true;
    buildRoot.add(chassisMesh);

    const [gridU, gridV] = faceGridSize(frame, selectedFace);
    const surfacePoint = (u: number, v: number): [number, number, number] => {
      const halfW = frame.deck[0] * CELL / 2;
      const halfD = frame.deck[1] * CELL / 2;
      if (selectedFace === "deck") return [u, frame.groundClearance + frame.height + 0.002, v];
      if (selectedFace === "underside") return [u, frame.groundClearance - 0.002, v];
      if (selectedFace === "left") return [-halfW - 0.002, frame.groundClearance + v + gridV * CELL / 2, u];
      if (selectedFace === "right") return [halfW + 0.002, frame.groundClearance + v + gridV * CELL / 2, u];
      if (selectedFace === "front") return [u, frame.groundClearance + v + gridV * CELL / 2, -halfD - 0.002];
      if (selectedFace === "internal") {
        return [
          u + (gridU - frame.deck[0]) * CELL / 2,
          frame.groundClearance + frame.height / 2,
          v + (gridV - frame.deck[1]) * CELL / 2
        ];
      }
      return [u, frame.groundClearance + v + gridV * CELL / 2, halfD + 0.002];
    };
    const linePositions: number[] = [];
    for (let u = 0; u <= gridU; u += 1) {
      linePositions.push(
        ...surfacePoint((u - gridU / 2) * CELL, -gridV * CELL / 2),
        ...surfacePoint((u - gridU / 2) * CELL, gridV * CELL / 2)
      );
    }
    for (let v = 0; v <= gridV; v += 1) {
      linePositions.push(
        ...surfacePoint(-gridU * CELL / 2, (v - gridV / 2) * CELL),
        ...surfacePoint(gridU * CELL / 2, (v - gridV / 2) * CELL)
      );
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
    buildRoot.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0x2a3032, transparent: true, opacity: 0.72 })));

    for (const placed of spec.parts) {
      const part = catalog.byId.get(placed.partId);
      if (!part || part.category === "chassis") continue;
      const object = createPartObject(part, part.color, placed.rot, false, placed.face);
      mountPartObject(object, frame, part, placed);
      buildRoot.add(object);
    }
    rebuildGhost();
    renderer.shadowMap.needsUpdate = true;
  }

  function candidateSpec(part: PartDef, cell: [number, number]): BotSpec {
    return {
      ...spec,
      parts: [...spec.parts, { partId: part.id, face: selectedFace, cell, rot }]
    };
  }

  function placementValid(part: PartDef, cell: [number, number]): boolean {
    const before = validateBuild(spec, catalog, settings);
    const after = validateBuild(candidateSpec(part, cell), catalog, settings);
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
        new RoundedBoxGeometry(part.deck[0] * CELL, part.height, part.deck[1] * CELL, 2, 0.009),
        industrialMaterial(part.material, part.color, { transparent: true, opacity: 0.44 })
      );
      mesh.position.y = part.height * 0.5 + 0.004;
      ghostRoot.add(mesh);
      return;
    }
    if (!hoverCell) return;
    const valid = placementValid(part, hoverCell);
    const object = createPartObject(part, valid ? 0x55d68a : 0xe24338, rot, true, selectedFace);
    mountPartObject(object, frame, part, { partId: part.id, face: selectedFace, cell: hoverCell, rot }, 0.004);
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
    const halfW = frame.deck[0] * CELL / 2;
    const halfD = frame.deck[1] * CELL / 2;
    const deckY = frame.groundClearance + frame.height;
    const normal = selectedFace === "deck" ? new THREE.Vector3(0, 1, 0) :
      selectedFace === "internal" ? new THREE.Vector3(0, 1, 0) :
      selectedFace === "underside" ? new THREE.Vector3(0, -1, 0) :
      selectedFace === "left" ? new THREE.Vector3(-1, 0, 0) :
      selectedFace === "right" ? new THREE.Vector3(1, 0, 0) :
      selectedFace === "front" ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 0, 1);
    const planePoint = selectedFace === "deck" ? new THREE.Vector3(0, deckY, 0) :
      selectedFace === "internal" ? new THREE.Vector3(0, frame.groundClearance + frame.height / 2, 0) :
      selectedFace === "underside" ? new THREE.Vector3(0, frame.groundClearance, 0) :
      selectedFace === "left" ? new THREE.Vector3(-halfW, 0, 0) :
      selectedFace === "right" ? new THREE.Vector3(halfW, 0, 0) :
      selectedFace === "front" ? new THREE.Vector3(0, 0, -halfD) : new THREE.Vector3(0, 0, halfD);
    mountPlane.setFromNormalAndCoplanarPoint(normal, planePoint);
    if (!raycaster.ray.intersectPlane(mountPlane, planeHit)) {
      hoverCell = null;
    } else {
      const [gridU, gridV] = faceGridSize(frame, selectedFace);
      const u = selectedFace === "left" || selectedFace === "right" ? planeHit.z : planeHit.x;
      const v = selectedFace === "deck" || selectedFace === "underside" || selectedFace === "internal"
        ? planeHit.z
        : planeHit.y - frame.groundClearance;
      hoverCell = [
        Math.floor(u / CELL + (selectedFace === "internal" ? frame.deck[0] : gridU) / 2),
        Math.floor(v / CELL)
      ];
      if (selectedFace === "deck" || selectedFace === "underside" || selectedFace === "internal") {
        hoverCell[1] = Math.floor(
          v / CELL + (selectedFace === "internal" ? frame.deck[1] : gridV) / 2
        );
      }
    }
    rebuildGhost();
  }

  function removeAtHover(): void {
    if (!hoverCell) return;
    for (let index = spec.parts.length - 1; index >= 0; index -= 1) {
      const placed = spec.parts[index]!;
      if (placed.face !== selectedFace) continue;
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
    if (!dragging) {
      const follow = reducedMotion ? 1 : 1 - Math.exp(-Math.min(Math.max(dt, 0), 0.1) * 8);
      camYaw = THREE.MathUtils.lerp(camYaw, targetCamYaw, follow);
      camPitch = THREE.MathUtils.lerp(camPitch, targetCamPitch, follow);
    }
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
    targetCamYaw = camYaw;
    targetCamPitch = camPitch;
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
    setFace(nextFace) {
      selectedFace = nextFace;
      hoverCell = null;
      const views: Record<MountFace, [number, number]> = {
        deck: [-0.72, 1.08],
        underside: [2.35, -0.42],
        left: [-Math.PI / 2, 0.32],
        right: [Math.PI / 2, 0.32],
        front: [Math.PI, 0.32],
        rear: [0, 0.32],
        internal: [-0.72, 1.35]
      };
      [targetCamYaw, targetCamPitch] = views[nextFace];
      floorRoot.visible = nextFace !== "underside";
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
        valid: validateBuild(spec, catalog, settings).ok,
        render: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles },
        memory: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures },
        env: scene.environment !== null,
        toneMapping: renderer.toneMapping,
        shadowCasters: (() => {
          let count = 0;
          scene.traverse((object) => {
            if (object instanceof THREE.Light && object.castShadow) count += 1;
          });
          return count;
        })()
      };
    },
    captureFrame() {
      render(0);
      return canvas.toDataURL("image/png");
    },
    setEnvironmentEnabled(enabled) {
      scene.environment = enabled ? studioEnvironment : null;
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
      environment.dispose();
      renderer.dispose();
      scene.clear();
    }
  };
}
