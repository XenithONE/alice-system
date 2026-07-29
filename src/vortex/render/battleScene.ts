import * as THREE from "three";
import { configureRenderer, installStudioEnvironment } from "../../arena/render/renderEnv";
import {
  createTopVisual,
  disposeTopVisual,
  type TopVisualSpec
} from "./topFactory";
import {
  applyCrowdBattleLod,
  createBattleStackDecoration,
  resolveBattlePresentation,
  type BattlePresentation,
  type BattleSeatPresentation,
} from "./battlePresentation";
import {
  FX_FAMILY_SPECS,
  fxFamilyForSkill,
  type FxFamily
} from "../content/fxFamily";
import type { SimEvent } from "../sim/types";
import { assertNever } from "../assertNever";

export type { BattlePresentation } from "./battlePresentation";

export interface BattleArenaVisual {
  readonly id: string;
  readonly radius: number;
  readonly lipHeight: number;
  /** Normalized radius (0..1), height in metres. */
  readonly profile: readonly (readonly [number, number])[];
  readonly waveAmplitude?: number;
  readonly waveCount?: number;
  readonly colors?: readonly [number, number, number];
}

export interface BattleBotVisualState {
  readonly seat: number;
  readonly alive: boolean;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly qx: number;
  readonly qy: number;
  readonly qz: number;
  readonly qw: number;
  readonly hp: number;
  readonly spin: number;
}

/*
 * Events arrive as the simulator's own union. There used to be a second,
 * looser shape here — `type: string` with everything optional — and an adapter
 * in App.tsx translating between the two. One fact written twice: the adapter
 * faithfully produced "shockwave" and "sudden-death" that nothing downstream
 * matched, so a shockwave and every sudden-death stage happened in silence,
 * and `skillId` was dropped on the floor even though the protocol carries and
 * validates it.
 *
 * Taking SimEvent directly also puts effects where the top is *drawn* rather
 * than where the last snapshot said it was: positions are resolved here, from
 * the interpolated visual, instead of from raw snapshot coordinates.
 */
export interface BattleSnapshotVisual {
  readonly tick: number;
  readonly elapsed: number;
  readonly phase: string;
  readonly bots: readonly BattleBotVisualState[];
  readonly events?: readonly SimEvent[];
}

export interface VortexBattleScene {
  setup(
    builds: readonly TopVisualSpec[],
    names: readonly string[],
    arena: BattleArenaVisual,
    mySeat: number,
    presentation?: BattlePresentation,
  ): void;
  pushSnapshot(snapshot: BattleSnapshotVisual): void;
  setPaused(paused: boolean): void;
  debugTick(dt: number): void;
  captureFrame(): string;
  getDebugState(): {
    ready: boolean;
    bots: number;
    lastTick: number;
    render: { calls: number; triangles: number };
    memory: { geometries: number; textures: number };
    presentation: {
      crowdLod: boolean;
      allies: number;
      enemies: number;
      wave: number;
      stackDecorations: number;
    };
    /* Named scene parts. The battle canvas cannot be screenshotted from the
       harness, so "is the arcade actually built" has to be answerable in
       text — otherwise it is only ever assumed. */
    arena: readonly string[];
    /* Live cue counts. "The shockwave draws now" is otherwise unprovable
       without a screenshot, and this canvas cannot be screenshotted here. */
    fx: { rings: number; shells: number; sparks: number };
  };
  dispose(): void;
}

interface BotVisual {
  readonly root: THREE.Group;
  readonly trail: THREE.Line;
  readonly trailPositions: THREE.Vector3[];
  target: BattleBotVisualState | null;
  previous: BattleBotVisualState | null;
  blend: number;
  readonly presentation: BattleSeatPresentation;
  /* Render-only kick on being hit. The simulation's position is authoritative;
     this is added on top of it and decays, so the top flinches without the
     host and the client ever disagreeing about where it is. */
  readonly recoil: THREE.Vector3;
  recoilLife: number;
}

interface Spark {
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly color: THREE.Color;
  life: number;
  maxLife: number;
}

const PLAYER_COLORS = [0x62ddff, 0xffb448, 0xff5bd7, 0x6effb2] as const;


function profileHeight(profile: BattleArenaVisual["profile"], normalizedRadius: number): number {
  if (profile.length === 0) return 0;
  const r = THREE.MathUtils.clamp(normalizedRadius, 0, 1);
  if (r <= profile[0]![0]) return profile[0]![1];
  for (let index = 1; index < profile.length; index += 1) {
    const previous = profile[index - 1]!;
    const next = profile[index]!;
    if (r <= next[0]) {
      const span = Math.max(1e-6, next[0] - previous[0]);
      const t = THREE.MathUtils.clamp((r - previous[0]) / span, 0, 1);
      const smooth = t * t * (3 - 2 * t);
      return THREE.MathUtils.lerp(previous[1], next[1], smooth);
    }
  }
  return profile[profile.length - 1]![1];
}

