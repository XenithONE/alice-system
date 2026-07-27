import {
  TOP_LINEAGES,
  TOP_ROLES,
  TOP_SLOTS,
  TOP_STAT_KEYS,
  type PartGrade,
  type PartKind,
  type PartSearchFilters,
  type SkillRank,
  type TopLineage,
  type TopPartDef,
  type TopPhysicsStats,
  type TopRole,
  type TopSlot,
  type TopStats
} from "../types";
import {
  ACTIVE_SKILLS,
  PASSIVE_SKILLS,
  getActiveSkill,
  getPassiveSkill
} from "./skills";

export const SLOT_META = {
  crest: { number: 1, name: "Crest", nameJa: "紋章", purposeJa: "属性・スキル傾向" },
  crown: { number: 2, name: "Crown", nameJa: "冠輪", purposeJa: "空力・防御" },
  edge: { number: 3, name: "Edge", nameJa: "衝撃刃", purposeJa: "攻撃半径・反発" },
  weight: { number: 4, name: "Weight", nameJa: "慣性輪", purposeJa: "質量・慣性" },
  core: { number: 5, name: "Core", nameJa: "駆動核", purposeJa: "耐久・エネルギー" },
  shaft: { number: 6, name: "Shaft", nameJa: "回転軸", purposeJa: "高さ・傾き・回転伝達" },
  tip: { number: 7, name: "Tip", nameJa: "接地針", purposeJa: "摩擦・移動軌道" }
} as const satisfies Record<
  TopSlot,
  { number: 1 | 2 | 3 | 4 | 5 | 6 | 7; name: string; nameJa: string; purposeJa: string }
>;

export const LINEAGE_META: Record<
  TopLineage,
  { name: string; nameJa: string; identityJa: string; primary: number; accent: number }
> = {
  aegis: {
    name: "Aegis",
    nameJa: "イージス",
    identityJa: "防御と軸安定に優れた多層装甲系統",
    primary: 0x3f647d,
    accent: 0x9bd8ff
  },
  raptor: {
    name: "Raptor",
    nameJa: "ラプター",
    identityJa: "鋭い打撃と高速追跡を担う猛禽系統",
    primary: 0x8f2f38,
    accent: 0xffb08a
  },
  tempest: {
    name: "Tempest",
    nameJa: "テンペスト",
    identityJa: "空力と持久を磨いた渦流系統",
    primary: 0x267f8d,
    accent: 0x8ff4e9
  },
  atlas: {
    name: "Atlas",
    nameJa: "アトラス",
    identityJa: "圧倒的な質量と耐久を持つ重装系統",
    primary: 0x645b55,
    accent: 0xe0b56b
  },
  nova: {
    name: "Nova",
    nameJa: "ノヴァ",
    identityJa: "爆発的な衝突出力を蓄える恒星系統",
    primary: 0x9d4a24,
    accent: 0xffde74
  },
  pulse: {
    name: "Pulse",
    nameJa: "パルス",
    identityJa: "軌道制御と瞬発力に秀でる電子系統",
    primary: 0x5651a6,
    accent: 0xd0a6ff
  },
  revenant: {
    name: "Revenant",
    nameJa: "レヴナント",
    identityJa: "損傷から立て直し反撃する再生系統",
    primary: 0x3f704b,
    accent: 0xb3ed86
  },
  eclipse: {
    name: "Eclipse",
    nameJa: "エクリプス",
    identityJa: "低重心と位相制御を操る蝕影系統",
    primary: 0x302f46,
    accent: 0xee7aff
  },
  helix: {
    name: "Helix",
    nameJa: "ヘリックス",
    identityJa: "攻防持久を螺旋構造でつなぐ均衡系統",
    primary: 0x426d68,
    accent: 0xc6f0c2
  }
};

export const ROLE_META: Record<
  TopRole,
  { name: string; nameJa: string; identityJa: string }
> = {
  attack: { name: "Striker", nameJa: "強襲", identityJa: "衝突威力を優先" },
  defense: { name: "Bulwark", nameJa: "堅守", identityJa: "被害と押し出しを軽減" },
  stamina: { name: "Endurance", nameJa: "持久", identityJa: "回転維持を優先" },
  control: { name: "Vector", nameJa: "制御", identityJa: "姿勢と軌道を優先" }
};

