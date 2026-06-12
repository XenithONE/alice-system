/* ============================================================
   I WANNA BE THE SIGNAL — engine.js（MVPスキャフォールド）
   担当: エンジン班（XenithONE + Claude）

   ・仮グラフィック（図形）で全要素が動く状態
   ・assets/sprites/ に ASSET_SPEC.md 通りのPNGを置くと
     自動でスプライトに切り替わる（コード変更は不要）
   ・レベルは levels/level1.js のASCIIマップ
     #=地形  ^=トゲ(即死)  S=セーブ  G=ゴール  P=スタート  .=空
============================================================ */
(() => {
'use strict';

/* ---------- 定数 ---------- */
const TILE = 32;
const VIEW_W = 960, VIEW_H = 544;
const GRAVITY = 1700, MOVE = 190, JUMP1 = -540, JUMP2 = -500, MAX_FALL = 900;
const C = { bg:'#04060b', ink:'#eaf4f2', teal:'#33e7c8', violet:'#7b4dff',
            red:'#ff3b5c', block:'#1d2738' };

const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
ctx.imageSmoothingEnabled = false;

/* ---------- スプライト自動ロード（アート班の絵が来たら勝手に反映） ---------- */
const SHEET = { player_idle:2, player_run:6, player_jump:2, player_dead:4,
  tile_ground:1, tile_wall:1, hazard_spike:1, savepoint:4, door_goal:1, bg_stage1:1 };
const SPR = {};
Object.entries(SHEET).forEach(([name, frames]) => {
  const img = new Image();
  img.onload = () => { SPR[name] = { img, frames, fw: Math.floor(img.width / frames), fh: img.height }; };
  img.onerror = () => {};
  img.src = 'assets/sprites/' + name + '.png';
});
function spr(name, frame, dx, dy, dw, dh, flip) {
  const s = SPR[name]; if (!s) return false;
  const f = Math.floor(frame) % s.frames;
  ctx.save();
  if (flip) { ctx.translate(dx + dw, dy); ctx.scale(-1, 1);
    ctx.drawImage(s.img, f * s.fw, 0, s.fw, s.fh, 0, 0, dw, dh); }
  else ctx.drawImage(s.img, f * s.fw, 0, s.fw, s.fh, dx, dy, dw, dh);
  ctx.restore();
  return true;
}

/* ---------- サウンド（WebAudioビープ・Mでミュート） ---------- */
let actx = null, mute = false;
function tone(f, d = 0.08, type = 'square', g = 0.04) {
  if (mute) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), gn = actx.createGain();
    o.type = type; o.frequency.value = f; o.connect(gn); gn.connect(actx.destination);
    const t = actx.currentTime;
    gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(g, t + 0.01);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + d); o.start(t); o.stop(t + d);
  } catch (e) {}
}

/* ---------- レベル ---------- */
const DEF = (window.GAME_LEVELS || [])[0] || { name: 'NO LEVEL', map: ['P.', '##'] };
function parseLevel(def) {
  const rows = def.map, h = rows.length, w = Math.max(...rows.map(r => r.length));
  const solid = new Set(), spikes = [], saves = [], goals = [];
  let spawn = { x: TILE * 1.5, y: TILE };
  rows.forEach((row, ty) => { [...row].forEach((ch, tx) => {
    if (ch === '#') solid.add(tx + ',' + ty);
    else if (ch === '^') spikes.push({ tx, ty });
    else if (ch === 'S') saves.push({ tx, ty });
    else if (ch === 'G') goals.push({ tx, ty });
    else if (ch === 'P') spawn = { x: tx * TILE + TILE / 2, y: (ty + 1) * TILE };
  }); });
  return { name: def.name || 'STAGE', w, h, solid, spikes, saves, goals, spawn };
}
const LV = parseLevel(DEF);
const isSolid = (tx, ty) => LV.solid.has(tx + ',' + ty);
function rectSolid(l, t, r, b) {
  const x0 = Math.floor(l / TILE), x1 = Math.floor((r - 0.01) / TILE);
  const y0 = Math.floor(t / TILE), y1 = Math.floor((b - 0.01) / TILE);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++)
    if (isSolid(tx, ty)) return true;
  return false;
}

/* ---------- 状態 ---------- */
const P = { x: 0, y: 0, vx: 0, vy: 0, w: 20, h: 28, face: 1, ground: false, jumps: 2, anim: 0 };
let checkpoint = { ...LV.spawn };
let deaths = +(localStorage.getItem('signal_deaths') || 0);
let state = 'title';            // title | play | dead | clear
let deadT = 0, toast = '', toastT = 0, time = 0, activeSave = -1;
const parts = [];

