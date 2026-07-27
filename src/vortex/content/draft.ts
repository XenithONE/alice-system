import {
  TOP_SLOTS,
  type BuildCostLimit,
  type DraftCreateOptions,
  type DraftPlayer,
  type DraftState,
  type PartId,
  type TopBuildSpec,
  type TopPartDef,
  type VortexPlayerCount
} from "../types";
import { getPart, getPartsForSlot } from "./catalog";
import { minimumPartCost, validateBuild } from "./build";

export const DRAFT_TURN_MS = 12_000 as const;

function hashSeed(value: number | string): number {
  const text = String(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0 || 0x6d2b79f5;
}

function nextRandom(state: number): number {
  let value = state >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

function shuffleSeats(count: number, seed: number): readonly number[] {
  const result = Array.from({ length: count }, (_, index) => index);
  let rng = seed;
  for (let index = result.length - 1; index > 0; index -= 1) {
    rng = nextRandom(rng);
    const target = rng % (index + 1);
    [result[index], result[target]] = [result[target]!, result[index]!];
  }
  return Object.freeze(result);
}

function defaultPlayers(count: VortexPlayerCount): readonly DraftPlayer[] {
  return Object.freeze(
    Array.from({ length: count }, (_, index) =>
      Object.freeze({
        id: `seat-${index + 1}`,
        name: index === 0 ? "PLAYER 1" : `CPU ${index}`,
        isCpu: index > 0
      })
    )
  );
}

function normalizePlayers(players: readonly DraftPlayer[] | VortexPlayerCount): readonly DraftPlayer[] {
  const source = typeof players === "number" ? defaultPlayers(players) : players;
  if (source.length < 2 || source.length > 4) {
    throw new RangeError("ドラフト参加者は2〜4人で指定してください。");
  }
  const ids = new Set<string>();
  const normalized = source.map((player, index) => {
    if (
      typeof player.id !== "string" ||
      player.id.length < 1 ||
      player.id.length > 64 ||
      ids.has(player.id)
    ) {
      throw new TypeError(`ドラフト参加者${index + 1}のIDが不正または重複しています。`);
    }
    ids.add(player.id);
    return Object.freeze({
      id: player.id,
      name: player.name.trim().slice(0, 64) || `PLAYER ${index + 1}`,
      isCpu: Boolean(player.isCpu)
    });
  });
  return Object.freeze(normalized);
}

export function createDraftState(options: DraftCreateOptions): DraftState;
export function createDraftState(
  players: VortexPlayerCount,
  costLimit?: BuildCostLimit,
  seed?: number | string,
  nowMs?: number
): DraftState;
export function createDraftState(
  optionsOrPlayers: DraftCreateOptions | VortexPlayerCount,
  positionalCostLimit: BuildCostLimit = 1000,
  positionalSeed: number | string = 1,
  positionalNowMs = 0
): DraftState {
  const options: DraftCreateOptions =
    typeof optionsOrPlayers === "number"
      ? {
          players: optionsOrPlayers,
          costLimit: positionalCostLimit,
          seed: positionalSeed,
          nowMs: positionalNowMs
        }
      : optionsOrPlayers;
  const players = normalizePlayers(options.players);
  const seed = hashSeed(options.seed ?? 1);
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs! : 0;
  const costLimit = options.costLimit ?? 1000;
  if (!(costLimit === Number.POSITIVE_INFINITY || (Number.isFinite(costLimit) && costLimit > 0))) {
    throw new RangeError("ドラフトのコスト上限が不正です。");
  }
  return Object.freeze({
    v: 1,
    seed,
    players,
    baseOrder: shuffleSeats(players.length, seed),
    slotIndex: 0,
    pickIndex: 0,
    picks: Object.freeze(players.map(() => Object.freeze({}))),
    claimedPartIds: Object.freeze([]),
    costLimit,
    turnDurationMs: DRAFT_TURN_MS,
    deadlineMs: nowMs + DRAFT_TURN_MS,
    completed: false
  });
}

export function currentDraftOrder(state: DraftState): readonly number[] {
  return state.slotIndex % 2 === 0
    ? state.baseOrder
    : Object.freeze([...state.baseOrder].reverse());
}

export function currentDraftPlayerIndex(state: DraftState): number | null {
  if (state.completed || state.slotIndex >= TOP_SLOTS.length) return null;
  return currentDraftOrder(state)[state.pickIndex] ?? null;
}

export function currentDraftSlot(state: DraftState): (typeof TOP_SLOTS)[number] | null {
  return state.completed ? null : (TOP_SLOTS[state.slotIndex] ?? null);
}

export function draftPlayerCost(state: DraftState, playerIndex: number): number {
  const picks = state.picks[playerIndex];
  if (picks === undefined) return Number.POSITIVE_INFINITY;
  return TOP_SLOTS.reduce((total, slot) => {
    const id = picks[slot];
    return total + (id === undefined ? 0 : (getPart(id)?.cost ?? 0));
  }, 0);
}

function reservedFutureCost(state: DraftState): number {
  return TOP_SLOTS.slice(state.slotIndex + 1).reduce(
    (total, slot) => total + minimumPartCost(slot),
    0
  );
}

export function legalDraftPicks(state: DraftState): readonly TopPartDef[] {
  const slot = currentDraftSlot(state);
  const playerIndex = currentDraftPlayerIndex(state);
  if (slot === null || playerIndex === null) return [];
  const claimed = new Set(state.claimedPartIds);
  const alreadySpent = draftPlayerCost(state, playerIndex);
  const reserve = reservedFutureCost(state);
  return getPartsForSlot(slot).filter(
    (part) =>
      !claimed.has(part.id) &&
      (state.costLimit === Number.POSITIVE_INFINITY ||
        alreadySpent + part.cost + reserve <= state.costLimit)
  );
}

function advanceTurn(state: DraftState, nowMs: number): Pick<DraftState, "slotIndex" | "pickIndex" | "deadlineMs" | "completed"> {
  const nextPick = state.pickIndex + 1;
  if (nextPick < state.players.length) {
    return {
      slotIndex: state.slotIndex,
      pickIndex: nextPick,
      deadlineMs: nowMs + DRAFT_TURN_MS,
      completed: false
    };
  }
  const nextSlot = state.slotIndex + 1;
  return {
    slotIndex: nextSlot,
    pickIndex: 0,
    deadlineMs: nowMs + DRAFT_TURN_MS,
    completed: nextSlot >= TOP_SLOTS.length
  };
}

export function applyDraftPick(
  state: DraftState,
  partId: PartId,
  nowMs = state.deadlineMs - DRAFT_TURN_MS
): DraftState {
  if (state.completed) throw new RangeError("完了済みのドラフトへ追加選択はできません。");
  const playerIndex = currentDraftPlayerIndex(state);
  const slot = currentDraftSlot(state);
  if (playerIndex === null || slot === null) throw new RangeError("現在のドラフト手番がありません。");
  const legal = legalDraftPicks(state);
  const part = legal.find((candidate) => candidate.id === partId);
  if (part === undefined) {
    throw new RangeError(`パーツ「${partId}」は現在の手番では選択できません。`);
  }
  const nextPicks = state.picks.map((picks, index) =>
    index === playerIndex ? Object.freeze({ ...picks, [slot]: part.id }) : picks
  );
  const nextTurn = advanceTurn(state, Number.isFinite(nowMs) ? nowMs : 0);
  return Object.freeze({
    ...state,
    ...nextTurn,
    picks: Object.freeze(nextPicks),
    claimedPartIds: Object.freeze([...state.claimedPartIds, part.id])
  });
}

function autoScore(state: DraftState, part: TopPartDef): number {
  const statScore =
    part.stats.attack * 1.05 +
    part.stats.defense +
    part.stats.stamina * 0.9 +
    part.stats.stability +
    part.stats.mobility * 0.85 +
    part.stats.durability * 0.6;
  const efficiency = statScore / Math.max(1, part.cost);
  const noise = (hashSeed(`${state.seed}:${state.slotIndex}:${state.pickIndex}:${part.id}`) % 10_000) / 1_000_000;
  return efficiency + noise;
}

export function autoDraftPick(
  state: DraftState,
  nowMs = state.deadlineMs
): DraftState {
  const legal = legalDraftPicks(state);
  if (legal.length === 0) {
    throw new RangeError("予算を守って選択できるドラフトパーツがありません。");
  }
  const chosen = [...legal].sort((a, b) => {
    const scoreDelta = autoScore(state, b) - autoScore(state, a);
    return Math.abs(scoreDelta) > Number.EPSILON ? scoreDelta : a.id.localeCompare(b.id);
  })[0]!;
  return applyDraftPick(state, chosen.id, nowMs);
}

export function isDraftTurnExpired(state: DraftState, nowMs: number): boolean {
  return !state.completed && nowMs >= state.deadlineMs;
}

/**
 * Resolves consecutive CPU and expired turns. The loop is bounded by the 28
 * maximum selections (4 players × 7 slots).
 */
export function advanceAutomaticDraftTurns(state: DraftState, nowMs: number): DraftState {
  let next = state;
  for (let guard = 0; guard < 28 && !next.completed; guard += 1) {
    const playerIndex = currentDraftPlayerIndex(next);
    if (playerIndex === null) break;
    if (!next.players[playerIndex]!.isCpu && !isDraftTurnExpired(next, nowMs)) break;
    next = autoDraftPick(next, nowMs);
  }
  return next;
}

export function withDraftPlayerCpu(state: DraftState, playerIndex: number): DraftState {
  if (state.players[playerIndex] === undefined) throw new RangeError("参加者番号が範囲外です。");
  return Object.freeze({
    ...state,
    players: Object.freeze(
      state.players.map((player, index) =>
        index === playerIndex ? Object.freeze({ ...player, isCpu: true }) : player
      )
    )
  });
}

export function draftBuildForPlayer(
  state: DraftState,
  playerIndex: number,
  name = state.players[playerIndex]?.name ?? "DRAFT TOP",
  paint = 0x48d9ff
): TopBuildSpec {
  if (!state.completed) throw new RangeError("ドラフト完了前に機体を確定できません。");
  const picks = state.picks[playerIndex];
  if (picks === undefined || !TOP_SLOTS.every((slot) => picks[slot] !== undefined)) {
    throw new RangeError("参加者の7部位がそろっていません。");
  }
  const build: TopBuildSpec = {
    v: 1,
    name: name.trim().slice(0, 64) || "DRAFT TOP",
    paint,
    parts: Object.fromEntries(TOP_SLOTS.map((slot) => [slot, picks[slot]!])) as TopBuildSpec["parts"]
  };
  const verdict = validateBuild(build, state.costLimit);
  if (!verdict.ok) {
    throw new TypeError(verdict.errors.map((issue) => issue.message).join(" / "));
  }
  return build;
}
