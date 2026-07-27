import {
  ACTIVE_SKILLS,
  CATALOG_BY_ID,
  PARTS,
  PASSIVE_SKILLS,
  SYNERGIES,
  TOP_LINEAGES,
  TOP_ROLES,
  TOP_SLOTS,
  assertCatalogSkillReferences,
  autoDraftPick,
  createDefaultBuild,
  createDraftState,
  currentDraftOrder,
  currentDraftPlayerIndex,
  deriveBuildStats,
  draftBuildForPlayer,
  getPartsForSlot,
  isDraftTurnExpired,
  legalDraftPicks,
  resolveSynergies,
  searchParts,
  validateBuild,
  type DraftPlayer,
  type PartKind,
  type TopBuildSpec
} from "./index";
import {
  VORTEX_GARAGE_KEY,
  decodeBuild,
  encodeBuild,
  loadGarage,
  saveGarage
} from "../builder/storage";

declare const process: { exitCode?: number };

const failures: string[] = [];

function check(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
  if (!ok) failures.push(name);
}

function countBy<T extends string>(values: readonly T[]): Record<T, number> {
  const result = {} as Record<T, number>;
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
}

function makeSingleLineageBuild(lineage: (typeof TOP_LINEAGES)[number]): TopBuildSpec {
  return {
    v: 1,
    name: `${lineage}-resonance`,
    paint: 0x445566,
    parts: Object.fromEntries(
      TOP_SLOTS.map((slot) => [
        slot,
        getPartsForSlot(slot).find((part) => part.lineage === lineage && part.grade === 1)!.id
      ])
    ) as TopBuildSpec["parts"]
  };
}

function makeAllRolesBuild(): TopBuildSpec {
  return {
    v: 1,
    name: "all-roles",
    paint: 0x112233,
    parts: Object.fromEntries(
      TOP_SLOTS.map((slot, index) => {
        const role = TOP_ROLES[index % TOP_ROLES.length]!;
        return [
          slot,
          getPartsForSlot(slot).find((part) => part.role === role && part.grade === 1)!.id
        ];
      })
    ) as TopBuildSpec["parts"]
  };
}

function installStorageShim(): Map<string, string> {
  const values = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value)
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: shim
  });
  return values;
}

function catalogGates(): void {
  check("[C01] 合計パーツ数", PARTS.length === 777, `${PARTS.length} / 777`);
  for (const slot of TOP_SLOTS) {
    const count = getPartsForSlot(slot).length;
    check(`[C02] ${slot}は111件`, count === 111, `${count} / 111`);
  }
  const kindCounts = countBy(PARTS.map((part) => part.kind));
  for (const kind of ["stat", "passive", "active"] as const satisfies readonly PartKind[]) {
    check(`[C03] ${kind}型は259件`, kindCounts[kind] === 259, `${kindCounts[kind] ?? 0} / 259`);
  }
  check(
    "[C04] IDは全件一意",
    CATALOG_BY_ID.size === PARTS.length,
    `${CATALOG_BY_ID.size} unique / ${PARTS.length}`
  );

  let baseDistributionOk = true;
  for (const slot of TOP_SLOTS) {
    for (const lineage of TOP_LINEAGES) {
      for (const role of TOP_ROLES) {
        const variants = PARTS.filter(
          (part) =>
            part.slot === slot &&
            part.lineage === lineage &&
            part.role === role &&
            part.grade !== "signature"
        );
        if (
          variants.length !== 3 ||
          !([1, 2, 3] as const).every((grade) => variants.some((part) => part.grade === grade))
        ) {
          baseDistributionOk = false;
        }
      }
    }
  }
  check(
    "[C05] 各部位は9系統×4役割×3グレード",
    baseDistributionOk,
    "全252 slot/lineage/role組を検査"
  );
  const signatureCounts = TOP_SLOTS.map(
    (slot) => PARTS.filter((part) => part.slot === slot && part.grade === "signature").length
  );
  check(
    "[C06] シグネチャーは各部位3件",
    signatureCounts.every((count) => count === 3),
    signatureCounts.join(",")
  );

  check(
    "[C07] Active辞書は35件でID一意",
    ACTIVE_SKILLS.length === 35 &&
      new Set(ACTIVE_SKILLS.map((skill) => skill.id)).size === ACTIVE_SKILLS.length,
    `${ACTIVE_SKILLS.length} definitions`
  );
  check(
    "[C08] Passive辞書は35件でID一意",
    PASSIVE_SKILLS.length === 35 &&
      new Set(PASSIVE_SKILLS.map((skill) => skill.id)).size === PASSIVE_SKILLS.length,
    `${PASSIVE_SKILLS.length} definitions`
  );
  check(
    "[C09] 全スキル参照が辞書に存在",
    PARTS.every(assertCatalogSkillReferences),
    `${PARTS.filter(assertCatalogSkillReferences).length} / ${PARTS.length}`
  );
  const referencedActive = new Set(PARTS.map((part) => part.activeSkillId).filter(Boolean));
  const referencedPassive = new Set(PARTS.map((part) => part.passiveSkillId).filter(Boolean));
  check(
    "[C10] 全Active定義が実パーツで使用される",
    referencedActive.size === ACTIVE_SKILLS.length,
    `${referencedActive.size} / ${ACTIVE_SKILLS.length}`
  );
  check(
    "[C11] 全Passive定義が実パーツで使用される",
    referencedPassive.size === PASSIVE_SKILLS.length,
    `${referencedPassive.size} / ${PASSIVE_SKILLS.length}`
  );

  const baseVisualKeys = new Set(
    PARTS.filter((part) => part.grade !== "signature").map((part) => part.visual.visualKey)
  );
  const signatureVisualKeys = new Set(
    PARTS.filter((part) => part.grade === "signature").map((part) => part.visual.visualKey)
  );
  check("[C12] 基本形状factoryは63", baseVisualKeys.size === 63, `${baseVisualKeys.size} / 63`);
  check(
    "[C13] シグネチャー形状factoryは21",
    signatureVisualKeys.size === 21,
    `${signatureVisualKeys.size} / 21`
  );
  const visualSignatures = new Set(PARTS.map((part) => part.visual.parameterSignature));
  check(
    "[C14] 外観パラメータは全件一意",
    visualSignatures.size === PARTS.length,
    `${visualSignatures.size} / ${PARTS.length}`
  );
  const gameplaySignatures = new Set(
    PARTS.map((part) =>
      JSON.stringify([
        part.slot,
        part.cost,
        part.stats,
        part.physics,
        part.activeSkillId ?? null,
        part.passiveSkillId ?? null,
        part.skillRank ?? null
      ])
    )
  );
  check(
    "[C15] 能力構成は全件一意",
    gameplaySignatures.size === PARTS.length,
    `${gameplaySignatures.size} / ${PARTS.length}`
  );

  const lineageSynergies = SYNERGIES.filter((synergy) => synergy.kind === "lineage");
  const roleSynergies = SYNERGIES.filter((synergy) => synergy.kind === "role-pair");
  check(
    "[C16] 系統シナジーは9×3段階",
    lineageSynergies.length === 27,
    `${lineageSynergies.length} / 27`
  );
  check("[C17] 役割ペアシナジーは6", roleSynergies.length === 6, `${roleSynergies.length} / 6`);
}

