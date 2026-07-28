import {
  createDefaultBuild,
  getPartsForSlot
} from "../content";
import { resolveCatalogBuild } from "../sim/catalogAdapter";
import {
  TOP_PHYSICS_KEYS,
  TOP_SLOTS,
  TOP_STAT_KEYS,
  type RogueBuildSpec
} from "../types";
import {
  appendRoguePart,
  autoChooseEndlessRewards,
  chooseEndlessReward,
  completeEndlessWave,
  createEndlessRun,
  createRogueRewardOffer,
  deserializeEndlessRun,
  endlessEnemyExtraStackCount,
  generateEndlessEnemy,
  isLegalRewardOffer,
  resolveRogueBuild,
  rogueBuildFromTopBuild,
  serializeEndlessRun,
  validateRogueBuild,
  visualBuildFromRogue
} from "./index";

declare const process: { exitCode?: number };

const failures: string[] = [];

function check(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
  if (!ok) failures.push(name);
}

function finiteTree(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(finiteTree);
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(finiteTree);
  }
  return value === undefined;
}

function sameJson(first: unknown, second: unknown): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

function normalCompatibilityGate(): RogueBuildSpec {
  const normal = createDefaultBuild("ENDLESS TEST");
  const rogue = rogueBuildFromTopBuild(normal);
  const normalResolved = resolveCatalogBuild(normal);
  const rogueResolved = resolveRogueBuild(rogue);
  check(
    "[E01] RogueBuildSpecは通常ビルドと別形式",
    TOP_SLOTS.every(
      (slot) =>
        Array.isArray(rogue.parts[slot]) &&
        rogue.parts[slot].length === 1 &&
        rogue.parts[slot][0] === normal.parts[slot]
    ),
    "7 slot arrays, one representative each"
  );
  check(
    "[E02] 1個/部位は通常resolverと数値互換",
    sameJson(rogueResolved.stats, normalResolved.stats) &&
      sameJson(rogueResolved.physics, normalResolved.physics) &&
      sameJson(rogueResolved.modifiers, normalResolved.modifiers) &&
      sameJson(rogueResolved.synergyIds, normalResolved.synergyIds),
    `stats=${sameJson(rogueResolved.stats, normalResolved.stats)}, physics=${sameJson(rogueResolved.physics, normalResolved.physics)}`
  );
  check(
    "[E03] visual buildは先頭7パーツへ可逆",
    sameJson(visualBuildFromRogue(rogue), normal),
    normal.name
  );
  return rogue;
}

function multiStackGate(base: RogueBuildSpec): void {
  let stacked = base;
  for (const slot of TOP_SLOTS) {
    const active = getPartsForSlot(slot).find(
      (part) => part.kind === "active"
    )!;
    const passive = getPartsForSlot(slot).find(
      (part) => part.kind === "passive"
    )!;
    stacked = appendRoguePart(stacked, active.id);
    stacked = appendRoguePart(stacked, passive.id);
  }
  const duplicateId = stacked.parts.crest[1]!;
  stacked = appendRoguePart(stacked, duplicateId);
  const verdict = validateRogueBuild(stacked);
  const resolved = resolveRogueBuild(stacked);
  check(
    "[E04] 全7部位へ多重装備可能",
    verdict.ok &&
      TOP_SLOTS.every((slot) => stacked.parts[slot].length >= 3),
    `${verdict.totalParts} installed parts`
  );
  check(
    "[E05] 同ID重複を保持",
    stacked.parts.crest.filter((id) => id === duplicateId).length === 2,
    `${duplicateId} x2`
  );
  check(
    "[E06] 物理トポロジーは代表7 collider固定",
    resolved.parts.length === 7 &&
      resolved.stackEntries.length === verdict.totalParts &&
      TOP_SLOTS.every(
        (slot, index) =>
          resolved.parts[index]?.id === stacked.parts[slot][0]
      ),
    `colliders=${resolved.parts.length}, stacks=${resolved.stackEntries.length}`
  );
  check(
    "[E07] 同slot Active groupを同時発動契約へ集約",
    TOP_SLOTS.every(
      (slot) => (resolved.activeGroups[slot]?.length ?? 0) >= 1
    ) &&
      (resolved.activeGroups.crest?.length ?? 0) >= 2,
    TOP_SLOTS.map(
      (slot) => `${slot}:${resolved.activeGroups[slot]?.length ?? 0}`
    ).join(", ")
  );
  const crestScales = resolved.stackEntries
    .filter((entry) => entry.slot === "crest")
    .map((entry) => entry.contributionScale);
  check(
    "[E08] 追加効果は正で単調逓減",
    crestScales.every(
      (scale, index) =>
        scale > 0 &&
        (index === 0 || scale < crestScales[index - 1]!)
    ),
    crestScales.map((value) => value.toFixed(3)).join(" > ")
  );
  check(
    "[E09] Passive重複も個別発動契約へ保持",
    resolved.passives.length >= TOP_SLOTS.length,
    `${resolved.passives.length} passive instances`
  );
}