const SLOT_BASE_STATS: Record<TopSlot, TopStats> = {
  crest: { attack: 8, defense: 8, stamina: 11, stability: 10, mobility: 9, durability: 18 },
  crown: { attack: 10, defense: 16, stamina: 12, stability: 13, mobility: 7, durability: 25 },
  edge: { attack: 22, defense: 8, stamina: 7, stability: 7, mobility: 12, durability: 21 },
  weight: { attack: 13, defense: 14, stamina: 10, stability: 18, mobility: 5, durability: 28 },
  core: { attack: 9, defense: 12, stamina: 17, stability: 12, mobility: 8, durability: 35 },
  shaft: { attack: 7, defense: 8, stamina: 14, stability: 20, mobility: 11, durability: 19 },
  tip: { attack: 10, defense: 7, stamina: 16, stability: 14, mobility: 21, durability: 17 }
};

const LINEAGE_STAT_BONUS: Record<TopLineage, Partial<TopStats>> = {
  aegis: { defense: 6, stability: 3 },
  raptor: { attack: 6, mobility: 3 },
  tempest: { stamina: 6, mobility: 3 },
  atlas: { defense: 4, durability: 8, mobility: -2 },
  nova: { attack: 5, stamina: 3, stability: -1 },
  pulse: { mobility: 6, stability: 2 },
  revenant: { durability: 7, attack: 3 },
  eclipse: { stability: 6, defense: 2 },
  helix: { attack: 2, defense: 2, stamina: 3, stability: 3 }
};

const ROLE_STAT_BONUS: Record<TopRole, Partial<TopStats>> = {
  attack: { attack: 7, defense: -2, mobility: 2 },
  defense: { defense: 7, durability: 5, mobility: -2 },
  stamina: { stamina: 7, stability: 2, attack: -1 },
  control: { stability: 5, mobility: 5, attack: -1 }
};

const SLOT_BASE_PHYSICS: Record<TopSlot, TopPhysicsStats> = {
  crest: { mass: 0.1, inertia: 0.03, centerOfMass: 0.11, friction: 0.38, restitution: 0.46, drag: 0.045 },
  crown: { mass: 0.2, inertia: 0.07, centerOfMass: 0.075, friction: 0.42, restitution: 0.42, drag: 0.052 },
  edge: { mass: 0.28, inertia: 0.15, centerOfMass: 0.042, friction: 0.34, restitution: 0.62, drag: 0.06 },
  weight: { mass: 0.48, inertia: 0.22, centerOfMass: 0.01, friction: 0.48, restitution: 0.3, drag: 0.044 },
  core: { mass: 0.26, inertia: 0.09, centerOfMass: -0.018, friction: 0.44, restitution: 0.36, drag: 0.04 },
  shaft: { mass: 0.14, inertia: 0.045, centerOfMass: -0.065, friction: 0.5, restitution: 0.34, drag: 0.034 },
  tip: { mass: 0.09, inertia: 0.025, centerOfMass: -0.11, friction: 0.64, restitution: 0.4, drag: 0.03 }
};

const SLOT_COST: Record<TopSlot, number> = {
  crest: 58,
  crown: 68,
  edge: 82,
  weight: 86,
  core: 90,
  shaft: 64,
  tip: 56
};

const GRADE_SCALE: Record<PartGrade, number> = {
  1: 1,
  2: 1.28,
  3: 1.58,
  signature: 1.88
};

const GRADE_LABEL: Record<PartGrade, string> = {
  1: "I",
  2: "II",
  3: "III",
  signature: "Σ"
};

const LINEAGE_COST_DELTA: Record<TopLineage, number> = {
  aegis: 2,
  raptor: 4,
  tempest: 1,
  atlas: 8,
  nova: 5,
  pulse: 2,
  revenant: 4,
  eclipse: 3,
  helix: 0
};

const ROLE_COST_DELTA: Record<TopRole, number> = {
  attack: 5,
  defense: 4,
  stamina: 1,
  control: 2
};

const MATERIALS = ["titanium", "tungsten", "carbon", "ceramic", "alloy", "polymer"] as const;
const KINDS = ["stat", "passive", "active"] as const satisfies readonly PartKind[];
const SIGNATURE_NAMES = [
  { name: "Zenith", nameJa: "ゼニス" },
  { name: "Paragon", nameJa: "パラゴン" },
  { name: "Obsidian", nameJa: "オブシディアン" }
] as const;

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function gradeRank(grade: PartGrade): SkillRank {
  return grade === 1 ? 1 : grade === 2 ? 2 : 3;
}

