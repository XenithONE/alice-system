/**
 * Gate: every skill has a look, every look is used, and the loud things win.
 *
 * The bug this guards against had no visible symptom on any single frame —
 * every skill drew the same particle burst, so "wrong family" and "right
 * family" looked identical. A gate that only checked "something was drawn"
 * would have passed the whole time.
 *
 * Run: npx tsx src/vortex/content/fxSelftest.ts
 */
import { ACTIVE_SKILLS } from "./skills";
import {
  FX_FAMILIES,
  FX_FAMILY_BY_SKILL_ID,
  FX_FAMILY_SPECS,
  fxFamilyForEffects,
  type FxFamily
} from "./fxFamily";

declare const process: { exitCode?: number };

const failures: string[] = [];
const check = (name: string, ok: boolean, detail: string): void => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
  if (!ok) failures.push(name);
};

type Skill = { readonly id: string; readonly effects: readonly { kind: string }[] };
const skills = ACTIVE_SKILLS as unknown as readonly Skill[];

const unclassified = skills.filter((skill) => fxFamilyForEffects(skill.effects) === null);
check(
  "[X1] 全アクティブスキルが型に分類される（既定値へ落ちない）",
  unclassified.length === 0,
  unclassified.length ? unclassified.map((s) => s.id).join(", ") : `${skills.length} 件`
);

const counts = new Map<FxFamily, number>();
for (const family of FX_FAMILY_BY_SKILL_ID.values()) {
  counts.set(family, (counts.get(family) ?? 0) + 1);
}
const unused = FX_FAMILIES.filter((family) => !counts.has(family));
check(
  "[X2] 8型すべてに実際のスキルが割り当たっている（死んだ型が無い）",
  unused.length === 0,
  unused.length
    ? `未使用: ${unused.join(", ")}`
    : FX_FAMILIES.map((f) => `${f}=${counts.get(f)}`).join(" ")
);

check(
  "[X3] マップが全スキルを覆う",
  FX_FAMILY_BY_SKILL_ID.size === skills.length,
  `${FX_FAMILY_BY_SKILL_ID.size} / ${skills.length}`
);

/*
 * The knockout and sudden-death priorities live in battleScene (9 and 8). Any
 * family priority reaching them would let a routine buff push a knockout out
 * of the frame budget, which is precisely the readability failure the two
 * layers exist to prevent.
 */
const KNOCKOUT_PRIORITY = 9;
const SUDDEN_DEATH_PRIORITY = 8;
const loudest = Math.max(...FX_FAMILIES.map((f) => FX_FAMILY_SPECS[f].priority));
check(
  "[X4] どの型もKO・サドンデスより上に立たない",
  loudest < SUDDEN_DEATH_PRIORITY && loudest < KNOCKOUT_PRIORITY,
  `型の最大 ${loudest} < サドンデス ${SUDDEN_DEATH_PRIORITY} < KO ${KNOCKOUT_PRIORITY}`
);

/*
 * Two families that look the same are one family with extra steps. Compare in
 * RGB rather than by hex equality, which would pass for #6effb2 and #6effb3.
 */
const rgb = (hex: number): [number, number, number] => [
  (hex >> 16) & 255,
  (hex >> 8) & 255,
  hex & 255
];
let closest = Number.POSITIVE_INFINITY;
let closestPair = "";
for (let i = 0; i < FX_FAMILIES.length; i += 1) {
  for (let j = i + 1; j < FX_FAMILIES.length; j += 1) {
    const a = rgb(FX_FAMILY_SPECS[FX_FAMILIES[i]!].color);
    const b = rgb(FX_FAMILY_SPECS[FX_FAMILIES[j]!].color);
    const distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    if (distance < closest) {
      closest = distance;
      closestPair = `${FX_FAMILIES[i]}/${FX_FAMILIES[j]}`;
    }
  }
}
check(
  "[X5] 型の色が互いに見分けられる（最近接ペアのRGB距離）",
  closest >= 60,
  `${closestPair} = ${closest.toFixed(0)}（下限 60）`
);

// Repair must never read as a hit: green channel dominant, and not warm.
const rebootRgb = rgb(FX_FAMILY_SPECS.reboot.color);
check(
  "[X6] 再起（回復）が暖色でない",
  rebootRgb[1] > rebootRgb[0] && rebootRgb[1] > rebootRgb[2],
  `rgb(${rebootRgb.join(", ")})`
);

const table = FX_FAMILIES.map((family) => ({
  family,
  skills: counts.get(family) ?? 0,
  ...FX_FAMILY_SPECS[family]
}));
console.table(table);

if (failures.length > 0) {
  console.log(`FX SELFTEST FAIL — ${failures.join(" / ")}`);
  process.exitCode = 1;
} else {
  console.log("FX SELFTEST PASS");
}
