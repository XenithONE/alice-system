// Solo opponent "AUTOMATON" — an abstract versus player with no board sim.
// It follows the SAME economy rules (send costs / permanent income bonuses) and
// sends real creeps at the player. The player's sends damage its lives directly
// (per-send botDamage), gated by a defense curve (botBlockedFromWave) that stands
// in for the towers a human opponent would have built. Documented abstraction,
// surfaced in the UI as "simulated opponent".

import { mulberry32 } from "../../lib/seed";
import { SENDS, SEND_KINDS, START_LIVES, START_GOLD, START_INCOME, BOT_LEVELS, type SendKind, type BotDifficulty } from "../engine/balance";
import type { CreepSendMsg } from "../engine/tdEngine";

export interface BotCallbacks {
  onCreeps: (msg: CreepSendMsg) => void;
  onStatus: (s: { lives: number; income: number; gold: number; blockedTiers: SendKind[] }) => void;
  onOver: () => void;
}

export class BotOpponent {
  readonly id = "bot";
  lives = START_LIVES;
  gold = START_GOLD;
  income = START_INCOME;
  private wave = 0;
  private dead = false;
  private sendSeq = 0;
  private sendTimer: number;
  private incomeTimer = 10000;
  private statusTimer = 500;
  private savingForBoss = false;
  private readonly diff: BotDifficulty;
  private readonly rng: () => number;
  private readonly cb: BotCallbacks;

  constructor(level: keyof typeof BOT_LEVELS, seed: number, callbacks: BotCallbacks) {
    this.diff = BOT_LEVELS[level];
    this.rng = mulberry32(seed >>> 0);
    this.cb = callbacks;
    this.sendTimer = this.diff.startDelayMs;
  }

  /** Mirror the player's wave (used for send HP pricing + defense curve). */
  setWave(wave: number): void {
    this.wave = wave;
  }

  /** Player sent creeps at the bot. Returns true if they got through its "defense". */
  receiveAttack(kind: SendKind): boolean {
    if (this.dead) return false;
    const spec = SENDS[kind];
    if (this.wave >= spec.botBlockedFromWave) return false; // fully defended tier
    this.lives -= spec.botDamage;
    if (this.lives <= 0) {
      this.lives = 0;
      this.dead = true;
      this.cb.onOver();
    }
    return true;
  }

  get isDead(): boolean {
    return this.dead;
  }

  advance(ms: number): void {
    if (this.dead) return;

    this.incomeTimer -= ms;
    while (this.incomeTimer <= 0) {
      this.incomeTimer += 10000;
      this.gold += this.income;
    }

    this.sendTimer -= ms;
    if (this.sendTimer <= 0) {
      this.decide();
      this.sendTimer = this.diff.sendEveryMs * (0.8 + this.rng() * 0.4);
    }

    this.statusTimer -= ms;
    if (this.statusTimer <= 0) {
      this.statusTimer = 500;
      this.cb.onStatus({
        lives: this.lives,
        income: this.income,
        gold: Math.floor(this.gold),
        blockedTiers: SEND_KINDS.filter((k) => this.wave >= SENDS[k].botBlockedFromWave)
      });
    }
  }

  private decide(): void {
    if (!this.savingForBoss && this.rng() < this.diff.saveForBossChance) this.savingForBoss = true;
    if (this.savingForBoss) {
      if (this.gold >= SENDS.boss.cost) {
        this.emitSend("boss");
        this.savingForBoss = false;
      }
      return; // hold gold until the boss is affordable
    }
    // weighted pick among affordable sends (weight = cost → prefers meaningful sends)
    const affordable = SEND_KINDS.filter((k) => SENDS[k].cost <= this.gold);
    if (affordable.length === 0) return;
    const total = affordable.reduce((sum, k) => sum + SENDS[k].cost, 0);
    let roll = this.rng() * total;
    let pick: SendKind = affordable[affordable.length - 1];
    for (const k of affordable) {
      roll -= SENDS[k].cost;
      if (roll <= 0) { pick = k; break; }
    }
    this.emitSend(pick);
  }

  private emitSend(kind: SendKind): void {
    this.gold -= SENDS[kind].cost;
    this.income += SENDS[kind].incomeBonus;
    this.sendSeq += 1;
    this.cb.onCreeps({ kind, wave: this.wave, sendId: this.sendSeq, from: this.id });
  }
}
