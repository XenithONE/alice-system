/**
 * Per-track set dressing — the scenery that gives each circuit an identity.
 *
 * `SET_PIECES` is checked by budgetSelftest for totality: every track in
 * `TRACKS` must have a builder, so a fourth circuit without scenery is a
 * failing gate rather than a bare ribbon of road that nobody notices until
 * it ships. Builders receive a `SetPieceContext` instead of touching the DOM
 * so the same construction runs headless in the budget gate.
 */

import * as THREE from "three";
import type { Track } from "../../sim/track";
import { buildCityLoop } from "./cityLoop";
import { buildNeonCanyon } from "./neonCanyon";
import { buildSkyGarden } from "./skyGarden";
import { buildSunsetCoast } from "./sunsetCoast";

export interface SetPieceContext {
  /** quality.setPieceDetail — 1 full, 0.5 half instances, 0.25 landmarks only. */
  readonly detail: number;
  readonly shadows: boolean;
  /**
   * Canvas-texture seam. Browser passes the real painter; the Node budget gate
   * passes a stub returning a blank texture, so builders never import
   * `document` directly.
   */
  texture(
    size: number,
    draw: (context: CanvasRenderingContext2D, size: number) => void,
  ): THREE.Texture;
}

export interface SetPieceBundle {
  readonly group: THREE.Group;
  update(elapsed: number, cameraX: number, cameraZ: number): void;
  dispose(): void;
}

export type SetPieceBuilder = (
  track: Track,
  context: SetPieceContext,
) => SetPieceBundle;

/**
 * Emissive ceiling, shared by every set piece. The bloom threshold is 1.15
 * (post.ts); values past ~2 grow halos that swallow their own shapes — the
 * exact bug the first cover shoot caught on the rumble strips. One knob here
 * instead of a constant in every builder.
 */
export const EMISSIVE_MAX = 2.0;

export function emissiveStrip(color: number, intensity: number): THREE.MeshBasicMaterial {
  const clamped = Math.min(EMISSIVE_MAX, Math.max(0, intensity));
  const material = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
  material.color.setHex(color).multiplyScalar(clamped);
  return material;
}

function emptyBundle(): SetPieceBundle {
  return {
    group: new THREE.Group(),
    update: () => undefined,
    dispose: () => undefined,
  };
}

export const SET_PIECES: Record<string, SetPieceBuilder> = {
  "sunset-coast": buildSunsetCoast,
  "neon-canyon": buildNeonCanyon,
  "sky-garden": buildSkyGarden,
  "city-loop": buildCityLoop,
};

export function buildSetPieces(
  track: Track,
  context: SetPieceContext,
): SetPieceBundle {
  const builder = SET_PIECES[track.spec.id];
  return builder ? builder(track, context) : emptyBundle();
}
