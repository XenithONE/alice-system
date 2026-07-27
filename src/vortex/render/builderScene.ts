import * as THREE from "three";
import { configureRenderer, installStudioEnvironment } from "../../arena/render/renderEnv";
import {
  createTopVisual,
  disposeTopVisual,
  type TopVisualSpec
} from "./topFactory";

export interface VortexBuilderScene {
  setSpec(spec: TopVisualSpec): void;
  setExploded(exploded: boolean): void;
  setSelectedSlot(slot: number | null): void;
  resetCamera(): void;
  debugTick(dt: number): void;
  captureFrame(): string;
  getDebugState(): {
    parts: number;
    exploded: boolean;
    selectedSlot: number | null;
    render: { calls: number; triangles: number };
    memory: { geometries: number; textures: number };
  };
  dispose(): void;
}

export function createVortexBuilderScene(
  canvas: HTMLCanvasElement,
  initialSpec: TopVisualSpec
): VortexBuilderScene {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance"
  });
  configureRenderer(renderer, {
    shadows: true,
    pixelRatio: Math.min(devicePixelRatio, 2),
    exposure: 1.12
  });
  renderer.setClearColor(0x071015, 1);
  renderer.shadowMap.autoUpdate = false;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x071015, 0.12);
  const environment = installStudioEnvironment(renderer, scene, 0.75);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.02, 40);
  const presentation = new THREE.Group();
  const topRoot = new THREE.Group();
  const guideRoot = new THREE.Group();
  const stageRoot = new THREE.Group();
  presentation.add(topRoot, guideRoot);
  scene.add(stageRoot, presentation);

  const floor = new THREE.Mesh(
    new THREE.CylinderGeometry(2.55, 2.9, 0.16, 96),
    new THREE.MeshStandardMaterial({ color: 0x101a20, metalness: 0.76, roughness: 0.32 })
  );
  floor.position.y = -1.02;
  floor.receiveShadow = true;
  stageRoot.add(floor);
  const inset = new THREE.Mesh(
    new THREE.RingGeometry(1.13, 2.15, 96),
    new THREE.MeshStandardMaterial({
      color: 0x1a4555,
      emissive: 0x163d4d,
      emissiveIntensity: 1.15,
      metalness: 0.65,
      roughness: 0.42
    })
  );
  inset.rotation.x = -Math.PI / 2;
  inset.position.y = -0.932;
  stageRoot.add(inset);
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(1.95, 0.022, 8, 96),
    new THREE.MeshBasicMaterial({
      color: 0x62ddff,
      transparent: true,
      opacity: 0.48,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  halo.rotation.x = Math.PI / 2;
  halo.position.y = -0.91;
  stageRoot.add(halo);
  const grid = new THREE.GridHelper(8, 80, 0x295263, 0x14242b);
  grid.position.y = -0.925;
  grid.material.transparent = true;
  grid.material.opacity = 0.22;
  stageRoot.add(grid);

  scene.add(new THREE.HemisphereLight(0xbbeeff, 0x190f0b, 1.0));
  const key = new THREE.SpotLight(0xd7f6ff, 70, 15, 0.45, 0.5, 1.5);
  key.position.set(-3.6, 5.2, 3.8);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key, key.target);
  const warm = new THREE.SpotLight(0xffa448, 48, 12, 0.55, 0.6, 1.4);
  warm.position.set(3.4, 2.4, 2.2);
  warm.target.position.set(0, 0.1, 0);
  scene.add(warm, warm.target);
  const rim = new THREE.DirectionalLight(0x7b66ff, 2.2);
  rim.position.set(1, 2, -4);
  scene.add(rim);

  let spec = initialSpec;
  let exploded = true;
  let selectedSlot: number | null = 0;
  let yaw = -0.62;
  let pitch = 0.36;
  let distance = 5.35;
  let targetYaw = yaw;
  let targetPitch = pitch;
  let targetDistance = distance;
  let dragging = false;
  let pointerX = 0;
  let pointerY = 0;
  let autoSpin = true;
  let clock = 0;
  let frame = 0;
  let disposed = false;

  function rebuild(): void {
    disposeTopVisual(topRoot);
    const visual = createTopVisual(spec, {
      quality: "high",
      exploded,
      selectedSlot,
      playerColor: spec.paint
    });
    topRoot.add(...visual.children);
    topRoot.userData.sculptRuntime = visual.userData.sculptRuntime;
    topRoot.scale.setScalar(1.08);
    rebuildGuides();
    renderer.shadowMap.needsUpdate = true;
  }

  function rebuildGuides(): void {
    guideRoot.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
    guideRoot.clear();
    if (!exploded) return;
    const material = new THREE.LineDashedMaterial({
      color: 0x62ddff,
      transparent: true,
      opacity: 0.4,
      dashSize: 0.05,
      gapSize: 0.04
    });
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, -0.86, 0),
        new THREE.Vector3(0, 1.62, 0)
      ]),
      material
    );
    line.computeLineDistances();
    guideRoot.add(line);
    for (let slot = 0; slot < 7; slot += 1) {
      const y = 0.72 + (3 - slot) * 0.21 - slot * (slot === 0 ? 0 : 0.22);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.02, 0.008, 4, 64),
        new THREE.MeshBasicMaterial({
          color: slot === selectedSlot ? 0x62ddff : 0x5f7882,
          transparent: true,
          opacity: slot === selectedSlot ? 0.72 : 0.12,
          depthWrite: false
        })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      guideRoot.add(ring);
    }
  }

  function updateCamera(dt: number): void {
    const follow = reducedMotion ? 1 : 1 - Math.exp(-Math.max(0, Math.min(dt, 0.1)) * 11);
    yaw = THREE.MathUtils.lerp(yaw, targetYaw, follow);
    pitch = THREE.MathUtils.lerp(pitch, targetPitch, follow);
    distance = THREE.MathUtils.lerp(distance, targetDistance, follow);
    const cos = Math.cos(pitch);
    camera.position.set(
      Math.sin(yaw) * cos * distance,
      Math.sin(pitch) * distance + 0.2,
      Math.cos(yaw) * cos * distance
    );
    camera.lookAt(0, exploded ? 0.28 : 0.15, 0);
  }

  function resize(): void {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function render(dt: number): void {
    clock += dt;
    updateCamera(dt);
    if (autoSpin && !dragging) {
      presentation.rotation.y += dt * (exploded ? 0.28 : 0.75);
    }
    halo.material.opacity = 0.35 + Math.sin(clock * 2.2) * 0.12;
    renderer.render(scene, camera);
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  const pointerDown = (event: PointerEvent): void => {
    dragging = true;
    pointerX = event.clientX;
    pointerY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    const dx = event.clientX - pointerX;
    const dy = event.clientY - pointerY;
    targetYaw -= dx * 0.007;
    targetPitch = THREE.MathUtils.clamp(targetPitch + dy * 0.006, -0.12, 1.2);
    pointerX = event.clientX;
    pointerY = event.clientY;
  };
  const pointerUp = (event: PointerEvent): void => {
    dragging = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  const wheel = (event: WheelEvent): void => {
    event.preventDefault();
    targetDistance = THREE.MathUtils.clamp(targetDistance + event.deltaY * 0.003, 2.1, 7.5);
  };
  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", pointerUp);
  canvas.addEventListener("wheel", wheel, { passive: false });

  let last = performance.now();
  function loop(now: number): void {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    render(dt);
    if (!disposed) frame = requestAnimationFrame(loop);
  }

  rebuild();
  resize();
  frame = requestAnimationFrame(loop);

  return {
    setSpec(next) {
      spec = next;
      rebuild();
    },
    setExploded(next) {
      exploded = next;
      autoSpin = true;
      targetDistance = next ? Math.max(targetDistance, 5.35) : Math.min(targetDistance, 4.15);
      rebuild();
    },
    setSelectedSlot(next) {
      selectedSlot = next;
      rebuild();
    },
    resetCamera() {
      targetYaw = -0.62;
      targetPitch = 0.36;
      targetDistance = exploded ? 5.35 : 4.15;
      presentation.rotation.set(0, 0, 0);
    },
    debugTick(dt) {
      render(Math.min(0.1, Math.max(0, dt)));
    },
    captureFrame() {
      render(0);
      return canvas.toDataURL("image/png");
    },
    getDebugState() {
      return {
        parts: spec.parts.length,
        exploded,
        selectedSlot,
        render: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles },
        memory: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerUp);
      canvas.removeEventListener("wheel", wheel);
      disposeTopVisual(topRoot);
      guideRoot.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      floor.geometry.dispose();
      floor.material.dispose();
      inset.geometry.dispose();
      inset.material.dispose();
      halo.geometry.dispose();
      halo.material.dispose();
      grid.geometry.dispose();
      grid.material.dispose();
      environment.dispose();
      renderer.dispose();
      scene.clear();
    }
  };
}
