// SIGNAL SIEGE — deterministic versus-TD simulation.
// Pure sim: NO DOM, NO Math.random, NO Date.now/performance.now in this file.
// Fixed 30Hz ticks; commands and network events are queued and drained at the
// start of the next tick, never applied mid-tick. Each player simulates ONLY
// their own board; the only cross-player inputs are CreepSendMsg events.

import { mulberry32 } from "../../lib/seed";
import {
  TICK_HZ, WAVE_EVERY_TICKS, INCOME_EVERY_TICKS,
  GRID_W, GRID_H, CELL_PX,
  START_LIVES, START_GOLD, START_INCOME, SELL_REFUND,
  CREEP_CAP, PROJECTILE_CAP, BEAM_RING, CATCHUP_TICK_CAP,
  PATH_WAYPOINTS,
  TOWERS, TOWER_KINDS, CHAIN_HOP_CELLS,
  SENDS, SEND_HP_GROWTH, SHIELD_ARMOR,
  WAVE_BASE_COUNT, WAVE_COUNT_PER_2, WAVE_BASE_HP, WAVE_HP_GROWTH,
  WAVE_BASE_SPEED, WAVE_SPEED_PER, WAVE_SPEED_CAP,
  WAVE_BASE_BOUNTY, WAVE_BOUNTY_GROWTH, WAVE_SPAWN_GAP_TICKS,
  WAVE_BOSS_EVERY, WAVE_BOSS_HP_MULT, WAVE_BOSS_BOUNTY_MULT, WAVE_BOSS_LEAK,
  type TowerKind, type SendKind
} from "./balance";

const DT = 1 / TICK_HZ;

// creep kind byte: 0 = wave normal, 1..5 = send kinds (index into SEND_KINDS order), 6 = wave boss
export const CREEP_WAVE = 0;
export const CREEP_WAVE_BOSS = 6;
const SEND_KIND_BYTE: Record<SendKind, number> = { runner: 1, swarm: 2, tank: 3, shield: 4, boss: 5 };

const FLAG_ALIVE = 1;
const FLAG_SHIELDED = 2;

export interface CreepSendMsg {
  kind: SendKind;
  wave: number; // sender's wave at send time — prices HP identically on both sims
  sendId: number;
  from: string;
}

export interface TdStatus {
  lives: number;
  gold: number;
  income: number;
  wave: number;
  creepsAlive: number;
  nextWaveTicks: number;
  tick: number;
}

export interface SendResult {
  ok: boolean;
  kind: SendKind;
  sendId: number;
  wave: number;
  reason?: "gold";
}

export interface TdCallbacks {
  onStatus?: (s: TdStatus) => void; // ~4Hz
  onWave?: (waveNo: number) => void;
  onSendResolved?: (r: SendResult) => void;
  onLifeLost?: (leak: number) => void;
  onGameOver?: (r: { waveReached: number; ticks: number; kills: number; sendsMade: number }) => void;
}

export interface BeamEvent {
  x1: number; y1: number; x2: number; y2: number;
  kind: TowerKind;
  ttl: number; // render frames-ish; renderer decrements
}

interface SpawnGroup {
  remaining: number;
  gapTicks: number;
  counter: number;
  hp: number;
  speed: number;
  bounty: number;
  leak: number;
  kindByte: number;
  shielded: boolean;
}

type Command =
  | { t: "place"; cell: number; kind: TowerKind }
  | { t: "upgrade"; cell: number }
  | { t: "sell"; cell: number }
  | { t: "send"; kind: SendKind };

// ---------------------------------------------------------------- path

export interface PathInfo {
  totalLen: number; // cells
  mask: Uint8Array; // GRID_W*GRID_H, 1 = path (unbuildable)
  posAt: (d: number, out: { x: number; y: number }) => void; // px coords
}