function makeStats(
  slot: TopSlot,
  lineage: TopLineage,
  role: TopRole,
  grade: PartGrade,
  kind: PartKind,
  globalIndex: number
): TopStats {
  const result = { ...SLOT_BASE_STATS[slot] };
  const lineageBonus = LINEAGE_STAT_BONUS[lineage];
  const roleBonus = ROLE_STAT_BONUS[role];
  const scale = GRADE_SCALE[grade];
  for (const key of TOP_STAT_KEYS) {
    const raw = (result[key] + (lineageBonus[key] ?? 0) + (roleBonus[key] ?? 0)) * scale;
    const statPremium = kind === "stat" ? 1.1 : 1;
    result[key] = round(Math.max(1, raw * statPremium + ((globalIndex + TOP_STAT_KEYS.indexOf(key)) % 5) * 0.04), 2);
  }
  return result;
}

function makePhysics(
  slot: TopSlot,
  lineage: TopLineage,
  role: TopRole,
  grade: PartGrade,
  globalIndex: number
): TopPhysicsStats {
  const base = SLOT_BASE_PHYSICS[slot];
  const gradeScale = 0.84 + GRADE_SCALE[grade] * 0.16;
  const lineageMass =
    lineage === "atlas" ? 1.18 : lineage === "tempest" || lineage === "pulse" ? 0.9 : 1;
  const roleMass = role === "defense" ? 1.08 : role === "control" ? 0.94 : 1;
  const roleFriction = role === "control" ? 1.12 : role === "stamina" ? 0.92 : 1;
  const lineageRestitution = lineage === "raptor" || lineage === "nova" ? 1.12 : 1;
  const dragScale = lineage === "tempest" ? 0.82 : lineage === "atlas" ? 1.12 : 1;
  return {
    mass: round(base.mass * gradeScale * lineageMass * roleMass, 4),
    inertia: round(base.inertia * gradeScale * lineageMass * (role === "stamina" ? 1.08 : 1), 5),
    centerOfMass: round(
      base.centerOfMass +
        (role === "control" ? -0.006 : role === "attack" ? 0.004 : 0) +
        globalIndex * 0.00001,
      5
    ),
    friction: round(base.friction * roleFriction, 4),
    restitution: round(Math.min(0.95, base.restitution * lineageRestitution), 4),
    drag: round(base.drag * dragScale * (role === "stamina" ? 0.9 : 1), 5)
  };
}

