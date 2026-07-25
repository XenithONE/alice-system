/**
 * SCRAP CROWN — frozen type contract.
 *
 * Owned by the architect. Implementers must not edit this file; propose changes
 * in your report instead. Everything downstream (catalog, sim, builder, render,
 * net) is written against these shapes, so a unilateral edit desynchronises the
 * whole build.
 *
 * Units are metres, kilograms, seconds, radians. One grid cell is 0.12 m.
 */

export const CELL = 0.12;
export const SEATS = 4;

export type SeatIndex = 0 | 1 | 2 | 3;
/** Quarter turns on the build deck. */
export type Rot4 = 0 | 1 | 2 | 3;

export type PartCategory = "chassis" | "drive" | "weapon" | "armor" | "utility";

/** How a weapon puts energy into the other robot. */
export type WeaponMotion =
  /** free-spinning mass: builds up omega, hits hardest at full speed */
  | "spin"
  /** one-shot swing on a cooldown: flipper, hammer */
  | "swing"
  /** no moving part: wedges win by control, not damage */
  | "none";

interface PartDefBase {
  /** stable kebab-case key; referenced by BotSpec and never renamed */
  readonly id: string;
  readonly name: string;
  readonly nameJa: string;
  readonly category: PartCategory;
  /** kg — this is the build budget AND the physical mass. There is no separate cost. */
  readonly mass: number;
  /** part is destroyed and falls off at 0 */
  readonly hp: number;
  /** flat damage subtracted from every impact against this part */
  readonly armor: number;
  /** footprint on the deck in cells, before rotation */
  readonly cells: readonly [number, number];
  /** m, above the deck — drives both the collider and the mesh */
  readonly height: number;
  /** base brick colour, 0xRRGGBB */
  readonly color: number;
  /** one line of Japanese shown in the builder */
  readonly blurb: string;
}

export interface ChassisDef extends PartDefBase {
  readonly category: "chassis";
  /** buildable deck in cells; `cells` must equal this */
  readonly deck: readonly [number, number];
  /** m between the deck underside and the floor */
  readonly groundClearance: number;
}

export interface DriveDef extends PartDefBase {
  readonly category: "drive";
  readonly kind: "wheel" | "track";
  readonly radius: number;
  /** N·m delivered at the axle */
  readonly torque: number;
  /** rad/s ceiling for the wheel motor */
  readonly maxOmega: number;
  /** Coulomb friction against the floor */
  readonly friction: number;
}

export interface WeaponDef extends PartDefBase {
  readonly category: "weapon";
  readonly motion: WeaponMotion;
  /** impact multiplier; see the damage formula in ARCHITECTURE.md */
  readonly damageMul: number;
  /** fraction of dealt damage the weapon takes back. 0 for wedges. */
  readonly selfDamageMul: number;
  /** m the weapon sticks out past its mount, for collider placement */
  readonly reach: number;
  /** spin only */
  readonly maxOmega?: number;
  readonly spinUpTorque?: number;
  readonly inertia?: number;
  /** swing only */
  readonly impulse?: number;
  readonly cooldown?: number;
  readonly sweep?: number;
}

export interface ArmorDef extends PartDefBase {
  readonly category: "armor";
}

export interface UtilityDef extends PartDefBase {
  readonly category: "utility";
  /** grants the self-right action */
  readonly selfRight?: boolean;
  /** multiplies drive torque, e.g. 1.15 */
  readonly powerMul?: number;
}

export type PartDef = ChassisDef | DriveDef | WeaponDef | ArmorDef | UtilityDef;

export interface Catalog {
  readonly parts: readonly PartDef[];
  readonly presets: readonly BotSpec[];
  /** O(1) lookup built once at load */
  readonly byId: ReadonlyMap<string, PartDef>;
}

/** A part bolted onto the deck at a cell, rotated in quarter turns. */
export interface PlacedPart {
  readonly partId: string;
  /** top-left cell of the footprint, deck coordinates */
  readonly cell: readonly [number, number];
  readonly rot: Rot4;
}

/** Everything a player designs. Serialisable, shareable, untrusted over the wire. */
export interface BotSpec {
  readonly v: 1;
  readonly name: string;
  readonly chassisId: string;
  /** paint colour, 0xRRGGBB */
  readonly paint: number;
  readonly parts: readonly PlacedPart[];
}

