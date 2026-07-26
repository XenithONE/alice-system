import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { CELL, type ArenaDef, type BotSpec, type Catalog, type ChassisDef, type DriveDef, type SeatIndex } from "../sim/types";
import { INTERP_DELAY } from "../sim/balance";
import { CAM_DISTANCE, chaseCameraPose, smoothChaseYaw } from "../sim/chaseCamera";
import { chassisForward } from "../sim/heading";
import type { BotSnap, EntSnap, Snapshot, WeaponSnap } from "../net/protocol";
import {
  applyWeaponRig,
  createIndustrialPart,
  industrialMaterial,
  type WeaponRig
} from "./industrialKit";
import { mountPartObject } from "./mounting";
import type { ProceduralDrive } from "./procedural/types";
import { configureRenderer, installStudioEnvironment } from "./renderEnv";
import { createEntityVisual, type EntityVisual } from "./deployKit";

const MAX_SNAPSHOTS = 48;
const MAX_SPARKS = 96;
const MAX_FLAMES = 56;
const MAX_SMOKE = 32;
const MAX_DEBRIS = 48;
const BOT_COLORS = [0xc73c32, 0x2878a9, 0x3a8b68, 0xd69a24] as const;

export interface ArenaQuality {
  pixelRatio?: number;
  shadows?: boolean;
  particles?: number;
  antialias?: boolean;
  rendererFactory?: (
    canvas: HTMLCanvasElement,
    parameters: THREE.WebGLRendererParameters
  ) => THREE.WebGLRenderer;
}

export interface ArenaScene {
  setup(specs: readonly (BotSpec | null)[], names: readonly string[], arena: ArenaDef, mySeat: SeatIndex): void;
  pushSnapshot(s: Snapshot): void;
  debugTick(dt: number): void;
  getDebugState(): {
    ready: boolean; botCount: number; meshCount: number;
    bots: { seat: number; x: number; y: number; z: number; hp: number; detached: number }[];
    camPos: [number, number, number];
    camForward: [number, number, number];
    botForward: [number, number, number];
    cameraForwardDot: number;
    lastSnapshotTick: number;
    render: { calls: number; triangles: number };
    memory: { geometries: number; textures: number };
    env: boolean;
    toneMapping: number;
    shadowCasters: number;
  };
  captureFrame(): string;
  setEnvironmentEnabled(enabled: boolean): void;
  setPaused(p: boolean): void;
  dispose(): void;
}

interface TimedSnapshot {
  readonly receivedAt: number;
  readonly snapshot: Snapshot;
}
interface PartVisual {
  readonly index: number;
  readonly root: THREE.Object3D;
  readonly drive: DriveDef | null;
  readonly weapon: WeaponRig | null;
  readonly basePosition: THREE.Vector3;
  readonly baseScale: THREE.Vector3;
  readonly finishes: {
    material: THREE.MeshStandardMaterial;
    color: THREE.Color;
    baseRoughness: number;
    baseMetalness: number;
  }[];
  detached: boolean;
  condition: number;
  lastConditionByte: number;
}
interface BotVisual {
  readonly seat: SeatIndex;
  readonly root: THREE.Group;
  readonly parts: PartVisual[];
  readonly wheelRoots: ProceduralDrive[];
  readonly wheelRadii: number[];
  readonly nameSprite: THREE.Sprite;
  hp: number;
  burn: number;
  detach: number;
  lastX: number;
  lastZ: number;
  wheelPhase: number;
  initialized: boolean;
}
interface Particle {
  readonly mesh: THREE.Mesh;
  readonly velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}
interface Debris {
  readonly mesh: THREE.Mesh;
  readonly velocity: THREE.Vector3;
  readonly spin: THREE.Vector3;
  life: number;
}

