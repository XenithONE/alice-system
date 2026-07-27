import {
  TOP_LINEAGES,
  TOP_PHYSICS_KEYS,
  TOP_ROLES,
  TOP_SLOTS,
  TOP_STAT_KEYS,
  type BuildCostLimit,
  type BuildValidationIssue,
  type BuildValidationResult,
  type DerivedTopBuild,
  type PartId,
  type ResolvedSynergy,
  type SynergyModifierDef,
  type TopBuildSpec,
  type TopLineage,
  type TopPartDef,
  type TopPhysicsStats,
  type TopRole,
  type TopSlot,
  type TopStats
} from "../types";
import { CATALOG_BY_ID, getPart, getPartsForSlot } from "./catalog";
import { SYNERGIES } from "./synergies";

export const COST_LIMITS = [700, 1000, 1300, Number.POSITIVE_INFINITY] as const;
export const DEFAULT_COST_LIMIT: BuildCostLimit = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function safeBudget(value: BuildCostLimit): number {
  return value === Number.POSITIVE_INFINITY
    ? Number.POSITIVE_INFINITY
    : finite(value) && value > 0
      ? value
      : DEFAULT_COST_LIMIT;
}

export function validateBuild(
  build: unknown,
  budget: BuildCostLimit = DEFAULT_COST_LIMIT
): BuildValidationResult {
  const errors: BuildValidationIssue[] = [];
  const warnings: string[] = [];
  let totalCost = 0;
  if (!isRecord(build)) {
    return {
      ok: false,
      errors: [{ code: "invalid-version", message: "ビルドデータがオブジェクトではありません。" }],
      warnings,
      totalCost
    };
  }
  if (build.v !== 1) {
    errors.push({ code: "invalid-version", message: "対応していないビルド形式です。" });
  }
  if (
    typeof build.name !== "string" ||
    build.name.trim().length < 1 ||
    build.name.length > 64 ||
    /[\u0000-\u001f\u007f]/u.test(build.name)
  ) {
    errors.push({ code: "invalid-name", message: "機体名は1〜64文字の表示可能な文字で指定してください。" });
  }
  if (
    !Number.isSafeInteger(build.paint) ||
    (build.paint as number) < 0 ||
    (build.paint as number) > 0xffffff
  ) {
    errors.push({ code: "invalid-paint", message: "ペイント色が24bit RGBの範囲外です。" });
  }

  const seen = new Set<string>();
  const rawParts = isRecord(build.parts) ? build.parts : null;
  for (const slot of TOP_SLOTS) {
    const candidate = rawParts?.[slot];
    if (typeof candidate !== "string" || candidate.length < 1) {
      errors.push({ code: "missing-slot", message: `${slot}パーツがありません。`, slot });
      continue;
    }
    const part = CATALOG_BY_ID.get(candidate);
    if (part === undefined) {
      errors.push({
        code: "unknown-part",
        message: `未知のパーツ「${candidate}」です。`,
        slot,
        partId: candidate
      });
      continue;
    }
    totalCost += part.cost;
    if (part.slot !== slot) {
      errors.push({
        code: "wrong-slot",
        message: `${part.nameJa}は${slot}部位へ装着できません。`,
        slot,
        partId: candidate
      });
    }
    if (seen.has(candidate)) {
      errors.push({
        code: "duplicate-part",
        message: `同じパーツ「${part.nameJa}」を複数部位へ使用できません。`,
        slot,
        partId: candidate
      });
    }
    seen.add(candidate);
  }

  const limit = safeBudget(budget);
  if (totalCost > limit) {
    errors.push({
      code: "over-budget",
      message: `コスト${totalCost}は上限${limit}を${totalCost - limit}超過しています。`
    });
  }
  if (
    rawParts !== null &&
    !TOP_SLOTS.some((slot) => {
      const id = rawParts[slot];
      return typeof id === "string" && CATALOG_BY_ID.get(id)?.activeSkillId !== undefined;
    })
  ) {
    warnings.push("Activeスキルを持つパーツがなく、戦闘中の手動操作はありません。");
  }
  return { ok: errors.length === 0, errors, warnings, totalCost };
}

export function createDefaultBuild(name = "VORTEX-01"): TopBuildSpec {
  const parts = Object.fromEntries(
    TOP_SLOTS.map((slot, slotIndex) => {
      const lineage = TOP_LINEAGES[(slotIndex * 2) % TOP_LINEAGES.length]!;
      const role = TOP_ROLES[slotIndex % TOP_ROLES.length]!;
      const chosen =
        getPartsForSlot(slot).find(
          (part) => part.lineage === lineage && part.role === role && part.grade === 1
        ) ?? getPartsForSlot(slot)[0]!;
      return [slot, chosen.id];
    })
  ) as Record<TopSlot, PartId>;
  const build: TopBuildSpec = {
    v: 1,
    name: name.trim().slice(0, 64) || "VORTEX-01",
    paint: 0x48d9ff,
    parts
  };
  if (!validateBuild(build, 700).ok) {
    throw new Error("内蔵デフォルトビルドが700コスト以内に収まりません。");
  }
  return build;
}

