// SIGNAL SIEGE — every tunable number lives here. The sim (tdEngine.ts) must not
// contain literals for anything a balance pass would want to touch.

export const TICK_HZ = 30;
export const TICK_MS = 1000 / TICK_HZ;
export const WAVE_EVERY_TICKS = 750; // 25s
export const INCOME_EVERY_TICKS = 300; // 10s

export const GRID_W = 14;
export const GRID_H = 10;
export const CELL_PX = 48;

export const START_LIVES = 20;
export const START_GOLD = 180;
export const START_INCOME = 15;
export const SELL_REFUND = 0.7;

export const CREEP_CAP = 512;
export const PROJECTILE_CAP = 256;
export const BEAM_RING = 64;
export const MAX_TICKS_PER_FRAME = 8;
export const CATCHUP_TICK_CAP = 900; // waveTick fence hard limit (~30s of sim)

// Hand-tuned S-path (col,row waypoints; entry/exit off-board). Cells the path
// crosses are unbuildable. ~40 traversed cells.
export const PATH_WAYPOINTS: ReadonlyArray<readonly [number, number]> = [
  [-1, 1],
  [11, 1],
  [11, 4],
  [2, 4],
  [2, 7],
  [14, 7]
];

export type TowerKind = "arrow" | "cannon" | "frost" | "tesla" | "sniper";
export const TOWER_KINDS: TowerKind[] = ["arrow", "cannon", "frost", "tesla", "sniper"];

export interface TowerLevelSpec {
  dmg: number;
  rate: number; // shots/sec
  range: number; // cells
  slowPct?: number; // frost
  slowTicks?: number;
  chain?: number; // tesla
  splash?: number; // cannon, cells
  pierceShield?: boolean; // sniper L3
  aoePulse?: boolean; // frost L3: hits all in range
}

export interface TowerSpec {
  name: string;
  cost: number; // L1
  upCost: [number, number]; // L2, L3
  levels: [TowerLevelSpec, TowerLevelSpec, TowerLevelSpec];
  color: string;
}

export const TOWERS: Record<TowerKind, TowerSpec> = {
  arrow: {
    name: "ARROW",
    cost: 50,
    upCost: [60, 140],
    color: "#cdaa6d",
    levels: [
      { dmg: 8, rate: 2.5, range: 2.8 },
      { dmg: 20, rate: 2.5, range: 2.9 },
      { dmg: 46, rate: 3.3, range: 3.0 }
    ]
  },
  cannon: {
    name: "CANNON",
    cost: 90,
    upCost: [110, 240],
    color: "#d8845a",
    levels: [
      { dmg: 22, rate: 0.8, range: 2.5, splash: 1.1 },
      { dmg: 50, rate: 0.8, range: 2.6, splash: 1.2 },
      { dmg: 115, rate: 0.9, range: 2.7, splash: 1.35 }
    ]
  },
  frost: {
    name: "FROST",
    cost: 70,
    upCost: [80, 170],
    color: "#7fc8e8",
    levels: [
      { dmg: 2, rate: 1.0, range: 2.6, slowPct: 40, slowTicks: 60 },
      { dmg: 3, rate: 1.0, range: 3.0, slowPct: 50, slowTicks: 60 },
      { dmg: 5, rate: 1.0, range: 3.0, slowPct: 60, slowTicks: 75, aoePulse: true }
    ]
  },
  tesla: {
    name: "TESLA",
    cost: 120,
    upCost: [130, 280],
    color: "#b58cff",
    levels: [
      { dmg: 14, rate: 1.6, range: 2.4, chain: 3 },
      { dmg: 32, rate: 1.6, range: 2.5, chain: 4 },
      { dmg: 70, rate: 1.7, range: 2.6, chain: 6 }
    ]
  },
  sniper: {
    name: "SNIPER",
    cost: 100,
    upCost: [130, 280],
    color: "#e8e2d4",
    levels: [
      { dmg: 55, rate: 0.4, range: 6.5 },
      { dmg: 140, rate: 0.4, range: 7.0 },
      { dmg: 330, rate: 0.45, range: 7.5, pierceShield: true }
    ]
  }
};