export function buildPath(): PathInfo {
  const segs: Array<{ x: number; y: number; dx: number; dy: number; len: number; cum: number }> = [];
  let cum = 0;
  for (let i = 0; i < PATH_WAYPOINTS.length - 1; i += 1) {
    const [c0, r0] = PATH_WAYPOINTS[i];
    const [c1, r1] = PATH_WAYPOINTS[i + 1];
    const len = Math.abs(c1 - c0) + Math.abs(r1 - r0); // axis-aligned
    const dx = Math.sign(c1 - c0);
    const dy = Math.sign(r1 - r0);
    segs.push({ x: c0, y: r0, dx, dy, len, cum });
    cum += len;
  }
  const totalLen = cum;

  const mask = new Uint8Array(GRID_W * GRID_H);
  for (const s of segs) {
    for (let step = 0; step <= s.len; step += 1) {
      const c = s.x + s.dx * step;
      const r = s.y + s.dy * step;
      if (c >= 0 && c < GRID_W && r >= 0 && r < GRID_H) mask[r * GRID_W + c] = 1;
    }
  }

  const posAt = (d: number, out: { x: number; y: number }): void => {
    if (d <= 0) {
      const s = segs[0];
      out.x = (s.x + 0.5 + s.dx * d) * CELL_PX;
      out.y = (s.y + 0.5 + s.dy * d) * CELL_PX;
      return;
    }
    for (let i = segs.length - 1; i >= 0; i -= 1) {
      const s = segs[i];
      if (d >= s.cum) {
        const local = d - s.cum;
        out.x = (s.x + 0.5 + s.dx * local) * CELL_PX;
        out.y = (s.y + 0.5 + s.dy * local) * CELL_PX;
        return;
      }
    }
    out.x = (segs[0].x + 0.5) * CELL_PX;
    out.y = (segs[0].y + 0.5) * CELL_PX;
  };

  return { totalLen, mask, posAt };
}

// ---------------------------------------------------------------- engine

export class TdEngine {
  readonly path: PathInfo;

  // creeps (SoA)
  readonly pathPos = new Float32Array(CREEP_CAP);
  readonly prevPos = new Float32Array(CREEP_CAP);
  readonly hp = new Float32Array(CREEP_CAP);
  readonly maxHp = new Float32Array(CREEP_CAP);
  readonly speed = new Float32Array(CREEP_CAP);
  readonly cx = new Float32Array(CREEP_CAP);
  readonly cy = new Float32Array(CREEP_CAP);
  readonly kindArr = new Uint8Array(CREEP_CAP);
  readonly slowT = new Uint16Array(CREEP_CAP);
  readonly slowAmt = new Uint8Array(CREEP_CAP);
  readonly flags = new Uint8Array(CREEP_CAP);
  readonly bountyArr = new Float32Array(CREEP_CAP);
  readonly leakArr = new Uint8Array(CREEP_CAP);
  readonly gen = new Uint16Array(CREEP_CAP);
  readonly active = new Int32Array(CREEP_CAP);
  activeCount = 0;
  private readonly freeStack = new Int32Array(CREEP_CAP);
  private freeCount = 0;

  // towers (dense per-cell)
  readonly towerType = new Uint8Array(GRID_W * GRID_H); // 0 none, 1..5 = TOWER_KINDS index+1
  readonly towerLevel = new Uint8Array(GRID_W * GRID_H);
  readonly towerCooldown = new Int16Array(GRID_W * GRID_H);
  readonly towerInvested = new Float32Array(GRID_W * GRID_H);
  readonly towerCells: number[] = [];

  // projectiles (SoA)
  readonly pjX = new Float32Array(PROJECTILE_CAP);
  readonly pjY = new Float32Array(PROJECTILE_CAP);
  readonly pjDestX = new Float32Array(PROJECTILE_CAP);
  readonly pjDestY = new Float32Array(PROJECTILE_CAP);
  readonly pjTarget = new Int32Array(PROJECTILE_CAP);
  readonly pjTargetGen = new Uint16Array(PROJECTILE_CAP);
  readonly pjDmg = new Float32Array(PROJECTILE_CAP);
  readonly pjKind = new Uint8Array(PROJECTILE_CAP); // tower kind index
  readonly pjSplash = new Float32Array(PROJECTILE_CAP); // px, 0 = none
  readonly pjPierce = new Uint8Array(PROJECTILE_CAP);
  readonly pjAlive = new Uint8Array(PROJECTILE_CAP);
  private pjCount = 0;

  // beams for the renderer (ring buffer; renderer consumes ttl)
  readonly beams: BeamEvent[] = [];
  private beamHead = 0;

  // state
  tickNo = 0;
  lives = START_LIVES;
  gold = START_GOLD;
  income = START_INCOME;
  wave = 0;
  dead = false;
  kills = 0;
  sendsMade = 0;
  private sendSeq = 0;
  private readonly seed: number;
  private readonly groups: SpawnGroup[] = [];
  private readonly commands: Command[] = [];
  private readonly netInbox: CreepSendMsg[] = [];
  private readonly seenSendIds = new Map<string, number>();
  private readonly cb: TdCallbacks;
  private readonly scratch = { x: 0, y: 0 };

