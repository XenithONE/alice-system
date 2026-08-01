/**
 * The post-processing stack, and the ladder for shedding it.
 *
 * Chain: RenderPass → UnrealBloomPass → grade → SMAA/FXAA → OutputPass.
 * AA runs AFTER the grade pass on purpose — the grade's chromatic fringe and
 * radial smear re-sharpen edges, so AA before it would be partially undone —
 * and before OutputPass, matching three's own SMAA example ordering.
 *
 * `shedNext()` implements the one-way degrade ladder (cascades → AA → bloom →
 * dpr ×0.85 → shadows). Prior art is the portfolio hero (glScene.ts): measure
 * over a 90-frame window, shed exactly one feature, never restore. Shadows go
 * last because toggling them forces a lights-state reprogram hitch; a dpr
 * notch is cheaper and usually bigger. Cascades go first because dropping to
 * one shadow map leaves the near shadow — the one under the player's kart —
 * exactly where it was, and takes back two full shadow passes.
 */

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";
import type { KartQuality } from "./quality";

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
    uWet: { value: 0 },
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
    uniform float uWet;
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

      // 25% blend, edges only. Any stronger and the sun grows a magenta/cyan
      // ring — an aberration you notice is a filter, not a lens.
      float fringe = (0.0006 + uSpeed * 0.0011) * smoothstep(0.2, 0.85, radius);
      colour.r = texture2D(tDiffuse, centre + offset * (1.0 - fringe)).r * 0.25 + colour.r * 0.75;
      colour.b = texture2D(tDiffuse, centre + offset * (1.0 + fringe)).b * 0.25 + colour.b * 0.75;

      float vignette = smoothstep(1.05, uVignette * 0.42, radius);
      colour *= mix(0.72, 1.0, vignette);
      colour = mix(colour, colour * colour * (3.0 - 2.0 * colour), 0.18);
      // Rain cools and deepens the frame slightly.
      colour = mix(colour, colour * vec3(0.92, 0.97, 1.06), uWet * 0.5);
      colour += uShake * 0.05;

      gl_FragColor = vec4(colour, 1.0);
    }
  `,
};

export type ShedStage = "csm" | "aa" | "bloom" | "dpr" | "shadows";

export interface PostStackHooks {
  /** Called when the ladder reaches the shadows rung (post owns no lights). */
  readonly onShedShadows: () => void;
  /**
   * Called at the csm rung: drop to a single shadow map. First on the ladder
   * because it is the one rung whose absence the player is least likely to
   * name — the near shadow, the one under their own kart, is untouched, and
   * only the far cascades go. Every rung below it changes something in the
   * middle of the screen.
   */
  readonly onShedCascades: () => void;
}

export interface PostStack {
  /** Null on LOW — the caller renders directly and keeps MSAA. */
  readonly composer: EffectComposer | null;
  setSpeed(value: number): void;
  setShake(value: number): void;
  setWet(value: number): void;
  setSize(width: number, height: number): void;
  /** Sheds the next rung; returns what was shed, or null when the ladder is spent. */
  shedNext(): ShedStage | null;
  readonly shedStages: readonly ShedStage[];
  dispose(): void;
}

export function createPostStack(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  quality: KartQuality,
  bloomStrength: number,
  hooks: PostStackHooks,
): PostStack {
  const shed: ShedStage[] = [];

  if (!quality.postProcessing) {
    return {
      composer: null,
      setSpeed: () => undefined,
      setShake: () => undefined,
      setWet: () => undefined,
      setSize: () => undefined,
      shedNext: () => {
        // LOW has nothing to shed but shadows are already off; report spent.
        return null;
      },
      shedStages: shed,
      dispose: () => undefined,
    };
  }

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  let bloomPass: UnrealBloomPass | null = null;
  if (quality.bloom) {
    /*
     * Threshold above 1. Bloom runs before tone mapping, so it sees linear
     * HDR: a plain white curb under a 3.4-intensity sun sits near 3.0, and a
     * lower threshold made every painted line glow like a filament. Only
     * genuinely emissive things should bloom.
     */
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      bloomStrength,
      0.55,
      1.15,
    );
    composer.addPass(bloomPass);
  }

  const gradePass = new ShaderPass(GRADE_SHADER);
  composer.addPass(gradePass);

  let smaaPass: SMAAPass | null = null;
  let fxaaPass: ShaderPass | null = null;
  if (quality.aa === "smaa") {
    smaaPass = new SMAAPass();
    composer.addPass(smaaPass);
  } else if (quality.aa === "fxaa") {
    fxaaPass = new ShaderPass(FXAAShader);
    composer.addPass(fxaaPass);
  }

  composer.addPass(new OutputPass());

  let width = 1;
  let height = 1;

  function applyFxaaResolution(): void {
    if (!fxaaPass) return;
    const dpr = renderer.getPixelRatio();
    const resolution = fxaaPass.material.uniforms.resolution!.value as THREE.Vector2;
    resolution.set(1 / (width * dpr), 1 / (height * dpr));
  }

  return {
    composer,
    setSpeed(value) {
      gradePass.uniforms.uSpeed!.value = value;
    },
    setShake(value) {
      gradePass.uniforms.uShake!.value = value;
    },
    setWet(value) {
      gradePass.uniforms.uWet!.value = value;
    },
    setSize(nextWidth, nextHeight) {
      width = Math.max(1, nextWidth);
      height = Math.max(1, nextHeight);
      composer.setSize(width, height);
      bloomPass?.setSize(width, height);
      applyFxaaResolution();
    },
    shedNext() {
      if (!shed.includes("csm") && quality.shadowCascades > 1) {
        hooks.onShedCascades();
        shed.push("csm");
        return "csm";
      }
      if (!shed.includes("aa") && (smaaPass || fxaaPass)) {
        const pass = smaaPass ?? fxaaPass!;
        composer.removePass(pass);
        pass.dispose();
        smaaPass = null;
        fxaaPass = null;
        shed.push("aa");
        return "aa";
      }
      if (!shed.includes("bloom") && bloomPass) {
        composer.removePass(bloomPass);
        bloomPass.dispose();
        bloomPass = null;
        shed.push("bloom");
        return "bloom";
      }
      if (!shed.includes("dpr")) {
        renderer.setPixelRatio(renderer.getPixelRatio() * 0.85);
        composer.setSize(width, height);
        applyFxaaResolution();
        shed.push("dpr");
        return "dpr";
      }
      if (!shed.includes("shadows") && quality.shadows) {
        hooks.onShedShadows();
        shed.push("shadows");
        return "shadows";
      }
      return null;
    },
    shedStages: shed,
    dispose() {
      bloomPass?.dispose();
      gradePass.dispose();
      smaaPass?.dispose();
      fxaaPass?.dispose();
      composer.dispose();
    },
  };
}
