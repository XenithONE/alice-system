import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { assetPath, type FragmentId, type World } from "../data/worlds";
import type { ProgressState } from "./storage";
import { dailySeed, mulberry32 } from "./seed";
import { type QualityTier } from "./webgl";

interface PlanetNode {
  group: THREE.Group;
  world: World;
  surface: THREE.Mesh;
  atmosphere: THREE.Mesh;
  surfaceDetail?: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  weatherLayer?: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  cloudShadowLayer?: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  terrainGlints?: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  nightNetwork?: THREE.Group;
  exosphere?: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  atmosphericRim?: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  magnetosphere?: THREE.Group;
  orbitalInfrastructure?: THREE.Group;
  moonlets?: THREE.InstancedMesh;
  ring?: THREE.Mesh;
  ringDebris?: THREE.Group;
  clouds?: THREE.Mesh;
  beacon?: THREE.Sprite;
  radius: number;
  phase: number;
  completed: boolean;
}

interface AnomalyNode {
  group: THREE.Group;
  fragment: FragmentId;
  core: THREE.Object3D;
  taken: boolean;
}

interface BlackHoleNode {
  group: THREE.Group;
  disk: THREE.Mesh<THREE.RingGeometry, THREE.ShaderMaterial>;
  horizon: THREE.Mesh;
  portrait?: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  lensShell?: THREE.Mesh;
  corona?: THREE.Sprite;
  jets?: THREE.Mesh[];
  debris?: THREE.Points;
  photonCage?: THREE.Group;
  plume?: THREE.Group;
  caustics?: THREE.Group;
  lensingArcs?: THREE.Group;
  infall?: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  lensingStarfield?: THREE.Group;
  photonSheath?: THREE.Group;
  polarizationField?: THREE.Group;
  accretionStructure?: THREE.Group;
  rubbleHalo?: THREE.Group;
}

export interface CosmosInfo {
  quality: QualityTier["label"];
  spark: boolean;
  webgl2: boolean;
  bloom: boolean;
  gravity: boolean;
  flare: boolean;
  rays: boolean;
  msaa: number;
  particles: number;
}

export interface TimeTrialEvent {
  phase: "start" | "tick" | "checkpoint" | "finish" | "cancel";
  index: number;
  total: number;
  ms: number;
}

export interface CosmosCallbacks {
  onSelectWorld: (world: World) => void;
  onNearestWorld: (world: World | null) => void;
  onCollectFragment: (fragment: FragmentId) => void;
  onRevealHiddenPlanet: () => void;
  onReady: (info: CosmosInfo) => void;
  onError: (message: string) => void;
  onCollectStardust: (id: string) => void;
  onFlyDistance: (units: number) => void;
  onTimeTrial: (event: TimeTrialEvent) => void;
}

interface FocusState {
  startedAt: number;
  duration: number;
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromQuat: THREE.Quaternion;
  toQuat: THREE.Quaternion;
  world: World | null;
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const TMP_COLOR = new THREE.Color();
const TMP_VEC = new THREE.Vector3();
const TMP_VEC_2 = new THREE.Vector3();
const TMP_VEC_3 = new THREE.Vector3();
const TMP_OBJ = new THREE.Object3D();
const CLAMP_MIN = new THREE.Vector3(-105, -48, -105);
const CLAMP_MAX = new THREE.Vector3(105, 56, 105);

function rng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    material.forEach((entry) => disposeMaterial(entry));
    return;
  }
  for (const key of ["map", "alphaMap", "bumpMap", "roughnessMap", "emissiveMap", "normalMap", "displacementMap"]) {
    const texture = (material as unknown as Record<string, unknown>)[key];
    if (texture instanceof THREE.Texture) texture.dispose();
  }
  if (material instanceof THREE.ShaderMaterial) {
    for (const uniform of Object.values(material.uniforms)) {
      const value = uniform.value;
      if (value instanceof THREE.Texture) value.dispose();
    }
  }
  material.dispose();
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// Derive cheap surface relief and mineral variation from a planet's own color map luminance (no extra assets).
function applyLuminanceBump(material: THREE.MeshStandardMaterial, strength = 0.6, accent = 0x33e7c8): void {
  const accentColor = new THREE.Color(accent);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBumpStrength = { value: strength };
    shader.uniforms.uPlanetAccent = { value: accentColor };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uBumpStrength;
        uniform vec3 uPlanetAccent;
        float _planetHash(vec2 p){ p = fract(p * vec2(173.31, 419.67)); p += dot(p, p + 31.17); return fract(p.x * p.y); }
        float _lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }`
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        #ifdef USE_MAP
          float _vein = sin(vMapUv.x * 82.0 + sin(vMapUv.y * 31.0) * 4.0);
          float _micro = _planetHash(floor(vMapUv * vec2(220.0, 116.0)));
          float _mineral = smoothstep(0.72, 0.98, _vein * 0.5 + 0.5) * (0.45 + _micro * 0.55);
          diffuseColor.rgb = mix(diffuseColor.rgb * 0.82, diffuseColor.rgb + uPlanetAccent * 0.34, _mineral * 0.22);
          diffuseColor.rgb += (uPlanetAccent - diffuseColor.rgb) * ((_micro - 0.5) * 0.055);
        #endif`
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        #ifdef USE_MAP
          float _h  = _lum(texture2D(map, vMapUv).rgb);
          float _hx = _lum(texture2D(map, vMapUv + vec2(1.0 / 1024.0, 0.0)).rgb);
          float _hy = _lum(texture2D(map, vMapUv + vec2(0.0, 1.0 / 1024.0)).rgb);
          normal = normalize(normal + vec3((_h - _hx) * uBumpStrength, (_h - _hy) * uBumpStrength, 0.0));
        #endif`
      );
  };
  material.needsUpdate = true;
}

// Soft radial sun glow (canvas-generated; no asset fetch, bloom-friendly additive).
function makeGlowTexture(size = 256): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0.0, "rgba(255,255,245,1)");
  grad.addColorStop(0.2, "rgba(255,232,176,0.9)");
  grad.addColorStop(0.5, "rgba(255,182,96,0.25)");
  grad.addColorStop(1.0, "rgba(255,150,60,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeDistantGalaxyTexture(seed: number, size = 768): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const rand = rng(seed);
  const cx = size / 2;
  const cy = size / 2;
  const hueA = 190 + rand() * 42;
  const hueB = rand() > 0.52 ? 28 + rand() * 28 : 300 + rand() * 34;

  g.clearRect(0, 0, size, size);
  g.globalCompositeOperation = "lighter";

  g.save();
  g.translate(cx, cy);
  g.scale(1, 0.38 + rand() * 0.18);
  const halo = g.createRadialGradient(0, 0, 0, 0, 0, size * 0.44);
  halo.addColorStop(0.0, "rgba(255,255,245,0.9)");
  halo.addColorStop(0.18, `hsla(${hueB}, 96%, 76%, 0.42)`);
  halo.addColorStop(0.52, `hsla(${hueA}, 92%, 66%, 0.18)`);
  halo.addColorStop(1.0, `hsla(${hueA}, 92%, 58%, 0)`);
  g.fillStyle = halo;
  g.beginPath();
  g.ellipse(0, 0, size * 0.36, size * 0.18, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();

  for (let arm = 0; arm < 4; arm += 1) {
    for (let pass = 0; pass < 4; pass += 1) {
      const spread = 0.13 + pass * 0.038;
      const alpha = 0.055 - pass * 0.008;
      g.save();
      g.translate(cx, cy);
      g.rotate((arm / 4) * Math.PI * 2 + (rand() - 0.5) * 0.12);
      g.scale(1, 0.42 + rand() * 0.1);
      g.lineCap = "round";
      g.lineJoin = "round";
      g.lineWidth = 1.0 + pass * 1.25;
      g.strokeStyle = pass % 2 === 0
        ? `hsla(${hueA}, 100%, ${62 + pass * 4}%, ${alpha})`
        : `hsla(${hueB}, 100%, ${68 + pass * 3}%, ${alpha * 0.82})`;
      g.beginPath();
      for (let i = 0; i <= 240; i += 1) {
        const t = i / 240;
        const r = Math.pow(t, 0.82) * size * (0.11 + spread);
        const a = t * (5.8 + rand() * 0.7) + Math.sin(t * 12.0 + seed) * 0.05;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      g.restore();
    }
  }

  for (let i = 0; i < 920; i += 1) {
    const a = rand() * Math.PI * 2;
    const r = Math.pow(rand(), 1.9) * size * 0.43;
    const yScale = 0.22 + rand() * 0.32;
    const x = cx + Math.cos(a) * r + (rand() - 0.5) * size * 0.035;
    const y = cy + Math.sin(a) * r * yScale + (rand() - 0.5) * size * 0.03;
    const alpha = 0.045 + Math.pow(rand(), 4.2) * 0.62;
    const radius = 0.45 + Math.pow(rand(), 3.2) * 2.8;
    const warm = rand() > 0.58;
    const glow = g.createRadialGradient(x, y, 0, x, y, radius * 5.5);
    glow.addColorStop(0, warm ? `hsla(${hueB}, 100%, 88%, ${alpha})` : `hsla(${hueA}, 100%, 86%, ${alpha})`);
    glow.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = glow;
    g.beginPath();
    g.arc(x, y, radius * 5.5, 0, Math.PI * 2);
    g.fill();
  }

  const core = g.createRadialGradient(cx, cy, 0, cx, cy, size * 0.075);
  core.addColorStop(0.0, "rgba(255,246,214,0.92)");
  core.addColorStop(0.32, `hsla(${hueB}, 100%, 76%, 0.48)`);
  core.addColorStop(1.0, "rgba(255,246,214,0)");
  g.fillStyle = core;
  g.beginPath();
  g.arc(cx, cy, size * 0.075, 0, Math.PI * 2);
  g.fill();

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeAccretionTexture(width = 1024, height = 512): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const g = c.getContext("2d")!;
  const cx = width / 2;
  const cy = height / 2;
  const rand = rng(5021);

  g.clearRect(0, 0, width, height);
  g.globalCompositeOperation = "lighter";
  g.save();
  g.translate(cx, cy);
  g.scale(1, 0.25);
  const glow = g.createRadialGradient(0, 0, 12, 0, 0, width * 0.43);
  glow.addColorStop(0.0, "rgba(255,246,214,0.98)");
  glow.addColorStop(0.16, "rgba(255,217,138,0.72)");
  glow.addColorStop(0.46, "rgba(255,104,154,0.28)");
  glow.addColorStop(0.78, "rgba(51,231,200,0.16)");
  glow.addColorStop(1.0, "rgba(51,231,200,0)");
  g.fillStyle = glow;
  g.beginPath();
  g.ellipse(0, 0, width * 0.39, height * 0.78, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();

  for (let i = 0; i < 150; i += 1) {
    const radius = width * (0.13 + rand() * 0.27);
    const start = -Math.PI * 0.18 + rand() * Math.PI * 1.42;
    const length = Math.PI * (0.18 + rand() * 0.5);
    const yScale = 0.18 + rand() * 0.11;
    const warm = rand() > 0.24;
    g.save();
    g.translate(cx + (rand() - 0.5) * 18, cy + (rand() - 0.5) * 12);
    g.scale(1, yScale);
    g.rotate((rand() - 0.5) * 0.08);
    g.lineWidth = 1.3 + rand() * 4.6;
    g.strokeStyle = warm
      ? `rgba(255,${170 + Math.floor(rand() * 66)},${110 + Math.floor(rand() * 90)},${0.08 + rand() * 0.25})`
      : `rgba(${60 + Math.floor(rand() * 65)},235,220,${0.05 + rand() * 0.14})`;
    g.beginPath();
    g.arc(0, 0, radius, start, start + length);
    g.stroke();
    g.restore();
  }

  g.globalCompositeOperation = "destination-out";
  g.save();
  g.translate(cx, cy);
  g.scale(1, 0.34);
  const cut = g.createRadialGradient(0, 0, 0, 0, 0, width * 0.13);
  cut.addColorStop(0.0, "rgba(0,0,0,1)");
  cut.addColorStop(0.56, "rgba(0,0,0,0.9)");
  cut.addColorStop(1.0, "rgba(0,0,0,0)");
  g.fillStyle = cut;
  g.beginPath();
  g.ellipse(0, 0, width * 0.16, height * 0.56, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makePlanetDetailTexture(seed: number, size = 512): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d")!;
  const image = g.createImageData(size, size);
  const rand = rng(9091 + seed * 7919);
  const phaseA = rand() * Math.PI * 2;
  const phaseB = rand() * Math.PI * 2;
  const phaseC = rand() * Math.PI * 2;

  for (let y = 0; y < size; y += 1) {
    const ny = y / size;
    for (let x = 0; x < size; x += 1) {
      const nx = x / size;
      const ridgeA = Math.sin(nx * 42.0 + Math.sin(ny * 13.0 + phaseA) * 2.5 + phaseB);
      const ridgeB = Math.sin((nx + ny) * 95.0 + Math.sin(nx * 18.0 + phaseC) * 1.7);
      const continents = Math.sin(nx * 11.0 + phaseA) * Math.cos(ny * 7.0 + phaseB);
      const cellX = ((nx * 12.0 + phaseA) % 1 + 1) % 1 - 0.5;
      const cellY = ((ny * 7.0 + phaseB) % 1 + 1) % 1 - 0.5;
      const crater = Math.max(0, 1 - Math.hypot(cellX, cellY) * 5.2);
      const fine = Math.sin(nx * 210.0 + ny * 137.0 + phaseC) * 0.08;
      const value = 126 + ridgeA * 21 + ridgeB * 13 + continents * 27 - crater * crater * 44 + fine * 255;
      const px = (y * size + x) * 4;
      const v = Math.max(30, Math.min(235, Math.round(value)));
      image.data[px] = v;
      image.data[px + 1] = v;
      image.data[px + 2] = v;
      image.data[px + 3] = 255;
    }
  }

  g.putImageData(image, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function makePlanetEmissionTexture(seed: number, size = 768): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d")!;
  const rand = rng(12011 + seed * 1879);

  g.fillStyle = "rgb(0,0,0)";
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = "lighter";
  g.lineCap = "round";
  g.lineJoin = "round";

  for (let belt = 0; belt < 7; belt += 1) {
    const y = size * (0.22 + rand() * 0.56);
    const amp = size * (0.01 + rand() * 0.035);
    const freq = 1.3 + rand() * 3.4;
    const phase = rand() * Math.PI * 2;
    g.strokeStyle = `rgba(255,255,255,${0.018 + rand() * 0.035})`;
    g.lineWidth = 0.6 + rand() * 1.1;
    g.beginPath();
    for (let x = -12; x <= size + 12; x += 9) {
      const yy = y + Math.sin((x / size) * Math.PI * 2 * freq + phase) * amp + (rand() - 0.5) * 4;
      if (x <= -12) g.moveTo(x, yy);
      else g.lineTo(x, yy);
    }
    g.stroke();
  }

  for (let i = 0; i < 130; i += 1) {
    const startX = rand() * size;
    const startY = size * (0.14 + rand() * 0.72);
    const steps = 3 + Math.floor(rand() * 7);
    const length = size * (0.025 + rand() * 0.095);
    let x = startX;
    let y = startY;
    g.strokeStyle = `rgba(255,255,255,${0.025 + rand() * 0.12})`;
    g.lineWidth = 0.45 + rand() * 1.35;
    g.beginPath();
    g.moveTo(x, y);
    for (let j = 0; j < steps; j += 1) {
      x += (rand() - 0.5) * length;
      y += (rand() - 0.5) * length * 0.62;
      g.lineTo(x, y);
    }
    g.stroke();

    if (rand() > 0.42) {
      const r = 0.9 + rand() * 2.3;
      const alpha = 0.06 + rand() * 0.18;
      const glow = g.createRadialGradient(x, y, 0, x, y, r * 6);
      glow.addColorStop(0, `rgba(255,255,255,${alpha})`);
      glow.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = glow;
      g.beginPath();
      g.arc(x, y, r * 6, 0, Math.PI * 2);
      g.fill();
    }
  }

  const image = g.getImageData(0, 0, size, size);
  const data = image.data;
  for (let y = 0; y < size; y += 1) {
    const latitude = Math.abs(y / size - 0.5) * 2;
    const latMask = Math.max(0, 1 - Math.pow(latitude, 2.2));
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const n = Math.sin((x * 0.031 + seed) + Math.sin(y * 0.027) * 2.1) * 0.5 + 0.5;
      const glow = Math.max(data[i], data[i + 1], data[i + 2]);
      const v = Math.min(255, Math.round(glow * (0.42 + latMask * 0.72) + Math.pow(n, 10) * 18 * latMask));
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  g.putImageData(image, 0, 0);

  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const GRAVITY_LENS_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uAspect: { value: 1 },
    uRadius: { value: 0.32 },
    uStrength: { value: 0 },
    uTime: { value: 0 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 uCenter;
    uniform float uAspect;
    uniform float uRadius;
    uniform float uStrength;
    uniform float uTime;
    varying vec2 vUv;
    void main() {
      vec2 delta = vUv - uCenter;
      delta.x *= uAspect;
      float d = length(delta);
      float lens = smoothstep(uRadius, 0.0, d);
      vec2 dir = normalize(delta + vec2(0.0001));
      vec2 tangent = vec2(-dir.y, dir.x);
      float swirl = sin(d * 36.0 - uTime * 0.55) * 0.12;
      vec2 offset = (dir * -0.54 + tangent * swirl) * lens * uStrength;
      offset.x /= uAspect;
      vec2 uv = clamp(vUv + offset, 0.001, 0.999);
      vec3 base = texture2D(tDiffuse, uv).rgb;
      vec3 splitA = texture2D(tDiffuse, clamp(uv + offset * 0.05, 0.001, 0.999)).rgb;
      vec3 splitB = texture2D(tDiffuse, clamp(uv - offset * 0.05, 0.001, 0.999)).rgb;
      vec3 color = mix(base, vec3(splitA.r, base.g, splitB.b), 0.18);
      float angle = atan(delta.y, delta.x);
      float caustic = pow(sin(angle * 18.0 + d * 46.0 - uTime * 0.72) * 0.5 + 0.5, 8.0);
      float counter = pow(sin(-angle * 31.0 + d * 63.0 + uTime * 0.38) * 0.5 + 0.5, 14.0);
      float shadow = smoothstep(0.2, 0.0, d) * lens;
      float photon = (1.0 - smoothstep(0.0, 0.014, abs(d - 0.155))) * lens;
      float outerPhoton = (1.0 - smoothstep(0.0, 0.021, abs(d - 0.225))) * lens;
      color *= 1.0 - shadow * 0.22;
      color += vec3(1.0, 0.68, 0.36) * photon * (0.035 + caustic * 0.035);
      color += vec3(0.38, 0.96, 1.0) * outerPhoton * (0.012 + counter * 0.024);
      gl_FragColor = vec4(color, 1.0);
    }
  `
};

const LIGHT_SHAFT_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uAspect: { value: 1 },
    uStrength: { value: 0 },
    uTime: { value: 0 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 uCenter;
    uniform float uAspect;
    uniform float uStrength;
    uniform float uTime;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(181.13, 271.17));
      p += dot(p, p + 37.31);
      return fract(p.x * p.y);
    }

    vec3 bright(vec2 uv) {
      vec3 color = texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).rgb;
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      float gate = smoothstep(0.44, 1.12, luma);
      return color * gate;
    }

    void main() {
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      vec2 delta = (vUv - uCenter) * vec2(uAspect, 1.0);
      float dist = length(delta);
      vec2 dir = vUv - uCenter;
      float radialMask = smoothstep(0.03, 0.18, dist) * (1.0 - smoothstep(0.38, 0.92, dist));
      float angle = atan(delta.y, delta.x);
      float vane = pow(sin(angle * 9.0 + sin(dist * 18.0 - uTime * 0.4) * 0.7) * 0.5 + 0.5, 3.4);
      float grain = hash(floor(vec2(angle * 18.0, dist * 70.0)));

      vec3 rays = vec3(0.0);
      rays += bright(vUv - dir * 0.11) * 0.28;
      rays += bright(vUv - dir * 0.19) * 0.22;
      rays += bright(vUv - dir * 0.31) * 0.16;
      rays += bright(vUv - dir * 0.46) * 0.095;
      rays += bright(vUv - dir * 0.64) * 0.052;
      rays *= radialMask * (0.3 + vane * 0.7) * (0.84 + grain * 0.28);

      float occlusion = smoothstep(0.13, 0.28, dist);
      vec3 amber = vec3(1.0, 0.74, 0.42);
      vec3 cyan = vec3(0.38, 0.98, 0.9);
      vec3 tint = mix(cyan, amber, smoothstep(-0.42, 0.28, sin(angle - 0.15)));
      vec3 color = base + rays * tint * uStrength * occlusion;
      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
  `
};

const ANAMORPHIC_STREAK_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uIntensity: { value: 0.42 },
    uTime: { value: 0 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uIntensity;
    uniform float uTime;
    varying vec2 vUv;

    vec3 brightSample(vec2 uv) {
      vec3 c = texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).rgb;
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      float gate = smoothstep(0.58, 1.24, luma);
      return c * gate * gate;
    }

    void main() {
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      vec2 px = 1.0 / max(uResolution, vec2(1.0));
      vec2 horizontal = vec2(px.x, 0.0);
      vec2 diagonalA = normalize(vec2(px.x * 1.9, px.y * 0.42));
      vec2 diagonalB = normalize(vec2(px.x * 1.9, -px.y * 0.42));
      float shimmer = 0.93 + sin(uTime * 0.73 + vUv.y * 18.0) * 0.07;

      vec3 streak = vec3(0.0);
      streak += brightSample(vUv + horizontal * 7.0) * 0.26;
      streak += brightSample(vUv - horizontal * 7.0) * 0.26;
      streak += brightSample(vUv + horizontal * 17.0) * 0.18;
      streak += brightSample(vUv - horizontal * 17.0) * 0.18;
      streak += brightSample(vUv + horizontal * 35.0) * 0.105;
      streak += brightSample(vUv - horizontal * 35.0) * 0.105;
      streak += brightSample(vUv + horizontal * 68.0) * 0.052;
      streak += brightSample(vUv - horizontal * 68.0) * 0.052;
      streak += brightSample(vUv + diagonalA * px * 52.0) * 0.045;
      streak += brightSample(vUv - diagonalA * px * 52.0) * 0.045;
      streak += brightSample(vUv + diagonalB * px * 38.0) * 0.035;
      streak += brightSample(vUv - diagonalB * px * 38.0) * 0.035;

      float luma = dot(base, vec3(0.2126, 0.7152, 0.0722));
      float preserveText = 1.0 - smoothstep(0.04, 0.42, luma) * (1.0 - smoothstep(0.82, 1.0, luma));
      vec3 tint = vec3(0.96, 0.86, 0.68);
      vec3 color = base + streak * tint * uIntensity * shimmer * (0.78 + preserveText * 0.22);
      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
  `
};

const LENS_ARTIFACT_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uAspect: { value: 1 },
    uStrength: { value: 0 },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 uCenter;
    uniform float uAspect;
    uniform float uStrength;
    uniform float uTime;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(431.17, 211.93));
      p += dot(p, p + 29.37);
      return fract(p.x * p.y);
    }

    float disk(vec2 uv, vec2 pos, float radius, float feather) {
      float d = length((uv - pos) * vec2(uAspect, 1.0));
      return 1.0 - smoothstep(radius, radius + feather, d);
    }

    float ring(vec2 uv, vec2 pos, float radius, float width) {
      float d = length((uv - pos) * vec2(uAspect, 1.0));
      return smoothstep(radius - width, radius, d) * (1.0 - smoothstep(radius, radius + width, d));
    }

    float hexGhost(vec2 uv, vec2 pos, float radius) {
      vec2 p = (uv - pos) * vec2(uAspect, 1.0);
      float a = atan(p.y, p.x);
      float sector = 6.2831853 / 6.0;
      float edge = cos(floor(0.5 + a / sector) * sector - a) * length(p);
      float body = 1.0 - smoothstep(radius * 0.82, radius, edge);
      float cut = smoothstep(radius * 0.18, radius * 0.42, edge);
      return body * cut;
    }

    void main() {
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      vec2 screenCenter = vec2(0.5);
      vec2 fromSource = screenCenter - uCenter;
      float sourceInside = step(-0.12, uCenter.x) * step(uCenter.x, 1.12) * step(-0.12, uCenter.y) * step(uCenter.y, 1.12);
      float axisLen = max(0.001, length(fromSource));
      vec2 axis = fromSource / axisLen;
      vec2 rel = vUv - uCenter;
      float lineDist = abs(rel.x * axis.y - rel.y * axis.x);
      float lineAlong = 1.0 - smoothstep(0.08, 0.96, abs(dot(rel, axis)));
      float thinStreak = (1.0 - smoothstep(0.0015, 0.009, lineDist)) * lineAlong;
      float broadStreak = (1.0 - smoothstep(0.014, 0.092, lineDist)) * lineAlong * 0.22;

      vec2 g1 = screenCenter + fromSource * 0.58;
      vec2 g2 = screenCenter + fromSource * 1.05;
      vec2 g3 = screenCenter + fromSource * 1.62;
      vec2 g4 = screenCenter - fromSource * 0.42;
      float shimmer = 0.88 + sin(uTime * 0.84 + vUv.x * 18.0) * 0.12;
      float dust = hash(floor(vUv * uResolution * 0.18 + uTime * 0.21));
      float gate = smoothstep(0.22, 0.86, axisLen) * sourceInside;

      vec3 artifact = vec3(0.0);
      artifact += vec3(1.0, 0.73, 0.42) * (thinStreak * 0.19 + broadStreak * 0.34);
      artifact += vec3(0.42, 0.98, 0.92) * ring(vUv, g1, 0.052, 0.011) * 0.45;
      artifact += vec3(1.0, 0.55, 0.82) * hexGhost(vUv, g2, 0.074) * 0.28;
      artifact += vec3(0.74, 0.78, 1.0) * ring(vUv, g3, 0.104, 0.016) * 0.25;
      artifact += vec3(1.0, 0.86, 0.55) * disk(vUv, g4, 0.024, 0.018) * 0.36;
      artifact += vec3(0.34, 0.95, 1.0) * disk(vUv, uCenter, 0.032, 0.054) * 0.24;
      artifact *= gate * uStrength * shimmer * (0.92 + dust * 0.16);

      vec2 edge = abs(vUv - 0.5) * vec2(uAspect, 1.0);
      float preserveEdges = 1.0 - smoothstep(0.46, 0.88, length(edge));
      vec3 color = base + artifact * (0.72 + preserveEdges * 0.28);
      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
  `
};

const SENSOR_DIFFRACTION_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uAspect: { value: 1 },
    uStrength: { value: 0 },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 uCenter;
    uniform float uAspect;
    uniform float uStrength;
    uniform float uTime;
    uniform vec2 uResolution;
    varying vec2 vUv;

    const float PI = 3.14159265359;
    const float TAU = 6.28318530718;

    float luma(vec3 c) {
      return dot(c, vec3(0.2126, 0.7152, 0.0722));
    }

    float hash(vec2 p) {
      p = fract(p * vec2(257.73, 613.11));
      p += dot(p, p + 37.37);
      return fract(p.x * p.y);
    }

    vec3 readScene(vec2 uv) {
      return texture2D(tDiffuse, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
    }

    vec3 brightScene(vec2 uv) {
      vec3 c = readScene(uv);
      float gate = smoothstep(0.42, 1.12, luma(c));
      return c * gate * gate;
    }

    float angleDelta(float a, float b) {
      return abs(mod(a - b + PI, TAU) - PI);
    }

    float apertureArm(float angle, float target, float width) {
      float d = angleDelta(angle, target);
      return 1.0 - smoothstep(width, width * 3.6, d);
    }

    float ring(vec2 uv, vec2 pos, float radius, float width) {
      float d = length((uv - pos) * vec2(uAspect, 1.0));
      return smoothstep(radius - width, radius, d) * (1.0 - smoothstep(radius, radius + width, d));
    }

    float softHex(vec2 uv, vec2 pos, float radius) {
      vec2 p = (uv - pos) * vec2(uAspect, 1.0);
      float a = atan(p.y, p.x);
      float sector = TAU / 6.0;
      float edge = cos(floor(0.5 + a / sector) * sector - a) * length(p);
      float shell = 1.0 - smoothstep(radius * 0.74, radius, edge);
      return shell * smoothstep(radius * 0.16, radius * 0.42, edge);
    }

    void main() {
      vec3 base = readScene(vUv);
      vec2 sourceDelta = (vUv - uCenter) * vec2(uAspect, 1.0);
      float dist = length(sourceDelta);
      float angle = atan(sourceDelta.y, sourceDelta.x);
      float sourceInside = step(-0.1, uCenter.x) * step(uCenter.x, 1.1) * step(-0.1, uCenter.y) * step(uCenter.y, 1.1);

      vec2 sampleX = vec2(0.026 / max(uAspect, 0.001), 0.0);
      vec2 sampleY = vec2(0.0, 0.026);
      vec3 sourceGlow = brightScene(uCenter + sampleX) * 0.2;
      sourceGlow += brightScene(uCenter - sampleX) * 0.2;
      sourceGlow += brightScene(uCenter + sampleY) * 0.2;
      sourceGlow += brightScene(uCenter - sampleY) * 0.2;
      sourceGlow += brightScene(uCenter + vec2(sampleX.x, sampleY.y) * 0.74) * 0.1;
      sourceGlow += brightScene(uCenter - vec2(sampleX.x, sampleY.y) * 0.74) * 0.1;
      float sourceEnergy = smoothstep(0.025, 0.42, luma(sourceGlow));

      float rotation = sin(uTime * 0.13) * 0.08;
      float primary = apertureArm(angle, rotation, 0.012) + apertureArm(angle, rotation + PI, 0.012);
      primary += apertureArm(angle, rotation + PI * 0.5, 0.012) + apertureArm(angle, rotation - PI * 0.5, 0.012);
      float secondary = apertureArm(angle, rotation + PI * 0.25, 0.018) + apertureArm(angle, rotation - PI * 0.25, 0.018);
      secondary += apertureArm(angle, rotation + PI * 0.75, 0.018) + apertureArm(angle, rotation - PI * 0.75, 0.018);
      float radial = smoothstep(0.032, 0.11, dist) * (1.0 - smoothstep(0.32, 1.02, dist));
      float falloff = pow(1.0 - smoothstep(0.08, 0.82, dist), 1.25);
      float sparkle = 0.84 + hash(floor(vUv * uResolution * 0.08 + uTime * 0.11)) * 0.22;
      float spikeMask = radial * falloff * (primary * 0.54 + secondary * 0.18) * sparkle;

      vec2 center = vec2(0.5);
      vec2 axis = center - uCenter;
      vec2 ghostA = center + axis * 0.42;
      vec2 ghostB = center + axis * 0.9;
      vec2 ghostC = center - axis * 0.56;
      float ghostMask = smoothstep(0.18, 0.84, length(axis)) * sourceInside;
      vec3 ghosts = vec3(0.0);
      ghosts += vec3(0.36, 1.0, 0.92) * ring(vUv, ghostA, 0.034, 0.006) * 0.3;
      ghosts += vec3(1.0, 0.48, 0.8) * softHex(vUv, ghostB, 0.052) * 0.22;
      ghosts += vec3(1.0, 0.82, 0.45) * ring(vUv, ghostC, 0.022, 0.01) * 0.24;

      vec3 spectralTint = mix(vec3(0.4, 0.95, 1.0), vec3(1.0, 0.72, 0.42), smoothstep(-0.5, 0.7, sin(angle * 2.0 + rotation)));
      vec3 diffraction = sourceGlow * spectralTint * spikeMask * 0.78;
      diffraction += ghosts * ghostMask * (0.32 + sourceEnergy * 0.68);

      float localY = luma(base);
      float protectMids = 0.7 + 0.3 * (1.0 - smoothstep(0.08, 0.52, localY) * (1.0 - smoothstep(0.82, 1.1, localY)));
      vec3 color = base + diffraction * uStrength * sourceInside * (0.35 + sourceEnergy * 0.9) * protectMids;
      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
  `
};

const CINEMATIC_DOF_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uAspect: { value: 1 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uStrength: { value: 0.34 },
    uTime: { value: 0 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 uCenter;
    uniform float uAspect;
    uniform vec2 uResolution;
    uniform float uStrength;
    uniform float uTime;
    varying vec2 vUv;

    float luma(vec3 c) {
      return dot(c, vec3(0.2126, 0.7152, 0.0722));
    }

    vec3 sampleBright(vec2 uv) {
      vec3 c = texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).rgb;
      float gate = smoothstep(0.45, 1.1, luma(c));
      return c * (0.44 + gate * 0.88);
    }

    void main() {
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      vec2 px = 1.0 / max(uResolution, vec2(1.0));
      vec2 focusDelta = (vUv - uCenter) * vec2(uAspect, 1.0);
      float focusDistance = length(focusDelta);
      vec2 vignetteDelta = (vUv - 0.5) * vec2(uAspect, 1.0);
      float edge = smoothstep(0.28, 0.95, length(vignetteDelta));
      float focusMask = smoothstep(0.2, 0.72, focusDistance);
      float blur = clamp((edge * 0.55 + focusMask * 0.45) * uStrength, 0.0, 0.82);
      float breathe = 0.92 + sin(uTime * 0.21) * 0.08;
      vec2 radius = px * (2.0 + blur * 6.0) * breathe;
      vec3 bokeh = base * 0.32;
      bokeh += sampleBright(vUv + radius * vec2(1.7, 0.0)) * 0.12;
      bokeh += sampleBright(vUv - radius * vec2(1.7, 0.0)) * 0.12;
      bokeh += sampleBright(vUv + radius * vec2(0.85, 1.47)) * 0.11;
      bokeh += sampleBright(vUv - radius * vec2(0.85, 1.47)) * 0.11;
      bokeh += sampleBright(vUv + radius * vec2(-0.85, 1.47)) * 0.11;
      bokeh += sampleBright(vUv - radius * vec2(-0.85, 1.47)) * 0.11;
      bokeh += sampleBright(vUv + radius * vec2(2.85, 0.5)) * 0.065;
      bokeh += sampleBright(vUv - radius * vec2(2.85, 0.5)) * 0.065;
      float highlight = smoothstep(0.55, 1.15, luma(bokeh));
      vec3 color = mix(base, bokeh + vec3(1.0, 0.82, 0.56) * highlight * 0.035, blur);
      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
  `
};

const FILMIC_GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uResolution: { value: new THREE.Vector2(1, 1) }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAspect;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(234.34, 435.23));
      p += dot(p, p + 37.21);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 centered = (vUv - 0.5) * vec2(uAspect, 1.0);
      float edgeFade = smoothstep(0.24, 0.94, length(centered));
      vec2 aberration = centered * edgeFade * 0.0022;
      vec3 source = texture2D(tDiffuse, vUv).rgb;
      vec3 color = vec3(
        texture2D(tDiffuse, clamp(vUv + aberration, 0.001, 0.999)).r,
        source.g,
        texture2D(tDiffuse, clamp(vUv - aberration, 0.001, 0.999)).b
      );
      color = mix(source, color, 0.38);
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      vec3 coolShadows = vec3(0.82, 0.95, 1.12);
      vec3 warmHighlights = vec3(1.08, 0.99, 0.9);
      color *= mix(coolShadows, vec3(1.0), smoothstep(0.08, 0.42, luma));
      color *= mix(vec3(1.0), warmHighlights, smoothstep(0.55, 1.0, luma));
      color = max(vec3(0.0), (color - 0.5) * 1.045 + 0.5);
      color = pow(color, vec3(0.91));
      float vignette = smoothstep(0.96, 0.2, length(centered));
      color *= mix(0.78, 1.035, vignette);
      float dirt = hash(floor(vUv * vec2(96.0, 54.0)));
      float dirtMask = smoothstep(0.68, 1.25, luma) * smoothstep(0.88, 0.99, dirt);
      color += vec3(1.0, 0.82, 0.55) * dirtMask * 0.012;
      float grain = hash(vUv * uResolution + uTime * 19.0) - 0.5;
      color += grain * 0.012;
      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
  `
};

const MICRO_CONTRAST_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uStrength: { value: 0.2 },
    uTime: { value: 0 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uStrength;
    uniform float uTime;
    varying vec2 vUv;

    float luma(vec3 c) {
      return dot(c, vec3(0.2126, 0.7152, 0.0722));
    }

    void main() {
      vec2 px = 1.0 / max(uResolution, vec2(1.0));
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      vec3 n1 = texture2D(tDiffuse, clamp(vUv + vec2(px.x, 0.0), 0.001, 0.999)).rgb;
      vec3 n2 = texture2D(tDiffuse, clamp(vUv - vec2(px.x, 0.0), 0.001, 0.999)).rgb;
      vec3 n3 = texture2D(tDiffuse, clamp(vUv + vec2(0.0, px.y), 0.001, 0.999)).rgb;
      vec3 n4 = texture2D(tDiffuse, clamp(vUv - vec2(0.0, px.y), 0.001, 0.999)).rgb;
      vec3 n5 = texture2D(tDiffuse, clamp(vUv + px * vec2(1.6, 1.1), 0.001, 0.999)).rgb;
      vec3 n6 = texture2D(tDiffuse, clamp(vUv - px * vec2(1.6, 1.1), 0.001, 0.999)).rgb;
      vec3 blur = (n1 + n2 + n3 + n4 + n5 + n6) / 6.0;
      vec3 detail = c - blur;
      float y = luma(c);
      float protect = smoothstep(0.035, 0.16, y) * (1.0 - smoothstep(0.86, 1.12, y));
      float sparkle = smoothstep(0.62, 1.2, y) * 0.26;
      vec3 color = c + detail * uStrength * (0.68 + protect * 0.74 + sparkle);
      color += max(detail, vec3(0.0)) * sparkle * 0.12;
      color = mix(vec3(luma(color)), color, 1.035);
      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
  `
};

const CINEMATIC_FINISH_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uAspect: { value: 1 },
    uStrength: { value: 0.28 },
    uTime: { value: 0 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uAspect;
    uniform float uStrength;
    uniform float uTime;
    varying vec2 vUv;

    float luma(vec3 c) {
      return dot(c, vec3(0.2126, 0.7152, 0.0722));
    }

    float hash(vec2 p) {
      p = fract(p * vec2(127.1, 311.7));
      p += dot(p, p + 19.19);
      return fract(p.x * p.y);
    }

    vec3 readScene(vec2 uv) {
      return texture2D(tDiffuse, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
    }

    vec3 brightScene(vec2 uv) {
      vec3 c = readScene(uv);
      float gate = smoothstep(0.48, 1.18, luma(c));
      return c * gate;
    }

    void main() {
      vec2 px = 1.0 / max(uResolution, vec2(1.0));
      vec2 centered = (vUv - 0.5) * vec2(uAspect, 1.0);
      float radius = length(centered);
      float edge = smoothstep(0.24, 0.98, radius);
      vec2 radial = centered / max(radius, 0.0001);

      vec3 source = readScene(vUv);
      float sourceY = luma(source);

      vec2 spectralShift = radial * (0.0008 + edge * 0.0018) * uStrength;
      vec3 spectral = vec3(
        readScene(vUv + spectralShift * 1.45).r,
        source.g,
        readScene(vUv - spectralShift * 1.15).b
      );

      vec2 longX = vec2(px.x, 0.0);
      vec2 longY = vec2(0.0, px.y);
      vec3 glow = vec3(0.0);
      glow += brightScene(vUv + longX * 6.0) * 0.16;
      glow += brightScene(vUv - longX * 6.0) * 0.16;
      glow += brightScene(vUv + longY * 5.0) * 0.12;
      glow += brightScene(vUv - longY * 5.0) * 0.12;
      glow += brightScene(vUv + px * vec2(12.0, 4.0)) * 0.095;
      glow += brightScene(vUv - px * vec2(12.0, 4.0)) * 0.095;
      glow += brightScene(vUv + px * vec2(-5.0, 10.0)) * 0.075;
      glow += brightScene(vUv - px * vec2(-5.0, 10.0)) * 0.075;
      glow *= vec3(0.88, 1.0, 1.14);

      vec3 color = mix(source, spectral, (0.12 + edge * 0.28) * uStrength);
      color += glow * (0.055 + edge * 0.025) * uStrength;

      float y = luma(color);
      float toe = smoothstep(0.018, 0.28, y);
      color *= mix(vec3(0.72, 0.82, 1.02), vec3(1.0), toe);
      color *= mix(0.86, 1.02, toe);
      float highlight = smoothstep(0.68, 1.22, y);
      color = mix(color, vec3(1.0) - exp(-color * 1.18), highlight * 0.34 * uStrength);

      vec3 localA = readScene(vUv + px * vec2(1.25, -0.75));
      vec3 localB = readScene(vUv - px * vec2(1.25, -0.75));
      vec3 detail = source - (localA + localB) * 0.5;
      float protect = smoothstep(0.035, 0.22, sourceY) * (1.0 - smoothstep(0.9, 1.18, sourceY));
      color += detail * protect * 0.16 * uStrength;

      float vignette = smoothstep(1.08, 0.22, radius);
      color *= mix(0.84, 1.025, vignette);
      float scan = sin((vUv.y * uResolution.y + uTime * 10.0) * 3.14159);
      color *= 1.0 + scan * 0.0025 * uStrength;
      float grain = hash(vUv * uResolution + uTime * 23.0) - 0.5;
      color += grain * 0.007 * uStrength * (1.0 - smoothstep(0.28, 0.92, sourceY));

      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
  `
};

export class CosmosEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly worlds: World[];
  private readonly callbacks: CosmosCallbacks;
  private readonly quality: QualityTier;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, 1, 0.1, 480);
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly loader = new THREE.TextureLoader();
  private readonly planets = new Map<string, PlanetNode>();
  private readonly pickables: THREE.Object3D[] = [];
  private readonly anomalies: AnomalyNode[] = [];
  private readonly keys = new Set<string>();
  private readonly galaxyUniforms = { uTime: { value: 0 }, uMap: { value: null as THREE.Texture | null }, uUseMap: { value: 0 } };
  private readonly animatedMaterials: THREE.ShaderMaterial[] = [];
  private deepPanorama: THREE.Group | null = null;
  private nebulaCanyonField: THREE.Group | null = null;
  private parallaxNebulaVolume: THREE.Group | null = null;
  private stellarNurseryField: THREE.Group | null = null;
  private composer: EffectComposer | null = null;
  private composerSamples = 0;
  private gravityPass: ShaderPass | null = null;
  private lightShaftPass: ShaderPass | null = null;
  private streakPass: ShaderPass | null = null;
  private lensArtifactPass: ShaderPass | null = null;
  private diffractionPass: ShaderPass | null = null;
  private dofPass: ShaderPass | null = null;
  private contrastPass: ShaderPass | null = null;
  private gradePass: ShaderPass | null = null;
  private finishPass: ShaderPass | null = null;
  private animationId = 0;
  private focus: FocusState | null = null;
  private yaw = 0;
  private pitch = -0.08;
  private drag = false;
  private downX = 0;
  private downY = 0;
  private lastX = 0;
  private lastY = 0;
  private lastNearestId: string | null = null;
  private lastFrameTime = performance.now();
  private hiddenPlanet: PlanetNode | null = null;
  private progress: ProgressState;
  private sparkActive = false;
  private disposed = false;
  private blackHole: BlackHoleNode | null = null;
  private blackHoleSecretDone = false;
  private readonly blackHoleScreen = new THREE.Vector3();
  // v1.2 realism
  private envRT: THREE.WebGLRenderTarget | null = null;
  private readonly sunDir = new THREE.Vector3(54, 72, 48).normalize();
  // v1.1 gameplay + perf
  private readonly textureCache = new Map<string, THREE.Texture>();
  private readonly lastCamPos = new THREE.Vector3(0, 14, 82);
  private distanceAccum = 0;
  private distantGalaxyField: THREE.Group | null = null;
  private lensedGalaxyClusterField: THREE.Group | null = null;
  private deepSpaceDebrisField: THREE.Group | null = null;
  private relativisticWakeField: THREE.Group | null = null;
  private eventHorizonCitadelField: THREE.Group | null = null;
  private megastructureField: THREE.Group | null = null;
  private prismaticScatteringField: THREE.Group | null = null;
  private cameraDepthField: THREE.Group | null = null;
  private foregroundRelicField: THREE.Group | null = null;
  private lensDustField: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  private cosmicWebField: THREE.Group | null = null;
  private stardust: THREE.Points | null = null;
  private stardustPos: Float32Array | null = null;
  private stardustIds: string[] = [];
  private stardustTaken = new Set<string>();
  private sparkRoot: THREE.Object3D | null = null;
  private sparkClouds: THREE.Object3D[] = [];
  private trialActive = false;
  private trialGroup: THREE.Group | null = null;
  private trialRings: THREE.Mesh[] = [];
  private trialIndex = 0;
  private trialStart = 0;
  private trialLastTick = 0;

  constructor(canvas: HTMLCanvasElement, worlds: World[], progress: ProgressState, quality: QualityTier, callbacks: CosmosCallbacks) {
    this.canvas = canvas;
    this.worlds = worlds;
    this.progress = progress;
    this.quality = quality;
    this.callbacks = callbacks;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality.label !== "LOW",
      alpha: false,
      powerPreference: quality.label === "HIGH" ? "high-performance" : "default"
    });

    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.useHighDetailShadows ? 1.07 : 1.0; // balanced for PC shadow contrast
    this.renderer.shadowMap.enabled = this.useHighDetailShadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x03050b, 1);
    this.renderer.setPixelRatio(quality.dpr);
    this.camera.position.set(0, 14, 82);
    this.scene.fog = new THREE.FogExp2(0x03050b, 0.0065);
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", "AlicE sYsTeMの3D宇宙。ドラッグで視点、WASDで飛行、惑星クリックで選択。");

    this.setupLights();
    this.createBackground();
    this.createHighFidelityPanorama();
    this.createDistantGalaxyField();
    this.createLensedGalaxyClusterField();
    this.createDeepNebula();
    this.createForegroundNebulaVeils();
    this.createHighResolutionNebulaVeils();
    this.createNebulaCanyonField();
    this.createParallaxNebulaVolume();
    this.createStellarNurseryVolume();
    this.createCosmicWebField();
    this.createDeepSpaceDebrisField();
    this.createCameraDepthField();
    this.createLensDustField();
    this.createBlackHole();
    this.createRelativisticWakeField();
    this.createEventHorizonCitadelField();
    this.createMegastructureField();
    this.createPrismaticScatteringField();
    this.createWorlds();
    this.createAnomalies();
    this.createStardust();
    this.createForegroundRelicField();
    this.createComposer();
    this.attachEvents();
    this.syncProgress(progress);
    this.resize();
    this.publishCosmosApi();
    this.callbacks.onReady(this.getInfo());
    void this.initSparkLayer();
    this.animationId = window.requestAnimationFrame(this.frame);
  }

  syncProgress(progress: ProgressState): void {
    const loopChanged = this.progress.loop !== progress.loop;
    this.progress = progress;
    if (progress.hiddenPlanet) this.blackHoleSecretDone = true;
    if (loopChanged) this.rebuildStardust(); // NG+ remix
    for (const node of this.planets.values()) {
      const completed = node.world.statusKey ? progress.completedWorlds.has(node.world.id) : false;
      node.completed = completed;
      node.group.visible = !node.world.hidden || progress.hiddenPlanet;
      const material = node.surface.material as THREE.MeshStandardMaterial;
      material.emissive.setHex(completed ? 0xffc56a : node.world.color);
      material.emissiveIntensity = completed ? 0.55 : 0.16;
      if (node.surfaceDetail) node.surfaceDetail.material.uniforms.uCompleted.value = completed ? 1 : 0;
      if (node.weatherLayer) node.weatherLayer.material.uniforms.uCompleted.value = completed ? 1 : 0;
      if (node.cloudShadowLayer) node.cloudShadowLayer.material.uniforms.uCompleted.value = completed ? 1 : 0;
      if (node.terrainGlints) node.terrainGlints.material.uniforms.uCompleted.value = completed ? 1 : 0;
      if (node.nightNetwork) {
        for (const child of node.nightNetwork.children) {
          if (child instanceof THREE.LineSegments || child instanceof THREE.Points) {
            const material = child.material as THREE.ShaderMaterial | THREE.Material | THREE.Material[];
            const materials = Array.isArray(material) ? material : [material];
            for (const entry of materials) {
              if (entry instanceof THREE.ShaderMaterial && entry.uniforms.uCompleted) entry.uniforms.uCompleted.value = completed ? 1 : 0;
            }
          }
        }
      }
      if (node.exosphere) node.exosphere.material.uniforms.uCompleted.value = completed ? 1 : 0;
      if (node.atmosphericRim) node.atmosphericRim.material.uniforms.uCompleted.value = completed ? 1 : 0;
      if (node.magnetosphere) {
        for (const child of node.magnetosphere.children) {
          const material = (child as THREE.Mesh | THREE.Points).material;
          const materials = Array.isArray(material) ? material : [material];
          for (const entry of materials) {
            if (entry instanceof THREE.ShaderMaterial && entry.uniforms.uCompleted) entry.uniforms.uCompleted.value = completed ? 1 : 0;
          }
        }
      }
      if (node.beacon) node.beacon.visible = completed || node.world.kind === "app";
      if (node.ring) {
        const ringMat = node.ring.material as THREE.MeshBasicMaterial;
        ringMat.color.setHex(completed ? 0xffd98a : node.world.atmosphere);
        ringMat.opacity = completed ? 0.82 : 0.46;
      }
      if (node.ringDebris) {
        const debris = node.ringDebris.children[0] as THREE.InstancedMesh | undefined;
        const sparks = node.ringDebris.children[1] as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | undefined;
        if (debris?.material instanceof THREE.MeshStandardMaterial) {
          debris.material.emissive.setHex(completed ? 0xffc56a : node.world.atmosphere);
          debris.material.emissiveIntensity = completed ? 0.12 : 0.035;
        }
        if (sparks?.material instanceof THREE.ShaderMaterial) {
          sparks.material.uniforms.uCompleted.value = completed ? 1 : 0;
        }
      }
    }
    for (const anomaly of this.anomalies) {
      anomaly.taken = progress.fragments.has(anomaly.fragment);
      anomaly.group.visible = !anomaly.taken;
    }
  }

  focusWorld(id: string): void {
    const node = this.planets.get(id);
    if (!node || !node.group.visible) return;
    this.focusPlanet(node, false);
  }

  revealHiddenPlanet(): void {
    if (!this.hiddenPlanet || this.hiddenPlanet.group.visible) return; // idempotent: no double-fire
    this.hiddenPlanet.group.visible = true;
    this.callbacks.onRevealHiddenPlanet();
    this.focusPlanet(this.hiddenPlanet, false);
  }

  resetCamera(): void {
    TMP_OBJ.position.set(0, 14, 82);
    TMP_OBJ.lookAt(0, 0, 0);
    this.focus = {
      startedAt: performance.now(),
      duration: 1000,
      fromPos: this.camera.position.clone(),
      toPos: TMP_OBJ.position.clone(),
      fromQuat: this.camera.quaternion.clone(),
      toQuat: TMP_OBJ.quaternion.clone(),
      world: null
    };
  }

  dispose(): void {
    this.disposed = true;
    window.cancelAnimationFrame(this.animationId);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    for (const cloud of this.sparkClouds) {
      this.scene.remove(cloud);
      (cloud as { dispose?: () => void }).dispose?.();
    }
    this.sparkClouds = [];
    if (this.sparkRoot) {
      this.scene.remove(this.sparkRoot);
      (this.sparkRoot as { dispose?: () => void }).dispose?.();
      this.sparkRoot = null;
    }
    this.teardownTrialRings();
    this.scene.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) object.dispose(); // free instanceMatrix/instanceColor GPU buffers
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) disposeMaterial(mesh.material);
    });
    this.composer?.dispose();
    if (this.envRT) { this.envRT.dispose(); this.envRT = null; }
    this.scene.environment = null;
    this.renderer.dispose();
    for (const texture of this.textureCache.values()) texture.dispose();
    this.textureCache.clear();
    this.planets.clear();
    this.pickables.length = 0;
    this.anomalies.length = 0;
    this.keys.clear();
    if (window.__cosmos) delete window.__cosmos;
  }

  private setupLights(): void {
    const highContact = this.useHighDetailShadows;
    const sun = new THREE.DirectionalLight(0xfff2dc, 2.8);
    sun.position.set(54, 72, 48);
    if (highContact) {
      sun.intensity = 3.05;
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.near = 8;
      sun.shadow.camera.far = 260;
      sun.shadow.camera.left = -92;
      sun.shadow.camera.right = 92;
      sun.shadow.camera.top = 92;
      sun.shadow.camera.bottom = -92;
      sun.shadow.bias = -0.00018;
      sun.shadow.normalBias = 0.032;
    }
    this.scene.add(sun);
    const cyan = new THREE.PointLight(0x33e7c8, 26, 120, 1.9);
    cyan.position.set(-22, 12, 16);
    if (highContact) cyan.intensity = 28;
    this.scene.add(cyan);
    const violet = new THREE.PointLight(0x7b4dff, 18, 150, 2);
    violet.position.set(34, -18, -44);
    if (highContact) violet.intensity = 20;
    this.scene.add(violet);
    this.scene.add(new THREE.AmbientLight(0x28344d, highContact ? 0.46 : 0.58));
    if (highContact) {
      const blackHoleRim = new THREE.PointLight(0xffb26d, 15, 90, 2.05);
      blackHoleRim.position.set(21, 8, -38);
      this.scene.add(blackHoleRim);
      const deepCyanRim = new THREE.PointLight(0x5efff2, 10, 76, 2.15);
      deepCyanRim.position.set(-18, -7, -64);
      this.scene.add(deepCyanRim);
    }

    // v1.2: a visible sun (glow sprite + bright core) along the key-light direction → bloom anchor
    const sunGroup = new THREE.Group();
    sunGroup.position.copy(this.sunDir).multiplyScalar(168);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: makeGlowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false })
    );
    glow.scale.setScalar(this.quality.label === "LOW" ? 26 : 42);
    sunGroup.add(glow);
    if (this.quality.label !== "LOW") {
      sunGroup.add(new THREE.Mesh(new THREE.SphereGeometry(6, 24, 24), new THREE.MeshBasicMaterial({ color: 0xfff4e0, fog: false })));
    }
    this.scene.add(sunGroup);
  }

  private get useHighDetailShadows(): boolean {
    return this.quality.label === "HIGH" && !this.quality.mobile;
  }

  private enableHighDetailShadows(root: THREE.Object3D, cast = true, receive = true): void {
    if (!this.useHighDetailShadows) return;
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const material = object.material;
      const materials = Array.isArray(material) ? material : [material];
      const shadowable = materials.some((entry) =>
        entry instanceof THREE.MeshStandardMaterial &&
        entry.blending === THREE.NormalBlending &&
        (!entry.transparent || entry.opacity >= 0.68)
      );
      if (!shadowable) return;
      object.castShadow = cast;
      object.receiveShadow = receive;
    });
  }

  // Build a PMREM environment from the loaded equirect skybox → realistic IBL on planets (non-LOW).
  private buildEnvFrom(texture: THREE.Texture): void {
    if (this.quality.label === "LOW" || this.disposed || this.envRT) return;
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.envRT = pmrem.fromEquirectangular(texture);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = this.useHighDetailShadows ? 0.42 : 0.3;
      pmrem.dispose();
    } catch {
      // IBL is a nice-to-have; never break the scene if PMREM fails.
    }
  }

  // Shared, de-duplicated texture loader (one Texture/GPU upload per URL) with quiet error degrade.
  private loadTexture(path: string, onReady: (texture: THREE.Texture) => void): void {
    const url = assetPath(path);
    const cached = this.textureCache.get(url);
    if (cached) {
      onReady(cached);
      return;
    }
    this.loader.load(
      url,
      (texture) => {
        if (this.disposed) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        this.textureCache.set(url, texture);
        onReady(texture);
      },
      undefined,
      () => undefined
    );
  }

  private loadDataTexture(path: string, onReady: (texture: THREE.Texture) => void): void {
    const url = assetPath(path);
    const cached = this.textureCache.get(url);
    if (cached) {
      onReady(cached);
      return;
    }
    this.loader.load(
      url,
      (texture) => {
        if (this.disposed) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.NoColorSpace;
        this.textureCache.set(url, texture);
        onReady(texture);
      },
      undefined,
      () => undefined
    );
  }

  private planetDerivativeTexturePath(path: string, suffix: "normal" | "roughness" | "emission"): string {
    return path.replace(/\.(png|jpe?g)$/i, `-${suffix}.jpg`);
  }

  private createBackground(): void {
    const skyMat = new THREE.MeshBasicMaterial({
      color: 0x445078,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      fog: false
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(220, 64, 32), skyMat);
    sky.renderOrder = -30;
    this.scene.add(sky);
    const skyPath = this.quality.label === "LOW" ? "assets/cosmos-skybox.jpg" : "assets/deep-field-v4.jpg";
    this.loader.load(
      assetPath(skyPath),
      (texture) => {
        if (this.disposed) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        skyMat.map = texture;
        skyMat.needsUpdate = true;
      },
      undefined,
      () => {
        this.loader.load(assetPath("assets/cosmos-skybox.jpg"), (texture) => {
          if (this.disposed) {
            texture.dispose();
            return;
          }
          texture.colorSpace = THREE.SRGBColorSpace;
          skyMat.map = texture;
          skyMat.needsUpdate = true;
        });
      }
    );
    this.loader.load(assetPath("assets/cosmos-skybox.jpg"), (texture) => {
      if (this.disposed) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      this.buildEnvFrom(texture);
    });

    const starGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.quality.starCount * 3);
    const colors = new Float32Array(this.quality.starCount * 3);
    const sizes = new Float32Array(this.quality.starCount);
    const seeds = new Float32Array(this.quality.starCount);
    const rand = rng(42);
    for (let i = 0; i < this.quality.starCount; i += 1) {
      const r = 80 + rand() * 140;
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(rand() * 2 - 1);
      positions[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
      positions[i * 3 + 1] = Math.cos(phi) * r;
      positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
      TMP_COLOR.setHSL(0.5 + rand() * 0.22, 0.35 + rand() * 0.4, 0.68 + rand() * 0.32);
      colors[i * 3] = TMP_COLOR.r;
      colors[i * 3 + 1] = TMP_COLOR.g;
      colors[i * 3 + 2] = TMP_COLOR.b;
      sizes[i] = this.quality.label === "HIGH" ? 0.55 + Math.pow(rand(), 2.8) * 3.2 : 0.7 + rand() * 1.5;
      seeds[i] = rand() * 1000;
    }
    starGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    starGeometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    starGeometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    starGeometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    const starMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLow: { value: this.quality.label === "LOW" ? 1 : 0 }
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aSeed;
        varying vec3 vColor;
        varying float vSize;
        varying float vSeed;
        uniform float uTime;
        uniform float uLow;
        void main() {
          vColor = aColor;
          vSize = aSize;
          vSeed = aSeed;
          vec3 p = position;
          p.y += sin(uTime * 0.09 + aSeed) * (0.08 - uLow * 0.04);
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          float perspective = 230.0 / max(24.0, -mvPosition.z);
          gl_PointSize = min(8.0 - uLow * 2.5, aSize * perspective);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vSize;
        varying float vSeed;
        uniform float uTime;
        uniform float uLow;
        void main() {
          vec2 uv = gl_PointCoord.xy - 0.5;
          float d = length(uv);
          float core = smoothstep(0.46, 0.0, d);
          float halo = smoothstep(0.5, 0.08, d) * 0.26;
          float bright = smoothstep(1.6, 3.5, vSize) * (1.0 - uLow);
          float spikeX = (1.0 - smoothstep(0.006, 0.04, abs(uv.y))) * smoothstep(0.48, 0.06, abs(uv.x));
          float spikeY = (1.0 - smoothstep(0.006, 0.04, abs(uv.x))) * smoothstep(0.48, 0.06, abs(uv.y));
          float spike = max(spikeX, spikeY) * bright * 0.18;
          float twinkle = 0.84 + sin(uTime * (0.55 + fract(vSeed) * 0.4) + vSeed) * 0.16;
          vec3 hot = mix(vColor, vec3(1.0, 0.96, 0.82), bright * 0.32);
          float alpha = (core * 0.72 + halo + spike) * twinkle;
          if (d > 0.54 || alpha < 0.012) discard;
          gl_FragColor = vec4(hot * (0.72 + core * 0.62 + spike), clamp(alpha, 0.0, 0.96));
        }
      `
    });
    this.animatedMaterials.push(starMaterial);
    this.scene.add(new THREE.Points(starGeometry, starMaterial));

    const galaxy = this.createGalaxy();
    this.scene.add(galaxy);
    this.loadTexture("assets/particle.png", (texture) => {
      this.galaxyUniforms.uMap.value = texture;
      this.galaxyUniforms.uUseMap.value = 1;
    });

    if (this.quality.label !== "LOW") this.createHeroStarFlares();
  }

  private createHighFidelityPanorama(): void {
    if (this.quality.label !== "HIGH" || this.quality.mobile) return;

    const group = new THREE.Group();
    group.renderOrder = -12;
    this.deepPanorama = group;
    this.scene.add(group);

    const layers = [
      { path: "assets/deep-field-v3.jpg", radius: 214, alpha: 0.26, tint: 0xd8f4ff, seed: 2.7, drift: 0.0009, rot: new THREE.Euler(0.08, -0.22, 0.03) },
      { path: "assets/deep-field-v4.jpg", radius: 198, alpha: 0.18, tint: 0xffd6f1, seed: 9.3, drift: -0.0007, rot: new THREE.Euler(-0.06, 0.36, -0.05) }
    ];

    for (const layer of layers) {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uMap: { value: null as THREE.Texture | null },
          uUseMap: { value: 0 },
          uAlpha: { value: layer.alpha },
          uTint: { value: new THREE.Color(layer.tint) },
          uSeed: { value: layer.seed },
          uDrift: { value: layer.drift }
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        fog: false,
        vertexShader: `
          varying vec2 vUv;
          varying vec3 vDir;
          void main() {
            vUv = uv;
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D uMap;
          uniform float uUseMap;
          uniform float uTime;
          uniform float uAlpha;
          uniform vec3 uTint;
          uniform float uSeed;
          uniform float uDrift;
          varying vec2 vUv;
          varying vec3 vDir;

          float hash(vec2 p) {
            p = fract(p * vec2(173.31, 491.73));
            p += dot(p, p + 31.47);
            return fract(p.x * p.y);
          }

          float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            float a = hash(i);
            float b = hash(i + vec2(1.0, 0.0));
            float c = hash(i + vec2(0.0, 1.0));
            float d = hash(i + vec2(1.0, 1.0));
            return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
          }

          float fbm(vec2 p) {
            float v = 0.0;
            float a = 0.5;
            mat2 rot = mat2(0.86, -0.51, 0.51, 0.86);
            for (int i = 0; i < 5; i++) {
              v += noise(p) * a;
              p = rot * p * 2.04 + 6.73;
              a *= 0.5;
            }
            return v;
          }

          void main() {
            vec2 uv = vUv;
            uv.x = fract(uv.x + uTime * uDrift + sin((uv.y + uSeed) * 8.0) * 0.0028);
            uv.y = clamp(uv.y + sin((uv.x + uSeed) * 10.0 + uTime * 0.018) * 0.002, 0.0, 1.0);
            vec3 tex = mix(vec3(0.0), texture2D(uMap, uv).rgb, uUseMap);
            float lum = dot(tex, vec3(0.299, 0.587, 0.114));
            vec2 p = vec2(uv.x * 2.0 - 1.0, uv.y * 2.0 - 1.0);
            float cloud = fbm(p * vec2(2.3, 1.25) + vec2(uSeed, uTime * 0.006));
            float filament = fbm(p * vec2(8.8, 4.2) + vec2(-uTime * 0.01, uSeed));
            float horizon = smoothstep(0.03, 0.16, uv.y) * (1.0 - smoothstep(0.9, 0.99, uv.y));
            float galacticBand = smoothstep(0.86, 0.26, abs(vDir.y + sin(vDir.x * 3.2 + uSeed) * 0.18));
            float starLift = smoothstep(0.16, 0.88, lum);
            float gas = smoothstep(0.52, 0.88, cloud) * 0.34 + pow(smoothstep(0.62, 0.96, filament), 2.2) * 0.22;
            vec3 color = tex * (0.42 + starLift * 1.32) * uTint;
            color += uTint * gas * (0.22 + galacticBand * 0.52);
            color += vec3(1.0, 0.82, 0.58) * pow(starLift, 4.0) * 0.18;
            float alpha = (starLift * 0.36 + gas * 0.46 + galacticBand * 0.08) * horizon * uAlpha;
            if (alpha < 0.004) discard;
            gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.38));
          }
        `
      });
      const shell = new THREE.Mesh(new THREE.SphereGeometry(layer.radius, 96, 48), material);
      shell.rotation.copy(layer.rot);
      shell.renderOrder = -12;
      group.add(shell);
      this.animatedMaterials.push(material);
      this.loadTexture(layer.path, (texture) => {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        material.uniforms.uMap.value = texture;
        material.uniforms.uUseMap.value = 1;
      });
    }
  }

  private createDistantGalaxyField(): void {
    if (this.quality.label !== "HIGH" || this.quality.mobile) return;

    const group = new THREE.Group();
    group.renderOrder = -10;
    this.distantGalaxyField = group;
    this.scene.add(group);

    const specs = [
      { seed: 8111, pos: new THREE.Vector3(-72, 44, -176), width: 58, height: 25, color: 0x9ffcff, opacity: 0.46, roll: -0.22, spin: 0.017 },
      { seed: 8127, pos: new THREE.Vector3(76, 33, -188), width: 68, height: 29, color: 0xffd69a, opacity: 0.38, roll: 0.18, spin: -0.014 },
      { seed: 8161, pos: new THREE.Vector3(7, 62, -214), width: 76, height: 34, color: 0xc6d0ff, opacity: 0.3, roll: 0.04, spin: 0.011 },
      { seed: 8209, pos: new THREE.Vector3(-118, -26, -166), width: 54, height: 23, color: 0xff91c4, opacity: 0.36, roll: 0.34, spin: -0.019 },
      { seed: 8243, pos: new THREE.Vector3(116, -10, -170), width: 48, height: 20, color: 0x7dffea, opacity: 0.32, roll: -0.38, spin: 0.015 },
      { seed: 8297, pos: new THREE.Vector3(-18, -48, -152), width: 62, height: 27, color: 0xfff0c8, opacity: 0.25, roll: 0.09, spin: -0.01 }
    ];

    for (const spec of specs) {
      const material = new THREE.SpriteMaterial({
        map: makeDistantGalaxyTexture(spec.seed),
        color: spec.color,
        transparent: true,
        opacity: spec.opacity,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false
      });
      material.rotation = spec.roll;
      const sprite = new THREE.Sprite(material);
      sprite.position.copy(spec.pos);
      sprite.scale.set(spec.width, spec.height, 1);
      sprite.renderOrder = -10;
      sprite.userData.roll = spec.roll;
      sprite.userData.spin = spec.spin;
      sprite.userData.phase = spec.seed * 0.013;
      group.add(sprite);
    }
  }

  private createLensedGalaxyClusterField(): void {
    if (this.quality.label !== "HIGH" || this.quality.mobile || this.quality.reducedMotion) return;

    const group = new THREE.Group();
    group.renderOrder = -9;
    group.userData.particleBudget = 0;
    this.lensedGalaxyClusterField = group;
    this.scene.add(group);

    const lenses = [
      {
        pos: new THREE.Vector3(48, 24, -218),
        width: 106,
        height: 58,
        roll: -0.18,
        seed: 3.1,
        alpha: 0.34,
        tint: 0xdde7ff,
        accent: 0xffc36f,
        spin: 0.018,
        parallax: 0.022
      },
      {
        pos: new THREE.Vector3(-64, -8, -204),
        width: 88,
        height: 48,
        roll: 0.28,
        seed: 8.4,
        alpha: 0.24,
        tint: 0x9ffcff,
        accent: 0xff8ec7,
        spin: -0.014,
        parallax: 0.026
      },
      {
        pos: new THREE.Vector3(8, 58, -236),
        width: 118,
        height: 54,
        roll: 0.05,
        seed: 12.7,
        alpha: 0.18,
        tint: 0xffe1b8,
        accent: 0x8fffee,
        spin: 0.01,
        parallax: 0.017
      }
    ];

    for (const lens of lenses) {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uAlpha: { value: lens.alpha },
          uSeed: { value: lens.seed },
          uAspect: { value: lens.width / lens.height },
          uTint: { value: new THREE.Color(lens.tint) },
          uAccent: { value: new THREE.Color(lens.accent) }
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: false,
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uAlpha;
          uniform float uSeed;
          uniform float uAspect;
          uniform vec3 uTint;
          uniform vec3 uAccent;
          varying vec2 vUv;

          float hash(vec2 p) {
            p = fract(p * vec2(127.1, 311.7));
            p += dot(p, p + 19.19 + uSeed);
            return fract(p.x * p.y);
          }

          float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            float a = hash(i);
            float b = hash(i + vec2(1.0, 0.0));
            float c = hash(i + vec2(0.0, 1.0));
            float d = hash(i + vec2(1.0, 1.0));
            return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
          }

          float fbm(vec2 p) {
            float v = 0.0;
            float a = 0.52;
            mat2 rot = mat2(0.78, -0.63, 0.63, 0.78);
            for (int i = 0; i < 5; i++) {
              v += noise(p) * a;
              p = rot * p * 2.12 + vec2(4.7, 2.9);
              a *= 0.52;
            }
            return v;
          }

          void main() {
            vec2 p = vUv * 2.0 - 1.0;
            p.x *= uAspect;
            float radius = length(p);
            float angle = atan(p.y, p.x);
            float ellipse = length(p / vec2(1.0 + sin(uSeed) * 0.08, 0.48 + cos(uSeed) * 0.05));
            float aperture = smoothstep(1.42, 0.12, radius);

            float halo = exp(-ellipse * ellipse * 1.35) * 0.32;
            float core = exp(-dot(p, p * vec2(5.8, 9.5))) * 0.78;
            float dust = fbm(p * vec2(2.1, 1.2) + vec2(uSeed, uTime * 0.006));
            float clump = pow(fbm(p * vec2(8.4, 4.6) + vec2(-uSeed * 0.4, uTime * 0.012)), 2.4);

            float ringA = 1.0 - smoothstep(0.0, 0.026, abs(ellipse - 0.58));
            float ringB = 1.0 - smoothstep(0.0, 0.034, abs(ellipse - 0.82));
            float segmentA = smoothstep(0.08, 0.42, sin(angle * 2.0 + uSeed + uTime * 0.03) * 0.5 + 0.5);
            float segmentB = smoothstep(0.16, 0.72, sin(-angle * 3.0 + uSeed * 1.6 - uTime * 0.025) * 0.5 + 0.5);
            float fine = pow(sin(angle * 41.0 + radius * 17.0 + uSeed * 1.7) * 0.5 + 0.5, 9.0);
            float arcs = (ringA * segmentA * 0.9 + ringB * segmentB * 0.5) * (0.58 + fine * 0.72);

            float galaxyA = exp(-length((p - vec2(-0.28, 0.12)) / vec2(0.28, 0.1)) * 5.0);
            float galaxyB = exp(-length((p - vec2(0.24, -0.18)) / vec2(0.2, 0.08)) * 5.8);
            float galaxyC = exp(-length((p - vec2(0.08, 0.25)) / vec2(0.14, 0.06)) * 6.4);
            float galaxies = galaxyA + galaxyB * 0.82 + galaxyC * 0.64;

            float starlets = smoothstep(0.982, 0.999, hash(floor((p + 2.0) * vec2(72.0, 46.0)))) * aperture;
            vec3 gasColor = mix(uTint * 0.35, uAccent * 0.55, dust);
            vec3 arcColor = mix(uAccent, vec3(1.0, 0.93, 0.72), fine * 0.42);
            vec3 galaxyColor = mix(vec3(1.0, 0.8, 0.55), uTint, clump * 0.32);
            vec3 color = gasColor * (halo + clump * 0.22);
            color += galaxyColor * galaxies * (0.75 + dust * 0.5);
            color += arcColor * arcs * 1.18;
            color += vec3(0.84, 0.95, 1.0) * starlets * 0.58;

            float alpha = aperture * uAlpha * (halo * 0.62 + core * 0.34 + clump * 0.34 + arcs * 0.95 + galaxies * 0.42 + starlets * 0.26);
            if (alpha < 0.0035) discard;
            gl_FragColor = vec4(color * (0.76 + arcs * 0.72 + starlets * 0.9), clamp(alpha, 0.0, 0.5));
          }
        `
      });
      this.animatedMaterials.push(material);

      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(lens.width, lens.height, 4, 2), material);
      mesh.position.copy(lens.pos);
      mesh.lookAt(0, 7, 88);
      mesh.rotateZ(lens.roll);
      mesh.renderOrder = -9;
      mesh.frustumCulled = false;
      mesh.userData.base = lens.pos.clone();
      mesh.userData.roll = lens.roll;
      mesh.userData.spin = lens.spin;
      mesh.userData.parallax = lens.parallax;
      group.add(mesh);
    }

    const starCount = 1220;
    const rand = rng(537113);
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);
    const phases = new Float32Array(starCount);
    const anchors = [
      new THREE.Vector3(48, 24, -218),
      new THREE.Vector3(-64, -8, -204),
      new THREE.Vector3(8, 58, -236)
    ];

    for (let i = 0; i < starCount; i += 1) {
      const anchor = anchors[Math.floor(rand() * anchors.length)];
      const angle = rand() * Math.PI * 2;
      const radius = Math.pow(rand(), 0.52) * (24 + rand() * 54);
      const p = i * 3;
      positions[p] = anchor.x + Math.cos(angle) * radius + (rand() - 0.5) * 10;
      positions[p + 1] = anchor.y + Math.sin(angle) * radius * (0.42 + rand() * 0.24) + (rand() - 0.5) * 7;
      positions[p + 2] = anchor.z + (rand() - 0.5) * 18;
      TMP_COLOR.setHSL(rand() > 0.5 ? 0.58 + rand() * 0.12 : 0.08 + rand() * 0.08, 0.52 + rand() * 0.34, 0.56 + rand() * 0.32);
      if (rand() > 0.9) TMP_COLOR.lerp(new THREE.Color(0xfff0c8), 0.48);
      colors[p] = TMP_COLOR.r;
      colors[p + 1] = TMP_COLOR.g;
      colors[p + 2] = TMP_COLOR.b;
      sizes[i] = 0.4 + Math.pow(rand(), 2.8) * 4.6;
      phases[i] = rand() * 1000;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    const starMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMap: { value: makeGlowTexture(128) }
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aPhase;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vRing;
        uniform float uTime;
        void main() {
          vColor = aColor;
          vRing = fract(aPhase);
          vec3 p = position;
          p.x += sin(uTime * 0.018 + aPhase) * 0.7;
          p.y += cos(uTime * 0.022 + aPhase * 1.3) * 0.42;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          float depth = max(1.0, -mvPosition.z);
          float fade = smoothstep(96.0, 152.0, depth) * (1.0 - smoothstep(286.0, 350.0, depth));
          vAlpha = fade * (0.35 + fract(aPhase * 0.17) * 0.65);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(aSize * (270.0 / depth), 0.65, 5.8);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform float uTime;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vRing;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          if (d > 0.5) discard;
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float spike = max(
            smoothstep(0.018, 0.0, abs(uv.x)) * smoothstep(0.48, 0.05, abs(uv.y)),
            smoothstep(0.018, 0.0, abs(uv.y)) * smoothstep(0.48, 0.05, abs(uv.x))
          ) * smoothstep(0.82, 1.0, vRing) * 0.16;
          float pulse = 0.78 + 0.22 * sin(uTime * (0.22 + vRing * 0.34) + vRing * 20.0);
          float alpha = (tex.a * 0.42 + spike) * vAlpha * pulse;
          if (alpha < 0.004) discard;
          vec3 color = mix(vColor, vec3(1.0, 0.94, 0.78), tex.a * 0.28 + spike);
          gl_FragColor = vec4(color * (0.64 + tex.a * 1.15 + spike * 2.0), clamp(alpha, 0.0, 0.64));
        }
      `
    });
    this.animatedMaterials.push(starMaterial);
    const stars = new THREE.Points(geometry, starMaterial);
    stars.renderOrder = -8;
    stars.frustumCulled = false;
    group.add(stars);

    group.userData.particleBudget = lenses.length * 512 + starCount;
  }

  private createHeroStarFlares(): void {
    const count = this.quality.label === "HIGH" ? 64 : 24;
    const rand = rng(1327);
    const texture = makeGlowTexture(192);
    for (let i = 0; i < count; i += 1) {
      const theta = rand() * Math.PI * 2;
      const radius = 110 + rand() * 88;
      const y = (rand() - 0.5) * 120;
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: texture,
          color: rand() > 0.18 ? 0xbff7ff : 0xffd98a,
          transparent: true,
          opacity: 0.18 + rand() * 0.36,
          depthWrite: false,
          fog: false,
          blending: THREE.AdditiveBlending
        })
      );
      sprite.position.set(Math.cos(theta) * radius, y, Math.sin(theta) * radius - 30);
      const scale = 2.1 + rand() * (this.quality.label === "HIGH" ? 4.8 : 2.8);
      sprite.scale.set(scale, scale, 1);
      sprite.renderOrder = -1;
      this.scene.add(sprite);
    }
  }

  private createDeepNebula(): void {
    const layers = [
      { path: "assets/deep-nebula-v2.jpg", color: 0xffffff, pos: new THREE.Vector3(4, 2, -186), width: 222, height: 125, opacity: 0.36, blend: THREE.NormalBlending },
      { path: "assets/cosmos-nebula.jpg", color: 0x6af8e4, pos: new THREE.Vector3(-92, 18, -156), width: 142, height: 84, opacity: 0.2, blend: THREE.AdditiveBlending },
      { path: "assets/cosmos-nebula-2.jpg", color: 0xff6fa8, pos: new THREE.Vector3(84, -22, -150), width: 132, height: 76, opacity: 0.18, blend: THREE.AdditiveBlending },
      { path: "assets/nebula.jpg", color: 0x8f70ff, pos: new THREE.Vector3(8, 44, -180), width: 172, height: 96, opacity: 0.12, blend: THREE.AdditiveBlending }
    ];
    const visibleLayers = this.quality.label === "LOW" ? layers.slice(0, 1) : layers;

    for (const layer of visibleLayers) {
      const material = new THREE.MeshBasicMaterial({
        color: layer.color,
        transparent: true,
        opacity: this.quality.label === "LOW" ? Math.min(0.2, layer.opacity) : layer.opacity,
        depthWrite: false,
        blending: layer.blend,
        side: THREE.DoubleSide,
        fog: false
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(layer.width, layer.height), material);
      mesh.position.copy(layer.pos);
      mesh.lookAt(0, 5, 86);
      this.scene.add(mesh);
      this.loadTexture(layer.path, (texture) => {
        material.map = texture;
        material.needsUpdate = true;
      });
    }

    if (this.quality.label !== "LOW") this.createNebulaFilaments();
  }

  private createNebulaFilaments(): void {
    const count = this.quality.label === "HIGH" ? 1600 : 480;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const rand = rng(811);

    for (let i = 0; i < count; i += 1) {
      const arm = rand() > 0.48 ? 1 : -1;
      const t = Math.pow(rand(), 0.72);
      const radius = 36 + t * 96;
      const angle = arm * (0.65 + t * 1.25) + (rand() - 0.5) * 0.55;
      positions[i * 3] = Math.cos(angle) * radius + 8;
      positions[i * 3 + 1] = (rand() - 0.5) * (20 + t * 48) + Math.sin(t * 5.2) * 14;
      positions[i * 3 + 2] = -62 - Math.sin(angle) * radius - rand() * 58;
      TMP_COLOR.setHSL(rand() > 0.55 ? 0.52 + rand() * 0.08 : 0.88 + rand() * 0.06, 0.82, 0.5 + rand() * 0.26);
      colors[i * 3] = TMP_COLOR.r;
      colors[i * 3 + 1] = TMP_COLOR.g;
      colors[i * 3 + 2] = TMP_COLOR.b;
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: this.quality.label === "HIGH" ? 0.95 : 1.4,
      vertexColors: true,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });
    this.loadTexture("assets/particle.png", (texture) => {
      material.map = texture;
      material.needsUpdate = true;
    });
    this.scene.add(new THREE.Points(geometry, material));
  }

  private createForegroundNebulaVeils(): void {
    if (this.quality.label !== "HIGH" || this.quality.mobile) return;
    const specs = [
      { color: 0x33e7c8, pos: new THREE.Vector3(-24, -4, -68), rot: -0.18, width: 92, height: 50, alpha: 0.34, seed: 1.7 },
      { color: 0xff5c9d, pos: new THREE.Vector3(42, 9, -82), rot: 0.22, width: 86, height: 46, alpha: 0.22, seed: 4.1 },
      { color: 0x8f70ff, pos: new THREE.Vector3(2, 26, -112), rot: 0.04, width: 128, height: 58, alpha: 0.2, seed: 7.6 }
    ];

    for (const spec of specs) {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uSeed: { value: spec.seed },
          uAlpha: { value: spec.alpha },
          uColor: { value: new THREE.Color(spec.color) }
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: false,
        vertexShader: `
          varying vec2 vUv;
          varying vec3 vWorld;
          void main() {
            vUv = uv;
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorld = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uSeed;
          uniform float uAlpha;
          uniform vec3 uColor;
          varying vec2 vUv;

          float hash(vec2 p) {
            p = fract(p * vec2(123.34, 345.45));
            p += dot(p, p + 34.345);
            return fract(p.x * p.y);
          }

          float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            float a = hash(i);
            float b = hash(i + vec2(1.0, 0.0));
            float c = hash(i + vec2(0.0, 1.0));
            float d = hash(i + vec2(1.0, 1.0));
            return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
          }

          float fbm(vec2 p) {
            float v = 0.0;
            float a = 0.5;
            for (int i = 0; i < 5; i++) {
              v += noise(p) * a;
              p = mat2(1.58, 1.18, -1.18, 1.58) * p + 7.13;
              a *= 0.48;
            }
            return v;
          }

          void main() {
            vec2 p = (vUv - 0.5) * vec2(2.2, 1.45);
            vec2 flow = p;
            flow.x += sin(p.y * 5.5 + uSeed + uTime * 0.07) * 0.18;
            flow.y += sin(p.x * 3.8 - uSeed + uTime * 0.05) * 0.12;
            float cloud = fbm(flow * 3.8 + vec2(uSeed, uTime * 0.025));
            float high = fbm(flow * 11.0 - vec2(uTime * 0.035, uSeed));
            float strand = pow(smoothstep(0.44, 0.9, cloud), 2.6) + pow(smoothstep(0.62, 0.98, high), 4.0) * 0.52;
            float aperture = smoothstep(1.18, 0.08, length(p));
            float cut = smoothstep(0.06, 0.22, vUv.y) * (1.0 - smoothstep(0.8, 0.98, vUv.y));
            float alpha = aperture * cut * strand * uAlpha;
            vec3 color = uColor * (0.35 + strand * 1.25) + vec3(1.0, 0.92, 0.72) * pow(strand, 5.0) * 0.14;
            if (alpha < 0.004) discard;
            gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.42));
          }
        `
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(spec.width, spec.height, 1, 1), material);
      mesh.position.copy(spec.pos);
      mesh.rotation.z = spec.rot;
      mesh.lookAt(0, 6, 88);
      mesh.rotateZ(spec.rot);
      mesh.renderOrder = -2;
      this.scene.add(mesh);
      this.animatedMaterials.push(material);
    }
  }

  private createHighResolutionNebulaVeils(): void {
    if (this.quality.label !== "HIGH" || this.quality.mobile) return;
    const specs = [
      { path: "assets/nebula-veil-cyan-hq.png", color: 0x86fff2, pos: new THREE.Vector3(-30, -10, -88), rot: -0.14, width: 132, height: 66, alpha: 0.34, seed: 2.3, drift: 0.012 },
      { path: "assets/nebula-veil-magenta-hq.png", color: 0xff8ec8, pos: new THREE.Vector3(38, 18, -126), rot: 0.16, width: 164, height: 82, alpha: 0.28, seed: 6.7, drift: -0.009 },
      { path: "assets/nebula-veil-cyan-hq.png", color: 0xb0c7ff, pos: new THREE.Vector3(18, 42, -164), rot: 0.05, width: 188, height: 86, alpha: 0.17, seed: 9.1, drift: 0.006 }
    ];

    for (const spec of specs) {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uMap: { value: null as THREE.Texture | null },
          uAlpha: { value: spec.alpha },
          uTint: { value: new THREE.Color(spec.color) },
          uSeed: { value: spec.seed },
          uDrift: { value: spec.drift }
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: false,
        vertexShader: `
          varying vec2 vUv;
          varying float vDepth;
          void main() {
            vUv = uv;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            vDepth = -mvPosition.z;
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          uniform sampler2D uMap;
          uniform float uTime;
          uniform float uAlpha;
          uniform float uSeed;
          uniform float uDrift;
          uniform vec3 uTint;
          varying vec2 vUv;
          varying float vDepth;

          void main() {
            vec2 uv = vUv;
            uv.x = clamp(uv.x + sin(uv.y * 7.0 + uTime * 0.05 + uSeed) * 0.006 + uTime * uDrift * 0.01, 0.0, 1.0);
            uv.y = clamp(uv.y + sin(uv.x * 5.2 - uTime * 0.035 + uSeed) * 0.004, 0.0, 1.0);
            vec4 tex = texture2D(uMap, uv);
            vec2 p = (vUv - 0.5) * vec2(1.55, 1.18);
            float aperture = smoothstep(0.92, 0.18, length(p));
            float depthFade = smoothstep(46.0, 70.0, vDepth) * (1.0 - smoothstep(205.0, 265.0, vDepth));
            float ember = pow(max(max(tex.r, tex.g), tex.b), 3.2);
            float alpha = tex.a * uAlpha * aperture * depthFade * (0.86 + ember * 0.64);
            vec3 color = tex.rgb * (0.72 + ember * 1.55);
            color += uTint * tex.a * 0.5;
            color += vec3(1.0, 0.82, 0.55) * ember * 0.18;
            if (alpha < 0.004) discard;
            gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.42));
          }
        `
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(spec.width, spec.height, 2, 2), material);
      mesh.position.copy(spec.pos);
      mesh.rotation.z = spec.rot;
      mesh.lookAt(0, 6, 88);
      mesh.rotateZ(spec.rot);
      mesh.renderOrder = -6;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.animatedMaterials.push(material);
      this.loadTexture(spec.path, (texture) => {
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        material.uniforms.uMap.value = texture;
      });
    }
  }

  private createNebulaCanyonField(): void {
    if (this.quality.label !== "HIGH" || this.quality.mobile) return;

    const group = new THREE.Group();
    group.renderOrder = -5;
    group.userData.particleBudget = 0;
    this.nebulaCanyonField = group;
    this.scene.add(group);

    const specs = [
      { path: "assets/nebula-canyon-cyan-hq.png", color: 0x8dfff2, pos: new THREE.Vector3(-24, 4, -82), width: 156, height: 82, alpha: 0.28, seed: 12.7, roll: -0.13, depth: 8.5, order: -5, dark: 0 },
      { path: "assets/nebula-canyon-magenta-hq.png", color: 0xff8ebf, pos: new THREE.Vector3(39, 10, -116), width: 182, height: 92, alpha: 0.22, seed: 31.4, roll: 0.18, depth: 11.5, order: -6, dark: 0 },
      { path: "assets/nebula-canyon-cyan-hq.png", color: 0xb8caff, pos: new THREE.Vector3(2, 35, -152), width: 212, height: 98, alpha: 0.18, seed: 44.1, roll: 0.05, depth: 14.0, order: -8, dark: 0 },
      { path: "assets/nebula-canyon-magenta-hq.png", color: 0x071228, pos: new THREE.Vector3(18, -18, -96), width: 138, height: 74, alpha: 0.16, seed: 58.6, roll: -0.32, depth: 7.0, order: -2, dark: 1 }
    ];

    for (const spec of specs) {
      const geometry = new THREE.PlaneGeometry(spec.width, spec.height, 48, 24);
      const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
      const rand = rng(67001 + Math.floor(spec.seed * 100));
      const phaseA = rand() * Math.PI * 2;
      const phaseB = rand() * Math.PI * 2;
      for (let i = 0; i < positions.count; i += 1) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const nx = x / (spec.width * 0.5);
        const ny = y / (spec.height * 0.5);
        const canyon = Math.sin(nx * 5.2 + Math.sin(ny * 4.1 + phaseA) * 1.25 + phaseB);
        const fissure = Math.cos((nx + ny) * 8.8 + Math.sin(nx * 3.4 + phaseB) * 1.4);
        const ridge = Math.exp(-Math.abs(canyon * 0.62 + fissure * 0.38) * 1.85);
        const aperture = Math.max(0, 1 - Math.hypot(nx * 0.78, ny * 1.14));
        const z = (ridge * 2.0 - 0.72 + Math.sin(nx * 14.0 + phaseA) * 0.08) * spec.depth * aperture;
        positions.setZ(i, z);
        positions.setX(i, x + Math.sin(ny * 5.0 + phaseB) * spec.depth * 0.08 * aperture);
        positions.setY(i, y + Math.sin(nx * 4.3 + phaseA) * spec.depth * 0.05 * aperture);
      }
      positions.needsUpdate = true;
      geometry.computeVertexNormals();

      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uMap: { value: null as THREE.Texture | null },
          uTint: { value: new THREE.Color(spec.color) },
          uAlpha: { value: spec.alpha },
          uSeed: { value: spec.seed },
          uDark: { value: spec.dark }
        },
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        blending: spec.dark ? THREE.NormalBlending : THREE.AdditiveBlending,
        fog: false,
        vertexShader: `
          uniform float uTime;
          uniform float uSeed;
          varying vec2 vUv;
          varying float vDepth;
          varying float vRelief;
          void main() {
            vUv = uv;
            vec3 p = position;
            p.z += sin(uv.x * 8.0 + uTime * 0.036 + uSeed) * 0.28;
            p.x += sin(uv.y * 5.0 + uSeed) * 0.12;
            vRelief = smoothstep(-2.0, 8.0, p.z);
            vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
            vDepth = -mvPosition.z;
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          uniform sampler2D uMap;
          uniform float uTime;
          uniform float uAlpha;
          uniform float uSeed;
          uniform float uDark;
          uniform vec3 uTint;
          varying vec2 vUv;
          varying float vDepth;
          varying float vRelief;

          float hash(vec2 p) {
            p = fract(p * vec2(221.13, 417.61));
            p += dot(p, p + 31.73);
            return fract(p.x * p.y);
          }

          void main() {
            vec2 uv = vUv;
            uv.x = clamp(uv.x + sin(uv.y * 7.0 + uSeed + uTime * 0.022) * 0.003, 0.0, 1.0);
            uv.y = clamp(uv.y + sin(uv.x * 6.0 - uSeed + uTime * 0.018) * 0.003, 0.0, 1.0);
            vec4 tex = texture2D(uMap, uv);
            vec2 p = (vUv - 0.5) * vec2(1.55, 1.08);
            float aperture = smoothstep(0.98, 0.14, length(p));
            float depthFade = smoothstep(34.0, 58.0, vDepth) * (1.0 - smoothstep(168.0, 252.0, vDepth));
            float lum = max(max(tex.r, tex.g), tex.b);
            float ember = pow(lum, 3.1);
            float grain = hash(floor((uv + uSeed) * vec2(280.0, 164.0)));
            float ridge = smoothstep(0.2, 0.92, vRelief);
            float alpha = tex.a * uAlpha * aperture * depthFade * (0.74 + ridge * 0.42 + ember * 0.5 + grain * 0.06);
            vec3 gas = tex.rgb * (0.58 + ember * 1.55 + ridge * 0.34);
            gas += uTint * tex.a * (0.22 + ridge * 0.26);
            gas += vec3(1.0, 0.76, 0.44) * ember * 0.16;
            vec3 dust = mix(vec3(0.0, 0.002, 0.009), uTint * 0.16, tex.b * 0.35 + ridge * 0.16);
            vec3 color = mix(gas, dust, uDark);
            alpha *= mix(1.0, 0.64, uDark);
            if (alpha < 0.004) discard;
            gl_FragColor = vec4(color, clamp(alpha, 0.0, mix(0.46, 0.22, uDark)));
          }
        `
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(spec.pos);
      mesh.lookAt(0, 6, 88);
      mesh.rotateZ(spec.roll);
      mesh.renderOrder = spec.order;
      mesh.frustumCulled = false;
      mesh.userData.roll = spec.roll;
      mesh.userData.phase = spec.seed;
      group.add(mesh);
      this.animatedMaterials.push(material);
      this.loadTexture(spec.path, (texture) => {
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.anisotropy = Math.min(12, this.renderer.capabilities.getMaxAnisotropy());
        material.uniforms.uMap.value = texture;
      });
    }

    const starCount = 980;
    const rand = rng(771337);
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);
    const phases = new Float32Array(starCount);
    const anchors = [
      new THREE.Vector3(-34, 8, -86),
      new THREE.Vector3(38, 11, -118),
      new THREE.Vector3(6, 34, -150)
    ];
    for (let i = 0; i < starCount; i += 1) {
      const anchor = anchors[Math.floor(rand() * anchors.length)];
      const spread = 18 + Math.pow(rand(), 0.7) * 58;
      const a = rand() * Math.PI * 2;
      const p = i * 3;
      positions[p] = anchor.x + Math.cos(a) * spread + (rand() - 0.5) * 12;
      positions[p + 1] = anchor.y + (rand() - 0.5) * spread * 0.42;
      positions[p + 2] = anchor.z + Math.sin(a) * spread * 0.42 - rand() * 18;
      TMP_COLOR.setHSL(rand() > 0.52 ? 0.52 + rand() * 0.08 : 0.09 + rand() * 0.04, 0.58 + rand() * 0.28, 0.58 + rand() * 0.34);
      if (rand() > 0.91) TMP_COLOR.lerp(new THREE.Color(0xffffff), 0.5);
      colors[p] = TMP_COLOR.r;
      colors[p + 1] = TMP_COLOR.g;
      colors[p + 2] = TMP_COLOR.b;
      sizes[i] = 0.4 + Math.pow(rand(), 4.2) * 8.5;
      phases[i] = rand() * 1000;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMap: { value: makeGlowTexture(128) }
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aPhase;
        uniform float uTime;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSpike;
        void main() {
          vColor = aColor;
          vec3 p = position;
          p.x += sin(uTime * 0.08 + aPhase) * 0.2;
          p.y += cos(uTime * 0.07 + aPhase * 1.27) * 0.14;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          float depth = max(1.0, -mvPosition.z);
          float fade = smoothstep(34.0, 62.0, depth) * (1.0 - smoothstep(155.0, 238.0, depth));
          float pulse = 0.68 + 0.32 * sin(uTime * (0.55 + fract(aPhase) * 0.95) + aPhase);
          vAlpha = fade * pulse * (0.42 + fract(aPhase * 0.63) * 0.58);
          vSpike = smoothstep(4.0, 8.0, aSize);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(aSize * (235.0 / depth), 0.85, 14.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSpike;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          if (length(uv) > 0.5) discard;
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float starX = (1.0 - smoothstep(0.012, 0.07, abs(uv.y))) * smoothstep(0.5, 0.04, abs(uv.x));
          float starY = (1.0 - smoothstep(0.012, 0.07, abs(uv.x))) * smoothstep(0.5, 0.04, abs(uv.y));
          float spike = max(starX, starY) * vSpike * 0.2;
          float alpha = (tex.a * 0.58 + spike) * vAlpha;
          if (alpha < 0.005) discard;
          vec3 color = mix(vColor, vec3(1.0, 0.92, 0.72), tex.a * 0.32 + spike * 0.24);
          gl_FragColor = vec4(color * (0.58 + tex.a * 1.3 + spike * 0.85), clamp(alpha, 0.0, 0.82));
        }
      `
    });
    this.animatedMaterials.push(material);
    const stars = new THREE.Points(geometry, material);
    stars.renderOrder = -1;
    stars.frustumCulled = false;
    group.add(stars);

    group.userData.particleBudget = specs.length * 1225 + starCount;
  }

  private createParallaxNebulaVolume(): void {
    if (this.quality.label !== "HIGH" || this.quality.mobile || this.quality.reducedMotion) return;

    const group = new THREE.Group();
    group.renderOrder = -3;
    group.userData.particleBudget = 0;
    this.parallaxNebulaVolume = group;
    this.scene.add(group);

    const specs = [
      { path: "assets/volumetric-nebula-shadow-hq.png", color: 0x071225, pos: new THREE.Vector3(-42, -5, -58), width: 92, height: 62, alpha: 0.24, seed: 2.1, roll: -0.2, drift: 0.016, order: -2, dark: 1 },
      { path: "assets/volumetric-nebula-core-hq.png", color: 0x8ffff2, pos: new THREE.Vector3(-25, 7, -72), width: 112, height: 74, alpha: 0.22, seed: 4.6, roll: 0.08, drift: -0.014, order: -4, dark: 0 },
      { path: "assets/volumetric-nebula-core-hq.png", color: 0xffb2d0, pos: new THREE.Vector3(24, 15, -86), width: 128, height: 82, alpha: 0.19, seed: 7.8, roll: 0.23, drift: 0.011, order: -5, dark: 0 },
      { path: "assets/volumetric-nebula-shadow-hq.png", color: 0x050914, pos: new THREE.Vector3(39, -12, -94), width: 116, height: 76, alpha: 0.22, seed: 10.4, roll: -0.36, drift: -0.01, order: -2, dark: 1 },
      { path: "assets/volumetric-nebula-core-hq.png", color: 0xb9c9ff, pos: new THREE.Vector3(-4, 30, -118), width: 154, height: 94, alpha: 0.16, seed: 13.2, roll: -0.04, drift: 0.009, order: -7, dark: 0 },
      { path: "assets/volumetric-nebula-shadow-hq.png", color: 0x09182f, pos: new THREE.Vector3(8, -24, -126), width: 146, height: 92, alpha: 0.17, seed: 17.7, roll: 0.18, drift: -0.007, order: -3, dark: 1 },
      { path: "assets/volumetric-nebula-core-hq.png", color: 0x66fff0, pos: new THREE.Vector3(-58, 22, -142), width: 166, height: 98, alpha: 0.13, seed: 22.3, roll: -0.28, drift: 0.008, order: -8, dark: 0 },
      { path: "assets/volumetric-nebula-core-hq.png", color: 0xffc17a, pos: new THREE.Vector3(62, 4, -154), width: 172, height: 104, alpha: 0.12, seed: 27.9, roll: 0.34, drift: -0.006, order: -8, dark: 0 }
    ];

    for (const spec of specs) {
      const geometry = new THREE.PlaneGeometry(spec.width, spec.height, 8, 8);
      const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
      const rand = rng(8831 + Math.floor(spec.seed * 100));
      const phaseA = rand() * Math.PI * 2;
      const phaseB = rand() * Math.PI * 2;
      for (let i = 0; i < positions.count; i += 1) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const nx = x / (spec.width * 0.5);
        const ny = y / (spec.height * 0.5);
        const aperture = Math.max(0, 1 - Math.hypot(nx * 0.78, ny * 1.08));
        const relief = Math.sin(nx * 4.7 + phaseA) * Math.cos(ny * 3.9 + phaseB) + Math.sin((nx + ny) * 7.4 + phaseB) * 0.45;
        positions.setZ(i, relief * aperture * (spec.dark ? 2.4 : 4.6));
        positions.setX(i, x + Math.sin(ny * 3.6 + phaseB) * aperture * 1.4);
        positions.setY(i, y + Math.sin(nx * 4.1 + phaseA) * aperture * 0.8);
      }
      positions.needsUpdate = true;
      geometry.computeVertexNormals();

      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uMap: { value: null as THREE.Texture | null },
          uTint: { value: new THREE.Color(spec.color) },
          uAlpha: { value: spec.alpha },
          uSeed: { value: spec.seed },
          uDrift: { value: spec.drift },
          uDark: { value: spec.dark }
        },
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        blending: spec.dark ? THREE.NormalBlending : THREE.AdditiveBlending,
        fog: false,
        vertexShader: `
          uniform float uTime;
          uniform float uSeed;
          varying vec2 vUv;
          varying float vDepth;
          varying float vRelief;
          void main() {
            vUv = uv;
            vec3 p = position;
            p.z += sin(uv.x * 8.0 + uv.y * 5.0 + uSeed + uTime * 0.032) * 0.35;
            vRelief = smoothstep(-3.0, 5.5, p.z);
            vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
            vDepth = -mvPosition.z;
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          uniform sampler2D uMap;
          uniform float uTime;
          uniform float uAlpha;
          uniform float uSeed;
          uniform float uDrift;
          uniform float uDark;
          uniform vec3 uTint;
          varying vec2 vUv;
          varying float vDepth;
          varying float vRelief;

          float hash(vec2 p) {
            p = fract(p * vec2(231.17, 517.31));
            p += dot(p, p + 29.73);
            return fract(p.x * p.y);
          }

          void main() {
            vec2 uv = vUv;
            uv.x = clamp(uv.x + sin(uv.y * 8.2 + uSeed + uTime * 0.04) * 0.006 + uTime * uDrift * 0.011, 0.0, 1.0);
            uv.y = clamp(uv.y + sin(uv.x * 6.1 - uSeed + uTime * 0.026) * 0.005, 0.0, 1.0);
            vec4 tex = texture2D(uMap, uv);
            vec2 p = (vUv - 0.5) * vec2(1.46, 1.2);
            float aperture = smoothstep(1.02, 0.16, length(p));
            float depthFade = smoothstep(20.0, 46.0, vDepth) * (1.0 - smoothstep(170.0, 252.0, vDepth));
            float lum = max(max(tex.r, tex.g), tex.b);
            float ember = pow(lum, 3.35);
            float grain = hash(floor((uv + uSeed) * vec2(260.0, 260.0)));
            float ridge = smoothstep(0.24, 0.94, vRelief);
            float body = tex.a * aperture * depthFade;
            float alpha = body * uAlpha * (0.72 + ember * 0.52 + ridge * 0.22 + grain * 0.05);
            vec3 gas = tex.rgb * (0.52 + ember * 1.55 + ridge * 0.28);
            gas += uTint * tex.a * (0.26 + ridge * 0.22);
            gas += vec3(1.0, 0.78, 0.48) * ember * 0.14;
            vec3 dust = mix(vec3(0.0, 0.002, 0.008), uTint * 0.12, tex.b * 0.32 + ridge * 0.1);
            vec3 color = mix(gas, dust, uDark);
            alpha *= mix(1.0, 0.7, uDark);
            if (alpha < 0.0035) discard;
            gl_FragColor = vec4(color, clamp(alpha, 0.0, mix(0.38, 0.2, uDark)));
          }
        `
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(spec.pos);
      mesh.quaternion.copy(this.camera.quaternion);
      mesh.rotateZ(spec.roll);
      mesh.renderOrder = spec.order;
      mesh.frustumCulled = false;
      mesh.userData.base = spec.pos.clone();
      mesh.userData.roll = spec.roll;
      mesh.userData.phase = spec.seed;
      group.add(mesh);
      this.animatedMaterials.push(material);
      this.loadTexture(spec.path, (texture) => {
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.anisotropy = Math.min(12, this.renderer.capabilities.getMaxAnisotropy());
        material.uniforms.uMap.value = texture;
      });
    }

    const moteCount = 920;
    const rand = rng(401933);
    const positions = new Float32Array(moteCount * 3);
    const colors = new Float32Array(moteCount * 3);
    const sizes = new Float32Array(moteCount);
    const phases = new Float32Array(moteCount);
    for (let i = 0; i < moteCount; i += 1) {
      const z = -54 - Math.pow(rand(), 0.74) * 110;
      const spread = 22 + (Math.abs(z) - 54) * 0.45;
      const angle = rand() * Math.PI * 2;
      const radius = Math.pow(rand(), 0.64) * spread;
      const p = i * 3;
      positions[p] = Math.cos(angle) * radius + Math.sin(Math.abs(z) * 0.08) * 8;
      positions[p + 1] = (rand() - 0.5) * (24 + spread * 0.42) + Math.cos(angle * 2.0) * 4;
      positions[p + 2] = z;
      TMP_COLOR.setHSL(rand() > 0.58 ? 0.51 + rand() * 0.08 : 0.09 + rand() * 0.05, 0.58 + rand() * 0.3, 0.58 + rand() * 0.32);
      if (rand() > 0.9) TMP_COLOR.lerp(new THREE.Color(0xfff0c8), 0.5);
      colors[p] = TMP_COLOR.r;
      colors[p + 1] = TMP_COLOR.g;
      colors[p + 2] = TMP_COLOR.b;
      sizes[i] = 0.38 + Math.pow(rand(), 3.7) * 5.4;
      phases[i] = rand() * 1000;
    }

    const moteGeometry = new THREE.BufferGeometry();
    moteGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    moteGeometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    moteGeometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    moteGeometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    const moteMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMap: { value: makeGlowTexture(96) }
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aPhase;
        uniform float uTime;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSpike;
        void main() {
          vColor = aColor;
          vec3 p = position;
          p.x += sin(uTime * 0.09 + aPhase) * 0.18;
          p.y += cos(uTime * 0.08 + aPhase * 1.33) * 0.14;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          float depth = max(1.0, -mvPosition.z);
          float fade = smoothstep(20.0, 52.0, depth) * (1.0 - smoothstep(160.0, 238.0, depth));
          float pulse = 0.7 + 0.3 * sin(uTime * (0.6 + fract(aPhase) * 1.1) + aPhase);
          vAlpha = fade * pulse * (0.42 + fract(aPhase * 0.51) * 0.58);
          vSpike = smoothstep(3.8, 5.2, aSize);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(aSize * (230.0 / depth), 0.7, 8.5);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSpike;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          if (length(uv) > 0.5) discard;
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float cross = max(smoothstep(0.016, 0.0, abs(uv.x)) * smoothstep(0.5, 0.04, abs(uv.y)), smoothstep(0.016, 0.0, abs(uv.y)) * smoothstep(0.5, 0.04, abs(uv.x))) * vSpike;
          float alpha = (tex.a * 0.52 + cross * 0.12) * vAlpha;
          if (alpha < 0.004) discard;
          vec3 color = mix(vColor, vec3(1.0, 0.92, 0.72), tex.a * 0.3 + cross * 0.24);
          gl_FragColor = vec4(color * (0.58 + tex.a * 1.24 + cross * 0.8), clamp(alpha, 0.0, 0.74));
        }
      `
    });
    this.animatedMaterials.push(moteMaterial);
    const motes = new THREE.Points(moteGeometry, moteMaterial);
    motes.renderOrder = -1;
    motes.frustumCulled = false;
    motes.userData.motes = true;
    group.add(motes);

    group.userData.particleBudget = specs.length * 512 + moteCount;
  }

  private createStellarNurseryVolume(): void {
    if (this.quality.label !== "HIGH" || this.quality.mobile || this.quality.reducedMotion) return;

    const group = new THREE.Group();
    group.renderOrder = -4;
    group.userData.particleBudget = 0;
    this.stellarNurseryField = group;
    this.scene.add(group);

    const layerSpecs = [
      { path: "assets/stellar-dust-mask-hq.png", color: 0x10203d, pos: new THREE.Vector3(-16, 2, -74), width: 118, height: 58, alpha: 0.32, seed: 1.9, drift: -0.018, roll: -0.12, dark: true, order: -4 },
      { path: "assets/stellar-nursery-hq.png", color: 0x8dfff2, pos: new THREE.Vector3(-32, 12, -96), width: 146, height: 72, alpha: 0.36, seed: 4.7, drift: 0.014, roll: 0.08, dark: false, order: -5 },
      { path: "assets/stellar-nursery-hq.png", color: 0xff9fc7, pos: new THREE.Vector3(48, -6, -124), width: 166, height: 80, alpha: 0.28, seed: 8.3, drift: -0.012, roll: 0.22, dark: false, order: -6 },
      { path: "assets/stellar-dust-mask-hq.png", color: 0x050917, pos: new THREE.Vector3(28, 24, -108), width: 130, height: 64, alpha: 0.24, seed: 11.1, drift: 0.01, roll: 0.31, dark: true, order: -3 }
    ];

    for (const spec of layerSpecs) {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uMap: { value: null as THREE.Texture | null },
          uTint: { value: new THREE.Color(spec.color) },
          uAlpha: { value: spec.alpha },
          uSeed: { value: spec.seed },
          uDrift: { value: spec.drift },
          uDark: { value: spec.dark ? 1 : 0 }
        },
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        blending: spec.dark ? THREE.NormalBlending : THREE.AdditiveBlending,
        fog: false,
        vertexShader: `
          varying vec2 vUv;
          varying float vDepth;
          void main() {
            vUv = uv;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            vDepth = -mvPosition.z;
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          uniform sampler2D uMap;
          uniform float uTime;
          uniform float uAlpha;
          uniform float uSeed;
          uniform float uDrift;
          uniform float uDark;
          uniform vec3 uTint;
          varying vec2 vUv;
          varying float vDepth;

          float hash(vec2 p) {
            p = fract(p * vec2(173.31, 491.73));
            p += dot(p, p + 31.47);
            return fract(p.x * p.y);
          }

          void main() {
            vec2 uv = vUv;
            uv.x = clamp(uv.x + sin(uv.y * 6.2 + uSeed + uTime * 0.045) * 0.006 + uTime * uDrift * 0.012, 0.0, 1.0);
            uv.y = clamp(uv.y + sin(uv.x * 4.7 - uSeed + uTime * 0.031) * 0.005, 0.0, 1.0);
            vec4 tex = texture2D(uMap, uv);
            vec2 p = (vUv - 0.5) * vec2(1.48, 1.14);
            float aperture = smoothstep(1.02, 0.16, length(p));
            float depthFade = smoothstep(36.0, 62.0, vDepth) * (1.0 - smoothstep(168.0, 240.0, vDepth));
            float lum = max(max(tex.r, tex.g), tex.b);
            float ember = pow(lum, 3.0);
            float grain = hash(floor((uv + uSeed) * vec2(220.0, 128.0)));
            float alpha = tex.a * uAlpha * aperture * depthFade * (0.82 + ember * 0.54 + grain * 0.08);
            vec3 gas = tex.rgb * (0.58 + ember * 1.45) + uTint * tex.a * (0.42 + ember * 0.38);
            gas += vec3(1.0, 0.78, 0.44) * ember * 0.18;
            vec3 dust = mix(vec3(0.0, 0.003, 0.01), uTint * 0.22, tex.b * 0.45 + grain * 0.08);
            vec3 color = mix(gas, dust, uDark);
            alpha *= mix(1.0, 0.72, uDark);
            if (alpha < 0.004) discard;
            gl_FragColor = vec4(color, clamp(alpha, 0.0, mix(0.48, 0.26, uDark)));
          }
        `
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(spec.width, spec.height, 3, 3), material);
      mesh.position.copy(spec.pos);
      mesh.quaternion.copy(this.camera.quaternion);
      mesh.rotateZ(spec.roll);
      mesh.renderOrder = spec.order;
      mesh.frustumCulled = false;
      mesh.userData.roll = spec.roll;
      mesh.userData.phase = spec.seed;
      group.add(mesh);
      this.animatedMaterials.push(material);
      this.loadTexture(spec.path, (texture) => {
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        material.uniforms.uMap.value = texture;
      });
    }

    const starCount = 1450;
    const rand = rng(91831);
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);
    const phases = new Float32Array(starCount);
    const clusters = [
      new THREE.Vector3(-36, 14, -92),
      new THREE.Vector3(43, -4, -118),
      new THREE.Vector3(8, 27, -134)
    ];
    for (let i = 0; i < starCount; i += 1) {
      const cluster = clusters[Math.floor(rand() * clusters.length)];
      const r = Math.pow(rand(), 0.58);
      const a = rand() * Math.PI * 2;
      const b = Math.acos(rand() * 2 - 1);
      const stretch = 18 + rand() * 38;
      const p = i * 3;
      positions[p] = cluster.x + Math.sin(b) * Math.cos(a) * stretch * r + (rand() - 0.5) * 8;
      positions[p + 1] = cluster.y + Math.cos(b) * stretch * 0.46 * r + (rand() - 0.5) * 5;
      positions[p + 2] = cluster.z + Math.sin(b) * Math.sin(a) * stretch * 0.72 * r;
      TMP_COLOR.setHSL(rand() > 0.62 ? 0.095 + rand() * 0.04 : 0.52 + rand() * 0.1, 0.58 + rand() * 0.34, 0.66 + rand() * 0.28);
      if (rand() > 0.92) TMP_COLOR.lerp(new THREE.Color(0xffffff), 0.55);
      colors[p] = TMP_COLOR.r;
      colors[p + 1] = TMP_COLOR.g;
      colors[p + 2] = TMP_COLOR.b;
      sizes[i] = 0.42 + Math.pow(rand(), 5.4) * 8.8;
      phases[i] = rand() * 1000;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMap: { value: makeGlowTexture(128) }
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aPhase;
        uniform float uTime;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSpike;
        void main() {
          vColor = aColor;
          vec3 p = position;
          p.x += sin(uTime * 0.08 + aPhase) * 0.18;
          p.y += cos(uTime * 0.07 + aPhase * 1.31) * 0.12;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          float depth = max(1.0, -mvPosition.z);
          float fade = smoothstep(42.0, 72.0, depth) * (1.0 - smoothstep(172.0, 236.0, depth));
          float pulse = 0.72 + 0.28 * sin(uTime * (0.55 + fract(aPhase) * 0.9) + aPhase * 4.1);
          vAlpha = fade * pulse * (0.42 + fract(aPhase * 0.71) * 0.58);
          vSpike = smoothstep(4.2, 9.0, aSize);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(aSize * (225.0 / depth), 0.8, 15.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSpike;
        void main() {
          vec2 uv = gl_PointCoord.xy - 0.5;
          float d = length(uv);
          if (d > 0.5) discard;
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float starX = (1.0 - smoothstep(0.012, 0.075, abs(uv.y))) * smoothstep(0.5, 0.04, abs(uv.x));
          float starY = (1.0 - smoothstep(0.012, 0.075, abs(uv.x))) * smoothstep(0.5, 0.04, abs(uv.y));
          float spike = max(starX, starY) * vSpike * 0.22;
          float alpha = (tex.a * 0.62 + spike) * vAlpha;
          if (alpha < 0.005) discard;
          vec3 color = mix(vColor, vec3(1.0, 0.9, 0.68), tex.a * 0.28 + spike * 0.32);
          gl_FragColor = vec4(color * (0.55 + tex.a * 1.28 + spike * 0.8), clamp(alpha, 0.0, 0.82));
        }
      `
    });
    this.animatedMaterials.push(material);
    const stars = new THREE.Points(geometry, material);
    stars.renderOrder = -2;
    stars.frustumCulled = false;
    group.add(stars);
    group.userData.particleBudget = starCount + layerSpecs.length * 128;
  }

  private createCosmicWebField(): void {
    if (this.quality.label !== "HIGH" || this.quality.mobile || this.quality.reducedMotion) return;

    const group = new THREE.Group();
    group.renderOrder = -1;
    group.userData.particleBudget = 0;
    this.cosmicWebField = group;
    this.scene.add(group);

    const rand = rng(99173);
    const filamentCount = 18;
    const nodePositions: number[] = [];
    const nodeColors: number[] = [];
    const nodeSizes: number[] = [];
    const nodePhases: number[] = [];

    for (let i = 0; i < filamentCount; i += 1) {
      const side = i % 2 === 0 ? 1 : -1;
      const depth = -78 - rand() * 94;
      const span = 48 + rand() * 62;
      const height = -26 + rand() * 74;
      const x0 = -span * side + (rand() - 0.5) * 28;
      const x1 = span * side + (rand() - 0.5) * 34;
      const zBend = depth + (rand() - 0.5) * 32;
      const colorHue = rand() > 0.58 ? 0.52 + rand() * 0.08 : 0.78 + rand() * 0.16;
      const filamentColor = new THREE.Color().setHSL(colorHue, 0.74 + rand() * 0.18, 0.54 + rand() * 0.2);
      const points = [
        new THREE.Vector3(x0, height + (rand() - 0.5) * 22, depth + rand() * 18),
        new THREE.Vector3(x0 * 0.42 + (rand() - 0.5) * 18, height + 18 + rand() * 28, zBend),
        new THREE.Vector3(x1 * 0.36 + (rand() - 0.5) * 22, height - 18 + rand() * 36, zBend + 16 + rand() * 30),
        new THREE.Vector3(x1, height + (rand() - 0.5) * 24, depth + 28 + rand() * 42)
      ];
      const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.34 + rand() * 0.18);
      const radius = 0.07 + Math.pow(rand(), 2.0) * 0.16;
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: filamentColor },
          uAlpha: { value: 0.12 + rand() * 0.12 },
          uSeed: { value: rand() * 1000 }
        },
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: false,
        vertexShader: `
          varying vec2 vUv;
          varying float vDepth;
          void main() {
            vUv = uv;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            vDepth = -mvPosition.z;
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uAlpha;
          uniform float uSeed;
          uniform vec3 uColor;
          varying vec2 vUv;
          varying float vDepth;
          void main() {
            float around = 1.0 - abs(vUv.x - 0.5) * 2.0;
            float core = pow(clamp(around, 0.0, 1.0), 1.7);
            float packet = pow(sin(vUv.y * 28.0 - uTime * 0.36 + uSeed) * 0.5 + 0.5, 5.0);
            float depthFade = smoothstep(36.0, 76.0, vDepth) * (1.0 - smoothstep(202.0, 254.0, vDepth));
            float alpha = depthFade * (core * (0.58 + packet * 0.88)) * uAlpha;
            vec3 hot = mix(uColor, vec3(1.0, 0.92, 0.72), packet * 0.28);
            if (alpha < 0.002) discard;
            gl_FragColor = vec4(hot * (0.92 + packet * 0.86), clamp(alpha, 0.0, 0.32));
          }
        `
      });
      this.animatedMaterials.push(material);

      const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 78, radius, 8, false), material);
      mesh.renderOrder = -1;
      mesh.frustumCulled = false;
      group.add(mesh);

      for (let j = 0; j < points.length; j += 1) {
        if (rand() < 0.18) continue;
        const p = points[j];
        nodePositions.push(p.x, p.y, p.z);
        nodeColors.push(filamentColor.r, filamentColor.g, filamentColor.b);
        nodeSizes.push(2.4 + rand() * 5.2);
        nodePhases.push(rand() * 1000);
      }
      for (let j = 0; j < 7; j += 1) {
        const p = curve.getPoint(rand());
        nodePositions.push(p.x + (rand() - 0.5) * 4.5, p.y + (rand() - 0.5) * 4.5, p.z + (rand() - 0.5) * 4.5);
        nodeColors.push(filamentColor.r, filamentColor.g, filamentColor.b);
        nodeSizes.push(0.9 + Math.pow(rand(), 2.4) * 3.2);
        nodePhases.push(rand() * 1000);
      }
    }

    const nodeCount = nodeSizes.length;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(nodePositions, 3));
    geometry.setAttribute("aColor", new THREE.Float32BufferAttribute(nodeColors, 3));
    geometry.setAttribute("aSize", new THREE.Float32BufferAttribute(nodeSizes, 1));
    geometry.setAttribute("aPhase", new THREE.Float32BufferAttribute(nodePhases, 1));
    const nodeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMap: { value: makeGlowTexture(128) }
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aPhase;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vPhase;
        uniform float uTime;
        void main() {
          vColor = aColor;
          vPhase = aPhase;
          vec3 p = position;
          p.x += sin(uTime * 0.07 + aPhase) * 0.55;
          p.y += cos(uTime * 0.06 + aPhase * 1.37) * 0.34;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          float depth = max(1.0, -mvPosition.z);
          float fade = smoothstep(34.0, 68.0, depth) * (1.0 - smoothstep(210.0, 268.0, depth));
          vAlpha = fade * (0.58 + fract(aPhase) * 0.42);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(aSize * (250.0 / depth), 1.1, 10.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform float uTime;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vPhase;
        void main() {
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float pulse = 0.78 + 0.22 * sin(uTime * (0.55 + fract(vPhase) * 1.7) + vPhase);
          float alpha = tex.a * vAlpha * pulse * 0.82;
          if (alpha < 0.004) discard;
          vec3 color = mix(vColor, vec3(1.0, 0.93, 0.76), tex.a * 0.34);
          gl_FragColor = vec4(color * (0.64 + tex.a * 1.15), clamp(alpha, 0.0, 0.76));
        }
      `
    });
    this.animatedMaterials.push(nodeMaterial);
    const nodes = new THREE.Points(geometry, nodeMaterial);
    nodes.renderOrder = 0;
    nodes.frustumCulled = false;
    group.add(nodes);
    group.userData.particleBudget = nodeCount + filamentCount * 86;
  }

  private createDeepSpaceDebrisField(): void {
    if (this.quality.label !== "HIGH" || this.quality.mobile) return;

    const group = new THREE.Group();
    group.renderOrder = 4;
    group.userData.particleBudget = 0;
    this.deepSpaceDebrisField = group;
    this.scene.add(group);

    const rand = rng(220921);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const blackHoleCenter = new THREE.Vector3(21, 0, -38);

    const rockCount = 420;
    const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
    const rockMaterial = new THREE.MeshStandardMaterial({
      color: 0xb7c0cc,
      roughness: 0.86,
      metalness: 0.08,
      envMapIntensity: 0.62,
      vertexColors: true
    });
    const rocks = new THREE.InstancedMesh(rockGeometry, rockMaterial, rockCount);

    for (let i = 0; i < rockCount; i += 1) {
      const orbital = rand() < 0.68;
      if (orbital) {
        const radius = 21 + Math.pow(rand(), 0.82) * 48;
        const angle = rand() * Math.PI * 2;
        const belt = rand() > 0.5 ? 1 : -1;
        dummy.position.set(
          blackHoleCenter.x + Math.cos(angle) * radius + (rand() - 0.5) * 4.2,
          blackHoleCenter.y + Math.sin(angle * 1.7) * (2.8 + rand() * 4.4) * belt + (rand() - 0.5) * 2.2,
          blackHoleCenter.z + Math.sin(angle) * radius * (0.38 + rand() * 0.28) + (rand() - 0.5) * 4.2
        );
      } else {
        const theta = rand() * Math.PI * 2;
        const radius = 38 + rand() * 72;
        dummy.position.set(Math.cos(theta) * radius, (rand() - 0.5) * 62, Math.sin(theta) * radius - 22 - rand() * 74);
      }
      dummy.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
      const scale = 0.08 + Math.pow(rand(), 2.55) * (orbital ? 1.15 : 2.35);
      dummy.scale.set(scale * (0.55 + rand() * 1.9), scale * (0.5 + rand() * 1.3), scale * (0.48 + rand() * 1.5));
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
      color.setHSL(rand() > 0.7 ? 0.09 + rand() * 0.05 : 0.57 + rand() * 0.06, 0.16 + rand() * 0.22, 0.32 + rand() * 0.22);
      if (orbital && rand() > 0.74) color.lerp(new THREE.Color(0xffd98a), 0.18 + rand() * 0.2);
      rocks.setColorAt(i, color);
    }
    rocks.instanceMatrix.needsUpdate = true;
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    rocks.renderOrder = 4;
    group.add(rocks);

    const crystalCount = 260;
    const crystalGeometry = new THREE.OctahedronGeometry(1, 0);
    const crystalMaterial = new THREE.MeshStandardMaterial({
      color: 0xbffcff,
      roughness: 0.34,
      metalness: 0.18,
      emissive: 0x082b34,
      emissiveIntensity: 0.2,
      envMapIntensity: 1.25,
      vertexColors: true,
      transparent: true,
      opacity: 0.74,
      depthWrite: false
    });
    const crystals = new THREE.InstancedMesh(crystalGeometry, crystalMaterial, crystalCount);

    for (let i = 0; i < crystalCount; i += 1) {
      const theta = rand() * Math.PI * 2;
      const radius = 28 + Math.pow(rand(), 0.7) * 88;
      const lifted = rand() > 0.45 ? 1 : -1;
      dummy.position.set(
        Math.cos(theta) * radius + Math.sin(theta * 2.1) * 8,
        lifted * (12 + rand() * 44) + Math.sin(theta * 3.0) * 4,
        Math.sin(theta) * radius * 0.82 - 48 - rand() * 94
      );
      dummy.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
      const scale = 0.09 + Math.pow(rand(), 2.9) * 1.28;
      dummy.scale.set(scale * (0.28 + rand() * 0.5), scale * (1.4 + rand() * 3.2), scale * (0.28 + rand() * 0.72));
      dummy.updateMatrix();
      crystals.setMatrixAt(i, dummy.matrix);
      color.setHSL(rand() > 0.78 ? 0.09 + rand() * 0.04 : 0.5 + rand() * 0.1, 0.48 + rand() * 0.34, 0.48 + rand() * 0.28);
      if (rand() > 0.86) color.lerp(new THREE.Color(0xffffff), 0.45);
      crystals.setColorAt(i, color);
    }
    crystals.instanceMatrix.needsUpdate = true;
    if (crystals.instanceColor) crystals.instanceColor.needsUpdate = true;
    crystals.renderOrder = 5;
    group.add(crystals);

    const sparkCount = 820;
    const positions = new Float32Array(sparkCount * 3);
    const colors = new Float32Array(sparkCount * 3);
    const sizes = new Float32Array(sparkCount);
    const phases = new Float32Array(sparkCount);
    for (let i = 0; i < sparkCount; i += 1) {
      const orbit = rand() < 0.62;
      const p = i * 3;
      if (orbit) {
        const radius = 18 + Math.pow(rand(), 0.78) * 66;
        const angle = rand() * Math.PI * 2;
        positions[p] = blackHoleCenter.x + Math.cos(angle) * radius + (rand() - 0.5) * 6;
        positions[p + 1] = blackHoleCenter.y + (rand() - 0.5) * (8 + radius * 0.12);
        positions[p + 2] = blackHoleCenter.z + Math.sin(angle) * radius * (0.42 + rand() * 0.28) + (rand() - 0.5) * 6;
      } else {
        const theta = rand() * Math.PI * 2;
        const radius = 34 + rand() * 92;
        positions[p] = Math.cos(theta) * radius;
        positions[p + 1] = (rand() - 0.5) * 76;
        positions[p + 2] = Math.sin(theta) * radius - 34 - rand() * 112;
      }
      TMP_COLOR.setHSL(rand() > 0.58 ? 0.095 + rand() * 0.04 : 0.52 + rand() * 0.09, 0.62 + rand() * 0.28, 0.56 + rand() * 0.32);
      colors[p] = TMP_COLOR.r;
      colors[p + 1] = TMP_COLOR.g;
      colors[p + 2] = TMP_COLOR.b;
      sizes[i] = 0.42 + Math.pow(rand(), 4.1) * 6.4;
      phases[i] = rand() * 1000;
    }

    const sparkGeometry = new THREE.BufferGeometry();
    sparkGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    sparkGeometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    sparkGeometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    sparkGeometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    const sparkMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMap: { value: makeGlowTexture(128) }
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aPhase;
        uniform float uTime;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSpike;
        void main() {
          vColor = aColor;
          vec3 p = position;
          p.x += sin(uTime * 0.12 + aPhase) * 0.22;
          p.y += cos(uTime * 0.1 + aPhase * 1.41) * 0.16;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          float depth = max(1.0, -mvPosition.z);
          float fade = smoothstep(16.0, 38.0, depth) * (1.0 - smoothstep(160.0, 236.0, depth));
          float pulse = 0.72 + 0.28 * sin(uTime * (0.78 + fract(aPhase) * 1.2) + aPhase);
          vAlpha = fade * pulse * (0.44 + fract(aPhase * 0.67) * 0.56);
          vSpike = smoothstep(3.8, 6.8, aSize);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(aSize * (235.0 / depth), 0.72, 9.5);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSpike;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          if (d > 0.5) discard;
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float star = max(smoothstep(0.018, 0.0, abs(uv.x)) * smoothstep(0.5, 0.02, abs(uv.y)), smoothstep(0.018, 0.0, abs(uv.y)) * smoothstep(0.5, 0.02, abs(uv.x))) * vSpike;
          float alpha = (tex.a * 0.52 + star * 0.1) * vAlpha;
          if (alpha < 0.004) discard;
          vec3 color = mix(vColor, vec3(1.0, 0.9, 0.68), tex.a * 0.32 + star * 0.24);
          gl_FragColor = vec4(color * (0.55 + tex.a * 1.18 + star * 0.9), clamp(alpha, 0.0, 0.7));
        }
      `
    });
    this.animatedMaterials.push(sparkMaterial);
    const sparks = new THREE.Points(sparkGeometry, sparkMaterial);
    sparks.renderOrder = 6;
    sparks.frustumCulled = false;
    group.add(sparks);

    this.enableHighDetailShadows(group);
    group.userData.particleBudget = rockCount + crystalCount + sparkCount;
  }

  private createRelativisticWakeField(): void {
    if (this.quality.label !== "HIGH" || this.quality.mobile || this.quality.reducedMotion) return;

    const group = new THREE.Group();
    group.position.set(21, 0, -38);
    group.rotation.set(-0.05, 0.16, 0.02);
    group.userData.particleBudget = 0;
    group.renderOrder = 7;
    this.relativisticWakeField = group;
    this.scene.add(group);

    const rand = rng(990173);
    const arcCount = 34;
    const glowNodes: number[] = [];
    const glowColors: number[] = [];
    const glowSizes: number[] = [];
    const glowPhases: number[] = [];

    for (let i = 0; i < arcCount; i += 1) {
      const radius = 18 + Math.pow(rand(), 0.76) * 76;
      const start = rand() * Math.PI * 2;
      const length = 0.42 + Math.pow(rand(), 0.55) * 1.42;
      const clockwise = rand() > 0.5 ? 1 : -1;
      const tilt = new THREE.Euler(
        -0.86 + (rand() - 0.5) * 0.48,
        (rand() - 0.5) * 0.92,
        (rand() - 0.5) * 0.62,
        "XYZ"
      );
      const points: THREE.Vector3[] = [];
      const steps = 14;
      for (let j = 0; j < steps; j += 1) {
        const t = j / (steps - 1);
        const angle = start + length * clockwise * t;
        const ribbon = Math.sin(t * Math.PI) * (2.4 + rand() * 4.8);
        const localRadius = radius + Math.sin(t * Math.PI * 2 + i) * 1.3 + ribbon;
        const p = new THREE.Vector3(
          Math.cos(angle) * localRadius,
          Math.sin(angle * 1.7 + i) * (1.4 + radius * 0.038),
          Math.sin(angle) * localRadius * (0.36 + rand() * 0.22)
        ).applyEuler(tilt);
        points.push(p);
        if (j % 2 === 0 || rand() > 0.62) {
          glowNodes.push(p.x, p.y, p.z);
          TMP_COLOR.setHSL(rand() > 0.42 ? 0.09 + rand() * 0.045 : 0.51 + rand() * 0.08, 0.72 + rand() * 0.18, 0.58 + rand() * 0.28);
          glowColors.push(TMP_COLOR.r, TMP_COLOR.g, TMP_COLOR.b);
          glowSizes.push(1.2 + Math.pow(rand(), 1.9) * 6.4);
          glowPhases.push(rand() * 1000);
        }
      }

      const curve = new THREE.CatmullRomCurve3(points, false, "centripetal", 0.45);
      const color = new THREE.Color().setHSL(rand() > 0.5 ? 0.095 + rand() * 0.045 : 0.5 + rand() * 0.07, 0.82, 0.58 + rand() * 0.18);
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.26,
        metalness: 0.38,
        emissive: color,
        emissiveIntensity: 0.42 + rand() * 0.22,
        envMapIntensity: 1.35,
        transparent: true,
        opacity: 0.3 + rand() * 0.22,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false
      });
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 84, 0.025 + Math.pow(rand(), 2.4) * 0.095, 7, false),
        material
      );
      tube.renderOrder = 7;
      tube.userData.phase = rand() * 1000;
      tube.userData.spin = (rand() > 0.5 ? 1 : -1) * (0.002 + rand() * 0.004);
      group.add(tube);
    }

    const vaneCount = 48;
    const vaneGeometry = new THREE.BoxGeometry(1, 0.018, 0.22);
    const vaneMaterial = new THREE.MeshStandardMaterial({
      color: 0xbfd8e8,
      roughness: 0.34,
      metalness: 0.68,
      emissive: 0x123b47,
      emissiveIntensity: 0.12,
      envMapIntensity: 1.6,
      vertexColors: true
    });
    const vanes = new THREE.InstancedMesh(vaneGeometry, vaneMaterial, vaneCount);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (let i = 0; i < vaneCount; i += 1) {
      const angle = rand() * Math.PI * 2;
      const radius = 24 + Math.pow(rand(), 0.7) * 68;
      const lane = rand() > 0.5 ? 1 : -1;
      dummy.position.set(
        Math.cos(angle) * radius,
        lane * (3 + rand() * 18) + Math.sin(angle * 2.0) * 2.8,
        Math.sin(angle) * radius * (0.34 + rand() * 0.24)
      );
      dummy.lookAt(0, 0, 0);
      dummy.rotateZ((rand() - 0.5) * 0.9);
      const scale = 0.8 + Math.pow(rand(), 1.6) * 2.8;
      dummy.scale.set(scale * (1.2 + rand() * 2.6), scale * (0.55 + rand() * 1.1), scale * (0.36 + rand() * 0.9));
      dummy.updateMatrix();
      vanes.setMatrixAt(i, dummy.matrix);
      color.setHSL(rand() > 0.46 ? 0.09 + rand() * 0.05 : 0.52 + rand() * 0.07, 0.3 + rand() * 0.28, 0.38 + rand() * 0.24);
      vanes.setColorAt(i, color);
    }
    vanes.instanceMatrix.needsUpdate = true;
    if (vanes.instanceColor) vanes.instanceColor.needsUpdate = true;
    vanes.renderOrder = 6;
    group.add(vanes);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(glowNodes, 3));
    geometry.setAttribute("aColor", new THREE.Float32BufferAttribute(glowColors, 3));
    geometry.setAttribute("aSize", new THREE.Float32BufferAttribute(glowSizes, 1));
    geometry.setAttribute("aPhase", new THREE.Float32BufferAttribute(glowPhases, 1));
    const nodeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMap: { value: makeGlowTexture(128) }
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aPhase;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uTime;
        void main() {
          vColor = aColor;
          vec3 p = position;
          p.x += sin(uTime * 0.08 + aPhase) * 0.18;
          p.y += cos(uTime * 0.07 + aPhase * 1.6) * 0.13;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          float depth = max(1.0, -mvPosition.z);
          float fade = smoothstep(12.0, 36.0, depth) * (1.0 - smoothstep(145.0, 245.0, depth));
          vAlpha = fade * (0.48 + fract(aPhase) * 0.52);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(aSize * (255.0 / depth), 1.0, 12.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float alpha = tex.a * vAlpha * 0.8;
          if (alpha < 0.004) discard;
          vec3 color = mix(vColor, vec3(1.0, 0.92, 0.68), tex.a * 0.38);
          gl_FragColor = vec4(color * (0.62 + tex.a * 1.45), clamp(alpha, 0.0, 0.78));
        }
      `
    });
    this.animatedMaterials.push(nodeMaterial);
    const nodes = new THREE.Points(geometry, nodeMaterial);
    nodes.renderOrder = 8;
    nodes.frustumCulled = false;
    group.add(nodes);

    this.enableHighDetailShadows(group);
    group.userData.particleBudget = arcCount * 86 + vaneCount + glowSizes.length;
  }

  private createEventHorizonCitadelField(): void {
    if (this.quality.label !== "HIGH" || this.quality.mobile) return;

    const group = new THREE.Group();
    group.position.set(21, -0.4, -38);
    group.rotation.set(-0.02, 0.08, 0.03);
    group.renderOrder = 8;
    group.userData.particleBudget = 0;
    this.eventHorizonCitadelField = group;
    this.scene.add(group);

    const rand = rng(552911);
    const cyan = new THREE.Color(0x33e7c8);
    const amber = new THREE.Color(0xffb96d);
    const violet = new THREE.Color(0x8d72ff);
    const steel = new THREE.Color(0x9aa9b2);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    const spireCount = 112;
    const spireGeometry = new THREE.CylinderGeometry(0.14, 0.58, 1, 7, 1, false);
    const spireMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x111821,
      roughness: 0.26,
      metalness: 0.92,
      emissive: 0x03080d,
      emissiveIntensity: 0.06,
      envMapIntensity: 2.35,
      clearcoat: 0.55,
      clearcoatRoughness: 0.28,
      vertexColors: true
    });
    const spires = new THREE.InstancedMesh(spireGeometry, spireMaterial, spireCount);
    for (let i = 0; i < spireCount; i += 1) {
      const a = (i / spireCount) * Math.PI * 2 + (rand() - 0.5) * 0.16;
      const radius = 12 + Math.pow(rand(), 0.62) * 58;
      const upper = rand() > 0.48 ? 1 : -1;
      const height = 4.8 + Math.pow(rand(), 1.7) * 17.5;
      dummy.position.set(
        Math.cos(a) * radius + Math.sin(a * 2.4) * 1.7,
        upper * (2 + rand() * 16) + Math.sin(a * 3.0) * 1.2,
        Math.sin(a) * radius * (0.34 + rand() * 0.18)
      );
      dummy.rotation.set(
        upper * (0.12 + rand() * 0.28),
        -a + Math.PI / 2 + (rand() - 0.5) * 0.42,
        (rand() - 0.5) * 0.72
      );
      const s = 0.52 + Math.pow(rand(), 1.5) * 2.5;
      dummy.scale.set(s * (0.55 + rand() * 0.75), height, s * (0.55 + rand() * 0.86));
      dummy.updateMatrix();
      spires.setMatrixAt(i, dummy.matrix);
      color.copy(steel).lerp(rand() > 0.5 ? cyan : amber, 0.07 + rand() * 0.2);
      if (rand() > 0.86) color.lerp(violet, 0.24);
      spires.setColorAt(i, color);
    }
    spires.instanceMatrix.needsUpdate = true;
    if (spires.instanceColor) spires.instanceColor.needsUpdate = true;
    spires.renderOrder = 7;
    group.add(spires);

    const armorCount = 214;
    const armorGeometry = new THREE.BoxGeometry(1, 0.075, 0.56);
    const armorMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x687782,
      roughness: 0.32,
      metalness: 0.82,
      emissive: 0x041018,
      emissiveIntensity: 0.1,
      envMapIntensity: 2.05,
      clearcoat: 0.32,
      clearcoatRoughness: 0.35,
      vertexColors: true
    });
    const armor = new THREE.InstancedMesh(armorGeometry, armorMaterial, armorCount);
    for (let i = 0; i < armorCount; i += 1) {
      const nearCore = rand() < 0.7;
      const a = rand() * Math.PI * 2;
      const radius = nearCore ? 14 + Math.pow(rand(), 0.6) * 39 : 42 + rand() * 58;
      dummy.position.set(
        Math.cos(a) * radius,
        (rand() - 0.5) * (nearCore ? 23 : 48),
        Math.sin(a) * radius * (nearCore ? 0.36 : 0.52) - (nearCore ? 0 : rand() * 46)
      );
      dummy.lookAt(0, dummy.position.y * 0.15, 0);
      dummy.rotateZ(Math.PI / 2 + (rand() - 0.5) * 0.85);
      dummy.rotateY((rand() - 0.5) * 0.52);
      const s = 0.64 + Math.pow(rand(), 1.45) * 3.5;
      dummy.scale.set(s * (1.2 + rand() * 3.4), s * (0.52 + rand() * 1.1), s * (0.52 + rand() * 1.7));
      dummy.updateMatrix();
      armor.setMatrixAt(i, dummy.matrix);
      color.copy(steel).lerp(rand() > 0.58 ? amber : cyan, 0.12 + rand() * 0.28);
      if (rand() > 0.9) color.lerp(new THREE.Color(0xffffff), 0.24);
      armor.setColorAt(i, color);
    }
    armor.instanceMatrix.needsUpdate = true;
    if (armor.instanceColor) armor.instanceColor.needsUpdate = true;
    armor.renderOrder = 7;
    group.add(armor);

    const mirrorCount = 84;
    const mirrorGeometry = new THREE.CircleGeometry(1, 4);
    mirrorGeometry.rotateZ(Math.PI / 4);
    const mirrorMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xcde8ee,
      roughness: 0.08,
      metalness: 1,
      emissive: 0x071b22,
      emissiveIntensity: 0.08,
      envMapIntensity: 3.1,
      clearcoat: 0.9,
      clearcoatRoughness: 0.08,
      vertexColors: true,
      side: THREE.DoubleSide
    });
    const mirrors = new THREE.InstancedMesh(mirrorGeometry, mirrorMaterial, mirrorCount);
    for (let i = 0; i < mirrorCount; i += 1) {
      const a = rand() * Math.PI * 2;
      const radius = 18 + Math.pow(rand(), 0.7) * 54;
      dummy.position.set(
        Math.cos(a) * radius,
        (rand() - 0.5) * 31,
        Math.sin(a) * radius * (0.32 + rand() * 0.28)
      );
      dummy.lookAt(0, 0, 0);
      dummy.rotateZ(rand() * Math.PI * 2);
      const s = 0.72 + Math.pow(rand(), 1.6) * 3.4;
      dummy.scale.set(s * (0.62 + rand() * 1.8), s * (0.62 + rand() * 1.6), 1);
      dummy.updateMatrix();
      mirrors.setMatrixAt(i, dummy.matrix);
      color.copy(rand() > 0.5 ? cyan : amber).lerp(new THREE.Color(0xeefcff), 0.34 + rand() * 0.42);
      mirrors.setColorAt(i, color);
    }
    mirrors.instanceMatrix.needsUpdate = true;
    if (mirrors.instanceColor) mirrors.instanceColor.needsUpdate = true;
    mirrors.renderOrder = 8;
    group.add(mirrors);

    const tetherMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x1b2630,
      roughness: 0.42,
      metalness: 0.78,
      emissive: 0x05131a,
      emissiveIntensity: 0.12,
      envMapIntensity: 1.7,
      clearcoat: 0.24,
      clearcoatRoughness: 0.42
    });
    const tetherCount = 36;
    for (let i = 0; i < tetherCount; i += 1) {
      const side = rand() > 0.5 ? 1 : -1;
      const a = rand() * Math.PI * 2;
      const r0 = 12 + rand() * 12;
      const r1 = 44 + rand() * 48;
      const y0 = side * (2 + rand() * 8);
      const y1 = side * (10 + rand() * 26);
      const points = [
        new THREE.Vector3(Math.cos(a) * r0, y0, Math.sin(a) * r0 * 0.38),
        new THREE.Vector3(Math.cos(a + 0.08) * (r0 + r1) * 0.42, (y0 + y1) * 0.5 + Math.sin(i) * 2.8, Math.sin(a + 0.08) * (r0 + r1) * 0.18),
        new THREE.Vector3(Math.cos(a + 0.18) * r1, y1, Math.sin(a + 0.18) * r1 * (0.36 + rand() * 0.2) - rand() * 18)
      ];
      const material = tetherMaterial.clone();
      material.emissive.copy(rand() > 0.5 ? cyan : amber);
      material.emissiveIntensity = 0.025 + rand() * 0.08;
      const tether = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, "centripetal", 0.4), 64, 0.028 + rand() * 0.07, 6, false), material);
      tether.renderOrder = 7;
      tether.userData.phase = rand() * 1000;
      tether.userData.spin = side * (0.0006 + rand() * 0.0018);
      group.add(tether);
    }

    const veilCount = 11;
    for (let i = 0; i < veilCount; i += 1) {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uSeed: { value: rand() * 1000 },
          uAlpha: { value: 0.035 + rand() * 0.045 },
          uEdge: { value: (rand() > 0.5 ? cyan : amber).clone() }
        },
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        blending: THREE.NormalBlending,
        fog: false,
        vertexShader: `
          varying vec2 vUv;
          uniform float uTime;
          uniform float uSeed;
          void main() {
            vUv = uv;
            vec3 p = position;
            p.x += sin(uv.y * 8.0 + uSeed + uTime * 0.045) * 0.28;
            p.y += sin(uv.x * 5.0 + uSeed * 0.7) * 0.18;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uSeed;
          uniform float uAlpha;
          uniform vec3 uEdge;
          varying vec2 vUv;
          float hash(vec2 p) {
            p = fract(p * vec2(187.21, 317.17));
            p += dot(p, p + 23.71);
            return fract(p.x * p.y);
          }
          float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            float a = hash(i);
            float b = hash(i + vec2(1.0, 0.0));
            float c = hash(i + vec2(0.0, 1.0));
            float d = hash(i + vec2(1.0, 1.0));
            return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
          }
          void main() {
            vec2 p = (vUv - 0.5) * vec2(1.55, 1.0);
            float aperture = smoothstep(1.05, 0.12, length(p));
            float plume = noise(vUv * vec2(7.0, 3.2) + vec2(uSeed, uTime * 0.018));
            float cut = noise(vUv * vec2(19.0, 8.0) - vec2(uTime * 0.014, uSeed));
            float strand = pow(smoothstep(0.42, 0.9, plume), 1.8) * (0.55 + cut * 0.45);
            float edge = smoothstep(0.32, 0.74, abs(vUv.x - 0.5) + abs(vUv.y - 0.5) * 0.42);
            float alpha = aperture * strand * uAlpha;
            if (alpha < 0.004) discard;
            vec3 color = mix(vec3(0.0, 0.002, 0.008), uEdge * 0.12, edge * strand);
            gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.12));
          }
        `
      });
      this.animatedMaterials.push(material);
      const width = 18 + rand() * 45;
      const height = 7 + rand() * 19;
      const veil = new THREE.Mesh(new THREE.PlaneGeometry(width, height, 8, 4), material);
      const a = rand() * Math.PI * 2;
      const radius = 12 + rand() * 47;
      veil.position.set(Math.cos(a) * radius, (rand() - 0.5) * 24, Math.sin(a) * radius * 0.38 - 2 - rand() * 12);
      veil.lookAt(0, 1, 0);
      veil.rotateZ((rand() - 0.5) * 1.2);
      veil.renderOrder = 10;
      group.add(veil);
    }

    const beaconCount = 980;
    const positions = new Float32Array(beaconCount * 3);
    const colors = new Float32Array(beaconCount * 3);
    const sizes = new Float32Array(beaconCount);
    const phases = new Float32Array(beaconCount);
    for (let i = 0; i < beaconCount; i += 1) {
      const p = i * 3;
      const a = rand() * Math.PI * 2;
      const lane = rand() < 0.72;
      const radius = lane ? 13 + Math.pow(rand(), 0.62) * 58 : 44 + rand() * 82;
      positions[p] = Math.cos(a) * radius + (rand() - 0.5) * 2.8;
      positions[p + 1] = (rand() - 0.5) * (lane ? 30 : 62);
      positions[p + 2] = Math.sin(a) * radius * (lane ? 0.34 : 0.58) - (lane ? 0 : rand() * 48);
      TMP_COLOR.copy(rand() > 0.5 ? cyan : amber).lerp(rand() > 0.82 ? violet : new THREE.Color(0xffffff), rand() > 0.82 ? 0.28 : 0.08);
      colors[p] = TMP_COLOR.r;
      colors[p + 1] = TMP_COLOR.g;
      colors[p + 2] = TMP_COLOR.b;
      sizes[i] = 0.35 + Math.pow(rand(), 2.8) * (lane ? 4.6 : 7.2);
      phases[i] = rand() * 1000;
    }

    const beaconGeometry = new THREE.BufferGeometry();
    beaconGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    beaconGeometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    beaconGeometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    beaconGeometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    const beaconMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMap: { value: makeGlowTexture(128) }
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aPhase;
        uniform float uTime;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSpike;
        void main() {
          vColor = aColor;
          vec3 p = position;
          p.x += sin(uTime * 0.09 + aPhase) * 0.1;
          p.y += cos(uTime * 0.08 + aPhase * 1.7) * 0.08;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          float depth = max(1.0, -mvPosition.z);
          float pulse = 0.6 + 0.4 * sin(uTime * (0.7 + fract(aPhase) * 1.3) + aPhase);
          vAlpha = pulse * (0.48 + fract(aPhase * 0.71) * 0.52);
          vSpike = smoothstep(3.2, 6.4, aSize);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(aSize * (245.0 / depth), 0.75, 12.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSpike;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float cross = max(smoothstep(0.014, 0.0, abs(uv.x)) * smoothstep(0.5, 0.03, abs(uv.y)), smoothstep(0.014, 0.0, abs(uv.y)) * smoothstep(0.5, 0.03, abs(uv.x))) * vSpike;
          float alpha = (tex.a * 0.56 + cross * 0.16) * vAlpha;
          if (alpha < 0.004) discard;
          vec3 color = mix(vColor, vec3(1.0, 0.92, 0.72), tex.a * 0.36 + cross * 0.24);
          gl_FragColor = vec4(color * (0.58 + tex.a * 1.5 + cross), clamp(alpha, 0.0, 0.82));
        }
      `
    });
    this.animatedMaterials.push(beaconMaterial);
    const beacons = new THREE.Points(beaconGeometry, beaconMaterial);
    beacons.renderOrder = 11;
    beacons.frustumCulled = false;
    group.add(beacons);

    const rimA = new THREE.PointLight(0xffb96d, 13, 72, 2.05);
    rimA.position.set(-9, 7, 8);
    group.add(rimA);
    const rimB = new THREE.PointLight(0x33e7c8, 11, 68, 2.1);
    rimB.position.set(13, -6, -8);
    group.add(rimB);

    this.enableHighDetailShadows(group);
    group.userData.particleBudget = spireCount + armorCount + mirrorCount + tetherCount * 64 + veilCount * 64 + beaconCount;
  }

  private createMegastructureField(): void {
    if (this.quality.label !== "HIGH" || this.quality.mobile) return;

    const group = new THREE.Group();
    group.position.set(21, -1.4, -38);
    group.rotation.set(0.12, -0.24, -0.08);
    group.scale.setScalar(1.06);
    group.userData.particleBudget = 0;
    this.megastructureField = group;
    this.scene.add(group);

    const rand = rng(771903);
    const cyan = new THREE.Color(0x33e7c8);
    const amber = new THREE.Color(0xffd38a);
    const violet = new THREE.Color(0x9a78d8);
    const shellMaterial = new THREE.MeshStandardMaterial({
      color: 0xb9c8d4,
      roughness: 0.24,
      metalness: 0.84,
      emissive: 0x07151d,
      emissiveIntensity: 0.18,
      envMapIntensity: 1.9,
      vertexColors: true
    });

    const ringMaterial = new THREE.MeshStandardMaterial({
      color: 0x9fb8c8,
      roughness: 0.22,
      metalness: 0.88,
      emissive: 0x0a2930,
      emissiveIntensity: 0.24,
      envMapIntensity: 2.1,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false
    });

    const ringSpecs = [
      { radius: 29.5, tube: 0.055, arc: Math.PI * 1.52, z: 0.06, y: 0.0, color: cyan },
      { radius: 34.5, tube: 0.04, arc: Math.PI * 1.12, z: 1.9, y: 0.12, color: amber },
      { radius: 39.8, tube: 0.032, arc: Math.PI * 0.86, z: -2.1, y: -0.14, color: violet },
      { radius: 45.2, tube: 0.024, arc: Math.PI * 0.64, z: 3.2, y: 0.18, color: cyan }
    ];

    for (let i = 0; i < ringSpecs.length; i += 1) {
      const spec = ringSpecs[i];
      for (let j = 0; j < 3; j += 1) {
        const material = ringMaterial.clone();
        material.color.copy(spec.color).lerp(new THREE.Color(0xdfefff), 0.22 + rand() * 0.22);
        material.emissive.copy(spec.color);
        material.emissiveIntensity = 0.14 + rand() * 0.18;
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(spec.radius + j * 0.42, spec.tube * (1.1 - j * 0.18), 10, 180, spec.arc * (0.82 + rand() * 0.18)),
          material
        );
        ring.rotation.set(1.28 + spec.y + (rand() - 0.5) * 0.06, 0.05 + (rand() - 0.5) * 0.08, spec.z + rand() * Math.PI * 2);
        ring.renderOrder = 7;
        ring.userData.spin = (rand() > 0.5 ? 1 : -1) * (0.0009 + rand() * 0.002);
        ring.userData.phase = rand() * 1000;
        group.add(ring);
      }
    }

    const panelCount = 148;
    const panelGeometry = new THREE.BoxGeometry(1, 0.035, 0.72);
    const panels = new THREE.InstancedMesh(panelGeometry, shellMaterial, panelCount);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (let i = 0; i < panelCount; i += 1) {
      const a = (i / panelCount) * Math.PI * 2 + rand() * 0.04;
      const lane = rand() > 0.54 ? 1 : -1;
      const radius = 26 + Math.pow(rand(), 0.62) * 26;
      const band = Math.sin(a * 3.0 + lane) * 1.2;
      dummy.position.set(
        Math.cos(a) * radius,
        lane * (1.2 + rand() * 9.8) + band,
        Math.sin(a) * radius * (0.42 + rand() * 0.12)
      );
      dummy.lookAt(0, 0, 0);
      dummy.rotateZ(Math.PI / 2 + (rand() - 0.5) * 0.36);
      const scale = 0.62 + Math.pow(rand(), 1.7) * 2.6;
      dummy.scale.set(scale * (1.2 + rand() * 3.1), scale * (0.45 + rand() * 1.1), scale * (0.72 + rand() * 1.8));
      dummy.updateMatrix();
      panels.setMatrixAt(i, dummy.matrix);
      color.copy(rand() > 0.5 ? cyan : amber).lerp(new THREE.Color(0xdee8f2), 0.34 + rand() * 0.36);
      if (rand() > 0.88) color.lerp(violet, 0.46);
      panels.setColorAt(i, color);
    }
    panels.instanceMatrix.needsUpdate = true;
    if (panels.instanceColor) panels.instanceColor.needsUpdate = true;
    panels.renderOrder = 6;
    group.add(panels);

    const trussCount = 96;
    const trussGeometry = new THREE.CylinderGeometry(0.035, 0.035, 1, 6, 1);
    const trussMaterial = new THREE.MeshStandardMaterial({
      color: 0x8198a4,
      roughness: 0.36,
      metalness: 0.78,
      emissive: 0x061118,
      emissiveIntensity: 0.1,
      envMapIntensity: 1.5,
      vertexColors: true
    });
    const trusses = new THREE.InstancedMesh(trussGeometry, trussMaterial, trussCount);
    for (let i = 0; i < trussCount; i += 1) {
      const a = (i / trussCount) * Math.PI * 2 + rand() * 0.12;
      const radius = 23 + rand() * 30;
      const length = 2.0 + rand() * 8.2;
      dummy.position.set(Math.cos(a) * radius, (rand() - 0.5) * 18, Math.sin(a) * radius * (0.4 + rand() * 0.18));
      dummy.lookAt(Math.cos(a + 0.2) * (radius + length), (rand() - 0.5) * 8, Math.sin(a + 0.2) * (radius + length) * 0.48);
      dummy.rotateX(Math.PI / 2);
      dummy.scale.set(0.8 + rand() * 1.6, 0.8 + rand() * 1.6, length);
      dummy.updateMatrix();
      trusses.setMatrixAt(i, dummy.matrix);
      color.copy(cyan).lerp(amber, rand()).lerp(new THREE.Color(0x8798a5), 0.52);
      trusses.setColorAt(i, color);
    }
    trusses.instanceMatrix.needsUpdate = true;
    if (trusses.instanceColor) trusses.instanceColor.needsUpdate = true;
    trusses.renderOrder = 5;
    group.add(trusses);

    const curtainCount = 9;
    for (let i = 0; i < curtainCount; i += 1) {
      const width = 16 + rand() * 36;
      const height = 3.5 + rand() * 9;
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColorA: { value: (rand() > 0.5 ? cyan : amber).clone() },
          uColorB: { value: violet.clone().lerp(cyan, rand() * 0.5) },
          uSeed: { value: rand() * 1000 },
          uAlpha: { value: 0.08 + rand() * 0.075 }
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: false,
        vertexShader: `
          varying vec2 vUv;
          varying vec3 vWorld;
          uniform float uTime;
          uniform float uSeed;
          void main() {
            vUv = uv;
            vec3 p = position;
            p.z += sin(uv.y * 12.0 + uTime * 0.72 + uSeed) * 0.18;
            p.x += sin(uv.y * 7.0 + uSeed) * 0.12;
            vec4 wp = modelMatrix * vec4(p, 1.0);
            vWorld = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uSeed;
          uniform float uAlpha;
          uniform vec3 uColorA;
          uniform vec3 uColorB;
          varying vec2 vUv;
          varying vec3 vWorld;
          float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
          }
          void main() {
            float edge = smoothstep(0.0, 0.08, vUv.x) * (1.0 - smoothstep(0.92, 1.0, vUv.x));
            float vertical = smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.94, 1.0, vUv.y));
            float scan = pow(sin(vUv.y * 36.0 - uTime * 1.2 + uSeed) * 0.5 + 0.5, 4.5);
            float net = smoothstep(0.82, 1.0, sin((vUv.x + vUv.y) * 22.0 + uSeed) * 0.5 + 0.5) * 0.35;
            float grain = hash(vUv * 90.0 + uTime * 0.12) * 0.18;
            float alpha = (scan * 0.7 + net + grain) * edge * vertical * uAlpha;
            if (alpha < 0.003) discard;
            vec3 color = mix(uColorA, uColorB, vUv.y + scan * 0.18);
            gl_FragColor = vec4(color * (0.55 + scan * 1.35), clamp(alpha, 0.0, 0.24));
          }
        `
      });
      this.animatedMaterials.push(material);
      const curtain = new THREE.Mesh(new THREE.PlaneGeometry(width, height, 12, 4), material);
      const a = rand() * Math.PI * 2;
      const radius = 25 + rand() * 25;
      curtain.position.set(Math.cos(a) * radius, (rand() - 0.5) * 18, Math.sin(a) * radius * (0.42 + rand() * 0.08));
      curtain.lookAt(0, 0, 0);
      curtain.rotateZ((rand() - 0.5) * 0.55);
      curtain.renderOrder = 8;
      group.add(curtain);
    }

    const beaconCount = 420;
    const beaconPositions = new Float32Array(beaconCount * 3);
    const beaconColors = new Float32Array(beaconCount * 3);
    const beaconSizes = new Float32Array(beaconCount);
    const beaconPhases = new Float32Array(beaconCount);
    for (let i = 0; i < beaconCount; i += 1) {
      const a = rand() * Math.PI * 2;
      const radius = 21 + Math.pow(rand(), 0.75) * 36;
      const p = i * 3;
      beaconPositions[p] = Math.cos(a) * radius;
      beaconPositions[p + 1] = (rand() - 0.5) * 21;
      beaconPositions[p + 2] = Math.sin(a) * radius * (0.38 + rand() * 0.16);
      TMP_COLOR.copy(rand() > 0.44 ? cyan : amber).lerp(violet, rand() > 0.82 ? 0.35 : 0);
      beaconColors[p] = TMP_COLOR.r;
      beaconColors[p + 1] = TMP_COLOR.g;
      beaconColors[p + 2] = TMP_COLOR.b;
      beaconSizes[i] = 0.7 + Math.pow(rand(), 2.5) * 4.2;
      beaconPhases[i] = rand() * 1000;
    }

    const beaconGeometry = new THREE.BufferGeometry();
    beaconGeometry.setAttribute("position", new THREE.BufferAttribute(beaconPositions, 3));
    beaconGeometry.setAttribute("aColor", new THREE.BufferAttribute(beaconColors, 3));
    beaconGeometry.setAttribute("aSize", new THREE.BufferAttribute(beaconSizes, 1));
    beaconGeometry.setAttribute("aPhase", new THREE.BufferAttribute(beaconPhases, 1));
    const beaconMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMap: { value: makeGlowTexture(128) }
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aPhase;
        uniform float uTime;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vCore;
        void main() {
          vColor = aColor;
          vec3 p = position;
          p.y += sin(uTime * 0.28 + aPhase) * 0.04;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          float depth = max(1.0, -mvPosition.z);
          float pulse = 0.66 + 0.34 * sin(uTime * (0.72 + fract(aPhase) * 1.8) + aPhase);
          vCore = smoothstep(2.6, 4.9, aSize);
          vAlpha = pulse * (0.5 + fract(aPhase) * 0.5);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(aSize * (220.0 / depth), 0.8, 10.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vCore;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float cross = max(smoothstep(0.018, 0.0, abs(uv.x)) * smoothstep(0.5, 0.03, abs(uv.y)), smoothstep(0.018, 0.0, abs(uv.y)) * smoothstep(0.5, 0.03, abs(uv.x))) * vCore;
          float alpha = (tex.a * 0.58 + cross * 0.2) * vAlpha;
          if (alpha < 0.004) discard;
          vec3 color = mix(vColor, vec3(1.0, 0.92, 0.72), tex.a * 0.38 + cross * 0.28);
          gl_FragColor = vec4(color * (0.62 + tex.a * 1.4 + cross), clamp(alpha, 0.0, 0.8));
        }
      `
    });
    this.animatedMaterials.push(beaconMaterial);
    const beacons = new THREE.Points(beaconGeometry, beaconMaterial);
    beacons.renderOrder = 9;
    beacons.frustumCulled = false;
    group.add(beacons);

    const lightA = new THREE.PointLight(0x33e7c8, 16, 56, 2.1);
    lightA.position.set(-11, 4, 8);
    group.add(lightA);
    const lightB = new THREE.PointLight(0xffb86f, 11, 48, 2.2);
    lightB.position.set(13, -3, -5);
    group.add(lightB);

    this.enableHighDetailShadows(group);
    group.userData.particleBudget = panelCount + trussCount + ringSpecs.length * 3 * 180 + curtainCount * 48 + beaconCount;
  }

  private createPrismaticScatteringField(): void {
    if (this.quality.label !== "HIGH" || this.quality.mobile || this.quality.reducedMotion) return;

    const group = new THREE.Group();
    group.position.set(8, 1.5, -28);
    group.rotation.set(-0.04, 0.18, 0.02);
    group.userData.particleBudget = 0;
    group.renderOrder = 10;
    this.prismaticScatteringField = group;
    this.scene.add(group);

    const rand = rng(884211);
    const cyan = new THREE.Color(0x33e7c8);
    const magenta = new THREE.Color(0xff5c9d);
    const amber = new THREE.Color(0xffd98a);
    const blue = new THREE.Color(0x8fb8ff);

    const prismCount = 128;
    const prismGeometry = new THREE.CircleGeometry(1, 3);
    prismGeometry.rotateZ(Math.PI / 6);
    const prismMaterial = new THREE.MeshStandardMaterial({
      color: 0xdffcff,
      roughness: 0.08,
      metalness: 0.18,
      emissive: 0x16343d,
      emissiveIntensity: 0.16,
      envMapIntensity: 2.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.26,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false
    });
    const prisms = new THREE.InstancedMesh(prismGeometry, prismMaterial, prismCount);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (let i = 0; i < prismCount; i += 1) {
      const nearCore = rand() < 0.64;
      const angle = rand() * Math.PI * 2;
      const radius = nearCore ? 16 + Math.pow(rand(), 0.7) * 48 : 42 + Math.pow(rand(), 0.8) * 82;
      dummy.position.set(
        13 + Math.cos(angle) * radius,
        (rand() - 0.5) * (nearCore ? 28 : 64) + Math.sin(angle * 1.7) * 3.5,
        -38 + Math.sin(angle) * radius * (nearCore ? 0.38 : 0.62) - rand() * (nearCore ? 28 : 82)
      );
      dummy.lookAt(21 + (rand() - 0.5) * 8, (rand() - 0.5) * 5, -38 + (rand() - 0.5) * 8);
      dummy.rotateZ(rand() * Math.PI * 2);
      dummy.rotateY((rand() - 0.5) * 0.8);
      const scale = nearCore ? 0.5 + Math.pow(rand(), 1.4) * 3.7 : 0.9 + Math.pow(rand(), 1.2) * 6.4;
      dummy.scale.set(scale * (0.65 + rand() * 1.8), scale * (0.38 + rand() * 1.2), 1);
      dummy.updateMatrix();
      prisms.setMatrixAt(i, dummy.matrix);
      color.copy(rand() > 0.5 ? cyan : magenta).lerp(rand() > 0.58 ? amber : blue, 0.18 + rand() * 0.42);
      if (rand() > 0.86) color.lerp(new THREE.Color(0xffffff), 0.42);
      prisms.setColorAt(i, color);
    }
    prisms.instanceMatrix.needsUpdate = true;
    if (prisms.instanceColor) prisms.instanceColor.needsUpdate = true;
    prisms.renderOrder = 10;
    group.add(prisms);

    const bandCount = 20;
    for (let i = 0; i < bandCount; i += 1) {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uSeed: { value: rand() * 1000 },
          uColorA: { value: (rand() > 0.5 ? cyan : magenta).clone() },
          uColorB: { value: (rand() > 0.5 ? amber : blue).clone() },
          uAlpha: { value: 0.055 + rand() * 0.055 }
        },
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: false,
        vertexShader: `
          uniform float uTime;
          uniform float uSeed;
          varying vec2 vUv;
          varying float vWave;
          void main() {
            vUv = uv;
            vec3 p = position;
            float wave = sin(uv.x * 10.0 + uTime * 0.34 + uSeed) * 0.5 + 0.5;
            p.y += (wave - 0.5) * 0.18;
            p.z += sin(uv.x * 6.0 + uSeed) * 0.08;
            vWave = wave;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uSeed;
          uniform float uAlpha;
          uniform vec3 uColorA;
          uniform vec3 uColorB;
          varying vec2 vUv;
          varying float vWave;
          void main() {
            float feather = smoothstep(0.0, 0.12, vUv.x) * (1.0 - smoothstep(0.88, 1.0, vUv.x));
            feather *= smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.82, 1.0, vUv.y));
            float spectral = pow(sin(vUv.x * 38.0 - uTime * 0.52 + uSeed) * 0.5 + 0.5, 5.0);
            float thread = smoothstep(0.82, 1.0, sin((vUv.x - vUv.y) * 28.0 + uSeed) * 0.5 + 0.5);
            float alpha = feather * (spectral * 0.84 + thread * 0.28 + vWave * 0.18) * uAlpha;
            if (alpha < 0.003) discard;
            vec3 color = mix(uColorA, uColorB, vUv.x + spectral * 0.18);
            gl_FragColor = vec4(color * (0.62 + spectral * 1.55), clamp(alpha, 0.0, 0.22));
          }
        `
      });
      this.animatedMaterials.push(material);
      const width = 22 + rand() * 54;
      const height = 1.8 + rand() * 5.2;
      const band = new THREE.Mesh(new THREE.PlaneGeometry(width, height, 16, 3), material);
      const angle = rand() * Math.PI * 2;
      const radius = 18 + Math.pow(rand(), 0.72) * 74;
      band.position.set(16 + Math.cos(angle) * radius, (rand() - 0.5) * 34, -42 + Math.sin(angle) * radius * 0.45 - rand() * 68);
      band.lookAt(21, 0, -38);
      band.rotateZ((rand() - 0.5) * 0.9);
      band.userData.spin = (rand() > 0.5 ? 1 : -1) * (0.001 + rand() * 0.0028);
      band.userData.phase = rand() * 1000;
      band.renderOrder = 11;
      group.add(band);
    }

    const flareCount = 520;
    const positions = new Float32Array(flareCount * 3);
    const colors = new Float32Array(flareCount * 3);
    const sizes = new Float32Array(flareCount);
    const phases = new Float32Array(flareCount);
    for (let i = 0; i < flareCount; i += 1) {
      const p = i * 3;
      const angle = rand() * Math.PI * 2;
      const radius = 14 + Math.pow(rand(), 0.58) * 74;
      positions[p] = 17 + Math.cos(angle) * radius + (rand() - 0.5) * 5;
      positions[p + 1] = (rand() - 0.5) * (10 + radius * 0.48);
      positions[p + 2] = -39 + Math.sin(angle) * radius * (0.32 + rand() * 0.28) - rand() * 70;
      TMP_COLOR.copy(rand() > 0.45 ? cyan : magenta).lerp(rand() > 0.5 ? amber : blue, 0.22 + rand() * 0.38);
      colors[p] = TMP_COLOR.r;
      colors[p + 1] = TMP_COLOR.g;
      colors[p + 2] = TMP_COLOR.b;
      sizes[i] = 0.35 + Math.pow(rand(), 3.2) * 5.5;
      phases[i] = rand() * 1000;
    }

    const flareGeometry = new THREE.BufferGeometry();
    flareGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    flareGeometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    flareGeometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    flareGeometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    const flareMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMap: { value: makeGlowTexture(128) }
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aPhase;
        uniform float uTime;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSpike;
        void main() {
          vColor = aColor;
          vec3 p = position;
          p.x += sin(uTime * 0.12 + aPhase) * 0.2;
          p.y += cos(uTime * 0.1 + aPhase * 1.3) * 0.14;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          float depth = max(1.0, -mvPosition.z);
          float fade = smoothstep(8.0, 26.0, depth) * (1.0 - smoothstep(155.0, 250.0, depth));
          float pulse = 0.64 + 0.36 * sin(uTime * (0.74 + fract(aPhase) * 1.5) + aPhase);
          vAlpha = fade * pulse * (0.44 + fract(aPhase) * 0.56);
          vSpike = smoothstep(3.6, 5.7, aSize);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(aSize * (255.0 / depth), 0.8, 10.5);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSpike;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float cross = max(smoothstep(0.014, 0.0, abs(uv.x)) * smoothstep(0.5, 0.03, abs(uv.y)), smoothstep(0.014, 0.0, abs(uv.y)) * smoothstep(0.5, 0.03, abs(uv.x))) * vSpike;
          float alpha = (tex.a * 0.52 + cross * 0.14) * vAlpha;
          if (alpha < 0.004) discard;
          vec3 color = mix(vColor, vec3(1.0, 0.95, 0.78), tex.a * 0.32 + cross * 0.25);
          gl_FragColor = vec4(color * (0.58 + tex.a * 1.42 + cross), clamp(alpha, 0.0, 0.76));
        }
      `
    });
    this.animatedMaterials.push(flareMaterial);
    const flares = new THREE.Points(flareGeometry, flareMaterial);
    flares.renderOrder = 12;
    flares.frustumCulled = false;
    group.add(flares);

    group.userData.particleBudget = prismCount + bandCount * 64 + flareCount;
  }

  private createCameraDepthField(): void {
    if (this.quality.label !== "HIGH" || this.quality.mobile) return;

    const group = new THREE.Group();
    group.position.copy(this.camera.position);
    group.renderOrder = 5;
    this.cameraDepthField = group;
    this.scene.add(group);

    const rand = rng(7447);
    const dustCount = 1800;
    const positions = new Float32Array(dustCount * 3);
    const colors = new Float32Array(dustCount * 3);
    const sizes = new Float32Array(dustCount);
    const seeds = new Float32Array(dustCount);

    for (let i = 0; i < dustCount; i += 1) {
      const lane = rand() > 0.54 ? 1 : -1;
      const depth = -92 + Math.pow(rand(), 0.72) * 126;
      const sideBias = Math.sin(i * 2.399 + rand() * 0.8) * 18 * lane;
      positions[i * 3] = (rand() - 0.5) * 84 + sideBias;
      positions[i * 3 + 1] = (rand() - 0.5) * 52 + Math.sin(i * 0.37) * 4;
      positions[i * 3 + 2] = depth;
      TMP_COLOR.setHSL(rand() > 0.72 ? 0.1 + rand() * 0.05 : 0.51 + rand() * 0.08, 0.64 + rand() * 0.28, 0.55 + rand() * 0.3);
      colors[i * 3] = TMP_COLOR.r;
      colors[i * 3 + 1] = TMP_COLOR.g;
      colors[i * 3 + 2] = TMP_COLOR.b;
      sizes[i] = 0.28 + Math.pow(rand(), 3.0) * 3.8;
      seeds[i] = rand() * 1000;
    }

    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    dustGeometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    dustGeometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    dustGeometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));

    const dustMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aSeed;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uTime;
        void main() {
          vColor = aColor;
          vec3 p = position;
          p.x += sin(uTime * 0.19 + aSeed) * 0.34;
          p.y += cos(uTime * 0.16 + aSeed * 1.7) * 0.24;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          float depth = max(1.0, -mvPosition.z);
          float nearFade = smoothstep(4.0, 18.0, depth);
          float farFade = 1.0 - smoothstep(94.0, 146.0, depth);
          vAlpha = nearFade * farFade * (0.32 + fract(aSeed) * 0.68);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(aSize * (220.0 / depth), 0.85, 9.0);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 uv = gl_PointCoord.xy - 0.5;
          float d = length(uv);
          float core = smoothstep(0.26, 0.0, d);
          float halo = smoothstep(0.5, 0.05, d) * 0.34;
          float alpha = (core * 0.54 + halo) * vAlpha;
          if (d > 0.5 || alpha < 0.006) discard;
          gl_FragColor = vec4(vColor * (0.45 + core * 0.85), clamp(alpha, 0.0, 0.58));
        }
      `
    });
    this.animatedMaterials.push(dustMaterial);
    group.add(new THREE.Points(dustGeometry, dustMaterial));

    const shardCount = 96;
    const shardGeometry = new THREE.IcosahedronGeometry(0.58, 1);
    const shardMaterial = new THREE.MeshStandardMaterial({
      color: 0xb6fff1,
      roughness: 0.72,
      metalness: 0.18,
      emissive: 0x123a3f,
      emissiveIntensity: 0.16,
      envMapIntensity: 0.9,
      vertexColors: true,
      transparent: true,
      opacity: 0.56,
      depthWrite: false
    });
    const shards = new THREE.InstancedMesh(shardGeometry, shardMaterial, shardCount);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (let i = 0; i < shardCount; i += 1) {
      const depth = -78 + Math.pow(rand(), 0.82) * 92;
      const side = (rand() - 0.5) * 88;
      dummy.position.set(side, (rand() - 0.5) * 46, depth);
      dummy.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
      const scale = 0.18 + Math.pow(rand(), 2.0) * 0.95;
      dummy.scale.set(scale * (0.65 + rand() * 1.9), scale * (0.55 + rand() * 1.4), scale * (0.55 + rand() * 1.5));
      dummy.updateMatrix();
      shards.setMatrixAt(i, dummy.matrix);
      color.setHSL(rand() > 0.7 ? 0.09 : 0.5 + rand() * 0.08, 0.5 + rand() * 0.24, 0.38 + rand() * 0.26);
      shards.setColorAt(i, color);
    }
    shards.instanceMatrix.needsUpdate = true;
    if (shards.instanceColor) shards.instanceColor.needsUpdate = true;
    shards.renderOrder = 4;
    group.add(shards);

    const wakeCount = 1280;
    const wakePositions = new Float32Array(wakeCount * 2 * 3);
    const wakeColors = new Float32Array(wakeCount * 2 * 3);
    const wakeSeeds = new Float32Array(wakeCount * 2);
    const wakeAlphas = new Float32Array(wakeCount * 2);
    for (let i = 0; i < wakeCount; i += 1) {
      const lane = rand() > 0.5 ? 1 : -1;
      const edge = Math.pow(rand(), 0.62);
      const z = -18 - Math.pow(rand(), 0.7) * 126;
      const length = 2.8 + Math.pow(rand(), 1.8) * 10.5;
      const slope = (rand() - 0.5) * 1.6;
      const x = lane * (18 + edge * 58) + (rand() - 0.5) * 12;
      const y = (rand() - 0.5) * (34 + edge * 34);
      TMP_COLOR.setHSL(rand() > 0.7 ? 0.095 + rand() * 0.035 : 0.51 + rand() * 0.09, 0.58 + rand() * 0.26, 0.52 + rand() * 0.28);
      const alpha = 0.08 + Math.pow(rand(), 2.2) * 0.34;
      const seed = rand() * 1000;
      for (let end = 0; end < 2; end += 1) {
        const p = (i * 2 + end) * 3;
        const t = end === 0 ? -0.5 : 0.5;
        wakePositions[p] = x + lane * t * (length * 0.46);
        wakePositions[p + 1] = y + t * slope;
        wakePositions[p + 2] = z + t * length;
        wakeColors[p] = TMP_COLOR.r;
        wakeColors[p + 1] = TMP_COLOR.g;
        wakeColors[p + 2] = TMP_COLOR.b;
        wakeSeeds[i * 2 + end] = seed;
        wakeAlphas[i * 2 + end] = alpha;
      }
    }

    const wakeGeometry = new THREE.BufferGeometry();
    wakeGeometry.setAttribute("position", new THREE.BufferAttribute(wakePositions, 3));
    wakeGeometry.setAttribute("aColor", new THREE.BufferAttribute(wakeColors, 3));
    wakeGeometry.setAttribute("aSeed", new THREE.BufferAttribute(wakeSeeds, 1));
    wakeGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(wakeAlphas, 1));
    const wakeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSeed;
        attribute float aAlpha;
        uniform float uTime;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vec3 p = position;
          p.x += sin(uTime * 0.17 + aSeed) * 0.32;
          p.y += cos(uTime * 0.13 + aSeed * 1.37) * 0.22;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          float depth = max(1.0, -mvPosition.z);
          float nearFade = smoothstep(7.0, 24.0, depth);
          float farFade = 1.0 - smoothstep(116.0, 166.0, depth);
          float sidePulse = 0.72 + sin(uTime * (0.34 + fract(aSeed) * 0.28) + aSeed) * 0.28;
          vec4 clipPosition = projectionMatrix * mvPosition;
          vec2 ndc = clipPosition.xy / max(abs(clipPosition.w), 0.0001);
          float edgeMask = smoothstep(0.16, 0.7, length(ndc * vec2(1.05, 1.0)));
          vAlpha = aAlpha * nearFade * farFade * sidePulse * edgeMask;
          gl_Position = clipPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          if (vAlpha < 0.006) discard;
          gl_FragColor = vec4(vColor * 1.35, clamp(vAlpha, 0.0, 0.48));
        }
      `
    });
    this.animatedMaterials.push(wakeMaterial);
    const wake = new THREE.LineSegments(wakeGeometry, wakeMaterial);
    wake.renderOrder = 5;
    wake.frustumCulled = false;
    group.add(wake);

    const glyphCount = 12;
    for (let i = 0; i < glyphCount; i += 1) {
      const seed = rand() * 1000;
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uSeed: { value: seed },
          uColorA: { value: new THREE.Color(rand() > 0.55 ? 0x33e7c8 : 0xffb46f) },
          uColorB: { value: new THREE.Color(rand() > 0.5 ? 0x88a8ff : 0xff6aa8) },
          uAlpha: { value: 0.08 + rand() * 0.12 }
        },
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: false,
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uSeed;
          uniform float uAlpha;
          uniform vec3 uColorA;
          uniform vec3 uColorB;
          varying vec2 vUv;

          float hash(float n) {
            return fract(sin(n) * 43758.5453123);
          }

          void main() {
            vec2 uv = vUv - 0.5;
            uv.x *= 1.35;
            float d = length(uv);
            float angle = atan(uv.y, uv.x);
            float ringA = 1.0 - smoothstep(0.0, 0.008, abs(d - 0.34));
            float ringB = 1.0 - smoothstep(0.0, 0.006, abs(d - 0.22));
            float dashA = smoothstep(0.42, 0.95, sin(angle * 10.0 + uSeed + uTime * 0.13) * 0.5 + 0.5);
            float dashB = smoothstep(0.5, 0.97, sin(angle * 17.0 - uSeed * 0.31 - uTime * 0.21) * 0.5 + 0.5);
            float spoke = max(
              smoothstep(0.012, 0.0, abs(uv.x)) * smoothstep(0.32, 0.08, abs(uv.y)),
              smoothstep(0.012, 0.0, abs(uv.y)) * smoothstep(0.32, 0.08, abs(uv.x))
            ) * 0.18;
            float shimmer = 0.78 + hash(floor((angle + 3.14159) * 16.0) + floor(uTime * 6.0) + uSeed) * 0.22;
            float alpha = (ringA * dashA + ringB * dashB * 0.72 + spoke) * uAlpha * shimmer;
            if (d > 0.5 || alpha < 0.004) discard;
            vec3 color = mix(uColorA, uColorB, smoothstep(0.16, 0.42, d));
            gl_FragColor = vec4(color * (0.8 + alpha * 3.2), clamp(alpha, 0.0, 0.28));
          }
        `
      });
      this.animatedMaterials.push(material);
      const glyph = new THREE.Mesh(new THREE.PlaneGeometry(14 + rand() * 26, 14 + rand() * 26, 1, 1), material);
      const side = rand() > 0.5 ? 1 : -1;
      glyph.position.set(side * (28 + rand() * 48), -22 + rand() * 50, -34 - rand() * 94);
      glyph.rotation.set(-0.08 + (rand() - 0.5) * 0.32, side * (0.36 + rand() * 0.54), rand() * Math.PI * 2);
      glyph.userData.spin = side * (0.0012 + rand() * 0.0028);
      glyph.userData.phase = seed;
      glyph.renderOrder = 6;
      group.add(glyph);
    }

    group.userData.particleBudget = dustCount + shardCount + wakeCount + glyphCount * 96;
  }

  private createForegroundRelicField(): void {
    if (this.quality.label !== "HIGH" || this.quality.mobile) return;

    const group = new THREE.Group();
    group.position.copy(this.camera.position);
    group.rotation.set(-0.05, 0.08, 0.02);
    group.userData.particleBudget = 0;
    group.renderOrder = 9;
    this.foregroundRelicField = group;
    this.scene.add(group);

    const rand = rng(619733);
    const cyan = new THREE.Color(0x33e7c8);
    const amber = new THREE.Color(0xffc27a);
    const steel = new THREE.Color(0x9fafb9);

    const ribMaterial = new THREE.MeshStandardMaterial({
      color: 0x8c9aa5,
      roughness: 0.3,
      metalness: 0.82,
      emissive: 0x061118,
      emissiveIntensity: 0.08,
      envMapIntensity: 1.65,
      transparent: true,
      opacity: 0.86
    });

    const ribCount = 14;
    for (let i = 0; i < ribCount; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      const radius = 8.5 + Math.pow(rand(), 1.2) * 17;
      const tube = 0.055 + rand() * 0.12;
      const arc = Math.PI * (0.38 + rand() * 0.82);
      const material = ribMaterial.clone();
      material.color.copy(steel).lerp(rand() > 0.5 ? cyan : amber, 0.12 + rand() * 0.18);
      material.emissive.copy(rand() > 0.55 ? cyan : amber);
      material.emissiveIntensity = 0.025 + rand() * 0.065;
      const rib = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, 120, arc), material);
      rib.position.set(side * (26 + rand() * 30), -18 + rand() * 43, -42 - rand() * 96);
      rib.rotation.set(0.86 + (rand() - 0.5) * 0.8, side * (0.42 + rand() * 0.9), rand() * Math.PI * 2);
      rib.scale.set(1, 0.58 + rand() * 0.48, 1);
      rib.userData.spin = side * (0.001 + rand() * 0.0025);
      rib.userData.phase = rand() * 1000;
      rib.renderOrder = 8;
      group.add(rib);
    }

    const panelCount = 176;
    const panelGeometry = new THREE.BoxGeometry(1, 0.045, 0.54);
    const panelMaterial = new THREE.MeshStandardMaterial({
      color: 0x71818c,
      roughness: 0.36,
      metalness: 0.72,
      emissive: 0x061016,
      emissiveIntensity: 0.08,
      envMapIntensity: 1.55,
      vertexColors: true
    });
    const panels = new THREE.InstancedMesh(panelGeometry, panelMaterial, panelCount);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (let i = 0; i < panelCount; i += 1) {
      const side = rand() > 0.5 ? 1 : -1;
      const near = rand() > 0.58;
      const z = near ? -24 - rand() * 64 : -72 - rand() * 92;
      const edgeBias = Math.pow(rand(), 0.72);
      dummy.position.set(side * (18 + edgeBias * 54), (rand() - 0.5) * (near ? 48 : 70), z);
      dummy.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
      dummy.rotateY(side * (0.45 + rand() * 0.8));
      const scale = near ? 0.8 + rand() * 3.6 : 0.35 + rand() * 2.2;
      dummy.scale.set(scale * (1.3 + rand() * 3.4), scale * (0.58 + rand() * 1.4), scale * (0.5 + rand() * 1.5));
      dummy.updateMatrix();
      panels.setMatrixAt(i, dummy.matrix);
      color.copy(steel).lerp(rand() > 0.56 ? cyan : amber, 0.08 + rand() * 0.32);
      if (rand() > 0.9) color.lerp(new THREE.Color(0xffffff), 0.26);
      panels.setColorAt(i, color);
    }
    panels.instanceMatrix.needsUpdate = true;
    if (panels.instanceColor) panels.instanceColor.needsUpdate = true;
    panels.renderOrder = 7;
    group.add(panels);

    const cableMaterial = new THREE.MeshStandardMaterial({
      color: 0x33404a,
      roughness: 0.52,
      metalness: 0.68,
      emissive: 0x041018,
      emissiveIntensity: 0.18,
      envMapIntensity: 1.1
    });
    const cableCount = 18;
    for (let i = 0; i < cableCount; i += 1) {
      const side = rand() > 0.5 ? 1 : -1;
      const y = -28 + rand() * 58;
      const z = -34 - rand() * 118;
      const points: THREE.Vector3[] = [];
      for (let j = 0; j < 5; j += 1) {
        const t = j / 4;
        points.push(new THREE.Vector3(
          side * (20 + t * (22 + rand() * 35)) + Math.sin(t * Math.PI + i) * 4.6,
          y + Math.sin(t * Math.PI * 1.5 + i) * (5 + rand() * 6),
          z - t * (16 + rand() * 52)
        ));
      }
      const material = cableMaterial.clone();
      material.emissive.copy(rand() > 0.52 ? cyan : amber);
      material.emissiveIntensity = 0.025 + rand() * 0.08;
      const cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, "centripetal", 0.42), 58, 0.035 + rand() * 0.07, 6, false), material);
      cable.userData.spin = side * (0.0008 + rand() * 0.0018);
      cable.userData.phase = rand() * 1000;
      cable.renderOrder = 7;
      group.add(cable);
    }

    const beaconCount = 180;
    const positions = new Float32Array(beaconCount * 3);
    const colors = new Float32Array(beaconCount * 3);
    const sizes = new Float32Array(beaconCount);
    const phases = new Float32Array(beaconCount);
    for (let i = 0; i < beaconCount; i += 1) {
      const side = rand() > 0.5 ? 1 : -1;
      const near = rand() > 0.45;
      const p = i * 3;
      positions[p] = side * (16 + Math.pow(rand(), 0.8) * 60);
      positions[p + 1] = (rand() - 0.5) * (near ? 44 : 72);
      positions[p + 2] = near ? -28 - rand() * 70 : -86 - rand() * 104;
      TMP_COLOR.copy(rand() > 0.58 ? cyan : amber).lerp(new THREE.Color(0xffffff), rand() > 0.88 ? 0.35 : 0.04);
      colors[p] = TMP_COLOR.r;
      colors[p + 1] = TMP_COLOR.g;
      colors[p + 2] = TMP_COLOR.b;
      sizes[i] = 0.5 + Math.pow(rand(), 2.4) * (near ? 4.8 : 2.6);
      phases[i] = rand() * 1000;
    }

    const beaconGeometry = new THREE.BufferGeometry();
    beaconGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    beaconGeometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    beaconGeometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    beaconGeometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    const beaconMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMap: { value: makeGlowTexture(128) }
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aPhase;
        uniform float uTime;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSpike;
        void main() {
          vColor = aColor;
          vec3 p = position;
          p.x += sin(uTime * 0.11 + aPhase) * 0.12;
          p.y += cos(uTime * 0.09 + aPhase * 1.4) * 0.1;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          float depth = max(1.0, -mvPosition.z);
          float pulse = 0.62 + 0.38 * sin(uTime * (0.8 + fract(aPhase) * 1.8) + aPhase);
          vSpike = smoothstep(3.2, 5.0, aSize);
          vAlpha = pulse * (0.42 + fract(aPhase) * 0.58);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(aSize * (250.0 / depth), 0.8, 11.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSpike;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float cross = max(smoothstep(0.018, 0.0, abs(uv.x)) * smoothstep(0.5, 0.03, abs(uv.y)), smoothstep(0.018, 0.0, abs(uv.y)) * smoothstep(0.5, 0.03, abs(uv.x))) * vSpike;
          float alpha = (tex.a * 0.56 + cross * 0.16) * vAlpha;
          if (alpha < 0.004) discard;
          vec3 color = mix(vColor, vec3(1.0, 0.92, 0.72), tex.a * 0.32 + cross * 0.22);
          gl_FragColor = vec4(color * (0.58 + tex.a * 1.42 + cross * 0.8), clamp(alpha, 0.0, 0.76));
        }
      `
    });
    this.animatedMaterials.push(beaconMaterial);
    const beacons = new THREE.Points(beaconGeometry, beaconMaterial);
    beacons.frustumCulled = false;
    beacons.renderOrder = 9;
    group.add(beacons);

    const localLightA = new THREE.PointLight(0x33e7c8, 9, 34, 2.1);
    localLightA.position.set(32, -8, -52);
    group.add(localLightA);
    const localLightB = new THREE.PointLight(0xffb26d, 7, 32, 2.2);
    localLightB.position.set(-34, 10, -72);
    group.add(localLightB);

    this.enableHighDetailShadows(group);
    group.userData.particleBudget = ribCount * 120 + panelCount + cableCount * 58 + beaconCount;
  }

  private createLensDustField(): void {
    if (this.quality.label !== "HIGH" || this.quality.mobile || this.quality.reducedMotion) return;

    const count = 360;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const alphas = new Float32Array(count);
    const rand = rng(44771);

    for (let i = 0; i < count; i += 1) {
      const z = -12 - Math.pow(rand(), 0.62) * 46;
      const radius = Math.pow(rand(), 0.78);
      const angle = rand() * Math.PI * 2;
      const oval = 1.0 + Math.pow(rand(), 2.4) * 2.8;
      const p = i * 3;
      positions[p] = Math.cos(angle) * radius * 42 * oval;
      positions[p + 1] = Math.sin(angle) * radius * 22 + (rand() - 0.5) * 7;
      positions[p + 2] = z;
      const warm = rand() > 0.72;
      TMP_COLOR.setHSL(warm ? 0.095 + rand() * 0.035 : 0.52 + rand() * 0.08, 0.48 + rand() * 0.24, 0.62 + rand() * 0.22);
      colors[p] = TMP_COLOR.r;
      colors[p + 1] = TMP_COLOR.g;
      colors[p + 2] = TMP_COLOR.b;
      sizes[i] = 0.48 + Math.pow(rand(), 4.6) * 11.5;
      phases[i] = rand() * 1000;
      alphas[i] = 0.045 + Math.pow(rand(), 2.2) * 0.22;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aPhase;
        attribute float aAlpha;
        uniform float uTime;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vRing;
        void main() {
          vColor = aColor;
          vec3 p = position;
          p.x += sin(uTime * 0.23 + aPhase) * (0.18 + fract(aPhase) * 0.46);
          p.y += cos(uTime * 0.19 + aPhase * 1.63) * (0.12 + fract(aPhase * 0.71) * 0.34);
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          float depth = max(1.0, -mvPosition.z);
          float edge = smoothstep(56.0, 14.0, length(p.xy));
          float nearFade = smoothstep(3.0, 10.0, depth);
          float farFade = 1.0 - smoothstep(56.0, 64.0, depth);
          float pulse = 0.72 + 0.28 * sin(uTime * (0.7 + fract(aPhase) * 2.1) + aPhase);
          vAlpha = aAlpha * edge * nearFade * farFade * pulse;
          vRing = smoothstep(7.0, 18.0, aSize);
          gl_PointSize = clamp(aSize * (235.0 / depth), 0.65, 24.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        varying float vRing;
        void main() {
          vec2 uv = gl_PointCoord.xy - 0.5;
          float d = length(uv);
          if (d > 0.5) discard;
          float core = smoothstep(0.22, 0.0, d);
          float halo = smoothstep(0.5, 0.06, d) * 0.38;
          float ring = smoothstep(0.24, 0.35, d) * (1.0 - smoothstep(0.35, 0.48, d));
          float star = max(smoothstep(0.022, 0.0, abs(uv.x)) * smoothstep(0.5, 0.02, abs(uv.y)), smoothstep(0.022, 0.0, abs(uv.y)) * smoothstep(0.5, 0.02, abs(uv.x)));
          float alpha = (core * 0.48 + halo * 0.72 + ring * vRing * 0.18 + star * 0.09) * vAlpha;
          if (alpha < 0.005) discard;
          vec3 color = vColor * (0.36 + core * 0.72 + ring * 0.28 + star * 0.72);
          gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.36));
        }
      `
    });

    this.lensDustField = new THREE.Points(geometry, material);
    this.lensDustField.renderOrder = 9;
    this.lensDustField.frustumCulled = false;
    this.scene.add(this.lensDustField);
  }

  private createBlackHole(): void {
    const group = new THREE.Group();
    group.position.set(21, 0, -38);
    group.rotation.set(0.04, -0.14, 0.02);
    group.scale.setScalar(this.quality.label === "LOW" ? 1 : 1.55);
    this.scene.add(group);

    const low = this.quality.label === "LOW";
    const inner = low ? 3.8 : 5.0;
    const outer = low ? 10.8 : 19.4;
    const diskMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uInner: { value: inner },
        uOuter: { value: outer },
        uColorA: { value: new THREE.Color(0xffd98a) },
        uColorB: { value: new THREE.Color(0xff7a92) },
        uColorC: { value: new THREE.Color(0x33e7c8) },
        uLow: { value: low ? 1 : 0 }
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        varying vec2 vLocal;
        varying float vRadius;
        void main() {
          vLocal = position.xy;
          vRadius = length(position.xy);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uInner;
        uniform float uOuter;
        uniform float uLow;
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform vec3 uColorC;
        varying vec2 vLocal;
        varying float vRadius;
        float hash(float n) { return fract(sin(n) * 43758.5453123); }
        void main() {
          float ring = smoothstep(uInner, uInner + 0.8, vRadius) * (1.0 - smoothstep(uOuter - 2.4, uOuter, vRadius));
          float angle = atan(vLocal.y, vLocal.x);
          float radial = clamp((vRadius - uInner) / max(0.001, (uOuter - uInner)), 0.0, 1.0);
          float shear = angle * 1.4 + radial * 8.2 - uTime * (1.0 - uLow * 0.45);
          float filamentA = pow(sin(shear * 5.0 + sin(radial * 20.0) * 0.8) * 0.5 + 0.5, 2.8);
          float filamentB = pow(sin(shear * 11.0 - radial * 13.0 + uTime * 0.42) * 0.5 + 0.5, 5.0);
          float grain = hash(floor(angle * 42.0) + floor(radial * 72.0) * 11.0);
          float streak = max(filamentA * 0.74, filamentB * 0.92) * (0.86 + grain * 0.18);
          float hot = 1.0 - smoothstep(0.0, 0.58, radial);
          float rim = smoothstep(0.62, 1.0, radial);
          float doppler = 0.72 + smoothstep(-0.65, 0.9, cos(angle - 0.24)) * 0.42;
          vec3 whiteHot = vec3(1.0, 0.92, 0.74);
          vec3 amber = uColorA;
          vec3 magenta = uColorB;
          vec3 cyan = uColorC;
          vec3 color = mix(magenta, amber, hot);
          color = mix(color, whiteHot, pow(hot, 3.0) * 0.68);
          color = mix(color, cyan, rim * 0.22);
          float verticalCut = 0.52 + 0.48 * (1.0 - smoothstep(0.42, 1.0, abs(vLocal.y) / max(1.0, uOuter)));
          float alpha = ring * verticalCut * doppler * (0.14 + streak * (0.5 - uLow * 0.18));
          gl_FragColor = vec4(color * doppler * (0.48 + streak * 1.02 + hot * 0.42), alpha);
        }
      `
    });
    const disk = new THREE.Mesh(
      new THREE.RingGeometry(inner, outer, low ? 96 : 256, low ? 5 : 12),
      diskMaterial
    );
    disk.rotation.set(1.3, 0.08, -0.12);
    disk.renderOrder = 1;
    group.add(disk);

    if (!low) {
      const accretionMaterial = new THREE.SpriteMaterial({
        map: makeAccretionTexture(2048, 1024),
        color: 0xffffff,
        opacity: 0.44,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending
      });
      const accretionGlow = new THREE.Sprite(
        accretionMaterial
      );
      accretionGlow.scale.set(44, 22, 1);
      accretionGlow.renderOrder = 4;
      group.add(accretionGlow);
      this.loadTexture("assets/blackhole-accretion-v2.jpg", (texture) => {
        texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        accretionMaterial.map = texture;
        accretionMaterial.opacity = this.quality.label === "HIGH" ? 0.46 : 0.62;
        accretionMaterial.needsUpdate = true;
      });
    }

    const corona = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeGlowTexture(512),
        color: 0xffc27a,
        opacity: low ? 0.32 : 0.55,
        transparent: true,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending
      })
    );
    corona.scale.set(low ? 19 : 31, low ? 19 : 31, 1);
    corona.renderOrder = 0;
    group.add(corona);

    const horizon = new THREE.Mesh(
      new THREE.SphereGeometry(low ? 3.75 : 4.85, low ? 36 : 72, low ? 20 : 40),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 1, depthTest: false, depthWrite: false, fog: false })
    );
    horizon.renderOrder = 32;
    group.add(horizon);

    const jets = low ? [] : this.createBlackHoleJets();
    jets.forEach((jet) => group.add(jet));
    const plume = low || this.quality.mobile ? undefined : this.createBlackHoleAccretionPlume(inner, outer);
    if (plume) group.add(plume);
    const debris = low ? undefined : this.createBlackHoleDebris(inner, outer);
    if (debris) group.add(debris);
    const photonCage = low ? undefined : this.createBlackHolePhotonCage();
    if (photonCage) group.add(photonCage);
    const caustics = low || this.quality.mobile ? undefined : this.createBlackHoleCaustics(inner, outer);
    if (caustics) group.add(caustics);
    const lensingArcs = low || this.quality.mobile || this.quality.reducedMotion ? undefined : this.createBlackHoleLensingArcs(inner, outer);
    if (lensingArcs) group.add(lensingArcs);
    const infall = low || this.quality.mobile || this.quality.reducedMotion ? undefined : this.createBlackHoleInfallField(inner, outer);
    if (infall) group.add(infall);
    const lensingStarfield = low || this.quality.mobile || this.quality.reducedMotion ? undefined : this.createBlackHoleLensingStarfield(inner, outer);
    if (lensingStarfield) group.add(lensingStarfield);
    const photonSheath = this.quality.label === "HIGH" && !this.quality.mobile && !this.quality.reducedMotion ? this.createBlackHolePhotonSheath(inner, outer) : undefined;
    if (photonSheath) group.add(photonSheath);
    const polarizationField = this.quality.label === "HIGH" && !this.quality.mobile && !this.quality.reducedMotion ? this.createBlackHolePolarizationField(inner, outer) : undefined;
    if (polarizationField) group.add(polarizationField);
    const accretionStructure = this.quality.label === "HIGH" && !this.quality.mobile && !this.quality.reducedMotion ? this.createBlackHoleAccretionStructure(inner, outer) : undefined;
    if (accretionStructure) group.add(accretionStructure);
    const rubbleHalo = this.quality.label === "HIGH" && !this.quality.mobile ? this.createBlackHoleRubbleHalo(inner, outer) : undefined;
    if (rubbleHalo) group.add(rubbleHalo);

    const portrait = low ? undefined : this.createBlackHolePortrait();
    if (portrait) {
      portrait.position.copy(group.position);
      this.scene.add(portrait);
    }

    let lensShell: THREE.Mesh | undefined;
    if (!low && !this.quality.mobile) {
      lensShell = new THREE.Mesh(
        new THREE.SphereGeometry(9.8, 72, 36),
        new THREE.ShaderMaterial({
          uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(0x8fffee) }
          },
          transparent: true,
          depthWrite: false,
          side: THREE.BackSide,
          blending: THREE.AdditiveBlending,
          fog: false,
          vertexShader: `
            varying vec3 vNormal;
            varying vec3 vWorld;
            void main() {
              vNormal = normalize(mat3(modelMatrix) * normal);
              vec4 wp = modelMatrix * vec4(position, 1.0);
              vWorld = wp.xyz;
              gl_Position = projectionMatrix * viewMatrix * wp;
            }
          `,
          fragmentShader: `
            uniform float uTime;
            uniform vec3 uColor;
            varying vec3 vNormal;
            varying vec3 vWorld;
            void main() {
              vec3 viewDir = normalize(cameraPosition - vWorld);
              float fres = pow(1.0 - abs(dot(normalize(vNormal), viewDir)), 2.15);
              float ripple = sin(length(vWorld.xz) * 2.2 - uTime * 0.8) * 0.5 + 0.5;
              gl_FragColor = vec4(uColor * (0.28 + ripple * 0.42), fres * 0.13);
            }
          `
        })
      );
      group.add(lensShell);

      for (const scalar of [1.0, 1.18, 1.42]) {
        const photon = new THREE.Mesh(
          new THREE.TorusGeometry(5.0 * scalar, scalar === 1 ? 0.075 : 0.045, 12, 240),
          new THREE.MeshBasicMaterial({
            color: scalar > 1.2 ? 0x33e7c8 : 0xffd98a,
            transparent: true,
            opacity: scalar > 1.2 ? 0.16 : 0.46,
            depthTest: false,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            fog: false
          })
        );
        photon.rotation.copy(disk.rotation);
        photon.renderOrder = 9;
        group.add(photon);
      }
    }

    this.blackHole = { group, disk, horizon, portrait, lensShell, corona, jets, debris, photonCage, plume, caustics, lensingArcs, infall, lensingStarfield, photonSheath, polarizationField, accretionStructure, rubbleHalo };
  }

  private createBlackHoleAccretionStructure(inner: number, outer: number): THREE.Group {
    const group = new THREE.Group();
    group.rotation.set(1.3, 0.08, -0.12);
    group.userData.particleBudget = 0;

    const shadowMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uInner: { value: inner * 0.82 },
        uOuter: { value: outer * 1.08 }
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      fog: false,
      vertexShader: `
        varying vec2 vLocal;
        varying float vRadius;
        void main() {
          vLocal = position.xy;
          vRadius = length(position.xy);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uInner;
        uniform float uOuter;
        varying vec2 vLocal;
        varying float vRadius;

        float hash(vec2 p) {
          p = fract(p * vec2(173.13, 927.41));
          p += dot(p, p + 23.71);
          return fract(p.x * p.y);
        }

        void main() {
          float radial = clamp((vRadius - uInner) / max(0.001, uOuter - uInner), 0.0, 1.0);
          float ring = smoothstep(uInner, uInner + 0.72, vRadius) * (1.0 - smoothstep(uOuter - 2.2, uOuter, vRadius));
          float angle = atan(vLocal.y, vLocal.x);
          float midLane = exp(-pow(vLocal.y / max(1.0, uOuter * 0.135), 2.0));
          float braid = sin(angle * 11.0 + radial * 18.0 - uTime * 0.64) * 0.5 + 0.5;
          float broken = smoothstep(0.24, 0.98, hash(floor(vec2(angle * 28.0, radial * 54.0))));
          float innerProtect = 1.0 - smoothstep(0.0, 0.42, radial);
          float alpha = ring * midLane * (0.14 + braid * 0.22 + broken * 0.1);
          alpha += ring * innerProtect * (0.11 + braid * 0.08);
          if (alpha < 0.01) discard;
          vec3 laneColor = mix(vec3(0.0, 0.002, 0.006), vec3(0.015, 0.022, 0.03), radial);
          gl_FragColor = vec4(laneColor, clamp(alpha, 0.0, 0.44));
        }
      `
    });
    const shadow = new THREE.Mesh(new THREE.RingGeometry(inner * 0.82, outer * 1.08, 320, 10), shadowMaterial);
    shadow.renderOrder = 30;
    group.add(shadow);
    this.animatedMaterials.push(shadowMaterial);
    group.userData.particleBudget += 320;

    const rand = rng(86621);
    const ribbonCount = 18;
    for (let i = 0; i < ribbonCount; i += 1) {
      const radius = inner * (0.96 + rand() * 0.32) + (outer - inner) * (0.18 + rand() * 0.72);
      const arcLength = Math.PI * (0.72 + rand() * 0.92);
      const start = rand() * Math.PI * 2;
      const lift = (rand() - 0.5) * 0.62;
      const sideScale = 0.46 + rand() * 0.18;
      const points: THREE.Vector3[] = [];
      const steps = 34;
      for (let j = 0; j < steps; j += 1) {
        const t = j / (steps - 1);
        const angle = start + arcLength * t;
        const ripple = Math.sin(t * Math.PI * 2.0 + i * 1.71) * (0.18 + rand() * 0.12);
        const r = radius + Math.sin(t * Math.PI * 3.0 + i) * (0.34 + rand() * 0.28);
        points.push(new THREE.Vector3(Math.cos(angle) * r, Math.sin(angle) * r * sideScale, lift + ripple));
      }
      const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.35);
      const tube = new THREE.TubeGeometry(curve, 96, 0.028 + rand() * 0.052, 7, false);
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColorA: { value: new THREE.Color(rand() > 0.58 ? 0xffd58a : 0xff6f9b) },
          uColorB: { value: new THREE.Color(rand() > 0.42 ? 0x35f4e1 : 0xfff0c6) },
          uAlpha: { value: 0.18 + rand() * 0.18 },
          uSeed: { value: rand() * 19.0 }
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: false,
        vertexShader: `
          varying vec2 vUv;
          varying float vDepth;
          void main() {
            vUv = uv;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vDepth = -mv.z;
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uAlpha;
          uniform float uSeed;
          uniform vec3 uColorA;
          uniform vec3 uColorB;
          varying vec2 vUv;
          varying float vDepth;

          void main() {
            float flow = fract(vUv.x * 3.6 - uTime * 0.18 + uSeed);
            float pulse = pow(sin((flow + vUv.y * 0.35) * 6.2831853) * 0.5 + 0.5, 3.2);
            float core = 1.0 - smoothstep(0.18, 0.5, abs(vUv.y - 0.5));
            float depthFade = smoothstep(3.0, 24.0, vDepth);
            vec3 color = mix(uColorA, uColorB, pulse * 0.65 + vUv.y * 0.18);
            float alpha = (0.16 + pulse * 0.78) * core * uAlpha * depthFade;
            if (alpha < 0.01) discard;
            gl_FragColor = vec4(color * (0.42 + pulse * 1.15), clamp(alpha, 0.0, 0.42));
          }
        `
      });
      const mesh = new THREE.Mesh(tube, material);
      mesh.renderOrder = 10 + i;
      group.add(mesh);
      this.animatedMaterials.push(material);
    }

    group.userData.particleBudget += ribbonCount * 96;
    return group;
  }

  private createBlackHoleRubbleHalo(inner: number, outer: number): THREE.Group {
    const group = new THREE.Group();
    group.rotation.set(1.3, 0.08, -0.12);
    const count = 360;
    const geometry = new THREE.IcosahedronGeometry(0.28, 0);
    const material = new THREE.MeshStandardMaterial({
      color: 0x17141a,
      roughness: 0.88,
      metalness: 0.22,
      emissive: 0xff9c56,
      emissiveIntensity: 0.035,
      flatShading: true
    });
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const rand = rng(41093);
    for (let i = 0; i < count; i += 1) {
      const radius = inner * 1.12 + Math.pow(rand(), 0.62) * (outer * 1.42 - inner);
      const angle = rand() * Math.PI * 2;
      const y = (rand() - 0.5) * (0.28 + radius * 0.025);
      const z = Math.sin(angle) * radius * (0.52 + rand() * 0.18) + (rand() - 0.5) * 0.6;
      TMP_OBJ.position.set(Math.cos(angle) * radius, y, z);
      TMP_OBJ.rotation.set(rand() * Math.PI, rand() * Math.PI, angle);
      const scale = 0.22 + Math.pow(rand(), 2.2) * 0.86;
      TMP_OBJ.scale.set(scale * (0.65 + rand() * 1.4), scale * (0.5 + rand() * 0.9), scale * (0.45 + rand() * 1.0));
      TMP_OBJ.updateMatrix();
      mesh.setMatrixAt(i, TMP_OBJ.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = this.useHighDetailShadows;
    mesh.receiveShadow = this.useHighDetailShadows;
    mesh.renderOrder = 2;
    group.add(mesh);
    group.userData.particleBudget = count;
    return group;
  }

  private createBlackHoleCaustics(inner: number, outer: number): THREE.Group {
    const group = new THREE.Group();
    group.rotation.set(1.3, 0.08, -0.12);
    group.renderOrder = 8;
    const rand = rng(68419);
    const glow = makeGlowTexture(128);

    for (let i = 0; i < 10; i += 1) {
      const radius = inner * (1.02 + rand() * 0.32) + (outer - inner) * (0.25 + rand() * 0.68);
      const start = -1.75 + rand() * Math.PI * 2.0;
      const length = 0.92 + rand() * 1.55;
      const sideBias = rand() > 0.5 ? 1 : -1;
      const color = new THREE.Color().setHSL(rand() > 0.6 ? 0.09 + rand() * 0.05 : 0.5 + rand() * 0.09, 0.9, 0.62 + rand() * 0.18);
      const points: THREE.Vector3[] = [];
      const steps = 9;
      for (let j = 0; j < steps; j += 1) {
        const t = j / (steps - 1);
        const angle = start + length * t * sideBias;
        const warp = Math.sin(t * Math.PI) * (1.1 + rand() * 0.7);
        const localRadius = radius + Math.sin(t * Math.PI * 2 + i) * 0.55 + warp;
        points.push(new THREE.Vector3(Math.cos(angle) * localRadius, Math.sin(angle) * localRadius * (0.62 + rand() * 0.08), (t - 0.5) * 0.5));
      }
      const curve = new THREE.CatmullRomCurve3(points, false, "centripetal", 0.42);
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: color },
          uAlpha: { value: 0.16 + rand() * 0.14 },
          uSeed: { value: rand() * 1000 },
          uSpeed: { value: 0.62 + rand() * 0.76 }
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: false,
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uAlpha;
          uniform float uSeed;
          uniform float uSpeed;
          uniform vec3 uColor;
          varying vec2 vUv;
          void main() {
            float around = 1.0 - abs(vUv.x - 0.5) * 2.0;
            float core = pow(clamp(around, 0.0, 1.0), 1.35);
            float head = pow(sin(vUv.y * 24.0 - uTime * uSpeed + uSeed) * 0.5 + 0.5, 6.0);
            float sparks = pow(sin(vUv.y * 78.0 + uSeed * 1.7 + uTime * 0.28) * 0.5 + 0.5, 14.0);
            float endFade = smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.88, 1.0, vUv.y));
            float alpha = endFade * core * (0.48 + head * 0.9 + sparks * 0.44) * uAlpha;
            vec3 color = mix(uColor, vec3(1.0, 0.93, 0.76), head * 0.34 + sparks * 0.28);
            if (alpha < 0.002) discard;
            gl_FragColor = vec4(color * (0.9 + head * 0.76 + sparks * 0.7), clamp(alpha, 0.0, 0.42));
          }
        `
      });
      this.animatedMaterials.push(material);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 88, 0.035 + rand() * 0.075, 8, false), material);
      tube.renderOrder = 8;
      group.add(tube);

      if (i % 2 === 0) {
        const bead = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: glow,
            color,
            transparent: true,
            opacity: 0.42 + rand() * 0.26,
            depthWrite: false,
            depthTest: false,
            fog: false,
            blending: THREE.AdditiveBlending
          })
        );
        const beadPoint = curve.getPoint(0.28 + rand() * 0.44);
        bead.position.copy(beadPoint);
        bead.scale.setScalar(1.1 + rand() * 1.8);
        bead.renderOrder = 9;
        group.add(bead);
      }
    }

    return group;
  }

  private createBlackHolePolarizationField(inner: number, outer: number): THREE.Group {
    const group = new THREE.Group();
    group.rotation.set(1.3, 0.08, -0.12);
    group.renderOrder = 16;
    group.userData.particleBudget = 0;
    const rand = rng(229781);

    const pointCount = 1640;
    const positions = new Float32Array(pointCount * 3);
    const colors = new Float32Array(pointCount * 3);
    const sizes = new Float32Array(pointCount);
    const phases = new Float32Array(pointCount);
    const lanes = new Float32Array(pointCount);

    for (let i = 0; i < pointCount; i += 1) {
      const radial = Math.pow(rand(), 0.58);
      const radius = inner * 1.08 + radial * (outer * 1.12 - inner * 1.08);
      const angle = rand() * Math.PI * 2;
      const squash = 0.36 + rand() * 0.22;
      const p = i * 3;
      positions[p] = Math.cos(angle) * radius;
      positions[p + 1] = Math.sin(angle) * radius * squash;
      positions[p + 2] = (rand() - 0.5) * (0.18 + radial * 1.4);
      TMP_COLOR.setHSL(rand() > 0.64 ? 0.085 + rand() * 0.05 : 0.5 + rand() * 0.1, 0.72 + rand() * 0.22, 0.58 + rand() * 0.28);
      if (radial < 0.18 || rand() > 0.92) TMP_COLOR.lerp(new THREE.Color(0xfff0c8), 0.46);
      colors[p] = TMP_COLOR.r;
      colors[p + 1] = TMP_COLOR.g;
      colors[p + 2] = TMP_COLOR.b;
      sizes[i] = 0.38 + Math.pow(rand(), 2.7) * 4.8;
      phases[i] = rand() * 1000;
      lanes[i] = (rand() > 0.5 ? 1 : -1) * (0.18 + rand() * 0.82);
    }

    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    pointGeometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    pointGeometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    pointGeometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    pointGeometry.setAttribute("aLane", new THREE.BufferAttribute(lanes, 1));
    const pointMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uInner: { value: inner * 1.08 },
        uOuter: { value: outer * 1.12 },
        uMap: { value: makeGlowTexture(128) }
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aPhase;
        attribute float aLane;
        uniform float uTime;
        uniform float uInner;
        uniform float uOuter;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vStretch;
        varying float vHot;
        void main() {
          float radius = max(0.001, length(position.xy));
          float radial = clamp((radius - uInner) / max(0.001, uOuter - uInner), 0.0, 1.0);
          float lane = sign(aLane);
          float angle = atan(position.y / 0.52, position.x) + uTime * (0.42 + abs(aLane) * 0.74) * lane;
          float focus = 1.0 - smoothstep(0.0, 1.0, abs(radial - 0.28) * 2.25);
          float innerFlash = 1.0 - smoothstep(0.08, 0.42, radial);
          float precession = sin(angle * 4.0 + uTime * 0.76 + aPhase) * (0.04 + focus * 0.2);
          float targetRadius = radius + precession;
          vec3 p = vec3(
            cos(angle) * targetRadius,
            sin(angle) * targetRadius * (0.4 + abs(aLane) * 0.16),
            position.z + sin(uTime * 1.3 + aPhase) * (0.05 + focus * 0.18)
          );
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          float depth = max(1.0, -mvPosition.z);
          float gate = smoothstep(0.02, 0.16, radial) * (1.0 - smoothstep(0.96, 1.0, radial));
          float pulse = 0.62 + 0.38 * sin(uTime * (1.0 + abs(aLane)) + aPhase);
          float doppler = 0.72 + smoothstep(-0.52, 0.96, cos(angle - 0.18)) * 0.58;
          vColor = mix(aColor, vec3(1.0, 0.9, 0.68), clamp(focus * 0.3 + innerFlash * 0.42 + doppler * 0.12, 0.0, 1.0));
          vAlpha = gate * pulse * doppler * (0.1 + focus * 0.22 + innerFlash * 0.08);
          vStretch = clamp(focus + innerFlash * 0.72, 0.0, 1.0);
          vHot = clamp(innerFlash + focus * 0.48, 0.0, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(aSize * (255.0 / depth) * (1.0 + vHot * 0.65), 0.8, 8.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vStretch;
        varying float vHot;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          vec2 streak = uv;
          streak.y *= mix(1.0, 0.24, vStretch);
          streak.x *= mix(1.0, 0.58, vStretch);
          float d = length(streak);
          if (d > 0.5) discard;
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float line = smoothstep(0.5, 0.018, abs(streak.y)) * smoothstep(0.44, 0.032, abs(streak.x)) * vStretch * 0.2;
          float spark = max(
            smoothstep(0.018, 0.0, abs(uv.x)) * smoothstep(0.5, 0.025, abs(uv.y)),
            smoothstep(0.018, 0.0, abs(uv.y)) * smoothstep(0.5, 0.025, abs(uv.x))
          ) * vHot * 0.12;
          float alpha = (tex.a * 0.24 + line + spark + vHot * 0.016) * vAlpha;
          if (alpha < 0.0035) discard;
          vec3 color = mix(vColor, vec3(1.0, 0.93, 0.72), tex.a * 0.26 + vHot * 0.34);
          gl_FragColor = vec4(color * (0.54 + tex.a * 0.95 + line * 1.25 + spark * 1.35 + vHot * 0.22), clamp(alpha, 0.0, 0.32));
        }
      `
    });
    this.animatedMaterials.push(pointMaterial);
    const points = new THREE.Points(pointGeometry, pointMaterial);
    points.renderOrder = 16;
    points.frustumCulled = false;
    group.add(points);

    const rayCount = 420;
    const rayPositions = new Float32Array(rayCount * 2 * 3);
    const rayColors = new Float32Array(rayCount * 2 * 3);
    const rayAlphas = new Float32Array(rayCount * 2);
    const raySeeds = new Float32Array(rayCount * 2);
    for (let i = 0; i < rayCount; i += 1) {
      const radial = Math.pow(rand(), 0.74);
      const radius = inner * 1.22 + radial * (outer * 1.04 - inner * 1.22);
      const angle = rand() * Math.PI * 2;
      const trail = 0.025 + rand() * 0.11;
      const lane = rand() > 0.5 ? 1 : -1;
      TMP_COLOR.setHSL(rand() > 0.62 ? 0.09 + rand() * 0.04 : 0.52 + rand() * 0.08, 0.78 + rand() * 0.16, 0.62 + rand() * 0.24);
      if (radial < 0.22) TMP_COLOR.lerp(new THREE.Color(0xffefc8), 0.36);
      const alpha = 0.04 + Math.pow(rand(), 1.7) * 0.14;
      const seed = rand() * 1000;
      for (let end = 0; end < 2; end += 1) {
        const t = end === 0 ? -0.5 : 0.5;
        const a = angle + t * trail * lane;
        const p = (i * 2 + end) * 3;
        rayPositions[p] = Math.cos(a) * radius;
        rayPositions[p + 1] = Math.sin(a) * radius * (0.42 + rand() * 0.1);
        rayPositions[p + 2] = (rand() - 0.5) * 0.6 + t * radial * 0.24;
        rayColors[p] = TMP_COLOR.r;
        rayColors[p + 1] = TMP_COLOR.g;
        rayColors[p + 2] = TMP_COLOR.b;
        rayAlphas[i * 2 + end] = alpha;
        raySeeds[i * 2 + end] = seed;
      }
    }

    const rayGeometry = new THREE.BufferGeometry();
    rayGeometry.setAttribute("position", new THREE.BufferAttribute(rayPositions, 3));
    rayGeometry.setAttribute("aColor", new THREE.BufferAttribute(rayColors, 3));
    rayGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(rayAlphas, 1));
    rayGeometry.setAttribute("aSeed", new THREE.BufferAttribute(raySeeds, 1));
    const rayMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aAlpha;
        attribute float aSeed;
        uniform float uTime;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float radius = max(0.001, length(position.xy));
          float angle = atan(position.y / 0.52, position.x) + uTime * (0.18 + fract(aSeed) * 0.42);
          vec3 p = vec3(
            cos(angle) * radius,
            sin(angle) * radius * 0.52,
            position.z + sin(uTime * 0.8 + aSeed) * 0.08
          );
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          float depth = max(1.0, -mvPosition.z);
          float pulse = 0.66 + 0.34 * sin(uTime * (0.8 + fract(aSeed) * 0.7) + aSeed);
          float doppler = 0.68 + smoothstep(-0.48, 0.92, cos(angle - 0.16)) * 0.52;
          vColor = mix(aColor, vec3(1.0, 0.88, 0.62), doppler * 0.18);
          vAlpha = aAlpha * pulse * doppler * smoothstep(18.0, 34.0, depth) * (1.0 - smoothstep(132.0, 178.0, depth));
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          if (vAlpha < 0.004) discard;
          gl_FragColor = vec4(vColor * 1.25, clamp(vAlpha, 0.0, 0.32));
        }
      `
    });
    this.animatedMaterials.push(rayMaterial);
    const rays = new THREE.LineSegments(rayGeometry, rayMaterial);
    rays.renderOrder = 17;
    rays.frustumCulled = false;
    group.add(rays);

    group.userData.particleBudget = pointCount + rayCount * 2;
    return group;
  }

  private createBlackHolePhotonSheath(inner: number, outer: number): THREE.Group {
    const group = new THREE.Group();
    group.rotation.set(1.3, 0.08, -0.12);
    group.renderOrder = 12;
    group.userData.particleBudget = 0;

    const ringSpecs = [
      { radius: inner * 1.02, width: 0.18, alpha: 0.5, phase: 1.7, speed: 0.78, colorA: 0xfff1b4, colorB: 0xff6d8f },
      { radius: inner * 1.16, width: 0.11, alpha: 0.32, phase: 4.2, speed: -0.56, colorA: 0xffc06d, colorB: 0x33e7c8 },
      { radius: inner * 1.34, width: 0.09, alpha: 0.22, phase: 7.9, speed: 0.42, colorA: 0x8fffee, colorB: 0xff8ec7 },
      { radius: inner * 1.68, width: 0.08, alpha: 0.13, phase: 11.4, speed: -0.31, colorA: 0xd8f4ff, colorB: 0xffd98a }
    ];

    for (const [index, spec] of ringSpecs.entries()) {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uInner: { value: spec.radius - spec.width },
          uOuter: { value: spec.radius + spec.width },
          uAlpha: { value: spec.alpha },
          uPhase: { value: spec.phase },
          uSpeed: { value: spec.speed },
          uColorA: { value: new THREE.Color(spec.colorA) },
          uColorB: { value: new THREE.Color(spec.colorB) }
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: false,
        vertexShader: `
          varying vec2 vLocal;
          varying float vRadius;
          void main() {
            vLocal = position.xy;
            vRadius = length(position.xy);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uInner;
          uniform float uOuter;
          uniform float uAlpha;
          uniform float uPhase;
          uniform float uSpeed;
          uniform vec3 uColorA;
          uniform vec3 uColorB;
          varying vec2 vLocal;
          varying float vRadius;
          void main() {
            float radial = clamp((vRadius - uInner) / max(0.001, uOuter - uInner), 0.0, 1.0);
            float band = smoothstep(0.02, 0.18, radial) * (1.0 - smoothstep(0.78, 1.0, radial));
            float angle = atan(vLocal.y, vLocal.x);
            float doppler = 0.62 + smoothstep(-0.54, 0.98, cos(angle - 0.28)) * 0.72;
            float braid = pow(sin(angle * 22.0 + radial * 8.5 - uTime * uSpeed + uPhase) * 0.5 + 0.5, 7.0);
            float needle = pow(sin(angle * 91.0 - radial * 24.0 + uTime * (0.24 + abs(uSpeed)) + uPhase * 1.63) * 0.5 + 0.5, 18.0);
            float counter = pow(sin(-angle * 37.0 + radial * 18.0 + uTime * (0.18 + abs(uSpeed) * 0.42) + uPhase * 0.7) * 0.5 + 0.5, 12.0);
            float split = smoothstep(0.38, 0.92, cos(angle + 0.56));
            float hot = clamp(braid * 0.62 + needle * 0.46 + counter * 0.22, 0.0, 1.0);
            vec3 color = mix(uColorB, uColorA, clamp(doppler * 0.42 + split * 0.34 + radial * 0.18, 0.0, 1.0));
            color = mix(color, vec3(1.0, 0.92, 0.68), hot * 0.34);
            float alpha = band * uAlpha * doppler * (0.28 + braid * 0.7 + needle * 0.62 + counter * 0.32);
            if (alpha < 0.0025) discard;
            gl_FragColor = vec4(color * (0.86 + doppler * 0.34 + hot * 1.1), clamp(alpha, 0.0, 0.58));
          }
        `
      });
      this.animatedMaterials.push(material);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(spec.radius - spec.width, spec.radius + spec.width, 384, 5),
        material
      );
      ring.renderOrder = 12 + index;
      ring.frustumCulled = false;
      group.add(ring);
    }

    const echoCount = 720;
    const rand = rng(119371);
    const positions = new Float32Array(echoCount * 3);
    const colors = new Float32Array(echoCount * 3);
    const sizes = new Float32Array(echoCount);
    const phases = new Float32Array(echoCount);
    const lanes = new Float32Array(echoCount);
    const echoOuter = outer * 0.78;

    for (let i = 0; i < echoCount; i += 1) {
      const radial = Math.pow(rand(), 0.74);
      const radius = inner * 0.98 + radial * (echoOuter - inner * 0.98);
      const angle = rand() * Math.PI * 2;
      const p = i * 3;
      positions[p] = Math.cos(angle) * radius;
      positions[p + 1] = Math.sin(angle) * radius * (0.36 + rand() * 0.2);
      positions[p + 2] = (rand() - 0.5) * (0.28 + radial * 1.6);
      TMP_COLOR.setHSL(rand() > 0.58 ? 0.09 + rand() * 0.05 : 0.52 + rand() * 0.08, 0.74 + rand() * 0.18, 0.64 + rand() * 0.26);
      if (radial < 0.22 || rand() > 0.9) TMP_COLOR.lerp(new THREE.Color(0xfff2cc), 0.42);
      colors[p] = TMP_COLOR.r;
      colors[p + 1] = TMP_COLOR.g;
      colors[p + 2] = TMP_COLOR.b;
      sizes[i] = 0.44 + Math.pow(rand(), 2.5) * 4.4;
      phases[i] = rand() * 1000;
      lanes[i] = (rand() > 0.5 ? 1 : -1) * (0.22 + rand() * 0.78);
    }

    const echoGeometry = new THREE.BufferGeometry();
    echoGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    echoGeometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    echoGeometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    echoGeometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    echoGeometry.setAttribute("aLane", new THREE.BufferAttribute(lanes, 1));

    const echoMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uInner: { value: inner * 0.98 },
        uOuter: { value: echoOuter },
        uMap: { value: makeGlowTexture(128) }
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aPhase;
        attribute float aLane;
        uniform float uTime;
        uniform float uInner;
        uniform float uOuter;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vStretch;
        varying float vHot;
        void main() {
          float radius = max(0.001, length(position.xy));
          float radial = clamp((radius - uInner) / max(0.001, uOuter - uInner), 0.0, 1.0);
          float lane = sign(aLane);
          float angle = atan(position.y, position.x) + uTime * (0.58 + abs(aLane) * 0.9) * lane;
          float focus = 1.0 - smoothstep(0.0, 1.0, abs(radial - 0.24) * 2.7);
          float innerFlash = 1.0 - smoothstep(0.12, 0.52, radial);
          float precession = sin(angle * 3.0 + uTime * 0.84 + aPhase) * (0.05 + focus * 0.18);
          float targetRadius = radius + precession;
          vec3 p = vec3(
            cos(angle) * targetRadius,
            sin(angle) * targetRadius * (0.36 + abs(aLane) * 0.18),
            position.z + sin(uTime * 1.1 + aPhase) * (0.06 + focus * 0.16)
          );
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          float depth = max(1.0, -mvPosition.z);
          float gate = smoothstep(0.02, 0.16, radial) * (1.0 - smoothstep(0.94, 1.0, radial));
          float pulse = 0.66 + 0.34 * sin(uTime * (0.8 + abs(aLane)) + aPhase);
          vColor = mix(aColor, vec3(1.0, 0.9, 0.68), clamp(focus * 0.32 + innerFlash * 0.38, 0.0, 1.0));
          vAlpha = gate * (0.26 + focus * 0.34 + innerFlash * 0.16) * pulse;
          vStretch = clamp(focus + innerFlash * 0.74, 0.0, 1.0);
          vHot = clamp(innerFlash + focus * 0.42, 0.0, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(aSize * (255.0 / depth) * (1.0 + vHot * 0.72), 0.8, 7.6);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vStretch;
        varying float vHot;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          vec2 streak = uv;
          streak.y *= mix(1.0, 0.28, vStretch);
          streak.x *= mix(1.0, 0.62, vStretch);
          float d = length(streak);
          if (d > 0.5) discard;
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float line = smoothstep(0.5, 0.02, abs(streak.y)) * smoothstep(0.42, 0.035, abs(streak.x)) * vStretch * 0.24;
          float alpha = (tex.a * 0.36 + line + vHot * 0.028) * vAlpha;
          if (alpha < 0.0035) discard;
          vec3 color = mix(vColor, vec3(1.0, 0.92, 0.7), tex.a * 0.28 + vHot * 0.32);
          gl_FragColor = vec4(color * (0.62 + tex.a * 1.08 + line * 1.55 + vHot * 0.36), clamp(alpha, 0.0, 0.48));
        }
      `
    });
    this.animatedMaterials.push(echoMaterial);
    const echoes = new THREE.Points(echoGeometry, echoMaterial);
    echoes.renderOrder = 15;
    echoes.frustumCulled = false;
    group.add(echoes);

    group.userData.particleBudget = ringSpecs.length * 384 + echoCount;
    return group;
  }

  private createBlackHoleLensingArcs(inner: number, outer: number): THREE.Group {
    const group = new THREE.Group();
    group.rotation.set(1.3, 0.08, -0.12);
    group.renderOrder = 10;
    group.userData.particleBudget = 0;
    const rand = rng(97731);
    const arcCount = 26;

    for (let i = 0; i < arcCount; i += 1) {
      const radius = inner * (0.98 + rand() * 0.12) + (outer - inner) * (0.1 + rand() * 0.48);
      const start = -Math.PI + rand() * Math.PI * 2;
      const length = 0.42 + Math.pow(rand(), 0.56) * 1.42;
      const side = rand() > 0.5 ? 1 : -1;
      const ySquash = 0.48 + rand() * 0.18;
      const zLift = (rand() - 0.5) * 0.95;
      const points: THREE.Vector3[] = [];
      for (let step = 0; step <= 18; step += 1) {
        const t = step / 18;
        const envelope = Math.sin(t * Math.PI);
        const a = start + length * (t - 0.5) * side;
        const wobble = Math.sin(t * Math.PI * 2 + i * 0.73) * 0.18 * envelope;
        const r = radius + wobble + envelope * (0.2 + rand() * 0.3);
        points.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r * ySquash, zLift + (t - 0.5) * 0.22));
      }
      const curve = new THREE.CatmullRomCurve3(points, false, "centripetal", 0.34);
      const color = new THREE.Color().setHSL(rand() > 0.7 ? 0.095 + rand() * 0.04 : 0.52 + rand() * 0.08, 0.72 + rand() * 0.2, 0.7 + rand() * 0.18);
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: color },
          uAlpha: { value: 0.1 + rand() * 0.16 },
          uSeed: { value: rand() * 1000 },
          uSpeed: { value: 0.24 + rand() * 0.58 }
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: false,
        vertexShader: `
          varying vec2 vUv;
          varying float vDepth;
          void main() {
            vUv = uv;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            vDepth = -mvPosition.z;
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uAlpha;
          uniform float uSeed;
          uniform float uSpeed;
          uniform vec3 uColor;
          varying vec2 vUv;
          varying float vDepth;
          void main() {
            float center = pow(1.0 - abs(vUv.x - 0.5) * 2.0, 1.7);
            float endFade = smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.86, 1.0, vUv.y));
            float ripple = 0.68 + 0.32 * sin(vUv.y * 18.0 - uTime * uSpeed + uSeed);
            float bead = pow(sin(vUv.y * 88.0 + uSeed * 0.31 + uTime * 0.18) * 0.5 + 0.5, 18.0);
            float depthFade = smoothstep(14.0, 30.0, vDepth) * (1.0 - smoothstep(120.0, 178.0, vDepth));
            float alpha = (center * (0.62 + bead * 0.45) + bead * 0.28) * endFade * depthFade * ripple * uAlpha;
            vec3 color = mix(uColor, vec3(1.0, 0.92, 0.72), bead * 0.42);
            if (alpha < 0.0025) discard;
            gl_FragColor = vec4(color * (0.82 + bead * 1.1), clamp(alpha, 0.0, 0.34));
          }
        `
      });
      this.animatedMaterials.push(material);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 54, 0.015 + rand() * 0.036, 6, false), material);
      tube.renderOrder = 10;
      tube.frustumCulled = false;
      group.add(tube);
    }

    group.userData.particleBudget = arcCount * 54;
    return group;
  }

  private createBlackHoleInfallField(inner: number, outer: number): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
    const count = 1300;
    const rand = rng(41887);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const lanes = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
      const lane = rand() > 0.5 ? 1 : -1;
      const radial = Math.pow(rand(), 0.62);
      const radius = inner * 1.06 + radial * (outer * 1.46 - inner);
      const angle = rand() * Math.PI * 2;
      const ySquash = 0.38 + rand() * 0.22;
      const p = i * 3;
      positions[p] = Math.cos(angle) * radius + (rand() - 0.5) * 0.18;
      positions[p + 1] = Math.sin(angle) * radius * ySquash + (rand() - 0.5) * 0.3;
      positions[p + 2] = (rand() - 0.5) * 2.2 * (0.25 + radial);
      TMP_COLOR.setHSL(rand() > 0.64 ? 0.09 + rand() * 0.05 : 0.53 + rand() * 0.08, 0.72 + rand() * 0.22, 0.56 + rand() * 0.28);
      if (radial < 0.18) TMP_COLOR.lerp(new THREE.Color(0xfff0c8), 0.42);
      colors[p] = TMP_COLOR.r;
      colors[p + 1] = TMP_COLOR.g;
      colors[p + 2] = TMP_COLOR.b;
      sizes[i] = 0.38 + Math.pow(rand(), 3.2) * 3.9;
      phases[i] = rand() * 1000;
      lanes[i] = lane * (0.24 + rand() * 0.76);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute("aLane", new THREE.BufferAttribute(lanes, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uInner: { value: inner },
        uOuter: { value: outer * 1.46 },
        uMap: { value: makeGlowTexture(128) }
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aPhase;
        attribute float aLane;
        uniform float uTime;
        uniform float uInner;
        uniform float uOuter;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vStretch;
        void main() {
          float radius = max(0.001, length(position.xy));
          float radial = clamp((radius - uInner) / max(0.001, uOuter - uInner), 0.0, 1.0);
          float fall = fract(radial - uTime * (0.035 + abs(aLane) * 0.028) + fract(aPhase));
          float targetRadius = mix(uInner * 1.08, uOuter, fall);
          float angle = atan(position.y, position.x) + uTime * (0.36 + abs(aLane) * 0.44) * sign(aLane) + (1.0 - fall) * 2.7 * sign(aLane);
          vec3 p = vec3(cos(angle) * targetRadius, sin(angle) * targetRadius * (0.38 + abs(aLane) * 0.2), position.z * (0.4 + fall * 0.8));
          p.z += sin(uTime * 0.8 + aPhase) * 0.16;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          float depth = max(1.0, -mvPosition.z);
          float nearHot = 1.0 - smoothstep(0.0, 0.44, fall);
          float outerFade = smoothstep(0.04, 0.28, fall) * (1.0 - smoothstep(0.92, 1.0, fall));
          float pulse = 0.72 + 0.28 * sin(uTime * (0.9 + abs(aLane)) + aPhase);
          vColor = mix(aColor, vec3(1.0, 0.84, 0.58), nearHot * 0.48);
          vAlpha = (outerFade * 0.52 + nearHot * 0.34) * pulse;
          vStretch = smoothstep(0.52, 0.02, fall);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(aSize * (210.0 / depth) * (1.0 + nearHot * 0.85), 0.75, 7.8);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vStretch;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          uv.x *= mix(1.0, 0.42, vStretch);
          float d = length(uv);
          if (d > 0.5) discard;
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float tail = smoothstep(0.52, 0.02, abs(uv.x)) * smoothstep(0.34, 0.02, abs(uv.y)) * vStretch * 0.18;
          float alpha = (tex.a * 0.52 + tail) * vAlpha;
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(vColor * (0.58 + tex.a * 1.18 + tail * 1.3), clamp(alpha, 0.0, 0.68));
        }
      `
    });
    this.animatedMaterials.push(material);
    const points = new THREE.Points(geometry, material);
    points.rotation.set(1.3, 0.08, -0.12);
    points.renderOrder = 6;
    points.frustumCulled = false;
    points.userData.particleBudget = count;
    return points;
  }

  private createBlackHoleLensingStarfield(inner: number, outer: number): THREE.Group {
    const group = new THREE.Group();
    group.rotation.set(1.3, 0.08, -0.12);
    group.renderOrder = 6;
    group.userData.particleBudget = 0;

    const rand = rng(883421);
    const starCount = 1850;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);
    const phases = new Float32Array(starCount);
    const lanes = new Float32Array(starCount);
    const lensOuter = outer * 2.75;

    for (let i = 0; i < starCount; i += 1) {
      const lane = rand() > 0.5 ? 1 : -1;
      const radial = Math.pow(rand(), 0.52);
      const radius = inner * 1.18 + radial * (lensOuter - inner);
      const angle = rand() * Math.PI * 2;
      const ySquash = 0.36 + rand() * 0.18;
      const p = i * 3;
      positions[p] = Math.cos(angle) * radius + (rand() - 0.5) * 0.22;
      positions[p + 1] = Math.sin(angle) * radius * ySquash + (rand() - 0.5) * 0.38;
      positions[p + 2] = (rand() - 0.5) * (1.4 + radial * 8.2);
      TMP_COLOR.setHSL(rand() > 0.62 ? 0.095 + rand() * 0.04 : 0.52 + rand() * 0.08, 0.58 + rand() * 0.28, 0.58 + rand() * 0.34);
      if (radial < 0.24 || rand() > 0.92) TMP_COLOR.lerp(new THREE.Color(0xfff4d3), 0.36 + rand() * 0.34);
      colors[p] = TMP_COLOR.r;
      colors[p + 1] = TMP_COLOR.g;
      colors[p + 2] = TMP_COLOR.b;
      sizes[i] = 0.34 + Math.pow(rand(), 3.3) * 4.7;
      phases[i] = rand() * 1000;
      lanes[i] = lane * (0.18 + rand() * 0.82);
    }

    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    starGeometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    starGeometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    starGeometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    starGeometry.setAttribute("aLane", new THREE.BufferAttribute(lanes, 1));
    const starMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uInner: { value: inner * 1.08 },
        uOuter: { value: lensOuter },
        uMap: { value: makeGlowTexture(128) }
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aPhase;
        attribute float aLane;
        uniform float uTime;
        uniform float uInner;
        uniform float uOuter;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vStretch;
        varying float vHot;
        void main() {
          float seed = fract(aPhase);
          float radius = max(0.001, length(position.xy));
          float radial = clamp((radius - uInner) / max(0.001, uOuter - uInner), 0.0, 1.0);
          float fall = fract(radial - uTime * (0.012 + abs(aLane) * 0.02) + seed);
          float targetRadius = mix(uInner, uOuter, fall);
          float angle = atan(position.y, position.x) + uTime * (0.12 + abs(aLane) * 0.34) * sign(aLane) + (1.0 - fall) * 1.8 * sign(aLane);
          vec3 p = vec3(cos(angle) * targetRadius, sin(angle) * targetRadius * (0.36 + abs(aLane) * 0.17), position.z * (0.58 + fall * 0.92));
          p.z += sin(uTime * 0.56 + aPhase) * 0.18;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          float depth = max(1.0, -mvPosition.z);
          float horizonGuard = smoothstep(0.1, 0.23, fall);
          float nearHorizon = horizonGuard * (1.0 - smoothstep(0.26, 0.56, fall));
          float outerFade = horizonGuard * (1.0 - smoothstep(0.94, 1.0, fall));
          float pulse = 0.68 + 0.32 * sin(uTime * (0.84 + abs(aLane) * 0.72) + aPhase);
          vColor = mix(aColor, vec3(1.0, 0.86, 0.62), nearHorizon * 0.48);
          vAlpha = (outerFade * 0.32 + nearHorizon * 0.16) * pulse * (0.58 + seed * 0.46);
          vStretch = smoothstep(0.58, 0.02, fall);
          vHot = nearHorizon;
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(aSize * (235.0 / depth) * (1.0 + nearHorizon * 0.45), 0.7, 7.2);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vStretch;
        varying float vHot;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          vec2 dash = uv;
          dash.y *= mix(1.0, 0.34, vStretch);
          dash.x *= mix(1.0, 0.54, vStretch);
          float d = length(dash);
          if (d > 0.5) discard;
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float trail = smoothstep(0.52, 0.02, abs(dash.y)) * smoothstep(0.44, 0.04, abs(dash.x)) * vStretch * 0.2;
          float alpha = (tex.a * 0.36 + trail + vHot * 0.035) * vAlpha;
          if (alpha < 0.004) discard;
          vec3 hot = mix(vColor, vec3(1.0, 0.92, 0.72), tex.a * 0.32 + vHot * 0.38);
          gl_FragColor = vec4(hot * (0.56 + tex.a * 1.02 + trail * 1.45 + vHot * 0.22), clamp(alpha, 0.0, 0.52));
        }
      `
    });
    this.animatedMaterials.push(starMaterial);
    const stars = new THREE.Points(starGeometry, starMaterial);
    stars.renderOrder = 6;
    stars.frustumCulled = false;
    group.add(stars);

    const arcCount = 32;
    for (let i = 0; i < arcCount; i += 1) {
      const radius = inner * (1.35 + rand() * 0.55) + (outer * 2.2 - inner) * Math.pow(rand(), 0.72);
      const start = -Math.PI + rand() * Math.PI * 2;
      const length = Math.PI * (0.34 + Math.pow(rand(), 0.62) * 0.62);
      const side = rand() > 0.5 ? 1 : -1;
      const ySquash = 0.34 + rand() * 0.2;
      const zLift = (rand() - 0.5) * 3.4;
      const points: THREE.Vector3[] = [];
      for (let step = 0; step <= 20; step += 1) {
        const t = step / 20;
        const envelope = Math.sin(t * Math.PI);
        const angle = start + (t - 0.5) * length * side;
        const localRadius = radius + envelope * (0.65 + rand() * 1.35) + Math.sin(t * Math.PI * 2 + i) * 0.22;
        points.push(new THREE.Vector3(Math.cos(angle) * localRadius, Math.sin(angle) * localRadius * ySquash, zLift + (t - 0.5) * 0.5));
      }
      const curve = new THREE.CatmullRomCurve3(points, false, "centripetal", 0.38);
      const color = new THREE.Color().setHSL(rand() > 0.55 ? 0.09 + rand() * 0.05 : 0.51 + rand() * 0.09, 0.76 + rand() * 0.18, 0.62 + rand() * 0.22);
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: color },
          uAlpha: { value: 0.055 + rand() * 0.095 },
          uSeed: { value: rand() * 1000 },
          uSpeed: { value: 0.2 + rand() * 0.54 }
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: false,
        vertexShader: `
          varying vec2 vUv;
          varying float vDepth;
          void main() {
            vUv = uv;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            vDepth = -mvPosition.z;
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uAlpha;
          uniform float uSeed;
          uniform float uSpeed;
          uniform vec3 uColor;
          varying vec2 vUv;
          varying float vDepth;
          void main() {
            float core = pow(1.0 - abs(vUv.x - 0.5) * 2.0, 1.55);
            float ends = smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.88, 1.0, vUv.y));
            float packet = pow(sin(vUv.y * 32.0 - uTime * uSpeed + uSeed) * 0.5 + 0.5, 7.0);
            float bead = pow(sin(vUv.y * 118.0 + uSeed * 0.41 + uTime * 0.23) * 0.5 + 0.5, 20.0);
            float depthFade = smoothstep(10.0, 28.0, vDepth) * (1.0 - smoothstep(132.0, 214.0, vDepth));
            float alpha = (core * (0.58 + packet * 0.55) + bead * 0.34) * ends * depthFade * uAlpha;
            if (alpha < 0.002) discard;
            vec3 color = mix(uColor, vec3(1.0, 0.93, 0.76), packet * 0.28 + bead * 0.42);
            gl_FragColor = vec4(color * (0.78 + packet * 0.82 + bead * 1.1), clamp(alpha, 0.0, 0.36));
          }
        `
      });
      this.animatedMaterials.push(material);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 96, 0.012 + Math.pow(rand(), 2.3) * 0.04, 6, false), material);
      tube.renderOrder = 6;
      tube.frustumCulled = false;
      group.add(tube);
    }

    group.userData.particleBudget = starCount + arcCount * 96;
    return group;
  }

  private createBlackHoleAccretionPlume(inner: number, outer: number): THREE.Group {
    const plume = new THREE.Group();
    plume.rotation.set(1.3, 0.08, -0.12);

    const specs = [
      { inner: inner * 0.82, outer: outer * 1.18, color: 0xffc06d, alpha: 0.22, seed: 2.7, spin: 0.82, scaleY: 0.42, rotZ: -0.05, lift: 0.05 },
      { inner: inner * 0.96, outer: outer * 1.34, color: 0xff5f9b, alpha: 0.145, seed: 6.4, spin: 0.56, scaleY: 0.56, rotZ: 0.16, lift: -0.04 },
      { inner: inner * 1.18, outer: outer * 1.56, color: 0x33e7c8, alpha: 0.1, seed: 9.1, spin: 0.38, scaleY: 0.74, rotZ: -0.24, lift: 0.02 }
    ];

    for (const [index, spec] of specs.entries()) {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uInner: { value: spec.inner },
          uOuter: { value: spec.outer },
          uSeed: { value: spec.seed },
          uSpin: { value: spec.spin },
          uAlpha: { value: spec.alpha },
          uColor: { value: new THREE.Color(spec.color) }
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: false,
        vertexShader: `
          varying vec2 vLocal;
          varying float vRadius;
          void main() {
            vLocal = position.xy;
            vRadius = length(position.xy);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uInner;
          uniform float uOuter;
          uniform float uSeed;
          uniform float uSpin;
          uniform float uAlpha;
          uniform vec3 uColor;
          varying vec2 vLocal;
          varying float vRadius;

          float hash(vec2 p) {
            p = fract(p * vec2(127.1, 311.7));
            p += dot(p, p + 37.37);
            return fract(p.x * p.y);
          }

          float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(
              mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
              mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
              u.y
            );
          }

          float fbm(vec2 p) {
            float value = 0.0;
            float amp = 0.55;
            for (int i = 0; i < 4; i += 1) {
              value += noise(p) * amp;
              p = p * 2.03 + vec2(13.7, 7.9);
              amp *= 0.52;
            }
            return value;
          }

          void main() {
            float ring = smoothstep(uInner, uInner + 1.15, vRadius) * (1.0 - smoothstep(uOuter - 2.9, uOuter, vRadius));
            float radial = clamp((vRadius - uInner) / max(0.001, uOuter - uInner), 0.0, 1.0);
            float angle = atan(vLocal.y, vLocal.x);
            float shear = angle * 3.2 + radial * 14.0 - uTime * uSpin + uSeed;
            float braid = pow(sin(shear * 2.1 + sin(radial * 18.0 + uSeed) * 1.35) * 0.5 + 0.5, 3.4);
            float fine = pow(sin(shear * 6.8 - radial * 23.0 + uTime * 0.42) * 0.5 + 0.5, 7.0);
            float turbulence = fbm(vec2(angle * 2.8 + uTime * 0.04 + uSeed, radial * 10.4 - uTime * 0.12));
            float filament = braid * 0.52 + fine * 0.34 + pow(smoothstep(0.45, 0.92, turbulence), 2.0) * 0.66;
            float lane = 1.0 - smoothstep(0.35, 0.94, abs(vLocal.y) / max(1.0, uOuter * 0.58));
            float doppler = 0.62 + smoothstep(-0.78, 0.92, cos(angle - uTime * 0.09)) * 0.82;
            float hot = 1.0 - smoothstep(0.0, 0.54, radial);
            float outerGlow = smoothstep(0.52, 1.0, radial);
            float alpha = ring * lane * doppler * (0.02 + filament * filament) * uAlpha;
            if (alpha < 0.006) discard;
            vec3 color = uColor * (0.28 + filament * 1.18 + doppler * 0.22);
            color += vec3(1.0, 0.88, 0.62) * pow(hot, 2.4) * (0.3 + filament * 0.55);
            color += vec3(0.18, 0.9, 1.0) * outerGlow * pow(filament, 2.0) * 0.2;
            gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.48));
          }
        `
      });
      const mesh = new THREE.Mesh(new THREE.RingGeometry(spec.inner, spec.outer, 320, 8), material);
      mesh.rotation.z = spec.rotZ;
      mesh.position.z = spec.lift;
      mesh.scale.y = spec.scaleY;
      mesh.renderOrder = 3 + index;
      plume.add(mesh);
      this.animatedMaterials.push(material);
    }

    return plume;
  }

  private createBlackHolePortrait(): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAspect: { value: 56 / 36 },
        uColorHot: { value: new THREE.Color(0xfff0c8) },
        uColorWarm: { value: new THREE.Color(0xff8c5f) },
        uColorCool: { value: new THREE.Color(0x33e7c8) }
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending,
      fog: false,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uAspect;
        uniform vec3 uColorHot;
        uniform vec3 uColorWarm;
        uniform vec3 uColorCool;
        varying vec2 vUv;

        float hash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float ringBand(float r, float target, float width) {
          float x = (r - target) / width;
          return exp(-x * x);
        }

        void main() {
          vec2 p = (vUv - 0.5) * 2.0;
          vec2 circle = vec2(p.x * uAspect, p.y);
          float d = length(circle);
          float angle = atan(p.y, p.x);

          vec2 disk = vec2(p.x, p.y * 3.15 + sin(p.x * 3.4 + uTime * 0.18) * 0.055);
          float r = length(disk);
          float radial = smoothstep(0.22, 0.86, r) * (1.0 - smoothstep(1.02, 1.32, r));
          float band = ringBand(r, 0.57, 0.13) * 0.92 + ringBand(r, 0.82, 0.18) * 0.58 + ringBand(r, 0.39, 0.055) * 0.65;
          float spiral = sin(angle * 8.0 + r * 17.0 - uTime * 1.24 + sin(r * 9.0) * 1.1) * 0.5 + 0.5;
          float filament = pow(spiral, 2.9) * 0.58 + pow(sin(angle * 17.0 - r * 25.0 + uTime * 0.42) * 0.5 + 0.5, 8.0) * 0.42;
          float grain = hash(floor((disk + 1.8) * 92.0));
          float doppler = 0.68 + smoothstep(-0.75, 0.95, cos(angle - 0.06)) * 0.88;
          float vertical = 1.0 - smoothstep(0.42, 0.94, abs(p.y));
          float diskAlpha = radial * band * vertical * (0.26 + filament * 0.82) * (0.86 + grain * 0.22) * doppler;

          float horizon = 1.0 - smoothstep(0.278, 0.305, d);
          float photon = ringBand(d, 0.335, 0.018) * (0.55 + smoothstep(-0.28, 0.45, p.y) * 0.6);
          float outerLens = ringBand(d, 0.47, 0.038) * 0.26 + ringBand(d, 0.64, 0.055) * 0.12;
          float shadow = (1.0 - smoothstep(0.28, 0.52, d)) * 0.48;

          vec3 diskColor = mix(uColorCool, uColorWarm, smoothstep(0.2, 0.92, 1.0 - r));
          diskColor = mix(diskColor, uColorHot, pow(max(0.0, 1.0 - r), 3.2) * 0.92);
          diskColor *= 0.58 + doppler * 0.72 + filament * 0.66;
          diskColor = mix(diskColor, vec3(0.0, 0.003, 0.008), shadow);
          vec3 lensColor = mix(uColorCool, uColorHot, smoothstep(-0.2, 0.4, p.y));
          vec3 color = diskColor * diskAlpha + lensColor * (photon * 1.35 + outerLens);

          float alpha = max(diskAlpha, max(photon * 0.9, outerLens));
          color = mix(color, vec3(0.0, 0.0, 0.002), horizon);
          alpha = max(alpha, horizon);
          if (alpha < 0.012) discard;
          gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.98));
        }
      `
    });
    const portrait = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 1), material);
    portrait.scale.set(56, 36, 1);
    portrait.renderOrder = 8;
    return portrait;
  }

  private createBlackHolePhotonCage(): THREE.Group {
    const cage = new THREE.Group();
    const specs = [
      { r: 5.32, tube: 0.052, arc: Math.PI * 1.72, color: 0xfff1bd, opacity: 0.72, rot: [1.26, 0.16, -0.18] },
      { r: 5.86, tube: 0.035, arc: Math.PI * 1.35, color: 0x33e7c8, opacity: 0.28, rot: [1.08, -0.34, 0.42] },
      { r: 6.48, tube: 0.028, arc: Math.PI * 1.18, color: 0xff5c9d, opacity: 0.22, rot: [1.44, 0.28, -0.68] },
      { r: 7.42, tube: 0.022, arc: Math.PI * 1.54, color: 0xbff7ff, opacity: 0.16, rot: [1.2, -0.08, 1.16] }
    ];

    for (const spec of specs) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(spec.r, spec.tube, 10, 220, spec.arc),
        new THREE.MeshBasicMaterial({
          color: spec.color,
          transparent: true,
          opacity: spec.opacity,
          depthTest: false,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          fog: false
        })
      );
      ring.rotation.set(spec.rot[0], spec.rot[1], spec.rot[2]);
      ring.renderOrder = 7;
      cage.add(ring);
    }

    const glintMaterial = new THREE.SpriteMaterial({
      map: makeGlowTexture(128),
      color: 0xfff0c8,
      transparent: true,
      opacity: 0.38,
      depthTest: false,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending
    });
    const rand = rng(6607);
    for (let i = 0; i < 18; i += 1) {
      const a = rand() * Math.PI * 2;
      const r = 5.6 + rand() * 3.0;
      const glint = new THREE.Sprite(glintMaterial.clone());
      glint.position.set(Math.cos(a) * r, (rand() - 0.5) * 0.72, Math.sin(a) * r * 0.54);
      const scale = 0.26 + rand() * 0.58;
      glint.scale.set(scale * 2.1, scale, 1);
      glint.renderOrder = 7;
      cage.add(glint);
    }

    cage.rotation.set(0.04, -0.08, 0.0);
    return cage;
  }

  private createBlackHoleJets(): THREE.Mesh[] {
    return [-1, 1].map((direction) => {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColorA: { value: new THREE.Color(0x33e7c8) },
          uColorB: { value: new THREE.Color(0x7b4dff) }
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: false,
        vertexShader: `
          varying vec2 vUv;
          varying vec3 vPos;
          void main() {
            vUv = uv;
            vPos = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform vec3 uColorA;
          uniform vec3 uColorB;
          varying vec2 vUv;
          varying vec3 vPos;
          void main() {
            float core = 1.0 - smoothstep(0.0, 1.0, abs(vPos.x) + abs(vPos.z));
            float fade = smoothstep(0.03, 0.22, vUv.y) * (1.0 - smoothstep(0.54, 1.0, vUv.y));
            float pulse = sin(vUv.y * 22.0 - uTime * 2.0) * 0.5 + 0.5;
            vec3 color = mix(uColorB, uColorA, core);
            gl_FragColor = vec4(color * (0.35 + pulse * 0.45), core * fade * 0.24);
          }
        `
      });
      const jet = new THREE.Mesh(new THREE.ConeGeometry(2.6, 34, 48, 1, true), material);
      jet.position.y = direction * 18.5;
      jet.rotation.x = direction > 0 ? 0 : Math.PI;
      jet.renderOrder = 0;
      return jet;
    });
  }

  private createBlackHoleDebris(inner: number, outer: number): THREE.Points {
    const count = this.quality.label === "HIGH" ? 1800 : 640;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const rand = rng(1901);
    for (let i = 0; i < count; i += 1) {
      const radius = inner + Math.pow(rand(), 0.72) * (outer * 1.22 - inner);
      const angle = rand() * Math.PI * 2;
      const band = (rand() - 0.5) * 0.42;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = band;
      positions[i * 3 + 2] = Math.sin(angle) * radius * 0.72 + (rand() - 0.5) * 0.4;
      TMP_COLOR.setHSL(rand() > 0.82 ? 0.52 : 0.08 + rand() * 0.05, 0.8, 0.55 + rand() * 0.28);
      colors[i * 3] = TMP_COLOR.r;
      colors[i * 3 + 1] = TMP_COLOR.g;
      colors[i * 3 + 2] = TMP_COLOR.b;
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 0.34,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });
    this.loadTexture("assets/particle.png", (texture) => {
      material.map = texture;
      material.needsUpdate = true;
    });
    const debris = new THREE.Points(geometry, material);
    debris.rotation.set(1.3, 0.08, -0.12);
    debris.renderOrder = 2;
    return debris;
  }

  private createGalaxy(): THREE.Points {
    const count = this.quality.dustCount;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const scales = new Float32Array(count);
    const seeds = new Float32Array(count);
    const rand = rng(212);

    for (let i = 0; i < count; i += 1) {
      const arm = Math.floor(rand() * 4);
      const radius = 4 + Math.pow(rand(), 0.65) * 74;
      const angle = arm * (Math.PI / 2) + radius * 0.085 + (rand() - 0.5) * 0.7;
      const y = (rand() - 0.5) * (8 + radius * 0.18);
      positions[i * 3] = Math.cos(angle) * radius + (rand() - 0.5) * 5;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(angle) * radius + (rand() - 0.5) * 5;
      const hue = rand() > 0.76 ? 0.9 : 0.51 + rand() * 0.18;
      TMP_COLOR.setHSL(hue, 0.78, 0.55 + rand() * 0.25);
      colors[i * 3] = TMP_COLOR.r;
      colors[i * 3 + 1] = TMP_COLOR.g;
      colors[i * 3 + 2] = TMP_COLOR.b;
      scales[i] = 0.5 + rand() * 2.0;
      seeds[i] = rand() * 1000;
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aScale", new THREE.BufferAttribute(scales, 1));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: this.galaxyUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aScale;
        attribute float aSeed;
        varying vec3 vColor;
        varying float vSeed;
        uniform float uTime;
        void main() {
          vColor = aColor;
          vSeed = aSeed;
          vec3 p = position;
          p.y += sin(uTime * 0.18 + aSeed) * 0.18;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = min(5.5, aScale * (190.0 / max(18.0, -mvPosition.z)));
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform float uUseMap;
        varying vec3 vColor;
        varying float vSeed;
        void main() {
          vec2 uv = gl_PointCoord.xy;
          float d = length(uv - 0.5);
          float alpha = smoothstep(0.5, 0.0, d) * 0.38;
          if (uUseMap > 0.5) {
            alpha *= texture2D(uMap, uv).a;
          }
          gl_FragColor = vec4(vColor, alpha);
        }
      `
    });

    return new THREE.Points(geometry, material);
  }

  private createWorlds(): void {
    const visibleWorlds = this.worlds.filter((world) => !world.hidden);
    const camStart = new THREE.Vector3(0, 14, 82); // keep planets clear of the spawn point
    const placed: THREE.Vector3[] = [];
    for (let i = 0; i < visibleWorlds.length; i += 1) {
      const world = visibleWorlds[i];
      // Deterministic per-world stream (loop folded in => NG+ remixes the layout on reload).
      const rand = rng((i + 1) * 1973 + this.progress.loop * 7919 + 9277);
      // Jittered golden angle so the field never reads as a regular ring.
      const angle = i * GOLDEN + 0.4 + (rand() - 0.5) * 1.2;
      // Wide, uneven radius — some planets near, some far (CORE/app pulled toward the heart).
      let radius = world.kind === "app" ? 26 + rand() * 18 : 42 + rand() * 42;
      // Full vertical spread (not a flat shell).
      let y = (rand() - 0.45) * 66;
      let pos = new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius - 8);
      // Relaxation: push outward + re-jitter height until clear of other planets AND the spawn.
      for (let pass = 0; pass < 30; pass += 1) {
        const tooCloseToSpawn = pos.distanceTo(camStart) < 30;
        const tooCloseToPlanet = placed.some((other) => pos.distanceTo(other) < 24);
        if (!tooCloseToSpawn && !tooCloseToPlanet) break;
        radius = Math.min(88, radius + 6);
        y = THREE.MathUtils.clamp(y + (rand() - 0.5) * 10, -34, 42);
        pos = new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius - 8);
      }
      // Stay inside the reachable camera box (clamp ±105 / y -48..56) with margin.
      pos.x = THREE.MathUtils.clamp(pos.x, -96, 96);
      pos.z = THREE.MathUtils.clamp(pos.z, -96, 96);
      pos.y = THREE.MathUtils.clamp(pos.y, -34, 42);
      placed.push(pos.clone());
      this.createPlanet(world, pos, i);
    }

    const hidden = this.worlds.find((world) => world.hidden);
    if (hidden) {
      this.hiddenPlanet = this.createPlanet(hidden, new THREE.Vector3(-78, 26, -70), 99);
      this.hiddenPlanet.group.visible = this.progress.hiddenPlanet;
    }
  }

  private createPlanet(world: World, position: THREE.Vector3, index: number): PlanetNode {
    const highPlanetDetail = this.quality.label === "HIGH" && !this.quality.mobile;
    const group = new THREE.Group();
    group.position.copy(position);
    group.userData.worldId = world.id;
    this.scene.add(group);

    const material = new THREE.MeshStandardMaterial({
      color: world.color,
      roughness: 0.9,
      metalness: 0.0,
      emissive: new THREE.Color(world.color),
      emissiveIntensity: 0.16,
      envMapIntensity: 0.65
    });
    if (this.quality.label !== "LOW") applyLuminanceBump(material, 0.72, world.atmosphere); // surface relief from the color map
    if (this.quality.label !== "LOW") {
      const detailMap = makePlanetDetailTexture(index, highPlanetDetail ? 768 : this.quality.label === "HIGH" ? 512 : 384);
      detailMap.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
      material.bumpMap = detailMap;
      material.bumpScale = highPlanetDetail ? 0.19 : this.quality.label === "HIGH" ? 0.16 : 0.09;
      material.roughnessMap = detailMap;
      material.roughness = highPlanetDetail ? 0.72 : this.quality.label === "HIGH" ? 0.76 : 0.84;
      if (highPlanetDetail) {
        material.displacementMap = detailMap;
        material.displacementScale = world.size * 0.022;
        material.displacementBias = -world.size * 0.011;
      }
      material.needsUpdate = true;
    }
    if (highPlanetDetail) {
      const emissionMap = makePlanetEmissionTexture(index);
      emissionMap.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
      material.emissiveMap = emissionMap;
      material.emissiveIntensity = 0.2;
      material.needsUpdate = true;

      this.loadTexture(this.planetDerivativeTexturePath(world.texture, "emission"), (texture) => {
        texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        material.emissiveMap = texture;
        material.emissiveIntensity = world.kind === "app" ? 0.3 : world.ring ? 0.25 : 0.22;
        material.needsUpdate = true;
      });

      this.loadDataTexture(this.planetDerivativeTexturePath(world.texture, "normal"), (texture) => {
        texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        material.normalMap = texture;
        material.normalScale.setScalar(world.kind === "app" ? 0.17 : world.ring ? 0.13 : 0.15);
        material.needsUpdate = true;
      });

      this.loadDataTexture(this.planetDerivativeTexturePath(world.texture, "roughness"), (texture) => {
        texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        material.roughnessMap = texture;
        material.roughness = world.kind === "app" ? 0.58 : 0.64;
        material.metalness = world.kind === "app" ? 0.06 : 0.02;
        material.needsUpdate = true;
      });
    }
    const surface = new THREE.Mesh(new THREE.SphereGeometry(world.size, this.quality.planetSegments, Math.max(24, this.quality.planetSegments / 2)), material);
    surface.userData.worldId = world.id;
    group.add(surface);
    this.pickables.push(surface);

    this.loader.load(
      assetPath(world.texture),
      (texture) => {
        if (this.disposed) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        material.map = texture;
        material.color.setHex(0xffffff);
        material.needsUpdate = true;
      },
      undefined,
      () => undefined
    );

    const atmosphere = this.createAtmosphere(world.size, world.atmosphere);
    group.add(atmosphere);

    let surfaceDetail: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | undefined;
    if (this.quality.label === "HIGH") {
      surfaceDetail = this.createPlanetSurfaceDetail(world, index);
      group.add(surfaceDetail);
    }

    let weatherLayer: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | undefined;
    if (this.quality.label === "HIGH" && !this.quality.mobile) {
      weatherLayer = this.createPlanetWeatherLayer(world, index);
      group.add(weatherLayer);
    }

    let cloudShadowLayer: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | undefined;
    if (highPlanetDetail) {
      cloudShadowLayer = this.createPlanetCloudShadowLayer(world, index);
      group.add(cloudShadowLayer);
    }

    let exosphere: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | undefined;
    if (highPlanetDetail) {
      exosphere = this.createPlanetExosphere(world, index);
      group.add(exosphere);
    }

    let atmosphericRim: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | undefined;
    if (highPlanetDetail) {
      atmosphericRim = this.createPlanetAtmosphericRim(world, index);
      group.add(atmosphericRim);
    }

    let magnetosphere: THREE.Group | undefined;
    if (highPlanetDetail) {
      magnetosphere = this.createPlanetMagnetosphere(world, index);
      group.add(magnetosphere);
    }

    let orbitalInfrastructure: THREE.Group | undefined;
    if (highPlanetDetail) {
      orbitalInfrastructure = this.createPlanetOrbitalInfrastructure(world, index);
      group.add(orbitalInfrastructure);
    }

    let terrainGlints: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | undefined;
    if (highPlanetDetail) {
      terrainGlints = this.createPlanetTerrainGlints(world, index);
      group.add(terrainGlints);
    }

    let nightNetwork: THREE.Group | undefined;
    if (highPlanetDetail) {
      nightNetwork = this.createPlanetNightNetwork(world, index);
      group.add(nightNetwork);
    }

    let clouds: THREE.Mesh | undefined;
    if (world.clouds && this.quality.label !== "LOW") {
      const cloudMaterial = new THREE.MeshStandardMaterial({
        color: world.atmosphere,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        roughness: 1,
        metalness: 0
      });
      clouds = new THREE.Mesh(
        new THREE.SphereGeometry(world.size * 1.035, Math.max(48, this.quality.planetSegments), Math.max(24, this.quality.planetSegments / 2)),
        cloudMaterial
      );
      group.add(clouds);
      this.loadTexture("assets/planet-clouds-hq.png", (texture) => {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        cloudMaterial.alphaMap = texture;
        cloudMaterial.opacity = 0.78;
        cloudMaterial.needsUpdate = true;
      });
    }

    let ring: THREE.Mesh | undefined;
    if (world.ring) {
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: world.atmosphere,
        transparent: true,
        opacity: 0.46,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false
      });
      const ringSegments = highPlanetDetail ? 256 : 128;
      ring = new THREE.Mesh(new THREE.RingGeometry(world.size * 1.45, world.size * 2.26, ringSegments), ringMaterial);
      ring.rotation.x = Math.PI / 2 - 0.34;
      group.add(ring);
      const ringTexture = this.quality.label === "LOW" ? "assets/planet-ring.png" : "assets/planet-ring-hq.png";
      this.loadTexture(ringTexture, (texture) => {
        ringMaterial.map = texture;
        ringMaterial.needsUpdate = true;
      });
    }

    let ringDebris: THREE.Group | undefined;
    if (world.ring && highPlanetDetail) {
      ringDebris = this.createPlanetRingDebris(world, index);
      group.add(ringDebris);
    }

    let moonlets: THREE.InstancedMesh | undefined;
    if (this.quality.label === "HIGH" && !this.quality.mobile && world.kind === "game") {
      moonlets = this.createPlanetMoonlets(world, index);
      group.add(moonlets);
    }

    const beacon = this.createBeacon(world.atmosphere);
    beacon.visible = world.kind === "app";
    group.add(beacon);

    const node: PlanetNode = {
      group,
      world,
      surface,
      atmosphere,
      surfaceDetail,
      weatherLayer,
      cloudShadowLayer,
      terrainGlints,
      nightNetwork,
      exosphere,
      atmosphericRim,
      magnetosphere,
      orbitalInfrastructure,
      moonlets,
      ring,
      ringDebris,
      clouds,
      beacon,
      radius: 0.02 + index * 0.003,
      phase: index * 1.2,
      completed: false
    };
    if (highPlanetDetail) {
      surface.castShadow = true;
      surface.receiveShadow = true;
      if (ringDebris) this.enableHighDetailShadows(ringDebris);
      if (moonlets) this.enableHighDetailShadows(moonlets);
      if (orbitalInfrastructure) this.enableHighDetailShadows(orbitalInfrastructure);
    }
    this.planets.set(world.id, node);
    return node;
  }

  private createPlanetRingDebris(world: World, index: number): THREE.Group {
    const group = new THREE.Group();
    group.rotation.x = Math.PI / 2 - 0.34;
    group.rotation.y = 0.04 + index * 0.025;
    group.userData.particleBudget = 0;

    const rand = rng(8723 + index * 311);
    const rockCount = world.kind === "app" ? 260 : 180;
    const geometry = new THREE.IcosahedronGeometry(Math.max(0.018, world.size * 0.018), 0);
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(world.atmosphere).lerp(new THREE.Color(0xf7fbff), 0.34),
      roughness: 0.86,
      metalness: world.kind === "app" ? 0.1 : 0.04,
      emissive: new THREE.Color(world.atmosphere),
      emissiveIntensity: 0.035,
      envMapIntensity: 0.42,
      transparent: true,
      opacity: 0.72,
      depthWrite: false
    });
    const rocks = new THREE.InstancedMesh(geometry, material, rockCount);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (let i = 0; i < rockCount; i += 1) {
      const lane = rand();
      const radius = world.size * (1.56 + lane * 0.78 + (rand() - 0.5) * 0.08);
      const angle = (i / rockCount) * Math.PI * 2 + rand() * 0.08;
      const arcGap = 0.76 + Math.sin(angle * (3 + (index % 3)) + index) * 0.12;
      const y = (rand() - 0.5) * world.size * 0.11;
      dummy.position.set(Math.cos(angle) * radius * arcGap, y, Math.sin(angle) * radius * (0.72 + rand() * 0.06));
      dummy.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
      const scale = 0.32 + Math.pow(rand(), 2.3) * (world.kind === "app" ? 2.4 : 1.75);
      dummy.scale.set(scale * (0.65 + rand() * 1.4), scale * (0.5 + rand() * 1.0), scale * (0.55 + rand() * 1.1));
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
      color.set(world.atmosphere).lerp(new THREE.Color(rand() > 0.55 ? 0xfff3d0 : 0xc8fff8), 0.2 + rand() * 0.34);
      rocks.setColorAt(i, color);
    }

    rocks.instanceMatrix.needsUpdate = true;
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    rocks.renderOrder = 3;
    group.add(rocks);

    const sparkCount = world.kind === "app" ? 520 : 360;
    const positions = new Float32Array(sparkCount * 3);
    const colors = new Float32Array(sparkCount * 3);
    const sizes = new Float32Array(sparkCount);
    const phases = new Float32Array(sparkCount);
    const accent = new THREE.Color(world.atmosphere);
    for (let i = 0; i < sparkCount; i += 1) {
      const radius = world.size * (1.45 + rand() * 0.92);
      const angle = rand() * Math.PI * 2;
      const band = Math.sin(angle * (4.0 + index * 0.3)) * world.size * 0.025;
      const p = i * 3;
      positions[p] = Math.cos(angle) * radius * (0.9 + rand() * 0.1);
      positions[p + 1] = (rand() - 0.5) * world.size * 0.16 + band;
      positions[p + 2] = Math.sin(angle) * radius * (0.68 + rand() * 0.08);
      TMP_COLOR.copy(accent).lerp(new THREE.Color(rand() > 0.7 ? 0xffe3aa : 0xbffff5), 0.18 + rand() * 0.44);
      colors[p] = TMP_COLOR.r;
      colors[p + 1] = TMP_COLOR.g;
      colors[p + 2] = TMP_COLOR.b;
      sizes[i] = 0.52 + Math.pow(rand(), 3.0) * 2.4;
      phases[i] = rand() * 1000;
    }

    const sparkGeometry = new THREE.BufferGeometry();
    sparkGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    sparkGeometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    sparkGeometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    sparkGeometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    const sparkMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMap: { value: makeGlowTexture(128) },
        uCompleted: { value: 0 }
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aPhase;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uTime;
        uniform float uCompleted;
        void main() {
          vColor = mix(aColor, vec3(1.0, 0.76, 0.38), uCompleted * 0.45);
          vec3 p = position;
          p.y += sin(uTime * 0.22 + aPhase) * 0.025;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          float depth = max(1.0, -mvPosition.z);
          vAlpha = (0.5 + fract(aPhase) * 0.5) * (0.74 + uCompleted * 0.26);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(aSize * (180.0 / depth), 0.7, 5.8);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float alpha = tex.a * vAlpha * 0.42;
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(vColor * (0.58 + tex.a * 1.18), clamp(alpha, 0.0, 0.72));
        }
      `
    });
    this.animatedMaterials.push(sparkMaterial);
    const sparks = new THREE.Points(sparkGeometry, sparkMaterial);
    sparks.renderOrder = 4;
    group.add(sparks);
    group.userData.particleBudget = rockCount + sparkCount;

    return group;
  }

  private createPlanetOrbitalInfrastructure(world: World, index: number): THREE.Group {
    const group = new THREE.Group();
    group.rotation.set(0.42 + index * 0.08, 0.18 + index * 0.11, -0.24 + index * 0.05);
    group.userData.particleBudget = 0;

    const rand = rng(80321 + index * 719);
    const accent = new THREE.Color(world.atmosphere);
    const warm = new THREE.Color(0xffd79a);
    const cool = new THREE.Color(0xbffff6);

    const arcMaterial = new THREE.MeshStandardMaterial({
      color: accent.clone().lerp(cool, 0.34),
      roughness: 0.32,
      metalness: 0.74,
      emissive: accent,
      emissiveIntensity: world.kind === "app" ? 0.22 : 0.14,
      envMapIntensity: 1.55,
      transparent: true,
      opacity: world.kind === "app" ? 0.46 : 0.34,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false
    });

    const arcCount = world.kind === "app" ? 5 : world.ring ? 4 : 3;
    for (let i = 0; i < arcCount; i += 1) {
      const orbit = world.size * (1.48 + i * 0.22 + rand() * 0.12);
      const arc = Math.PI * (0.82 + rand() * 0.88);
      const tube = world.size * (0.006 + rand() * 0.006);
      const rail = new THREE.Mesh(new THREE.TorusGeometry(orbit, tube, 8, 172, arc), arcMaterial.clone());
      rail.rotation.set(Math.PI / 2 - 0.34 + (rand() - 0.5) * 0.45, (rand() - 0.5) * 0.8, rand() * Math.PI * 2);
      rail.renderOrder = 5;
      group.add(rail);
    }

    const moduleCount = world.kind === "app" ? 34 : 20 + (index % 3) * 4;
    const moduleGeometry = new THREE.BoxGeometry(1, 0.045, 0.28);
    const moduleMaterial = new THREE.MeshStandardMaterial({
      color: 0xaebfca,
      roughness: 0.38,
      metalness: 0.66,
      emissive: accent.clone().multiplyScalar(0.32),
      emissiveIntensity: 0.08,
      envMapIntensity: 1.45,
      vertexColors: true
    });
    const modules = new THREE.InstancedMesh(moduleGeometry, moduleMaterial, moduleCount);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (let i = 0; i < moduleCount; i += 1) {
      const a = (i / moduleCount) * Math.PI * 2 + rand() * 0.2;
      const belt = world.size * (1.72 + Math.pow(rand(), 1.5) * 0.62);
      const y = (rand() - 0.5) * world.size * (world.kind === "app" ? 0.56 : 0.34);
      dummy.position.set(Math.cos(a) * belt, y, Math.sin(a) * belt * (0.68 + rand() * 0.1));
      dummy.lookAt(0, 0, 0);
      dummy.rotateZ((rand() - 0.5) * 0.85);
      const scale = world.size * (0.16 + rand() * 0.19);
      dummy.scale.set(scale * (1.8 + rand() * 2.4), scale * (0.52 + rand() * 0.84), scale * (0.38 + rand() * 0.72));
      dummy.updateMatrix();
      modules.setMatrixAt(i, dummy.matrix);
      color.copy(accent).lerp(rand() > 0.62 ? warm : cool, 0.24 + rand() * 0.36);
      modules.setColorAt(i, color);
    }
    modules.instanceMatrix.needsUpdate = true;
    if (modules.instanceColor) modules.instanceColor.needsUpdate = true;
    modules.renderOrder = 4;
    group.add(modules);

    const mastCount = world.kind === "app" ? 14 : 8;
    const mastGeometry = new THREE.CylinderGeometry(world.size * 0.012, world.size * 0.018, world.size * 0.62, 6, 1);
    const mastMaterial = new THREE.MeshStandardMaterial({
      color: 0xc8d6dd,
      roughness: 0.48,
      metalness: 0.72,
      emissive: accent,
      emissiveIntensity: 0.08,
      envMapIntensity: 1.35,
      vertexColors: true
    });
    const masts = new THREE.InstancedMesh(mastGeometry, mastMaterial, mastCount);
    for (let i = 0; i < mastCount; i += 1) {
      const a = rand() * Math.PI * 2;
      const belt = world.size * (1.38 + rand() * 0.78);
      dummy.position.set(Math.cos(a) * belt, (rand() - 0.5) * world.size * 0.64, Math.sin(a) * belt * 0.72);
      dummy.lookAt(0, 0, 0);
      dummy.rotateX(Math.PI / 2);
      const s = 0.65 + rand() * 1.7;
      dummy.scale.set(s, s, s * (0.9 + rand() * 1.8));
      dummy.updateMatrix();
      masts.setMatrixAt(i, dummy.matrix);
      color.copy(accent).lerp(cool, 0.2 + rand() * 0.4);
      masts.setColorAt(i, color);
    }
    masts.instanceMatrix.needsUpdate = true;
    if (masts.instanceColor) masts.instanceColor.needsUpdate = true;
    masts.renderOrder = 4;
    group.add(masts);

    const lightCount = world.kind === "app" ? 150 : 92;
    const positions = new Float32Array(lightCount * 3);
    const colors = new Float32Array(lightCount * 3);
    const sizes = new Float32Array(lightCount);
    const phases = new Float32Array(lightCount);
    for (let i = 0; i < lightCount; i += 1) {
      const a = rand() * Math.PI * 2;
      const lane = rand() > 0.5 ? 1 : -1;
      const belt = world.size * (1.42 + rand() * 1.22);
      const p = i * 3;
      positions[p] = Math.cos(a) * belt * (0.9 + rand() * 0.08);
      positions[p + 1] = lane * world.size * (0.1 + rand() * 0.46);
      positions[p + 2] = Math.sin(a) * belt * (0.58 + rand() * 0.2);
      TMP_COLOR.copy(accent).lerp(rand() > 0.68 ? warm : cool, 0.26 + rand() * 0.42);
      colors[p] = TMP_COLOR.r;
      colors[p + 1] = TMP_COLOR.g;
      colors[p + 2] = TMP_COLOR.b;
      sizes[i] = 0.32 + Math.pow(rand(), 2.1) * (world.kind === "app" ? 2.35 : 1.6);
      phases[i] = rand() * 1000;
    }

    const lightGeometry = new THREE.BufferGeometry();
    lightGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    lightGeometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    lightGeometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    lightGeometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    const lightMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMap: { value: makeGlowTexture(96) }
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aPhase;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uTime;
        void main() {
          vColor = aColor;
          vec3 p = position;
          p.y += sin(uTime * 0.55 + aPhase) * 0.012;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          float depth = max(1.0, -mvPosition.z);
          float pulse = 0.68 + 0.32 * sin(uTime * (0.62 + fract(aPhase) * 1.2) + aPhase);
          vAlpha = pulse * (0.46 + fract(aPhase) * 0.54);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(aSize * (155.0 / depth), 0.65, 6.5);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float alpha = tex.a * vAlpha * 0.58;
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(vColor * (0.62 + tex.a * 1.35), clamp(alpha, 0.0, 0.76));
        }
      `
    });
    this.animatedMaterials.push(lightMaterial);
    const lights = new THREE.Points(lightGeometry, lightMaterial);
    lights.renderOrder = 6;
    group.add(lights);

    this.enableHighDetailShadows(group);
    group.userData.particleBudget = arcCount * 172 + moduleCount + mastCount + lightCount;
    return group;
  }

  private createPlanetNightNetwork(world: World, index: number): THREE.Group {
    const group = new THREE.Group();
    group.userData.particleBudget = 0;

    const rand = rng(92011 + index * 1777);
    const accent = new THREE.Color(world.atmosphere);
    const warm = new THREE.Color(world.kind === "app" ? 0xffc06f : 0xff8a58);
    const cool = new THREE.Color(world.kind === "game" ? 0x33e7c8 : 0x8aa7ff);
    const radius = world.size * 1.041;
    const linePositions: number[] = [];
    const lineColors: number[] = [];
    const lineAlphas: number[] = [];
    const nodePositions: number[] = [];
    const nodeColors: number[] = [];
    const nodeSizes: number[] = [];
    const nodePhases: number[] = [];
    const rings = world.kind === "game" ? 11 : 8;
    const steps = world.kind === "game" ? 52 : 42;

    const pushVertex = (point: THREE.Vector3, color: THREE.Color, alpha: number): void => {
      linePositions.push(point.x, point.y, point.z);
      lineColors.push(color.r, color.g, color.b);
      lineAlphas.push(alpha);
    };

    const pushNode = (point: THREE.Vector3, color: THREE.Color, size: number, phase: number): void => {
      nodePositions.push(point.x, point.y, point.z);
      nodeColors.push(color.r, color.g, color.b);
      nodeSizes.push(size);
      nodePhases.push(phase);
    };

    for (let band = 0; band < rings; band += 1) {
      const baseLat = -0.72 + (band / Math.max(1, rings - 1)) * 1.44;
      const lat = THREE.MathUtils.clamp(baseLat + (rand() - 0.5) * 0.09, -0.82, 0.82);
      const ring = Math.sqrt(Math.max(0.02, 1 - lat * lat));
      const bandPhase = rand() * Math.PI * 2;
      for (let step = 0; step < steps; step += 1) {
        if (rand() < 0.32) continue;
        const thetaA = (step / steps) * Math.PI * 2 + bandPhase;
        const thetaB = ((step + 0.82 + rand() * 0.28) / steps) * Math.PI * 2 + bandPhase;
        const jitterA = 1 + (rand() - 0.5) * 0.018;
        const jitterB = 1 + (rand() - 0.5) * 0.018;
        const pA = new THREE.Vector3(Math.cos(thetaA) * ring * radius * jitterA, lat * radius, Math.sin(thetaA) * ring * radius * jitterA);
        const pB = new THREE.Vector3(Math.cos(thetaB) * ring * radius * jitterB, (lat + (rand() - 0.5) * 0.018) * radius, Math.sin(thetaB) * ring * radius * jitterB);
        TMP_COLOR.copy(accent).lerp(rand() > 0.58 ? warm : cool, 0.24 + rand() * 0.42);
        if (rand() > 0.9) TMP_COLOR.lerp(new THREE.Color(0xffffff), 0.28);
        const alpha = 0.08 + Math.pow(rand(), 2.1) * 0.34;
        pushVertex(pA, TMP_COLOR, alpha);
        pushVertex(pB, TMP_COLOR, alpha);
        if (rand() > 0.56) pushNode(pA, TMP_COLOR, 2.0 + rand() * 4.6, rand() * 1000);
      }
    }

    const meridians = world.kind === "game" ? 34 : 24;
    for (let i = 0; i < meridians; i += 1) {
      const theta = rand() * Math.PI * 2;
      const latA = -0.78 + rand() * 1.56;
      const span = 0.06 + Math.pow(rand(), 1.4) * 0.24;
      const latB = THREE.MathUtils.clamp(latA + (rand() > 0.5 ? span : -span), -0.84, 0.84);
      const ringA = Math.sqrt(Math.max(0.02, 1 - latA * latA));
      const ringB = Math.sqrt(Math.max(0.02, 1 - latB * latB));
      const thetaB = theta + (rand() - 0.5) * 0.04;
      const pA = new THREE.Vector3(Math.cos(theta) * ringA * radius, latA * radius, Math.sin(theta) * ringA * radius);
      const pB = new THREE.Vector3(Math.cos(thetaB) * ringB * radius, latB * radius, Math.sin(thetaB) * ringB * radius);
      TMP_COLOR.copy(cool).lerp(warm, rand() * 0.35).lerp(accent, 0.26);
      const alpha = 0.06 + rand() * 0.18;
      pushVertex(pA, TMP_COLOR, alpha);
      pushVertex(pB, TMP_COLOR, alpha);
      if (rand() > 0.42) pushNode(rand() > 0.5 ? pA : pB, TMP_COLOR, 2.4 + rand() * 5.2, rand() * 1000);
    }

    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
    lineGeometry.setAttribute("aColor", new THREE.Float32BufferAttribute(lineColors, 3));
    lineGeometry.setAttribute("aAlpha", new THREE.Float32BufferAttribute(lineAlphas, 1));
    const lineMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSunDirection: { value: this.sunDir.clone() },
        uCompleted: { value: 0 }
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aAlpha;
        uniform float uTime;
        uniform vec3 uSunDirection;
        uniform float uCompleted;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vec4 mvPosition = viewMatrix * wp;
          vec3 N = normalize(mat3(modelMatrix) * normalize(position));
          vec3 V = normalize(cameraPosition - wp.xyz);
          vec3 L = normalize(uSunDirection);
          float sun = dot(N, L);
          float night = smoothstep(0.22, -0.24, sun);
          float day = smoothstep(-0.05, 0.68, sun);
          float front = smoothstep(-0.08, 0.24, dot(N, V));
          float pulse = 0.78 + 0.22 * sin(uTime * (0.5 + aAlpha * 1.7) + position.x * 1.9 + position.y * 2.3);
          vColor = mix(aColor, vec3(1.0, 0.72, 0.38), uCompleted * 0.18 + day * 0.08);
          vAlpha = aAlpha * front * pulse * (night * 1.05 + day * 0.18) * (0.78 + uCompleted * 0.48);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          if (vAlpha < 0.004) discard;
          gl_FragColor = vec4(vColor * 1.35, clamp(vAlpha, 0.0, 0.42));
        }
      `
    });
    this.animatedMaterials.push(lineMaterial);
    const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
    lines.renderOrder = 6;
    group.add(lines);

    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute("position", new THREE.Float32BufferAttribute(nodePositions, 3));
    pointGeometry.setAttribute("aColor", new THREE.Float32BufferAttribute(nodeColors, 3));
    pointGeometry.setAttribute("aSize", new THREE.Float32BufferAttribute(nodeSizes, 1));
    pointGeometry.setAttribute("aPhase", new THREE.Float32BufferAttribute(nodePhases, 1));
    const pointMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMap: { value: makeGlowTexture(128) },
        uSunDirection: { value: this.sunDir.clone() },
        uCompleted: { value: 0 }
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aPhase;
        uniform float uTime;
        uniform vec3 uSunDirection;
        uniform float uCompleted;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vec4 mvPosition = viewMatrix * wp;
          vec3 N = normalize(mat3(modelMatrix) * normalize(position));
          vec3 V = normalize(cameraPosition - wp.xyz);
          vec3 L = normalize(uSunDirection);
          float sun = dot(N, L);
          float night = smoothstep(0.22, -0.28, sun);
          float day = smoothstep(-0.08, 0.7, sun);
          float front = smoothstep(-0.06, 0.28, dot(N, V));
          float pulse = 0.65 + 0.35 * sin(uTime * (0.9 + fract(aPhase) * 1.8) + aPhase);
          vColor = mix(aColor, vec3(1.0, 0.78, 0.42), day * 0.16 + uCompleted * 0.24);
          vAlpha = front * pulse * (night * 0.92 + day * 0.12) * (0.72 + uCompleted * 0.62);
          float depth = max(1.0, -mvPosition.z);
          gl_PointSize = clamp(aSize * (180.0 / depth), 0.7, 6.2);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float alpha = tex.a * vAlpha * 0.62;
          if (alpha < 0.006) discard;
          gl_FragColor = vec4(vColor * (0.72 + tex.a * 1.6), clamp(alpha, 0.0, 0.82));
        }
      `
    });
    this.animatedMaterials.push(pointMaterial);
    const points = new THREE.Points(pointGeometry, pointMaterial);
    points.renderOrder = 7;
    group.add(points);

    group.userData.particleBudget = linePositions.length / 3 + nodePositions.length / 3;
    return group;
  }

  private createPlanetMoonlets(world: World, index: number): THREE.InstancedMesh {
    const count = world.ring ? 42 : 18 + (index % 3) * 8;
    const geometry = new THREE.IcosahedronGeometry(Math.max(0.055, world.size * 0.032), 0);
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(world.color).lerp(new THREE.Color(0xddefff), 0.18),
      roughness: 0.92,
      metalness: 0.08,
      emissive: new THREE.Color(world.atmosphere),
      emissiveIntensity: 0.025,
      envMapIntensity: 0.32
    });
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const rand = rng(5209 + index * 97);
    const dummy = new THREE.Object3D();
    const tilt = world.ring ? 0.28 : 0.52 + rand() * 0.34;

    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * Math.PI * 2 + rand() * 0.28;
      const belt = world.size * (world.ring ? 2.55 : 1.9 + rand() * 0.88);
      const eccentric = 1 + (rand() - 0.5) * 0.22;
      dummy.position.set(Math.cos(a) * belt * eccentric, (rand() - 0.5) * world.size * 0.18, Math.sin(a) * belt * 0.72);
      dummy.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
      dummy.scale.setScalar(0.42 + rand() * 1.85);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.rotation.set(Math.PI / 2 - tilt, 0.1 + rand() * 0.7, rand() * Math.PI);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.worldId = world.id;
    return mesh;
  }

  private createPlanetMagnetosphere(world: World, index: number): THREE.Group {
    const group = new THREE.Group();
    group.rotation.set(0.28 + index * 0.017, 0.12 + index * 0.041, -0.18 + index * 0.011);
    group.userData.particleBudget = 0;
    const rand = rng(33031 + index * 523);
    const lineCount = world.kind === "app" ? 7 : world.ring ? 6 : 5;
    const accent = new THREE.Color(world.atmosphere);

    for (let line = 0; line < lineCount; line += 1) {
      const phase = (line / lineCount) * Math.PI * 2 + rand() * 0.08;
      const radius = world.size * (1.26 + line * 0.13 + rand() * 0.08);
      const height = world.size * (1.03 + rand() * 0.42);
      const twist = 0.12 + rand() * 0.18;
      const points: THREE.Vector3[] = [];
      for (let i = 0; i <= 32; i += 1) {
        const t = i / 32;
        const a = -Math.PI * 0.82 + t * Math.PI * 1.64;
        const local = new THREE.Vector3(
          Math.cos(a) * radius,
          Math.sin(a) * height,
          Math.sin(a * 2.0 + phase) * world.size * twist
        );
        local.applyAxisAngle(TMP_VEC.set(0, 1, 0), phase);
        points.push(local);
      }
      const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.42);
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: accent.clone().lerp(new THREE.Color(0xffffff), 0.12 + rand() * 0.18) },
          uAlpha: { value: 0.24 + rand() * 0.1 },
          uSeed: { value: rand() * 1000 },
          uCompleted: { value: 0 }
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: false,
        vertexShader: `
          varying vec2 vUv;
          varying float vDepth;
          void main() {
            vUv = uv;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            vDepth = -mvPosition.z;
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uAlpha;
          uniform float uSeed;
          uniform float uCompleted;
          uniform vec3 uColor;
          varying vec2 vUv;
          varying float vDepth;
          void main() {
            float tube = pow(1.0 - abs(vUv.x - 0.5) * 2.0, 1.6);
            float packet = pow(sin(vUv.y * 24.0 - uTime * (0.42 + uCompleted * 0.18) + uSeed) * 0.5 + 0.5, 5.0);
            float beads = pow(sin(vUv.y * 72.0 + uSeed * 0.37 + uTime * 0.16) * 0.5 + 0.5, 11.0);
            float depthFade = smoothstep(16.0, 38.0, vDepth) * (1.0 - smoothstep(150.0, 225.0, vDepth));
            float alpha = (tube * 0.84 + packet * 0.42 + beads * 0.34) * depthFade * uAlpha * (0.88 + uCompleted * 0.46);
            vec3 hot = mix(uColor, vec3(1.0, 0.74, 0.42), packet * 0.24 + uCompleted * 0.22);
            if (alpha < 0.003) discard;
            gl_FragColor = vec4(hot * (0.76 + packet * 0.9 + beads * 0.68), clamp(alpha, 0.0, 0.48));
          }
        `
      });
      this.animatedMaterials.push(material);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 96, Math.max(0.008, world.size * 0.0065), 6, false), material);
      tube.renderOrder = 5;
      tube.frustumCulled = false;
      group.add(tube);
    }

    const particleCount = world.kind === "app" ? 420 : world.ring ? 360 : 300;
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    const phases = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i += 1) {
      const lane = Math.floor(rand() * lineCount);
      const phase = (lane / lineCount) * Math.PI * 2 + (rand() - 0.5) * 0.24;
      const t = rand();
      const a = -Math.PI * 0.84 + t * Math.PI * 1.68;
      const radius = world.size * (1.18 + lane * 0.13 + rand() * 0.24);
      const height = world.size * (0.96 + rand() * 0.54);
      const local = new THREE.Vector3(
        Math.cos(a) * radius,
        Math.sin(a) * height + (rand() - 0.5) * world.size * 0.08,
        Math.sin(a * 2.0 + phase) * world.size * (0.12 + rand() * 0.18)
      );
      local.applyAxisAngle(TMP_VEC.set(0, 1, 0), phase);
      const p = i * 3;
      positions[p] = local.x;
      positions[p + 1] = local.y;
      positions[p + 2] = local.z;
      TMP_COLOR.copy(accent).lerp(new THREE.Color(rand() > 0.72 ? 0xffd99a : 0xdfffff), 0.18 + rand() * 0.48);
      colors[p] = TMP_COLOR.r;
      colors[p + 1] = TMP_COLOR.g;
      colors[p + 2] = TMP_COLOR.b;
      sizes[i] = 0.7 + Math.pow(rand(), 2.8) * 3.6;
      phases[i] = rand() * 1000;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    const particleMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMap: { value: makeGlowTexture(128) },
        uCompleted: { value: 0 }
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aPhase;
        uniform float uTime;
        uniform float uCompleted;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = mix(aColor, vec3(1.0, 0.72, 0.36), uCompleted * 0.32);
          vec3 p = position;
          p.y += sin(uTime * 0.26 + aPhase) * 0.018;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          float depth = max(1.0, -mvPosition.z);
          float flow = 0.72 + 0.28 * sin(uTime * (0.55 + fract(aPhase) * 0.8) + aPhase * 7.1);
          vAlpha = flow * (0.7 + uCompleted * 0.36);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(aSize * (190.0 / depth), 0.75, 6.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float alpha = tex.a * vAlpha * 0.48;
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(vColor * (0.84 + tex.a * 1.32), clamp(alpha, 0.0, 0.78));
        }
      `
    });
    this.animatedMaterials.push(particleMaterial);
    const particles = new THREE.Points(geometry, particleMaterial);
    particles.renderOrder = 6;
    particles.frustumCulled = false;
    group.add(particles);
    group.userData.particleBudget = particleCount + lineCount * 96;
    return group;
  }

  private createPlanetSurfaceDetail(world: World, index: number): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSeed: { value: index * 17.19 + world.size * 3.7 },
        uBase: { value: new THREE.Color(world.color) },
        uAccent: { value: new THREE.Color(world.atmosphere) },
        uSunDirection: { value: this.sunDir.clone() },
        uCompleted: { value: 0 }
      },
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      blending: THREE.NormalBlending,
      fog: false,
      vertexShader: `
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        varying vec3 vLocalNormal;
        void main() {
          vLocalNormal = normalize(normal);
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uSeed;
        uniform vec3 uBase;
        uniform vec3 uAccent;
        uniform vec3 uSunDirection;
        uniform float uCompleted;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        varying vec3 vLocalNormal;

        float hash(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 74.7);
          return fract(p.x * p.y);
        }

        void main() {
          vec3 N = normalize(vWorldNormal);
          vec3 localN = normalize(vLocalNormal);
          vec3 V = normalize(cameraPosition - vWorldPos);
          vec3 L = normalize(uSunDirection);
          float lightFacing = dot(N, L);
          float day = smoothstep(-0.18, 0.62, lightFacing);
          float night = smoothstep(0.22, -0.26, lightFacing);
          float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
          vec2 uv = vec2(atan(localN.z, localN.x) / 6.2831853 + 0.5, asin(localN.y) / 3.1415926 + 0.5);
          float ridge = sin(uv.x * 58.0 + sin(uv.y * 18.0 + uSeed) * 3.3 + uSeed) * 0.5 + 0.5;
          float fine = sin((uv.x + uv.y) * 190.0 + sin(uv.x * 21.0 + uSeed) * 1.7) * 0.5 + 0.5;
          float cells = hash(floor(uv * vec2(42.0, 24.0) + uSeed));
          float cityGrid = hash(floor(uv * vec2(96.0, 52.0) + uSeed * 1.41));
          float crack = smoothstep(0.77, 0.97, ridge) * (0.45 + fine * 0.55);
          float mineral = smoothstep(0.58, 0.95, cells) * smoothstep(0.25, 0.85, fine);
          float lanes = smoothstep(0.8, 0.985, ridge) * smoothstep(0.36, 0.96, fine);
          float nodes = smoothstep(0.915, 0.998, cityGrid) * smoothstep(0.42, 0.98, fine);
          float latitudeMask = 1.0 - smoothstep(0.4, 0.95, abs(localN.y));
          float aurora = smoothstep(0.46, 0.86, abs(localN.y)) * (0.35 + hash(floor(uv * vec2(54.0, 12.0) + uSeed)) * 0.65);
          vec3 shadowInk = mix(uBase * 0.16, vec3(0.0, 0.015, 0.025), 0.42);
          vec3 highlight = mix(uAccent * 0.85, vec3(1.0, 0.82, 0.48), mineral * 0.45);
          vec3 color = mix(shadowInk, highlight, mineral * 0.72 + rim * 0.22);
          color += uAccent * rim * 0.35;
          float nightEnergy = (lanes * 0.38 + nodes * 0.92) * night * latitudeMask * (0.68 + uCompleted * 0.72);
          vec3 nightGlow = mix(uAccent * 0.85, vec3(1.0, 0.7, 0.38), 0.25 + uCompleted * 0.25);
          color += nightGlow * nightEnergy;
          color += uAccent * aurora * night * 0.11;
          float equatorFade = 1.0 - smoothstep(0.42, 0.95, abs(localN.y));
          float alpha = ((crack * 0.18 + mineral * 0.13) * day + rim * 0.12 + nightEnergy * 0.22) * equatorFade;
          alpha += aurora * night * 0.045;
          gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.42));
        }
      `
    });
    const detail = new THREE.Mesh(
      new THREE.SphereGeometry(world.size * 1.008, this.quality.planetSegments, Math.max(24, this.quality.planetSegments / 2)),
      material
    );
    detail.userData.worldId = world.id;
    return detail;
  }

  private createPlanetWeatherLayer(world: World, index: number): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSeed: { value: index * 13.71 + world.size * 2.1 },
        uBase: { value: new THREE.Color(world.color) },
        uAccent: { value: new THREE.Color(world.atmosphere) },
        uSunDirection: { value: this.sunDir.clone() },
        uCompleted: { value: 0 }
      },
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      blending: THREE.NormalBlending,
      fog: false,
      vertexShader: `
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        varying vec3 vLocalNormal;
        void main() {
          vLocalNormal = normalize(normal);
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uSeed;
        uniform vec3 uBase;
        uniform vec3 uAccent;
        uniform vec3 uSunDirection;
        uniform float uCompleted;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        varying vec3 vLocalNormal;

        float hash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }

        float fbm(vec2 p) {
          float v = 0.0;
          float amp = 0.5;
          mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
          for (int i = 0; i < 5; i++) {
            v += noise(p) * amp;
            p = rot * p * 2.03 + 9.17;
            amp *= 0.5;
          }
          return v;
        }

        void main() {
          vec3 N = normalize(vWorldNormal);
          vec3 localN = normalize(vLocalNormal);
          vec3 V = normalize(cameraPosition - vWorldPos);
          vec3 L = normalize(uSunDirection);
          float sun = dot(N, L);
          float day = smoothstep(-0.22, 0.58, sun);
          float night = smoothstep(0.12, -0.32, sun);
          float rim = pow(1.0 - max(dot(N, V), 0.0), 2.35);
          vec2 uv = vec2(atan(localN.z, localN.x) / 6.2831853 + 0.5, asin(localN.y) / 3.1415926 + 0.5);
          vec2 flow = uv * vec2(3.3, 1.55) + vec2(uTime * 0.018, sin(uTime * 0.025 + uSeed) * 0.035) + uSeed;
          float broad = fbm(flow);
          float shear = fbm(flow * vec2(2.7, 5.8) + vec2(-uTime * 0.036, uSeed * 0.37));
          float fine = fbm(flow * 8.2 + vec2(uTime * 0.06, -uSeed));
          float bands = smoothstep(0.46, 0.82, broad + sin((uv.y + shear * 0.12) * 32.0 + uSeed) * 0.11);
          float wisps = smoothstep(0.54, 0.86, fine) * smoothstep(0.18, 0.92, shear);
          vec2 stormUv = (uv - vec2(0.36 + fract(uSeed * 0.137) * 0.28, 0.44 + fract(uSeed * 0.091) * 0.18)) * vec2(13.0, 8.0);
          float storm = smoothstep(0.78, 0.98, fbm(stormUv + vec2(uTime * 0.045, -uTime * 0.018)));
          float latitudeMask = 1.0 - smoothstep(0.72, 0.98, abs(localN.y));
          float cloud = (bands * 0.62 + wisps * 0.48 + storm * 0.78) * latitudeMask;
          vec3 pearl = mix(vec3(0.72, 0.78, 0.84), vec3(1.0, 0.9, 0.68), broad * 0.45 + storm * 0.55);
          vec3 color = mix(uAccent * 0.45 + uBase * 0.12, pearl, 0.68 + storm * 0.22);
          color += uAccent * rim * 0.28;
          color += mix(uAccent, vec3(1.0, 0.62, 0.32), 0.38) * storm * uCompleted * 0.14;
          float alpha = cloud * day * 0.15 + rim * (0.055 + cloud * 0.08) + storm * night * 0.052;
          alpha += wisps * night * uCompleted * 0.032;
          gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.24));
        }
      `
    });
    const weather = new THREE.Mesh(
      new THREE.SphereGeometry(world.size * 1.022, this.quality.planetSegments, Math.max(24, this.quality.planetSegments / 2)),
      material
    );
    weather.userData.worldId = world.id;
    return weather;
  }

  private createPlanetCloudShadowLayer(world: World, index: number): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSeed: { value: index * 19.41 + world.size * 5.3 },
        uBase: { value: new THREE.Color(world.color) },
        uAccent: { value: new THREE.Color(world.atmosphere) },
        uSunDirection: { value: this.sunDir.clone() },
        uCompleted: { value: 0 }
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.FrontSide,
      blending: THREE.NormalBlending,
      fog: false,
      vertexShader: `
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        varying vec3 vLocalNormal;
        void main() {
          vLocalNormal = normalize(normal);
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uSeed;
        uniform vec3 uBase;
        uniform vec3 uAccent;
        uniform vec3 uSunDirection;
        uniform float uCompleted;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        varying vec3 vLocalNormal;

        float hash(vec2 p) {
          p = fract(p * vec2(193.41, 297.73));
          p += dot(p, p + 67.19);
          return fract(p.x * p.y);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }

        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          mat2 rot = mat2(0.74, -0.67, 0.67, 0.74);
          for (int i = 0; i < 5; i++) {
            v += noise(p) * a;
            p = rot * p * 2.08 + vec2(5.1, 3.7);
            a *= 0.52;
          }
          return v;
        }

        void main() {
          vec3 N = normalize(vWorldNormal);
          vec3 localN = normalize(vLocalNormal);
          vec3 V = normalize(cameraPosition - vWorldPos);
          vec3 L = normalize(uSunDirection);
          float sun = dot(N, L);
          float day = smoothstep(-0.18, 0.62, sun);
          float lowSun = smoothstep(0.36, -0.12, abs(sun));
          float facing = smoothstep(-0.24, 0.88, dot(N, V));
          vec2 uv = vec2(atan(localN.z, localN.x) / 6.2831853 + 0.5, asin(localN.y) / 3.1415926 + 0.5);
          vec2 flow = uv * vec2(4.2, 2.0) + vec2(uTime * 0.014, -uTime * 0.008) + uSeed;
          float broad = fbm(flow);
          float cellular = fbm(flow * vec2(3.4, 6.2) + vec2(uSeed * 0.3, uTime * 0.035));
          float vein = sin((uv.x + cellular * 0.08) * 72.0 + uv.y * 21.0 + uSeed) * 0.5 + 0.5;
          float shadowMask = smoothstep(0.48, 0.86, broad + vein * 0.16) * smoothstep(0.42, 0.86, cellular);
          float latitudeMask = 1.0 - smoothstep(0.76, 0.98, abs(localN.y));
          float shadowCast = shadowMask * latitudeMask * facing * (day * 0.42 + lowSun * 0.58);
          float copperEdge = smoothstep(0.5, 0.95, vein) * lowSun * shadowMask;
          vec3 shadowColor = mix(uBase * 0.08, vec3(0.0, 0.012, 0.025), 0.72);
          vec3 edgeColor = mix(uAccent * 0.58, vec3(1.0, 0.56, 0.28), 0.42 + uCompleted * 0.18);
          vec3 color = mix(shadowColor, edgeColor, copperEdge * 0.38);
          float alpha = shadowCast * (0.034 + lowSun * 0.038 + uCompleted * 0.012);
          if (alpha < 0.003) discard;
          gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.115));
        }
      `
    });
    const layer = new THREE.Mesh(
      new THREE.SphereGeometry(world.size * 1.016, this.quality.planetSegments, Math.max(24, this.quality.planetSegments / 2)),
      material
    );
    layer.renderOrder = 2;
    layer.userData.worldId = world.id;
    return layer;
  }

  private createPlanetAtmosphericRim(world: World, index: number): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSeed: { value: index * 29.73 + world.size * 1.9 },
        uColor: { value: new THREE.Color(world.atmosphere) },
        uSunsetColor: { value: new THREE.Color(world.kind === "app" ? 0xffc06d : 0xff6a3a) },
        uSunDirection: { value: this.sunDir.clone() },
        uCompleted: { value: 0 }
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        varying vec3 vLocalNormal;
        void main() {
          vLocalNormal = normalize(normal);
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uSeed;
        uniform vec3 uColor;
        uniform vec3 uSunsetColor;
        uniform vec3 uSunDirection;
        uniform float uCompleted;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        varying vec3 vLocalNormal;

        float hash(vec2 p) {
          p = fract(p * vec2(269.5, 183.3));
          p += dot(p, p + 41.7);
          return fract(p.x * p.y);
        }

        void main() {
          vec3 N = normalize(vWorldNormal);
          vec3 localN = normalize(vLocalNormal);
          vec3 V = normalize(cameraPosition - vWorldPos);
          vec3 L = normalize(uSunDirection);
          float sun = dot(N, L);
          float backRim = pow(1.0 - max(dot(-N, V), 0.0), 3.2);
          float grazing = smoothstep(0.36, -0.12, abs(sun));
          float day = smoothstep(-0.12, 0.72, sun);
          float forward = pow(max(dot(V, L), 0.0), 7.8) * day;
          vec2 uv = vec2(atan(localN.z, localN.x) / 6.2831853 + 0.5, asin(localN.y) / 3.1415926 + 0.5);
          float polar = smoothstep(0.55, 0.96, abs(localN.y));
          float curtain = smoothstep(0.55, 0.96, hash(floor(uv * vec2(86.0, 18.0) + vec2(uSeed, uTime * 0.12)))) * polar * smoothstep(0.24, -0.28, sun);
          float microBand = pow(sin(uv.x * 190.0 + uv.y * 24.0 + uSeed + uTime * 0.08) * 0.5 + 0.5, 9.0);
          vec3 dusk = mix(uSunsetColor, vec3(1.0, 0.78, 0.46), forward * 0.42);
          vec3 cool = mix(vec3(0.04, 0.22, 0.42), uColor, 0.78);
          vec3 color = mix(cool, dusk, grazing * 0.58 + forward * 0.48);
          color += uColor * curtain * (0.42 + uCompleted * 0.36);
          color += vec3(0.34, 1.0, 0.92) * curtain * microBand * 0.18;
          float alpha = backRim * (0.085 + day * 0.14 + grazing * 0.18 + forward * 0.08);
          alpha += curtain * backRim * 0.1;
          alpha *= 0.88 + uCompleted * 0.2;
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(color * (0.78 + grazing * 0.42 + forward * 0.52), clamp(alpha, 0.0, 0.48));
        }
      `
    });
    const rim = new THREE.Mesh(
      new THREE.SphereGeometry(world.size * 1.22, this.quality.planetSegments, Math.max(24, this.quality.planetSegments / 2)),
      material
    );
    rim.renderOrder = 4;
    rim.userData.worldId = world.id;
    return rim;
  }

  private createPlanetExosphere(world: World, index: number): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSeed: { value: index * 23.17 + world.size * 4.3 },
        uColor: { value: new THREE.Color(world.atmosphere) },
        uBase: { value: new THREE.Color(world.color) },
        uSunsetColor: { value: new THREE.Color(0xff8a4d) },
        uSunDirection: { value: this.sunDir.clone() },
        uCompleted: { value: 0 }
      },
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        varying vec3 vLocalNormal;
        void main() {
          vLocalNormal = normalize(normal);
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uSeed;
        uniform vec3 uColor;
        uniform vec3 uBase;
        uniform vec3 uSunsetColor;
        uniform vec3 uSunDirection;
        uniform float uCompleted;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        varying vec3 vLocalNormal;

        float hash(vec2 p) {
          p = fract(p * vec2(269.5, 183.3));
          p += dot(p, p + 41.7);
          return fract(p.x * p.y);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }

        void main() {
          vec3 N = normalize(vWorldNormal);
          vec3 localN = normalize(vLocalNormal);
          vec3 V = normalize(cameraPosition - vWorldPos);
          vec3 L = normalize(uSunDirection);
          float sun = dot(N, L);
          float day = smoothstep(-0.24, 0.52, sun);
          float night = smoothstep(0.18, -0.34, sun);
          float rim = pow(1.0 - max(dot(-N, V), 0.0), 2.12);
          float forwardScatter = pow(max(dot(V, L), 0.0), 5.4) * day;
          vec2 uv = vec2(atan(localN.z, localN.x) / 6.2831853 + 0.5, asin(localN.y) / 3.1415926 + 0.5);
          float polar = smoothstep(0.46, 0.9, abs(localN.y));
          float auroraNoise = noise(vec2(uv.x * 36.0 + uTime * 0.06 + uSeed, uv.y * 9.0 - uTime * 0.025));
          float auroraCurtain = polar * smoothstep(0.46, 0.92, auroraNoise) * night;
          float terminator = smoothstep(0.18, -0.08, abs(sun));
          vec3 sunset = mix(uSunsetColor, vec3(1.0, 0.74, 0.42), forwardScatter * 0.45);
          vec3 cool = mix(uBase * 0.2, uColor, 0.72);
          vec3 color = mix(cool, sunset, terminator * 0.68 + forwardScatter * 0.42);
          color += uColor * auroraCurtain * (0.62 + uCompleted * 0.45);
          color += vec3(0.28, 0.95, 1.0) * auroraCurtain * 0.22;
          float alpha = rim * (0.12 + day * 0.18 + night * 0.09) + forwardScatter * 0.075;
          alpha += terminator * rim * 0.15;
          alpha += auroraCurtain * 0.16;
          alpha *= 0.78 + uCompleted * 0.22;
          if (alpha < 0.006) discard;
          gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.52));
        }
      `
    });
    const exosphere = new THREE.Mesh(
      new THREE.SphereGeometry(world.size * 1.27, this.quality.planetSegments, Math.max(24, this.quality.planetSegments / 2)),
      material
    );
    exosphere.renderOrder = 3;
    exosphere.userData.worldId = world.id;
    return exosphere;
  }

  private createPlanetTerrainGlints(world: World, index: number): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
    const count = world.hidden ? 140 : world.kind === "game" ? 280 : 190;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const alphas = new Float32Array(count);
    const rand = rng(61091 + index * 1447);

    for (let i = 0; i < count; i += 1) {
      const banded = rand() < 0.62;
      const band = Math.round((rand() * 1.64 - 0.82) * 9) / 9;
      const y = banded ? band + (rand() - 0.5) * 0.055 : (rand() * 2 - 1) * 0.82;
      const theta = rand() * Math.PI * 2;
      const radius = world.size * (1.028 + rand() * 0.006);
      const lat = Math.max(-0.86, Math.min(0.86, y));
      const ring = Math.sqrt(Math.max(0, 1 - lat * lat));
      const p = i * 3;
      positions[p] = Math.cos(theta) * ring * radius;
      positions[p + 1] = lat * radius;
      positions[p + 2] = Math.sin(theta) * ring * radius;
      sizes[i] = 2.8 + rand() * (world.kind === "game" ? 4.2 : 3.1);
      phases[i] = rand();
      alphas[i] = 0.28 + rand() * 0.72;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAccent: { value: new THREE.Color(world.atmosphere) },
        uSunDirection: { value: this.sunDir.clone() },
        uCompleted: { value: 0 }
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        attribute float aSize;
        attribute float aPhase;
        attribute float aAlpha;
        uniform float uTime;
        uniform vec3 uAccent;
        uniform vec3 uSunDirection;
        uniform float uCompleted;
        varying float vAlpha;
        varying vec3 vTint;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vec4 mvPosition = viewMatrix * wp;
          vec3 N = normalize(mat3(modelMatrix) * normalize(position));
          vec3 V = normalize(cameraPosition - wp.xyz);
          vec3 L = normalize(uSunDirection);
          float front = smoothstep(-0.04, 0.24, dot(N, V));
          float day = smoothstep(-0.1, 0.78, dot(N, L));
          float night = smoothstep(0.22, -0.22, dot(N, L));
          float pulse = 0.74 + 0.26 * sin(uTime * (1.2 + aPhase * 3.1) + aPhase * 41.9);
          vAlpha = aAlpha * front * pulse * (night * 0.72 + day * 0.16) * (0.72 + uCompleted * 0.58);
          vTint = mix(uAccent, vec3(1.0, 0.72, 0.36), 0.38 + day * 0.22 + uCompleted * 0.16);
          gl_PointSize = aSize * (170.0 / max(18.0, -mvPosition.z));
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        varying vec3 vTint;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          float d = length(p);
          float core = smoothstep(0.28, 0.0, d);
          float halo = smoothstep(0.5, 0.08, d) * 0.32;
          float alpha = (core + halo) * vAlpha;
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(vTint, clamp(alpha, 0.0, 0.88));
        }
      `
    });

    const glints = new THREE.Points(geometry, material);
    glints.userData.worldId = world.id;
    return glints;
  }

  private createAtmosphere(size: number, color: number): THREE.Mesh {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uSunsetColor: { value: new THREE.Color(0xff7a3c) },
        uSunDirection: { value: this.sunDir.clone() },
        uBoost: { value: this.quality.label === "HIGH" ? 1.45 : 1.1 }
      },
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        void main() {
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform vec3 uSunsetColor;
        uniform vec3 uSunDirection;
        uniform float uBoost;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        void main() {
          vec3 N = normalize(vWorldNormal);
          vec3 V = normalize(cameraPosition - vWorldPos);
          vec3 L = normalize(uSunDirection);
          float fres = pow(1.0 - max(dot(-N, V), 0.0), 3.0);
          float sun = dot(N, L);
          float day = smoothstep(-0.25, 0.35, sun);
          float sunset = smoothstep(0.35, -0.1, sun) * day;
          float night = smoothstep(0.2, -0.42, sun);
          vec3 col = mix(uColor, uSunsetColor, sunset);
          vec3 nightCol = mix(vec3(0.05, 0.16, 0.32), uColor, 0.32);
          col += nightCol * fres * night * 0.42;
          float a = fres * day * uBoost + fres * night * 0.18 + pow(max(dot(V, L), 0.0), 8.0) * day * 0.5;
          gl_FragColor = vec4(col, clamp(a, 0.0, 0.78));
        }
      `
    });
    return new THREE.Mesh(new THREE.SphereGeometry(size * 1.16, this.quality.planetSegments, Math.max(24, this.quality.planetSegments / 2)), material);
  }

  private createBeacon(color: number): THREE.Sprite {
    const material = new THREE.SpriteMaterial({
      color,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(0, 0, 0);
    sprite.scale.set(10, 10, 1);
    this.loadTexture("assets/particle.png", (texture) => {
      material.map = texture;
      material.needsUpdate = true;
    });
    return sprite;
  }

  private createAnomalies(): void {
    const specs: Array<{ fragment: FragmentId; pos: THREE.Vector3; color: number; kind: "shard" | "terminal" | "ring" | "voice" }> = [
      { fragment: "anomaly", pos: new THREE.Vector3(24, 5, -18), color: 0x33e7c8, kind: "shard" },
      { fragment: "terminal", pos: new THREE.Vector3(-34, 9, -12), color: 0x7b4dff, kind: "terminal" },
      { fragment: "lantern", pos: new THREE.Vector3(12, -16, -38), color: 0xbff7ec, kind: "voice" },
      { fragment: "rift", pos: new THREE.Vector3(40, -5, 26), color: 0xff5c9d, kind: "ring" },
      { fragment: "voice", pos: new THREE.Vector3(-18, 12, 24), color: 0x33e7c8, kind: "voice" },
      { fragment: "idle", pos: new THREE.Vector3(0, 22, -50), color: 0x9a78d8, kind: "shard" }
    ];

    for (const spec of specs) {
      const group = new THREE.Group();
      group.position.copy(spec.pos);
      this.scene.add(group);
      let core: THREE.Object3D;
      if (spec.kind === "terminal") {
        core = new THREE.Mesh(
          new THREE.BoxGeometry(1.4, 3.1, 1.4),
          new THREE.MeshStandardMaterial({ color: 0x13203a, emissive: spec.color, emissiveIntensity: 0.85, roughness: 0.48 })
        );
      } else if (spec.kind === "ring") {
        core = new THREE.Mesh(
          new THREE.TorusGeometry(1.7, 0.18, 18, 90),
          new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, opacity: 0.88, depthWrite: false, fog: false, blending: THREE.AdditiveBlending })
        );
      } else if (spec.kind === "voice") {
        core = new THREE.Mesh(
          new THREE.IcosahedronGeometry(1, 1),
          new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, opacity: 0.58, depthWrite: false, fog: false, blending: THREE.AdditiveBlending })
        );
      } else {
        core = new THREE.Mesh(
          new THREE.OctahedronGeometry(1.15, 0),
          new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, opacity: 0.78, depthWrite: false, fog: false, blending: THREE.AdditiveBlending })
        );
        core.scale.set(1, 2.4, 1);
      }
      group.add(core);
      const halo = this.createBeacon(spec.color);
      halo.scale.set(6.5, 6.5, 1);
      group.add(halo);
      this.anomalies.push({ group, fragment: spec.fragment, core, taken: this.progress.fragments.has(spec.fragment) });
    }
  }

  private createComposer(): void {
    const useGravity = this.quality.label === "HIGH" && !this.quality.mobile && !this.quality.reducedMotion;
    const useLightShafts = this.quality.label === "HIGH" && !this.quality.mobile && !this.quality.reducedMotion;
    const useGrade = this.quality.label === "HIGH" && !this.quality.mobile;
    const useStreak = this.quality.label === "HIGH" && !this.quality.mobile;
    const useLensArtifacts = this.quality.label === "HIGH" && !this.quality.mobile && !this.quality.reducedMotion;
    const useDiffraction = this.quality.label === "HIGH" && !this.quality.mobile && !this.quality.reducedMotion;
    const useDof = this.quality.label === "HIGH" && !this.quality.mobile && !this.quality.reducedMotion;
    const useContrast = this.quality.label === "HIGH" && !this.quality.mobile;
    const useFinish = this.quality.label === "HIGH" && !this.quality.mobile;
    if (!this.quality.bloom && !useGravity && !useLightShafts && !useGrade && !useStreak && !useLensArtifacts && !useDiffraction && !useDof && !useContrast && !useFinish) return;
    const useMultisample = this.quality.label === "HIGH" && !this.quality.mobile && this.renderer.capabilities.isWebGL2;
    this.composerSamples = useMultisample ? Math.min(4, this.renderer.capabilities.maxSamples || 4) : 0;
    const renderTarget =
      this.composerSamples > 0
        ? new THREE.WebGLRenderTarget(1, 1, {
            type: THREE.HalfFloatType,
            depthBuffer: true,
            stencilBuffer: false,
            samples: this.composerSamples
          })
        : undefined;
    if (renderTarget) renderTarget.texture.name = "AlicE.HighComposer.MSAA";
    this.composer = new EffectComposer(this.renderer, renderTarget);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (useGravity) {
      this.gravityPass = new ShaderPass(GRAVITY_LENS_SHADER);
      this.gravityPass.uniforms.uStrength.value = 0.028;
      this.composer.addPass(this.gravityPass);
    }
    if (useLightShafts) {
      this.lightShaftPass = new ShaderPass(LIGHT_SHAFT_SHADER);
      this.lightShaftPass.uniforms.uStrength.value = 0.22;
      this.composer.addPass(this.lightShaftPass);
    }
    if (this.quality.bloom) {
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.46, 0.42, 0.82));
    }
    if (useStreak) {
      this.streakPass = new ShaderPass(ANAMORPHIC_STREAK_SHADER);
      this.streakPass.uniforms.uIntensity.value = 0.31;
      this.composer.addPass(this.streakPass);
    }
    if (useLensArtifacts) {
      this.lensArtifactPass = new ShaderPass(LENS_ARTIFACT_SHADER);
      this.lensArtifactPass.uniforms.uStrength.value = 0;
      this.composer.addPass(this.lensArtifactPass);
    }
    if (useDiffraction) {
      this.diffractionPass = new ShaderPass(SENSOR_DIFFRACTION_SHADER);
      this.diffractionPass.uniforms.uStrength.value = 0;
      this.composer.addPass(this.diffractionPass);
    }
    if (useDof) {
      this.dofPass = new ShaderPass(CINEMATIC_DOF_SHADER);
      this.dofPass.uniforms.uStrength.value = 0.32;
      this.composer.addPass(this.dofPass);
    }
    if (useContrast) {
      this.contrastPass = new ShaderPass(MICRO_CONTRAST_SHADER);
      this.contrastPass.uniforms.uStrength.value = 0.18;
      this.composer.addPass(this.contrastPass);
    }
    if (useGrade) {
      this.gradePass = new ShaderPass(FILMIC_GRADE_SHADER);
      this.composer.addPass(this.gradePass);
    }
    if (useFinish) {
      this.finishPass = new ShaderPass(CINEMATIC_FINISH_SHADER);
      this.finishPass.uniforms.uStrength.value = 0.22;
      this.composer.addPass(this.finishPass);
    }
    this.composer.addPass(new OutputPass());
  }

  private async initSparkLayer(): Promise<void> {
    if (!this.quality.spark || this.disposed || !this.renderer.capabilities.isWebGL2) return;
    try {
      const spark = await import("@sparkjsdev/spark");
      if (this.disposed) return;
      const sparkRoot = new (spark as any).SparkRenderer({ renderer: this.renderer });
      this.sparkRoot = sparkRoot;
      this.scene.add(sparkRoot);
      // High count, low-opacity splats work best as distant volumetric nebula, not front-screen noise.
      const c1 = this.createSparkCloud(spark, new THREE.Vector3(18, 2, -48), 0xffb15f, 90000, 42, 0.0026, 17);
      const c2 = this.createSparkCloud(spark, new THREE.Vector3(-72, 18, -128), 0x33e7c8, 70000, 73, 0.0034, 24);
      const c3 = this.createSparkCloud(spark, new THREE.Vector3(70, -18, -126), 0xff5c9d, 65000, 91, 0.0032, 22);
      this.sparkClouds.push(c1, c2, c3);
      this.scene.add(c1, c2, c3);
      this.sparkActive = true;
      this.callbacks.onReady(this.getInfo());
    } catch (error) {
      this.sparkActive = false;
      console.warn("Spark layer disabled", error);
    }
  }

  private createSparkCloud(spark: unknown, center: THREE.Vector3, color: number, count: number, seed: number, scale: number, spread = 13): THREE.Object3D {
    const mod = spark as { SplatMesh: new (opts: unknown) => THREE.Object3D };
    const rand = rng(seed);
    const base = new THREE.Color(color);
    const hot = new THREE.Color(0xffffff);
    const mesh = new mod.SplatMesh({
      // splats built RELATIVE to the mesh (mesh.position = center) so onFrame can spin/drift in place
      constructSplats: (splats: { pushSplat: (p: THREE.Vector3, s: THREE.Vector3, q: THREE.Quaternion, o: number, c: THREE.Color) => void }) => {
        const pos = new THREE.Vector3();
        const scl = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const col = new THREE.Color();
        for (let i = 0; i < count; i += 1) {
          const t = Math.pow(rand(), 0.62); // 0=core .. 1=edge
          const r = t * spread;
          const theta = rand() * Math.PI * 2;
          const phi = Math.acos(rand() * 2 - 1);
          pos.set(Math.sin(phi) * Math.cos(theta) * r, Math.cos(phi) * r * 0.72, Math.sin(phi) * Math.sin(theta) * r);
          scl.setScalar(scale * (0.6 + (1 - t) * 2.6) + rand() * scale * 1.4); // larger toward the glowing core
          col.copy(base).lerp(hot, (1 - t) * 0.5 + rand() * 0.12); // hot white core → colored rim
          splats.pushSplat(pos, scl, quat, (0.012 + (1 - t) * 0.05) * (0.7 + rand() * 0.5), col); // denser core, low opacity for high count
        }
      },
      onFrame: ({ mesh: m, time }: { mesh: THREE.Object3D; time: number }) => {
        m.position.set(center.x, center.y + Math.sin(time * 0.18 + seed) * 0.6, center.z);
        m.rotation.y = time * 0.02;
      }
    });
    mesh.position.copy(center);
    return mesh;
  }

  private attachEvents(): void {
    window.addEventListener("resize", this.resize, { passive: true });
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("visibilitychange", this.onVisibilityChange);
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    this.keys.add(event.code);
    if (["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ShiftLeft", "ShiftRight"].includes(event.code)) event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.canvas.focus({ preventScroll: true });
    this.drag = true;
    this.downX = this.lastX = event.clientX;
    this.downY = this.lastY = event.clientY;
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Some embedded browsers decline pointer capture.
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.drag) {
      this.updateHover(event.clientX, event.clientY);
      return;
    }
    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.yaw -= dx * 0.003;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0026, -1.22, 1.22);
    this.focus = null;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const moved = Math.hypot(event.clientX - this.downX, event.clientY - this.downY);
    this.drag = false;
    try {
      this.canvas.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore.
    }
    if (moved < 8) {
      const world = this.pick(event.clientX, event.clientY);
      if (world) {
        const node = this.planets.get(world.id);
        if (node) this.focusPlanet(node, true);
      }
    }
  };

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) {
      window.cancelAnimationFrame(this.animationId);
      this.animationId = 0;
    } else if (!this.animationId && !this.disposed) {
      this.lastFrameTime = performance.now();
      this.animationId = window.requestAnimationFrame(this.frame);
    }
  };

  private readonly resize = (): void => {
    const width = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const height = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.quality.dpr);
    this.renderer.setSize(width, height, false);
    this.composer?.setPixelRatio(this.quality.dpr);
    this.composer?.setSize(width, height);
    if (this.gravityPass) this.gravityPass.uniforms.uAspect.value = width / height;
    if (this.lightShaftPass) this.lightShaftPass.uniforms.uAspect.value = width / height;
    if (this.streakPass) this.streakPass.uniforms.uResolution.value.set(width * this.quality.dpr, height * this.quality.dpr);
    if (this.lensArtifactPass) {
      this.lensArtifactPass.uniforms.uAspect.value = width / height;
      this.lensArtifactPass.uniforms.uResolution.value.set(width * this.quality.dpr, height * this.quality.dpr);
    }
    if (this.diffractionPass) {
      this.diffractionPass.uniforms.uAspect.value = width / height;
      this.diffractionPass.uniforms.uResolution.value.set(width * this.quality.dpr, height * this.quality.dpr);
    }
    if (this.dofPass) {
      this.dofPass.uniforms.uAspect.value = width / height;
      this.dofPass.uniforms.uResolution.value.set(width * this.quality.dpr, height * this.quality.dpr);
    }
    if (this.contrastPass) {
      this.contrastPass.uniforms.uResolution.value.set(width * this.quality.dpr, height * this.quality.dpr);
    }
    if (this.gradePass) {
      this.gradePass.uniforms.uAspect.value = width / height;
      this.gradePass.uniforms.uResolution.value.set(width * this.quality.dpr, height * this.quality.dpr);
    }
    if (this.finishPass) {
      this.finishPass.uniforms.uAspect.value = width / height;
      this.finishPass.uniforms.uResolution.value.set(width * this.quality.dpr, height * this.quality.dpr);
    }
  };

  private readonly frame = (time: number): void => {
    if (this.disposed) return;
    const dt = Math.min(0.04, Math.max(0.001, (time - this.lastFrameTime) / 1000));
    this.lastFrameTime = time;
    this.galaxyUniforms.uTime.value = time * 0.001;
    for (const material of this.animatedMaterials) {
      if (material.uniforms.uTime) material.uniforms.uTime.value = time * 0.001;
    }
    if (this.lightShaftPass) this.lightShaftPass.uniforms.uTime.value = time * 0.001;
    if (this.streakPass) this.streakPass.uniforms.uTime.value = time * 0.001;
    if (this.lensArtifactPass) this.lensArtifactPass.uniforms.uTime.value = time * 0.001;
    if (this.diffractionPass) this.diffractionPass.uniforms.uTime.value = time * 0.001;
    if (this.dofPass) this.dofPass.uniforms.uTime.value = time * 0.001;
    if (this.contrastPass) this.contrastPass.uniforms.uTime.value = time * 0.001;
    if (this.gradePass) this.gradePass.uniforms.uTime.value = time * 0.001;
    if (this.finishPass) this.finishPass.uniforms.uTime.value = time * 0.001;
    this.updateCamera(dt, time);
    this.updateDeepPanorama(time);
    this.updateNebulaCanyonField(time);
    this.updateParallaxNebulaVolume(time);
    this.updateStellarNurseryVolume(time);
    this.updateDistantGalaxyField(time);
    this.updateLensedGalaxyClusterField(time);
    this.updateCosmicWebField(time);
    this.updateDeepSpaceDebrisField(dt, time);
    this.updateRelativisticWakeField(dt, time);
    this.updateEventHorizonCitadelField(dt, time);
    this.updateMegastructureField(dt, time);
    this.updatePrismaticScatteringField(dt, time);
    this.updateCameraDepthField(dt);
    this.updateForegroundRelicField(dt, time);
    this.updateLensDustField(time);
    this.updateBlackHole(dt, time);
    this.distanceAccum += this.lastCamPos.distanceTo(this.camera.position);
    this.lastCamPos.copy(this.camera.position);
    if (this.distanceAccum > 25) {
      this.callbacks.onFlyDistance(this.distanceAccum);
      this.distanceAccum = 0;
    }
    this.updatePlanets(dt, time);
    this.updateAnomalies(dt, time);
    this.updateStardust();
    this.updateTimeTrial();
    this.updateNearest();

    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);

    this.animationId = window.requestAnimationFrame(this.frame);
  };

  private updateBlackHole(dt: number, time: number): void {
    if (!this.blackHole) return;
    const t = time * 0.001;
    this.blackHole.group.rotation.z += dt * (this.quality.label === "LOW" ? 0.006 : 0.012);
    this.blackHole.disk.material.uniforms.uTime.value = t;
    const lensMaterial = this.blackHole.lensShell?.material as THREE.ShaderMaterial | undefined;
    if (lensMaterial) lensMaterial.uniforms.uTime.value = t;
    for (const jet of this.blackHole.jets ?? []) {
      (jet.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    }
    if (this.blackHole.debris) this.blackHole.debris.rotation.z += dt * 0.09;
    if (this.blackHole.plume) this.blackHole.plume.rotation.z += dt * 0.018;
    if (this.blackHole.photonCage) {
      this.blackHole.photonCage.rotation.y += dt * 0.026;
      this.blackHole.photonCage.rotation.z -= dt * 0.018;
    }
    if (this.blackHole.lensingArcs) {
      this.blackHole.lensingArcs.rotation.z += dt * 0.011;
      this.blackHole.lensingArcs.rotation.x = 1.3 + Math.sin(t * 0.08) * 0.018;
    }
    if (this.blackHole.infall) {
      this.blackHole.infall.rotation.z += dt * 0.018;
      this.blackHole.infall.material.uniforms.uTime.value = t;
    }
    if (this.blackHole.lensingStarfield) {
      this.blackHole.lensingStarfield.rotation.z += dt * 0.0065;
      this.blackHole.lensingStarfield.rotation.y = 0.08 + Math.sin(t * 0.048) * 0.026;
      this.blackHole.lensingStarfield.rotation.x = 1.3 + Math.cos(t * 0.035) * 0.014;
    }
    if (this.blackHole.photonSheath) {
      this.blackHole.photonSheath.rotation.z -= dt * 0.028;
      this.blackHole.photonSheath.rotation.y = 0.08 + Math.sin(t * 0.07) * 0.018;
      this.blackHole.photonSheath.rotation.x = 1.3 + Math.cos(t * 0.052) * 0.012;
    }
    if (this.blackHole.polarizationField) {
      this.blackHole.polarizationField.rotation.z += dt * 0.034;
      this.blackHole.polarizationField.rotation.y = 0.08 + Math.sin(t * 0.061) * 0.014;
      this.blackHole.polarizationField.rotation.x = 1.3 + Math.cos(t * 0.047) * 0.01;
    }
    if (this.blackHole.accretionStructure) {
      this.blackHole.accretionStructure.rotation.z -= dt * 0.016;
      this.blackHole.accretionStructure.rotation.y = 0.08 + Math.sin(t * 0.038) * 0.01;
    }
    if (this.blackHole.rubbleHalo) {
      this.blackHole.rubbleHalo.rotation.z += dt * 0.022;
      this.blackHole.rubbleHalo.rotation.x = 1.3 + Math.cos(t * 0.041) * 0.008;
    }

    const blackHolePos = TMP_VEC.setFromMatrixPosition(this.blackHole.group.matrixWorld);
    if (this.blackHole.portrait) {
      this.blackHole.portrait.position.copy(blackHolePos);
      this.blackHole.portrait.quaternion.copy(this.camera.quaternion);
      this.blackHole.portrait.material.uniforms.uTime.value = t;
    }
    const distance = this.camera.position.distanceTo(blackHolePos);
    if (!this.blackHoleSecretDone && !this.progress.hiddenPlanet && distance < 18) {
      this.blackHoleSecretDone = true;
      this.revealHiddenPlanet();
    }

    if (!this.gravityPass && !this.lightShaftPass && !this.lensArtifactPass && !this.diffractionPass && !this.dofPass) return;
    this.blackHoleScreen.copy(blackHolePos).project(this.camera);
    const x = this.blackHoleScreen.x * 0.5 + 0.5;
    const y = this.blackHoleScreen.y * 0.5 + 0.5;
    const visible = this.blackHoleScreen.z > -1 && this.blackHoleScreen.z < 1 && x > -0.2 && x < 1.2 && y > -0.2 && y < 1.2;
    if (this.gravityPass) {
      this.gravityPass.uniforms.uCenter.value.set(x, y);
      this.gravityPass.uniforms.uTime.value = t;
      this.gravityPass.uniforms.uStrength.value = visible ? THREE.MathUtils.clamp(0.036 - distance * 0.00008, 0.014, 0.036) : 0;
      this.gravityPass.enabled = visible;
    }
    if (this.lightShaftPass) {
      this.lightShaftPass.uniforms.uCenter.value.set(x, y);
      this.lightShaftPass.uniforms.uTime.value = t;
      this.lightShaftPass.uniforms.uStrength.value = visible ? THREE.MathUtils.clamp(0.28 - distance * 0.0015, 0.1, 0.28) : 0;
      this.lightShaftPass.enabled = visible;
    }
    if (this.lensArtifactPass) {
      this.lensArtifactPass.uniforms.uCenter.value.set(x, y);
      this.lensArtifactPass.uniforms.uTime.value = t;
      this.lensArtifactPass.uniforms.uStrength.value = visible ? THREE.MathUtils.clamp(0.19 - distance * 0.0011, 0.055, 0.16) : 0;
      this.lensArtifactPass.enabled = visible;
    }
    if (this.diffractionPass) {
      this.diffractionPass.uniforms.uCenter.value.set(x, y);
      this.diffractionPass.uniforms.uTime.value = t;
      this.diffractionPass.uniforms.uStrength.value = visible ? THREE.MathUtils.clamp(0.13 - distance * 0.00075, 0.035, 0.105) : 0;
      this.diffractionPass.enabled = visible;
    }
    if (this.dofPass) {
      this.dofPass.uniforms.uCenter.value.set(x, y);
      this.dofPass.uniforms.uTime.value = t;
      this.dofPass.uniforms.uStrength.value = visible ? THREE.MathUtils.clamp(0.36 - distance * 0.0009, 0.18, 0.34) : 0.22;
    }
  }

  private updateCamera(dt: number, time: number): void {
    if (this.focus) {
      const t = THREE.MathUtils.clamp((performance.now() - this.focus.startedAt) / this.focus.duration, 0, 1);
      const e = easeOutCubic(t);
      this.camera.position.lerpVectors(this.focus.fromPos, this.focus.toPos, e);
      this.camera.quaternion.slerpQuaternions(this.focus.fromQuat, this.focus.toQuat, e);
      if (t >= 1) {
        if (this.focus.world) this.callbacks.onSelectWorld(this.focus.world);
        this.focus = null;
      }
      return;
    }

    const wobble = this.quality.reducedMotion ? 0 : Math.sin(time * 0.00035) * 0.002;
    TMP_OBJ.rotation.set(this.pitch + wobble, this.yaw, 0, "YXZ");
    this.camera.quaternion.copy(TMP_OBJ.quaternion);
    const speed = (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? 34 : 19) * (this.quality.mobile ? 0.62 : 1);
    const accel = TMP_VEC.set(0, 0, 0);
    const forward = TMP_VEC_2.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const right = TMP_VEC_3.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    if (this.keys.has("KeyW")) accel.add(forward);
    if (this.keys.has("KeyS")) accel.addScaledVector(forward, -1);
    if (this.keys.has("KeyA")) accel.addScaledVector(right, -1);
    if (this.keys.has("KeyD")) accel.add(right);
    if (this.keys.has("Space")) accel.y += 1;
    if (this.keys.has("ControlLeft") || this.keys.has("ControlRight")) accel.y -= 1;
    if (accel.lengthSq() > 0) {
      accel.normalize().multiplyScalar(speed * dt);
      this.camera.position.add(accel);
      this.camera.position.clamp(CLAMP_MIN, CLAMP_MAX);
    }
  }

  private updateCameraDepthField(dt: number): void {
    if (!this.cameraDepthField) return;
    const follow = 1 - Math.pow(0.00018, dt);
    this.cameraDepthField.position.lerp(this.camera.position, follow);
    this.cameraDepthField.rotation.y += dt * 0.006;
    this.cameraDepthField.rotation.x += dt * 0.0025;
    this.cameraDepthField.rotation.z += dt * 0.0018;
    for (const child of this.cameraDepthField.children) {
      if (!(child instanceof THREE.Mesh) || child.userData.spin === undefined) continue;
      child.rotation.z += dt * child.userData.spin;
    }
  }

  private updateForegroundRelicField(dt: number, time: number): void {
    if (!this.foregroundRelicField) return;
    const t = time * 0.001;
    const follow = 1 - Math.pow(0.00008, dt);
    this.foregroundRelicField.position.lerp(this.camera.position, follow);
    this.foregroundRelicField.rotation.y += dt * 0.0032;
    this.foregroundRelicField.rotation.x = -0.05 + Math.sin(t * 0.015) * 0.018;
    this.foregroundRelicField.rotation.z = 0.02 + Math.cos(t * 0.012) * 0.014;
    for (const child of this.foregroundRelicField.children) {
      if (!(child instanceof THREE.Mesh) || child.userData.spin === undefined) continue;
      child.rotation.z += dt * child.userData.spin;
      child.position.y += Math.sin(t * 0.04 + child.userData.phase) * 0.0004;
    }
  }

  private updateDeepPanorama(time: number): void {
    if (!this.deepPanorama) return;
    const t = time * 0.001;
    this.deepPanorama.rotation.y = Math.sin(t * 0.018) * 0.018;
    this.deepPanorama.rotation.x = Math.sin(t * 0.011 + 1.4) * 0.008;
    this.deepPanorama.rotation.z = Math.cos(t * 0.014) * 0.006;
  }

  private updateNebulaCanyonField(time: number): void {
    if (!this.nebulaCanyonField) return;
    const t = time * 0.001;
    this.nebulaCanyonField.rotation.y = Math.sin(t * 0.009 + 0.4) * 0.014;
    this.nebulaCanyonField.rotation.x = Math.sin(t * 0.007 + 1.2) * 0.006;
    this.nebulaCanyonField.position.y = Math.sin(t * 0.012) * 0.42;
    for (const child of this.nebulaCanyonField.children) {
      if (!(child instanceof THREE.Mesh) || child.userData.roll === undefined) continue;
      child.rotation.z = child.userData.roll + Math.sin(t * 0.026 + child.userData.phase) * 0.012;
    }
  }

  private updateParallaxNebulaVolume(time: number): void {
    if (!this.parallaxNebulaVolume) return;
    const t = time * 0.001;
    this.parallaxNebulaVolume.rotation.y = Math.sin(t * 0.007 + 0.2) * 0.012;
    this.parallaxNebulaVolume.rotation.x = Math.cos(t * 0.006 + 1.1) * 0.005;
    this.parallaxNebulaVolume.position.y = Math.sin(t * 0.013 + 0.7) * 0.32;
    for (const child of this.parallaxNebulaVolume.children) {
      if (child instanceof THREE.Points && child.userData.motes) {
        child.rotation.y = Math.sin(t * 0.019) * 0.018;
        child.rotation.z = t * 0.0108; // time-based (frame-rate independent; was += 0.00018/frame)
        continue;
      }
      if (!(child instanceof THREE.Mesh) || child.userData.roll === undefined) continue;
      const base = child.userData.base as THREE.Vector3 | undefined;
      if (base) {
        child.position.set(
          base.x + Math.sin(t * 0.019 + child.userData.phase) * 0.42,
          base.y + Math.cos(t * 0.015 + child.userData.phase) * 0.28,
          base.z
        );
      }
      child.quaternion.copy(this.camera.quaternion);
      child.rotateZ(child.userData.roll + Math.sin(t * 0.028 + child.userData.phase) * 0.018);
    }
  }

  private updateStellarNurseryVolume(time: number): void {
    if (!this.stellarNurseryField) return;
    const t = time * 0.001;
    this.stellarNurseryField.position.x = Math.sin(t * 0.017) * 0.8;
    this.stellarNurseryField.position.y = Math.cos(t * 0.013 + 0.8) * 0.45;
    for (const child of this.stellarNurseryField.children) {
      if (!(child instanceof THREE.Mesh) || child.userData.roll === undefined) continue;
      child.quaternion.copy(this.camera.quaternion);
      child.rotateZ(child.userData.roll + Math.sin(t * 0.035 + child.userData.phase) * 0.012);
    }
  }

  private updateDistantGalaxyField(time: number): void {
    if (!this.distantGalaxyField) return;
    const t = time * 0.001;
    this.distantGalaxyField.rotation.y = Math.sin(t * 0.009) * 0.012;
    this.distantGalaxyField.rotation.x = Math.sin(t * 0.006 + 0.7) * 0.005;
    for (const child of this.distantGalaxyField.children) {
      const sprite = child as THREE.Sprite;
      const material = sprite.material as THREE.SpriteMaterial;
      material.rotation = sprite.userData.roll + Math.sin(t * sprite.userData.spin + sprite.userData.phase) * 0.028;
    }
  }

  private updateLensedGalaxyClusterField(time: number): void {
    if (!this.lensedGalaxyClusterField) return;
    const t = time * 0.001;
    this.lensedGalaxyClusterField.rotation.y = Math.sin(t * 0.006 + 0.4) * 0.012;
    this.lensedGalaxyClusterField.rotation.x = Math.cos(t * 0.005 + 1.1) * 0.006;
    for (const child of this.lensedGalaxyClusterField.children) {
      if (child instanceof THREE.Mesh) {
        const base = child.userData.base as THREE.Vector3 | undefined;
        if (!base) continue;
        const parallax = Number(child.userData.parallax ?? 0.018);
        child.position.set(
          base.x + this.camera.position.x * parallax + Math.sin(t * 0.013 + base.x) * 0.28,
          base.y + this.camera.position.y * parallax * 0.42 + Math.cos(t * 0.011 + base.y) * 0.18,
          base.z
        );
        child.lookAt(this.camera.position);
        child.rotateZ(Number(child.userData.roll ?? 0) + Math.sin(t * Number(child.userData.spin ?? 0.01) + base.z) * 0.024);
      } else if (child instanceof THREE.Points) {
        child.rotation.z = Math.sin(t * 0.01) * 0.01;
        child.rotation.y = Math.cos(t * 0.008) * 0.006;
      }
    }
  }

  private updateCosmicWebField(time: number): void {
    if (!this.cosmicWebField) return;
    const t = time * 0.001;
    this.cosmicWebField.rotation.y = Math.sin(t * 0.007) * 0.018;
    this.cosmicWebField.rotation.x = Math.cos(t * 0.005 + 0.6) * 0.009;
    this.cosmicWebField.rotation.z = Math.sin(t * 0.006 + 1.2) * 0.006;
  }

  private updateDeepSpaceDebrisField(dt: number, time: number): void {
    if (!this.deepSpaceDebrisField) return;
    const t = time * 0.001;
    this.deepSpaceDebrisField.rotation.y += dt * 0.0028;
    this.deepSpaceDebrisField.rotation.z = Math.sin(t * 0.018) * 0.01;
    this.deepSpaceDebrisField.position.y = Math.sin(t * 0.013 + 1.1) * 0.42;
  }

  private updateRelativisticWakeField(dt: number, time: number): void {
    if (!this.relativisticWakeField) return;
    const t = time * 0.001;
    this.relativisticWakeField.rotation.y += dt * 0.0045;
    this.relativisticWakeField.rotation.z = 0.02 + Math.sin(t * 0.015) * 0.014;
    this.relativisticWakeField.position.y = Math.sin(t * 0.018 + 2.4) * 0.28;
    for (const child of this.relativisticWakeField.children) {
      if (!(child instanceof THREE.Mesh) || child.userData.spin === undefined) continue;
      child.rotation.z += dt * child.userData.spin;
      child.position.y += Math.sin(t * 0.04 + child.userData.phase) * 0.00035;
    }
  }

  private updateEventHorizonCitadelField(dt: number, time: number): void {
    if (!this.eventHorizonCitadelField) return;
    const t = time * 0.001;
    this.eventHorizonCitadelField.rotation.y += dt * 0.0038;
    this.eventHorizonCitadelField.rotation.x = -0.02 + Math.sin(t * 0.013 + 0.5) * 0.014;
    this.eventHorizonCitadelField.rotation.z = 0.03 + Math.cos(t * 0.017) * 0.012;
    this.eventHorizonCitadelField.position.y = -0.4 + Math.sin(t * 0.021 + 1.3) * 0.28;
    for (const child of this.eventHorizonCitadelField.children) {
      if (!(child instanceof THREE.Mesh) || child.userData.spin === undefined) continue;
      child.rotation.z += dt * child.userData.spin;
      child.position.y += Math.sin(t * 0.04 + child.userData.phase) * 0.00035;
    }
  }

  private updateMegastructureField(dt: number, time: number): void {
    if (!this.megastructureField) return;
    const t = time * 0.001;
    this.megastructureField.rotation.y += dt * 0.0026;
    this.megastructureField.rotation.x = 0.12 + Math.sin(t * 0.011) * 0.018;
    this.megastructureField.rotation.z = -0.08 + Math.cos(t * 0.014) * 0.012;
    this.megastructureField.position.y = -1.4 + Math.sin(t * 0.02 + 1.7) * 0.34;
    for (const child of this.megastructureField.children) {
      if (!(child instanceof THREE.Mesh) || child.userData.spin === undefined) continue;
      child.rotation.z += dt * child.userData.spin;
      child.position.y += Math.sin(t * 0.035 + child.userData.phase) * 0.00045;
    }
  }

  private updatePrismaticScatteringField(dt: number, time: number): void {
    if (!this.prismaticScatteringField) return;
    const t = time * 0.001;
    this.prismaticScatteringField.rotation.y += dt * 0.0034;
    this.prismaticScatteringField.rotation.x = -0.04 + Math.sin(t * 0.017) * 0.016;
    this.prismaticScatteringField.rotation.z = 0.02 + Math.cos(t * 0.013) * 0.012;
    this.prismaticScatteringField.position.y = 1.5 + Math.sin(t * 0.025 + 0.8) * 0.36;
    for (const child of this.prismaticScatteringField.children) {
      if (!(child instanceof THREE.Mesh) || child.userData.spin === undefined) continue;
      child.rotation.z += dt * child.userData.spin;
      child.position.y += Math.sin(t * 0.042 + child.userData.phase) * 0.00035;
    }
  }

  private updateLensDustField(time: number): void {
    if (!this.lensDustField) return;
    const t = time * 0.001;
    this.lensDustField.position.copy(this.camera.position);
    this.lensDustField.quaternion.copy(this.camera.quaternion);
    this.lensDustField.rotateZ(Math.sin(t * 0.11) * 0.006);
    this.lensDustField.material.uniforms.uTime.value = t;
  }

  private updatePlanets(dt: number, time: number): void {
    const t = time * 0.001;
    for (const node of this.planets.values()) {
      if (!node.group.visible) continue;
      node.surface.rotation.y += dt * (0.08 + node.radius);
      if (node.surfaceDetail) {
        node.surfaceDetail.rotation.copy(node.surface.rotation);
        node.surfaceDetail.material.uniforms.uTime.value = t;
      }
      if (node.weatherLayer) {
        node.weatherLayer.rotation.copy(node.surface.rotation);
        node.weatherLayer.rotation.y += t * (0.026 + node.radius * 0.42);
        node.weatherLayer.rotation.z = Math.sin(t * 0.18 + node.phase) * 0.045;
        node.weatherLayer.material.uniforms.uTime.value = t;
      }
      if (node.cloudShadowLayer) {
        node.cloudShadowLayer.rotation.copy(node.surface.rotation);
        node.cloudShadowLayer.rotation.y += t * (0.018 + node.radius * 0.28);
        node.cloudShadowLayer.rotation.z = Math.sin(t * 0.13 + node.phase) * 0.032;
        node.cloudShadowLayer.material.uniforms.uTime.value = t;
      }
      if (node.exosphere) {
        node.exosphere.rotation.copy(node.surface.rotation);
        node.exosphere.rotation.y += t * 0.012;
        node.exosphere.material.uniforms.uTime.value = t;
      }
      if (node.atmosphericRim) {
        node.atmosphericRim.rotation.copy(node.surface.rotation);
        node.atmosphericRim.rotation.y += t * 0.008;
        node.atmosphericRim.material.uniforms.uTime.value = t;
      }
      if (node.magnetosphere) {
        node.magnetosphere.rotation.y += dt * (0.018 + node.radius * 0.28);
        node.magnetosphere.rotation.z += dt * 0.006;
      }
      if (node.orbitalInfrastructure) {
        node.orbitalInfrastructure.rotation.y += dt * (0.028 + node.radius * 0.45);
        node.orbitalInfrastructure.rotation.x = 0.42 + Math.sin(t * 0.13 + node.phase) * 0.045;
        node.orbitalInfrastructure.rotation.z += dt * 0.011;
      }
      if (node.terrainGlints) {
        node.terrainGlints.rotation.copy(node.surface.rotation);
        node.terrainGlints.material.uniforms.uTime.value = t;
      }
      if (node.nightNetwork) {
        node.nightNetwork.rotation.copy(node.surface.rotation);
        node.nightNetwork.rotation.y += t * (0.006 + node.radius * 0.18);
        for (const child of node.nightNetwork.children) {
          if ((child instanceof THREE.LineSegments || child instanceof THREE.Points) && child.material instanceof THREE.ShaderMaterial) {
            child.material.uniforms.uTime.value = t;
          }
        }
      }
      if (node.clouds) node.clouds.rotation.y -= dt * 0.045;
      if (node.ring) node.ring.rotation.z += dt * 0.025;
      if (node.ringDebris) {
        node.ringDebris.rotation.z += dt * (0.018 + node.radius * 0.55);
        const sparks = node.ringDebris.children[1] as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | undefined;
        if (sparks?.material instanceof THREE.ShaderMaterial) sparks.material.uniforms.uTime.value = t;
      }
      if (node.moonlets) {
        node.moonlets.rotation.y += dt * (0.052 + node.radius);
        node.moonlets.rotation.z += dt * 0.014;
      }
      if (!this.quality.reducedMotion) node.group.position.y += Math.sin(t * 0.45 + node.phase) * 0.0022;
      const distance = this.camera.position.distanceTo(node.group.position);
      const scale = distance < node.world.size * 7.8 ? 1 + (1 - distance / (node.world.size * 7.8)) * 0.1 : 1;
      node.group.scale.lerp(TMP_VEC.setScalar(scale), 0.08);
      if (node.beacon) {
        node.beacon.material.opacity = (node.completed ? 0.9 : 0.55) + Math.sin(t * 2.1 + node.phase) * 0.1;
      }
    }
  }

  private updateAnomalies(dt: number, time: number): void {
    const t = time * 0.001;
    for (const anomaly of this.anomalies) {
      if (!anomaly.group.visible) continue;
      anomaly.core.rotation.x += dt * 0.25;
      anomaly.core.rotation.y += dt * 0.42;
      anomaly.group.scale.setScalar(1 + Math.sin(t * 2.2 + anomaly.group.position.x) * 0.055);
      const distance = this.camera.position.distanceTo(anomaly.group.position);
      if (distance < 5.4) {
        anomaly.taken = true;
        anomaly.group.visible = false;
        this.callbacks.onCollectFragment(anomaly.fragment);
        if (anomaly.fragment === "terminal" || anomaly.fragment === "anomaly") {
          this.revealHiddenPlanet();
        }
      }
    }
    if (this.hiddenPlanet && !this.hiddenPlanet.group.visible && this.camera.position.distanceTo(this.hiddenPlanet.group.position) < 26) {
      this.revealHiddenPlanet();
    }
  }

  // ---- v1.1: stardust collectibles (pooled Points, static so proximity is world-accurate) ----
  private createStardust(): void {
    const count = this.quality.label === "HIGH" ? 220 : this.quality.label === "BALANCED" ? 140 : 40;
    const rand = mulberry32(dailySeed(this.progress.loop));
    const positions = new Float32Array(count * 3);
    this.stardustIds = [];
    this.stardustTaken = new Set(this.progress.stardustToday);
    for (let i = 0; i < count; i += 1) {
      const id = `s${i}`;
      this.stardustIds.push(id);
      const r = 26 + rand() * 70;
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(rand() * 2 - 1);
      positions[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
      positions[i * 3 + 1] = this.stardustTaken.has(id) ? 9999 : (rand() - 0.5) * 62;
      positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xffe6a3,
      size: 1.6,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.96,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.loadTexture("assets/particle.png", (texture) => {
      material.map = texture;
      material.needsUpdate = true;
    });
    this.stardust = new THREE.Points(geometry, material);
    this.stardustPos = positions;
    this.scene.add(this.stardust);
  }

  private rebuildStardust(): void {
    if (this.stardust) {
      this.scene.remove(this.stardust);
      this.stardust.geometry.dispose();
      disposeMaterial(this.stardust.material);
      this.stardust = null;
      this.stardustPos = null;
    }
    this.createStardust();
  }

  private updateStardust(): void {
    if (!this.stardust || !this.stardustPos) return;
    const cam = this.camera.position;
    const pos = this.stardustPos;
    let collected = false;
    for (let i = 0; i < this.stardustIds.length; i += 1) {
      const id = this.stardustIds[i];
      if (this.stardustTaken.has(id)) continue;
      const dx = cam.x - pos[i * 3];
      const dy = cam.y - pos[i * 3 + 1];
      const dz = cam.z - pos[i * 3 + 2];
      if (dx * dx + dy * dy + dz * dz < 16) {
        this.stardustTaken.add(id);
        pos[i * 3 + 1] = 9999;
        collected = true;
        this.callbacks.onCollectStardust(id);
      }
    }
    if (collected) (this.stardust.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  // ---- v1.1: time-trial ring run (coexists with normal flight) ----
  startTimeTrial(): void {
    if (this.trialActive) return;
    this.buildTrialRings();
    this.focus = null;
    this.trialActive = true;
    this.trialIndex = 0;
    this.trialStart = performance.now();
    this.trialLastTick = 0;
    this.highlightNextRing();
    this.callbacks.onTimeTrial({ phase: "start", index: 0, total: this.trialRings.length, ms: 0 });
  }

  cancelTimeTrial(): void {
    if (!this.trialActive) return;
    this.trialActive = false;
    this.teardownTrialRings();
    this.callbacks.onTimeTrial({ phase: "cancel", index: this.trialIndex, total: 0, ms: 0 });
  }

  private buildTrialRings(): void {
    this.teardownTrialRings();
    const group = new THREE.Group();
    const rand = mulberry32(dailySeed(this.progress.loop, 0x5217));
    const count = 6;
    for (let i = 0; i < count; i += 1) {
      const r = 30 + rand() * 60;
      const theta = rand() * Math.PI * 2;
      const y = (rand() - 0.5) * 70;
      const material = new THREE.MeshBasicMaterial({
        color: 0x33e7c8,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false
      });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.22, 14, 56), material);
      ring.position.set(Math.cos(theta) * r, y, Math.sin(theta) * r);
      ring.lookAt(0, y, 0);
      group.add(ring);
      this.trialRings.push(ring);
    }
    this.scene.add(group);
    this.trialGroup = group;
  }

  private teardownTrialRings(): void {
    if (this.trialGroup) {
      this.scene.remove(this.trialGroup);
      for (const ring of this.trialRings) {
        ring.geometry.dispose();
        disposeMaterial(ring.material);
      }
    }
    this.trialRings = [];
    this.trialGroup = null;
  }

  private highlightNextRing(): void {
    for (let i = 0; i < this.trialRings.length; i += 1) {
      const material = this.trialRings[i].material as THREE.MeshBasicMaterial;
      material.opacity = i === this.trialIndex ? 0.95 : i < this.trialIndex ? 0.12 : 0.4;
      material.color.setHex(i === this.trialIndex ? 0xffe27a : 0x33e7c8);
    }
  }

  private updateTimeTrial(): void {
    if (!this.trialActive) return;
    const ms = performance.now() - this.trialStart;
    const ring = this.trialRings[this.trialIndex];
    if (ring && this.camera.position.distanceTo(ring.position) < 3.4) {
      this.trialIndex += 1;
      if (this.trialIndex >= this.trialRings.length) {
        this.trialActive = false;
        this.callbacks.onTimeTrial({ phase: "finish", index: this.trialIndex, total: this.trialRings.length, ms });
        this.teardownTrialRings();
        return;
      }
      this.highlightNextRing();
      this.callbacks.onTimeTrial({ phase: "checkpoint", index: this.trialIndex, total: this.trialRings.length, ms });
    } else if (ms - this.trialLastTick > 100) {
      this.trialLastTick = ms;
      this.callbacks.onTimeTrial({ phase: "tick", index: this.trialIndex, total: this.trialRings.length, ms });
    }
  }

  private updateNearest(): void {
    let nearest: PlanetNode | null = null;
    let best = Infinity;
    for (const node of this.planets.values()) {
      if (!node.group.visible) continue;
      const distance = this.camera.position.distanceTo(node.group.position);
      if (distance < best) {
        best = distance;
        nearest = node;
      }
    }
    const nearEnough = nearest && best < nearest.world.size * 7.2 + 5;
    const id = nearEnough && nearest ? nearest.world.id : null;
    if (id !== this.lastNearestId) {
      this.lastNearestId = id;
      this.callbacks.onNearestWorld(nearEnough && nearest ? nearest.world : null);
    }
  }

  private updateHover(clientX: number, clientY: number): void {
    const world = this.pick(clientX, clientY);
    this.canvas.style.cursor = world ? "pointer" : "grab";
  }

  private pick(clientX: number, clientY: number): World | null {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, true);
    for (const hit of hits) {
      let object: THREE.Object3D | null = hit.object;
      while (object) {
        const id = object.userData.worldId as string | undefined;
        if (id) {
          const node = this.planets.get(id);
          if (node && node.group.visible) return node.world;
          break; // occluding planet is hidden → fall through to the next raycast hit
        }
        object = object.parent;
      }
    }
    return null;
  }

  private focusPlanet(node: PlanetNode, selectOnEnd: boolean): void {
    const direction = TMP_VEC.subVectors(this.camera.position, node.group.position);
    if (direction.lengthSq() < 0.01) direction.set(0, 0.2, 1);
    direction.normalize();
    const target = TMP_VEC_2.copy(node.group.position).addScaledVector(direction, node.world.size * 4.1 + 6);
    target.y += node.world.size * 0.55;
    TMP_OBJ.position.copy(target);
    TMP_OBJ.lookAt(node.group.position);
    this.focus = {
      startedAt: performance.now(),
      duration: 900,
      fromPos: this.camera.position.clone(),
      toPos: target.clone(),
      fromQuat: this.camera.quaternion.clone(),
      toQuat: TMP_OBJ.quaternion.clone(),
      world: selectOnEnd ? node.world : null
    };
  }

  private publishCosmosApi(): void {
    window.__cosmos = {
      revealPlanet: () => this.revealHiddenPlanet(),
      focusWorld: (id) => this.focusWorld(id),
      resetCamera: () => this.resetCamera(),
      startTimeTrial: () => this.startTimeTrial(),
      cancelTimeTrial: () => this.cancelTimeTrial()
    };
  }

  getInfo(): CosmosInfo {
    const stardustBudget = this.quality.label === "HIGH" ? 220 : this.quality.label === "BALANCED" ? 140 : 40;
    const depthFieldBudget = Number(this.cameraDepthField?.userData.particleBudget ?? 0);
    const foregroundRelicBudget = Number(this.foregroundRelicField?.userData.particleBudget ?? 0);
    const lensDustBudget = this.lensDustField?.geometry.getAttribute("position").count ?? 0;
    const cosmicWebBudget = Number(this.cosmicWebField?.userData.particleBudget ?? 0);
    const lensedGalaxyClusterBudget = Number(this.lensedGalaxyClusterField?.userData.particleBudget ?? 0);
    const nebulaCanyonBudget = Number(this.nebulaCanyonField?.userData.particleBudget ?? 0);
    const parallaxNebulaBudget = Number(this.parallaxNebulaVolume?.userData.particleBudget ?? 0);
    const stellarNurseryBudget = Number(this.stellarNurseryField?.userData.particleBudget ?? 0);
    const deepSpaceDebrisBudget = Number(this.deepSpaceDebrisField?.userData.particleBudget ?? 0);
    const relativisticWakeBudget = Number(this.relativisticWakeField?.userData.particleBudget ?? 0);
    const eventHorizonCitadelBudget = Number(this.eventHorizonCitadelField?.userData.particleBudget ?? 0);
    const megastructureBudget = Number(this.megastructureField?.userData.particleBudget ?? 0);
    const prismaticScatteringBudget = Number(this.prismaticScatteringField?.userData.particleBudget ?? 0);
    const blackHoleDetailBudget =
      Number(this.blackHole?.lensingArcs?.userData.particleBudget ?? 0) +
      Number(this.blackHole?.infall?.userData.particleBudget ?? 0) +
      Number(this.blackHole?.lensingStarfield?.userData.particleBudget ?? 0) +
      Number(this.blackHole?.photonSheath?.userData.particleBudget ?? 0) +
      Number(this.blackHole?.polarizationField?.userData.particleBudget ?? 0) +
      Number(this.blackHole?.accretionStructure?.userData.particleBudget ?? 0) +
      Number(this.blackHole?.rubbleHalo?.userData.particleBudget ?? 0);
    const sparkBudget = this.sparkActive ? 225000 : 0;
    let planetGlintBudget = 0;
    let nightNetworkBudget = 0;
    let ringDebrisBudget = 0;
    let magnetosphereBudget = 0;
    let orbitalInfrastructureBudget = 0;
    for (const node of this.planets.values()) {
      planetGlintBudget += node.terrainGlints?.geometry.getAttribute("position").count ?? 0;
      nightNetworkBudget += Number(node.nightNetwork?.userData.particleBudget ?? 0);
      ringDebrisBudget += Number(node.ringDebris?.userData.particleBudget ?? 0);
      magnetosphereBudget += Number(node.magnetosphere?.userData.particleBudget ?? 0);
      orbitalInfrastructureBudget += Number(node.orbitalInfrastructure?.userData.particleBudget ?? 0);
    }
    return {
      quality: this.quality.label,
      spark: this.sparkActive,
      webgl2: this.renderer.capabilities.isWebGL2,
      bloom: this.quality.bloom,
      gravity: Boolean(this.gravityPass),
      flare: Boolean(this.streakPass || this.lensArtifactPass || this.diffractionPass),
      rays: Boolean(this.lightShaftPass),
      msaa: this.composerSamples,
      particles: this.quality.starCount + this.quality.dustCount + stardustBudget + depthFieldBudget + foregroundRelicBudget + lensDustBudget + cosmicWebBudget + lensedGalaxyClusterBudget + nebulaCanyonBudget + parallaxNebulaBudget + stellarNurseryBudget + deepSpaceDebrisBudget + relativisticWakeBudget + eventHorizonCitadelBudget + megastructureBudget + prismaticScatteringBudget + blackHoleDetailBudget + sparkBudget + planetGlintBudget + nightNetworkBudget + ringDebrisBudget + magnetosphereBudget + orbitalInfrastructureBudget
    };
  }
}
