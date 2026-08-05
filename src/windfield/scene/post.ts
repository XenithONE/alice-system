import { RenderPipeline, type Camera, type Scene, type WebGPURenderer } from "three/webgpu";
import { emissive, mrt, output, pass, renderOutput } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { fxaa } from "three/addons/tsl/display/FXAANode.js";

/**
 * The post chain, and the two ordering rules that are easy to get wrong.
 *
 * 1. EVERYTHING HDR COMES FIRST, IN LINEAR. Bloom has to see values above 1 or
 *    it has nothing to bloom — the sun on water is the whole point. three's
 *    renderer keeps intermediate passes linear automatically and only applies
 *    tone mapping and the output colour space when drawing to the screen, so
 *    the chain below is linear right up to renderOutput().
 *
 * 2. FXAA COMES AFTER. It reads luminance differences to find edges and it
 *    expects sRGB; run it on linear values and it under-detects everything in
 *    the shadows. That is why `outputColorTransform` is switched off and
 *    renderOutput() is placed by hand: it is the only way to get anything
 *    after the transform.
 *
 * ── selective bloom, via MRT ──────────────────────────────────────────────
 *
 * Blooming the whole frame turns a bright day into fog. The scene pass writes
 * a second target holding only emissive, so the sun disc and the specular
 * glitter on the sea glow and the grass does not.
 */

export interface Post {
  render(): void;
  setSize(): void;
  dispose(): void;
}

/** Strength, radius, threshold. Restrained on purpose — see above. */
const BLOOM = { strength: 0.62, radius: 0.55, threshold: 0.0 } as const;

export function buildPost(renderer: WebGPURenderer, scene: Scene, camera: Camera): Post {
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, emissive }));

  const colour = scenePass.getTextureNode("output");
  const glow = scenePass.getTextureNode("emissive");

  const lit = colour.add(bloom(glow, BLOOM.strength, BLOOM.radius, BLOOM.threshold));

  const pipeline = new RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  pipeline.outputNode = fxaa(renderOutput(lit));

  return {
    render() {
      pipeline.render();
    },
    setSize() {
      /* PassNode owns its render targets and resizes them from the renderer's
         own size; nothing to do here yet. Kept as a seam so the caller does not
         have to learn that when a later effect does need it. */
    },
    dispose() {
      pipeline.dispose();
    }
  };
}
