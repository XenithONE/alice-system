import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { HeroQuality } from "../quality";
import { scrollState } from "../useLenis";

// Immersive persistent WebGL layer (Lusion / Bruno-Simon inspired):
//  - atmospheric void with scroll-linked glows + fluid pointer trail
//  - sculptural SIGNAL core (iris rings, orbiting geometry, field particles)
//  - floating crystal forms with depth parallax
//  - work covers as DOM-synced planes with hover ripple + scroll curve
// DOM remains fully usable if this layer never boots.

export interface GlScene {
  dispose: () => void;
}

const ACCENT = new THREE.Color("#cdaa6d");
const COOL = new THREE.Color("#6b7a9e");
const FOV = 48;

interface CoverPlane {
  el: HTMLElement;
  img: HTMLImageElement | null;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  hover: number;
  hoverTarget: number;
  mouse: THREE.Vector2;
  mouseTarget: THREE.Vector2;
  ready: boolean;
  enter: () => void;
  leave: () => void;
  move: (e: PointerEvent) => void;
}

interface Floater {
  group: THREE.Group;
  base: THREE.Vector3;
  phase: number;
  speed: number;
  amp: number;
  spin: THREE.Vector3;
}

export function createGlScene(canvas: HTMLCanvasElement, quality: HeroQuality): GlScene {
  const coarse = window.matchMedia("(pointer: coarse)").matches;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance"
  });
  renderer.setPixelRatio(quality.dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0a0c, 0.00028);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 8000);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomEnv = new RoomEnvironment();
  const envRT = pmrem.fromScene(roomEnv, 0.04);
  scene.environment = envRT.texture;
  roomEnv.dispose();
  pmrem.dispose();

  // ---------- fluid trail (ping-pong) ----------
  const trailRes = quality.tier === "high" ? 448 : 288;
  const rtOptions: THREE.RenderTargetOptions = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false
  };
  let trailA = new THREE.WebGLRenderTarget(trailRes, trailRes, rtOptions);
  let trailB = new THREE.WebGLRenderTarget(trailRes, trailRes, rtOptions);
  const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const trailScene = new THREE.Scene();
  const trailMat = new THREE.ShaderMaterial({
    uniforms: {
      uPrev: { value: trailA.texture },
      uPointer: { value: new THREE.Vector2(-10, -10) },
      uVel: { value: new THREE.Vector2(0, 0) },
      uStrength: { value: 0 },
      uDecay: { value: 0.96 }
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D uPrev; uniform vec2 uPointer; uniform vec2 uVel; uniform float uStrength; uniform float uDecay;
      varying vec2 vUv;
      void main(){
        vec2 smear = uVel * 0.004;
        float prev = texture2D(uPrev, vUv - smear).r * uDecay;
        float d = distance(vUv, uPointer);
        float splat = exp(-d * d * 320.0) * uStrength;
        float ring = exp(-abs(d - 0.04) * abs(d - 0.04) * 1800.0) * uStrength * 0.35;
        gl_FragColor = vec4(vec3(clamp(prev + splat + ring - 0.002, 0.0, 1.0)), 1.0);
      }`
  });
  trailScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), trailMat));

  // ---------- atmospheric background ----------
  const bgScene = new THREE.Scene();
  const bgMat = new THREE.ShaderMaterial({
    uniforms: {
      uTrail: { value: trailB.texture },
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uAspect: { value: 1 },
      uPointer: { value: new THREE.Vector2(0.5, 0.5) }
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D uTrail; uniform float uTime; uniform float uScroll; uniform float uAspect;
      uniform vec2 uPointer;
      varying vec2 vUv;

      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p);
        float a = hash(i), b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
      }
      float fbm(vec2 p){
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.05; a *= 0.5; }
        return v;
      }

      void main(){
        vec3 bg = vec3(0.035, 0.035, 0.045);
        vec2 uv = vUv;
        vec2 p = vec2(uv.x * uAspect, uv.y);
        float t = uTime * 0.08;

        // layered drifting nebulae
        float n1 = fbm(p * 1.8 + vec2(t * 0.4, uScroll * 1.2));
        float n2 = fbm(p * 3.2 - vec2(t * 0.25, -uScroll * 0.8) + 8.0);
        float n3 = fbm(p * 0.9 + vec2(-t * 0.15, uScroll * 0.5));

        vec2 c1 = vec2(0.72 + sin(t * 0.5) * 0.04, 0.48 + uScroll * 0.18);
        vec2 c2 = vec2(0.22, 0.78 - uScroll * 0.25);
        vec2 c3 = vec2(0.55, 0.15 + uScroll * 0.1);
        float g1 = exp(-distance(p, vec2(c1.x * uAspect, c1.y)) * 1.8);
        float g2 = exp(-distance(p, vec2(c2.x * uAspect, c2.y)) * 2.4);
        float g3 = exp(-distance(p, vec2(c3.x * uAspect, c3.y)) * 3.0);

        vec3 accent = vec3(0.804, 0.667, 0.427);
        vec3 cool = vec3(0.38, 0.44, 0.62);
        vec3 deep = vec3(0.12, 0.14, 0.28);

        vec3 col = bg;
        col += deep * n3 * 0.35;
        col += accent * g1 * (0.07 + n1 * 0.04);
        col += cool * g2 * (0.06 + n2 * 0.05);
        col += mix(accent, cool, 0.5) * g3 * 0.04;
        col += accent * n1 * n2 * 0.03;

        // faint star field
        float stars = step(0.997, hash(floor(uv * vec2(900.0, 700.0) + uTime * 0.01)));
        col += vec3(0.85, 0.88, 1.0) * stars * 0.35;

        // fluid trail
        float tr = texture2D(uTrail, uv).r;
        float e = 0.01;
        vec2 grad = vec2(
          texture2D(uTrail, uv + vec2(e, 0.0)).r - texture2D(uTrail, uv - vec2(e, 0.0)).r,
          texture2D(uTrail, uv + vec2(0.0, e)).r - texture2D(uTrail, uv - vec2(0.0, e)).r
        );
        col += accent * tr * 0.22;
        col += cool * abs(grad.x + grad.y) * 0.35;
        col += accent * exp(-distance(uv, uPointer) * 8.0) * 0.04;

        // vignette + film grain
        float vig = smoothstep(1.35, 0.3, distance(uv, vec2(0.5)));
        col *= mix(0.72, 1.0, vig);
        col += (hash(uv * 1100.0 + uTime) - 0.5) * 0.018;

        gl_FragColor = vec4(col, 1.0);
      }`
  });
  bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat));

  // ---------- SIGNAL core (hero sculpture) ----------
  const core = new THREE.Group();
  scene.add(core);
  const coreMats: THREE.Material[] = [];

  const nucleusMat = new THREE.MeshStandardMaterial({
    color: 0x0e0e12,
    metalness: 1,
    roughness: 0.12,
    envMapIntensity: 1.4,
    transparent: true
  });
  const nucleus = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 2), nucleusMat);
  core.add(nucleus);
  coreMats.push(nucleusMat);

  const shellMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a22,
    metalness: 0.95,
    roughness: 0.25,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
    wireframe: true
  });
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.35, 1), shellMat);
  core.add(shell);
  coreMats.push(shellMat);

  const bladeCount = quality.blades;
  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0x9a9aa8,
    metalness: 0.95,
    roughness: 0.28,
    transparent: true,
    envMapIntensity: 1.2
  });
  const blades = new THREE.InstancedMesh(new THREE.BoxGeometry(0.01, 0.42, 0.01), bladeMat, bladeCount);
  const dummy = new THREE.Object3D();
  const bladeColor = new THREE.Color();
  for (let i = 0; i < bladeCount; i += 1) {
    placeBlade(dummy, i, bladeCount, 0);
    blades.setMatrixAt(i, dummy.matrix);
    if (i % 10 === 0) bladeColor.copy(ACCENT);
    else if (i % 7 === 0) bladeColor.copy(COOL);
    else bladeColor.setRGB(0.58, 0.58, 0.64);
    blades.setColorAt(i, bladeColor);
  }
  blades.instanceMatrix.needsUpdate = true;
  if (blades.instanceColor) blades.instanceColor.needsUpdate = true;
  const iris = new THREE.Group();
  iris.add(blades);
  core.add(iris);
  coreMats.push(bladeMat);

  const ringSpecs: Array<{ r: number; tube: number; color: number; emissive: number; ei: number }> = [
    { r: 1.75, tube: 0.006, color: 0x3a3a48, emissive: 0x000000, ei: 0 },
    { r: 2.15, tube: 0.004, color: 0x121214, emissive: 0xcdaa6d, ei: 0.55 },
    { r: 2.55, tube: 0.003, color: 0x2a2a38, emissive: 0x6b7a9e, ei: 0.25 }
  ];
  const rings: THREE.Mesh[] = [];
  for (const spec of ringSpecs) {
    const mat = new THREE.MeshStandardMaterial({
      color: spec.color,
      emissive: new THREE.Color(spec.emissive),
      emissiveIntensity: spec.ei,
      metalness: 0.85,
      roughness: 0.35,
      transparent: true
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(spec.r, spec.tube, 10, 128), mat);
    core.add(ring);
    rings.push(ring);
    coreMats.push(mat);
  }
  rings[0].rotation.x = Math.PI * 0.5;
  rings[1].rotation.x = Math.PI * 0.42;
  rings[1].rotation.y = 0.35;
  rings[2].rotation.x = Math.PI * 0.58;
  rings[2].rotation.z = 0.4;

  // orbiting mini crystals around core
  const orbitGroup = new THREE.Group();
  core.add(orbitGroup);
  const crystalMat = new THREE.MeshStandardMaterial({
    color: 0xcdaa6d,
    metalness: 1,
    roughness: 0.15,
    emissive: ACCENT,
    emissiveIntensity: 0.15,
    transparent: true,
    opacity: 0.85
  });
  coreMats.push(crystalMat);
  const orbitCount = quality.tier === "high" ? 7 : 5;
  for (let i = 0; i < orbitCount; i += 1) {
    const geo =
      i % 2 === 0
        ? new THREE.OctahedronGeometry(0.08 + (i % 3) * 0.02, 0)
        : new THREE.TetrahedronGeometry(0.09 + (i % 2) * 0.02, 0);
    const m = new THREE.Mesh(geo, crystalMat);
    const a = (i / orbitCount) * Math.PI * 2;
    m.position.set(Math.cos(a) * 2.9, Math.sin(a * 1.7) * 0.55, Math.sin(a) * 2.9);
    m.userData.angle = a;
    m.userData.radius = 2.7 + (i % 3) * 0.25;
    m.userData.yAmp = 0.35 + (i % 4) * 0.1;
    orbitGroup.add(m);
  }

  // field particles
  const particleCount = quality.particles;
  let particleSystem: THREE.Points | null = null;
  if (particleCount > 0) {
    const positions = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i += 1) {
      const r = 3.5 + Math.random() * 8;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.55;
      positions[i * 3 + 2] = r * Math.cos(phi);
      sizes[i] = 0.5 + Math.random();
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    pGeo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    const pMat = new THREE.PointsMaterial({
      color: 0xcdaa6d,
      size: 2.2,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    particleSystem = new THREE.Points(pGeo, pMat);
    core.add(particleSystem);
    coreMats.push(pMat);
  }

  // ---------- floating world geometry (parallax depth) ----------
  const floaters: Floater[] = [];
  const floaterMat = new THREE.MeshStandardMaterial({
    color: 0x1c1c24,
    metalness: 0.9,
    roughness: 0.35,
    transparent: true,
    opacity: 0.55,
    wireframe: false,
    envMapIntensity: 0.9
  });
  const floaterWireMat = new THREE.MeshBasicMaterial({
    color: 0xcdaa6d,
    wireframe: true,
    transparent: true,
    opacity: 0.18
  });
  const floaterDefs =
    quality.tier === "high"
      ? [
          { geo: new THREE.IcosahedronGeometry(90, 0), x: -420, y: 180, z: -520, s: 1 },
          { geo: new THREE.OctahedronGeometry(70, 0), x: 480, y: -120, z: -680, s: 1.2 },
          { geo: new THREE.TetrahedronGeometry(55, 0), x: -280, y: -260, z: -400, s: 0.9 },
          { geo: new THREE.DodecahedronGeometry(48, 0), x: 320, y: 280, z: -900, s: 1.1 },
          { geo: new THREE.IcosahedronGeometry(40, 1), x: 80, y: -340, z: -1100, s: 1.4 },
          { geo: new THREE.TorusKnotGeometry(35, 10, 80, 8), x: -500, y: 40, z: -780, s: 0.8 }
        ]
      : [
          { geo: new THREE.IcosahedronGeometry(90, 0), x: -400, y: 160, z: -500, s: 1 },
          { geo: new THREE.OctahedronGeometry(70, 0), x: 450, y: -100, z: -650, s: 1.2 },
          { geo: new THREE.TetrahedronGeometry(55, 0), x: -250, y: -220, z: -420, s: 0.9 },
          { geo: new THREE.DodecahedronGeometry(48, 0), x: 300, y: 240, z: -850, s: 1.1 }
        ];

  for (let i = 0; i < floaterDefs.length; i += 1) {
    const def = floaterDefs[i];
    const group = new THREE.Group();
    const solid = new THREE.Mesh(def.geo, floaterMat);
    const wire = new THREE.Mesh(def.geo.clone(), floaterWireMat);
    wire.scale.setScalar(1.02);
    group.add(solid);
    group.add(wire);
    group.scale.setScalar(def.s);
    group.position.set(def.x, def.y, def.z);
    scene.add(group);
    floaters.push({
      group,
      base: new THREE.Vector3(def.x, def.y, def.z),
      phase: i * 1.7,
      speed: 0.15 + (i % 4) * 0.05,
      amp: 28 + (i % 3) * 12,
      spin: new THREE.Vector3(0.08 + (i % 3) * 0.02, 0.12 + (i % 2) * 0.04, 0.05)
    });
  }

  // lighting
  const key = new THREE.DirectionalLight(0xfff0d8, 0.65);
  key.position.set(-700, 500, 900);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x8899cc, 0.28);
  fill.position.set(600, -200, 400);
  scene.add(fill);
  const rim = new THREE.PointLight(0xcdaa6d, 1.2, 2000, 2);
  rim.position.set(200, 100, 200);
  scene.add(rim);
  const amb = new THREE.AmbientLight(0x404050, 0.35);
  scene.add(amb);

  // ---------- work cover planes ----------
  const covers: CoverPlane[] = [];
  const coverEnabled = !coarse;
  const loader = new THREE.TextureLoader();

  const coverVert = `
    uniform float uVelocity;
    varying vec2 vUv;
    varying vec2 vScreenUv;
    void main(){
      vUv = uv;
      vec3 pos = position;
      pos.z += sin(uv.y * 3.14159) * uVelocity * -32.0;
      pos.z += sin(uv.x * 6.28318 + uv.y * 3.14159) * abs(uVelocity) * 4.0;
      vec4 clip = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      vScreenUv = clip.xy / clip.w * 0.5 + 0.5;
      gl_Position = clip;
    }`;
  const coverFrag = `
    uniform sampler2D uMap; uniform sampler2D uTrail;
    uniform float uHover; uniform float uTime; uniform float uTexAspect; uniform float uPlaneAspect;
    uniform vec2 uMouse;
    varying vec2 vUv; varying vec2 vScreenUv;
    void main(){
      float pr = uPlaneAspect; float tr = uTexAspect;
      vec2 crop = (pr / tr < 1.0) ? vec2(pr / tr, 1.0) : vec2(1.0, tr / pr);
      vec2 uv = (vUv - 0.5);
      uv *= (1.0 - 0.08 * uHover);
      vec2 fromMouse = vUv - uMouse;
      float d = length(fromMouse);
      uv += normalize(fromMouse + 1e-4) * sin(d * 18.0 - uTime * 4.5) * 0.01 * uHover;
      float e = 0.012;
      vec2 grad = vec2(
        texture2D(uTrail, vScreenUv + vec2(e, 0.0)).r - texture2D(uTrail, vScreenUv - vec2(e, 0.0)).r,
        texture2D(uTrail, vScreenUv + vec2(0.0, e)).r - texture2D(uTrail, vScreenUv - vec2(0.0, e)).r
      );
      uv += grad * 0.04;
      uv = uv * crop + 0.5;
      float shift = 0.008 * uHover;
      vec3 col;
      col.r = texture2D(uMap, uv + vec2(shift, 0.0)).r;
      col.g = texture2D(uMap, uv).g;
      col.b = texture2D(uMap, uv - vec2(shift, 0.0)).b;
      float gray = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(gray) * 0.92, col, 0.78 + 0.22 * uHover);
      col *= 0.92 + 0.12 * uHover;
      // subtle edge vignette on plane
      float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(0.0, 0.08, vUv.y)
                 * smoothstep(0.0, 0.08, 1.0 - vUv.x) * smoothstep(0.0, 0.08, 1.0 - vUv.y);
      col *= mix(0.88, 1.0, edge);
      gl_FragColor = vec4(col, 1.0);
    }`;

  const setupCovers = (): void => {
    if (!coverEnabled) return;
    const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-gl-cover]"));
    for (const el of elements) {
      const img = el.querySelector("img");
      const src = img?.currentSrc || img?.src;
      if (!src) continue;
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: null },
          uTrail: { value: trailB.texture },
          uHover: { value: 0 },
          uTime: { value: 0 },
          uVelocity: { value: 0 },
          uTexAspect: { value: 1.5 },
          uPlaneAspect: { value: 1.5 },
          uMouse: { value: new THREE.Vector2(0.5, 0.5) }
        },
        vertexShader: coverVert,
        fragmentShader: coverFrag
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 32, 16), material);
      mesh.visible = false;
      scene.add(mesh);

      const cover: CoverPlane = {
        el,
        img: img ?? null,
        mesh,
        hover: 0,
        hoverTarget: 0,
        mouse: new THREE.Vector2(0.5, 0.5),
        mouseTarget: new THREE.Vector2(0.5, 0.5),
        ready: false,
        enter: () => {
          cover.hoverTarget = 1;
        },
        leave: () => {
          cover.hoverTarget = 0;
        },
        move: (e: PointerEvent) => {
          const rect = el.getBoundingClientRect();
          cover.mouseTarget.set(
            (e.clientX - rect.left) / Math.max(1, rect.width),
            1 - (e.clientY - rect.top) / Math.max(1, rect.height)
          );
        }
      };
      el.addEventListener("pointerenter", cover.enter);
      el.addEventListener("pointerleave", cover.leave);
      el.addEventListener("pointermove", cover.move);

      loader.load(
        src,
        (texture) => {
          if (disposed) {
            texture.dispose();
            return;
          }
          texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
          material.uniforms.uMap.value = texture;
          material.uniforms.uTexAspect.value = texture.image.width / Math.max(1, texture.image.height);
          cover.ready = true;
          mesh.visible = true;
          el.classList.add("gl-ready");
        },
        undefined,
        () => undefined
      );
      covers.push(cover);
    }
  };

  // ---------- pointer / scroll ----------
  const pointer = { x: -10, y: -10, lastX: -10, lastY: -10, strength: 0, vx: 0, vy: 0 };
  const onPointerMove = (e: PointerEvent): void => {
    const w = document.documentElement.clientWidth || 1;
    const h = document.documentElement.clientHeight || 1;
    const nx = e.clientX / w;
    const ny = 1 - e.clientY / h;
    if (pointer.x > -5) {
      pointer.vx = (nx - pointer.x) * 60;
      pointer.vy = (ny - pointer.y) * 60;
      const speed = Math.hypot(nx - pointer.x, ny - pointer.y);
      pointer.strength = Math.min(1, pointer.strength + speed * 16);
    }
    pointer.x = nx;
    pointer.y = ny;
  };
  window.addEventListener("pointermove", onPointerMove, { passive: true });

  let smoothVel = 0;
  let lastScroll = scrollState.y || window.scrollY || 0;

  const resize = (): void => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    camera.aspect = w / h;
    camera.position.z = h / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    bgMat.uniforms.uAspect.value = w / h;
  };
  resize();
  window.addEventListener("resize", resize);

  setupCovers();

  // ---------- frame loop ----------
  let rafId = 0;
  let disposed = false;
  const clock = new THREE.Clock();
  const pointerLerped = new THREE.Vector2(0.5, 0.5);
  const pointerScratch = new THREE.Vector2(0.5, 0.5);

  const renderFrame = (): void => {
    const dt = Math.min(0.1, clock.getDelta());
    const t = clock.elapsedTime;
    const k = dt * 60;
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    const scroll = scrollState.y || window.scrollY || 0;

    smoothVel += (scroll - lastScroll - smoothVel) * 0.12;
    lastScroll = scroll;

    // trail
    trailMat.uniforms.uPrev.value = trailA.texture;
    trailMat.uniforms.uPointer.value.set(pointer.x, pointer.y);
    trailMat.uniforms.uVel.value.set(pointer.vx, pointer.vy);
    trailMat.uniforms.uStrength.value = pointer.strength * 0.55;
    trailMat.uniforms.uDecay.value = Math.pow(0.958, k);
    renderer.setRenderTarget(trailB);
    renderer.clear();
    renderer.render(trailScene, orthoCam);
    renderer.setRenderTarget(null);
    const swap = trailA;
    trailA = trailB;
    trailB = swap;
    pointer.strength *= Math.pow(0.58, k);
    pointer.vx *= Math.pow(0.8, k);
    pointer.vy *= Math.pow(0.8, k);
    const trailTex = trailA.texture;
    bgMat.uniforms.uTrail.value = trailTex;

    bgMat.uniforms.uTime.value = t;
    const docH = Math.max(1, document.documentElement.scrollHeight - h);
    const scrollN = Math.min(1, scroll / docH);
    bgMat.uniforms.uScroll.value = scrollN;
    bgMat.uniforms.uPointer.value.set(
      pointer.x < -5 ? 0.5 : pointer.x,
      pointer.y < -5 ? 0.5 : pointer.y
    );

    // core scrub through hero
    const heroP = Math.min(1, scroll / (h * 0.95));
    const coreScale = Math.min(w, h) * 0.28 * (1 - heroP * 0.4);
    core.scale.setScalar(Math.max(1, coreScale));
    const baseX = w < 780 ? 0 : w * 0.24;
    core.position.set(baseX * (1 - heroP * 0.45), h * 0.04 + heroP * h * 0.9, -80);
    const coreOpacity = Math.max(0, 1 - heroP * 1.1);
    for (const m of coreMats) {
      if (m === shellMat) (m as THREE.MeshStandardMaterial).opacity = 0.35 * coreOpacity;
      else if (m === crystalMat) (m as THREE.MeshStandardMaterial).opacity = 0.85 * coreOpacity;
      else if (m instanceof THREE.PointsMaterial) m.opacity = 0.55 * coreOpacity;
      else (m as THREE.MeshStandardMaterial).opacity = coreOpacity;
    }
    core.visible = coreOpacity > 0.01;

    if (quality.animate && core.visible) {
      iris.rotation.z = t * 0.035;
      nucleus.rotation.y = t * 0.12;
      nucleus.rotation.x = t * 0.06;
      shell.rotation.y = -t * 0.08;
      shell.rotation.z = t * 0.04;
      rings[0].rotation.z = t * 0.1;
      rings[1].rotation.z = -t * 0.07;
      rings[2].rotation.y = t * 0.05;

      for (let i = 0; i < bladeCount; i += 1) {
        placeBlade(dummy, i, bladeCount, Math.sin(t * 0.45 + i * 0.22) * 0.06);
        blades.setMatrixAt(i, dummy.matrix);
      }
      blades.instanceMatrix.needsUpdate = true;

      for (const child of orbitGroup.children) {
        const a = (child.userData.angle as number) + t * 0.35;
        const r = child.userData.radius as number;
        child.position.set(
          Math.cos(a) * r,
          Math.sin(a * 1.6 + t * 0.5) * (child.userData.yAmp as number),
          Math.sin(a) * r
        );
        child.rotation.x = t * 0.8;
        child.rotation.y = t * 1.1;
      }

      if (particleSystem) {
        particleSystem.rotation.y = t * 0.04;
        particleSystem.rotation.x = Math.sin(t * 0.1) * 0.08;
      }

      pointerScratch.set(pointer.x < -5 ? 0.5 : pointer.x, pointer.y < -5 ? 0.5 : pointer.y);
      pointerLerped.lerp(pointerScratch, 0.035);
      core.rotation.y = (pointerLerped.x - 0.5) * 0.55;
      core.rotation.x = -(pointerLerped.y - 0.5) * 0.4;
    }

    // floaters — scroll parallax + idle drift
    const floaterOp = THREE.MathUtils.clamp(1.15 - heroP * 0.55 - scrollN * 0.35, 0.15, 0.7);
    floaterMat.opacity = floaterOp * 0.55;
    floaterWireMat.opacity = floaterOp * 0.22;
    for (const f of floaters) {
      f.group.position.x = f.base.x + Math.sin(t * f.speed + f.phase) * f.amp;
      f.group.position.y = f.base.y + Math.cos(t * f.speed * 0.8 + f.phase) * f.amp * 0.6 - scroll * 0.15;
      f.group.position.z = f.base.z + Math.sin(t * 0.1 + f.phase) * 20;
      f.group.rotation.x = t * f.spin.x + f.phase;
      f.group.rotation.y = t * f.spin.y;
      f.group.rotation.z = t * f.spin.z * 0.5;
    }

    rim.intensity = 1.0 + Math.sin(t * 1.2) * 0.25 + pointer.strength * 0.4;

    // covers
    const velNorm = THREE.MathUtils.clamp(smoothVel / 60, -1, 1);
    for (const cover of covers) {
      if (!cover.ready) continue;
      const rect = cover.el.getBoundingClientRect();
      const visible = rect.bottom > -100 && rect.top < h + 100;
      cover.mesh.visible = visible;
      if (!visible) continue;
      cover.mesh.position.set(rect.left + rect.width / 2 - w / 2, -(rect.top + rect.height / 2 - h / 2), 0);
      cover.mesh.scale.set(Math.max(1, rect.width), Math.max(1, rect.height), 1);
      cover.hover += (cover.hoverTarget - cover.hover) * 0.09;
      cover.mouse.lerp(cover.mouseTarget, 0.12);
      const u = cover.mesh.material.uniforms;
      u.uHover.value = cover.hover;
      u.uTime.value = t;
      u.uVelocity.value = velNorm;
      u.uTrail.value = trailTex;
      u.uPlaneAspect.value = rect.width / Math.max(1, rect.height);
      u.uMouse.value.copy(cover.mouse);
    }

    renderer.clear();
    renderer.render(bgScene, orthoCam);
    renderer.clearDepth();
    renderer.render(scene, camera);
  };

  if (quality.animate) {
    const loop = (): void => {
      if (disposed) return;
      renderFrame();
      rafId = window.requestAnimationFrame(loop);
    };
    rafId = window.requestAnimationFrame(loop);
  } else {
    renderFrame();
  }

  return {
    dispose: () => {
      disposed = true;
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      for (const cover of covers) {
        cover.el.removeEventListener("pointerenter", cover.enter);
        cover.el.removeEventListener("pointerleave", cover.leave);
        cover.el.removeEventListener("pointermove", cover.move);
        cover.el.classList.remove("gl-ready");
        (cover.mesh.material.uniforms.uMap.value as THREE.Texture | null)?.dispose();
      }
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      });
      blades.dispose();
      for (const s of [trailScene, bgScene]) {
        s.traverse((o) => {
          (o as THREE.Mesh).geometry?.dispose();
        });
      }
      trailMat.dispose();
      bgMat.dispose();
      floaterMat.dispose();
      floaterWireMat.dispose();
      trailA.dispose();
      trailB.dispose();
      envRT.dispose();
      renderer.dispose();
    }
  };
}

function placeBlade(dummy: THREE.Object3D, index: number, count: number, breathe: number): void {
  const angle = (index / count) * Math.PI * 2;
  const radius = 1.55;
  dummy.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
  dummy.rotation.set(0, 0, angle + Math.PI / 2 + breathe);
  dummy.updateMatrix();
}
