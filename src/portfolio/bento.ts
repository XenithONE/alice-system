import { ARENA_GAMES } from "../data/arenaGames";
import derivatives from "../data/imageDerivatives.json";
import { WORKS, type Work } from "../data/works";

/**
 * Layout for the works grid. No React, no DOM — this is arithmetic, so it can
 * be checked by bentoSelftest without a browser.
 *
 * The grid is six columns. A tile's size says how much the work matters, and
 * that size is DERIVED from the work rather than written down per title:
 * works.ts promises that appending one entry updates the site, and a hand-kept
 * position table would quietly break that promise.
 */

export type Tier = "xl" | "l" | "p" | "m" | "s";

export interface TierSpec {
  /** grid columns, out of six */
  readonly cols: number;
  /** grid rows */
  readonly rows: number;
  /**
   * Overlay puts the text on the picture; caption stacks text underneath.
   *
   * m is the odd one out on purpose. Every cover is 1280x800, so a 4x4 or a
   * 2x2 tile is within a whisker of 16:10 and crops nothing. A 2x3 is 1.07,
   * which would cut a third of the width off — so m shows the picture whole
   * with a text panel below it, the way a magazine sets a figure. It also
   * stops every tile looking like the same object.
   */
  readonly mode: "overlay" | "caption";
}

export const TIERS: Record<Tier, TierSpec> = {
  xl: { cols: 4, rows: 4, mode: "overlay" },
  l: { cols: 4, rows: 3, mode: "overlay" },
  p: { cols: 2, rows: 4, mode: "overlay" },
  m: { cols: 2, rows: 3, mode: "caption" },
  s: { cols: 2, rows: 2, mode: "overlay" }
};

export const GRID_COLUMNS = 6;

/**
 * The two arena titles reach the site through here.
 *
 * They used to be entered only by walking into the harbour's arena, and
 * arenaGames.ts still says to keep them out of WORKS — which remains right:
 * mixing them in would move STUDIO_TALLY and the sitemap. This adapter shows
 * them without adopting them. Now that the harbour is a hidden page, without
 * it two finished games would be unreachable from the site.
 */
export const ARENA_AS_WORKS: Work[] = ARENA_GAMES.map((game) => ({
  id: game.id,
  title: game.title,
  titleJa: game.titleJa,
  description: game.description,
  href: game.href,
  cover: game.cover,
  year: game.year,
  kind: "game",
  engine: "Three.js + Rapier",
  platform: ["web"],
  status: "playable",
  tags: [...game.tags],
  aiTools: ["Claude"]
}));

/** Everything the grid shows, in reading order. */
export const CATALOG: Work[] = [...WORKS, ...ARENA_AS_WORKS];

export function tierOf(work: Work): Tier {
  // The flagship in production: the one title worth the biggest tile.
  if (work.featured && work.status !== "playable") return "xl";
  // Portrait key art exists — give it the only upright tile. 2x4 measures
  // 0.774 against the posters' 0.667, so it centre-crops about 14% of the
  // height; six columns cannot express 2:3 exactly at any row count. Under
  // 560px the stack drops the lattice and shows them whole.
  if (work.poster) return "p";
  if (work.featured) return "l";
  if (work.status !== "playable") return "m";
  if (work.kind !== "game") return "m";
  if (work.engine.startsWith("Three.js")) return "m";
  return "s";
}

export interface Band {
  readonly tiles: readonly Work[];
  /** columns used; a full band is GRID_COLUMNS */
  readonly width: number;
  readonly full: boolean;
}

/*
 * Recipes, not `grid-auto-flow: dense`.
 *
 * Dense would close the gaps for us, at the price of reordering tiles visually
 * without reordering them in the DOM — so the tab order and the screen-reader
 * order would stop matching what is on screen (WCAG 1.3.2 and 2.4.3). Packing
 * the order ourselves keeps one order for everyone.
 *
 * Each recipe is height-consistent as well as six columns wide, which is what
 * actually prevents holes: [p,p,s,s] works because two 2-row s tiles stack to
 * the same four rows as a p.
 */
const RECIPES: readonly (readonly Tier[])[] = [
  ["xl", "p"],
  ["l", "m"],
  ["p", "p", "s", "s"],
  ["m", "m", "m"],
  ["s", "s", "s"]
];