  constructor(seed: number, callbacks: TdCallbacks = {}) {
    this.seed = seed >>> 0;
    this.cb = callbacks;
    this.path = buildPath();
    for (let i = 0; i < CREEP_CAP; i += 1) this.freeStack[i] = CREEP_CAP - 1 - i;
    this.freeCount = CREEP_CAP;
    for (let i = 0; i < BEAM_RING; i += 1) this.beams.push({ x1: 0, y1: 0, x2: 0, y2: 0, kind: "arrow", ttl: 0 });
  }

  // ---------------------------------------------------- public commands (queued)

  placeTower(cell: number, kind: TowerKind): void {
    this.commands.push({ t: "place", cell, kind });
  }
  upgradeTower(cell: number): void {
    this.commands.push({ t: "upgrade", cell });
  }
  sellTower(cell: number): void {
    this.commands.push({ t: "sell", cell });
  }
  /** Synchronous affordability gate for UI; the actual debit happens on tick. */
  trySend(kind: SendKind): boolean {
    const pending = this.commands.reduce((sum, c) => sum + (c.t === "send" ? SENDS[c.kind].cost : 0), 0);
    if (this.gold - pending < SENDS[kind].cost) return false;
    this.commands.push({ t: "send", kind });
    return true;
  }
  receiveCreeps(msg: CreepSendMsg): void {
    this.netInbox.push(msg);
  }
  /** Host waveTick fence: catch up (bounded) if we fell behind. */
  syncWave(hostWave: number): void {
    if (this.dead) return;
    if (hostWave <= this.wave + 1) return;
    const targetTick = hostWave * WAVE_EVERY_TICKS;
    const deficit = targetTick - this.tickNo;
    if (deficit <= 0) return;
    const budget = Math.min(deficit, CATCHUP_TICK_CAP);
    this.pump(budget);
    if (this.tickNo < targetTick) {
      // Documented degradation: beyond the catch-up budget, jump the clock.
      // wave must be hostWave-1 here: the scheduler fires wave N when a tick
      // STARTS at N*WAVE_EVERY_TICKS, so the very next tick emits hostWave.
      // Setting hostWave directly would drift one wave ahead permanently.
      this.tickNo = targetTick;
      this.wave = hostWave - 1;
    }
  }

  pump(n: number): void {
    for (let i = 0; i < n; i += 1) this.tick();
  }

  // ---------------------------------------------------- tick pipeline

  tick(): void {
    if (this.dead) return;
    this.drainCommands();
    this.waveScheduler();
    this.spawnStep();
    this.creepMove();
    this.towerFire();
    this.projectileStep();
    this.economy();
    this.tickNo += 1;
    this.emit();
  }

  private drainCommands(): void {
    for (const cmd of this.commands) {
      if (cmd.t === "place") this.applyPlace(cmd.cell, cmd.kind);
      else if (cmd.t === "upgrade") this.applyUpgrade(cmd.cell);
      else if (cmd.t === "sell") this.applySell(cmd.cell);
      else this.applySend(cmd.kind);
    }
    this.commands.length = 0;

    for (const msg of this.netInbox) {
      const last = this.seenSendIds.get(msg.from) ?? -1;
      if (msg.sendId <= last) continue; // duplicate / replay
      this.seenSendIds.set(msg.from, msg.sendId);
      const spec = SENDS[msg.kind];
      if (!spec) continue;
      const wave = Math.max(0, Math.min(msg.wave, this.wave + 1));
      const mult = Math.pow(SEND_HP_GROWTH, wave);
      this.groups.push({
        remaining: spec.count,
        gapTicks: spec.spawnGapTicks,
        counter: 0,
        hp: spec.hp * mult,
        speed: spec.speed,
        bounty: spec.bounty,
        leak: spec.leak,
        kindByte: SEND_KIND_BYTE[msg.kind],
        shielded: msg.kind === "shield"
      });
    }
    this.netInbox.length = 0;
  }

