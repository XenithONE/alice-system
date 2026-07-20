import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import type { HeroQuality } from "../quality";

// KINTSUGI — 金継のモノリス. One obsidian monolith repaired with molten gold
// seams, alone in a void. The GL canvas is the page background (opaque void):
// the DOM catalog floats above it. Scroll drives a camera spine through five
// chapters (hero / works / lab / prompts / footer); the monolith bisects at the
// lab and swallows the camera at the footer. Reduced motion freezes ambient
// drift but keeps the composed pose and scroll framing.

export interface GlScene {
  dispose: () => void;
  /** test seam: force chapter progress 0..4 and render one frame */
  _debugSetProgress?: (p: number) => void;
}

const VOID_BG = 0x0a0a0c;
const GOLD = 0xcdaa6d;
const BLOOM_GOLD = 0xf0d9a6;
const VERMILION = 0xfb3516;
const COBALT = 0x164cff;
const FOV = 42;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smooth = (v: number): number => v * v * (3 - 2 * v);

/** Deterministic value noise from position (no RNG: identical look every load). */
function vnoise(x: number, y: number, z: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}
function fbm(x: number, y: number, z: number): number {
  let amp = 0.5;
  let f = 1.4;
  let sum = 0;
  for (let o = 0; o < 4; o += 1) {
    sum += amp * (vnoise(x * f, y * f, z * f) - 0.5);
    amp *= 0.5;
    f *= 2.1;
  }
  return sum;
}

/** Split a geometry into (x<0, x>=0) halves by triangle centroid. */
function bisect(geo: THREE.BufferGeometry): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const src = geo.toNonIndexed();
  const pos = src.getAttribute("position") as THREE.BufferAttribute;
  const nor = src.getAttribute("normal") as THREE.BufferAttribute;
  const L: number[] = [];
  const R: number[] = [];
  const LN: number[] = [];
  const RN: number[] = [];
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const [p, n] = cx < 0 ? [L, LN] : [R, RN];
    for (let k = 0; k < 3; k += 1) {
      p.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
      n.push(nor.getX(i + k), nor.getY(i + k), nor.getZ(i + k));
    }
  }
  const make = (p: number[], n: number[]): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(n, 3));
    return g;
  };
  src.dispose();
  return [make(L, LN), make(R, RN)];
}