/** Derived numbers shown in the builder and used by validation. */
export interface BuildStats {
  readonly mass: number;
  readonly massLimit: number;
  readonly hp: number;
  readonly armor: number;
  /** m/s on a flat floor */
  readonly topSpeed: number;
  readonly torque: number;
  /** indicative damage per hit at full weapon speed */
  readonly hitPower: number;
  readonly driveCount: number;
  readonly weaponId: string | null;
  readonly hasSelfRight: boolean;
}

export interface BuildValidation {
  readonly ok: boolean;
  /** Japanese, shown verbatim in the builder */
  readonly errors: readonly string[];
  readonly stats: BuildStats;
}

/* ------------------------------------------------------------------ */
/* runtime                                                             */
/* ------------------------------------------------------------------ */

export type MatchPhase = "countdown" | "live" | "over";

export interface MatchInput {
  /** -1 reverse .. 1 forward */
  readonly throttle: number;
  /** -1 left .. 1 right */
  readonly steer: number;
  /** weapon held */
  readonly weapon: boolean;
  /** self-right requested this frame */
  readonly selfRight: boolean;
}

export const NEUTRAL_INPUT: MatchInput = {
  throttle: 0,
  steer: 0,
  weapon: false,
  selfRight: false
};

/** Judge tally, BattleBots scoring: damage 5 / aggression 3 / control 2. */
export interface JudgeScore {
  readonly seat: SeatIndex;
  readonly damage: number;
  readonly aggression: number;
  readonly control: number;
  readonly total: number;
}

export interface BotState {
  readonly seat: SeatIndex;
  readonly name: string;
  readonly alive: boolean;
  readonly chassisHp: number;
  readonly chassisHpMax: number;
  readonly pos: readonly [number, number, number];
  readonly quat: readonly [number, number, number, number];
  readonly vel: readonly [number, number, number];
  /** rad/s of the weapon, 0 when it has none */
  readonly weaponOmega: number;
  readonly weaponAngle: number;
  /** indices into BotSpec.parts that have fallen off */
  readonly detached: readonly number[];
  /** seconds the bot has been under the immobility threshold */
  readonly immobileFor: number;
  readonly damageDealt: number;
  readonly damageTaken: number;
  /** true while the chassis is upside down */
  readonly inverted: boolean;
  readonly selfRightCooldown: number;
}

/** Fire-and-forget signals for VFX and audio; not authoritative state. */
export type SimEvent =
  | { readonly t: "hit"; readonly seat: SeatIndex; readonly by: SeatIndex; readonly x: number; readonly y: number; readonly z: number; readonly power: number }
  | { readonly t: "detach"; readonly seat: SeatIndex; readonly partIdx: number; readonly x: number; readonly y: number; readonly z: number }
  | { readonly t: "ko"; readonly seat: SeatIndex; readonly reason: KoReason }
  | { readonly t: "flip"; readonly seat: SeatIndex }
  | { readonly t: "hazard"; readonly seat: SeatIndex; readonly x: number; readonly y: number; readonly z: number };

export type KoReason = "damage" | "immobile" | "pit";

export interface MatchState {
  readonly tick: number;
  readonly elapsed: number;
  readonly phase: MatchPhase;
  readonly bots: readonly BotState[];
}

export interface MatchResult {
  readonly winner: SeatIndex | null;
  readonly reason: "ko" | "judges" | "draw";
  readonly scores: readonly JudgeScore[];
  readonly durationSec: number;
  readonly kos: readonly { readonly seat: SeatIndex; readonly reason: KoReason; readonly at: number }[];
}

export interface ArenaDef {
  readonly id: string;
  readonly name: string;
  readonly nameJa: string;
  readonly size: number;
  readonly wallHeight: number;
  readonly pit: { readonly x: number; readonly z: number; readonly r: number } | null;
  readonly saws: readonly { readonly x: number; readonly z: number; readonly r: number }[];
}

/** Injected randomness. Never call Math.random inside sim/. */
export interface Rng {
  (): number;
  int(maxExclusive: number): number;
  range(min: number, max: number): number;
}

export interface ArenaSim {
  readonly tick: number;
  readonly elapsed: number;
  readonly phase: MatchPhase;
  /** advance one fixed step; dt is always FIXED_DT */
  step(inputs: readonly MatchInput[]): void;
  getState(): MatchState;
  /** events since the previous drain; the host clears them per snapshot */
  drainEvents(): readonly SimEvent[];
  result(): MatchResult | null;
  dispose(): void;
}

export interface CreateSimOptions {
  readonly seed: number;
  /** index is the seat; null seats are skipped entirely */
  readonly specs: readonly (BotSpec | null)[];
  readonly names: readonly string[];
  readonly catalog: Catalog;
  readonly arena: ArenaDef;
}