  private applyPlace(cell: number, kind: TowerKind): void {
    if (cell < 0 || cell >= GRID_W * GRID_H) return;
    if (this.path.mask[cell] || this.towerType[cell] !== 0) return;
    const spec = TOWERS[kind];
    if (!spec || this.gold < spec.cost) return;
    this.gold -= spec.cost;
    this.towerType[cell] = TOWER_KINDS.indexOf(kind) + 1;
    this.towerLevel[cell] = 1;
    this.towerCooldown[cell] = 0;
    this.towerInvested[cell] = spec.cost;
    this.towerCells.push(cell);
  }

  private applyUpgrade(cell: number): void {
    const t = this.towerType[cell];
    if (t === 0) return;
    const level = this.towerLevel[cell];
    if (level >= 3) return;
    const spec = TOWERS[TOWER_KINDS[t - 1]];
    const cost = spec.upCost[level - 1];
    if (this.gold < cost) return;
    this.gold -= cost;
    this.towerLevel[cell] = level + 1;
    this.towerInvested[cell] += cost;
  }

  private applySell(cell: number): void {
    if (this.towerType[cell] === 0) return;
    this.gold += Math.floor(this.towerInvested[cell] * SELL_REFUND);
    this.towerType[cell] = 0;
    this.towerLevel[cell] = 0;
    this.towerInvested[cell] = 0;
    const idx = this.towerCells.indexOf(cell);
    if (idx >= 0) this.towerCells.splice(idx, 1);
  }

  private applySend(kind: SendKind): void {
    const spec = SENDS[kind];
    if (this.gold < spec.cost) {
      this.cb.onSendResolved?.({ ok: false, kind, sendId: -1, wave: this.wave, reason: "gold" });
      return;
    }
    this.gold -= spec.cost;
    this.income += spec.incomeBonus;
    this.sendsMade += 1;
    this.sendSeq += 1;
    this.cb.onSendResolved?.({ ok: true, kind, sendId: this.sendSeq, wave: this.wave });
  }

  private waveScheduler(): void {
    if (this.tickNo === 0 || this.tickNo % WAVE_EVERY_TICKS !== 0) return;
    this.wave += 1;
    const n = this.wave;
    const rng = mulberry32((this.seed ^ Math.imul(n, 0x9e3779b1)) >>> 0);
    const count = WAVE_BASE_COUNT + Math.floor(n / 2) * WAVE_COUNT_PER_2;
    const hp = WAVE_BASE_HP * Math.pow(WAVE_HP_GROWTH, n - 1);
    const speedV = Math.min(WAVE_SPEED_CAP, WAVE_BASE_SPEED + WAVE_SPEED_PER * (n - 1));
    const bounty = Math.ceil(WAVE_BASE_BOUNTY * Math.pow(WAVE_BOUNTY_GROWTH, n - 1));
    if (n % WAVE_BOSS_EVERY === 0) {
      this.groups.push({
        remaining: 1,
        gapTicks: 1,
        counter: 0,
        hp: hp * count * WAVE_BOSS_HP_MULT,
        speed: speedV * 0.7,
        bounty: bounty * count * WAVE_BOSS_BOUNTY_MULT,
        leak: WAVE_BOSS_LEAK,
        kindByte: CREEP_WAVE_BOSS,
        shielded: false
      });
    } else {
      this.groups.push({
        remaining: count,
        gapTicks: WAVE_SPAWN_GAP_TICKS + Math.floor(rng() * 4),
        counter: 0,
        hp,
        speed: speedV,
        bounty,
        leak: 1,
        kindByte: CREEP_WAVE,
        shielded: false
      });
    }
    this.cb.onWave?.(n);
  }

  private spawnStep(): void {
    for (let g = this.groups.length - 1; g >= 0; g -= 1) {
      const group = this.groups[g];
      group.counter -= 1;
      if (group.counter > 0) continue;
      if (this.freeCount === 0) {
        group.counter = 2; // pool exhausted — retry shortly
        continue;
      }
      group.counter = group.gapTicks;
      group.remaining -= 1;
      const slot = this.freeStack[--this.freeCount];
      this.pathPos[slot] = 0;
      this.prevPos[slot] = 0;
      this.hp[slot] = group.hp;
      this.maxHp[slot] = group.hp;
      this.speed[slot] = group.speed;
      this.kindArr[slot] = group.kindByte;
      this.slowT[slot] = 0;
      this.slowAmt[slot] = 0;
      this.bountyArr[slot] = group.bounty;
      this.leakArr[slot] = group.leak;
      this.flags[slot] = FLAG_ALIVE | (group.shielded ? FLAG_SHIELDED : 0);
      this.gen[slot] = (this.gen[slot] + 1) & 0xffff;
      this.active[this.activeCount++] = slot;
      const p = this.scratch;
      this.path.posAt(0, p);
      this.cx[slot] = p.x;
      this.cy[slot] = p.y;
      if (group.remaining <= 0) this.groups.splice(g, 1);
    }
  }