function rewardAndRunGate(base: RogueBuildSpec): void {
  const first = createRogueRewardOffer("same-seed", 17, "p1");
  const repeat = createRogueRewardOffer("same-seed", 17, "p1");
  const other = createRogueRewardOffer("same-seed", 17, "p2");
  check(
    "[E10] reward offerはseed/wave/playerで決定論的",
    sameJson(first, repeat) && !sameJson(first.choices, other.choices),
    first.choices.map((choice) => choice.partId).join(", ")
  );
  check(
    "[E11] rewardは777 catalog由来の合法3候補",
    isLegalRewardOffer(first) &&
      first.choices.length === 3 &&
      new Set(first.choices.map((choice) => choice.partId)).size === 3,
    "3 unique catalog choices"
  );

  const runPlayers = [
    { id: "p1", name: "ALPHA", build: base },
    { id: "p2", name: "BRAVO", build: base }
  ] as const;
  const initial = createEndlessRun("run-seed", runPlayers);
  let reward = completeEndlessWave(initial);
  reward = chooseEndlessReward(
    reward,
    "p1",
    reward.rewardOffers[0]!.choices[0].partId
  );
  const stillWaiting = reward.phase === "reward";
  const partialReward = reward;
  const serializedPartial = serializeEndlessRun(partialReward);
  check(
    "[E21] 選択途中の正規reward stateはJSON往復可能",
    sameJson(partialReward, deserializeEndlessRun(serializedPartial)),
    `${serializedPartial.length} bytes`
  );
  const rejectsSerialized = (candidate: unknown): boolean => {
    try {
      deserializeEndlessRun(JSON.stringify(candidate));
      return false;
    } catch {
      return true;
    }
  };
  const firstOffer = partialReward.rewardOffers[0]!;
  const secondOffer = partialReward.rewardOffers[1]!;
  const invalidSelected = {
    ...partialReward,
    rewardOffers: partialReward.rewardOffers.map((offer, index) =>
      index === 1
        ? { ...offer, selectedPartId: "not-an-offered-part" }
        : offer
    )
  };
  const duplicatePlayerOffer = {
    ...partialReward,
    rewardOffers: [
      firstOffer,
      { ...secondOffer, playerId: firstOffer.playerId }
    ]
  };
  const duplicateOfferId = {
    ...partialReward,
    rewardOffers: [
      firstOffer,
      { ...secondOffer, id: firstOffer.id }
    ]
  };
  const impossibleCompletedReward = {
    ...partialReward,
    rewardOffers: partialReward.rewardOffers.map((offer) => ({
      ...offer,
      selectedPartId: offer.selectedPartId ?? offer.choices[0].partId
    }))
  };
  check(
    "[E22] reward saveの選択ID・player・offer一意性を厳密検証",
    rejectsSerialized(invalidSelected) &&
      rejectsSerialized(duplicatePlayerOffer) &&
      rejectsSerialized(duplicateOfferId) &&
      rejectsSerialized(impossibleCompletedReward),
    "invalid selectedPartId / duplicate playerId / duplicate offer id / completed reward rejected"
  );
  reward = chooseEndlessReward(
    reward,
    "p2",
    reward.rewardOffers[1]!.choices[0].partId
  );
  check(
    "[E12] 2人の各選択後に次waveへ原子的に進む",
    stillWaiting &&
      reward.phase === "battle" &&
      reward.wave === 2 &&
      reward.players.every(
        (player) =>
          validateRogueBuild(player.build).totalParts ===
          validateRogueBuild(base).totalParts + 1
      ),
    `phase=${reward.phase}, wave=${reward.wave}`
  );
  const serialized = serializeEndlessRun(reward);
  check(
    "[E13] run stateはJSON往復可能",
    sameJson(reward, deserializeEndlessRun(serialized)),
    `${serialized.length} bytes`
  );
  check(
    "[E14] co-op人数は2〜4人",
    (() => {
      try {
        createEndlessRun("bad", [runPlayers[0]]);
        return false;
      } catch {
        // expected
      }
      try {
        createEndlessRun(
          "four",
          [0, 1, 2, 3].map((index) => ({
            id: `p${index}`,
            name: `P${index}`,
            build: base
          }))
        );
        return true;
      } catch {
        return false;
      }
    })(),
    "1 rejected / 4 accepted"
  );
}

