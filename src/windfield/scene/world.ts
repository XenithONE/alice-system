import {
  ACESFilmicToneMapping,
  CapsuleGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardNodeMaterial,
  PCFSoftShadowMap,
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
import { buildSky } from "./sky";
import { buildPost } from "./post";
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
  /*
   * The single largest visual change in this file.
   *
   * The default is NoToneMapping, which writes linear radiance straight into an
   * sRGB buffer: a sunlit sky clips to flat white and everything under it lives
   * in the bottom of the range. ACES is what the repo's WebGL scenes already
   * use (renderEnv.ts) and it is applied here in a separate full-screen pass
   * that preserves MSAA rather than inline.
   */
  renderer.toneMapping = ACESFilmicToneMapping;
  /*
   * ⚠ SkyMesh emits physical-scale radiance, not 0..1.
   *
   * The first attempt used 0.86 — a sane number for a scene lit by lights you
   * typed in — and the render came back solid white: sky, grass, avatar, all
   * of it. three's own sky examples run around 0.5 with the sky alone, and
   * this scene also takes its ambient from a PMREM bake OF that sky, so the
   * two stack. The three knobs below are overridable from the query string
   * because the only way to pick them is to look at the result.
   */
  const tune = new URLSearchParams(window.location.search);
  const num = (key: string, fallback: number): number => {
    const raw = Number(tune.get(key));
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  };
  renderer.toneMappingExposure = num("exp", 0.28);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  await renderer.init();

  const scene = new Scene();
  const camera = new PerspectiveCamera(58, 1, 0.1, FIELD.size * 6);

  /* The sky is a real object in the scene and also the source of the ambient
     light, baked into scene.environment. It has to be built before the fog,
     because the fog takes its colour. */
  const sky = buildSky(renderer, scene);
  scene.fog = new Fog(sky.horizon, FIELD.size * 0.45, FIELD.size * 1.9);

  /*
   * One sun that casts, and a small hemisphere fill on top of the environment
   * map. The fill is a fraction of what it was: with scene.environment doing
   * the ambient properly, a strong HemisphereLight only flattens it back out.
   */
  /* scene.environment carries the ambient now, so the sun is a key light
     rather than the whole lighting rig, and the fill under it is a whisper. */
  scene.environmentIntensity = num("env", 0.45);
  const sun = new DirectionalLight("#fff3dc", num("sun", 2.6));
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  /* An orthographic shadow camera sized to the field. Too large and every
     blade gets a quarter of a texel; too small and the far side of the island
     has no shadows at all, which reads as a lighting bug rather than a budget. */
  const shadowCam = sun.shadow.camera;
  shadowCam.left = -FIELD.size * 0.62;
  shadowCam.right = FIELD.size * 0.62;
  shadowCam.top = FIELD.size * 0.62;
  shadowCam.bottom = -FIELD.size * 0.62;
  shadowCam.near = 1;
  shadowCam.far = FIELD.size * 2.4;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.06;
  scene.add(sun);
  scene.add(sun.target);
  scene.add(new HemisphereLight("#cfe4f6", "#4a5a34", num("fill", 0.18)));

  const ground = new Group();
  scene.add(ground);
  const terrain = await buildTerrain(renderer, ground);
  terrain.mesh.castShadow = true;
  terrain.mesh.receiveShadow = true;
  const grass = await buildGrass(renderer, ground, quality, terrain.attribute);
  /* Grass receives but does not cast. A shadow pass runs the vertex shader for
     every blade a second time — a million more vertices for silhouettes a
     metre high. Darkening the roots is cheaper and reads the same. */
  grass.mesh.receiveShadow = true;
  grass.mesh.castShadow = false;

  /* Bake the environment now that the renderer is up. Before init() this logs
     a warning and quietly does nothing. */
  sky.refresh();

  const spawn = spawnPoint(terrain.field);
  const walker = createWalker(spawn.x, spawn.z, terrain.field);

  /* Something to be, in third person. A capsule reads as a person at this
     distance and costs one draw call; anything more is a different project. */
  const avatar = new Mesh(
    new CapsuleGeometry(0.24, 0.9, 4, 10),
    new MeshStandardNodeMaterial({ color: "#efe6d4", roughness: 0.8 })
  );
  avatar.castShadow = true;
  avatar.receiveShadow = true;
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

  /* Everything is in the scene, so the pass can be built. From here the scene
     is only ever drawn through the pipeline. */
  const post = buildPost(renderer, scene, camera);

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
    /* The shadow camera is a box around the sun's direction; parking it on the
       walker keeps its texels where the reader is rather than spread over a
       field they are nowhere near. */
    sun.target.position.set(walker.x, walker.y, walker.z);
    sun.position
      .copy(sun.target.position)
      .addScaledVector(sky.sunDirection, FIELD.size * 0.9);
    sun.target.updateMatrixWorld();
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
      post.render();
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
      post.render();
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
      post.dispose();
      sky.dispose();
      grass.dispose();
      terrain.dispose();
      disposeTree(scene);
      renderer.dispose();
    }
  };
}
