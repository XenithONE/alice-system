import { deriveBuildStats, validateBuild } from "../content/build";
import { getActiveSkill, getPassiveSkill } from "../content/skills";
import {
  TOP_SLOTS,
  type ActiveConditionDef,
  type ActiveSkillDef,
  type BuildCostLimit,
  type DerivedTopBuild,
  type SkillEffectDef,
  type SkillRank,
  type TopBuildSpec,
  type TopPhysicsStats,
  type TopStats,
} from "../types";
import {
  NEUTRAL_MODIFIERS,
  type ResolvedActiveSkill,
  type ResolvedPassiveEffect,
  type ResolvedPassiveSkill,
  type ResolvedTopBuild,
  type RuntimeModifiers,
  type SkillCondition,
  type SkillEffect,
} from "./types";

const COLLIDER_RADIUS: Record<(typeof TOP_SLOTS)[number], number> = {
  crest: 0.2,
  crown: 0.38,
  edge: 0.535,
  weight: 0.415,
  core: 0.275,
  shaft: 0.16,
  tip: 0.11,
};

const COLLIDER_HEIGHT: Record<(typeof TOP_SLOTS)[number], number> = {
  crest: 0.11,
  crown: 0.12,
  edge: 0.15,
  weight: 0.2,
  core: 0.24,
  shaft: 0.2,
  tip: 0.34,
};

