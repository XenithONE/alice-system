/**
 * Gate: the works grid has no holes, loses no work, and reads in the order it
 * looks.
 *
 * The layout is arithmetic, so it can be checked without a browser — which is
 * the point. A hole in the middle of the grid or a title that silently stops
 * being shown are both things you would only notice by looking, and only if
 * you happened to look at the right viewport.
 *
 * Run: npx tsx src/portfolio/bentoSelftest.ts
 */

import { CATALOG, GRID_COLUMNS, TIERS, artFor, packBands, packedOrder, tierOf } from "./bento";
import { ARENA_GAMES } from "../data/arenaGames";
import { STUDIO_TALLY, WORKS } from "../data/works";

declare const process: { exitCode?: number };

const failures: string[] = [];
const check = (name: string, ok: boolean, detail: string): void => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
  if (!ok) failures.push(name);
};

const bands = packBands(CATALOG);
const order = packedOrder(CATALOG);

console.table(
  bands.map((band, index) => ({
    band: index + 1,
    tiles: band.tiles.map((w) => `${tierOf(w)}:${w.id}`).join("  "),
    cols: band.width,
    full: band.full
  }))
);

/* ---------------- nothing lost, nothing duplicated ---------------- */

check(
  "[A1] すべての作品がちょうど1回ずつ出る",
  order.length === CATALOG.length && new Set(order.map((w) => w.id)).size === CATALOG.length,
  `カタログ ${CATALOG.length} 件 -> 配置 ${order.length} 件 / ユニーク ${new Set(order.map((w) => w.id)).size} 件`
);

const missing = CATALOG.filter((w) => !order.some((o) => o.id === w.id)).map((w) => w.id);
check("[A2] 取りこぼしなし", missing.length === 0, missing.length ? missing.join(", ") : "なし");

check(
  "[A3] 闘技場の2作がカタログに入っている（港が隠れても到達できる）",
  ARENA_GAMES.every((g) => order.some((w) => w.id === g.id)),
  ARENA_GAMES.map((g) => g.id).join(", ")
);

/* ---------------- no holes ---------------- */

const short = bands.slice(0, -1).filter((b) => b.width !== GRID_COLUMNS);
check(
  "[B1] 最後を除く全ての帯がちょうど6列",
  short.length === 0,
  short.length ? short.map((b) => `${b.width}列`).join(", ") : `${bands.length - 1} 本すべて 6 列`
);

const lastBand = bands[bands.length - 1];
check(
  "[B2] 最後の帯も6列を超えない",
  !lastBand || lastBand.width <= GRID_COLUMNS,
  lastBand ? `${lastBand.width} 列` : "帯なし"
);

/*
 * Simulate what CSS grid actually does, rather than counting columns.
 *
 * Auto-placement walks row-major and skips cells already taken; without
 * `dense` the cursor never goes backwards. So [p,p,s,s] is sound — the two
 * four-row p tiles hold columns 0-3, and the two-row s tiles stack in columns
 * 4-5 to the same depth. A column tally says that band is ragged, which is why
 * this walks the cells instead: the first version of this check modelled the
 * cursor as advancing modulo six and flagged a band that is in fact solid.
 */
function placeBand(tiles: readonly { cols: number; rows: number }[]): {
  height: number;
  holes: number;
  overflow: boolean;
} {
  const taken = new Set<string>();
  const at = (r: number, c: number): string => `${r},${c}`;
  let cursorRow = 0;
  let cursorCol = 0;
  let height = 0;
  let overflow = false;

  for (const tile of tiles) {
    if (tile.cols > GRID_COLUMNS) {
      overflow = true;
      continue;
    }
    // advance to the first cell where this tile fits
    for (;;) {
      if (cursorCol + tile.cols > GRID_COLUMNS) {
        cursorRow += 1;
        cursorCol = 0;
        continue;
      }
      let free = true;
      for (let r = 0; r < tile.rows && free; r += 1) {
        for (let c = 0; c < tile.cols && free; c += 1) {
          if (taken.has(at(cursorRow + r, cursorCol + c))) free = false;
        }
      }
      if (free) break;
      cursorCol += 1;
    }
    for (let r = 0; r < tile.rows; r += 1) {
      for (let c = 0; c < tile.cols; c += 1) taken.add(at(cursorRow + r, cursorCol + c));
    }
    height = Math.max(height, cursorRow + tile.rows);
    cursorCol += tile.cols;
  }

  let holes = 0;
  for (let r = 0; r < height; r += 1) {
    for (let c = 0; c < GRID_COLUMNS; c += 1) if (!taken.has(at(r, c))) holes += 1;
  }
  return { height, holes, overflow };
}

