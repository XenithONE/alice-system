export const TOP_SLOTS = [
  "crest",
  "crown",
  "edge",
  "weight",
  "core",
  "shaft",
  "tip"
] as const;

export type TopSlot = (typeof TOP_SLOTS)[number];
export type PartId = string;

export const TOP_LINEAGES = [
  "aegis",
  "raptor",
  "tempest",
  "atlas",
  "nova",
  "pulse",
  "revenant",
  "eclipse",
  "helix"
] as const;

export type TopLineage = (typeof TOP_LINEAGES)[number];

export const TOP_ROLES = ["attack", "defense", "stamina", "control"] as const;
export type TopRole = (typeof TOP_ROLES)[number];
export type PartGrade = 1 | 2 | 3 | "signature";
export type PartKind = "stat" | "passive" | "active";
export type SkillRank = 1 | 2 | 3;

export const TOP_STAT_KEYS = [
  "attack",
  "defense",
  "stamina",
  "stability",
  "mobility",
  "durability"
] as const;

export type TopStatKey = (typeof TOP_STAT_KEYS)[number];

export interface TopStats {
  attack: number;
  defense: number;
  stamina: number;
  stability: number;
  mobility: number;
  durability: number;
}

export const TOP_PHYSICS_KEYS = [
  "mass",
  "inertia",
  "centerOfMass",
  "friction",
  "restitution",
  "drag"
] as const;

export type TopPhysicsKey = (typeof TOP_PHYSICS_KEYS)[number];

export interface TopPhysicsStats {
  /** Kilograms. */
  mass: number;
  /** Relative polar moment used by the fixed-step simulator. */
  inertia: number;
  /** Vertical offset from the assembled body's origin, in metres. */
  centerOfMass: number;
  friction: number;
  restitution: number;
  drag: number;
}

export type ActiveConditionDef =
  | { kind: "always" }
  | { kind: "durability-below"; ratio: number }
  | { kind: "spin-below"; ratio: number }
  | { kind: "spin-above"; ratio: number }
  | { kind: "near-rim"; normalizedRadius: number }
  | { kind: "recently-hit"; withinSec: number }
  | { kind: "target-near"; distance: number }
  | { kind: "airborne" }
  | { kind: "last-survivor" };

export type SkillEffectDef =
  | {
      kind: "stat-multiplier";
      stat: TopStatKey;
      multiplier: number;
      durationSec?: number;
    }
  | {
      kind: "physics-multiplier";
      stat: TopPhysicsKey;
      multiplier: number;
      durationSec?: number;
    }
  | {
      kind: "impulse";
      direction: "toward-target" | "away-from-target" | "toward-center" | "tangent";
      strength: number;
    }
  | { kind: "spin"; amount: number }
  | { kind: "durability"; amount: number }
  | { kind: "shield"; amount: number; durationSec: number }
  | { kind: "radial-damage"; amount: number; radius: number }
  /*
   * `target` says who the shift lands on, because the host cannot infer it.
   * Both handlers walked the CASTER's own slots, so pulse-jammer — whose text
   * promises to delay 周囲の相手 — added +4s to all seven of its own, scaled by
   * rank, on a 30s cooldown. The four self-targeted users were correct and stay
   * correct: omitting the field means "self".
   *
   * Not inferred from the sign (+ enemy / − self) even though today's data
   * happens to line up that way. A reader could not tell what an effect does
   * without knowing the convention, and "slow the enemy's cooldown recovery"
   * would become inexpressible.
   */
  | {
      kind: "cooldown-shift";
      amountSec: number;
      target?: "self" | "enemies";
      /** Required when target is "enemies"; ignored otherwise. */
      radius?: number;
    }
  | { kind: "cleanse" }
  | { kind: "phase"; durationSec: number }
  | { kind: "steal-spin"; amount: number }
  | { kind: "reverse-orbit"; durationSec: number };

export interface ActiveSkillDef {
  id: string;
  name: string;
  nameJa: string;
  descriptionJa: string;
  cooldownSec: number;
  /** null means no charge limit. */
  charges: number | null;
  condition: ActiveConditionDef;
  effects: readonly SkillEffectDef[];
}

export type PassiveTrigger =
  | "continuous"
  | "battle-start"
  | "on-hit"
  | "on-take-hit"
  | "near-rim"
  | "durability-below"
  | "spin-below"
  | "elimination";

export interface PassiveSkillDef {
  id: string;
  name: string;
  nameJa: string;
  descriptionJa: string;
  trigger: PassiveTrigger;
  /** Optional normalized threshold for threshold-based triggers. */
  threshold?: number;
  effects: readonly SkillEffectDef[];
}

export interface TopPartVisualDef {
  /** One of 63 lineage/slot factories or 21 signature factories. */
  visualKey: string;
  /** Unique, stable cache key for this exact procedural variation. */
  parameterSignature: string;
  material:
    | "titanium"
    | "tungsten"
    | "carbon"
    | "ceramic"
    | "alloy"
    | "polymer";
  primaryColor: number;
  accentColor: number;
  bladeCount: number;
  thickness: number;
  aperture: number;
  engraving: string;
}

