/**
 * VORTEX CROWN simulation contracts.
 *
 * These types deliberately contain no Three.js, React, DOM, or renderer
 * objects.  A catalog/build layer resolves its richer data into
 * `ResolvedTopBuild`; from that point the simulation can run in Node.
 */

export const VORTEX_SEATS = 8;
export const TOP_SLOTS = [
  "crest",
  "crown",
  "edge",
  "weight",
  "core",
  "shaft",
  "tip",
] as const;

export type SimTopSlot = (typeof TOP_SLOTS)[number];
export type SkillSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type SeatIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type MatchPhase = "countdown" | "live" | "over";
export type KnockoutReason = "ring-out" | "destroyed";

export interface DisplayStats {
  readonly attack: number;
  readonly defense: number;
  readonly stamina: number;
  readonly stability: number;
  readonly mobility: number;
  readonly durability: number;
}

export interface PhysicalStats {
  /** kilograms */
  readonly mass: number;
  /** relative rotational inertia, normally 0.5..2 */
  readonly inertia: number;
  /** local vertical centre-of-mass offset in metres */
  readonly centerOfMass: number;
  readonly friction: number;
  readonly restitution: number;
  readonly drag: number;
  /** initial angular speed in radians per second */
  readonly launchSpin: number;
}

export type SkillCondition =
  | { readonly type: "always" }
  | { readonly type: "hp-below"; readonly ratio: number }
  | { readonly type: "hp-above"; readonly ratio: number }
  | { readonly type: "spin-below"; readonly radiansPerSec: number }
  | { readonly type: "spin-above"; readonly radiansPerSec: number }
  | { readonly type: "near-edge"; readonly distance: number }
  | { readonly type: "near-center"; readonly radius: number }
  | { readonly type: "target-within"; readonly distance: number }
  | { readonly type: "recently-hit"; readonly withinSec: number }
  | { readonly type: "elapsed"; readonly seconds: number }
  | { readonly type: "airborne"; readonly heightAboveSurface: number }
  | { readonly type: "final-duel" }
  | { readonly type: "outnumbered" }
  | {
      readonly type: "all";
      readonly conditions: readonly SkillCondition[];
    }
  | {
      readonly type: "any";
      readonly conditions: readonly SkillCondition[];
    };

/**
 * Enumerated instructions are the only executable active-skill vocabulary.
 * Catalog entries never contain callbacks or source text.
 */
export type SkillEffect =
  | { readonly type: "spin-boost"; readonly radiansPerSec: number }
  | { readonly type: "dash"; readonly impulse: number }
  | {
      readonly type: "shield";
      readonly durationSec: number;
      readonly damageMultiplier: number;
    }
  | { readonly type: "repair"; readonly amount: number }
  | {
      readonly type: "shockwave";
      readonly radius: number;
      readonly impulse: number;
      readonly damage: number;
    }
  | {
      readonly type: "attack-boost";
      readonly durationSec: number;
      readonly multiplier: number;
    }
  | {
      readonly type: "stability-boost";
      readonly durationSec: number;
      readonly multiplier: number;
    }
  | {
      readonly type: "tracking-boost";
      readonly durationSec: number;
      readonly multiplier: number;
    }
  | {
      readonly type: "friction-shift";
      readonly durationSec: number;
      readonly multiplier: number;
    }
  | {
      readonly type: "target-spin-drain";
      readonly radius: number;
      readonly radiansPerSec: number;
    }
  | {
      readonly type: "recoil";
      readonly impulse: number;
    }
  | { readonly type: "center-pull"; readonly impulse: number }
  | { readonly type: "orbit-dash"; readonly impulse: number }
  | { readonly type: "cooldown-shift"; readonly seconds: number }
  | { readonly type: "cleanse" }
  | { readonly type: "reverse-orbit"; readonly durationSec: number };

export interface ResolvedActiveSkill {
  readonly id: string;
  readonly name: string;
  readonly cooldownSec: number;
  /** -1 is unlimited; otherwise a non-negative whole number */
  readonly charges: number;
  readonly conditions: readonly SkillCondition[];
  readonly effects: readonly SkillEffect[];
}

export type ResolvedPassiveTrigger =
  | "continuous"
  | "battle-start"
  | "on-hit"
  | "on-take-hit"
  | "near-rim"
  | "durability-below"
  | "spin-below"
  | "elimination";

export type PassiveStatKey = keyof DisplayStats;
export type PassivePhysicsKey = Exclude<keyof PhysicalStats, "launchSpin">;

/**
 * Declarative passive instructions. Values remain catalog-authored here;
 * rank scaling and trigger timing are applied by the deterministic world.
 */
