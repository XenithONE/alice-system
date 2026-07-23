import type { Board, BoardNode, NodeKind } from "../engine/types";
import type { RivalView } from "../net/protocol";

export interface BoardRenderOptions {
  board: Board;
  players: RivalView[];
  you: number;
  current: number;
  reachable: Set<number>;
  traps: Record<number, unknown>;
  size: { w: number; h: number };
  kbFocus?: number | null;
}

const MARGIN = 40;
const NODE_SIZE = 34;
const PAWN_COLORS = ["#c91a09", "#0055bf", "#4b9f4a", "#7a5fd0"];

function point(node: BoardNode, size: BoardRenderOptions["size"]) {
  return {
    x: MARGIN + node.x * Math.max(0, size.w - MARGIN * 2),
    y: MARGIN + node.y * Math.max(0, size.h - MARGIN * 2),
  };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function nodeColor(kind: NodeKind) {
  switch (kind) {
    case "start": return "#fff";
    case "path": return "#dfe5ec";
    case "monster": return "#e98a80";
    case "elite": return "#8e1206";
    case "event": return "#f7df78";
    case "shop": return "#74a4dc";
    case "camp": return "#94c793";
    case "shrine": return "#7a5fd0";
    case "portal": return "#20242a";
  }
}

function glyph(ctx: CanvasRenderingContext2D, kind: NodeKind, x: number, y: number) {
  ctx.save();
  ctx.strokeStyle = kind === "elite" || kind === "shrine" || kind === "portal" ? "#fff" : "#28303a";
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (kind === "monster" || kind === "elite") {
    ctx.moveTo(x - 6, y + 6); ctx.lineTo(x + 5, y - 7); ctx.moveTo(x - 2, y - 5); ctx.lineTo(x + 7, y + 4);
  } else if (kind === "event") {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const r = i % 2 ? 3 : 7;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  } else if (kind === "shop") {
    ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4);
  } else if (kind === "camp") {
    ctx.moveTo(x - 8, y + 6); ctx.lineTo(x, y - 7); ctx.lineTo(x + 8, y + 6); ctx.closePath();
    ctx.moveTo(x, y - 7); ctx.lineTo(x, y + 6);
  } else if (kind === "shrine") {
    ctx.moveTo(x, y - 8); ctx.lineTo(x + 7, y); ctx.lineTo(x, y + 8); ctx.lineTo(x - 7, y); ctx.closePath();
  } else if (kind === "portal") {
    ctx.strokeStyle = "#f2cd37"; ctx.lineWidth = 3; ctx.arc(x, y, 8, 0, Math.PI * 2);
  } else {
    ctx.arc(x, y, 3, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.restore();
}

function drawPawn(ctx: CanvasRenderingContext2D, x: number, y: number, seat: number, current: boolean) {
  const ox = (seat % 2) * 11 - 5.5;
  const oy = Math.floor(seat / 2) * 9 - 4;
  x += ox; y += oy;
  if (current) {
    ctx.strokeStyle = "#f2cd37"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y - 15, 10, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = PAWN_COLORS[seat % PAWN_COLORS.length];
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
  roundRect(ctx, x - 6, y - 17, 12, 11, 4); ctx.fill(); ctx.stroke();
  roundRect(ctx, x - 8, y - 8, 16, 11, 3); ctx.fill(); ctx.stroke();
}

export function drawBoard(ctx: CanvasRenderingContext2D, opts: BoardRenderOptions): void {
  const { w, h } = opts.size;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#f7f0dc"; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(105,86,50,.08)";
  for (let x = 14; x < w; x += 24) for (let y = 14; y < h; y += 24) {
    ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.lineCap = "round";
  for (const node of opts.board.nodes) {
    const a = point(node, opts.size);
    for (const edge of node.edges) {
      if (edge < node.id) continue;
      const other = opts.board.nodes.find(n => n.id === edge);
      if (!other) continue;
      const b = point(other, opts.size);
      ctx.strokeStyle = "#b8c0c9"; ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = "#edf0f3"; ctx.lineWidth = 5; ctx.stroke();
    }
  }
  for (const node of opts.board.nodes) {
    const p = point(node, opts.size);
    if (opts.reachable.has(node.id)) {
      ctx.strokeStyle = "#2f812e"; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(p.x, p.y, 23, 0, Math.PI * 2); ctx.stroke();
    }
    if (opts.kbFocus === node.id) {
      ctx.save();
      ctx.setLineDash([6, 4]); ctx.strokeStyle = "#0055bf"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(p.x, p.y, 28, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    const trap = opts.traps[node.id] as { by?: number } | undefined;
    if (trap?.by === opts.you) {
      ctx.fillStyle = "#6c311f";
      for (const dx of [-9, 0, 9]) { ctx.beginPath(); ctx.moveTo(p.x + dx - 3, p.y + 21); ctx.lineTo(p.x + dx, p.y + 14); ctx.lineTo(p.x + dx + 3, p.y + 21); ctx.fill(); }
    }
    ctx.shadowColor = "rgba(20,24,30,.2)"; ctx.shadowBlur = 3; ctx.shadowOffsetY = 2;
    ctx.fillStyle = nodeColor(node.kind); ctx.strokeStyle = "rgba(20,24,30,.35)"; ctx.lineWidth = 1;
    roundRect(ctx, p.x - 17, p.y - 17, NODE_SIZE, NODE_SIZE, 8); ctx.fill(); ctx.stroke();
    ctx.shadowColor = "transparent";
    ctx.fillStyle = "rgba(255,255,255,.65)";
    for (const dx of [-7, 7]) { ctx.beginPath(); ctx.ellipse(p.x + dx, p.y - 14, 4.5, 2.4, 0, 0, Math.PI * 2); ctx.fill(); }
    glyph(ctx, node.kind, p.x, p.y);
    ctx.fillStyle = node.kind === "elite" || node.kind === "portal" ? "#fff" : "#3f4751";
    for (let i = 0; i < node.tier; i++) { ctx.beginPath(); ctx.arc(p.x + (i - (node.tier - 1) / 2) * 5, p.y + 12, 1.4, 0, Math.PI * 2); ctx.fill(); }
  }
  for (const player of opts.players) {
    const node = opts.board.nodes.find(n => n.id === player.node);
    if (node) { const p = point(node, opts.size); drawPawn(ctx, p.x, p.y, player.seat, player.seat === opts.current); }
  }
}

export function hitTestNode(opts: BoardRenderOptions, px: number, py: number): number | null {
  let best: { id: number; d: number } | null = null;
  for (const node of opts.board.nodes) {
    const p = point(node, opts.size);
    const d = Math.hypot(px - p.x, py - p.y);
    if (d <= NODE_SIZE / 2 + 6 && (!best || d < best.d)) best = { id: node.id, d };
  }
  return best?.id ?? null;
}
