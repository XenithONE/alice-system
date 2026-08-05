/**
 * What each page actually costs on first load, and what it must never reach.
 *
 * Bundle listings report chunks, not pages. A chunk that only the harbour pulls
 * in still appears in the build output, so "three.js is 150 KB gzip" tells you
 * nothing about whether the top page pays for it. This walks the import graph
 * from each HTML entry — static AND dynamic — and sums what a browser would
 * fetch, which is the only number the plan's budget is written against.
 *
 * Dynamic imports count. `import('./harborScene-XXX.js')` is deferred, not
 * free, and it is reachable: if the top page can reach three.js down any path,
 * the split has failed. Template-literal specifiers are matched too, because
 * rolldown emits some of them that way and a regex that missed them would let
 * exactly the regression this exists to catch through.
 *
 * Run: node scripts/measure_closure.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, dirname, basename } from "node:path";

const DIST = "dist";

/**
 * A page must not be able to reach these, however indirectly.
 *
 * ⚠ three.core is the one that matters, and it did not exist as a chunk until
 * gallery.html started importing three/webgpu. Both entry points — the WebGL
 * `three` build and the WebGPU one — are thin shells over `three.core.js`, so
 * once two graphs share it rolldown splits it out and `three.module-*` shrinks
 * from 150 KB to 83 KB. At that moment a rule that only banned
 * /^three\.module-/ stopped being able to see three.js at all: the top page
 * could have pulled in the whole core and reported a clean run.
 *
 * Banning the core is the load-bearing line. You cannot use any part of three
 * without it, whichever entry point you came in through — so this one pattern
 * covers builds that do not exist yet. The other two are named anyway, because
 * a failure message that says which door was opened is worth three characters.
 */
const BANNED = {
  "index.html": [
    /^three\.core-/,
    /^three\.module-/,
    /^three\.webgpu-/,
    /^three\.tsl-/,
    /^spark\.module-/,
    /^rapier-/
  ],
  "harbor.html": [/^spark\.module-/, /^rapier-/],
  "atelier.html": [/^spark\.module-/, /^rapier-/],
  "gallery.html": [/^spark\.module-/, /^rapier-/]
};

/**
 * Budget in gzip bytes for the first-load JS closure.
 *
 * v13: raw-WebGL2 fluid layer + MOTION toggle (still no three.js).
 *
 * Adding gallery.html moved the measured figure from 83,774 to ~84,500 without
 * adding a line of code to the top page: sharing bento.ts, badges.tsx and
 * motion.ts across two entries makes rolldown split them into their own chunks,
 * and the same bytes compress worse in eight pieces than in five. Raw grew 384
 * bytes; gzip grew about 900. The ceiling stays where it was — the point of a
 * budget is that it does not move to accommodate what happened.
 */
const BUDGET = { "index.html": 95_000 };

const gz = (p) => gzipSync(readFileSync(p)).length;

// Both forms: import("./x.js") and import(`./x.js`), plus static from-clauses.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'`](\.\.?\/[^"'`]+?\.js)["'`]/g;

function closure(entryFiles, assetsDir) {
  const seen = new Set();
  const queue = [...entryFiles];
  while (queue.length) {
    const name = queue.pop();
    if (seen.has(name)) continue;
    const path = join(assetsDir, name);
    let src;
    try {
      src = readFileSync(path, "utf8");
    } catch {
      continue; // not an emitted asset (bare import, external URL)
    }
    seen.add(name);
    for (const m of src.matchAll(SPECIFIER)) queue.push(basename(m[1]));
  }
  return seen;
}

const pages = readdirSync(DIST).filter((f) => f.endsWith(".html"));
const assetsDir = join(DIST, "assets");
let failures = 0;

console.log("page                    JS chunks   JS raw      JS gzip     CSS gzip");
console.log("-".repeat(74));

const report = [];
for (const page of pages.sort()) {
  const html = readFileSync(join(DIST, page), "utf8");
  const entries = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => basename(m[1]));
  const css = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+\.css)"/g)].map((m) =>
    basename(m[1])
  );
  if (!entries.length) continue;

  const files = closure(entries, assetsDir);
  let raw = 0;
  let gzip = 0;
  for (const f of files) {
    const p = join(assetsDir, f);
    raw += statSync(p).size;
    gzip += gz(p);
  }
  const cssGzip = css.reduce((n, f) => n + gz(join(assetsDir, f)), 0);

  console.log(
    `${page.padEnd(22)} ${String(files.size).padStart(5)}   ${String(raw).padStart(9)}   ` +
      `${String(gzip).padStart(9)}   ${String(cssGzip).padStart(8)}`
  );
  report.push({ page, files, gzip });

  const banned = (BANNED[page] ?? []).flatMap((re) => [...files].filter((f) => re.test(f)));
  if (banned.length) {
    console.log(`  FAIL  BANNED REACHABLE: ${banned.join(", ")}`);
    failures += 1;
  } else if (BANNED[page]) {
    console.log("  ok    BANNED REACHABLE: (none)");
  }
  const budget = BUDGET[page];
  if (budget !== undefined) {
    const ok = gzip <= budget;
    console.log(`  ${ok ? "ok  " : "FAIL"}  JS budget ${gzip} / ${budget} gzip`);
    if (!ok) failures += 1;
  }
}

// The heavy chunks must still be reachable from the pages that need them —
// a "win" that deleted the physics engine would otherwise look like a pass.
const REQUIRED = {
  "index.html": /^fluidLayer-/,
  "scrap-crown.html": /^rapier-/,
  "vortex-crown.html": /^rapier-/,
  "hollow-ward.html": /^spark\.module-/,
  "harbor.html": /^three\.module-/,
  "atelier.html": /^three\.module-/,
  /* The corridor. three/webgpu currently gets inlined into the page's own
     world chunk rather than emitted as three.webgpu-*, so the core is what
     proves the renderer is still reachable. */
  "gallery.html": /^three\.core-/
};
for (const [page, re] of Object.entries(REQUIRED)) {
  const row = report.find((r) => r.page === page);
  if (!row) continue;
  const ok = [...row.files].some((f) => re.test(f));
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${page} still reaches ${re}`);
  if (!ok) failures += 1;
}

console.log(failures ? `\nCLOSURE FAIL — ${failures}` : "\nCLOSURE PASS");
process.exitCode = failures ? 1 : 0;
