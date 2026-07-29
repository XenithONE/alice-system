import { getPartsForSlot } from "../content/catalog";
import { resolveCatalogBuild } from "../sim/catalogAdapter";
import { mulberry32 } from "../sim/rng";
import type {
  ResolvedActiveSkill,
  ResolvedTopBuild,
  SkillEffect
} from "../sim/types";
import {
  TOP_LINEAGES,
  TOP_ROLES,
  TOP_SLOTS,
  TOP_STAT_KEYS,
  type PartGrade,
  type RogueBuildSpec,
  type TopBuildSpec,
  type TopLineage,
  type TopRole,
  type TopSlot,
  type TopStatKey,
  type TopStats
} from "../types";
import {
  resolveRogueBuild,
  rogueBuildFromTopBuild
} from "./rogueBuild";
import { canonicalEndlessSeed, mixEndlessSeed } from "./seed";
import type {
  EndlessBossAffix,
  EndlessEnemySpec,
  EndlessSeed
} from "./types";

const BOSS_AFFIXES = [
  "mirror-armour",
  "overclock-storm",
  "gravity-prank",
  "rubber-chicken",
  "tax-audit",
  "reverse-day",
  "ghost-bearing",
  "snack-break",
  "final-form-again"
] as const satisfies readonly EndlessBossAffix[];

const ENEMY_BASE_STATS: TopStats = {
  attack: 176,
  defense: 170,
  stamina: 174,
  stability: 164,
  mobility: 158,
  durability: 236
};

const ROLE_FOCUS: Record<TopRole, readonly TopStatKey[]> = {
  attack: ["attack", "mobility"],
  defense: ["defense", "durability"],
  stamina: ["stamina", "stability"],
  control: ["stability", "mobility"]
};

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function assertWave(wave: number): void {
  if (!Number.isSafeInteger(wave) || wave < 1) {
    throw new RangeError("wave must be a positive safe integer.");
  }
}

function enemyIdentity(
  seed: number,
  wave: number
): {
  readonly lineage: TopLineage;
  readonly role: TopRole;
  readonly isBoss: boolean;
  readonly bossCycle: number;
  readonly bossAffix: EndlessBossAffix | null;
} {
  const lineageOffset = seed % TOP_LINEAGES.length;
  const roleOffset = (seed >>> 9) % TOP_ROLES.length;
  const isBoss = wave % 5 === 0;
  const bossCycle = Math.floor((wave - 1) / 5);
  const lineage = TOP_LINEAGES[
    (lineageOffset + wave - 1 + (isBoss ? bossCycle : 0)) %
      TOP_LINEAGES.length
  ]!;
  const role = TOP_ROLES[
    (roleOffset + Math.floor((wave - 1) / 2)) % TOP_ROLES.length
  ]!;
  const bossAffix = isBoss
    ? BOSS_AFFIXES[(bossCycle + (seed >>> 17)) % BOSS_AFFIXES.length]!
    : null;
  return { lineage, role, isBoss, bossCycle, bossAffix };
}

function enemyGrade(wave: number, isBoss: boolean): PartGrade {
  if (isBoss) return "signature";
  if (wave >= 21) return 3;
  if (wave >= 8) return 2;
  return 1;
}

function visualEnemyBuild(
  seed: number,
  wave: number,
  variant: number,
  lineage: TopLineage,
  role: TopRole,
  isBoss: boolean
): TopBuildSpec {
  const grade = enemyGrade(wave, isBoss);
  const rng = mulberry32(mixEndlessSeed(seed, "enemy-visual", wave, variant));
  const parts = Object.fromEntries(
    TOP_SLOTS.map((slot) => {
      const slotParts = getPartsForSlot(slot);
      const preferred = slotParts.filter((part) =>
        grade === "signature"
          ? part.grade === "signature"
          : part.lineage === lineage &&
            part.role === role &&
            part.grade === grade
      );
      const fallback = slotParts.filter((part) => part.grade === grade);
      const pool = preferred.length > 0
        ? preferred
        : fallback.length > 0
          ? fallback
          : slotParts;
      return [slot, pool[rng.int(pool.length)]!.id];
    })
  ) as TopBuildSpec["parts"];
  return {
    v: 1,
    name: isBoss
      ? `BOSS ${wave} // ${lineage.toUpperCase()}`
      : `WAVE ${wave} // ${lineage.toUpperCase()}`,
    paint: (0x421122 + Math.imul(wave + variant, 0x010b17)) & 0xffffff,
    parts
  };
}

