import { CATALOG, mediaFor, type Art } from "../portfolio/bento";
import derivatives from "../data/imageDerivatives.json";
import type { Work } from "../data/works";

/**
 * What hangs on the wall.
 *
 * A gallery does not hang itself: this page is a Work in the catalogue like
 * every other, so it is filtered out by id rather than by position. Filtering
 * by index would silently exhibit the wrong title the day someone reorders
 * works.ts.
 *
 * There is no second list. Appending a Work adds a frame to the corridor, a
 * row to the DOM catalogue and a texture to the budget in one edit, which is
 * the promise works.ts makes and the reason gallerySelftest [G5] checks the
 * count against CATALOG rather than against a number written here.
 */
export const SELF_ID = "long-gallery";

export const EXHIBITS: readonly Work[] = CATALOG.filter((w) => w.id !== SELF_ID);

/**
 * The catalogue row's picture.
 *
 * Measured against the built layout, not guessed: `.cg-card` is a 1120px
 * container with a 1.05fr / 1fr split and a 40px gap, so the plate is 552 CSS
 * px at the widest, half the viewport between 880 and 1180, and the full
 * column below 880. `sizes` that overstates fetches the next file up for
 * nothing; one that understates upscales a small file and looks soft.
 */
export const CARD_SIZES = "(max-width: 879px) 92vw, (max-width: 1179px) 50vw, 560px";

export function cardArt(work: Work, base: string): Art {
  return mediaFor(work.cover, base, CARD_SIZES);
}

/* ── what the wall costs ────────────────────────────────────────────────── */

/**
 * Two resolutions and a window, because seventeen sharp covers do not fit.
 *
 * Measured: a 1280x800 RGBA texture with mipmaps is 5.46 MB of GPU memory, so
 * hanging all seventeen sharp is 93 MB — on an integrated GPU that is the
 * whole budget for a page that also wants a renderer, a depth buffer and two
 * post-processing targets. Every plate loads at 400 and only the five around
 * the reader are promoted; the rest go back down and the big texture is
 * disposed. [G6] checks the arithmetic rather than trusting this paragraph.
 */
export const LOD = {
  /** Every plate, from boot. 400x250 is 0.53 MB and reads sharp past 8 m. */
  base: 400,
  /** The plates the reader is actually in front of. */
  near: 1280,
  /** How many either side of the active frame get promoted. */
  window: 2
} as const;

type Derived = Record<string, { w: number; h: number; widths: number[] } | undefined>;

export interface Derivative {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  /** False when the manifest had no entry and the source file is being used. */
  readonly derived: boolean;
}

/**
 * The narrowest encoded file that is at least `want` wide.
 *
 * bento.ts hands the browser a srcset and lets it choose; a texture upload has
 * to name one file, so this picks the same way the browser would. Falling
 * through to the source rather than guessing a width is deliberate — a URL for
 * a derivative that was never encoded 404s, and a 404 texture is a black
 * rectangle with no error anyone sees.
 */
export function derivativeFor(path: string, want: number, base: string): Derivative {
  const entry = (derivatives as Derived)[path];
  if (!entry || entry.widths.length === 0) {
    return { url: base + path, width: 1280, height: 800, derived: false };
  }
  const width = entry.widths.find((w) => w >= want) ?? entry.widths[entry.widths.length - 1]!;
  const stem = path.replace(/^.*\//, "").replace(/\.webp$/, "");
  return {
    url: `${base}assets/derived/${stem}-${width}.webp`,
    width,
    height: Math.round((width * entry.h) / entry.w),
    derived: true
  };
}

/** GPU bytes for an RGBA8 texture with a full mip chain. */
export function gpuBytes(width: number, height: number): number {
  return Math.round(width * height * 4 * (4 / 3));
}

/**
 * The most GPU memory the wall can be holding at once.
 *
 * Every plate keeps its small texture for the life of the page, and the window
 * adds a large one on top. That is a change from the first version, which
 * REPLACED the small with the large and charged only the difference — cheaper
 * on paper, and the reason demoting a plate cost a fetch, a decode, an upload
 * and ten mipmap passes for a file it had held a moment earlier. Holding
 * 17 x 0.53 MB permanently is what buys a free demotion.
 */
export function worstCaseTextureBytes(count: number = EXHIBITS.length, base = "/"): number {
  const promoted = Math.min(count, LOD.window * 2 + 1);
  let total = 0;
  EXHIBITS.slice(0, count).forEach((work, i) => {
    const small = derivativeFor(work.cover, LOD.base, base);
    total += gpuBytes(small.width, small.height);
    if (i < promoted) {
      const large = derivativeFor(work.cover, LOD.near, base);
      total += gpuBytes(large.width, large.height);
    }
  });
  return total;
}
