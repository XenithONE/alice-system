/**
 * The drivers: pure data, eight of them.
 *
 * Eight because the grid is eight (MAX_RACERS), so a seat can be handed a
 * driver by index with no modulo bias and no repeats in a full field.
 *
 * A character is how a car is driven and how its luck runs — how fast a drift
 * charges, how hard a boost bites, how the roulette leans — plus one skill.
 * The car itself is the machine's business. The two coefficient sets are
 * separate types for exactly that reason (see tuning.ts).
 *
 * The reference driver carries no coefficients at all, so a race with the
 * default kit is bit-identical to a race from before any of this existed.
 */

import type { CharacterPhysicsKey, DisplayStats } from "./tuning";
import type { UnlockRule } from "./machines";

/** Helmet silhouette. The driver is 40 px tall; the shape is what reads. */
export type DriverShape = "visor-high" | "visor-low" | "crest" | "open-face";

export interface CharacterDef {
  readonly id: string;
  readonly name: string;
  readonly nameJa: string;
  readonly blurbJa: string;
  readonly shape: DriverShape;
  /** Garage accent; the race livery is chosen separately. */
  readonly signal: number;
  readonly display: DisplayStats;
  readonly physics: Partial<Record<CharacterPhysicsKey, number>>;
  readonly skillId: string;
  readonly unlock: UnlockRule;
}

export const REFERENCE_CHARACTER_ID = "vera";

export const CHARACTERS: readonly CharacterDef[] = [
  {
    id: "vera",
    name: "VERA",
    nameJa: "ヴェラ",
    blurbJa: "基準となる走り。癖がないぶん、腕がそのまま出る。",
    shape: "visor-high",
    signal: 0xe23b3b,
    display: { speed: 3, accel: 3, handling: 3, weight: 3, luck: 3 },
    physics: {},
    skillId: "nitro-pulse",
    unlock: { kind: "free" },
  },
  {
    id: "koto",
    name: "KOTO",
    nameJa: "コト",
    blurbJa: "ドリフトの溜めが速い。コーナーで稼ぐ人向け。",
    shape: "visor-low",
    signal: 0x2f7fe0,
    display: { speed: 3, accel: 3, handling: 4, weight: 3, luck: 2 },
    physics: { driftChargeScale: 1.14, itemLuck: 0.94 },
    skillId: "hard-brake",
    unlock: { kind: "free" },
  },
  {
    id: "rafe",
    name: "RAFE",
    nameJa: "レイフ",
    blurbJa: "ブーストの立ち上がりが鋭い。持ち物を使い切るタイプ。",
    shape: "crest",
    signal: 0x54c23a,
    display: { speed: 3, accel: 4, handling: 3, weight: 3, luck: 3 },
    physics: { boostAccelScale: 1.12 },
    skillId: "nitro-pulse",
    unlock: { kind: "free" },
  },
  {
    id: "juno",
    name: "JUNO",
    nameJa: "ジュノ",
    blurbJa: "運が良い。後ろからでも良いものを引く。",
    shape: "open-face",
    signal: 0xf0a220,
    display: { speed: 3, accel: 3, handling: 3, weight: 3, luck: 5 },
    physics: { itemLuck: 1.18, driftChargeScale: 0.96 },
    skillId: "item-magnet",
    unlock: { kind: "achievement", id: "turbo_100" },
  },
  {
    id: "sable",
    name: "SABLE",
    nameJa: "セイブル",
    blurbJa: "打たれ強い。被弾からの立ち直りを持っている。",
    shape: "visor-high",
    signal: 0x9350e0,
    display: { speed: 3, accel: 3, handling: 3, weight: 4, luck: 3 },
    physics: { boostAccelScale: 1.05 },
    skillId: "second-wind",
    unlock: { kind: "free" },
  },
  {
    id: "pike",
    name: "PIKE",
    nameJa: "パイク",
    blurbJa: "空中が得意。ランプとクレストを稼ぎ場に変える。",
    shape: "crest",
    signal: 0x1fb8b0,
    display: { speed: 3, accel: 3, handling: 4, weight: 2, luck: 3 },
    physics: { driftChargeScale: 1.06 },
    skillId: "gyro-lock",
    unlock: { kind: "free" },
  },
  {
    id: "mireille",
    name: "MIREILLE",
    nameJa: "ミレイユ",
    blurbJa: "隠れるのが上手い。一瞬だけ手が出せなくなる。",
    shape: "visor-low",
    signal: 0xec5aa6,
    display: { speed: 3, accel: 3, handling: 3, weight: 3, luck: 4 },
    physics: { itemLuck: 1.08 },
    skillId: "phase-veil",
    unlock: { kind: "free" },
  },
  {
    id: "orson",
    name: "ORSON",
    nameJa: "オーソン",
    blurbJa: "後方から風を呼ぶ。集団の中でこそ速い。",
    shape: "open-face",
    signal: 0xb9c3cc,
    display: { speed: 4, accel: 3, handling: 2, weight: 3, luck: 3 },
    physics: { boostAccelScale: 1.08, driftChargeScale: 0.97 },
    skillId: "slip-call",
    unlock: { kind: "free" },
  },
];

const BY_ID = new Map(CHARACTERS.map((character) => [character.id, character]));

export function characterById(id: string | null | undefined): CharacterDef {
  return (id ? BY_ID.get(id) : undefined) ?? BY_ID.get(REFERENCE_CHARACTER_ID)!;
}