function longWaveGenerationGate(): {
  readonly wave100Ms: number;
  readonly wave5000Ms: number;
  readonly wave100Stacks: number;
  readonly wave5000Stacks: number;
} {
  const wave4Stacks = endlessEnemyExtraStackCount(4);
  const wave100Stacks = endlessEnemyExtraStackCount(100);
  const wave5000Stacks = endlessEnemyExtraStackCount(5_000);
  const waveMillionStacks = endlessEnemyExtraStackCount(1_000_000);
  check(
    "[E23] 敵stackはwave4開始の無限・サブ線形成長",
    endlessEnemyExtraStackCount(3) === 0 &&
      wave4Stacks === 1 &&
      wave100Stacks > wave4Stacks &&
      wave5000Stacks > wave100Stacks &&
      waveMillionStacks > wave5000Stacks &&
      wave5000Stacks / 5_000 < wave100Stacks / 100,
    `w4=${wave4Stacks}, w100=${wave100Stacks}, w5000=${wave5000Stacks}, w1m=${waveMillionStacks}`
  );

  const start100 = performance.now();
  const enemy100 = generateEndlessEnemy(0xc0ffee, 100, 0);
  const wave100Ms = performance.now() - start100;
  const start5000 = performance.now();
  const enemy5000 = generateEndlessEnemy(0xc0ffee, 5_000, 0);
  const wave5000Ms = performance.now() - start5000;
  const enemy100Parts = validateRogueBuild(enemy100.sourceBuild).totalParts;
  const enemy5000Parts = validateRogueBuild(enemy5000.sourceBuild).totalParts;
  check(
    "[E24] wave100/5000敵生成は有限・実用時間",
    finiteTree(enemy100) &&
      finiteTree(enemy5000) &&
      enemy100Parts === TOP_SLOTS.length + wave100Stacks &&
      enemy5000Parts === TOP_SLOTS.length + wave5000Stacks &&
      wave100Ms < 250 &&
      wave5000Ms < 500,
    `w100=${wave100Ms.toFixed(2)}ms/${enemy100Parts} parts, w5000=${wave5000Ms.toFixed(2)}ms/${enemy5000Parts} parts`
  );
  check(
    "[E25] stack削減後も敵能力・脅威は無限単調成長",
    enemy5000.powerMultiplier > enemy100.powerMultiplier &&
      enemy5000.abilityMultiplier > enemy100.abilityMultiplier &&
      enemy5000.threatScore > enemy100.threatScore &&
      TOP_STAT_KEYS.every(
        (key) => enemy5000.resolved.stats[key] > enemy100.resolved.stats[key]
      ),
    `power ${enemy100.powerMultiplier.toFixed(2)}→${enemy5000.powerMultiplier.toFixed(2)}, threat ${enemy100.threatScore.toFixed(0)}→${enemy5000.threatScore.toFixed(0)}`
  );
  return {
    wave100Ms,
    wave5000Ms,
    wave100Stacks,
    wave5000Stacks
  };
}