function stackedEnemyBuild(
  seed: number,
  wave: number,
  variant: number,
  visualBuild: TopBuildSpec,
  lineage: TopLineage,
  role: TopRole
): RogueBuildSpec {
  const base = rogueBuildFromTopBuild(visualBuild);
  const parts = Object.fromEntries(
    TOP_SLOTS.map((slot) => [slot, [...base.parts[slot]]])
  ) as Record<TopSlot, string[]>;
  const extraCount = endlessEnemyExtraStackCount(wave);
  const rng = mulberry32(mixEndlessSeed(seed, "enemy-stack", wave, variant));
  for (let index = 0; index < extraCount; index += 1) {
    const slot = TOP_SLOTS[
      (index + variant + (seed % TOP_SLOTS.length)) % TOP_SLOTS.length
    ]!;
    const pool = getPartsForSlot(slot);
    const desiredKind = index % 2 === 0 ? "active" : "passive";
    const preferred = pool.filter(
      (part) =>
        part.lineage === lineage &&
        part.role === role &&
        part.kind === desiredKind
    );
    const skillPool = pool.filter((part) => part.kind === desiredKind);
    const candidates = preferred.length > 0
      ? preferred
      : skillPool.length > 0
        ? skillPool
        : pool;
    parts[slot].push(candidates[rng.int(candidates.length)]!.id);
  }
  return { ...base, parts };
}

/**
 * Enemies begin stacking on wave four. Square-root growth remains unbounded,
 * but keeps build resolution and simultaneous Active groups practical during
 * very long browser sessions.
 */
export function endlessEnemyExtraStackCount(wave: number): number {
  assertWave(wave);
  return wave < 4 ? 0 : Math.max(1, Math.floor(Math.sqrt(wave - 3)));
}

function monotonicEnemyStats(
  wave: number,
  lineage: TopLineage,
  role: TopRole
): TopStats {
  const progress = wave - 1;
  const retainedBossSteps = Math.floor(wave / 5);
  const ascent =
    progress * 12 +
    0.46 * progress ** 1.36 +
    retainedBossSteps * 8;
  const lineageIndex = TOP_LINEAGES.indexOf(lineage);
  const roleIndex = TOP_ROLES.indexOf(role);
  return Object.fromEntries(
    TOP_STAT_KEYS.map((key, keyIndex) => {
      // Bounded identity flavour; the 12-point minimum wave ascent is larger
      // than the maximum possible one-wave flavour drop (9 points).
      const lineageFlavour =
        ((lineageIndex * 3 + keyIndex * 2) % 5) - 2;
      const roleFlavour = ROLE_FOCUS[role].includes(key) ? 5 : -1;
      const parityFlavour = ((roleIndex + keyIndex) % 3) - 1;
      const durabilityScale = key === "durability" ? 1.24 : 1;
      return [
        key,
        round(
          (ENEMY_BASE_STATS[key] +
            ascent +
            lineageFlavour +
            roleFlavour +
            parityFlavour) *
            durabilityScale,
          3
        )
      ];
    })
  ) as unknown as TopStats;
}

function scaleEnemyEffect(effect: SkillEffect, scale: number): SkillEffect {
  switch (effect.type) {
    case "spin-boost":
      return { ...effect, radiansPerSec: effect.radiansPerSec * scale };
    case "dash":
    case "recoil":
    case "center-pull":
    case "orbit-dash":
      return { ...effect, impulse: effect.impulse * scale };
    case "shield":
      return {
        ...effect,
        damageMultiplier: Math.max(
          0.06,
          1 - (1 - effect.damageMultiplier) * Math.sqrt(scale)
        )
      };
    case "repair":
      return { ...effect, amount: effect.amount * scale };
    case "shockwave":
      return {
        ...effect,
        impulse: effect.impulse * scale,
        damage: effect.damage * scale
      };
    case "attack-boost":
    case "stability-boost":
    case "tracking-boost":
    case "friction-shift":
      return {
        ...effect,
        multiplier: 1 + (effect.multiplier - 1) * scale
      };
    case "target-spin-drain":
      return { ...effect, radiansPerSec: effect.radiansPerSec * scale };
    case "cooldown-shift":
      return { ...effect, seconds: effect.seconds * scale };
    case "reverse-orbit":
      return {
        ...effect,
        durationSec: effect.durationSec * Math.sqrt(scale)
      };
    case "phase":
      return {
        ...effect,
        durationSec: effect.durationSec * Math.sqrt(scale)
      };
    case "cleanse":
      return effect;
  }
}

