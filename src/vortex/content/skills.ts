import type { ActiveSkillDef, PassiveSkillDef } from "../types";

/**
 * Skills are declarative on purpose. The host simulator interprets this closed
 * set of effect commands; catalog data never carries executable callbacks.
 */
export const ACTIVE_SKILLS = [
  {
    id: "burst-drive",
    name: "Burst Drive",
    nameJa: "バーストドライブ",
    descriptionJa: "標的へ瞬間加速し、短時間だけ攻撃を高める。",
    cooldownSec: 12,
    charges: null,
    condition: { kind: "always" },
    effects: [
      { kind: "impulse", direction: "toward-target", strength: 7.5 },
      { kind: "stat-multiplier", stat: "attack", multiplier: 1.18, durationSec: 2.4 }
    ]
  },
  {
    id: "aegis-field",
    name: "Aegis Field",
    nameJa: "イージスフィールド",
    descriptionJa: "耐久を受け止める短時間シールドを展開する。",
    cooldownSec: 18,
    charges: 3,
    condition: { kind: "always" },
    effects: [{ kind: "shield", amount: 90, durationSec: 4 }]
  },
  {
    id: "overdrive",
    name: "Overdrive",
    nameJa: "オーバードライブ",
    descriptionJa: "回転を注入し、機動力を一時的に引き上げる。",
    cooldownSec: 16,
    charges: 3,
    condition: { kind: "spin-below", ratio: 0.82 },
    effects: [
      { kind: "spin", amount: 18 },
      { kind: "stat-multiplier", stat: "mobility", multiplier: 1.2, durationSec: 3 }
    ]
  },
  {
    id: "rim-brake",
    name: "Rim Brake",
    nameJa: "リムブレーキ",
    descriptionJa: "外周で摩擦を上げ、中央へ踏みとどまる。",
    cooldownSec: 10,
    charges: null,
    condition: { kind: "near-rim", normalizedRadius: 0.72 },
    effects: [
      { kind: "physics-multiplier", stat: "friction", multiplier: 1.7, durationSec: 1.8 },
      { kind: "impulse", direction: "toward-center", strength: 5.5 }
    ]
  },
  {
    id: "kinetic-pulse",
    name: "Kinetic Pulse",
    nameJa: "キネティックパルス",
    descriptionJa: "周囲へ衝撃波を放って間合いを作る。",
    cooldownSec: 20,
    charges: 2,
    condition: { kind: "target-near", distance: 2.4 },
    effects: [
      { kind: "radial-damage", amount: 34, radius: 2.4 },
      { kind: "impulse", direction: "away-from-target", strength: 8 }
    ]
  },
  {
    id: "anchor-drop",
    name: "Anchor Drop",
    nameJa: "アンカードロップ",
    descriptionJa: "重心を落として弾き飛ばしに耐える。",
    cooldownSec: 15,
    charges: null,
    condition: { kind: "recently-hit", withinSec: 2 },
    effects: [
      { kind: "physics-multiplier", stat: "mass", multiplier: 1.3, durationSec: 3 },
      { kind: "physics-multiplier", stat: "centerOfMass", multiplier: 0.72, durationSec: 3 }
    ]
  },
  {
    id: "vortex-dash",
    name: "Vortex Dash",
    nameJa: "ヴォルテックスダッシュ",
    descriptionJa: "接線方向へ鋭く抜けて次の衝突角を作る。",
    cooldownSec: 9,
    charges: 5,
    condition: { kind: "always" },
    effects: [
      { kind: "impulse", direction: "tangent", strength: 9 },
      { kind: "stat-multiplier", stat: "stability", multiplier: 1.12, durationSec: 2 }
    ]
  },
  {
    id: "repair-nanites",
    name: "Repair Nanites",
    nameJa: "リペアナナイト",
    descriptionJa: "損傷時に耐久を回復する。使用回数は少ない。",
    cooldownSec: 28,
    charges: 2,
    condition: { kind: "durability-below", ratio: 0.48 },
    effects: [{ kind: "durability", amount: 70 }]
  },
  {
    id: "recoil-convert",
    name: "Recoil Convert",
    nameJa: "リコイルコンバート",
    descriptionJa: "直前の衝撃を回転へ変換して立て直す。",
    cooldownSec: 13,
    charges: 4,
    condition: { kind: "recently-hit", withinSec: 1.2 },
    effects: [
      { kind: "spin", amount: 14 },
      { kind: "stat-multiplier", stat: "stability", multiplier: 1.22, durationSec: 2.2 }
    ]
  },
  {
    id: "gravity-lock",
    name: "Gravity Lock",
    nameJa: "グラビティロック",
    descriptionJa: "慣性と接地力を増して軸を固定する。",
    cooldownSec: 22,
    charges: 3,
    condition: { kind: "always" },
    effects: [
      { kind: "physics-multiplier", stat: "inertia", multiplier: 1.3, durationSec: 4 },
      { kind: "physics-multiplier", stat: "friction", multiplier: 1.25, durationSec: 4 }
    ]
  },
  {
    id: "hunter-lunge",
    name: "Hunter Lunge",
    nameJa: "ハンターランジ",
    descriptionJa: "近距離の標的へ突進し、強い一撃を狙う。",
    cooldownSec: 14,
    charges: null,
    condition: { kind: "target-near", distance: 3.5 },
    effects: [
      { kind: "impulse", direction: "toward-target", strength: 11 },
      { kind: "stat-multiplier", stat: "attack", multiplier: 1.26, durationSec: 1.4 }
    ]
  },
  {
    id: "phase-skid",
    name: "Phase Skid",
    nameJa: "フェイズスキッド",
    descriptionJa: "短時間すり抜け状態になり危険な衝突を回避する。",
    cooldownSec: 24,
    charges: 2,
    condition: { kind: "durability-below", ratio: 0.6 },
    effects: [
      { kind: "phase", durationSec: 1.1 },
      { kind: "impulse", direction: "toward-center", strength: 4 }
    ]
  },
  {
    id: "counter-spin",
    name: "Counter Spin",
    nameJa: "カウンタースピン",
    descriptionJa: "相手の回転を奪い、自身へ移す。",
    cooldownSec: 19,
    charges: 3,
    condition: { kind: "target-near", distance: 1.7 },
    effects: [{ kind: "steal-spin", amount: 12 }]
  },
  {
    id: "momentum-siphon",
    name: "Momentum Siphon",
    nameJa: "モメンタムサイフォン",
    descriptionJa: "接近した相手から回転を大きく吸収する。",
    cooldownSec: 26,
    charges: 2,
    condition: { kind: "spin-below", ratio: 0.5 },
    effects: [
      { kind: "steal-spin", amount: 20 },
      { kind: "durability", amount: 24 }
    ]
  },
  {
    id: "shock-ring",
    name: "Shock Ring",
    nameJa: "ショックリング",
    descriptionJa: "全周攻撃で密集した敵を押し返す。",
    cooldownSec: 21,
    charges: 3,
    condition: { kind: "target-near", distance: 2.1 },
    effects: [
      { kind: "radial-damage", amount: 44, radius: 2.1 },
      { kind: "impulse", direction: "away-from-target", strength: 10 }
    ]
  },
  {
    id: "gyroscopic-reset",
    name: "Gyroscopic Reset",
    nameJa: "ジャイロリセット",
    descriptionJa: "姿勢を戻し、安定性と回転を回復する。",
    cooldownSec: 23,
    charges: 2,
    condition: { kind: "airborne" },
    effects: [
      { kind: "stat-multiplier", stat: "stability", multiplier: 1.5, durationSec: 2.5 },
      { kind: "spin", amount: 10 }
    ]
  },
  {
    id: "last-stand",
    name: "Last Stand",
    nameJa: "ラストスタンド",
    descriptionJa: "最後の一機同士になった時、攻防を同時強化する。",
    cooldownSec: 40,
    charges: 1,
    condition: { kind: "last-survivor" },
    effects: [
      { kind: "stat-multiplier", stat: "attack", multiplier: 1.3, durationSec: 8 },
      { kind: "stat-multiplier", stat: "defense", multiplier: 1.3, durationSec: 8 }
    ]
  },
  {
    id: "heat-vent",
    name: "Heat Vent",
    nameJa: "ヒートベント",
    descriptionJa: "妨害を解除して回転伝達を正常化する。",
    cooldownSec: 17,
    charges: 3,
    condition: { kind: "always" },
    effects: [{ kind: "cleanse" }, { kind: "spin", amount: 7 }]
  },
  {
    id: "vector-flip",
    name: "Vector Flip",
    nameJa: "ベクトルフリップ",
    descriptionJa: "周回方向を反転し、追跡を外す。",
    cooldownSec: 18,
    charges: 3,
    condition: { kind: "always" },
    effects: [
      { kind: "reverse-orbit", durationSec: 5 },
      { kind: "stat-multiplier", stat: "mobility", multiplier: 1.15, durationSec: 5 }
    ]
  },
  {
    id: "orbit-break",
    name: "Orbit Break",
    nameJa: "オービットブレイク",
    descriptionJa: "外周から中央へ一気に切り込む。",
    cooldownSec: 12,
    charges: 4,
    condition: { kind: "near-rim", normalizedRadius: 0.68 },
    effects: [
      { kind: "impulse", direction: "toward-center", strength: 12 },
      { kind: "stat-multiplier", stat: "attack", multiplier: 1.2, durationSec: 2 }
    ]
  },
  {
    id: "impact-shell",
    name: "Impact Shell",
    nameJa: "インパクトシェル",
    descriptionJa: "被弾直後に厚い防御殻を形成する。",
    cooldownSec: 20,
    charges: 3,
    condition: { kind: "recently-hit", withinSec: 0.8 },
    effects: [
      { kind: "shield", amount: 120, durationSec: 2.5 },
      { kind: "stat-multiplier", stat: "defense", multiplier: 1.2, durationSec: 2.5 }
    ]
  },
  {
    id: "slipstream",
    name: "Slipstream",
    nameJa: "スリップストリーム",
    descriptionJa: "空気抵抗を減らし、高速周回へ移る。",
    cooldownSec: 15,
    charges: null,
    condition: { kind: "spin-above", ratio: 0.55 },
    effects: [
      { kind: "physics-multiplier", stat: "drag", multiplier: 0.55, durationSec: 5 },
      { kind: "stat-multiplier", stat: "mobility", multiplier: 1.18, durationSec: 5 }
    ]
  },
  {
    id: "radial-guard",
    name: "Radial Guard",
    nameJa: "ラジアルガード",
    descriptionJa: "外周付近で反発と防御を抑え、場外を防ぐ。",
    cooldownSec: 14,
    charges: 4,
    condition: { kind: "near-rim", normalizedRadius: 0.75 },
    effects: [
      { kind: "physics-multiplier", stat: "restitution", multiplier: 0.45, durationSec: 3 },
      { kind: "stat-multiplier", stat: "defense", multiplier: 1.25, durationSec: 3 }
    ]
  },
  {
    id: "execution-drive",
    name: "Execution Drive",
    nameJa: "エクスキューションドライブ",
    descriptionJa: "高速回転時に全出力を攻撃へ集中する。",
    cooldownSec: 25,
    charges: 2,
    condition: { kind: "spin-above", ratio: 0.72 },
    effects: [
      { kind: "stat-multiplier", stat: "attack", multiplier: 1.42, durationSec: 3 },
      { kind: "spin", amount: -10 }
    ]
  },
  {
    id: "pulse-jammer",
    name: "Pulse Jammer",
    nameJa: "パルスジャマー",
    descriptionJa: "周囲の相手のスキル再使用を遅らせる。",
    cooldownSec: 30,
    charges: 2,
    condition: { kind: "target-near", distance: 2.8 },
    effects: [
      { kind: "radial-damage", amount: 18, radius: 2.8 },
      { kind: "cooldown-shift", amountSec: 4 }
    ]
  },
  {
    id: "cyclone-lift",
    name: "Cyclone Lift",
    nameJa: "サイクロンリフト",
    descriptionJa: "軽い相手を浮かせる強い押し出しを生む。",
    cooldownSec: 22,
    charges: 3,
    condition: { kind: "target-near", distance: 1.6 },
    effects: [
      { kind: "impulse", direction: "away-from-target", strength: 14 },
      { kind: "stat-multiplier", stat: "attack", multiplier: 1.16, durationSec: 1.5 }
    ]
  },
  {
    id: "resonance-burst",
    name: "Resonance Burst",
    nameJa: "レゾナンスバースト",
    descriptionJa: "低回転を代償に広範囲へ共振ダメージを与える。",
    cooldownSec: 27,
    charges: 2,
    condition: { kind: "spin-below", ratio: 0.62 },
    effects: [
      { kind: "radial-damage", amount: 58, radius: 3 },
      { kind: "spin", amount: -7 }
    ]
  },
  {
    id: "core-reboot",
    name: "Core Reboot",
    nameJa: "コアリブート",
    descriptionJa: "瀕死時に耐久と回転を一度だけ回復する。",
    cooldownSec: 60,
    charges: 1,
    condition: { kind: "durability-below", ratio: 0.22 },
    effects: [
      { kind: "durability", amount: 105 },
      { kind: "spin", amount: 16 },
      { kind: "cleanse" }
    ]
  },
  {
    id: "edge-reversal",
    name: "Edge Reversal",
    nameJa: "エッジリバーサル",
    descriptionJa: "被弾直後に周回を反転して反撃する。",
    cooldownSec: 16,
    charges: 4,
    condition: { kind: "recently-hit", withinSec: 1 },
    effects: [
      { kind: "reverse-orbit", durationSec: 4 },
      { kind: "impulse", direction: "toward-target", strength: 8 }
    ]
  },
  {
    id: "stamina-surge",
    name: "Stamina Surge",
    nameJa: "スタミナサージ",
    descriptionJa: "低回転域で持久と回転を補う。",
    cooldownSec: 20,
    charges: 3,
    condition: { kind: "spin-below", ratio: 0.4 },
    effects: [
      { kind: "spin", amount: 22 },
      { kind: "stat-multiplier", stat: "stamina", multiplier: 1.3, durationSec: 5 }
    ]
  },
  {
    id: "gravity-well",
    name: "Gravity Well",
    nameJa: "グラビティウェル",
    descriptionJa: "中央へ強く引き込み、重い衝突を作る。",
    cooldownSec: 24,
    charges: 3,
    condition: { kind: "always" },
    effects: [
      { kind: "impulse", direction: "toward-center", strength: 10 },
      { kind: "physics-multiplier", stat: "mass", multiplier: 1.2, durationSec: 4 }
    ]
  },
  {
    id: "torque-spike",
    name: "Torque Spike",
    nameJa: "トルクスパイク",
    descriptionJa: "瞬間的な回転トルクを衝突威力へ変える。",
    cooldownSec: 11,
    charges: 5,
    condition: { kind: "spin-above", ratio: 0.45 },
    effects: [
      { kind: "spin", amount: 9 },
      { kind: "stat-multiplier", stat: "attack", multiplier: 1.22, durationSec: 1.8 }
    ]
  },
  {
    id: "survivor-mode",
    name: "Survivor Mode",
    nameJa: "サバイバーモード",
    descriptionJa: "最後の競り合いで持久と耐久を補強する。",
    cooldownSec: 45,
    charges: 1,
    condition: { kind: "last-survivor" },
    effects: [
      { kind: "stat-multiplier", stat: "stamina", multiplier: 1.4, durationSec: 10 },
      { kind: "durability", amount: 60 }
    ]
  },
  {
    id: "eclipse-step",
    name: "Eclipse Step",
    nameJa: "エクリプスステップ",
    descriptionJa: "短い位相移動で中央側へ位置を変える。",
    cooldownSec: 21,
    charges: 3,
    condition: { kind: "near-rim", normalizedRadius: 0.62 },
    effects: [
      { kind: "phase", durationSec: 0.8 },
      { kind: "impulse", direction: "toward-center", strength: 9 }
    ]
  },
  {
    id: "crown-breaker",
    name: "Crown Breaker",
    nameJa: "クラウンブレイカー",
    descriptionJa: "一度だけ放てる最大級の正面突撃。",
    cooldownSec: 60,
    charges: 1,
    condition: { kind: "target-near", distance: 4 },
    effects: [
      { kind: "impulse", direction: "toward-target", strength: 16 },
      { kind: "stat-multiplier", stat: "attack", multiplier: 1.55, durationSec: 1.2 }
    ]
  }
] as const satisfies readonly ActiveSkillDef[];

