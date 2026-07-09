// SIGNAL SIEGE renderer — pure view over TdEngine state. All randomness/FX here
// never feed back into the sim. Sprites are pre-rendered at init (repo rule:
// no per-frame shadowBlur). Board logical size: GRID_W*CELL x GRID_H*CELL.

import {
  GRID_W, GRID_H, CELL_PX,
  TOWERS, TOWER_KINDS, SENDS, type TowerKind
} from "./balance";
import { TdEngine, CREEP_WAVE_BOSS } from "./tdEngine";

const BOARD_W = GRID_W * CELL_PX;
const BOARD_H = GRID_H * CELL_PX;

const CREEP_COLORS = ["#c8b8a0", "#9fe07a", "#7ad0e0", "#d8845a", "#b58cff", "#e05a7a", "#ffd166"];

function makeGlowDisc(color: string, radius: number): HTMLCanvasElement {
  const size = radius * 4;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, color);
  g.addColorStop(0.45, color + "88");
  g.addColorStop(1, color + "00");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#0a0a0c";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, radius * 0.66, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, radius * 0.52, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

function makeTowerSprite(kind: TowerKind, level: number): HTMLCanvasElement {
  const size = CELL_PX;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  const color = TOWERS[kind].color;
  const cx = size / 2;
  const cy = size / 2;
  // base plate
  ctx.fillStyle = "#14141a";
  ctx.strokeStyle = "rgba(205,170,109,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(4, 4, size - 8, size - 8, 6);
  ctx.fill();
  ctx.stroke();
  // glyph per kind
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  const r = 6 + level * 2.4;
  ctx.beginPath();
  if (kind === "arrow") {
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r * 0.8, cy + r * 0.7);
    ctx.lineTo(cx, cy + r * 0.25);
    ctx.lineTo(cx - r * 0.8, cy + r * 0.7);
    ctx.closePath();
    ctx.fill();
  } else if (kind === "cannon") {
    ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(cx - 2, cy - r - 3, 4, r);
  } else if (kind === "frost") {
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.stroke();
  } else if (kind === "tesla") {
    ctx.moveTo(cx - r * 0.5, cy - r);
    ctx.lineTo(cx + r * 0.3, cy - r * 0.15);
    ctx.lineTo(cx - r * 0.3, cy + r * 0.15);
    ctx.lineTo(cx + r * 0.5, cy + r);
    ctx.stroke();
  } else {
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  // level pips
  ctx.fillStyle = "#cdaa6d";
  for (let i = 0; i < level; i += 1) ctx.fillRect(7 + i * 6, size - 9, 4, 3);
  return c;
}

