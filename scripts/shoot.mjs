/**
 * Screenshots the top page so it can actually be looked at.
 *
 * This exists because the whole of v10 was designed without anyone seeing it.
 * The in-app browser pane could not composite frames, so every check was a
 * measurement — contrast ratios, bounding boxes, computed styles — and every
 * measurement passed while the page still read as unchanged. Numbers can tell
 * you a heading is 57px of Shippori Mincho at 13.6:1. They cannot tell you the
 * page looks like a dashboard.
 *
 * Uses the system Chrome rather than downloading a browser.
 *
 * Run: node scripts/shoot.mjs [url] [outDir]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2] ?? "http://localhost:4322/alice-system/";
const outDir = process.argv[3] ?? "shots";
mkdirSync(outDir, { recursive: true });

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
];

const browser = await chromium.launch({ channel: "chrome" });
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    /* The design has to be judged with motion ON. The environment that built
       it reports `reduce`, which is exactly why the entrance and the scroll
       bar were never seen. */
    reducedMotion: "no-preference",
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    // Walk the page so every IntersectionObserver target fires and every
    // lazy image decodes, then come back for the full-page capture.
    for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 400));
  });
  await page.waitForTimeout(600);

  await page.screenshot({ path: `${outDir}/${vp.name}-fold.png` });
  await page.screenshot({ path: `${outDir}/${vp.name}-full.png`, fullPage: true });

  // Each section on its own, which is how a spread is judged.
  for (const id of ["games", "ai-lab", "prompts", "stack"]) {
    const el = await page.$(`#${id}`);
    if (el) await el.screenshot({ path: `${outDir}/${vp.name}-${id}.png` }).catch(() => {});
  }
  console.log(`shot ${vp.name} ${vp.width}x${vp.height}`);
  await ctx.close();
}
await browser.close();
console.log(`done -> ${outDir}/`);
