/**
 * SCRAP CROWN — frozen type contract (v2: realistic combat robots).
 *
 * Owned by the architect. Implementers must not edit this file; propose changes
 * in your report instead. Everything downstream (catalog, sim, builder, render,
 * net) is written against these shapes, so a unilateral edit desynchronises the
 * whole build.
 *
 * v2 changes the game, not just the numbers:
 *  - the build budget is POINTS, set per room by the host. Mass stays as a
 *    physical property so armour still makes you slow, but what you can afford
 *    is now the room's call. Cheap heavy steel vs expensive light titanium is
 *    the interesting decision and it did not exist when mass was the budget.
 *  - weapons have an ACTION: always running, live while you hold the button, or
 *    one-shot on a cooldown. A machine can carry two, so "spinning side saws
 *    plus a launcher" is a build you can actually make.
 *  - the look is real machinery: welded plate, hydraulics, scorched steel. The
 *    toy-brick language belongs to the site, not to this game.
 *
 * Units are metres, kilograms, seconds, radians. One grid cell is 0.12 m.
 */

export const CELL = 0.12;
export const SEATS = 4;

export type SeatIndex = 0 | 1 | 2 | 3;
/** Quarter turns on the build deck. */
export type Rot4 = 0 | 1 | 2 | 3;

export type PartCategory = "chassis" | "drive" | "weapon" | "armor" | "utility";

/** When the weapon does its work. */
export type WeaponAction =
  /** runs from the start of the match and never stops: side saws, shell spinners */
  | "passive"
  /** live only while the player holds the button: flamethrower, cutting disc */
  | "held"
  /** one shot, then a cooldown: flipper, spear, hammer, crusher */
  | "triggered";

/** How the weapon converts energy into someone else's bad day. */
export type WeaponEffect =
  /** rotating mass; impact damage scales with how much speed it has built up */
  | "spin"
  /** continuous cutting while in contact and active */
  | "grind"
  /** a single violent push: flippers, lifters, spears, hammers */
  | "impulse"
  /** grabs and squeezes, holding the victim while it chews through armour */
  | "clamp"
  /** cone of fire; damage over time, burns fuel, ignores most armour */
  | "flame"
  /** no moving parts; wedges, forks and spikes win by geometry */
  | "static";

/** Which button drives it. Three weapons means three buttons. */
export type WeaponSlot = "primary" | "secondary" | "tertiary";

/** Fixed key for each slot, shown in the builder and the HUD. */
export const SLOT_KEYS: readonly (readonly [WeaponSlot, string])[] = [
  ["primary", "Space"],
  ["secondary", "Shift"],
  ["tertiary", "F"]
];

/**
 * Fine-grained type, purely for letting the player find things. `category`
 * still drives the rules; this drives the filter list, because "weapon" is
 * useless when you are hunting for a drill.
 */
export type PartType =
  | "frame"
  | "wheel"
  | "track"
  | "spinner"
  | "drum"
  | "saw"
  | "drill"
  | "flipper"
  | "lifter"
  | "spear"
  | "hammer"
  | "crusher"
  | "flame"
  | "wedge"
  | "fork"
  | "spike"
  | "plate"
  | "applique"
  | "skirt"
  | "srimech"
  | "power"
  | "booster"
  /*
   * The engine bay. These four are `category: "utility"` like any other bolt-on
   * — what makes them internals is that they are the only types allowed on the
   * "internal" face, and the only ones that contribute to the four plant
   * budgets. See isInternalPart.
   */
  | "engine"
  | "battery"
  | "tank"
  | "radiator";

