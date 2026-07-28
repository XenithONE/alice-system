import type {
  PartGrade,
  PartId,
  PartKind,
  RogueBuildSpec,
  TopBuildSpec,
  TopLineage,
  TopPartDef,
  TopRole,
  TopSlot
} from "../types";
import type {
  ResolvedActiveSkill,
  ResolvedPassiveSkill,
  ResolvedTopBuild
} from "../sim/types";

export type EndlessSeed = number | string;
export type EndlessPlayerCount = 2 | 3 | 4;
export type EndlessRunPhase = "battle" | "reward";

export type RogueBuildValidationCode =
  | "invalid-version"
  | "invalid-name"
  | "invalid-paint"
  | "missing-slot"
  | "empty-slot"
  | "invalid-part-id"
  | "unknown-part"
  | "wrong-slot";

export interface RogueBuildValidationIssue {
  readonly code: RogueBuildValidationCode;
  readonly message: string;
  readonly slot?: TopSlot;
  readonly partId?: PartId;
  readonly stackIndex?: number;
}

export interface RogueBuildValidationResult {
  readonly ok: boolean;
  readonly errors: readonly RogueBuildValidationIssue[];
  readonly totalParts: number;
  readonly totalCost: number;
}

/**
 * One installed part and its deterministic diminishing-return contribution.
 * `stackIndex` is local to a slot and starts at zero.
 */
export interface RogueStackEntry {
  readonly slot: TopSlot;
  readonly stackIndex: number;
  readonly part: TopPartDef;
  readonly contributionScale: number;
}

export type RogueActiveGroups = Partial<
  Record<TopSlot, readonly ResolvedActiveSkill[]>
>;

/**
 * Simulation-ready endless build. It is a strict superset of the normal
 * resolved contract, so callers which do not know about endless mode can
 * still consume its seven representative colliders.
 */
export interface ResolvedRogueBuild extends ResolvedTopBuild<RogueBuildSpec> {
  /** First part from each slot, used by the procedural visual factory. */
  readonly visualBuild: TopBuildSpec;
  /** All acquired parts, including duplicate IDs, in stable slot order. */
  readonly stackEntries: readonly RogueStackEntry[];
  /** Pressing a slot fires every ready member of that group in one tick. */
  readonly activeGroups: RogueActiveGroups;
  /** Triggered passives retain duplicate occurrences as separate entries. */
  readonly passives: readonly ResolvedPassiveSkill[];
}

export interface RogueRewardChoice {
  readonly partId: PartId;
  readonly slot: TopSlot;
  readonly grade: PartGrade;
  readonly kind: PartKind;
  readonly lineage: TopLineage;
  readonly role: TopRole;
}

export type RogueRewardChoices = readonly [
  RogueRewardChoice,
  RogueRewardChoice,
  RogueRewardChoice
];

export interface RogueRewardOffer {
  readonly v: 1;
  readonly id: string;
  readonly wave: number;
  readonly playerId: string;
  readonly choices: RogueRewardChoices;
  readonly selectedPartId: PartId | null;
}

export interface EndlessPlayerState {
  readonly id: string;
  readonly name: string;
  readonly build: RogueBuildSpec;
}

export interface EndlessPlayerInit {
  readonly id: string;
  readonly name: string;
  readonly build: TopBuildSpec | RogueBuildSpec;
}

export interface EndlessRunState {
  readonly v: 1;
  /** Canonical unsigned 32-bit seed. */
  readonly seed: number;
  /** Current battle wave; starts at one. */
  readonly wave: number;
  readonly clearedWaves: number;
  readonly phase: EndlessRunPhase;
  readonly players: readonly EndlessPlayerState[];
  readonly rewardOffers: readonly RogueRewardOffer[];
}

export type EndlessBossAffix =
  | "mirror-armour"
  | "overclock-storm"
  | "gravity-prank"
  | "rubber-chicken"
  | "tax-audit"
  | "reverse-day"
  | "ghost-bearing"
  | "snack-break"
  | "final-form-again";

export interface EndlessEnemySpec {
  readonly v: 1;
  readonly wave: number;
  readonly variant: number;
  readonly lineage: TopLineage;
  readonly role: TopRole;
  readonly isBoss: boolean;
  readonly bossCycle: number;
  readonly bossAffix: EndlessBossAffix | null;
  /** `normal` is used until the first extra same-slot stack appears. */
  readonly sourceKind: "normal" | "rogue";
  readonly sourceBuild: TopBuildSpec | RogueBuildSpec;
  /** Always available to the renderer, regardless of source kind. */
  readonly visualBuild: TopBuildSpec;
  readonly resolved: ResolvedTopBuild<TopBuildSpec | RogueBuildSpec>;
  /** Strictly increasing, unbounded wave progression scalars. */
  readonly powerMultiplier: number;
  readonly abilityMultiplier: number;
  readonly threatScore: number;
}