export function packBands(works: readonly Work[]): Band[] {
  const buckets = new Map<Tier, Work[]>();
  for (const work of works) {
    const tier = tierOf(work);
    if (!buckets.has(tier)) buckets.set(tier, []);
    buckets.get(tier)!.push(work);
  }

  const bands: Band[] = [];
  const remaining = (): number => [...buckets.values()].reduce((n, list) => n + list.length, 0);

  let guard = works.length + RECIPES.length;
  while (remaining() > 0 && guard-- > 0) {
    const recipe = RECIPES.find((r) => {
      const need = new Map<Tier, number>();
      for (const t of r) need.set(t, (need.get(t) ?? 0) + 1);
      return [...need].every(([t, n]) => (buckets.get(t)?.length ?? 0) >= n);
    });
    if (!recipe) break;
    const tiles = recipe.map((t) => buckets.get(t)!.shift()!);
    bands.push({ tiles, width: GRID_COLUMNS, full: true });
  }

  // Whatever no recipe can take rides in one last, possibly short band. A gap
  // at the very end of the grid reads as the end of the grid; a gap in the
  // middle reads as a bug.
  const leftovers = [...buckets.values()].flat();
  if (leftovers.length > 0) {
    const width = leftovers.reduce((n, w) => n + TIERS[tierOf(w)].cols, 0);
    bands.push({ tiles: leftovers, width, full: width === GRID_COLUMNS });
  }
  return bands;
}

/** Reading order across all bands — the order the tiles are written to the DOM. */
export function packedOrder(works: readonly Work[]): Work[] {
  return packBands(works).flatMap((band) => [...band.tiles]);
}

/* ------------------------------------------------------------------ art --- */

/**
 * What to put in the <img>.
 *
 * The widths come from imageDerivatives.json, which scripts/optimize_covers.py
 * writes — so this cannot offer the browser a width that was never encoded.
 * The sizes strings are the grid's own breakpoints read back as percentages:
 * six columns above 1180, four to 880, two to 560, one below. Get these wrong
 * and srcset quietly picks the wrong file, which looks like nothing at all.
 */
export interface Art {
  readonly src: string;
  readonly srcSet: string;
  readonly sizes: string;
  readonly width: number;
  readonly height: number;
}

/*
 * Measured, not estimated. At a 1280 viewport the XL tile is 700 CSS px and
 * every other tile 342 — 54.7vw and 26.7vw. The first draft said 60vw and
 * 30vw, and the browser dutifully fetched the 960 for a 700px box: sizes that
 * overstates is not a rounding error, it is the next file up.
 */
const SIZES: Record<Tier, string> = {
  // four of six columns, then the whole grid once it is four across
  xl: "(max-width: 1179px) 92vw, (max-width: 1650px) 55vw, 890px",
  l: "(max-width: 1179px) 92vw, (max-width: 1650px) 55vw, 890px",
  // p keeps two columns down to 560, where it becomes the whole row
  p: "(max-width: 879px) 92vw, (max-width: 1179px) 45vw, (max-width: 1650px) 27vw, 440px",
  m: "(max-width: 559px) 92vw, (max-width: 1179px) 45vw, (max-width: 1650px) 27vw, 440px",
  s: "(max-width: 559px) 92vw, (max-width: 1179px) 45vw, (max-width: 1650px) 27vw, 440px"
};

type Derived = Record<string, { w: number; h: number; widths: number[] } | undefined>;

/** Any image with derivatives, given the CSS width it will be drawn at. */
export function mediaFor(path: string, base: string, sizes: string): Art {
  const entry = (derivatives as Derived)[path];
  // No manifest entry means no derivatives were made for it; serve the source
  // rather than 404 on a width that does not exist.
  if (!entry || entry.widths.length === 0) {
    return { src: base + path, srcSet: "", sizes: "", width: 1280, height: 800 };
  }
  const stem = path.replace(/^.*\//, "").replace(/\.webp$/, "");
  const url = (w: number): string => `${base}assets/derived/${stem}-${w}.webp`;
  return {
    src: url(entry.widths[entry.widths.length - 1]!),
    srcSet: entry.widths.map((w) => `${url(w)} ${w}w`).join(", "),
    sizes,
    width: entry.w,
    height: entry.h
  };
}

export function artFor(work: Work, tier: Tier, base: string): Art {
  const path = tier === "p" && work.poster ? work.poster : work.cover;
  return mediaFor(path, base, SIZES[tier]);
}

/**
 * The detail dialog's key art. It used to load the full source — 350 KB for
 * the widest — the moment anyone opened a tile.
 *
 * `.game-detail` is max-width: min(960px, 94vw), and the media fills it minus
 * the shell's border: 943 CSS px at a 1280 viewport, measured. A first guess of
 * 620px here made the browser fetch the 720 for a 943px box and upscale it
 * 1.5x — sizes that understates is as wrong as sizes that overstates, just
 * blurry instead of slow.
 */
export const DETAIL_SIZES = "(max-width: 1021px) 94vw, 960px";