function placeAt(pt) { P.x = pt.x; P.y = pt.y; P.vx = P.vy = 0; P.jumps = 2; P.ground = true; }
function respawn() { placeAt(checkpoint); state = 'play'; }
function toastMsg(s) { toast = s; toastT = 2.2; }
function die() {
  if (state !== 'play') return;
  state = 'dead'; deadT = 0;
  deaths++; localStorage.setItem('signal_deaths', deaths);
  for (let i = 0; i < 26; i++) parts.push({ x: P.x, y: P.y - P.h / 2,
    vx: (Math.random() * 2 - 1) * 260, vy: -Math.random() * 330, t: 0.7 + Math.random() * 0.4 });
  tone(220, 0.12, 'sawtooth', 0.06); setTimeout(() => tone(110, 0.25, 'sawtooth', 0.05), 60);
}
placeAt(checkpoint);

/* ---------- 入力 ---------- */
const keys = {};
const JUMPK = ['z', 'Z', ' ', 'ArrowUp', 'w', 'W'];
addEventListener('keydown', e => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
  if (e.repeat) return;
  if (state === 'title') { state = 'play'; tone(660, .1, 'square', .05); return; }
  if (state === 'clear') {
    if (e.key === 'r' || e.key === 'R') { checkpoint = { ...LV.spawn }; activeSave = -1; respawn(); }
    return;
  }
  if (e.key === 'm' || e.key === 'M') { mute = !mute; toastMsg(mute ? 'MUTE ON' : 'MUTE OFF'); return; }
  if (e.key === 'r' || e.key === 'R') { die(); return; }
  keys[e.key] = true;
  if (JUMPK.includes(e.key) && state === 'play' && P.jumps > 0) {
    const first = P.ground;
    P.vy = first ? JUMP1 : JUMP2; P.jumps--; P.ground = false;
    tone(first ? 520 : 640, 0.07, 'square', 0.04);
  }
});
addEventListener('keyup', e => {
  keys[e.key] = false;
  if (JUMPK.includes(e.key) && P.vy < 0) P.vy *= 0.45;   // 可変ジャンプ
});
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

/* ---------- 更新 ---------- */
function moveAxis(dx, dy) {           // 4px刻みで進めて衝突したら止める
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 4));
  const sx = dx / steps, sy = dy / steps;
  for (let i = 0; i < steps; i++) {
    if (rectSolid(P.x - P.w / 2 + sx, P.y - P.h + sy, P.x + P.w / 2 + sx, P.y + sy)) return true;
    P.x += sx; P.y += sy;
  }
  return false;
}
function updateParts(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.t -= dt;
    if (p.t <= 0) { parts.splice(i, 1); continue; }
    p.vy += 1300 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
  }
}
function update(dt) {
  time += dt;
  if (toastT > 0) toastT -= dt;
  updateParts(dt);
  if (state === 'dead') { deadT += dt; if (deadT > 0.9) respawn(); return; }
  if (state !== 'play') return;

  const Lk = keys['ArrowLeft'] || keys['a'] || keys['A'];
  const Rk = keys['ArrowRight'] || keys['d'] || keys['D'];
  P.vx = (Rk ? MOVE : 0) - (Lk ? MOVE : 0);
  if (P.vx) P.face = P.vx > 0 ? 1 : -1;
  P.vy = Math.min(P.vy + GRAVITY * dt, MAX_FALL);

  moveAxis(P.vx * dt, 0);
  const vy0 = P.vy;
  if (moveAxis(0, P.vy * dt)) {
    if (vy0 > 0) { P.ground = true; P.jumps = 2; }
    P.vy = 0;
  } else if (P.vy > 40) P.ground = false;

  const pl = P.x - P.w / 2, pr = P.x + P.w / 2, pt = P.y - P.h, pb = P.y;

  // トゲ＝即死（当たりは見た目より少し甘め）
  for (const s of LV.spikes) {
    const l = s.tx * TILE + 7, r = s.tx * TILE + TILE - 7, t = s.ty * TILE + 13, b = (s.ty + 1) * TILE;
    if (pr > l && pl < r && pb > t && pt < b) { die(); return; }
  }
  // セーブポイント
  LV.saves.forEach((s, i) => {
    const l = s.tx * TILE, r = l + TILE, t = s.ty * TILE, b = t + TILE;
    if (pr > l && pl < r && pb > t && pt < b && activeSave !== i) {
      activeSave = i; checkpoint = { x: s.tx * TILE + TILE / 2, y: (s.ty + 1) * TILE };
      toastMsg('◈ SIGNAL SAVED');
      tone(740, .09, 'sine', .05); setTimeout(() => tone(990, .12, 'sine', .05), 70);
    }
  });
  // ゴール
  for (const g of LV.goals) {
    const l = g.tx * TILE, r = l + TILE, t = (g.ty - 1) * TILE, b = (g.ty + 1) * TILE;
    if (pr > l && pl < r && pb > t && pt < b) {
      state = 'clear';
      tone(660, .1, 'sine', .06); setTimeout(() => tone(880, .14, 'sine', .06), 90);
      setTimeout(() => tone(1320, .2, 'sine', .06), 200);
      return;
    }
  }
  // 画面外落下
  if (P.y - P.h > LV.h * TILE + 96) die();
  P.anim += dt;
}

