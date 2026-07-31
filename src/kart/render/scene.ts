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
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { BASE_TOP_SPEED } from "../sim/balance";
import { forwardOf, type Track } from "../sim/track";
import type { RaceEvent, RaceState } from "../sim/types";
import { createFxSystem, type FxSystem } from "./fx";
import { createKartVisual, disposeSharedKartGeometry, type KartVisual } from "./kartModel";
import {
  BOOST_FLAME_COLORS,
  DRIFT_TIER_COLORS,
  liveryOf,
} from "./palette";
import type { KartQuality } from "./quality";
import { buildTrackMesh, type TrackMeshBundle } from "./trackMesh";

export interface KartSceneOptions {
  readonly canvas: HTMLCanvasElement;
  readonly track: Track;
  readonly quality: KartQuality;
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
  getDebugState(): KartSceneDebug;
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
  varying vec3 vWorld;
  void main() {
    vec3 dir = normalize(vWorld);
    float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 sky = mix(uLow, uHigh, pow(h, 0.75));
    float sun = max(0.0, dot(dir, normalize(uSunDir)));
    sky += uSun * pow(sun, 340.0) * 2.4;
    sky += uSun * pow(sun, 6.0) * 0.16;
    gl_FragColor = vec4(sky, 1.0);
  }
`;

/**
 * Final grade: a radial smear that grows with speed, a vignette, and a touch
 * of chromatic aberration at the edges. Speed is a uniform rather than a
 * post-hoc guess so it matches the kart the camera is actually following.
 */
const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSpeed: { value: 0 },
    uShake: { value: 0 },
    uVignette: { value: 0.9 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSpeed;
    uniform float uShake;
    uniform float uVignette;
    varying vec2 vUv;

    void main() {
      vec2 centre = vec2(0.5);
      vec2 offset = vUv - centre;
      float radius = length(offset);

      vec3 colour = vec3(0.0);
      float total = 0.0;
      const int SAMPLES = 6;
      for (int i = 0; i < SAMPLES; i++) {
        float t = float(i) / float(SAMPLES - 1);
        float scale = 1.0 - t * uSpeed * 0.055 * smoothstep(0.12, 0.75, radius);
        float weight = 1.0 - t * 0.62;
        colour += texture2D(tDiffuse, centre + offset * scale).rgb * weight;
        total += weight;
      }
      colour /= total;

      // Chromatic fringe, edges only.
      float fringe = (0.0006 + uSpeed * 0.0011) * smoothstep(0.2, 0.85, radius);
      // 25%, not 55%. At the higher weight the sun picked up a magenta/cyan
      // ring — an aberration you notice is a filter, not a lens.
      colour.r = texture2D(tDiffuse, centre + offset * (1.0 - fringe)).r * 0.25 + colour.r * 0.75;
      colour.b = texture2D(tDiffuse, centre + offset * (1.0 + fringe)).b * 0.25 + colour.b * 0.75;

      float vignette = smoothstep(1.05, uVignette * 0.42, radius);
      colour *= mix(0.72, 1.0, vignette);
      colour = mix(colour, colour * colour * (3.0 - 2.0 * colour), 0.18);
      colour += uShake * 0.05;

      gl_FragColor = vec4(colour, 1.0);
    }
  `,
};

function tempVector(): THREE.Vector3 {
  return new THREE.Vector3();
}

export function createKartScene(options: KartSceneOptions): KartScene {
  const { canvas, track, quality } = options;
  const theme = track.spec.theme;

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
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;
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

  const karts = new Map<number, KartVisual>();
  const kartRoot = new THREE.Group();
  scene.add(kartRoot);

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
  let composer: EffectComposer | null = null;
  let bloomPass: UnrealBloomPass | null = null;
  let gradePass: ShaderPass | null = null;
  if (quality.postProcessing) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    if (quality.bloom) {
      /*
       * Threshold above 1. Bloom runs before tone mapping, so it sees linear
       * HDR: a plain white curb under a 3.4-intensity sun sits near 3.0, and a
       * 0.82 threshold made every painted line, rumble strip and item box glow
       * like a filament. Only things that are actually emissive should bloom.
       */
      bloomPass = new UnrealBloomPass(
        new THREE.Vector2(1, 1),
        theme.bloom * 0.8,
        0.55,
        1.15,
      );
      composer.addPass(bloomPass);
    }
    gradePass = new ShaderPass(GRADE_SHADER);
    composer.addPass(gradePass);
    composer.addPass(new OutputPass());
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

  function visualFor(seat: number, livery: number): KartVisual {
    let visual = karts.get(seat);
    if (!visual) {
      visual = createKartVisual(livery, quality.shadows);
      karts.set(seat, visual);
      kartRoot.add(visual.root);
    }
    return visual;
  }

  function handleEvents(events: readonly RaceEvent[], view: RaceState): void {
    for (const event of events) {
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
      const visual = visualFor(racer.id, racer.livery);
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
    // A little outward swing through a drift, so the corner opens up.
    desired.x += Math.cos(racer.yaw) * racer.slip * 3.2;
    desired.z += -Math.sin(racer.yaw) * racer.slip * 3.2;

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

    if (gradePass) {
      gradePass.uniforms.uSpeed!.value = speedFraction * (boosting ? 1.7 : 1);
      gradePass.uniforms.uShake!.value = shake;
    }
  }

  function resize(nextWidth: number, nextHeight: number): void {
    width = Math.max(1, Math.floor(nextWidth));
    height = Math.max(1, Math.floor(nextHeight));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    composer?.setSize(width, height);
    bloomPass?.setSize(width, height);
  }

  resize(canvas.clientWidth || 960, canvas.clientHeight || 540);

  return {
    advance(dt, view, events, seat, lookBack) {
      const step = Math.max(0, Math.min(0.1, dt));
      elapsed += step;
      frames += 1;
      focusSeat = seat;
      shake = Math.max(0, shake - step * 3.4);

      if (view) {
        handleEvents(events, view);
        updateKarts(view, step);
        updateEntities(view);
        updateCamera(view, step, lookBack);
        trackMesh.update(elapsed, view.boxCooldowns);
      } else {
        trackMesh.update(elapsed, []);
      }
      fx.update(step);

      renderer.info.reset();
      if (composer) composer.render(step);
      else renderer.render(scene, camera);
      // Sampled after the frame; `autoReset` is off so this is the scene's
      // own cost, not the last post pass's.
      lastCalls = renderer.info.render.calls;
      lastTriangles = renderer.info.render.triangles;
    },
    resize,
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
      };
    },
    dispose() {
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
      trackMesh.dispose();
      hazeGeometry.dispose();
      hazeMaterial.dispose();
      skyGeometry.dispose();
      skyMaterial.dispose();
      environment?.dispose();
      bloomPass?.dispose();
      gradePass?.dispose();
      composer?.dispose();
      renderer.dispose();
      scene.clear();
    },
  };
}
