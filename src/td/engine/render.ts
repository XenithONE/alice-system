// SIGNAL SIEGE renderer — pure view over TdEngine state. All randomness/FX here
// never feed back into the sim. Sprites are pre-rendered at init (repo rule:
// no per-frame shadowBlur). Board logical size: GRID_W*CELL x GRID_H*CELL.
//
// v2 BRICK UPDATE — toy-brick diorama matching the cover art: green studded
// baseplate, tan studded lane, stone-brick castles (red spawn / blue home),
// brick turret towers and chunky brick-soldier creeps. Rendering only: every
// engine field is read, never written.

import {
  GRID_W, GRID_H, CELL_PX,
  TOWERS, TOWER_KINDS, SENDS, type TowerKind
} from "./balance";
import { TdEngine, CREEP_WAVE_BOSS } from "./tdEngine";

const BOARD_W = GRID_W * CELL_PX;
const BOARD_H = GRID_H * CELL_PX;

// kind byte -> soldier color. [0] wave = toy blue (cover's marching army),
// [1..5] match SENDS button colors exactly, [6] wave boss = gold.
const CREEP_COLORS = ["#0055bf", "#9fe07a", "#7ad0e0", "#d8845a", "#b58cff", "#e05a7a", "#ffd166"];

const PLATE_GREEN = "#4b9f4a";
const PATH_TAN = "#d8c48a";
const CASTLE_STONE = "#b7b7bd";
const SPAWN_RED = "#c91a09"; // hostile gate (spawn side, matches old rose marker)
const HOME_BLUE = "#0055bf"; // your keep (exit side)

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amt));
  const b = Math.max(0, Math.min(255, (n & 0xff) + amt));
  return `rgb(${r},${g},${b})`;
}

