/**
 * Gate: the two stylesheets say one thing each, and nothing moves for someone
 * who asked for stillness.
 *
 * Both defect classes here are SILENT. Neither produces an error, a console
 * message, or a layout shift; both look identical to correct code in every
 * screenshot taken on the machine that wrote them.
 *
 *   Cascade duplication — theme.css and portfolio.css both styled ~35
 *   selectors. Which one won was decided by the bundler's chunk order, not by
 *   anything in the source, and it had been deciding it wrong: 64 declarations
 *   in theme.css never reached a browser. The AI Lab shipped its paper ground
 *   as navy, so its heading rendered #061c31 on #0a2944 — 1.16:1, invisible —
 *   and the active filter tab shipped white-on-amber at 2.01:1. Nobody
 *   noticed for two versions because there is nothing to notice: the page
 *   renders, it just renders the loser's values.
 *
 *   Reduced motion — a rule that escapes the contract is invisible on every
 *   machine except one belonging to someone who turned the setting on.
 *   portfolio.css's own comment says that machine is the owner's.
 *
 * Run: npx tsx scripts/cssSelftest.ts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ── a tiny CSS reader ─────────────────────────────────────────────────────
 * Brace-walking, no dependency. It returns each declaration together with the
 * stack of at-rules enclosing it, which is the only thing both checks need:
 * "is this rule inside a no-preference block" and "does the other file also
 * declare this property on this selector in the same context".
 */
interface Rule {
  readonly atRules: readonly string[];
  readonly selector: string;
  readonly decls: ReadonlyMap<string, string>;
  readonly line: number;
}
interface Keyframes {
  readonly atRules: readonly string[];
  readonly name: string;
  readonly line: number;
}

function parse(css: string): { rules: Rule[]; keyframes: Keyframes[] } {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const rules: Rule[] = [];
  const keyframes: Keyframes[] = [];
  const stack: string[] = [];
  let buf = "";
  let i = 0;
  const lineAt = (at: number): number => src.slice(0, at).split("\n").length;

  while (i < src.length) {
    const c = src[i]!;
    if (c === "{") {
      const prelude = buf.trim().replace(/\s+/g, " ");
      buf = "";
      if (prelude.startsWith("@")) {
        if (/^@keyframes\b/.test(prelude)) {
          keyframes.push({
            atRules: [...stack],
            name: prelude.replace(/^@keyframes\s+/, ""),
            line: lineAt(i),
          });
          // skip the whole keyframes body; its inner blocks are not rules
          let depth = 1;
          let j = i + 1;
          while (j < src.length && depth > 0) {
            if (src[j] === "{") depth++;
            else if (src[j] === "}") depth--;
            j++;
          }
          i = j;
          continue;
        }
        stack.push(prelude);
        i++;
        continue;
      }
      let depth = 1;
      let j = i + 1;
      while (j < src.length && depth > 0) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
        j++;
      }
      const decls = new Map<string, string>();
      for (const part of src.slice(i + 1, j - 1).split(";")) {
        const colon = part.indexOf(":");
        if (colon === -1) continue;
        decls.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, " "));
      }
      rules.push({ atRules: [...stack], selector: prelude, decls, line: lineAt(i) });
      i = j;
      continue;
    }
    if (c === "}") {
      buf = "";
      stack.pop();
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  return { rules, keyframes };
}

