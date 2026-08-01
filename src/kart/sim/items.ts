/**
 * The item roulette.
 *
 * Weights are a function of where the racer is running, blended between three
 * anchor tables. The leader can only ever defend; last place gets the tools to
 * come back. The blend is continuous so a mid-pack racer does not flip between
 * two personalities as one position changes.
 */

import type { ItemKind } from "./types";
import { ITEM_KINDS } from "./types";

type WeightTable = Readonly<Record<ItemKind, number>>;

/*
 * The four native items sit deliberately: `turbine` and `mine` reward the
 * driver already in front (one converts a drift you had to earn, the other is
 * a defensive drop), while `slipcall` belongs to the pack — it is only worth
 * anything with a car ahead — and `emp` to the chasers, as a bolt that reaches
 * a few lengths rather than the whole field.
 */
const FRONT: WeightTable = {
  mushroom: 10,
  triple: 4,
  banana: 26,
  green: 26,
  red: 8,
  bomb: 12,
  star: 0,
  bolt: 0,
  turbine: 14,
  slipcall: 0,
  mine: 16,
  emp: 0,
};

const MIDDLE: WeightTable = {
  mushroom: 18,
  triple: 12,
  banana: 10,
  green: 14,
  red: 20,
  bomb: 10,
  star: 5,
  bolt: 1,
  turbine: 10,
  slipcall: 14,
  mine: 8,
  emp: 10,
};

const BACK: WeightTable = {
  mushroom: 16,
  triple: 20,
  banana: 4,
  green: 6,
  red: 16,
  bomb: 6,
  star: 16,
  bolt: 9,
  turbine: 4,
  slipcall: 10,
  mine: 2,
  emp: 12,
};

function blend(a: WeightTable, b: WeightTable, t: number): WeightTable {
  const out = {} as Record<ItemKind, number>;
  for (const kind of ITEM_KINDS) out[kind] = a[kind] + (b[kind] - a[kind]) * t;
  return out;
}

/**
 * @param place 1-based finishing position right now.
 * @param count number of racers on track.
 */
export function itemWeights(place: number, count: number): WeightTable {
  const span = Math.max(1, count - 1);
  const p = Math.max(0, Math.min(1, (place - 1) / span));
  return p <= 0.5
    ? blend(FRONT, MIDDLE, p / 0.5)
    : blend(MIDDLE, BACK, (p - 0.5) / 0.5);
}

export function rollItem(
  random: () => number,
  place: number,
  count: number,
): ItemKind {
  const weights = itemWeights(place, count);
  let total = 0;
  for (const kind of ITEM_KINDS) total += weights[kind];
  if (total <= 0) return "mushroom";
  let roll = random() * total;
  for (const kind of ITEM_KINDS) {
    roll -= weights[kind];
    if (roll <= 0) return kind;
  }
  return "mushroom";
}

/** Stack size an item is granted with. */
export function itemCharges(kind: ItemKind): number {
  return kind === "triple" ? 3 : 1;
}

/** A held item that keeps protecting you while it is out (dragged banana). */
export function isDefensive(kind: ItemKind): boolean {
  return kind === "banana" || kind === "green" || kind === "mine";
}

export const ITEM_LABEL: Readonly<Record<ItemKind, string>> = {
  mushroom: "BOOST",
  triple: "TRIPLE",
  banana: "BANANA",
  green: "GREEN",
  red: "RED",
  bomb: "BOMB",
  star: "STAR",
  bolt: "BOLT",
  turbine: "TURBINE",
  slipcall: "SLIPCALL",
  mine: "MINE",
  emp: "EMP",
};

export const ITEM_LABEL_JA: Readonly<Record<ItemKind, string>> = {
  mushroom: "ダッシュ",
  triple: "3連ダッシュ",
  banana: "バナナ",
  green: "みどり甲羅",
  red: "あか甲羅",
  bomb: "ボム",
  star: "スター",
  bolt: "サンダー",
  turbine: "タービン",
  slipcall: "ドラフトコール",
  mine: "スパイクマイン",
  emp: "EMP",
};
