/**
 * Character skills and machine gimmicks, as data.
 *
 * The rule this file exists to keep, borrowed wholesale from VORTEX's skill
 * catalog: **abilities are declarative and carry no executable code**. Every
 * one of them is a condition drawn from a closed set and a list of effects
 * drawn from a closed set, and the host's simulation is the only thing that
 * interprets them.
 *
 * That is not tidiness. A callback in a catalog is a callback that has to be
 * identical on the host and on every guest, cannot be validated when it
 * arrives over a wire, and can reach for `Math.random` or a clock without
 * anything noticing until two machines disagree about who won. A tagged union
 * can be checked by the compiler, gated by a total switch, and sent as an id.
 *
 * Every effect below also has to land on machinery the sim already has —
 * boosts, hazards, stun timers, the coefficient set. An ability that needs a
 * new subsystem is an ability for a later release.
 */

export type AbilityCondition =
  | { readonly kind: "always" }
  | { readonly kind: "grounded" }
  | { readonly kind: "airborne" }
  | { readonly kind: "drifting" }
  | { readonly kind: "offroad" }
  | { readonly kind: "moving-above"; readonly speed: number }
  | { readonly kind: "place-behind"; readonly place: number }
  | { readonly kind: "recently-hit"; readonly withinSec: number };

/** Which coefficient a `tuning-mul` effect bends, for its duration. */
export type TunableStat = "speed" | "turn" | "accel" | "offroad";

export type AbilityEffect =
  | { readonly kind: "boost"; readonly seconds: number; readonly source: "mushroom" | "mini" | "draft" }
  | { readonly kind: "invuln"; readonly seconds: number }
  | { readonly kind: "star"; readonly seconds: number }
  | { readonly kind: "hazard"; readonly hazard: "banana" | "mine"; readonly offset: number }
  | { readonly kind: "hop"; readonly vy: number }
  | { readonly kind: "cleanse" }
  | {
      readonly kind: "tuning-mul";
      readonly stat: TunableStat;
      readonly multiplier: number;
      readonly seconds: number;
    }
  | { readonly kind: "air-control"; readonly multiplier: number; readonly seconds: number }
  | { readonly kind: "magnet"; readonly seconds: number }
  | { readonly kind: "brake-slide"; readonly seconds: number };

export interface AbilityDef {
  readonly id: string;
  readonly name: string;
  readonly nameJa: string;
  readonly descJa: string;
  readonly cooldownSec: number;
  readonly condition: AbilityCondition;
  readonly effects: readonly AbilityEffect[];
}

/** One per character. The切り札 half: a single decisive press. */
export const CHARACTER_SKILLS: readonly AbilityDef[] = [
  {
    id: "nitro-pulse",
    name: "NITRO PULSE",
    nameJa: "ニトロパルス",
    descJa: "短いブーストを即座に一発。",
    cooldownSec: 9,
    condition: { kind: "always" },
    effects: [{ kind: "boost", seconds: 0.9, source: "mushroom" }],
  },
  {
    id: "phase-veil",
    name: "PHASE VEIL",
    nameJa: "フェイズヴェール",
    descJa: "2.2秒だけ被弾しなくなり、旋回もわずかに鋭くなる。",
    cooldownSec: 16,
    condition: { kind: "always" },
    effects: [
      { kind: "invuln", seconds: 2.2 },
      { kind: "tuning-mul", stat: "turn", multiplier: 1.1, seconds: 2.2 },
    ],
  },
  {
    id: "gyro-lock",
    name: "GYRO LOCK",
    nameJa: "ジャイロロック",
    descJa: "空中でのみ。姿勢制御が跳ね上がり、少し浮き上がる。",
    cooldownSec: 11,
    condition: { kind: "airborne" },
    effects: [
      { kind: "air-control", multiplier: 2.6, seconds: 1.6 },
      { kind: "hop", vy: 2 },
    ],
  },
  {
    id: "hard-brake",
    name: "HARD BRAKE",
    nameJa: "ハードブレーキ",
    descJa: "速度を削る代わりに一瞬だけ深く曲がる。",
    cooldownSec: 8,
    condition: { kind: "moving-above", speed: 18 },
    effects: [{ kind: "brake-slide", seconds: 0.7 }],
  },
  {
    id: "scrap-drop",
    name: "SCRAP DROP",
    nameJa: "スクラップ投下",
    descJa: "アイテム枠を使わずに後方へ障害物を落とす。",
    cooldownSec: 10,
    condition: { kind: "always" },
    effects: [{ kind: "hazard", hazard: "banana", offset: -3.6 }],
  },
  {
    id: "item-magnet",
    name: "ITEM MAGNET",
    nameJa: "アイテムマグネット",
    descJa: "3.5秒だけアイテムボックスを広く拾える。",
    cooldownSec: 14,
    condition: { kind: "always" },
    effects: [{ kind: "magnet", seconds: 3.5 }],
  },
  {
    id: "second-wind",
    name: "SECOND WIND",
    nameJa: "セカンドウィンド",
    descJa: "被弾直後のみ。スピンを打ち消して立ち上がる。",
    cooldownSec: 12,
    condition: { kind: "recently-hit", withinSec: 2.5 },
    effects: [{ kind: "cleanse" }, { kind: "boost", seconds: 0.6, source: "mini" }],
  },
  {
    id: "slip-call",
    name: "SLIP CALL",
    nameJa: "スリップコール",
    descJa: "3位以下のとき、前走の風を呼び込む。",
    cooldownSec: 13,
    condition: { kind: "place-behind", place: 2 },
    effects: [{ kind: "boost", seconds: 1.4, source: "draft" }],
  },
];

