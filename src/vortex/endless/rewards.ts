import {
  PARTS,
  getPart,
  getPartsForSlot
} from "../content/catalog";
import { mulberry32 } from "../sim/rng";
import {
  TOP_SLOTS,
  type PartGrade,
  type PartId,
  type RogueBuildSpec,
  type TopPartDef,
  type TopSlot
} from "../types";
import { appendRoguePart, validateRogueBuild } from "./rogueBuild";
import {
  deterministicId,
  mixEndlessSeed
} from "./seed";
import type {
  EndlessSeed,
  RogueRewardChoice,
  RogueRewardChoices,
  RogueRewardOffer
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertWave(wave: number): void {
  if (!Number.isSafeInteger(wave) || wave < 1) {
    throw new RangeError("wave must be a positive safe integer.");
  }
}

function unlockedGrade(wave: number, roll: number): PartGrade {
  const signatureChance = Math.min(0.16, 0.012 + wave * 0.0015);
  if (roll < signatureChance) return "signature";
  const grade3Chance = Math.min(0.48, 0.08 + wave * 0.007);
  if (roll < signatureChance + grade3Chance) return 3;
  const grade2Chance = Math.min(0.62, 0.3 + wave * 0.004);
  return roll < signatureChance + grade3Chance + grade2Chance ? 2 : 1;
}

function pickPart(
  slot: TopSlot,
  grade: PartGrade,
  randomIndex: number
): TopPartDef {
  const sameGrade = getPartsForSlot(slot).filter(
    (part) => part.grade === grade
  );
  const pool = sameGrade.length > 0 ? sameGrade : getPartsForSlot(slot);
  return pool[randomIndex % pool.length]!;
}

function rewardChoice(part: TopPartDef): RogueRewardChoice {
  return {
    partId: part.id,
    slot: part.slot,
    grade: part.grade,
    kind: part.kind,
    lineage: part.lineage,
    role: part.role
  };
}

/**
 * Produces exactly three unique, catalog-backed options. Acquired IDs are not
 * excluded: duplicate stacks are an intentional endless-mode mechanic.
 */
export function createRogueRewardOffer(
  seed: EndlessSeed,
  wave: number,
  playerId: string
): RogueRewardOffer {
  assertWave(wave);
  if (playerId.trim().length < 1) {
    throw new TypeError("playerId must not be empty.");
  }
  const mixedSeed = mixEndlessSeed(seed, "reward", wave, playerId);
  const rng = mulberry32(mixedSeed);
  const selected = new Map<PartId, RogueRewardChoice>();
  let attempts = 0;
  while (selected.size < 3 && attempts < 64) {
    const slot = TOP_SLOTS[rng.int(TOP_SLOTS.length)]!;
    const grade = unlockedGrade(wave, rng());
    const part = pickPart(slot, grade, rng.int(1_000_000));
    selected.set(part.id, rewardChoice(part));
    attempts += 1;
  }
  if (selected.size < 3) {
    const start = mixedSeed % PARTS.length;
    for (let offset = 0; selected.size < 3; offset += 1) {
      const part = PARTS[(start + offset) % PARTS.length]!;
      selected.set(part.id, rewardChoice(part));
    }
  }
  const choices = [...selected.values()] as [
    RogueRewardChoice,
    RogueRewardChoice,
    RogueRewardChoice
  ];
  return {
    v: 1,
    id: deterministicId("rw", mixedSeed),
    wave,
    playerId,
    choices,
    selectedPartId: null
  };
}

/**
 * Deeply validates both generated and deserialised reward offers.
 *
 * `selectedPartId` is part of the save/network contract rather than harmless
 * presentation state: accepting an arbitrary non-null value would make the
 * player appear locked while no offered part had actually been installed.
 */
export function isLegalRewardOffer(
  value: unknown
): value is RogueRewardOffer {
  if (!isRecord(value)) return false;
  const choices = value.choices;
  if (
    value.v !== 1 ||
    typeof value.id !== "string" ||
    value.id.length < 1 ||
    value.id.length > 64 ||
    !Number.isSafeInteger(value.wave) ||
    (value.wave as number) < 1 ||
    typeof value.playerId !== "string" ||
    value.playerId.trim().length < 1 ||
    value.playerId.length > 64 ||
    !Array.isArray(choices) ||
    choices.length !== 3
  ) {
    return false;
  }
  if (
    !choices.every(isRecord) ||
    new Set(choices.map((choice) => choice.partId)).size !== 3
  ) {
    return false;
  }
  const legalChoices = choices.every((choice) => {
    if (
      typeof choice.partId !== "string" ||
      typeof choice.slot !== "string" ||
      typeof choice.kind !== "string" ||
      typeof choice.lineage !== "string" ||
      typeof choice.role !== "string"
    ) {
      return false;
    }
    const part = getPart(choice.partId);
    return (
      part !== undefined &&
      part.slot === choice.slot &&
      part.grade === choice.grade &&
      part.kind === choice.kind &&
      part.lineage === choice.lineage &&
      part.role === choice.role
    );
  });
  if (!legalChoices) return false;
  return (
    value.selectedPartId === null ||
    (typeof value.selectedPartId === "string" &&
      choices.some((choice) => choice.partId === value.selectedPartId))
  );
}

export function selectRogueReward(
  build: RogueBuildSpec,
  offer: RogueRewardOffer,
  partId: PartId
): { readonly build: RogueBuildSpec; readonly offer: RogueRewardOffer } {
  const verdict = validateRogueBuild(build);
  if (!verdict.ok) {
    throw new TypeError(verdict.errors.map((issue) => issue.message).join(" / "));
  }
  if (!isLegalRewardOffer(offer)) {
    throw new TypeError("報酬オファーが不正です。");
  }
  if (offer.selectedPartId !== null) {
    throw new Error("この報酬オファーは選択済みです。");
  }
  if (!offer.choices.some((choice) => choice.partId === partId)) {
    throw new RangeError("選択したパーツは3候補に含まれていません。");
  }
  return {
    build: appendRoguePart(build, partId),
    offer: { ...offer, selectedPartId: partId }
  };
}

export function rewardPartIds(
  choices: RogueRewardChoices
): readonly [PartId, PartId, PartId] {
  return [
    choices[0].partId,
    choices[1].partId,
    choices[2].partId
  ];
}
