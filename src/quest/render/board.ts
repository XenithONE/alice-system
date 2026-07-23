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
  /** Fires once when board-plate (or other board images) finish loading so the host can redraw. */
  onAssetReady?: () => void;
}

const MARGIN = 40;
const NODE_SIZE = 34;
const PAWN_COLORS = ["#c91a09", "#0055bf", "#4b9f4a", "#7a5fd0"];

/* §2 palette */
const PARCHMENT = "#f3ead2";
const SAND = "#dcc89a";
const SAND_EDGE = "#c4ad7a";
const PATH_HI = "#f0e4c4";

const PLATE_URL = "/assets/quest/board-plate.webp";
let plateImg: HTMLImageElement | null = null;
let plateStatus: "idle" | "loading" | "ready" | "error" = "idle";
const plateReadyListeners = new Set<() => void>();

/** Subscribe for a one-shot ready notification while loading. Already-ready does not re-fire. */
function ensurePlate(onReady?: () => void): void {
  if (plateStatus === "ready" || plateStatus === "error") return;
  if (onReady) plateReadyListeners.add(onReady);
  if (plateStatus === "loading") return;
  plateStatus = "loading";
  const img = new Image();
  img.decoding = "async";
  img.onload = () => {
    plateImg = img;
    plateStatus = "ready";
    const listeners = [...plateReadyListeners];
    plateReadyListeners.clear();
    for (const fn of listeners) fn();
  };
  img.onerror = () => {
    plateStatus = "error";
    plateImg = null;
    plateReadyListeners.clear();
  };
  img.src = PLATE_URL;
}

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
    case "path": return "#e8edf3";
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
    ctx.fillStyle = "#c4b0f0";
    ctx.strokeStyle = "#fff";
    ctx.moveTo(x, y - 9); ctx.lineTo(x + 8, y); ctx.lineTo(x, y + 9); ctx.lineTo(x - 8, y); ctx.closePath();
    ctx.fill();
  } else if (kind === "portal") {
    // gold ring + purple core (cover-aligned)
    ctx.fillStyle = "#7a5fd0";
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#f2cd37"; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = "rgba(242,205,55,.45)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    return;
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
    ctx.strokeStyle = "#f2cd37"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y - 16, 11, 0, Math.PI * 2); ctx.stroke();
  }
  const color = PAWN_COLORS[seat % PAWN_COLORS.length]!;
  // body
  ctx.fillStyle = color;
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
  roundRect(ctx, x - 8, y - 8, 16, 12, 3); ctx.fill(); ctx.stroke();
  // head
  ctx.beginPath(); ctx.arc(x, y - 14, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // head highlight
  ctx.fillStyle = "rgba(255,255,255,.35)";
  ctx.beginPath(); ctx.arc(x - 1.5, y - 15.5, 2, 0, Math.PI * 2); ctx.fill();
}

function drawFallbackBase(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#f8f1dc");
  grad.addColorStop(1, PARCHMENT);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  // soft plate wash
  ctx.fillStyle = "rgba(90,158,75,.12)";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(105,86,50,.1)";
  for (let x = 14; x < w; x += 24) {
    for (let y = 14; y < h; y += 24) {
      ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawPlateBase(ctx: CanvasRenderingContext2D, w: number, h: number) {
  if (plateImg && plateStatus === "ready") {
    try {
      const pattern = ctx.createPattern(plateImg, "repeat");
      if (pattern) {
        ctx.save();
        // Scale pattern for stud density on large boards
        const scale = 0.55;
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, w / scale, h / scale);
        ctx.restore();
        // Warm parchment multiply for path readability
        ctx.fillStyle = "rgba(243,234,210,.28)";
        ctx.fillRect(0, 0, w, h);
        return;
      }
    } catch {
      /* fall through */
    }
  }
  drawFallbackBase(ctx, w, h);
}

export function drawBoard(ctx: CanvasRenderingContext2D, opts: BoardRenderOptions): void {
  const { w, h } = opts.size;
  // Kick off plate load; notify host once when the image first becomes ready.
  ensurePlate(opts.onAssetReady);

  ctx.clearRect(0, 0, w, h);
  drawPlateBase(ctx, w, h);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // edges: sand brick paths
  for (const node of opts.board.nodes) {
    const a = point(node, opts.size);
    for (const edge of node.edges) {
      if (edge < node.id) continue;
      const other = opts.board.nodes.find(n => n.id === edge);
      if (!other) continue;
      const b = point(other, opts.size);
      ctx.strokeStyle = SAND_EDGE; ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = SAND; ctx.lineWidth = 7; ctx.stroke();
      ctx.strokeStyle = PATH_HI; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.55; ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  for (const node of opts.board.nodes) {
    const p = point(node, opts.size);
    if (opts.reachable.has(node.id)) {
      ctx.fillStyle = "rgba(47,129,46,.12)";
      ctx.beginPath(); ctx.arc(p.x, p.y, 24, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#2f812e"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(p.x, p.y, 23, 0, Math.PI * 2); ctx.stroke();
    }
    if (opts.kbFocus === node.id) {
      ctx.save();
      ctx.setLineDash([6, 4]); ctx.strokeStyle = "#0055bf"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(p.x, p.y, 28, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    const trap = opts.traps[node.id] as { by?: number } | undefined;
    if (trap?.by === opts.you) {
      ctx.fillStyle = "#3a1c12";
      for (const dx of [-9, 0, 9]) {
        ctx.beginPath();
        ctx.moveTo(p.x + dx - 3.5, p.y + 22);
        ctx.lineTo(p.x + dx, p.y + 13);
        ctx.lineTo(p.x + dx + 3.5, p.y + 22);
        ctx.fill();
      }
    }

    // block thickness (2px offset under body)
    ctx.fillStyle = "rgba(20,24,30,.28)";
    roundRect(ctx, p.x - 17, p.y - 15, NODE_SIZE, NODE_SIZE, 8); ctx.fill();

    ctx.shadowColor = "rgba(20,24,30,.22)"; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2;
    ctx.fillStyle = nodeColor(node.kind); ctx.strokeStyle = "rgba(20,24,30,.35)"; ctx.lineWidth = 1;
    roundRect(ctx, p.x - 17, p.y - 17, NODE_SIZE, NODE_SIZE, 8); ctx.fill(); ctx.stroke();
    ctx.shadowColor = "transparent";

    // top stud grid (2×2)
    ctx.fillStyle = "rgba(255,255,255,.55)";
    for (const dx of [-7, 7]) {
      for (const dy of [-12, -6]) {
        ctx.beginPath(); ctx.ellipse(p.x + dx, p.y + dy, 3.6, 2.1, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    // top edge shine
    ctx.strokeStyle = "rgba(255,255,255,.45)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(p.x - 12, p.y - 14); ctx.lineTo(p.x + 12, p.y - 14); ctx.stroke();

    glyph(ctx, node.kind, p.x, p.y + 1);
    ctx.fillStyle = node.kind === "elite" || node.kind === "portal" ? "#fff" : "#3f4751";
    for (let i = 0; i < node.tier; i++) {
      ctx.beginPath();
      ctx.arc(p.x + (i - (node.tier - 1) / 2) * 5, p.y + 12, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (const player of opts.players) {
    const node = opts.board.nodes.find(n => n.id === player.node);
    if (node) {
      const p = point(node, opts.size);
      drawPawn(ctx, p.x, p.y, player.seat, player.seat === opts.current);
    }
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
