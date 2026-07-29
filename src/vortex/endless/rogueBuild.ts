import { validateBuild } from "../content/build";
import { CATALOG_BY_ID } from "../content/catalog";
import { getPassiveSkill } from "../content/skills";
import { SYNERGIES } from "../content/synergies";
import { resolvedBuildFromDerived } from "../sim/catalogAdapter";
import {
  NEUTRAL_MODIFIERS,
  type ResolvedActiveSkill,
  type ResolvedPassiveEffect,
  type ResolvedPassiveSkill,
  type RuntimeModifiers,
  type SkillEffect
} from "../sim/types";
import {
  TOP_LINEAGES,
  TOP_PHYSICS_KEYS,
  TOP_ROLES,
  TOP_SLOTS,
  TOP_STAT_KEYS,
  type DerivedTopBuild,
  type PartId,
  type ResolvedSynergy,
  type RogueBuildSpec,
  type SkillEffectDef,
  type SkillRank,
  type SynergyModifierDef,
  type TopBuildSpec,
  type TopLineage,
  type TopPartDef,
  type TopPhysicsStats,
  type TopRole,
  type TopSlot,
  type TopStats
} from "../types";
import type {
  ResolvedRogueBuild,
  RogueBuildValidationIssue,
  RogueBuildValidationResult,
  RogueStackEntry
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function rankScale(rank: SkillRank): number {
  return 1 + (rank - 1) * 0.12;
}

/**
 * Every acquired part remains useful forever, but the nth part in one slot
 * contributes less than the previous one. The harmonic-root curve is
 * unbounded in aggregate, unlike an exponential cap, which preserves endless
 * progression while avoiding linear stat explosions.
 */
export function rogueContributionScale(stackIndex: number): number {
  if (!Number.isSafeInteger(stackIndex) || stackIndex < 0) {
    throw new RangeError("stackIndex must be a non-negative safe integer.");
  }
  return 1 / Math.sqrt(stackIndex + 1);
}

export function validateRogueBuild(build: unknown): RogueBuildValidationResult {
  const errors: RogueBuildValidationIssue[] = [];
  let totalParts = 0;
  let totalCost = 0;
  if (!isRecord(build)) {
    return {
      ok: false,
      errors: [{
        code: "invalid-version",
        message: "ローグビルドがオブジェクトではありません。"
      }],
      totalParts,
      totalCost
    };
  }
  if (build.v !== 1) {
    errors.push({
      code: "invalid-version",
      message: "対応していないローグビルド形式です。"
    });
  }
  if (
    typeof build.name !== "string" ||
    build.name.trim().length < 1 ||
    build.name.length > 64 ||
    /[\u0000-\u001f\u007f]/u.test(build.name)
  ) {
    errors.push({
      code: "invalid-name",
      message: "機体名は1〜64文字の表示可能な文字で指定してください。"
    });
  }
  if (
    !Number.isSafeInteger(build.paint) ||
    (build.paint as number) < 0 ||
    (build.paint as number) > 0xffffff
  ) {
    errors.push({
      code: "invalid-paint",
      message: "ペイント色が24bit RGBの範囲外です。"
    });
  }

  const rawParts = isRecord(build.parts) ? build.parts : null;
  for (const slot of TOP_SLOTS) {
    const stack = rawParts?.[slot];
    if (!Array.isArray(stack)) {
      errors.push({
        code: "missing-slot",
        message: `${slot}のパーツ配列がありません。`,
        slot
      });
      continue;
    }
    if (stack.length < 1) {
      errors.push({
        code: "empty-slot",
        message: `${slot}には最低1個のパーツが必要です。`,
        slot
      });
      continue;
    }
    totalParts += stack.length;
    for (let stackIndex = 0; stackIndex < stack.length; stackIndex += 1) {
      const candidate: unknown = stack[stackIndex];
      if (typeof candidate !== "string" || candidate.length < 1) {
        errors.push({
          code: "invalid-part-id",
          message: `${slot}[${stackIndex}]のパーツIDが不正です。`,
          slot,
          stackIndex
        });
        continue;
      }
      const part = CATALOG_BY_ID.get(candidate);
      if (part === undefined) {
        errors.push({
          code: "unknown-part",
          message: `未知のパーツ「${candidate}」です。`,
          slot,
          partId: candidate,
          stackIndex
        });
        continue;
      }
      totalCost += part.cost;
      if (part.slot !== slot) {
        errors.push({
          code: "wrong-slot",
          message: `${part.nameJa}は${slot}へ装着できません。`,
          slot,
          partId: candidate,
          stackIndex
        });
      }
    }
  }
  return { ok: errors.length === 0, errors, totalParts, totalCost };
}

function assertRogueBuild(build: unknown): asserts build is RogueBuildSpec {
  const verdict = validateRogueBuild(build);
  if (!verdict.ok) {
    throw new TypeError(verdict.errors.map((issue) => issue.message).join(" / "));
  }
}

export function rogueBuildFromTopBuild(build: TopBuildSpec): RogueBuildSpec {
  const verdict = validateBuild(build, Number.POSITIVE_INFINITY);
  if (!verdict.ok) {
    throw new TypeError(verdict.errors.map((issue) => issue.message).join(" / "));
  }
  return {
    v: 1,
    name: build.name,
    paint: build.paint,
    parts: Object.fromEntries(
      TOP_SLOTS.map((slot) => [slot, [build.parts[slot]] as const])
    ) as unknown as Record<TopSlot, readonly PartId[]>
  };
}

export function visualBuildFromRogue(build: RogueBuildSpec): TopBuildSpec {
  assertRogueBuild(build);
  return {
    v: 1,
    name: build.name,
    paint: build.paint,
    parts: Object.fromEntries(
      TOP_SLOTS.map((slot) => [slot, build.parts[slot][0]!])
    ) as Record<TopSlot, PartId>
  };
}

export function appendRoguePart(
  build: RogueBuildSpec,
  partId: PartId
): RogueBuildSpec {
  assertRogueBuild(build);
  const part = CATALOG_BY_ID.get(partId);
  if (part === undefined) {
    throw new TypeError(`未知のパーツ「${partId}」です。`);
  }
  return {
    ...build,
    parts: {
      ...build.parts,
      [part.slot]: [...build.parts[part.slot], partId]
    }
  };
}

function stackEntriesOf(build: RogueBuildSpec): readonly RogueStackEntry[] {
  return TOP_SLOTS.flatMap((slot) =>
    build.parts[slot].map((partId, stackIndex) => ({
      slot,
      stackIndex,
      part: CATALOG_BY_ID.get(partId)!,
      contributionScale: rogueContributionScale(stackIndex)
    }))
  );
}

function resolveRogueSynergies(
  entries: readonly RogueStackEntry[]
): readonly ResolvedSynergy[] {
  const lineageCounts = Object.fromEntries(
    TOP_LINEAGES.map((lineage) => [lineage, 0])
  ) as Record<TopLineage, number>;
  const roleCounts = Object.fromEntries(
    TOP_ROLES.map((role) => [role, 0])
  ) as Record<TopRole, number>;
  for (const entry of entries) {
    lineageCounts[entry.part.lineage] += 1;
    roleCounts[entry.part.role] += 1;
  }

  const resolved: ResolvedSynergy[] = [];
  for (const lineage of TOP_LINEAGES) {
    const count = lineageCounts[lineage];
    const threshold = count >= 6 ? 6 : count >= 4 ? 4 : count >= 2 ? 2 : null;
    if (threshold === null) continue;
    const synergy = SYNERGIES.find(
      (candidate) =>
        candidate.kind === "lineage" &&
        candidate.lineage === lineage &&
        candidate.threshold === threshold
    );
    if (synergy !== undefined) {
      resolved.push({ synergy, sourceCount: count });
    }
  }
  for (const synergy of SYNERGIES) {
    if (synergy.kind !== "role-pair" || synergy.roles === undefined) continue;
    const [first, second] = synergy.roles;
    if (roleCounts[first] > 0 && roleCounts[second] > 0) {
      resolved.push({
        synergy,
        sourceCount: roleCounts[first] + roleCounts[second]
      });
    }
  }
  return resolved;
}

function applySynergyModifier(
  stats: TopStats,
  physics: TopPhysicsStats,
  modifier: SynergyModifierDef
): void {
  if (modifier.target === "stats") {
    stats[modifier.stat] =
      modifier.operation === "multiply"
        ? stats[modifier.stat] * modifier.value
        : stats[modifier.stat] + modifier.value;
  } else {
    physics[modifier.stat] =
      modifier.operation === "multiply"
        ? physics[modifier.stat] * modifier.value
        : physics[modifier.stat] + modifier.value;
  }
}

function scaledPassiveEffect(
  effect: SkillEffectDef,
  contributionScale: number
): ResolvedPassiveEffect {
  switch (effect.kind) {
    case "stat-multiplier":
      return {
        type: "stat-multiplier",
        stat: effect.stat,
        multiplier: 1 + (effect.multiplier - 1) * contributionScale,
        ...(effect.durationSec === undefined
          ? {}
          : { durationSec: effect.durationSec })
      };
    case "physics-multiplier":
      return {
        type: "physics-multiplier",
        stat: effect.stat,
        multiplier: 1 + (effect.multiplier - 1) * contributionScale,
        ...(effect.durationSec === undefined
          ? {}
          : { durationSec: effect.durationSec })
      };
    case "impulse":
      return {
        type: "impulse",
        direction: effect.direction,
        strength: effect.strength * contributionScale
      };
    case "spin":
      return { type: "spin", amount: effect.amount * contributionScale };
    case "durability":
      return {
        type: "durability",
        amount: effect.amount * contributionScale
      };
    case "shield":
      return {
        type: "shield",
        amount: effect.amount * contributionScale,
        durationSec: effect.durationSec
      };
    case "radial-damage":
      return {
        type: "radial-damage",
        amount: effect.amount * contributionScale,
        radius: effect.radius
      };
    case "cooldown-shift":
      return {
        type: "cooldown-shift",
        amountSec: effect.amountSec * contributionScale,
        target: effect.target ?? "self",
        radius: effect.radius ?? 0
      };
    case "cleanse":
      return { type: "cleanse" };
    case "phase":
      return {
        type: "phase",
        durationSec: effect.durationSec * Math.max(0.25, contributionScale)
      };
    case "steal-spin":
      return {
        type: "steal-spin",
        amount: effect.amount * contributionScale
      };
    case "reverse-orbit":
      return {
        type: "reverse-orbit",
        durationSec: effect.durationSec * Math.max(0.25, contributionScale)
      };
  }
}

function passivesFromEntries(
  entries: readonly RogueStackEntry[]
): readonly ResolvedPassiveSkill[] {
  return entries.flatMap((entry) => {
    const part = entry.part;
    if (part.passiveSkillId === undefined || part.skillRank === undefined) {
      return [];
    }
    const definition = getPassiveSkill(part.passiveSkillId);
    if (definition === undefined) return [];
    return [{
      id: definition.id,
      name: definition.nameJa,
      rank: part.skillRank,
      trigger: definition.trigger,
      threshold: definition.threshold ?? null,
      effects: definition.effects.map((effect) =>
        scaledPassiveEffect(effect, entry.contributionScale)
      )
    }];
  });
}

function applyNumber(
  record: Record<string, number>,
  key: string,
  multiplier: number
): void {
  if (key in record) record[key] = (record[key] ?? 0) * multiplier;
}

function applyContinuousPassive(
  passive: ResolvedPassiveSkill,
  stats: TopStats,
  physics: TopPhysicsStats,
  modifiers: RuntimeModifiers
): RuntimeModifiers {
  const scale = rankScale(passive.rank);
  let result = { ...modifiers };
  for (const effect of passive.effects) {
    if (effect.type === "stat-multiplier") {
      applyNumber(
        stats as unknown as Record<string, number>,
        effect.stat,
        1 + (effect.multiplier - 1) * scale
      );
    } else if (effect.type === "physics-multiplier") {
      applyNumber(
        physics as unknown as Record<string, number>,
        effect.stat,
        1 + (effect.multiplier - 1) * scale
      );
    } else if (effect.type === "durability") {
      stats.durability += effect.amount * scale;
    } else if (effect.type === "shield" || effect.type === "phase") {
      const strength = effect.type === "shield" ? effect.amount / 650 : 0.12;
      result = {
        ...result,
        damageTaken:
          result.damageTaken * clamp(1 - strength * scale, 0.68, 1)
      };
    } else if (effect.type === "spin") {
      stats.stamina += effect.amount * scale * 0.45;
    } else if (effect.type === "steal-spin") {
      result = {
        ...result,
        lifesteal: clamp(
          result.lifesteal + effect.amount * scale / 400,
          0,
          0.3
        )
      };
    } else if (effect.type === "radial-damage") {
      result = {
        ...result,
        thorns: clamp(
          result.thorns + effect.amount * scale / 500,
          0,
          0.28
        )
      };
    } else if (effect.type === "reverse-orbit") {
      result = {
        ...result,
        tracking: result.tracking * (1 + 0.06 * scale)
      };
    } else if (effect.type === "cooldown-shift") {
      result = {
        ...result,
        tracking:
          result.tracking *
          (1 + Math.max(0, -effect.amountSec) * scale * 0.01)
      };
    }
  }
  return result;
}

function scaleActiveEffect(
  effect: SkillEffect,
  contributionScale: number
): SkillEffect {
  switch (effect.type) {
    case "spin-boost":
      return {
        ...effect,
        radiansPerSec: effect.radiansPerSec * contributionScale
      };
    case "dash":
    case "recoil":
    case "center-pull":
    case "orbit-dash":
      return { ...effect, impulse: effect.impulse * contributionScale };
    case "shield":
      return {
        ...effect,
        damageMultiplier: clamp(
          1 - (1 - effect.damageMultiplier) * contributionScale,
          0.05,
          1
        )
      };
    case "repair":
      return { ...effect, amount: effect.amount * contributionScale };
    case "shockwave":
      return {
        ...effect,
        impulse: effect.impulse * contributionScale,
        damage: effect.damage * contributionScale
      };
    case "attack-boost":
    case "stability-boost":
    case "tracking-boost":
    case "friction-shift":
      return {
        ...effect,
        multiplier: 1 + (effect.multiplier - 1) * contributionScale
      };
    case "target-spin-drain":
      return {
        ...effect,
        radiansPerSec: effect.radiansPerSec * contributionScale
      };
    case "cooldown-shift":
      return { ...effect, seconds: effect.seconds * contributionScale };
    case "reverse-orbit":
      return {
        ...effect,
        durationSec:
          effect.durationSec * Math.max(0.25, contributionScale)
      };
    case "phase":
      return {
        ...effect,
        durationSec:
          effect.durationSec * Math.max(0.25, contributionScale)
      };
    case "cleanse":
      return effect;
  }
}

function scaleActiveSkill(
  skill: ResolvedActiveSkill,
  contributionScale: number
): ResolvedActiveSkill {
  return {
    ...skill,
    effects: skill.effects.map((effect) =>
      scaleActiveEffect(effect, contributionScale)
    )
  };
}

function activeGroupsFromEntries(
  entries: readonly RogueStackEntry[],
  shell: DerivedTopBuild
): ResolvedRogueBuild["activeGroups"] {
  const groups: Partial<Record<TopSlot, ResolvedActiveSkill[]>> = {};
  for (const entry of entries) {
    const part = entry.part;
    if (part.activeSkillId === undefined || part.skillRank === undefined) {
      continue;
    }
    const probe = resolvedBuildFromDerived({
      ...shell,
      activeSlots: {
        [entry.slot]: {
          skillId: part.activeSkillId,
          rank: part.skillRank
        }
      }
    });
    const resolved = probe.parts[TOP_SLOTS.indexOf(entry.slot)]?.activeSkill;
    if (resolved === null || resolved === undefined) continue;
    (groups[entry.slot] ??= []).push(
      scaleActiveSkill(resolved, entry.contributionScale)
    );
  }
  return groups;
}

/**
 * Resolves an endless build without increasing rigid-body topology.
 *
 * Seven first entries become the representative compound colliders. Every
 * additional part affects aggregate values and declarative skills only.
 */
export function resolveRogueBuild(build: RogueBuildSpec): ResolvedRogueBuild {
  assertRogueBuild(build);
  const verdict = validateRogueBuild(build);
  const visualBuild = visualBuildFromRogue(build);
  const entries = stackEntriesOf(build);
  const representatives = Object.fromEntries(
    TOP_SLOTS.map((slot) => [
      slot,
      CATALOG_BY_ID.get(build.parts[slot][0]!)!
    ])
  ) as Record<TopSlot, TopPartDef>;

  const stats: TopStats = {
    attack: 0,
    defense: 0,
    stamina: 0,
    stability: 0,
    mobility: 0,
    durability: 0
  };
  let mass = 0;
  let inertia = 0;
  let weightedCenter = 0;
  let weightedFriction = 0;
  let weightedRestitution = 0;
  let weightedDrag = 0;
  for (const entry of entries) {
    const { part, contributionScale } = entry;
    for (const key of TOP_STAT_KEYS) {
      stats[key] += part.stats[key] * contributionScale;
    }
    const effectiveMass = part.physics.mass * contributionScale;
    mass += effectiveMass;
    inertia += part.physics.inertia * contributionScale;
    weightedCenter += part.physics.centerOfMass * effectiveMass;
    weightedFriction += part.physics.friction * effectiveMass;
    weightedRestitution += part.physics.restitution * effectiveMass;
    weightedDrag += part.physics.drag * effectiveMass;
  }
  const safeMass = Math.max(0.0001, mass);
  const physics: TopPhysicsStats = {
    mass,
    inertia,
    centerOfMass: weightedCenter / safeMass,
    friction: weightedFriction / safeMass,
    restitution: weightedRestitution / safeMass,
    drag: weightedDrag / safeMass
  };
  const synergies = resolveRogueSynergies(entries);
  for (const resolved of synergies) {
    for (const modifier of resolved.synergy.modifiers) {
      applySynergyModifier(stats, physics, modifier);
    }
  }
  for (const key of TOP_STAT_KEYS) stats[key] = round(stats[key], 2);
  for (const key of TOP_PHYSICS_KEYS) physics[key] = round(physics[key], 5);

  const passives = passivesFromEntries(entries);
  let modifiers: RuntimeModifiers = { ...NEUTRAL_MODIFIERS };
  for (const passive of passives) {
    if (passive.trigger !== "continuous") continue;
    modifiers = applyContinuousPassive(passive, stats, physics, modifiers);
  }

  const shell: DerivedTopBuild = {
    spec: visualBuild,
    parts: representatives,
    totalCost: verdict.totalCost,
    stats,
    physics,
    synergies,
    activeSlots: {},
    passiveSkills: []
  };
  const representativeResolved = resolvedBuildFromDerived(shell);
  const activeGroups = activeGroupsFromEntries(entries, shell);
  const resolvedParts = representativeResolved.parts.map((part) => ({
    ...part,
    activeSkill: activeGroups[part.slot]?.[0] ?? null
  }));

  return {
    ...representativeResolved,
    source: build,
    name: build.name,
    cost: verdict.totalCost,
    parts: resolvedParts,
    activeGroups,
    passives,
    modifiers,
    synergyIds: synergies.map((entry) => entry.synergy.id),
    visualBuild,
    stackEntries: entries
  };
}