/** Japanese labels for the builder's type filter, in display order. */
export const PART_TYPE_LABELS: readonly (readonly [PartType, string])[] = [
  ["frame", "フレーム"],
  ["wheel", "タイヤ系"],
  ["track", "ベルト系"],
  ["spinner", "スピナー系"],
  ["drum", "ドラム系"],
  ["saw", "のこぎり系"],
  ["drill", "ドリル系"],
  ["flipper", "フリッパー"],
  ["lifter", "リフター"],
  ["spear", "スピア"],
  ["hammer", "ハンマー"],
  ["crusher", "クラッシャー"],
  ["flame", "火炎"],
  ["wedge", "ウェッジ"],
  ["fork", "フォーク"],
  ["spike", "スパイク"],
  ["plate", "装甲板"],
  ["applique", "貼付装甲"],
  ["skirt", "スカート"],
  ["srimech", "自立機構"],
  ["power", "電源"],
  ["booster", "ブースター"],
  ["engine", "エンジン"],
  ["battery", "バッテリー"],
  ["tank", "燃料タンク"],
  ["radiator", "ラジエーター"]
];

/**
 * The engine-bay types. A part is an internal if and only if it is one of
 * these, and an internal may only be mounted on the "internal" face — both
 * directions are enforced in validateBuild and asserted in catalogSelftest,
 * because `faces` alone is catalogue data and catalogue data can be wrong.
 */
export const INTERNAL_TYPES = ["engine", "battery", "tank", "radiator"] as const;
export type InternalType = (typeof INTERNAL_TYPES)[number];

export function isInternalPart(part: PartDef): boolean {
  return part.category === "utility"
    && (INTERNAL_TYPES as readonly string[]).includes(part.type);
}

/**
 * Which surface of the hull a part bolts to. Wheels tucked underneath give a
 * low, hard-to-flip machine; wheels hung on the flanks are exposed but let the
 * bot drive upside down; tracks belong on the sides. Restricting everything to
 * the top deck made every robot look the same.
 *
 * "internal" is the engine bay: a grid INSIDE the hull slab rather than on a
 * surface of it. It exists so that installing an engine costs volume you could
 * have spent on something else — that spatial cost is the third cap that keeps
 * the plant budgets from being free (the other two are points and waste heat).
 * Only INTERNAL_TYPES may sit there, and they may sit nowhere else.
 */
export type MountFace =
  | "deck" | "underside" | "left" | "right" | "front" | "rear" | "internal";

export const MOUNT_FACE_LABELS: readonly (readonly [MountFace, string])[] = [
  ["deck", "上面"],
  ["underside", "底面"],
  ["left", "左側面"],
  ["right", "右側面"],
  ["front", "前面"],
  ["rear", "背面"],
  ["internal", "機関室"]
];

interface PartDefBase {
  /** fine-grained kind, for the builder's filter list */
  readonly type: PartType;
  /** faces this part may bolt to; the builder greys out the rest */
  readonly faces: readonly MountFace[];
  /** stable kebab-case key; referenced by BotSpec and never renamed */
  readonly id: string;
  readonly name: string;
  readonly nameJa: string;
  readonly category: PartCategory;
  /** what the part costs out of the room's budget */
  readonly cost: number;
  /** kg — physical mass. Affects handling and impact, but is not the budget. */
  readonly mass: number;
  /** part is destroyed and falls off at 0 */
  readonly hp: number;
  /** flat damage subtracted from every impact against this part */
  readonly armor: number;
  /** footprint on the deck in cells, before rotation */
  readonly cells: readonly [number, number];
  /** m, above the deck — drives both the collider and the mesh */
  readonly height: number;
  /** how it is rendered: real machinery, not painted plastic */
  readonly material: SurfaceMaterial;
  /** base colour, 0xRRGGBB */
  readonly color: number;
  /** one line of Japanese shown in the builder */
  readonly blurb: string;
}

/** Render hints so the whole machine reads as fabricated metal. */
export type SurfaceMaterial =
  | "steel"
  | "titanium"
  | "hardox"
  | "aluminium"
  | "polymer"
  | "rubber"
  | "carbon"
  | "brass";

export interface ChassisDef extends PartDefBase {
  readonly category: "chassis";
  /** buildable deck in cells; `cells` must equal this */
  readonly deck: readonly [number, number];
  /** m between the deck underside and the floor */
  readonly groundClearance: number;
  /** how many cells tall the flanks are, giving the side faces a grid */
  readonly heightCells: number;
  /** drive still works upside down (a real invertible design) */
  readonly invertible: boolean;

