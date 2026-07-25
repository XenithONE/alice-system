import * as THREE from "three";
import type { HeroQuality } from "../../quality";
import { createHouses, type HouseSpec } from "./harborHouses";
import {
  createBlockFigure,
  createCastleGate,
  createCityBackdrop,
  createFloatingIslands,
  createHarborMaterials,
  createLighthouse,
  createMarket,
  createPlayableSkiff,
  createProjectPortal,
  createPromenade,
  type HarborFigure,
  type HarborMaterials,
  type ProjectPortal
} from "./harborModels";

export interface HarborWorkItem {
  id: string;
  title: string;
  titleJa: string;
  cover: string;
  status: string;
}

export type HarborMode = "intro" | "sailing" | "walking" | "cinematic";
export type HarborLandmark = "works" | "ai-lab" | "prompts" | "studio";

export interface HarborSceneState {
  mode: HarborMode;
  nearDock: boolean;
  activeWorkId: string | null;
  activeHouseId: string | null;
  activeHouseTitle: string | null;
  activeLandmark: HarborLandmark;
  speed: number;
  cinematicStop: number;
  paused: boolean;
}

export interface HarborSceneEvents {
  onState(state: HarborSceneState): void;
  onHoverWork(id: string | null): void;
  onSelectWork(id: string): void;
  onEnterHouse?: (id: string) => void;
}

export interface HarborScene {
  dispose(): void;
  captureFrame(advance?: number): string;
  debugTick(deltaSeconds: number): void;
  getDebugState(): {
    mode: HarborMode;
    playerPos: { x: number; y: number; z: number };
    camPos: { x: number; y: number; z: number };
    /** unit heading the hull actually points, taken from its world matrix */
    bow: { x: number; z: number };
    boatYaw: number;
    camYaw: number;
    camPitch: number;
    nearDock: boolean;
    activeWorkId: string | null;
    speed: number;
  };
  startVoyage(): void;
  interact(): void;
  /** steer the skiff to the pier by itself; cancels on any helm input */
  autoDock(): void;
  goToLandmark(index: number): void;
  setPaused(paused: boolean): void;
  pause(): void;
  resume(): void;
}

interface PortalRuntime {
  id: string;
  model: ProjectPortal;
  baseScale: number;
}

interface MutableState {
  mode: HarborMode;
  nearDock: boolean;
  activeWorkId: string | null;
  activeHouseId: string | null;
  activeHouseTitle: string | null;
  activeLandmark: HarborLandmark;
  speed: number;
  cinematicStop: number;
  paused: boolean;
}

interface CircleCollider {
  x: number;
  z: number;
  r: number;
}

const DOCK_POINT = new THREE.Vector3(-2.75, 0.55, 5.05);
const WALK_SPAWN = new THREE.Vector3(-8.2, 0.72, 0.85);
const CINEMATIC_STOPS = [0.13, 0.34, 0.61, 0.86] as const;
const PLAYER_R = 0.42;
// z band where the castle's west tower projects into the promenade.
const CASTLE_BAND: readonly [number, number] = [-30.0, -25.0];
const SKIFF_R = 0.9;
// navigable water box (the promenade/land is west of WATER_MIN_X)
const WATER_MIN_X = -4.8;
const WATER_MAX_X = 12.8;
const WATER_MIN_Z = -8.5;
const WATER_MAX_Z = 23;
// Sized to the visible planks. At r 4.0 this invisible ring covered the
// fairway straight ahead of the spawn: 3s of straight sailing ended in a
// 94% speed loss and a 37 degree yank off course.
const DOCK_COLLIDER = { x: -2.94, z: 1.05, r: 2.2 } as const;
// The hull is modelled bow-first along local -Z: the bow taper runs out to
// z -3.45 while the rudder and wake sit at +3.2 and +3.4. So `rotation.y = yaw`
// points the bow exactly here. Travel, autopilot bearings and the cinematic
// path all derive from this one function -- when they were written out by hand
// they disagreed on the sign of x, and the skiff sailed mirrored to the way it
// was facing (identical only when heading due north, which is why straight-line
// tests passed).
const bowDirection = (yaw: number, target = new THREE.Vector3()): THREE.Vector3 =>
  target.set(-Math.sin(yaw), 0, -Math.cos(yaw));
/** Yaw that puts the bow on the given world-space heading. Inverse of bowDirection. */
const yawTowards = (dx: number, dz: number): number => Math.atan2(-dx, -dz);
// The chase camera looks along its own yaw's bow direction reversed, so parking
// it half a turn behind the helm keeps it dead astern.
const CHASE_CAM_OFFSET = Math.PI;
const MOORING_MARGIN = 0.2;
const MOORED_SKIFF_POINT = (() => {
  const fromDock = new THREE.Vector2(
    DOCK_POINT.x - DOCK_COLLIDER.x,
    DOCK_POINT.z - DOCK_COLLIDER.z
  ).normalize().multiplyScalar(DOCK_COLLIDER.r + SKIFF_R + MOORING_MARGIN);
  return new THREE.Vector3(
    DOCK_COLLIDER.x + fromDock.x,
    DOCK_POINT.y,
    DOCK_COLLIDER.z + fromDock.y
  );
})();

// Bow pointing away from the pier, so casting off heads for open water.
// Derived rather than written down: any heading with north in it drives the
// hull straight back into the pier it is moored against.
const MOORED_SKIFF_YAW = yawTowards(
  MOORED_SKIFF_POINT.x - DOCK_COLLIDER.x,
  MOORED_SKIFF_POINT.z - DOCK_COLLIDER.z
);

/**
 * Bearing for the autopilot: the mooring, but rounding the pier instead of
 * driving at it. Steering the direct line wedged the hull between the pier's
 * collider and the west edge of the harbour and left it stranded 6.8 units
 * short. When the pier stands in the way the boat is aimed at one of the
 * tangents of the blocked circle, preferring the smaller turn but never a
 * tangent that runs it into the harbour wall.
 */
const autoDockBearing = (from: THREE.Vector3): number => {
  const toTargetX = MOORED_SKIFF_POINT.x - from.x;
  const toTargetZ = MOORED_SKIFF_POINT.z - from.z;
  const direct = yawTowards(toTargetX, toTargetZ);
  const cx = DOCK_COLLIDER.x - from.x;
  const cz = DOCK_COLLIDER.z - from.z;
  const toCentre = Math.hypot(cx, cz);
  const clearance = DOCK_COLLIDER.r + SKIFF_R + 0.45;
  if (toCentre <= clearance) return yawTowards(-cx, -cz);
  // Anything further away than the mooring cannot be between us and it.
  if (toCentre > Math.hypot(toTargetX, toTargetZ)) return direct;
  const centreBearing = yawTowards(cx, cz);
  const half = Math.asin(clearance / toCentre);
  const off = Math.atan2(Math.sin(direct - centreBearing), Math.cos(direct - centreBearing));
  if (Math.abs(off) >= half) return direct;
  const navigable = (yaw: number): boolean => {
    const probe = bowDirection(yaw).multiplyScalar(3.2);
    const x = from.x + probe.x;
    const z = from.z + probe.z;
    return x > WATER_MIN_X && x < WATER_MAX_X && z > WATER_MIN_Z && z < WATER_MAX_Z;
  };
  const near = centreBearing + (off >= 0 ? half : -half);
  const far = centreBearing + (off >= 0 ? -half : half);
  return navigable(near) || !navigable(far) ? near : far;
};

function makeWaterTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable for water texture");
  ctx.fillStyle = "#f4ffff";
  ctx.fillRect(0, 0, 256, 256);
  ctx.lineCap = "round";
  for (let row = 0; row < 18; row += 1) {
    const y = 9 + row * 14;
    const offset = (row % 3) * 17;
    for (let wave = 0; wave < 5; wave += 1) {
      const x = -24 + offset + wave * 62;
      const width = 16 + ((row + wave) % 4) * 7;
      ctx.strokeStyle = `rgba(5, 102, 132, ${0.085 + ((row + wave) % 3) * 0.028})`;
      ctx.lineWidth = (row + wave) % 4 === 0 ? 1.5 : 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + width * 0.48, y - 2.5, x + width, y);
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(16, 20);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function makeSky(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(150, 32, 18);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x54aee2) },
      horizonColor: { value: new THREE.Color(0xffd49d) },
      bottomColor: { value: new THREE.Color(0xeaf5f7) },
      offset: { value: 0.12 },
      exponent: { value: 0.72 }
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
        float skyMix = pow(max(h, 0.0), exponent);
        vec3 horizon = mix(bottomColor, horizonColor, smoothstep(-0.22, 0.18, h));
        gl_FragColor = vec4(mix(horizon, topColor, skyMix), 1.0);
      }
    `
  });
  return new THREE.Mesh(geometry, material);
}

function createSun(): THREE.Group {
  const root = new THREE.Group();
  const disk = new THREE.Mesh(
    new THREE.SphereGeometry(2.6, 20, 12),
    new THREE.MeshBasicMaterial({ color: 0xffedb5, toneMapped: false })
  );
  disk.position.set(52, 24, -56);
  root.add(disk);
  return root;
}

function createClouds(quality: HeroQuality): THREE.Group {
  const root = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: 0xffedd3,
    roughness: 1,
    transparent: true,
    opacity: 0.82,
    depthWrite: false
  });
  const cloudCount = quality.tier === "low" ? 6 : 11;
  for (let i = 0; i < cloudCount; i += 1) {
    const cloud = new THREE.Group();
    const puffCount = quality.tier === "low" ? 3 : 5;
    for (let puff = 0; puff < puffCount; puff += 1) {
      const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 1), material);
      mesh.position.set((puff - (puffCount - 1) / 2) * 1.45, Math.sin(puff * 1.7) * 0.45, (puff % 2) * 0.34);
      mesh.scale.set(1.25 + (puff % 3) * 0.4, 0.72 + (puff % 2) * 0.24, 0.85);
      cloud.add(mesh);
    }
    cloud.position.set(-48 + (i % 6) * 19, 18 + (i % 3) * 4.2, -38 - Math.floor(i / 6) * 28);
    cloud.scale.setScalar(0.8 + (i % 4) * 0.18);
    root.add(cloud);
  }
  return root;
}

function makeCragGeometry(radius: number, height: number, segments: number, seed: number): THREE.BufferGeometry {
  const geometry = new THREE.ConeGeometry(radius, height, segments, 4);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i += 1) {
    const y = position.getY(i);
    const factor = 0.88 + Math.sin(i * 12.37 + seed * 4.91) * 0.13;
    position.setX(i, position.getX(i) * factor);
    position.setZ(i, position.getZ(i) * (0.9 + Math.cos(i * 7.13 + seed) * 0.1));
    position.setY(i, y + Math.sin(i * 4.27 + seed) * height * 0.018);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function createRockIsland(
  radius: number,
  height: number,
  materials: HarborMaterials,
  segments = 10
): THREE.Group {
  const root = new THREE.Group();
  const rock = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.78, radius, height, segments, 3), materials.stoneDark);
  rock.position.y = -height * 0.46;
  rock.castShadow = true;
  rock.receiveShadow = true;
  root.add(rock);
  const terrace = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.88, 0.72, segments), materials.stone);
  terrace.position.y = 0.18;
  terrace.receiveShadow = true;
  root.add(terrace);
  const grass = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.92, radius * 0.95, 0.28, segments), materials.foliage);
  grass.position.y = 0.67;
  grass.receiveShadow = true;
  root.add(grass);
  return root;
}

function createMountains(materials: HarborMaterials, quality: HeroQuality): THREE.Group {
  const root = new THREE.Group();
  const count = quality.tier === "low" ? 10 : 18;
  for (let i = 0; i < count; i += 1) {
    const height = 13 + (i % 5) * 4.8;
    const radius = 5.5 + (i % 4) * 1.1;
    const mountain = new THREE.Mesh(
      makeCragGeometry(radius, height, quality.tier === "high" ? 9 : 7, i),
      i % 3 === 0 ? materials.stone : materials.stoneDark
    );
    mountain.position.set(-48 + (i % 9) * 12, height * 0.38 - 3, -69 - Math.floor(i / 9) * 18);
    mountain.rotation.y = (i * 0.63) % Math.PI;
    mountain.scale.z = 0.72 + (i % 3) * 0.12;
    root.add(mountain);
    const green = new THREE.Mesh(makeCragGeometry(radius * 0.92, height * 0.48, quality.tier === "high" ? 9 : 7, i + 17), materials.foliageDark);
    green.position.copy(mountain.position);
    green.position.y -= height * 0.13;
    green.rotation.y = mountain.rotation.y;
    green.scale.z = mountain.scale.z;
    root.add(green);
  }
  return root;
}

function createLantern(materials: HarborMaterials, quality: HeroQuality): THREE.Group {
  const root = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 2.3, 8), materials.stoneDark);
  post.position.y = 1.15;
  root.add(post);
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.58, 0.44), materials.window);
  box.position.y = 2.45;
  root.add(box);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.34, 4), materials.cobalt);
  roof.position.y = 2.91;
  roof.rotation.y = Math.PI / 4;
  root.add(roof);
  if (quality.tier !== "low") {
    const light = new THREE.PointLight(0xff9f3d, 1.5, 5.5, 2);
    light.position.y = 2.48;
    root.add(light);
  }
  return root;
}

function createWake(): THREE.Group {
  const root = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color: 0xc6fff9,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  for (const side of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(side * 0.35, 0.8);
    shape.lineTo(side * 1.7, 5.2);
    shape.lineTo(side * 0.62, 4.9);
    shape.closePath();
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -0.38;
    root.add(mesh);
  }
  return root;
}

function landmarkForCinematic(t: number): HarborLandmark {
  if (t < 0.26) return "works";
  if (t < 0.49) return "ai-lab";
  if (t < 0.73) return "prompts";
  return "studio";
}

function approach(current: number, target: number, speed: number, delta: number): number {
  const distance = target - current;
  const amount = Math.min(Math.abs(distance), speed * delta);
  return current + Math.sign(distance) * amount;
}

function dampVector(current: THREE.Vector3, target: THREE.Vector3, lambda: number, delta: number): void {
  const factor = 1 - Math.exp(-lambda * delta);
  current.lerp(target, factor);
}

function resolveCirclePenetrations(
  position: THREE.Vector3,
  radius: number,
  colliders: CircleCollider[],
  fallbackX: number,
  fallbackZ: number
): boolean {
  let collided = false;
  for (let pass = 0; pass < 3; pass += 1) {
    let adjusted = false;
    for (const collider of colliders) {
      const dx = position.x - collider.x;
      const dz = position.z - collider.z;
      const minDistance = radius + collider.r;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq >= minDistance * minDistance) continue;

      let normalX = dx;
      let normalZ = dz;
      let distance = Math.sqrt(distanceSq);
      if (distance < 1e-6) {
        const fallbackLength = Math.hypot(fallbackX, fallbackZ);
        normalX = fallbackLength > 1e-6 ? -fallbackX / fallbackLength : 1;
        normalZ = fallbackLength > 1e-6 ? -fallbackZ / fallbackLength : 0;
        distance = 0;
      } else {
        normalX /= distance;
        normalZ /= distance;
      }
      const push = minDistance - distance;
      position.x += normalX * push;
      position.z += normalZ * push;
      collided = true;
      adjusted = true;
    }
    if (!adjusted) break;
  }
  return collided;
}

function moveWithCircleCollisions(
  position: THREE.Vector3,
  deltaX: number,
  deltaZ: number,
  radius: number,
  colliders: CircleCollider[]
): boolean {
  let collided = false;
  position.x += deltaX;
  collided = resolveCirclePenetrations(position, radius, colliders, deltaX, 0) || collided;
  position.z += deltaZ;
  collided = resolveCirclePenetrations(position, radius, colliders, 0, deltaZ) || collided;
  return collided;
}

export function createHarborScene(
  canvas: HTMLCanvasElement,
  quality: HeroQuality,
  works: HarborWorkItem[],
  events: HarborSceneEvents
): HarborScene {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: quality.tier !== "low",
    powerPreference: "high-performance",
    alpha: false
  });
  try {
    return initHarbor(canvas, renderer, quality, works, events);
  } catch (error) {
    renderer.dispose();
    throw error;
  }
}

function initHarbor(
  canvas: HTMLCanvasElement,
  renderer: THREE.WebGLRenderer,
  quality: HeroQuality,
  works: HarborWorkItem[],
  events: HarborSceneEvents
): HarborScene {
  const searchParams = new URLSearchParams(window.location.search);
  const qaJourney = searchParams.get("qa") === "journey";
  const skiffReview = searchParams.get("skiff-review") === "1";
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = quality.tier !== "low";
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xbddce6, quality.tier === "low" ? 0.0095 : 0.0072);
  const camera = new THREE.PerspectiveCamera(quality.coarse ? 56 : 48, 1, 0.1, 260);
  camera.position.set(0, 6.3, 27);

  const materials = createHarborMaterials();
  const sky = makeSky();
  scene.add(sky);
  scene.add(createSun());
  scene.add(createClouds(quality));
  scene.add(new THREE.HemisphereLight(0xa8d9f4, 0x81522c, quality.tier === "low" ? 1.65 : 1.95));
  const key = new THREE.DirectionalLight(0xffd098, quality.tier === "low" ? 3.1 : 4.1);
  key.position.set(-28, 42, 26);
  key.castShadow = renderer.shadowMap.enabled;
  key.shadow.mapSize.set(quality.tier === "high" ? 2048 : 1024, quality.tier === "high" ? 2048 : 1024);
  key.shadow.camera.left = -45;
  key.shadow.camera.right = 45;
  key.shadow.camera.top = 45;
  key.shadow.camera.bottom = -45;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 120;
  key.shadow.bias = -0.0002;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xbbeeff, 0.18);
  rim.position.set(36, 22, -42);
  scene.add(rim);

  const waterTexture = makeWaterTexture();
  const waterSegments = quality.tier === "high" ? 128 : quality.tier === "low" ? 48 : 84;
  const waterGeometry = new THREE.PlaneGeometry(150, 170, waterSegments, waterSegments);
  const waterPositions = waterGeometry.attributes.position as THREE.BufferAttribute;
  const waterBase = new Float32Array(waterPositions.array as Float32Array);
  const waterMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x079fb7,
    map: waterTexture,
    roughness: 0.62,
    metalness: 0.03,
    clearcoat: 0.04,
    clearcoatRoughness: 0.6,
    transparent: true,
    opacity: 0.96,
    side: THREE.DoubleSide
  });
  const water = new THREE.Mesh(waterGeometry, waterMaterial);
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0;
  water.receiveShadow = true;
  scene.add(water);

  const castleIsland = createRockIsland(16.2, 5.5, materials, quality.tier === "high" ? 14 : 10);
  castleIsland.position.set(-9.5, -0.8, -31);
  scene.add(castleIsland);
  const cityIsland = createRockIsland(28, 7.5, materials, quality.tier === "high" ? 16 : 11);
  cityIsland.position.set(-7, -1.9, -52);
  scene.add(cityIsland);
  const lighthouseIsland = createRockIsland(6.6, 4.3, materials, quality.tier === "high" ? 12 : 9);
  lighthouseIsland.position.set(17, -0.45, -15.5);
  scene.add(lighthouseIsland);

  const promenade = createPromenade(materials, quality.tier);
  scene.add(promenade);
  const market = createMarket(materials, quality.tier);
  scene.add(market);
  const castle = createCastleGate(materials, quality.tier);
  castle.position.set(-8.5, 0.62, -27.5);
  const CASTLE_SCALE = 1.55;
  castle.scale.setScalar(CASTLE_SCALE);
  const castleWestTowerCollider: CircleCollider = {
    x: -8.5 - 3.4 * CASTLE_SCALE,
    z: -27.5,
    r: 2.1 * CASTLE_SCALE
  };
  scene.add(castle);
  const lighthouse = createLighthouse(materials, quality.tier);
  lighthouse.position.set(16.5, 0.55, -14.5);
  lighthouse.scale.setScalar(1.28);
  scene.add(lighthouse);
  scene.add(createCityBackdrop(materials, quality.tier));
  scene.add(createFloatingIslands(materials, quality.tier));
  scene.add(createMountains(materials, quality));

  const lanternCount = quality.tier === "low" ? 7 : 13;
  for (let i = 0; i < lanternCount; i += 1) {
    const lantern = createLantern(materials, quality);
    lantern.position.set(-7.45, 0.54, -35.4 + i * (34 / Math.max(1, lanternCount - 1)));
    scene.add(lantern);
  }

  const skiffModel = createPlayableSkiff(quality.tier, renderer.shadowMap.enabled);
  const skiff = skiffModel.root;
  skiff.position.copy(qaJourney ? MOORED_SKIFF_POINT : new THREE.Vector3(0.3, 0.55, 17.5));
  skiff.rotation.y = 0;
  skiff.scale.setScalar(0.72);
  skiff.scale.x *= 1.16;
  scene.add(skiff);
  const backgroundSkiff = createPlayableSkiff("low", false).root;
  backgroundSkiff.name = "background-skiff";
  backgroundSkiff.position.set(8.2, 0.48, -7.6);
  backgroundSkiff.rotation.y = -0.52;
  backgroundSkiff.scale.multiplyScalar(0.42);
  backgroundSkiff.scale.x *= 1.16;
  scene.add(backgroundSkiff);
  const wake = createWake();
  wake.position.set(0, 0, 3.4);
  skiff.add(wake);

  const figure: HarborFigure = createBlockFigure(materials);
  figure.root.visible = false;
  figure.root.position.copy(WALK_SPAWN);
  figure.root.rotation.y = Math.PI;
  scene.add(figure.root);

  const textureLoader = new THREE.TextureLoader();
  const textures: THREE.Texture[] = [];
  const coverTextures = new Map<string, THREE.Texture>();
  const portals: PortalRuntime[] = [];
  const pickMeshes: THREE.Mesh[] = [];
  // Create each cover once before houses so both the portal easel and its house
  // sign share the same GPU texture upload.
  for (const work of works) {
    const texture = textureLoader.load(
      work.cover,
      () => renderOnce(),
      undefined,
      () => renderOnce()
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(6, renderer.capabilities.getMaxAnisotropy());
    textures.push(texture);
    coverTextures.set(work.id, texture);
  }
  const housePalette = [0xb84235, 0x356eb8, 0x3b8b62, 0xd2a536];
  // Only browser-playable works become enterable houses — the promenade is
  // 38 units long, so packing every work in would shrink them below their own
  // footprint. In-development titles stay as poster easels.
  const houseSpecs: HouseSpec[] = works
    .filter((work) => work.status === "playable")
    .map((work, index) => ({
      id: work.id,
      title: work.title,
      cover: work.cover,
      color: housePalette[index % housePalette.length]!
    }));
  const houseCollection = createHouses(
    houseSpecs,
    materials,
    quality,
    coverTextures,
    {
      forbiddenBand: CASTLE_BAND,
      collider: castleWestTowerCollider,
      playerRadius: PLAYER_R
    }
  );
  scene.add(houseCollection.group);
  const housePickMeshes: THREE.Mesh[] = [];
  houseCollection.group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && typeof mesh.userData.houseId === "string") housePickMeshes.push(mesh);
  });
  for (let i = 0; i < works.length; i += 1) {
    const work = works[i]!;
    const texture = coverTextures.get(work.id);
    if (!texture) throw new Error(`missing cover texture for ${work.id}`);
    const portal = createProjectPortal(texture, materials, quality.tier);
    portal.root.position.set(-14.75, 0.63, -2.8 - i * 2.55);
    portal.root.rotation.y = Math.PI / 2;
    portal.root.scale.setScalar(0.78);
    portal.pick.userData.workId = work.id;
    portal.pick.userData.portalIndex = i;
    scene.add(portal.root);
    portals.push({ id: work.id, model: portal, baseScale: 0.78 });
    pickMeshes.push(portal.pick);
  }

  // Static promenade obstacles, derived from the placements above and in
  // createPromenade/createMarket/createCastleGate.
  const colliders: CircleCollider[] = [
    ...houseCollection.houses.map((house) => house.collider),
    ...portals.map((portal) => ({
      x: portal.model.root.position.x,
      z: portal.model.root.position.z,
      r: 0.72
    })),
    ...Array.from({ length: quality.tier === "low" ? 3 : 5 }, (_, index) => ({
      x: -17.1,
      z: -4.5 - index * 5.5,
      r: 1.35
    })),
    ...Array.from({ length: lanternCount }, (_, index) => ({
      x: -7.45,
      z: -35.4 + index * (34 / Math.max(1, lanternCount - 1)),
      r: 0.24
    })),
    // The scaled castle's west tower and gate-side masonry reach the walkway.
    // The west tower's local radius is 2.1 (createTower in harborModels), so its
    // real world footprint is 2.1 * CASTLE_SCALE = 3.255 — the old 2.05 let the
    // walker stand 0.75 inside visible masonry.
    castleWestTowerCollider,
    { x: -10.55, z: -28.15, r: 1.35 }
  ];

  // Water hazards use the same circle resolver. The island values come from
  // the actual createRockIsland placements; the dock center spans its planks.
  const sailingColliders: CircleCollider[] = [
    DOCK_COLLIDER,
    { x: castleIsland.position.x, z: castleIsland.position.z, r: 15.2 },
    { x: cityIsland.position.x, z: cityIsland.position.z, r: 26.5 },
    { x: lighthouseIsland.position.x, z: lighthouseIsland.position.z, r: 6.2 },
    { x: lighthouse.position.x, z: lighthouse.position.z, r: 2.2 },
    { x: backgroundSkiff.position.x, z: backgroundSkiff.position.z, r: 1.25 }
  ];

  if (skiffReview) {
    scene.fog = null;
    scene.background = new THREE.Color(0xd5d0c6);
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      let cursor: THREE.Object3D | null = object;
      let belongsToSkiff = false;
      while (cursor) {
        if (cursor === skiff) {
          belongsToSkiff = true;
          break;
        }
        cursor = cursor.parent;
      }
      if (!belongsToSkiff) mesh.visible = false;
    });
    const reviewGround = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.MeshStandardMaterial({ color: 0xb8b0a3, roughness: 0.82 })
    );
    reviewGround.name = "skiff-review-ground";
    reviewGround.rotation.x = -Math.PI / 2;
    reviewGround.position.y = -0.78;
    reviewGround.receiveShadow = true;
    scene.add(reviewGround);
    const reviewFill = new THREE.DirectionalLight(0xffe0b4, 2.35);
    reviewFill.position.set(10, 12, 11);
    scene.add(reviewFill);
    skiff.position.set(0, 0.05, 0);
    skiff.rotation.set(0, 0, 0);
    skiff.scale.set(1.16, 1, 1);
    const reviewSkipper = skiffModel.runtime.nodes.skipper;
    if (reviewSkipper) reviewSkipper.visible = false;
    camera.fov = 55;
    camera.updateProjectionMatrix();
    camera.position.set(6.6, 5.5, 9.9);
    camera.lookAt(0, 2.6, 0);
  }

  const cinematicPath = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(0.3, 0.55, 17.5),
      new THREE.Vector3(-2.4, 0.55, 7.2),
      new THREE.Vector3(3.2, 0.55, -2.2),
      new THREE.Vector3(8.8, 0.55, -12.8),
      new THREE.Vector3(3.6, 0.55, -24.4),
      new THREE.Vector3(-1.2, 0.55, -31.8)
    ],
    false,
    "catmullrom",
    0.42
  );

  const initialMode: HarborMode = quality.coarse ? "cinematic" : "intro";
  const mutable: MutableState = {
    mode: initialMode,
    nearDock: false,
    activeWorkId: null,
    activeHouseId: null,
    activeHouseTitle: null,
    activeLandmark: "works",
    speed: 0,
    cinematicStop: 0,
    paused: false
  };
  let emittedState = "";
  let cinematicT: number = CINEMATIC_STOPS[0];
  let cinematicTarget: number = CINEMATIC_STOPS[0];
  let boatYaw = 0;
  let boatSpeed = 0;
  // seconds the hull has been pinned with the throttle open
  let boatWedged = false;
  let autoDocking = false;
  // sampled every 0.5s to detect a wedged hull that still jitters in place
  let boatProgressAnchor = new THREE.Vector3();
  let boatProgressTimer = 0;
  let camYaw = figure.root.rotation.y;
  let camPitch = 0;
  let boatCamYawOffset = CHASE_CAM_OFFSET;
  let pointerDown = false;
  let pointerMoved = false;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let hoveredWorkId: string | null = null;
  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const keys = new Set<string>();
  let running = true;
  let disposed = false;
  let raf = 0;
  let lastFrame = 0;
  let elapsed = 0;
  let gameplayTime = 0;

  const emitState = (): void => {
    const publicState: HarborSceneState = {
      mode: mutable.mode,
      nearDock: mutable.nearDock,
      activeWorkId: mutable.activeWorkId,
      activeHouseId: mutable.activeHouseId,
      activeHouseTitle: mutable.activeHouseTitle,
      activeLandmark: mutable.activeLandmark,
      speed: mutable.speed,
      cinematicStop: mutable.cinematicStop,
      paused: mutable.paused
    };
    const keyValue = JSON.stringify(publicState);
    if (keyValue === emittedState) return;
    emittedState = keyValue;
    events.onState(publicState);
  };

  const setHoveredWork = (id: string | null): void => {
    if (hoveredWorkId === id) return;
    hoveredWorkId = id;
    events.onHoverWork(id);
  };

  const setActiveHouse = (id: string | null): void => {
    mutable.activeHouseId = id;
    mutable.activeHouseTitle = id
      ? works.find((work) => work.id === id)?.title ?? null
      : null;
    for (const house of houseCollection.houses) {
      house.setHighlight(house.id === id);
    }
  };

  const updatePortalHighlights = (delta: number): void => {
    for (const portal of portals) {
      const active = portal.id === mutable.activeWorkId || portal.id === hoveredWorkId;
      const targetScale = portal.baseScale * (active ? 1.08 : 1);
      const currentScale = portal.model.root.scale.x;
      const nextScale = THREE.MathUtils.damp(currentScale, targetScale, 12, delta);
      portal.model.root.scale.setScalar(nextScale);
      portal.model.frameMaterial.emissive.setHex(active ? 0xe0a73d : 0x000000);
      portal.model.frameMaterial.emissiveIntensity = active ? 0.48 : 0;
    }
  };

  const resize = (): void => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    const maxPixels = quality.tier === "high" ? 2_800_000 : quality.tier === "balanced" ? 2_000_000 : 1_050_000;
    const dpr = Math.min(quality.dpr, Math.sqrt(maxPixels / Math.max(1, width * height)));
    renderer.setPixelRatio(Math.max(0.75, dpr));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = quality.coarse ? 54 : 48;
    camera.updateProjectionMatrix();
    renderOnce();
  };

  function updateWater(time: number): void {
    if (quality.motionScale === 0) return;
    const array = waterPositions.array as Float32Array;
    for (let i = 0; i < waterPositions.count; i += 1) {
      const x = waterBase[i * 3]!;
      const y = waterBase[i * 3 + 1]!;
      array[i * 3 + 2] =
        Math.sin(x * 0.17 + time * 0.72) * 0.13 +
        Math.sin(y * 0.14 - time * 0.55) * 0.09 +
        Math.sin((x + y) * 0.095 + time * 0.33) * 0.055;
    }
    waterPositions.needsUpdate = true;
    if (quality.tier !== "low") waterGeometry.computeVertexNormals();
    waterTexture.offset.x = (time * 0.008) % 1;
    waterTexture.offset.y = (time * 0.004) % 1;
  }

  const updateBoatBob = (time: number, intensity = 1): void => {
    skiff.position.y = 0.55 + Math.sin(time * 1.15) * 0.12 * intensity;
    skiff.rotation.z = Math.sin(time * 0.88) * 0.035 * intensity;
    skiff.rotation.x = Math.sin(time * 0.66 + 0.8) * 0.025 * intensity;
  };

  const updateSailing = (delta: number, ambientTime: number, operationTime: number): void => {
    let throttle = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
    let steering = (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0) - (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0);
    // Autopilot: the HUD used to show a dead, disabled "桟橋へ近づく" button.
    // It now actually sails there, and any helm input hands control straight back.
    if (autoDocking) {
      if (throttle !== 0 || steering !== 0) {
        autoDocking = false;
      } else {
        const bearing = autoDockBearing(skiff.position);
        let off = bearing - boatYaw;
        off = Math.atan2(Math.sin(off), Math.cos(off));
        steering = Math.abs(off) < 0.05 ? 0 : (off > 0 ? 1 : -1);
        const distance = skiff.position.distanceTo(MOORED_SKIFF_POINT);
        // ease off so the arrival is slow enough for the dock prompt to arm
        throttle = distance < 6 && Math.abs(boatSpeed) > 1.6 ? -1 : 1;
        if (mutable.nearDock) autoDocking = false;
      }
    }
    boatSpeed = approach(boatSpeed, throttle > 0 ? 6.2 : throttle < 0 ? -2.4 : 0, throttle === 0 ? 2.4 : 3.2, delta);
    boatYaw += steering * delta * (0.65 + Math.min(1, Math.abs(boatSpeed) / 4) * 0.75);
    const forward = bowDirection(boatYaw);
    const travel = boatSpeed * delta;
    const fromX = skiff.position.x;
    const fromZ = skiff.position.z;
    const intendedX = fromX + forward.x * travel;
    const intendedZ = fromZ + forward.z * travel;
    const collided = moveWithCircleCollisions(
      skiff.position,
      forward.x * travel,
      forward.z * travel,
      SKIFF_R,
      sailingColliders
    );
    if (collided) {
      // Bleed a little way so a scrape feels like a scrape. The heading is NOT
      // touched: auto-steering only ran when the player was not steering, i.e.
      // exactly when they were holding W alone, so the boat wandered off course
      // on its own. Sliding is handled positionally by the collision resolver.
      boatSpeed *= 0.86;
    }

    const preX = skiff.position.x;
    const preZ = skiff.position.z;
    skiff.position.x = THREE.MathUtils.clamp(preX, WATER_MIN_X, WATER_MAX_X);
    skiff.position.z = THREE.MathUtils.clamp(preZ, WATER_MIN_Z, WATER_MAX_Z);
    const blockedX = skiff.position.x !== preX;
    const blockedZ = skiff.position.z !== preZ;
    if (blockedX || blockedZ) {
      // Slow at the harbour edge, but never turn the wheel for the player.
      boatSpeed *= 0.6;
    }

    skiff.rotation.y = boatYaw;
    updateBoatBob(ambientTime, Math.min(1, 0.35 + Math.abs(boatSpeed) * 0.12));
    const rudder = skiffModel.runtime.nodes.rudder;
    const wheel = skiffModel.runtime.nodes["steering-wheel"];
    if (rudder) rudder.rotation.y = THREE.MathUtils.damp(rudder.rotation.y, steering * 0.48, 7, delta);
    if (wheel) wheel.rotation.z = THREE.MathUtils.damp(wheel.rotation.z, -steering * 0.82, 8, delta);
    wake.visible = Math.abs(boatSpeed) > 0.3;
    wake.scale.z = THREE.MathUtils.damp(wake.scale.z, 0.7 + Math.abs(boatSpeed) * 0.15, 6, delta);
    wake.scale.x = THREE.MathUtils.damp(
      wake.scale.x,
      1 + (wake.visible ? Math.sin(operationTime * 9) * 0.035 : 0),
      7,
      delta
    );
    const wakeMesh = wake.children[0] as THREE.Mesh | undefined;
    const wakeMaterial = wakeMesh?.material as THREE.MeshBasicMaterial | undefined;
    if (wakeMaterial) wakeMaterial.opacity = 0.2 + Math.abs(boatSpeed) * 0.045;

    // Escape assist: colliders and the harbour edge could wedge the skiff with
    // the engine running and the rudder doing nothing — the "船が操縦できない"
    // report. If nothing moves while the throttle is open, swing the bow toward
    // open water and give it steerage way back.
    // Per-frame distance is a bad stuck test: a hull wedged between a collider
    // and the water edge oscillates by ~0.02 every frame and looks like motion.
    // Measure real progress over a window instead.
    // Wedge release. A hull can still be pinned between a collider and the water
    // edge, where the two constraints cancel. This frees it WITHOUT rotating the
    // bow — the helm belongs to the player. The window is deliberately strict
    // (a full second of near-zero progress while under power) so it can never
    // fire during ordinary sailing, including the initial acceleration.
    boatProgressTimer += delta;
    if (boatProgressTimer >= 1) {
      const progressed = Math.hypot(
        skiff.position.x - boatProgressAnchor.x,
        skiff.position.z - boatProgressAnchor.z
      );
      boatWedged = throttle !== 0 && Math.abs(boatSpeed) > 0.8 && progressed < 0.1;
      boatProgressAnchor.copy(skiff.position);
      boatProgressTimer = 0;
    }
    if (boatWedged) {
      const openX = (WATER_MIN_X + WATER_MAX_X) / 2;
      const openZ = (WATER_MIN_Z + WATER_MAX_Z) / 2;
      const openLen = Math.hypot(openX - skiff.position.x, openZ - skiff.position.z) || 1;
      skiff.position.x = THREE.MathUtils.clamp(
        skiff.position.x + ((openX - skiff.position.x) / openLen) * delta * 2.5,
        WATER_MIN_X,
        WATER_MAX_X
      );
      skiff.position.z = THREE.MathUtils.clamp(
        skiff.position.z + ((openZ - skiff.position.z) / openLen) * delta * 2.5,
        WATER_MIN_Z,
        WATER_MAX_Z
      );
    }

    const distanceToDock = skiff.position.distanceTo(DOCK_POINT);
    mutable.nearDock = distanceToDock < 4.25 && Math.abs(boatSpeed) < 2.35;
    // Report the distance actually covered this frame, not the throttle: the
    // old value still read 6.2 while the hull was pinned against the edge.
    const groundSpeed = delta > 1e-6
      ? Math.hypot(skiff.position.x - fromX, skiff.position.z - fromZ) / delta
      : 0;
    mutable.speed = Math.round(Math.min(Math.abs(boatSpeed), groundSpeed) * 10) / 10;

    camYaw = boatYaw + boatCamYawOffset;
    const back = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    const desiredCamera = skiff.position
      .clone()
      .addScaledVector(back, 12.4)
      .add(new THREE.Vector3(0, 5.4 + camPitch * 3.2, 0));
    dampVector(camera.position, desiredCamera, 5.4, delta);
    camera.lookAt(skiff.position.x, skiff.position.y + 1.55, skiff.position.z);
  };

  const walkablePosition = (candidate: THREE.Vector3): THREE.Vector3 => {
    candidate.x = THREE.MathUtils.clamp(candidate.x, -14.15, -7.65);
    candidate.z = THREE.MathUtils.clamp(candidate.z, -36.4, 1.6);
    candidate.y = 0.72;
    return candidate;
  };

  const updateWalking = (delta: number, ambientTime: number, operationTime: number): void => {
    const xInput = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    const zInput = (keys.has("KeyS") ? 1 : 0) - (keys.has("KeyW") ? 1 : 0);
    const camForward = new THREE.Vector3();
    camera.getWorldDirection(camForward);
    camForward.y = 0;
    if (camForward.lengthSq() > 1e-6) {
      camForward.normalize();
    } else {
      camForward.set(Math.sin(camYaw), 0, Math.cos(camYaw));
    }
    // Right-hand rule: facing north (0,0,-1) the screen-right axis is +X (east).
    // The mirrored form made D strafe west and A strafe east.
    const camRight = new THREE.Vector3(-camForward.z, 0, camForward.x);
    const move = camRight.multiplyScalar(xInput).add(camForward.multiplyScalar(-zInput));
    move.y = 0;
    const moving = move.lengthSq() > 1e-4;
    const run = keys.has("ShiftLeft") || keys.has("ShiftRight");
    const moveSpeed = run ? 6.2 : 3.6;
    if (moving) {
      move.normalize();
      const travel = moveSpeed * delta;
      moveWithCircleCollisions(
        figure.root.position,
        move.x * travel,
        move.z * travel,
        PLAYER_R,
        colliders
      );
      walkablePosition(figure.root.position);
      const targetYaw = Math.atan2(move.x, move.z);
      figure.root.rotation.y = THREE.MathUtils.damp(figure.root.rotation.y, targetYaw, 12, delta);
    }
    const stride = moving ? Math.sin(operationTime * (run ? 12 : 8)) * (run ? 0.76 : 0.52) : 0;
    figure.leftArm.rotation.x = THREE.MathUtils.damp(figure.leftArm.rotation.x, -stride, 12, delta);
    figure.rightArm.rotation.x = THREE.MathUtils.damp(figure.rightArm.rotation.x, stride, 12, delta);
    figure.leftLeg.rotation.x = THREE.MathUtils.damp(figure.leftLeg.rotation.x, stride, 12, delta);
    figure.rightLeg.rotation.x = THREE.MathUtils.damp(figure.rightLeg.rotation.x, -stride, 12, delta);
    figure.head.rotation.y = Math.sin(ambientTime * 0.58) * 0.08;

    let nearest: PortalRuntime | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const portal of portals) {
      const distance = figure.root.position.distanceTo(portal.model.root.position);
      if (distance < nearestDistance) {
        nearest = portal;
        nearestDistance = distance;
      }
    }
    mutable.activeWorkId = nearestDistance < 3.55 ? nearest?.id ?? null : null;
    let nearestHouseId: string | null = null;
    let nearestHouseDistance = Number.POSITIVE_INFINITY;
    for (const house of houseCollection.houses) {
      const distance = figure.root.position.distanceTo(house.doorPosition);
      if (distance < nearestHouseDistance) {
        nearestHouseId = house.id;
        nearestHouseDistance = distance;
      }
    }
    // Doors sit ~3.35 apart, so a 2.6 radius overlapped two houses at once.
    setActiveHouse(nearestHouseDistance < 1.9 ? nearestHouseId : null);
    mutable.nearDock = figure.root.position.distanceTo(WALK_SPAWN) < 2.15;
    mutable.speed = moving ? moveSpeed : 0;

    const back = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    const desiredCamera = figure.root.position
      .clone()
      .addScaledVector(back, 6.2)
      .add(new THREE.Vector3(0, 2.4 + camPitch * 2.6, 0));
    dampVector(camera.position, desiredCamera, 7.2, delta);
    camera.lookAt(figure.root.position.x, figure.root.position.y + 1.35, figure.root.position.z);
    updateBoatBob(ambientTime, 0.55);
  };

  const updateIntro = (delta: number, time: number): void => {
    updateBoatBob(time, 0.75);
    skiff.rotation.y = 0;
    const motion = quality.motionScale;
    const desired = new THREE.Vector3(
      1.8 + Math.sin(time * 0.16) * 1.1 * motion,
      8.6 + Math.sin(time * 0.21) * 0.18 * motion,
      33.5 + Math.cos(time * 0.16) * 0.55 * motion
    );
    dampVector(camera.position, desired, 3.5, delta);
    camera.lookAt(
      -2.5 + Math.sin(time * 0.12) * 0.25 * motion,
      3.4,
      -9.8
    );
    mutable.speed = 0;
    mutable.nearDock = false;
  };

  const updateCinematic = (delta: number, time: number): void => {
    if (!mutable.paused && quality.motionScale > 0) {
      cinematicTarget = Math.min(0.93, cinematicTarget + delta * 0.0075);
      if (cinematicTarget >= 0.925) cinematicTarget = CINEMATIC_STOPS[0];
    }
    cinematicT = THREE.MathUtils.damp(cinematicT, cinematicTarget, 2.4, delta);
    const point = cinematicPath.getPointAt(cinematicT);
    const tangent = cinematicPath.getTangentAt(Math.min(0.995, cinematicT + 0.002)).normalize();
    skiff.position.copy(point);
    boatYaw = yawTowards(tangent.x, tangent.z);
    skiff.rotation.y = boatYaw;
    updateBoatBob(time, 0.9);
    const cameraTrail = quality.coarse ? 15.8 : 9.1;
    const desiredCamera = point
      .clone()
      .add(new THREE.Vector3(
        -tangent.x * cameraTrail,
        quality.coarse ? 8.2 : 5.8,
        -tangent.z * cameraTrail
      ))
      .add(new THREE.Vector3(quality.coarse ? 0.6 : 2.2, 0, 0));
    dampVector(camera.position, desiredCamera, 4.6, delta);
    const target = point
      .clone()
      .addScaledVector(tangent, quality.coarse ? 10 : 8)
      .add(new THREE.Vector3(0, quality.coarse ? 3 : 2.4, 0));
    camera.lookAt(target);
    mutable.activeLandmark = landmarkForCinematic(cinematicT);
    let stop = 0;
    let best = Number.POSITIVE_INFINITY;
    CINEMATIC_STOPS.forEach((value, index) => {
      const distance = Math.abs(cinematicT - value);
      if (distance < best) {
        stop = index;
        best = distance;
      }
    });
    mutable.cinematicStop = stop;
    mutable.speed = mutable.paused ? 0 : 2.1;
    mutable.nearDock = false;
  };

  const update = (delta: number, ambientTime: number, operationTime: number): void => {
    if (skiffReview) {
      skiff.position.y = 0.05 + Math.sin(ambientTime * 0.65) * 0.025 * quality.motionScale;
      skiff.rotation.y = Math.sin(ambientTime * 0.32) * 0.035 * quality.motionScale;
      camera.lookAt(0, 2.6, 0);
      emitState();
      return;
    }
    if (mutable.mode !== "walking" && mutable.activeHouseId) setActiveHouse(null);
    updateWater(ambientTime);
    if (mutable.mode === "intro") updateIntro(delta, ambientTime);
    if (mutable.mode === "sailing") updateSailing(delta, ambientTime, operationTime);
    if (mutable.mode === "walking") updateWalking(delta, ambientTime, operationTime);
    if (mutable.mode === "cinematic") updateCinematic(delta, ambientTime);
    updatePortalHighlights(delta);
    emitState();
  };

  function renderOnce(): void {
    if (!running) return;
    renderer.render(scene, camera);
  }

  const frame = (now: number): void => {
    if (!running) return;
    raf = window.requestAnimationFrame(frame);
    const minFrame = 1000 / quality.maxFps;
    if (now - lastFrame < minFrame) return;
    const delta = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000));
    lastFrame = now;
    // Reduced motion freezes ambient loops, but the render loop stays alive so
    // voyage controls, camera changes, and landmark navigation still respond.
    elapsed += delta * quality.motionScale;
    gameplayTime += delta;
    update(delta, elapsed, gameplayTime);
    renderOnce();
  };

  const updatePointer = (event: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
  };

  const pickWorkAtPointer = (): string | null => {
    if (!running || mutable.mode !== "walking") return null;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pickMeshes, false)[0];
    return (hit?.object.userData.workId as string | undefined) ?? null;
  };

  const pickHouseAtPointer = (): string | null => {
    if (!running || mutable.mode !== "walking" || !mutable.activeHouseId) return null;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(housePickMeshes, false)[0];
    const id = hit?.object.userData.houseId as string | undefined;
    return id === mutable.activeHouseId ? id : null;
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (!running) return;
    pointerDown = true;
    pointerMoved = false;
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    updatePointer(event);
    canvas.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!running) return;
    updatePointer(event);
    if (pointerDown) {
      const dx = event.clientX - pointerStartX;
      const dy = event.clientY - pointerStartY;
      if (Math.hypot(dx, dy) > 5) pointerMoved = true;
      if (mutable.mode === "sailing" || mutable.mode === "walking") {
        if (mutable.mode === "sailing") {
          boatCamYawOffset += dx * 0.0023;
          camYaw = boatYaw + boatCamYawOffset;
        } else {
          camYaw += dx * 0.0023;
        }
        camPitch = THREE.MathUtils.clamp(camPitch + dy * 0.0018, -0.35, 0.55);
        pointerStartX = event.clientX;
        pointerStartY = event.clientY;
      }
      return;
    }
    setHoveredWork(pickWorkAtPointer());
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (!running) return;
    updatePointer(event);
    if (mutable.mode === "cinematic") {
      const dx = event.clientX - pointerStartX;
      if (Math.abs(dx) > 42) {
        const next = THREE.MathUtils.clamp(mutable.cinematicStop + (dx < 0 ? 1 : -1), 0, 3);
        cinematicTarget = CINEMATIC_STOPS[next]!;
      }
    } else if (!pointerMoved && mutable.mode === "walking") {
      const houseId = pickHouseAtPointer();
      if (houseId) {
        events.onEnterHouse?.(houseId);
      } else {
        const id = pickWorkAtPointer();
        if (id) events.onSelectWork(id);
      }
    }
    pointerDown = false;
    canvas.releasePointerCapture?.(event.pointerId);
  };
  const onPointerLeave = (): void => {
    if (!pointerDown) setHoveredWork(null);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!running) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
    keys.add(event.code);
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
    if (event.code === "KeyE" || event.code === "Enter") interact();
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    if (!running) return;
    keys.delete(event.code);
  };

  const startVoyage = (): void => {
    if (quality.coarse) {
      mutable.mode = "cinematic";
      mutable.paused = false;
      cinematicTarget = CINEMATIC_STOPS[0];
    } else {
      mutable.mode = "sailing";
      mutable.paused = false;
    }
    emitState();
  };

  const dock = (): void => {
    mutable.mode = "walking";
    boatSpeed = 0;
    // The dock obstacle is r=4.0 and the skiff is r=0.9. This mooring is
    // exactly 5.1 units from its centre (0.2 clearance), so boarding cannot
    // trigger the collision resolver's former ~0.9-unit first-frame push.
    skiff.position.copy(MOORED_SKIFF_POINT);
    skiff.rotation.y = MOORED_SKIFF_YAW;
    boatYaw = MOORED_SKIFF_YAW;
    figure.root.visible = true;
    figure.root.position.copy(qaJourney ? new THREE.Vector3(-12.85, 0.72, -2.8) : WALK_SPAWN);
    figure.root.rotation.y = Math.PI;
    camYaw = figure.root.rotation.y;
    camPitch = 0;
    const skipper = skiffModel.runtime.nodes.skipper;
    if (skipper) skipper.visible = false;
    mutable.nearDock = true;
    mutable.activeWorkId = null;
    setActiveHouse(null);
    emitState();
  };

  const board = (): void => {
    mutable.mode = "sailing";
    figure.root.visible = false;
    // Carrying the walking camera's yaw across left the chase view 90 degrees
    // off the stern; the helm must always be framed from directly behind.
    boatCamYawOffset = CHASE_CAM_OFFSET;
    const skipper = skiffModel.runtime.nodes.skipper;
    if (skipper) skipper.visible = true;
    mutable.activeWorkId = null;
    setActiveHouse(null);
    mutable.nearDock = true;
    emitState();
  };

  function interact(): void {
    if (mutable.mode === "intro") {
      startVoyage();
      return;
    }
    if (mutable.mode === "sailing" && mutable.nearDock) {
      dock();
      return;
    }
    if (mutable.mode === "walking" && mutable.activeHouseId) {
      events.onEnterHouse?.(mutable.activeHouseId);
      return;
    }
    if (mutable.mode === "walking" && mutable.activeWorkId) {
      events.onSelectWork(mutable.activeWorkId);
      return;
    }
    if (mutable.mode === "walking" && mutable.nearDock) board();
  }

  const goToLandmark = (index: number): void => {
    const next = THREE.MathUtils.clamp(Math.round(index), 0, CINEMATIC_STOPS.length - 1);
    mutable.mode = "cinematic";
    mutable.paused = false;
    cinematicTarget = CINEMATIC_STOPS[next]!;
    mutable.cinematicStop = next;
    emitState();
  };

  const setPaused = (paused: boolean): void => {
    mutable.paused = paused;
    emitState();
  };

  const pause = (): void => {
    if (disposed || !running) return;
    running = false;
    keys.clear();
    pointerDown = false;
    window.cancelAnimationFrame(raf);
  };

  const resume = (): void => {
    if (disposed || running) return;
    running = true;
    lastFrame = performance.now();
    raf = window.requestAnimationFrame(frame);
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);
  window.addEventListener("keydown", onKeyDown, { passive: false });
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("resize", resize);
  resize();
  emitState();

  raf = window.requestAnimationFrame(frame);

  return {
    startVoyage,
    interact,
    autoDock() {
      if (mutable.mode === "sailing") autoDocking = true;
    },
    goToLandmark,
    setPaused,
    pause,
    resume,
    captureFrame(advance = 1.2) {
      const safeAdvance = Number.isFinite(advance) ? Math.max(0, advance) : 0;
      elapsed += safeAdvance * quality.motionScale;
      gameplayTime += safeAdvance;
      update(Math.min(0.05, safeAdvance), elapsed, gameplayTime);
      renderOnce();
      return renderer.domElement.toDataURL("image/png");
    },
    debugTick(deltaSeconds: number) {
      const delta = Number.isFinite(deltaSeconds)
        ? THREE.MathUtils.clamp(deltaSeconds, 0, 0.05)
        : 0;
      elapsed += delta * quality.motionScale;
      gameplayTime += delta;
      update(delta, elapsed, gameplayTime);
      renderer.render(scene, camera);
    },
    getDebugState() {
      const player = mutable.mode === "walking" ? figure.root.position : skiff.position;
      // Bow read off the rendered matrix rather than recomputed from boatYaw,
      // so a heading that disagrees with the hull on screen shows up here.
      const bow = new THREE.Vector3(0, 0, -1)
        .applyQuaternion(skiff.getWorldQuaternion(new THREE.Quaternion()))
        .setY(0)
        .normalize();
      return {
        mode: mutable.mode,
        playerPos: { x: player.x, y: player.y, z: player.z },
        camPos: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        bow: { x: bow.x, z: bow.z },
        boatYaw,
        camYaw,
        camPitch,
        nearDock: mutable.nearDock,
        activeWorkId: mutable.activeWorkId,
        speed: mutable.speed
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      running = false;
      window.cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", resize);
      setHoveredWork(null);
      scene.remove(houseCollection.group);
      houseCollection.dispose();

      const geometries = new Set<THREE.BufferGeometry>();
      const sceneMaterials = new Set<THREE.Material>();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        geometries.add(mesh.geometry);
        const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        source.forEach((material) => sceneMaterials.add(material));
      });
      geometries.forEach((geometry) => geometry.dispose());
      sceneMaterials.forEach((material) => material.dispose());
      textures.forEach((texture) => texture.dispose());
      waterTexture.dispose();
      renderer.dispose();
    }
  };
}
