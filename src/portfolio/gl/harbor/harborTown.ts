import * as THREE from "three";
import type { HeroQuality } from "../../quality";
import { BRICK, BRICK_H, BrickBatcher, PLATE_H, type BrickKind } from "../brick/brickKit";
import type { HarborMaterials } from "./harborModels";

/**
 * The amphitheatre ring, stated once.
 *
 * The wall and its collision used to be two separate loops with two different
 * segment counts and two different opening widths. They agreed exactly on the
 * high tier, which is where anyone looks, and on the low tier the twelve wall
 * blocks sat as much as 0.75 m from the nearest 0.62 m collider — so on a
 * phone the player walked through the arena wall and stopped at nothing.
 *
 * Everything downstream — masonry, arcade, colliders — reads this array.
 */
export const ARENA_CENTER = new THREE.Vector2(-13.0, -47.1);
export const ARENA_RADIUS = 5.0;
/** Half-width of the gap left for the gate, radians, measured from due south. */
const ARENA_GATE_HALF = 0.34;

export interface ArenaBay {
  readonly angle: number;
  readonly x: number;
  readonly z: number;
}

export function arenaBays(tier: HeroQuality["tier"]): ArenaBay[] {
  const segments = tier === "low" ? 14 : 18;
  const bays: ArenaBay[] = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    // +Z is south; leave the avenue open.
    const fromSouth = Math.abs(
      Math.atan2(Math.sin(angle - Math.PI / 2), Math.cos(angle - Math.PI / 2))
    );
    if (fromSouth < ARENA_GATE_HALF) continue;
    bays.push({
      angle,
      x: ARENA_CENTER.x + Math.cos(angle) * ARENA_RADIUS,
      z: ARENA_CENTER.y + Math.sin(angle) * ARENA_RADIUS
    });
  }
  return bays;
}

/** One span of the arcade: the opening between two neighbouring bays. */
export interface ArenaArch {
  readonly a: ArenaBay;
  readonly b: ArenaBay;
  /** Angular width of the opening, radians. */
  readonly span: number;
  /** Angle of the crown of the arch. */
  readonly mid: number;
}

function arenaPairs(bays: readonly ArenaBay[]): ArenaArch[] {
  return bays.map((a, index) => {
    const b = bays[(index + 1) % bays.length]!;
    let span = b.angle - a.angle;
    while (span <= 1e-9) span += Math.PI * 2;
    return { a, b, span, mid: a.angle + span / 2 };
  });
}

/**
 * The arcade, derived from the bays instead of from a second angle loop.
 *
 * Every neighbouring pair carries an arch except the pair that straddles the
 * gate, which is exactly three nominal steps wide — so "wider than one and a
 * half steps" separates it without restating a segment count the bays already
 * decided. Pier masonry, arch masonry and collision all read this.
 */
export function arenaArches(bays: readonly ArenaBay[]): ArenaArch[] {
  if (bays.length < 3) return [];
  const pairs = arenaPairs(bays);
  const step = Math.min(...pairs.map((pair) => pair.span));
  return pairs.filter((pair) => pair.span < step * 1.5);
}

/** The single pair the arcade skips: the two bays that flank the gate. */
export function arenaGateSpan(bays: readonly ArenaBay[]): ArenaArch | null {
  if (bays.length < 3) return null;
  const pairs = arenaPairs(bays);
  const step = Math.min(...pairs.map((pair) => pair.span));
  return pairs.find((pair) => pair.span >= step * 1.5) ?? null;
}

/** A point on the ring. `tangential` slides along the wall, `radius` across it. */
export function arenaPoint(
  angle: number,
  radius: number,
  tangential = 0
): { x: number; z: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: ARENA_CENTER.x + cos * radius - sin * tangential,
    z: ARENA_CENTER.y + sin * radius + cos * tangential
  };
}

/**
 * The amphitheatre's vertical scheme, stated once so every course lines up on
 * both tiers. Heights are brick-module exact: the walkway is y 0.72, so the
 * first podium course is mostly buried and the ring reads from 0.96 upward.
 */
const ARENA_Y = {
  podium: 0,
  podiumUpper: BRICK_H, // 0.96
  stringCourse: BRICK_H * 2, // 1.92 — the horizontal that gives the ring its scale
  arcade: BRICK_H * 2 + PLATE_H, // 2.24 — pier shafts and the voids between them
  impost: BRICK_H * 3 + PLATE_H, // 3.20 — arches spring from here
  archRing1: BRICK_H * 3 + PLATE_H * 2, // 3.52
  archRing2: BRICK_H * 3 + PLATE_H * 3, // 3.84
  keystone: BRICK_H * 3 + PLATE_H * 4, // 4.16
  cornice: BRICK_H * 3 + PLATE_H * 5, // 4.48
  attic: BRICK_H * 3 + PLATE_H * 6 // 4.80
} as const;
const ARENA_CROWN_HIGH = ARENA_Y.attic + BRICK_H; // 5.76
const ARENA_CROWN_LOW = ARENA_Y.attic; // 4.80 — the attic storey is the low-tier saving

