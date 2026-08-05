import {
  CapsuleGeometry,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardNodeMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGPURenderer
} from "three/webgpu";
import type { GpuHooks, GpuWorld } from "../../gpu/GpuRoot";
import { FrameClock } from "../../gpu/perf";
import { disposeTree } from "../../gpu/dispose";
import { FIELD, bladeCount, buildQuality, heightAt, type GpuQuality } from "../field";
import { buildTerrain, extremes, spawnPoint } from "./terrain";
import { buildGrass } from "./grass";
import { createWalker, step as walkStep, type Keys } from "./walker";

/**
 * WIND FIELD — the walkable one.
 *
 * The reader presses a key and moves; nothing here moves on its own except the
 * wind, and the wind is exactly what stops when motion is turned off. That
 * split is the page's whole accessibility position: reduced motion is about
 * movement the reader did not ask for, and someone who pressed W asked.
 */

const EYE = 1.62;
const CHASE = { distance: 5.6, height: 2.5, lookAhead: 1.35 } as const;

export interface WindFieldDebugState {
  readonly player: { x: number; y: number; z: number };
  readonly yaw: number;
  readonly speed: number;
  /** Ground height under the player, from the heightfield. */
  readonly groundY: number;
  readonly blades: number;
  readonly tier: GpuQuality["tier"];
  readonly firstPerson: boolean;
  readonly drawCalls: number;
  readonly frames: number;
  readonly p50: number;
  readonly p95: number;
  readonly worst: number;
}

declare global {
  interface Window {
    __windField?: {
      debugTick(deltaMs: number, keys?: Partial<Keys>): Promise<void>;
      getDebugState(): WindFieldDebugState;
      teleport(x: number, z: number): void;
    };
  }
}

function detectTier(coarse: boolean): GpuQuality["tier"] {
  const params = new URLSearchParams(window.location.search);
  const forced = params.get("q");
  if (forced === "high" || forced === "balanced" || forced === "low") return forced;
  const memory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory || 4);
  if (coarse || memory < 4 || window.innerWidth < 900) return "low";
  return memory >= 8 ? "high" : "balanced";
}

