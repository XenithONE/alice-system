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

export interface BattleEventVisual {
  readonly type: string;
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  readonly seat?: number;
  readonly target?: number;
  readonly power?: number;
  readonly color?: number;
}

export interface BattleSnapshotVisual {
  readonly tick: number;
  readonly elapsed: number;
  readonly phase: string;
  readonly bots: readonly BattleBotVisualState[];
  readonly events?: readonly BattleEventVisual[];
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

function makeArena(arena: BattleArenaVisual): THREE.Group {
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
  scene.fog = new THREE.FogExp2(0x020405, 0.028);
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
      });
    }
  }

  function setupArena(next: BattleArenaVisual): void {
    disposeTree(arenaRoot);
    arena = next;
    arenaRoot.add(makeArena(next));
    renderer.shadowMap.needsUpdate = true;
  }

  function burst(event: BattleEventVisual): void {
    const count = lowPower ? 7 : Math.min(24, 8 + Math.round((event.power ?? 1) * 2));
    const color =
      event.color ??
      seatPresentation[event.seat ?? -1]?.color ??
      PLAYER_COLORS[(event.seat ?? 0) % PLAYER_COLORS.length]!;
    for (let index = 0; index < count; index += 1) {
      if (sparks.length >= sparkCapacity) sparks.shift();
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 4;
      const velocity = new THREE.Vector3(
        Math.cos(angle) * speed,
        1.2 + Math.random() * 3,
        Math.sin(angle) * speed
      );
      const life = 0.35 + Math.random() * 0.45;
      sparks.push({
        position: new THREE.Vector3(event.x ?? 0, event.y ?? 0.2, event.z ?? 0),
        velocity,
        color: new THREE.Color(color),
        life,
        maxLife: life
      });
    }
  }

  function processEvents(events: readonly BattleEventVisual[]): void {
    for (const event of events) {
      if (
        event.type === "impact" ||
        event.type === "skill" ||
        event.type === "ringout" ||
        event.type === "destroy"
      ) {
        burst(event);
      }
    }
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
      disposeTree(arenaRoot);
      fxRoot.clear();
      botRoot.clear();
      environment.dispose();
      renderer.dispose();
      scene.clear();
    }
  };
}