export type ResolvedPassiveEffect =
  | {
      readonly type: "stat-multiplier";
      readonly stat: PassiveStatKey;
      readonly multiplier: number;
      readonly durationSec?: number;
    }
  | {
      readonly type: "physics-multiplier";
      readonly stat: PassivePhysicsKey;
      readonly multiplier: number;
      readonly durationSec?: number;
    }
  | {
      readonly type: "impulse";
      readonly direction:
        | "toward-target"
        | "away-from-target"
        | "toward-center"
        | "tangent";
      readonly strength: number;
    }
  | { readonly type: "spin"; readonly amount: number }
  | { readonly type: "durability"; readonly amount: number }
  | {
      readonly type: "shield";
      readonly amount: number;
      readonly durationSec: number;
    }
  | {
      readonly type: "radial-damage";
      readonly amount: number;
      readonly radius: number;
    }
  | { readonly type: "cooldown-shift"; readonly amountSec: number }
  | { readonly type: "cleanse" }
  | { readonly type: "phase"; readonly durationSec: number }
  | { readonly type: "steal-spin"; readonly amount: number }
  | { readonly type: "reverse-orbit"; readonly durationSec: number };

export interface ResolvedPassiveSkill {
  readonly id: string;
  readonly name: string;
  readonly rank: 1 | 2 | 3;
  readonly trigger: ResolvedPassiveTrigger;
  readonly threshold: number | null;
  readonly effects: readonly ResolvedPassiveEffect[];
}

export interface ResolvedTopPart {
  readonly id: string;
  readonly slot: SimTopSlot;
  readonly shape?: "cylinder" | "cone" | "compound";
  /** collider radius in metres */
  readonly radius: number;
  /** collider height in metres */
  readonly height: number;
  /** local body-space centre; omitted fixtures are stacked automatically */
  readonly offsetY?: number;
  /** radial facets/blades used by compound collision proxies */
  readonly lobes?: number;
  readonly mass: number;
  readonly friction: number;
  readonly restitution: number;
  readonly activeSkill: ResolvedActiveSkill | null;
}

export interface RuntimeModifiers {
  readonly damageDealt: number;
  readonly damageTaken: number;
  readonly spinDrain: number;
  readonly tracking: number;
  readonly stability: number;
  readonly edgeRecovery: number;
  readonly thorns: number;
  readonly lifesteal: number;
}

export const NEUTRAL_MODIFIERS: RuntimeModifiers = {
  damageDealt: 1,
  damageTaken: 1,
  spinDrain: 1,
  tracking: 1,
  stability: 1,
  edgeRecovery: 0,
  thorns: 0,
  lifesteal: 0,
};

/**
 * Fully validated, catalog-resolved build consumed by physics.
 * `source` is the serialisable build spec used by networking and persistence.
 */
export interface ResolvedTopBuild<TSource = unknown> {
  readonly source: TSource;
  readonly name: string;
  readonly cost: number;
  readonly stats: DisplayStats;
  readonly physics: PhysicalStats;
  /** exactly seven entries in TOP_SLOTS order */
  readonly parts: readonly ResolvedTopPart[];
  /**
   * Optional roguelike stacks. When present, every currently-ready member of
   * the selected slot fires together; the seven representative parts still
   * define the unchanged rigid-body/collider topology.
   */
  readonly activeGroups?: Partial<
    Record<SimTopSlot, readonly ResolvedActiveSkill[]>
  >;
  /** zero to seven declarative part passives */
  readonly passives: readonly ResolvedPassiveSkill[];
  readonly modifiers: RuntimeModifiers;
  readonly synergyIds: readonly string[];
}

export interface SimRingPoint {
  /** radius from the arena centre */
  readonly radius: number;
  /** surface height at that radius */
  readonly height: number;
}

export interface SimRingArena {
  readonly id:
    | "core-bowl"
    | "wide-dish"
    | "pressure-crater"
    | "wave-ring"
    | "eclipse-ring";
  readonly name: string;
  readonly nameJa: string;
  readonly profile: readonly SimRingPoint[];
  readonly outRadius: number;
  readonly spawnRadius: number;
  readonly friction: number;
  readonly restitution: number;
  readonly waveAmplitude?: number;
  readonly waveCount?: number;
}

export interface RingSurfaceMesh {
  readonly vertices: Float32Array;
  readonly indices: Uint32Array;
  readonly radialSegments: number;
  readonly angularSegments: number;
}

export interface SkillRuntimeState {
  readonly slot: SkillSlot;
  readonly skillId: string | null;
  readonly name: string | null;
  readonly cooldownRemaining: number;
  /** -1 is unlimited */
  readonly chargesRemaining: number;
  readonly ready: boolean;
  readonly blockedReason: SkillRejectReason | null;
  /** Present for stacked roguelike slots; ordinary builds report 1/1. */
  readonly groupSize?: number;
  readonly readyCount?: number;
}