// Sand and ivory carry the mass; gold only at tips and keystones; verdigris
// crowns the terracotta-warm stone; red and blue appear on pennants and the
// gate's keystone alone.
const ARENA_STONE = BRICK.tan;
const ARENA_STONE_DEEP = new THREE.Color(BRICK.tan).offsetHSL(0, 0, -0.06).getHex();
const ARENA_TRIM = BRICK.ivory;
const ARENA_VOID = BRICK.darkGray;
const ARENA_VERDIGRIS = BRICK.sand;

const GATE_Z = -42.55;
const GATE_PIER_DX = 1.9;
const BRAZIER_DX = 2.2;
const BRAZIER_Z = -41.2;

// Velarium banner cloth: a vertical drop hung from each mast. Tangential
// width, drop and thickness — deliberately not brick-module sizes, because it
// is cloth, not masonry, and it is drawn as its own thin mesh in createTown().
const PENNANT_W = 0.34;
const PENNANT_H = 1.12;
const PENNANT_T = 0.06;

export interface TownRuntime {
  group: THREE.Group;
  colliders: { x: number; z: number; r: number }[];
  arenaDoor: THREE.Vector3;
  setArenaHighlight(on: boolean): void;
  dispose(): void;
}

interface Building {
  x: number;
  z: number;
  color: number;
  kind: "shop" | "home" | "clock";
}

const BUILDINGS: Building[] = [
  { x: -18.0, z: -38.6, color: BRICK.red, kind: "shop" },
  { x: -21.0, z: -38.6, color: BRICK.tan, kind: "home" },
  { x: -24.0, z: -38.6, color: BRICK.blue, kind: "shop" },
  { x: -27.0, z: -38.6, color: BRICK.sand, kind: "home" },
  { x: -30.0, z: -38.6, color: BRICK.red, kind: "shop" },
  { x: -27.0, z: -44.7, color: BRICK.azure, kind: "clock" },
  { x: -30.0, z: -44.7, color: BRICK.tan, kind: "home" },
  { x: -21.0, z: -50.3, color: BRICK.sand, kind: "home" },
  { x: -25.5, z: -50.3, color: BRICK.red, kind: "shop" },
  { x: -30.0, z: -50.3, color: BRICK.blue, kind: "home" }
];

function addBuilding(
  batch: BrickBatcher,
  trim: BrickBatcher,
  building: Building,
  index: number
): void {
  const isClock = building.kind === "clock";
  const floors = isClock ? 6 : 3 + (index % 2);
  const footprintX = isClock ? 3 : 3;
  const footprintZ = isClock ? 3 : 4;
  for (let floor = 0; floor < floors; floor += 1) {
    batch.add(
      footprintX,
      footprintZ,
      "brick",
      building.x,
      floor * 0.96,
      building.z,
      floor % 2 === 0 ? building.color : new THREE.Color(building.color).offsetHSL(0, 0, 0.045).getHex()
    );
  }

  const roofY = floors * 0.96;
  trim.add(4, footprintZ + 1, "plate", building.x, roofY, building.z, index % 3 === 0 ? BRICK.orange : BRICK.darkGray);
  trim.add(3, footprintZ, "brick", building.x, roofY + PLATE_H, building.z, index % 3 === 0 ? BRICK.orange : BRICK.darkGray);

  const southFaceZ = building.z + footprintZ * 0.4 + 0.05;
  trim.add(1, 1, "tile", building.x, 0.03, southFaceZ, BRICK.darkGray);
  for (let floor = 1; floor < Math.min(floors, 4); floor += 1) {
    for (const side of [-0.72, 0.72]) {
      trim.add(1, 1, "tile", building.x + side, floor * 0.96 + 0.25, southFaceZ, BRICK.yellow);
    }
  }

  if (building.kind === "shop") {
    trim.add(3, 1, "plate", building.x, 1.22, southFaceZ + 0.32, index % 2 ? BRICK.yellow : BRICK.white);
    trim.add(1, 1, "brick", building.x - 0.75, 0.28, southFaceZ + 0.05, BRICK.medAzure);
    trim.add(1, 1, "brick", building.x + 0.75, 0.28, southFaceZ + 0.05, BRICK.medAzure);
  } else {
    trim.add(1, 1, "brick", building.x + 0.76, roofY + 0.35, building.z - 0.45, BRICK.darkGray);
  }

  if (isClock) {
    trim.add(2, 1, "tile", building.x, 5.08, building.z + 1.23, BRICK.ivory);
    trim.add(1, 1, "tile", building.x, 5.18, building.z + 1.28, BRICK.gold);
  }
}

