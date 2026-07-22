import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { buildOcean, MAX_ISLANDS } from "./ocean";
import { buildSky } from "./sky";
import { buildIslands } from "./islands";
import { buildShip } from "./props/ship";
import { buildFlora } from "./props/flora";
import { buildBrickCrates } from "./props/brickCrates";
import type { MachineMaterials } from "./machines/types";
import { mulberry32, hashStr } from "../../lib/seed";
import type { HeroQuality } from "../quality";

// ATELIER ADRIFT — a bright fantasy low-poly archipelago. A caravel carrying the
// workshop's da Vinci inventions (ornithopter + ballista) sails a faceted sea
// past scattered islands. The GL canvas is the opaque page background; the DOM
// catalog floats above. Scroll walks a camera spine across five chapters; the
// ship bobs on the real wave surface and its cargo machines animate on hover.

export interface GlScene {
  dispose: () => void;
  /** test seam: force chapter progress 0..4 and render one frame */
  _debugSetProgress?: (p: number) => void;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smooth = (v: number): number => v * v * (3 - 2 * v);

// Daytime palette (footer lerps toward golden hour).
const DAY = {
  domeTop: new THREE.Color(0x5fbff0),
  domeHorizon: new THREE.Color(0xd6f2ff),
  shallow: new THREE.Color(0x49c5d0),
  deep: new THREE.Color(0x1e6ca6),
  sky: new THREE.Color(0xd6f2ff),
  fog: new THREE.Color(0xcdeaf6),
  sun: new THREE.Color(0xfff4c6),
  sunDir: new THREE.Vector3(0.5, 0.72, 0.35).normalize()
};
const DUSK = {
  domeTop: new THREE.Color(0x3a6ea8),
  domeHorizon: new THREE.Color(0xffce93),
  shallow: new THREE.Color(0x3f9bb4),
  deep: new THREE.Color(0x2a5c8f),
  sky: new THREE.Color(0xffce93),
  fog: new THREE.Color(0xffdfaf),
  sun: new THREE.Color(0xffdd8a),
  sunDir: new THREE.Vector3(0.62, 0.3, 0.4).normalize()
};

export function createGlScene(canvas: HTMLCanvasElement, quality: HeroQuality): GlScene {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: false,
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

function init(canvas: HTMLCanvasElement, renderer: THREE.WebGLRenderer, quality: HeroQuality): GlScene {
  renderer.setPixelRatio(quality.dpr);
  renderer.setClearColor(DAY.domeHorizon, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = quality.tier !== "low";
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = DAY.domeHorizon.clone();
  scene.fog = new THREE.Fog(DAY.fog.clone(), 40, 210);
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 700);
  camera.position.set(-6, 5, 14);

  // ------------------------------------------------------------- materials
  const flat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0, ...extra });
  const materials: MachineMaterials = {
    wood: flat(0xb4884d),
    woodDark: flat(0x7a5230),
    brass: flat(0xc79a45, { roughness: 0.5, metalness: 0.2 }),
    canvas: flat(0xf4eedd, { side: THREE.DoubleSide, roughness: 0.92 }),
    rope: flat(0x9c7a46, { roughness: 0.95 }),
    iron: flat(0x3a3a42, { roughness: 0.6, metalness: 0.15 }),
    sail: flat(0xf4eedd, { side: THREE.DoubleSide, roughness: 0.9 })
  };

  // ------------------------------------------------------------- world
  const seed = hashStr("atelier-adrift-v1");
  const rand = mulberry32(seed);

  const ocean = buildOcean(quality);
  scene.add(ocean.mesh);

  const sky = buildSky(quality);
  scene.add(sky.group);

  const islands = buildIslands(materials, rand, MAX_ISLANDS);
  scene.add(islands.group);
  // feed shore rings into the ocean foam
  for (let i = 0; i < islands.shores.length && i < MAX_ISLANDS; i += 1) {
    ocean.uniforms.uIslands.value[i].copy(islands.shores[i]);
  }
  ocean.uniforms.uIslandCount.value = Math.min(islands.shores.length, MAX_ISLANDS);

  const flora = buildFlora(islands.placements, materials, rand);
  scene.add(flora.group);