function scaleEnemySkill(
  skill: ResolvedActiveSkill,
  abilityMultiplier: number,
  wave: number
): ResolvedActiveSkill {
  return {
    ...skill,
    cooldownSec: Math.max(
      2.5,
      skill.cooldownSec / Math.sqrt(abilityMultiplier)
    ),
    charges:
      skill.charges < 0
        ? -1
        : skill.charges + Math.floor((wave - 1) / 20),
    effects: skill.effects.map((effect) =>
      scaleEnemyEffect(effect, abilityMultiplier)
    )
  };
}

function groupsFromResolved(
  resolved: ResolvedTopBuild<TopBuildSpec | RogueBuildSpec>
): Partial<Record<TopSlot, readonly ResolvedActiveSkill[]>> {
  if (resolved.activeGroups !== undefined) {
    return resolved.activeGroups;
  }
  const groups: Partial<Record<TopSlot, readonly ResolvedActiveSkill[]>> = {};
  for (const part of resolved.parts) {
    if (part.activeSkill !== null) {
      groups[part.slot] = [part.activeSkill];
    }
  }
  return groups;
}

/**
 * Deterministic enemy definition for any positive safe-integer wave.
 * Progression scalars grow without a fixed level cap; all wave-100 values stay
 * comfortably finite for browser physics.
 */
export function generateEndlessEnemy(
  seed: EndlessSeed,
  wave: number,
  variant = 0
): EndlessEnemySpec {
  assertWave(wave);
  if (!Number.isSafeInteger(variant) || variant < 0) {
    throw new RangeError("variant must be a non-negative safe integer.");
  }
  const canonicalSeed = canonicalEndlessSeed(seed);
  const identity = enemyIdentity(canonicalSeed, wave);
  const visualBuild = visualEnemyBuild(
    canonicalSeed,
    wave,
    variant,
    identity.lineage,
    identity.role,
    identity.isBoss
  );
  const rogueBuild = stackedEnemyBuild(
    canonicalSeed,
    wave,
    variant,
    visualBuild,
    identity.lineage,
    identity.role
  );
  const rogue = Object.values(rogueBuild.parts).some(
    (stack) => stack.length > 1
  );
  const sourceKind = rogue ? "rogue" : "normal";
  const sourceBuild = rogue ? rogueBuild : visualBuild;
  const baseResolved: ResolvedTopBuild<TopBuildSpec | RogueBuildSpec> = rogue
    ? resolveRogueBuild(rogueBuild)
    : resolveCatalogBuild(visualBuild);

  const progress = wave - 1;
  const retainedBossSteps = Math.floor(wave / 5);
  const powerMultiplier = round(
    1 +
      progress * 0.085 +
      0.004 * progress ** 1.35 +
      retainedBossSteps * 0.08,
    6
  );
  const abilityMultiplier = round(
    1 +
      progress * 0.055 +
      0.003 * progress ** 1.3 +
      retainedBossSteps * 0.05,
    6
  );
  const groups = groupsFromResolved(baseResolved);
  const scaledGroups = Object.fromEntries(
    Object.entries(groups).map(([slot, skills]) => [
      slot,
      (skills ?? []).map((skill) =>
        scaleEnemySkill(skill, abilityMultiplier, wave)
      )
    ])
  ) as Partial<Record<TopSlot, readonly ResolvedActiveSkill[]>>;
  const resolved: ResolvedTopBuild<TopBuildSpec | RogueBuildSpec> = {
    ...baseResolved,
    source: sourceBuild,
    stats: monotonicEnemyStats(wave, identity.lineage, identity.role),
    physics: {
      ...baseResolved.physics,
      launchSpin: Math.min(
        240,
        88 + progress * 0.92 + retainedBossSteps * 3
      )
    },
    parts: baseResolved.parts.map((part) => ({
      ...part,
      activeSkill: scaledGroups[part.slot]?.[0] ?? null
    })),
    activeGroups: scaledGroups,
    modifiers: {
      ...baseResolved.modifiers,
      damageDealt: baseResolved.modifiers.damageDealt * powerMultiplier,
      damageTaken:
        baseResolved.modifiers.damageTaken /
        (1 + progress * 0.012 + retainedBossSteps * 0.025),
      spinDrain:
        baseResolved.modifiers.spinDrain * (1 + progress * 0.004),
      tracking:
        baseResolved.modifiers.tracking * (1 + progress * 0.005)
    }
  };
  const threatScore = round(
    100 * powerMultiplier +
      35 * abilityMultiplier +
      endlessEnemyExtraStackCount(wave) * 4,
    3
  );

  return {
    v: 1,
    wave,
    variant,
    ...identity,
    sourceKind,
    sourceBuild,
    visualBuild,
    resolved,
    powerMultiplier,
    abilityMultiplier,
    threatScore
  };
}
