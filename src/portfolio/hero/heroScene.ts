import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { HeroQuality } from "../quality";
import { scrollState } from "../useLenis";

// "IRIS / SIGNAL" — an obsidian pupil ringed by breathing metal blades.
// three-only, fully procedural, no postprocessing (clean PMREM speculars instead of bloom).

export interface HeroScene {
  dispose: () => void;
}

const ACCENT = new THREE.Color("#cdaa6d");

export function createHeroScene(canvas: HTMLCanvasElement, quality: HeroQuality): HeroScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(quality.dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 40);
  camera.position.set(0, 0, 7.2);

  // Clean studio reflections for the metal/glass materials.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  pmrem.dispose();

  const root = new THREE.Group();
  // Sit the iris right of center so the wordmark owns the left half.
  root.position.set(1.9, 0.25, 0);
  scene.add(root);

  // Pupil — obsidian sphere.
  const pupil = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 32),
    new THREE.MeshStandardMaterial({ color: 0x111214, metalness: 1.0, roughness: 0.18 })
  );
  root.add(pupil);

  // Iris — ring of thin metal blades (single InstancedMesh).
  const bladeCount = quality.blades;
  const bladeGeo = new THREE.BoxGeometry(0.012, 0.34, 0.012);
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x9a9aa2, metalness: 0.9, roughness: 0.35 });
  const blades = new THREE.InstancedMesh(bladeGeo, bladeMat, bladeCount);
  const dummy = new THREE.Object3D();
  const bladeColor = new THREE.Color();
  for (let i = 0; i < bladeCount; i += 1) {
    placeBlade(dummy, i, bladeCount, 0);
    blades.setMatrixAt(i, dummy.matrix);
    if (i % 12 === 0) bladeColor.copy(ACCENT);
    else bladeColor.setRGB(0.6, 0.6, 0.63);
    blades.setColorAt(i, bladeColor);
  }
  blades.instanceMatrix.needsUpdate = true;
  if (blades.instanceColor) blades.instanceColor.needsUpdate = true;
  // Low-key accent emission on every 12th blade via a second, tiny InstancedMesh
  // would cost another draw call — instead let instance color + env reflections carry it.
  const iris = new THREE.Group();
  iris.add(blades);
  root.add(iris);

  // Hairline halo torus.
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(2.1, 0.008, 8, 128),
    new THREE.MeshStandardMaterial({ color: 0x3a3a40, metalness: 0.85, roughness: 0.4 })
  );
  root.add(halo);

  // Accent ring — a faint emissive inner torus that reads as the iris rim light.
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(1.55, 0.006, 8, 96),
    new THREE.MeshStandardMaterial({
      color: 0x121212,
      emissive: ACCENT,
      emissiveIntensity: 0.6,
      metalness: 0.4,
      roughness: 0.5
    })
  );
  root.add(rim);

  // Background particle disc for depth.
  let points: THREE.Points | null = null;
  if (quality.particles > 0) {
    const positions = new Float32Array(quality.particles * 3);
    for (let i = 0; i < quality.particles; i += 1) {
      const radius = 2.6 + Math.random() * 5.5;
      const angle = Math.random() * Math.PI * 2;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = Math.sin(angle) * radius * 0.7;
      positions[i * 3 + 2] = -1.5 - Math.random() * 4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0x6a6a72,
        size: 0.015,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    root.add(points);
  }

  // Soft key light so the pupil silhouette separates from the background.
  const key = new THREE.DirectionalLight(0xfff4e0, 0.5);
  key.position.set(-3, 2, 4);
  scene.add(key);

  // ---- sizing ----
  const resize = (): void => {
    const width = canvas.clientWidth || window.innerWidth || 1;
    const height = canvas.clientHeight || window.innerHeight || 1;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    // On narrow screens center the iris behind the type instead of clipping right.
    root.position.x = width < 780 ? 0 : 1.9;
  };
  resize();
  window.addEventListener("resize", resize);

  // ---- pointer parallax ----
  const pointerTarget = new THREE.Vector2();
  const pointerCurrent = new THREE.Vector2();
  const onPointerMove = (e: PointerEvent): void => {
    pointerTarget.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
  };
  if (quality.parallax) window.addEventListener("pointermove", onPointerMove, { passive: true });

  // ---- frame loop ----
  let rafId = 0;
  let disposed = false;
  const clock = new THREE.Clock();

  const renderFrame = (): void => {
    const t = clock.getElapsedTime();

    iris.rotation.z = t * 0.03;
    pupil.rotation.y = -t * 0.01;
    halo.rotation.z = -t * 0.012;

    // Blade breathing — cheap at <=144 instances.
    for (let i = 0; i < bladeCount; i += 1) {
      placeBlade(dummy, i, bladeCount, Math.sin(t * 0.4 + i * 0.26) * 0.05);
      blades.setMatrixAt(i, dummy.matrix);
    }
    blades.instanceMatrix.needsUpdate = true;

    if (points) points.rotation.z = t * 0.006;

    // The eye follows the pointer, gently.
    pointerCurrent.lerp(pointerTarget, 0.04);
    camera.position.x = pointerCurrent.x * 0.55;
    camera.position.y = -pointerCurrent.y * 0.35;
    camera.lookAt(root.position.x, root.position.y, 0);

    // Scroll parallax: the whole scene eases up + fades as the hero leaves.
    const scroll = Math.min(1, scrollState.y / (window.innerHeight || 1));
    root.position.y = 0.25 + scroll * 1.2;
    canvas.style.opacity = String(1 - scroll * 0.9);

    renderer.render(scene, camera);
  };

  if (quality.animate) {
    const loop = (): void => {
      if (disposed) return;
      renderFrame();
      rafId = window.requestAnimationFrame(loop);
    };
    rafId = window.requestAnimationFrame(loop);
  } else {
    // Reduced motion / low: render one handsome still frame.
    renderFrame();
  }

  return {
    dispose: () => {
      disposed = true;
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      if (quality.parallax) window.removeEventListener("pointermove", onPointerMove);
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      });
      blades.dispose();
      envRT.dispose();
      renderer.dispose();
    }
  };
}

function placeBlade(dummy: THREE.Object3D, index: number, count: number, breathe: number): void {
  const angle = (index / count) * Math.PI * 2;
  const radius = 1.55;
  dummy.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
  dummy.rotation.set(0, 0, angle + Math.PI / 2 + breathe);
  dummy.updateMatrix();
}
