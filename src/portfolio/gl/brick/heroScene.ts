import * as THREE from "three";
import type { HeroQuality } from "../../quality";
import { U, PLATE_H, BRICK_H, BRICK, BrickBatcher, makeBrickMaterials } from "./brickKit";

// BRICK STUDIO hero — a toy-brick "A" monument on a studded baseplate, lit like a
// bright product-photography set, on a slow turntable with pointer parallax. It is
// decoration (the site is the star): no navigation, no game. Reduced motion freezes
// it into a composed 3/4 pose. Mirrors glScene's renderer/loop/dispose, minus the
// world. three.js lives only in this small hero scene, keeping the entry light.

export interface HeroScene {
  dispose: () => void;
  /** test seam: force turntable angle and render one frame */
  _debugSetPose?: (rot: number) => void;
}

// "A" monogram, 5 wide × 7 tall (top row first). 1 = brick.
const GLYPH_A = [
  "01110",
  "10001",
  "10001",
  "11111",
  "10001",
  "10001",
  "10001"
];

export function createHeroScene(canvas: HTMLCanvasElement, quality: HeroQuality): HeroScene {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true, // sit over the page's light hero background
    antialias: quality.tier !== "low",
    powerPreference: "high-performance"
  });
  try {
    return init(canvas, renderer, quality);
  } catch (error) {
    renderer.dispose();
    throw error;
  }
}