export interface TopPartColliderDef {
  shape: "cylinder" | "cone" | "compound";
  radius: number;
  height: number;
  offsetY: number;
  lobes: number;
}

export interface TopPartDef {
  id: PartId;
  slot: TopSlot;
  /** Canonical family field. `family` is an interoperability alias. */
  lineage: TopLineage;
  family: TopLineage;
  role: TopRole;
  grade: PartGrade;
  kind: PartKind;
  name: string;
  nameJa: string;
  descriptionJa: string;
  cost: number;
  stats: TopStats;
  physics: TopPhysicsStats;
  activeSkillId?: string;
  passiveSkillId?: string;
  skillRank?: SkillRank;
  visual: TopPartVisualDef;
  collider: TopPartColliderDef;
  keywords: readonly string[];
}

export interface TopBuildSpec {
  v: 1;
  name: string;
  paint: number;
  parts: Record<TopSlot, PartId>;
}

/**
 * Endless co-op build format.
 *
 * This deliberately stays separate from `TopBuildSpec`: the first entry in
 * each slot is the visual/collider representative while later entries are
 * roguelike stacks. Repeated part IDs are legal, including within one slot.
 */
export interface RogueBuildSpec {
  v: 1;
  name: string;
  paint: number;
  parts: Record<TopSlot, readonly PartId[]>;
}

export type BuildCostLimit = 700 | 1000 | 1300 | number;

export interface BuildModifierDef {
  target: "stats";
  stat: TopStatKey;
  operation: "add" | "multiply";
  value: number;
}

export interface PhysicsModifierDef {
  target: "physics";
  stat: TopPhysicsKey;
  operation: "add" | "multiply";
  value: number;
}

export type SynergyModifierDef = BuildModifierDef | PhysicsModifierDef;

export interface SynergyDef {
  id: string;
  name: string;
  nameJa: string;
  descriptionJa: string;
  kind: "lineage" | "role-pair";
  lineage?: TopLineage;
  threshold?: 2 | 4 | 6;
  roles?: readonly [TopRole, TopRole];
  modifiers: readonly SynergyModifierDef[];
}

export interface ResolvedSynergy {
  synergy: SynergyDef;
  sourceCount: number;
}

export interface DerivedTopBuild {
  spec: TopBuildSpec;
  parts: Record<TopSlot, TopPartDef>;
  totalCost: number;
  stats: TopStats;
  physics: TopPhysicsStats;
  synergies: readonly ResolvedSynergy[];
  activeSlots: Partial<Record<TopSlot, { skillId: string; rank: SkillRank }>>;
  passiveSkills: readonly { slot: TopSlot; skillId: string; rank: SkillRank }[];
}

export type BuildValidationCode =
  | "invalid-version"
  | "invalid-name"
  | "invalid-paint"
  | "missing-slot"
  | "unknown-part"
  | "wrong-slot"
  | "duplicate-part"
  | "over-budget";

export interface BuildValidationIssue {
  code: BuildValidationCode;
  message: string;
  slot?: TopSlot;
  partId?: string;
}

export interface BuildValidationResult {
  ok: boolean;
  errors: readonly BuildValidationIssue[];
  warnings: readonly string[];
  totalCost: number;
}

export interface RingProfilePoint {
  /** Normalized radius, 0 at centre and 1 at the outer wall. */
  r: number;
  /** Floor height in metres. */
  y: number;
}

export interface RingArenaDef {
  id: string;
  name: string;
  nameJa: string;
  radius: number;
  wallHeight: number;
  outOfBoundsRadius: number;
  profile: readonly RingProfilePoint[];
  radialWave?: { amplitude: number; frequency: number; phase: number };
  descriptionJa: string;
}

export type VortexGameMode = "custom" | "draft" | "endless";
export type VortexPlayerCount = 2 | 3 | 4;

export interface VortexRoomSettings {
  costLimit: BuildCostLimit;
  arenaId: string;
  mode: VortexGameMode;
  playerCount: VortexPlayerCount;
  cpuCount: number;
  seed: number;
  draftTurnSec: 12;
}

export interface PartSearchFilters {
  query?: string;
  lineages?: readonly TopLineage[];
  roles?: readonly TopRole[];
  grades?: readonly PartGrade[];
  kinds?: readonly PartKind[];
  maxCost?: number;
  hasSkill?: boolean;
}

export interface DraftPlayer {
  id: string;
  name: string;
  isCpu: boolean;
}

export interface DraftState {
  v: 1;
  seed: number;
  players: readonly DraftPlayer[];
  /** Seed-shuffled seat indices. Each odd slot round reverses this order. */
  baseOrder: readonly number[];
  slotIndex: number;
  pickIndex: number;
  picks: readonly Partial<Record<TopSlot, PartId>>[];
  claimedPartIds: readonly PartId[];
  costLimit: BuildCostLimit;
  turnDurationMs: 12_000;
  deadlineMs: number;
  completed: boolean;
}

export interface DraftCreateOptions {
  players: readonly DraftPlayer[] | VortexPlayerCount;
  costLimit?: BuildCostLimit;
  seed?: number | string;
  nowMs?: number;
}
