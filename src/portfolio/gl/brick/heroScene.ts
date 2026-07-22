import * as THREE from "three";
import type { HeroQuality } from "../../quality";
import { U, PLATE_H, BRICK, BrickBatcher, buildBrickGeo, makeBrickMaterials } from "./brickKit";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// BRICK GALLERY hero — the 13 works themselves, as floating toy-brick framed
// panels (cover art on a studded white brick frame), arranged in a three-tier
// salon wall over a studded baseplate, with the red brick "A" landmark turning
// slowly at stage right. Hover lifts a panel; click opens that work's detail
// dialog. This IS the portfolio in 3D — the catalog below stays the browse path.
//
// Robustness: reduced-motion runs NO rAF loop but re-renders one frame on every
// resize / texture arrival / hover change (a resize after the single boot frame
// used to clear the GL buffer and leave the hero blank — the bug this replaces).

export interface HeroWorkItem {
  id: string;
  title: string;
  cover: string; // absolute (BASE-resolved) texture URL
}

export interface HeroSceneEvents {
  onHover(id: string | null): void;
  onSelect(id: string): void;
}

export interface HeroScene {
  dispose: () => void;
  /** QA seam: advance the timeline (seconds), render once, return canvas PNG.
   *  Lets the capture-verify loop see the settled composition even when the
   *  page is hidden and no rAF loop is running. */
  captureFrame: (advance?: number) => string;
}

// "A" monogram, 5 wide × 7 tall (top row first). 1 = brick.
const GLYPH_A = ["01110", "10001", "10001", "11111", "10001", "10001", "10001"];

// Panel proportions match the 16:10 cover crop.
const PW = 3.9;
const PH = PW * (10 / 16);
const PD = 0.5;
const FRAME = 0.34; // white brick border visible around the art

// 13 wall slots: rows of 5 / 4 / 4, stepping up and back like stadium seating.
// Order matches the works array passed in (BrickHero curates that order).
const COL = 4.35;
const SLOTS: Array<{ x: number; y: number; z: number }> = [
  // front row (5)
  { x: 0, y: 1.95, z: 3.6 },
  { x: -COL, y: 1.95, z: 3.6 },
  { x: COL, y: 1.95, z: 3.6 },
  { x: -2 * COL, y: 1.95, z: 3.6 },
  { x: 2 * COL, y: 1.95, z: 3.6 },
  // middle row (4)
  { x: -0.5 * COL, y: 4.75, z: 0.9 },
  { x: 0.5 * COL, y: 4.75, z: 0.9 },
  { x: -1.5 * COL, y: 4.75, z: 0.9 },
  { x: 1.5 * COL, y: 4.75, z: 0.9 },
  // top row (4)
  { x: -0.5 * COL, y: 7.55, z: -1.8 },
  { x: 0.5 * COL, y: 7.55, z: -1.8 },
  { x: -1.5 * COL, y: 7.55, z: -1.8 },
  { x: 1.5 * COL, y: 7.55, z: -1.8 }
];

interface Panel {
  group: THREE.Group;
  cover: THREE.MeshBasicMaterial;
  baseY: number;
  phase: number;
  lift: number; // animated 0..1
  reveal: number; // animated 0..1
  delay: number;
  id: string;
}

export function createHeroScene(
  canvas: HTMLCanvasElement,
  quality: HeroQuality,
  works: HeroWorkItem[],
  events: HeroSceneEvents
): HeroScene {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true, // sit over the page's light hero background
    antialias: quality.tier !== "low",
    powerPreference: "high-performance"
  });
  try {
    return init(canvas, renderer, quality, works, events);
  } catch (error) {
    renderer.dispose();
    throw error;
  }
}