function autoQuality(overrides: ArenaQuality): Required<Omit<ArenaQuality, "rendererFactory">> {
  const requested = new URLSearchParams(location.search).get("q");
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const weakDevice = (navigator.hardwareConcurrency || 4) <= 4 || memory !== undefined && memory <= 4;
  const low = requested === "low" || requested !== "high" && weakDevice;
  return {
    pixelRatio: overrides.pixelRatio ?? Math.min(devicePixelRatio || 1, low ? 1.15 : 2),
    shadows: overrides.shadows ?? !low,
    particles: Math.max(0, Math.min(MAX_SPARKS, overrides.particles ?? (low ? 36 : MAX_SPARKS))),
    antialias: overrides.antialias ?? !low
  };
}
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Sprite)) return;
    if (
      (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) &&
      object.geometry.userData.scShared !== true
    ) {
      object.geometry.dispose();
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      if (material instanceof THREE.SpriteMaterial && material.map) material.map.dispose();
      material.dispose();
    });
  });
  root.clear();
}
function makeLabel(text: string, color: number): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "rgba(5,7,8,.86)";
  context.fillRect(0, 10, 512, 70);
  context.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
  context.fillRect(0, 10, 9, 70);
  context.strokeStyle = "#687174";
  context.strokeRect(1.5, 11.5, 509, 67);
  context.fillStyle = "#f1eee6";
  context.font = "700 37px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text.slice(0, 22), 260, 45);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(2.2, 0.42, 1);
  sprite.position.y = 1.22;
  return sprite;
}
function addChassisDetails(root: THREE.Group, chassis: ChassisDef, paint: number, seat: SeatIndex): void {
  const w = chassis.deck[0] * CELL;
  const d = chassis.deck[1] * CELL;
  const plate = new THREE.Mesh(
    new RoundedBoxGeometry(w, chassis.height, d, 2, 0.009),
    industrialMaterial(chassis.material, paint)
  );
  plate.position.y = chassis.groundClearance + chassis.height * 0.5;
  plate.castShadow = plate.receiveShadow = true;
  root.add(plate);
  const railMaterial = industrialMaterial("steel", BOT_COLORS[seat]);
  const steel = industrialMaterial("steel", 0x9ba09f);
  for (const x of [-w * 0.43, w * 0.43]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.045, d * 0.88), railMaterial);
    rail.position.set(x, chassis.groundClearance + chassis.height + 0.017, 0);
    rail.castShadow = true;
    root.add(rail);
  }
  for (let index = 0; index < 5; index += 1) {
    for (const x of [-w * 0.42, w * 0.42]) {
      const rivet = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.012, 6), steel);
      rivet.position.set(x, chassis.groundClearance + chassis.height + 0.01, THREE.MathUtils.lerp(-d * 0.38, d * 0.38, index / 4));
      root.add(rivet);
    }
  }
  const access = new THREE.Mesh(new RoundedBoxGeometry(w * 0.34, 0.012, d * 0.28, 1, 0.004), industrialMaterial("steel", 0x4b5051));
  access.position.set(0, chassis.groundClearance + chassis.height + 0.007, d * 0.08);
  root.add(access);
}
function createBot(spec: BotSpec, name: string, seat: SeatIndex, catalog: Catalog): BotVisual | null {
  const chassis = catalog.byId.get(spec.chassisId);
  if (!chassis || chassis.category !== "chassis") return null;
  const root = new THREE.Group();
  addChassisDetails(root, chassis, spec.paint, seat);
  const parts: PartVisual[] = [];
  const wheelRoots: ProceduralDrive[] = [];
  const wheelRadii: number[] = [];
  spec.parts.forEach((placed, index) => {
    const part = catalog.byId.get(placed.partId);
    if (!part || part.category === "chassis") return;
    const created = createIndustrialPart(part, placed.rot, spec.paint, false, placed.face);
    mountPartObject(created.root, chassis, part, placed);
    root.add(created.root);
    const drive = part.category === "drive" ? part : null;
    const finishes: PartVisual["finishes"] = [];
    created.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material instanceof THREE.MeshStandardMaterial) finishes.push({
          material,
          color: material.color.clone(),
          baseRoughness: material.roughness,
          baseMetalness: material.metalness
        });
      }
    });
    parts.push({
      index, root: created.root, drive, weapon: created.weapon,
      basePosition: created.root.position.clone(), baseScale: created.root.scale.clone(),
      finishes, detached: false, condition: 1, lastConditionByte: -1
    });
    if (created.drive && drive) {
      wheelRoots.push(created.drive);
      wheelRadii.push(drive.radius);
    }
  });
  const nameSprite = makeLabel(name || `BOT ${seat + 1}`, BOT_COLORS[seat]);
  root.add(nameSprite);
  return {
    seat, root, parts, wheelRoots, wheelRadii, nameSprite,
    hp: 0, burn: 0, detach: 0, lastX: 0, lastZ: 0, wheelPhase: 0, initialized: false
  };
}

function lerpWeapons(a: readonly WeaponSnap[], b: readonly WeaponSnap[], alpha: number): WeaponSnap[] {
  return b.map((next) => {
    const previous = a.find((item) => item.idx === next.idx) ?? next;
    return {
      ...next,
      a: THREE.MathUtils.lerp(previous.a, next.a, alpha),
      o: THREE.MathUtils.lerp(previous.o, next.o, alpha),
      c: THREE.MathUtils.lerp(previous.c, next.c, alpha),
      f: THREE.MathUtils.lerp(previous.f, next.f, alpha)
    };
  });
}
function lerpBot(a: BotSnap, b: BotSnap, alpha: number): BotSnap {
  return {
    ...b,
    alive: alpha < 0.5 ? a.alive : b.alive,
    hp: THREE.MathUtils.lerp(a.hp, b.hp, alpha),
    x: THREE.MathUtils.lerp(a.x, b.x, alpha),
    y: THREE.MathUtils.lerp(a.y, b.y, alpha),
    z: THREE.MathUtils.lerp(a.z, b.z, alpha),
    // The authoritative snapshot quaternion is applied directly. No Euler/yaw reconstruction.
    qx: b.qx, qy: b.qy, qz: b.qz, qw: b.qw,
    w: lerpWeapons(a.w, b.w, alpha),
    wp: a.wp !== 0 || b.wp !== 0 ? THREE.MathUtils.lerp(a.wp, b.wp, alpha) : 0,
    burn: THREE.MathUtils.lerp(a.burn, b.burn, alpha),
    detach: alpha < 0.5 ? a.detach : b.detach,
    pc: b.pc.map((value, index) => Math.round(THREE.MathUtils.lerp(a.pc[index] ?? value, value, alpha)))
  };
}

function lerpEnt(a: EntSnap, b: EntSnap, alpha: number): EntSnap {
  return {
    ...b,
    x: THREE.MathUtils.lerp(a.x, b.x, alpha),
    y: THREE.MathUtils.lerp(a.y, b.y, alpha),
    z: THREE.MathUtils.lerp(a.z, b.z, alpha),
    r: THREE.MathUtils.lerp(a.r, b.r, alpha)
  };
}

