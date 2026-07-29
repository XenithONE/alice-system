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
      // The only enemy-targeting cooldown-shift in the catalogue. The radius
      // matches this skill's own radial-damage and its target-near condition,
      // both 2.8 — one reach, authored once.
      { kind: "cooldown-shift", amountSec: 4, target: "enemies", radius: 2.8 }
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
  },
  {
    id: "emergency-ramen",
    name: "Emergency Ramen",
    nameJa: "緊急ラーメン",
    descriptionJa: "瀕死時に非常食カートリッジを開封し、湯気と一緒に耐久・回転を取り戻す。",
    cooldownSec: 29,
    charges: 2,
    condition: { kind: "durability-below", ratio: 0.38 },
    effects: [
      { kind: "durability", amount: 55 },
      { kind: "spin", amount: 11 },
      { kind: "cleanse" }
    ]
  },
  {
    id: "banana-orbit",
    name: "Banana Orbit",
    nameJa: "バナナ軌道",
    descriptionJa: "外周で予測不能な反転ドリフトを始め、追跡してきた相手の読みを外す。",
    cooldownSec: 13,
    charges: 4,
    condition: { kind: "near-rim", normalizedRadius: 0.58 },
    effects: [
      { kind: "reverse-orbit", durationSec: 6 },
      { kind: "impulse", direction: "tangent", strength: 8 },
      { kind: "physics-multiplier", stat: "restitution", multiplier: 0.72, durationSec: 4 }
    ]
  },
  {
    id: "rubber-chicken-counter",
    name: "Rubber Chicken Counter",
    nameJa: "ゴムチキン反撃",
    descriptionJa: "被弾音を盛大に鳴らし、その反響を全周カウンターへ変換する。",
    cooldownSec: 17,
    charges: 3,
    condition: { kind: "recently-hit", withinSec: 0.9 },
    effects: [
      { kind: "radial-damage", amount: 26, radius: 1.9 },
      { kind: "impulse", direction: "away-from-target", strength: 9 }
    ]
  },
  {
    id: "coffee-overfill",
    name: "Coffee Overfill",
    nameJa: "コーヒー過充填",
    descriptionJa: "駆動核へ濃すぎる一杯を注ぎ、低回転から猛烈な加速状態へ入る。",
    cooldownSec: 21,
    charges: 2,
    condition: { kind: "spin-below", ratio: 0.65 },
    effects: [
      { kind: "spin", amount: 26 },
      { kind: "stat-multiplier", stat: "mobility", multiplier: 1.34, durationSec: 4 },
      { kind: "physics-multiplier", stat: "drag", multiplier: 0.72, durationSec: 4 }
    ]
  },
  {
    id: "monday-override",
    name: "Monday Override",
    nameJa: "月曜強制再起動",
    descriptionJa: "週初め級の危機を検知すると現実逃避シールドを展開して強制復帰する。",
    cooldownSec: 52,
    charges: 1,
    condition: { kind: "durability-below", ratio: 0.25 },
    effects: [
      { kind: "phase", durationSec: 1 },
      { kind: "shield", amount: 70, durationSec: 3 },
      { kind: "durability", amount: 36 }
    ]
  },
  {
    id: "deadline-dash",
    name: "Deadline Dash",
    nameJa: "締切ダッシュ",
    descriptionJa: "締切八秒前の集中力で標的へ突進する。なぜ普段から出せないのかは未解明。",
    cooldownSec: 8,
    charges: 5,
    condition: { kind: "target-near", distance: 4.2 },
    effects: [
      { kind: "impulse", direction: "toward-target", strength: 12 },
      { kind: "stat-multiplier", stat: "attack", multiplier: 1.16, durationSec: 1.6 }
    ]
  },
  {
    id: "popcorn-scatter",
    name: "Popcorn Scatter",
    nameJa: "ポップコーン散開",
    descriptionJa: "浮いた瞬間に内蔵粒子が弾け、周囲を巻き込む派手な着地準備を行う。",
    cooldownSec: 24,
    charges: 2,
    condition: { kind: "airborne" },
    effects: [
      { kind: "radial-damage", amount: 40, radius: 2.6 },
      { kind: "impulse", direction: "away-from-target", strength: 11 }
    ]
  },
  {
    id: "vector-parry",
    name: "Vector Parry",
    nameJa: "ベクトルパリィ",
    descriptionJa: "衝撃を接線方向へ受け流し、薄い防壁を残しながら射線を切る。",
    cooldownSec: 15,
    charges: 4,
    condition: { kind: "recently-hit", withinSec: 0.7 },
    effects: [
      { kind: "shield", amount: 66, durationSec: 2.2 },
      { kind: "impulse", direction: "tangent", strength: 6.5 }
    ]
  },
  {
    id: "nullwake-wash",
    name: "Nullwake Wash",
    nameJa: "ヌルウェイク洗浄",
    descriptionJa: "妨害を洗い流し、空力境界を整えて滑らかな周回へ戻す。",
    cooldownSec: 19,
    charges: 3,
    condition: { kind: "always" },
    effects: [
      { kind: "cleanse" },
      { kind: "physics-multiplier", stat: "drag", multiplier: 0.62, durationSec: 4.5 }
    ]
  },
  {
    id: "periapsis-lance",
    name: "Periapsis Lance",
    nameJa: "近点槍",
    descriptionJa: "外周で蓄えた周回速度を最短距離の刺突へ変換する。",
    cooldownSec: 16,
    charges: 3,
    condition: { kind: "near-rim", normalizedRadius: 0.7 },
    effects: [
      { kind: "impulse", direction: "toward-target", strength: 13.5 },
      { kind: "stat-multiplier", stat: "attack", multiplier: 1.3, durationSec: 1.5 }
    ]
  },
  {
    id: "iron-choir",
    name: "Iron Choir",
    nameJa: "鋼鉄聖歌",
    descriptionJa: "最終決戦で装甲各層を共振させ、長時間の守勢へ移行する。",
    cooldownSec: 48,
    charges: 1,
    condition: { kind: "last-survivor" },
    effects: [
      { kind: "shield", amount: 135, durationSec: 9 },
      { kind: "stat-multiplier", stat: "defense", multiplier: 1.32, durationSec: 9 },
      { kind: "stat-multiplier", stat: "stamina", multiplier: 1.2, durationSec: 9 }
    ]
  },
  {
    id: "spin-escrow",
    name: "Spin Escrow",
    nameJa: "回転エスクロー",
    descriptionJa: "余剰回転を一時預託し、強固な防壁として先払いする。",
    cooldownSec: 20,
    charges: 3,
    condition: { kind: "spin-above", ratio: 0.76 },
    effects: [
      { kind: "spin", amount: -6 },
      { kind: "shield", amount: 110, durationSec: 4.2 }
    ]
  },
  {
    id: "centerline-recall",
    name: "Centerline Recall",
    nameJa: "中心線リコール",
    descriptionJa: "位相をずらしながらリング中央へ帰還し、場外軌道を断ち切る。",
    cooldownSec: 23,
    charges: 2,
    condition: { kind: "near-rim", normalizedRadius: 0.78 },
    effects: [
      { kind: "phase", durationSec: 0.9 },
      { kind: "impulse", direction: "toward-center", strength: 13 }
    ]
  },
  {
    id: "harmonic-dividend",
    name: "Harmonic Dividend",
    nameJa: "共振配当",
    descriptionJa: "近距離の回転共振から利益を回収し、自機の再使用待ちを短縮する。",
    cooldownSec: 25,
    charges: 3,
    condition: { kind: "target-near", distance: 2 },
    effects: [
      { kind: "steal-spin", amount: 8 },
      { kind: "cooldown-shift", amountSec: -2.5 }
    ]
  },
  /* ---- v3 additions: eight actives authored around the combo table and
     the new pass-through phase. Counts asserted in gates.ts (C07). ---- */
  {
    id: "axle-bite",
    name: "Axle Bite",
    nameJa: "アクスルバイト",
    descriptionJa: "軸ごと噛みつくように踏み込み、次の一撃へ全トルクを乗せる。",
    cooldownSec: 14,
    charges: 4,
    condition: { kind: "target-near", distance: 3.4 },
    effects: [
      { kind: "impulse", direction: "toward-target", strength: 7 },
      { kind: "stat-multiplier", stat: "attack", multiplier: 1.22, durationSec: 2 }
    ]
  },
  {
    id: "ghost-lattice",
    name: "Ghost Lattice",
    nameJa: "ゴーストラティス",
    descriptionJa: "格子状の位相場で一瞬だけ実体を失い、渦中を通り抜ける。",
    cooldownSec: 18,
    charges: 3,
    condition: { kind: "target-near", distance: 2.6 },
    effects: [
      { kind: "phase", durationSec: 0.85 },
      { kind: "impulse", direction: "toward-target", strength: 6 }
    ]
  },
  {
    id: "undertow",
    name: "Undertow",
    nameJa: "アンダートウ",
    descriptionJa: "低い引き波で敵の回転を奪い、自分の軸に足す。",
    cooldownSec: 20,
    charges: 3,
    condition: { kind: "target-near", distance: 2.4 },
    effects: [
      { kind: "steal-spin", amount: 7 },
      { kind: "physics-multiplier", stat: "friction", multiplier: 0.85, durationSec: 2 }
    ]
  },
  {
    id: "static-veil",
    name: "Static Veil",
    nameJa: "スタティックヴェール",
    descriptionJa: "静電の帳で周囲の再使用回路を焼き、行動を遅らせる。",
    cooldownSec: 26,
    charges: 2,
    condition: { kind: "target-near", distance: 3 },
    effects: [
      { kind: "cooldown-shift", amountSec: 3, target: "enemies", radius: 3 },
      { kind: "shield", amount: 30, durationSec: 1.6 }
    ]
  },
  {
    id: "flywheel-loan",
    name: "Flywheel Loan",
    nameJa: "フライホイールローン",
    descriptionJa: "未来の持久を前借りして、今この瞬間の回転に変える。",
    cooldownSec: 16,
    charges: 4,
    condition: { kind: "spin-below", ratio: 0.6 },
    effects: [
      { kind: "spin", amount: 16 },
      { kind: "stat-multiplier", stat: "stamina", multiplier: 0.9, durationSec: 4 }
    ]
  },
  {
    id: "keel-cut",
    name: "Keel Cut",
    nameJa: "キールカット",
    descriptionJa: "竜骨で斬り込むような接線加速。壁際の敵に深く刺さる。",
    cooldownSec: 12,
    charges: 5,
    condition: { kind: "always" },
    effects: [
      { kind: "impulse", direction: "tangent", strength: 8 },
      { kind: "stat-multiplier", stat: "attack", multiplier: 1.1, durationSec: 1.6 }
    ]
  },
  {
    id: "ballast-drop",
    name: "Ballast Drop",
    nameJa: "バラストドロップ",
    descriptionJa: "バラストを落として重心を沈め、押し合いを制する。",
    cooldownSec: 15,
    charges: 4,
    condition: { kind: "near-rim", normalizedRadius: 0.7 },
    effects: [
      { kind: "physics-multiplier", stat: "mass", multiplier: 1.3, durationSec: 2.4 },
      { kind: "impulse", direction: "toward-center", strength: 5 }
    ]
  },
  {
    id: "afterimage-bloom",
    name: "Afterimage Bloom",
    nameJa: "残像開花",
    descriptionJa: "残像を咲かせて離脱し、離れ際に衝撃の花弁を散らす。",
    cooldownSec: 22,
    charges: 2,
    condition: { kind: "target-near", distance: 2 },
    effects: [
      { kind: "phase", durationSec: 0.6 },
      { kind: "impulse", direction: "away-from-target", strength: 9 },
      { kind: "radial-damage", amount: 16, radius: 1.8 }
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
  },
  {
    id: "monday-resistance",
    name: "Monday Resistance",
    nameJa: "月曜耐性",
    descriptionJa: "開始直後の憂鬱を装甲へ変換し、しばらく防御と持久を高める。",
    trigger: "battle-start",
    effects: [
      { kind: "shield", amount: 50, durationSec: 12 },
      { kind: "stat-multiplier", stat: "stamina", multiplier: 1.1, durationSec: 12 }
    ]
  },
  {
    id: "rubber-chicken-reflex",
    name: "Rubber Chicken Reflex",
    nameJa: "ゴムチキン反射",
    descriptionJa: "殴られるたび珍妙な反響波を放ち、相手との距離を強引に作る。",
    trigger: "on-take-hit",
    effects: [
      { kind: "radial-damage", amount: 14, radius: 1.5 },
      { kind: "impulse", direction: "tangent", strength: 1.8 }
    ]
  },
  {
    id: "coffee-drip-bearing",
    name: "Coffee Drip Bearing",
    nameJa: "コーヒー滴下ベアリング",
    descriptionJa: "低回転になると一滴だけ補給し、回転とスキル循環をこっそり立て直す。",
    trigger: "spin-below",
    threshold: 0.45,
    effects: [
      { kind: "spin", amount: 6 },
      { kind: "cooldown-shift", amountSec: -0.5 }
    ]
  },
  {
    id: "emergency-snack-bay",
    name: "Emergency Snack Bay",
    nameJa: "非常用おやつ収納",
    descriptionJa: "損傷で隠し蓋が開くと糖分と予備装甲を展開し、少しだけ粘る。",
    trigger: "durability-below",
    threshold: 0.35,
    effects: [
      { kind: "durability", amount: 9 },
      { kind: "physics-multiplier", stat: "mass", multiplier: 1.06, durationSec: 3 },
      { kind: "cleanse" }
    ]
  },
  {
    id: "suspicious-spare-screw",
    name: "Suspicious Spare Screw",
    nameJa: "怪しい余りネジ",
    descriptionJa: "命中時だけ妙に仕事をして攻撃を上げるが、姿勢精度には少し自信がない。",
    trigger: "on-hit",
    effects: [
      { kind: "stat-multiplier", stat: "attack", multiplier: 1.12, durationSec: 2.2 },
      { kind: "stat-multiplier", stat: "stability", multiplier: 0.96, durationSec: 2.2 }
    ]
  },
  {
    id: "meeting-escape-hatch",
    name: "Meeting Escape Hatch",
    nameJa: "会議脱出ハッチ",
    descriptionJa: "外周で長引く会議を検知すると一瞬だけ現実から離脱し、中央へ戻る。",
    trigger: "near-rim",
    threshold: 0.65,
    effects: [
      { kind: "phase", durationSec: 0.4 },
      { kind: "impulse", direction: "toward-center", strength: 1.6 }
    ]
  },
  {
    id: "victory-pose-buffer",
    name: "Victory Pose Buffer",
    nameJa: "勝利ポーズ先行予約",
    descriptionJa: "脱落者が出るたび早すぎる勝利ポーズで軌道を反転し、耐久を少し回復する。",
    trigger: "elimination",
    effects: [
      { kind: "reverse-orbit", durationSec: 3 },
      { kind: "durability", amount: 8 }
    ]
  },
  {
    id: "impact-cartographer",
    name: "Impact Cartographer",
    nameJa: "衝突地図",
    descriptionJa: "命中地点を学習し、次の進路変更と姿勢制御を精密化する。",
    trigger: "on-hit",
    effects: [
      { kind: "stat-multiplier", stat: "stability", multiplier: 1.1, durationSec: 3 },
      { kind: "stat-multiplier", stat: "mobility", multiplier: 1.08, durationSec: 3 }
    ]
  },
  {
    id: "terminal-ballast",
    name: "Terminal Ballast",
    nameJa: "終端バラスト",
    descriptionJa: "耐久が危険域へ入ると可動錘を固定し、質量と防御を底上げする。",
    trigger: "durability-below",
    threshold: 0.3,
    effects: [
      { kind: "physics-multiplier", stat: "mass", multiplier: 1.15, durationSec: 4 },
      { kind: "stat-multiplier", stat: "defense", multiplier: 1.14, durationSec: 4 }
    ]
  },
  {
    id: "aerogel-lattice",
    name: "Aerogel Lattice",
    nameJa: "エアロゲル格子",
    descriptionJa: "軽量格子が空気抵抗を減らしながら、装甲面の荷重を分散する。",
    trigger: "continuous",
    effects: [
      { kind: "physics-multiplier", stat: "drag", multiplier: 0.9 },
      { kind: "stat-multiplier", stat: "defense", multiplier: 1.05 }
    ]
  },
  {
    id: "rim-shepherd",
    name: "Rim Shepherd",
    nameJa: "リムシェパード",
    descriptionJa: "外周を検知すると接地力を高め、中央へ穏やかに軌道を戻す。",
    trigger: "near-rim",
    threshold: 0.7,
    effects: [
      { kind: "impulse", direction: "toward-center", strength: 2.6 },
      { kind: "physics-multiplier", stat: "friction", multiplier: 1.15, durationSec: 2 }
    ]
  },
  {
    id: "quiet-capacitor",
    name: "Quiet Capacitor",
    nameJa: "静穏キャパシタ",
    descriptionJa: "極低回転で蓄積電荷を解放し、回転とスキル循環を同時に補う。",
    trigger: "spin-below",
    threshold: 0.25,
    effects: [
      { kind: "spin", amount: 10 },
      { kind: "cooldown-shift", amountSec: -1 }
    ]
  },
  {
    id: "collision-checksum",
    name: "Collision Checksum",
    nameJa: "衝突チェックサム",
    descriptionJa: "被弾データを即時検証し、次の衝撃だけを抑える薄い防壁を生成する。",
    trigger: "on-take-hit",
    effects: [{ kind: "shield", amount: 20, durationSec: 1.3 }]
  },
  {
    id: "hunter-ledger",
    name: "Hunter Ledger",
    nameJa: "狩猟台帳",
    descriptionJa: "脱落を記録するたび攻撃系統を再調整し、回転も少量回収する。",
    trigger: "elimination",
    effects: [
      { kind: "stat-multiplier", stat: "attack", multiplier: 1.08, durationSec: 10 },
      { kind: "spin", amount: 3 }
    ]
  },
  /* ---- v3 additions: eight passives. Counts asserted in gates.ts (C08). ---- */
  {
    id: "combo-conductor",
    name: "Combo Conductor",
    nameJa: "コンボ指揮者",
    descriptionJa: "開幕から機動と攻撃をわずかに高める、連携特化の指揮系統。",
    trigger: "battle-start",
    effects: [
      { kind: "stat-multiplier", stat: "mobility", multiplier: 1.08, durationSec: 8 },
      { kind: "stat-multiplier", stat: "attack", multiplier: 1.05, durationSec: 8 }
    ]
  },
  {
    id: "phantom-hull",
    name: "Phantom Hull",
    nameJa: "ファントムハル",
    descriptionJa: "被弾の瞬間、船体が一拍だけ位相の外へ逃げる。",
    trigger: "on-take-hit",
    effects: [{ kind: "phase", durationSec: 0.5 }]
  },
  {
    id: "rim-magnet",
    name: "Rim Magnet",
    nameJa: "リムマグネット",
    descriptionJa: "縁に近づくと中心へ弱く引かれる保険装置。",
    trigger: "near-rim",
    threshold: 0.78,
    effects: [{ kind: "impulse", direction: "toward-center", strength: 2 }]
  },
  {
    id: "scavenger-coil",
    name: "Scavenger Coil",
    nameJa: "スカベンジャーコイル",
    descriptionJa: "敵を撃破するたび、残骸から回転を回収する。",
    trigger: "elimination",
    effects: [{ kind: "spin", amount: 10 }]
  },
  {
    id: "cold-start",
    name: "Cold Start",
    nameJa: "コールドスタート",
    descriptionJa: "回転が細ったとき、深いところから捻り戻す。",
    trigger: "spin-below",
    threshold: 0.4,
    effects: [{ kind: "spin", amount: 12 }]
  },
  {
    id: "counterweight",
    name: "Counterweight",
    nameJa: "カウンターウェイト",
    descriptionJa: "被弾のたび、質量をわずかに増して姿勢を守る。",
    trigger: "on-take-hit",
    effects: [
      { kind: "physics-multiplier", stat: "mass", multiplier: 1.06, durationSec: 2 }
    ]
  },
  {
    id: "spite-thorns",
    name: "Spite Thorns",
    nameJa: "スパイトソーン",
    descriptionJa: "打たれるほど攻撃が研がれる、負けん気の棘。",
    trigger: "on-take-hit",
    effects: [
      { kind: "stat-multiplier", stat: "attack", multiplier: 1.07, durationSec: 3 }
    ]
  },
  {
    id: "closing-argument",
    name: "Closing Argument",
    nameJa: "最終弁論",
    descriptionJa: "耐久が尽きかけたとき、全てを攻撃へ振り替える。",
    trigger: "durability-below",
    threshold: 0.3,
    effects: [
      { kind: "stat-multiplier", stat: "attack", multiplier: 1.2, durationSec: 5 },
      { kind: "stat-multiplier", stat: "defense", multiplier: 0.92, durationSec: 5 }
    ]
  }

] as const satisfies readonly PassiveSkillDef[];

/** Explicitly curated playful skills. Gates verify every ID is assigned to real parts. */
export const JOKE_ACTIVE_SKILL_IDS = [
  "emergency-ramen",
  "banana-orbit",
  "rubber-chicken-counter",
  "coffee-overfill",
  "monday-override",
  "deadline-dash",
  "popcorn-scatter"
] as const satisfies readonly (typeof ACTIVE_SKILLS)[number]["id"][];

export const JOKE_PASSIVE_SKILL_IDS = [
  "monday-resistance",
  "rubber-chicken-reflex",
  "coffee-drip-bearing",
  "emergency-snack-bay",
  "suspicious-spare-screw",
  "meeting-escape-hatch",
  "victory-pose-buffer"
] as const satisfies readonly (typeof PASSIVE_SKILLS)[number]["id"][];

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