export interface TopState {
  readonly seat: SeatIndex;
  readonly name: string;
  readonly alive: boolean;
  readonly hp: number;
  readonly hpMax: number;
  readonly spin: number;
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number, number];
  readonly velocity: readonly [number, number, number];
  readonly skills: readonly SkillRuntimeState[];
  readonly lastHitAt: number;
  readonly cpu: boolean;
}

export type SimEvent =
  | {
      readonly type: "impact";
      readonly attacker: SeatIndex;
      readonly victim: SeatIndex;
      readonly damage: number;
      readonly impulse: number;
      readonly point: readonly [number, number, number];
    }
  | {
      readonly type: "skill";
      readonly seat: SeatIndex;
      readonly slot: SkillSlot;
      readonly skillId: string;
    }
  | {
      readonly type: "shockwave";
      readonly seat: SeatIndex;
      readonly radius: number;
    }
  | {
      readonly type: "knockout";
      readonly seat: SeatIndex;
      readonly reason: KnockoutReason;
      readonly by: SeatIndex | null;
    }
  | { readonly type: "sudden-death"; readonly stage: number };

export interface MatchState {
  readonly tick: number;
  readonly elapsed: number;
  readonly phase: MatchPhase;
  readonly suddenDeathStage: number;
  readonly arenaId: SimRingArena["id"];
  readonly tops: readonly TopState[];
}

export interface MatchResult {
  readonly winner: SeatIndex | null;
  /** Team id when `teamIds` were supplied; seat id in the default FFA. */
  readonly winnerTeam?: number | null;
  readonly reason: KnockoutReason | "draw";
  readonly durationSec: number;
  readonly knockouts: readonly {
    readonly seat: SeatIndex;
    readonly reason: KnockoutReason;
    readonly at: number;
  }[];
}

export type SkillRejectReason =
  | "match-not-live"
  | "invalid-seat"
  | "knocked-out"
  | "empty-slot"
  | "cooldown"
  | "no-charges"
  | "condition";

export type SkillActivationResult =
  | {
      readonly ok: true;
      readonly seat: SeatIndex;
      readonly slot: SkillSlot;
      readonly skillId: string;
    }
  | {
      readonly ok: false;
      readonly seat: number;
      readonly slot: number;
      readonly reason: SkillRejectReason;
    };

export interface VortexSimDiagnostics {
  readonly rigidBodies: number;
  readonly colliders: number;
  readonly topRigidBodies: number;
  readonly topColliders: readonly number[];
  readonly passiveTriggers: readonly {
    readonly seat: SeatIndex;
    readonly passiveId: string;
    readonly trigger: ResolvedPassiveTrigger;
    readonly count: number;
  }[];
  readonly stepCount: number;
}

export interface VortexSim {
  readonly tick: number;
  readonly elapsed: number;
  readonly phase: MatchPhase;
  readonly arena: SimRingArena;
  step(): void;
  activate(seat: SeatIndex, slot: SkillSlot): SkillActivationResult;
  canActivate(seat: SeatIndex, slot: SkillSlot): SkillActivationResult;
  setCpu(seat: SeatIndex, cpu: boolean): void;
  isCpu(seat: SeatIndex): boolean;
  getState(): MatchState;
  drainEvents(): readonly SimEvent[];
  result(): MatchResult | null;
  diagnostics(): VortexSimDiagnostics;
  dispose(): void;
}

export interface CreateVortexSimOptions<TSource = unknown> {
  readonly seed: number;
  /** 2..8 non-null builds, indexed by seat */
  readonly builds: readonly (ResolvedTopBuild<TSource> | null)[];
  readonly names?: readonly string[];
  /**
   * Per-seat launch-meter multiplier. Values are safely clamped to 0..1.25;
   * omitted/non-finite entries preserve the historical 1.0 launch exactly.
   */
  readonly launchPower?: readonly number[];
  /**
   * Per-seat team identifiers. Omitted/non-finite entries use their seat id,
   * preserving the historical free-for-all.
   */
  readonly teamIds?: readonly number[];
  readonly arenaId?: SimRingArena["id"];
  readonly arena?: SimRingArena;
  readonly cpuSeats?: readonly SeatIndex[];
  readonly countdownSec?: number;
  readonly suddenDeathSec?: number;
  /**
   * Safety ceiling. The production default is 240 seconds; sudden-death
   * amplification makes ordinary matches end well before it.
   */
  readonly maxDurationSec?: number;
}
