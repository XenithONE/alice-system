import {
  DataTexture,
  ImageBitmapLoader,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Texture,
  Vector3,
  type Group
} from "three/webgpu";
import { PLATE } from "../curve";
import { EXHIBITS, LOD, derivativeFor } from "../exhibits";
import { PANEL, type PanelPlacement } from "./corridor";

/**
 * The works themselves, and the memory they are allowed to use.
 *
 * Seventeen covers at 1280x800 with mipmaps is 93 MB of GPU memory — more than
 * an integrated GPU will give a tab that also wants a depth buffer and two
 * post-processing targets, and the failure mode is the tab being killed. So
 * every plate hangs at 400, five are promoted to 1280 around the reader, and
 * the rest hand the big texture back. [G6] checks the arithmetic.
 *
 * ── WHY THIS FILE WAS REWRITTEN: the measured stutter ────────────────────
 *
 * The published corridor hitched for 383 ms, twice, during a 22-second scroll.
 * Recording every rAF delta and the texture footprint alongside it put the
 * stalls exactly on the steps where the footprint jumped, and reading three's
 * WebGPU backend explained why one `focus()` could cost that much:
 *
 *   the decode is on the main thread — TextureLoader uses ImageLoader, which
 *   uses an <img> element and a load event, not createImageBitmap;
 *   the upload is copyExternalImageToTexture;
 *   and mipmap generation builds its OWN command encoder and issues its OWN
 *   queue.submit, one render pass per level — ten of them for a 1280x800.
 *
 * Five of those in one call is 27.3 MB and fifty extra render passes, injected
 * mid-frame. Three things made it worse than that number suggests:
 *
 *   A  the camera EASES toward the scroll (EASE_TAU 0.14 in world.ts), so a
 *      flick from work 2 to work 10 walks the active index through 3,4,5,6,7,8
 *      on the way — promoting each one and demoting it again inside half a
 *      second. Every one was fetched, decoded, uploaded, mipmapped, discarded.
 *   B  the old guard compared `plate.level`, which was only written when a load
 *      SUCCEEDED. While a 1280 was in flight the plate still read as 400, so
 *      the next focus() started a second load of the same file. Six index
 *      ticks during one fetch meant six fetches.
 *   C  nothing cached the small texture, so demoting re-fetched, re-decoded,
 *      re-uploaded and re-mipmapped a file the plate had held minutes ago.
 *
 * What is NOT the cause, though it reads like it: `material.needsUpdate` on a
 * texture-to-texture swap. three's render-object cache key covers mapping,
 * min/mag filter and the three wrap modes and nothing else — not the image,
 * not its size — so swapping 400 for 1280 never rebuilt a pipeline. The one
 * place that DID force a synchronous device.createRenderPipeline was `map`
 * going from null to a Texture, and because all seventeen materials are
 * structurally identical they share a cache key: one build, at boot, once.
 * The placeholder below removes even that.
 *
 * So: cache both levels, wait for the window to settle, track what is in
 * flight, upload one at a time, decode off the main thread, and never let the
 * material's node graph change shape.
 */

const ART_PROUD = PANEL.depth / 2 + 0.004;

/**
 * How long the active index must hold still before anything is promoted.
 *
 * Long enough that a flick through six works touches none of them, short
 * enough that stopping in front of one sharpens it before the reader has
 * finished stopping. Demotion is swept at the same moment.
 */
const SETTLE_MS = 140;

/**
 * How many decodes may be in flight. One.
 *
 * The queue exists so that five promotions become five frames with one upload
 * each rather than one frame with five. Raising this puts the mipmap passes
 * back into the same frame, which is the thing being fixed.
 */
const IN_FLIGHT = 1;