export class TdRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly bgLayer: HTMLCanvasElement;
  private readonly gradeLayer: HTMLCanvasElement;
  private readonly towerSprites = new Map<string, HTMLCanvasElement>();
  private readonly creepSprites: HTMLCanvasElement[] = [];
  private hoverCell = -1;
  private hoverKind: TowerKind | null = null;
  private selectedCell = -1;
  private shake = 0;
  private readonly scratch = { x: 0, y: 0 };

  constructor(private readonly canvas: HTMLCanvasElement, private readonly engine: TdEngine) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = BOARD_W * dpr;
    canvas.height = BOARD_H * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    this.ctx = ctx;

    for (const kind of TOWER_KINDS) {
      for (let level = 1; level <= 3; level += 1) {
        this.towerSprites.set(`${kind}${level}`, makeTowerSprite(kind, level));
      }
    }
    for (let k = 0; k <= 6; k += 1) {
      this.creepSprites.push(makeGlowDisc(CREEP_COLORS[k], k === CREEP_WAVE_BOSS || k === 5 ? 13 : 8));
    }

    this.bgLayer = this.renderBgLayer();
    this.gradeLayer = this.renderGradeLayer();
  }

  setHover(cell: number, kind: TowerKind | null): void {
    this.hoverCell = cell;
    this.hoverKind = kind;
  }
  setSelected(cell: number): void {
    this.selectedCell = cell;
  }
  kick(strength: number): void {
    this.shake = Math.min(8, this.shake + strength);
  }

  private renderBgLayer(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = BOARD_W;
    c.height = BOARD_H;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#0b0b0f";
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);
    // grid hairlines
    ctx.strokeStyle = "rgba(235,235,240,0.05)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= GRID_W; x += 1) { ctx.moveTo(x * CELL_PX + 0.5, 0); ctx.lineTo(x * CELL_PX + 0.5, BOARD_H); }
    for (let y = 0; y <= GRID_H; y += 1) { ctx.moveTo(0, y * CELL_PX + 0.5); ctx.lineTo(BOARD_W, y * CELL_PX + 0.5); }
    ctx.stroke();
    // path
    const mask = this.engine.path.mask;
    for (let i = 0; i < mask.length; i += 1) {
      if (!mask[i]) continue;
      const x = (i % GRID_W) * CELL_PX;
      const y = Math.floor(i / GRID_W) * CELL_PX;
      ctx.fillStyle = "rgba(205,170,109,0.08)";
      ctx.fillRect(x, y, CELL_PX, CELL_PX);
    }
    // path center line
    ctx.strokeStyle = "rgba(205,170,109,0.35)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    const p = this.scratch;
    this.engine.path.posAt(0, p);
    ctx.moveTo(p.x, p.y);
    for (let d = 0.5; d <= this.engine.path.totalLen; d += 0.5) {
      this.engine.path.posAt(d, p);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // spawn / exit markers
    this.engine.path.posAt(0, p);
    ctx.fillStyle = "rgba(224,90,122,0.8)";
    ctx.fillRect(0, p.y - 14, 4, 28);
    this.engine.path.posAt(this.engine.path.totalLen, p);
    ctx.fillStyle = "rgba(205,170,109,0.8)";
    ctx.fillRect(BOARD_W - 4, p.y - 14, 4, 28);
    return c;
  }

  private renderGradeLayer(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = BOARD_W;
    c.height = BOARD_H;
    const ctx = c.getContext("2d")!;
    const v = ctx.createRadialGradient(BOARD_W / 2, BOARD_H / 2, BOARD_H * 0.35, BOARD_W / 2, BOARD_H / 2, BOARD_W * 0.72);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.42)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);
    ctx.fillStyle = "rgba(0,0,0,0.10)";
    for (let y = 0; y < BOARD_H; y += 3) ctx.fillRect(0, y, BOARD_W, 1);
    return c;
  }

  draw(alpha: number): void {
    const ctx = this.ctx;
    const e = this.engine;
    ctx.save();
    if (this.shake > 0.05) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.shake *= 0.85;
    }
    ctx.drawImage(this.bgLayer, 0, 0);

    // hover / selection
    if (this.hoverCell >= 0) {
      const x = (this.hoverCell % GRID_W) * CELL_PX;
      const y = Math.floor(this.hoverCell / GRID_W) * CELL_PX;
      const blocked = e.path.mask[this.hoverCell] === 1 || e.towerType[this.hoverCell] !== 0;
      ctx.fillStyle = blocked ? "rgba(224,90,122,0.18)" : "rgba(205,170,109,0.16)";
      ctx.fillRect(x, y, CELL_PX, CELL_PX);
      if (this.hoverKind && !blocked) {
        const range = TOWERS[this.hoverKind].levels[0].range * CELL_PX;
        ctx.strokeStyle = "rgba(205,170,109,0.3)";
        ctx.beginPath();
        ctx.arc(x + CELL_PX / 2, y + CELL_PX / 2, range, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (this.selectedCell >= 0 && e.towerType[this.selectedCell] !== 0) {
      const x = (this.selectedCell % GRID_W) * CELL_PX;
      const y = Math.floor(this.selectedCell / GRID_W) * CELL_PX;
      const kind = TOWER_KINDS[e.towerType[this.selectedCell] - 1];
      const range = TOWERS[kind].levels[e.towerLevel[this.selectedCell] - 1].range * CELL_PX;
      ctx.strokeStyle = "rgba(205,170,109,0.45)";
      ctx.strokeRect(x + 1, y + 1, CELL_PX - 2, CELL_PX - 2);
      ctx.beginPath();
      ctx.arc(x + CELL_PX / 2, y + CELL_PX / 2, range, 0, Math.PI * 2);
      ctx.stroke();
    }

    // towers
    for (const cell of e.towerCells) {
      const t = e.towerType[cell];
      if (t === 0) continue;
      const sprite = this.towerSprites.get(`${TOWER_KINDS[t - 1]}${e.towerLevel[cell]}`);
      if (sprite) ctx.drawImage(sprite, (cell % GRID_W) * CELL_PX, Math.floor(cell / GRID_W) * CELL_PX);
    }

    // beams
    ctx.globalCompositeOperation = "lighter";
    for (const b of e.beams) {
      if (b.ttl <= 0) continue;
      b.ttl -= 1;
      const a = b.ttl / 6;
      ctx.strokeStyle = b.kind === "frost" ? `rgba(127,200,232,${0.7 * a})` : `rgba(181,140,255,${0.7 * a})`;
      ctx.lineWidth = b.kind === "frost" ? 2 : 2.5;
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y1);
      if (b.kind === "tesla") {
        const mx = (b.x1 + b.x2) / 2 + (Math.random() - 0.5) * 10;
        const my = (b.y1 + b.y2) / 2 + (Math.random() - 0.5) * 10;
        ctx.quadraticCurveTo(mx, my, b.x2, b.y2);
      } else {
        ctx.lineTo(b.x2, b.y2);
      }
      ctx.stroke();
    }

    // projectiles
    ctx.fillStyle = "#ffd166";
    for (let i = 0; i < e.pjAlive.length; i += 1) {
      if (!e.pjAlive[i]) continue;
      ctx.beginPath();
      ctx.arc(e.pjX[i], e.pjY[i], e.pjKind[i] === 1 ? 4 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";

    // creeps (interpolated along the path)
    const p = this.scratch;
    for (let i = 0; i < e.activeCount; i += 1) {
      const s = e.active[i];
      const d = e.prevPos[s] + (e.pathPos[s] - e.prevPos[s]) * alpha;
      e.path.posAt(d, p);
      const kind = e.kindArr[s];
      const sprite = this.creepSprites[kind];
      ctx.drawImage(sprite, p.x - sprite.width / 2, p.y - sprite.height / 2);
      // hp bar
      const frac = Math.max(0, e.hp[s] / e.maxHp[s]);
      if (frac < 1) {
        const w = kind === CREEP_WAVE_BOSS || kind === 5 ? 30 : 18;
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(p.x - w / 2, p.y - 18, w, 3);
        ctx.fillStyle = frac > 0.5 ? "#9fe07a" : frac > 0.25 ? "#ffd166" : "#e05a7a";
        ctx.fillRect(p.x - w / 2, p.y - 18, w * frac, 3);
      }
      // shield ring
      if ((e.flags[s] & 2) !== 0) {
        ctx.strokeStyle = "rgba(181,140,255,0.8)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.drawImage(this.gradeLayer, 0, 0);
    ctx.restore();
  }
}

export const BOARD_SIZE = { w: BOARD_W, h: BOARD_H };
