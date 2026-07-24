import * as THREE from "three";
import type { HeroQuality } from "../../quality";
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
  activeLandmark: HarborLandmark;
  speed: number;
  cinematicStop: number;
  paused: boolean;
}

export interface HarborSceneEvents {
  onState(state: HarborSceneState): void;
  onHoverWork(id: string | null): void;
  onSelectWork(id: string): void;
}

export interface HarborScene {
  dispose(): void;
  captureFrame(advance?: number): string;
  startVoyage(): void;
  interact(): void;
  goToLandmark(index: number): void;
  setPaused(paused: boolean): void;
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
  activeLandmark: HarborLandmark;
  speed: number;
  cinematicStop: number;
  paused: boolean;
}

const DOCK_POINT = new THREE.Vector3(-2.75, 0.55, 5.05);
const WALK_SPAWN = new THREE.Vector3(-8.2, 0.72, 0.85);
const CINEMATIC_STOPS = [0.13, 0.34, 0.61, 0.86] as const;

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
  castle.scale.setScalar(1.55);
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
  skiff.position.copy(qaJourney ? DOCK_POINT.clone().add(new THREE.Vector3(0.55, 0, 0.8)) : new THREE.Vector3(0.3, 0.55, 17.5));
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
  const portals: PortalRuntime[] = [];
  const pickMeshes: THREE.Mesh[] = [];
  for (let i = 0; i < works.length; i += 1) {
    const work = works[i]!;
    const texture = textureLoader.load(
      work.cover,
      () => renderOnce(),
      undefined,
      () => renderOnce()
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(6, renderer.capabilities.getMaxAnisotropy());
    textures.push(texture);
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
  let orbitYaw = 0;
  let orbitPitch = 0;
  let pointerDown = false;
  let pointerMoved = false;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let hoveredWorkId: string | null = null;
  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const keys = new Set<string>();
  let running = true;
  let raf = 0;
  let lastFrame = 0;
  let elapsed = 0;

  const emitState = (): void => {
    const publicState: HarborSceneState = {
      mode: mutable.mode,
      nearDock: mutable.nearDock,
      activeWorkId: mutable.activeWorkId,
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

  const updateSailing = (delta: number, time: number): void => {
    const throttle = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
    const steering = (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0) - (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0);
    boatSpeed = approach(boatSpeed, throttle > 0 ? 6.2 : throttle < 0 ? -2.4 : 0, throttle === 0 ? 2.4 : 3.2, delta);
    boatYaw += steering * delta * (0.65 + Math.min(1, Math.abs(boatSpeed) / 4) * 0.75);
    const forward = new THREE.Vector3(Math.sin(boatYaw), 0, -Math.cos(boatYaw));
    skiff.position.addScaledVector(forward, boatSpeed * delta);
    skiff.position.x = THREE.MathUtils.clamp(skiff.position.x, -4.8, 12.8);
    skiff.position.z = THREE.MathUtils.clamp(skiff.position.z, -8.5, 23);
    skiff.rotation.y = boatYaw;
    updateBoatBob(time, Math.min(1, 0.35 + Math.abs(boatSpeed) * 0.12));
    const rudder = skiffModel.runtime.nodes.rudder;
    const wheel = skiffModel.runtime.nodes["steering-wheel"];
    if (rudder) rudder.rotation.y = THREE.MathUtils.damp(rudder.rotation.y, steering * 0.48, 7, delta);
    if (wheel) wheel.rotation.z = THREE.MathUtils.damp(wheel.rotation.z, -steering * 0.82, 8, delta);
    wake.visible = Math.abs(boatSpeed) > 0.3;
    wake.scale.z = THREE.MathUtils.damp(wake.scale.z, 0.7 + Math.abs(boatSpeed) * 0.15, 6, delta);
    const wakeMesh = wake.children[0] as THREE.Mesh | undefined;
    const wakeMaterial = wakeMesh?.material as THREE.MeshBasicMaterial | undefined;
    if (wakeMaterial) wakeMaterial.opacity = 0.2 + Math.abs(boatSpeed) * 0.045;

    const distanceToDock = skiff.position.distanceTo(DOCK_POINT);
    mutable.nearDock = distanceToDock < 4.25 && Math.abs(boatSpeed) < 2.35;
    mutable.speed = Math.round(Math.abs(boatSpeed) * 10) / 10;

    const localOffset = new THREE.Vector3(
      Math.sin(orbitYaw) * 3.6,
      5.4 + orbitPitch * 3.2,
      12.4 + Math.cos(orbitYaw) * 1.1
    ).applyAxisAngle(new THREE.Vector3(0, 1, 0), boatYaw);
    const desiredCamera = skiff.position.clone().add(localOffset);
    dampVector(camera.position, desiredCamera, 5.4, delta);
    const lookTarget = skiff.position
      .clone()
      .add(new THREE.Vector3(0, 1.55, -3.15).applyAxisAngle(new THREE.Vector3(0, 1, 0), boatYaw));
    camera.lookAt(lookTarget);
  };

  const walkablePosition = (candidate: THREE.Vector3): THREE.Vector3 => {
    candidate.x = THREE.MathUtils.clamp(candidate.x, -14.15, -7.65);
    candidate.z = THREE.MathUtils.clamp(candidate.z, -36.4, 1.6);
    candidate.y = 0.72;
    return candidate;
  };

  const updateWalking = (delta: number, time: number): void => {
    const xInput = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    const zInput = (keys.has("KeyS") ? 1 : 0) - (keys.has("KeyW") ? 1 : 0);
    const direction = new THREE.Vector3(xInput, 0, zInput);
    const moving = direction.lengthSq() > 0.01;
    const run = keys.has("ShiftLeft") || keys.has("ShiftRight");
    const moveSpeed = run ? 6.2 : 3.6;
    if (moving) {
      direction.normalize();
      const candidate = figure.root.position.clone().addScaledVector(direction, moveSpeed * delta);
      figure.root.position.copy(walkablePosition(candidate));
      const targetYaw = Math.atan2(direction.x, direction.z);
      figure.root.rotation.y = THREE.MathUtils.damp(figure.root.rotation.y, targetYaw, 12, delta);
    }
    const stride = moving ? Math.sin(time * (run ? 12 : 8)) * (run ? 0.76 : 0.52) : 0;
    figure.leftArm.rotation.x = THREE.MathUtils.damp(figure.leftArm.rotation.x, -stride, 12, delta);
    figure.rightArm.rotation.x = THREE.MathUtils.damp(figure.rightArm.rotation.x, stride, 12, delta);
    figure.leftLeg.rotation.x = THREE.MathUtils.damp(figure.leftLeg.rotation.x, stride, 12, delta);
    figure.rightLeg.rotation.x = THREE.MathUtils.damp(figure.rightLeg.rotation.x, -stride, 12, delta);
    figure.head.rotation.y = Math.sin(time * 0.58) * 0.08;

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
    mutable.nearDock = figure.root.position.distanceTo(WALK_SPAWN) < 2.15;
    mutable.speed = moving ? moveSpeed : 0;

    const facing = new THREE.Vector3(Math.sin(figure.root.rotation.y), 0, Math.cos(figure.root.rotation.y));
    const side = new THREE.Vector3(facing.z, 0, -facing.x);
    const desiredCamera = figure.root.position
      .clone()
      .addScaledVector(facing, -6.2)
      .addScaledVector(side, orbitYaw * 2.6)
      .add(new THREE.Vector3(0, 3.9 + orbitPitch * 2.1, 0));
    dampVector(camera.position, desiredCamera, 7.2, delta);
    camera.lookAt(figure.root.position.x, figure.root.position.y + 1.35, figure.root.position.z);
    updateBoatBob(time, 0.55);
  };

  const updateIntro = (delta: number, time: number): void => {
    updateBoatBob(time, 0.75);
    skiff.rotation.y = 0;
    const desired = new THREE.Vector3(1.8, 8.6, 33.5);
    dampVector(camera.position, desired, 3.5, delta);
    camera.lookAt(-2.5, 3.4, -9.8);
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
    boatYaw = Math.atan2(tangent.x, -tangent.z);
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

  const update = (delta: number, time: number): void => {
    if (skiffReview) {
      skiff.position.y = 0.05 + Math.sin(time * 0.65) * 0.025 * quality.motionScale;
      skiff.rotation.y = Math.sin(time * 0.32) * 0.035 * quality.motionScale;
      camera.lookAt(0, 2.6, 0);
      emitState();
      return;
    }
    updateWater(time);
    if (mutable.mode === "intro") updateIntro(delta, time);
    if (mutable.mode === "sailing") updateSailing(delta, time);
    if (mutable.mode === "walking") updateWalking(delta, time);
    if (mutable.mode === "cinematic") updateCinematic(delta, time);
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
    elapsed += delta;
    update(delta, elapsed);
    renderOnce();
  };

  const updatePointer = (event: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
  };

  const pickWorkAtPointer = (): string | null => {
    if (mutable.mode !== "walking") return null;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pickMeshes, false)[0];
    return (hit?.object.userData.workId as string | undefined) ?? null;
  };

  const onPointerDown = (event: PointerEvent): void => {
    pointerDown = true;
    pointerMoved = false;
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    updatePointer(event);
    canvas.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent): void => {
    updatePointer(event);
    if (pointerDown) {
      const dx = event.clientX - pointerStartX;
      const dy = event.clientY - pointerStartY;
      if (Math.hypot(dx, dy) > 5) pointerMoved = true;
      if (mutable.mode === "sailing" || mutable.mode === "walking") {
        orbitYaw = THREE.MathUtils.clamp(orbitYaw - dx * 0.0023, -0.85, 0.85);
        orbitPitch = THREE.MathUtils.clamp(orbitPitch + dy * 0.0018, -0.4, 0.45);
        pointerStartX = event.clientX;
        pointerStartY = event.clientY;
      }
      return;
    }
    setHoveredWork(pickWorkAtPointer());
  };
  const onPointerUp = (event: PointerEvent): void => {
    updatePointer(event);
    if (mutable.mode === "cinematic") {
      const dx = event.clientX - pointerStartX;
      if (Math.abs(dx) > 42) {
        const next = THREE.MathUtils.clamp(mutable.cinematicStop + (dx < 0 ? 1 : -1), 0, 3);
        cinematicTarget = CINEMATIC_STOPS[next]!;
      }
    } else if (!pointerMoved && mutable.mode === "walking") {
      const id = pickWorkAtPointer();
      if (id) events.onSelectWork(id);
    }
    pointerDown = false;
    canvas.releasePointerCapture?.(event.pointerId);
  };
  const onPointerLeave = (): void => {
    if (!pointerDown) setHoveredWork(null);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
    keys.add(event.code);
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
    if (event.code === "KeyE" || event.code === "Enter") interact();
  };
  const onKeyUp = (event: KeyboardEvent): void => {
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
    skiff.position.copy(DOCK_POINT);
    skiff.rotation.y = Math.PI / 2;
    boatYaw = Math.PI / 2;
    figure.root.visible = true;
    figure.root.position.copy(qaJourney ? new THREE.Vector3(-12.85, 0.72, -2.8) : WALK_SPAWN);
    figure.root.rotation.y = Math.PI;
    const skipper = skiffModel.runtime.nodes.skipper;
    if (skipper) skipper.visible = false;
    mutable.nearDock = true;
    mutable.activeWorkId = null;
    emitState();
  };

  const board = (): void => {
    mutable.mode = "sailing";
    figure.root.visible = false;
    const skipper = skiffModel.runtime.nodes.skipper;
    if (skipper) skipper.visible = true;
    mutable.activeWorkId = null;
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

  if (quality.motionScale === 0) {
    update(0, 1.2);
    renderOnce();
  } else {
    raf = window.requestAnimationFrame(frame);
  }

  return {
    startVoyage,
    interact,
    goToLandmark,
    setPaused,
    captureFrame(advance = 1.2) {
      elapsed += advance;
      update(Math.min(0.05, advance), elapsed);
      renderOnce();
      return renderer.domElement.toDataURL("image/png");
    },
    dispose() {
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