  const ship = buildShip(materials);
  ship.group.position.set(0, 0.4, 0);
  ship.group.rotation.y = -0.35;
  scene.add(ship.group);
  // v2 BRICK UPDATE — studded toy-brick cargo crates ride on the deck.
  const brickCrates = buildBrickCrates();
  ship.group.add(brickCrates.group);
  // per-work cargo lift: the machines are the ship's cargo
  const cargo = ship.machines.map((mch) => mch.group);
  const cargoBaseY = cargo.map((g) => g.position.y);

  // ------------------------------------------------------------- whale (egg)
  const whale = buildWhale(materials);
  whale.group.visible = false;
  scene.add(whale.group);
  let sunClicks = 0;
  let whaleT = -1; // -1 idle; 0..1 breach timeline

  // Ship + machine meshes cast shadows onto the deck; ocean/sky/whale don't.
  if (renderer.shadowMap.enabled) {
    ship.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }

  // ------------------------------------------------------------- lights
  const hemi = new THREE.HemisphereLight(0xdff2ff, 0x2f6a55, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d6, 2.5);
  sun.position.copy(DAY.sunDir).multiplyScalar(60);
  sun.target.position.set(0, 0, 0);
  scene.add(sun.target);
  if (renderer.shadowMap.enabled) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const c = sun.shadow.camera;
    c.left = -16;
    c.right = 16;
    c.top = 16;
    c.bottom = -16;
    c.near = 1;
    c.far = 160;
    sun.shadow.bias = -0.0005;
  }
  scene.add(sun);

  // ------------------------------------------------------------- composer
  const useBloom = quality.tier !== "low";
  let composer: EffectComposer | null = null;
  let bloomPass: UnrealBloomPass | null = null;
  if (useBloom) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.26, 0.5, 0.85);
    composer.addPass(bloomPass);
  }

  // ------------------------------------------------------------- chapters
  const camPos = [
    new THREE.Vector3(-6, 5, 14),
    new THREE.Vector3(3, 2.4, 6.5),
    new THREE.Vector3(4.6, 1.7, 2.6),
    new THREE.Vector3(0, 15, 9),
    new THREE.Vector3(-1.5, 2.6, 11)
  ];
  const camLook = [
    new THREE.Vector3(0, 1.6, 0),
    new THREE.Vector3(0, 1.5, 0.5),
    new THREE.Vector3(2.4, 1.2, -1),
    new THREE.Vector3(0, 0, -6),
    new THREE.Vector3(0, 1.3, -34)
  ];

  let chapterTops: number[] = [0, 1000, 2000, 3000, 4000];
  const resolveChapters = (): void => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-chapter]"));
    if (els.length >= 2) {
      chapterTops = els
        .map((el) => el.getBoundingClientRect().top + window.scrollY)
        .sort((a, b) => a - b);
    }
    while (chapterTops.length < 5) chapterTops.push((chapterTops[chapterTops.length - 1] ?? 0) + 900);
  };
  const progressFromScroll = (): number => {
    const y = window.scrollY + window.innerHeight * 0.42;
    if (y <= chapterTops[0]) return 0;
    for (let i = 0; i < 4; i += 1) {
      if (y < chapterTops[i + 1]) {
        return i + clamp01((y - chapterTops[i]) / Math.max(1, chapterTops[i + 1] - chapterTops[i]));
      }
    }
    return 4;
  };

  // ------------------------------------------------------------- state
  let disposed = false;
  let rafId = 0;
  let running = false;
  let last = 0;
  let progress = 0;
  let forcedProgress: number | null = null;
  const frozen = quality.motionScale === 0;
  let reveal = frozen ? 1 : 0;
  let hoverDrive = 0;
  let hoverActive = false;
  let hoverPulse = 0;
  let goldMode = false;
  let firstFrame = true;
  let fpsAcc = 0;
  let fpsN = 0;
  let bloomDropped = false;
  const pointer = new THREE.Vector2(0.2, 0.12);
  const pointerTarget = new THREE.Vector2(0.2, 0.12);
  const ndc = new THREE.Vector2(-2, -2);
  const raycaster = new THREE.Raycaster();
  const tmpLook = new THREE.Vector3();
  const curLook = camLook[0].clone();
  const cScratch = { top: new THREE.Color(), horizon: new THREE.Color(), sky: new THREE.Color(), fog: new THREE.Color(), sun: new THREE.Color(), dir: new THREE.Vector3() };

  const resize = (): void => {
    if (disposed) return;
    const w = Math.max(1, canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, canvas.clientHeight || window.innerHeight);
    renderer.setSize(w, h, false);
    composer?.setSize(Math.floor(w / 2), Math.floor(h / 2));
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    resolveChapters();
  };
  window.addEventListener("resize", resize, { passive: true });
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  ro?.observe(document.documentElement);
  resize();

  const onPointer = (e: PointerEvent): void => {
    pointerTarget.set((e.clientX / window.innerWidth - 0.5) * 2, (e.clientY / window.innerHeight - 0.5) * 2);
    ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  };
  if (quality.parallax) window.addEventListener("pointermove", onPointer, { passive: true });

  const onClick = (e: MouseEvent): void => {
    const nx = (e.clientX / window.innerWidth) * 2 - 1;
    const ny = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
    if (raycaster.intersectObject(sky.sun, false).length > 0) {
      sunClicks += 1;
      if (sunClicks >= 3 && whaleT < 0) {
        whaleT = 0;
        sunClicks = 0;
      }
    }
  };
  window.addEventListener("click", onClick);

  const onWorkHover = (e: Event): void => {
    const idx = (e as CustomEvent<{ index: number | null }>).detail?.index;
    hoverActive = typeof idx === "number";
    if (hoverActive) hoverPulse = 1;
  };
  window.addEventListener("alice:work-hover", onWorkHover);

  // ------------------------------------------------------------- frame
  const renderFrame = (timestamp: number, dt: number): void => {
    const time = timestamp * 0.001 * quality.motionScale;
    const damp = 1 - Math.exp(-dt * 4.2);

    progress = forcedProgress ?? progressFromScroll();
    const ci = Math.min(3, Math.floor(progress));
    const ct = smooth(clamp01(progress - ci));

    if (reveal < 1) reveal = Math.min(1, reveal + dt / 1.4);
    ocean.uniforms.uReveal.value = frozen ? 1 : smooth(reveal);

    // Golden-hour blend only in the footer chapter.
    const dusk = smooth(clamp01((progress - 3.25) / 0.75));
    cScratch.top.copy(DAY.domeTop).lerp(DUSK.domeTop, dusk);
    cScratch.horizon.copy(DAY.domeHorizon).lerp(DUSK.domeHorizon, dusk);
    cScratch.sky.copy(DAY.sky).lerp(DUSK.sky, dusk);
    cScratch.fog.copy(DAY.fog).lerp(DUSK.fog, dusk);
    cScratch.sun.copy(DAY.sun).lerp(DUSK.sun, dusk);
    cScratch.dir.copy(DAY.sunDir).lerp(DUSK.sunDir, dusk).normalize();
    sky.setPalette(cScratch.top, cScratch.horizon, cScratch.sun);
    ocean.uniforms.uShallow.value.copy(DAY.shallow).lerp(DUSK.shallow, dusk);
    ocean.uniforms.uDeep.value.copy(DAY.deep).lerp(DUSK.deep, dusk);
    ocean.uniforms.uSky.value.copy(cScratch.sky);
    ocean.uniforms.uFogColor.value.copy(cScratch.fog);
    ocean.uniforms.uSunDir.value.copy(cScratch.dir);
    (scene.fog as THREE.Fog).color.copy(cScratch.fog);
    scene.background = cScratch.horizon;
    sun.color.copy(cScratch.sun);
    sun.position.copy(cScratch.dir).multiplyScalar(60);
    sky.sun.position.copy(cScratch.dir).multiplyScalar(180);

    // camera spine + parallax
    camera.position.lerpVectors(camPos[ci], camPos[Math.min(4, ci + 1)], ct);
    tmpLook.lerpVectors(camLook[ci], camLook[Math.min(4, ci + 1)], ct);
    pointer.lerp(pointerTarget, 1 - Math.exp(-dt * 4));
    const par = (1 - Math.max(0, progress - 3)) * 0.55;
    camera.position.x += pointer.x * par;
    camera.position.y += -pointer.y * par * 0.4;
    if (firstFrame) {
      curLook.copy(tmpLook);
      firstFrame = false;
    }
    curLook.lerp(tmpLook, damp);
    camera.lookAt(curLook);

    // ocean time + ship buoyancy — scale sampled height by the reveal factor so
    // the ship settles WITH the rising sea during load (matches the vertex shader).
    ocean.uniforms.uTime.value = time;
    const rev = ocean.uniforms.uReveal.value;
    const sx = ship.group.position.x;
    const sz = ship.group.position.z;
    const hC = ocean.waveHeight(sx, sz, time) * rev;
    const hBow = ocean.waveHeight(sx, sz + 2.4, time) * rev;
    const hStern = ocean.waveHeight(sx, sz - 2.4, time) * rev;
    const hPort = ocean.waveHeight(sx - 1.1, sz, time) * rev;
    const hStar = ocean.waveHeight(sx + 1.1, sz, time) * rev;
    ship.group.position.y = 0.15 + (hC + hBow + hStern) / 3;
    ship.group.rotation.x = (hStern - hBow) * 0.12;
    ship.group.rotation.z = -0.35 * 0 + (hPort - hStar) * 0.1; // roll around forward axis
    ocean.uniforms.uShip.value.set(sx, sz, 1);

    // cursor wake: project pointer onto the sea plane
    if (quality.parallax && ndc.x > -1.5) {
      raycaster.setFromCamera(ndc, camera);
      const t2 = -raycaster.ray.origin.y / (raycaster.ray.direction.y || -1e-3);
      if (t2 > 0 && t2 < 300) {
        const px = raycaster.ray.origin.x + raycaster.ray.direction.x * t2;
        const pz = raycaster.ray.origin.z + raycaster.ray.direction.z * t2;
        ocean.uniforms.uCursor.value.set(px, pz, 0.8, 0);
      }
    }

    // hover: cargo lifts, machines engage, foam pulse
    hoverDrive += ((hoverActive ? 1 : 0) - hoverDrive) * damp;
    hoverPulse = Math.max(0, hoverPulse - dt * 1.6);
    ocean.uniforms.uHoverPulse.value = hoverPulse;
    const worksT = progress > 0.4 && progress < 2 ? 1 - Math.abs(progress - 1.2) / 0.8 : 0;
    const drive = clamp01(0.18 + hoverDrive * 0.65 + clamp01(worksT) * 0.4);
    for (let i = 0; i < cargo.length; i += 1) {
      cargo[i].position.y = cargoBaseY[i] + hoverDrive * 0.18 * (i === 0 ? 1 : 0.7);
    }
    ship.update(time, drive);
    sky.update(time, quality.motionScale);

    // whale easter egg breach
    if (whaleT >= 0) {
      whaleT += dt / 2.6;
      const w = whaleT;
      whale.group.visible = w < 1;
      const arc = Math.sin(Math.min(w, 1) * Math.PI);
      whale.group.position.set(sx + 3.2, -6 + arc * 8.5, sz - 1.5);
      whale.group.rotation.z = -0.5 + arc * 1.1;
      whale.update(time);
      if (arc > 0.4) ocean.uniforms.uHoverPulse.value = Math.max(ocean.uniforms.uHoverPulse.value, arc * 0.7);
      if (w >= 1) {
        whaleT = -1;
        whale.group.visible = false;
      }
    }

    // footer DOM inversion class
    const wantGold = dusk > 0.55;
    if (wantGold !== goldMode) {
      goldMode = wantGold;
      document.documentElement.classList.toggle("gold-mode", goldMode);
    }

    if (composer && !bloomDropped) composer.render();
    else renderer.render(scene, camera);

    if (dt > 0 && dt < 0.5) {
      fpsAcc += dt;
      fpsN += 1;
      if (fpsN >= 90) {
        const fps = fpsN / fpsAcc;
        const floor2 = quality.maxFps === 30 ? 18 : 30;
        if (fps < floor2 && !bloomDropped) {
          bloomDropped = true;
          bloomPass?.dispose();
          composer?.dispose();
          bloomPass = null;
          composer = null;
        }
        fpsAcc = 0;
        fpsN = 0;
      }
    }
  };

  const minFrame = 1000 / quality.maxFps;
  const loop = (timestamp: number): void => {
    if (disposed || !running) return;
    const elapsed = timestamp - last;
    if (elapsed >= minFrame - 0.5) {
      const dt = last === 0 ? 1 / quality.maxFps : Math.min(0.1, elapsed / 1000);
      last = timestamp;
      renderFrame(timestamp, dt);
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
  document.addEventListener("visibilitychange", onVisibility);

  // Frozen (reduced motion): pick a composed wave phase so the bow lifts.
  renderFrame(frozen ? 1200 : performance.now(), 1 / quality.maxFps);
  start();

  return {
    _debugSetProgress: (p: number) => {
      forcedProgress = p;
      renderFrame(frozen ? 1200 : performance.now(), 1 / 30);
      forcedProgress = null;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", resize);
      window.removeEventListener("alice:work-hover", onWorkHover);
      window.removeEventListener("click", onClick);
      if (quality.parallax) window.removeEventListener("pointermove", onPointer);
      ro?.disconnect();
      document.documentElement.classList.remove("gold-mode");

      ocean.dispose();
      sky.dispose();
      islands.dispose();
      flora.dispose();
      brickCrates.dispose();
      whale.dispose();
      const geos = new Set<THREE.BufferGeometry>();
      const mats = new Set<THREE.Material>();
      scene.traverse((o) => {
        const d = o as THREE.Mesh;
        if (d.geometry) geos.add(d.geometry as THREE.BufferGeometry);
        const mm = d.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mm)) mm.forEach((x) => mats.add(x));
        else if (mm) mats.add(mm);
      });
      geos.forEach((g) => g.dispose());
      mats.forEach((mm) => mm.dispose());
      Object.values(materials).forEach((mm) => mm.dispose());
      bloomPass?.dispose();
      composer?.dispose();
      renderer.dispose();
      scene.clear();
    }
  };
}

