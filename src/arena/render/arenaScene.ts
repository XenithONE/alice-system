import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { buildBrickGeo, U } from "../../portfolio/gl/brick/brickKit";
import { CELL, type ArenaDef, type BotSpec, type Catalog, type ChassisDef, type DriveDef, type PartDef, type SeatIndex } from "../sim/types";
import { INTERP_DELAY } from "../sim/balance";
import type { BotSnap, Snapshot } from "../net/protocol";

const MAX_SNAPSHOTS = 48;
const MAX_PARTICLES = 96;
const MAX_DEBRIS = 48;
const BOT_COLORS = [0xc91a09, 0x0055bf, 0x4b9f4a, 0xf2cd37] as const;

export interface ArenaQuality {
  pixelRatio?: number;
  shadows?: boolean;
  particles?: number;
  antialias?: boolean;
  /** QA-only renderer seam; production leaves this undefined. */
  rendererFactory?: (
    canvas: HTMLCanvasElement,
    parameters: THREE.WebGLRendererParameters
  ) => THREE.WebGLRenderer;
}

export interface ArenaScene {
  /** 開始時に一度。BotSpec からメッシュを組む */
  setup(specs: readonly (BotSpec | null)[], names: readonly string[], arena: ArenaDef, mySeat: SeatIndex): void;
  pushSnapshot(s: Snapshot): void;
  /** QA seam: このペインは document.hidden=true で rAF が発火しない。必須 */
  debugTick(dt: number): void;
  getDebugState(): {
    ready: boolean; botCount: number; meshCount: number;
    bots: { seat: number; x: number; y: number; z: number; hp: number; detached: number }[];
    camPos: [number, number, number];
    lastSnapshotTick: number;
  };
  captureFrame(): string;
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
  detached: boolean;
}

interface BotVisual {
  readonly seat: SeatIndex;
  readonly root: THREE.Group;
  readonly parts: PartVisual[];
  readonly wheelRoots: THREE.Object3D[];
  readonly wheelRadii: number[];
  readonly nameSprite: THREE.Sprite;
  hp: number;
  detach: number;
  lastX: number;
  lastZ: number;
  wheelPhase: number;
}

interface Particle {
  readonly mesh: THREE.Mesh;
  readonly velocity: THREE.Vector3;
  life: number;
}

interface Debris {
  readonly mesh: THREE.Mesh;
  readonly velocity: THREE.Vector3;
  readonly spin: THREE.Vector3;
  life: number;
}

function autoQuality(overrides: ArenaQuality): Required<Omit<ArenaQuality, "rendererFactory">> {
  const requested = new URLSearchParams(location.search).get("q");
  const weakDevice = (navigator.hardwareConcurrency || 4) <= 4 || (navigator as Navigator & { deviceMemory?: number }).deviceMemory !== undefined &&
    ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4;
  const low = requested === "low" || (requested !== "high" && weakDevice);
  return {
    pixelRatio: overrides.pixelRatio ?? Math.min(devicePixelRatio || 1, low ? 1.15 : 2),
    shadows: overrides.shadows ?? !low,
    particles: Math.max(0, Math.min(MAX_PARTICLES, overrides.particles ?? (low ? 36 : MAX_PARTICLES))),
    antialias: overrides.antialias ?? !low
  };
}

function dimensions(part: PartDef, rot: number): [number, number] {
  return rot % 2 === 1 ? [part.cells[1], part.cells[0]] : [part.cells[0], part.cells[1]];
}

function localPartPosition(chassis: ChassisDef, part: PartDef, cell: readonly [number, number], rot: number): [number, number] {
  const [w, d] = dimensions(part, rot);
  return [
    (cell[0] + w / 2 - chassis.deck[0] / 2) * CELL,
    (cell[1] + d / 2 - chassis.deck[1] / 2) * CELL
  ];
}

function metalMaterial(color: number, roughness = 0.55): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.42 });
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Sprite)) return;
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      if (material instanceof THREE.SpriteMaterial && material.map) material.map.dispose();
      material.dispose();
    });
  });
  root.clear();
}

