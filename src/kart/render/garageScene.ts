/**
 * The garage turntable: one kart on a plinth, lit like a showroom.
 *
 * `createKartScene` cannot be reused for this — it takes a `Track` and builds
 * the road mesh, the set pieces, the sky shader and the post chain from it,
 * none of which a preview wants. What it CAN share is the renderer setup:
 * `configureRenderer` gives this pane the same ACES + sRGB pipeline the race
 * uses, which is the only reason a colour chosen here still looks like itself
 * on the grid.
 *
 * `debugTick` exists because the Browser pane runs with `document.hidden`
 * true, so `requestAnimationFrame` never fires and the QA harness would
 * otherwise be photographing frame zero forever.
 */

import * as THREE from "three";
import {
  configureRenderer,
  installStudioEnvironment,
} from "../../arena/render/renderEnv";
import { machineById, type MachineShape } from "../content/machines";
import { createKartVisual, type KartVisual } from "./kartModel";

export interface GarageScene {
  /** Swap the kart. Cheap: the shape geometry is the shared cache's. */
  setKit(machineId: string, livery: number): void;
  /** Drag-to-spin, in radians. */
  nudgeSpin(delta: number): void;
  resize(width: number, height: number): void;
  /** QA seam: this pane never gets a rAF. */
  debugTick(dt: number): void;
  getDebugState(): {
    machineId: string;
    livery: number;
    spin: number;
    shape: MachineShape;
    render: { calls: number; triangles: number };
    env: boolean;
  };
  dispose(): void;
}

export interface GarageSceneOptions {
  readonly canvas: HTMLCanvasElement;
  readonly machineId: string;
  readonly livery: number;
  readonly pixelRatio?: number;
}

const SPIN_RATE = 0.42;

export function createGarageScene(options: GarageSceneOptions): GarageScene {
  const { canvas } = options;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  configureRenderer(renderer, {
    shadows: true,
    pixelRatio: Math.min(options.pixelRatio ?? window.devicePixelRatio ?? 1, 2),
    exposure: 1.06,
  });

  const scene = new THREE.Scene();
  const environment = installStudioEnvironment(renderer, scene, 0.55);

  /*
   * Framing is set by the longest chassis, not the default one: BULWARK is
   * 5.35 m nose to tail and 3.12 m across, so a camera tuned to STANDARD puts
   * the heavy machines through the edge of the canvas as the turntable comes
   * side-on. This distance clears the widest diagonal with room to spare.
   */
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  camera.position.set(5.0, 2.7, 5.8);
  camera.lookAt(0, 0.6, 0);

  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(4, 6.5, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -5;
  key.shadow.camera.right = 5;
  key.shadow.camera.top = 5;
  key.shadow.camera.bottom = -5;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fd0ff, 1.05);
  rim.position.set(-5, 2.4, -4);
  scene.add(rim);
  scene.add(new THREE.HemisphereLight(0xdce8ff, 0x1b2030, 0.55));

  // The plinth: a disc to catch the shadow, and a ring to read as an edge.
  const plinthGeometry = new THREE.CylinderGeometry(3.3, 3.3, 0.22, 48);
  const plinthMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a1f2b,
    roughness: 0.72,
    metalness: 0.12,
  });
  const plinth = new THREE.Mesh(plinthGeometry, plinthMaterial);
  plinth.position.y = -0.11;
  plinth.receiveShadow = true;
  scene.add(plinth);

  const ringGeometry = new THREE.TorusGeometry(3.28, 0.035, 8, 64);
  const ringMaterial = new THREE.MeshStandardMaterial({
    color: 0x4ad9ff,
    emissive: 0x1d7fa8,
    emissiveIntensity: 0.9,
    roughness: 0.4,
  });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.002;
  scene.add(ring);

  const turntable = new THREE.Group();
  scene.add(turntable);

  let machineId = options.machineId;
  let livery = options.livery;
  let visual: KartVisual | null = null;
  let spin = 0.6;
  let disposed = false;

  function rebuild(): void {
    if (visual) {
      turntable.remove(visual.root);
      visual.dispose();
    }
    visual = createKartVisual({
      livery,
      castShadow: true,
      shape: machineById(machineId).shape,
    });
    turntable.add(visual.root);
  }
  rebuild();

  function render(): void {
    turntable.rotation.y = spin;
    renderer.render(scene, camera);
  }

  function resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    render();
  }
  resize(canvas.clientWidth || 480, canvas.clientHeight || 320);

  let raf = 0;
  let last = 0;
  function loop(now: number): void {
    if (disposed) return;
    const dt = last === 0 ? 1 / 60 : Math.min(0.1, (now - last) / 1000);
    last = now;
    spin += SPIN_RATE * dt;
    render();
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  return {
    setKit(nextMachine, nextLivery) {
      if (nextMachine === machineId && nextLivery === livery) return;
      machineId = nextMachine;
      livery = nextLivery;
      rebuild();
      render();
    },
    nudgeSpin(delta) {
      spin += delta;
      render();
    },
    resize,
    debugTick(dt) {
      spin += SPIN_RATE * dt;
      render();
    },
    getDebugState() {
      return {
        machineId,
        livery,
        spin,
        shape: machineById(machineId).shape,
        render: {
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
        },
        env: scene.environment !== null,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      if (visual) {
        turntable.remove(visual.root);
        visual.dispose();
      }
      environment.dispose();
      plinthGeometry.dispose();
      plinthMaterial.dispose();
      ringGeometry.dispose();
      ringMaterial.dispose();
      key.dispose();
      rim.dispose();
      renderer.dispose();
    },
  };
}