function hundredWaveGate(base: RogueBuildSpec): void {
  let run = createEndlessRun(0xc0ffee, [
    { id: "p1", name: "ALPHA", build: base },
    { id: "p2", name: "BRAVO", build: base }
  ]);
  let previousThreat = 0;
  let previousPower = 0;
  let previousAbility = 0;
  let previousStats: Record<string, number> | null = null;
  let enemiesFinite = true;
  let monotonic = true;
  let offersLegal = true;
  let deterministic = true;
  let normalEnemies = 0;
  let rogueEnemies = 0;
  const lineages = new Set<string>();
  const roles = new Set<string>();
  const bossAffixes = new Set<string>();
  let bosses = 0;

  for (let wave = 1; wave <= 100; wave += 1) {
    const enemy = generateEndlessEnemy(run.seed, wave);
    const repeat = generateEndlessEnemy(run.seed, wave);
    deterministic &&= sameJson(enemy, repeat);
    enemiesFinite &&= finiteTree(enemy);
    monotonic &&=
      enemy.threatScore > previousThreat &&
      enemy.powerMultiplier > previousPower &&
      enemy.abilityMultiplier > previousAbility;
    if (previousStats !== null) {
      monotonic &&= TOP_STAT_KEYS.every(
        (key) => enemy.resolved.stats[key] > previousStats![key]!
      );
    }
    previousThreat = enemy.threatScore;
    previousPower = enemy.powerMultiplier;
    previousAbility = enemy.abilityMultiplier;
    previousStats = { ...enemy.resolved.stats };
    lineages.add(enemy.lineage);
    roles.add(enemy.role);
    if (enemy.isBoss) {
      bosses += 1;
      bossAffixes.add(enemy.bossAffix!);
    }
    if (enemy.sourceKind === "normal") normalEnemies += 1;
    else rogueEnemies += 1;

    run = completeEndlessWave(run);
    offersLegal &&= run.rewardOffers.every(isLegalRewardOffer);
    run = autoChooseEndlessRewards(run);
  }
  const finalResolved = run.players.map((player) =>
    resolveRogueBuild(player.build)
  );
  const expectedParts = TOP_SLOTS.length + 100;
  check(
    "[E15] 100waveの全敵・全player値が有限",
    enemiesFinite &&
      finalResolved.every(finiteTree) &&
      finalResolved.every(
        (resolved) =>
          TOP_STAT_KEYS.every((key) => Number.isFinite(resolved.stats[key])) &&
          TOP_PHYSICS_KEYS.every((key) =>
            Number.isFinite(resolved.physics[key])
          )
      ),
    `wave=${run.wave}, threat=${previousThreat}, parts/player=${expectedParts}`
  );
  check(
    "[E16] 敵はwaveごとに単調強化",
    monotonic,
    `power=${previousPower}, ability=${previousAbility}, threat=${previousThreat}`
  );
  check(
    "[E17] 敵系統・役割・boss周期が変化",
    lineages.size === 9 &&
      roles.size === 4 &&
      bosses === 20 &&
      bossAffixes.size >= 5,
    `lineages=${lineages.size}, roles=${roles.size}, bosses=${bosses}, affixes=${bossAffixes.size}`
  );
  check(
    "[E18] 通常敵と多重装備Rogue敵を共通契約で返す",
    normalEnemies > 0 &&
      rogueEnemies > 0 &&
      generateEndlessEnemy(run.seed, 1).visualBuild.v === 1 &&
      generateEndlessEnemy(run.seed, 100).resolved.parts.length === 7,
    `normal=${normalEnemies}, rogue=${rogueEnemies}`
  );
  check(
    "[E19] 100wave全offerが合法",
    offersLegal &&
      run.players.every(
        (player) =>
          validateRogueBuild(player.build).totalParts === expectedParts
      ),
    `${100 * run.players.length} offers applied`
  );
  check(
    "[E20] 100wave生成とrun replayはseed再現",
    deterministic &&
      sameJson(
        createRogueRewardOffer(run.seed, 100, "p1"),
        createRogueRewardOffer(run.seed, 100, "p1")
      ),
    `serialized run=${serializeEndlessRun(run).length} bytes`
  );
}

const base = normalCompatibilityGate();
multiStackGate(base);
rewardAndRunGate(base);
hundredWaveGate(base);
const generationBench = longWaveGenerationGate();

console.log(
  JSON.stringify(
    {
      gate: "vortex-endless",
      failures,
      checkedWaves: 100,
      catalogOnly: true,
      duplicateIdsAllowed: true,
      colliderCount: 7,
      generationBench: {
        wave100Ms: Number(generationBench.wave100Ms.toFixed(2)),
        wave5000Ms: Number(generationBench.wave5000Ms.toFixed(2)),
        wave100Stacks: generationBench.wave100Stacks,
        wave5000Stacks: generationBench.wave5000Stacks
      }
    },
    null,
    2
  )
);

if (failures.length > 0) {
  process.exitCode = 1;
}
