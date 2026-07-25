// Architect's audit of validateBuild: this is the boundary that stops a guest
// sending an illegal robot, so it gets tested adversarially, not sampled.
import { buildCatalog, PRESETS } from "../parts/catalog";
import { validateBuild, computeStats } from "./build";
import { DEFAULT_ROOM_SETTINGS, type BotSpec, type PlacedPart } from "./types";

// Node-only gate script; the app tsconfig has no node types (same shim as
// src/quest/engine/selftest.ts).
declare const process: { exitCode?: number };

const cat = buildCatalog();
const results: Record<string, unknown>[] = [];
const problems: string[] = [];

const check = (label: string, spec: BotSpec, expectOk: boolean) => {
  let ok: boolean;
  let errors: readonly string[] = [];
  try {
    const v = validateBuild(spec, cat, DEFAULT_ROOM_SETTINGS);
    ok = v.ok;
    errors = v.errors;
  } catch (e) {
    problems.push(`${label}: threw ${(e as Error).message}`);
    return;
  }
  if (ok !== expectOk) problems.push(`${label}: expected ok=${expectOk} got ${ok} (${errors.join(" / ")})`);
  results.push({ label, ok, expectOk, errors: errors.slice(0, 2) });
};

// 1. every preset must be legal
for (const p of PRESETS) check(`preset:${p.name}`, p, true);

const base = PRESETS[0]!;
const partsOf = (extra: PlacedPart[]): PlacedPart[] => [...base.parts, ...extra];

// 2. over budget
const costly = [...cat.parts].filter((p) => p.category !== "chassis").sort((a, b) => b.cost - a.cost)[0]!;
check(
  "overBudget",
  { ...base, parts: partsOf([{ partId: costly.id, face: "deck", cell: [0, 0], rot: 0 }]) },
  false
);

// 3. two parts on the same cell
const firstDrive = base.parts.find((p) => cat.byId.get(p.partId)!.category === "drive")!;
check("overlap", { ...base, parts: partsOf([{ ...firstDrive }]) }, false);

// 4. hanging off the deck
check("outOfDeck", { ...base, parts: partsOf([{ partId: firstDrive.partId, face: "deck", cell: [40, 40], rot: 0 }]) }, false);

// 5. fewer than two drives
check("noDrive", { ...base, parts: base.parts.filter((p) => cat.byId.get(p.partId)!.category !== "drive") }, false);

// 6. two weapons
const weapon = base.parts.find((p) => cat.byId.get(p.partId)!.category === "weapon");
if (weapon) {
  const other = cat.parts.find((p) => p.category === "weapon" && p.id !== weapon.partId)!;
  check("twoWeapons", { ...base, parts: partsOf([{ partId: other.id, face: "deck", cell: [0, 0], rot: 0 }]) }, false);
}

// 7. garbage input must not crash the host
check("unknownPart", { ...base, parts: partsOf([{ partId: "does-not-exist", face: "deck", cell: [0, 0], rot: 0 }]) }, false);
check("unknownChassis", { ...base, chassisId: "nope" }, false);
check("emptyBuild", { ...base, parts: [] }, false);

// stats sanity on the presets
const stats = PRESETS.map((p) => {
  const s = computeStats(p, cat, DEFAULT_ROOM_SETTINGS);
  if (s.cost > s.pointBudget) problems.push(`${p.name}: stats.cost ${s.cost} over budget`);
  if (!(s.topSpeed > 0)) problems.push(`${p.name}: topSpeed ${s.topSpeed}`);
  if (!(s.hp > 0)) problems.push(`${p.name}: hp ${s.hp}`);
  return { name: p.name, cost: s.cost, mass: +s.mass.toFixed(1), hp: s.hp, topSpeed: +s.topSpeed.toFixed(2), torque: +s.torque.toFixed(0), hit: +s.hitPower.toFixed(1), drives: s.driveCount, primary: s.primaryId, secondary: s.secondaryId };
});

console.log(JSON.stringify({ cases: results, stats, problems }, null, 2));
if (problems.length) process.exitCode = 1;