export function sampleBattleArenaHeight(
  arena: BattleArenaVisual,
  normalizedRadius: number,
  angle = 0
): number {
  const radius = THREE.MathUtils.clamp(normalizedRadius, 0, 1);
  const base = profileHeight(arena.profile, radius);
  const profileEdge = arena.profile[arena.profile.length - 1]?.[0] ?? 1;
  const waveRadius = THREE.MathUtils.clamp(
    radius / Math.max(1e-6, profileEdge),
    0,
    1
  );
  const wave =
    (arena.waveAmplitude ?? 0) *
    Math.sin(angle * (arena.waveCount ?? 0)) *
    Math.sin(Math.PI * waveRadius) ** 2;
  return base + wave;
}

function ringGeometry(arena: BattleArenaVisual): THREE.BufferGeometry {
  const radial = 36;
  const angular = 128;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let ri = 0; ri <= radial; ri += 1) {
    const rn = ri / radial;
    const radius = rn * arena.radius;
    for (let ai = 0; ai <= angular; ai += 1) {
      const angle = (ai / angular) * Math.PI * 2;
      positions.push(
        Math.cos(angle) * radius,
        sampleBattleArenaHeight(arena, rn, angle),
        Math.sin(angle) * radius
      );
      uvs.push(ai / angular, rn);
      normals.push(0, 1, 0);
    }
  }
  const row = angular + 1;
  for (let ri = 0; ri < radial; ri += 1) {
    for (let ai = 0; ai < angular; ai += 1) {
      const a = ri * row + ai;
      const b = a + row;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}


/**
 * The arcade: a colonnade of arches standing around the circle.
 *
 * "アーチ状になった円" — the floor is already a curved circle (rings.ts is a
 * radius-to-height profile), so what was missing is the architecture around
 * it. This is decoration only: it never touches the profile, so the physics
 * mesh and the render mesh stay the same surface, which ringSurfaceSelftest
 * holds to 2.8e-16.
 *
 * Three draw calls at most — piers, arches, entablature — because every
 * column being its own mesh is how a 121-call scene becomes a 160-call one.
 */
export function makeArcade(arena: BattleArenaVisual, lite: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = "arena-arcade";
  const bays = lite ? 12 : 18;
  const standRadius = arena.radius + 0.92;
  const base = profileHeight(arena.profile, 1) + arena.lipHeight;
  const pierHeight = Math.max(1.1, arena.radius * 0.22);
  const pierRadius = 0.15;

  const stone = new THREE.MeshStandardMaterial({
    color: 0x1b262c,
    metalness: 0.68,
    roughness: 0.42,
    envMapIntensity: 0.8
  });

  const pierGeo = new THREE.CylinderGeometry(pierRadius * 0.86, pierRadius, pierHeight, 8);
  const piers = new THREE.InstancedMesh(pierGeo, stone, bays);
  const slot = new THREE.Object3D();
  for (let index = 0; index < bays; index += 1) {
    const angle = (index / bays) * Math.PI * 2;
    slot.position.set(
      Math.cos(angle) * standRadius,
      base + pierHeight / 2,
      Math.sin(angle) * standRadius
    );
    slot.rotation.set(0, -angle, 0);
    slot.scale.set(1, 1, 1);
    slot.updateMatrix();
    piers.setMatrixAt(index, slot.matrix);
  }
  piers.castShadow = false;
  piers.name = "arcade-piers";
  group.add(piers);

  if (!lite) {
    /*
     * Each arch is a half torus standing in the vertical plane through two
     * neighbouring piers. Its major radius is half the chord between them, so
     * the springing lands on the pier tops rather than near them — an arch
     * that misses its own columns is the tell that this was faked.
     */
    const chord = 2 * standRadius * Math.sin(Math.PI / bays);
    const archGeo = new THREE.TorusGeometry(chord / 2, pierRadius * 0.78, 6, 14, Math.PI);
    const arches = new THREE.InstancedMesh(archGeo, stone, bays);
    const basis = new THREE.Matrix4();
    const along = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const normal = new THREE.Vector3();
    const centre = new THREE.Vector3();
    for (let index = 0; index < bays; index += 1) {
      const a = ((index + 0) / bays) * Math.PI * 2;
      const b = ((index + 1) / bays) * Math.PI * 2;
      const pa = new THREE.Vector3(Math.cos(a) * standRadius, 0, Math.sin(a) * standRadius);
      const pb = new THREE.Vector3(Math.cos(b) * standRadius, 0, Math.sin(b) * standRadius);
      along.copy(pb).sub(pa).normalize();
      normal.crossVectors(along, up).normalize();
      centre.copy(pa).add(pb).multiplyScalar(0.5).setY(base + pierHeight);
      basis.makeBasis(along, up, normal);
      basis.setPosition(centre);
      arches.setMatrixAt(index, basis);
    }
    arches.name = "arcade-arches";
    group.add(arches);

    const crown = new THREE.Mesh(
      new THREE.TorusGeometry(standRadius, 0.13, 6, 96),
      new THREE.MeshStandardMaterial({
        color: 0x2b3a42,
        metalness: 0.8,
        roughness: 0.3
      })
    );
    crown.rotation.x = Math.PI / 2;
    crown.position.y = base + pierHeight + chord / 2;
    crown.name = "arcade-crown";
    group.add(crown);
  }
  return group;
}

function makeArena(arena: BattleArenaVisual, arcadeLite: boolean): THREE.Group {
  const root = new THREE.Group();
  root.name = `arena:${arena.id}`;
  const [deep, mid, glowColor] = arena.colors ?? [0x070c10, 0x1c2d34, 0x62ddff];
  const floor = new THREE.Mesh(
    ringGeometry(arena),
    new THREE.MeshStandardMaterial({
      color: mid,
      metalness: 0.76,
      roughness: 0.36,
      envMapIntensity: 0.85
    })
  );
  floor.receiveShadow = true;
  root.add(floor);
  const under = new THREE.Mesh(
    new THREE.CylinderGeometry(arena.radius * 1.025, arena.radius * 0.8, 1.1, 128),
    new THREE.MeshStandardMaterial({ color: deep, metalness: 0.7, roughness: 0.52 })
  );
  under.position.y = -0.65;
  root.add(under);
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(
      arena.radius + 0.1,
      arena.radius + 0.1,
      Math.max(0.28, arena.lipHeight),
      128,
      1,
      true
    ),
    new THREE.MeshStandardMaterial({
      color: 0x26343a,
      metalness: 0.82,
      roughness: 0.27,
      side: THREE.DoubleSide
    })
  );
  wall.position.y = profileHeight(arena.profile, 1) + arena.lipHeight * 0.5;
  root.add(wall);
  const lip = new THREE.Mesh(
    new THREE.TorusGeometry(arena.radius + 0.1, 0.11, 10, 128),
    new THREE.MeshStandardMaterial({
      color: glowColor,
      emissive: glowColor,
      emissiveIntensity: 1.3,
      metalness: 0.55,
      roughness: 0.25
    })
  );
  lip.rotation.x = Math.PI / 2;
  lip.position.y = profileHeight(arena.profile, 1) + arena.lipHeight;
  root.add(lip);
  for (const fraction of [0.25, 0.48, 0.72]) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(arena.radius * fraction, 0.014, 4, 128),
      new THREE.MeshBasicMaterial({
        color: glowColor,
        transparent: true,
        opacity: 0.18 + fraction * 0.13,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = profileHeight(arena.profile, fraction) + 0.018;
    root.add(ring);
  }
  const outer = new THREE.Mesh(
    new THREE.RingGeometry(arena.radius + 0.22, arena.radius + 4.2, 128),
    new THREE.MeshStandardMaterial({ color: 0x030607, roughness: 0.9, metalness: 0.5 })
  );
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.45;
  root.add(outer);
  root.add(makeArcade(arena, arcadeLite));
  return root;
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Sprite)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      if (material instanceof THREE.SpriteMaterial) material.map?.dispose();
      material.dispose();
    });
  });
  root.clear();
}

