/**
 * SCRAP CROWN — part catalog + preset bots.
 * Pure data only. Numbers stay inside ARCHITECTURE.md balance envelopes.
 */
import type {
  BotSpec,
  Catalog,
  PartDef
} from "../sim/types";

/* ------------------------------------------------------------------ */
/* brick palette (0xRRGGBB)                                             */
/* #c91a09 #0055bf #f2cd37 #4b9f4a #f4f4f4 #6c6e68 #a0a5a9            */
/* ------------------------------------------------------------------ */

export const PARTS: readonly PartDef[] = [
  /* ======================== chassis (3) ======================== */
  {
    id: "chassis-light",
    name: "Light Frame",
    nameJa: "軽量シャーシ",
    category: "chassis",
    mass: 20,
    hp: 280,
    armor: 4,
    cells: [5, 7],
    deck: [5, 7],
    height: 0.1,
    groundClearance: 0.04,
    color: 0x6c6e68,
    blurb: "機動重視の軽量デッキ。積載は控えめ。"
  },
  {
    id: "chassis-medium",
    name: "Medium Frame",
    nameJa: "中量シャーシ",
    category: "chassis",
    mass: 32,
    hp: 380,
    armor: 8,
    cells: [7, 9],
    deck: [7, 9],
    height: 0.12,
    groundClearance: 0.05,
    color: 0xa0a5a9,
    blurb: "バランス型の標準デッキ。多くの構成に対応。"
  },
  {
    id: "chassis-heavy",
    name: "Heavy Frame",
    nameJa: "重量シャーシ",
    category: "chassis",
    mass: 48,
    hp: 520,
    armor: 14,
    cells: [9, 11],
    deck: [9, 11],
    height: 0.14,
    groundClearance: 0.05,
    color: 0x6c6e68,
    blurb: "耐久最優先の大甲板。重いが壊れにくい。"
  },

  /* ======================== drive (5) ======================== */
  {
    id: "wheel-small",
    name: "Small Wheel",
    nameJa: "小ホイール",
    category: "drive",
    kind: "wheel",
    mass: 4,
    hp: 50,
    armor: 2,
    cells: [1, 1],
    height: 0.1,
    radius: 0.08,
    torque: 22,
    maxOmega: 72,
    friction: 1.0,
    color: 0x6c6e68,
    blurb: "軽量高速。トルクは控えめ。"
  },
  {
    id: "wheel-mid",
    name: "Mid Wheel",
    nameJa: "中ホイール",
    category: "drive",
    kind: "wheel",
    mass: 8,
    hp: 70,
    armor: 4,
    cells: [2, 2],
    height: 0.14,
    radius: 0.12,
    torque: 40,
    maxOmega: 52,
    friction: 1.1,
    color: 0x6c6e68,
    blurb: "標準サイズ。トルクと速度のバランス型。"
  },
  {
    id: "wheel-large",
    name: "Large Wheel",
    nameJa: "大ホイール",
    category: "drive",
    kind: "wheel",
    mass: 12,
    hp: 85,
    armor: 6,
    cells: [2, 3],
    height: 0.18,
    radius: 0.16,
    torque: 62,
    maxOmega: 38,
    friction: 1.2,
    color: 0x6c6e68,
    blurb: "高トルクの大径輪。段差に強い。"
  },
  {
    id: "wheel-grip",
    name: "High-Grip Wheel",
    nameJa: "高グリップホイール",
    category: "drive",
    kind: "wheel",
    mass: 7,
    hp: 65,
    armor: 3,
    cells: [2, 2],
    height: 0.13,
    radius: 0.11,
    torque: 36,
    maxOmega: 48,
    friction: 1.4,
    color: 0x0055bf,
    blurb: "高μコンパウンド。押し合いと旋回に強い。"
  },
  {
    id: "track-std",
    name: "Track Drive",
    nameJa: "履帯",
    category: "drive",
    kind: "track",
    mass: 16,
    hp: 120,
    armor: 10,
    cells: [2, 4],
    height: 0.12,
    radius: 0.1,
    torque: 55,
    maxOmega: 28,
    friction: 1.6,
    color: 0x6c6e68,
    blurb: "低速高牽引。最高速は落ちるが押しが強い。"
  },

  /* ======================== weapon (7) ======================== */
  {
    id: "disc-light",
    name: "Light Disc",
    nameJa: "軽量ディスク",
    category: "weapon",
    motion: "spin",
    mass: 24,
    hp: 160,
    armor: 4,
    cells: [4, 2],
    height: 0.08,
    color: 0xc91a09,
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
    name: "Heavy Disc",
    nameJa: "重量ディスク",
    category: "weapon",
    motion: "spin",
    mass: 30,
    hp: 200,
    armor: 6,
    cells: [5, 2],
    height: 0.1,
    color: 0xc91a09,
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
    name: "Drum Spinner",
    nameJa: "ドラムスピナー",
    category: "weapon",
    motion: "spin",
    mass: 32,
    hp: 240,
    armor: 8,
    cells: [4, 3],
    height: 0.16,
    color: 0xc91a09,
    blurb: "縦回転ドラム。安定した継続火力。",
    damageMul: 2.1,
    selfDamageMul: 0.25,
    reach: 0.14,
    maxOmega: 150,
    spinUpTorque: 70,
    inertia: 1.6
  },
  {
    id: "flipper-std",
    name: "Pneumatic Flipper",
    nameJa: "フリッパー",
    category: "weapon",
    motion: "swing",
    mass: 26,
    hp: 210,
    armor: 6,
    cells: [4, 3],
    height: 0.1,
    color: 0xf2cd37,
    blurb: "相手を宙に舞わせピットへ。判定向きの制御武器。",
    damageMul: 0.75,
    selfDamageMul: 0.05,
    reach: 0.2,
    impulse: 1200,
    cooldown: 2.5,
    sweep: 1.2
  },
  {
    id: "hammer-std",
    name: "Overhead Hammer",
    nameJa: "ハンマー",
    category: "weapon",
    motion: "swing",
    mass: 22,
    hp: 190,
    armor: 5,
    cells: [3, 3],
    height: 0.22,
    color: 0xf2cd37,
    blurb: "頭上から叩き込む。連打で装甲を割る。",
    damageMul: 1.4,
    selfDamageMul: 0.1,
    reach: 0.28,
    impulse: 700,
    cooldown: 1.6,
    sweep: 1.6
  },
  {
    id: "saw-std",
    name: "Cutting Saw",
    nameJa: "ソー",
    category: "weapon",
    motion: "spin",
    mass: 13,
    hp: 110,
    armor: 2,
    cells: [2, 2],
    height: 0.08,
    color: 0xa0a5a9,
    blurb: "高回転の切断ソー。継続ダメージ寄り。",
    damageMul: 1.1,
    selfDamageMul: 0.15,
    reach: 0.12,
    maxOmega: 300,
    spinUpTorque: 25,
    inertia: 0.2
  },
  {
    id: "wedge-std",
    name: "Control Wedge",
    nameJa: "ウェッジ",
    category: "weapon",
    motion: "none",
    mass: 12,
    hp: 260,
    armor: 18,
    cells: [5, 2],
    height: 0.08,
    color: 0xf4f4f4,
    blurb: "相手をすくい上げ耐久で判定勝ちを狙う。",
    damageMul: 0.3,
    selfDamageMul: 0,
    reach: 0.16
  },

  /* ======================== armor (4) ======================== */
  {
    id: "plate-thin",
    name: "Thin Plate",
    nameJa: "薄板装甲",
    category: "armor",
    mass: 6,
    hp: 220,
    armor: 12,
    cells: [2, 2],
    height: 0.04,
    color: 0xa0a5a9,
    blurb: "軽い薄板。急所を手軽に守る。"
  },
  {
    id: "plate-thick",
    name: "Thick Plate",
    nameJa: "厚板装甲",
    category: "armor",
    mass: 12,
    hp: 320,
    armor: 24,
    cells: [3, 2],
    height: 0.06,
    color: 0x6c6e68,
    blurb: "重い厚板。正面の交換に耐える。"
  },
  {
    id: "armor-wedge",
    name: "Wedge Armor",
    nameJa: "楔形前面装甲",
    category: "armor",
    mass: 10,
    hp: 280,
    armor: 20,
    cells: [4, 2],
    height: 0.07,
    color: 0xf4f4f4,
    blurb: "前面をすくう楔形装甲。下に潜られるのを防ぐ。"
  },
  {
    id: "side-skirt",
    name: "Side Skirt",
    nameJa: "側面スカート",
    category: "armor",
    mass: 8,
    hp: 240,
    armor: 16,
    cells: [1, 4],
    height: 0.05,
    color: 0xa0a5a9,
    blurb: "側面を覆うスカート。横からの攻撃を散らす。"
  },

  /* ======================== utility (3) ======================== */
  {
    id: "util-self-right",
    name: "Self-Right Module",
    nameJa: "セルフライト機構",
    category: "utility",
    mass: 6,
    hp: 80,
    armor: 2,
    cells: [2, 2],
    height: 0.08,
    color: 0x4b9f4a,
    blurb: "反転復帰を可能にする機構。クールダウンあり。",
    selfRight: true
  },
  {
    id: "util-battery",
    name: "High-Capacity Battery",
    nameJa: "大容量バッテリ",
    category: "utility",
    mass: 9,
    hp: 70,
    armor: 2,
    cells: [2, 2],
    height: 0.08,
    color: 0xf2cd37,
    blurb: "駆動トルクを底上げする大容量電源。",
    powerMul: 1.15
  },
  {
    id: "util-light-frame",
    name: "Lightweight Frame",
    nameJa: "軽量化フレーム",
    category: "utility",
    mass: 3,
    hp: 50,
    armor: 1,
    cells: [2, 1],
    height: 0.04,
    color: 0x4b9f4a,
    blurb: "軽量補強フレーム。わずかな質量で剛性を足す。"
  }
];

