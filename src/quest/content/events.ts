import type { EventDef } from "../engine/types";

// 18 events: 6 per tier. Choices use only Effect variants.
// Rewards modest: gold 3–12, xp 2–6, small heal/loseHp. Some goldCost.

export const EVENTS: Record<string, EventDef> = {
  // ── Tier 1 (6) ────────────────────────────────────────────────────────────
  "event-lost-stud": {
    id: "event-lost-stud",
    nameJa: "落ちたスタッド",
    textJa: "道端に光るスタッドが落ちている。拾う？調べる？",
    tier: 1,
    choices: [
      { labelJa: "拾う", effects: [{ t: "gold", n: 5 }] },
      { labelJa: "慎重に調べる", effects: [{ t: "xp", n: 3 }, { t: "gold", n: 2 }] },
      { labelJa: "無視して進む", effects: [] },
    ],
  },
  "event-brick-merchant": {
    id: "event-brick-merchant",
    nameJa: "行商ブリック",
    textJa: "小さな行商人が荷を広げている。「安いよ」",
    tier: 1,
    choices: [
      {
        labelJa: "傷薬を買う",
        goldCost: 4,
        effects: [{ t: "heal", n: 6 }],
      },
      {
        labelJa: "噂を買う",
        goldCost: 3,
        effects: [{ t: "xp", n: 4 }],
      },
      { labelJa: "通りすぎる", effects: [] },
    ],
  },
  "event-peg-shrine-minor": {
    id: "event-peg-shrine-minor",
    nameJa: "小さなペグ祠",
    textJa: "道端の祠。供え物か、祈るか。",
    tier: 1,
    choices: [
      {
        labelJa: "コインを供える",
        goldCost: 5,
        effects: [{ t: "heal", n: 8 }, { t: "xp", n: 2 }],
      },
      { labelJa: "黙祷する", effects: [{ t: "heal", n: 3 }] },
      { labelJa: "供物を漁る", effects: [{ t: "gold", n: 6 }, { t: "loseHp", n: 2 }] },
    ],
  },
  "event-clay-mud": {
    id: "event-clay-mud",
    nameJa: "粘土ぬかるみ",
    textJa: "足元が粘土に沈む。力ずくか、回り道か。",
    tier: 1,
    choices: [
      { labelJa: "力ずくで抜ける", effects: [{ t: "loseHp", n: 2 }, { t: "xp", n: 3 }] },
      { labelJa: "回り道", effects: [{ t: "xp", n: 2 }] },
      { labelJa: "宝物を探す", effects: [{ t: "gold", n: 7 }, { t: "loseHp", n: 3 }] },
    ],
  },
  "event-friendly-bot": {
    id: "event-friendly-bot",
    nameJa: "迷子ボット",
    textJa: "歯車が外れた小さなボットが助けを求めている。",
    tier: 1,
    choices: [
      {
        labelJa: "修理してやる",
        goldCost: 3,
        effects: [{ t: "xp", n: 5 }, { t: "gold", n: 4 }],
      },
      { labelJa: "部品をもらう", effects: [{ t: "gold", n: 4 }] },
      { labelJa: "放っておく", effects: [] },
    ],
  },
  "event-training-dummy": {
    id: "event-training-dummy",
    nameJa: "訓練用ダミー",
    textJa: "捨てられたブリックの人形。殴って練習できそうだ。",
    tier: 1,
    choices: [
      { labelJa: "本気で殴る", effects: [{ t: "xp", n: 4 }, { t: "loseHp", n: 1 }] },
      { labelJa: "軽く打つ", effects: [{ t: "xp", n: 2 }] },
      { labelJa: "中のコインを取る", effects: [{ t: "gold", n: 5 }] },
    ],
  },

  // ── Tier 2 (6) ────────────────────────────────────────────────────────────
  "event-gear-market": {
    id: "event-gear-market",
    nameJa: "ギア市場",
    textJa: "歯車とプレートが並ぶ小さな市場。",
    tier: 2,
    choices: [
      {
        labelJa: "良品を買う",
        goldCost: 8,
        effects: [{ t: "heal", n: 10 }, { t: "xp", n: 3 }],
      },
      {
        labelJa: "安く交渉",
        goldCost: 4,
        effects: [{ t: "gold", n: 6 }],
      },
      { labelJa: "見て回るだけ", effects: [{ t: "xp", n: 2 }] },
    ],
  },
  "event-mirror-plate": {
    id: "event-mirror-plate",
    nameJa: "鏡面プレート",
    textJa: "自分の姿が歪んで映る鏡の壁。",
    tier: 2,
    choices: [
      { labelJa: "触れる", effects: [{ t: "xp", n: 5 }, { t: "loseHp", n: 3 }] },
      { labelJa: "祈る", effects: [{ t: "heal", n: 6 }] },
      {
        labelJa: "磨き上げる",
        goldCost: 5,
        effects: [{ t: "xp", n: 4 }, { t: "heal", n: 4 }],
      },
    ],
  },
  "event-bandit-toll": {
    id: "event-bandit-toll",
    nameJa: "盗賊の通行料",
    textJa: "マスクをしたブリック盗賊が道を塞ぐ。「通したきゃ払え」",
    tier: 2,
    choices: [
      {
        labelJa: "払う",
        goldCost: 5,
        effects: [{ t: "xp", n: 2 }],
      },
      { labelJa: "押し通る", effects: [{ t: "loseHp", n: 5 }, { t: "xp", n: 4 }, { t: "gold", n: 3 }] },
      // Fixed-cost trick (no RNG in content): HP price for gold, never free reward
      { labelJa: "騙して通る", effects: [{ t: "loseHp", n: 5 }, { t: "gold", n: 6 }] },
    ],
  },
  "event-hot-springs": {
    id: "event-hot-springs",
    nameJa: "ブリック温泉",
    textJa: "湯気が立つプレートの湯船。疲れが取れそうだ。",
    tier: 2,
    choices: [
      {
        labelJa: "入浴する",
        goldCost: 5,
        effects: [{ t: "heal", n: 12 }],
      },
      { labelJa: "足だけ浸ける", effects: [{ t: "heal", n: 5 }] },
      { labelJa: "湯のコインを探す", effects: [{ t: "gold", n: 8 }, { t: "loseHp", n: 2 }] },
    ],
  },
  "event-riddle-brick": {
    id: "event-riddle-brick",
    nameJa: "謎かけブロック",
    textJa: "壁のブロックが声を出す。「答えよ、旅人」",
    tier: 2,
    choices: [
      { labelJa: "知恵で答える", effects: [{ t: "xp", n: 6 }, { t: "gold", n: 5 }] },
      { labelJa: "力で壊す", effects: [{ t: "loseHp", n: 4 }, { t: "gold", n: 10 }] },
      { labelJa: "黙って去る", effects: [{ t: "xp", n: 2 }] },
    ],
  },
  "event-abandoned-camp": {
    id: "event-abandoned-camp",
    nameJa: "捨てられた野営",
    textJa: "火の気が残る野営跡。荷物が散らばっている。",
    tier: 2,
    choices: [
      { labelJa: "休む", effects: [{ t: "heal", n: 8 }] },
      // Malicious: scatter cursed chains onto a rival (entry path for curse-chains)
      {
        labelJa: "呪われた荷をばら撒く",
        effects: [
          { t: "curseGive", card: "curse-chains" },
          { t: "gold", n: 6 },
          { t: "loseHp", n: 1 },
        ],
      },
      {
        labelJa: "罠を仕掛ける",
        effects: [{ t: "trapNode", dmg: 5 }, { t: "xp", n: 3 }],
      },
    ],
  },

  // ── Tier 3 (6) ────────────────────────────────────────────────────────────
  "event-relic-echo": {
    id: "event-relic-echo",
    nameJa: "レリックの残響",
    textJa: "空気が震える。祠の力がここにも届いている。",
    tier: 3,
    choices: [
      { labelJa: "力を吸収する", effects: [{ t: "xp", n: 6 }, { t: "heal", n: 5 }] },
      // Paid = same xp as free + extra heal (tempo/gold trade, not strictly worse)
      {
        labelJa: "供物を捧げる",
        goldCost: 8,
        effects: [{ t: "xp", n: 6 }, { t: "heal", n: 10 }],
      },
      { labelJa: "危険を感じ退く", effects: [{ t: "xp", n: 2 }] },
    ],
  },
  "event-obsidian-altar": {
    id: "event-obsidian-altar",
    nameJa: "黒曜石の祭壇",
    textJa: "冷たい祭壇。血か、金か、知識か。",
    tier: 3,
    choices: [
      { labelJa: "血を捧げる", effects: [{ t: "loseHp", n: 6 }, { t: "xp", n: 6 }, { t: "gold", n: 8 }] },
      {
        labelJa: "金を捧げる",
        goldCost: 12,
        effects: [{ t: "xp", n: 6 }, { t: "heal", n: 8 }],
      },
      { labelJa: "ただ眺める", effects: [{ t: "xp", n: 3 }] },
    ],
  },
  "event-portal-whisper": {
    id: "event-portal-whisper",
    nameJa: "ポータルの囁き",
    textJa: "中央の核が遠くで囁く。聞くと正気を揺さぶる。",
    tier: 3,
    choices: [
      { labelJa: "耳を傾ける", effects: [{ t: "xp", n: 6 }, { t: "loseHp", n: 4 }] },
      { labelJa: "心を閉じる", effects: [{ t: "heal", n: 4 }] },
      {
        labelJa: "反響を封じる",
        goldCost: 8,
        effects: [{ t: "xp", n: 4 }, { t: "heal", n: 6 }],
      },
    ],
  },
  "event-chrome-vault": {
    id: "event-chrome-vault",
    nameJa: "クロームの金庫",
    textJa: "半開きの金庫。中に光るものがある。",
    tier: 3,
    choices: [
      { labelJa: "こじ開ける", effects: [{ t: "gold", n: 12 }, { t: "loseHp", n: 5 }] },
      {
        labelJa: "鍵を買う",
        goldCost: 6,
        effects: [{ t: "gold", n: 11 }, { t: "xp", n: 3 }],
      },
      { labelJa: "触らない", effects: [{ t: "xp", n: 2 }] },
    ],
  },
  "event-guardian-trace": {
    id: "event-guardian-trace",
    nameJa: "守護者の足跡",
    textJa: "巨大なスタッドの足跡。追うと学びがあるかもしれない。",
    tier: 3,
    choices: [
      { labelJa: "追跡する", effects: [{ t: "xp", n: 6 }, { t: "loseHp", n: 3 }] },
      { labelJa: "足跡から型を取る", effects: [{ t: "xp", n: 4 }, { t: "gold", n: 5 }] },
      {
        labelJa: "罠を残す",
        effects: [{ t: "trapNode", dmg: 8 }, { t: "xp", n: 3 }],
      },
    ],
  },
  "event-last-campfire": {
    id: "event-last-campfire",
    nameJa: "最後の焚き火",
    textJa: "旅人たちが残した火。休むか、仕掛けるか。",
    tier: 3,
    choices: [
      { labelJa: "休み英気を養う", effects: [{ t: "heal", n: 12 }, { t: "xp", n: 3 }] },
      // Paid = clearly more total value than free (same heal + double xp) for gold
      {
        labelJa: "装備を整える",
        goldCost: 5,
        effects: [{ t: "heal", n: 12 }, { t: "xp", n: 6 }],
      },
      {
        labelJa: "罠を仕掛けて去る",
        effects: [{ t: "trapNode", dmg: 6 }, { t: "gold", n: 4 }],
      },
    ],
  },
};