export function createArenaScene(canvas: HTMLCanvasElement, catalog: Catalog, quality: ArenaQuality = {}): ArenaScene {
  const settings = autoQuality(quality);
  const parameters: THREE.WebGLRendererParameters = {
    canvas, antialias: settings.antialias, alpha: false,
    preserveDrawingBuffer: true, powerPreference: "high-performance"
  };
  const renderer = quality.rendererFactory?.(canvas, parameters) ?? new THREE.WebGLRenderer(parameters);
  configureRenderer(renderer, { shadows: settings.shadows, pixelRatio: settings.pixelRatio, exposure: 1.03 });
  renderer.setClearColor(0x030506);

  const scene = new THREE.Scene();
  const environment = installStudioEnvironment(renderer, scene);
  const studioEnvironment = scene.environment;
  scene.background = new THREE.Color(0x030506);
  scene.fog = new THREE.FogExp2(0x050708, 0.034);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.06, 120);
  const arenaRoot = new THREE.Group();
  const botRoot = new THREE.Group();
  const entRoot = new THREE.Group();
  const vfxRoot = new THREE.Group();
  scene.add(arenaRoot, botRoot, entRoot, vfxRoot);
  scene.add(new THREE.HemisphereLight(0x536570, 0x120b07, 0.26));
  const rim = new THREE.DirectionalLight(0x4b86a3, 1.4);
  rim.position.set(-8, 6, 5);
  scene.add(rim);
  const key = new THREE.DirectionalLight(0xffc982, 1.25);
  key.position.set(5, 8, -4);
  key.castShadow = settings.shadows;
  key.shadow.camera.left = -9;
  key.shadow.camera.right = 9;
  key.shadow.camera.top = 9;
  key.shadow.camera.bottom = -9;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  const spotPositions: [number, number, number][] = [[-6, 11, -5], [6, 11, -5], [-6, 11, 5], [6, 11, 5], [0, 12, 0]];
  for (const [x, y, z] of spotPositions) {
    const spot = new THREE.SpotLight(z === 0 ? 0xc8e8ff : 0xffe0b0, 235, 30, Math.PI / 6, 0.48, 1.45);
    spot.position.set(x, y, z);
    spot.target.position.set(0, 0, 0);
    spot.castShadow = false;
    scene.add(spot, spot.target);
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 0.42, 12), industrialMaterial("steel", 0x222729));
    housing.position.set(x, y, z);
    housing.rotation.x = Math.PI;
    scene.add(housing);
  }

  function pool(count: number, geometry: THREE.BufferGeometry, material: THREE.Material): Particle[] {
    return Array.from({ length: count }, () => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      vfxRoot.add(mesh);
      return { mesh, velocity: new THREE.Vector3(), life: 0, maxLife: 1 };
    });
  }
  const sparkGeometry = new THREE.BoxGeometry(0.025, 0.025, 0.18);
  const sparkMaterial = new THREE.MeshBasicMaterial({ color: 0xffb02f, toneMapped: false });
  const flameGeometry = new THREE.ConeGeometry(0.08, 0.32, 7);
  flameGeometry.rotateX(-Math.PI / 2);
  const flameMaterial = new THREE.MeshBasicMaterial({ color: 0xff6721, transparent: true, opacity: 0.72, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false });
  const smokeGeometry = new THREE.SphereGeometry(0.11, 7, 5);
  const smokeMaterial = new THREE.MeshBasicMaterial({ color: 0x17191a, transparent: true, opacity: 0.36, depthWrite: false });
  const sparks = pool(settings.particles, sparkGeometry, sparkMaterial);
  const flames = pool(Math.min(MAX_FLAMES, Math.max(18, settings.particles)), flameGeometry, flameMaterial);
  const smoke = pool(Math.min(MAX_SMOKE, Math.max(12, Math.round(settings.particles / 2))), smokeGeometry, smokeMaterial);
  const debrisGeometry = new RoundedBoxGeometry(0.14, 0.045, 0.1, 1, 0.006);
  const debrisMaterial = industrialMaterial("steel", 0x6d7272);
  const debris: Debris[] = Array.from({ length: MAX_DEBRIS }, () => {
    const mesh = new THREE.Mesh(debrisGeometry, debrisMaterial);
    mesh.visible = false;
    mesh.castShadow = settings.shadows;
    vfxRoot.add(mesh);
    return { mesh, velocity: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 };
  });

  let arena: ArenaDef | null = null;
  let mySeat: SeatIndex = 0;
  const bots = new Map<number, BotVisual>();
  const ents = new Map<number, EntityVisual>();
  let depCache: EntSnap[] = [];
  let depVersion = -1;
  let tetherLines: THREE.Line[] = [];
  let snapshots: TimedSnapshot[] = [];
  let clock = 0;
  let frame = 0;
  let lastFrameTime = performance.now();
  let paused = false;
  let disposed = false;
  let ready = false;
  let cameraShake = 0;
  let impactFlash = 0;
  let hitStopRemaining = 0;
  let impactPull = 0;
  let focusSpeed = 0;
  let koFocus: number | null = null;
  let koFocusUntil = 0;
  let cameraYaw = 0;
  let cameraYawInitialized = false;
  let cameraPoseInitialized = false;
  const debugCamForward = new THREE.Vector3(0, 0, -1);
  const debugBotForward = new THREE.Vector3(0, 0, -1);
  let lastSnapshotTick = -1;
  let vfxCursor = 0;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function createArena(next: ArenaDef): void {
    disposeObject(arenaRoot);
    const floorMaterial = industrialMaterial("steel", 0x303638);
    const plateSize = next.size / 8;
    for (let x = 0; x < 8; x += 1) {
      for (let z = 0; z < 8; z += 1) {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(plateSize - 0.045, 0.075, plateSize - 0.045), floorMaterial);
        plate.position.set((x - 3.5) * plateSize, -0.055, (z - 3.5) * plateSize);
        plate.receiveShadow = true;
        arenaRoot.add(plate);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const floorBolt = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.012, 6), industrialMaterial("steel", 0x8a8f8e, { wear: false }));
          floorBolt.position.set(plate.position.x + sx * (plateSize * 0.43), -0.008, plate.position.z + sz * (plateSize * 0.43));
          arenaRoot.add(floorBolt);
        }
      }
    }
    if (next.pit) {
      const pit = new THREE.Mesh(new THREE.CylinderGeometry(next.pit.r, next.pit.r, 0.2, 48), new THREE.MeshStandardMaterial({ color: 0x010202, roughness: 1 }));
      pit.position.set(next.pit.x, -0.11, next.pit.z);
      arenaRoot.add(pit);
      const ring = new THREE.Mesh(new THREE.RingGeometry(next.pit.r, next.pit.r + 0.22, 48), industrialMaterial("steel", 0xd19418));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(next.pit.x, 0.004, next.pit.z);
      arenaRoot.add(ring);
    }
    for (const saw of next.saws) {
      const sawRoot = new THREE.Group();
      sawRoot.name = "arena-saw";
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(saw.r, saw.r, 0.09, 32), industrialMaterial("hardox", 0x9ca09f));
      disc.rotation.x = Math.PI / 2;
      sawRoot.add(disc);
      for (let tooth = 0; tooth < 20; tooth += 1) {
        const angle = tooth / 20 * Math.PI * 2;
        const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.31, 3), industrialMaterial("hardox", 0xb9bcba));
        mesh.position.set(Math.cos(angle) * (saw.r + 0.07), 0, Math.sin(angle) * (saw.r + 0.07));
        mesh.rotation.set(0, -angle, Math.PI / 2);
        sawRoot.add(mesh);
      }
      sawRoot.position.set(saw.x, 0.025, saw.z);
      arenaRoot.add(sawRoot);
    }
    for (const jet of next.flameJets) {
      const jetRoot = new THREE.Group();
      jetRoot.name = "arena-jet";
      const grille = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.27, 0.035, 16), industrialMaterial("steel", 0x1a1e20));
      for (let slit = -2; slit <= 2; slit += 1) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.04, 0.42), industrialMaterial("steel", 0x777c7c));
        bar.position.x = slit * 0.07;
        jetRoot.add(bar);
      }
      jetRoot.add(grille);
      jetRoot.position.set(jet.x, 0.01, jet.z);
      arenaRoot.add(jetRoot);
    }

    const half = next.size / 2;
    const structural = industrialMaterial("steel", 0x3d4548);
    const poly = new THREE.MeshPhysicalMaterial({ color: 0x9bb0b6, roughness: 0.2, metalness: 0, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide });
    const railX = new THREE.BoxGeometry(next.size + 0.3, 0.15, 0.15);
    const railZ = new THREE.BoxGeometry(0.15, 0.15, next.size + 0.3);
    for (const y of [0.1, next.wallHeight]) {
      for (const z of [-half, half]) {
        const rail = new THREE.Mesh(railX, structural);
        rail.position.set(0, y, z);
        arenaRoot.add(rail);
      }
      for (const x of [-half, half]) {
        const rail = new THREE.Mesh(railZ, structural);
        rail.position.set(x, y, 0);
        arenaRoot.add(rail);
      }
    }
    for (let position = -half; position <= half; position += 2) {
      for (const side of [-1, 1]) {
        const postX = new THREE.Mesh(new THREE.BoxGeometry(0.12, next.wallHeight, 0.12), structural);
        postX.position.set(position, next.wallHeight / 2, side * half);
        arenaRoot.add(postX);
        const postZ = new THREE.Mesh(new THREE.BoxGeometry(0.12, next.wallHeight, 0.12), structural);
        postZ.position.set(side * half, next.wallHeight / 2, position);
        arenaRoot.add(postZ);
      }
    }
    for (const side of [-1, 1]) {
      const wallX = new THREE.Mesh(new THREE.PlaneGeometry(next.size, next.wallHeight), poly);
      wallX.position.set(0, next.wallHeight / 2, side * half);
      arenaRoot.add(wallX);
      const wallZ = new THREE.Mesh(new THREE.PlaneGeometry(next.size, next.wallHeight), poly);
      wallZ.rotation.y = Math.PI / 2;
      wallZ.position.set(side * half, next.wallHeight / 2, 0);
      arenaRoot.add(wallZ);
      const meshX = new THREE.GridHelper(next.size, 40, 0x596164, 0x363d40);
      meshX.rotation.z = Math.PI / 2;
      meshX.position.set(side * half, next.wallHeight * 0.73, 0);
      meshX.scale.y = next.wallHeight * 0.5 / next.size;
      arenaRoot.add(meshX);
      const meshZ = new THREE.GridHelper(next.size, 40, 0x596164, 0x363d40);
      meshZ.rotation.x = Math.PI / 2;
      meshZ.position.set(0, next.wallHeight * 0.73, side * half);
      meshZ.scale.z = next.wallHeight * 0.5 / next.size;
      arenaRoot.add(meshZ);
    }
    for (const y of [7.8, 10.4]) {
      for (const z of [-6, 0, 6]) {
        const truss = new THREE.Mesh(new THREE.BoxGeometry(next.size + 5, 0.14, 0.14), structural);
        truss.position.set(0, y, z);
        arenaRoot.add(truss);
      }
      for (const x of [-6, 0, 6]) {
        const truss = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, next.size + 5), structural);
        truss.position.set(x, y, 0);
        arenaRoot.add(truss);
      }
    }
  }

  function resize(): void {
    const width = Math.max(canvas.clientWidth, 1);
    const height = Math.max(canvas.clientHeight, 1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);

  function spark(x: number, y: number, z: number, power: number): void {
    let remaining = Math.min(Math.max(Math.round(power / 12), 5), 22);
    for (const particle of sparks) {
      if (remaining <= 0) break;
      if (particle.life > 0) continue;
      const angle = (remaining * 2.399 + clock * 11) % (Math.PI * 2);
      const speed = 1.8 + remaining % 5 * 0.42;
      particle.mesh.position.set(x, y, z);
      particle.mesh.rotation.set(angle, angle * 0.5, 0);
      particle.velocity.set(Math.cos(angle) * speed, 1.2 + remaining % 4 * 0.5, Math.sin(angle) * speed);
      particle.life = particle.maxLife = 0.24 + remaining % 3 * 0.09;
      particle.mesh.visible = true;
      remaining -= 1;
    }
  }
  function flame(x: number, y: number, z: number, dx: number, dz: number, scale = 1): void {
    const item = flames.find((particle) => particle.life <= 0);
    if (!item) return;
    item.mesh.position.set(x, y, z);
    item.mesh.lookAt(x + dx, y + 0.05, z + dz);
    item.mesh.scale.setScalar(0.55 + (vfxCursor++ % 5) * 0.11 * scale);
    item.velocity.set(dx * (2.1 + vfxCursor % 4 * 0.2), 0.25 + vfxCursor % 3 * 0.16, dz * (2.1 + vfxCursor % 4 * 0.2));
    item.life = item.maxLife = 0.28 + vfxCursor % 4 * 0.05;
    item.mesh.visible = true;
  }
  function puff(x: number, y: number, z: number): void {
    const item = smoke.find((particle) => particle.life <= 0);
    if (!item) return;
    item.mesh.position.set(x, y, z);
    item.mesh.scale.setScalar(0.45 + vfxCursor++ % 4 * 0.12);
    item.velocity.set((vfxCursor % 5 - 2) * 0.08, 0.35 + vfxCursor % 4 * 0.09, ((vfxCursor * 3) % 5 - 2) * 0.08);
    item.life = item.maxLife = 1.25 + vfxCursor % 5 * 0.16;
    item.mesh.visible = true;
  }
  function throwDebris(x: number, y: number, z: number, color = 0x777a7a): void {
    const item = debris.find((candidate) => candidate.life <= 0);
    if (!item) return;
    (item.mesh.material as THREE.MeshStandardMaterial).color.setHex(color);
    item.mesh.position.set(x, y, z);
    const seed = ((lastSnapshotTick + 1) * 31 + debris.indexOf(item) * 17) % 97;
    item.velocity.set((seed % 9 - 4) * 0.32, 1.4 + seed % 6 * 0.18, ((seed * 3) % 9 - 4) * 0.32);
    item.spin.set(2 + seed % 5, 3 + seed % 7, 1 + seed % 3);
    item.life = 3.5;
    item.mesh.visible = true;
  }
  function processEvents(snapshot: Snapshot): void {
    for (const event of snapshot.events) {
      if (event.t === "hit") {
        spark(event.x, event.y, event.z, event.power);
        const distance = camera.position.distanceTo(new THREE.Vector3(event.x, event.y, event.z));
        const proximity = THREE.MathUtils.clamp(1 - distance / 18, 0.18, 1);
        const force = THREE.MathUtils.clamp(event.power / 180, 0.08, 1);
        cameraShake = Math.min(0.34, cameraShake + force * proximity * 0.24);
        impactFlash = Math.max(impactFlash, force * proximity);
        impactPull = Math.max(impactPull, force * 0.7);
        if (!reducedMotion && force > 0.66) hitStopRemaining = Math.max(hitStopRemaining, 0.08 + force * 0.04);
        const fragments = Math.min(5, Math.max(1, Math.floor(event.power / 55)));
        for (let index = 0; index < fragments; index += 1) throwDebris(event.x, event.y, event.z);
        if (event.effect === "spin" || event.effect === "grind") {
          spark(event.x, event.y, event.z, event.power * 1.35);
          spark(event.x + 0.08, event.y, event.z - 0.08, event.power);
        }
      } else if (event.t === "detach") {
        spark(event.x, event.y, event.z, 120);
        throwDebris(event.x, event.y, event.z, BOT_COLORS[event.seat]);
      } else if (event.t === "hazard") {
        spark(event.x, event.y, event.z, 75);
      } else if (event.t === "flame") {
        flame(event.x, event.y, event.z, event.dirX, event.dirZ, 1.3);
      } else if (event.t === "fire") {
        const bot = bots.get(event.seat);
        if (bot) {
          const point = new THREE.Vector3();
          bot.root.getWorldPosition(point);
          spark(point.x, point.y + 0.25, point.z, 45);
        }
      } else if (event.t === "ko") {
        koFocus = event.seat;
        koFocusUntil = clock + 1.6;
        renderer.toneMappingExposure = 0.74;
      }
    }
  }

  function resetEntities(): void {
    disposeObject(entRoot);
    ents.clear();
    depCache = [];
    depVersion = -1;
    tetherLines = Array.from({ length: 4 }, () => {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(),
        new THREE.Vector3()
      ]);
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({ color: 0xd0b06b })
      );
      line.visible = false;
      entRoot.add(line);
      return line;
    });
  }

  function syncDeploys(snapshot: Snapshot): void {
    if (snapshot.dep === undefined || snapshot.dv === depVersion) return;
    depVersion = snapshot.dv;
    depCache = [...snapshot.dep];
    const wanted = new Set(depCache.map((entity) => entity.i));
    for (const [id, visual] of [...ents]) {
      if (visual.kind >= 4 || wanted.has(id)) continue;
      entRoot.remove(visual.root);
      disposeObject(visual.root);
      ents.delete(id);
    }
    for (const entity of depCache) {
      if (ents.has(entity.i)) continue;
      const visual = createEntityVisual(entity);
      ents.set(entity.i, visual);
      entRoot.add(visual.root);
    }
  }
  function sampledBots(): BotSnap[] {
    if (snapshots.length === 0) return [];
    const target = clock - INTERP_DELAY;
    let older = snapshots[0]!;
    let newer = snapshots[snapshots.length - 1]!;
    for (const candidate of snapshots) {
      if (candidate.receivedAt <= target) older = candidate;
      if (candidate.receivedAt >= target) {
        newer = candidate;
        break;
      }
    }
    if (older === newer || newer.receivedAt <= older.receivedAt) return [...older.snapshot.bots];
    const alpha = THREE.MathUtils.clamp((target - older.receivedAt) / (newer.receivedAt - older.receivedAt), 0, 1);
    return newer.snapshot.bots.map((next) => {
      const previous = older.snapshot.bots.find((bot) => bot.seat === next.seat);
      return previous ? lerpBot(previous, next, alpha) : next;
    });
  }

  function sampledEnts(): EntSnap[] {
    if (snapshots.length === 0) return [];
    const target = clock - INTERP_DELAY;
    let older = snapshots[0]!;
    let newer = snapshots[snapshots.length - 1]!;
    for (const candidate of snapshots) {
      if (candidate.receivedAt <= target) older = candidate;
      if (candidate.receivedAt >= target) {
        newer = candidate;
        break;
      }
    }
    if (older === newer || newer.receivedAt <= older.receivedAt) {
      return [...older.snapshot.proj];
    }
    const alpha = THREE.MathUtils.clamp(
      (target - older.receivedAt) / (newer.receivedAt - older.receivedAt),
      0,
      1
    );
    return newer.snapshot.proj.map((next) => {
      const previous = older.snapshot.proj.find((entity) => entity.i === next.i);
      return previous ? lerpEnt(previous, next, alpha) : next;
    });
  }

  function applyEntities(next: readonly EntSnap[], nextBots: readonly BotSnap[]): void {
    const wanted = new Set(next.map((entity) => entity.i));
    for (const [id, visual] of [...ents]) {
      if (visual.kind < 4 || wanted.has(id)) continue;
      entRoot.remove(visual.root);
      disposeObject(visual.root);
      ents.delete(id);
    }
    for (const entity of next) {
      let visual = ents.get(entity.i);
      if (!visual) {
        visual = createEntityVisual(entity);
        ents.set(entity.i, visual);
        entRoot.add(visual.root);
      }
      visual.root.position.set(entity.x, entity.y, entity.z);
      visual.root.rotation.y = entity.r;
    }
    let cableIndex = 0;
    for (const victim of nextBots) {
      if (victim.th < 0 || cableIndex >= tetherLines.length) continue;
      const attacker = nextBots.find((candidate) => candidate.seat === victim.th);
      if (!attacker) continue;
      const line = tetherLines[cableIndex++]!;
      const positions = line.geometry.getAttribute("position") as THREE.BufferAttribute;
      positions.setXYZ(0, attacker.x, attacker.y + 0.3, attacker.z);
      positions.setXYZ(1, victim.x, victim.y + 0.3, victim.z);
      positions.needsUpdate = true;
      line.visible = true;
    }
    while (cableIndex < tetherLines.length) tetherLines[cableIndex++]!.visible = false;
  }
  function applyBots(nextBots: readonly BotSnap[], dt: number): void {
    for (const snap of nextBots) {
      const visual = bots.get(snap.seat);
      if (!visual) continue;
      const dx = visual.initialized ? snap.x - visual.lastX : 0;
      const dz = visual.initialized ? snap.z - visual.lastZ : 0;
      const speed = dt > 0 ? Math.hypot(dx, dz) / dt : 0;
      if (snap.seat === mySeat) focusSpeed = THREE.MathUtils.lerp(focusSpeed, speed, 0.18);
      const suspensionSink = snap.alive ? Math.max(0, 0.022 * (1 - Math.min(speed / 1.2, 1))) : 0;
      visual.root.position.set(snap.x, snap.y - suspensionSink, snap.z);
      visual.root.quaternion.set(snap.qx, snap.qy, snap.qz, snap.qw);
      visual.root.visible = true;
      visual.hp = snap.hp;
      visual.burn = snap.burn;
      visual.detach = snap.detach;
      visual.nameSprite.material.opacity = snap.alive ? 1 : 0.38;
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(visual.root.quaternion);
      const forwardDistance = dx * forward.x + dz * forward.z;
      if (snap.wp !== 0) visual.wheelPhase = snap.wp;
      else if (dt > 0) visual.wheelPhase += forwardDistance / Math.max(visual.wheelRadii[0] ?? 0.12, 0.03);
      visual.wheelRoots.forEach((drive) => drive.applyPhase(visual.wheelPhase));
      for (const part of visual.parts) {
        const state = part.weapon ? snap.w.find((weapon) => weapon.idx === part.index) : null;
        if (part.weapon && state) {
          applyWeaponRig(part.weapon, state.a, state.o, state.on);
          if (part.weapon.mode === "flame" && state.on && part.weapon.flameOrigin) {
            const origin = new THREE.Vector3();
            const direction = new THREE.Vector3(0, 0, -1);
            part.weapon.flameOrigin.getWorldPosition(origin);
            direction.transformDirection(part.weapon.flameOrigin.matrixWorld);
            flame(origin.x, origin.y, origin.z, direction.x, direction.z, 1.2);
          }
        }
        const detached = (snap.detach & 2 ** part.index) !== 0;
        const conditionByte = THREE.MathUtils.clamp(snap.pc[part.index] ?? 255, 0, 255);
        const condition = conditionByte / 255;
        part.condition = condition;
        part.root.position.copy(part.basePosition);
        part.root.scale.copy(part.baseScale);
        if (condition < 0.5) part.root.scale.y *= 0.92;
        if (condition < 0.25 && !reducedMotion) {
          const vibration = (0.25 - condition) * 0.028;
          part.root.position.x += Math.sin(clock * 73 + part.index * 4.1) * vibration;
          part.root.position.z += Math.cos(clock * 67 + part.index * 2.7) * vibration;
        }
        if (conditionByte !== part.lastConditionByte) {
          for (const finish of part.finishes) {
            const damage = 1 - condition;
            finish.material.color.copy(finish.color).lerp(new THREE.Color(condition < 0.5 ? 0x171414 : 0x3c3934), damage * 0.72);
            finish.material.roughness = Math.min(1, finish.baseRoughness + damage * 0.34);
            finish.material.metalness = finish.baseMetalness * (1 - damage * 0.25);
            finish.material.emissive.setHex(condition < 0.25 ? 0x8f2109 : 0x000000);
            finish.material.emissiveIntensity = condition < 0.25 ? (0.25 - condition) * 5 : 0;
          }
          part.lastConditionByte = conditionByte;
        }
        const smokeBucket = Math.floor(clock * 7 + part.index + snap.seat);
        const previousSmokeBucket = Math.floor((clock - dt) * 7 + part.index + snap.seat);
        if (condition < 0.25 && smokeBucket !== previousSmokeBucket) {
          const point = new THREE.Vector3();
          part.root.getWorldPosition(point);
          puff(point.x, point.y + 0.05, point.z);
        } else if (condition < 0.5 && smokeBucket !== previousSmokeBucket && smokeBucket % 5 === 0) {
          const point = new THREE.Vector3();
          part.root.getWorldPosition(point);
          spark(point.x, point.y, point.z, 28);
        }
        if (detached && !part.detached) {
          const point = new THREE.Vector3();
          part.root.getWorldPosition(point);
          throwDebris(point.x, point.y, point.z, BOT_COLORS[visual.seat]);
        }
        part.detached = detached;
        part.root.visible = !detached;
      }
      if (snap.burn > 0) {
        const point = new THREE.Vector3();
        visual.root.getWorldPosition(point);
        flame(point.x + Math.sin(clock * 9 + snap.seat) * 0.18, point.y + 0.18, point.z + Math.cos(clock * 7 + snap.seat) * 0.18, 0.08, -0.12, 0.7);
        if ((lastSnapshotTick + snap.seat) % 2 === 0) puff(point.x, point.y + 0.35, point.z);
      } else if (snap.alive && snap.hp < 110 && (lastSnapshotTick + snap.seat) % 4 === 0) {
        const point = new THREE.Vector3();
        visual.root.getWorldPosition(point);
        puff(point.x, point.y + 0.28, point.z);
      }
      visual.lastX = snap.x;
      visual.lastZ = snap.z;
      visual.initialized = true;
    }
  }
  function updateParticles(items: Particle[], dt: number, gravity: number): void {
    for (const item of items) {
      if (item.life <= 0) continue;
      item.life -= dt;
      item.velocity.y -= gravity * dt;
      item.mesh.position.addScaledVector(item.velocity, dt);
      const fraction = Math.max(item.life / item.maxLife, 0);
      if (item.mesh.material instanceof THREE.MeshBasicMaterial) item.mesh.material.opacity = fraction * (items === smoke ? 0.36 : items === flames ? 0.78 : 1);
      if (items === smoke) item.mesh.scale.multiplyScalar(1 + dt * 0.75);
      if (item.life <= 0) item.mesh.visible = false;
    }
  }
  function updateVfx(dt: number): void {
    updateParticles(sparks, dt, 8.5);
    updateParticles(flames, dt, -0.15);
    updateParticles(smoke, dt, -0.06);
    for (const item of debris) {
      if (item.life <= 0) continue;
      item.life -= dt;
      item.velocity.y -= 5.5 * dt;
      item.mesh.position.addScaledVector(item.velocity, dt);
      item.mesh.rotation.x += item.spin.x * dt;
      item.mesh.rotation.y += item.spin.y * dt;
      item.mesh.rotation.z += item.spin.z * dt;
      if (item.mesh.position.y < 0.05) {
        item.mesh.position.y = 0.05;
        item.velocity.multiply(new THREE.Vector3(0.72, -0.28, 0.72));
      }
      if (item.life <= 0) item.mesh.visible = false;
    }
  }
  function updateCamera(nextBots: readonly BotSnap[], dt: number, force = false): void {
    if (nextBots.length === 0) return;
    if (koFocus !== null && clock >= koFocusUntil) {
      koFocus = null;
      renderer.toneMappingExposure = 1.03;
    }
    const alive = nextBots.filter((bot) => bot.alive);
    const focusSeat = koFocus ?? mySeat;
    const focus = nextBots.find((bot) => bot.seat === focusSeat) ?? alive[0] ?? nextBots[0]!;
    const botForward = chassisForward({
      x: focus.qx, y: focus.qy, z: focus.qz, w: focus.qw
    });
    debugBotForward.set(botForward.x, 0, botForward.z);
    const targetYaw = Math.atan2(-botForward.x, -botForward.z);
    if (!cameraYawInitialized || force) {
      cameraYaw = targetYaw;
      cameraYawInitialized = true;
    } else {
      cameraYaw = smoothChaseYaw(cameraYaw, targetYaw, dt);
    }
    const smoothForward = { x: -Math.sin(cameraYaw), z: -Math.cos(cameraYaw) };
    const pose = chaseCameraPose(
      { x: focus.x, y: focus.y, z: focus.z },
      smoothForward,
      CAM_DISTANCE + impactPull * 1.2
    );
    const desired = new THREE.Vector3(pose.camera.x, pose.camera.y, pose.camera.z);
    const target = new THREE.Vector3(pose.target.x, pose.target.y, pose.target.z);
    if (!cameraPoseInitialized || force) {
      camera.position.copy(desired);
      cameraPoseInitialized = true;
    } else {
      camera.position.lerp(desired, 1 - Math.exp(-Math.max(dt, 0) * 11));
    }
    if (!reducedMotion && cameraShake > 0.001) {
      camera.position.x += (Math.sin(clock * 77) * 0.58 + Math.sin(clock * 19) * 0.42) * cameraShake;
      camera.position.y += (Math.cos(clock * 91) * 0.32 + Math.cos(clock * 16) * 0.36) * cameraShake;
      cameraShake *= Math.exp(-dt * 12);
    } else cameraShake = 0;
    camera.lookAt(target);
    camera.getWorldDirection(debugCamForward);
    debugCamForward.y = 0;
    if (debugCamForward.lengthSq() > Number.EPSILON) debugCamForward.normalize();
  }
  function renderTick(dt: number): void {
    if (disposed || paused) return;
    const safeDt = THREE.MathUtils.clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    clock += safeDt;
    const nextBots = sampledBots();
    const nextEnts = sampledEnts();
    if (!reducedMotion && hitStopRemaining > 0) {
      hitStopRemaining = Math.max(0, hitStopRemaining - safeDt);
      updateCamera(nextBots, safeDt);
      renderer.render(scene, camera);
      return;
    }
    applyBots(nextBots, safeDt);
    applyEntities(nextEnts, nextBots);
    updateVfx(safeDt);
    arenaRoot.traverse((object) => {
      if (object.name === "arena-saw") object.rotation.y += safeDt * 7;
      if (object.name === "arena-jet" && Math.sin(clock * 2.4 + object.position.x) > 0.93) {
        flame(object.position.x, 0.08, object.position.z, 0.05, 0.05, 1.5);
      }
    });
    updateCamera(nextBots, safeDt);
    const speedAmount = THREE.MathUtils.clamp((focusSpeed - 2.5) / 10, 0, 1);
    camera.fov = THREE.MathUtils.lerp(camera.fov, 42 + speedAmount * 5, 1 - Math.exp(-safeDt * 4));
    camera.updateProjectionMatrix();
    impactFlash *= Math.exp(-safeDt * 18);
    impactPull *= Math.exp(-safeDt * 10);
    const host = canvas.parentElement;
    if (host) {
      host.style.setProperty("--sc-speed", reducedMotion ? "0" : String(speedAmount * 0.62));
      host.style.setProperty("--sc-impact", String(impactFlash));
    }
    renderer.render(scene, camera);
  }
  function loop(now: number): void {
    const dt = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    renderTick(dt);
    if (!disposed) frame = requestAnimationFrame(loop);
  }

  resize();
  frame = requestAnimationFrame(loop);
  return {
    setup(specs, names, nextArena, nextMySeat) {
      disposeObject(botRoot);
      bots.clear();
      resetEntities();
      snapshots = [];
      clock = 0;
      lastSnapshotTick = -1;
      koFocus = null;
      koFocusUntil = 0;
      cameraYawInitialized = false;
      cameraPoseInitialized = false;
      renderer.toneMappingExposure = 1.03;
      arena = nextArena;
      mySeat = nextMySeat;
      createArena(nextArena);
      specs.forEach((spec, index) => {
        if (!spec || index > 3) return;
        const visual = createBot(spec, names[index] ?? `BOT ${index + 1}`, index as SeatIndex, catalog);
        if (!visual) return;
        bots.set(index, visual);
        botRoot.add(visual.root);
      });
      ready = true;
      resize();
      renderer.render(scene, camera);
    },
    pushSnapshot(snapshot) {
      if (disposed || snapshot.tick <= lastSnapshotTick) return;
      lastSnapshotTick = snapshot.tick;
      snapshots.push({ receivedAt: clock, snapshot });
      if (snapshots.length > MAX_SNAPSHOTS) snapshots.splice(0, snapshots.length - MAX_SNAPSHOTS);
      processEvents(snapshot);
      syncDeploys(snapshot);
      if (!cameraPoseInitialized) updateCamera(snapshot.bots, 0, true);
    },
    debugTick(dt) { renderTick(dt); },
    getDebugState() {
      let meshCount = 0;
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Sprite) meshCount += 1;
      });
      return {
        ready, botCount: bots.size, meshCount,
        bots: [...bots.values()].map((bot) => ({
          seat: bot.seat, x: bot.root.position.x, y: bot.root.position.y, z: bot.root.position.z,
          hp: bot.hp, detached: bot.detach
        })),
        camPos: [camera.position.x, camera.position.y, camera.position.z],
        camForward: [debugCamForward.x, debugCamForward.y, debugCamForward.z],
        botForward: [debugBotForward.x, debugBotForward.y, debugBotForward.z],
        cameraForwardDot: debugCamForward.dot(debugBotForward),
        lastSnapshotTick,
        render: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles },
        memory: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures },
        env: scene.environment !== null,
        toneMapping: renderer.toneMapping,
        shadowCasters: (() => {
          let count = 0;
          scene.traverse((object) => {
            if (object instanceof THREE.Light && object.castShadow) count += 1;
          });
          return count;
        })()
      };
    },
    captureFrame() {
      renderer.render(scene, camera);
      return canvas.toDataURL("image/png");
    },
    setEnvironmentEnabled(enabled) {
      scene.environment = enabled ? studioEnvironment : null;
    },
    setPaused(nextPaused) {
      paused = nextPaused;
      if (!paused) lastFrameTime = performance.now();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      ready = false;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      disposeObject(arenaRoot);
      disposeObject(botRoot);
      disposeObject(entRoot);
      disposeObject(vfxRoot);
      environment.dispose();
      renderer.dispose();
      canvas.parentElement?.style.removeProperty("--sc-speed");
      canvas.parentElement?.style.removeProperty("--sc-impact");
      scene.clear();
      snapshots = [];
      bots.clear();
      ents.clear();
      depCache = [];
      depVersion = -1;
      arena = null;
    }
  };
}
