import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { HeroQuality } from "../quality";

// A transparent, persistent creation object shared by the light hero and dark
// closing section. The DOM owns the page and backgrounds; WebGL only contributes
// the chrome/glass sculpture and its signal orbit.

export interface GlScene {
  dispose: () => void;
}

interface FadingMaterial {
  material: THREE.Material & { opacity: number };
  opacity: number;
}

const FOV = 38;
const CAMERA_Z = 10;
const VERMILION = 0xff3b1f;
const COBALT = 0x164cff;
const ORBIT_RX = 2.34;
const ORBIT_RY = 1.24;
const CLOSING_SELECTORS = "[data-creation-close], #closing, .closing-section, footer";

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const x = clamp01((value - edge0) / Math.max(0.0001, edge1 - edge0));
  return x * x * (3 - 2 * x);
}

function createChromeMaterial(opacity = 1): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0xf3f5f7,
    metalness: 1,
    roughness: 0.105,
    clearcoat: 1,
    clearcoatRoughness: 0.045,
    envMapIntensity: 2.3,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide
  });
}

function createGlassMaterial(opacity = 0.68): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0xe7efff,
    metalness: 0.03,
    roughness: 0.045,
    transmission: 0.94,
    thickness: 0.72,
    ior: 1.46,
    clearcoat: 1,
    clearcoatRoughness: 0.025,
    envMapIntensity: 2.5,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide
  });
}

function ellipseLine(
  radiusX: number,
  radiusY: number,
  segments: number,
  color: number,
  opacity: number
): THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial> {
  const curve = new THREE.EllipseCurve(0, 0, radiusX, radiusY, 0, Math.PI * 2, false, 0);
  const points = curve.getPoints(segments).map((point) => new THREE.Vector3(point.x, point.y, 0));
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false
  });
  return new THREE.LineLoop(geometry, material);
}

export function createGlScene(canvas: HTMLCanvasElement, quality: HeroQuality): GlScene {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: quality.tier !== "low",
    powerPreference: "high-performance",
    premultipliedAlpha: true
  });

  try {
    return initialiseScene(canvas, renderer, quality);
  } catch (error) {
    renderer.dispose();
    throw error;
  }
}

