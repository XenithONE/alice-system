import {
  LinearFilter,
  Mesh,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type Group,
  type Texture
} from "three/webgpu";
import { PLATE } from "../curve";
import { EXHIBITS, LOD, derivativeFor } from "../exhibits";
import { PANEL, type PanelPlacement } from "./corridor";

/**
 * The works themselves, and the memory they are allowed to use.
 *
 * Seventeen covers at 1280x800 with mipmaps is 93 MB of GPU memory. That is
 * not a "might be tight on a phone" number, it is more than the entire budget
 * an integrated GPU will give a browser tab that also wants a depth buffer and
 * a couple of render targets — and the failure mode is not a warning, it is
 * the tab being killed.
 *
 * So every plate hangs at 400 wide from the start, five of them are promoted
 * to 1280 as the reader arrives, and the ones that leave the window go back
 * down and give the big texture back. Worst case 32.1 MB, checked by [G6]
 * against the same arithmetic this file uses rather than against a comment.
 *
 * ── the race this is written around ──────────────────────────────────────
 *
 * Scrolling fast moves the window faster than a texture decodes. Without a
 * token per plate, a promotion that started three windows ago finishes after
 * the demotion that was supposed to cancel it, and the plate ends up holding
 * the large texture it was told to drop — silently, and only when the reader
 * scrolls quickly, which is not how anyone tests.
 */

const ART_PROUD = PANEL.depth / 2 + 0.004;

export interface Plate {
  readonly index: number;
  readonly mesh: Mesh;
  /** Width currently on the GPU, or 0 while the first one is in flight. */
  level: number;
  /** Bumped on every level change; a load whose token is stale is discarded. */
  token: number;
}

export interface PlateSet {
  readonly plates: readonly Plate[];
  /** Meshes to raycast against — the art, not the slab behind it. */
  readonly targets: readonly Mesh[];
  /** Promote the window around `active`, demote everything else. */
  focus(active: number): void;
  bytes(): number;
  dispose(): void;
}

export function buildPlates(
  placements: readonly PanelPlacement[],
  base: string,
  parent: Group
): PlateSet {
  const loader = new TextureLoader();
  const geometry = new PlaneGeometry(PLATE.width, PLATE.height);
  const offset = new Vector3();
  const facing = new Vector3();
  let disposed = false;

  const plates: Plate[] = placements.map((place) => {
    const material = new MeshStandardNodeMaterial({
      color: "#ffffff",
      roughness: 0.62,
      metalness: 0,
      /* Until the first texture lands the plate is a blank white card rather
         than a black one — a gallery with the lights on and nothing hung yet,
         not a hole in the wall. */
      map: null
    });
    const mesh = new Mesh(geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(place.matrix);
    facing.setFromMatrixColumn(place.matrix, 2);
    offset.setFromMatrixPosition(place.matrix).addScaledVector(facing, ART_PROUD);
    mesh.matrix.setPosition(offset);
    mesh.matrixWorldNeedsUpdate = true;
    mesh.userData.exhibit = place.index;
    parent.add(mesh);
    return { index: place.index, mesh, level: 0, token: 0 };
  });

  const load = (plate: Plate, width: number): void => {
    if (disposed || plate.level === width) return;
    const work = EXHIBITS[plate.index];
    if (!work) return;
    const source = derivativeFor(work.cover, width, base);
    const token = ++plate.token;
    loader.load(
      source.url,
      (texture: Texture) => {
        if (disposed || token !== plate.token) {
          /* The window moved on while this decoded. Handing it to the material
             now would install a texture nothing asked for and leak the one it
             replaced. */
          texture.dispose();
          return;
        }
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = 8;
        texture.magFilter = LinearFilter;
        const material = plate.mesh.material as MeshStandardNodeMaterial & { map: Texture | null };
        const previous = material.map;
        material.map = texture;
        material.needsUpdate = true;
        previous?.dispose();
        plate.level = source.width;
      },
      undefined,
      () => {
        /* A 404 leaves the blank card, which is the same thing the catalogue
           shows before its images arrive. Nothing to report to the reader. */
        if (token === plate.token) plate.level = 0;
      }
    );
  };

  /* Everything at the small size immediately: the corridor should never show a
     blank wall waiting for a decode, and 17 x 0.53 MB is affordable outright. */
  for (const plate of plates) load(plate, LOD.base);

  return {
    plates,
    targets: plates.map((p) => p.mesh),
    focus(active: number) {
      for (const plate of plates) {
        const near = Math.abs(plate.index - active) <= LOD.window;
        load(plate, near ? LOD.near : LOD.base);
      }
    },
    bytes() {
      return plates.reduce((total, plate) => {
        const height = Math.round(plate.level * 0.625);
        return total + Math.round(plate.level * height * 4 * (4 / 3));
      }, 0);
    },
    dispose() {
      disposed = true;
      for (const plate of plates) {
        const material = plate.mesh.material as MeshStandardNodeMaterial & { map: Texture | null };
        material.map?.dispose();
        material.dispose();
      }
      geometry.dispose();
    }
  };
}