function init(
  canvas: HTMLCanvasElement,
  renderer: THREE.WebGLRenderer,
  quality: HeroQuality,
  works: HeroWorkItem[],
  events: HeroSceneEvents
): HeroScene {
  renderer.setPixelRatio(quality.dpr);
  renderer.setClearAlpha(0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = quality.tier !== "low";
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xe7edf4, 34, 62);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 220);

  const studSeg = quality.tier === "high" ? 12 : quality.tier === "low" ? 8 : 10;
  const mats = makeBrickMaterials();
  const disposables: Array<{ dispose(): void }> = [];

  const root = new THREE.Group();
  scene.add(root);

  // ---- studded baseplate ----
  const baseBatch = new BrickBatcher(mats.matte, quality.tier === "high" ? 10 : 8);
  baseBatch.add(46, 34, "plate", 0, -PLATE_H, -2, BRICK.white);
  const base = baseBatch.build(false);
  root.add(base.group);
  disposables.push(base);

  // ---- the red "A" landmark, stage right, on its own slow turntable ----
  const turntable = new THREE.Group();
  turntable.position.set(13.0, 0, -5.5);
  turntable.scale.setScalar(0.95);
  root.add(turntable);
  const logoBatch = new BrickBatcher(mats.glossy, studSeg);
  const cols = GLYPH_A[0]!.length;
  const rowsN = GLYPH_A.length;
  for (let rTop = 0; rTop < rowsN; rTop += 1) {
    const line = GLYPH_A[rTop]!;
    for (let col = 0; col < cols; col += 1) {
      if (line[col] !== "1") continue;
      const gy = rowsN - 1 - rTop;
      const x = (col - (cols - 1) / 2) * U;
      for (let d = 0; d < 2; d += 1) logoBatch.add(1, 1, "brick", x, gy * (PLATE_H * 3), -d * U, BRICK.red);
    }
  }
  const logo = logoBatch.build(renderer.shadowMap.enabled);
  turntable.add(logo.group);
  disposables.push(logo);

  // ---- loose colour bricks, stage left + scattered on the plate ----
  const propBatch = new BrickBatcher(mats.glossy, studSeg);
  const props: Array<[number, number, number, number, number, number]> = [
    [-13.4, 0, -2.2, BRICK.yellow, 2, 0.4],
    [-12.6, PLATE_H * 3, -2.4, BRICK.azure, 1, -0.3],
    [-14.2, 0, 1.2, BRICK.green, 1, 0.9],
    [8.6, 0, 6.4, BRICK.blue, 1, 0.5],
    [-8.9, 0, 6.8, BRICK.orange, 1, -0.7],
    [12.2, 0, 4.2, BRICK.lime, 1, 1.2]
  ];
  props.forEach(([x, y, z, c, fx, rot]) => propBatch.add(fx, 1, "brick", x, y, z, c, rot));
  const prop = propBatch.build(renderer.shadowMap.enabled);
  root.add(prop.group);
  disposables.push(prop);

  // ---- floating mini bricks (ambient depth) ----
  const miniGeo = buildBrickGeo(1, 1, "brick", studSeg);
  const MINIS: Array<[number, number, number, number]> = [
    [-9.5, 6.4, 5.2, BRICK.red],
    [10.4, 8.6, 1.4, BRICK.yellow],
    [-11.8, 9.2, -0.6, BRICK.azure],
    [7.2, 10.4, -2.8, BRICK.green],
    [-5.6, 10.8, -3.6, BRICK.orange],
    [12.6, 5.6, 4.6, BRICK.medAzure]
  ];
  const minis = new THREE.InstancedMesh(miniGeo, mats.glossy, MINIS.length);
  minis.castShadow = renderer.shadowMap.enabled;
  const miniDummy = new THREE.Object3D();
  MINIS.forEach(([, , , c], i) => minis.setColorAt(i, new THREE.Color(c)));
  if (minis.instanceColor) minis.instanceColor.needsUpdate = true;
  root.add(minis);
  const updateMinis = (t: number): void => {
    for (let i = 0; i < MINIS.length; i += 1) {
      const [x, y, z] = MINIS[i]!;
      miniDummy.position.set(x, y + Math.sin(t * 0.6 + i * 2.1) * 0.35, z);
      miniDummy.rotation.set(t * 0.12 + i, t * 0.21 + i * 1.7, 0);
      miniDummy.scale.setScalar(0.72);
      miniDummy.updateMatrix();
      minis.setMatrixAt(i, miniDummy.matrix);
    }
    minis.instanceMatrix.needsUpdate = true;
  };

  // ---- the 13 work panels ----
  // shared frame geometry: rounded brick slab + 4 studs on the top edge
  const slab = new RoundedBoxGeometry(PW, PH, PD, 2, 0.05);
  const frameParts: THREE.BufferGeometry[] = [slab];
  for (let i = 0; i < 4; i += 1) {
    const stud = new THREE.CylinderGeometry(U * 0.24, U * 0.24, U * 0.16, studSeg);
    stud.translate((i - 1.5) * U, PH / 2 + U * 0.08, 0);
    frameParts.push(stud);
  }
  const frameNorm = frameParts.map((p) => (p.index ? p.toNonIndexed() : p));
  const frameGeo = mergeGeometries(frameNorm, false);
  new Set([...frameParts, ...frameNorm]).forEach((p) => p.dispose());
  if (!frameGeo) throw new Error("panel frame merge failed");
  const coverGeo = new THREE.PlaneGeometry(PW - FRAME, PH - FRAME);

  const texLoader = new THREE.TextureLoader();
  const textures: THREE.Texture[] = [];
  const panels: Panel[] = [];
  const pickMeshes: THREE.Mesh[] = [];
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  // Weak / coarse devices don't need 13 full-res covers on the GPU (~70 MB
  // with mips) — downscale to 640×400 (~18 MB) before upload.
  const smallCovers = quality.tier === "low" || quality.coarse;
  // Hover picking runs against STATIC invisible proxies at each slot, not the
  // lifted meshes — raycasting the visual panel makes the target move away
  // from the pointer and oscillate along each panel's bottom edge.
  const proxyGeo = new THREE.PlaneGeometry(PW + 0.1, PH + 0.5);
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });

  works.slice(0, SLOTS.length).forEach((work, i) => {
    const slot = SLOTS[i]!;
    const group = new THREE.Group();
    group.position.set(slot.x, slot.y, slot.z);
    group.rotation.y = -slot.x * 0.012; // gentle turn toward centre

    const body = new THREE.Mesh(frameGeo, mats.glossy);
    body.castShadow = renderer.shadowMap.enabled;
    body.receiveShadow = true;
    group.add(body);

    const coverMat = new THREE.MeshBasicMaterial({ color: 0xdfe5ec, toneMapped: false, fog: false });
    const cover = new THREE.Mesh(coverGeo, coverMat);
    cover.position.z = PD / 2 + 0.006;
    group.add(cover);

    const proxy = new THREE.Mesh(proxyGeo, proxyMat);
    proxy.position.set(slot.x, slot.y + 0.18, slot.z + PD / 2);
    proxy.rotation.y = -slot.x * 0.012;
    proxy.userData.workId = work.id;
    root.add(proxy);
    pickMeshes.push(proxy);

    texLoader.load(work.cover, (tex) => {
      if (disposed) {
        tex.dispose();
        return;
      }
      let finalTex: THREE.Texture = tex;
      if (smallCovers) {
        const img = tex.image as HTMLImageElement | undefined;
        const cv = document.createElement("canvas");
        cv.width = 640;
        cv.height = 400;
        const ctx = cv.getContext("2d");
        if (img && ctx) {
          ctx.drawImage(img, 0, 0, 640, 400);
          finalTex = new THREE.CanvasTexture(cv);
          tex.dispose();
        }
      }
      finalTex.colorSpace = THREE.SRGBColorSpace;
      finalTex.anisotropy = maxAniso;
      textures.push(finalTex);
      coverMat.map = finalTex;
      coverMat.color.set(0xffffff);
      coverMat.needsUpdate = true;
      requestRender();
    });

    root.add(group);
    panels.push({
      group,
      cover: coverMat,
      baseY: slot.y,
      phase: i * 1.73,
      lift: 0,
      reveal: 0,
      delay: 0.25 + i * 0.055,
      id: work.id
    });
  });

  // ---- lights: warm key + cool sky fill = clean studio contrast ----
  const hemiLight = new THREE.HemisphereLight(0xeaf4ff, 0xbfae95, 0.85);
  scene.add(hemiLight);
  const key = new THREE.DirectionalLight(0xfff2d6, 2.3);
  key.position.set(9, 15, 10);
  key.target.position.set(0, 3, 0);
  scene.add(key.target);
  if (renderer.shadowMap.enabled) {
    key.castShadow = true;
    const res = quality.tier === "high" ? 2048 : 1024;
    key.shadow.mapSize.set(res, res);
    const c = key.shadow.camera;
    c.left = -17;
    c.right = 17;
    c.top = 16;
    c.bottom = -8;
    c.near = 1;
    c.far = 60;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
  }
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xbcd8ff, 0.5);
  rim.position.set(-9, 7, -7);
  scene.add(rim);

  // ---- state ----
  let disposed = false;
  let rafId = 0;
  let running = false;
  let last = 0;
  const frozen = quality.motionScale === 0;
  let time = frozen ? 7.3 : 0; // frozen: fixed composed instant (varied bob phases)
  let elapsedLife = frozen ? 10 : 0; // reveal timeline
  const pointer = new THREE.Vector2(0, 0);
  const pointerTarget = new THREE.Vector2(0, 0);
  const camBase = new THREE.Vector3(0, 6.2, 18);
  const lookAt = new THREE.Vector3(0, 4.2, 0);
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2(2, 2); // offscreen until first move
  let pointerInside = false;
  let hoveredId: string | null = null;

  const frameCamera = (): void => {
    // Fit the wall PLANE-ACCURATELY: each constraint is measured at the z of
    // the row it bounds (the front row sits 3.6 toward the camera).
    const aspect = camera.aspect;
    camera.fov = aspect < 0.9 ? 55 : 40;
    const vHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const hHalf = vHalf * aspect;
    const frontZ = SLOTS[0]!.z;
    const topZ = SLOTS[9]!.z;
    const halfW = 2 * COL + PW / 2 + 0.7;
    const topY = SLOTS[9]!.y + PH / 2 + 0.55;
    const botY = SLOTS[0]!.y - PH / 2 - 0.35;
    lookAt.y = aspect < 0.9 ? 4.6 : 3.9;
    const dW = frontZ + halfW / hHalf;
    const dTop = topZ + (topY - lookAt.y) / vHalf;
    const dBot = frontZ + (lookAt.y - botY) / vHalf;
    const dist = Math.min(27, Math.max(14, dW, dTop, dBot) + 0.4);
    camBase.set(0, aspect < 0.9 ? 6.6 : 6.0, dist);
    camera.updateProjectionMatrix();
  };

  const resize = (): void => {
    if (disposed) return;
    const w = Math.max(1, canvas.clientWidth || 1);
    const h = Math.max(1, canvas.clientHeight || 1);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    frameCamera();
    // Frozen mode must never leave a cleared buffer on screen — and rAF may be
    // suspended (hidden tab), so redraw synchronously rather than scheduling.
    if (frozen) renderFrame(0);
    else requestRender();
  };

  const setPointerFromEvent = (e: PointerEvent | MouseEvent): void => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    pointerNdc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -(((e.clientY - rect.top) / rect.height) * 2 - 1));
    pointerTarget.set(pointerNdc.x, -pointerNdc.y);
  };

  const pickWork = (): string | null => {
    if (!pointerInside) return null;
    raycaster.setFromCamera(pointerNdc, camera);
    const hit = raycaster.intersectObjects(pickMeshes, false)[0];
    return hit ? ((hit.object.userData.workId as string) ?? null) : null;
  };

  const applyHover = (id: string | null): void => {
    if (id === hoveredId) return;
    hoveredId = id;
    // The site's custom cursor (html.cursor-on) hides the native cursor; an
    // inline style would resurrect it ON TOP of the custom one (double cursor
    // — a regression this site fixed once before). Only steer the native
    // cursor when CursorFX is not active. Checked at call time: it mounts async.
    if (!document.documentElement.classList.contains("cursor-on")) {
      canvas.style.cursor = id ? "pointer" : "";
    }
    events.onHover(id);
    if (frozen) {
      // no loop: settle lifts instantly and redraw once
      panels.forEach((p) => {
        p.lift = p.id === id ? 1 : 0;
      });
      requestRender();
    }
  };

  const onPointerMove = (e: PointerEvent): void => {
    setPointerFromEvent(e);
    pointerInside = true;
    if (frozen) applyHover(pickWork());
  };
  const onPointerLeave = (): void => {
    pointerInside = false;
    pointerNdc.set(2, 2);
    pointerTarget.set(0, 0);
    applyHover(null);
  };
  let downPt: { x: number; y: number } | null = null;
  const onPointerDown = (e: PointerEvent): void => {
    downPt = e.button === 0 || e.pointerType !== "mouse" ? { x: e.clientX, y: e.clientY } : null;
  };
  const onClick = (e: MouseEvent): void => {
    // Releasing a drag / scroll gesture over a panel must not select it.
    const moved = !downPt || Math.hypot(e.clientX - downPt.x, e.clientY - downPt.y) > 7;
    downPt = null;
    if (moved) return;
    setPointerFromEvent(e);
    pointerInside = true;
    const id = pickWork();
    // Clear the pick state BEFORE opening the dialog — under the modal no
    // pointerleave fires, and on touch the hover would otherwise stick forever.
    pointerInside = false;
    pointerNdc.set(2, 2);
    pointerTarget.set(0, 0);
    applyHover(null);
    if (id) events.onSelect(id);
  };
  canvas.addEventListener("pointermove", onPointerMove, { passive: true });
  canvas.addEventListener("pointerleave", onPointerLeave, { passive: true });
  canvas.addEventListener("pointerdown", onPointerDown, { passive: true });
  canvas.addEventListener("click", onClick);

  window.addEventListener("resize", resize, { passive: true });
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  ro?.observe(canvas);

  const renderFrame = (dt: number): void => {
    if (!frozen) {
      time += dt;
      elapsedLife += dt;
      applyHover(pickWork());
    }

    // panels: staggered reveal, idle bob, hover lift
    for (const p of panels) {
      const rt = Math.min(1, Math.max(0, (elapsedLife - p.delay) / 0.55));
      p.reveal = rt * rt * (3 - 2 * rt);
      const target = p.id === hoveredId ? 1 : 0;
      p.lift = frozen ? p.lift : p.lift + (target - p.lift) * Math.min(1, dt * 9);
      const bob = Math.sin(time * 0.8 + p.phase) * 0.11 * quality.motionScale;
      p.group.position.y = p.baseY + bob + p.lift * 0.5;
      const s = p.reveal * (1 + 0.06 * Math.sin(Math.PI * Math.min(1, p.reveal)) + p.lift * 0.05);
      p.group.scale.setScalar(Math.max(0.0001, s));
      p.group.rotation.x = -0.02 - p.lift * 0.05;
    }

    turntable.rotation.y = frozen ? -0.5 : time * 0.22;
    root.rotation.y = Math.sin(time * 0.1) * 0.03 * quality.motionScale;
    updateMinis(time);

    pointer.lerp(pointerTarget, frozen ? 1 : 1 - Math.exp(-dt * 4));
    const px = quality.parallax ? pointer.x : 0;
    const py = quality.parallax ? pointer.y : 0;
    const swayX = Math.sin(time * 0.16) * 0.7 * quality.motionScale;
    const swayY = Math.cos(time * 0.13) * 0.3 * quality.motionScale;
    camera.position.set(camBase.x + swayX + px * 1.5, camBase.y + swayY - py * 0.9, camBase.z);
    camera.lookAt(lookAt);

    renderer.render(scene, camera);
  };

  // frozen mode renders single frames on demand (coalesced per rAF)
  let framePending = false;
  function requestRender(): void {
    if (disposed || (!frozen && running) || framePending) return;
    framePending = true;
    window.requestAnimationFrame(() => {
      framePending = false;
      if (!disposed) renderFrame(0);
    });
  }

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
    if (disposed || running || document.hidden || !inView) return;
    running = true;
    last = 0;
    rafId = window.requestAnimationFrame(loop);
  };
  const onVisibility = (): void => {
    if (document.hidden) stop();
    else start();
  };
  // Don't keep rendering the heaviest scene on the page once the visitor has
  // scrolled down to the catalog — gate the loop on hero visibility.
  let inView = true;
  const io =
    typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(
          (entries) => {
            const e = entries[entries.length - 1];
            inView = Boolean(e && e.isIntersecting);
            if (frozen) return;
            if (inView) start();
            else stop();
          },
          { rootMargin: "160px 0px" }
        )
      : null;
  io?.observe(canvas);

  resize();
  if (frozen) {
    renderFrame(0);
  } else {
    document.addEventListener("visibilitychange", onVisibility);
    renderFrame(1 / quality.maxFps);
    start();
  }

  return {
    captureFrame: (advance = 0) => {
      renderFrame(Math.max(0, advance));
      return canvas.toDataURL("image/png");
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("click", onClick);
      canvas.style.cursor = "";
      ro?.disconnect();
      io?.disconnect();
      disposables.forEach((d) => d.dispose());
      panels.forEach((p) => p.cover.dispose());
      textures.forEach((t) => t.dispose());
      minis.dispose();
      miniGeo.dispose();
      frameGeo.dispose();
      coverGeo.dispose();
      proxyGeo.dispose();
      proxyMat.dispose();
      mats.dispose();
      renderer.dispose();
      scene.clear();
    }
  };
}