function makePart(
  slot: TopSlot,
  lineage: TopLineage,
  role: TopRole,
  grade: PartGrade,
  kind: PartKind,
  localIndex: number,
  globalIndex: number,
  skillOrdinal: number,
  signatureVariant?: number
): TopPartDef {
  const slotMeta = SLOT_META[slot];
  const lineageMeta = LINEAGE_META[lineage];
  const roleMeta = ROLE_META[role];
  const signatureName =
    signatureVariant === undefined ? null : SIGNATURE_NAMES[signatureVariant]!;
  const id =
    signatureVariant === undefined
      ? `${slot}-${lineage}-${role}-g${grade}`
      : `${slot}-signature-${signatureName!.name.toLowerCase()}`;
  const name =
    signatureName === null
      ? `${lineageMeta.name} ${roleMeta.name} ${slotMeta.name} ${GRADE_LABEL[grade]}`
      : `${signatureName.name} ${slotMeta.name}`;
  const nameJa =
    signatureName === null
      ? `${lineageMeta.nameJa} ${roleMeta.nameJa}${slotMeta.nameJa} ${GRADE_LABEL[grade]}`
      : `${signatureName.nameJa}${slotMeta.nameJa}`;
  const skillRank = gradeRank(grade);
  const activeSkill =
    kind === "active" ? ACTIVE_SKILLS[skillOrdinal % ACTIVE_SKILLS.length] : undefined;
  const passiveSkill =
    kind === "passive" ? PASSIVE_SKILLS[skillOrdinal % PASSIVE_SKILLS.length] : undefined;
  const kindCost = kind === "active" ? 13 : kind === "passive" ? 9 : 5;
  const signatureCost = signatureVariant === undefined ? 0 : 18 + signatureVariant * 3;
  const cost = Math.round(
    SLOT_COST[slot] * GRADE_SCALE[grade] +
      LINEAGE_COST_DELTA[lineage] +
      ROLE_COST_DELTA[role] +
      kindCost +
      signatureCost
  );
  const material =
    MATERIALS[(TOP_LINEAGES.indexOf(lineage) + TOP_ROLES.indexOf(role) + skillRank) % MATERIALS.length]!;
  const bladeCount = 3 + ((localIndex + TOP_ROLES.indexOf(role) * 2) % 10);
  const thickness = round(0.022 + SLOT_META[slot].number * 0.0025 + skillRank * 0.003, 4);
  const aperture = round(0.08 + ((localIndex * 7) % 19) * 0.009, 4);
  const engraving = `${lineage.slice(0, 3).toUpperCase()}-${slotMeta.number}-${role[0]!.toUpperCase()}-${GRADE_LABEL[grade]}`;
  const visualKey =
    signatureVariant === undefined
      ? `${slot}:${lineage}`
      : `signature:${slot}:${signatureVariant}`;
  const parameterSignature = [
    visualKey,
    `r${role}`,
    `g${GRADE_LABEL[grade]}`,
    `b${bladeCount}`,
    `t${thickness}`,
    `a${aperture}`,
    `m${material}`,
    `u${globalIndex}`
  ].join("|");
  const skillText =
    activeSkill !== undefined
      ? `Active「${activeSkill.nameJa}」を搭載。`
      : passiveSkill !== undefined
        ? `Passive「${passiveSkill.nameJa}」を搭載。`
        : "スキル機構を省き、同コスト帯より基礎能力を10%高めた純性能型。";
  return Object.freeze({
    id,
    slot,
    lineage,
    family: lineage,
    role,
    grade,
    kind,
    name,
    nameJa,
    descriptionJa: `${lineageMeta.identityJa}の${slotMeta.purposeJa}用${roleMeta.identityJa}モデル。${skillText}`,
    cost,
    stats: Object.freeze(makeStats(slot, lineage, role, grade, kind, globalIndex)),
    physics: Object.freeze(makePhysics(slot, lineage, role, grade, globalIndex)),
    ...(activeSkill === undefined ? {} : { activeSkillId: activeSkill.id, skillRank }),
    ...(passiveSkill === undefined ? {} : { passiveSkillId: passiveSkill.id, skillRank }),
    visual: Object.freeze({
      visualKey,
      parameterSignature,
      material,
      primaryColor: lineageMeta.primary,
      accentColor: lineageMeta.accent,
      bladeCount,
      thickness,
      aperture,
      engraving
    }),
    collider: Object.freeze({
      shape:
        slot === "tip"
          ? "cone"
          : slot === "edge" || signatureVariant !== undefined
            ? "compound"
            : "cylinder",
      radius: round(0.2 + slotMeta.number * 0.014 + (slot === "edge" ? 0.11 : 0), 3),
      height: round(thickness * (slot === "shaft" ? 2.4 : 1.3), 3),
      offsetY: round(0.14 - slotMeta.number * 0.042, 3),
      lobes: bladeCount
    }),
    keywords: Object.freeze([
      slotMeta.name,
      slotMeta.nameJa,
      lineageMeta.name,
      lineageMeta.nameJa,
      roleMeta.name,
      roleMeta.nameJa,
      kind,
      ...(activeSkill === undefined ? [] : [activeSkill.name, activeSkill.nameJa]),
      ...(passiveSkill === undefined ? [] : [passiveSkill.name, passiveSkill.nameJa])
    ])
  });
}

