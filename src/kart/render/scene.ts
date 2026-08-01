/**
 * The renderer.
 *
 * It consumes a `RaceState` and nothing else, so the host's live simulation
 * and a guest's interpolated snapshot go down the identical path — a rendering
 * bug can only be in one place, and the wire gate exercises the guest half on
 * every run.
 *
 * `advance()` and `getDebugState()` are the QA seam. The Browser pane runs with
 * `document.hidden === true`, where `requestAnimationFrame` never fires, so
 * without an explicit step-and-read pair no 3D scene on this site can be
 * verified at all (HARBOR WORLD learned that the hard way).
 */

import * as THREE from "three";
import { BASE_TOP_SPEED, SHOULDER_WIDTH } from "../sim/balance";
import { forwardOf, querySurface, rightOf, type Track } from "../sim/track";
import type { RaceEvent, RaceState, RacerState } from "../sim/types";
import { machineById } from "../content/machines";
import { createFxSystem, type FxSystem } from "./fx";
import { createKartVisual, disposeSharedKartGeometry, type KartVisual } from "./kartModel";
import {
  BOOST_FLAME_COLORS,
  DRIFT_TIER_COLORS,
  liveryOf,
} from "./palette";
import { cueForEvent, type CueContext } from "../audio/cues";
import type { NitroAudio } from "../audio/engine";
import { createClouds, type CloudLayer } from "./clouds";
import { createGrandstands, type Grandstands } from "./grandstand";
import { createPostStack, type PostStack } from "./post";
import { createRain, type RainLayer } from "./rain";
import { createSkidMarks, type SkidMarks } from "./skidmarks";
import { resolveWeatherLook } from "./weather";
import {
  buildSetPieces,
  type SetPieceBundle,
  type SetPieceContext,
} from "./setpieces";
import type { KartQuality } from "./quality";
import { buildTrackMesh, type TrackMeshBundle } from "./trackMesh";
import { CSM } from "three/addons/csm/CSM.js";

/** three installs this no-op on every Material; it is not a real hook. */
const DEFAULT_ON_BEFORE_COMPILE = THREE.Material.prototype.onBeforeCompile;

export interface KartSceneOptions {
  readonly canvas: HTMLCanvasElement;
  readonly track: Track;
  readonly quality: KartQuality;
  readonly weather?: import("../sim/balance").WeatherKind;
  /** Optional: cues are dispatched at the same point as the visual FX. */
  readonly audio?: NitroAudio;
  /**
   * Capture/benchmark escape hatch (`?shed=off`). The QA seam feeds the fps
   * window SIMULATED dt, so fast-stepping reads as 7 fps on any hardware and
   * sheds bloom out of every screenshot.
   */
  readonly disableShed?: boolean;
}

export interface KartSceneDebug {
  readonly frames: number;
  readonly cameraPosition: readonly [number, number, number];
  /** Camera forward taken from the world matrix, not recomputed from yaw. */
  readonly cameraForward: readonly [number, number, number];
  readonly focusSeat: number;
  readonly visibleKarts: number;
  readonly particles: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly quality: string;
  /** Features the degrade ladder has removed this session. */
  readonly shed: readonly string[];
  readonly fps: number;
  /** World position of the TT ghost kart, when one is visible. */
  readonly ghost: { x: number; y: number; z: number } | null;
}

export interface KartScene {
  /** Step the presentation and draw one frame. */
  advance(
    dt: number,
    view: RaceState | null,
    events: readonly RaceEvent[],
    focusSeat: number,
    lookBack: boolean,
  ): void;
  resize(width: number, height: number): void;
  /** Time-trial ghost pose; null hides it. */
  setGhostPose(pose: { x: number; y: number; z: number; yaw: number; slip: number } | null): void;
  getDebugState(): KartSceneDebug;
  /** Debug seam: meshes taller than 5 m whose bounds sit over the road. */
  probeCorridor(maxHeight?: number): unknown[];
  dispose(): void;
}

const SKY_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 uLow;
  uniform vec3 uHigh;
  uniform vec3 uSun;
  uniform vec3 uSunDir;
  uniform float uStars;
  varying vec3 vWorld;

  float hash21(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }

  void main() {
    vec3 dir = normalize(vWorld);
    float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 sky = mix(uLow, uHigh, pow(h, 0.75));
    float sun = max(0.0, dot(dir, normalize(uSunDir)));
    sky += uSun * pow(sun, 340.0) * 2.4;
    sky += uSun * pow(sun, 6.0) * 0.16;
    // Hash starfield: a point INSIDE each lit cell, not the lit cell itself.
    // Lighting whole cells turned the night sky into drifting paper scraps —
    // each cell is over a degree across, and bloom finished the job.
    if (uStars > 0.001 && dir.y > 0.05) {
      vec3 g = dir * 46.0;
      vec3 cell3 = floor(g);
      float star = hash21(cell3.xy + cell3.z * 61.7);
      float threshold = 1.0 - uStars * 0.05;
      if (star > threshold) {
        vec3 offset = vec3(
          hash21(cell3.xy + cell3.z * 13.1),
          hash21(cell3.yz + cell3.x * 7.7),
          hash21(cell3.zx + cell3.y * 3.3)
        );
        float d = length(fract(g) - offset);
        float spark = smoothstep(0.32, 0.03, d);
        float mag = (star - threshold) / max(1e-4, 1.0 - threshold);
        sky += vec3(0.85, 0.92, 1.0) * spark * (0.3 + mag * 0.9)
             * smoothstep(0.1, 0.35, dir.y);
      }
    }
    gl_FragColor = vec4(sky, 1.0);
  }
