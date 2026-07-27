import {
  TOP_LINEAGES,
  type SynergyDef,
  type SynergyModifierDef,
  type TopLineage,
  type TopStatKey
} from "../types";

const LINEAGE_META: Record<
  TopLineage,
  { name: string; nameJa: string; primary: TopStatKey; secondary: TopStatKey }
> = {
  aegis: { name: "Aegis", nameJa: "イージス", primary: "defense", secondary: "stability" },
  raptor: { name: "Raptor", nameJa: "ラプター", primary: "attack", secondary: "mobility" },
  tempest: { name: "Tempest", nameJa: "テンペスト", primary: "stamina", secondary: "mobility" },
  atlas: { name: "Atlas", nameJa: "アトラス", primary: "durability", secondary: "defense" },
  nova: { name: "Nova", nameJa: "ノヴァ", primary: "attack", secondary: "stamina" },
  pulse: { name: "Pulse", nameJa: "パルス", primary: "mobility", secondary: "stability" },
  revenant: { name: "Revenant", nameJa: "レヴナント", primary: "durability", secondary: "attack" },
  eclipse: { name: "Eclipse", nameJa: "エクリプス", primary: "stability", secondary: "defense" },
  helix: { name: "Helix", nameJa: "ヘリックス", primary: "stamina", secondary: "stability" }
};

function lineageModifiers(
  lineage: TopLineage,
  threshold: 2 | 4 | 6
): readonly SynergyModifierDef[] {
  const meta = LINEAGE_META[lineage];
  if (threshold === 2) {
    return [{ target: "stats", stat: meta.primary, operation: "multiply", value: 1.05 }];
  }
  if (threshold === 4) {
    return [
      { target: "stats", stat: meta.primary, operation: "multiply", value: 1.1 },
      { target: "stats", stat: meta.secondary, operation: "multiply", value: 1.06 }
    ];
  }
  const physics =
    lineage === "atlas" || lineage === "aegis"
      ? ({ target: "physics", stat: "centerOfMass", operation: "multiply", value: 0.9 } as const)
      : lineage === "raptor" || lineage === "nova"
        ? ({ target: "physics", stat: "restitution", operation: "multiply", value: 1.08 } as const)
        : ({ target: "physics", stat: "drag", operation: "multiply", value: 0.9 } as const);
  return [
    { target: "stats", stat: meta.primary, operation: "multiply", value: 1.16 },
    { target: "stats", stat: meta.secondary, operation: "multiply", value: 1.1 },
    physics
  ];
}

const LINEAGE_SYNERGIES: readonly SynergyDef[] = TOP_LINEAGES.flatMap((lineage) =>
  ([2, 4, 6] as const).map((threshold) => {
    const meta = LINEAGE_META[lineage];
    return {
      id: `${lineage}-${threshold}`,
      name: `${meta.name} Resonance ${threshold}`,
      nameJa: `${meta.nameJa}共鳴 ${threshold}`,
      descriptionJa: `${meta.nameJa}系統を${threshold}部位そろえた時に発動する最高段階のみ有効な共鳴。`,
      kind: "lineage",
      lineage,
      threshold,
      modifiers: lineageModifiers(lineage, threshold)
    };
  })
);

const ROLE_PAIR_SYNERGIES = [
  {
    id: "role-attack-defense",
    name: "Breaker Bulwark",
    nameJa: "ブレイカーブルワーク",
    descriptionJa: "攻撃役と防御役を組み合わせ、攻防の切り替えを強化する。",
    kind: "role-pair",
    roles: ["attack", "defense"],
    modifiers: [
      { target: "stats", stat: "attack", operation: "multiply", value: 1.04 },
      { target: "stats", stat: "defense", operation: "multiply", value: 1.04 }
    ]
  },
  {
    id: "role-attack-stamina",
    name: "Relentless Assault",
    nameJa: "リレントレスアサルト",
    descriptionJa: "攻撃を持久へつなぎ、長い打ち合いを可能にする。",
    kind: "role-pair",
    roles: ["attack", "stamina"],
    modifiers: [
      { target: "stats", stat: "attack", operation: "multiply", value: 1.035 },
      { target: "stats", stat: "stamina", operation: "multiply", value: 1.055 }
    ]
  },
  {
    id: "role-attack-control",
    name: "Guided Impact",
    nameJa: "ガイデッドインパクト",
    descriptionJa: "制御された軌道から正確な衝突を作る。",
    kind: "role-pair",
    roles: ["attack", "control"],
    modifiers: [
      { target: "stats", stat: "attack", operation: "multiply", value: 1.045 },
      { target: "stats", stat: "mobility", operation: "multiply", value: 1.045 }
    ]
  },
  {
    id: "role-defense-stamina",
    name: "Iron Orbit",
    nameJa: "アイアンオービット",
    descriptionJa: "防御と持久の連携で粘り強い周回を作る。",
    kind: "role-pair",
    roles: ["defense", "stamina"],
    modifiers: [
      { target: "stats", stat: "defense", operation: "multiply", value: 1.04 },
      { target: "stats", stat: "stamina", operation: "multiply", value: 1.05 }
    ]
  },
  {
    id: "role-defense-control",
    name: "Fortress Vector",
    nameJa: "フォートレスベクトル",
    descriptionJa: "防御姿勢を崩さず危険な軌道を避ける。",
    kind: "role-pair",
    roles: ["defense", "control"],
    modifiers: [
      { target: "stats", stat: "defense", operation: "multiply", value: 1.045 },
      { target: "stats", stat: "stability", operation: "multiply", value: 1.045 }
    ]
  },
  {
    id: "role-stamina-control",
    name: "Perfect Cycle",
    nameJa: "パーフェクトサイクル",
    descriptionJa: "持久と制御の連携で回転損失を抑える。",
    kind: "role-pair",
    roles: ["stamina", "control"],
    modifiers: [
      { target: "stats", stat: "stamina", operation: "multiply", value: 1.055 },
      { target: "physics", stat: "drag", operation: "multiply", value: 0.96 }
    ]
  }
] as const satisfies readonly SynergyDef[];

export const SYNERGIES: readonly SynergyDef[] = [
  ...LINEAGE_SYNERGIES,
  ...ROLE_PAIR_SYNERGIES
];

export const SYNERGY_BY_ID: ReadonlyMap<string, SynergyDef> = new Map(
  SYNERGIES.map((synergy) => [synergy.id, synergy])
);