export async function createWindFieldWorld(
  canvas: HTMLCanvasElement,
  hooks: GpuHooks
): Promise<GpuWorld> {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const motionOn = document.documentElement.classList.contains("motion-on");
  /*
   * Quality is read once, from the same document class the rest of the site
   * uses. motionScale 0 here freezes the wind and the sun's drift — never the
   * walking, which is the reader's own input.
   */
  const quality = buildQuality(detectTier(coarse), !motionOn, coarse, window.devicePixelRatio || 1);

  const renderer = new WebGPURenderer({ canvas, antialias: quality.samples > 0, alpha: false });
  renderer.onDeviceLost = (info) => {
    hooks.onDeviceLost(String((info as { message?: string }).message ?? "GPU デバイスが失われました"));
  };
  renderer.setPixelRatio(quality.dpr);
  await renderer.init();

  const scene = new Scene();
  const sky = new Color("#a8c8e4");
  scene.background = sky;
  scene.fog = new Fog(sky, FIELD.size * 0.35, FIELD.size * 1.25);

  const camera = new PerspectiveCamera(58, 1, 0.1, FIELD.size * 2.4);

  const sun = new DirectionalLight("#fff3dc", 2.4);
  sun.position.set(-34, 46, 22);
  scene.add(sun);
  scene.add(new HemisphereLight("#cfe4f6", "#4a5a34", 1.05));

  const ground = new Group();
  scene.add(ground);
  const terrain = await buildTerrain(renderer, ground);
  const grass = await buildGrass(renderer, ground, quality, terrain.attribute);

  const spawn = spawnPoint(terrain.field);
  const walker = createWalker(spawn.x, spawn.z, terrain.field);

  /* Something to be, in third person. A capsule reads as a person at this
     distance and costs one draw call; anything more is a different project. */
  const avatar = new Mesh(
    new CapsuleGeometry(0.24, 0.9, 4, 10),
    new MeshStandardNodeMaterial({ color: "#efe6d4", roughness: 0.8 })
  );
  scene.add(avatar);

  /* ── input ────────────────────────────────────────────────────────────── */
  const keys: Keys = { forward: 0, strafe: 0, run: false };
  const held = new Set<string>();
  let cameraYaw = walker.yaw;
  let firstPerson = false;
  let dragging = false;
  let lastPointerX = 0;

  const readKeys = (): void => {
    keys.forward = (held.has("w") || held.has("arrowup") ? 1 : 0) - (held.has("s") || held.has("arrowdown") ? 1 : 0);
    keys.strafe = (held.has("d") || held.has("arrowright") ? 1 : 0) - (held.has("a") || held.has("arrowleft") ? 1 : 0);
    keys.run = held.has("shift");
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    if (k === "f") firstPerson = !firstPerson;
    /* Arrow keys scroll the page by default, and a page that scrolls while you
       walk is a page fighting you. Only the movement keys are taken. */
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
      e.preventDefault();
    }
    held.add(k === "shift" ? "shift" : k);
    readKeys();
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    held.delete(e.key.toLowerCase());
    readKeys();
  };
  const onBlur = (): void => {
    held.clear();
    readKeys();
  };
  /*
   * Turning is drag, not pointer lock. Taking the pointer means taking Escape
   * away from the reader, and on a portfolio page that is a worse trade than
   * asking them to hold a mouse button.
   */
  const onPointerDown = (e: PointerEvent): void => {
    dragging = true;
    lastPointerX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (!dragging) return;
    cameraYaw -= (e.clientX - lastPointerX) * 0.005;
    lastPointerX = e.clientX;
  };
  const onPointerUp = (e: PointerEvent): void => {
    dragging = false;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* the pointer may already be gone */
    }
  };

  canvas.tabIndex = 0;
  canvas.addEventListener("keydown", onKeyDown);
  canvas.addEventListener("keyup", onKeyUp);
  canvas.addEventListener("blur", onBlur);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove, { passive: true });
  canvas.addEventListener("pointerup", onPointerUp);
  window.addEventListener("blur", onBlur);

  /* ── frame ────────────────────────────────────────────────────────────── */
  const clock = new FrameClock();
  let last = performance.now();
  const eye = new Vector3();
  const target = new Vector3();

  const place = (): void => {
    avatar.position.set(walker.x, walker.y + 0.7, walker.z);
    avatar.rotation.y = walker.yaw;

    if (firstPerson) {
      eye.set(walker.x, walker.y + EYE, walker.z);
      target.set(
        walker.x - Math.sin(cameraYaw) * 6,
        walker.y + EYE - 0.4,
        walker.z - Math.cos(cameraYaw) * 6
      );
    } else {
      eye.set(
        walker.x + Math.sin(cameraYaw) * CHASE.distance,
        walker.y + CHASE.height,
        walker.z + Math.cos(cameraYaw) * CHASE.distance
      );
      /* The camera never goes under the hill it is behind. Reading the same
         heightfield the walker stands on is the only way that stays true. */
      const floor = heightAt(terrain.field, eye.x, eye.z) + 0.6;
      eye.y = Math.max(eye.y, floor);
      target.set(walker.x, walker.y + CHASE.lookAhead, walker.z);
    }
    camera.position.copy(eye);
    camera.lookAt(target);
  };

  const advance = (deltaMs: number): void => {
    const dt = Math.min(deltaMs, 100) / 1000;
    walkStep(walker, keys, cameraYaw, dt, terrain.field);
    place();
    grass.update(renderer, walker.x, walker.z, quality.motionScale);
  };

  const resize = (): void => {
    const width = Math.max(1, canvas.clientWidth || window.innerWidth);
    const height = Math.max(1, canvas.clientHeight || window.innerHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  window.addEventListener("resize", resize, { passive: true });
  resize();
  place();

  void renderer
    .setAnimationLoop((now) => {
      const delta = now - last;
      last = now;
      clock.push(delta);
      advance(delta);
      renderer.render(scene, camera);
    })
    .catch((error) => {
      if (import.meta.env.DEV) console.warn("Wind field loop stopped.", error);
      hooks.onDeviceLost("描画ループが停止しました");
    });

  /*
   * The seam the tests drive. document.hidden is true in the in-app browser, so
   * without this not one frame of this page could ever be checked automatically
   * — not the walking, not the ground, not the frame budget.
   */
  window.__windField = {
    debugTick: async (deltaMs, override) => {
      if (override) Object.assign(keys, override);
      advance(deltaMs);
      clock.push(deltaMs);
      await renderer.renderAsync(scene, camera);
    },
    getDebugState: () => {
      const stats = clock.stats();
      return {
        player: { x: walker.x, y: walker.y, z: walker.z },
        yaw: walker.yaw,
        speed: walker.speed,
        groundY: heightAt(terrain.field, walker.x, walker.z),
        blades: bladeCount(quality),
        tier: quality.tier,
        firstPerson,
        drawCalls: renderer.info.render.drawCalls,
        frames: stats.frames,
        p50: stats.p50,
        p95: stats.p95,
        worst: stats.worst
      };
    },
    teleport: (x, z) => {
      walker.x = x;
      walker.z = z;
      walker.y = heightAt(terrain.field, x, z);
      walker.speed = 0;
      place();
    }
  };

  const range = extremes(terrain.field);
  if (import.meta.env.DEV) {
    console.info(
      `WIND FIELD: ${bladeCount(quality).toLocaleString()} blades, tier ${quality.tier}, ` +
        `terrain ${range.min.toFixed(2)}..${range.max.toFixed(2)} m`
    );
  }

  return {
    dispose() {
      void renderer.setAnimationLoop(null);
      window.removeEventListener("resize", resize);
      window.removeEventListener("blur", onBlur);
      canvas.removeEventListener("keydown", onKeyDown);
      canvas.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("blur", onBlur);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      if (window.__windField) delete window.__windField;
      grass.dispose();
      terrain.dispose();
      disposeTree(scene);
      renderer.dispose();
    }
  };
}