function init(canvas: HTMLCanvasElement, renderer: THREE.WebGLRenderer, quality: HeroQuality): HeroScene {
  renderer.setPixelRatio(quality.dpr);
  renderer.setClearAlpha(0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = quality.tier !== "low";
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  camera.position.set(6.2, 6.4, 13);

  const studSeg = quality.tier === "high" ? 14 : quality.tier === "low" ? 8 : 12;
  const mats = makeBrickMaterials();

  // turntable group (baseplate + monument spin together)
  const turntable = new THREE.Group();
  scene.add(turntable);

  // ---- baseplate (matte white plate, one merged geometry) ----
  const baseBatch = new BrickBatcher(mats.matte, studSeg);
  baseBatch.add(16, 14, "plate", 0, -PLATE_H, 0, BRICK.white);
  const base = baseBatch.build(false);
  turntable.add(base.group);

  // ---- the "A" monument (glossy bricks, 2 deep), red with gold + azure accents ----
  const logoBatch = new BrickBatcher(mats.glossy, studSeg);
  const cols = GLYPH_A[0]!.length;
  const rowsN = GLYPH_A.length;
  for (let rTop = 0; rTop < rowsN; rTop += 1) {
    const line = GLYPH_A[rTop]!;
    for (let col = 0; col < cols; col += 1) {
      if (line[col] !== "1") continue;
      const gy = rowsN - 1 - rTop; // 0 = bottom
      const x = (col - (cols - 1) / 2) * U;
      const y = gy * BRICK_H; // base of this brick
      // Monochrome so the letterform reads; colour pop comes from the loose bricks.
      for (let d = 0; d < 2; d += 1) logoBatch.add(1, 1, "brick", x, y, -d * U, BRICK.red);
    }
  }
  const logo = logoBatch.build(renderer.shadowMap.enabled);
  logo.group.position.z = U * 0.5; // nudge toward camera on the plate
  turntable.add(logo.group);

  // a few loose accent bricks scattered on the plate (playful, premium)
  const propBatch = new BrickBatcher(mats.glossy, studSeg);
  const props: Array<[number, number, number, number]> = [
    [-5.2, 0, 3.4, BRICK.yellow],
    [4.9, 0, 3.1, BRICK.green],
    [-4.4, 0, -3.2, BRICK.blue],
    [5.4, 0, -2.6, BRICK.red]
  ];
  props.forEach(([x, , z, c], i) => propBatch.add(i % 2 ? 1 : 2, 1, "brick", x, 0, z, c, (i * Math.PI) / 3));
  const prop = propBatch.build(renderer.shadowMap.enabled);
  turntable.add(prop.group);

  // ---- lights: warm key + cool sky fill = clean studio contrast ----
  const hemiLight = new THREE.HemisphereLight(0xeaf4ff, 0xbfae95, 0.85);
  scene.add(hemiLight);
  const key = new THREE.DirectionalLight(0xfff2d6, 2.4);
  key.position.set(7, 11, 6);
  key.target.position.set(0, 3, 0);
  scene.add(key.target);
  if (renderer.shadowMap.enabled) {
    key.castShadow = true;
    key.shadow.mapSize.set(quality.tier === "high" ? 2048 : 1024, quality.tier === "high" ? 2048 : 1024);
    const c = key.shadow.camera;
    c.left = -10;
    c.right = 10;
    c.top = 12;
    c.bottom = -6;
    c.near = 1;
    c.far = 40;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
  }
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xbcd8ff, 0.5);
  rim.position.set(-8, 5, -6);
  scene.add(rim);

  // ---- state ----
  let disposed = false;
  let rafId = 0;
  let running = false;
  let last = 0;
  const frozen = quality.motionScale === 0;
  let spin = frozen ? -0.5 : -0.35; // composed 3/4 pose when frozen
  let reveal = frozen ? 1 : 0;
  const pointer = new THREE.Vector2(0, 0);
  const pointerTarget = new THREE.Vector2(0, 0);
  const camBase = camera.position.clone();
  const lookAt = new THREE.Vector3(0, 3.1, 0);
  let fpsAcc = 0;
  let fpsN = 0;

  const resize = (): void => {
    if (disposed) return;
    const w = Math.max(1, canvas.clientWidth || 1);
    const h = Math.max(1, canvas.clientHeight || 1);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", resize, { passive: true });
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  ro?.observe(canvas);
  resize();

  const onPointer = (e: PointerEvent): void => {
    pointerTarget.set((e.clientX / window.innerWidth - 0.5) * 2, (e.clientY / window.innerHeight - 0.5) * 2);
  };
  if (quality.parallax) window.addEventListener("pointermove", onPointer, { passive: true });

  const renderFrame = (dt: number): void => {
    if (reveal < 1) reveal = Math.min(1, reveal + dt / 0.9);
    const grow = frozen ? 1 : reveal * reveal * (3 - 2 * reveal);
    turntable.scale.setScalar(0.9 + 0.1 * grow);

    if (!frozen) spin -= dt * 0.18;
    turntable.rotation.y = spin;

    pointer.lerp(pointerTarget, 1 - Math.exp(-dt * 4));
    camera.position.set(camBase.x + pointer.x * 1.6, camBase.y - pointer.y * 1.1, camBase.z);
    camera.lookAt(lookAt);

    renderer.render(scene, camera);

    if (dt > 0 && dt < 0.5) {
      fpsAcc += dt;
      fpsN += 1;
      if (fpsN >= 90) {
        fpsAcc = 0;
        fpsN = 0;
      }
    }
  };

  const minFrame = 1000 / quality.maxFps;
  const loop = (t: number): void => {
    if (disposed || !running) return;
    const elapsed = t - last;
    if (elapsed >= minFrame - 0.5) {
      const dt = last === 0 ? 1 / quality.maxFps : Math.min(0.1, elapsed / 1000);
      last = t;
      renderFrame(dt);
    }
    rafId = window.requestAnimationFrame(loop);
  };
  const stop = (): void => {
    running = false;
    window.cancelAnimationFrame(rafId);
  };
  const start = (): void => {
    if (disposed || running || document.hidden) return;
    running = true;
    last = 0;
    rafId = window.requestAnimationFrame(loop);
  };
  const onVisibility = (): void => {
    if (document.hidden) stop();
    else start();
  };

  if (frozen) {
    // Reduced motion (the owner's machine): render one composed still and stop —
    // no rAF loop re-drawing an unchanging frame.
    renderFrame(1 / quality.maxFps);
  } else {
    document.addEventListener("visibilitychange", onVisibility);
    renderFrame(1 / quality.maxFps);
    start();
  }

  return {
    _debugSetPose: (rot: number) => {
      spin = rot;
      turntable.rotation.y = spin;
      turntable.scale.setScalar(1);
      renderFrame(1 / 60);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", resize);
      if (quality.parallax) window.removeEventListener("pointermove", onPointer);
      ro?.disconnect();
      base.dispose();
      logo.dispose();
      prop.dispose();
      mats.dispose();
      renderer.dispose();
      scene.clear();
    }
  };
}
