import { RenderPipeline, type Camera, type Scene, type WebGPURenderer } from "three/webgpu";
import { pass, uniform } from "three/tsl";
import { dof } from "three/addons/tsl/display/DepthOfFieldNode.js";

/**
 * Depth of field, and the reason this page needs WebGPU at all.
 *
 * Not a vignette and not a blur-by-distance fake: the pass reads the scene's
 * own view-space depth and computes a circle of confusion per pixel, then
 * gathers eighty samples on a golden-angle disc. The focal plane is driven to
 * whatever the reader is standing in front of, so walking up the corridor
 * racks focus from the far bend onto the picture and lets the near wall go
 * soft — the thing a real lens does and a CSS filter cannot.
 *
 * ── the honest cost ──────────────────────────────────────────────────────
 *
 * Six render targets and a 80-tap gather. That is why it is the first thing
 * measured after it is added and the first thing that would come out again if
 * the frame budget said so.
 *
 * ── the risk that was flagged before writing it ──────────────────────────
 *
 * pass(scene, camera, { samples }) carries a JSDoc note about being WebGL2
 * only, which may just be stale. It is not used: MSAA is left off and the
 * pipeline runs at samples 0. The corridor is flat walls and rectangles, so
 * the edges that would benefit are the panel silhouettes alone, and those are
 * exactly the edges depth of field softens anyway.
 */

export interface Focus {
  /** Metres from the camera to whatever should be sharp. */
  set(distance: number): void;
}

export interface Pipeline extends Focus {
  render(): void;
  dispose(): void;
}

/** Metres either side of the focal plane before a thing is fully soft. */
const FOCAL_LENGTH = 5.5;
/** Unitless. Past about 3 the bokeh discs start reading as a smear. */
const BOKEH = 2.1;

export function buildPipeline(renderer: WebGPURenderer, scene: Scene, camera: Camera): Pipeline {
  const scenePass = pass(scene, camera);
  const focus = uniform(11);
  const graded = dof(scenePass.getTextureNode(), scenePass.getViewZNode(), focus, FOCAL_LENGTH, BOKEH);
  const pipeline = new RenderPipeline(renderer, graded);

  return {
    set(distance: number) {
      /* Clamped, because the reader can reach the ends of the corridor where
         there is no next plate and an unclamped focal plane would snap to the
         far clip and blur the entire room. */
      focus.value = Math.min(Math.max(distance, 2), 40);
    },
    render() {
      pipeline.render();
    },
    dispose() {
      pipeline.dispose();
    }
  };
}