function addTownProps(batch: BrickBatcher, low: boolean): void {
  // Market stalls and crates occupy the small square without closing either
  // cross street. All are deliberately below knee height or outside its path.
  for (const [x, z, color] of [
    [-21.5, -44.0, BRICK.orange],
    [-23.6, -45.4, BRICK.blue],
    [-21.4, -46.0, BRICK.red]
  ] as const) {
    batch.add(2, 2, "plate", x, 0, z, BRICK.tan);
    batch.add(2, 2, "plate", x, 1.0, z, color);
    batch.add(1, 1, "brick", x - 0.55, 0.32, z, BRICK.tan);
    batch.add(1, 1, "brick", x + 0.55, 0.32, z, BRICK.tan);
  }

  // Fountain / well in the square.
  for (let index = 0; index < 8; index += 1) {
    const angle = index / 8 * Math.PI * 2;
    batch.add(1, 1, "brick", -23.1 + Math.cos(angle) * 1.0, 0, -44.7 + Math.sin(angle) * 1.0, BRICK.gray, angle);
  }
  batch.add(1, 1, "brick", -23.1, 0.42, -44.7, BRICK.medAzure);

  const lampPositions = low
    ? [[-15.2, -39.4], [-15.2, -47.0], [-20.0, -41.7]]
    : [[-15.2, -39.4], [-15.2, -43.0], [-15.2, -47.0], [-20.0, -41.7], [-25.0, -41.7], [-20.0, -47.7]];
  for (const [x, z] of lampPositions) {
    batch.add(1, 1, "brick", x!, 0, z!, BRICK.darkGray);
    batch.add(1, 1, "brick", x!, 0.96, z!, BRICK.darkGray);
    batch.add(1, 1, "brick", x!, 1.92, z!, BRICK.yellow);
  }

  if (!low) {
    // Benches, planters, barrels, and a geometric (textless) hanging sign.
    for (const [x, z, rot] of [[-19.0, -42.0, 0], [-25.0, -47.5, Math.PI / 2]] as const) {
      batch.add(3, 1, "plate", x, 0.45, z, BRICK.tan, rot);
      batch.add(1, 1, "brick", x - Math.cos(rot) * 0.7, 0, z + Math.sin(rot) * 0.7, BRICK.darkGray);
      batch.add(1, 1, "brick", x + Math.cos(rot) * 0.7, 0, z - Math.sin(rot) * 0.7, BRICK.darkGray);
    }
    for (const [x, z] of [[-17.0, -41.8], [-29.0, -47.6], [-24.0, -36.9]] as const) {
      batch.add(1, 1, "brick", x, 0, z, BRICK.red);
      batch.add(1, 1, "plate", x, 0.96, z, BRICK.green);
    }
    batch.add(1, 1, "brick", -17.0, 2.0, -38.2, BRICK.darkGray);
    batch.add(2, 1, "tile", -16.85, 2.85, -38.2, BRICK.gold, Math.PI / 2);
  }
}

/** One brick in the amphitheatre, in the batcher it belongs to. */
export interface ArenaPiece {
  readonly batch: "masonry" | "trim";
  readonly fx: number;
  readonly fy: number;
  readonly kind: BrickKind;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly color: number;
  readonly rot: number;
}

export interface ArenaBuild {
  pieces: ArenaPiece[];
  colliders: { x: number; z: number; r: number }[];
  braziers: { x: number; z: number }[];
  /**
   * Vertical banners for the velarium masts and the gate poles. A pennant
   * built as a roof tile read as a 0.95 m cantilevered slab; cloth has to
   * hang, so these are drawn as thin boxes by createTown(), leaning `lean`
   * radians off plumb and dropping `drop` metres from the mast head.
   */
  pennants: { x: number; y: number; z: number; rot: number; lean: number; drop: number; color: number }[];
}

/**
 * The amphitheatre.
 *
 * A ring only reads as an amphitheatre when it has a continuous arcade: a
 * rhythm of piers with recessed, shadowed voids between them, banded top and
 * bottom by string courses so the eye has something to measure the height
 * against. Everything is generated from arenaBays()/arenaArches(); no angle is
 * derived twice, and the collision ring is pushed from the same walk through
 * the same arrays that lays the masonry.
 *
 * Low tier drops the attic storey, thins the mast count and halves the merlons.
 * It keeps the arcade — that is the whole silhouette.
 */