function buildGates(): TopBuildSpec {
  const build = createDefaultBuild("日本語 VORTEX");
  const verdict700 = validateBuild(build, 700);
  check(
    "[B01] デフォルトビルドは7部位・700以内",
    verdict700.ok,
    `cost=${verdict700.totalCost}, errors=${verdict700.errors.length}`
  );
  const derived = deriveBuildStats(build);
  const allFinite =
    Object.values(derived.stats).every(Number.isFinite) &&
    Object.values(derived.physics).every(Number.isFinite);
  check(
    "[B02] 派生能力・物理値は有限",
    allFinite && derived.parts !== undefined,
    `cost=${derived.totalCost}, active=${Object.keys(derived.activeSlots).length}, passive=${derived.passiveSkills.length}`
  );

  const expensive: TopBuildSpec = {
    ...build,
    name: "over-budget",
    parts: Object.fromEntries(
      TOP_SLOTS.map((slot) => [
        slot,
        [...getPartsForSlot(slot)].sort((a, b) => b.cost - a.cost)[0]!.id
      ])
    ) as TopBuildSpec["parts"]
  };
  const finiteVerdict = validateBuild(expensive, 700);
  const sandboxVerdict = validateBuild(expensive, Number.POSITIVE_INFINITY);
  check(
    "[B03] 700上限は超過を拒否",
    !finiteVerdict.ok && finiteVerdict.errors.some((issue) => issue.code === "over-budget"),
    `cost=${finiteVerdict.totalCost}`
  );
  check(
    "[B04] Infinityサンドボックスは同じ構成を許可",
    sandboxVerdict.ok,
    `cost=${sandboxVerdict.totalCost}`
  );

  const sameLineage = resolveSynergies(makeSingleLineageBuild("aegis")).filter(
    (entry) => entry.synergy.kind === "lineage"
  );
  check(
    "[B05] 同系統7部位では6段階だけ適用",
    sameLineage.length === 1 && sameLineage[0]?.synergy.id === "aegis-6",
    sameLineage.map((entry) => entry.synergy.id).join(",")
  );
  const allRolePairs = resolveSynergies(makeAllRolesBuild()).filter(
    (entry) => entry.synergy.kind === "role-pair"
  );
  check(
    "[B06] 4役割を含むと全6ペアが適用",
    allRolePairs.length === 6,
    `${allRolePairs.length} / 6`
  );
  const unknown: TopBuildSpec = {
    ...build,
    parts: { ...build.parts, crest: "not-a-real-part" }
  };
  check(
    "[B07] 未知参照を拒否",
    validateBuild(unknown, 1000).errors.some((issue) => issue.code === "unknown-part"),
    "unknown-part"
  );
  return build;
}