/**
 * How far a plate may be from the reader and still hold its big texture.
 *
 * Equal to the window, i.e. no hysteresis — and that is a decision, not an
 * omission. Keeping one extra index either side would spare a re-fetch when
 * someone drifts across a boundary, but it raises the worst case from five
 * large textures to seven, and 7 x 5.46 + 17 x 0.53 is 47 MB against [G6]'s
 * 40 MB ceiling. Now that the small texture is cached for the life of the
 * page, the settle timer below is already what protects against churn: drifting
 * across a boundary has to hold still for 140 ms before it costs anything.
 */
const KEEP = LOD.window;

export interface Plate {
  readonly index: number;
  readonly mesh: Mesh;
  readonly material: MeshStandardNodeMaterial & { map: Texture | null };
  /** Kept for the life of the page once it arrives. 0.53 MB. */
  small: Texture | null;
  /** Only while the plate is in or beside the window. 5.46 MB. */
  large: Texture | null;
  /** Width currently on the material. 0 while it is still the placeholder. */
  shown: number;
  /** Width being fetched right now. 0 when idle. Separate from `shown` on
      purpose — conflating them is amplifier B above. */
  requested: number;
}

export interface PlateSet {
  readonly plates: readonly Plate[];
  /** Meshes to raycast against — the art, not the slab behind it. */
  readonly targets: readonly Mesh[];
  /** The reader is at `active`. Promotion happens once this holds still. */
  focus(active: number): void;
  bytes(): number;
  dispose(): void;
}

/**
 * One white pixel, shared by every plate, installed before the first frame.
 *
 * Its filters are set to match a decoded cover's defaults exactly, because
 * three's render-object cache key is built from precisely those fields. Leave
 * a DataTexture on its own defaults (Nearest/Nearest) and the first real
 * texture changes the key, which is the pipeline rebuild this exists to avoid
 * — the fix would look like it worked while doing nothing.
 */
