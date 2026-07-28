import type {
  PartId,
  RogueBuildSpec,
  TopBuildSpec
} from "../types";
import {
  rogueBuildFromTopBuild,
  validateRogueBuild
} from "./rogueBuild";
import {
  createRogueRewardOffer,
  isLegalRewardOffer,
  selectRogueReward
} from "./rewards";
import { canonicalEndlessSeed } from "./seed";
import type {
  EndlessPlayerInit,
  EndlessPlayerState,
  EndlessRunState,
  EndlessSeed,
  RogueRewardOffer
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRogueBuild(build: TopBuildSpec | RogueBuildSpec): build is RogueBuildSpec {
  return Array.isArray(build.parts.crest);
}

function normalizePlayer(
  player: EndlessPlayerInit
): EndlessPlayerState {
  if (
    player.id.trim().length < 1 ||
    player.id.length > 64 ||
    player.name.trim().length < 1 ||
    player.name.length > 64
  ) {
    throw new TypeError("player id/name must contain 1–64 characters.");
  }
  const build = isRogueBuild(player.build)
    ? player.build
    : rogueBuildFromTopBuild(player.build);
  const verdict = validateRogueBuild(build);
  if (!verdict.ok) {
    throw new TypeError(verdict.errors.map((issue) => issue.message).join(" / "));
  }
  return { id: player.id, name: player.name, build };
}

export function createEndlessRun(
  seed: EndlessSeed,
  players: readonly EndlessPlayerInit[]
): EndlessRunState {
  if (players.length < 2 || players.length > 4) {
    throw new RangeError("Endless co-op requires 2–4 players.");
  }
  const normalized = players.map(normalizePlayer);
  if (new Set(normalized.map((player) => player.id)).size !== normalized.length) {
    throw new TypeError("Endless co-op player IDs must be unique.");
  }
  return {
    v: 1,
    seed: canonicalEndlessSeed(seed),
    wave: 1,
    clearedWaves: 0,
    phase: "battle",
    players: normalized,
    rewardOffers: []
  };
}

/**
 * Moves the current battle into the per-player reward phase. Offer generation
 * is keyed by run seed, cleared wave and player ID, so host/replay call order
 * cannot change the three choices.
 */
export function completeEndlessWave(
  state: EndlessRunState
): EndlessRunState {
  assertEndlessRun(state);
  if (state.phase !== "battle") {
    throw new Error("Reward selection must finish before another wave clears.");
  }
  return {
    ...state,
    clearedWaves: state.wave,
    phase: "reward",
    rewardOffers: state.players.map((player) =>
      createRogueRewardOffer(state.seed, state.wave, player.id)
    )
  };
}

/**
 * Applies one player's selected reward immutably. The last selection
 * atomically opens the next battle wave.
 */
export function chooseEndlessReward(
  state: EndlessRunState,
  playerId: string,
  partId: PartId
): EndlessRunState {
  assertEndlessRun(state);
  if (state.phase !== "reward") {
    throw new Error("Rewards can only be selected during the reward phase.");
  }
  const playerIndex = state.players.findIndex(
    (player) => player.id === playerId
  );
  const offerIndex = state.rewardOffers.findIndex(
    (offer) => offer.playerId === playerId
  );
  if (playerIndex < 0 || offerIndex < 0) {
    throw new RangeError(`Unknown endless player: ${playerId}`);
  }
  const result = selectRogueReward(
    state.players[playerIndex]!.build,
    state.rewardOffers[offerIndex]!,
    partId
  );
  const players = state.players.map((player, index) =>
    index === playerIndex ? { ...player, build: result.build } : player
  );
  const rewardOffers = state.rewardOffers.map((offer, index) =>
    index === offerIndex ? result.offer : offer
  );
  const allSelected = rewardOffers.every(
    (offer) => offer.selectedPartId !== null
  );
  return allSelected
    ? {
        ...state,
        wave: state.wave + 1,
        phase: "battle",
        players,
        rewardOffers: []
      }
    : { ...state, players, rewardOffers };
}

export function autoChooseEndlessRewards(
  state: EndlessRunState
): EndlessRunState {
  let next = state;
  if (next.phase !== "reward") {
    throw new Error("Auto reward selection requires reward phase.");
  }
  for (const offer of state.rewardOffers) {
    if (offer.selectedPartId !== null) continue;
    next = chooseEndlessReward(
      next,
      offer.playerId,
      offer.choices[0].partId
    );
  }
  return next;
}

function validateSerializedOffer(
  offer: unknown,
  wave: number
): offer is RogueRewardOffer {
  return (
    isRecord(offer) &&
    offer.wave === wave &&
    isLegalRewardOffer(offer)
  );
}

export function assertEndlessRun(
  value: unknown
): asserts value is EndlessRunState {
  if (!isRecord(value) || value.v !== 1) {
    throw new TypeError("Invalid endless run version.");
  }
  if (
    !Number.isSafeInteger(value.seed) ||
    (value.seed as number) < 0 ||
    (value.seed as number) > 0xffffffff ||
    !Number.isSafeInteger(value.wave) ||
    (value.wave as number) < 1 ||
    !Number.isSafeInteger(value.clearedWaves) ||
    (value.clearedWaves as number) < 0 ||
    (value.phase !== "battle" && value.phase !== "reward")
  ) {
    throw new TypeError("Invalid endless run counters.");
  }
  if (
    !Array.isArray(value.players) ||
    value.players.length < 2 ||
    value.players.length > 4
  ) {
    throw new TypeError("Endless run must contain 2–4 players.");
  }
  const ids = new Set<string>();
  for (const candidate of value.players) {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== "string" ||
      candidate.id.length < 1 ||
      candidate.id.length > 64 ||
      typeof candidate.name !== "string" ||
      candidate.name.length < 1 ||
      candidate.name.length > 64
    ) {
      throw new TypeError("Invalid endless player.");
    }
    if (ids.has(candidate.id)) {
      throw new TypeError("Duplicate endless player ID.");
    }
    ids.add(candidate.id);
    const verdict = validateRogueBuild(candidate.build);
    if (!verdict.ok) {
      throw new TypeError(
        verdict.errors.map((issue) => issue.message).join(" / ")
      );
    }
  }
  if (!Array.isArray(value.rewardOffers)) {
    throw new TypeError("Invalid endless reward list.");
  }
  const wave = value.wave as number;
  const clearedWaves = value.clearedWaves as number;
  if (
    (value.phase === "battle" && wave !== clearedWaves + 1) ||
    (value.phase === "reward" && wave !== clearedWaves)
  ) {
    throw new TypeError("Endless run phase/counters are inconsistent.");
  }
  if (value.phase === "battle" && value.rewardOffers.length !== 0) {
    throw new TypeError("Battle phase cannot retain reward offers.");
  }
  if (value.phase === "reward") {
    if (value.rewardOffers.length !== value.players.length) {
      throw new TypeError("Every player needs one reward offer.");
    }
    const offeredPlayerIds = new Set<string>();
    const offerIds = new Set<string>();
    let selectedOffers = 0;
    for (const offer of value.rewardOffers) {
      if (!validateSerializedOffer(offer, wave)) {
        throw new TypeError("Invalid serialized reward offer.");
      }
      if (!ids.has(offer.playerId)) {
        throw new TypeError("Reward offer references an unknown player.");
      }
      if (offeredPlayerIds.has(offer.playerId)) {
        throw new TypeError("Duplicate reward offer player ID.");
      }
      if (offerIds.has(offer.id)) {
        throw new TypeError("Duplicate reward offer ID.");
      }
      offeredPlayerIds.add(offer.playerId);
      offerIds.add(offer.id);
      if (offer.selectedPartId !== null) selectedOffers += 1;
    }
    if (offeredPlayerIds.size !== ids.size) {
      throw new TypeError("Every player needs one unique reward offer.");
    }
    // The final choice atomically advances to the next battle; an all-selected
    // reward phase is therefore impossible and would otherwise be a soft-lock.
    if (selectedOffers === value.rewardOffers.length) {
      throw new TypeError("Completed reward phase must advance to battle.");
    }
  }
}

export function serializeEndlessRun(state: EndlessRunState): string {
  assertEndlessRun(state);
  return JSON.stringify(state);
}

export function deserializeEndlessRun(serialized: string): EndlessRunState {
  const parsed: unknown = JSON.parse(serialized);
  assertEndlessRun(parsed);
  return parsed;
}