/* ------------------------------------------------------------------ */
/* presets — mass / drive / weapon / deck / no-overlap checked by hand */
/* ------------------------------------------------------------------ */

export const PRESETS: readonly BotSpec[] = [
  // spin-king: chassis medium 7x9 (32kg)
  //   wheel-mid      x4 @ (0,2)(5,2)(0,6)(5,6)  2x2 each -> 8*4 = 32kg
  //   disc-heavy     x1 @ (1,0) 5x2             -> 30kg
  //   plate-thin     x1 @ (2,4) 2x2             -> 6kg
  //   util-self-right x1 @ (2,7) 2x2            -> 6kg
  //   合計 32+32+30+6+6 = 106kg / 占有セル 重複なし
  //   deck内: x0-6 z0-8。disc z0-1 / wheels z2-3&z6-7 / plate z4-5 / util z7-8
  {
    v: 1,
    name: "spin-king",
    chassisId: "chassis-medium",
    paint: 0xc91a09,
    parts: [
      { partId: "wheel-mid", cell: [0, 2], rot: 0 },
      { partId: "wheel-mid", cell: [5, 2], rot: 0 },
      { partId: "wheel-mid", cell: [0, 6], rot: 0 },
      { partId: "wheel-mid", cell: [5, 6], rot: 0 },
      { partId: "disc-heavy", cell: [1, 0], rot: 0 },
      { partId: "plate-thin", cell: [2, 4], rot: 0 },
      { partId: "util-self-right", cell: [2, 7], rot: 0 }
    ]
  },

  // flip-jack: chassis medium 7x9 (32kg)
  //   wheel-grip     x4 @ (0,3)(5,3)(0,6)(5,6)  2x2 each -> 7*4 = 28kg
  //   flipper-std    x1 @ (1,0) 4x3             -> 26kg
  //   util-self-right x1 @ (2,4) 2x2            -> 6kg
  //   plate-thin     x1 @ (2,7) 2x2             -> 6kg
  //   合計 32+28+26+6+6 = 98kg / 占有セル 重複なし
  //   flipper x1-4 z0-2 / grip z3-4&z6-7 / util z4-5 / plate z7-8
  {
    v: 1,
    name: "flip-jack",
    chassisId: "chassis-medium",
    paint: 0xf2cd37,
    parts: [
      { partId: "wheel-grip", cell: [0, 3], rot: 0 },
      { partId: "wheel-grip", cell: [5, 3], rot: 0 },
      { partId: "wheel-grip", cell: [0, 6], rot: 0 },
      { partId: "wheel-grip", cell: [5, 6], rot: 0 },
      { partId: "flipper-std", cell: [1, 0], rot: 0 },
      { partId: "util-self-right", cell: [2, 4], rot: 0 },
      { partId: "plate-thin", cell: [2, 7], rot: 0 }
    ]
  },

  // brick-wall: chassis heavy 9x11 (48kg)
  //   track-std   x2 @ (0,3)(7,3)  2x4 each -> 16*2 = 32kg
  //   wedge-std   x1 @ (2,0) 5x2            -> 12kg
  //   armor-wedge x1 @ (2,2) 4x2            -> 10kg
  //   plate-thick x1 @ (3,6) 3x2            -> 12kg
  //   plate-thin  x1 @ (3,8) 2x2            -> 6kg
  //   合計 48+32+12+10+12+6 = 120kg / 占有セル 重複なし
  //   tracks x0-1&x7-8 z3-6 / wedge z0-1 / armor-wedge z2-3 / plates z6-7&z8-9
  {
    v: 1,
    name: "brick-wall",
    chassisId: "chassis-heavy",
    paint: 0xf4f4f4,
    parts: [
      { partId: "track-std", cell: [0, 3], rot: 0 },
      { partId: "track-std", cell: [7, 3], rot: 0 },
      { partId: "wedge-std", cell: [2, 0], rot: 0 },
      { partId: "armor-wedge", cell: [2, 2], rot: 0 },
      { partId: "plate-thick", cell: [3, 6], rot: 0 },
      { partId: "plate-thin", cell: [3, 8], rot: 0 }
    ]
  },

  // drum-runner: chassis light 5x7 (20kg)
  //   wheel-small     x4 @ (0,3)(4,3)(0,6)(4,6) 1x1 -> 4*4 = 16kg
  //   drum-std        x1 @ (0,0) 4x3               -> 32kg
  //   util-battery    x1 @ (1,4) 2x2               -> 9kg
  //   util-light-frame x1 @ (1,6) 2x1              -> 3kg
  //   合計 20+16+32+9+3 = 80kg / 占有セル 重複なし
  //   drum x0-3 z0-2 / wheels corners mid+rear / battery z4-5 / frame z6
  {
    v: 1,
    name: "drum-runner",
    chassisId: "chassis-light",
    paint: 0x0055bf,
    parts: [
      { partId: "wheel-small", cell: [0, 3], rot: 0 },
      { partId: "wheel-small", cell: [4, 3], rot: 0 },
      { partId: "wheel-small", cell: [0, 6], rot: 0 },
      { partId: "wheel-small", cell: [4, 6], rot: 0 },
      { partId: "drum-std", cell: [0, 0], rot: 0 },
      { partId: "util-battery", cell: [1, 4], rot: 0 },
      { partId: "util-light-frame", cell: [1, 6], rot: 0 }
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
