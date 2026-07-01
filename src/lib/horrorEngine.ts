import * as THREE from "three";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import type { QualityTier } from "./webgl";
import { mulberry32, dailySeed } from "./seed";

// ---------------------------------------------------------------- TYPES

export type GameMode = "menu" | "playing" | "paused" | "won" | "lost";
export type JumpscareKind = "chase" | "mirror" | "locker" | "finale" | "ambient";
export type LossKind = "caught" | "fear";

export interface GameInfo {
  quality: "HIGH" | "BALANCED" | "LOW";
  webgl2: boolean;
  spark: boolean;
  bloom: boolean;
}

export interface RunEndResult {
  won: boolean;
  ms: number;
  score: number;
  scares: number;
  hides: number;
  lossKind?: LossKind;
}

export interface HorrorCallbacks {
  onReady: (info: GameInfo) => void;
  onError: (message: string) => void;
  onFilesUpdate: (found: number, total: number) => void;
  onFear: (value: number) => void;
  onTime: (ms: number) => void;
  onJumpscare: (kind: JumpscareKind) => void;
  onHideChange: (hiding: boolean) => void;
  onFlashlightChange: (on: boolean) => void;
  onModeChange: (mode: GameMode) => void;
  onRunEnd: (result: RunEndResult) => void;
}

