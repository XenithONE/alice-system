/**
 * The machines: pure data, six of them.
 *
 * A machine is the car — top speed, cornering, acceleration, how it copes off
 * the road, and how it fares in a shove. It is deliberately NOT how the car is
 * driven; that belongs to the character.
 *
 * Six because a garage tab is not worth opening for fewer, and because each
 * one costs a body and a spoiler in the shared geometry cache (see
 * kartModel.ts) — the wheels, helmet, torso and shadow stay singletons.
 *
 * Every coefficient is a multiplier around 1, and the reference machine has
 * none at all. `x * 1 === x` for every finite x, so the reference kit leaves
 * the existing headless gates bit-identical: that is the migration's safety
 * net, and [C3] checks it rather than trusting it.
 */

import type { DisplayStats, MachinePhysicsKey } from "./tuning";

/** Which shared body/spoiler pair the renderer builds for this machine. */
export type MachineShape = "standard" | "heavy" | "light" | "buggy";

export type UnlockRule =
  | { readonly kind: "free" }
  | { readonly kind: "achievement"; readonly id: string };

export interface MachineDef {
  readonly id: string;
  readonly name: string;
  readonly nameJa: string;
  readonly blurbJa: string;
  readonly shape: MachineShape;
  /** Garage accent, distinct from the sixteen race liveries. */
  readonly primary: number;
  readonly display: DisplayStats;
  readonly physics: Partial<Record<MachinePhysicsKey, number>>;
  readonly gimmickId: string;
  readonly unlock: UnlockRule;
}

export const REFERENCE_MACHINE_ID = "standard";

export const MACHINES: readonly MachineDef[] = [
  {
    id: "standard",
    name: "STANDARD",
    nameJa: "スタンダード",
    blurbJa: "癖のない基準機。どのコースでも計算が立つ。",
    shape: "standard",
    primary: 0xd8dee6,
    display: { speed: 3, accel: 3, handling: 3, weight: 3, luck: 3 },
    physics: {},
    gimmickId: "thrust-vector",
    unlock: { kind: "free" },
  },
  {
    id: "bulwark",
    name: "BULWARK",
    nameJa: "バルワーク",
    blurbJa: "重い。押し勝てるし草でも粘るが、曲がるのは苦手。",
    shape: "heavy",
    primary: 0x8d6a3f,
    display: { speed: 4, accel: 2, handling: 2, weight: 5, luck: 3 },
    physics: {
      speedScale: 1.05,
      turnScale: 0.93,
      accelScale: 0.9,
      offroadScale: 1.22,
      bumpScale: 1.35,
    },
    gimmickId: "ballast-shift",
    unlock: { kind: "free" },
  },
  {
    id: "wisp",
    name: "WISP",
    nameJa: "ウィスプ",
    blurbJa: "軽い。立ち上がりが速く良く曲がるが、当たり負けする。",
    shape: "light",
    primary: 0x7ce6ff,
    display: { speed: 2, accel: 5, handling: 4, weight: 1, luck: 3 },
    physics: {
      speedScale: 0.95,
      turnScale: 1.08,
      accelScale: 1.18,
      offroadScale: 0.88,
      bumpScale: 0.72,
    },
    gimmickId: "turbo-tap",
    unlock: { kind: "free" },
  },
  {
    id: "duneskip",
    name: "DUNESKIP",
    nameJa: "デューンスキップ",
    blurbJa: "オフロード寄り。舗装では平凡だが、外に出ても止まらない。",
    shape: "buggy",
    primary: 0xd98a45,
    display: { speed: 3, accel: 3, handling: 3, weight: 4, luck: 3 },
    physics: {
      speedScale: 0.97,
      turnScale: 1.02,
      accelScale: 1.05,
      offroadScale: 1.45,
      bumpScale: 1.12,
    },
    gimmickId: "mud-tread",
    unlock: { kind: "achievement", id: "trick_25" },
  },
  {
    id: "lancet",
    name: "LANCET",
    nameJa: "ランセット",
    blurbJa: "最高速に振った尖った機体。直線は速いが草に弱い。",
    shape: "light",
    primary: 0xf0413c,
    display: { speed: 5, accel: 2, handling: 3, weight: 2, luck: 3 },
    physics: {
      speedScale: 1.09,
      turnScale: 0.96,
      accelScale: 0.92,
      offroadScale: 0.82,
      bumpScale: 0.9,
    },
    gimmickId: "hover-jump",
    unlock: { kind: "achievement", id: "podium_10" },
  },
  {
    id: "aegis",
    name: "AEGIS",
    nameJa: "イージス",
    blurbJa: "守りの機体。速くはないが、当たり負けせず立て直しが早い。",
    shape: "heavy",
    primary: 0x9350e0,
    display: { speed: 2, accel: 4, handling: 4, weight: 4, luck: 3 },
    physics: {
      speedScale: 0.96,
      turnScale: 1.06,
      accelScale: 1.1,
      offroadScale: 1.08,
      bumpScale: 1.2,
    },
    gimmickId: "spike-guard",
    unlock: { kind: "achievement", id: "hits_30" },
  },
];

const BY_ID = new Map(MACHINES.map((machine) => [machine.id, machine]));

export function machineById(id: string | null | undefined): MachineDef {
  return (id ? BY_ID.get(id) : undefined) ?? BY_ID.get(REFERENCE_MACHINE_ID)!;
}