function searchGates(): void {
  const ja = searchParts("crest", "イージス");
  check(
    "[S01] 日本語検索",
    ja.length > 0 &&
      ja.every(
        (part) =>
          part.slot === "crest" &&
          `${part.nameJa} ${part.descriptionJa} ${part.keywords.join(" ")}`.includes("イージス")
      ),
    `${ja.length} results`
  );
  const filtered = searchParts("edge", {
    lineages: ["raptor"],
    roles: ["attack"],
    kinds: ["active"],
    maxCost: 300,
    hasSkill: true
  });
  check(
    "[S02] 複合フィルター",
    filtered.length > 0 &&
      filtered.every(
        (part) =>
          part.slot === "edge" &&
          part.lineage === "raptor" &&
          part.role === "attack" &&
          part.kind === "active" &&
          part.cost <= 300
      ),
    `${filtered.length} results`
  );
}

function draftGates(): void {
  const players: readonly DraftPlayer[] = [
    { id: "p1", name: "P1", isCpu: false },
    { id: "p2", name: "P2", isCpu: false }
  ];
  let draft = createDraftState({ players, costLimit: 700, seed: "snake-gate", nowMs: 100 });
  const baseOrder = [...draft.baseOrder];
  const initialLegal = legalDraftPicks(draft);
  const initialReserve = TOP_SLOTS.slice(1).reduce(
    (sum, slot) => sum + Math.min(...getPartsForSlot(slot).map((part) => part.cost)),
    0
  );
  check(
    "[D01] 予約コストを守る候補だけ提示",
    initialLegal.length > 0 && initialLegal.every((part) => part.cost + initialReserve <= 700),
    `${initialLegal.length} legal`
  );
  draft = autoDraftPick(draft, 120);
  const firstId = draft.claimedPartIds[0]!;
  const duplicateHidden = !legalDraftPicks(draft).some((part) => part.id === firstId);
  check("[D02] 取得済みパーツは再選択不可", duplicateHidden, firstId);
  draft = autoDraftPick(draft, 140);
  const reversedOrder = [...currentDraftOrder(draft)];
  check(
    "[D03] 部位ラウンドごとにスネーク反転",
    draft.slotIndex === 1 &&
      reversedOrder.join(",") === [...baseOrder].reverse().join(",") &&
      currentDraftPlayerIndex(draft) === baseOrder.at(-1),
    `base=${baseOrder.join(",")} next=${reversedOrder.join(",")}`
  );
  check(
    "[D04] 各手番は12秒",
    draft.deadlineMs === 140 + 12_000 && !isDraftTurnExpired(draft, 140 + 11_999) && isDraftTurnExpired(draft, 140 + 12_000),
    `deadline=${draft.deadlineMs}`
  );
  for (let guard = 0; guard < 20 && !draft.completed; guard += 1) {
    draft = autoDraftPick(draft, 200 + guard);
  }
  check(
    "[D05] 2人×7部位で14選択後に完了",
    draft.completed && draft.claimedPartIds.length === 14,
    `completed=${draft.completed}, picks=${draft.claimedPartIds.length}`
  );
  const builds = players.map((_, index) => draftBuildForPlayer(draft, index));
  check(
    "[D06] ドラフト機体は全員700以内",
    builds.every((build) => validateBuild(build, 700).ok),
    builds.map((build) => validateBuild(build, 700).totalCost).join(",")
  );
  check(
    "[D07] 全ドラフト取得が一意",
    new Set(draft.claimedPartIds).size === draft.claimedPartIds.length,
    `${new Set(draft.claimedPartIds).size} / ${draft.claimedPartIds.length}`
  );
}

function storageGates(build: TopBuildSpec): void {
  const values = installStorageShim();
  const encoded = encodeBuild(build);
  const decoded = decodeBuild(encoded);
  check(
    "[P01] Unicode名をbase64url往復",
    decoded !== null &&
      decoded.name === build.name &&
      JSON.stringify(decoded.parts) === JSON.stringify(build.parts) &&
      /^[A-Za-z0-9_-]+$/u.test(encoded),
    `${encoded.length} chars`
  );
  check("[P02] 壊れた共有コードを拒否", decodeBuild("not!base64") === null, "null");
  saveGarage([build]);
  const loaded = loadGarage();
  check(
    "[P03] localStorage往復",
    loaded.length === 1 && loaded[0]?.name === build.name,
    `${loaded.length} builds`
  );
  values.set(VORTEX_GARAGE_KEY, "{broken");
  check("[P04] 壊れた保存データは安全に空配列", loadGarage().length === 0, "[]");
}

function main(): void {
  catalogGates();
  const build = buildGates();
  searchGates();
  draftGates();
  storageGates(build);
  if (failures.length > 0) {
    console.log(`VORTEX CONTENT GATES FAIL — ${failures.join(" / ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `VORTEX CONTENT GATES PASS — parts=${PARTS.length}, active=${ACTIVE_SKILLS.length}, passive=${PASSIVE_SKILLS.length}, synergies=${SYNERGIES.length}`
  );
}

main();