function createCatalog(): readonly TopPartDef[] {
  const parts: TopPartDef[] = [];
  let passiveOrdinal = 0;
  let activeOrdinal = 0;
  for (const [slotIndex, slot] of TOP_SLOTS.entries()) {
    let localIndex = 0;
    for (const [lineageIndex, lineage] of TOP_LINEAGES.entries()) {
      for (const [roleIndex, role] of TOP_ROLES.entries()) {
        for (const [gradeIndex, grade] of ([1, 2, 3] as const).entries()) {
          const kind = KINDS[(gradeIndex + lineageIndex + roleIndex + slotIndex) % KINDS.length]!;
          const skillOrdinal =
            kind === "active"
              ? activeOrdinal++
              : kind === "passive"
                ? passiveOrdinal++
                : localIndex;
          parts.push(
            makePart(
              slot,
              lineage,
              role,
              grade,
              kind,
              localIndex,
              slotIndex * 111 + localIndex,
              skillOrdinal
            )
          );
          localIndex += 1;
        }
      }
    }
    for (let variant = 0; variant < 3; variant += 1) {
      const lineage = TOP_LINEAGES[(slotIndex + variant * 3) % TOP_LINEAGES.length]!;
      const role = TOP_ROLES[(slotIndex + variant) % TOP_ROLES.length]!;
      const kind = KINDS[(variant + slotIndex) % KINDS.length]!;
      const skillOrdinal =
        kind === "active"
          ? activeOrdinal++
          : kind === "passive"
            ? passiveOrdinal++
            : localIndex;
      parts.push(
        makePart(
          slot,
          lineage,
          role,
          "signature",
          kind,
          localIndex,
          slotIndex * 111 + localIndex,
          skillOrdinal,
          variant
        )
      );
      localIndex += 1;
    }
  }
  return Object.freeze(parts);
}

export const PARTS: readonly TopPartDef[] = createCatalog();
export const CATALOG_BY_ID: ReadonlyMap<string, TopPartDef> = new Map(
  PARTS.map((part) => [part.id, part])
);

const PARTS_BY_SLOT: Readonly<Record<TopSlot, readonly TopPartDef[]>> = Object.freeze(
  Object.fromEntries(
    TOP_SLOTS.map((slot) => [slot, Object.freeze(PARTS.filter((part) => part.slot === slot))])
  ) as Record<TopSlot, readonly TopPartDef[]>
);

const SEARCH_TEXT_BY_ID: ReadonlyMap<string, string> = new Map(
  PARTS.map((part) => [
    part.id,
    [
      part.id,
      part.name,
      part.nameJa,
      part.descriptionJa,
      ...part.keywords
    ]
      .join(" ")
      .normalize("NFKC")
      .toLocaleLowerCase("ja")
  ])
);

export function getPart(id: string): TopPartDef | undefined {
  return CATALOG_BY_ID.get(id);
}

export function getPartsForSlot(slot: TopSlot): readonly TopPartDef[] {
  return PARTS_BY_SLOT[slot];
}

function matchesFilters(part: TopPartDef, filters: PartSearchFilters): boolean {
  if (filters.lineages !== undefined && !filters.lineages.includes(part.lineage)) return false;
  if (filters.roles !== undefined && !filters.roles.includes(part.role)) return false;
  if (filters.grades !== undefined && !filters.grades.includes(part.grade)) return false;
  if (filters.kinds !== undefined && !filters.kinds.includes(part.kind)) return false;
  if (filters.maxCost !== undefined && part.cost > filters.maxCost) return false;
  if (
    filters.hasSkill !== undefined &&
    (part.activeSkillId !== undefined || part.passiveSkillId !== undefined) !== filters.hasSkill
  ) {
    return false;
  }
  const query = filters.query?.trim().normalize("NFKC").toLocaleLowerCase("ja");
  if (query) {
    const haystack = SEARCH_TEXT_BY_ID.get(part.id) ?? "";
    const tokens = query.split(/\s+/u).filter(Boolean);
    if (!tokens.every((token) => haystack.includes(token))) return false;
  }
  return true;
}

export function searchParts(
  slot: TopSlot | undefined,
  queryOrFilters: string | PartSearchFilters = {}
): readonly TopPartDef[] {
  const filters =
    typeof queryOrFilters === "string" ? { query: queryOrFilters } : queryOrFilters;
  const source = slot === undefined ? PARTS : PARTS_BY_SLOT[slot];
  return source.filter((part) => matchesFilters(part, filters));
}

export function assertCatalogSkillReferences(part: TopPartDef): boolean {
  return (
    (part.activeSkillId === undefined || getActiveSkill(part.activeSkillId) !== undefined) &&
    (part.passiveSkillId === undefined || getPassiveSkill(part.passiveSkillId) !== undefined)
  );
}
