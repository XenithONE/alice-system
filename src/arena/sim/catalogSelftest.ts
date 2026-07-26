// Architect's audit of the v2 catalog. Checks the roster the work order asked
// for, the envelope, and does the preset arithmetic independently.
import { PARTS, PRESETS, buildCatalog } from "../parts/catalog";
import { ARENAS } from "../parts/arenas";
import { faceSize } from "./build";
import {
  isInternalPart,
  type ChassisDef,
  type DriveDef,
  type PartDef,
  type RiserDef,
  type Rot4,
  type WeaponDef
} from "./types";

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
  const hasInternalFace = p.faces.includes("internal");
  const internal = isInternalPart(p);
  if (hasInternalFace !== internal) note(`${p.id}: internal face/type mismatch`);
  if (internal && p.faces.length !== 1) note(`${p.id}: internal part must have exactly one face`);
}

const cat = (c: string) => PARTS.filter((p) => p.category === c);
const weapons = cat("weapon") as WeaponDef[];
const byAction = (a: string) => weapons.filter((w) => w.action === a);
const byEffect = (e: string) => weapons.filter((w) => w.effect === e);

const chassisDefs = cat("chassis") as ChassisDef[];
const drives = cat("drive") as DriveDef[];
const risers = cat("structure") as RiserDef[];

const roster = {
  chassis: chassisDefs.length,
  drive: drives.length,
  weapon: weapons.length,
  armor: cat("armor").length,
  utility: cat("utility").length,
  // v4. Risers are their own category because they move everything above them;
  // H2 wants at least three so a build has a real choice of storey height.
  structure: risers.length,
  leg: drives.filter((d) => d.kind === "leg").length,
  riser: PARTS.filter((p) => p.type === "riser").length,
  multiLevelChassis: chassisDefs.filter((c) => c.maxLevels >= 2).length,
  passive: byAction("passive").length,
  held: byAction("held").length,
  triggered: byAction("triggered").length,
  static: byAction("passive").filter((w) => w.effect === "static").length + byEffect("static").length
};
const need: Record<string, number> = {
  chassis: 4,
  drive: 6,
  armor: 6,
  utility: 4,
  passive: 4,
  held: 4,
  triggered: 5,
  // v4 contract: H2 structure >= 3, P2 legs 5 / risers 5 / 3 multi-storey frames
  structure: 3,
  leg: 5,
  riser: 5,
  multiLevelChassis: 3
};
for (const [k, n] of Object.entries(need)) {
  if ((roster as Record<string, number>)[k]! < n) note(`roster ${k}: ${(roster as Record<string, number>)[k]} < ${n}`);
}
// every effect the gate will demand must actually exist in the catalog
for (const e of ["spin", "grind", "impulse", "clamp", "flame", "static", "deploy", "net", "harpoon"]) {
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
  if (w.effect === "deploy" && (w.trapKind == null || w.ammo == null || w.cooldown == null)) {
    note(`${w.id}: missing deploy fields`);
  }
  if ((w.effect === "net" || w.effect === "harpoon") &&
      (w.range == null || w.muzzle == null || w.cooldown == null)) {
    note(`${w.id}: missing projectile fields`);
  }
  if (w.effect === "harpoon" && w.reelSpeed == null) note(`${w.id}: missing reelSpeed`);
  // fuel is optional by contract: omitted or 0 means the weapon needs none
  if (!["primary", "secondary", "tertiary"].includes(w.slot)) note(`${w.id}: bad slot ${w.slot}`);
}

/*
 * v4 §6.1 A3 — a riser's own `height` MUST equal its `rise`.
 *
 * That equality is what lets `y = base(level) + height / 2` place the riser AND
 * put its top exactly on the next storey's floor, so build.ts needs one formula
 * instead of two. A riser whose height and rise disagree is a catalogue error;
 * the code must not absorb it, because absorbing it means writing the storey
 * height down a second time, which is how the side wheels ended up 5 cm high.
 */
for (const riser of risers) {
  if (riser.type !== "riser") note(`${riser.id}: category "structure" but type "${riser.type}"`);
  if (Math.abs(riser.height - riser.rise) >= 1e-9) {
    note(`${riser.id}: height ${riser.height} != rise ${riser.rise} (A3)`);
  }
  // H2 states the legal band. Outside it a storey is either invisible or taller
  // than the hull it stands on.
  if (!(riser.rise >= 0.1 - 1e-9 && riser.rise <= 0.3 + 1e-9)) {
    note(`${riser.id}: rise ${riser.rise} outside 0.10..0.30 (H2)`);
  }
  if (!riser.faces.every((face) => face === "deck")) {
    note(`${riser.id}: risers mount on the deck only, got [${riser.faces.join(",")}]`);
  }
}