/* ---------- 描画 ---------- */
function render() {
  const camX = Math.max(0, Math.min(P.x - VIEW_W / 2, LV.w * TILE - VIEW_W));
  const camY = Math.max(0, Math.min(P.y - VIEW_H * 0.6, Math.max(0, LV.h * TILE - VIEW_H)));
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // 背景（bg_stage1.png があればパララックス、無ければ星空）
  const bg = SPR['bg_stage1'];
  if (bg) {
    const off = (camX * 0.3) % VIEW_W;
    ctx.drawImage(bg.img, 0, 0, bg.fw, bg.fh, -off, 0, VIEW_W, VIEW_H);
    ctx.drawImage(bg.img, 0, 0, bg.fw, bg.fh, VIEW_W - off, 0, VIEW_W, VIEW_H);
  } else {
    ctx.fillStyle = 'rgba(234,244,242,.22)';
    for (let i = 0; i < 90; i++) {
      const sx = (i * 97 + 13) % (LV.w * TILE), sy = (i * 57 + 31) % VIEW_H;
      const x = ((sx - camX * 0.3) % VIEW_W + VIEW_W) % VIEW_W;
      ctx.fillRect(x, sy, 2, 2);
    }
  }

  ctx.save(); ctx.translate(-camX, -camY);
  const tx0 = Math.floor(camX / TILE), tx1 = Math.ceil((camX + VIEW_W) / TILE);

  // 地形
  for (let ty = 0; ty < LV.h; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    if (!isSolid(tx, ty)) continue;
    const x = tx * TILE, y = ty * TILE;
    if (spr('tile_ground', 0, x, y, TILE, TILE)) continue;
    ctx.fillStyle = C.block; ctx.fillRect(x, y, TILE, TILE);
    ctx.strokeStyle = 'rgba(51,231,200,.10)'; ctx.strokeRect(x + .5, y + .5, TILE - 1, TILE - 1);
    if (!isSolid(tx, ty - 1)) { ctx.fillStyle = C.teal; ctx.globalAlpha = .75; ctx.fillRect(x, y, TILE, 3); ctx.globalAlpha = 1; }
  }
  // トゲ
  for (const s of LV.spikes) {
    const x = s.tx * TILE, y = s.ty * TILE;
    if (spr('hazard_spike', 0, x, y, TILE, TILE)) continue;
    ctx.fillStyle = C.red;
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.moveTo(x + i * 16 + 2, y + TILE); ctx.lineTo(x + i * 16 + 8, y + 8); ctx.lineTo(x + i * 16 + 14, y + TILE);
      ctx.closePath(); ctx.fill();
    }
  }
  // セーブポイント
  LV.saves.forEach((s, i) => {
    const x = s.tx * TILE, y = s.ty * TILE, on = i === activeSave;
    if (spr('savepoint', time * 6, x, y, TILE, TILE)) return;
    const cx = x + 16, cy = y + 16 + Math.sin(time * 3 + i) * 3;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.PI / 4);
    ctx.fillStyle = on ? C.teal : 'rgba(51,231,200,.45)';
    ctx.fillRect(-7, -7, 14, 14); ctx.restore();
    if (on) { ctx.strokeStyle = C.teal; ctx.globalAlpha = .5;
      ctx.beginPath(); ctx.arc(cx, cy, 13 + Math.sin(time * 5) * 2, 0, 7); ctx.stroke(); ctx.globalAlpha = 1; }
  });
  // ゴール扉（32x48）
  for (const g of LV.goals) {
    const x = g.tx * TILE, yB = (g.ty + 1) * TILE;
    if (spr('door_goal', 0, x, yB - 48, TILE, 48)) continue;
    ctx.fillStyle = C.violet; ctx.globalAlpha = .25; ctx.fillRect(x - 6, yB - 54, TILE + 12, 54); ctx.globalAlpha = 1;
    ctx.fillStyle = C.violet; ctx.fillRect(x + 2, yB - 48, TILE - 4, 48);
    ctx.fillStyle = C.teal; ctx.fillRect(x + TILE - 11, yB - 27, 4, 7);
    ctx.strokeStyle = 'rgba(234,244,242,.5)'; ctx.strokeRect(x + 2.5, yB - 47.5, TILE - 5, 47);
  }
  // プレイヤー（死亡中はパーティクルのみ）
  if (state !== 'dead') {
    const px = P.x - 16, py = P.y - 32;
    const moving = Math.abs(P.vx) > 1;
    let name = 'player_idle', fr = time * 4;
    if (!P.ground) { name = 'player_jump'; fr = P.vy < 0 ? 0 : 1; }
    else if (moving) { name = 'player_run'; fr = P.anim * 10; }
    if (!spr(name, fr, px, py, 32, 32, P.face < 0)) {
      ctx.fillStyle = C.ink; ctx.fillRect(P.x - P.w / 2, P.y - P.h, P.w, P.h);
      ctx.fillStyle = C.teal;
      const vx = P.face > 0 ? P.x + 1 : P.x - P.w / 2 + 2;
      ctx.fillRect(vx, P.y - P.h + 6, P.w / 2 - 3, 4);
    }
  }
  // パーティクル
  ctx.fillStyle = C.red;
  for (const p of parts) { ctx.globalAlpha = Math.min(1, p.t * 2); ctx.fillRect(p.x - 2, p.y - 2, 4, 4); }
  ctx.globalAlpha = 1;
  ctx.restore();

  /* ---- HUD ---- */
  ctx.font = '700 13px "Courier New",monospace';
  ctx.fillStyle = 'rgba(234,244,242,.85)'; ctx.textAlign = 'left';
  ctx.fillText('DEATHS ' + String(deaths).padStart(3, '0'), 14, 22);
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(234,244,242,.5)';
  ctx.fillText(LV.name, VIEW_W / 2, 22);
  ctx.textAlign = 'right';
  ctx.fillStyle = SPR.player_run ? 'rgba(51,231,200,.8)' : 'rgba(234,244,242,.35)';
  ctx.fillText(SPR.player_run ? 'SPRITES: LIVE' : 'SPRITES: PLACEHOLDER', VIEW_W - 14, 22);
  if (toastT > 0) {
    ctx.textAlign = 'center'; ctx.fillStyle = C.teal;
    ctx.font = '700 15px "Courier New",monospace';
    ctx.fillText(toast, VIEW_W / 2, 92);
  }

  /* ---- オーバーレイ ---- */
  if (state === 'title' || state === 'clear') {
    ctx.fillStyle = 'rgba(4,6,11,.82)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center';
    if (state === 'title') {
      ctx.fillStyle = C.ink; ctx.font = '700 36px "Courier New",monospace';
      ctx.fillText('I WANNA BE THE SIGNAL', VIEW_W / 2, VIEW_H / 2 - 60);
      ctx.fillStyle = C.violet; ctx.font = '700 13px "Courier New",monospace';
      ctx.fillText('AlicE sYsTeM // game lab — MVP BUILD', VIEW_W / 2, VIEW_H / 2 - 30);
      ctx.fillStyle = 'rgba(234,244,242,.75)'; ctx.font = '700 14px "Courier New",monospace';
      ctx.fillText('← → MOVE   Z / SPACE JUMP ×2   R RETRY   M MUTE', VIEW_W / 2, VIEW_H / 2 + 24);
      ctx.fillStyle = C.teal;
      ctx.fillText(Math.sin(time * 4) > 0 ? '— PRESS ANY KEY —' : '', VIEW_W / 2, VIEW_H / 2 + 70);
      ctx.fillStyle = C.red; ctx.font = '700 12px "Courier New",monospace';
      ctx.fillText('警告: トゲは即死です。死は学習です。', VIEW_W / 2, VIEW_H / 2 + 110);
    } else {
      ctx.fillStyle = C.teal; ctx.font = '700 40px "Courier New",monospace';
      ctx.fillText('STAGE CLEAR', VIEW_W / 2, VIEW_H / 2 - 30);
      ctx.fillStyle = C.ink; ctx.font = '700 15px "Courier New",monospace';
      ctx.fillText('DEATHS: ' + deaths, VIEW_W / 2, VIEW_H / 2 + 10);
      ctx.fillStyle = 'rgba(234,244,242,.6)';
      ctx.fillText('R — RESTART FROM THE BEGINNING', VIEW_W / 2, VIEW_H / 2 + 48);
    }
  }
}

/* ---------- メインループ ---------- */
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
  update(dt); render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
})();