const placements = bands.map((b) => ({
  band: b,
  ...placeBand(b.tiles.map((w) => TIERS[tierOf(w)]))
}));
const holed = placements.filter((p) => p.band.full && p.holes > 0);
check(
  "[B3] 満杯の帯にセルの空きが無い（CSS グリッドの自動配置を実際に模して確認）",
  holed.length === 0,
  holed.length
    ? holed.map((p) => `${p.holes} セル空き`).join(", ")
    : placements.filter((p) => p.band.full).map((p) => `${p.height}行`).join(" / ")
);
check(
  "[B4] どのタイルも6列を超えない",
  placements.every((p) => !p.overflow),
  placements.some((p) => p.overflow) ? "はみ出しあり" : "なし"
);

/* ---------------- the size means something ---------------- */

const tierCounts = order.reduce<Record<string, number>>((acc, w) => {
  const t = tierOf(w);
  acc[t] = (acc[t] ?? 0) + 1;
  return acc;
}, {});
check(
  "[C1] 最大タイルは1枚だけ（序列が成立している）",
  (tierCounts.xl ?? 0) === 1,
  `xl=${tierCounts.xl ?? 0} l=${tierCounts.l ?? 0} p=${tierCounts.p ?? 0} m=${tierCounts.m ?? 0} s=${tierCounts.s ?? 0}`
);

const posterWorks = CATALOG.filter((w) => w.poster);
check(
  "[C2] 縦ポスターを持つ作品だけが縦タイルになる（16:10素材を縦に切らない）",
  posterWorks.every((w) => tierOf(w) === "p") && order.filter((w) => tierOf(w) === "p").every((w) => !!w.poster),
  `poster あり ${posterWorks.length} 件 = 縦タイル ${order.filter((w) => tierOf(w) === "p").length} 件`
);

/* ---------------- the tally must not move ---------------- */

check(
  "[D1] 闘技場を並べても STUDIO_TALLY は WORKS のみを数えている",
  STUDIO_TALLY.live === WORKS.filter((w) => w.status === "playable").length &&
    STUDIO_TALLY.live < CATALOG.filter((w) => w.status === "playable").length,
  `tally.live=${STUDIO_TALLY.live} / カタログの playable=${CATALOG.filter((w) => w.status === "playable").length}`
);

/* ---------------- the pictures are the right size ---------------- */

/*
 * artFor falls back to the full-size source when a work has no derivatives, so
 * that a new cover renders rather than 404s. A fallback is the correct
 * behaviour and the wrong outcome — it means someone added art and did not run
 * the optimiser, and the only symptom is a slow page. Make it loud here.
 */
const unoptimised = order
  .map((w) => ({ w, art: artFor(w, tierOf(w), "/") }))
  .filter(({ art }) => art.srcSet === "");
check(
  "[F1] 全タイルが幅の派生を持つ（原寸フォールバックに落ちていない）",
  unoptimised.length === 0,
  unoptimised.length
    ? `${unoptimised.map(({ w }) => w.id).join(", ")} — python scripts/optimize_covers.py`
    : `${order.length} 件すべて srcset あり`
);

const badSizes = order
  .map((w) => ({ w, art: artFor(w, tierOf(w), "/") }))
  .filter(({ art }) => art.srcSet !== "" && !art.sizes.includes("max-width"));
check(
  "[F2] srcset を出すタイルは必ず sizes も出す（無いと 100vw 扱いで最大幅を掴む）",
  badSizes.length === 0,
  badSizes.length ? badSizes.map(({ w }) => w.id).join(", ") : "なし"
);

/* ---------------- growth ---------------- */

// works.ts promises that appending one Work updates the site. Prove the packer
// survives it rather than assuming.
const grown = [...CATALOG, { ...CATALOG[0]!, id: "__probe", featured: false, poster: undefined, status: "playable" as const, kind: "game" as const, engine: "Canvas 2D" as const }];
const grownOrder = packedOrder(grown);
check(
  "[E1] 作品を1件足しても配置が成立する",
  grownOrder.length === grown.length && new Set(grownOrder.map((w) => w.id)).size === grown.length,
  `${CATALOG.length} -> ${grownOrder.length} 件`
);

console.log(`GRID: ${GRID_COLUMNS} columns, ${bands.length} bands, ${order.length} tiles`);
if (failures.length > 0) {
  console.log(`BENTO SELFTEST FAIL — ${failures.join(" / ")}`);
  process.exitCode = 1;
} else {
  console.log("BENTO SELFTEST PASS");
}
