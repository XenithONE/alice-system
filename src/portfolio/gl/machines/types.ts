import type * as THREE from "three";

/** Shared PBR material set injected into every machine builder so all exhibits
 * speak one material language (textured wood/brass/canvas/rope/iron). */
export interface MachineMaterials {
  /** warm mid-tone worked timber (spars, frames) */
  wood: THREE.MeshStandardMaterial;
  /** darker dense timber (stocks, bases, pedestals) */
  woodDark: THREE.MeshStandardMaterial;
  /** polished brass/bronze fittings, pins, buckles */
  brass: THREE.MeshStandardMaterial;
  /** stretched canvas / parchment membrane (double-sided, slightly translucent) */
  canvas: THREE.MeshStandardMaterial;
  /** twisted hemp rope / sinew skeins */
  rope: THREE.MeshStandardMaterial;
  /** dark forged iron (bolt heads, plates, tips) */
  iron: THREE.MeshStandardMaterial;
}

export interface Machine {
  /** whole model, centered at origin, real-world-ish scale ~3-4 units wide */
  group: THREE.Group;
  /**
   * @param time seconds (0 when reduced motion — animation must freeze into a
   *   composed pose, not a degenerate one)
   * @param drive 0..1 mechanism engagement (wing stroke / string draw); the
   *   scene drives this from scroll + hover, animate smoothly around it
   */
  update(time: number, drive: number): void;
}
