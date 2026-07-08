import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { HeroQuality } from "../quality";
import { scrollState } from "../useLenis";

// Lusion-style persistent WebGL layer behind the whole page:
//  - pseudo-fluid pointer trail (ping-pong render targets) tinting/warping everything
//  - full-screen shader background (replaces the CSS poster when live)
//  - the IRIS/SIGNAL eye, scroll-scrubbed through the hero
//  - work covers as DOM-synced textured planes with hover ripple + scroll curve
// Everything is procedural; DOM keeps working when this layer never boots.

export interface GlScene {
  dispose: () => void;
}

const ACCENT = new THREE.Color("#cdaa6d");
const FOV = 50;

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

export function createGlScene(canvas: HTMLCanvasElement, quality: HeroQuality): GlScene {
  const coarse = window.matchMedia("(pointer: coarse)").matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(quality.dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.autoClear = false;

  // ---------- main scene: pixel-matched perspective camera ----------
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 6000);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomEnv = new RoomEnvironment();
  const envRT = pmrem.fromScene(roomEnv, 0.04);
  scene.environment = envRT.texture;
  roomEnv.dispose();
  pmrem.dispose();

  // ---------- fluid trail (ping-pong feedback) ----------
  const trailRes = quality.tier === "high" ? 384 : 256;
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
      uDecay: { value: 0.955 }
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D uPrev; uniform vec2 uPointer; uniform vec2 uVel; uniform float uStrength; uniform float uDecay;
      varying vec2 vUv;
      void main(){
        vec2 smear = uVel * 0.0035;
        float prev = texture2D(uPrev, vUv - smear).r * uDecay;
        float d = distance(vUv, uPointer);
        float splat = exp(-d * d * 380.0) * uStrength;
        // -0.002 (> 0.5/255) guarantees 8-bit texels decay to true zero — pure
        // multiplicative decay would freeze a permanent ghost plateau at ~11/255.
        gl_FragColor = vec4(vec3(clamp(prev + splat - 0.002, 0.0, 1.0)), 1.0);
      }`
  });
  trailScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), trailMat));

  // ---------- background (full-screen shader quad) ----------
  const bgScene = new THREE.Scene();
  const bgMat = new THREE.ShaderMaterial({
    uniforms: {
      uTrail: { value: trailB.texture },
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uAspect: { value: 1 }
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D uTrail; uniform float uTime; uniform float uScroll; uniform float uAspect;
      varying vec2 vUv;
      float noise(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      void main(){
        vec3 bg = vec3(0.039, 0.039, 0.047); // --bg #0a0a0c
        // two slow radial glows, drifting with scroll
        vec2 c1 = vec2(0.68, 0.42 + uScroll * 0.22);
        vec2 c2 = vec2(0.18, 0.85 - uScroll * 0.3);
        vec2 p = vec2(vUv.x * uAspect, vUv.y);
        float g1 = exp(-distance(p, vec2(c1.x * uAspect, c1.y)) * 2.2);
        float g2 = exp(-distance(p, vec2(c2.x * uAspect, c2.y)) * 2.6);
        vec3 accent = vec3(0.804, 0.667, 0.427); // #cdaa6d
        vec3 cool = vec3(0.42, 0.46, 0.56);
        vec3 col = bg + accent * g1 * 0.055 + cool * g2 * 0.05;
        // fluid trail: warm smoke where the cursor travelled
        float t = texture2D(uTrail, vUv).r;
        float e = 0.012;
        vec2 grad = vec2(
          texture2D(uTrail, vUv + vec2(e, 0.0)).r - texture2D(uTrail, vUv - vec2(e, 0.0)).r,
          texture2D(uTrail, vUv + vec2(0.0, e)).r - texture2D(uTrail, vUv - vec2(0.0, e)).r
        );
        col += accent * t * 0.16;
        col += cool * abs(grad.x + grad.y) * 0.25;
        // vignette + grain
        float vig = smoothstep(1.25, 0.35, distance(vUv, vec2(0.5)));
        col *= mix(0.82, 1.0, vig);
        col += (noise(vUv * 900.0 + uTime) - 0.5) * 0.012;
        gl_FragColor = vec4(col, 1.0);
      }`
  });
  bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat));

  // ---------- IRIS eye (scroll-scrubbed hero centerpiece) ----------
  const eye = new THREE.Group();
  scene.add(eye);
  const eyeMats: THREE.Material[] = [];

  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x111214, metalness: 1.0, roughness: 0.18, transparent: true });
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), pupilMat);
  eye.add(pupil);
  eyeMats.push(pupilMat);

  const bladeCount = quality.blades;
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x9a9aa2, metalness: 0.9, roughness: 0.35, transparent: true });
  const blades = new THREE.InstancedMesh(new THREE.BoxGeometry(0.012, 0.34, 0.012), bladeMat, bladeCount);
  const dummy = new THREE.Object3D();
  const bladeColor = new THREE.Color();
  for (let i = 0; i < bladeCount; i += 1) {
    placeBlade(dummy, i, bladeCount, 0);
    blades.setMatrixAt(i, dummy.matrix);
    if (i % 12 === 0) bladeColor.copy(ACCENT);
    else bladeColor.setRGB(0.6, 0.6, 0.63);
    blades.setColorAt(i, bladeColor);
  }
  blades.instanceMatrix.needsUpdate = true;
  if (blades.instanceColor) blades.instanceColor.needsUpdate = true;
  const iris = new THREE.Group();
  iris.add(blades);
  eye.add(iris);
  eyeMats.push(bladeMat);

  const haloMat = new THREE.MeshStandardMaterial({ color: 0x3a3a40, metalness: 0.85, roughness: 0.4, transparent: true });
  const halo = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.008, 8, 128), haloMat);
  eye.add(halo);
  eyeMats.push(haloMat);

  const rimMat = new THREE.MeshStandardMaterial({
    color: 0x121212, emissive: ACCENT, emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.5, transparent: true
  });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.006, 8, 96), rimMat);
  eye.add(rim);
  eyeMats.push(rimMat);

  const key = new THREE.DirectionalLight(0xfff4e0, 0.5);
  key.position.set(-600, 400, 800);
  scene.add(key);

  // ---------- work cover planes (DOM-synced) ----------
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
      pos.z += sin(uv.y * 3.14159) * uVelocity * -26.0; // curve while scrolling
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
      // background-size: cover
      float pr = uPlaneAspect; float tr = uTexAspect;
      vec2 crop = (pr / tr < 1.0) ? vec2(pr / tr, 1.0) : vec2(1.0, tr / pr);
      vec2 uv = (vUv - 0.5);
      uv *= (1.0 - 0.06 * uHover);            // hover zoom
      // hover ripple out from the pointer
      vec2 fromMouse = vUv - uMouse;
      float d = length(fromMouse);
      uv += normalize(fromMouse + 1e-4) * sin(d * 22.0 - uTime * 5.0) * 0.006 * uHover;
      // fluid trail displacement
      float e = 0.012;
      vec2 grad = vec2(
        texture2D(uTrail, vScreenUv + vec2(e, 0.0)).r - texture2D(uTrail, vScreenUv - vec2(e, 0.0)).r,
        texture2D(uTrail, vScreenUv + vec2(0.0, e)).r - texture2D(uTrail, vScreenUv - vec2(0.0, e)).r
      );
      uv += grad * 0.03;
      uv = uv * crop + 0.5;
      float shift = 0.006 * uHover;
      vec3 col;
      col.r = texture2D(uMap, uv + vec2(shift, 0.0)).r;
      col.g = texture2D(uMap, uv).g;
      col.b = texture2D(uMap, uv - vec2(shift, 0.0)).b;
      float gray = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(gray), col, 0.82 + 0.18 * uHover);
      col *= 0.94 + 0.08 * uHover;
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
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 24, 8), material);
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
        enter: () => { cover.hoverTarget = 1; },
        leave: () => { cover.hoverTarget = 0; },
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
          if (disposed) { texture.dispose(); return; }
          // NOTE: no SRGBColorSpace here — coverFrag is a raw ShaderMaterial writing
          // straight to the drawing buffer, so sampling must stay byte-faithful to the
          // DOM <img> (an sRGB decode would render every cover gamma-darkened).
          texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
          material.uniforms.uMap.value = texture;
          material.uniforms.uTexAspect.value = texture.image.width / Math.max(1, texture.image.height);
          cover.ready = true;
          mesh.visible = true;
          el.classList.add("gl-ready");
        },
        undefined,
        () => undefined // keep the DOM <img> on failure
      );
      covers.push(cover);
    }
  };

  // ---------- pointer / scroll state ----------
  const pointer = { x: -10, y: -10, lastX: -10, lastY: -10, strength: 0, vx: 0, vy: 0 };
  const onPointerMove = (e: PointerEvent): void => {
    // documentElement.clientWidth excludes the classic scrollbar, matching the
    // fixed canvas box — window.innerWidth would skew splats near the right edge.
    const w = document.documentElement.clientWidth || 1;
    const h = document.documentElement.clientHeight || 1;
    const nx = e.clientX / w;
    const ny = 1 - e.clientY / h;
    if (pointer.x > -5) {
      pointer.vx = (nx - pointer.x) * 60;
      pointer.vy = (ny - pointer.y) * 60;
      const speed = Math.hypot(nx - pointer.x, ny - pointer.y);
      pointer.strength = Math.min(1, pointer.strength + speed * 14);
    }
    pointer.x = nx;
    pointer.y = ny;
  };
  window.addEventListener("pointermove", onPointerMove, { passive: true });

  let smoothVel = 0;
  let lastScroll = scrollState.y || window.scrollY || 0;

  // ---------- sizing ----------
  const resize = (): void => {
    // Size from the canvas CSS box (scrollbar-exclusive), not window.innerWidth,
    // so GL pixels stay aligned with DOM rects on classic-scrollbar platforms.
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
  const pointerLerped = new THREE.Vector2(-10, -10);
  const pointerScratch = new THREE.Vector2(-10, -10);

  const renderFrame = (): void => {
    const dt = Math.min(0.1, clock.getDelta());
    const t = clock.elapsedTime;
    const k = dt * 60; // frame-rate normalization (decays authored at 60Hz)
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    const scroll = scrollState.y || window.scrollY || 0;

    smoothVel += (scroll - lastScroll - smoothVel) * 0.12;
    lastScroll = scroll;

    // -- trail feedback pass --
    trailMat.uniforms.uPrev.value = trailA.texture;
    trailMat.uniforms.uPointer.value.set(pointer.x, pointer.y);
    trailMat.uniforms.uVel.value.set(pointer.vx, pointer.vy);
    trailMat.uniforms.uStrength.value = pointer.strength * 0.5;
    trailMat.uniforms.uDecay.value = Math.pow(0.955, k);
    renderer.setRenderTarget(trailB);
    renderer.clear();
    renderer.render(trailScene, orthoCam);
    renderer.setRenderTarget(null);
    const swap = trailA; trailA = trailB; trailB = swap;
    pointer.strength *= Math.pow(0.6, k);
    pointer.vx *= Math.pow(0.8, k);
    pointer.vy *= Math.pow(0.8, k);
    const trailTex = trailA.texture;
    bgMat.uniforms.uTrail.value = trailTex;

    // -- background uniforms --
    bgMat.uniforms.uTime.value = t;
    const docH = Math.max(1, document.documentElement.scrollHeight - h);
    bgMat.uniforms.uScroll.value = Math.min(1, scroll / docH);

    // -- eye scrub --
    const heroP = Math.min(1, scroll / (h * 0.9));
    const eyeScale = Math.min(w, h) * 0.3 * (1 - heroP * 0.35);
    eye.scale.setScalar(Math.max(1, eyeScale));
    const baseX = w < 780 ? 0 : w * 0.22;
    eye.position.set(baseX * (1 - heroP * 0.4), h * 0.02 + heroP * h * 0.85, -60);
    const eyeOpacity = Math.max(0, 1 - heroP * 1.15);
    for (const m of eyeMats) (m as THREE.MeshStandardMaterial).opacity = eyeOpacity;
    eye.visible = eyeOpacity > 0.01;
    if (quality.animate && eye.visible) {
      iris.rotation.z = t * 0.03;
      pupil.rotation.y = -t * 0.01;
      halo.rotation.z = -t * 0.012;
      for (let i = 0; i < bladeCount; i += 1) {
        placeBlade(dummy, i, bladeCount, Math.sin(t * 0.4 + i * 0.26) * 0.05);
        blades.setMatrixAt(i, dummy.matrix);
      }
      blades.instanceMatrix.needsUpdate = true;
      pointerScratch.set(pointer.x, pointer.y);
      pointerLerped.lerp(pointerScratch, 0.04);
      eye.rotation.y = (pointerLerped.x - 0.5) * 0.5;
      eye.rotation.x = -(pointerLerped.y - 0.5) * 0.35;
    }

    // -- cover planes: sync to DOM rects --
    const velNorm = THREE.MathUtils.clamp(smoothVel / 60, -1, 1);
    for (const cover of covers) {
      if (!cover.ready) continue;
      const rect = cover.el.getBoundingClientRect();
      const visible = rect.bottom > -80 && rect.top < h + 80;
      cover.mesh.visible = visible;
      if (!visible) continue;
      cover.mesh.position.set(rect.left + rect.width / 2 - w / 2, -(rect.top + rect.height / 2 - h / 2), 0);
      cover.mesh.scale.set(Math.max(1, rect.width), Math.max(1, rect.height), 1);
      cover.hover += (cover.hoverTarget - cover.hover) * 0.08;
      cover.mouse.lerp(cover.mouseTarget, 0.12);
      const u = cover.mesh.material.uniforms;
      u.uHover.value = cover.hover;
      u.uTime.value = t;
      u.uVelocity.value = velNorm;
      u.uTrail.value = trailTex;
      u.uPlaneAspect.value = rect.width / Math.max(1, rect.height);
      u.uMouse.value.copy(cover.mouse);
    }

    // -- composite --
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
      // The fullscreen quads live in trailScene/bgScene, outside the main traverse.
      for (const s of [trailScene, bgScene]) {
        s.traverse((o) => { (o as THREE.Mesh).geometry?.dispose(); });
      }
      trailMat.dispose();
      bgMat.dispose();
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