interface Box2D {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface Cell {
  x: number;
  z: number;
  n: boolean;
  e: boolean;
  s: boolean;
  w: boolean;
  visited: boolean;
}

interface GameItem {
  mesh: THREE.Mesh;
  light: THREE.PointLight | null;
  x: number;
  z: number;
  phase: number;
  got: boolean;
}

interface HideSpot {
  group: THREE.Group;
  door: THREE.Mesh;
  x: number;
  z: number;
  doorOpen: number;
}

interface LockerProp {
  group: THREE.Group;
  door: THREE.Mesh;
  x: number;
  z: number;
  doorOpen: number;
  lastScare: number;
}

interface MirrorProp {
  mesh: THREE.Mesh;
  faceMat: THREE.MeshBasicMaterial;
  x: number;
  z: number;
  nx: number;
  nz: number;
  triggered: boolean;
  flashT: number;
}

interface FlickerLight {
  light: THREE.PointLight;
  base: number;
  phase: number;
}

// ---------------------------------------------------------------- CONSTANTS

const GRID = 9;
const CELL = 4.4;
const WALL_THICK = 0.3;
const WALL_H = 3.35;
const HALF = (GRID * CELL) / 2;
const PLAYER_R = 0.34;
const PLAYER_SPEED = 3.6;
const EYE_H = 1.62;
const NEEDED_FILES = 6;
const HIDE_COUNT = 5;
const MIRROR_COUNT = 3;
const WANDER_SPEED = 1.15;
const HUNT_SPEED = 3.85;
const DETECT_RADIUS = 15;
const CONTACT_RADIUS = 1.05;
const HUNT_DECAY = 22;
const OBSERVE_COS = Math.cos((30 * Math.PI) / 180);
const OBSERVE_DIST = 17;
const PRE_EXIT_RADIUS = 7;
const EXIT_RADIUS = 2.1;

const TMP_VEC = new THREE.Vector3();
const TMP_VEC_2 = new THREE.Vector3();
const TMP_VEC_3 = new THREE.Vector3();
const TMP_COLOR = new THREE.Color();

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

function fmtTime(ms: number): string {
  if (ms <= 0 || !Number.isFinite(ms)) return "--:--.-";
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m).padStart(2, "0")}:${r < 10 ? "0" : ""}${r.toFixed(1)}`;
}

function cellIndex(x: number, z: number): number {
  return z * GRID + x;
}

function worldToCell(wx: number, wz: number): { x: number; z: number } {
  return {
    x: clamp(Math.round(wx / CELL + (GRID - 1) / 2), 0, GRID - 1),
    z: clamp(Math.round(wz / CELL + (GRID - 1) / 2), 0, GRID - 1)
  };
}

function cellCenter(cx: number, cz: number): { x: number; z: number } {
  return { x: (cx - (GRID - 1) / 2) * CELL, z: (cz - (GRID - 1) / 2) * CELL };
}

// Small canvas-drawn textures — zero external asset dependency (safe / no license risk).
function makeGlowTexture(size = 128): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.55)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// Procedural "face in the dark" texture for the mirror jumpscare — a vague pale
// face-like shape with dark hollow eyes, drawn once and reused across all mirrors.
function makeFaceTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(0,0,0,0)";
  ctx.fillRect(0, 0, size, size);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  const grad = ctx.createRadialGradient(0, -10, 10, 0, 0, 110);
  grad.addColorStop(0, "rgba(214,222,222,0.92)");
  grad.addColorStop(0.7, "rgba(180,190,190,0.55)");
  grad.addColorStop(1, "rgba(180,190,190,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(0, 0, 66, 92, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(6,4,8,0.94)";
  ctx.beginPath();
  ctx.ellipse(-24, -8, 12, 17, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(24, -8, 12, 17, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(6,4,8,0.7)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-20, 34);
  ctx.lineTo(20, 30);
  ctx.stroke();
  ctx.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function loadPbrSet(
  loader: THREE.TextureLoader,
  base: string,
  repeat: number
): { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture } {
  const map = loader.load(`${base}/diff.jpg`);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(repeat, repeat);
  const normalMap = loader.load(`${base}/nor.jpg`);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(repeat, repeat);
  const roughnessMap = loader.load(`${base}/rough.jpg`);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(repeat, repeat);
  return { map, normalMap, roughnessMap };
}

// Disposes a material AND any map/normalMap/roughnessMap it holds — Material.dispose()
// alone does not cascade to its textures, which would otherwise leak GPU memory.
function disposeMaterial(material: THREE.Material): void {
  const withMaps = material as THREE.MeshStandardMaterial & THREE.MeshBasicMaterial;
  withMaps.map?.dispose();
  withMaps.normalMap?.dispose();
  withMaps.roughnessMap?.dispose();
  material.dispose();
}
function disposeMaterials(material: THREE.Material | THREE.Material[] | undefined | null): void {
  if (!material) return;
  if (Array.isArray(material)) material.forEach(disposeMaterial);
  else disposeMaterial(material);
}

// ---------------------------------------------------------------- ENGINE

export class HorrorEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly touchLayer: HTMLDivElement;
  private readonly quality: QualityTier;
  private readonly callbacks: HorrorCallbacks;
  private loop: number;

  private readonly scene = new THREE.Scene();
  // Holds every maze/prop/warden object that setLoop() needs to tear down and rebuild
  // on an NG+ remix. Lights + camera (buildLights) are NOT in here — they're permanent.
  private levelGroup = new THREE.Group();
  private readonly camera = new THREE.PerspectiveCamera(72, 1, 0.1, 60);
  private readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private fearPass: ShaderPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private hdrTexture: THREE.Texture | null = null;

  private disposed = false;
  private animationId = 0;
  private readonly clock = new THREE.Clock();

  private mode: GameMode = "menu";
  private startedAt = 0;
  private elapsedMs = 0;
  private score = 0;
  private scaresThisRun = new Set<JumpscareKind>();
  private hidesThisRun = 0;

  private cells: Cell[] = [];
  private wallBoxes: Box2D[] = [];
  private spawnCell = { x: 0, z: 0 };
  private exitCell = { x: 0, z: 0 };

  private items: GameItem[] = [];
  private filesFound = 0;
  private hideSpots: HideSpot[] = [];
  private lockers: LockerProp[] = [];
  private mirrors: MirrorProp[] = [];
  private flickerLights: FlickerLight[] = [];

  private exitSign: THREE.Group | null = null;
  private exitTrulyOpen = false;
  private financeFinaleFired = false;

  private warden: THREE.Group | null = null;
  private wardenEyes: THREE.Mesh[] = [];
  private wardenPos = new THREE.Vector3();
  private wardenCell = 0;
  private wardenPath: number[] = [];
  private wardenPathIdx = 0;
  private wardenMode: "wander" | "hunt" = "wander";
  private wardenHuntTimer = 0;
  private wardenRepathT = 0;

  private fear = 0;
  private hiding = false;
  private hidingSpot: HideSpot | null = null;
  private flashlightOn = true;
  private muted = false;
  private invuln = 0;

  private flash!: THREE.SpotLight;
  private handGlow!: THREE.PointLight;

  private yaw = 0;
  private pitch = 0;
  private lookSens = 0.0022;
  private bloomEnabled: boolean;
  private shakeEnabled: boolean;
  private fovKick = 0;
  private punchX = 0;
  private punchZ = 0;

  private readonly keys: Record<string, boolean> = { f: false, b: false, l: false, r: false };
  private readonly keyMap: Record<string, "f" | "b" | "l" | "r"> = {
    ArrowUp: "f", w: "f", W: "f",
    ArrowDown: "b", s: "b", S: "b",
    ArrowLeft: "l", a: "l", A: "l",
    ArrowRight: "r", d: "r", D: "r"
  };
  private dragging = false;
  private readonly isTouch: boolean;
  private readonly sticks: {
    left: { id: number; ox: number; oy: number; dx: number; dy: number } | null;
    right: { id: number; ox: number; oy: number; dx: number; dy: number } | null;
  } = { left: null, right: null };
  private stickEls: { left: HTMLDivElement; right: HTMLDivElement } | null = null;
  private touchPointerDown: ((e: PointerEvent) => void) | null = null;
  private touchPointerMove: ((e: PointerEvent) => void) | null = null;
  private touchPointerUp: ((e: PointerEvent) => void) | null = null;

  private dustMesh: SplatMesh | null = null;
  private fogMesh: SplatMesh | null = null;
  private sparkRendererReady = false;

  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private droneGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private lastLockerScare = -30;
  private lastAmbientScare = -12;

  private readonly onKeyDown = (e: KeyboardEvent): void => this.handleKeyDown(e);
  private readonly onKeyUp = (e: KeyboardEvent): void => this.handleKeyUp(e);
  private readonly onMouseMove = (e: MouseEvent): void => this.handleMouseMove(e);
  private readonly onMouseDown = (): void => this.handleMouseDown();
  private readonly onMouseUp = (): void => { this.dragging = false; };
  private readonly onPointerLockChange = (): void => this.handlePointerLockChange();
  private readonly onVisibility = (): void => {
    if (!document.hidden && this.ac && this.ac.state !== "running") this.ac.resume().catch(() => undefined);
  };
  private readonly onResize = (): void => this.resize();

  constructor(canvas: HTMLCanvasElement, touchLayer: HTMLDivElement, quality: QualityTier, callbacks: HorrorCallbacks, loop: number) {
    this.canvas = canvas;
    this.touchLayer = touchLayer;
    this.quality = quality;
    this.callbacks = callbacks;
    this.loop = loop;
    this.bloomEnabled = quality.bloom;
    this.shakeEnabled = !quality.reducedMotion;
    this.isTouch = window.matchMedia("(hover: none)").matches || "ontouchstart" in window;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.aa, powerPreference: "high-performance" });
    } catch (err) {
      callbacks.onError(`WebGL init failed: ${String(err)}`);
      throw err;
    }
    this.renderer = renderer;
    this.renderer.setPixelRatio(quality.dpr);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.shadowMap.type = quality.label === "HIGH" ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer.setClearColor(0x030408, 1);

    this.camera.rotation.order = "YXZ";
    this.scene.fog = new THREE.FogExp2(0x03040a, 0.052);

    this.scene.add(this.levelGroup);
    this.buildMaze();
    this.buildLights();
    this.buildGeometry();
    this.buildProps();
    this.buildWarden();
    this.setupSparkAtmosphere();
    this.setupComposer();
    this.setupTouchSticks();
    this.attachInput();
    this.resize();

    const spawn = cellCenter(this.spawnCell.x, this.spawnCell.z);
    this.camera.position.set(spawn.x, EYE_H, spawn.z);
    this.yaw = 0;
    this.pitch = 0;

    this.wardenCell = this.farthestCellFrom(this.spawnCell.x, this.spawnCell.z, 0.35).idx;
    this.wardenPos.copy(this.cellWorldPos(this.wardenCell));
    if (this.warden) this.warden.position.copy(this.wardenPos);

    this.callbacks.onReady({
      quality: quality.label,
      webgl2: this.renderer.capabilities.isWebGL2,
      spark: quality.spark,
      bloom: quality.bloom
    });

    this.animationId = window.requestAnimationFrame(this.frame);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("visibilitychange", this.onVisibility);
  }

  // ---------------------------------------------------------- MAZE GENERATION

  private buildMaze(): void {
    const rand = mulberry32(dailySeed(this.loop, 0x484f57));
    const cells: Cell[] = [];
    for (let z = 0; z < GRID; z += 1) {
      for (let x = 0; x < GRID; x += 1) {
        cells.push({ x, z, n: false, e: false, s: false, w: false, visited: false });
      }
    }
    const at = (x: number, z: number): Cell => cells[cellIndex(x, z)];
    const startX = 0;
    const startZ = GRID - 1;
    at(startX, startZ).visited = true;
    const stack: Cell[] = [at(startX, startZ)];
    while (stack.length > 0) {
      const cur = stack[stack.length - 1];
      const allDirs: Array<{ dx: number; dz: number; dir: "n" | "e" | "s" | "w"; opp: "n" | "e" | "s" | "w" }> = [
        { dx: 0, dz: -1, dir: "n", opp: "s" },
        { dx: 1, dz: 0, dir: "e", opp: "w" },
        { dx: 0, dz: 1, dir: "s", opp: "n" },
        { dx: -1, dz: 0, dir: "w", opp: "e" }
      ];
      const options = allDirs.filter((o) => {
        const nx = cur.x + o.dx;
        const nz = cur.z + o.dz;
        return nx >= 0 && nx < GRID && nz >= 0 && nz < GRID && !at(nx, nz).visited;
      });
      if (options.length === 0) {
        stack.pop();
        continue;
      }
      const pick = options[Math.floor(rand() * options.length)];
      const next = at(cur.x + pick.dx, cur.z + pick.dz);
      cur[pick.dir] = true;
      next[pick.opp] = true;
      next.visited = true;
      stack.push(next);
    }
    this.cells = cells;

    // Wall AABBs — thin boxes on every closed cell edge (see collide()/los()).
    const boxes: Box2D[] = [];
    for (let z = 0; z <= GRID; z += 1) {
      for (let x = 0; x < GRID; x += 1) {
        const isWall = z === 0 || z === GRID || !at(x, z === GRID ? z - 1 : z)[z === GRID ? "s" : "n"];
        if (!isWall) continue;
        const cx = (x - (GRID - 1) / 2) * CELL;
        const wz = (z - GRID / 2) * CELL;
        boxes.push({ minX: cx - CELL / 2, maxX: cx + CELL / 2, minZ: wz - WALL_THICK / 2, maxZ: wz + WALL_THICK / 2 });
      }
    }
    for (let x = 0; x <= GRID; x += 1) {
      for (let z = 0; z < GRID; z += 1) {
        const isWall = x === 0 || x === GRID || !at(x === GRID ? x - 1 : x, z)[x === GRID ? "e" : "w"];
        if (!isWall) continue;
        const wx = (x - GRID / 2) * CELL;
        const cz = (z - (GRID - 1) / 2) * CELL;
        boxes.push({ minX: wx - WALL_THICK / 2, maxX: wx + WALL_THICK / 2, minZ: cz - CELL / 2, maxZ: cz + CELL / 2 });
      }
    }
    this.wallBoxes = boxes;
    this.spawnCell = { x: startX, z: startZ };
    const farthest = this.farthestCellFrom(startX, startZ, 1);
    this.exitCell = { x: farthest.idx % GRID, z: Math.floor(farthest.idx / GRID) };
  }

  private bfsDistances(fromX: number, fromZ: number): Int32Array {
    const dist = new Int32Array(GRID * GRID).fill(-1);
    const startIdx = cellIndex(fromX, fromZ);
    dist[startIdx] = 0;
    const queue: number[] = [startIdx];
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head];
      head += 1;
      const cx = cur % GRID;
      const cz = Math.floor(cur / GRID);
      const cell = this.cells[cur];
      const neighbors: Array<[boolean, number, number]> = [
        [cell.n, cx, cz - 1],
        [cell.e, cx + 1, cz],
        [cell.s, cx, cz + 1],
        [cell.w, cx - 1, cz]
      ];
      for (const [open, nx, nz] of neighbors) {
        if (!open || nx < 0 || nx >= GRID || nz < 0 || nz >= GRID) continue;
        const ni = cellIndex(nx, nz);
        if (dist[ni] !== -1) continue;
        dist[ni] = dist[cur] + 1;
        queue.push(ni);
      }
    }
    return dist;
  }

  private bfsPath(fromIdx: number, toIdx: number): number[] {
    if (fromIdx === toIdx) return [fromIdx];
    const prev = new Int32Array(GRID * GRID).fill(-1);
    const visited = new Uint8Array(GRID * GRID);
    visited[fromIdx] = 1;
    const queue: number[] = [fromIdx];
    let head = 0;
    let found = false;
    while (head < queue.length && !found) {
      const cur = queue[head];
      head += 1;
      const cx = cur % GRID;
      const cz = Math.floor(cur / GRID);
      const cell = this.cells[cur];
      const neighbors: Array<[boolean, number, number]> = [
        [cell.n, cx, cz - 1],
        [cell.e, cx + 1, cz],
        [cell.s, cx, cz + 1],
        [cell.w, cx - 1, cz]
      ];
      for (const [open, nx, nz] of neighbors) {
        if (!open || nx < 0 || nx >= GRID || nz < 0 || nz >= GRID) continue;
        const ni = cellIndex(nx, nz);
        if (visited[ni]) continue;
        visited[ni] = 1;
        prev[ni] = cur;
        queue.push(ni);
        if (ni === toIdx) { found = true; break; }
      }
    }
    const path: number[] = [toIdx];
    let walk = toIdx;
    while (walk !== fromIdx) {
      const p = prev[walk];
      if (p === -1) break;
      path.push(p);
      walk = p;
    }
    path.reverse();
    return path;
  }

  private farthestCellFrom(fromX: number, fromZ: number, fractionOfMax: number): { idx: number; dist: number } {
    const dist = this.bfsDistances(fromX, fromZ);
    let max = 0;
    for (const d of dist) if (d > max) max = d;
    const threshold = max * fractionOfMax;
    const candidates: number[] = [];
    for (let i = 0; i < dist.length; i += 1) if (dist[i] >= threshold) candidates.push(i);
    const idx = candidates.length > 0 ? candidates[Math.floor(candidates.length / 2)] : dist.indexOf(max);
    return { idx, dist: dist[idx] };
  }

  private cellWorldPos(idx: number, out?: THREE.Vector3): THREE.Vector3 {
    const cx = idx % GRID;
    const cz = Math.floor(idx / GRID);
    const p = cellCenter(cx, cz);
    return (out ?? new THREE.Vector3()).set(p.x, 1.3, p.z);
  }

  // ---------------------------------------------------------- GEOMETRY / MATERIALS

  private buildLights(): void {
    this.scene.add(new THREE.AmbientLight(0x0a1018, 0.55));
    const hemi = new THREE.HemisphereLight(0x1a2436, 0x03040a, 0.5);
    this.scene.add(hemi);

    this.flash = new THREE.SpotLight(0xeaf2ff, 105, 20, Math.PI / 6.6, 0.5, 1.2);
    this.flash.castShadow = this.quality.shadows;
    if (this.quality.shadows) {
      this.flash.shadow.mapSize.set(this.quality.shadowSize, this.quality.shadowSize);
      this.flash.shadow.camera.near = 0.5;
      this.flash.shadow.camera.far = 20;
      this.flash.shadow.bias = -0.0004;
      this.flash.shadow.normalBias = 0.02;
    }
    this.flash.position.set(0, -0.05, 0.15);
    this.flash.target.position.set(0, -0.4, -1);
    this.camera.add(this.flash);
    this.camera.add(this.flash.target);

    this.handGlow = new THREE.PointLight(0x8fa6c0, 1.8, 5, 1.6);
    this.handGlow.position.set(0, -0.1, 0.2);
    this.camera.add(this.handGlow);
    this.scene.add(this.camera);
  }

  private buildGeometry(): void {
    const loader = new THREE.TextureLoader();
    const anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());

    const floorPbr = loadPbrSet(loader, "assets/textures/floor", GRID * 1.1);
    const wallPbr = loadPbrSet(loader, "assets/textures/wall", CELL / 1.6);
    floorPbr.map.anisotropy = anisotropy;
    wallPbr.map.anisotropy = anisotropy;

    const floorMat = new THREE.MeshStandardMaterial({
      map: floorPbr.map,
      normalMap: floorPbr.normalMap,
      roughnessMap: floorPbr.roughnessMap,
      roughness: 1,
      metalness: 0,
      envMapIntensity: 0.4
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(GRID * CELL, GRID * CELL), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = this.quality.shadows;
    this.levelGroup.add(floor);

    const ceilMat = new THREE.MeshStandardMaterial({ color: 0x0a0c12, roughness: 1, metalness: 0 });
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(GRID * CELL, GRID * CELL), ceilMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = WALL_H;
    this.levelGroup.add(ceiling);

    const wallMat = new THREE.MeshStandardMaterial({
      map: wallPbr.map,
      normalMap: wallPbr.normalMap,
      roughnessMap: wallPbr.roughnessMap,
      roughness: 1,
      metalness: 0,
      envMapIntensity: 0.35
    });

    const horizontalBoxes = this.wallBoxes.filter((b) => b.maxX - b.minX > b.maxZ - b.minZ);
    const verticalBoxes = this.wallBoxes.filter((b) => b.maxX - b.minX <= b.maxZ - b.minZ);
    const buildInstanced = (boxes: Box2D[]): THREE.InstancedMesh => {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const inst = new THREE.InstancedMesh(geo, wallMat, Math.max(1, boxes.length));
      inst.castShadow = this.quality.shadows;
      inst.receiveShadow = this.quality.shadows;
      const dummy = new THREE.Object3D();
      boxes.forEach((b, i) => {
        const cx = (b.minX + b.maxX) / 2;
        const cz = (b.minZ + b.maxZ) / 2;
        dummy.position.set(cx, WALL_H / 2, cz);
        dummy.scale.set(b.maxX - b.minX, WALL_H, b.maxZ - b.minZ);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      return inst;
    };
    this.levelGroup.add(buildInstanced(horizontalBoxes));
    this.levelGroup.add(buildInstanced(verticalBoxes));

    // Subtle IBL from the CC0 HDRI (creepy_bathroom) — floor/metal reflections only,
    // kept low-intensity so the flashlight remains the dominant light source.
    if (this.quality.label !== "LOW") {
      // setLoop() remixes call buildGeometry() again — drop the previous run's env
      // render target first so scene.environment never points at a disposed texture.
      if (this.envRT) { this.envRT.dispose(); this.envRT = null; this.scene.environment = null; }
      const rgbeLoader = new RGBELoader();
      rgbeLoader.load(
        "assets/hdri/creepy_bathroom_1k.hdr",
        (texture) => {
          if (this.disposed) return;
          const pmrem = new THREE.PMREMGenerator(this.renderer);
          const envRT = pmrem.fromEquirectangular(texture);
          this.envRT = envRT;
          this.scene.environment = envRT.texture;
          this.scene.environmentIntensity = 0.18;
          pmrem.dispose();
          texture.dispose();
        },
        undefined,
        () => undefined
      );
    }
  }

  // ---------------------------------------------------------- PROPS

  private buildProps(): void {
    const rand = mulberry32(dailySeed(this.loop, 0x9917));
    const dist = this.bfsDistances(this.spawnCell.x, this.spawnCell.z);
    const order = Array.from(dist.keys())
      .filter((i) => dist[i] > 2 && i !== this.spawnCell.x + this.spawnCell.z * GRID && i !== this.exitCell.x + this.exitCell.z * GRID)
      .sort((a, b) => dist[b] - dist[a]);

    const used = new Set<number>();
    const pickSpread = (count: number): number[] => {
      const picked: number[] = [];
      for (const idx of order) {
        if (used.has(idx)) continue;
        const cx = idx % GRID;
        const cz = Math.floor(idx / GRID);
        const tooClose = picked.some((p) => {
          const px = p % GRID;
          const pz = Math.floor(p / GRID);
          return Math.abs(px - cx) + Math.abs(pz - cz) < 2;
        });
        if (tooClose) continue;
        picked.push(idx);
        used.add(idx);
        if (picked.length >= count) break;
      }
      return picked;
    };

    const fileGeo = new THREE.BoxGeometry(0.34, 0.44, 0.05);
    const fileMat = new THREE.MeshStandardMaterial({
      color: 0x6b5a3a,
      emissive: 0xffd166,
      emissiveIntensity: 1.1,
      roughness: 0.5,
      metalness: 0.1
    });
    for (const idx of pickSpread(NEEDED_FILES)) {
      const c = cellCenter(idx % GRID, Math.floor(idx / GRID));
      const jitterX = c.x + (rand() - 0.5) * (CELL * 0.4);
      const jitterZ = c.z + (rand() - 0.5) * (CELL * 0.4);
      const mesh = new THREE.Mesh(fileGeo, fileMat.clone());
      mesh.position.set(jitterX, 1.05, jitterZ);
      this.levelGroup.add(mesh);
      const light = this.quality.label !== "LOW" ? new THREE.PointLight(0xffd166, 1.6, 4.5, 1.6) : null;
      if (light) {
        light.position.set(jitterX, 1.1, jitterZ);
        this.levelGroup.add(light);
      }
      this.items.push({ mesh, light, x: jitterX, z: jitterZ, phase: rand() * Math.PI * 2, got: false });
    }

    const lockerMat = new THREE.MeshStandardMaterial({ color: 0x1c2430, roughness: 0.6, metalness: 0.4 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x222c3a, roughness: 0.55, metalness: 0.45 });
    for (const idx of pickSpread(HIDE_COUNT)) {
      const c = cellCenter(idx % GRID, Math.floor(idx / GRID));
      const group = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2, 0.7), lockerMat);
      body.position.y = 1;
      body.castShadow = this.quality.shadows;
      group.add(body);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.9, 0.06), doorMat);
      door.position.set(0.22, 1, 0.38);
      group.add(door);
      group.position.set(c.x + (rand() - 0.5) * 1.4, 0, c.z + (rand() - 0.5) * 1.4);
      group.rotation.y = Math.floor(rand() * 4) * (Math.PI / 2);
      this.levelGroup.add(group);
      this.hideSpots.push({ group, door, x: group.position.x, z: group.position.z, doorOpen: 0 });
    }

    // Decorative-only lockers used purely for the environmental "slam" scare.
    for (const idx of pickSpread(4)) {
      const c = cellCenter(idx % GRID, Math.floor(idx / GRID));
      const group = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.7, 0.5), lockerMat);
      body.position.y = 0.85;
      group.add(body);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.6, 0.05), doorMat);
      door.position.set(0.15, 0.85, 0.27);
      group.add(door);
      group.position.set(c.x + (rand() - 0.5) * 1.4, 0, c.z + (rand() - 0.5) * 1.4);
      group.rotation.y = Math.floor(rand() * 4) * (Math.PI / 2);
      this.levelGroup.add(group);
      this.lockers.push({ group, door, x: group.position.x, z: group.position.z, doorOpen: 0, lastScare: -999 });
    }

    const faceTexture = makeFaceTexture();
    const mirrorGeo = new THREE.PlaneGeometry(0.9, 1.5);
    for (const idx of pickSpread(MIRROR_COUNT)) {
      const c = cellCenter(idx % GRID, Math.floor(idx / GRID));
      const cell = this.cells[cellIndex(idx % GRID, Math.floor(idx / GRID))];
      const dirs: Array<{ open: boolean; nx: number; nz: number }> = [
        { open: cell.n, nx: 0, nz: -1 },
        { open: cell.e, nx: 1, nz: 0 },
        { open: cell.s, nx: 0, nz: 1 },
        { open: cell.w, nx: -1, nz: 0 }
      ];
      const wallDirs = dirs.filter((d) => !d.open);
      const facing = wallDirs.length > 0 ? wallDirs[0] : dirs[0];
      const baseMat = new THREE.MeshBasicMaterial({ color: 0x141a22, transparent: true, opacity: 0.5 });
      const mesh = new THREE.Mesh(mirrorGeo, baseMat);
      const offset = CELL / 2 - 0.05;
      mesh.position.set(c.x + facing.nx * offset, 1.5, c.z + facing.nz * offset);
      mesh.rotation.y = Math.atan2(-facing.nx, -facing.nz);
      this.levelGroup.add(mesh);
      this.mirrors.push({
        mesh,
        faceMat: new THREE.MeshBasicMaterial({ map: faceTexture, transparent: true, opacity: 0, depthWrite: false }),
        x: mesh.position.x,
        z: mesh.position.z,
        nx: facing.nx,
        nz: facing.nz,
        triggered: false,
        flashT: 0
      });
      const faceMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), this.mirrors[this.mirrors.length - 1].faceMat);
      faceMesh.position.copy(mesh.position);
      faceMesh.position.y += 0.05;
      faceMesh.rotation.copy(mesh.rotation);
      this.levelGroup.add(faceMesh);
    }

    // Flickering emergency ceiling lights.
    if (this.quality.label !== "LOW") {
      const flickerCells = pickSpread(this.quality.label === "HIGH" ? 8 : 5);
      for (const idx of flickerCells) {
        const c = cellCenter(idx % GRID, Math.floor(idx / GRID));
        const base = 1.1 + rand() * 0.6;
        const light = new THREE.PointLight(0x8fb0c8, base, 6.5, 1.8);
        light.position.set(c.x, WALL_H - 0.3, c.z);
        this.levelGroup.add(light);
        this.flickerLights.push({ light, base, phase: rand() * Math.PI * 2 });
      }
    }

    // Exit sign at the farthest cell.
    const exitCenter = cellCenter(this.exitCell.x, this.exitCell.z);
    const exitGroup = new THREE.Group();
    const signMat = new THREE.MeshStandardMaterial({ color: 0x2a0d0d, emissive: 0xff3b3b, emissiveIntensity: 1.4, roughness: 0.5 });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.32, 0.08), signMat);
    sign.position.set(exitCenter.x, WALL_H - 0.4, exitCenter.z);
    exitGroup.add(sign);
    const exitLight = new THREE.PointLight(0xff5050, 1.6, 6, 1.7);
    exitLight.position.set(exitCenter.x, WALL_H - 0.5, exitCenter.z);
    exitGroup.add(exitLight);
    this.levelGroup.add(exitGroup);
    this.exitSign = exitGroup;
  }

  // ---------------------------------------------------------- WARDEN (monster)

  private buildWarden(): void {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x07080b, roughness: 1, metalness: 0, emissive: 0x040308, emissiveIntensity: 0.25 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 1.15, 6, 10), bodyMat);
    body.position.y = 0;
    body.castShadow = this.quality.shadows;
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 12), bodyMat);
    head.position.y = 0.86;
    head.castShadow = this.quality.shadows;
    group.add(head);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a0303, emissive: 0xff2b2b, emissiveIntensity: 1.6, roughness: 0.3 });
    const eyeGeo = new THREE.SphereGeometry(0.045, 10, 8);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.09, 0.9, 0.22);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.09;
    group.add(eyeL, eyeR);
    this.wardenEyes = [eyeL, eyeR];
    this.levelGroup.add(group);
    this.warden = group;
  }

  // ---------------------------------------------------------- SPARKJS ATMOSPHERE

  private setupSparkAtmosphere(): void {
    if (!this.quality.spark) return;
    // Remixing (setLoop) calls this again — drop the previous run's splats first.
    if (this.dustMesh) { this.scene.remove(this.dustMesh); this.dustMesh.dispose(); this.dustMesh = null; }
    if (this.fogMesh) { this.scene.remove(this.fogMesh); this.fogMesh.dispose(); this.fogMesh = null; }
    // SparkRenderer is a renderer-wide utility (not per-maze content) — create it once
    // and reuse across setLoop() remixes instead of adding a duplicate every time.
    if (!this.sparkRendererReady) {
      try {
        const sparkRenderer = new SparkRenderer({ renderer: this.renderer });
        this.scene.add(sparkRenderer);
        this.sparkRendererReady = true;
      } catch {
        return;
      }
    }

    const rand = mulberry32(dailySeed(this.loop, 0x5a17));
    const scale = new THREE.Vector3(0.02, 0.02, 0.02);
    const quat = new THREE.Quaternion();
    const dustCount = this.quality.motes;
    this.dustMesh = new SplatMesh({
      constructSplats: (splats) => {
        for (let i = 0; i < dustCount; i += 1) {
          const x = (rand() - 0.5) * GRID * CELL;
          const y = rand() * WALL_H * 0.85;
          const z = (rand() - 0.5) * GRID * CELL;
          TMP_COLOR.setRGB(0.85, 0.82, 0.7).multiplyScalar(0.5 + rand() * 0.5);
          splats.pushSplat(new THREE.Vector3(x, y, z), scale, quat, 0.35 + rand() * 0.3, TMP_COLOR.clone());
        }
      },
      onFrame: ({ mesh, time }) => {
        mesh.rotation.y = Math.sin(time * 0.05) * 0.02;
      }
    });
    this.scene.add(this.dustMesh);

    const fogScale = new THREE.Vector3(0.55, 0.12, 0.55);
    const fogCount = Math.round(dustCount * 0.4);
    this.fogMesh = new SplatMesh({
      constructSplats: (splats) => {
        for (let i = 0; i < fogCount; i += 1) {
          const x = (rand() - 0.5) * GRID * CELL;
          const y = 0.15 + rand() * 0.5;
          const z = (rand() - 0.5) * GRID * CELL;
          TMP_COLOR.setRGB(0.5, 0.55, 0.6).multiplyScalar(0.4 + rand() * 0.3);
          splats.pushSplat(new THREE.Vector3(x, y, z), fogScale, quat, 0.18 + rand() * 0.14, TMP_COLOR.clone());
        }
      },
      onFrame: ({ mesh, time }) => {
        mesh.position.x = Math.sin(time * 0.03) * 0.5;
        mesh.position.z = Math.cos(time * 0.026) * 0.5;
      }
    });
    this.scene.add(this.fogMesh);
  }

  // ---------------------------------------------------------- POST-PROCESSING

  private setupComposer(): void {
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const size = new THREE.Vector2(1, 1);
    this.bloomPass = new UnrealBloomPass(size, this.quality.label === "HIGH" ? 0.82 : 0.6, 0.42, 0.6);
    this.bloomPass.enabled = this.bloomEnabled;
    composer.addPass(this.bloomPass);

    const fearShader = {
      uniforms: { tDiffuse: { value: null }, fear: { value: 0 }, warden: { value: 0 }, time: { value: 0 }, flash: { value: 0 } },
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float fear; uniform float warden; uniform float time; uniform float flash;
        varying vec2 vUv;
        void main(){
          float amt = (fear*0.0013 + warden*0.0026) * (0.6 + 0.4*sin(time*9.0));
          vec2 off = vec2(amt, amt*0.7);
          float r = texture2D(tDiffuse, vUv + off).r;
          float g = texture2D(tDiffuse, vUv).g;
          float b = texture2D(tDiffuse, vUv - off).b;
          vec3 col = vec3(r,g,b);
          float vig = smoothstep(0.95, 0.22, distance(vUv, vec2(0.5)));
          col *= mix(1.0, vig, 0.32 + fear*0.0035);
          col += (fract(sin(dot(vUv*vec2(12.0,78.0)+time, vec2(12.9898,78.233)))*43758.5453)-0.5) * (0.014 + fear*0.0002);
          col = mix(col, vec3(1.0,0.94,0.9), flash);
          gl_FragColor = vec4(col,1.0);
        }`
    };
    this.fearPass = new ShaderPass(fearShader);
    composer.addPass(this.fearPass);
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  // ---------------------------------------------------------- INPUT

  private setupTouchSticks(): void {
    if (!this.isTouch) return;
    const makeStick = (): HTMLDivElement => {
      const el = document.createElement("div");
      el.style.cssText =
        "position:fixed;z-index:15;width:112px;height:112px;border-radius:50%;border:1px solid rgba(255,209,102,.22);" +
        "background:rgba(20,10,10,.22);display:none;pointer-events:none;transform:translate(-50%,-50%)";
      const knob = document.createElement("div");
      knob.style.cssText =
        "position:absolute;left:50%;top:50%;width:44px;height:44px;border-radius:50%;background:rgba(255,209,102,.16);" +
        "border:1px solid rgba(255,209,102,.4);transform:translate(-50%,-50%)";
      el.appendChild(knob);
      this.touchLayer.appendChild(el);
      return el;
    };
    this.stickEls = { left: makeStick(), right: makeStick() };

    const showStick = (side: "left" | "right", x: number, y: number): void => {
      const el = side === "left" ? this.stickEls?.left : this.stickEls?.right;
      if (!el) return;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.display = "block";
      (el.firstChild as HTMLDivElement).style.left = "50%";
      (el.firstChild as HTMLDivElement).style.top = "50%";
    };
    const moveKnob = (side: "left" | "right", dx: number, dy: number): void => {
      const el = side === "left" ? this.stickEls?.left : this.stickEls?.right;
      if (!el) return;
      const knob = el.firstChild as HTMLDivElement;
      knob.style.left = `${50 + (dx / 60) * 50}%`;
      knob.style.top = `${50 + (dy / 60) * 50}%`;
    };
    const hideStick = (side: "left" | "right"): void => {
      const el = side === "left" ? this.stickEls?.left : this.stickEls?.right;
      if (el) el.style.display = "none";
    };

    this.touchPointerDown = (e) => {
      if (this.mode !== "playing" || this.hiding) return;
      if ((e.target as HTMLElement | null)?.closest?.(".touch-btn")) return;
      const side: "left" | "right" = e.clientX < window.innerWidth / 2 ? "left" : "right";
      if (this.sticks[side]) return;
      this.sticks[side] = { id: e.pointerId, ox: e.clientX, oy: e.clientY, dx: 0, dy: 0 };
      showStick(side, e.clientX, e.clientY);
    };
    this.touchPointerMove = (e) => {
      for (const side of ["left", "right"] as const) {
        const s = this.sticks[side];
        if (s && s.id === e.pointerId) {
          let dx = e.clientX - s.ox;
          let dy = e.clientY - s.oy;
          const len = Math.hypot(dx, dy);
          if (len > 60) { dx = (dx / len) * 60; dy = (dy / len) * 60; }
          s.dx = dx; s.dy = dy;
          moveKnob(side, dx, dy);
        }
      }
    };
    this.touchPointerUp = (e) => {
      for (const side of ["left", "right"] as const) {
        const s = this.sticks[side];
        if (s && s.id === e.pointerId) { this.sticks[side] = null; hideStick(side); }
      }
    };
    window.addEventListener("pointerdown", this.touchPointerDown, { passive: true });
    window.addEventListener("pointermove", this.touchPointerMove, { passive: true });
    window.addEventListener("pointerup", this.touchPointerUp);
    window.addEventListener("pointercancel", this.touchPointerUp);
  }

  // Drops any in-progress touch drag and hides both stick visuals — called on every
  // mode transition (start/pause/resume/endRun) so a stale drag can't bleed into the
  // next frame of play (e.g. a finger still down when a jumpscare ends the run).
  private resetTouchSticks(): void {
    if (this.sticks.left || this.sticks.right) {
      this.sticks.left = null;
      this.sticks.right = null;
    }
    if (this.stickEls) {
      this.stickEls.left.style.display = "none";
      this.stickEls.right.style.display = "none";
    }
  }

  private attachInput(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousemove", this.onMouseMove);
    this.canvas.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const mapped = this.keyMap[e.key];
    if (mapped) { this.keys[mapped] = true; e.preventDefault(); }
    if (e.key === "e" || e.key === "E") this.toggleHide();
    if (e.key === "f" || e.key === "F") this.toggleFlashlight();
    if (e.key === "Escape" && this.mode === "playing") this.pause();
  }

  private handleKeyUp(e: KeyboardEvent): void {
    const mapped = this.keyMap[e.key];
    if (mapped) this.keys[mapped] = false;
  }

  private clampPitch(): void {
    this.pitch = clamp(this.pitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
  }

  private handleMouseMove(e: MouseEvent): void {
    if ((document.pointerLockElement === this.canvas || this.dragging) && this.mode === "playing" && !this.hiding) {
      this.yaw -= e.movementX * this.lookSens;
      this.pitch -= e.movementY * this.lookSens;
      this.clampPitch();
    }
  }

  private handleMouseDown(): void {
    if (!this.isTouch && document.pointerLockElement !== this.canvas) {
      if (this.mode === "playing") this.lockPointer();
      else this.dragging = true;
    }
  }

  private lockPointer(): void {
    try {
      this.canvas.requestPointerLock?.();
    } catch {
      /* ignore */
    }
  }

  private handlePointerLockChange(): void {
    if (this.mode !== "playing") return;
    const locked = document.pointerLockElement === this.canvas;
    if (!locked && !this.isTouch) this.pause();
  }

  // ---------------------------------------------------------- COLLISION / LOS

  private collide(cx: number, cz: number, r: number): [number, number] {
    for (let pass = 0; pass < 2; pass += 1) {
      for (const box of this.wallBoxes) {
        const nx = clamp(cx, box.minX, box.maxX);
        const nz = clamp(cz, box.minZ, box.maxZ);
        const dx = cx - nx;
        const dz = cz - nz;
        const d2 = dx * dx + dz * dz;
        if (d2 < r * r) {
          const d = Math.sqrt(d2) || 1e-4;
          const push = (r - d) / d;
          cx += dx * push;
          cz += dz * push;
        }
      }
    }
    cx = clamp(cx, -HALF + r, HALF - r);
    cz = clamp(cz, -HALF + r, HALF - r);
    return [cx, cz];
  }

  private los(ax: number, az: number, bx: number, bz: number): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    for (const box of this.wallBoxes) {
      let t0 = 0;
      let t1 = 1;
      let clipped = true;
      for (const axis of [0, 1]) {
        const o = axis ? az : ax;
        const d = axis ? dz : dx;
        const lo = axis ? box.minZ : box.minX;
        const hi = axis ? box.maxZ : box.maxX;
        if (Math.abs(d) < 1e-6) {
          if (o < lo || o > hi) { clipped = false; break; }
        } else {
          let ta = (lo - o) / d;
          let tb = (hi - o) / d;
          if (ta > tb) { const s = ta; ta = tb; tb = s; }
          t0 = Math.max(t0, ta);
          t1 = Math.min(t1, tb);
          if (t0 > t1) { clipped = false; break; }
        }
      }
      if (clipped && t1 >= 0 && t0 <= 1) return false;
    }
    return true;
  }

  // ---------------------------------------------------------- AUDIO

  private audioInit(): void {
    if (this.ac) {
      if (this.ac.state !== "running") this.ac.resume().catch(() => undefined);
      return;
    }
    try {
      this.ac = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      this.master = this.ac.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ac.destination);
      this.droneGain = this.ac.createGain();
      this.droneGain.gain.value = 0.05;
      this.droneGain.connect(this.master);
      const o1 = this.ac.createOscillator();
      const o2 = this.ac.createOscillator();
      o1.type = "sine"; o1.frequency.value = 48;
      o2.type = "sine"; o2.frequency.value = 51.2;
      o1.connect(this.droneGain); o2.connect(this.droneGain);
      o1.start(); o2.start();
    } catch {
      this.ac = null;
    }
  }

  private pulse(freq: number, dur: number, type: OscillatorType, gain: number): void {
    if (this.muted || !this.ac || !this.master) return;
    const osc = this.ac.createOscillator();
    const g = this.ac.createGain();
    osc.type = type; osc.frequency.value = freq;
    osc.connect(g); g.connect(this.master);
    const now = this.ac.currentTime;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.start(now); osc.stop(now + dur + 0.02);
  }

  private ensureNoiseBuffer(): AudioBuffer | null {
    if (!this.ac) return null;
    if (!this.noiseBuf) {
      this.noiseBuf = this.ac.createBuffer(1, this.ac.sampleRate * 0.6, this.ac.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    }
    return this.noiseBuf;
  }

  private stinger(kind: JumpscareKind): void {
    if (this.muted || !this.ac || !this.master) return;
    const buf = this.ensureNoiseBuffer();
    if (!buf) return;
    const src = this.ac.createBufferSource();
    src.buffer = buf;
    const filter = this.ac.createBiquadFilter();
    const gain = this.ac.createGain();
    const now = this.ac.currentTime;
    if (kind === "chase") {
      filter.type = "lowpass"; filter.frequency.value = 700;
      gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(0.6, now + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
      this.pulse(58, 0.7, "sawtooth", 0.12);
    } else if (kind === "mirror") {
      filter.type = "bandpass"; filter.frequency.value = 1800; filter.Q.value = 5;
      gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(0.35, now + 0.01); gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
      this.pulse(720, 0.15, "triangle", 0.06);
    } else if (kind === "locker") {
      filter.type = "lowpass"; filter.frequency.value = 500;
      gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(0.32, now + 0.01); gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    } else if (kind === "finale") {
      filter.type = "lowpass"; filter.frequency.value = 900;
      gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(0.55, now + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
      this.pulse(64, 0.9, "sawtooth", 0.1);
    } else {
      filter.type = "bandpass"; filter.frequency.value = 900 + Math.random() * 1000; filter.Q.value = 4;
      gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(0.18, now + 0.04); gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    }
    src.connect(filter); filter.connect(gain); gain.connect(this.master);
    src.start(now); src.stop(now + 1.2);
  }

  // ---------------------------------------------------------- GAME FLOW

  // Rebuilds the maze/props/warden/atmosphere for a new NG+ loop. Call before start()
  // whenever the persisted loop counter has advanced since this engine was constructed
  // (the engine instance otherwise lives for the whole page session and would keep
  // replaying the same construction-time layout forever).
  setLoop(loop: number): void {
    if (loop === this.loop) return;
    this.loop = loop;

    this.scene.remove(this.levelGroup);
    for (const item of this.items) disposeMaterials(item.mesh.material as THREE.Material | THREE.Material[] | undefined);
    this.levelGroup.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) object.dispose();
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      disposeMaterials(mesh.material as THREE.Material | THREE.Material[] | undefined);
    });

    this.items = [];
    this.hideSpots = [];
    this.lockers = [];
    this.mirrors = [];
    this.flickerLights = [];
    this.exitSign = null;
    this.wardenEyes = [];
    this.warden = null;

    this.levelGroup = new THREE.Group();
    this.scene.add(this.levelGroup);

    this.buildMaze();
    this.buildGeometry();
    this.buildProps();
    this.buildWarden();
    this.setupSparkAtmosphere();
  }

  start(): void {
    this.audioInit();
    this.resetTouchSticks();
    this.filesFound = 0;
    for (const item of this.items) {
      if (item.got) { this.levelGroup.add(item.mesh); if (item.light) this.levelGroup.add(item.light); }
      item.got = false;
    }
    this.fear = 0;
    this.hiding = false;
    this.hidingSpot = null;
    this.flashlightOn = true;
    this.invuln = 1.2;
    this.score = 0;
    this.scaresThisRun.clear();
    this.hidesThisRun = 0;
    this.exitTrulyOpen = false;
    this.financeFinaleFired = false;
    for (const m of this.mirrors) { m.triggered = false; m.flashT = 0; m.faceMat.opacity = 0; }
    for (const l of this.lockers) l.lastScare = -999;
    this.lastLockerScare = -30;
    this.lastAmbientScare = -12;

    const spawn = cellCenter(this.spawnCell.x, this.spawnCell.z);
    this.camera.position.set(spawn.x, EYE_H, spawn.z);
    this.yaw = 0; this.pitch = 0; this.camera.fov = 72; this.camera.updateProjectionMatrix();

    this.wardenCell = this.farthestCellFrom(this.spawnCell.x, this.spawnCell.z, 0.35).idx;
    this.wardenPos.copy(this.cellWorldPos(this.wardenCell));
    this.wardenMode = "wander";
    this.wardenHuntTimer = 0;
    this.wardenPath = [];
    this.wardenPathIdx = 0;
    if (this.warden) this.warden.position.copy(this.wardenPos);

    this.mode = "playing";
    this.startedAt = performance.now();
    this.elapsedMs = 0;
    this.callbacks.onModeChange("playing");
    this.callbacks.onFilesUpdate(0, NEEDED_FILES);
    this.callbacks.onFear(0);
    this.callbacks.onFlashlightChange(true);
    if (!this.isTouch) this.lockPointer();
  }

  pause(): void {
    if (this.mode !== "playing") return;
    this.mode = "paused";
    this.resetTouchSticks();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock?.();
    this.callbacks.onModeChange("paused");
  }

  resume(): void {
    if (this.mode !== "paused") return;
    this.mode = "playing";
    this.resetTouchSticks();
    this.callbacks.onModeChange("playing");
    if (!this.isTouch) this.lockPointer();
  }

  toggleHide(): void {
    if (this.mode !== "playing") return;
    if (this.hiding) {
      this.hiding = false;
      this.hidingSpot = null;
      this.callbacks.onHideChange(false);
      return;
    }
    let nearest: HideSpot | null = null;
    let nearestD = 1.5;
    for (const spot of this.hideSpots) {
      const d = Math.hypot(this.camera.position.x - spot.x, this.camera.position.z - spot.z);
      if (d < nearestD) { nearestD = d; nearest = spot; }
    }
    if (nearest) {
      this.hiding = true;
      this.hidingSpot = nearest;
      this.hidesThisRun += 1;
      this.callbacks.onHideChange(true);
    }
  }

  toggleFlashlight(): void {
    if (this.mode !== "playing") return;
    this.flashlightOn = !this.flashlightOn;
    this.callbacks.onFlashlightChange(this.flashlightOn);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  setBloomEnabled(enabled: boolean): void {
    this.bloomEnabled = enabled;
    if (this.bloomPass) this.bloomPass.enabled = enabled;
  }

  setShakeEnabled(enabled: boolean): void {
    this.shakeEnabled = enabled;
  }

  setLookSens(v: number): void {
    this.lookSens = v;
  }

  private endRun(won: boolean, lossKind?: LossKind): void {
    if (this.mode !== "playing") return;
    this.mode = won ? "won" : "lost";
    this.resetTouchSticks();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock?.();
    if (won) {
      const speedBonus = Math.max(0, Math.floor(4000 - (this.elapsedMs / 1000) * 5));
      const flawlessBonus = this.scaresThisRun.size === 0 ? 1000 : 0;
      this.score += speedBonus + flawlessBonus + this.hidesThisRun * 50;
    }
    this.callbacks.onModeChange(this.mode);
    this.callbacks.onRunEnd({
      won,
      ms: this.elapsedMs,
      score: this.score,
      scares: this.scaresThisRun.size,
      hides: this.hidesThisRun,
      lossKind
    });
  }

  private triggerJumpscare(kind: JumpscareKind): void {
    this.scaresThisRun.add(kind);
    this.stinger(kind);
    this.callbacks.onJumpscare(kind);
    if (kind === "chase") this.fear = 100;
    else if (kind === "mirror") this.fear = clamp(this.fear + 10, 0, 100);
    else if (kind === "locker") this.fear = clamp(this.fear + 8, 0, 100);
    else if (kind === "finale") this.fear = clamp(this.fear + 18, 0, 100);
    else this.fear = clamp(this.fear + 6, 0, 100);
    if (this.shakeEnabled) {
      this.fovKick += kind === "chase" ? 10 : kind === "finale" ? 6 : 3;
      this.punchX += (Math.random() - 0.5) * (kind === "chase" ? 0.5 : 0.2);
      this.punchZ += (Math.random() - 0.5) * (kind === "chase" ? 0.5 : 0.2);
    }
  }

  // ---------------------------------------------------------- PER-FRAME UPDATE

  private readonly frame = (): void => {
    if (this.disposed) return;
    const dt = Math.min(0.05, this.clock.getDelta());
    const time = this.clock.elapsedTime;
    this.update(dt, time);
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    this.animationId = window.requestAnimationFrame(this.frame);
  };

  private update(dt: number, time: number): void {
    this.invuln = Math.max(0, this.invuln - dt);

    if (this.mode === "playing") {
      this.elapsedMs = performance.now() - this.startedAt;
      this.callbacks.onTime(this.elapsedMs);
      this.updatePlayer(dt);
      this.updateItems(dt, time);
      this.updateWarden(dt, time);
      this.updateMirrors(dt);
      this.updateLockers(dt, time);
      this.updateAmbientScare(dt);
      this.updateFear(dt);
      this.updateExit();
    }

    this.updateFlicker(time);
    if (this.fearPass) {
      this.fearPass.uniforms.fear.value = this.fear;
      this.fearPass.uniforms.warden.value = this.wardenMode === "hunt" ? 40 : 0;
      this.fearPass.uniforms.time.value = time;
      this.fearPass.uniforms.flash.value = Math.max(0, this.fearPass.uniforms.flash.value - dt * 3.5);
    }
    if (this.master && this.droneGain) {
      const target = 0.03 + (this.fear / 100) * 0.16;
      this.droneGain.gain.value += (target - this.droneGain.gain.value) * Math.min(1, dt * 2);
    }
  }

  private updatePlayer(dt: number): void {
    if (this.hiding) return;
    let ix = 0;
    let iz = 0;
    if (this.keys.f) iz += 1;
    if (this.keys.b) iz -= 1;
    if (this.keys.r) ix += 1;
    if (this.keys.l) ix -= 1;
    if (this.sticks.left) { ix += this.sticks.left.dx / 60; iz += -this.sticks.left.dy / 60; }
    if (this.sticks.right) {
      this.yaw -= (this.sticks.right.dx / 60) * 2.4 * dt;
      this.pitch -= (this.sticks.right.dy / 60) * 2.4 * dt;
      this.clampPitch();
    }

    this.camera.rotation.set(this.pitch, this.yaw, 0);
    const forward = TMP_VEC.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = TMP_VEC_2.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const dirX = forward.x * iz + right.x * ix;
    const dirZ = forward.z * iz + right.z * ix;
    const len = Math.hypot(dirX, dirZ);
    const nx = len > 0 ? dirX / Math.max(1, len) : 0;
    const nz = len > 0 ? dirZ / Math.max(1, len) : 0;
    const speed = PLAYER_SPEED * (this.quality.mobile ? 0.92 : 1);
    const targetX = this.camera.position.x + nx * speed * dt;
    const targetZ = this.camera.position.z + nz * speed * dt;
    const [cx, cz] = this.collide(targetX, targetZ, PLAYER_R);
    this.camera.position.x = cx;
    this.camera.position.z = cz;

    this.flash.intensity = this.flashlightOn ? 105 : 0;
    this.handGlow.intensity = this.flashlightOn ? 1.8 : 0.4;

    if (this.shakeEnabled && (this.fovKick > 0.001 || Math.abs(this.punchX) > 0.0005 || Math.abs(this.punchZ) > 0.0005)) {
      this.camera.fov = 72 + this.fovKick;
      this.camera.updateProjectionMatrix();
      this.fovKick *= Math.pow(0.05, dt);
      this.camera.position.x += this.punchX;
      this.camera.position.z += this.punchZ;
      this.punchX *= Math.pow(0.02, dt);
      this.punchZ *= Math.pow(0.02, dt);
    } else if (this.fovKick !== 0) {
      this.fovKick = 0; this.punchX = 0; this.punchZ = 0;
      if (this.camera.fov !== 72) { this.camera.fov = 72; this.camera.updateProjectionMatrix(); }
    }
  }

  private updateItems(_dt: number, time: number): void {
    for (const item of this.items) {
      if (item.got) continue;
      item.mesh.rotation.y = time * 1.6;
      item.mesh.position.y = 1.05 + Math.sin(time * 2 + item.phase) * 0.08;
      if (this.hiding) continue;
      const d = Math.hypot(this.camera.position.x - item.x, this.camera.position.z - item.z);
      if (d < 1.5) {
        item.got = true;
        this.levelGroup.remove(item.mesh);
        if (item.light) this.levelGroup.remove(item.light);
        this.filesFound += 1;
        this.score += 500;
        this.pulse(560 + this.filesFound * 30, 0.09, "triangle", 0.05);
        this.callbacks.onFilesUpdate(this.filesFound, NEEDED_FILES);
      }
    }
  }

  private updateWarden(dt: number, time: number): void {
    if (!this.warden) return;
    const camDist = this.camera.position.distanceTo(this.wardenPos);
    const toWarden = TMP_VEC.set(this.wardenPos.x - this.camera.position.x, 0, this.wardenPos.z - this.camera.position.z);
    const toWardenLen = toWarden.length();
    let observed = false;
    if (toWardenLen > 0.001 && camDist < OBSERVE_DIST) {
      toWarden.normalize();
      const forward = TMP_VEC_2.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      forward.y = 0;
      forward.normalize();
      const dot = forward.dot(toWarden);
      if (dot > OBSERVE_COS && this.los(this.camera.position.x, this.camera.position.z, this.wardenPos.x, this.wardenPos.z)) {
        observed = true;
      }
    }

    if (!this.hiding && camDist < DETECT_RADIUS) {
      this.wardenMode = "hunt";
      this.wardenHuntTimer = HUNT_DECAY;
    } else if (this.wardenMode === "hunt") {
      this.wardenHuntTimer -= dt;
      if (this.wardenHuntTimer <= 0) this.wardenMode = "wander";
    }

    this.wardenRepathT -= dt;
    if (this.wardenRepathT <= 0) {
      this.wardenRepathT = 0.5;
      const target =
        this.wardenMode === "hunt" && !this.hiding
          ? worldToCell(this.camera.position.x, this.camera.position.z)
          : worldToCell(this.wardenPos.x + (Math.random() - 0.5) * GRID * CELL, this.wardenPos.z + (Math.random() - 0.5) * GRID * CELL);
      const fromIdx = cellIndex(worldToCell(this.wardenPos.x, this.wardenPos.z).x, worldToCell(this.wardenPos.x, this.wardenPos.z).z);
      const toIdx = cellIndex(target.x, target.z);
      if (fromIdx !== toIdx) {
        this.wardenPath = this.bfsPath(fromIdx, toIdx);
        this.wardenPathIdx = 1;
      }
    }

    if (!observed) {
      const speed = this.wardenMode === "hunt" ? HUNT_SPEED : WANDER_SPEED;
      if (this.wardenPathIdx < this.wardenPath.length) {
        const targetPos = this.cellWorldPos(this.wardenPath[this.wardenPathIdx], TMP_VEC_3);
        const dx = targetPos.x - this.wardenPos.x;
        const dz = targetPos.z - this.wardenPos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.15) {
          this.wardenPathIdx += 1;
        } else {
          this.wardenPos.x += (dx / d) * speed * dt;
          this.wardenPos.z += (dz / d) * speed * dt;
          this.warden.rotation.y = Math.atan2(dx, dz);
        }
      }
    }

    this.warden.position.set(this.wardenPos.x, Math.sin(time * 5) * 0.02, this.wardenPos.z);
    for (const eye of this.wardenEyes) {
      const mat = eye.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = observed ? 2.2 : 1.4 + Math.sin(time * 6) * 0.3;
    }

    if (!this.hiding && this.invuln <= 0 && camDist < CONTACT_RADIUS && this.wardenMode === "hunt" && !observed) {
      this.triggerJumpscare("chase");
      this.endRun(false, "caught");
    }
  }

  private updateMirrors(_dt: number): void {
    for (const mirror of this.mirrors) {
      if (mirror.flashT > 0) {
        mirror.flashT -= 0.016;
        mirror.faceMat.opacity = clamp(mirror.flashT / 0.18, 0, 1) * 0.85;
        continue;
      }
      if (mirror.triggered || this.hiding) continue;
      const d = Math.hypot(this.camera.position.x - mirror.x, this.camera.position.z - mirror.z);
      if (d > 3) continue;
      const toMirror = TMP_VEC.set(mirror.x - this.camera.position.x, 0, mirror.z - this.camera.position.z).normalize();
      const forward = TMP_VEC_2.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      forward.y = 0; forward.normalize();
      if (forward.dot(toMirror) > 0.75) {
        mirror.triggered = true;
        mirror.flashT = 0.18;
        this.triggerJumpscare("mirror");
      }
    }
  }

  private updateLockers(dt: number, time: number): void {
    for (const locker of this.lockers) {
      if (locker.doorOpen > 0) {
        locker.doorOpen = Math.max(0, locker.doorOpen - dt * 2.2);
        locker.door.rotation.y = Math.sin(locker.doorOpen * Math.PI) * 0.9;
      }
      if (this.hiding) continue;
      const d = Math.hypot(this.camera.position.x - locker.x, this.camera.position.z - locker.z);
      if (d > 3.2) continue;
      if (time - locker.lastScare < 8 || time - this.lastLockerScare < 25) continue;
      if (Math.random() < dt * 0.22) {
        locker.lastScare = time;
        this.lastLockerScare = time;
        locker.doorOpen = 1;
        this.triggerJumpscare("locker");
      }
    }
  }

  private updateAmbientScare(dt: number): void {
    const time = this.clock.elapsedTime;
    if (time - this.lastAmbientScare < 16) return;
    const chance = (this.fear > 15 ? 0.09 : 0.03) * dt;
    if (Math.random() < chance) {
      this.lastAmbientScare = time;
      this.triggerJumpscare("ambient");
    }
  }

  private updateFear(dt: number): void {
    if (this.hiding) {
      this.fear = clamp(this.fear - dt * 16, 0, 100);
    } else {
      let delta = -dt * 6;
      const camDist = this.camera.position.distanceTo(this.wardenPos);
      if (this.wardenMode === "hunt" && camDist < DETECT_RADIUS) {
        delta += dt * clamp((DETECT_RADIUS - camDist) / DETECT_RADIUS, 0, 1) * 15;
      }
      if (!this.flashlightOn) delta += dt * 2.2;
      this.fear = clamp(this.fear + delta, 0, 100);
    }
    this.callbacks.onFear(this.fear);
    if (this.fear >= 100 && this.mode === "playing") this.endRun(false, "fear");
  }

  private updateExit(): void {
    if (this.filesFound < NEEDED_FILES) return;
    const exitCenter = cellCenter(this.exitCell.x, this.exitCell.z);
    const d = Math.hypot(this.camera.position.x - exitCenter.x, this.camera.position.z - exitCenter.z);
    if (!this.financeFinaleFired && d < PRE_EXIT_RADIUS) {
      this.financeFinaleFired = true;
      this.exitTrulyOpen = true;
      this.triggerJumpscare("finale");
      return;
    }
    if (this.exitTrulyOpen && d < EXIT_RADIUS) {
      this.endRun(true);
    }
  }

  private updateFlicker(time: number): void {
    for (const f of this.flickerLights) {
      const flicker = Math.sin(time * 9 + f.phase) * 0.15 + Math.sin(time * 23 + f.phase * 2) * 0.08;
      const dip = Math.random() < 0.002 ? 0.15 : 1;
      f.light.intensity = Math.max(0, f.base + flicker) * dip;
    }
    if (this.exitSign) {
      const sign = this.exitSign.children[0] as THREE.Mesh | undefined;
      const mat = sign?.material as THREE.MeshStandardMaterial | undefined;
      if (mat) mat.emissiveIntensity = this.exitTrulyOpen ? 2.2 : 1.2 + Math.sin(time * 4) * 0.3;
    }
  }

  // ---------------------------------------------------------- RESIZE / DISPOSE

  private resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer?.setSize(width, height);
    this.bloomPass?.setSize(width, height);
  }

  dispose(): void {
    this.disposed = true;
    window.cancelAnimationFrame(this.animationId);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    if (this.touchPointerDown) window.removeEventListener("pointerdown", this.touchPointerDown);
    if (this.touchPointerMove) window.removeEventListener("pointermove", this.touchPointerMove);
    if (this.touchPointerUp) {
      window.removeEventListener("pointerup", this.touchPointerUp);
      window.removeEventListener("pointercancel", this.touchPointerUp);
    }
    if (this.stickEls) {
      this.stickEls.left.remove();
      this.stickEls.right.remove();
    }
    if (this.dustMesh) { this.scene.remove(this.dustMesh); this.dustMesh.dispose(); }
    if (this.fogMesh) { this.scene.remove(this.fogMesh); this.fogMesh.dispose(); }
    this.scene.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) object.dispose();
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      disposeMaterials(mesh.material as THREE.Material | THREE.Material[] | undefined);
    });
    // Collected items are scene.remove()'d in updateItems(), so the traverse above
    // never reaches their per-instance cloned materials — dispose those explicitly.
    for (const item of this.items) disposeMaterials(item.mesh.material as THREE.Material | THREE.Material[] | undefined);
    this.composer?.dispose();
    if (this.envRT) { this.envRT.dispose(); this.envRT = null; }
    if (this.hdrTexture) { this.hdrTexture.dispose(); this.hdrTexture = null; }
    this.renderer.dispose();
    if (this.ac) this.ac.close().catch(() => undefined);
  }
}