/*
 * H5 — every frame declares how many storeys it carries, counting the hull deck
 * as 1. validateBuild rejects `level >= maxLevels`, so a missing or fractional
 * value would silently make a frame unbuildable rather than merely flat.
 */
for (const frame of chassisDefs) {
  if (!Number.isInteger(frame.maxLevels) || frame.maxLevels < 1) {
    note(`${frame.id}: maxLevels ${frame.maxLevels} must be an integer >= 1 (H5)`);
  }
  if (frame.maxLevels > 4) note(`${frame.id}: maxLevels ${frame.maxLevels} > 4`);
}
// A frame that promises two storeys is useless without a riser short enough to
// be worth putting under it — the pair is the feature, not either half.
const shortestRise = risers.length ? Math.min(...risers.map((r) => r.rise)) : Number.POSITIVE_INFINITY;
if (roster.multiLevelChassis > 0 && !Number.isFinite(shortestRise)) {
  note("multi-storey frames exist but the catalog has no riser to stand on them");
}

/*
 * L2 / L5 / L7 — the leg envelope. `feet` drives both the collider count and
 * the phase bias (bias = PI / feet), so an absent or fractional value puts the
 * mesh and the capsules on different angles.
 */
for (const drive of drives) {
  if (drive.kind === "leg") {
    if (!Number.isInteger(drive.feet ?? NaN) || (drive.feet ?? 0) < 2) {
      note(`${drive.id}: leg feet ${drive.feet} must be an integer >= 2 (L2)`);
    }
    if (!(drive.radius >= 0.18 - 1e-9 && drive.radius <= 0.3 + 1e-9)) {
      note(`${drive.id}: leg radius ${drive.radius} outside 0.18..0.30 (L7)`);
    }
    if (!(drive.tractionAssist != null && drive.tractionAssist > 0 && drive.tractionAssist <= 0.2)) {
      note(`${drive.id}: leg tractionAssist ${drive.tractionAssist} must be in (0, 0.2] (L5)`);
    }
  } else if (drive.feet != null) {
    note(`${drive.id}: only legs may declare feet (got ${drive.feet} on a ${drive.kind})`);
  }
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
  let badLevel = 0;
  let topLevel = 0;
  for (const pp of spec.parts) {
    const def = byId.get(pp.partId);
    if (!def) { note(`${spec.name}: unknown part ${pp.partId}`); continue; }
    cost += def.cost;
    mass += def.mass;
    if (def.category === "drive") drives += 1;
    if (def.category === "weapon") slots.push((def as WeaponDef).slot);
    /*
     * v4 §6.2 — the storey belongs in the occupancy key. Without it a riser on
     * storey 0 and the part standing on top of it read as the same cell, so
     * every legal multi-storey build is reported as an overlap and stacking is
     * impossible by construction. build.ts keys the same three facts; this audit
     * has to agree with it or the two disagree about what "occupied" means.
     */
    const level = pp.face === "deck" ? Math.max(0, Math.trunc(pp.level ?? 0)) : 0;
    if ((pp.level ?? 0) !== level) badLevel += 1;
    topLevel = Math.max(topLevel, level);
    const [gridW, gridH] = faceSize(chassis, pp.face);
    for (const [x, z] of cellsOf(def, pp.cell, pp.rot)) {
      if (x < 0 || z < 0 || x >= gridW || z >= gridH) oob += 1;
      const k = `${pp.face}:${level}:${x},${z}`;
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
  if (oob) note(`${spec.name}: ${oob} cells off their mounting faces`);
  // H1 off the deck / H5 past the frame's promise. buildSelftest checks the
  // Japanese message; this checks the shipped presets never need it.
  if (badLevel) note(`${spec.name}: ${badLevel} parts carry a level they may not (H1)`);
  if (topLevel >= chassis.maxLevels) {
    note(`${spec.name}: uses storey ${topLevel} but ${chassis.id} allows 0..${chassis.maxLevels - 1} (H5)`);
  }
  return {
    name: spec.name,
    cost,
    mass: +mass.toFixed(1),
    drives,
    slots: slots.join("+") || "none",
    overlap,
    oob,
    topLevel
  };
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