// ---------------------------------------------------------------- whale
interface Whale {
  group: THREE.Group;
  update(time: number): void;
  dispose(): void;
}
function buildWhale(m: MachineMaterials): Whale {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3f5a7a, flatShading: true, roughness: 0.9, metalness: 0 });
  const bellyMat = new THREE.MeshStandardMaterial({ color: 0xcdd8e4, flatShading: true, roughness: 0.9, metalness: 0 });
  const bodyGeo = new THREE.IcosahedronGeometry(1.6, 1);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.scale.set(1, 0.8, 2.4);
  group.add(body);
  const bellyGeo = new THREE.IcosahedronGeometry(1.5, 1);
  const belly = new THREE.Mesh(bellyGeo, bellyMat);
  belly.scale.set(0.9, 0.5, 2.2);
  belly.position.y = -0.5;
  group.add(belly);
  const flukeGeo = new THREE.ConeGeometry(1.3, 0.5, 4);
  const fluke = new THREE.Mesh(flukeGeo, bodyMat);
  fluke.rotation.x = Math.PI / 2;
  fluke.rotation.z = Math.PI / 4;
  fluke.position.z = -3.4;
  fluke.scale.set(1.6, 0.3, 1);
  group.add(fluke);
  const finGeo = new THREE.ConeGeometry(0.6, 0.2, 4);
  for (const s of [-1, 1]) {
    const fin = new THREE.Mesh(finGeo, bodyMat);
    fin.position.set(s * 1.3, -0.2, 0.6);
    fin.rotation.z = (s * Math.PI) / 2.4;
    fin.scale.set(1.5, 0.3, 1);
    group.add(fin);
  }
  void m;
  return {
    group,
    update: (time: number) => {
      fluke.rotation.y = Math.sin(time * 3) * 0.25;
    },
    dispose: () => {
      bodyGeo.dispose();
      bellyGeo.dispose();
      flukeGeo.dispose();
      finGeo.dispose();
      bodyMat.dispose();
      bellyMat.dispose();
    }
  };
}
