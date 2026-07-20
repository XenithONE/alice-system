import * as THREE from "three";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { buildOrnithopter } from "./machines/ornithopter";
import { buildBallista } from "./machines/ballista";
import type { MachineMaterials } from "./machines/types";
import type { HeroQuality } from "../quality";

// THE ATELIER — Leonardo protocol. A dark workshop-museum: two mechanical
// reconstructions (da Vinci ornithopter, giant ballista) in real PBR timber and
// brass under warm exhibit light. The GL canvas is the opaque page background;
// the DOM catalog floats above. Scroll walks a camera spine through five
// chapters; the machines' mechanisms are driven by scroll and work-row hover.

export interface GlScene {
  dispose: () => void;
  /** test seam: force chapter progress 0..4 and render one frame */
  _debugSetProgress?: (p: number) => void;
}

const VOID_BG = 0x0a0a0c;
const BASE = import.meta.env.BASE_URL;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smooth = (v: number): number => v * v * (3 - 2 * v);

function vnoise(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Radial soft-shadow texture for cheap grounded contact shadows. */
function contactShadowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(0,0,0,0.62)");
    g.addColorStop(0.55, "rgba(0,0,0,0.28)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(canvas);
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
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = quality.tier !== "low";
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(VOID_BG);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 80);
  camera.position.set(-1.6, 1.1, 7.2);

  // ------------------------------------------------------------- materials
  const texLoader = new THREE.TextureLoader();
  const loadedTextures: THREE.Texture[] = [];
  const tex = (file: string, srgb: boolean, repeat = 1): THREE.Texture => {
    const t = texLoader.load(BASE + "assets/pbr/" + file, undefined, undefined, () => {
      // A 404 diffuse map would render the material black; observability only —
      // the material still has plausible base colors underneath.
      if (import.meta.env.DEV) console.warn("[atelier] texture missing:", file);
    });
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    loadedTextures.push(t);
    return t;
  };

  const wood = new THREE.MeshStandardMaterial({
    map: tex("brown_planks_09_diff.jpg", true, 1.6),
    normalMap: tex("brown_planks_09_nor_gl.jpg", false, 1.6),
    roughnessMap: tex("brown_planks_09_rough.jpg", false, 1.6),
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.55
  });
  const woodDark = new THREE.MeshStandardMaterial({
    map: tex("dark_wooden_planks_diff.jpg", true, 1.3),
    normalMap: tex("dark_wooden_planks_nor_gl.jpg", false, 1.3),
    roughnessMap: tex("dark_wooden_planks_rough.jpg", false, 1.3),
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.5
  });
  const brass = new THREE.MeshStandardMaterial({
    color: 0xa9853f,
    metalness: 0.96,
    roughness: 0.28,
    envMapIntensity: 1.1
  });
  const canvasMat = new THREE.MeshStandardMaterial({
    color: 0xd9cbae,
    roughness: 0.94,
    metalness: 0,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.94,
    envMapIntensity: 0.45
  });
  const rope = new THREE.MeshStandardMaterial({
    color: 0x8f7145,
    roughness: 0.98,
    metalness: 0,
    envMapIntensity: 0.4
  });
  const iron = new THREE.MeshStandardMaterial({
    color: 0x232327,
    metalness: 0.88,
    roughness: 0.52,
    envMapIntensity: 0.7
  });
  const materials: MachineMaterials = { wood, woodDark, brass, canvas: canvasMat, rope, iron };

  // Warm workshop image-based lighting (loads async; lights carry the frame
  // until it lands). Background stays void — env is lighting only.
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT: THREE.WebGLRenderTarget | null = null;
  new RGBELoader().load(
    BASE + "assets/pbr/artist_workshop_1k.hdr",
    (hdr) => {
      if (disposed) {
        hdr.dispose();
        return;
      }
      envRT = pmrem.fromEquirectangular(hdr);
      scene.environment = envRT.texture;
      scene.environmentIntensity = 0.45;
      hdr.dispose();
      pmrem.dispose();
    },
    undefined,
    () => {
      // Direct lights still carry the scene; free the generator either way.
      pmrem.dispose();
      if (import.meta.env.DEV) console.warn("[atelier] env HDR failed to load — direct lights only");
    }
  );

  // ------------------------------------------------------------- exhibits
  const orni = buildOrnithopter(materials);
  orni.group.position.set(0, 0.55, 0);
  orni.group.rotation.y = -0.5;
  scene.add(orni.group);

  const bal = buildBallista(materials);
  bal.group.position.set(7.4, 0.32, -1.6);
  bal.group.rotation.y = -0.5;
  scene.add(bal.group);

  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = renderer.shadowMap.enabled;
      mesh.receiveShadow = false;
    }
  });

  // Floor + plinths + contact shadows.
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(26, 48),
    new THREE.MeshStandardMaterial({ color: 0x0d0d11, roughness: 0.96, metalness: 0, envMapIntensity: 0.25 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  floor.receiveShadow = renderer.shadowMap.enabled;
  scene.add(floor);

  const plinthGeo = new THREE.CylinderGeometry(2.5, 2.62, 0.14, 44);
  for (const [x, z, r] of [
    [0, 0, 2.5],
    [7.4, -1.6, 2.2]
  ] as const) {
    const plinth = new THREE.Mesh(plinthGeo, woodDark);
    // XZ-only scale: keep height 0.14 so both tops sit at y=0.14, flush with
    // the floor and 0.005 under the shared shadow decals.
    plinth.scale.set(r / 2.5, 1, r / 2.5);
    plinth.position.set(x, 0.07, z);
    plinth.receiveShadow = renderer.shadowMap.enabled;
    scene.add(plinth);
  }
  const shadowTex = contactShadowTexture();
  const shadowGeo = new THREE.PlaneGeometry(1, 1);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    depthWrite: false
  });
  for (const [x, z, s] of [
    [0, 0, 6.2],
    [7.4, -1.6, 5.2]
  ] as const) {
    const sh = new THREE.Mesh(shadowGeo, shadowMat);
    sh.rotation.x = -Math.PI / 2;
    sh.position.set(x, 0.145, z);
    sh.scale.setScalar(s);
    sh.renderOrder = 1;
    scene.add(sh);
  }

  // ------------------------------------------------------------- dust motes
  const dustCount = quality.tier === "low" ? 380 : 1100;
  const dustGeo = new THREE.BufferGeometry();
  {
    const arr = new Float32Array(dustCount * 3);
    const phase = new Float32Array(dustCount);
    for (let i = 0; i < dustCount; i += 1) {
      const r = 1.6 + vnoise(i * 0.31, 7) * 8.5;
      const a = vnoise(i * 0.17, 2) * Math.PI * 2;
      arr[i * 3] = Math.cos(a) * r + 2.4;
      arr[i * 3 + 1] = 0.3 + vnoise(i * 0.53, 9) * 4.6;
      arr[i * 3 + 2] = Math.sin(a) * r - 1.0;
      phase[i] = vnoise(i * 0.77, 4) * Math.PI * 2;
    }
    dustGeo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    dustGeo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
  }
  const dustMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uGlobal: { value: 1 }, uColor: { value: new THREE.Color(0xd8b678) } },
    vertexShader: `
      attribute float aPhase;
      uniform float uTime;
      varying float vFade;
      void main() {
        vec3 p = position;
        p.y += sin(uTime * 0.3 + aPhase) * 0.2;
        p.x += cos(uTime * 0.18 + aPhase * 1.7) * 0.14;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float dist = -mv.z;
        vFade = smoothstep(16.0, 4.0, dist) * (0.3 + 0.7 * fract(aPhase * 3.1));
        gl_PointSize = 20.0 / dist;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uGlobal;
      varying float vFade;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = smoothstep(0.5, 0.05, length(uv));
        gl_FragColor = vec4(uColor, d * vFade * 0.4 * uGlobal);
      }`
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  scene.add(dust);

  // ------------------------------------------------------------- lights
  const key = new THREE.SpotLight(0xffe2bd, 0, 60, 0.5, 0.6, 1.4);
  key.position.set(-5.5, 8.5, 6);
  key.target.position.set(0, 0.6, 0);
  scene.add(key.target);
  if (renderer.shadowMap.enabled) {
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0004;
  }
  scene.add(key);
  const key2 = new THREE.SpotLight(0xffdcae, 0, 60, 0.55, 0.65, 1.4);
  key2.position.set(11.5, 7.5, 3.5);
  key2.target.position.set(7.4, 0.5, -1.6);
  scene.add(key2.target);
  scene.add(key2);
  const fill = new THREE.HemisphereLight(0x30394a, 0x0a0806, 0.5);
  scene.add(fill);
  const torch = new THREE.PointLight(0xffc98a, 0, 10, 1.7);
  scene.add(torch);

  // ------------------------------------------------------------- composer
  const useBloom = quality.tier !== "low";
  let composer: EffectComposer | null = null;
  let bloomPass: UnrealBloomPass | null = null;
  if (useBloom) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.3, 0.4, 0.86);
    composer.addPass(bloomPass);
  }

  // ------------------------------------------------------------- chapters
  const camPos = [
    new THREE.Vector3(-2.7, 1.35, 5.0),
    new THREE.Vector3(2.9, 0.85, 7.6),
    new THREE.Vector3(4.4, 1.2, 1.0),
    new THREE.Vector3(-0.5, 3.4, 6.6),
    new THREE.Vector3(0.7, 0.9, 2.9)
  ];
  const camLook = [
    new THREE.Vector3(-1.0, 1.0, 0),
    new THREE.Vector3(3.8, 0.7, 0),
    new THREE.Vector3(7.5, 0.75, -1.7),
    new THREE.Vector3(0.2, 0.85, 0),
    new THREE.Vector3(-0.4, 0.85, 0.2)
  ];
  const keyI = [210, 90, 45, 110, 60];
  const key2I = [0, 10, 190, 12, 8];
  const dustFactor = [1, 0.7, 0.55, 0.85, 0.3];

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
  let ignition = quality.motionScale === 0 ? 1 : 0;
  let hoverDrive = 0;
  let hoverActive = false;
  let goldMode = false;
  let fpsAcc = 0;
  let fpsN = 0;
  let bloomDropped = false;
  const pointer = new THREE.Vector2(0.25, 0.15);
  const pointerTarget = new THREE.Vector2(0.25, 0.15);
  const tmpLook = new THREE.Vector3();
  const curLook = camLook[0].clone();
  let firstFrame = true;

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
    hoverActive = typeof idx === "number";
  };
  window.addEventListener("alice:work-hover", onWorkHover);

  // ------------------------------------------------------------- frame
  const renderFrame = (timestamp: number, dt: number): void => {
    const time = timestamp * 0.001 * quality.motionScale;
    const damp = 1 - Math.exp(-dt * 4.2);

    progress = forcedProgress ?? progressFromScroll();
    const ci = Math.min(3, Math.floor(progress));
    const ct = smooth(clamp01(progress - ci));

    if (ignition < 1) ignition = Math.min(1, ignition + dt / 1.1);
    const ign = smooth(ignition);
    const flick = ign < 1 ? (vnoise(timestamp * 0.05, 1) > 0.35 ? 1 : 0.2) : 1;

    // camera spine + parallax
    camera.position.lerpVectors(camPos[ci], camPos[Math.min(4, ci + 1)], ct);
    tmpLook.lerpVectors(camLook[ci], camLook[Math.min(4, ci + 1)], ct);
    pointer.lerp(pointerTarget, 1 - Math.exp(-dt * 4));
    const par = (1 - Math.max(0, progress - 3)) * 0.3;
    camera.position.x += pointer.x * par;
    camera.position.y += -pointer.y * par * 0.5;
    if (firstFrame) {
      // Mid-page reload / anchor restore: snap the look with the position so
      // the first frames don't swing across the room.
      curLook.copy(tmpLook);
      firstFrame = false;
    }
    curLook.lerp(tmpLook, damp);
    camera.lookAt(curLook);

    // lights per chapter
    key.intensity += (THREE.MathUtils.lerp(keyI[ci], keyI[Math.min(4, ci + 1)], ct) * ign * flick - key.intensity) * damp;
    key2.intensity += (THREE.MathUtils.lerp(key2I[ci], key2I[Math.min(4, ci + 1)], ct) * ign - key2.intensity) * damp;
    if (quality.parallax) {
      torch.position.set(pointer.x * 4.5 + 1.5, 2.2 - pointer.y * 2.2, 4.0);
      torch.intensity += (8 * ign - torch.intensity) * damp;
    }

    // machine drives: ornithopter flaps gently always, harder on hover/works;
    // ballista spans with lab-chapter progress.
    hoverDrive += ((hoverActive ? 1 : 0) - hoverDrive) * damp;
    const worksT = progress > 0.4 && progress < 2 ? 1 - Math.abs(progress - 1.2) / 0.8 : 0;
    const orniDrive = clamp01(0.22 + hoverDrive * 0.6 + clamp01(worksT) * 0.35);
    orni.update(time, orniDrive);
    const labT = smooth(clamp01((progress - 1.75) / 0.85)) * (1 - smooth(clamp01((progress - 3.1) / 0.5)));
    bal.update(time, labT);

    // footer: closing warmth + DOM gold inversion
    const swallow = smooth(clamp01((progress - 3.25) / 0.75));
    fill.intensity = 0.5 + swallow * 0.5;
    const wantGold = swallow > 0.55;
    if (wantGold !== goldMode) {
      goldMode = wantGold;
      document.documentElement.classList.toggle("gold-mode", goldMode);
    }

    (dustMat.uniforms.uTime as { value: number }).value = time;
    (dustMat.uniforms.uGlobal as { value: number }).value = THREE.MathUtils.lerp(
      dustFactor[ci],
      dustFactor[Math.min(4, ci + 1)],
      ct
    );

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
      loadedTextures.forEach((t) => t.dispose());
      shadowTex.dispose();
      envRT?.dispose();
      bloomPass?.dispose();
      composer?.dispose();
      renderer.dispose();
      scene.clear();
    }
  };
}