export function arenaPlan(tier: HeroQuality["tier"]): ArenaBuild {
  const low = tier === "low";
  const bays = arenaBays(tier);
  const arches = arenaArches(bays);
  const crownY = low ? ARENA_CROWN_LOW : ARENA_CROWN_HIGH;
  const colliders: ArenaBuild["colliders"] = [];
  const braziers: ArenaBuild["braziers"] = [];
  const pennants: ArenaBuild["pennants"] = [];
  const pieces: ArenaPiece[] = [];
  const masonry = {
    add(fx: number, fy: number, kind: BrickKind, x: number, y: number, z: number, color: number, rot = 0) {
      pieces.push({ batch: "masonry", fx, fy, kind, x, y, z, color, rot });
    }
  };
  const trim = {
    add(fx: number, fy: number, kind: BrickKind, x: number, y: number, z: number, color: number, rot = 0) {
      pieces.push({ batch: "trim", fx, fy, kind, x, y, z, color, rot });
    }
  };

  // --- piers ---------------------------------------------------------------
  bays.forEach((bay, index) => {
    const rot = -bay.angle;
    // Two podium courses: the first is half swallowed by the pavement, so one
    // course alone left the ring standing on nothing.
    masonry.add(1, 2, "brick", bay.x, ARENA_Y.podium, bay.z, ARENA_STONE, rot);
    masonry.add(1, 2, "brick", bay.x, ARENA_Y.podiumUpper, bay.z, ARENA_STONE_DEEP, rot);
    const string = arenaPoint(bay.angle, ARENA_RADIUS + 0.08);
    trim.add(1, 2, "tile", string.x, ARENA_Y.stringCourse, string.z, ARENA_TRIM, rot);

    // The pier is one stud wide so the openings beside it are actually open.
    masonry.add(1, 1, "brick", bay.x, ARENA_Y.arcade, bay.z, ARENA_STONE, rot);
    // The impost is a capital: pier-width, projecting radially. It used to run
    // 1.6 m along the wall, which choked the springing line to 0.22 m and made
    // the opening WIDER again one course above — the profile has to narrow
    // monotonically from here to the keystone, so the capital stays pier-wide.
    const impost = arenaPoint(bay.angle, ARENA_RADIUS + 0.04);
    trim.add(1, 1, "tile", impost.x, ARENA_Y.impost, impost.z, ARENA_TRIM, rot);
    // The pier carries on past the arch to the cornice, which is what the
    // corbelled ring below springs from.
    masonry.add(1, 1, "brick", bay.x, ARENA_Y.archRing1, bay.z, ARENA_TRIM, rot);

    const cornice = arenaPoint(bay.angle, ARENA_RADIUS + 0.14);
    trim.add(1, 2, "tile", cornice.x, ARENA_Y.cornice, cornice.z, ARENA_TRIM, rot);
    if (!low) {
      // Attic storey: a closed wall, the way the Colosseum's top level is a
      // wall — repeating the arcade's pier/void rhythm up here made the ring
      // read as two identical hoops. Deep-tan face, a proud tan band to break
      // it off the ivory cornice, and ivory only as pilasters on every other
      // bay (under the masts). The arch loop fills the spans the same way.
      masonry.add(1, 2, "brick", bay.x, ARENA_Y.attic, bay.z, ARENA_STONE_DEEP, rot);
      const band = arenaPoint(bay.angle, ARENA_RADIUS + 0.14);
      trim.add(1, 2, "tile", band.x, ARENA_Y.attic, band.z, ARENA_STONE, rot);
      if (index % 2 === 0) {
        const pilaster = arenaPoint(bay.angle, ARENA_RADIUS + 0.1);
        masonry.add(1, 1, "brick", pilaster.x, ARENA_Y.attic, pilaster.z, ARENA_TRIM, rot);
      }
    }
    const crown = arenaPoint(bay.angle, ARENA_RADIUS + 0.18);
    trim.add(1, 2, "tile", crown.x, crownY, crown.z, ARENA_VERDIGRIS, rot);

    // Velarium masts break the skyline; merlons fill the bays between them.
    if (index % (low ? 3 : 2) === 0) {
      const foot = arenaPoint(bay.angle, ARENA_RADIUS + 0.2);
      trim.add(1, 1, "tile", foot.x, crownY + PLATE_H, foot.z, BRICK.gold, rot);
      masonry.add(1, 1, "brick", foot.x, crownY + PLATE_H * 2, foot.z, ARENA_VOID, rot);
      // The banner HANGS: a tall narrow cloth dropped from the mast head,
      // leaning a few degrees, alternating the lean so the ring reads windblown
      // rather than stamped. (It used to be a 0.8 x 1.6 m roof tile floating
      // 0.95 m off the mast — the brightest thing on the ring, and a slab.)
      const pennant = arenaPoint(bay.angle, ARENA_RADIUS + 0.2, 0.52);
      pennants.push({
        x: pennant.x,
        y: crownY + PLATE_H * 2 + BRICK_H - 0.04 - PENNANT_H / 2,
        z: pennant.z,
        rot,
        lean: index % 4 === 0 ? 0.09 : -0.09,
        drop: PENNANT_H,
        color: index % 4 === 0 ? BRICK.red : BRICK.blue
      });
    } else if (!low || index % 2 === 0) {
      trim.add(1, 1, "plate", bay.x, crownY + PLATE_H, bay.z, ARENA_STONE, rot);
    }

    colliders.push({ x: bay.x, z: bay.z, r: 0.62 });
  });

  // --- arches --------------------------------------------------------------
  arches.forEach((arch) => {
    const rot = -arch.mid;
    const mid = arenaPoint(arch.mid, ARENA_RADIUS);
    const recess = arenaPoint(arch.mid, ARENA_RADIUS - 0.28);
    masonry.add(1, 2, "brick", mid.x, ARENA_Y.podium, mid.z, ARENA_STONE, rot);
    masonry.add(1, 2, "brick", mid.x, ARENA_Y.podiumUpper, mid.z, ARENA_STONE_DEEP, rot);
    const string = arenaPoint(arch.mid, ARENA_RADIUS + 0.08);
    trim.add(1, 2, "tile", string.x, ARENA_Y.stringCourse, string.z, ARENA_TRIM, rot);

    // Recessed and dark: from outside this is the shadow inside the opening,
    // and it keeps the ring solid without pretending the arcade is a passage.
    masonry.add(1, 2, "brick", recess.x, ARENA_Y.arcade, recess.z, ARENA_VOID, rot);
    masonry.add(1, 2, "brick", recess.x, ARENA_Y.impost, recess.z, ARENA_VOID, rot);
    trim.add(1, 2, "tile", recess.x, ARENA_Y.keystone, recess.z, ARENA_VOID, rot);

    // Corbelled arch. The opening narrows monotonically from the springing
    // line to the keystone: each course steps further into the span AND a
    // little prouder of the wall face, so the front of the ring carries the
    // curve instead of hiding it flush with the piers. The old fractions
    // (0.3/0.7) slammed the opening shut a course early and then let it back
    // open beside the keystone — four sign flips in the opening profile.
    for (const fraction of [0.15, 0.85]) {
      const angle = arch.a.angle + arch.span * fraction;
      const point = arenaPoint(angle, ARENA_RADIUS + 0.02);
      trim.add(1, 1, "plate", point.x, ARENA_Y.archRing1, point.z, ARENA_TRIM, -angle);
    }
    for (const fraction of [0.25, 0.75]) {
      const angle = arch.a.angle + arch.span * fraction;
      const point = arenaPoint(angle, ARENA_RADIUS + 0.06);
      trim.add(1, 1, "plate", point.x, ARENA_Y.archRing2, point.z, ARENA_TRIM, -angle);
    }
    // The keystone course closes the span completely on both tiers: two
    // flankers meet the gold keystone, so at keystone height the opening is 0.
    for (const fraction of [0.25, 0.75]) {
      const angle = arch.a.angle + arch.span * fraction;
      const point = arenaPoint(angle, ARENA_RADIUS + 0.06);
      trim.add(1, 1, "plate", point.x, ARENA_Y.keystone, point.z, ARENA_TRIM, -angle);
    }
    // Proud of the pier face by 0.10 m — a keystone that sits flush is just a brick.
    const key = arenaPoint(arch.mid, ARENA_RADIUS + 0.1);
    trim.add(1, 1, "plate", key.x, ARENA_Y.keystone, key.z, BRICK.gold, rot);

    const cornice = arenaPoint(arch.mid, ARENA_RADIUS + 0.14);
    trim.add(1, 2, "tile", cornice.x, ARENA_Y.cornice, cornice.z, ARENA_TRIM, rot);
    if (!low) {
      // Attic span: closed deep-tan wall plus the proud tan band, matching the
      // bay loop — no second arcade of voids up here.
      masonry.add(1, 2, "brick", mid.x, ARENA_Y.attic, mid.z, ARENA_STONE_DEEP, rot);
      const band = arenaPoint(arch.mid, ARENA_RADIUS + 0.14);
      trim.add(1, 2, "tile", band.x, ARENA_Y.attic, band.z, ARENA_STONE, rot);
    }
    const crown = arenaPoint(arch.mid, ARENA_RADIUS + 0.18);
    trim.add(1, 2, "tile", crown.x, crownY, crown.z, ARENA_VERDIGRIS, rot);

    colliders.push({ x: mid.x, z: mid.z, r: 0.62 });
  });

  // --- gate ----------------------------------------------------------------
  const gatePierX = [ARENA_CENTER.x - GATE_PIER_DX, ARENA_CENTER.x + GATE_PIER_DX];

  // Abutments closing the ring onto the gate. Derived from the pair the arcade
  // skipped, so they follow the bays even when the segment count changes — on
  // the low tier the ring used to end 1.0 m short of the gate pier, wide enough
  // for the 0.84 m walker to step straight through the arena wall.
  const gateSpan = arenaGateSpan(bays);
  for (const bay of gateSpan ? [gateSpan.a, gateSpan.b] : []) {
    const pierX = bay.x > ARENA_CENTER.x ? gatePierX[1]! : gatePierX[0]!;
    const x = (bay.x + pierX) / 2;
    const z = (bay.z + GATE_Z) / 2;
    const rot = Math.atan2(pierX - bay.x, GATE_Z - bay.z);
    masonry.add(1, 2, "brick", x, ARENA_Y.podium, z, ARENA_STONE, rot);
    masonry.add(1, 2, "brick", x, ARENA_Y.podiumUpper, z, ARENA_STONE_DEEP, rot);
    trim.add(1, 2, "tile", x, ARENA_Y.stringCourse, z, ARENA_TRIM, rot);
    masonry.add(1, 2, "brick", x, ARENA_Y.arcade, z, ARENA_STONE, rot);
    trim.add(1, 2, "tile", x, ARENA_Y.impost, z, ARENA_TRIM, rot);
    masonry.add(1, 2, "brick", x, ARENA_Y.archRing1, z, ARENA_TRIM, rot);
    trim.add(1, 2, "tile", x, ARENA_Y.cornice, z, ARENA_TRIM, rot);
    trim.add(1, 2, "tile", x, crownY, z, ARENA_VERDIGRIS, rot);
    colliders.push({ x, z, r: 0.62 });
  }

  // The gatehouse carries an attic storey the arcade does not, so its mass ends
  // above the ring's crown: the way in has to be the tallest solid thing here,
  // or it reads as something bolted onto a bigger wall.
  const GATE_ATTIC = ARENA_Y.attic; // 4.80, on top of the architrave
  const GATE_CORNICE = GATE_ATTIC + BRICK_H; // 5.76
  const GATE_CROWN = GATE_CORNICE + PLATE_H; // 6.08
  const GATE_POLE = GATE_CROWN + PLATE_H; // 6.40
  for (const x of gatePierX) {
    const east = x > ARENA_CENTER.x;
    masonry.add(2, 2, "brick", x, ARENA_Y.podium, GATE_Z, ARENA_STONE);
    masonry.add(2, 2, "brick", x, ARENA_Y.podiumUpper, GATE_Z, ARENA_STONE_DEEP);
    trim.add(2, 2, "tile", x, ARENA_Y.stringCourse, GATE_Z, ARENA_TRIM);
    masonry.add(2, 2, "brick", x, ARENA_Y.arcade, GATE_Z, ARENA_STONE);
    trim.add(2, 2, "tile", x, ARENA_Y.impost, GATE_Z, ARENA_TRIM);
    // Mass is warm stone, ivory is reserved for the thin bands. Building the
    // pier cap and the attic in ivory turned the whole upper gate into one
    // undifferentiated pale slab.
    masonry.add(2, 2, "brick", x, ARENA_Y.archRing1, GATE_Z, ARENA_STONE);
    trim.add(2, 2, "tile", x, ARENA_Y.cornice, GATE_Z, ARENA_TRIM);
    masonry.add(2, 2, "brick", x, GATE_ATTIC, GATE_Z, ARENA_STONE_DEEP);
    trim.add(2, 2, "tile", x, GATE_CORNICE, GATE_Z, ARENA_TRIM);
    trim.add(2, 2, "tile", x, GATE_CROWN, GATE_Z, ARENA_VERDIGRIS);
    masonry.add(1, 1, "brick", x, GATE_POLE, GATE_Z, ARENA_VOID);
    // Gate standards hang like the ring's banners — the 1.6 m tile that used
    // to lie flat a metre off each pole was the same slab problem as F8. The
    // drop is shortened so the cloth clears the gatehouse crown slab below.
    const gateDrop = 0.86;
    pennants.push({
      x: x + (east ? 0.52 : -0.52),
      y: GATE_POLE + BRICK_H - 0.04 - gateDrop / 2,
      z: GATE_Z,
      rot: Math.PI / 2,
      lean: east ? -0.09 : 0.09,
      drop: gateDrop,
      color: east ? BRICK.blue : BRICK.red
    });
    colliders.push({ x, z: GATE_Z, r: 0.85 });
  }

  // Gate arch, architrave, attic and crown across the span.
  for (const dx of [-1.33, 1.33]) {
    trim.add(1, 1, "plate", ARENA_CENTER.x + dx, ARENA_Y.archRing1, GATE_Z, ARENA_TRIM);
  }
  for (const dx of [-0.78, 0.78]) {
    trim.add(1, 1, "plate", ARENA_CENTER.x + dx, ARENA_Y.archRing2, GATE_Z, ARENA_TRIM);
  }
  // Spandrels. The band between the arch rings and the cornice used to be open
  // air either side of the keystone — two 0.7 x 0.32 m through-holes that
  // showed the arena's inside from the avenue and left the red crest floating.
  // Fill them wall-deep in stone; they overlap the piers and the crest so the
  // brick bevels cannot reopen a seam.
  for (const dx of [-0.75, 0.75]) {
    masonry.add(1, 2, "plate", ARENA_CENTER.x + dx, ARENA_Y.keystone, GATE_Z, ARENA_STONE);
  }
  trim.add(4, 2, "tile", ARENA_CENTER.x, ARENA_Y.cornice, GATE_Z, ARENA_TRIM);
  for (const dx of [-1.05, 0, 1.05]) {
    masonry.add(2, 2, "brick", ARENA_CENTER.x + dx, GATE_ATTIC, GATE_Z, ARENA_STONE_DEEP);
  }
  trim.add(4, 2, "tile", ARENA_CENTER.x, GATE_CORNICE, GATE_Z, ARENA_TRIM);
  trim.add(4, 2, "tile", ARENA_CENTER.x, GATE_CROWN, GATE_Z, ARENA_VERDIGRIS);
  // The only red in the whole ring: the crest over the arch crown. Pushed
  // 0.55 m forward of the arch face so the architrave cannot hide it, and now
  // backed by the spandrels rather than by two windows of open air. Its base
  // sits on the keystone course, so it reads as mounted, not floating.
  masonry.add(1, 1, "brick", ARENA_CENTER.x, ARENA_Y.keystone, GATE_Z + 0.55, BRICK.red);

  // Braziers flanking the approach: the warm point light already lived here, so
  // give it something visible to come out of.
  for (const x of [ARENA_CENTER.x - BRAZIER_DX, ARENA_CENTER.x + BRAZIER_DX]) {
    masonry.add(1, 1, "brick", x, ARENA_Y.podium, BRAZIER_Z, ARENA_VOID);
    masonry.add(1, 1, "brick", x, ARENA_Y.podiumUpper, BRAZIER_Z, ARENA_VOID);
    trim.add(1, 1, "plate", x, ARENA_Y.stringCourse, BRAZIER_Z, BRICK.gold);
    trim.add(1, 1, "plate", x, ARENA_Y.stringCourse + PLATE_H, BRAZIER_Z, BRICK.orange);
    colliders.push({ x, z: BRAZIER_Z, r: 0.34 });
    braziers.push({ x, z: BRAZIER_Z });
  }

  // Threshold. Two inlaid bands rather than real risers: the walker's y is
  // fixed at 0.72, so anything that actually stood proud would swallow its
  // shins. Both tops sit at or just under the pavement. Positions are derived
  // from the gate, like everything else on this axis.
  trim.add(6, 3, "tile", ARENA_CENTER.x, 0.37, GATE_Z + 1.2, ARENA_TRIM);
  trim.add(4, 2, "tile", ARENA_CENTER.x, 0.42, GATE_Z + 0.8, ARENA_STONE);

  return { pieces, colliders, braziers, pennants };
}