export const PASSIVE_SKILLS = [
  {
    id: "reinforced-shell",
    name: "Reinforced Shell",
    nameJa: "強化シェル",
    descriptionJa: "常時、防御を高める。",
    trigger: "continuous",
    effects: [{ kind: "stat-multiplier", stat: "defense", multiplier: 1.1 }]
  },
  {
    id: "razor-balance",
    name: "Razor Balance",
    nameJa: "レイザーバランス",
    descriptionJa: "攻撃と安定を小幅に両立する。",
    trigger: "continuous",
    effects: [
      { kind: "stat-multiplier", stat: "attack", multiplier: 1.06 },
      { kind: "stat-multiplier", stat: "stability", multiplier: 1.06 }
    ]
  },
  {
    id: "endless-bearing",
    name: "Endless Bearing",
    nameJa: "エンドレスベアリング",
    descriptionJa: "空気抵抗を抑え、持久力を高める。",
    trigger: "continuous",
    effects: [
      { kind: "physics-multiplier", stat: "drag", multiplier: 0.88 },
      { kind: "stat-multiplier", stat: "stamina", multiplier: 1.08 }
    ]
  },
  {
    id: "low-center",
    name: "Low Center",
    nameJa: "ローセンター",
    descriptionJa: "重心を下げて傾きにくくする。",
    trigger: "continuous",
    effects: [
      { kind: "physics-multiplier", stat: "centerOfMass", multiplier: 0.84 },
      { kind: "stat-multiplier", stat: "stability", multiplier: 1.08 }
    ]
  },
  {
    id: "quick-foot",
    name: "Quick Foot",
    nameJa: "クイックフット",
    descriptionJa: "軽快な軌道変更で機動力を高める。",
    trigger: "continuous",
    effects: [{ kind: "stat-multiplier", stat: "mobility", multiplier: 1.11 }]
  },
  {
    id: "kinetic-weave",
    name: "Kinetic Weave",
    nameJa: "キネティックウィーブ",
    descriptionJa: "被弾後に短時間、防御を上げる。",
    trigger: "on-take-hit",
    effects: [{ kind: "stat-multiplier", stat: "defense", multiplier: 1.18, durationSec: 2 }]
  },
  {
    id: "adaptive-armor",
    name: "Adaptive Armor",
    nameJa: "アダプティブアーマー",
    descriptionJa: "耐久低下時に防御殻が硬化する。",
    trigger: "durability-below",
    threshold: 0.5,
    effects: [{ kind: "stat-multiplier", stat: "defense", multiplier: 1.2 }]
  },
  {
    id: "rim-reader",
    name: "Rim Reader",
    nameJa: "リムリーダー",
    descriptionJa: "外周で中央方向の復帰力を得る。",
    trigger: "near-rim",
    threshold: 0.72,
    effects: [{ kind: "impulse", direction: "toward-center", strength: 2.2 }]
  },
  {
    id: "opening-rush",
    name: "Opening Rush",
    nameJa: "オープニングラッシュ",
    descriptionJa: "開始直後だけ攻撃と機動を高める。",
    trigger: "battle-start",
    effects: [
      { kind: "stat-multiplier", stat: "attack", multiplier: 1.15, durationSec: 8 },
      { kind: "stat-multiplier", stat: "mobility", multiplier: 1.12, durationSec: 8 }
    ]
  },
  {
    id: "comeback-gear",
    name: "Comeback Gear",
    nameJa: "カムバックギア",
    descriptionJa: "低回転になると回転を補う。",
    trigger: "spin-below",
    threshold: 0.35,
    effects: [{ kind: "spin", amount: 8 }]
  },
  {
    id: "impact-memory",
    name: "Impact Memory",
    nameJa: "インパクトメモリ",
    descriptionJa: "被弾の直後、次の攻撃を強める。",
    trigger: "on-take-hit",
    effects: [{ kind: "stat-multiplier", stat: "attack", multiplier: 1.14, durationSec: 2.5 }]
  },
  {
    id: "friction-bloom",
    name: "Friction Bloom",
    nameJa: "フリクションブルーム",
    descriptionJa: "外周で接地力を増し、滑落を抑える。",
    trigger: "near-rim",
    threshold: 0.68,
    effects: [{ kind: "physics-multiplier", stat: "friction", multiplier: 1.22 }]
  },
  {
    id: "overclocked-core",
    name: "Overclocked Core",
    nameJa: "オーバークロックコア",
    descriptionJa: "開始時に追加回転を得る。",
    trigger: "battle-start",
    effects: [{ kind: "spin", amount: 12 }]
  },
  {
    id: "wind-cut",
    name: "Wind Cut",
    nameJa: "ウィンドカット",
    descriptionJa: "空気抵抗を継続的に軽減する。",
    trigger: "continuous",
    effects: [{ kind: "physics-multiplier", stat: "drag", multiplier: 0.82 }]
  },
  {
    id: "shock-dampers",
    name: "Shock Dampers",
    nameJa: "ショックダンパー",
    descriptionJa: "反発を抑えて場外方向への跳ねを減らす。",
    trigger: "continuous",
    effects: [{ kind: "physics-multiplier", stat: "restitution", multiplier: 0.82 }]
  },
  {
    id: "hunter-bias",
    name: "Hunter Bias",
    nameJa: "ハンターバイアス",
    descriptionJa: "命中するたび短時間、機動が上がる。",
    trigger: "on-hit",
    effects: [{ kind: "stat-multiplier", stat: "mobility", multiplier: 1.12, durationSec: 2 }]
  },
  {
    id: "crown-aegis",
    name: "Crown Aegis",
    nameJa: "クラウンイージス",
    descriptionJa: "開始時に小型シールドを得る。",
    trigger: "battle-start",
    effects: [{ kind: "shield", amount: 48, durationSec: 12 }]
  },
  {
    id: "damage-spool",
    name: "Damage Spool",
    nameJa: "ダメージスプール",
    descriptionJa: "命中時に回転を少量回収する。",
    trigger: "on-hit",
    effects: [{ kind: "spin", amount: 3 }]
  },
  {
    id: "precision-tip",
    name: "Precision Tip",
    nameJa: "プレシジョンチップ",
    descriptionJa: "安定性と摩擦を整え、軌道を正確にする。",
    trigger: "continuous",
    effects: [
      { kind: "stat-multiplier", stat: "stability", multiplier: 1.09 },
      { kind: "physics-multiplier", stat: "friction", multiplier: 1.06 }
    ]
  },
  {
    id: "orbit-keeper",
    name: "Orbit Keeper",
    nameJa: "オービットキーパー",
    descriptionJa: "外周で持久力を高める。",
    trigger: "near-rim",
    threshold: 0.6,
    effects: [{ kind: "stat-multiplier", stat: "stamina", multiplier: 1.14 }]
  },
  {
    id: "guard-conversion",
    name: "Guard Conversion",
    nameJa: "ガードコンバージョン",
    descriptionJa: "被弾の一部を回転へ変える。",
    trigger: "on-take-hit",
    effects: [{ kind: "spin", amount: 4 }]
  },
  {
    id: "stagger-proof",
    name: "Stagger Proof",
    nameJa: "スタガープルーフ",
    descriptionJa: "被弾直後の姿勢崩れを抑える。",
    trigger: "on-take-hit",
    effects: [{ kind: "stat-multiplier", stat: "stability", multiplier: 1.22, durationSec: 1.5 }]
  },
  {
    id: "siphon-bearing",
    name: "Siphon Bearing",
    nameJa: "サイフォンベアリング",
    descriptionJa: "命中時に相手の回転を少量奪う。",
    trigger: "on-hit",
    effects: [{ kind: "steal-spin", amount: 3 }]
  },
  {
    id: "echo-drive",
    name: "Echo Drive",
    nameJa: "エコードライブ",
    descriptionJa: "被弾後に接線方向へ押し出して再加速する。",
    trigger: "on-take-hit",
    effects: [{ kind: "impulse", direction: "tangent", strength: 2.8 }]
  },
  {
    id: "stable-axis",
    name: "Stable Axis",
    nameJa: "ステーブルアクシス",
    descriptionJa: "慣性を増し、回転軸を保つ。",
    trigger: "continuous",
    effects: [
      { kind: "physics-multiplier", stat: "inertia", multiplier: 1.1 },
      { kind: "stat-multiplier", stat: "stability", multiplier: 1.07 }
    ]
  },
  {
    id: "collision-feast",
    name: "Collision Feast",
    nameJa: "コリジョンフィースト",
    descriptionJa: "命中するたび耐久をわずかに回復する。",
    trigger: "on-hit",
    effects: [{ kind: "durability", amount: 5 }]
  },
  {
    id: "emergency-lube",
    name: "Emergency Lube",
    nameJa: "エマージェンシールーブ",
    descriptionJa: "低回転になると摩擦と抵抗を抑える。",
    trigger: "spin-below",
    threshold: 0.3,
    effects: [
      { kind: "physics-multiplier", stat: "friction", multiplier: 0.82 },
      { kind: "physics-multiplier", stat: "drag", multiplier: 0.8 }
    ]
  },
  {
    id: "underdog-current",
    name: "Underdog Current",
    nameJa: "アンダードッグカレント",
    descriptionJa: "脱落者が出るたび回転を得る。",
    trigger: "elimination",
    effects: [{ kind: "spin", amount: 7 }]
  },
  {
    id: "mass-driver",
    name: "Mass Driver",
    nameJa: "マスドライバー",
    descriptionJa: "質量と攻撃を増す代わりに機動を少し落とす。",
    trigger: "continuous",
    effects: [
      { kind: "physics-multiplier", stat: "mass", multiplier: 1.08 },
      { kind: "stat-multiplier", stat: "attack", multiplier: 1.08 },
      { kind: "stat-multiplier", stat: "mobility", multiplier: 0.96 }
    ]
  },
  {
    id: "serene-spin",
    name: "Serene Spin",
    nameJa: "セリーンスピン",
    descriptionJa: "攻撃を受けていない間の持久効率を高める。",
    trigger: "continuous",
    effects: [{ kind: "stat-multiplier", stat: "stamina", multiplier: 1.11 }]
  },
  {
    id: "volatile-edge",
    name: "Volatile Edge",
    nameJa: "ヴォラタイルエッジ",
    descriptionJa: "反発と攻撃を増し、激しい衝突を作る。",
    trigger: "continuous",
    effects: [
      { kind: "physics-multiplier", stat: "restitution", multiplier: 1.12 },
      { kind: "stat-multiplier", stat: "attack", multiplier: 1.1 }
    ]
  },
  {
    id: "pulse-lattice",
    name: "Pulse Lattice",
    nameJa: "パルスラティス",
    descriptionJa: "命中時に次のスキル再使用をわずかに早める。",
    trigger: "on-hit",
    effects: [{ kind: "cooldown-shift", amountSec: -0.8 }]
  },
  {
    id: "eclipse-veil",
    name: "Eclipse Veil",
    nameJa: "エクリプスヴェイル",
    descriptionJa: "瀕死時に一度だけ短い位相状態へ入る。",
    trigger: "durability-below",
    threshold: 0.2,
    effects: [{ kind: "phase", durationSec: 0.7 }]
  },
  {
    id: "helix-feedback",
    name: "Helix Feedback",
    nameJa: "ヘリックスフィードバック",
    descriptionJa: "命中時に攻撃と安定を短時間強化する。",
    trigger: "on-hit",
    effects: [
      { kind: "stat-multiplier", stat: "attack", multiplier: 1.08, durationSec: 2 },
      { kind: "stat-multiplier", stat: "stability", multiplier: 1.08, durationSec: 2 }
    ]
  },
  {
    id: "survivor-alloy",
    name: "Survivor Alloy",
    nameJa: "サバイバーアロイ",
    descriptionJa: "脱落者が出るたび防御と耐久を補う。",
    trigger: "elimination",
    effects: [
      { kind: "stat-multiplier", stat: "defense", multiplier: 1.06 },
      { kind: "durability", amount: 12 }
    ]
  }
] as const satisfies readonly PassiveSkillDef[];

export const ACTIVE_SKILL_BY_ID: ReadonlyMap<string, ActiveSkillDef> = new Map(
  ACTIVE_SKILLS.map((skill) => [skill.id, skill])
);

export const PASSIVE_SKILL_BY_ID: ReadonlyMap<string, PassiveSkillDef> = new Map(
  PASSIVE_SKILLS.map((skill) => [skill.id, skill])
);

export function getActiveSkill(id: string): ActiveSkillDef | undefined {
  return ACTIVE_SKILL_BY_ID.get(id);
}

export function getPassiveSkill(id: string): PassiveSkillDef | undefined {
  return PASSIVE_SKILL_BY_ID.get(id);
}