/** topFactory SLOT_Y multiplied by the battle-scene 0.56 scale */
const COLLIDER_Y: Record<(typeof TOP_SLOTS)[number], number> = {
  crest: 0.4032,
  crown: 0.2912,
  edge: 0.1736,
  weight: 0.0448,
  core: -0.0728,
  shaft: -0.2128,
  tip: -0.3752,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function rankScale(rank: SkillRank): number {
  return 1 + (rank - 1) * 0.12;
}

function conditionFromCatalog(
  condition: ActiveConditionDef,
  launchSpin: number,
): SkillCondition {
  switch (condition.kind) {
    case "always":
      return { type: "always" };
    case "durability-below":
      return { type: "hp-below", ratio: condition.ratio };
    case "spin-below":
      return {
        type: "spin-below",
        radiansPerSec: launchSpin * condition.ratio,
      };
    case "spin-above":
      return {
        type: "spin-above",
        radiansPerSec: launchSpin * condition.ratio,
      };
    case "near-rim":
      return {
        type: "near-edge",
        // Ring radii span 6.1..8.8 m; this remains conservative on all five.
        distance: (1 - condition.normalizedRadius) * 7.2,
      };
    case "recently-hit":
      return { type: "recently-hit", withinSec: condition.withinSec };
    case "target-near":
      return { type: "target-within", distance: condition.distance };
    case "airborne":
      return { type: "airborne", heightAboveSurface: 0.32 };
    case "last-survivor":
      return { type: "final-duel" };
  }
}

function effectsFromCatalog(
  effect: SkillEffectDef,
  rank: SkillRank,
): readonly SkillEffect[] {
  const scale = rankScale(rank);
  switch (effect.kind) {
    case "stat-multiplier": {
      const durationSec = effect.durationSec ?? 3;
      if (effect.stat === "attack") {
        return [{
          type: "attack-boost",
          durationSec,
          multiplier: 1 + (effect.multiplier - 1) * scale,
        }];
      }
      if (effect.stat === "defense" || effect.stat === "durability") {
        return [{
          type: "shield",
          durationSec,
          damageMultiplier: 1 / Math.max(0.2, 1 + (effect.multiplier - 1) * scale),
        }];
      }
      if (effect.stat === "stability") {
        return [{
          type: "stability-boost",
          durationSec,
          multiplier: 1 + (effect.multiplier - 1) * scale,
        }];
      }
      if (effect.stat === "mobility") {
        return [{
          type: "tracking-boost",
          durationSec,
          multiplier: 1 + (effect.multiplier - 1) * scale,
        }];
      }
      return [{
        type: "friction-shift",
        durationSec,
        multiplier: 1 / Math.max(0.2, 1 + (effect.multiplier - 1) * scale),
      }];
    }
    case "physics-multiplier": {
      const durationSec = effect.durationSec ?? 3;
      if (
        effect.stat === "mass" ||
        effect.stat === "inertia" ||
        effect.stat === "centerOfMass"
      ) {
        const raw =
          effect.stat === "centerOfMass"
            ? 1 / Math.max(0.2, effect.multiplier)
            : effect.multiplier;
        return [{
          type: "stability-boost",
          durationSec,
          multiplier: 1 + (raw - 1) * scale,
        }];
      }
      if (effect.stat === "friction") {
        return [{
          type: "friction-shift",
          durationSec,
          multiplier: 1 + (effect.multiplier - 1) * scale,
        }];
      }
      if (effect.stat === "restitution") {
        return [{
          type: "attack-boost",
          durationSec,
          multiplier: 1 + (effect.multiplier - 1) * scale,
        }];
      }
      return [{
        type: "tracking-boost",
        durationSec,
        multiplier: 1 / Math.max(0.2, 1 + (effect.multiplier - 1) * scale),
      }];
    }
    case "impulse":
      if (effect.direction === "toward-target") {
        return [{ type: "dash", impulse: effect.strength * scale }];
      }
      if (effect.direction === "away-from-target") {
        return [{ type: "recoil", impulse: effect.strength * scale }];
      }
      if (effect.direction === "toward-center") {
        return [{ type: "center-pull", impulse: effect.strength * scale }];
      }
      return [{ type: "orbit-dash", impulse: effect.strength * scale }];
    case "spin":
      return [{ type: "spin-boost", radiansPerSec: effect.amount * scale }];
    case "durability":
      return [{ type: "repair", amount: effect.amount * scale }];
    case "shield":
      return [{
        type: "shield",
        durationSec: effect.durationSec,
        damageMultiplier: clamp(1 - effect.amount * scale / 300, 0.2, 0.92),
      }];
    case "radial-damage":
      return [{
        type: "shockwave",
        radius: effect.radius,
        impulse: effect.amount * 0.055 * scale,
        damage: effect.amount * scale,
      }];
    case "cooldown-shift":
      return [{ type: "cooldown-shift", seconds: effect.amountSec * scale }];
    case "cleanse":
      return [{ type: "cleanse" }];
    case "phase":
      return [{
        type: "shield",
        durationSec: effect.durationSec,
        damageMultiplier: 0.12,
      }];
    case "steal-spin":
      return [
        {
          type: "target-spin-drain",
          radius: 2.2,
          radiansPerSec: effect.amount * scale,
        },
        { type: "spin-boost", radiansPerSec: effect.amount * scale * 0.65 },
      ];
    case "reverse-orbit":
      return [{ type: "reverse-orbit", durationSec: effect.durationSec }];
  }
}

function activeFromCatalog(
  skill: ActiveSkillDef,
  rank: SkillRank,
  launchSpin: number,
): ResolvedActiveSkill {
  return {
    id: skill.id,
    name: skill.nameJa,
    cooldownSec: skill.cooldownSec * (1 - (rank - 1) * 0.06),
    charges: skill.charges === null ? -1 : skill.charges,
    conditions: [conditionFromCatalog(skill.condition, launchSpin)],
    effects: skill.effects.flatMap((effect) => effectsFromCatalog(effect, rank)),
  };
}

function passiveEffectFromCatalog(
  effect: SkillEffectDef,
): ResolvedPassiveEffect {
  switch (effect.kind) {
    case "stat-multiplier":
      return {
        type: "stat-multiplier",
        stat: effect.stat,
        multiplier: effect.multiplier,
        ...(effect.durationSec === undefined
          ? {}
          : { durationSec: effect.durationSec }),
      };
    case "physics-multiplier":
      return {
        type: "physics-multiplier",
        stat: effect.stat,
        multiplier: effect.multiplier,
        ...(effect.durationSec === undefined
          ? {}
          : { durationSec: effect.durationSec }),
      };
    case "impulse":
      return {
        type: "impulse",
        direction: effect.direction,
        strength: effect.strength,
      };
    case "spin":
      return { type: "spin", amount: effect.amount };
    case "durability":
      return { type: "durability", amount: effect.amount };
    case "shield":
      return {
        type: "shield",
        amount: effect.amount,
        durationSec: effect.durationSec,
      };
    case "radial-damage":
      return {
        type: "radial-damage",
        amount: effect.amount,
        radius: effect.radius,
      };
    case "cooldown-shift":
      return { type: "cooldown-shift", amountSec: effect.amountSec };
    case "cleanse":
      return { type: "cleanse" };
    case "phase":
      return { type: "phase", durationSec: effect.durationSec };
    case "steal-spin":
      return { type: "steal-spin", amount: effect.amount };
    case "reverse-orbit":
      return { type: "reverse-orbit", durationSec: effect.durationSec };
  }
}

function applyNumber(
  record: Record<string, number>,
  key: string,
  multiplier: number,
): void {
  if (key in record) record[key] = (record[key] ?? 0) * multiplier;
}

/**
 * Continuous passives are part of the resolved baseline. Every other trigger
 * is carried into the world verbatim and must not receive an uptime estimate.
 */
function applyContinuousPassive(
  passive: ResolvedPassiveSkill,
  stats: TopStats,
  physics: TopPhysicsStats,
  modifiers: RuntimeModifiers,
): RuntimeModifiers {
  const scale = rankScale(passive.rank);
  let result = { ...modifiers };
  for (const effect of passive.effects) {
    if (effect.type === "stat-multiplier") {
      applyNumber(
        stats as unknown as Record<string, number>,
        effect.stat,
        1 + (effect.multiplier - 1) * scale,
      );
    } else if (effect.type === "physics-multiplier") {
      applyNumber(
        physics as unknown as Record<string, number>,
        effect.stat,
        1 + (effect.multiplier - 1) * scale,
      );
    } else if (effect.type === "durability") {
      stats.durability += effect.amount * scale;
    } else if (effect.type === "shield" || effect.type === "phase") {
      const strength = effect.type === "shield" ? effect.amount / 650 : 0.12;
      result = {
        ...result,
        damageTaken: result.damageTaken * clamp(1 - strength * scale, 0.68, 1),
      };
    } else if (effect.type === "spin") {
      stats.stamina += effect.amount * scale * 0.45;
    } else if (effect.type === "steal-spin") {
      result = {
        ...result,
        lifesteal: clamp(result.lifesteal + effect.amount * scale / 400, 0, 0.3),
      };
    } else if (effect.type === "radial-damage") {
      result = {
        ...result,
        thorns: clamp(result.thorns + effect.amount * scale / 500, 0, 0.28),
      };
    } else if (effect.type === "reverse-orbit") {
      result = {
        ...result,
        tracking: result.tracking * (1 + 0.06 * scale),
      };
    } else if (effect.type === "cooldown-shift") {
      result = {
        ...result,
        tracking: result.tracking * (1 + Math.max(0, -effect.amountSec) * scale * 0.01),
      };
    }
  }
  return result;
}

export function resolvedBuildFromDerived(
  derived: DerivedTopBuild,
): ResolvedTopBuild<TopBuildSpec> {
  const stats = { ...derived.stats };
  const physics = { ...derived.physics };
  const passives: ResolvedPassiveSkill[] = derived.passiveSkills.flatMap(
    (passive) => {
      const definition = getPassiveSkill(passive.skillId);
      if (!definition) return [];
      return [{
        id: definition.id,
        name: definition.nameJa,
        rank: passive.rank,
        trigger: definition.trigger,
        threshold: definition.threshold ?? null,
        effects: definition.effects.map(passiveEffectFromCatalog),
      }];
    },
  );
  let modifiers: RuntimeModifiers = { ...NEUTRAL_MODIFIERS };
  for (const passive of passives) {
    if (passive.trigger !== "continuous") continue;
    modifiers = applyContinuousPassive(
      passive,
      stats,
      physics,
      modifiers,
    );
  }
  const launchSpin = clamp(
    70 + stats.stamina * 0.105 + physics.inertia * 14,
    64,
    145,
  );
  return {
    source: derived.spec,
    name: derived.spec.name,
    cost: derived.totalCost,
    stats,
    physics: {
      ...physics,
      launchSpin,
    },
    parts: TOP_SLOTS.map((slot) => {
      const part = derived.parts[slot];
      const activeRef = derived.activeSlots[slot];
      const active =
        activeRef === undefined ? undefined : getActiveSkill(activeRef.skillId);
      const gradeScale =
        part.grade === 1
          ? 0.96
          : part.grade === 2
            ? 1
            : part.grade === 3
              ? 1.04
              : 1.08;
      return {
        id: part.id,
        slot,
        shape: part.collider.shape,
        radius: COLLIDER_RADIUS[slot] * gradeScale,
        height: COLLIDER_HEIGHT[slot] * (0.97 + (gradeScale - 0.96) * 0.5),
        offsetY: COLLIDER_Y[slot],
        lobes: part.collider.lobes,
        mass: part.physics.mass,
        friction: part.physics.friction,
        restitution: part.physics.restitution,
        activeSkill:
          active && activeRef
            ? activeFromCatalog(active, activeRef.rank, launchSpin)
            : null,
      };
    }),
    passives,
    modifiers,
    synergyIds: derived.synergies.map((entry) => entry.synergy.id),
  };
}

export function resolveCatalogBuild(
  spec: TopBuildSpec,
  costLimit: BuildCostLimit = Number.POSITIVE_INFINITY,
): ResolvedTopBuild<TopBuildSpec> {
  const verdict = validateBuild(spec, costLimit);
  if (!verdict.ok) {
    throw new TypeError(verdict.errors.map((issue) => issue.message).join(" / "));
  }
  return resolvedBuildFromDerived(deriveBuildStats(spec));
}