export const CHAIN_HOP_CELLS = 1.5;

export type SendKind = "runner" | "swarm" | "tank" | "shield" | "boss";
export const SEND_KINDS: SendKind[] = ["runner", "swarm", "tank", "shield", "boss"];

export interface SendSpec {
  name: string;
  cost: number;
  incomeBonus: number;
  count: number;
  hp: number;
  speed: number; // cells/sec
  bounty: number;
  leak: number; // lives lost per leaked creep
  spawnGapTicks: number;
  botDamage: number; // vs AI bot: lives dealt PER SEND (not per creep)
  botBlockedFromWave: number; // AI bot fully blocks this send from this wave on (Infinity = never)
  color: string;
}

export const SENDS: Record<SendKind, SendSpec> = {
  runner: { name: "RUNNER", cost: 20, incomeBonus: 2, count: 4, hp: 30, speed: 1.6, bounty: 3, leak: 1, spawnGapTicks: 6, botDamage: 1, botBlockedFromWave: 5, color: "#9fe07a" },
  swarm: { name: "SWARM", cost: 35, incomeBonus: 3, count: 12, hp: 12, speed: 1.4, bounty: 1, leak: 1, spawnGapTicks: 4, botDamage: 2, botBlockedFromWave: 9, color: "#7ad0e0" },
  tank: { name: "TANK", cost: 60, incomeBonus: 6, count: 1, hp: 480, speed: 0.7, bounty: 25, leak: 1, spawnGapTicks: 1, botDamage: 3, botBlockedFromWave: 13, color: "#d8845a" },
  shield: { name: "SHIELD", cost: 90, incomeBonus: 8, count: 3, hp: 220, speed: 0.9, bounty: 15, leak: 1, spawnGapTicks: 10, botDamage: 4, botBlockedFromWave: 17, color: "#b58cff" },
  boss: { name: "BOSS", cost: 240, incomeBonus: 20, count: 1, hp: 2600, speed: 0.55, bounty: 120, leak: 3, spawnGapTicks: 1, botDamage: 7, botBlockedFromWave: Infinity, color: "#e05a7a" }
};

export const SEND_HP_GROWTH = 1.12; // ^wave
export const SHIELD_ARMOR = 0.35; // -35% damage while shielded (above 50% hp)

// Auto waves
export const WAVE_BASE_COUNT = 8;
export const WAVE_COUNT_PER_2 = 1; // +1 per 2 waves
export const WAVE_BASE_HP = 40;
export const WAVE_HP_GROWTH = 1.2;
export const WAVE_BASE_SPEED = 1.0;
export const WAVE_SPEED_PER = 0.02;
export const WAVE_SPEED_CAP = 1.5;
export const WAVE_BASE_BOUNTY = 4;
export const WAVE_BOUNTY_GROWTH = 1.1;
export const WAVE_SPAWN_GAP_TICKS = 12;
export const WAVE_BOSS_EVERY = 5;
export const WAVE_BOSS_HP_MULT = 12; // x pack-total
export const WAVE_BOSS_BOUNTY_MULT = 10;
export const WAVE_BOSS_LEAK = 2;

// Bot (solo opponent)
export interface BotDifficulty {
  name: string;
  sendEveryMs: number;
  saveForBossChance: number; // 0..1, checked at each decision
  startDelayMs: number;
}
export const BOT_LEVELS: Record<"easy" | "normal" | "hard", BotDifficulty> = {
  easy: { name: "EASY", sendEveryMs: 35000, saveForBossChance: 0.1, startDelayMs: 30000 },
  normal: { name: "NORMAL", sendEveryMs: 22000, saveForBossChance: 0.3, startDelayMs: 18000 },
  hard: { name: "HARD", sendEveryMs: 15000, saveForBossChance: 0.5, startDelayMs: 10000 }
};
