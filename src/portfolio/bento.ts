import { ARENA_GAMES } from "../data/arenaGames";
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
