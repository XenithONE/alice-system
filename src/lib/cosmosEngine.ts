import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
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
  ring?: THREE.Mesh;
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

export interface CosmosInfo {
  quality: QualityTier["label"];
  spark: boolean;
  webgl2: boolean;
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
const TMP_OBJ = new THREE.Object3D();

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
    material.forEach((entry) => entry.dispose());
    return;
  }
  material.dispose();
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// Derive cheap surface relief from a planet's own color map luminance (no extra assets).
function applyLuminanceBump(material: THREE.MeshStandardMaterial, strength = 0.6): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBumpStrength = { value: strength };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uBumpStrength;
        float _lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }`
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
  private composer: EffectComposer | null = null;
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
  // v1.2 realism
  private envRT: THREE.WebGLRenderTarget | null = null;
  private readonly sunDir = new THREE.Vector3(54, 72, 48).normalize();
  // v1.1 gameplay + perf
  private readonly textureCache = new Map<string, THREE.Texture>();
  private readonly lastCamPos = new THREE.Vector3(0, 14, 82);
  private distanceAccum = 0;
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
    this.renderer.toneMappingExposure = 1.0; // lowered for the bright sun + tighter bloom (v1.2)
    this.renderer.setClearColor(0x03050b, 1);
    this.renderer.setPixelRatio(quality.dpr);
    this.camera.position.set(0, 14, 82);
    this.scene.fog = new THREE.FogExp2(0x03050b, 0.0065);
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", "AlicE sYsTeMの3D宇宙。ドラッグで視点、WASDで飛行、惑星クリックで選択。");

    this.setupLights();
    this.createBackground();
    this.createWorlds();
    this.createAnomalies();
    this.createStardust();
    this.createComposer();
    this.attachEvents();
    this.syncProgress(progress);
    this.resize();
    this.publishCosmosApi();
    this.callbacks.onReady({ quality: quality.label, spark: false, webgl2: this.renderer.capabilities.isWebGL2 });
    void this.initSparkLayer();
    this.animationId = window.requestAnimationFrame(this.frame);
  }

  syncProgress(progress: ProgressState): void {
    const loopChanged = this.progress.loop !== progress.loop;
    this.progress = progress;
    if (loopChanged) this.rebuildStardust(); // NG+ remix
    for (const node of this.planets.values()) {
      const completed = node.world.statusKey ? progress.completedWorlds.has(node.world.id) : false;
      node.completed = completed;
      node.group.visible = !node.world.hidden || progress.hiddenPlanet;
      const material = node.surface.material as THREE.MeshStandardMaterial;
      material.emissive.setHex(completed ? 0xffc56a : node.world.color);
      material.emissiveIntensity = completed ? 0.55 : 0.16;
      if (node.beacon) node.beacon.visible = completed || node.world.kind === "app";
      if (node.ring) {
        const ringMat = node.ring.material as THREE.MeshBasicMaterial;
        ringMat.color.setHex(completed ? 0xffd98a : node.world.atmosphere);
        ringMat.opacity = completed ? 0.82 : 0.46;
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
    const sun = new THREE.DirectionalLight(0xfff2dc, 2.8);
    sun.position.set(54, 72, 48);
    this.scene.add(sun);
    const cyan = new THREE.PointLight(0x33e7c8, 26, 120, 1.9);
    cyan.position.set(-22, 12, 16);
    this.scene.add(cyan);
    const violet = new THREE.PointLight(0x7b4dff, 18, 150, 2);
    violet.position.set(34, -18, -44);
    this.scene.add(violet);
    this.scene.add(new THREE.AmbientLight(0x28344d, 0.58));

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

  // Build a PMREM environment from the loaded equirect skybox → realistic IBL on planets (non-LOW).
  private buildEnvFrom(texture: THREE.Texture): void {
    if (this.quality.label === "LOW" || this.disposed || this.envRT) return;
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.envRT = pmrem.fromEquirectangular(texture);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = 0.3;
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
        texture.colorSpace = THREE.SRGBColorSpace;
        this.textureCache.set(url, texture);
        onReady(texture);
      },
      undefined,
      () => undefined
    );
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
    this.scene.add(sky);
    this.loader.load(
      assetPath("assets/cosmos-skybox.jpg"),
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        skyMat.map = texture;
        skyMat.needsUpdate = true;
        this.buildEnvFrom(texture);
      },
      undefined,
      () => {
        this.loader.load(assetPath("assets/cosmos-nebula.jpg"), (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          skyMat.map = texture;
          skyMat.needsUpdate = true;
          this.buildEnvFrom(texture);
        });
      }
    );

    const starGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.quality.starCount * 3);
    const colors = new Float32Array(this.quality.starCount * 3);
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
    }
    starGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    starGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.scene.add(
      new THREE.Points(
        starGeometry,
        new THREE.PointsMaterial({
          size: this.quality.label === "HIGH" ? 0.72 : 0.95,
          vertexColors: true,
          sizeAttenuation: true,
          transparent: true,
          opacity: 0.88,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        })
      )
    );

    const galaxy = this.createGalaxy();
    this.scene.add(galaxy);
    this.loadTexture("assets/particle.png", (texture) => {
      this.galaxyUniforms.uMap.value = texture;
      this.galaxyUniforms.uUseMap.value = 1;
    });
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
      scales[i] = 0.8 + rand() * 2.8;
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
          gl_PointSize = aScale * (260.0 / max(1.0, -mvPosition.z));
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
          float alpha = smoothstep(0.5, 0.0, d) * 0.58;
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
    for (let i = 0; i < visibleWorlds.length; i += 1) {
      const world = visibleWorlds[i];
      const angle = i * GOLDEN + 0.4;
      const radius = world.kind === "app" ? 24 : 38 + ((i * 11) % 19);
      const y = world.kind === "app" ? 8 : Math.sin(i * 1.57) * 18;
      const pos = new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius - 8);
      this.createPlanet(world, pos, i);
    }

    const hidden = this.worlds.find((world) => world.hidden);
    if (hidden) {
      this.hiddenPlanet = this.createPlanet(hidden, new THREE.Vector3(-52, 20, -54), 99);
      this.hiddenPlanet.group.visible = this.progress.hiddenPlanet;
    }
  }

  private createPlanet(world: World, position: THREE.Vector3, index: number): PlanetNode {
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
    if (this.quality.label !== "LOW") applyLuminanceBump(material, 0.6); // surface relief from the color map
    const surface = new THREE.Mesh(new THREE.SphereGeometry(world.size, this.quality.planetSegments, Math.max(24, this.quality.planetSegments / 2)), material);
    surface.userData.worldId = world.id;
    group.add(surface);
    this.pickables.push(surface);

    this.loader.load(
      assetPath(world.texture),
      (texture) => {
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
      this.loadTexture("assets/planet-clouds.png", (texture) => {
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
      ring = new THREE.Mesh(new THREE.RingGeometry(world.size * 1.45, world.size * 2.26, 128), ringMaterial);
      ring.rotation.x = Math.PI / 2 - 0.34;
      group.add(ring);
      this.loadTexture("assets/planet-ring.png", (texture) => {
        ringMaterial.map = texture;
        ringMaterial.needsUpdate = true;
      });
    }

    const beacon = this.createBeacon(world.atmosphere);
    beacon.visible = world.kind === "app";
    group.add(beacon);

    const node: PlanetNode = {
      group,
      world,
      surface,
      atmosphere,
      ring,
      clouds,
      beacon,
      radius: 0.02 + index * 0.003,
      phase: index * 1.2,
      completed: false
    };
    this.planets.set(world.id, node);
    return node;
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
          vec3 col = mix(uColor, uSunsetColor, sunset);
          float a = fres * day * uBoost + pow(max(dot(V, L), 0.0), 8.0) * day * 0.5;
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
    if (!this.quality.bloom) return;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.6, 0.8)); // strength, radius, threshold (only sun/speculars bloom)
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
      const c1 = this.createSparkCloud(spark, new THREE.Vector3(0, 4, -10), 0x33e7c8, 900, 42, 0.024);
      const c2 = this.createSparkCloud(spark, new THREE.Vector3(42, -4, 26), 0xff5c9d, 700, 73, 0.032);
      const c3 = this.createSparkCloud(spark, new THREE.Vector3(-52, 20, -54), 0x33e7c8, 650, 91, 0.028);
      this.sparkClouds.push(c1, c2, c3);
      this.scene.add(c1, c2, c3);
      this.sparkActive = true;
      this.callbacks.onReady({ quality: this.quality.label, spark: true, webgl2: this.renderer.capabilities.isWebGL2 });
    } catch (error) {
      this.sparkActive = false;
      console.warn("Spark layer disabled", error);
    }
  }

  private createSparkCloud(spark: unknown, center: THREE.Vector3, color: number, count: number, seed: number, scale: number): THREE.Object3D {
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
          const r = t * 13;
          const theta = rand() * Math.PI * 2;
          const phi = Math.acos(rand() * 2 - 1);
          pos.set(Math.sin(phi) * Math.cos(theta) * r, Math.cos(phi) * r * 0.72, Math.sin(phi) * Math.sin(theta) * r);
          scl.setScalar(scale * (0.6 + (1 - t) * 2.6) + rand() * scale * 1.4); // larger toward the glowing core
          col.copy(base).lerp(hot, (1 - t) * 0.5 + rand() * 0.12); // hot white core → colored rim
          splats.pushSplat(pos, scl, quat, (0.12 + (1 - t) * 0.42) * (0.7 + rand() * 0.5), col); // denser core
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
    this.composer?.setSize(width, height);
  };

  private readonly frame = (time: number): void => {
    if (this.disposed) return;
    const dt = Math.min(0.04, Math.max(0.001, (time - this.lastFrameTime) / 1000));
    this.lastFrameTime = time;
    this.galaxyUniforms.uTime.value = time * 0.001;
    this.updateCamera(dt, time);
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
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    if (this.keys.has("KeyW")) accel.add(forward);
    if (this.keys.has("KeyS")) accel.addScaledVector(forward, -1);
    if (this.keys.has("KeyA")) accel.addScaledVector(right, -1);
    if (this.keys.has("KeyD")) accel.add(right);
    if (this.keys.has("Space")) accel.y += 1;
    if (this.keys.has("ControlLeft") || this.keys.has("ControlRight")) accel.y -= 1;
    if (accel.lengthSq() > 0) {
      accel.normalize().multiplyScalar(speed * dt);
      this.camera.position.add(accel);
      this.camera.position.clamp(new THREE.Vector3(-105, -48, -105), new THREE.Vector3(105, 56, 105));
    }
  }

  private updatePlanets(dt: number, time: number): void {
    const t = time * 0.001;
    for (const node of this.planets.values()) {
      if (!node.group.visible) continue;
      node.surface.rotation.y += dt * (0.08 + node.radius);
      if (node.clouds) node.clouds.rotation.y -= dt * 0.045;
      if (node.ring) node.ring.rotation.z += dt * 0.025;
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
          return node && node.group.visible ? node.world : null;
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
    return { quality: this.quality.label, spark: this.sparkActive, webgl2: this.renderer.capabilities.isWebGL2 };
  }
}
