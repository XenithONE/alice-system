// Architect's audit of the v2 catalog. Checks the roster the work order asked
// for, the envelope, and does the preset arithmetic independently.
import { PARTS, PRESETS, buildCatalog } from "../parts/catalog";
import { ARENAS } from "../parts/arenas";
import type { PartDef, Rot4, WeaponDef } from "./types";

declare const process: { exitCode?: number };

const problems: string[] = [];
const note = (m: string) => problems.push(m);

const ids = new Set<string>();
for (const p of PARTS) {
  if (ids.has(p.id)) note(`duplicate id ${p.id}`);
  ids.add(p.id);
  if (!(p.cost > 0)) note(`${p.id}: cost ${p.cost}`);
  if (!(p.mass > 0)) note(`${p.id}: mass ${p.mass}`);
  if (!p.material) note(`${p.id}: no material`);
}

const cat = (c: string) => PARTS.filter((p) => p.category === c);
const weapons = cat("weapon") as WeaponDef[];
const byAction = (a: string) => weapons.filter((w) => w.action === a);
const byEffect = (e: string) => weapons.filter((w) => w.effect === e);

const roster = {
  chassis: cat("chassis").length,
  drive: cat("drive").length,
  weapon: weapons.length,
  armor: cat("armor").length,
  utility: cat("utility").length,
  passive: byAction("passive").length,
  held: byAction("held").length,
  triggered: byAction("triggered").length,
  static: byAction("passive").filter((w) => w.effect === "static").length + byEffect("static").length
};
const need: Record<string, number> = { chassis: 4, drive: 6, armor: 6, utility: 4, passive: 4, held: 4, triggered: 5 };
for (const [k, n] of Object.entries(need)) {
  if ((roster as Record<string, number>)[k]! < n) note(`roster ${k}: ${(roster as Record<string, number>)[k]} < ${n}`);
}
// every effect the gate will demand must actually exist in the catalog
for (const e of ["spin", "grind", "impulse", "clamp", "flame", "static"]) {
  if (byEffect(e).length === 0) note(`no weapon with effect "${e}"`);
}
// required per-effect fields
for (const w of weapons) {
  if ((w.effect === "spin" || w.effect === "grind") && w.maxOmega == null) note(`${w.id}: missing maxOmega`);
  if (w.effect === "grind" && w.dps == null) note(`${w.id}: missing dps`);
  if (w.effect === "clamp" && (w.dps == null || w.holdSec == null)) note(`${w.id}: missing clamp fields`);
  if (w.effect === "flame" && (w.dps == null || w.coneAngle == null || w.coneRange == null || w.fuel == null)) {
    note(`${w.id}: missing flame fields`);
  }
  if (w.effect === "impulse" && (w.impulse == null || w.cooldown == null)) note(`${w.id}: missing impulse fields`);
  // fuel is optional by contract: omitted or 0 means the weapon needs none
  if (!["primary", "secondary", "tertiary"].includes(w.slot)) note(`${w.id}: bad slot ${w.slot}`);
}

// cheap+heavy vs dear+light must actually exist among armour, or points are pointless
const armour = cat("armor");
const cheapHeavy = armour.some((a) => a.cost <= 90 && a.mass >= 11);
const dearLight = armour.some((a) => a.cost >= 140 && a.mass <= 9);
if (!cheapHeavy || !dearLight) note(`armour lacks the cheap-heavy / dear-light contrast (cheapHeavy=${cheapHeavy} dearLight=${dearLight})`);

const cellsOf = (p: PartDef, cell: readonly [number, number], rot: Rot4): [number, number][] => {
  const [w, d] = rot % 2 === 0 ? [p.cells[0], p.cells[1]] : [p.cells[1], p.cells[0]];
  const out: [number, number][] = [];
  for (let x = 0; x < w; x += 1) for (let z = 0; z < d; z += 1) out.push([cell[0] + x, cell[1] + z]);
  return out;
};

const byId = new Map(PARTS.map((p) => [p.id, p]));
const presetRows = PRESETS.map((spec) => {
  const chassis = byId.get(spec.chassisId);
  if (!chassis || chassis.category !== "chassis") { note(`${spec.name}: bad chassis`); return null; }
  let cost = chassis.cost;
  let mass = chassis.mass;
  let drives = 0;
  const slots: string[] = [];
  const used = new Set<string>();
  let overlap = 0;
  let oob = 0;
  for (const pp of spec.parts) {
    const def = byId.get(pp.partId);
    if (!def) { note(`${spec.name}: unknown part ${pp.partId}`); continue; }
    cost += def.cost;
    mass += def.mass;
    if (def.category === "drive") drives += 1;
    if (def.category === "weapon") slots.push((def as WeaponDef).slot);
    for (const [x, z] of cellsOf(def, pp.cell, pp.rot)) {
      if (x < 0 || z < 0 || x >= chassis.deck[0] || z >= chassis.deck[1]) oob += 1;
      const k = `${pp.face}:${x},${z}`;
      if (used.has(k)) overlap += 1;
      used.add(k);
    }
  }
  if (spec.v !== 3) note(`${spec.name}: spec version ${spec.v} != 3`);
  if (cost > 1000) note(`${spec.name}: cost ${cost} > 1000`);
  if (drives < 2) note(`${spec.name}: drives ${drives} < 2`);
  if (slots.filter((s) => s === "primary").length > 1) note(`${spec.name}: two primaries`);
  if (slots.filter((s) => s === "secondary").length > 1) note(`${spec.name}: two secondaries`);
  if (slots.filter((s) => s === "tertiary").length > 1) note(`${spec.name}: two tertiaries`);
  if (overlap) note(`${spec.name}: ${overlap} overlapping cells`);
  if (oob) note(`${spec.name}: ${oob} cells off the deck`);
  return { name: spec.name, cost, mass: +mass.toFixed(1), drives, slots: slots.join("+") || "none", overlap, oob };
}).filter(Boolean);

if (PRESETS.length < 6) note(`presets ${PRESETS.length} < 6`);
if (ARENAS.length < 3) note(`arenas ${ARENAS.length} < 3`);
if (!ARENAS.some((a) => a.flameJets.length >= 4)) note("no arena with 4+ flame jets");
if (buildCatalog().byId.size !== PARTS.length) note("byId size mismatch");

console.log(JSON.stringify({
  parts: PARTS.length,
  roster,
  weapons: weapons.map((w) => `${w.id}[${w.action}/${w.effect}/${w.slot}] ${w.cost}pt ${w.mass}kg`),
  presets: presetRows,
  arenas: ARENAS.map((a) => `${a.id} pit=${a.pit ? "yes" : "no"} saws=${a.saws.length} jets=${a.flameJets.length}`),
  problems
}, null, 2));
if (problems.length) process.exitCode = 1;