function initialiseScene(
  canvas: HTMLCanvasElement,
  renderer: THREE.WebGLRenderer,
  quality: HeroQuality
): GlScene {
  renderer.setPixelRatio(quality.dpr);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60);
  camera.position.set(0, 0, CAMERA_Z);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.03);
  scene.environment = environment.texture;
  room.dispose();
  pmrem.dispose();

  const root = new THREE.Group();
  root.name = "creation-core";
  scene.add(root);

  const intact = new THREE.Group();
  intact.name = "creation-core-intact";
  root.add(intact);

  const intactChrome = createChromeMaterial();
  const intactGlass = createGlassMaterial(0.7);
  const fragmentChrome = createChromeMaterial(0);
  const fragmentGlass = createGlassMaterial(0);

  const fading: FadingMaterial[] = [
    { material: intactChrome, opacity: 1 },
    { material: intactGlass, opacity: 0.7 },
    { material: fragmentChrome, opacity: 0.97 },
    { material: fragmentGlass, opacity: 0.62 }
  ];

  const torus = (radius: number, tube: number): THREE.TorusGeometry =>
    new THREE.TorusGeometry(
      radius,
      tube,
      quality.radialSegments,
      quality.tubularSegments
    );

  const chromeLoopA = new THREE.Mesh(torus(1.5, 0.145), intactChrome);
  chromeLoopA.scale.set(1.14, 0.76, 1);
  chromeLoopA.rotation.set(0.73, 0.56, -0.28);
  intact.add(chromeLoopA);

  const chromeLoopB = new THREE.Mesh(torus(1.35, 0.105), intactChrome);
  chromeLoopB.scale.set(1.02, 0.82, 1);
  chromeLoopB.rotation.set(-0.63, 0.38, 0.66);
  intact.add(chromeLoopB);

  const glassLoop = new THREE.Mesh(torus(1.24, 0.185), intactGlass);
  glassLoop.scale.set(1.17, 0.79, 1);
  glassLoop.rotation.set(0.26, -0.78, 0.23);
  intact.add(glassLoop);

  const loopBaseRotations = [
    chromeLoopA.rotation.clone(),
    chromeLoopB.rotation.clone(),
    glassLoop.rotation.clone()
  ];

  // Four related pieces replace the intact loops as the closing section arrives.
  // Each piece combines a chrome outer arc with a slightly offset glass inner arc.
  const fragments = new THREE.Group();
  fragments.name = "creation-core-fragments";
  root.add(fragments);

  const fragmentGroups: THREE.Group[] = [];
  const fragmentTargets = Array.from({ length: 4 }, () => new THREE.Vector3());
  const fragmentOpenRotations = [
    new THREE.Euler(0.12, -0.34, -0.3),
    new THREE.Euler(-0.18, 0.32, 0.38),
    new THREE.Euler(0.22, 0.26, -0.42),
    new THREE.Euler(-0.12, -0.28, 0.34)
  ];
  const arcSegments = Math.max(28, Math.round(quality.tubularSegments * 0.56));

  for (let i = 0; i < 4; i += 1) {
    const fragment = new THREE.Group();
    const start = i * Math.PI * 0.5 + 0.14;

    const chromeArc = new THREE.Mesh(
      new THREE.TorusGeometry(1.34, 0.15, quality.radialSegments, arcSegments, Math.PI * 0.58),
      fragmentChrome
    );
    chromeArc.scale.set(1.06, 0.77, 1);
    chromeArc.rotation.z = start;
    fragment.add(chromeArc);

    const glassArc = new THREE.Mesh(
      new THREE.TorusGeometry(
        1.02,
        0.125,
        quality.radialSegments,
        Math.max(24, arcSegments - 8),
        Math.PI * 0.47
      ),
      fragmentGlass
    );
    glassArc.scale.set(1.12, 0.8, 1);
    glassArc.rotation.set(i % 2 === 0 ? 0.2 : -0.2, i % 2 === 0 ? -0.16 : 0.16, start + 0.12);
    fragment.add(glassArc);

    fragment.scale.setScalar(0.72);
    fragments.add(fragment);
    fragmentGroups.push(fragment);
  }

  // Two restrained signal paths tie the intact and open states together.
  const orbit = new THREE.Group();
  orbit.name = "creation-core-orbit";
  root.add(orbit);
  const orbitMain = ellipseLine(
    ORBIT_RX,
    ORBIT_RY,
    quality.tier === "low" ? 72 : 128,
    0x65718b,
    0.23
  );
  orbit.add(orbitMain);
  const orbitSecondary = ellipseLine(
    ORBIT_RX * 1.1,
    ORBIT_RY * 0.77,
    quality.tier === "low" ? 64 : 112,
    COBALT,
    0.16
  );
  orbitSecondary.rotation.z = 0.26;
  orbitSecondary.position.z = -0.25;
  orbit.add(orbitSecondary);

  const bead = new THREE.Group();
  root.add(bead);
  const beadMaterial = new THREE.MeshPhysicalMaterial({
    color: VERMILION,
    emissive: VERMILION,
    emissiveIntensity: 0.72,
    metalness: 0.08,
    roughness: 0.16,
    clearcoat: 1,
    clearcoatRoughness: 0.04
  });
  bead.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(0.13, quality.tier === "low" ? 12 : 20, quality.tier === "low" ? 8 : 14),
      beadMaterial
    )
  );
  const beadGlowMaterial = new THREE.MeshBasicMaterial({
    color: VERMILION,
    transparent: true,
    opacity: 0.14,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const beadGlow = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 8), beadGlowMaterial);
  bead.add(beadGlow);

  const cobaltMaterial = new THREE.MeshStandardMaterial({
    color: COBALT,
    emissive: COBALT,
    emissiveIntensity: 2.2,
    roughness: 0.22,
    metalness: 0.2
  });
  const cobaltPoints: THREE.Mesh[] = [];
  const cobaltGeometry = new THREE.SphereGeometry(0.045, quality.tier === "low" ? 8 : 12, 8);
  for (let i = 0; i < 3; i += 1) {
    const point = new THREE.Mesh(cobaltGeometry, cobaltMaterial);
    root.add(point);
    cobaltPoints.push(point);
  }

  const key = new THREE.DirectionalLight(0xffffff, 3.4);
  key.position.set(-4, 5, 7);
  scene.add(key);
  const coolRim = new THREE.PointLight(COBALT, 24, 14, 2);
  coolRim.position.set(-3.5, -1.5, 3.6);
  scene.add(coolRim);
  const warmRim = new THREE.PointLight(VERMILION, 18, 11, 2);
  root.add(warmRim);
  const fill = new THREE.HemisphereLight(0xffffff, 0x65718b, 1.15);
  scene.add(fill);

  let disposed = false;
  let rafId = 0;
  let running = false;
  let lastRenderedAt = 0;
  let morph = 0;
  let morphStart = 0;
  let morphEnd = 1;
  let worldWidth = 1;
  let worldHeight = 1;
  let heroX = 0;
  let heroY = 0;
  let heroScale = 1;
  let closingTarget: Element | null = null;
  const pointer = new THREE.Vector2();
  const pointerTarget = new THREE.Vector2();

  const resolveMorphRange = (): void => {
    const scrollMax = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    closingTarget = document.querySelector(CLOSING_SELECTORS);
    if (closingTarget) {
      const rect = closingTarget.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      morphStart = Math.max(0, Math.min(scrollMax, top - window.innerHeight * 0.86));
      morphEnd = Math.max(morphStart + 1, Math.min(scrollMax, top - window.innerHeight * 0.16));
      return;
    }
    morphStart = scrollMax * 0.68;
    morphEnd = Math.max(morphStart + 1, scrollMax * 0.92);
  };

  const resize = (): void => {
    if (disposed) return;
    const width = Math.max(1, canvas.clientWidth || window.innerWidth);
    const height = Math.max(1, canvas.clientHeight || window.innerHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    worldHeight = 2 * Math.tan(THREE.MathUtils.degToRad(FOV * 0.5)) * CAMERA_Z;
    worldWidth = worldHeight * camera.aspect;
    const compact = width < 900;
    heroX = compact ? worldWidth * 0.08 : worldWidth * 0.25;
    heroY = compact ? -worldHeight * 0.12 : worldHeight * 0.015;
    heroScale = compact ? 0.95 : Math.min(1.72, Math.max(1.5, worldWidth / 7.6));

    const x = worldWidth * (compact ? 0.22 : 0.31);
    const y = worldHeight * (compact ? 0.22 : 0.24);
    fragmentTargets[0].set(-x, y, -0.15);
    fragmentTargets[1].set(x, y * 0.83, 0.05);
    fragmentTargets[2].set(x * 0.9, -y, -0.1);
    fragmentTargets[3].set(-x * 0.9, -y * 0.88, 0.08);
    resolveMorphRange();
  };

  const onPointerMove = (event: PointerEvent): void => {
    pointerTarget.set(
      (event.clientX / Math.max(1, window.innerWidth) - 0.5) * 2,
      (event.clientY / Math.max(1, window.innerHeight) - 0.5) * 2
    );
  };
  const onPointerLeave = (): void => {
    pointerTarget.set(0, 0);
  };

  if (quality.parallax) {
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onPointerLeave);
  }
  window.addEventListener("resize", resize, { passive: true });

  const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  resizeObserver?.observe(canvas);
  resizeObserver?.observe(document.documentElement);

  resize();
  if (closingTarget) resizeObserver?.observe(closingTarget);
  const initialScroll = window.scrollY || 0;
  morph = smoothstep(morphStart, morphEnd, initialScroll);

  const renderFrame = (timestamp: number, dt: number): void => {
    const time = timestamp * 0.001;
    const scroll = window.scrollY || 0;
    const morphTarget = smoothstep(morphStart, morphEnd, scroll);
    const response = 1 - Math.exp(-dt * 5.2);
    morph += (morphTarget - morph) * response;
    pointer.lerp(pointerTarget, 1 - Math.exp(-dt * 4.8));

    const open = smoothstep(0.04, 0.98, morph);
    const intactOpacity = 1 - smoothstep(0.06, 0.68, morph);
    const fragmentOpacity = smoothstep(0.16, 0.82, morph);
    intact.visible = intactOpacity > 0.002;
    fragments.visible = fragmentOpacity > 0.002;
    fading[0].material.opacity = fading[0].opacity * intactOpacity;
    fading[1].material.opacity = fading[1].opacity * intactOpacity;
    fading[2].material.opacity = fading[2].opacity * fragmentOpacity;
    fading[3].material.opacity = fading[3].opacity * fragmentOpacity;

    const pointerStrength = 1 - open * 0.64;
    root.position.set(
      THREE.MathUtils.lerp(heroX, 0, open),
      THREE.MathUtils.lerp(heroY, 0, open),
      0
    );
    const rootScale = THREE.MathUtils.lerp(heroScale, 1, open);
    root.scale.setScalar(rootScale);
    root.rotation.x = -pointer.y * 0.11 * pointerStrength + Math.sin(time * 0.23) * 0.018;
    root.rotation.y = pointer.x * 0.16 * pointerStrength + Math.sin(time * 0.18) * 0.025;
    root.rotation.z = THREE.MathUtils.lerp(-0.04, 0.015, open);

    chromeLoopA.rotation.set(
      loopBaseRotations[0].x + Math.sin(time * 0.27) * 0.025,
      loopBaseRotations[0].y + time * 0.035,
      loopBaseRotations[0].z
    );
    chromeLoopB.rotation.set(
      loopBaseRotations[1].x,
      loopBaseRotations[1].y - time * 0.028,
      loopBaseRotations[1].z + Math.sin(time * 0.21) * 0.03
    );
    glassLoop.rotation.set(
      loopBaseRotations[2].x + Math.sin(time * 0.19) * 0.03,
      loopBaseRotations[2].y + time * 0.024,
      loopBaseRotations[2].z
    );
    intact.scale.setScalar(THREE.MathUtils.lerp(1, 0.82, open));

    for (let i = 0; i < fragmentGroups.length; i += 1) {
      const fragment = fragmentGroups[i];
      const targetRotation = fragmentOpenRotations[i];
      fragment.position.copy(fragmentTargets[i]).multiplyScalar(open);
      fragment.rotation.set(
        targetRotation.x * open + Math.sin(time * 0.31 + i) * 0.015,
        targetRotation.y * open + Math.cos(time * 0.27 + i) * 0.018,
        targetRotation.z * open + Math.sin(time * 0.22 + i * 1.7) * 0.012
      );
      fragment.scale.setScalar(THREE.MathUtils.lerp(0.76, 0.58, open));
    }

    const orbitScaleX = THREE.MathUtils.lerp(1, (worldWidth * 0.43) / ORBIT_RX, open);
    const orbitScaleY = THREE.MathUtils.lerp(1, (worldHeight * 0.31) / ORBIT_RY, open);
    orbit.scale.set(orbitScaleX, orbitScaleY, 1);
    orbit.rotation.z = THREE.MathUtils.lerp(-0.16, -0.035, open);
    orbitMain.material.opacity = THREE.MathUtils.lerp(0.23, 0.3, open);
    orbitSecondary.material.opacity = THREE.MathUtils.lerp(0.16, 0.25, open);

    const orbitAngle = time * 0.34 + open * 0.72;
    const orbitCos = Math.cos(orbit.rotation.z);
    const orbitSin = Math.sin(orbit.rotation.z);
    const placeOnOrbit = (object: THREE.Object3D, angle: number, z: number): void => {
      const x = Math.cos(angle) * ORBIT_RX * orbitScaleX;
      const y = Math.sin(angle) * ORBIT_RY * orbitScaleY;
      object.position.set(x * orbitCos - y * orbitSin, x * orbitSin + y * orbitCos, z);
    };
    placeOnOrbit(bead, orbitAngle, 0.48);
    const beadPulse = 1 + Math.sin(time * 2.1) * 0.055;
    bead.scale.setScalar(beadPulse);
    warmRim.position.copy(bead.position);
    warmRim.intensity = 16 + Math.sin(time * 1.9) * 3;

    const cobaltPhases = [1.43, 3.42, 5.18];
    for (let i = 0; i < cobaltPoints.length; i += 1) {
      placeOnOrbit(cobaltPoints[i], -time * (0.075 + i * 0.012) + cobaltPhases[i], 0.24 - i * 0.08);
      cobaltPoints[i].scale.setScalar(0.92 + Math.sin(time * 1.5 + i) * 0.12);
    }

    renderer.clear();
    renderer.render(scene, camera);
  };

  const minFrameDuration = 1000 / quality.maxFps;
  const loop = (timestamp: number): void => {
    if (disposed || !running) return;
    const elapsed = timestamp - lastRenderedAt;
    if (elapsed >= minFrameDuration - 0.5) {
      const dt = lastRenderedAt === 0 ? 1 / quality.maxFps : Math.min(0.1, elapsed / 1000);
      lastRenderedAt = timestamp;
      renderFrame(timestamp, dt);
    }
    rafId = window.requestAnimationFrame(loop);
  };

  const stop = (): void => {
    running = false;
    window.cancelAnimationFrame(rafId);
    rafId = 0;
  };
  const start = (): void => {
    if (disposed || running || document.hidden) return;
    running = true;
    lastRenderedAt = 0;
    rafId = window.requestAnimationFrame(loop);
  };
  const onVisibilityChange = (): void => {
    if (document.hidden) stop();
    else start();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  // Paint once so the canvas can fade in immediately, then let visibility own RAF.
  renderFrame(performance.now(), 1 / quality.maxFps);
  start();

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("resize", resize);
      if (quality.parallax) {
        window.removeEventListener("pointermove", onPointerMove);
        document.documentElement.removeEventListener("pointerleave", onPointerLeave);
      }
      resizeObserver?.disconnect();

      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      scene.traverse((object) => {
        const drawable = object as THREE.Mesh | THREE.Line;
        if (drawable.geometry) geometries.add(drawable.geometry as THREE.BufferGeometry);
        const material = drawable.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((item) => materials.add(item));
        else if (material) materials.add(material);
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      environment.dispose();
      renderer.dispose();
      scene.clear();
    }
  };
}