function partsOf(build: TopBuildSpec): Record<TopSlot, TopPartDef> {
  return Object.fromEntries(
    TOP_SLOTS.map((slot) => {
      const part = getPart(build.parts[slot]);
      if (part === undefined || part.slot !== slot) {
        throw new TypeError(`${slot}のパーツ参照が不正です。`);
      }
      return [slot, part];
    })
  ) as Record<TopSlot, TopPartDef>;
}

export function resolveSynergies(build: TopBuildSpec): readonly ResolvedSynergy[] {
  const verdict = validateBuild(build, Number.POSITIVE_INFINITY);
  if (!verdict.ok) {
    throw new TypeError(verdict.errors.map((issue) => issue.message).join(" / "));
  }
  const parts = partsOf(build);
  const lineageCounts = Object.fromEntries(TOP_LINEAGES.map((lineage) => [lineage, 0])) as Record<
    TopLineage,
    number
  >;
  const roleCounts = Object.fromEntries(TOP_ROLES.map((role) => [role, 0])) as Record<
    TopRole,
    number
  >;
  for (const part of Object.values(parts)) {
    lineageCounts[part.lineage] += 1;
    roleCounts[part.role] += 1;
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
    if (synergy !== undefined) resolved.push({ synergy, sourceCount: count });
  }
  for (const synergy of SYNERGIES) {
    if (synergy.kind !== "role-pair" || synergy.roles === undefined) continue;
    const [a, b] = synergy.roles;
    if (roleCounts[a] > 0 && roleCounts[b] > 0) {
      resolved.push({ synergy, sourceCount: roleCounts[a] + roleCounts[b] });
    }
  }
  return resolved;
}

function applyModifier(
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

export function deriveBuildStats(build: TopBuildSpec): DerivedTopBuild {
  const verdict = validateBuild(build, Number.POSITIVE_INFINITY);
  if (!verdict.ok) {
    throw new TypeError(verdict.errors.map((issue) => issue.message).join(" / "));
  }
  const parts = partsOf(build);
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
  for (const part of Object.values(parts)) {
    for (const key of TOP_STAT_KEYS) stats[key] += part.stats[key];
    mass += part.physics.mass;
    inertia += part.physics.inertia;
    weightedCenter += part.physics.centerOfMass * part.physics.mass;
    weightedFriction += part.physics.friction * part.physics.mass;
    weightedRestitution += part.physics.restitution * part.physics.mass;
    weightedDrag += part.physics.drag * part.physics.mass;
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
  const synergies = resolveSynergies(build);
  for (const resolved of synergies) {
    for (const modifier of resolved.synergy.modifiers) applyModifier(stats, physics, modifier);
  }
  for (const key of TOP_STAT_KEYS) stats[key] = Math.round(stats[key] * 100) / 100;
  for (const key of TOP_PHYSICS_KEYS) {
    physics[key] = Math.round(physics[key] * 100_000) / 100_000;
  }

  const activeSlots: DerivedTopBuild["activeSlots"] = {};
  const passiveSkills: { slot: TopSlot; skillId: string; rank: 1 | 2 | 3 }[] = [];
  for (const slot of TOP_SLOTS) {
    const part = parts[slot];
    if (part.activeSkillId !== undefined && part.skillRank !== undefined) {
      activeSlots[slot] = { skillId: part.activeSkillId, rank: part.skillRank };
    }
    if (part.passiveSkillId !== undefined && part.skillRank !== undefined) {
      passiveSkills.push({ slot, skillId: part.passiveSkillId, rank: part.skillRank });
    }
  }
  return {
    spec: build,
    parts,
    totalCost: verdict.totalCost,
    stats,
    physics,
    synergies,
    activeSlots,
    passiveSkills
  };
}

/** Alias used by the headless simulator. */
export const deriveBuild = deriveBuildStats;

export function minimumPartCost(slot: TopSlot): number {
  return Math.min(...getPartsForSlot(slot).map((part) => part.cost));
}

export function remainingMinimumCost(slots: readonly TopSlot[]): number {
  return slots.reduce((total, slot) => total + minimumPartCost(slot), 0);
}

export function isOfficialCostLimit(value: number): value is 700 | 1000 | 1300 {
  return value === 700 || value === 1000 || value === 1300;
}

export function buildHasFiniteDerivedValues(build: TopBuildSpec): boolean {
  const derived = deriveBuildStats(build);
  return (
    TOP_STAT_KEYS.every((key) => Number.isFinite(derived.stats[key])) &&
    TOP_PHYSICS_KEYS.every((key) => Number.isFinite(derived.physics[key]))
  );
}