`;

function tempVector(): THREE.Vector3 {
  return new THREE.Vector3();
}

export function createKartScene(options: KartSceneOptions): KartScene {
  const { canvas, track, quality, audio } = options;
  const look = resolveWeatherLook(track.spec.theme, options.weather ?? "clear");
  const theme = look.theme;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !quality.postProcessing,
    powerPreference: "high-performance",
    stencil: false,
  });
  renderer.setPixelRatio(quality.dpr);
  /*
   * `info` resets itself at the start of every `render()`. EffectComposer calls
   * render() once per pass, so the counters end the frame describing the final
   * full-screen blit — one draw call, one triangle, for a scene with hundreds
   * of both. Taking the reset by hand makes the numbers describe the scene.
   */
  renderer.info.autoReset = false;
  /*
   * Per-circuit tone mapping. ACES is what the game shipped with and what the
   * first three circuits were graded against; AgX keeps saturated colour from
   * shifting hue as it clips, which is worth having on the neon skyline and
   * the red dirt and is worth nothing on the coast. AgX is slightly darker at
   * the top end, so it takes a little more exposure to sit where ACES did.
   */
  const TONEMAP = {
    aces: THREE.ACESFilmicToneMapping,
    agx: THREE.AgXToneMapping,
    neutral: THREE.NeutralToneMapping,
  } as const;
  const tonemap = track.spec.theme.tonemap ?? "aces";
  renderer.toneMapping = TONEMAP[tonemap];
  renderer.toneMappingExposure = tonemap === "agx" ? 1.12 : 0.98;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  if (quality.shadows) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(theme.fog, theme.fogDensity);

  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.4, 3000);
  camera.position.set(0, 12, 24);

  // ── Sky ───────────────────────────────────────────────────────────────────
  const sunDirection = new THREE.Vector3(...theme.sunDir).normalize();
  const skyMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uLow: { value: new THREE.Color(theme.skyLow) },
      uHigh: { value: new THREE.Color(theme.skyHigh) },
      uSun: { value: new THREE.Color(theme.sunColor) },
      uSunDir: { value: sunDirection.clone() },
      uStars: { value: 0 },
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const skyGeometry = new THREE.SphereGeometry(1400, 32, 20);
  const sky = new THREE.Mesh(skyGeometry, skyMaterial);
  sky.frustumCulled = false;
  scene.add(sky);

  // Reflections come from the sky itself, so chrome picks up the theme.
  let environment: THREE.Texture | null = null;
  if (quality.environmentMap) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const skyScene = new THREE.Scene();
    const probe = new THREE.Mesh(skyGeometry, skyMaterial);
    skyScene.add(probe);
    environment = pmrem.fromScene(skyScene, 0, 1, 2000).texture;
    scene.environment = environment;
    skyScene.remove(probe);
    pmrem.dispose();
  }
  // Stars only AFTER the environment probe: hash noise in the reflection map
  // would put white speckle on every chrome surface in the game.
  (skyMaterial.uniforms.uStars as { value: number }).value = theme.stars;

  // ── Lights ────────────────────────────────────────────────────────────────
  const sun = new THREE.DirectionalLight(theme.sunColor, theme.sunIntensity);
  sun.position.copy(sunDirection).multiplyScalar(120);
  if (quality.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 320;
    const extent = 78;
    sun.shadow.camera.left = -extent;
    sun.shadow.camera.right = extent;
    sun.shadow.camera.top = extent;
    sun.shadow.camera.bottom = -extent;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
  }
  scene.add(sun);
  scene.add(sun.target);

  /*
   * Cascaded shadows.
   *
   * The single map above covers ±78 m around the focus kart, which is why the
   * lighthouse, the grandstands and every distant prop have always read as
   * painted backdrop: they were outside the only shadow camera in the scene.
   * CSM splits the view frustum into near/mid/far maps so the far half of the
   * track casts too.
   *
   * `csm.setupMaterial` has to be called on every standard material in the
   * scene, and a material that misses it silently loses its shadow — the same
   * registration-omission bug class as a set piece missing from SET_PIECES. So
   * nothing registers by hand: `enrol` traverses whatever it is given, and the
   * scene calls it once after everything is built and again whenever a kart is
   * created.
   */
  let csm: CSM | null = null;
  /** Materials whose own shader hook survived CSM registration. See `enrol`. */
  let chainedHooks = 0;
  const enrolled = new WeakSet<THREE.Material>();
  function enrol(root: THREE.Object3D): void {
    if (!csm) return;
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const material of materials) {
        if (!material || enrolled.has(material)) continue;
        if (!(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
          continue;
        }
        enrolled.add(material);
        /*
         * `csm.setupMaterial` ASSIGNS `material.onBeforeCompile`, so it silently
         * discards any hook the material already had. The road's dirt/gravel
         * blend is exactly such a hook, and losing it produced the most
         * confusing symptom of this whole feature: the sim said gravel, the
         * dust plume came up orange, and the tarmac under it stayed grey.
         *
         * They can both run — CSM patches `ShaderChunk` globally and its own
         * hook only writes uniforms, so there is no chunk-replace collision.
         * Chain them rather than choosing.
         */
        /*
         * Against the prototype default, not against undefined: three gives
         * every Material a no-op `onBeforeCompile`, so "does it have one" is
         * true for all of them and chaining would wrap 54 materials around a
         * function that does nothing. Only a hook the material actually
         * installed is worth preserving — and counting.
         */
        const own = material.onBeforeCompile;
        csm!.setupMaterial(material);
        const fromCsm = material.onBeforeCompile;
        if (own && own !== DEFAULT_ON_BEFORE_COMPILE && own !== fromCsm) {
          material.onBeforeCompile = function (shader, renderer) {
            fromCsm.call(this, shader, renderer);
            own.call(this, shader, renderer);
          };
          chainedHooks += 1;
        }
      }
    });
  }
  if (quality.shadows && quality.shadowCascades > 1) {
    csm = new CSM({
      maxFar: 420,
      cascades: quality.shadowCascades,
      mode: "practical",
      parent: scene,
      shadowMapSize: quality.shadowMapSize,
      shadowBias: -0.0006,
      lightDirection: sunDirection.clone().negate().normalize(),
      lightIntensity: theme.sunIntensity,
      camera,
    });
    // CSM builds white lights; the theme's sun is not white on any circuit
    // here (sunset amber, canyon magenta), and leaving them white would make
    // every shadowed surface the wrong colour relative to the sky.
    for (const light of csm.lights) {
      light.color.set(theme.sunColor);
      light.shadow.normalBias = 0.03;
    }
    // CSM brings its own directional lights; the original would double the sun.
    sun.castShadow = false;
    sun.intensity = 0;
  }

  const hemisphere = new THREE.HemisphereLight(
    theme.skyHigh,
    theme.ground,
    theme.ambient,
  );
  scene.add(hemisphere);

  // ── World ─────────────────────────────────────────────────────────────────
  const trackMesh: TrackMeshBundle = buildTrackMesh(track, {
    shadows: quality.shadows,
    propDensity: quality.propDensity,
  });
  scene.add(trackMesh.group);

  /*
   * A far disc in the fog colour. The circuit is a ribbon of land, so without
   * this the apron simply stops and you can see sky through the gap where the
   * ground should carry on. At this radius the fog has swallowed it before it
   * resolves into a surface, so it reads as haze rather than as a floor.
   */
  const hazeGeometry = new THREE.CircleGeometry(1150, 48);
  hazeGeometry.rotateX(-Math.PI / 2);
  const hazeMaterial = new THREE.MeshBasicMaterial({
    color: theme.fog,
    fog: true,
    depthWrite: false,
  });
  const haze = new THREE.Mesh(hazeGeometry, hazeMaterial);
  haze.position.y = track.bounds.minY - 26;
  haze.renderOrder = -2;
  scene.add(haze);

  const fxGlow: FxSystem = createFxSystem(quality.particleBudget);
  scene.add(fxGlow.object);
  const fxSoft: FxSystem = createFxSystem(
    Math.round(quality.particleBudget * 0.4),
    true,
  );
  scene.add(fxSoft.object);
  /** Dirt is opaque; sparks and flame add light. */
  const fx: FxSystem = {
    object: fxGlow.object,
    get active() {
      return fxGlow.active + fxSoft.active;
    },
    spawn(kind, ...rest) {
      const target = kind === "dust" ? fxSoft : fxGlow;
      target.spawn(kind, ...rest);
    },
    update(dt) {
      fxGlow.update(dt);
      fxSoft.update(dt);
    },
    dispose() {
      fxGlow.dispose();
      fxSoft.dispose();
    },
  };

  const skidMarks: SkidMarks = createSkidMarks(track, quality.skidQuads);
  scene.add(skidMarks.mesh);

  let clouds: CloudLayer | null = null;
  if (quality.cloudCount > 0) {
    clouds = createClouds(
      track,
      quality.cloudCount,
      theme.night ? 0x2a2440 : 0xffffff,
    );
    scene.add(clouds.object);
  }

  const grandstands: Grandstands = createGrandstands(
    track,
    quality.grandstands,
    quality.shadows,
  );
  scene.add(grandstands.group);

  const setPieceContext: SetPieceContext = {
    detail: quality.setPieceDetail,
    shadows: quality.shadows,
    texture(size, draw) {
      const element = document.createElement("canvas");
      element.width = size;
      element.height = size;
      draw(element.getContext("2d")!, size);
      const texture = new THREE.CanvasTexture(element);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    },
  };
  const setPieces: SetPieceBundle = buildSetPieces(track, setPieceContext);
  scene.add(setPieces.group);

  if (look.rain) {
    // Wet world: glossier, more reflective, on every lit surface.
    trackMesh.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as THREE.MeshStandardMaterial;
      if (!material.isMeshStandardMaterial) return;
      material.roughness = Math.min(material.roughness, look.roadRoughness + 0.15);
      material.envMapIntensity = look.roadEnvIntensity;
    });
  }

  let rainLayer: RainLayer | null = null;
  if (look.rain && quality.rainParticles > 0) {
    rainLayer = createRain(quality.rainParticles);
    scene.add(rainLayer.object);
  }

  const karts = new Map<number, KartVisual>();
  const kartRoot = new THREE.Group();
  scene.add(kartRoot);

  // The ghost: one translucent kart, created lazily, never in the standings.
  let ghostVisual: KartVisual | null = null;
  function ensureGhost(): KartVisual {
    if (ghostVisual) return ghostVisual;
    ghostVisual = createKartVisual({ livery: 15, castShadow: false });
    enrol(ghostVisual.root);
    ghostVisual.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as THREE.Material & { opacity: number };
      material.transparent = true;
      material.opacity = 0.32;
      material.depthWrite = false;
    });
    ghostVisual.root.visible = false;
    scene.add(ghostVisual.root);
    return ghostVisual;
  }

  // Projectiles and dropped items share two geometries and three materials.
  const shellGeometry = new THREE.IcosahedronGeometry(0.85, 1);
  const shellMaterials: Record<string, THREE.MeshStandardMaterial> = {
    green: new THREE.MeshStandardMaterial({
      color: 0x3ddc63,
      roughness: 0.25,
      metalness: 0.2,
      emissive: 0x0d3a1a,
    }),
    red: new THREE.MeshStandardMaterial({
      color: 0xf0413c,
      roughness: 0.25,
      metalness: 0.2,
      emissive: 0x4a0d0b,
    }),
    bomb: new THREE.MeshStandardMaterial({
      color: 0x24262c,
      roughness: 0.55,
      metalness: 0.4,
      emissive: 0x551200,
    }),
  };
  const bananaGeometry = new THREE.CapsuleGeometry(0.42, 0.7, 3, 8);
  const bananaMaterial = new THREE.MeshStandardMaterial({
    color: 0xf6d03c,
    roughness: 0.45,
  });
  const projectilePool = new Map<number, THREE.Mesh>();
  const hazardPool = new Map<number, THREE.Mesh>();

  // ── Post ──────────────────────────────────────────────────────────────────
  const post: PostStack = createPostStack(
    renderer,
    scene,
    camera,
    quality,
    theme.bloom * 0.8,
    {
      onShedShadows: () => {
        sun.castShadow = false;
        if (csm) for (const light of csm.lights) light.castShadow = false;
      },
      onShedCascades: () => {
        if (!csm) return;
        /*
         * Back to one map, not none. Disposing CSM would need every material
         * it patched to be recompiled mid-race — a hitch far worse than the
         * two shadow passes being reclaimed. Switching the far cascades off
         * keeps the near one, which is the shadow the player actually looks
         * at, and costs nothing but a boolean.
         */
        csm.lights.forEach((light, index) => {
          light.castShadow = index === 0;
        });
      },
    },
  );

  // Everything static is in the scene by now — road, set pieces, grandstands,
  // clouds, props. One traverse registers the lot.
  enrol(scene);

  /** Debug seam: how much of the scene CSM actually reached. */
  function countPatchedMaterials(): { patched: number; standard: number } {
    let patched = 0;
    let standard = 0;
    const seen = new Set<THREE.Material>();
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of list) {
        if (!material || seen.has(material)) continue;
        if (!(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
          continue;
        }
        seen.add(material);
        standard += 1;
        if (enrolled.has(material)) patched += 1;
      }
    });
    return { patched, standard };
  }

  // ── Camera state ──────────────────────────────────────────────────────────
  const cameraTarget = tempVector();
  const cameraLook = tempVector();
  const desired = tempVector();
  const scratch = tempVector();
  let cameraReady = false;
  let shake = 0;
  let elapsed = 0;
  let frames = 0;
  let focusSeat = 0;
  let width = 1;
  let height = 1;
  let lastCalls = 0;
  let lastTriangles = 0;
  let fpsAccum = 0;
  let fpsFrames = 0;
  let lastFps = 0;
  // Repeating alarm/jingle timers (scene-side; the sim has no such events).
  let starJingleAt = 0;
  let wrongWayAt = 0;
  let rouletteAt = 0;

  function visualFor(seat: number, racer: RacerState): KartVisual {
    let visual = karts.get(seat);
    if (!visual) {
      visual = createKartVisual({
        livery: racer.livery,
        castShadow: quality.shadows,
        raceNumber: seat + 1,
        headlights: theme.night,
        shape: machineById(racer.machineId).shape,
      });
      karts.set(seat, visual);
      kartRoot.add(visual.root);
      // Karts appear after the one-shot enrolment below, so each new one
      // registers itself. Without this the grid is the only thing in the scene
      // with no shadow — the most visible possible version of this bug.
      enrol(visual.root);
    }
    return visual;
  }

  function handleEvents(events: readonly RaceEvent[], view: RaceState): void {
    const focus = view.racers.find((entry) => entry.id === focusSeat);
    const cueContext: CueContext = {
      focusSeat,
      laps: view.laps,
      focusX: focus?.x ?? 0,
      focusZ: focus?.z ?? 0,
    };
    for (const event of events) {
      // Same dispatch point, same event stream as the visuals: an event the
      // budget drops is dropped from both senses.
      audio?.cue(cueForEvent(event, cueContext));
      switch (event.k) {
        case "boost": {
          const racer = view.racers.find((entry) => entry.id === event.racer);
          if (!racer) break;
          fx.spawn(
            "boost",
            racer.x,
            racer.y + 0.6,
            racer.z,
            BOOST_FLAME_COLORS[event.source] ?? 0xffffff,
            18,
            1.4,
            0.8,
            1.4,
          );
          if (event.racer === focusSeat) shake = Math.max(shake, 0.35);
          break;
        }
        case "hit": {
          fx.spawn("impact", event.x, event.y + 0.9, event.z, 0xffe27a, 26, 2, 1.4, 2);
          if (event.racer === focusSeat) shake = Math.max(shake, 1);
          break;
        }
        case "blast": {
          fx.spawn("blast", event.x, event.y + 1, event.z, 0xff8a2b, 70, 3, 2, 3);
          fx.spawn("blast", event.x, event.y + 1, event.z, 0xffe9a8, 40, 2, 1.5, 2);
          shake = Math.max(shake, 0.8);
          break;
        }
        case "pickup": {
          const racer = view.racers.find((entry) => entry.id === event.racer);
          if (!racer) break;
          fx.spawn("pickup", racer.x, racer.y + 1.6, racer.z, 0x9fe8ff, 16, 1.6, 1, 1.6);
          break;
        }
        case "wall": {
          const racer = view.racers.find((entry) => entry.id === event.racer);
          if (!racer) break;
          fx.spawn("impact", racer.x, racer.y + 0.6, racer.z, 0xffd9a0, 12, 1.2, 0.8, 1.2);
          if (event.racer === focusSeat) shake = Math.max(shake, 0.28);
          break;
        }
        case "respawn": {
          const racer = view.racers.find((entry) => entry.id === event.racer);
          if (!racer) break;
          fx.spawn("pickup", racer.x, racer.y + 1, racer.z, 0xffffff, 24, 2, 2, 2);
          break;
        }
        default:
          break;
      }
    }
  }

  function updateKarts(view: RaceState, dt: number): void {
    const seen = new Set<number>();
    for (const racer of view.racers) {
      seen.add(racer.id);
      const visual = visualFor(racer.id, racer);
      visual.root.position.set(racer.x, racer.y, racer.z);
      visual.root.rotation.y = racer.yaw;
      visual.body.rotation.y = racer.slip;
      // Lean into the drift, and squash when a bomb or a bolt has landed.
      const lean = -racer.slip * 0.32;
      visual.body.rotation.z += (lean - visual.body.rotation.z) * Math.min(1, 10 * dt);
      const squash = racer.squashTimer > 0 ? 0.45 : 1;
      const scale = racer.boltTimer > 0 ? 0.62 : 1;
      visual.body.scale.set(
        scale,
        scale * squash + (1 - squash) * 0.0,
        scale,
      );
      visual.setSteer(racer.driftDir !== 0 ? racer.driftDir * 0.8 : 0);
      visual.spinWheels(racer.distance);

      // Trick: a full barrel spin while airborne, resolved by landing.
      if (racer.tricking) {
        visual.body.rotation.y = racer.slip + elapsed * 11;
      }
      // Slipstream feedback: faint wind streaks while charging.
      if (racer.drafting && frames % 3 === 0) {
        const [wfx, wfz] = forwardOf(racer.yaw);
        fx.spawn(
          "boost",
          racer.x - wfx * 1.2,
          racer.y + 1.1,
          racer.z - wfz * 1.2,
          0xcfe8ff,
          1,
          1.2,
          0.5,
          1.2,
        );
      }
      // Wet wheels throw spray.
      if (look.rain && !racer.airborne && Math.abs(racer.speed) > 16 && frames % 2 === 0) {
        const [sfx, sfz] = forwardOf(racer.yaw);
        fx.spawn(
          "dust",
          racer.x - sfx * 1.5,
          racer.y + 0.3,
          racer.z - sfz * 1.5,
          0x9db4c8,
          1,
          1.6,
          0.5,
          1.2,
        );
      }

      // The driver looks into the corner; the chassis breathes with speed and
      // settles on landing. Pure presentation -- consumes RacerState only.
      const headTarget = Math.max(-0.6, Math.min(0.6, -racer.slip * 0.7));
      visual.helmet.rotation.y +=
        (headTarget - visual.helmet.rotation.y) * Math.min(1, 9 * dt);
      const rideTarget = racer.airborne ? 0.07 : 0;
      const vibration = racer.airborne
        ? 0
        : Math.sin(elapsed * 46 + racer.id * 1.7) *
          0.008 *
          Math.min(1, Math.abs(racer.speed) / 30);
      visual.body.position.y +=
        (rideTarget + vibration - visual.body.position.y) * Math.min(1, 11 * dt);

      skidMarks.note(racer, dt, elapsed);

      const boosting = racer.boostTimer > 0 || racer.starTimer > 0;
      const flameColor = racer.starTimer > 0
        ? BOOST_FLAME_COLORS.star!
        : (BOOST_FLAME_COLORS[racer.boostSource ?? "mini"] ?? 0xffffff);
      for (const exhaust of visual.exhausts) {
        exhaust.visible = boosting;
        const material = exhaust.material as THREE.MeshBasicMaterial;
        material.opacity = boosting ? 0.55 + Math.sin(elapsed * 40) * 0.25 : 0;
        material.color.setHex(flameColor);
        exhaust.scale.setScalar(boosting ? 1 + Math.sin(elapsed * 30) * 0.2 : 1);
      }

      if (racer.id === focusSeat && audio) {
        const rpm =
          Math.min(1, Math.abs(racer.speed) / (BASE_TOP_SPEED * 1.42)) *
          (racer.stalled ? 0.25 : 1);
        const boosting01 =
          racer.boostTimer > 0 || racer.starTimer > 0 ? 1 : 0;
        audio.setEngine(racer.finished ? rpm * 0.5 : rpm, boosting01);
        const squeal =
          racer.driftDir !== 0 && Math.abs(racer.speed) > 8
            ? Math.min(1, 0.3 + racer.driftTier * 0.18 + Math.abs(racer.slip) * 0.6)
            : racer.spinTimer > 0
              ? 0.5
              : 0;
        audio.setSqueal(squeal);

        // Scene-side repeaters: states, not events, so the sim stays silent.
        if (racer.starTimer > 0 && elapsed >= starJingleAt) {
          starJingleAt = elapsed + 0.45;
          audio.cue({ kind: "voice", name: "star-jingle" });
        }
        if (racer.wrongWay && elapsed >= wrongWayAt) {
          wrongWayAt = elapsed + 0.85;
          audio.cue({ kind: "voice", name: "wrong-way" });
        }
        if (racer.rouletteTimer > 0 && elapsed >= rouletteAt) {
          rouletteAt = elapsed + 0.09;
          audio.cue({ kind: "voice", name: "roulette-tick" });
        }
      }

      // Invulnerability blink, so a player knows why a shell bounced off.
      const blinking = racer.graceTimer > 0 && Math.floor(elapsed * 14) % 2 === 0;
      visual.body.visible = !blinking;

      // Continuous particle sources.
      const [fxDir, fzDir] = forwardOf(racer.yaw);
      const tailX = racer.x - fxDir * 1.7;
      const tailZ = racer.z - fzDir * 1.7;
      if (racer.driftDir !== 0 && racer.speed > 8) {
        const tier = Math.min(3, racer.driftTier);
        fx.spawn(
          "drift",
          tailX,
          racer.y + 0.25,
          tailZ,
          DRIFT_TIER_COLORS[tier]!,
          tier > 0 ? 3 : 2,
          1.8,
          0.3,
          1.2,
        );
      }
      if (boosting && racer.speed > 6) {
        fx.spawn("boost", tailX, racer.y + 0.5, tailZ, flameColor, 2, 1, 0.4, 1);
      }
      if (racer.offRoad && racer.speed > 6) {
        fx.spawn("dust", tailX, racer.y + 0.2, tailZ, theme.ground, 2, 2, 0.4, 1.6);
      } else if (racer.speed > 20) {
        /*
         * On-road dust: only loose surfaces throw any, so a paved circuit
         * spawns nothing here and its particle count is unchanged. The colour
         * is the road's own, which is why a dirt section reads as dirt from the
         * spray before the texture under the wheels is even visible.
         */
        const surface = querySurface(
          track,
          racer.x,
          racer.z,
          -1,
          SHOULDER_WIDTH,
        ).surface;
        if (surface === "dirt" || surface === "gravel") {
          fx.spawn(
            "dust",
            tailX,
            racer.y + 0.18,
            tailZ,
            theme.looseRoad ?? 0x8a6a44,
            surface === "dirt" ? 2 : 1,
            1.5,
            0.36,
            1.4,
          );
        }
      }
      if (racer.starTimer > 0) {
        fx.spawn("star", racer.x, racer.y + 1.1, racer.z, 0xfff2a0, 2, 2, 1.6, 2);
      }
      if (racer.spinTimer > 0 || racer.squashTimer > 0) {
        fx.spawn("impact", racer.x, racer.y + 1.8, racer.z, 0xffe27a, 1, 1.6, 0.4, 1.6);
      }
      if (racer.stalled) {
        fx.spawn("dust", tailX, racer.y + 0.6, tailZ, 0x9aa2ad, 2, 1, 0.6, 1);
      }
    }
    for (const [seat, visual] of karts) {
      if (seen.has(seat)) continue;
      kartRoot.remove(visual.root);
      visual.dispose();
      karts.delete(seat);
    }
  }

  function updateEntities(view: RaceState): void {
    const liveShots = new Set<number>();
    for (const projectile of view.projectiles) {
      liveShots.add(projectile.id);
      let mesh = projectilePool.get(projectile.id);
      if (!mesh) {
        mesh = new THREE.Mesh(shellGeometry, shellMaterials[projectile.kind]!);
        mesh.castShadow = quality.shadows;
        scene.add(mesh);
        // Shells appear after the one-shot enrolment, so they register here.
        enrol(mesh);
        projectilePool.set(projectile.id, mesh);
      }
      mesh.position.set(projectile.x, projectile.y, projectile.z);
      mesh.rotation.y = projectile.yaw;
      mesh.rotation.x = elapsed * 9;
    }
    for (const [id, mesh] of projectilePool) {
      if (liveShots.has(id)) continue;
      scene.remove(mesh);
      projectilePool.delete(id);
    }

    const liveDrops = new Set<number>();
    for (const hazard of view.hazards) {
      liveDrops.add(hazard.id);
      let mesh = hazardPool.get(hazard.id);
      if (!mesh) {
        mesh = new THREE.Mesh(bananaGeometry, bananaMaterial);
        mesh.rotation.z = Math.PI / 2.4;
        mesh.castShadow = quality.shadows;
        scene.add(mesh);
        enrol(mesh);
        hazardPool.set(hazard.id, mesh);
      }
      mesh.position.set(hazard.x, hazard.y + 0.42, hazard.z);
      mesh.rotation.y = elapsed * 1.4 + hazard.id;
    }
    for (const [id, mesh] of hazardPool) {
      if (liveDrops.has(id)) continue;
      scene.remove(mesh);
      hazardPool.delete(id);
    }
  }

  function updateCamera(view: RaceState, dt: number, lookBack: boolean): void {
    const racer =
      view.racers.find((entry) => entry.id === focusSeat) ?? view.racers[0];
    if (!racer) return;
    const [fx0, fz0] = forwardOf(racer.yaw);
    const sign = lookBack ? -1 : 1;
    const speedFraction = Math.min(1.4, Math.abs(racer.speed) / BASE_TOP_SPEED);
    const distance = 9.6 + speedFraction * 2.4;
    const heightAbove = 4.1 + speedFraction * 0.6;

    desired.set(
      racer.x - fx0 * distance * sign,
      racer.y + heightAbove,
      racer.z - fz0 * distance * sign,
    );
    // A little outward swing through a drift, so the corner opens up. Slip is
    // negative in a right-hand drift, so +rightOf lands on the outside.
    const [crx, crz] = rightOf(racer.yaw);
    desired.x += crx * racer.slip * 3.2;
    desired.z += crz * racer.slip * 3.2;

    if (!cameraReady) {
      cameraTarget.copy(desired);
      cameraReady = true;
    } else {
      const follow = 1 - Math.pow(0.0022, dt);
      cameraTarget.lerp(desired, follow);
    }

    scratch.set(
      racer.x + fx0 * 9 * sign,
      racer.y + 1.9,
      racer.z + fz0 * 9 * sign,
    );
    cameraLook.lerp(scratch, 1 - Math.pow(0.0009, dt));

    camera.position.copy(cameraTarget);
    if (shake > 0.001) {
      const amount = shake * 0.5;
      camera.position.x += (Math.random() - 0.5) * amount;
      camera.position.y += (Math.random() - 0.5) * amount;
      camera.position.z += (Math.random() - 0.5) * amount;
    }
    camera.lookAt(cameraLook);

    const boosting = racer.boostTimer > 0 || racer.starTimer > 0;
    const targetFov = 62 + speedFraction * 9 + (boosting ? 6 : 0);
    camera.fov += (targetFov - camera.fov) * Math.min(1, 5 * dt);
    camera.updateProjectionMatrix();

    sun.target.position.set(racer.x, racer.y, racer.z);
    sun.position
      .copy(sunDirection)
      .multiplyScalar(120)
      .add(sun.target.position);
    sky.position.set(racer.x, racer.y, racer.z);

    post.setSpeed(speedFraction * (boosting ? 1.7 : 1));
    post.setShake(shake);
  }

  function resize(nextWidth: number, nextHeight: number): void {
    width = Math.max(1, Math.floor(nextWidth));
    height = Math.max(1, Math.floor(nextHeight));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    post.setSize(width, height);
  }

  resize(canvas.clientWidth || 960, canvas.clientHeight || 540);

  return {
    advance(dt, view, events, seat, lookBack) {
      const step = Math.max(0, Math.min(0.1, dt));
      audio?.beginFrame();
      elapsed += step;
      frames += 1;
      focusSeat = seat;
      shake = Math.max(0, shake - step * 3.4);

      if (view) {
        handleEvents(events, view);
        updateKarts(view, step);
        updateEntities(view);
        updateCamera(view, step, lookBack);
        trackMesh.update(elapsed, view.boxCooldowns, view.countdown);
      } else {
        trackMesh.update(elapsed, [], -1);
      }
      skidMarks.update(elapsed);
      clouds?.update(elapsed);
      grandstands.update(elapsed);
      setPieces.update(elapsed, camera.position.x, camera.position.z);
      rainLayer?.update(step, camera.position.x, camera.position.y, camera.position.z);
      post.setWet(look.rain ? 1 : 0);
      fx.update(step);

      // After the camera has moved, before the draw: the cascades are fitted to
      // the current view frustum, so updating them earlier would aim last
      // frame's shadow maps at this frame's picture.
      csm?.update();

      renderer.info.reset();
      if (post.composer) post.composer.render(step);
      else renderer.render(scene, camera);
      // Sampled after the frame; `autoReset` is off so this is the scene's
      // own cost, not the last post pass's.
      lastCalls = renderer.info.render.calls;
      lastTriangles = renderer.info.render.triangles;

      /*
       * The degrade ladder. 90 frames is long enough that a GC pause or a
       * tab-switch hiccup cannot trigger it; shedding is one-way, so a scene
       * that dips once does not oscillate between looks (glScene precedent).
       */
      if (!options.disableShed && quality.shedFloorFps > 0 && dt > 0 && dt < 0.5) {
        fpsAccum += dt;
        fpsFrames += 1;
        if (fpsFrames >= 90) {
          lastFps = fpsFrames / fpsAccum;
          if (lastFps < quality.shedFloorFps) post.shedNext();
          fpsAccum = 0;
          fpsFrames = 0;
        }
      }
    },
    resize,
    setGhostPose(pose) {
      if (!pose) {
        if (ghostVisual) ghostVisual.root.visible = false;
        return;
      }
      const ghost = ensureGhost();
      ghost.root.visible = true;
      ghost.root.position.set(pose.x, pose.y, pose.z);
      ghost.root.rotation.y = pose.yaw;
      ghost.body.rotation.y = pose.slip;
      ghost.spinWheels(pose.x + pose.z);
    },
    probeCorridor(maxHeight = 40) {
      const offenders: {
        type: string;
        name: string;
        x: number;
        y: number;
        z: number;
        height: number;
      }[] = [];
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh || !mesh.visible) return;
        box.setFromObject(mesh);
        if (!Number.isFinite(box.min.x)) return;
        const centerX = (box.min.x + box.max.x) / 2;
        const centerZ = (box.min.z + box.max.z) / 2;
        const height = box.max.y - box.min.y;
        if (height < 5 || height > maxHeight * 4) return;
        const query = querySurface(track, centerX, centerZ, -1, 4);
        if (!query.onRoad) return;
        offenders.push({
          type: mesh.geometry.type,
          name: mesh.name || mesh.parent?.name || "(anon)",
          x: Math.round(centerX),
          y: Math.round(box.min.y),
          z: Math.round(centerZ),
          height: Math.round(height),
        });
      });
      return offenders;
    },
    getDebugState() {
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      return {
        frames,
        cameraPosition: [
          camera.position.x,
          camera.position.y,
          camera.position.z,
        ] as const,
        cameraForward: [forward.x, forward.y, forward.z] as const,
        focusSeat,
        visibleKarts: karts.size,
        particles: fx.active,
        drawCalls: lastCalls,
        triangles: lastTriangles,
        quality: quality.label,
        /*
         * Shadow accounting. `csmPatched` vs `standardMaterials` is the only
         * way to see the failure this feature is most likely to have: a
         * material that never got `setupMaterial` renders perfectly and simply
         * has no shadow, which no headless gate and no error log will report.
         * They must be equal.
         */
        shadowCascades: csm?.lights.length ?? (sun.castShadow ? 1 : 0),
        shadowCasting:
          (csm?.lights.filter((light) => light.castShadow).length ?? 0) +
          (sun.castShadow ? 1 : 0),
        csmPatched: countPatchedMaterials().patched,
        standardMaterials: countPatchedMaterials().standard,
        /*
         * At least one, always: the road carries the dirt/gravel blend. Zero
         * here means CSM overwrote it, which renders perfectly and simply
         * paints every surface as tarmac — the sim still says gravel, the dust
         * still comes up orange, and only the road disagrees.
         */
        csmChainedHooks: chainedHooks,
        shed: post.shedStages.slice(),
        fps: Math.round(lastFps),
        ghost:
          ghostVisual && ghostVisual.root.visible
            ? {
                x: ghostVisual.root.position.x,
                y: ghostVisual.root.position.y,
                z: ghostVisual.root.position.z,
              }
            : null,
      };
    },
    dispose() {
      audio?.reset();
      csm?.dispose();
      ghostVisual?.dispose();
      for (const visual of karts.values()) visual.dispose();
      karts.clear();
      disposeSharedKartGeometry();
      for (const mesh of projectilePool.values()) scene.remove(mesh);
      projectilePool.clear();
      for (const mesh of hazardPool.values()) scene.remove(mesh);
      hazardPool.clear();
      shellGeometry.dispose();
      for (const material of Object.values(shellMaterials)) material.dispose();
      bananaGeometry.dispose();
      bananaMaterial.dispose();
      fx.dispose();
      rainLayer?.dispose();
      setPieces.dispose();
      skidMarks.dispose();
      clouds?.dispose();
      grandstands.dispose();
      trackMesh.dispose();
      hazeGeometry.dispose();
      hazeMaterial.dispose();
      skyGeometry.dispose();
      skyMaterial.dispose();
      environment?.dispose();
      post.dispose();
      renderer.dispose();
      scene.clear();
    },
  };
}