// One 48px studded baseplate tile (4x4 studs), pre-rendered once per color.
function makeBaseTile(base: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = CELL_PX;
  c.height = CELL_PX;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, CELL_PX, CELL_PX);
  const hi = shade(base, 20);
  const lo = shade(base, -34);
  for (let gy = 0; gy < 4; gy += 1) {
    for (let gx = 0; gx < 4; gx += 1) {
      const cx = 6 + gx * 12;
      const cy = 6 + gy * 12;
      ctx.fillStyle = hi;
      ctx.beginPath();
      ctx.arc(cx, cy, 3.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = lo;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, 3.1, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.32)";
      ctx.beginPath();
      ctx.arc(cx, cy - 0.5, 2.1, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = "rgba(0,0,0,0.10)";
  ctx.strokeRect(0.5, 0.5, CELL_PX - 1, CELL_PX - 1);
  return c;
}

// Chunky brick soldier: legs + glossy torso brick + lighter head cylinder + stud.
function makeCreepSprite(color: string, big: boolean): HTMLCanvasElement {
  const s = big ? 1.6 : 1;
  const c = document.createElement("canvas");
  c.width = Math.ceil(28 * s);
  c.height = Math.ceil(34 * s);
  const ctx = c.getContext("2d")!;
  ctx.scale(s, s);
  // ground shadow
  ctx.fillStyle = "rgba(0,0,0,0.26)";
  ctx.beginPath();
  ctx.ellipse(14, 30.5, 8.5, 2.8, 0, 0, Math.PI * 2);
  ctx.fill();
  // legs
  ctx.fillStyle = shade(color, -48);
  ctx.fillRect(8.5, 21, 4.5, 8);
  ctx.fillRect(15, 21, 4.5, 8);
  // arms
  ctx.fillStyle = shade(color, -22);
  ctx.beginPath();
  ctx.roundRect(3.2, 12.5, 3.4, 7.5, 1.6);
  ctx.roundRect(21.4, 12.5, 3.4, 7.5, 1.6);
  ctx.fill();
  // torso brick
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(6, 10.5, 16, 12, 3);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.roundRect(6, 18.5, 16, 4, [0, 0, 3, 3]);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(8, 13);
  ctx.lineTo(19.5, 13);
  ctx.stroke();
  // head + stud
  ctx.fillStyle = shade(color, 26);
  ctx.beginPath();
  ctx.roundRect(9, 3.5, 10, 8, 2.5);
  ctx.fill();
  ctx.fillStyle = shade(color, 46);
  ctx.beginPath();
  ctx.roundRect(11.2, 0.8, 5.6, 3, 1.2);
  ctx.fill();
  // silhouette outline (readability on the bright baseplate)
  ctx.strokeStyle = "rgba(0,0,0,0.32)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(6, 10.5, 16, 12, 3);
  ctx.roundRect(9, 3.5, 10, 8, 2.5);
  ctx.stroke();
  return c;
}

// Brick turret: stone body + type-colored battlement cap (studs = level) and
// the original kind glyph on a dark plaque so tower reads stay identical.
function makeTowerSprite(kind: TowerKind, level: number): HTMLCanvasElement {
  const size = CELL_PX;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  const color = TOWERS[kind].color;
  // soft ground shade
  ctx.fillStyle = "rgba(0,0,0,0.30)";
  ctx.beginPath();
  ctx.roundRect(7, 40, 34, 6, 3);
  ctx.fill();
  // stone body
  ctx.fillStyle = CASTLE_STONE;
  ctx.beginPath();
  ctx.roundRect(7, 14, 34, 28, 4);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1;
  ctx.stroke();
  // mortar courses
  ctx.strokeStyle = "rgba(0,0,0,0.14)";
  ctx.beginPath();
  for (const my of [22, 30, 38]) { ctx.moveTo(8, my); ctx.lineTo(40, my); }
  ctx.moveTo(24, 14.5); ctx.lineTo(24, 22);
  ctx.moveTo(15, 22); ctx.lineTo(15, 30);
  ctx.moveTo(33, 22); ctx.lineTo(33, 30);
  ctx.moveTo(24, 30); ctx.lineTo(24, 38);
  ctx.stroke();
  // battlement cap in tower color
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(5, 8, 38, 9, 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.30)";
  ctx.stroke();
  for (const mx of [7, 21, 35]) ctx.fillRect(mx, 3.5, 6, 5.5);
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(7, 10.5);
  ctx.lineTo(41, 10.5);
  ctx.stroke();
  // studs = level
  ctx.fillStyle = shade(color, 38);
  for (let i = 0; i < level; i += 1) {
    const sx = 24 + (i - (level - 1) / 2) * 9;
    ctx.beginPath();
    ctx.arc(sx, 13, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  // body gloss
  ctx.strokeStyle = "rgba(255,255,255,0.30)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(9.5, 16.5);
  ctx.lineTo(9.5, 39.5);
  ctx.stroke();
  // dark plaque + glyph (same shapes as v1)
  ctx.fillStyle = "#14141a";
  ctx.strokeStyle = "rgba(205,170,109,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(14, 20, 20, 19, 3);
  ctx.fill();
  ctx.stroke();
  const cx = 24;
  const cy = 29.5;
  const r = Math.min(8.5, 5 + level * 1.8);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
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
  return c;
}

// Small brick castle drawn at a board edge (bg layer only — towers/creeps draw
// above it, so overlap into neighbor cells never hides anything interactive).
// Drawn as the LEFT castle; the right one is mirrored via ctx transform.
function drawCastle(ctx: CanvasRenderingContext2D, py: number, accent: string): void {
  ctx.fillStyle = CASTLE_STONE;
  ctx.beginPath();
  ctx.roundRect(-8, py - 46, 34, 92, 5);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1;
  ctx.stroke();
  // mortar
  ctx.strokeStyle = "rgba(0,0,0,0.13)";
  ctx.beginPath();
  for (let y = py - 34; y <= py + 40; y += 9) { ctx.moveTo(-2, y); ctx.lineTo(26, y); }
  ctx.moveTo(9, py - 34); ctx.lineTo(9, py - 25);
  ctx.moveTo(17, py - 16); ctx.lineTo(17, py - 7);
  ctx.moveTo(9, py + 2); ctx.lineTo(9, py + 11);
  ctx.moveTo(17, py + 20); ctx.lineTo(17, py + 29);
  ctx.stroke();
  // battlement cap + merlons
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.roundRect(-8, py - 56, 36, 12, 3);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.30)";
  ctx.stroke();
  for (const mx of [-4, 8, 20]) ctx.fillRect(mx, py - 62, 6, 7);
  ctx.strokeStyle = "rgba(255,255,255,0.42)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-6, py - 53);
  ctx.lineTo(26, py - 53);
  ctx.stroke();
  // studs on the cap
  ctx.fillStyle = shade(accent, 32);
  for (const sx of [6, 18]) {
    ctx.beginPath();
    ctx.arc(sx, py - 50, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // cannon port
  ctx.fillStyle = "#26262b";
  ctx.beginPath();
  ctx.arc(12, py - 26, 3, 0, Math.PI * 2);
  ctx.fill();
  // gate arch on the lane
  ctx.fillStyle = "#17171b";
  ctx.beginPath();
  ctx.moveTo(8, py + 13);
  ctx.lineTo(8, py - 4);
  ctx.arc(17, py - 4, 9, Math.PI, 0);
  ctx.lineTo(26, py + 13);
  ctx.closePath();
  ctx.fill();
  // flag
  ctx.strokeStyle = "#3c3c42";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(11, py - 62);
  ctx.lineTo(11, py - 72);
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(11, py - 72);
  ctx.lineTo(22, py - 68);
  ctx.lineTo(11, py - 64);
  ctx.closePath();
  ctx.fill();
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
      this.creepSprites.push(makeCreepSprite(CREEP_COLORS[k], k === CREEP_WAVE_BOSS || k === 5));
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
    // studded baseplate: green field, tan lane (both pre-rendered tiles)
    const greenTile = makeBaseTile(PLATE_GREEN);
    const tanTile = makeBaseTile(PATH_TAN);
    const mask = this.engine.path.mask;
    for (let i = 0; i < mask.length; i += 1) {
      const x = (i % GRID_W) * CELL_PX;
      const y = Math.floor(i / GRID_W) * CELL_PX;
      ctx.drawImage(mask[i] ? tanTile : greenTile, x, y);
    }
    // cell seams
    ctx.strokeStyle = "rgba(0,0,0,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= GRID_W; x += 1) { ctx.moveTo(x * CELL_PX + 0.5, 0); ctx.lineTo(x * CELL_PX + 0.5, BOARD_H); }
    for (let y = 0; y <= GRID_H; y += 1) { ctx.moveTo(0, y * CELL_PX + 0.5); ctx.lineTo(BOARD_W, y * CELL_PX + 0.5); }
    ctx.stroke();
    // lane edging
    ctx.strokeStyle = "rgba(120,92,46,0.38)";
    for (let i = 0; i < mask.length; i += 1) {
      if (!mask[i]) continue;
      ctx.strokeRect((i % GRID_W) * CELL_PX + 1, Math.floor(i / GRID_W) * CELL_PX + 1, CELL_PX - 2, CELL_PX - 2);
    }
    // lane center line (march direction)
    ctx.strokeStyle = "rgba(96,72,38,0.5)";
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
    // castles: red hostile gate at spawn (left), blue home keep at exit (right)
    this.engine.path.posAt(0, p);
    drawCastle(ctx, p.y, SPAWN_RED);
    this.engine.path.posAt(this.engine.path.totalLen, p);
    ctx.save();
    ctx.translate(BOARD_W, 0);
    ctx.scale(-1, 1);
    drawCastle(ctx, p.y, HOME_BLUE);
    ctx.restore();
    return c;
  }

  private renderGradeLayer(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = BOARD_W;
    c.height = BOARD_H;
    const ctx = c.getContext("2d")!;
    const v = ctx.createRadialGradient(BOARD_W / 2, BOARD_H / 2, BOARD_H * 0.35, BOARD_W / 2, BOARD_H / 2, BOARD_W * 0.72);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.30)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);
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
      ctx.fillStyle = blocked ? "rgba(201,26,9,0.28)" : "rgba(255,255,255,0.30)";
      ctx.fillRect(x, y, CELL_PX, CELL_PX);
      if (this.hoverKind && !blocked) {
        const range = TOWERS[this.hoverKind].levels[0].range * CELL_PX;
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = 1.5;
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
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 1, y + 1, CELL_PX - 2, CELL_PX - 2);
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
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
    ctx.globalCompositeOperation = "source-over";

    // projectiles — brick-ish squares (dark rim for read on the bright plate)
    for (let i = 0; i < e.pjAlive.length; i += 1) {
      if (!e.pjAlive[i]) continue;
      const s = e.pjKind[i] === 1 ? 8 : 5;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(e.pjX[i] - s / 2 - 1, e.pjY[i] - s / 2 - 1, s + 2, s + 2);
      ctx.fillStyle = "#ffd166";
      ctx.fillRect(e.pjX[i] - s / 2, e.pjY[i] - s / 2, s, s);
    }

    // creeps (interpolated along the path)
    const p = this.scratch;
    for (let i = 0; i < e.activeCount; i += 1) {
      const s = e.active[i];
      const d = e.prevPos[s] + (e.pathPos[s] - e.prevPos[s]) * alpha;
      e.path.posAt(d, p);
      const kind = e.kindArr[s];
      const sprite = this.creepSprites[kind];
      ctx.drawImage(sprite, p.x - sprite.width / 2, p.y - sprite.height / 2);
      // hp bar (just above the soldier's head stud)
      const frac = Math.max(0, e.hp[s] / e.maxHp[s]);
      if (frac < 1) {
        const w = kind === CREEP_WAVE_BOSS || kind === 5 ? 30 : 18;
        const by = p.y - sprite.height / 2 - 4;
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(p.x - w / 2, by, w, 3);
        ctx.fillStyle = frac > 0.5 ? "#9fe07a" : frac > 0.25 ? "#ffd166" : "#e05a7a";
        ctx.fillRect(p.x - w / 2, by, w * frac, 3);
      }
      // shield ring
      if ((e.flags[s] & 2) !== 0) {
        ctx.strokeStyle = "rgba(181,140,255,0.9)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.drawImage(this.gradeLayer, 0, 0);
    ctx.restore();
  }
}

export const BOARD_SIZE = { w: BOARD_W, h: BOARD_H };