function buildPlaceholder(): DataTexture {
  const texture = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export function buildPlates(
  placements: readonly PanelPlacement[],
  base: string,
  parent: Group
): PlateSet {
  /* createImageBitmap, not an <img>. This is the one change that takes the
     decode off the main thread entirely rather than merely spreading it out. */
  const loader = new ImageBitmapLoader();
  loader.setOptions({ imageOrientation: "flipY" });

  const geometry = new PlaneGeometry(PLATE.width, PLATE.height);
  const placeholder = buildPlaceholder();
  const offset = new Vector3();
  const facing = new Vector3();
  let disposed = false;

  const plates: Plate[] = placements.map((place) => {
    const material = new MeshStandardNodeMaterial({
      color: "#ffffff",
      roughness: 0.62,
      metalness: 0,
      /* Never null. A gallery with the lights on and nothing hung yet. */
      map: placeholder
    }) as MeshStandardNodeMaterial & { map: Texture | null };
    const mesh = new Mesh(geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(place.matrix);
    facing.setFromMatrixColumn(place.matrix, 2);
    offset.setFromMatrixPosition(place.matrix).addScaledVector(facing, ART_PROUD);
    mesh.matrix.setPosition(offset);
    mesh.matrixWorldNeedsUpdate = true;
    mesh.userData.exhibit = place.index;
    parent.add(mesh);
    return { index: place.index, mesh, material, small: null, large: null, shown: 0, requested: 0 };
  });

  const held = (plate: Plate, width: number): Texture | null =>
    width >= LOD.near ? plate.large : plate.small;

  /**
   * Put a texture the plate already holds onto the material.
   *
   * No `material.needsUpdate`. With a non-null map from the first frame,
   * three's NodeMaterialObserver watches the map's id and version and asks for
   * a new bind group when either moves — which is the whole cost. Bumping the
   * material version instead would make the backend re-derive the pipeline
   * cache key for a pipeline that has not changed.
   */
  const show = (plate: Plate, width: number): void => {
    const texture = held(plate, width);
    if (!texture || plate.shown === width) return;
    plate.material.map = texture;
    plate.shown = width;
  };

  /** Give the 5.46 MB back, falling to the cached small first. */
  const drop = (plate: Plate): void => {
    if (!plate.large) return;
    if (plate.shown >= LOD.near) show(plate, LOD.base);
    plate.large.dispose();
    plate.large = null;
  };

  /* One at a time, nearest first. Rebuilt from scratch whenever the window
     moves, so a want from three windows ago never runs. */
  let queue: Array<{ plate: Plate; width: number }> = [];
  let inFlight = 0;

  const pump = (): void => {
    while (!disposed && inFlight < IN_FLIGHT && queue.length > 0) {
      const job = queue.shift()!;
      const work = EXHIBITS[job.plate.index];
      if (!work || held(job.plate, job.width) || job.plate.requested === job.width) continue;
      const source = derivativeFor(work.cover, job.width, base);
      job.plate.requested = job.width;
      inFlight += 1;
      loader.load(
        source.url,
        (bitmap: ImageBitmap) => {
          if (disposed) {
            bitmap.close();
            inFlight -= 1;
            return;
          }
          const texture = new Texture(bitmap as unknown as HTMLImageElement);
          texture.colorSpace = SRGBColorSpace;
          texture.anisotropy = 8;
          /* flipY false because the bitmap was already flipped at decode time,
             by the loader option above. Doing it in both places, or neither,
             hangs every cover upside down — loudly, which is the good kind. */
          texture.flipY = false;
          texture.needsUpdate = true;
          if (source.width >= LOD.near) job.plate.large = texture;
          else job.plate.small = texture;
          job.plate.requested = 0;
          /* Only paint it if the window still wants it. A large that arrived
             late is kept rather than thrown away — the sweep will decide. */
          if (source.width < LOD.near || Math.abs(job.plate.index - wanted) <= LOD.window) {
            show(job.plate, source.width);
          }
          inFlight -= 1;
          pump();
        },
        undefined,
        () => {
          /* A 404 leaves whatever is already hanging. Nothing to tell the
             reader; the catalogue row below shows the same cover. */
          job.plate.requested = 0;
          inFlight -= 1;
          pump();
        }
      );
    }
  };

  const want = (plate: Plate, width: number): void => {
    if (held(plate, width)) {
      show(plate, width);
      return;
    }
    if (plate.requested === width) return;
    queue.push({ plate, width });
  };

  let wanted = 0;
  let settle = 0;

  const applyWindow = (active: number): void => {
    wanted = active;
    /* Stale wants go; the one in flight finishes and is kept, because both
       levels are cached now and keeping it costs nothing. */
    queue = [];
    const order = [...plates].sort(
      (a, b) => Math.abs(a.index - active) - Math.abs(b.index - active)
    );
    for (const plate of order) {
      if (Math.abs(plate.index - active) <= LOD.window) want(plate, LOD.near);
      else show(plate, LOD.base);
    }
    for (const plate of plates) if (Math.abs(plate.index - active) > KEEP) drop(plate);
    pump();
  };

  /* Every plate at the small size straight away — the corridor should never
     show a blank wall — but through the same one-at-a-time queue. */
  for (const plate of plates) want(plate, LOD.base);
  pump();

  return {
    plates,
    targets: plates.map((p) => p.mesh),
    focus(active: number) {
      if (active === wanted && settle === 0) return;
      window.clearTimeout(settle);
      settle = window.setTimeout(() => {
        settle = 0;
        applyWindow(active);
      }, SETTLE_MS);
    },
    bytes() {
      const gpu = (width: number): number => {
        const height = Math.round(width * 0.625);
        return Math.round(width * height * 4 * (4 / 3));
      };
      return plates.reduce(
        (total, plate) => total + (plate.small ? gpu(LOD.base) : 0) + (plate.large ? gpu(LOD.near) : 0),
        0
      );
    },
    dispose() {
      disposed = true;
      window.clearTimeout(settle);
      queue = [];
      for (const plate of plates) {
        plate.small?.dispose();
        plate.large?.dispose();
        plate.material.dispose();
      }
      placeholder.dispose();
      geometry.dispose();
    }
  };
}
