import { Color, PMREMGenerator, Scene, Vector3, type RenderTarget, type WebGPURenderer } from "three/webgpu";
import { SkyMesh } from "three/addons/objects/SkyMesh.js";

/**
 * The sky, and with it every colour in the scene.
 *
 * ── why this is the first thing that was wrong ────────────────────────────
 *
 * The field used to have a flat `Color` for a background, a linear `Fog` to
 * another flat colour, one HemisphereLight, and NO TONE MAPPING AT ALL —
 * measured: `grep toneMapping src/` found the WebGL arena setting ACESFilmic
 * with an exposure, and neither WebGPU page setting anything. A renderer on
 * NoToneMapping writes linear values straight out, so a bright sky clips to
 * white and everything under it sits in the bottom third of the range. That is
 * not a lighting problem that more grass fixes.
 *
 * ── SkyMesh, not Sky ──────────────────────────────────────────────────────
 *
 * `three/addons/objects/Sky.js` builds a ShaderMaterial and its own header says
 * it only works with WebGLRenderer. `SkyMesh.js` is the node-material twin: the
 * same Preetham analytic daylight model, plus an animated FBM cloud layer the
 * WebGL one does not have, with everything exposed as uniforms. Every `*Mesh`
 * addon is the WebGPU one; the plain name is dead on this backend.
 *
 * ── the sky lights the scene, not just the background ─────────────────────
 *
 * `PMREMGenerator.fromScene()` bakes the sky into an environment map and that
 * becomes `scene.environment`. This is what makes grass in shadow read as blue
 * at noon and orange at sunset instead of as "the ambient colour someone typed
 * in". It must run after `renderer.init()` — before that it logs a warning and
 * silently defers — and the sun disc is switched off while baking, because a
 * 10,000:1 highlight in a 256px cube map turns into a square artefact.
 */

export interface Sky {
  readonly mesh: SkyMesh;
  /** Unit vector from the ground toward the sun. Read by the light and the sea. */
  readonly sunDirection: Vector3;
  /** How high the sun is, in radians. Negative after it sets. */
  readonly elevation: number;
  /** Colour to fog the horizon with, so distance dissolves into the sky. */
  readonly horizon: Color;
  /** 0 = midnight, 0.25 = dawn, 0.5 = noon, 0.75 = dusk. */
  setTime(dayFraction: number): void;
  /** Re-bakes the environment only if the sun has moved enough to matter. */
  refresh(): void;
  dispose(): void;
}

/** How high the sun climbs at noon. A tropical latitude, near overhead. */
const MAX_ELEVATION = (78 * Math.PI) / 180;
/**
 * How far the sun must move before the environment is baked again.
 *
 * A PMREM bake renders the sky into a cube map and filters it — far too much
 * to do every frame, and completely unnecessary: over three degrees the ambient
 * changes by less than the dithering. Three degrees over a three-minute cycle
 * is a bake roughly every 1.5 seconds, and only while the sun is moving.
 */
const REBAKE_RADIANS = (3 * Math.PI) / 180;

