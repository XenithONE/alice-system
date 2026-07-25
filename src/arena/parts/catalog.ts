/**
 * SCRAP CROWN v2 — realistic combat-robot part catalog + preset bots.
 * Pure data only. Budget is POINTS (cost); mass is physics only.
 * Look: welded plate, titanium, UHMW, scorched steel — no toy brick palette.
 */
import type {
  BotSpec,
  Catalog,
  PartDef
} from "../sim/types";

/* ------------------------------------------------------------------ */
/* metal / paint palette (0xRRGGBB)                                     */
/* gun 0x2f3336 | raw steel 0x8d9299 | brass 0xb08d57 | rust 0x7a2f20  */
/* paint red 0xc8102e | paint blue 0x1b4a8f | hazard 0xe0a80d          */
/* scorched 0x3a3f45                                                    */
/* ------------------------------------------------------------------ */

export const PARTS: readonly PartDef[] = [
  /* ======================== chassis (4) ======================== */
  {
    id: "chassis-light",
    name: "Light Chassis",
    nameJa: "軽量シャーシ",
    category: "chassis",
    cost: 110,
    mass: 20,
    hp: 280,
    armor: 4,
    cells: [5, 7],
    deck: [5, 7],
    height: 0.1,
    groundClearance: 0.04,
    invertible: false,
    material: "aluminium",
    color: 0x2f3336,
    blurb: "機動重視の薄肉アルミデッキ。積載は控えめ。"
  },
  {
    id: "chassis-medium",
    name: "Medium Chassis",
    nameJa: "中量シャーシ",
    category: "chassis",
    cost: 160,
    mass: 32,
    hp: 380,
    armor: 8,
    cells: [7, 9],
    deck: [7, 9],
    height: 0.12,
    groundClearance: 0.05,
    invertible: false,
    material: "steel",
    color: 0x8d9299,
    blurb: "溶接鋼板の標準デッキ。多くの構成に対応。"
  },
  {
    id: "chassis-heavy",
    name: "Heavy Chassis",
    nameJa: "重量シャーシ",
    category: "chassis",
    cost: 230,
    mass: 48,
    hp: 520,
    armor: 14,
    cells: [9, 11],
    deck: [9, 11],
    height: 0.14,
    groundClearance: 0.05,
    invertible: false,
    material: "hardox",
    color: 0x3a3f45,
    blurb: "Hardox厚板の大甲板。重いが壊れにくい。"
  },
  {
    id: "chassis-invert",
    name: "Invertible Medium",
    nameJa: "インバーテッド中量シャーシ",
    category: "chassis",
    cost: 195,
    mass: 34,
    hp: 380,
    armor: 10,
    cells: [7, 9],
    deck: [7, 9],
    height: 0.12,
    groundClearance: 0.045,
    invertible: true,
    material: "steel",
    color: 0x2f3336,
    blurb: "上下対称デッキ。逆さでも走れる本格可逆設計。"
  },

  /* ======================== drive (6) ======================== */
  {
    id: "wheel-small",
    name: "Small Wheel",
    nameJa: "小ホイール",
    category: "drive",
    kind: "wheel",
    cost: 40,
    mass: 4,
    hp: 50,
    armor: 2,
    cells: [1, 1],
    height: 0.1,
    radius: 0.08,
    torque: 22,
    maxOmega: 55,
    friction: 1.0,
    material: "rubber",
    color: 0x3a3f45,
    blurb: "軽量高速。トルクは控えめ。"
  },
  {
    id: "wheel-mid",
    name: "Mid Wheel",
    nameJa: "中ホイール",
    category: "drive",
    kind: "wheel",
    cost: 45,
    mass: 8,
    hp: 70,
    armor: 4,
    cells: [2, 2],
    height: 0.14,
    radius: 0.12,
    torque: 40,
    maxOmega: 48,
    friction: 1.1,
    material: "rubber",
    color: 0x3a3f45,
    blurb: "標準サイズ。トルクと速度のバランス型。"
  },
  {
    id: "wheel-large",
    name: "Large Wheel",
    nameJa: "大ホイール",
    category: "drive",
    kind: "wheel",
    cost: 50,
    mass: 12,
    hp: 85,
    armor: 6,
    cells: [2, 3],
    height: 0.18,
    radius: 0.16,
    torque: 62,
    maxOmega: 35,
    friction: 1.2,
    material: "rubber",
    color: 0x3a3f45,
    blurb: "高トルクの大径輪。段差と押し合いに強い。"
  },
  {
    id: "wheel-grip",
    name: "High-Grip Wheel",
    nameJa: "高グリップホイール",
    category: "drive",
    kind: "wheel",
    cost: 48,
    mass: 7,
    hp: 65,
    armor: 3,
    cells: [2, 2],
    height: 0.13,
    radius: 0.11,
    torque: 36,
    maxOmega: 45,
    friction: 1.45,
    material: "rubber",
    color: 0x1b4a8f,
    blurb: "高μコンパウンド。押し合いと旋回に強い。"
  },
  {
    id: "track-std",
    name: "Track Drive",
    nameJa: "履帯",
    category: "drive",
    kind: "track",
    cost: 90,
    mass: 16,
    hp: 115,
    armor: 10,
    cells: [2, 4],
    height: 0.12,
    radius: 0.1,
    torque: 58,
    maxOmega: 16,
    friction: 1.6,
    material: "steel",
    color: 0x2f3336,
    blurb: "低速高牽引。最高速は落ちるが押しが強い。"
  },
  {
    id: "hub-invert",
    name: "Invertible Hub",
    nameJa: "インバーテッド対応ハブ",
    category: "drive",
    kind: "wheel",
    cost: 95,
    mass: 15,
    hp: 110,
    armor: 8,
    cells: [2, 2],
    height: 0.12,
    radius: 0.11,
    torque: 60,
    maxOmega: 18,
    friction: 1.55,
    material: "steel",
    color: 0x8d9299,
    blurb: "上下両用ハブ。可逆シャーシと組んで逆走を維持。"
  },

  /* ======================== weapon passive (4) ======================== */
  {
    id: "disc-light",
    mechanism: "revolute",
    spinAxis: "horizontal",
    name: "Light Horizontal Disc",
    nameJa: "軽量水平ディスク",
    category: "weapon",
    action: "passive",
    effect: "spin",
    slot: "primary",
    cost: 290,
    mass: 24,
    hp: 160,
    armor: 4,
    cells: [4, 2],
    height: 0.08,
    material: "steel",
    color: 0xc8102e,
    blurb: "軽めの水平スピナー。立ち上がりが速い。",
    damageMul: 2.4,
    selfDamageMul: 0.25,
    reach: 0.18,
    maxOmega: 240,
    spinUpTorque: 40,
    inertia: 0.55
  },
  {
    id: "disc-heavy",
    mechanism: "revolute",
    spinAxis: "horizontal",
    name: "Heavy Horizontal Disc",
    nameJa: "重量水平ディスク",
    category: "weapon",
    action: "passive",
    effect: "spin",
    slot: "primary",
    cost: 380,
    mass: 30,
    hp: 200,
    armor: 6,
    cells: [5, 2],
    height: 0.1,
    material: "hardox",
    color: 0xc8102e,
    blurb: "一撃の重い水平スピナー。自傷にも注意。",
    damageMul: 2.8,
    selfDamageMul: 0.25,
    reach: 0.22,
    maxOmega: 200,
    spinUpTorque: 55,
    inertia: 0.95
  },
  {
    id: "drum-std",
    mechanism: "revolute",
    spinAxis: "vertical",
    name: "Vertical Drum",
    nameJa: "垂直ドラム",
    category: "weapon",
    action: "passive",
    effect: "spin",
    slot: "primary",
    cost: 340,
    mass: 32,
    hp: 240,
    armor: 8,
    cells: [4, 3],
    height: 0.16,
    material: "steel",
    color: 0x7a2f20,
    blurb: "縦回転ドラム。安定した継続火力とすくい上げ。",
    damageMul: 2.1,
    selfDamageMul: 0.22,
    reach: 0.14,
    maxOmega: 145,
    spinUpTorque: 70,
    inertia: 1.6
  },
  {
    id: "side-saws",
    mechanism: "revolute",
    spinAxis: "horizontal",
    pairMount: true,
    name: "Side Saws",
    nameJa: "サイドソー",
    category: "weapon",
    action: "passive",
    effect: "grind",
    slot: "primary",
    cost: 180,
    mass: 13,
    hp: 110,
    armor: 3,
    cells: [2, 2],
    height: 0.08,
    material: "steel",
    color: 0x8d9299,
    blurb: "左右に常時回転する切断ソー。寄られても削る。",
    damageMul: 1.15,
    selfDamageMul: 0.15,
    reach: 0.12,
    maxOmega: 290,
    spinUpTorque: 25,
    inertia: 0.22,
    dps: 28
  },

  /* ======================== weapon held (4) ======================== */
  {
    id: "flamethrower",
    mechanism: "fixed",
    name: "Flamethrower",
    nameJa: "火炎放射器",
    category: "weapon",
    action: "held",
    effect: "flame",
    slot: "primary",
    cost: 280,
    mass: 17,
    hp: 110,
    armor: 2,
    cells: [3, 2],
    height: 0.12,
    material: "brass",
    color: 0xb08d57,
    blurb: "燃料式火炎放射。装甲をほぼ無視して燃やす。",
    damageMul: 1.0,
    selfDamageMul: 0,
    reach: 0.3,
    dps: 32,
    coneAngle: 0.38,
    coneRange: 2.6,
    fuel: 7.5,
    refuelRate: 0.3
  },
  {
    id: "cutting-disc",
    mechanism: "revolute",
    spinAxis: "horizontal",
    name: "Cutting Disc",
    nameJa: "カッティングディスク",
    category: "weapon",
    action: "held",
    effect: "grind",
    slot: "primary",
    cost: 200,
    mass: 12,
    hp: 100,
    armor: 2,
    cells: [2, 2],
    height: 0.08,
    material: "steel",
    color: 0xe0a80d,
    blurb: "押している間だけ高回転切断。燃料不要。",
    damageMul: 1.2,
    selfDamageMul: 0.1,
    reach: 0.1,
    maxOmega: 300,
    spinUpTorque: 30,
    inertia: 0.18,
    dps: 38,
    fuel: 0
  },
  {
    id: "angle-grinder",
    mechanism: "revolute",
    spinAxis: "vertical",
    name: "Angle Grinder",
    nameJa: "アングルグラインダ",
    category: "weapon",
    action: "held",
    effect: "grind",
    slot: "secondary",
    cost: 130,
    mass: 10,
    hp: 90,
    armor: 2,
    cells: [2, 2],
    height: 0.07,
    material: "steel",
    color: 0x8d9299,
    blurb: "安価な補助グラインダ。押している間だけ削る。",
    damageMul: 1.0,
    selfDamageMul: 0.12,
    reach: 0.08,
    maxOmega: 280,
    spinUpTorque: 20,
    inertia: 0.12,
    dps: 22,
    fuel: 0
  },
  {
    id: "shell-spinner",
    mechanism: "revolute",
    spinAxis: "vertical",
    name: "Shell Spinner",
    nameJa: "シェルスピナー",
    category: "weapon",
    action: "held",
    effect: "spin",
    slot: "primary",
    cost: 360,
    mass: 34,
    hp: 250,
    armor: 10,
    cells: [5, 3],
    height: 0.18,
    material: "hardox",
    color: 0x3a3f45,
    blurb: "殻ごと回す重量スピナー。押している間だけ加速。",
    damageMul: 2.0,
    selfDamageMul: 0.25,
    reach: 0.16,
    maxOmega: 140,
    spinUpTorque: 65,
    inertia: 1.8
  },

  /* ======================== weapon triggered (5) ======================== */
  {
    id: "flipper-std",
    mechanism: "revolute",
    launch: "flip",
    name: "Pneumatic Flipper",
    nameJa: "空圧フリッパー",
    category: "weapon",
    action: "triggered",
    effect: "impulse",
    slot: "primary",
    cost: 320,
    mass: 25,
    hp: 210,
    armor: 6,
    cells: [4, 3],
    height: 0.1,
    material: "steel",
    color: 0xe0a80d,
    blurb: "空圧で相手を宙に舞わせる。ピット送りの本命。",
    damageMul: 0.75,
    selfDamageMul: 0.05,
    reach: 0.2,
    impulse: 1200,
    cooldown: 2.5,
    sweep: 1.2,
    strokeSec: 0.18
  },
  {
    id: "lifter-std",
    mechanism: "revolute",
    launch: "flip",
    name: "Electric Lifter",
    nameJa: "電動リフター",
    category: "weapon",
    action: "triggered",
    effect: "impulse",
    slot: "primary",
    cost: 230,
    mass: 20,
    hp: 200,
    armor: 6,
    cells: [4, 3],
    height: 0.1,
    material: "steel",
    color: 0xb08d57,
    blurb: "遅いが制御しやすい電動リフト。持ち上げて運ぶ。",
    damageMul: 0.6,
    selfDamageMul: 0.05,
    reach: 0.18,
    impulse: 650,
    cooldown: 1.7,
    sweep: 1.15,
    strokeSec: 0.25
  },
  {
    id: "spear-std",
    mechanism: "prismatic",
    launch: "punch",
    name: "Telescopic Spear",
    nameJa: "飛び出すスピア",
    category: "weapon",
    action: "triggered",
    effect: "impulse",
    slot: "primary",
    cost: 290,
    mass: 18,
    hp: 165,
    armor: 4,
    cells: [3, 2],
    height: 0.1,
    material: "steel",
    color: 0x8d9299,
    blurb: "油圧で突き出す槍。一点に穿つ。sweepは伸び量[m]。",
    damageMul: 1.5,
    selfDamageMul: 0.08,
    reach: 0.55,
    impulse: 900,
    cooldown: 2.1,
    sweep: 0.55,
    strokeSec: 0.13
  },
  {
    id: "axe-hammer",
    mechanism: "revolute",
    launch: "punch",
    name: "Axe Hammer",
    nameJa: "アックス／ハンマー",
    category: "weapon",
    action: "triggered",
    effect: "impulse",
    slot: "primary",
    cost: 220,
    mass: 20,
    hp: 190,
    armor: 5,
    cells: [3, 3],
    height: 0.22,
    material: "steel",
    color: 0x7a2f20,
    blurb: "頭上から叩き込む斧／ハンマー。連打で装甲を割る。",
    damageMul: 1.4,
    selfDamageMul: 0.1,
    reach: 0.28,
    impulse: 700,
    cooldown: 1.6,
    sweep: 1.9,
    strokeSec: 0.2
  },
  {
    id: "crusher-jaws",
    mechanism: "revolute",
    name: "Crusher Jaws",
    nameJa: "クラッシャー顎",
    category: "weapon",
    action: "triggered",
    effect: "clamp",
    slot: "secondary",
    cost: 340,
    mass: 28,
    hp: 230,
    armor: 8,
    cells: [4, 3],
    height: 0.14,
    material: "hardox",
    color: 0x3a3f45,
    blurb: "掴んで潰す油圧顎。保持中に装甲を噛み砕く。",
    damageMul: 1.0,
    selfDamageMul: 0.08,
    reach: 0.15,
    dps: 36,
    holdSec: 3.2,
    cooldown: 3.5
  },

  /* ======================== weapon static (3) ======================== */
  {
    id: "wedge-std",
    mechanism: "fixed",
    name: "Control Wedge",
    nameJa: "ウェッジ",
    category: "weapon",
    action: "passive",
    effect: "static",
    slot: "secondary",
    cost: 90,
    mass: 12,
    hp: 260,
    armor: 18,
    cells: [5, 2],
    height: 0.08,
    material: "steel",
    color: 0x8d9299,
    blurb: "相手をすくい上げる制御ウェッジ。耐久と判定向き。",
    damageMul: 0.3,
    selfDamageMul: 0,
    reach: 0.16
  },
  {
    id: "forks-std",
    mechanism: "fixed",
    name: "Front Forks",
    nameJa: "フォーク",
    category: "weapon",
    action: "passive",
    effect: "static",
    slot: "secondary",
    cost: 85,
    mass: 12,
    hp: 240,
    armor: 14,
    cells: [5, 2],
    height: 0.07,
    material: "steel",
    color: 0x8d9299,
    blurb: "相手の下に潜る前方フォーク。すくいと固定。",
    damageMul: 0.25,
    selfDamageMul: 0,
    reach: 0.2
  },
  {
    id: "spike-rack",
    mechanism: "fixed",
    name: "Spike Rack",
    nameJa: "スパイクラック",
    category: "weapon",
    action: "passive",
    effect: "static",
    slot: "secondary",
    cost: 75,
    mass: 10,
    hp: 220,
    armor: 12,
    cells: [3, 2],
    height: 0.09,
    material: "steel",
    color: 0x2f3336,
    blurb: "固定スパイク列。体当たりの一点集中。",
    damageMul: 0.4,
    selfDamageMul: 0,
    reach: 0.12
  },

  /* ======================== armor (6) ======================== */
  {
    id: "plate-steel",
    name: "Steel Plate",
    nameJa: "鋼板",
    category: "armor",
    cost: 70,
    mass: 12,
    hp: 280,
    armor: 22,
    cells: [3, 2],
    height: 0.05,
    material: "steel",
    color: 0x8d9299,
    blurb: "安くて重い普通鋼板。コスト効率の防壁。"
  },
  {
    id: "plate-titanium",
    name: "Titanium Plate",
    nameJa: "チタン板",
    category: "armor",
    cost: 160,
    mass: 6,
    hp: 260,
    armor: 20,
    cells: [3, 2],
    height: 0.04,
    material: "titanium",
    color: 0x8d9299,
    blurb: "軽くて高価なチタン板。機動を落とさず守る。"
  },
  {
    id: "armor-uhmw",
    name: "UHMW Polymer",
    nameJa: "UHMWポリマー",
    category: "armor",
    cost: 110,
    mass: 8,
    hp: 220,
    armor: 14,
    cells: [3, 2],
    height: 0.06,
    material: "polymer",
    color: 0x2f3336,
    blurb: "スピナー衝撃を散らす超高分子ポリエチレン。",
    spinnerResist: 0.55
  },
  {
    id: "skirt-hardox",
    name: "Hardox Skirt",
    nameJa: "Hardoxスカート",
    category: "armor",
    cost: 100,
    mass: 10,
    hp: 250,
    armor: 20,
    cells: [1, 4],
    height: 0.05,
    material: "hardox",
    color: 0x3a3f45,
    blurb: "側面を覆うHardox製スカート。横槍を散らす。"
  },
  {
    id: "heat-shield",
    name: "Heat Shield",
    nameJa: "耐熱シールド",
    category: "armor",
    cost: 120,
    mass: 9,
    hp: 200,
    armor: 12,
    cells: [3, 3],
    height: 0.05,
    material: "titanium",
    color: 0x7a2f20,
    blurb: "火炎と残火に効く耐熱シールド。",
    flameResist: 0.35
  },
  {
    id: "rail-anti-spinner",
    name: "Anti-Spinner Rail",
    nameJa: "アンチスピナー・レール",
    category: "armor",
    cost: 130,
    mass: 11,
    hp: 240,
    armor: 18,
    cells: [4, 1],
    height: 0.06,
    material: "hardox",
    color: 0x2f3336,
    blurb: "スピナーを受け流す前面レール。",
    spinnerResist: 0.5
  },

  /* ======================== utility (4) ======================== */
  {
    id: "util-self-right",
    name: "Self-Right Module",
    nameJa: "セルフライト機構",
    category: "utility",
    cost: 120,
    mass: 6,
    hp: 80,
    armor: 2,
    cells: [2, 2],
    height: 0.08,
    material: "steel",
    color: 0xb08d57,
    blurb: "反転復帰を可能にする機構。クールダウンあり。",
    selfRight: true
  },
  {
    id: "util-power-cell",
    name: "Power Cell",
    nameJa: "パワーセル",
    category: "utility",
    cost: 140,
    mass: 9,
    hp: 70,
    armor: 2,
    cells: [2, 2],
    height: 0.08,
    material: "brass",
    color: 0xe0a80d,
    blurb: "駆動トルクを底上げする高出力電源。",
    powerMul: 1.15
  },
  {
    id: "util-weapon-boost",
    name: "Weapon Booster",
    nameJa: "武器ブースター",
    category: "utility",
    cost: 160,
    mass: 8,
    hp: 75,
    armor: 2,
    cells: [2, 2],
    height: 0.08,
    material: "brass",
    color: 0xc8102e,
    blurb: "武器の加速トルクを底上げするブースター。",
    weaponPowerMul: 1.2
  },
  {
    id: "util-light-frame",
    name: "Lightweight Frame",
    nameJa: "軽量フレーム",
    category: "utility",
    cost: 90,
    mass: 5,
    hp: 65,
    armor: 1,
    cells: [2, 1],
    height: 0.04,
    material: "carbon",
    color: 0x2f3336,
    blurb: "炭素繊維の軽量補強。わずかな質量で剛性を足す。"
  }
];