  /** engine bay in cells, read (x, z) like the deck */
  readonly internalGrid: readonly [number, number];
  /*
   * The plant welded into the frame. Internals ADD to these; they do not
   * replace them. This is not free power — it is the drive ESCs and the pack
   * every combat robot has by definition, and without it the eight shipping
   * presets (which carry no internals) would all become invalid builds and
   * take buildSelftest, driveSelftest and the headless gate down with them.
   * Tune so those eight validate with zero shortfall and zero heat derate.
   */
  readonly stockPowerKw: number;
  readonly stockAlternatorKw: number;
  readonly stockChargeKj: number;
  readonly stockFuelL: number;
  readonly stockCoolingKw: number;
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
  readonly action: WeaponAction;
  readonly effect: WeaponEffect;
  readonly slot: WeaponSlot;
  /** impact multiplier; see the damage formula in ARCHITECTURE.md */
  readonly damageMul: number;
  /** fraction of dealt damage the weapon takes back. 0 for wedges and flame. */
  readonly selfDamageMul: number;
  /** m the weapon reaches past its mount */
  readonly reach: number;

  /*
   * Mechanism, stated rather than guessed. The first pass inferred all of this
   * from substrings of the part id ("spear", "flip", "disc", "side-saws"),
   * which works only for the exact ids that existed when it was written: add a
   * "hydraulic-lance" to the catalog and it silently mounts as the wrong joint
   * and throws its victim the wrong way. These say it outright.
   */
  /** how the moving part is attached; "fixed" weapons have no joint at all */
  readonly mechanism: "revolute" | "prismatic" | "fixed";
  /** spin plane, for spin/grind weapons */
  readonly spinAxis?: "horizontal" | "vertical";
  /** impulse weapons: throw the victim up and over, or drive straight through */
  readonly launch?: "flip" | "punch";
  /** mounted as a mirrored pair on both flanks */
  readonly pairMount?: boolean;

  /** spin / grind */
  readonly maxOmega?: number;
  readonly spinUpTorque?: number;
  readonly inertia?: number;
  /** grind / clamp: hit points per second of sustained contact */
  readonly dps?: number;

  /** impulse: N·s delivered to whatever it catches */
  readonly impulse?: number;
  /** impulse / clamp / triggered: seconds between uses */
  readonly cooldown?: number;
  /*
   * triggered: electrical energy one activation draws from the pack. Omitted
   * means impulse/IMPULSE_KJ_DIVISOR, so existing parts need no edit. A weapon
   * whose cost exceeds the pack cannot fire, and WeaponSnap.c already carries a
   * 0..1 readiness meter — it now means "cooled down AND charged", which is
   * what the player wanted it to mean anyway.
   */
  readonly chargeKj?: number;
  /** impulse: radians the arm sweeps, or metres a spear extends */
  readonly sweep?: number;
  /** impulse: how long the stroke takes */
  readonly strokeSec?: number;

  /** clamp: seconds it can hold a victim before releasing */
  readonly holdSec?: number;

  /** flame: cone half-angle in radians and its length in metres */
  readonly coneAngle?: number;
  readonly coneRange?: number;
  /** held weapons: seconds of use before the tank is dry (0 = unlimited) */
  readonly fuel?: number;
  /** seconds to refill one second of fuel while not firing */
  readonly refuelRate?: number;
}

export interface ArmorDef extends PartDefBase {
  readonly category: "armor";
  /** multiplier applied to spinner damage specifically, e.g. 0.6 for UHMW */
  readonly spinnerResist?: number;
  /** multiplier applied to flame damage, e.g. 0.4 for a heat shield */
  readonly flameResist?: number;
}

export interface UtilityDef extends PartDefBase {
  readonly category: "utility";
  /** grants the self-right action */
  readonly selfRight?: boolean;
  /** multiplies drive torque, e.g. 1.15 */
  readonly powerMul?: number;
  /** multiplies weapon spin-up torque */
  readonly weaponPowerMul?: number;