/** A crack path riding just above the displaced monolith surface. */
function seamCurve(seed: number, turns: number): THREE.CatmullRomCurve3 {
  const pts: THREE.Vector3[] = [];
  const n = 9;
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    const phi = (0.16 + 0.68 * t) * Math.PI;
    const theta = seed * 2.4 + turns * t * Math.PI + Math.sin(seed * 7 + t * 9) * 0.35;
    const dir = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.sin(theta)
    );
    const r = 1.1 * (1.035 + fbm(dir.x * 2 + seed, dir.y * 2, dir.z * 2) * 0.05);
    pts.push(new THREE.Vector3(dir.x * r, dir.y * r * 1.85, dir.z * r));
  }
  return new THREE.CatmullRomCurve3(pts);
}

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
  renderer.setClearColor(VOID_BG, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(VOID_BG);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 60);
  camera.position.set(-1.5, 0.25, 6.3);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04);
  scene.environment = environment.texture;
  room.dispose();
  pmrem.dispose();

  // ---------------------------------------------------------------- monolith
  const detail = quality.tier === "low" ? 14 : 26;
  // PolyhedronGeometry ships duplicated (flat-shaded) vertices — merge them so
  // the displaced surface shades SMOOTH obsidian, not disco facets.
  const base = mergeVertices(new THREE.IcosahedronGeometry(1.1, detail));
  {
    const p = base.getAttribute("position") as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i += 1) {
      v.fromBufferAttribute(p, i).normalize();
      const d = 1 + fbm(v.x * 1.7, v.y * 1.7, v.z * 1.7) * 0.14 + fbm(v.x * 4.4, v.y * 4.4, v.z * 4.4) * 0.008;
      p.setXYZ(i, v.x * 1.1 * d, v.y * 1.1 * d * 1.85, v.z * 1.1 * d);
    }
    base.computeVertexNormals();
  }
  const [leftGeo, rightGeo] = bisect(base);
  base.dispose();

  const obsidian = new THREE.MeshPhysicalMaterial({
    color: 0x0b0b0e,
    roughness: 0.68,
    metalness: 0.03,
    specularIntensity: 0.32,
    clearcoat: 0.16,
    clearcoatRoughness: 0.5,
    envMapIntensity: 0.14,
    sheen: 0.12,
    sheenColor: new THREE.Color(GOLD),
    sheenRoughness: 0.65
  });

  const root = new THREE.Group();
  root.name = "kintsugi-monolith";
  scene.add(root);
  const halfL = new THREE.Group();
  const halfR = new THREE.Group();
  halfL.add(new THREE.Mesh(leftGeo, obsidian));
  halfR.add(new THREE.Mesh(rightGeo, obsidian));
  root.add(halfL, halfR);

  // ---------------------------------------------------------------- seams
  const seamSpecs = [
    { seed: 1.3, turns: 1.7 },
    { seed: 2.9, turns: -1.2 },
    { seed: 4.1, turns: 2.3 },
    { seed: 5.6, turns: -1.9 },
    { seed: 0.4, turns: 1.1 }
  ];
  const seamSegments = quality.tier === "low" ? 72 : 128;
  interface Seam {
    mesh: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>;
    total: number;
    pulse: number;
  }
  const seams: Seam[] = [];
  for (let i = 0; i < seamSpecs.length; i += 1) {
    const spec = seamSpecs[i];
    const geo = new THREE.TubeGeometry(seamCurve(spec.seed, spec.turns), seamSegments, 0.021, 5, false);
    const mat = new THREE.MeshBasicMaterial({ color: BLOOM_GOLD, toneMapped: false });
    const mesh = new THREE.Mesh(geo, mat);
    const total = geo.index ? geo.index.count : 0;
    mesh.geometry.setDrawRange(0, 0); // SEAM IGNITION draws these in
    (mesh.position.x < 0 ? halfL : halfR).add(mesh);
    // assign by curve midpoint side
    const mid = seamCurve(spec.seed, spec.turns).getPoint(0.5);
    mesh.removeFromParent();
    (mid.x < 0 ? halfL : halfR).add(mesh);
    seams.push({ mesh, total, pulse: 0 });
  }

  // Inner gold core: visible through the footer crack approach.
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.92, 3),
    new THREE.MeshBasicMaterial({ color: 0x8a6c38, toneMapped: false, side: THREE.BackSide, transparent: true, opacity: 0 })
  );
  core.scale.y = 1.85;
  root.add(core);

  // ---------------------------------------------------------------- gold dust
  const dustCount = quality.tier === "low" ? 420 : 1300;
  const dustGeo = new THREE.BufferGeometry();
  {
    const arr = new Float32Array(dustCount * 3);
    const phase = new Float32Array(dustCount);
    for (let i = 0; i < dustCount; i += 1) {
      const r = 2.2 + vnoise(i * 0.31, 1, 7) * 6.5;
      const a = vnoise(i * 0.17, 3, 2) * Math.PI * 2;
      const y = (vnoise(i * 0.53, 5, 9) - 0.5) * 7;
      arr[i * 3] = Math.cos(a) * r;
      arr[i * 3 + 1] = y;
      arr[i * 3 + 2] = Math.sin(a) * r - 1.2;
      phase[i] = vnoise(i * 0.77, 2, 4) * Math.PI * 2;
    }
    dustGeo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    dustGeo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
  }
  const dustMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uGlobal: { value: 1 }, uColor: { value: new THREE.Color(GOLD) } },
    vertexShader: `
      attribute float aPhase;
      uniform float uTime;
      varying float vFade;
      void main() {
        vec3 p = position;
        p.y += sin(uTime * 0.35 + aPhase) * 0.22;
        p.x += cos(uTime * 0.22 + aPhase * 1.7) * 0.16;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float dist = -mv.z;
        vFade = smoothstep(14.0, 4.5, dist) * (0.35 + 0.65 * fract(aPhase * 3.1));
        gl_PointSize = 26.0 / dist;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uGlobal;
      varying float vFade;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = smoothstep(0.5, 0.05, length(uv));
        gl_FragColor = vec4(uColor, d * vFade * 0.55 * uGlobal);
      }`
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  scene.add(dust);

  // ---------------------------------------------------------------- lights
  const key = new THREE.SpotLight(0xfff2dc, 0, 40, 0.62, 0.55, 1.2);
  key.position.set(-6, 7, 5);
  key.target = root;
  scene.add(key);
  const fill = new THREE.HemisphereLight(0x2a3242, 0x05050a, 0.32);
  scene.add(fill);
  const torch = new THREE.PointLight(0xcdaa6d, 0, 9, 1.6);
  scene.add(torch);
  const crackLight = new THREE.PointLight(0xf0d9a6, 0, 12, 1.4);
  crackLight.position.set(-0.4, 0.4, 1.4);
  root.add(crackLight);
  const labRed = new THREE.PointLight(VERMILION, 0, 14, 1.6);
  labRed.position.set(-3.4, 0.6, 2.6);
  scene.add(labRed);
  const labBlue = new THREE.PointLight(COBALT, 0, 14, 1.6);
  labBlue.position.set(3.4, -0.2, 2.6);
  scene.add(labBlue);

  // Lab axis: a hairline gold plane between the halves.
  const axis = new THREE.Mesh(
    new THREE.PlaneGeometry(0.01, 4.6),
    new THREE.MeshBasicMaterial({ color: BLOOM_GOLD, toneMapped: false, transparent: true, opacity: 0 })
  );
  scene.add(axis);

  // ---------------------------------------------------------------- composer
  const size = new THREE.Vector2();
  renderer.getSize(size);
  const useBloom = quality.tier !== "low";
  let composer: EffectComposer | null = null;
  let bloomPass: UnrealBloomPass | null = null;
  if (useBloom) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.55, 0.5, 0.78);
    composer.addPass(bloomPass);
  }

  // ---------------------------------------------------------------- chapters
  // Camera keyframes per chapter: hero, works, lab, prompts, footer.
  const camPos = [
    new THREE.Vector3(-1.55, 0.3, 6.4),
    new THREE.Vector3(2.7, -0.25, 7.6),
    new THREE.Vector3(0, 0.15, 8.1),
    new THREE.Vector3(0.5, 2.7, 7.2),
    new THREE.Vector3(-0.15, 0.2, 3.0)
  ];
  const camLook = [
    new THREE.Vector3(-1.4, 0.05, 0),
    new THREE.Vector3(3.7, 0.1, 0),
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.1, 0.7, 0),
    new THREE.Vector3(-0.3, 0.25, 0)
  ];
  const keyIntensity = [26, 13, 18, 10, 6];
  const dustFactor = [1, 0.75, 0.35, 0.9, 0.2];

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

  // ---------------------------------------------------------------- state
  let disposed = false;
  let rafId = 0;
  let running = false;
  let last = 0;
  let progress = 0;
  let forcedProgress: number | null = null;
  let ignition = quality.motionScale === 0 ? 1 : 0;
  let hoverSeam = -1;
  let goldMode = false;
  let fpsAcc = 0;
  let fpsN = 0;
  let bloomDropped = false;
  const pointer = new THREE.Vector2(0.3, 0.2);
  const pointerTarget = new THREE.Vector2(0.3, 0.2);
  const tmpLook = new THREE.Vector3();
  const curLook = camLook[0].clone();

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
  };
  if (quality.parallax) window.addEventListener("pointermove", onPointer, { passive: true });

  const onWorkHover = (e: Event): void => {
    const idx = (e as CustomEvent<{ index: number | null }>).detail?.index;
    hoverSeam = typeof idx === "number" ? idx % seams.length : -1;
  };
  window.addEventListener("alice:work-hover", onWorkHover);

  // ---------------------------------------------------------------- frame
  const renderFrame = (timestamp: number, dt: number): void => {
    const time = timestamp * 0.001 * quality.motionScale;
    const damp = 1 - Math.exp(-dt * 4.2);

    progress = forcedProgress ?? progressFromScroll();
    const ci = Math.min(3, Math.floor(progress));
    const ct = smooth(clamp01(progress - ci));

    if (ignition < 1) ignition = Math.min(1, ignition + dt / 1.25);
    const ign = smooth(ignition);

    // seams draw in + pulse
    for (let i = 0; i < seams.length; i += 1) {
      const s = seams[i];
      const local = clamp01(ign * 1.6 - i * 0.12);
      s.mesh.geometry.setDrawRange(0, Math.floor(s.total * local));
      const target = hoverSeam === i ? 1 : 0;
      s.pulse += (target - s.pulse) * damp;
      const breathe = 3 <= progress && progress < 4 ? 0.25 + 0.25 * Math.sin(time * 1.6 + i) : 0;
      const footerBoost = Math.max(0, progress - 3) * 1.4;
      (s.mesh.material as THREE.MeshBasicMaterial).color
        .setHex(BLOOM_GOLD)
        .multiplyScalar(1.35 + s.pulse * 1.2 + breathe + footerBoost);
    }

    // ignition light flicker
    const flick = ign < 1 ? (vnoise(timestamp * 0.05, 1, 1) > 0.4 ? 1 : 0.25) : 1;
    const keyTarget = THREE.MathUtils.lerp(keyIntensity[ci], keyIntensity[Math.min(4, ci + 1)], ct);
    key.intensity += (keyTarget * ign * flick - key.intensity) * damp;

    // camera spine
    camera.position.lerpVectors(camPos[ci], camPos[Math.min(4, ci + 1)], ct);
    tmpLook.lerpVectors(camLook[ci], camLook[Math.min(4, ci + 1)], ct);
    // pointer parallax (fades toward footer)
    pointer.lerp(pointerTarget, 1 - Math.exp(-dt * 4));
    const par = (1 - Math.max(0, progress - 3)) * 0.32;
    camera.position.x += pointer.x * par;
    camera.position.y += -pointer.y * par * 0.6;
    curLook.lerp(tmpLook, damp);
    camera.lookAt(curLook);

    // ambient drift
    root.rotation.y = Math.sin(time * 0.11) * 0.05 + time * 0.014;
    root.rotation.z = Math.sin(time * 0.07) * 0.02;

    // lab bisection
    const split = smooth(clamp01((progress - 1.55) / 0.9)) * (1 - smooth(clamp01((progress - 2.7) / 0.6)));
    halfL.position.x = -1.15 * split;
    halfR.position.x = 1.15 * split;
    labRed.intensity += (split * 70 - labRed.intensity) * damp;
    labBlue.intensity += (split * 70 - labBlue.intensity) * damp;
    (axis.material as THREE.MeshBasicMaterial).opacity += (split * 0.85 - (axis.material as THREE.MeshBasicMaterial).opacity) * damp;

    // works crack light + torch
    const worksT = ci === 0 ? ct : ci >= 1 && progress < 2 ? 1 - clamp01(progress - 1.7) : 0;
    crackLight.intensity += ((worksT + (hoverSeam >= 0 ? 1.4 : 0)) * 16 * ign - crackLight.intensity) * damp;
    if (quality.parallax) {
      torch.position.set(pointer.x * 4.2, -pointer.y * 3.2, 3.4);
      torch.intensity += (11 * ign - torch.intensity) * damp;
    }

    // footer swallow
    const swallow = smooth(clamp01((progress - 3.2) / 0.8));
    (core.material as THREE.MeshBasicMaterial).opacity += (swallow * 0.9 - (core.material as THREE.MeshBasicMaterial).opacity) * damp;
    fill.intensity = 0.55 + swallow * 0.8;
    const wantGold = swallow > 0.55;
    if (wantGold !== goldMode) {
      goldMode = wantGold;
      document.documentElement.classList.toggle("gold-mode", goldMode);
    }

    // dust
    (dustMat.uniforms.uTime as { value: number }).value = time;
    const dustT = THREE.MathUtils.lerp(dustFactor[ci], dustFactor[Math.min(4, ci + 1)], ct);
    dust.visible = dustT > 0.05;
    (dustMat.uniforms.uGlobal as { value: number }).value = dustT;

    if (composer && !bloomDropped) composer.render();
    else renderer.render(scene, camera);

    // FPS ladder: sustained low frame rate drops bloom permanently. Accumulate
    // frame TIME (not 1/dt — the harmonic-mean bias hides bimodal jank), and
    // keep the floor below the frame cap so a healthy 30fps-capped session
    // (reduced motion) never trips it.
    if (dt > 0 && dt < 0.5) {
      fpsAcc += dt;
      fpsN += 1;
      if (fpsN >= 90) {
        const fps = fpsN / fpsAcc;
        const floor = quality.maxFps === 30 ? 18 : 30;
        if (fps < floor && !bloomDropped) {
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

  renderFrame(performance.now(), 1 / quality.maxFps);
  start();

  return {
    _debugSetProgress: (p: number) => {
      forcedProgress = p;
      renderFrame(performance.now(), 1 / 30);
      forcedProgress = null;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", resize);
      window.removeEventListener("alice:work-hover", onWorkHover);
      if (quality.parallax) window.removeEventListener("pointermove", onPointer);
      ro?.disconnect();
      document.documentElement.classList.remove("gold-mode");

      const geos = new Set<THREE.BufferGeometry>();
      const mats = new Set<THREE.Material>();
      scene.traverse((o) => {
        const d = o as THREE.Mesh;
        if (d.geometry) geos.add(d.geometry as THREE.BufferGeometry);
        const m = d.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(m)) m.forEach((x) => mats.add(x));
        else if (m) mats.add(m);
      });
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      bloomPass?.dispose();
      composer?.dispose();
      environment.dispose();
      renderer.dispose();
      scene.clear();
    }
  };
}