function makeNameLabel(name: string, color: number): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext("2d")!;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = "700 36px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.shadowColor = "#000";
  context.shadowBlur = 8;
  context.fillStyle = "#fff";
  context.fillText(name.slice(0, 18), 256, 45);
  context.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
  context.fillRect(190, 76, 132, 3);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
  );
  sprite.scale.set(2.2, 0.41, 1);
  sprite.position.y = 1.25;
  return sprite;
}

export function createVortexBattleScene(canvas: HTMLCanvasElement): VortexBattleScene {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const lowPower = matchMedia("(max-width: 700px)").matches || devicePixelRatio > 2.5;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !lowPower,
    alpha: false,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance"
  });
  configureRenderer(renderer, {
    shadows: !lowPower,
    pixelRatio: Math.min(devicePixelRatio, lowPower ? 1.25 : 1.8),
    exposure: 1.06
  });
  renderer.setClearColor(0x020405, 1);
  const scene = new THREE.Scene();
  const baseFogDensity = 0.028;
  scene.fog = new THREE.FogExp2(0x020405, baseFogDensity);
  const environment = installStudioEnvironment(renderer, scene, 0.58);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 100);
  const arenaRoot = new THREE.Group();
  const botRoot = new THREE.Group();
  const fxRoot = new THREE.Group();
  scene.add(arenaRoot, botRoot, fxRoot);
  scene.add(new THREE.HemisphereLight(0x9eddf0, 0x120b09, 1.05));
  const sun = new THREE.DirectionalLight(0xf4faff, 2.2);
  sun.position.set(-6, 12, 7);
  sun.castShadow = !lowPower;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -9;
  sun.shadow.camera.right = 9;
  sun.shadow.camera.top = 9;
  sun.shadow.camera.bottom = -9;
  scene.add(sun);
  const cyan = new THREE.PointLight(0x4edaff, 20, 18, 2);
  cyan.position.set(5, 3, -5);
  const amber = new THREE.PointLight(0xff9c43, 16, 16, 2);
  amber.position.set(-5, 2, 4);
  scene.add(cyan, amber);

  const bots = new Map<number, BotVisual>();
  const sparks: Spark[] = [];
  const sparkCapacity = lowPower ? 48 : 128;
  const sparkGeometry = new THREE.IcosahedronGeometry(0.035, 0);
  const sparkMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.86,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexColors: true
  });
  const sparkInstances = new THREE.InstancedMesh(
    sparkGeometry,
    sparkMaterial,
    sparkCapacity
  );
  sparkInstances.name = "impact-spark-pool";
  sparkInstances.count = 0;
  sparkInstances.frustumCulled = false;
  sparkInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  fxRoot.add(sparkInstances);
  const sparkTransform = new THREE.Object3D();

  /*
   * Layer one: the silhouette that has to be readable in a third of a second.
   *
   * Two pools, not eight. A flat annulus scaled on the floor plane covers
   * everything that means "an area" (shock ring, orbit arc, anchor ripple,
   * repair pulse); a sphere scaled on one axis covers everything that means
   * "a body or a line" (shield dome, spin flare, lance streak, siphon thread).
   * Eight bespoke meshes would have been eight more draw calls, and the budget
   * for this whole update is five.
   */
  interface Cue {
    readonly kind: "ring" | "shell";
    readonly position: THREE.Vector3;
    /** Unit vector the shell is stretched along; unused by rings. */
    readonly axis: THREE.Vector3;
    readonly color: THREE.Color;
    readonly from: number;
    readonly to: number;
    readonly stretch: number;
    life: number;
    readonly maxLife: number;
  }
  const cues: Cue[] = [];
  const cueCapacity = lowPower ? 8 : 20;
  const ringGeo = new THREE.RingGeometry(0.82, 1, 40, 1).rotateX(-Math.PI / 2);
  const shellGeo = new THREE.IcosahedronGeometry(1, 2);
  const cueMaterial = (opacity: number): THREE.MeshBasicMaterial =>
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexColors: true
    });
  const ringInstances = new THREE.InstancedMesh(ringGeo, cueMaterial(0.9), cueCapacity);
  const shellInstances = new THREE.InstancedMesh(shellGeo, cueMaterial(0.34), cueCapacity);
  for (const pool of [ringInstances, shellInstances]) {
    pool.count = 0;
    pool.frustumCulled = false;
    pool.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    fxRoot.add(pool);
  }
  ringInstances.name = "fx-ring-pool";
  shellInstances.name = "fx-shell-pool";
  const cueTransform = new THREE.Object3D();
  let arena: BattleArenaVisual = {
    id: "fallback",
    radius: 6.5,
    lipHeight: 0.35,
    profile: [[0, -0.9], [0.6, -0.5], [1, 0]]
  };
  let mySeat = 0;
  let ready = false;
  let paused = false;
  let frame = 0;
  let disposed = false;
  let clock = 0;
  let lastTick = -1;
  /* Presentation-only. None of these are read by the simulation: shaking the
     camera or punching the FOV must never be able to change a result. */
  let shake = 0;
  let fovPunch = 0;
  let suddenDeathStage = 0;
  const scratchColor = new THREE.Color();
  const baseFov = 42;
  let cameraYaw = 0.35;
  let cameraTarget = new THREE.Vector3();
  const cameraLook = new THREE.Vector3();
  let crowdLod = false;
  let seatPresentation: readonly BattleSeatPresentation[] = [];

  function setupBots(
    builds: readonly TopVisualSpec[],
    names: readonly string[],
    presentation?: BattlePresentation,
  ): void {
    for (const visual of bots.values()) {
      disposeTopVisual(visual.root);
      fxRoot.remove(visual.trail);
      disposeTree(visual.trail);
    }
    bots.clear();
    botRoot.clear();
    crowdLod = builds.length >= 5;
    seatPresentation = resolveBattlePresentation(builds.length, presentation);
    const useShadows = !lowPower && !crowdLod;
    renderer.shadowMap.enabled = useShadows;
    sun.castShadow = useShadows;
    renderer.shadowMap.needsUpdate = true;
    for (let seat = 0; seat < builds.length; seat += 1) {
      const seatPlan = seatPresentation[seat]!;
      const color = seatPlan.color;
      const root = createTopVisual(builds[seat]!, {
        quality: lowPower || crowdLod ? "low" : "battle",
        playerColor: color
      });
      if (crowdLod) applyCrowdBattleLod(root);
      if (seatPlan.extraStacks > 0) {
        root.add(createBattleStackDecoration(seatPlan));
      }
      root.scale.setScalar(0.56);
      root.add(makeNameLabel(names[seat] ?? `UNIT ${seat + 1}`, color));
      root.visible = false;
      botRoot.add(root);
      const trailGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(),
        new THREE.Vector3()
      ]);
      const trail = new THREE.Line(
        trailGeometry,
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0.44,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      );
      fxRoot.add(trail);
      bots.set(seat, {
        root,
        trail,
        trailPositions: [],
        target: null,
        previous: null,
        blend: 1,
        presentation: seatPlan,
        recoil: new THREE.Vector3(),
        recoilLife: 0,
      });
    }
  }

  function setupArena(next: BattleArenaVisual): void {
    disposeTree(arenaRoot);
    arena = next;
    // crowdLod is not known until setup(); a rebuild happens there anyway.
    arenaRoot.add(makeArena(next, lowPower || crowdLod));
    renderer.shadowMap.needsUpdate = true;
  }

  const seatColor = (seat: number): number =>
    seatPresentation[seat]?.color ?? PLAYER_COLORS[seat % PLAYER_COLORS.length]!;

  /** Where the top is *drawn* this frame, not where the last snapshot put it. */
  function seatPosition(seat: number, out = new THREE.Vector3()): THREE.Vector3 {
    const visual = bots.get(seat);
    if (visual) return out.copy(visual.root.position);
    return out.set(0, 0.2, 0);
  }

  function spawnCue(
    kind: Cue["kind"],
    position: THREE.Vector3,
    color: number,
    from: number,
    to: number,
    life: number,
    axis = new THREE.Vector3(0, 1, 0),
    stretch = 1
  ): void {
    if (cues.length >= cueCapacity) cues.shift();
    cues.push({
      kind,
      position: position.clone(),
      axis: axis.clone().normalize(),
      color: new THREE.Color(color),
      from,
      to,
      stretch,
      life,
      maxLife: life
    });
  }

  /**
   * Layer two. `shape` constrains the velocity so the particles agree with the
   * silhouette — a ring that sprays a sphere of sparks reads as an explosion,
   * not as an area.
   */
  function burstAt(
    position: THREE.Vector3,
    color: number,
    count: number,
    shape: "sphere" | "disc" | "cone" | "up",
    direction = new THREE.Vector3(0, 1, 0)
  ): void {
    const budget = lowPower ? Math.max(3, Math.round(count / 2)) : count;
    for (let index = 0; index < budget; index += 1) {
      if (sparks.length >= sparkCapacity) sparks.shift();
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 4;
      let velocity: THREE.Vector3;
      if (shape === "disc") {
        velocity = new THREE.Vector3(Math.cos(angle) * speed, 0.25, Math.sin(angle) * speed);
      } else if (shape === "cone") {
        velocity = direction
          .clone()
          .multiplyScalar(speed * 1.4)
          .add(
            new THREE.Vector3(
              (Math.random() - 0.5) * 1.2,
              (Math.random() - 0.5) * 1.2,
              (Math.random() - 0.5) * 1.2
            )
          );
      } else if (shape === "up") {
        velocity = new THREE.Vector3(
          Math.cos(angle) * speed * 0.35,
          2 + Math.random() * 2.5,
          Math.sin(angle) * speed * 0.35
        );
      } else {
        velocity = new THREE.Vector3(
          Math.cos(angle) * speed,
          1.2 + Math.random() * 3,
          Math.sin(angle) * speed
        );
      }
      const life = 0.35 + Math.random() * 0.45;
      sparks.push({
        position: position.clone(),
        velocity,
        color: new THREE.Color(color),
        life,
        maxLife: life
      });
    }
  }

  /** One silhouette per family — see content/fxFamily.ts for why these eight. */
  function playSkillCue(family: FxFamily, seat: number, target: number | null): void {
    const spec = FX_FAMILY_SPECS[family];
    const at = seatPosition(seat);
    const tint = spec.color;
    switch (family) {
      case "shockring":
        spawnCue("ring", at, tint, 0.4, 3.2, spec.duration);
        burstAt(at, tint, spec.sparks, "disc");
        return;
      case "orbit": {
        spawnCue("ring", at, tint, 1.5, 0.7, spec.duration);
        burstAt(at, tint, spec.sparks, "disc");
        return;
      }
      case "anchor":
        spawnCue("ring", at, tint, 1.6, 0.5, spec.duration);
        spawnCue("shell", at, tint, 0.9, 0.2, spec.duration, new THREE.Vector3(0, 1, 0), 2.6);
        burstAt(at, tint, spec.sparks, "disc");
        return;
      case "reboot":
        spawnCue("ring", at, tint, 0.3, 1.7, spec.duration);
        burstAt(at, tint, spec.sparks, "up");
        return;
      case "aegis":
        spawnCue("shell", at, tint, 0.3, 1.15, spec.duration);
        burstAt(at, tint, spec.sparks, "sphere");
        return;
      case "overclock":
        spawnCue("shell", at, tint, 0.5, 0.75, spec.duration, new THREE.Vector3(0, 1, 0), 3.4);
        burstAt(at, tint, spec.sparks, "up");
        return;
      case "lance":
      case "siphon": {
        // Both draw a line between two tops; the direction is what differs.
        const other = target === null ? null : seatPosition(target, new THREE.Vector3());
        const axis = other ? other.clone().sub(at) : new THREE.Vector3(0, 1, 0);
        const length = Math.max(0.6, axis.length());
        const mid = other ? at.clone().add(other).multiplyScalar(0.5) : at;
        spawnCue("shell", mid, tint, 0.16, 0.1, spec.duration, axis, length * 5.2);
        burstAt(
          family === "lance" ? (other ?? at) : at,
          tint,
          spec.sparks,
          "cone",
          axis.clone().normalize().multiplyScalar(family === "lance" ? 1 : -1)
        );
        return;
      }
    }
  }

  /*
   * Simultaneous events are ranked, not queued. Four buffs landing on the same
   * frame as a knockout used to be four identical bursts and the knockout was
   * one of them; now the frame keeps the loudest few and drops the rest, so
   * what survives is what mattered.
   */
  const FRAME_CUE_BUDGET = 4;

  function processEvents(events: readonly SimEvent[]): void {
    const ranked = events
      .map((event) => {
        if (event.type === "skill") {
          const family = fxFamilyForSkill(event.skillId);
          return { event, family, priority: family ? FX_FAMILY_SPECS[family].priority : 1 };
        }
        const priority = event.type === "knockout" ? 9 : event.type === "sudden-death" ? 8 : 5;
        return { event, family: null as FxFamily | null, priority };
      })
      .sort((a, b) => b.priority - a.priority);

    let spent = 0;
    for (const { event, family } of ranked) {
      switch (event.type) {
        case "impact": {
          const at = new THREE.Vector3(event.point[0], event.point[1], event.point[2]);
          const power = Math.min(8, Math.max(1, event.impulse * 0.4));
          burstAt(at, 0xffffff, Math.min(24, 8 + Math.round(power * 2)), "sphere");
          shake = Math.min(0.5, shake + power * 0.028);
          fovPunch = Math.min(3.4, fovPunch + power * 0.34);
          // The impact mark is a ring too - a third pool would be a third draw call.
          spawnCue("ring", at, 0xffffff, 0.25, 1.1, 0.3);
          const victim = bots.get(event.victim);
          if (victim) {
            victim.recoil
              .copy(at)
              .sub(victim.root.position)
              .setY(0)
              .normalize()
              .multiplyScalar(-Math.min(0.045, 0.012 * power));
            victim.recoilLife = 0.08;
          }
          break;
        }
        case "skill": {
          if (spent >= FRAME_CUE_BUDGET) break;
          spent += 1;
          playSkillCue(family ?? "overclock", event.seat, null);
          break;
        }
        case "shockwave": {
          // Was translated and then silently dropped: it matched none of the
          // four names the renderer used to test for.
          const at = seatPosition(event.seat);
          const tint = seatColor(event.seat);
          spawnCue("ring", at, tint, 0.3, Math.max(0.8, event.radius), 0.55);
          burstAt(at, tint, lowPower ? 6 : 14, "disc");
          shake = Math.min(0.5, shake + 0.12);
          break;
        }
        case "knockout": {
          const at = seatPosition(event.seat);
          const tint = seatColor(event.seat);
          if (event.reason === "ring-out") {
            const outward = at.clone().setY(0).normalize();
            spawnCue("shell", at, tint, 0.3, 0.12, 0.75, outward, 7);
            burstAt(at, tint, lowPower ? 8 : 22, "cone", outward);
          } else {
            spawnCue("ring", at, tint, 0.2, 3.6, 0.7);
            burstAt(at, tint, lowPower ? 10 : 28, "sphere");
          }
          shake = Math.min(0.6, shake + 0.34);
          fovPunch = Math.min(4, fovPunch + 2.4);
          break;
        }
        case "sudden-death": {
          // A rule change, so it is announced by the arena rather than by a top.
          suddenDeathStage = Math.max(suddenDeathStage, event.stage);
          shake = Math.min(0.5, shake + 0.2);
          break;
        }
        default:
          /*
           * Adding a variant to SimEvent without drawing it is now a build
           * error, not a silence. That is the whole bug this replaced: the
           * renderer tested for four names by hand, two of which the simulator
           * never emitted, while shockwave and sudden-death went unhandled for
           * as long as they have existed.
           */
          assertNever(event);
      }
    }
  }

  function updateCues(dt: number): void {
    for (let index = cues.length - 1; index >= 0; index -= 1) {
      const cue = cues[index]!;
      cue.life -= dt;
      if (cue.life <= 0) cues.splice(index, 1);
    }
    let rings = 0;
    let shells = 0;
    for (const cue of cues) {
      const t = 1 - Math.max(0, cue.life) / cue.maxLife;
      const eased = 1 - (1 - t) * (1 - t);
      const scale = cue.from + (cue.to - cue.from) * eased;
      const fade = 1 - t;
      cueTransform.position.copy(cue.position);
      cueTransform.quaternion.identity();
      if (cue.kind === "ring") {
        cueTransform.position.y += 0.06;
        cueTransform.scale.set(scale, scale, scale);
      } else {
        cueTransform.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), cue.axis);
        cueTransform.scale.set(scale, scale * cue.stretch, scale);
      }
      cueTransform.updateMatrix();
      const pool = cue.kind === "ring" ? ringInstances : shellInstances;
      const slot = cue.kind === "ring" ? rings++ : shells++;
      pool.setMatrixAt(slot, cueTransform.matrix);
      pool.setColorAt(slot, scratchColor.copy(cue.color).multiplyScalar(fade));
    }
    ringInstances.count = rings;
    shellInstances.count = shells;
    ringInstances.instanceMatrix.needsUpdate = true;
    shellInstances.instanceMatrix.needsUpdate = true;
    if (ringInstances.instanceColor) ringInstances.instanceColor.needsUpdate = true;
    if (shellInstances.instanceColor) shellInstances.instanceColor.needsUpdate = true;
  }

  function updateBots(dt: number): void {
    const follow = 1 - Math.exp(-dt * 18);
    for (const visual of bots.values()) {
      const state = visual.target;
      if (!state) continue;
      visual.root.visible = state.alive;
      visual.blend = Math.min(1, visual.blend + dt * 12);
      const previous = visual.previous ?? state;
      const t = THREE.MathUtils.smoothstep(visual.blend, 0, 1);
      visual.root.position.set(
        THREE.MathUtils.lerp(previous.x, state.x, t),
        THREE.MathUtils.lerp(previous.y, state.y, t),
        THREE.MathUtils.lerp(previous.z, state.z, t)
      );
      if (visual.recoilLife > 0) {
        visual.recoilLife = Math.max(0, visual.recoilLife - dt);
        // Added on top of the interpolated position and gone in 80ms. The
        // simulation never sees it, so it cannot desync anything.
        visual.root.position.addScaledVector(visual.recoil, visual.recoilLife / 0.08);
      }
      const from = new THREE.Quaternion(previous.qx, previous.qy, previous.qz, previous.qw);
      const to = new THREE.Quaternion(state.qx, state.qy, state.qz, state.qw);
      visual.root.quaternion.slerpQuaternions(from, to, t);
      const spinGlow = THREE.MathUtils.clamp(state.spin / 100, 0.2, 1.5);
      visual.root.children.forEach((child) => {
        if (child.name === "energy-aura") {
          child.scale.lerp(new THREE.Vector3(spinGlow, 1, spinGlow), follow);
        } else if (child.name === "roguelike-stack-augmentation") {
          child.rotation.y +=
            dt *
            (0.16 +
              Math.min(0.4, visual.presentation.wave * 0.008) +
              visual.presentation.extraStacks * 0.006);
        }
      });
      if (state.alive) {
        const latest = visual.root.position.clone();
        latest.y += 0.04;
        if (
          visual.trailPositions.length === 0 ||
          latest.distanceToSquared(visual.trailPositions[visual.trailPositions.length - 1]!) > 0.012
        ) {
          visual.trailPositions.push(latest);
          if (visual.trailPositions.length > (lowPower ? 18 : 34)) visual.trailPositions.shift();
          visual.trail.geometry.dispose();
          visual.trail.geometry = new THREE.BufferGeometry().setFromPoints(visual.trailPositions);
        }
      }
    }
  }

  function updateSparks(dt: number): void {
    for (let index = sparks.length - 1; index >= 0; index -= 1) {
      const spark = sparks[index]!;
      spark.life -= dt;
      spark.velocity.y -= 8 * dt;
      spark.position.addScaledVector(spark.velocity, dt);
      if (spark.life <= 0) {
        sparks.splice(index, 1);
      }
    }
    sparkInstances.count = sparks.length;
    for (let index = 0; index < sparks.length; index += 1) {
      const spark = sparks[index]!;
      const life = THREE.MathUtils.clamp(spark.life / spark.maxLife, 0, 1);
      sparkTransform.position.copy(spark.position);
      sparkTransform.rotation.set(
        spark.life * 8 + index * 0.37,
        index * 0.61,
        spark.life * 5
      );
      sparkTransform.scale.setScalar(0.3 + life * 0.9);
      sparkTransform.updateMatrix();
      sparkInstances.setMatrixAt(index, sparkTransform.matrix);
      sparkInstances.setColorAt(index, spark.color);
    }
    sparkInstances.instanceMatrix.needsUpdate = true;
    if (sparkInstances.instanceColor) sparkInstances.instanceColor.needsUpdate = true;
  }

  function updateCamera(dt: number): void {
    const alive = [...bots.values()].filter((bot) => bot.root.visible);
    if (alive.length > 0) {
      const center = new THREE.Vector3();
      for (const bot of alive) center.add(bot.root.position);
      center.multiplyScalar(1 / alive.length);
      cameraTarget.lerp(center, 1 - Math.exp(-dt * 2.8));
    }
    cameraYaw += dt * (reducedMotion ? 0 : 0.035);
    // A portrait viewport has a very narrow horizontal field of view. Pull
    // back and raise the camera proportionally so all four fighters and the
    // full ring remain readable instead of being cropped at both sides.
    const portraitPressure = THREE.MathUtils.clamp(
      1 / Math.max(0.45, camera.aspect),
      1,
      2.25
    );
    const pullback = 1 + (portraitPressure - 1) * 1.25;
    const densityPullback = crowdLod ? 1.07 : 1;
    const radius = arena.radius * (lowPower ? 1.58 : 1.42) * pullback * densityPullback;
    const height =
      arena.radius * (1.05 + (portraitPressure - 1) * 1.5);
    const desired = new THREE.Vector3(
      Math.sin(cameraYaw) * radius,
      height,
      Math.cos(cameraYaw) * radius
    ).addScaledVector(cameraTarget, 0.18);
    camera.position.lerp(desired, 1 - Math.exp(-dt * 2.2));
    cameraLook.lerp(cameraTarget, 1 - Math.exp(-dt * 4));
    camera.lookAt(cameraLook);
    if (scene.fog instanceof THREE.FogExp2) {
      /* Sudden death closes the room in. A camera tremor alone was too quiet
         for a rule change — this is the one cue that has to reach a player who
         was looking at the HUD when it happened. */
      const target = baseFogDensity * (1 + suddenDeathStage * 0.5);
      scene.fog.density += (target - scene.fog.density) * (1 - Math.exp(-dt * 1.6));
    }
    if (shake > 0.0005 || fovPunch > 0.005) {
      shake = Math.max(0, shake - dt * 2.4);
      fovPunch = Math.max(0, fovPunch - dt * 14);
      // Sudden death runs hotter: the same hit reads as more dangerous.
      const gain = 1 + suddenDeathStage * 0.25;
      camera.position.x += (Math.random() - 0.5) * shake * gain;
      camera.position.y += (Math.random() - 0.5) * shake * gain * 0.6;
      camera.position.z += (Math.random() - 0.5) * shake * gain;
      camera.fov = baseFov + fovPunch;
      camera.updateProjectionMatrix();
    } else if (camera.fov !== baseFov) {
      camera.fov = baseFov;
      camera.updateProjectionMatrix();
    }
  }

  function resize(): void {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function render(dt: number): void {
    if (!paused) clock += dt;
    updateBots(paused ? 0 : dt);
    updateSparks(paused ? 0 : dt);
    updateCues(paused ? 0 : dt);
    updateCamera(paused ? 0 : dt);
    cyan.intensity = 17 + Math.sin(clock * 1.4) * 3;
    amber.intensity = 13 + Math.sin(clock * 1.1 + 1) * 3;
    renderer.render(scene, camera);
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  let last = performance.now();
  function loop(now: number): void {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    render(dt);
    if (!disposed) frame = requestAnimationFrame(loop);
  }
  resize();
  frame = requestAnimationFrame(loop);

  return {
    setup(builds, names, nextArena, nextMySeat, presentation) {
      mySeat = nextMySeat;
      setupArena(nextArena);
      setupBots(builds, names, presentation);
      lastTick = -1;
      ready = true;
      cameraYaw = (mySeat / Math.max(1, builds.length)) * Math.PI * 2 + Math.PI;
    },
    pushSnapshot(snapshot) {
      if (snapshot.tick <= lastTick) return;
      lastTick = snapshot.tick;
      for (const state of snapshot.bots) {
        const visual = bots.get(state.seat);
        if (!visual) continue;
        visual.previous = visual.target ?? state;
        visual.target = state;
        visual.blend = 0;
      }
      processEvents(snapshot.events ?? []);
    },
    setPaused(next) {
      paused = next;
    },
    debugTick(dt) {
      render(Math.min(0.1, Math.max(0, dt)));
    },
    captureFrame() {
      render(0);
      return canvas.toDataURL("image/png");
    },
    getDebugState() {
      return {
        ready,
        bots: bots.size,
        lastTick,
        render: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles },
        memory: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures },
        presentation: {
          crowdLod,
          allies: seatPresentation.filter((seat) => seat.team === "ally").length,
          enemies: seatPresentation.filter((seat) => seat.team === "enemy").length,
          wave: seatPresentation[0]?.wave ?? 0,
          stackDecorations: seatPresentation.reduce(
            (total, seat) => total + Math.min(12, seat.extraStacks),
            0,
          ),
        },
        // arenaRoot holds one group per arena; the parts are inside it.
        fx: {
          rings: ringInstances.count,
          shells: shellInstances.count,
          sparks: sparks.length,
        },
        arena: arenaRoot.children.flatMap((group) =>
          group.children.flatMap((child) =>
            child.name === "arena-arcade"
              ? child.children.map((part) => part.name)
              : child.name
                ? [child.name]
                : [],
          ),
        ),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      for (const visual of bots.values()) {
        disposeTopVisual(visual.root);
        disposeTree(visual.trail);
      }
      sparks.length = 0;
      sparkGeometry.dispose();
      sparkMaterial.dispose();
      ringGeo.dispose();
      shellGeo.dispose();
      (ringInstances.material as THREE.Material).dispose();
      (shellInstances.material as THREE.Material).dispose();
      ringInstances.dispose();
      shellInstances.dispose();
      cues.length = 0;
      disposeTree(arenaRoot);
      fxRoot.clear();
      botRoot.clear();
      environment.dispose();
      renderer.dispose();
      scene.clear();
    }
  };
}