  private creepMove(): void {
    const p = this.scratch;
    for (let i = 0; i < this.activeCount; i += 1) {
      const s = this.active[i];
      this.prevPos[s] = this.pathPos[s];
      let v = this.speed[s];
      if (this.slowT[s] > 0) {
        this.slowT[s] -= 1;
        v *= 1 - this.slowAmt[s] / 100;
        if (this.slowT[s] === 0) this.slowAmt[s] = 0;
      }
      this.pathPos[s] += v * DT;
      this.path.posAt(this.pathPos[s], p);
      this.cx[s] = p.x;
      this.cy[s] = p.y;
    }
    // leaks (iterate backwards over active list for swap-remove)
    for (let i = this.activeCount - 1; i >= 0; i -= 1) {
      const s = this.active[i];
      if (this.pathPos[s] >= this.path.totalLen) {
        const leak = this.leakArr[s];
        this.removeCreep(i);
        this.lives -= leak;
        this.cb.onLifeLost?.(leak);
        if (this.lives <= 0 && !this.dead) {
          this.lives = 0;
          this.dead = true;
          this.cb.onGameOver?.({ waveReached: this.wave, ticks: this.tickNo, kills: this.kills, sendsMade: this.sendsMade });
          return;
        }
      }
    }
  }

  private towerFire(): void {
    for (const cell of this.towerCells) {
      const typeIdx = this.towerType[cell];
      if (typeIdx === 0) continue;
      if (this.towerCooldown[cell] > 0) {
        this.towerCooldown[cell] -= 1;
        continue;
      }
      const kind = TOWER_KINDS[typeIdx - 1];
      const spec = TOWERS[kind].levels[this.towerLevel[cell] - 1];
      const tx = ((cell % GRID_W) + 0.5) * CELL_PX;
      const ty = (Math.floor(cell / GRID_W) + 0.5) * CELL_PX;
      const range2 = spec.range * CELL_PX * (spec.range * CELL_PX);

      // deterministic acquire: max pathPos (sniper: max hp); tie -> lowest slot
      let best = -1;
      let bestScore = -Infinity;
      for (let i = 0; i < this.activeCount; i += 1) {
        const s = this.active[i];
        const dx = this.cx[s] - tx;
        const dy = this.cy[s] - ty;
        if (dx * dx + dy * dy > range2) continue;
        const score = kind === "sniper" ? this.hp[s] : this.pathPos[s];
        if (score > bestScore || (score === bestScore && (best === -1 || s < best))) {
          bestScore = score;
          best = s;
        }
      }
      if (best === -1) continue;

      // -1 because the cooldown gate skips the tick where the counter hits 0;
      // without it every tower's real period is (cooldown+1) ticks, under-
      // delivering the rate documented in balance.ts.
      this.towerCooldown[cell] = Math.max(0, Math.round(TICK_HZ / spec.rate) - 1);

      if (kind === "frost") {
        if (spec.aoePulse) {
          for (let i = this.activeCount - 1; i >= 0; i -= 1) {
            const s = this.active[i];
            const dx = this.cx[s] - tx;
            const dy = this.cy[s] - ty;
            if (dx * dx + dy * dy > range2) continue;
            this.applySlow(s, spec.slowPct ?? 0, spec.slowTicks ?? 0);
            this.damageCreep(i, spec.dmg, false);
          }
        } else {
          this.applySlow(best, spec.slowPct ?? 0, spec.slowTicks ?? 0);
          this.damageBySlot(best, spec.dmg, false);
        }
        this.pushBeam(tx, ty, this.cx[best], this.cy[best], kind);
      } else if (kind === "tesla") {
        let current = best;
        let hops = spec.chain ?? 1;
        let px = tx;
        let py = ty;
        const hit = new Set<number>();
        while (hops > 0 && current !== -1) {
          this.pushBeam(px, py, this.cx[current], this.cy[current], kind);
          px = this.cx[current];
          py = this.cy[current];
          hit.add(current);
          this.damageBySlot(current, spec.dmg, false);
          hops -= 1;
          if (hops === 0) break;
          // next hop: nearest un-hit creep within CHAIN_HOP_CELLS of last hit
          const hop2 = CHAIN_HOP_CELLS * CELL_PX * (CHAIN_HOP_CELLS * CELL_PX);
          let next = -1;
          let nextD = Infinity;
          for (let i = 0; i < this.activeCount; i += 1) {
            const s = this.active[i];
            if (hit.has(s) || !(this.flags[s] & FLAG_ALIVE)) continue;
            const dx = this.cx[s] - px;
            const dy = this.cy[s] - py;
            const d2 = dx * dx + dy * dy;
            if (d2 <= hop2 && (d2 < nextD || (d2 === nextD && s < next))) {
              nextD = d2;
              next = s;
            }
          }
          current = next;
        }
        this.reapDead();
      } else {
        // projectile towers: arrow / cannon / sniper
        if (this.pjCount >= PROJECTILE_CAP) continue;
        let pj = -1;
        for (let i = 0; i < PROJECTILE_CAP; i += 1) {
          if (!this.pjAlive[i]) { pj = i; break; }
        }
        if (pj === -1) continue;
        this.pjAlive[pj] = 1;
        this.pjX[pj] = tx;
        this.pjY[pj] = ty;
        this.pjDestX[pj] = this.cx[best];
        this.pjDestY[pj] = this.cy[best];
        this.pjTarget[pj] = best;
        this.pjTargetGen[pj] = this.gen[best];
        this.pjDmg[pj] = spec.dmg;
        this.pjKind[pj] = typeIdx - 1;
        this.pjSplash[pj] = (spec.splash ?? 0) * CELL_PX;
        this.pjPierce[pj] = spec.pierceShield ? 1 : 0;
        this.pjCount += 1;
      }
    }
  }

