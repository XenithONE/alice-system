import type * as THREE from "three";

/** Shared flat-shaded low-poly material set injected into every builder (machines,
 * ship, props) so the whole world speaks one material language. All are solid
 * colors with `flatShading: true` and NO textures — the faceted look IS the style. */
export interface MachineMaterials {
  /** warm mid-tone worked timber (spars, frames, deck) */
  wood: THREE.MeshStandardMaterial;
  /** darker dense timber (stocks, hull strakes, pedestals) */
  woodDark: THREE.MeshStandardMaterial;
  /** low-metal gold fittings, pins, buckles */
  brass: THREE.MeshStandardMaterial;
  /** stretched canvas / parchment membrane (double-sided) */
  canvas: THREE.MeshStandardMaterial;
  /** twisted hemp rope / rigging / lashings */
  rope: THREE.MeshStandardMaterial;
  /** dark forged iron (bolt heads, plates, tips) */
  iron: THREE.MeshStandardMaterial;
  /** off-white sail cloth (double-sided) */
  sail: THREE.MeshStandardMaterial;
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