export function buildSky(renderer: WebGPURenderer, scene: Scene): Sky {
  const mesh = new SkyMesh();
  mesh.scale.setScalar(45000);
  /* A clear tropical day. Turbidity and rayleigh are the two that carry the
     time of day; the cloud layer is left light so the horizon stays readable. */
  mesh.turbidity.value = 4.2;
  mesh.rayleigh.value = 1.6;
  mesh.mieCoefficient.value = 0.006;
  mesh.mieDirectionalG.value = 0.82;
  mesh.cloudCoverage.value = 0.36;
  mesh.cloudDensity.value = 0.32;
  mesh.cloudScale.value = 0.00022;
  mesh.cloudSpeed.value = 0.00008;
  /*
   * The sky is not in the fog. It is 45 km away and the scene's fog ends at
   * about 180 m, so leaving this on paints the entire dome 100% fog colour —
   * which renders as a flat grey ceiling and looks exactly like "the sky did
   * not load". It did load; it was being erased by a rule meant for terrain.
   */
  mesh.material.fog = false;
  scene.add(mesh);

  /* The bake needs the sky alone: a cube map of the sky with an island in it
     would light the island with a picture of itself. */
  const bakeScene = new Scene();
  const bakeSky = new SkyMesh();
  bakeSky.scale.setScalar(45000);
  bakeSky.material.fog = false;
  bakeScene.add(bakeSky);

  const pmrem = new PMREMGenerator(renderer);
  let baked: RenderTarget | null = null;
  let bakedAt = Number.NEGATIVE_INFINITY;

  const sunDirection = new Vector3(0, 1, 0);
  const horizon = new Color();
  let elevation = MAX_ELEVATION;

  const copyUniforms = (): void => {
    bakeSky.turbidity.value = mesh.turbidity.value;
    bakeSky.rayleigh.value = mesh.rayleigh.value;
    bakeSky.mieCoefficient.value = mesh.mieCoefficient.value;
    bakeSky.mieDirectionalG.value = mesh.mieDirectionalG.value;
    bakeSky.cloudCoverage.value = mesh.cloudCoverage.value;
    bakeSky.cloudDensity.value = mesh.cloudDensity.value;
    bakeSky.sunPosition.value.copy(mesh.sunPosition.value);
  };

  const api: Sky = {
    mesh,
    sunDirection,
    get elevation() {
      return elevation;
    },
    horizon,

    setTime(dayFraction: number) {
      const t = dayFraction - Math.floor(dayFraction);
      /* Noon at 0.5, horizon at 0.25 and 0.75, lowest at midnight. One
         expression, so the sun, the light and the sea can never disagree about
         what time it is. */
      elevation = MAX_ELEVATION * Math.sin((t - 0.25) * Math.PI * 2);
      const azimuth = t * Math.PI * 2 + Math.PI * 0.35;
      const horizontal = Math.cos(elevation);
      sunDirection.set(
        horizontal * Math.sin(azimuth),
        Math.sin(elevation),
        horizontal * Math.cos(azimuth)
      );
      mesh.sunPosition.value.copy(sunDirection);

      /*
       * Air thickens toward the horizon. Turbidity and rayleigh are what turn
       * a blue noon into an orange evening in the Preetham model, so they are
       * driven from the same elevation rather than from a second clock.
       */
      const high = Math.max(0, Math.sin(elevation));
      mesh.turbidity.value = 2.6 + (1 - high) * 6.5;
      mesh.rayleigh.value = 0.6 + high * 2.2;
      mesh.mieCoefficient.value = 0.004 + (1 - high) * 0.012;

      /* Fog takes the horizon's own colour, so the far edge of the sea
         dissolves into the sky instead of ending at a line. */
      const warm = Math.pow(1 - high, 2);
      horizon.setRGB(0.62 + warm * 0.34, 0.74 - warm * 0.24, 0.86 - warm * 0.5);
      if (elevation < 0) {
        /* After sunset the horizon is not a warmer day, it is a darker night. */
        const night = Math.min(1, -elevation / 0.4);
        horizon.multiplyScalar(1 - night * 0.86);
      }
    },

    refresh() {
      if (Math.abs(elevation - bakedAt) < REBAKE_RADIANS && baked) return;
      bakedAt = elevation;
      copyUniforms();
      /* Off while baking: the disc is thousands of times brighter than the sky
         around it and a cube map cannot carry that without ringing. */
      bakeSky.showSunDisc.value = 0;
      const next = pmrem.fromScene(bakeScene, 0.05);
      baked?.dispose();
      baked = next;
      scene.environment = next.texture;
    },

    dispose() {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.dispose();
      bakeSky.geometry.dispose();
      bakeSky.material.dispose();
      baked?.dispose();
      pmrem.dispose();
      scene.environment = null;
    }
  };

  api.setTime(0.42);
  return api;
}