function makeLabel(text: string, color: number): THREE.Sprite {
  const label = document.createElement("canvas");
  label.width = 512;
  label.height = 96;
  const context = label.getContext("2d")!;
  context.fillStyle = "rgba(7,9,10,.82)";
  context.fillRect(0, 8, label.width, 72);
  context.strokeStyle = `#${color.toString(16).padStart(6, "0")}`;
  context.lineWidth = 5;
  context.strokeRect(2.5, 10.5, label.width - 5, 67);
  context.fillStyle = "#f3eee3";
  context.font = "700 38px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text.slice(0, 22), label.width / 2, 45);
  const texture = new THREE.CanvasTexture(label);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(2.25, 0.42, 1);
  sprite.position.y = 1.25;
  return sprite;
}

function createPart(part: PartDef, rot: number, paint: number): { root: THREE.Group; wheel: THREE.Object3D | null } {
  const root = new THREE.Group();
  root.rotation.y = rot * Math.PI / 2;
  const [w, d] = dimensions(part, rot);
  const kind = part.category === "armor" ? "tile" : "plate";
  const bodyGeo = buildBrickGeo(w, d, kind, 8);
  bodyGeo.scale(CELL / U, Math.max(part.height, 0.03) / (U * 0.4), CELL / U);
  const body = new THREE.Mesh(bodyGeo, metalMaterial(part.category === "armor" ? paint : part.color));
  body.castShadow = true;
  body.receiveShadow = true;
  root.add(body);

  let wheel: THREE.Object3D | null = null;
  if (part.category === "drive") {
    if (part.kind === "track") {
      wheel = new THREE.Mesh(
        new RoundedBoxGeometry(Math.max(w * CELL * 0.82, 0.12), part.radius * 1.35, Math.max(d * CELL * 0.82, 0.16), 2, 0.018),
        metalMaterial(0x17191a, 0.8)
      );
    } else {
      wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(part.radius, part.radius, Math.max(Math.min(w, d) * CELL * 0.68, 0.08), 16),
        metalMaterial(0x17191a, 0.82)
      );
      wheel.rotation.z = Math.PI / 2;
    }
    wheel.position.y = Math.max(part.radius * 0.56, part.height * 0.5);
    root.add(wheel);
  } else if (part.category === "weapon" && part.motion === "spin") {
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(Math.max(Math.min(w * CELL, d * CELL) * 0.45, 0.11), Math.max(Math.min(w * CELL, d * CELL) * 0.45, 0.11), 0.034, 18),
      metalMaterial(0x9a9d9c, 0.28)
    );
    disc.name = "weapon";
    disc.position.y = part.height + 0.035;
    root.add(disc);
  }
  return { root, wheel };
}

function createBot(spec: BotSpec, name: string, seat: SeatIndex, catalog: Catalog): BotVisual | null {
  const chassis = catalog.byId.get(spec.chassisId);
  if (!chassis || chassis.category !== "chassis") return null;
  const root = new THREE.Group();
  const chassisGeo = new RoundedBoxGeometry(chassis.deck[0] * CELL, chassis.height, chassis.deck[1] * CELL, 3, 0.025);
  const chassisMesh = new THREE.Mesh(chassisGeo, metalMaterial(spec.paint, 0.46));
  chassisMesh.position.y = chassis.height * 0.5;
  chassisMesh.castShadow = true;
  chassisMesh.receiveShadow = true;
  root.add(chassisMesh);

  const bumperGeo = new THREE.BoxGeometry(chassis.deck[0] * CELL * 0.78, 0.035, 0.045);
  const bumper = new THREE.Mesh(bumperGeo, metalMaterial(BOT_COLORS[seat], 0.35));
  bumper.position.set(0, chassis.height * 0.55, chassis.deck[1] * CELL * 0.51);
  root.add(bumper);

  const parts: PartVisual[] = [];
  const wheelRoots: THREE.Object3D[] = [];
  const wheelRadii: number[] = [];
  spec.parts.forEach((placed, index) => {
    const part = catalog.byId.get(placed.partId);
    if (!part || part.category === "chassis") return;
    const created = createPart(part, placed.rot, spec.paint);
    const [x, z] = localPartPosition(chassis, part, placed.cell, placed.rot);
    created.root.position.set(x, chassis.height, z);
    root.add(created.root);
    const drive = part.category === "drive" ? part : null;
    parts.push({ index, root: created.root, drive, detached: false });
    if (created.wheel && drive) {
      wheelRoots.push(created.wheel);
      wheelRadii.push(drive.radius);
    }
  });
  const nameSprite = makeLabel(name || `BOT ${seat + 1}`, BOT_COLORS[seat]);
  root.add(nameSprite);
  return { seat, root, parts, wheelRoots, wheelRadii, nameSprite, hp: 0, detach: 0, lastX: 0, lastZ: 0, wheelPhase: 0 };
}