  private projectileStep(): void {
    const speedPx = 9 * CELL_PX * DT; // homing speed
    for (let i = 0; i < PROJECTILE_CAP; i += 1) {
      if (!this.pjAlive[i]) continue;
      const target = this.pjTarget[i];
      const targetAlive = target >= 0 && (this.flags[target] & FLAG_ALIVE) !== 0 && this.gen[target] === this.pjTargetGen[i];
      if (targetAlive) {
        this.pjDestX[i] = this.cx[target];
        this.pjDestY[i] = this.cy[target];
      }
      const dx = this.pjDestX[i] - this.pjX[i];
      const dy = this.pjDestY[i] - this.pjY[i];
      const dist = Math.hypot(dx, dy);
      const step = this.pjKind[i] === 1 ? speedPx * 0.6 : speedPx; // cannon slower
      if (dist <= step) {
        // impact
        if (this.pjSplash[i] > 0) {
          const r2 = this.pjSplash[i] * this.pjSplash[i];
          for (let j = this.activeCount - 1; j >= 0; j -= 1) {
            const s = this.active[j];
            const ddx = this.cx[s] - this.pjDestX[i];
            const ddy = this.cy[s] - this.pjDestY[i];
            if (ddx * ddx + ddy * ddy <= r2) this.damageCreep(j, this.pjDmg[i], this.pjPierce[i] === 1);
          }
        } else if (targetAlive) {
          this.damageBySlot(target, this.pjDmg[i], this.pjPierce[i] === 1);
          this.reapDead();
        }
        this.pjAlive[i] = 0;
        this.pjCount -= 1;
      } else {
        this.pjX[i] += (dx / dist) * step;
        this.pjY[i] += (dy / dist) * step;
      }
    }
  }

  private economy(): void {
    if (this.tickNo > 0 && this.tickNo % INCOME_EVERY_TICKS === 0) {
      this.gold += this.income;
    }
  }

  private emit(): void {
    if (this.tickNo % Math.round(TICK_HZ / 4) === 0) {
      this.cb.onStatus?.(this.status());
    }
  }

  // ---------------------------------------------------- damage helpers

  private applySlow(slot: number, pct: number, ticks: number): void {
    if (pct > this.slowAmt[slot] || this.slowT[slot] === 0) {
      this.slowAmt[slot] = pct;
      this.slowT[slot] = ticks;
    } else if (pct === this.slowAmt[slot]) {
      this.slowT[slot] = Math.max(this.slowT[slot], ticks);
    }
  }