  /*
   * Plant. Only meaningful when isInternalPart(part) — an engine bolted to the
   * deck is rejected by validateBuild, so these are never read off a surface
   * part. Unlike the multipliers above, which stack with `*=`, these sum into a
   * pool with `+=`: energy is extensive, two engines really is twice the power.
   */
  /** engine: mechanical output at the shaft */
  readonly powerKw?: number;
  /** engine: how much of its output it can divert to recharging the pack */
  readonly alternatorKw?: number;
  /** engine: waste-heat multiplier. A race engine makes more power AND cooks */
  readonly heatMul?: number;
  /** battery: stored electrical energy */
  readonly chargeKj?: number;
  /** tank: litres, drawn on to refill held weapons' own lines */
  readonly fuelL?: number;
  /** radiator: heat it can shed */
  readonly coolingKw?: number;
}

export type PartDef = ChassisDef | DriveDef | WeaponDef | ArmorDef | UtilityDef;

export interface Catalog {
  readonly parts: readonly PartDef[];
  readonly presets: readonly BotSpec[];
  /** O(1) lookup built once at load */
  readonly byId: ReadonlyMap<string, PartDef>;
}

/**
 * A part bolted to one face of the hull at a cell, rotated in quarter turns.
 * Cell coordinates are read in that face's own grid:
 *   deck / underside -> (x, z) over deck[0] x deck[1]
 *   left / right     -> (z, y) over deck[1] x heightCells
 *   front / rear     -> (x, y) over deck[0] x heightCells
 */
export interface PlacedPart {
  readonly partId: string;
  readonly face: MountFace;
  /** top-left cell of the footprint in the face's grid */
  readonly cell: readonly [number, number];
  readonly rot: Rot4;
}

/** Everything a player designs. Serialisable, shareable, untrusted over the wire. */
export interface BotSpec {
  readonly v: 3;
  readonly name: string;
  readonly chassisId: string;
  /** livery colour, 0xRRGGBB */
  readonly paint: number;
  readonly parts: readonly PlacedPart[];
}

/** Room rules the host picks before the match. */
export interface RoomSettings {
  /** build budget in points; the whole reason two rooms play differently */
  readonly pointBudget: number;
  readonly arenaId: string;
  readonly matchSec: number;
}

/**
 * Room budgets. The top tier exists so the absurd hardware has somewhere to
 * live: a 900-point disc or a 700-point slab of armour is unaffordable in a
 * normal match, which is exactly what makes a MAYHEM room worth opening.
 */
export const POINT_BUDGET_PRESETS = [600, 1000, 1500, 2200, 3200] as const;
export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  pointBudget: 1000,
  arenaId: "the-box",
  matchSec: 180
};

/** Derived numbers shown in the builder and used by validation. */
export interface BuildStats {
  readonly cost: number;
  readonly pointBudget: number;
  readonly mass: number;
  readonly hp: number;
  readonly armor: number;
  /** m/s on a flat floor */
  readonly topSpeed: number;
  readonly torque: number;
  /** indicative damage per hit at full weapon speed */
  readonly hitPower: number;
  /** sustained damage per second from grind/flame/clamp weapons */
  readonly sustainedDps: number;
  readonly driveCount: number;
  readonly primaryId: string | null;
  readonly secondaryId: string | null;
  readonly tertiaryId: string | null;
  readonly hasSelfRight: boolean;
  readonly invertible: boolean;

  /*
   * The plant. Supply is chassis stock plus everything in the bay; demand is
   * what the fitted drives and weapons ask for. The builder shows both sides so
   * the player can see which one is short.
   */
  readonly powerKw: number;
  readonly powerDemandKw: number;
  readonly chargeKj: number;
  readonly chargeDemandKj: number;
  readonly fuelL: number;
  /** seconds of held-weapon fire the tank is worth */
  readonly fuelBurnSec: number;
  readonly coolingKw: number;
  /** waste heat at sustained full output */
  readonly heatKw: number;
  /** seconds the slowest fitted rotor needs to reach speed on this plant */
  readonly spinUpSec: number;
  readonly internalCells: number;
  readonly internalCellsMax: number;
}