/* ------------------------------------------------------------------ */
/* presets — cost / drive / weapon slots / deck / no-overlap by hand  */
/* ------------------------------------------------------------------ */

export const PRESETS: readonly BotSpec[] = [
  // spin-king: chassis medium (cost 160 / 32kg)
  //   wheel-mid x4 (45*4=180 / 32kg) @ (0,2)(5,2)(0,6)(5,6)
  //   disc-heavy (380 / 30kg) @ (1,0) 5x2           [primary]
  //   plate-steel (70 / 12kg) @ (2,4) 3x2
  //   util-self-right (120 / 6kg) @ (2,7) 2x2
  //   合計 cost 910 / 1000, mass 112kg, 占有セル重複なし
  {
    v: 2,
    name: "spin-king",
    chassisId: "chassis-medium",
    paint: 0xc8102e,
    parts: [
      { partId: "wheel-mid", cell: [0, 2], rot: 0 },
      { partId: "wheel-mid", cell: [5, 2], rot: 0 },
      { partId: "wheel-mid", cell: [0, 6], rot: 0 },
      { partId: "wheel-mid", cell: [5, 6], rot: 0 },
      { partId: "disc-heavy", cell: [1, 0], rot: 0 },
      { partId: "plate-steel", cell: [2, 4], rot: 0 },
      { partId: "util-self-right", cell: [2, 7], rot: 0 }
    ]
  },

  // flip-jack: chassis medium (cost 160 / 32kg)
  //   wheel-grip x4 (48*4=192 / 28kg) @ (0,3)(5,3)(0,5)(5,5)
  //   flipper-std (320 / 25kg) @ (1,0) 4x3         [primary]
  //   wedge-std (90 / 12kg) @ (1,7) 5x2            [secondary]
  //   util-self-right (120 / 6kg) @ (2,3) 2x2
  //   合計 cost 882 / 1000, mass 103kg, 占有セル重複なし
  {
    v: 2,
    name: "flip-jack",
    chassisId: "chassis-medium",
    paint: 0xe0a80d,
    parts: [
      { partId: "wheel-grip", cell: [0, 3], rot: 0 },
      { partId: "wheel-grip", cell: [5, 3], rot: 0 },
      { partId: "wheel-grip", cell: [0, 5], rot: 0 },
      { partId: "wheel-grip", cell: [5, 5], rot: 0 },
      { partId: "flipper-std", cell: [1, 0], rot: 0 },
      { partId: "wedge-std", cell: [1, 7], rot: 0 },
      { partId: "util-self-right", cell: [2, 3], rot: 0 }
    ]
  },

  // brick-wall: chassis heavy (cost 230 / 48kg)
  //   track-std x2 (90*2=180 / 32kg) @ (0,3)(7,3)
  //   side-saws (180 / 13kg) @ (3,2) 2x2           [primary]
  //   wedge-std (90 / 12kg) @ (2,0) 5x2            [secondary]
  //   plate-steel (70 / 12kg) @ (3,6) 3x2
  //   armor-uhmw (110 / 8kg) @ (3,8) 3x2
  //   合計 cost 860 / 1000, mass 125kg, 占有セル重複なし
  {
    v: 2,
    name: "brick-wall",
    chassisId: "chassis-heavy",
    paint: 0x8d9299,
    parts: [
      { partId: "track-std", cell: [0, 3], rot: 0 },
      { partId: "track-std", cell: [7, 3], rot: 0 },
      { partId: "side-saws", cell: [3, 2], rot: 0 },
      { partId: "wedge-std", cell: [2, 0], rot: 0 },
      { partId: "plate-steel", cell: [3, 6], rot: 0 },
      { partId: "armor-uhmw", cell: [3, 8], rot: 0 }
    ]
  },

  // drum-runner: chassis light (cost 110 / 20kg)
  //   wheel-small x4 (40*4=160 / 16kg) @ (0,3)(4,3)(0,6)(4,6)
  //   drum-std (340 / 32kg) @ (0,0) 4x3            [primary]
  //   util-power-cell (140 / 9kg) @ (1,4) 2x2
  //   util-light-frame (90 / 5kg) @ (1,6) 2x1
  //   合計 cost 840 / 1000, mass 82kg, 占有セル重複なし
  {
    v: 2,
    name: "drum-runner",
    chassisId: "chassis-light",
    paint: 0x1b4a8f,
    parts: [
      { partId: "wheel-small", cell: [0, 3], rot: 0 },
      { partId: "wheel-small", cell: [4, 3], rot: 0 },
      { partId: "wheel-small", cell: [0, 6], rot: 0 },
      { partId: "wheel-small", cell: [4, 6], rot: 0 },
      { partId: "drum-std", cell: [0, 0], rot: 0 },
      { partId: "util-power-cell", cell: [1, 4], rot: 0 },
      { partId: "util-light-frame", cell: [1, 6], rot: 0 }
    ]
  },

  // pyro: chassis medium (cost 160 / 32kg)
  //   wheel-mid x4 (45*4=180 / 32kg) @ (0,1)(5,1)(0,5)(5,5)
  //   flamethrower (280 / 17kg) @ (2,0) 3x2        [primary]
  //   forks-std (85 / 12kg) @ (1,7) 5x2            [secondary]
  //   heat-shield (120 / 9kg) @ (2,3) 3x3
  //   合計 cost 825 / 1000, mass 102kg, 占有セル重複なし
  {
    v: 2,
    name: "pyro",
    chassisId: "chassis-medium",
    paint: 0x7a2f20,
    parts: [
      { partId: "wheel-mid", cell: [0, 1], rot: 0 },
      { partId: "wheel-mid", cell: [5, 1], rot: 0 },
      { partId: "wheel-mid", cell: [0, 5], rot: 0 },
      { partId: "wheel-mid", cell: [5, 5], rot: 0 },
      { partId: "flamethrower", cell: [2, 0], rot: 0 },
      { partId: "forks-std", cell: [1, 7], rot: 0 },
      { partId: "heat-shield", cell: [2, 3], rot: 0 }
    ]
  },

  // impaler: chassis medium (cost 160 / 32kg)
  //   wheel-mid x4 (45*4=180 / 32kg) @ (0,5)(5,5)(0,7)(5,7)
  //   spear-std (290 / 18kg) @ (2,0) 3x2           [primary]
  //   crusher-jaws (340 / 28kg) @ (1,2) 4x3        [secondary]
  //   合計 cost 970 / 1000, mass 110kg, 占有セル重複なし
  {
    v: 2,
    name: "impaler",
    chassisId: "chassis-medium",
    paint: 0x3a3f45,
    parts: [
      { partId: "wheel-mid", cell: [0, 5], rot: 0 },
      { partId: "wheel-mid", cell: [5, 5], rot: 0 },
      { partId: "wheel-mid", cell: [0, 7], rot: 0 },
      { partId: "wheel-mid", cell: [5, 7], rot: 0 },
      { partId: "spear-std", cell: [2, 0], rot: 0 },
      { partId: "crusher-jaws", cell: [1, 2], rot: 0 }
    ]
  }
];

export function buildCatalog(): Catalog {
  const byId = new Map<string, PartDef>();
  for (const part of PARTS) {
    byId.set(part.id, part);
  }
  return {
    parts: PARTS,
    presets: PRESETS,
    byId
  };
}