  /** Damage by active-list index (safe for immediate swap-remove). */
  private damageCreep(activeIdx: number, dmg: number, pierceShield: boolean): void {
    const s = this.active[activeIdx];
    this.applyDamage(s, dmg, pierceShield);
    if (this.hp[s] <= 0) {
      this.gold += this.bountyArr[s];
      this.kills += 1;
      this.removeCreep(activeIdx);
    }
  }

  /** Damage by slot; caller must reapDead() afterwards. */
  private damageBySlot(slot: number, dmg: number, pierceShield: boolean): void {
    this.applyDamage(slot, dmg, pierceShield);
  }

  private applyDamage(slot: number, dmg: number, pierceShield: boolean): void {
    let d = dmg;
    if ((this.flags[slot] & FLAG_SHIELDED) !== 0 && !pierceShield) d *= 1 - SHIELD_ARMOR;
    this.hp[slot] -= d;
    if ((this.flags[slot] & FLAG_SHIELDED) !== 0 && this.hp[slot] <= this.maxHp[slot] * 0.5) {
      this.flags[slot] &= ~FLAG_SHIELDED;
    }
  }

  private reapDead(): void {
    for (let i = this.activeCount - 1; i >= 0; i -= 1) {
      const s = this.active[i];
      if (this.hp[s] <= 0) {
        this.gold += this.bountyArr[s];
        this.kills += 1;
        this.removeCreep(i);
      }
    }
  }

  private removeCreep(activeIdx: number): void {
    const s = this.active[activeIdx];
    this.flags[s] = 0;
    this.gen[s] = (this.gen[s] + 1) & 0xffff;
    this.active[activeIdx] = this.active[--this.activeCount];
    this.freeStack[this.freeCount++] = s;
  }

  private pushBeam(x1: number, y1: number, x2: number, y2: number, kind: TowerKind): void {
    const b = this.beams[this.beamHead];
    b.x1 = x1; b.y1 = y1; b.x2 = x2; b.y2 = y2; b.kind = kind; b.ttl = 6;
    this.beamHead = (this.beamHead + 1) % BEAM_RING;
  }

  // ---------------------------------------------------- introspection

  status(): TdStatus {
    return {
      lives: this.lives,
      gold: Math.floor(this.gold),
      income: this.income,
      wave: this.wave,
      creepsAlive: this.activeCount,
      nextWaveTicks: WAVE_EVERY_TICKS - (this.tickNo % WAVE_EVERY_TICKS),
      tick: this.tickNo
    };
  }

  /** Compact board snapshot for opponent mini-views (140 bytes + creep count). */
  boardSnapshot(): { grid: number[]; creeps: number } {
    const grid: number[] = new Array(GRID_W * GRID_H);
    for (let i = 0; i < GRID_W * GRID_H; i += 1) {
      grid[i] = this.towerType[i] === 0 ? 0 : this.towerType[i] * 4 + this.towerLevel[i];
    }
    return { grid, creeps: this.activeCount };
  }

  debugState(): Record<string, unknown> {
    return {
      tick: this.tickNo,
      wave: this.wave,
      lives: this.lives,
      gold: Math.floor(this.gold),
      income: this.income,
      creeps: this.activeCount,
      towers: this.towerCells.length,
      dead: this.dead,
      groups: this.groups.length,
      kills: this.kills
    };
  }

  /** FNV-1a over sim state — determinism regression tests. */
  stateHash(): number {
    let h = 0x811c9dc5;
    const mix = (v: number): void => {
      h ^= v & 0xff; h = Math.imul(h, 0x01000193);
      h ^= (v >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
      h ^= (v >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
      h ^= (v >>> 24) & 0xff; h = Math.imul(h, 0x01000193);
    };
    mix(this.tickNo); mix(this.lives); mix(Math.round(this.gold * 100)); mix(this.income); mix(this.wave); mix(this.activeCount);
    const f32 = (arr: Float32Array): void => {
      const u = new Uint32Array(arr.buffer, arr.byteOffset, arr.length);
      for (let i = 0; i < u.length; i += 1) mix(u[i]);
    };
    f32(this.pathPos); f32(this.hp);
    for (let i = 0; i < this.flags.length; i += 1) mix(this.flags[i] | (this.kindArr[i] << 8));
    for (let i = 0; i < this.towerType.length; i += 1) mix(this.towerType[i] | (this.towerLevel[i] << 8) | (this.towerCooldown[i] << 16));
    return h >>> 0;
  }

  dispose(): void {
    this.commands.length = 0;
    this.netInbox.length = 0;
    this.groups.length = 0;
  }
}