function lerpBot(a: BotSnap, b: BotSnap, alpha: number): BotSnap {
  const qa = new THREE.Quaternion(a.qx, a.qy, a.qz, a.qw);
  const qb = new THREE.Quaternion(b.qx, b.qy, b.qz, b.qw);
  qa.slerp(qb, alpha);
  return {
    seat: b.seat,
    alive: alpha < 0.5 ? a.alive : b.alive,
    hp: THREE.MathUtils.lerp(a.hp, b.hp, alpha),
    x: THREE.MathUtils.lerp(a.x, b.x, alpha),
    y: THREE.MathUtils.lerp(a.y, b.y, alpha),
    z: THREE.MathUtils.lerp(a.z, b.z, alpha),
    qx: qa.x, qy: qa.y, qz: qa.z, qw: qa.w,
    wa: THREE.MathUtils.lerp(a.wa, b.wa, alpha),
    wo: THREE.MathUtils.lerp(a.wo, b.wo, alpha),
    wp: a.wp !== 0 || b.wp !== 0 ? THREE.MathUtils.lerp(a.wp, b.wp, alpha) : 0,
    detach: alpha < 0.5 ? a.detach : b.detach
  };
}

export function createArenaScene(canvas: HTMLCanvasElement, catalog: Catalog, quality: ArenaQuality = {}): ArenaScene {
  const settings = autoQuality(quality);
  const rendererParameters: THREE.WebGLRendererParameters = {
    canvas,
    antialias: settings.antialias,
    alpha: false,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance"
  };
  const renderer = quality.rendererFactory?.(canvas, rendererParameters) ?? new THREE.WebGLRenderer(rendererParameters);
  renderer.setPixelRatio(settings.pixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = settings.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x07090a);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07090a);
  scene.fog = new THREE.FogExp2(0x07090a, 0.032);
  const camera = new THREE.PerspectiveCamera(43, 1, 0.06, 120);
  const arenaRoot = new THREE.Group();
  const botRoot = new THREE.Group();
  const vfxRoot = new THREE.Group();
  scene.add(arenaRoot, botRoot, vfxRoot);
  scene.add(new THREE.HemisphereLight(0x73818a, 0x160e09, 0.55));

  const spotPositions: [number, number, number][] = [[-6, 11, -5], [6, 11, -5], [-6, 11, 5], [6, 11, 5]];
  for (const [x, y, z] of spotPositions) {
    const spot = new THREE.SpotLight(0xffe6bf, 220, 30, Math.PI / 5, 0.55, 1.4);
    spot.position.set(x, y, z);
    spot.target.position.set(0, 0, 0);
    spot.castShadow = settings.shadows;
    if (settings.shadows) spot.shadow.mapSize.set(1024, 1024);
    scene.add(spot, spot.target);
  }

  const particles: Particle[] = [];
  const particleGeo = new THREE.BoxGeometry(0.035, 0.035, 0.12);
  const particleMat = new THREE.MeshBasicMaterial({ color: 0xffb12b, toneMapped: false });
  for (let index = 0; index < settings.particles; index += 1) {
    const mesh = new THREE.Mesh(particleGeo, particleMat);
    mesh.visible = false;
    vfxRoot.add(mesh);
    particles.push({ mesh, velocity: new THREE.Vector3(), life: 0 });
  }
  const debris: Debris[] = [];
  const debrisGeo = new RoundedBoxGeometry(0.14, 0.06, 0.1, 1, 0.012);
  const debrisMat = metalMaterial(0x6d7172, 0.62);
  for (let index = 0; index < MAX_DEBRIS; index += 1) {
    const mesh = new THREE.Mesh(debrisGeo, debrisMat);
    mesh.visible = false;
    mesh.castShadow = settings.shadows;
    vfxRoot.add(mesh);
    debris.push({ mesh, velocity: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 });
  }

  let arena: ArenaDef | null = null;
  let mySeat: SeatIndex = 0;
  let bots = new Map<number, BotVisual>();
  let snapshots: TimedSnapshot[] = [];
  let clock = 0;
  let frame = 0;
  let lastFrameTime = performance.now();
  let paused = false;
  let disposed = false;
  let ready = false;
  let cameraShake = 0;
  let koFocus: number | null = null;
  let lastSnapshotTick = -1;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function createArena(next: ArenaDef): void {
    disposeObject(arenaRoot);
    const floorMaterial = metalMaterial(0x34383a, 0.78);
    const plateSize = next.size / 8;
    for (let x = 0; x < 8; x += 1) {
      for (let z = 0; z < 8; z += 1) {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(plateSize - 0.035, 0.08, plateSize - 0.035), floorMaterial.clone());
        plate.position.set((x - 3.5) * plateSize, -0.06, (z - 3.5) * plateSize);
        plate.receiveShadow = true;
        arenaRoot.add(plate);
      }
    }
    const pitMat = new THREE.MeshStandardMaterial({ color: 0x020303, roughness: 1 });
    if (next.pit) {
      const pit = new THREE.Mesh(new THREE.CylinderGeometry(next.pit.r, next.pit.r, 0.18, 48), pitMat);
      pit.position.set(next.pit.x, -0.1, next.pit.z);
      arenaRoot.add(pit);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(next.pit.r, next.pit.r + 0.22, 48),
        new THREE.MeshStandardMaterial({ color: 0xe0a824, roughness: 0.65, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(next.pit.x, 0.006, next.pit.z);
      arenaRoot.add(ring);
    }
    for (const saw of next.saws) {
      const sawRoot = new THREE.Group();
      sawRoot.name = "arena-saw";
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(saw.r, saw.r, 0.1, 24),
        metalMaterial(0x8b8e8e, 0.28)
      );
      disc.rotation.x = Math.PI / 2;
      sawRoot.add(disc);
      for (let tooth = 0; tooth < 16; tooth += 1) {
        const angle = tooth / 16 * Math.PI * 2;
        const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.34, 3), metalMaterial(0xb3b4b1, 0.28));
        mesh.position.set(Math.cos(angle) * (saw.r + 0.07), 0, Math.sin(angle) * (saw.r + 0.07));
        mesh.rotation.set(0, -angle, Math.PI / 2);
        sawRoot.add(mesh);
      }
      sawRoot.position.set(saw.x, 0.03, saw.z);
      arenaRoot.add(sawRoot);
    }

    const half = next.size / 2;
    const wallMat = metalMaterial(0x454b4d, 0.7);
    const railGeoX = new THREE.BoxGeometry(next.size + 0.25, 0.16, 0.16);
    const railGeoZ = new THREE.BoxGeometry(0.16, 0.16, next.size + 0.25);
    for (const y of [0.12, next.wallHeight]) {
      for (const z of [-half, half]) {
        const rail = new THREE.Mesh(railGeoX, wallMat);
        rail.position.set(0, y, z);
        arenaRoot.add(rail);
      }
      for (const x of [-half, half]) {
        const rail = new THREE.Mesh(railGeoZ, wallMat);
        rail.position.set(x, y, 0);
        arenaRoot.add(rail);
      }
    }
    for (const side of [-1, 1]) {
      const gridA = new THREE.GridHelper(next.size, 32, 0x6b7172, 0x3f4648);
      gridA.rotation.z = Math.PI / 2;
      gridA.position.set(side * half, next.wallHeight / 2, 0);
      gridA.scale.y = next.wallHeight / next.size;
      arenaRoot.add(gridA);
      const gridB = new THREE.GridHelper(next.size, 32, 0x6b7172, 0x3f4648);
      gridB.rotation.x = Math.PI / 2;
      gridB.position.set(0, next.wallHeight / 2, side * half);
      gridB.scale.z = next.wallHeight / next.size;
      arenaRoot.add(gridB);
    }
    const stripeMaterialA = new THREE.MeshStandardMaterial({ color: 0xe2ad28, roughness: 0.7 });
    const stripeMaterialB = new THREE.MeshStandardMaterial({ color: 0x17191a, roughness: 0.8 });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (let stripe = 0; stripe < 7; stripe += 1) {
          const marker = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.025, 1.35), stripe % 2 ? stripeMaterialA : stripeMaterialB);
          marker.position.set(sx * (half - 0.72) + stripe * sx * 0.08, 0.012, sz * (half - 0.67));
          marker.rotation.y = sx * sz * 0.55;
          arenaRoot.add(marker);
        }
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
    let remaining = Math.min(Math.max(Math.round(power / 12), 5), 20);
    for (const particle of particles) {
      if (remaining <= 0) break;
      if (particle.life > 0) continue;
      const angle = (remaining * 2.399 + clock * 11) % (Math.PI * 2);
      const speed = 1.8 + (remaining % 5) * 0.42;
      particle.mesh.position.set(x, y, z);
      particle.mesh.rotation.set(angle, angle * 0.5, 0);
      particle.velocity.set(Math.cos(angle) * speed, 1.2 + (remaining % 4) * 0.5, Math.sin(angle) * speed);
      particle.life = 0.24 + (remaining % 3) * 0.09;
      particle.mesh.visible = true;
      remaining -= 1;
    }
  }

  function throwDebris(x: number, y: number, z: number, color = 0x777a7a): void {
    const item = debris.find((candidate) => candidate.life <= 0);
    if (!item) return;
    (item.mesh.material as THREE.MeshStandardMaterial).color.setHex(color);
    item.mesh.position.set(x, y, z);
    const seed = ((lastSnapshotTick + 1) * 31 + debris.indexOf(item) * 17) % 97;
    item.velocity.set(((seed % 9) - 4) * 0.32, 1.4 + (seed % 6) * 0.18, (((seed * 3) % 9) - 4) * 0.32);
    item.spin.set(2 + seed % 5, 3 + seed % 7, 1 + seed % 3);
    item.life = 3.5;
    item.mesh.visible = true;
  }

  function processEvents(snapshot: Snapshot): void {
    for (const event of snapshot.events) {
      if (event.t === "hit") {
        spark(event.x, event.y, event.z, event.power);
        cameraShake = Math.min(0.22, cameraShake + event.power * 0.0008);
      } else if (event.t === "detach") {
        spark(event.x, event.y, event.z, 120);
        throwDebris(event.x, event.y, event.z, BOT_COLORS[event.seat]);
      } else if (event.t === "hazard") {
        spark(event.x, event.y, event.z, 75);
      } else if (event.t === "ko") {
        koFocus = event.seat;
        renderer.toneMappingExposure = 0.74;
      }
    }
  }

  function sampledBots(): BotSnap[] {
    if (snapshots.length === 0) return [];
    const target = clock - INTERP_DELAY;
    let older = snapshots[0]!;
    let newer = snapshots[snapshots.length - 1]!;
    for (let index = 0; index < snapshots.length; index += 1) {
      const candidate = snapshots[index]!;
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

  function applyBots(nextBots: readonly BotSnap[], dt: number): void {
    for (const snap of nextBots) {
      const visual = bots.get(snap.seat);
      if (!visual) continue;
      const dx = snap.x - visual.lastX;
      const dz = snap.z - visual.lastZ;
      visual.root.position.set(snap.x, snap.y, snap.z);
      visual.root.quaternion.set(snap.qx, snap.qy, snap.qz, snap.qw).normalize();
      visual.root.visible = true;
      visual.hp = snap.hp;
      visual.detach = snap.detach;
      visual.nameSprite.material.opacity = snap.alive ? 1 : 0.38;
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(visual.root.quaternion);
      const forwardDistance = dx * forward.x + dz * forward.z;
      if (snap.wp !== 0) {
        visual.wheelPhase = snap.wp;
      } else if (dt > 0) {
        const radius = visual.wheelRadii[0] ?? 0.12;
        visual.wheelPhase += forwardDistance / Math.max(radius, 0.03);
      }
      visual.wheelRoots.forEach((wheel) => {
        wheel.rotation.x = visual.wheelPhase;
      });
      visual.root.traverse((object) => {
        if (object.name === "weapon") object.rotation.y = snap.wa;
      });
      for (const part of visual.parts) {
        const detached = (snap.detach & 2 ** part.index) !== 0;
        if (detached && !part.detached) {
          const point = new THREE.Vector3();
          part.root.getWorldPosition(point);
          throwDebris(point.x, point.y, point.z, BOT_COLORS[visual.seat]);
        }
        part.detached = detached;
        part.root.visible = !detached;
      }
      visual.lastX = snap.x;
      visual.lastZ = snap.z;
    }
  }

  function updateVfx(dt: number): void {
    for (const particle of particles) {
      if (particle.life <= 0) continue;
      particle.life -= dt;
      particle.velocity.y -= 8.5 * dt;
      particle.mesh.position.addScaledVector(particle.velocity, dt);
      particle.mesh.scale.setScalar(Math.max(particle.life * 2.5, 0.1));
      if (particle.life <= 0) particle.mesh.visible = false;
    }
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

  function updateCamera(nextBots: readonly BotSnap[], dt: number): void {
    if (nextBots.length === 0) return;
    const alive = nextBots.filter((bot) => bot.alive);
    const focusSeat = koFocus !== null
      ? (alive.length === 1 ? alive[0]!.seat : koFocus)
      : mySeat;
    const focus = nextBots.find((bot) => bot.seat === focusSeat) ?? alive[0] ?? nextBots[0]!;
    const center = new THREE.Vector3();
    const framing = alive.length > 0 ? alive : nextBots;
    for (const bot of framing) center.add(new THREE.Vector3(bot.x, bot.y, bot.z));
    center.multiplyScalar(1 / framing.length);
    let spread = 3.8;
    for (const bot of framing) spread = Math.max(spread, Math.hypot(bot.x - center.x, bot.z - center.z));
    const focusQuat = new THREE.Quaternion(focus.qx, focus.qy, focus.qz, focus.qw);
    const back = new THREE.Vector3(0, 0, -1).applyQuaternion(focusQuat);
    back.y = 0;
    back.normalize();
    const target = new THREE.Vector3(focus.x, Math.max(focus.y, 0) + 0.45, focus.z).lerp(center.setY(0.35), 0.32);
    const desired = target.clone().addScaledVector(back, 5.8 + spread * 0.65);
    desired.y += 3.1 + spread * 0.34;
    const ease = 1 - Math.exp(-Math.max(dt, 0) * 4.6);
    camera.position.lerp(desired, ease);
    if (!reducedMotion && cameraShake > 0.001) {
      camera.position.x += Math.sin(clock * 77) * cameraShake;
      camera.position.y += Math.cos(clock * 91) * cameraShake * 0.45;
      cameraShake *= Math.exp(-dt * 12);
    } else {
      cameraShake = 0;
    }
    camera.lookAt(target);
  }

  function renderTick(dt: number): void {
    if (disposed || paused) return;
    const safeDt = THREE.MathUtils.clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    clock += safeDt;
    const nextBots = sampledBots();
    applyBots(nextBots, safeDt);
    updateVfx(safeDt);
    for (const saw of arenaRoot.children) {
      if (saw.name === "arena-saw") saw.rotation.y += safeDt * 7;
    }
    updateCamera(nextBots, safeDt);
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
      snapshots = [];
      clock = 0;
      lastSnapshotTick = -1;
      koFocus = null;
      renderer.toneMappingExposure = 1.05;
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
    },
    debugTick(dt) {
      renderTick(dt);
    },
    getDebugState() {
      let meshCount = 0;
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Sprite) meshCount += 1;
      });
      return {
        ready,
        botCount: bots.size,
        meshCount,
        bots: [...bots.values()].map((bot) => ({
          seat: bot.seat,
          x: bot.root.position.x,
          y: bot.root.position.y,
          z: bot.root.position.z,
          hp: bot.hp,
          detached: bot.detach
        })),
        camPos: [camera.position.x, camera.position.y, camera.position.z],
        lastSnapshotTick
      };
    },
    captureFrame() {
      renderer.render(scene, camera);
      return canvas.toDataURL("image/png");
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
      particles.forEach((particle) => vfxRoot.remove(particle.mesh));
      debris.forEach((item) => vfxRoot.remove(item.mesh));
      particleGeo.dispose();
      particleMat.dispose();
      debrisGeo.dispose();
      debrisMat.dispose();
      renderer.dispose();
      scene.clear();
      snapshots = [];
      bots.clear();
      arena = null;
    }
  };
}