export interface BuildValidation {
  readonly ok: boolean;
  /** Japanese, shown verbatim in the builder */
  readonly errors: readonly string[];
  /*
   * Japanese, shown but NOT blocking. A machine that will overheat is a choice,
   * not an illegal build — and world.ts throws on !ok, so anything that lands
   * in `errors` locks the player out of the room entirely.
   */
  readonly warnings: readonly string[];
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
  /** primary weapon button (Space) */
  readonly primary: boolean;
  /** secondary weapon button (Shift) */
  readonly secondary: boolean;
  /** tertiary weapon button (F) */
  readonly tertiary: boolean;
  /** self-right requested this frame */
  readonly selfRight: boolean;
}

export const NEUTRAL_INPUT: MatchInput = {
  throttle: 0,
  steer: 0,
  primary: false,
  secondary: false,
  tertiary: false,
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

/** Live state of one weapon, for the HUD and the renderer. */
export interface WeaponState {
  readonly partIdx: number;
  readonly slot: WeaponSlot;
  readonly active: boolean;
  /** rad/s for spin/grind, 0 otherwise */
  readonly omega: number;
  readonly angle: number;
  /** 0..1 ready meter for triggered weapons */
  readonly charge: number;
  /** 0..1 remaining fuel for held weapons; 1 when the weapon needs none */
  readonly fuel: number;
  /** seat currently held in a clamp, if any */
  readonly clamping: SeatIndex | null;
}

/**
 * Live plant meters, all 0..1 so the HUD needs no unit conversion and the wire
 * can carry them as bytes.
 */
export interface PlantState {
  /** of heat capacity; above HEAT_DERATE_START the engine is derating */
  readonly heat: number;
  /** of battery capacity */
  readonly charge: number;
  /** of tank capacity */
  readonly fuel: number;
  /** of engine output currently drawn */
  readonly load: number;
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
  readonly weapons: readonly WeaponState[];
  /** indices into BotSpec.parts that have fallen off */
  readonly detached: readonly number[];
  /** 0..1 condition per BotSpec.parts index, so damage shows before it falls off */
  readonly partCondition: readonly number[];
  /** seconds the bot has been under the immobility threshold */
  readonly immobileFor: number;
  readonly damageDealt: number;
  readonly damageTaken: number;
  /** true while the chassis is upside down */
  readonly inverted: boolean;
  /** seconds of burning damage still to come */
  readonly burningFor: number;
  readonly selfRightCooldown: number;
  readonly plant: PlantState;
}

/** Fire-and-forget signals for VFX and audio; not authoritative state. */
export type SimEvent =
  | { readonly t: "hit"; readonly seat: SeatIndex; readonly by: SeatIndex; readonly x: number; readonly y: number; readonly z: number; readonly power: number; readonly effect: WeaponEffect }
  | { readonly t: "detach"; readonly seat: SeatIndex; readonly partIdx: number; readonly x: number; readonly y: number; readonly z: number }
  | { readonly t: "fire"; readonly seat: SeatIndex; readonly slot: WeaponSlot; readonly effect: WeaponEffect }
  | { readonly t: "flame"; readonly seat: SeatIndex; readonly x: number; readonly y: number; readonly z: number; readonly dirX: number; readonly dirZ: number }
  | { readonly t: "clamp"; readonly seat: SeatIndex; readonly victim: SeatIndex }
  | { readonly t: "ko"; readonly seat: SeatIndex; readonly reason: KoReason }
  | { readonly t: "flip"; readonly seat: SeatIndex }
  | { readonly t: "hazard"; readonly seat: SeatIndex; readonly x: number; readonly y: number; readonly z: number };

export type KoReason = "damage" | "immobile" | "pit" | "fire";

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
  /** square hole; `r` is the half-side */
  readonly pit: { readonly x: number; readonly z: number; readonly r: number } | null;
  readonly saws: readonly { readonly x: number; readonly z: number; readonly r: number }[];
  /** floor flame jets that fire on a cycle */
  readonly flameJets: readonly { readonly x: number; readonly z: number }[];
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
  readonly settings: RoomSettings;
}