/** One per machine. The situational half: turn the state you are in to profit. */
export const MACHINE_GIMMICKS: readonly AbilityDef[] = [
  {
    id: "thrust-vector",
    name: "THRUST VECTOR",
    nameJa: "スラストベクター",
    descJa: "接地中のみ。2.5秒だけ最高速が伸びる。",
    cooldownSec: 10,
    condition: { kind: "grounded" },
    effects: [{ kind: "tuning-mul", stat: "speed", multiplier: 1.12, seconds: 2.5 }],
  },
  {
    id: "hover-jump",
    name: "HOVER JUMP",
    nameJa: "ホバージャンプ",
    descJa: "接地中のみ。跳び上がって空中制御を得る。",
    cooldownSec: 9,
    condition: { kind: "grounded" },
    effects: [
      { kind: "hop", vy: 7.5 },
      { kind: "air-control", multiplier: 1.8, seconds: 1.2 },
    ],
  },
  {
    id: "ballast-shift",
    name: "BALLAST SHIFT",
    nameJa: "バラストシフト",
    descJa: "1.8秒だけ深く曲がる代わりに少し遅くなる。",
    cooldownSec: 8,
    condition: { kind: "always" },
    effects: [
      { kind: "tuning-mul", stat: "turn", multiplier: 1.28, seconds: 1.8 },
      { kind: "tuning-mul", stat: "speed", multiplier: 0.94, seconds: 1.8 },
    ],
  },
  {
    id: "spike-guard",
    name: "SPIKE GUARD",
    nameJa: "スパイクガード",
    descJa: "一瞬無敵になり、後方にマインを残す。",
    cooldownSec: 14,
    condition: { kind: "always" },
    effects: [
      { kind: "invuln", seconds: 1.4 },
      { kind: "hazard", hazard: "mine", offset: -3.2 },
    ],
  },
  {
    id: "turbo-tap",
    name: "TURBO TAP",
    nameJa: "ターボタップ",
    descJa: "ドリフト中のみ。溜めを一段ぶん進める。",
    cooldownSec: 6,
    condition: { kind: "drifting" },
    effects: [{ kind: "boost", seconds: 0.55, source: "mini" }],
  },
  {
    id: "mud-tread",
    name: "MUD TREAD",
    nameJa: "マッドトレッド",
    descJa: "コース外にいるときのみ。3秒だけ路外に強くなる。",
    cooldownSec: 9,
    condition: { kind: "offroad" },
    effects: [{ kind: "tuning-mul", stat: "offroad", multiplier: 1.9, seconds: 3 }],
  },
];

const BY_ID = new Map<string, AbilityDef>(
  [...CHARACTER_SKILLS, ...MACHINE_GIMMICKS].map((ability) => [
    ability.id,
    ability,
  ]),
);

export function abilityById(id: string): AbilityDef | null {
  return BY_ID.get(id) ?? null;
}