const failures: string[] = [];
function check(id: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${id} — ${detail}`);
  if (!ok) failures.push(id);
}

/* ── [C0] the gate reads exactly what the page loads ──────────────────────
 * Without this the whole file is defeated by adding a third stylesheet: every
 * assertion below would keep passing while rules shipped from a file nothing
 * was reading. This is the file-level version of the no-preference wrapper —
 * a new thing cannot end up silently outside the guard.
 */
const SCANNED = ["portfolio.css", "theme.css"] as const;
const entry = readFileSync(join(root, "src/main.tsx"), "utf8");
const imported = [...entry.matchAll(/import\s+"\.\/portfolio\/([\w.-]+\.css)"/g)].map((m) => m[1]!);
check(
  "[C0] ゲートが走査するCSSがトップページの読み込むCSSと一致する",
  imported.length === SCANNED.length && imported.every((f) => (SCANNED as readonly string[]).includes(f)),
  `main.tsx: ${imported.join(", ") || "(なし)"} / gate: ${SCANNED.join(", ")}`
);

const files = SCANNED.map((name) => {
  const text = readFileSync(join(root, "src/portfolio", name), "utf8");
  return { name, text, ...parse(text) };
});

/* ── [C1] one fact, one place ─────────────────────────────────────────────
 * Selector + property, in the same at-rule context. Not "selector declared
 * twice" — the two files legitimately split layout from look on the same
 * selector, and forbidding that would force a layering nobody wants. What
 * cannot happen is the SAME property on the SAME selector in both, because
 * then the value that ships is a property of the build, not of the source.
 */
{
  /*
   * @layer is stripped from the context before comparing, and that is the
   * whole check.
   *
   * The first version of this keyed on the raw at-rule stack, which includes
   * `@layer base` for one file and `@layer theme` for the other — so every
   * duplicate looked like two declarations in different contexts and the
   * check could not fail. Sabotaging it by restoring .lab-notebook's second
   * background proved it: [C1] passed while the defect was present. A layer
   * is precisely the mechanism that picks a winner between two declarations
   * of one fact; treating it as a separator makes the gate agree with the bug.
   *
   * Media and supports queries stay in the key — the same property under two
   * different breakpoints genuinely is two facts.
   */
  const contextOf = (rule: Rule): string =>
    rule.atRules.filter((a) => !a.startsWith("@layer")).join(" ");
  const index = new Map<string, { file: string; value: string; line: number }>();
  const clashes: string[] = [];
  for (const file of files) {
    for (const rule of file.rules) {
      for (const selector of rule.selector.split(",").map((s) => s.trim()).filter(Boolean)) {
        for (const [prop, value] of rule.decls) {
          if (prop.startsWith("--")) continue; // tokens are [C5]/[C6]'s job
          const key = `${contextOf(rule)}|${selector}|${prop}`;
          const prior = index.get(key);
          if (prior && prior.file !== file.name) {
            clashes.push(
              `${selector} { ${prop} }  ${prior.file}:${prior.line}「${prior.value}」 vs ${file.name}:${rule.line}「${value}」`
            );
          } else if (!prior) {
            index.set(key, { file: file.name, value, line: rule.line });
          }
        }
      }
    }
  }
  check(
    "[C1] 同じセレクタの同じプロパティが2枚のCSSに重複していない",
    clashes.length === 0,
    clashes.length === 0
      ? "重複なし（この検査は導入時 64 件で落ちた）"
      : `${clashes.length} 件\n      ${clashes.join("\n      ")}`
  );
}

/* ── [C2] every keyframes is inside the opt-in wrapper ────────────────────
 * Declared inside the media query, a @keyframes does not exist when the query
 * fails, so an animation-name referencing it resolves to nothing. That makes
 * the guard structural rather than a second rule someone has to remember.
 */
const NO_PREF = /prefers-reduced-motion\s*:\s*no-preference/;
{
  const escaped = files.flatMap((f) =>
    f.keyframes.filter((k) => !k.atRules.some((a) => NO_PREF.test(a))).map((k) => `${f.name}:${k.line} @keyframes ${k.name}`)
  );
  check(
    "[C2] 全ての @keyframes が no-preference ラッパの内側にある",
    escaped.length === 0,
    escaped.length === 0 ? `${files.reduce((n, f) => n + f.keyframes.length, 0)} 件すべて内側` : escaped.join(" / ")
  );
}

/* ── [C3] every animation-name referring to one is guarded too ────────────
 * [C2] alone is not enough: the keyframes can be inside the wrapper while the
 * rule that plays it sits outside, which is exactly how `pulse` shipped — the
 * animation ran and a separate `reduce` rule was expected to remember to stop
 * it.
 */
{
  const names = new Set(files.flatMap((f) => f.keyframes.map((k) => k.name)));
  const escaped: string[] = [];
  for (const file of files) {
    for (const rule of file.rules) {
      const value = rule.decls.get("animation") ?? rule.decls.get("animation-name");
      if (!value) continue;
      if (![...names].some((n) => new RegExp(`(^|\\s)${n}(\\s|$)`).test(value))) continue;
      if (!rule.atRules.some((a) => NO_PREF.test(a))) {
        escaped.push(`${file.name}:${rule.line} ${rule.selector} { ${value} }`);
      }
    }
  }
  check(
    "[C3] キーフレームを再生する規則も no-preference の内側にある",
    escaped.length === 0,
    escaped.length === 0 ? "全て内側" : escaped.join(" / ")
  );
}

/* ── [C4] scroll-driven motion is guarded twice ───────────────────────────
 * @supports because ~16% of browsers have no timeline, and no-preference
 * because a scrubbed animation is still animation.
 */
{
  const bad: string[] = [];
  for (const file of files) {
    for (const rule of file.rules) {
      if (!rule.decls.has("animation-timeline")) continue;
      const supports = rule.atRules.some((a) => a.startsWith("@supports"));
      const pref = rule.atRules.some((a) => NO_PREF.test(a));
      if (!supports || !pref) {
        bad.push(`${file.name}:${rule.line} ${rule.selector} (supports=${supports} no-preference=${pref})`);
      }
    }
  }
  const total = files.reduce((n, f) => n + f.rules.filter((r) => r.decls.has("animation-timeline")).length, 0);
  check(
    "[C4] スクロール駆動は @supports と no-preference の二重ガードの内側",
    bad.length === 0,
    bad.length === 0 ? `${total} 件すべて二重ガード` : bad.join(" / ")
  );
}

/* ── [C5]/[C6]/[C7] the token layer says what is true ─────────────────── */
const roots = files.flatMap((f) => f.rules.filter((r) => r.selector === ":root").map((r) => ({ f: f.name, r })));
check(
  "[C5] :root は全体で1つだけ",
  roots.length === 1,
  roots.map((x) => `${x.f}:${x.r.line}`).join(", ") || "なし"
);

const tokens = new Map<string, string>();
for (const { r } of roots) for (const [k, v] of r.decls) if (k.startsWith("--")) tokens.set(k, v);

{
  /*
   * Aliases (`--red: var(--amber)`) are legal and are how a rename migrates.
   * Two PRIMITIVES holding one literal is the defect: it makes a fossil look
   * like a live decision. That was --red/--amber, both #e6ad46, for two
   * versions, and --sans/--jp holding the same stack.
   *
   * Restricted to colours and font stacks on purpose. The first draft of this
   * check compared every value and flagged --rise-1/--r-2 (both 8px) and
   * --lift/--r-1 (both 4px) — a rise and a radius are two facts that happen
   * to be equal, not one fact written twice, and aliasing them would couple
   * the motion scale to the shape scale so that retuning one moved the other.
   * A check that demands the wrong fix is worse than no check.
   */
  const isColour = (v: string): boolean => /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|color-mix\()/i.test(v);
  const isStack = (v: string): boolean => v.includes('"');
  const byValue = new Map<string, string[]>();
  for (const [name, value] of tokens) {
    if (value.includes("var(")) continue;
    if (!isColour(value) && !isStack(value)) continue;
    byValue.set(value, [...(byValue.get(value) ?? []), name]);
  }
  const dupes = [...byValue.entries()].filter(([, names]) => names.length > 1);
  check(
    "[C6] 同じ色・同じ書体スタックを持つ生トークンが2つ以上ない（別名は可）",
    dupes.length === 0,
    dupes.length === 0
      ? `${byValue.size} 個の色/スタックに重複なし`
      : dupes.map(([v, n]) => `${v.slice(0, 40)} <= ${n.join(" / ")}`).join(" / ")
  );
}

{
  /*
   * A mistyped var() falls back to the initial value in silence. During a
   * token migration that is a 0s transition reading as "the animation didn't
   * work", which sends you looking in the wrong file.
   *
   * Declarations are collected from EVERY rule, not just :root — --i on the
   * tiles and --bento-row on the grid are scoped custom properties, which is
   * the correct way to write them and which the first draft of this check
   * called an error.
   */
  const declared = new Set(tokens.keys());
  for (const file of files) {
    for (const rule of file.rules) for (const k of rule.decls.keys()) if (k.startsWith("--")) declared.add(k);
  }
  const used = new Set<string>();
  for (const file of files) {
    for (const m of file.text.matchAll(/var\(\s*(--[\w-]+)/g)) used.add(m[1]!);
  }
  const missing = [...used].filter((t) => !declared.has(t));
  check(
    "[C7] 参照されている var(--x) が全て宣言されている",
    missing.length === 0,
    missing.length === 0 ? `${used.size} 種すべて宣言済み` : missing.join(", ")
  );
}

/* ── [C8] the font request and the font stacks agree ──────────────────────
 * The strict form — must be the FIRST family of some token — is the one that
 * bites. index.html used to request six families and all six appeared in a
 * stack, so a loose check passed; but "Oswald" sat second behind Barlow and
 * "Space Grotesk" second behind Noto Sans JP, and a fallback never resolves
 * while the family in front of it does. Seven faces were declared that could
 * not paint a glyph.
 */
{
  const html = readFileSync(join(root, "index.html"), "utf8");
  const requested = new Set(
    [...html.matchAll(/family=([A-Za-z+]+)/g)].map((m) => m[1]!.replace(/\+/g, " "))
  );
  // Resolve one level of aliasing: --jp is var(--sans), and the family that
  // actually paints is the one at the end of the chain.
  const resolve = (name: string, depth = 0): string | undefined => {
    const value = tokens.get(name);
    if (!value || depth > 4) return value;
    const alias = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value);
    return alias ? resolve(alias[1]!, depth + 1) : value;
  };
  const firsts = new Set(
    ["--display", "--serif", "--sans", "--jp", "--mono"]
      .map((t) => resolve(t))
      .filter((v): v is string => Boolean(v))
      .map((v) => v.split(",")[0]!.trim().replace(/^["']|["']$/g, ""))
      .filter((f) => !f.startsWith("ui-") && f !== "system-ui")
  );
  const neverPaints = [...requested].filter((f) => !firsts.has(f));
  const neverLoaded = [...firsts].filter((f) => !requested.has(f));
  check(
    "[C8] 要求している書体が全てスタックの先頭であり、先頭が全て要求されている",
    neverPaints.length === 0 && neverLoaded.length === 0,
    neverPaints.length === 0 && neverLoaded.length === 0
      ? `${requested.size} ファミリが一致`
      : `描画されないのに読み込む: ${neverPaints.join(", ") || "なし"} / 読み込まずに使う: ${neverLoaded.join(", ") || "なし"}`
  );
}

/* ── [C9] the page's own claims about itself ──────────────────────────────
 * index.html said "全14作品" while the catalogue held 16, and the title, the
 * description and both OG cards were still advertising a walkable 3D harbour
 * that moved to harbor.html (noindex, unlinked) two versions ago. Search
 * results and every shared link described somewhere the link does not go.
 *
 * The count is the part that drifts silently, because appending a Work is a
 * one-line change in a file that has nothing to do with index.html.
 */
{
  const { CATALOG } = await import("../src/portfolio/bento");
  const html = readFileSync(join(root, "index.html"), "utf8");
  const claimed = [...html.matchAll(/全(\d+)作品/g)].map((m) => Number(m[1]));
  const wrong = claimed.filter((n) => n !== CATALOG.length);
  check(
    "[C9] index.html の作品数が CATALOG.length と一致する",
    claimed.length > 0 && wrong.length === 0,
    claimed.length === 0
      ? "index.html に作品数の記述が無い（メタが作品数を語らなくなったら消してよい検査）"
      : `記述 ${claimed.join(", ")} / 実際 ${CATALOG.length}`
  );
  const stale = ["og-harbor", "港を旅", "3Dポートフォリオ", "小舟"].filter((s) => html.includes(s));
  check(
    "[C9b] 退避済みの港サイトの文言・画像が meta に残っていない",
    stale.length === 0,
    stale.length === 0 ? "残存なし" : `残存: ${stale.join(", ")}`
  );
}

console.log(failures.length === 0 ? "CSS SELFTEST PASS" : `CSS SELFTEST FAIL — ${failures.join(", ")}`);
if (failures.length > 0) process.exitCode = 1;
