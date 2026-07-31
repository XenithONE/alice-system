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

const FRONT: WeightTable = {
  mushroom: 10,
  triple: 4,
  banana: 30,
  green: 30,
  red: 8,
  bomb: 14,
  star: 0,
  bolt: 0,
};

const MIDDLE: WeightTable = {
  mushroom: 20,
  triple: 12,
  banana: 12,
  green: 16,
  red: 22,
  bomb: 12,
  star: 5,
  bolt: 1,
};

const BACK: WeightTable = {
  mushroom: 16,
  triple: 22,
  banana: 4,
  green: 6,
  red: 18,
  bomb: 6,
  star: 18,
  bolt: 10,
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
  return kind === "banana" || kind === "green";
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
};
