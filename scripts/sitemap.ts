/**
 * The sitemap, derived from the catalogue instead of kept by hand.
 *
 * It had already drifted: relic-road.html was listed and scrap-crown.html was
 * not, because the arena titles were once deliberately unlisted and nothing
 * revisited that when they were put in the works grid. A hand-maintained copy
 * of a list that lives in works.ts is the same defect as any other fact
 * written twice — it is only slower to notice.
 *
 * harbor.html is absent on purpose. It carries noindex; listing a page in the
 * sitemap while telling crawlers not to index it is a contradiction, and the
 * point of the harbour now is that you find it rather than are told about it.
 *
 *   npx tsx scripts/sitemap.ts           write public/sitemap.xml
 *   npx tsx scripts/sitemap.ts --check   fail if the committed file is stale
 */
import { readFileSync, writeFileSync } from "node:fs";
import { CATALOG } from "../src/portfolio/bento";

const ORIGIN = "https://xenithone.github.io/alice-system/";
const OUT = "public/sitemap.xml";

interface Entry {
  loc: string;
  changefreq: string;
  priority: string;
}

/** A page a crawler can reach; "#anchor" titles have no page of their own. */
const pages = CATALOG.filter((w) => !w.href.startsWith("#"));

const entries: Entry[] = [
  { loc: ORIGIN, changefreq: "weekly", priority: "1.0" },
  ...pages.map((w) => {
    // .../index.html and .../ are the same page; prefer the canonical form.
    const path = w.href.replace(/(^|\/)index\.html$/, "$1");
    const nested = path.includes("/");
    const priority = nested ? "0.5" : w.kind === "game" ? "0.7" : "0.6";
    return { loc: ORIGIN + path, changefreq: "monthly", priority };
  })
];

const xml =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  entries
    .map(
      (e) =>
        `  <url><loc>${e.loc}</loc><changefreq>${e.changefreq}</changefreq>` +
        `<priority>${e.priority}</priority></url>`
    )
    .join("\n") +
  "\n</urlset>\n";

declare const process: { argv: string[]; exitCode?: number };

if (process.argv.includes("--check")) {
  const current = readFileSync(OUT, "utf8").replace(/\r\n/g, "\n");
  if (current === xml) {
    console.log(`SITEMAP PASS — ${entries.length} URLs, matches the catalogue`);
  } else {
    const has = new Set([...current.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
    const want = new Set(entries.map((e) => e.loc));
    const missing = [...want].filter((u) => !has.has(u));
    const extra = [...has].filter((u) => !want.has(u));
    console.log("SITEMAP FAIL — public/sitemap.xml is stale");
    if (missing.length) console.log(`  missing: ${missing.join(", ")}`);
    if (extra.length) console.log(`  extra:   ${extra.join(", ")}`);
    if (!missing.length && !extra.length) console.log("  same URLs, different priorities or formatting");
    console.log("  fix: npx tsx scripts/sitemap.ts");
    process.exitCode = 1;
  }
} else {
  writeFileSync(OUT, xml);
  console.log(`wrote ${OUT} — ${entries.length} URLs`);
}