/** Lays the plan into the town's two batchers. */
function addArena(
  masonry: BrickBatcher,
  trim: BrickBatcher,
  tier: HeroQuality["tier"]
): ArenaBuild {
  const plan = arenaPlan(tier);
  for (const piece of plan.pieces) {
    const batcher = piece.batch === "masonry" ? masonry : trim;
    batcher.add(piece.fx, piece.fy, piece.kind, piece.x, piece.y, piece.z, piece.color, piece.rot);
  }
  return plan;
}

export function createTown(
  materials: HarborMaterials,
  quality: HeroQuality
): TownRuntime {
  const group = new THREE.Group();
  group.name = "harbor-town";
  const ownedGeometries: THREE.BufferGeometry[] = [];
  const ownedMaterials: THREE.Material[] = [];

  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(24.35, 0.42, 15.6),
    materials.stoneDark
  );
  ground.name = "town-base";
  ground.position.set(-19.825, 0.35, -44.2);
  ground.receiveShadow = true;
  group.add(ground);
  ownedGeometries.push(ground.geometry);

  const pavingGeometry = new THREE.BoxGeometry(1, 0.12, 1);
  const pavingMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    vertexColors: true
  });
  const paving: Array<{ x: number; z: number; sx: number; sz: number; color: number }> = [
    { x: -11.9, z: -44.2, sx: 5.1, sz: 15.6, color: 0xc9b48d },
    { x: -20.2, z: -41.7, sx: 16.8, sz: 2.8, color: 0xb7a985 },
    { x: -23.2, z: -47.7, sx: 15.2, sz: 2.8, color: 0xb7a985 },
    { x: -23.1, z: -44.7, sx: 4.7, sz: 4.4, color: 0xd1c39c }
  ];
  const pavingMesh = new THREE.InstancedMesh(pavingGeometry, pavingMaterial, paving.length);
  const dummy = new THREE.Object3D();
  paving.forEach((item, index) => {
    dummy.position.set(item.x, 0.62, item.z);
    dummy.scale.set(item.sx, 1, item.sz);
    dummy.updateMatrix();
    pavingMesh.setMatrixAt(index, dummy.matrix);
    pavingMesh.setColorAt(index, new THREE.Color(item.color));
  });
  pavingMesh.instanceMatrix.needsUpdate = true;
  if (pavingMesh.instanceColor) pavingMesh.instanceColor.needsUpdate = true;
  pavingMesh.receiveShadow = true;
  group.add(pavingMesh);
  ownedGeometries.push(pavingGeometry);
  ownedMaterials.push(pavingMaterial);

  const brickMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.66,
    metalness: 0,
    vertexColors: true
  });
  const trimMaterial = brickMaterial.clone();
  trimMaterial.roughness = 0.52;
  ownedMaterials.push(brickMaterial, trimMaterial);
  const buildings = new BrickBatcher(brickMaterial, quality.tier === "low" ? 6 : 8);
  const trim = new BrickBatcher(trimMaterial, quality.tier === "low" ? 6 : 8);
  BUILDINGS.forEach((building, index) => addBuilding(buildings, trim, building, index));
  addTownProps(trim, quality.tier === "low");

  const arena = addArena(buildings, trim, quality.tier);

  const buildingBatch = buildings.build(quality.tier !== "low");
  const trimBatch = trim.build(false);
  group.add(buildingBatch.group, trimBatch.group);

  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd58a,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    toneMapped: false
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.25, 2.65), glowMaterial);
  glow.name = "arena-gate-glow";
  glow.position.set(ARENA_CENTER.x, 1.55, GATE_Z - 0.15);
  group.add(glow);
  ownedGeometries.push(glow.geometry);
  ownedMaterials.push(glowMaterial);

  const arenaLight = new THREE.PointLight(
    0xffb85c,
    quality.tier === "low" ? 0.55 : 1.1,
    7,
    2
  );
  arenaLight.position.set(ARENA_CENTER.x, 1.7, GATE_Z - 0.75);
  group.add(arenaLight);

  // The point light is the entry signal, but it used to hang in mid air. The
  // braziers now sit under it, so the warmth reads as coming from a source.
  const brazierGeometry = new THREE.PlaneGeometry(0.62, 0.92);
  const brazierMaterial = new THREE.MeshBasicMaterial({
    color: 0xffb15c,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    toneMapped: false
  });
  const brazierGlows = arena.braziers.map((brazier) => {
    const mesh = new THREE.Mesh(brazierGeometry, brazierMaterial);
    mesh.name = "arena-brazier-glow";
    mesh.position.set(brazier.x, 2.4, brazier.z + 0.06);
    group.add(mesh);
    return mesh;
  });
  ownedGeometries.push(brazierGeometry);
  ownedMaterials.push(brazierMaterial);

  // Velarium banners: vertical cloth hung from the mast heads, one thin box
  // per mast with a per-instance lean. Not a brick on purpose — the flat tile
  // version read as a cantilevered slab, and this is the ring's only saturated
  // colour, so it has to read as fabric.
  const pennantGeometry = new THREE.BoxGeometry(PENNANT_T, PENNANT_H, PENNANT_W);
  const pennantMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.78,
    metalness: 0,
    vertexColors: true
  });
  const pennantMesh = new THREE.InstancedMesh(
    pennantGeometry,
    pennantMaterial,
    arena.pennants.length
  );
  pennantMesh.name = "arena-pennants";
  arena.pennants.forEach((pennant, index) => {
    dummy.position.set(pennant.x, pennant.y, pennant.z);
    dummy.rotation.set(0, pennant.rot, pennant.lean);
    dummy.scale.set(1, pennant.drop / PENNANT_H, 1);
    dummy.updateMatrix();
    pennantMesh.setMatrixAt(index, dummy.matrix);
    pennantMesh.setColorAt(index, new THREE.Color(pennant.color));
  });
  pennantMesh.instanceMatrix.needsUpdate = true;
  if (pennantMesh.instanceColor) pennantMesh.instanceColor.needsUpdate = true;
  pennantMesh.castShadow = quality.tier !== "low";
  group.add(pennantMesh);
  ownedGeometries.push(pennantGeometry);
  ownedMaterials.push(pennantMaterial);

  const colliders = BUILDINGS.map((building) => ({
    x: building.x,
    z: building.z,
    r: building.kind === "clock" ? 1.62 : 1.55
  }));
  // Pushed by the same walk through the same bays/arches that laid the masonry,
  // so the wall a player can see is the wall a player runs into on every tier.
  colliders.push(...arena.colliders, { x: -23.1, z: -44.7, r: 1.05 });

  let disposed = false;
  return {
    group,
    colliders,
    // Derived from the same axis as the masonry; -42.55 + 0.65 === -41.9
    // exactly in doubles, so the runtime value is bit-identical to before.
    arenaDoor: new THREE.Vector3(ARENA_CENTER.x, 0.72, GATE_Z + 0.65),
    setArenaHighlight(on: boolean) {
      glowMaterial.opacity = on ? 0.82 : 0.34;
      arenaLight.intensity = on
        ? (quality.tier === "low" ? 1.25 : 2.8)
        : (quality.tier === "low" ? 0.55 : 1.1);
      glow.scale.setScalar(on ? 1.12 : 1);
      brazierMaterial.opacity = on ? 0.95 : 0.5;
      for (const flame of brazierGlows) flame.scale.setScalar(on ? 1.2 : 1);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      buildingBatch.dispose();
      trimBatch.dispose();
      // InstancedMesh owns GPU-side instance buffers on top of its geometry;
      // dispose them explicitly or they outlive the town.
      pavingMesh.dispose();
      pennantMesh.dispose();
      ownedGeometries.forEach((geometry) => geometry.dispose());
      ownedMaterials.forEach((material) => material.dispose());
      group.clear();
    }
  };
}
