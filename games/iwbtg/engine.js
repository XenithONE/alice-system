/* ============================================================
   I WANNA BE THE SIGNAL — engine.js v2（高難度・複数ステージ版）
   担当: エンジン班（XenithONE + Claude）

   ・levels/levelN.js を順番に読み込み、ステージ進行する
   ・assets/sprites/ に ASSET_SPEC 通りのPNGを置くと自動でスプライト化
   ・タイル文字:
       # 地形   ^ 上トゲ  v 下トゲ  < 左トゲ  > 右トゲ
       ! 偽ブロック(触れると消える)   ? 透明ブロック(常に固体・触れると見える)
       * 崩落ブロック(乗ると壊れる)   S セーブ  F 偽セーブ(即死)
       G ゴール  X 偽ゴール(即死)     P スタート  . 空
   ・エンティティ(levelのentities配列):
       tspike / saw / shooter / fallblock / platform / msg
   ・?debug をURLに付けると 1-9キーでステージ移動、Gキーで無敵
============================================================ */
(() => {
'use strict';

/* ---------- 定数 ---------- */
const TILE = 32;
const VIEW_W = 960, VIEW_H = 544;
const GRAVITY = 1700, MOVE = 190, JUMP1 = -540, JUMP2 = -500, MAX_FALL = 900;
const C = { bg:'#04060b', ink:'#eaf4f2', teal:'#33e7c8', violet:'#7b4dff',
            red:'#ff3b5c', block:'#1d2738' };
const DEBUG = /[?&]debug/.test(location.search);

const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
ctx.imageSmoothingEnabled = false;

/* ---------- スプライト自動ロード ---------- */
const SHEET = { player_idle:2, player_run:6, player_jump:2, player_dead:4,
  tile_ground:1, tile_wall:1, hazard_spike:1, savepoint:4, door_goal:1, bg_stage1:1,
  hazard_saw:4, hazard_bullet:1, hazard_block_fall:1 };
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

/* ---------- サウンド ---------- */
let actx = null, mute = false;
function tone(f, d = 0.08, type = 'square', g = 0.04) {
  if (mute) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const o = actx.createOscillator(), gn = actx.createGain();
    o.type = type; o.frequency.value = f; o.connect(gn); gn.connect(actx.destination);
    const t = actx.currentTime;
    gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(g, t + 0.01);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + d); o.start(t); o.stop(t + d);
  } catch (e) {}
}

/* ---------- レベル解析（静的データ） ---------- */
const DEFS = (window.GAME_LEVELS && window.GAME_LEVELS.length)
  ? window.GAME_LEVELS : [{ name: 'NO LEVEL', map: ['P.', '##'], entities: [] }];

function parseLevel(def) {
  const rows = def.map, h = rows.length, w = Math.max(...rows.map(r => r.length));
  const plain = new Set(), fake = [], invis = [], crumble = [];
  const spikes = [], saves = [], goals = [];
  let spawn = { x: TILE * 1.5, y: TILE };
  const dirOf = { '^':'up', 'v':'down', '<':'left', '>':'right' };
  rows.forEach((row, ty) => { [...row].forEach((ch, tx) => {
    const k = tx + ',' + ty;
    if (ch === '#') plain.add(k);
    else if (ch === '!') fake.push(k);
    else if (ch === '?') invis.push(k);
    else if (ch === '*') crumble.push(k);
    else if (dirOf[ch]) spikes.push({ tx, ty, dir: dirOf[ch] });
    else if (ch === 'S') saves.push({ tx, ty, fake: false });
    else if (ch === 'F') saves.push({ tx, ty, fake: true });
    else if (ch === 'G') goals.push({ tx, ty, fake: false });
    else if (ch === 'X') goals.push({ tx, ty, fake: true });
    else if (ch === 'P') spawn = { x: tx * TILE + TILE / 2, y: (ty + 1) * TILE };
  }); });
  return { name: def.name || 'STAGE', w, h, plain, fake, invis, crumble,
           spikes, saves, goals, spawn, ents: def.entities || [] };
}

/* ---------- ランタイム状態 ---------- */
let LV = null;                 // 解析済みステージ
let solid = new Set();         // 衝突判定の唯一のソース
let fakeSt = new Map();        // key → {st:0待機|1カウント|2消滅, t}
let crumSt = new Map();        // key → {st:0健在|1カウント|2崩壊, t}
const revealed = new Set();    // ? の発見状態（死んでも維持）
let saws = [], shooters = [], bullets = [], tspikes = [], fallblocks = [], platforms = [], msgs = [];

const P = { x: 0, y: 0, vx: 0, vy: 0, w: 20, h: 28, face: 1, ground: false,
            jumps: 2, anim: 0, grace: 0 };
let stageIdx = Math.min(Math.max(parseInt(localStorage.getItem('signal_stage'), 10) || 0, 0), DEFS.length - 1);
let deaths = parseInt(localStorage.getItem('signal_deaths'), 10) || 0;
let state = 'title';           // title | card | play | dead | stageclear | clear
let deadT = 0, cardT = 0, clearT = 0, toast = '', toastT = 0, time = 0, runT = 0;
let god = false, activeSave = -1, checkpoint = null;
const parts = [];

const keyOf = (tx, ty) => tx + ',' + ty;
const isSolid = (tx, ty) => solid.has(keyOf(tx, ty));

function initRuntime(keepSaves) {
  solid = new Set(LV.plain);
  fakeSt = new Map(); crumSt = new Map();
  LV.fake.forEach(k => { solid.add(k); fakeSt.set(k, { st: 0, t: 0 }); });
  LV.invis.forEach(k => solid.add(k));
  LV.crumble.forEach(k => { solid.add(k); crumSt.set(k, { st: 0, t: 0 }); });
  bullets = [];
  saws = []; shooters = []; tspikes = []; fallblocks = []; platforms = []; msgs = [];
  for (const e of LV.ents) {
    if (e.type === 'saw') saws.push({
      x1: e.from[0] * TILE + 16, y1: e.from[1] * TILE + 16,
      x2: e.to[0] * TILE + 16,  y2: e.to[1] * TILE + 16,
      speed: e.speed || 140, t: 0, x: 0, y: 0 });
    else if (e.type === 'shooter') {
      shooters.push({ tx: e.at[0], ty: e.at[1], dir: e.dir || 'left',
        every: e.every || 1.5, speed: e.speed || 260, timer: e.delay || 0 });
      solid.add(keyOf(e.at[0], e.at[1]));            // タレットは固体
    }
    else if (e.type === 'tspike') tspikes.push({
      tx: e.at[0], ty: e.at[1], dir: e.dir || 'up',
      zone: [e.zone[0] * TILE, e.zone[1] * TILE, e.zone[2] * TILE, e.zone[3] * TILE],
      speed: e.speed || 520, st: 0, x: e.at[0] * TILE, y: e.at[1] * TILE });
    else if (e.type === 'fallblock') fallblocks.push({
      tx: e.at[0], ty: e.at[1],
      zone: [e.zone[0] * TILE, e.zone[1] * TILE, e.zone[2] * TILE, e.zone[3] * TILE],
      st: 0, x: e.at[0] * TILE, y: e.at[1] * TILE, vy: 0 });
    else if (e.type === 'platform') {
      const w = (e.w || 2) * TILE;
      platforms.push({ x1: e.from[0] * TILE, y1: e.from[1] * TILE,
        x2: e.to[0] * TILE, y2: e.to[1] * TILE, speed: e.speed || 90,
        w, t: 0, x: e.from[0] * TILE, y: e.from[1] * TILE, px: 0, py: 0 });
    }
    else if (e.type === 'msg') msgs.push({
      x: e.at[0] * TILE, y: e.at[1] * TILE, text: e.text || '...',
      zone: e.zone ? [e.zone[0] * TILE, e.zone[1] * TILE, e.zone[2] * TILE, e.zone[3] * TILE] : null });
  }
  if (!keepSaves) { activeSave = -1; checkpoint = { ...LV.spawn }; }
}

function loadStage(i, viaTitle) {
  stageIdx = Math.max(0, Math.min(i, DEFS.length - 1));
  localStorage.setItem('signal_stage', stageIdx);
  LV = parseLevel(DEFS[stageIdx]);
  revealed.clear();
  initRuntime(false);
  placeAt(checkpoint);
  if (!viaTitle) { state = 'card'; cardT = 1.4; }
}

function placeAt(pt) { P.x = pt.x; P.y = pt.y; P.vx = P.vy = 0; P.jumps = 2; P.ground = true; P.grace = 0.5; }
function respawn() { initRuntime(true); placeAt(checkpoint); state = 'play'; }
function toastMsg(s) { toast = s; toastT = 2.4; }
function burst(x, y, col, n) {
  for (let i = 0; i < n; i++) parts.push({ x, y,
    vx: (Math.random() * 2 - 1) * 260, vy: -Math.random() * 330,
    t: 0.6 + Math.random() * 0.4, col });
}
function die(msg) {
  if (state !== 'play' || god) return;
  state = 'dead'; deadT = 0;
  deaths++; localStorage.setItem('signal_deaths', deaths);
  burst(P.x, P.y - P.h / 2, C.red, 28);
  if (msg) toastMsg(msg);
  tone(220, 0.12, 'sawtooth', 0.06); setTimeout(() => tone(110, 0.25, 'sawtooth', 0.05), 60);
}

/* ---------- 入力 ---------- */
const keys = {};
const JUMPK = ['z', 'Z', ' ', 'ArrowUp', 'w', 'W'];
addEventListener('keydown', e => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
  if (e.repeat) return;
  keys[e.key] = true;            // 状態に関わらず物理キーは常に記録（カード中の先行入力を保持）
  if (DEBUG && state !== 'title') {
    if (e.key >= '1' && e.key <= '9') { const n = +e.key - 1; if (n < DEFS.length) { loadStage(n); return; } }
    if (e.key === 'g' || e.key === 'G') { god = !god; toastMsg(god ? 'GOD ON' : 'GOD OFF'); return; }
  }
  if (state === 'title') {
    if (e.key === '0' && stageIdx > 0) { loadStage(0, true); toastMsg('PROGRESS RESET'); return; }
    state = 'card'; cardT = 1.2; tone(660, .1, 'square', .05); return;
  }
  if (state === 'clear') {
    if (e.key === 'r' || e.key === 'R') { loadStage(0); runT = 0; }
    return;
  }
  if (state !== 'play' && state !== 'dead') return;
  if (e.key === 'm' || e.key === 'M') { mute = !mute; toastMsg(mute ? 'MUTE ON' : 'MUTE OFF'); return; }
  if (e.key === 'r' || e.key === 'R') { if (state === 'play') { if (god) respawn(); else die(); } return; }
  if (JUMPK.includes(e.key) && state === 'play' && P.jumps > 0) {
    const first = P.ground;
    P.vy = first ? JUMP1 : JUMP2; P.jumps--; P.ground = false;
    tone(first ? 520 : 640, 0.07, 'square', 0.04);
  }
});
addEventListener('keyup', e => {
  keys[e.key] = false;
  if (JUMPK.includes(e.key) && P.vy < 0) P.vy *= 0.45;
});
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

/* ---------- 衝突 ---------- */
function blockingTiles(l, t, r, b, out) {
  const x0 = Math.floor(l / TILE), x1 = Math.floor((r - 0.01) / TILE);
  const y0 = Math.floor(t / TILE), y1 = Math.floor((b - 0.01) / TILE);
  let hit = false;
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const k = keyOf(tx, Math.max(0, ty));   // マップ上端より上は行0の壁を延長（飛び越え封じ）
    if (solid.has(k)) { hit = true; if (out) out.push(k); }
  }
  return hit;
}
function touchTile(k, fromAbove) {
  if (!revealed.has(k) && LV.invis.includes(k)) {
    revealed.add(k); tone(330, .06, 'triangle', .04);
  }
  const f = fakeSt.get(k);
  if (f && f.st === 0) { f.st = 1; f.t = 0.15; }
  const c = crumSt.get(k);
  if (c && c.st === 0 && fromAbove) { c.st = 1; c.t = 0.35; }
}
function moveAxis(dx, dy) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 4));
  const sx = dx / steps, sy = dy / steps;
  for (let i = 0; i < steps; i++) {
    const hits = [];
    if (blockingTiles(P.x - P.w / 2 + sx, P.y - P.h + sy, P.x + P.w / 2 + sx, P.y + sy, hits)) {
      hits.forEach(k => touchTile(k, sy > 0));
      return true;
    }
    P.x += sx; P.y += sy;
  }
  return false;
}
const rectsHit = (al, at, ar, ab, bl, bt, br, bb) => ar > bl && al < br && ab > bt && at < bb;
function circleRect(cx, cy, r, l, t, rr, b) {
  const nx = Math.max(l, Math.min(cx, rr)), ny = Math.max(t, Math.min(cy, b));
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}
const SPIKE_BOX = {
  up:    k => [k.tx * TILE + 7, k.ty * TILE + 13, k.tx * TILE + 25, k.ty * TILE + 32],
  down:  k => [k.tx * TILE + 7, k.ty * TILE,      k.tx * TILE + 25, k.ty * TILE + 14],
  left:  k => [k.tx * TILE + 13, k.ty * TILE + 7, k.tx * TILE + 32, k.ty * TILE + 25],
  right: k => [k.tx * TILE,      k.ty * TILE + 7, k.tx * TILE + 19, k.ty * TILE + 25],
};

/* ---------- 更新 ---------- */
function updateParts(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.t -= dt;
    if (p.t <= 0) { parts.splice(i, 1); continue; }
    p.vy += 1300 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
  }
}
const tri = x => { x = x % 2; if (x < 0) x += 2; return x < 1 ? x : 2 - x; };

function updateEntities(dt) {
  const pl = P.x - P.w / 2, pr = P.x + P.w / 2, pt = P.y - P.h, pb = P.y;
  const canHurt = P.grace <= 0 && state === 'play';

  // 偽ブロック消滅
  fakeSt.forEach((f, k) => {
    if (f.st === 1) { f.t -= dt;
      if (f.t <= 0) { f.st = 2; solid.delete(k);
        const [tx, ty] = k.split(',').map(Number);
        burst(tx * TILE + 16, ty * TILE + 16, C.teal, 10); tone(180, .1, 'sawtooth', .04); } }
  });
  // 崩落ブロック
  crumSt.forEach((c, k) => {
    if (c.st === 1) { c.t -= dt;
      if (c.t <= 0) { c.st = 2; c.t = 2.5; solid.delete(k);
        const [tx, ty] = k.split(',').map(Number);
        burst(tx * TILE + 16, ty * TILE + 16, 'rgba(234,244,242,.8)', 8); tone(150, .09, 'sawtooth', .04); } }
    else if (c.st === 2) { c.t -= dt;
      if (c.t <= 0) {
        const [tx, ty] = k.split(',').map(Number);
        const l = tx * TILE, t = ty * TILE;
        if (!rectsHit(pl, pt, pr, pb, l, t, l + TILE, t + TILE)) { c.st = 0; solid.add(k); }
        else c.t = 0.3;
      } }
  });
  // ノコギリ
  for (const s of saws) {
    s.t += dt;
    const d = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) || 1;
    const u = tri(s.t * s.speed / d);
    s.x = s.x1 + (s.x2 - s.x1) * u; s.y = s.y1 + (s.y2 - s.y1) * u;
    if (canHurt && circleRect(s.x, s.y, 13, pl, pt, pr, pb)) { die(); return; }
  }
  // タレット → 弾
  for (const sh of shooters) {
    sh.timer -= dt;
    if (sh.timer <= 0) {
      sh.timer += sh.every;
      const cx = sh.tx * TILE + 16, cy = sh.ty * TILE + 16;
      const v = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[sh.dir];
      bullets.push({ x: cx + v[0] * 18, y: cy + v[1] * 18, vx: v[0] * sh.speed, vy: v[1] * sh.speed });
      tone(300, .05, 'square', .025);
    }
  }
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.x < -64 || b.x > LV.w * TILE + 64 || b.y < -64 || b.y > LV.h * TILE + 64 ||
        isSolid(Math.floor(b.x / TILE), Math.floor(b.y / TILE))) { bullets.splice(i, 1); continue; }
    if (canHurt && rectsHit(pl, pt, pr, pb, b.x - 6, b.y - 6, b.x + 6, b.y + 6)) { die(); return; }
  }
  // トリガースパイク
  for (const t of tspikes) {
    if (t.st === 0) {
      if (state === 'play' && rectsHit(pl, pt, pr, pb, t.zone[0], t.zone[1], t.zone[0] + t.zone[2], t.zone[1] + t.zone[3])) {
        t.st = 1; tone(980, .07, 'sawtooth', .05);
      }
    } else if (t.st === 1) {
      const v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[t.dir];
      t.x += v[0] * t.speed * dt; t.y += v[1] * t.speed * dt;
      if (t.x < -64 || t.x > LV.w * TILE + 64 || t.y < -96 || t.y > LV.h * TILE + 96) t.st = 2;
      if (canHurt && rectsHit(pl, pt, pr, pb, t.x + 6, t.y + 6, t.x + 26, t.y + 26)) { die(); return; }
    }
  }
  // 落下ブロック
  for (const f of fallblocks) {
    if (f.st === 0) {
      if (state === 'play' && rectsHit(pl, pt, pr, pb, f.zone[0], f.zone[1], f.zone[0] + f.zone[2], f.zone[1] + f.zone[3])) {
        f.st = 1; tone(140, .08, 'sawtooth', .05);
      }
    } else if (f.st === 1) {
      f.vy = Math.min(f.vy + 1500 * dt, 760); f.y += f.vy * dt;
      if (canHurt && rectsHit(pl, pt, pr, pb, f.x + 2, f.y + 2, f.x + 30, f.y + 32)) { die(); return; }
      const bty = Math.floor((f.y + TILE) / TILE);
      if (isSolid(Math.floor((f.x + 16) / TILE), bty) || f.y > LV.h * TILE + 64) {
        f.st = 2; burst(f.x + 16, f.y + 24, 'rgba(234,244,242,.8)', 10); tone(120, .1, 'sawtooth', .05);
      }
    }
  }
  // 移動足場（位置更新は updatePlayer 前に行う → ここでは何もしない）
}

function updatePlatforms(dt) {
  for (const p of platforms) {
    p.px = p.x; p.py = p.y;
    p.t += dt;
    const d = Math.hypot(p.x2 - p.x1, p.y2 - p.y1) || 1;
    const u = tri(p.t * p.speed / d);
    p.x = p.x1 + (p.x2 - p.x1) * u; p.y = p.y1 + (p.y2 - p.y1) * u;
  }
}

function update(dt) {
  time += dt;
  if (toastT > 0) toastT -= dt;
  updateParts(dt);
  if (state === 'card') { cardT -= dt; if (cardT <= 0) state = 'play'; return; }
  if (state === 'dead') { deadT += dt; if (deadT > 0.9) respawn(); return; }
  if (state === 'stageclear') {
    clearT -= dt;
    if (clearT <= 0) {
      if (stageIdx + 1 < DEFS.length) loadStage(stageIdx + 1);
      else { state = 'clear'; localStorage.setItem('signal_stage', 0); }
    }
    return;
  }
  if (state !== 'play') return;

  runT += dt;
  if (P.grace > 0) P.grace -= dt;
  updatePlatforms(dt);

  const Lk = keys['ArrowLeft'] || keys['a'] || keys['A'];
  const Rk = keys['ArrowRight'] || keys['d'] || keys['D'];
  P.vx = (Rk ? MOVE : 0) - (Lk ? MOVE : 0);
  if (P.vx) P.face = P.vx > 0 ? 1 : -1;
  P.vy = Math.min(P.vy + GRAVITY * dt, MAX_FALL);

  // 足場に乗っているか（移動前の足元で判定）
  let ride = null;
  for (const p of platforms) {
    if (P.vy >= 0 && Math.abs(P.y - p.py) <= Math.max(6, Math.abs(p.y - p.py) + 2) &&
        P.x + P.w / 2 > p.px && P.x - P.w / 2 < p.px + p.w) ride = p;
  }
  if (ride) {
    // 衝突判定を通してキャリー（壁・天井へのめり込み防止）
    moveAxis(ride.x - ride.px, 0);
    moveAxis(0, ride.y - P.y);
    P.vy = 0; P.ground = true; P.jumps = 2;
  }

  moveAxis(P.vx * dt, 0);
  const vy0 = P.vy;
  if (!ride) {
    const prevB = P.y;
    if (moveAxis(0, P.vy * dt)) {
      if (vy0 > 0) { P.ground = true; P.jumps = 2; }
      P.vy = 0;
    } else if (P.vy > 40) P.ground = false;
    // 落下中に足場の天面を跨いだら着地（スイープ判定：高速落下でも貫通しない）
    if (vy0 > 0) for (const p of platforms) {
      if (P.x + P.w / 2 > p.x && P.x - P.w / 2 < p.x + p.w &&
          prevB <= p.py + 1 && P.y >= p.y) { P.y = p.y; P.vy = 0; P.ground = true; P.jumps = 2; }
    }
  }

  // 足元の崩落ブロック起動（立ち続けでも発火）
  if (P.ground) {
    const fy = Math.floor((P.y + 1) / TILE);
    for (const tx of [Math.floor((P.x - P.w / 2) / TILE), Math.floor((P.x + P.w / 2 - 1) / TILE)]) {
      const k = keyOf(tx, fy);
      const c = crumSt.get(k); if (c && c.st === 0) { c.st = 1; c.t = 0.35; }
      const f = fakeSt.get(k); if (f && f.st === 0) { f.st = 1; f.t = 0.15; }
    }
  }

  const pl = P.x - P.w / 2, pr = P.x + P.w / 2, pt = P.y - P.h, pb = P.y;

  // 静的トゲ（4方向）— リスポーン直後のグレース中は猶予
  if (P.grace <= 0) for (const s of LV.spikes) {
    const [l, t, r, b] = SPIKE_BOX[s.dir](s);
    if (rectsHit(pl, pt, pr, pb, l, t, r, b)) { die(); return; }
  }
  // セーブ（偽含む）
  LV.saves.forEach((s, i) => {
    const l = s.tx * TILE, t = s.ty * TILE;
    if (rectsHit(pl, pt, pr, pb, l, t, l + TILE, t + TILE)) {
      if (s.fake) { if (state === 'play') { burst(l + 16, t + 16, C.red, 16); die('……偽物だ。'); } return; }
      if (activeSave !== i) {
        activeSave = i; checkpoint = { x: l + 16, y: t + TILE };
        toastMsg('◈ SIGNAL SAVED');
        tone(740, .09, 'sine', .05); setTimeout(() => tone(990, .12, 'sine', .05), 70);
      }
    }
  });
  if (state !== 'play') return;   // 偽セーブで死んだフレームはここで打ち切り
  // ゴール（偽含む）
  for (const g of LV.goals) {
    const l = g.tx * TILE, t = (g.ty - 1) * TILE, b = (g.ty + 1) * TILE;
    if (rectsHit(pl, pt, pr, pb, l, t, l + TILE, b)) {
      if (g.fake) { burst(l + 16, b - 24, C.violet, 22); die('そのドアは嘘だった。'); return; }
      state = 'stageclear'; clearT = 1.5;
      tone(660, .1, 'sine', .06); setTimeout(() => tone(880, .14, 'sine', .06), 90);
      setTimeout(() => tone(1320, .2, 'sine', .06), 200);
      return;
    }
  }

  updateEntities(dt);
  if (P.y - P.h > LV.h * TILE + 96) die();
  P.anim += dt;
}

/* ---------- 描画 ---------- */
function drawSpikeShape(x, y, dir, bright) {
  if (SPR.hazard_spike && dir === 'up') { spr('hazard_spike', 0, x, y, TILE, TILE); return; }
  if (SPR.hazard_spike) {
    const ang = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 }[dir];
    ctx.save(); ctx.translate(x + 16, y + 16); ctx.rotate(ang);
    spr('hazard_spike', 0, -16, -16, TILE, TILE); ctx.restore(); return;
  }
  ctx.save(); ctx.translate(x + 16, y + 16);
  ctx.rotate({ up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 }[dir]);
  ctx.fillStyle = bright ? '#ff6b85' : C.red;
  for (let i = 0; i < 2; i++) {
    ctx.beginPath();
    ctx.moveTo(-14 + i * 16, 16); ctx.lineTo(-8 + i * 16, -8); ctx.lineTo(-2 + i * 16, 16);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

function render() {
  const camX = Math.max(0, Math.min(P.x - VIEW_W / 2, LV.w * TILE - VIEW_W));
  const camY = Math.max(0, Math.min(P.y - VIEW_H * 0.6, Math.max(0, LV.h * TILE - VIEW_H)));
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, VIEW_W, VIEW_H);

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
  const tx0 = Math.floor(camX / TILE) - 1, tx1 = Math.ceil((camX + VIEW_W) / TILE) + 1;

  const drawBlock = (x, y) => {
    if (spr('tile_ground', 0, x, y, TILE, TILE)) return;
    ctx.fillStyle = C.block; ctx.fillRect(x, y, TILE, TILE);
    ctx.strokeStyle = 'rgba(51,231,200,.10)'; ctx.strokeRect(x + .5, y + .5, TILE - 1, TILE - 1);
  };
  // 通常地形
  LV.plain.forEach(k => {
    const [tx, ty] = k.split(',').map(Number);
    if (tx < tx0 || tx > tx1) return;
    const x = tx * TILE, y = ty * TILE;
    drawBlock(x, y);
    if (!solid.has(keyOf(tx, ty - 1)) && !SPR.tile_ground) {
      ctx.fillStyle = C.teal; ctx.globalAlpha = .75; ctx.fillRect(x, y, TILE, 3); ctx.globalAlpha = 1;
    }
  });
  // 偽ブロック（見た目は完全に同じ＝それが罠）
  fakeSt.forEach((f, k) => {
    if (f.st === 2) return;
    const [tx, ty] = k.split(',').map(Number);
    if (tx < tx0 || tx > tx1) return;
    const x = tx * TILE, y = ty * TILE;
    drawBlock(x, y);
    if (!solid.has(keyOf(tx, ty - 1)) && !SPR.tile_ground) {
      ctx.fillStyle = C.teal; ctx.globalAlpha = .75; ctx.fillRect(x, y, TILE, 3); ctx.globalAlpha = 1;
    }
  });
  // 透明ブロック（発見後のみ・紫の枠）
  LV.invis.forEach(k => {
    if (!revealed.has(k)) return;
    const [tx, ty] = k.split(',').map(Number);
    if (tx < tx0 || tx > tx1) return;
    const x = tx * TILE, y = ty * TILE;
    drawBlock(x, y);
    ctx.strokeStyle = C.violet; ctx.globalAlpha = .8; ctx.strokeRect(x + 1.5, y + 1.5, TILE - 3, TILE - 3); ctx.globalAlpha = 1;
  });
  // 崩落ブロック（ヒビ入り）
  crumSt.forEach((c, k) => {
    if (c.st === 2) return;
    const [tx, ty] = k.split(',').map(Number);
    if (tx < tx0 || tx > tx1) return;
    const x = tx * TILE, y = ty * TILE;
    drawBlock(x, y);
    ctx.strokeStyle = 'rgba(234,244,242,.5)'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 4); ctx.lineTo(x + 14, y + 14); ctx.lineTo(x + 9, y + 26);
    ctx.moveTo(x + 22, y + 6); ctx.lineTo(x + 18, y + 16); ctx.lineTo(x + 26, y + 27);
    ctx.stroke();
    if (c.st === 1) { ctx.fillStyle = 'rgba(255,59,92,.25)'; ctx.fillRect(x, y, TILE, TILE); }
  });
  // 静的トゲ
  for (const s of LV.spikes) {
    if (s.tx < tx0 || s.tx > tx1) continue;
    drawSpikeShape(s.tx * TILE, s.ty * TILE, s.dir, false);
  }
  // 落下ブロック
  for (const f of fallblocks) {
    if (f.st === 2) continue;
    if (!spr('hazard_block_fall', 0, f.x, f.y, TILE, TILE)) {
      drawBlock(f.x, f.y);
      if (f.st === 1) { ctx.fillStyle = 'rgba(255,59,92,.3)'; ctx.fillRect(f.x, f.y, TILE, TILE); }
    }
  }
  // 移動足場
  for (const p of platforms) {
    ctx.fillStyle = C.teal; ctx.globalAlpha = .9;
    ctx.fillRect(p.x, p.y, p.w, 8);
    ctx.globalAlpha = .25; ctx.fillRect(p.x, p.y + 8, p.w, 4); ctx.globalAlpha = 1;
  }
  // タレット
  for (const sh of shooters) {
    const x = sh.tx * TILE, y = sh.ty * TILE;
    drawBlock(x, y);
    ctx.fillStyle = C.violet; ctx.fillRect(x + 8, y + 8, 16, 16);
    const v = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[sh.dir];
    ctx.fillStyle = C.red; ctx.fillRect(x + 14 + v[0] * 10, y + 14 + v[1] * 10, 6, 6);
  }
  // ノコギリ
  for (const s of saws) {
    if (!spr('hazard_saw', time * 10, s.x - 16, s.y - 16, TILE, TILE)) {
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(time * 7);
      ctx.fillStyle = C.red;
      ctx.beginPath(); ctx.arc(0, 0, 12, 0, 7); ctx.fill();
      for (let i = 0; i < 8; i++) {
        ctx.rotate(Math.PI / 4);
        ctx.beginPath(); ctx.moveTo(10, -3); ctx.lineTo(16, 0); ctx.lineTo(10, 3); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = C.bg; ctx.beginPath(); ctx.arc(0, 0, 4, 0, 7); ctx.fill();
      ctx.restore();
    }
  }
  // トリガースパイク（飛行中のみ表示）
  for (const t of tspikes) if (t.st === 1) drawSpikeShape(t.x, t.y, t.dir, true);
  // 弾
  for (const b of bullets) {
    if (!spr('hazard_bullet', 0, b.x - 8, b.y - 8, 16, 16)) {
      ctx.fillStyle = C.red; ctx.beginPath(); ctx.arc(b.x, b.y, 5, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,59,92,.35)'; ctx.beginPath(); ctx.arc(b.x, b.y, 8, 0, 7); ctx.fill();
    }
  }
  // ゴール扉（偽も同じ見た目）
  for (const g of LV.goals) {
    const x = g.tx * TILE, yB = (g.ty + 1) * TILE;
    if (spr('door_goal', 0, x, yB - 48, TILE, 48)) continue;
    ctx.fillStyle = C.violet; ctx.globalAlpha = .25; ctx.fillRect(x - 6, yB - 54, TILE + 12, 54); ctx.globalAlpha = 1;
    ctx.fillStyle = C.violet; ctx.fillRect(x + 2, yB - 48, TILE - 4, 48);
    ctx.fillStyle = C.teal; ctx.fillRect(x + TILE - 11, yB - 27, 4, 7);
    ctx.strokeStyle = 'rgba(234,244,242,.5)'; ctx.strokeRect(x + 2.5, yB - 47.5, TILE - 5, 47);
  }
  // セーブ（偽も同じ見た目）
  LV.saves.forEach((s, i) => {
    const x = s.tx * TILE, y = s.ty * TILE, on = i === activeSave && !s.fake;
    if (spr('savepoint', time * 6, x, y, TILE, TILE)) return;
    const cx = x + 16, cy = y + 16 + Math.sin(time * 3 + i) * 3;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.PI / 4);
    ctx.fillStyle = on ? C.teal : 'rgba(51,231,200,.45)';
    ctx.fillRect(-7, -7, 14, 14); ctx.restore();
    if (on) { ctx.strokeStyle = C.teal; ctx.globalAlpha = .5;
      ctx.beginPath(); ctx.arc(cx, cy, 13 + Math.sin(time * 5) * 2, 0, 7); ctx.stroke(); ctx.globalAlpha = 1; }
  });
  // メッセージ
  ctx.font = '700 12px "Courier New",monospace'; ctx.textAlign = 'left';
  for (const m of msgs) {
    if (m.zone && !rectsHit(P.x - P.w / 2, P.y - P.h, P.x + P.w / 2, P.y,
        m.zone[0], m.zone[1], m.zone[0] + m.zone[2], m.zone[1] + m.zone[3])) continue;
    ctx.fillStyle = 'rgba(123,77,255,.95)';
    ctx.fillText(m.text, m.x, m.y + 12);
  }
  // プレイヤー
  if (state !== 'dead') {
    const px = P.x - 16, py = P.y - 32;
    const moving = Math.abs(P.vx) > 1;
    let name = 'player_idle', fr = time * 4;
    if (!P.ground) { name = 'player_jump'; fr = P.vy < 0 ? 0 : 1; }
    else if (moving) { name = 'player_run'; fr = P.anim * 10; }
    if (!spr(name, fr, px, py, 32, 32, P.face < 0)) {
      ctx.fillStyle = god ? C.violet : C.ink;
      ctx.fillRect(P.x - P.w / 2, P.y - P.h, P.w, P.h);
      ctx.fillStyle = C.teal;
      const vx = P.face > 0 ? P.x + 1 : P.x - P.w / 2 + 2;
      ctx.fillRect(vx, P.y - P.h + 6, P.w / 2 - 3, 4);
    }
    if (P.grace > 0.2) { ctx.globalAlpha = .25; ctx.strokeStyle = C.teal;
      ctx.strokeRect(P.x - P.w / 2 - 3, P.y - P.h - 3, P.w + 6, P.h + 6); ctx.globalAlpha = 1; }
  }
  // パーティクル
  for (const p of parts) {
    ctx.globalAlpha = Math.min(1, p.t * 2);
    ctx.fillStyle = p.col || C.red;
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  /* ---- HUD ---- */
  const mm = Math.floor(runT / 60), ss = (runT % 60).toFixed(1).padStart(4, '0');
  ctx.font = '700 13px "Courier New",monospace';
  ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(234,244,242,.85)';
  ctx.fillText('DEATHS ' + String(deaths).padStart(3, '0'), 14, 22);
  ctx.fillStyle = 'rgba(234,244,242,.5)';
  ctx.fillText('TIME ' + mm + ':' + ss, 14, 40);
  ctx.textAlign = 'center';
  ctx.fillText((stageIdx + 1) + '/' + DEFS.length + '  ' + LV.name, VIEW_W / 2, 22);
  ctx.textAlign = 'right';
  ctx.fillStyle = SPR.player_run ? 'rgba(51,231,200,.8)' : 'rgba(234,244,242,.35)';
  ctx.fillText(SPR.player_run ? 'SPRITES: LIVE' : 'SPRITES: PLACEHOLDER', VIEW_W - 14, 22);
  if (DEBUG) { ctx.fillStyle = C.violet; ctx.fillText('DEBUG' + (god ? ' / GOD' : ''), VIEW_W - 14, 40); }
  if (toastT > 0) {
    ctx.textAlign = 'center'; ctx.fillStyle = C.teal;
    ctx.font = '700 15px "Courier New",monospace';
    ctx.fillText(toast, VIEW_W / 2, 92);
  }

  /* ---- オーバーレイ ---- */
  ctx.textAlign = 'center';
  if (state === 'title') {
    ctx.fillStyle = 'rgba(4,6,11,.85)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = C.ink; ctx.font = '700 36px "Courier New",monospace';
    ctx.fillText('I WANNA BE THE SIGNAL', VIEW_W / 2, VIEW_H / 2 - 70);
    ctx.fillStyle = C.violet; ctx.font = '700 13px "Courier New",monospace';
    ctx.fillText('AlicE sYsTeM // game lab — ' + DEFS.length + ' STAGES OF PAIN', VIEW_W / 2, VIEW_H / 2 - 40);
    ctx.fillStyle = 'rgba(234,244,242,.75)'; ctx.font = '700 14px "Courier New",monospace';
    ctx.fillText('← → MOVE   Z / SPACE JUMP ×2   R RETRY   M MUTE', VIEW_W / 2, VIEW_H / 2 + 14);
    if (stageIdx > 0) {
      ctx.fillStyle = C.teal;
      ctx.fillText('CONTINUE: STAGE ' + (stageIdx + 1) + '   (0キーで最初から)', VIEW_W / 2, VIEW_H / 2 + 44);
    }
    ctx.fillStyle = C.teal;
    ctx.fillText(Math.sin(time * 4) > 0 ? '— PRESS ANY KEY —' : '', VIEW_W / 2, VIEW_H / 2 + 80);
    ctx.fillStyle = C.red; ctx.font = '700 12px "Courier New",monospace';
    ctx.fillText('警告: この世界はあなたを騙します。全てを疑え。', VIEW_W / 2, VIEW_H / 2 + 116);
  } else if (state === 'card') {
    ctx.fillStyle = 'rgba(4,6,11,.78)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = C.ink; ctx.font = '700 30px "Courier New",monospace';
    ctx.fillText(LV.name, VIEW_W / 2, VIEW_H / 2 - 8);
    ctx.fillStyle = 'rgba(234,244,242,.5)'; ctx.font = '700 13px "Courier New",monospace';
    ctx.fillText('STAGE ' + (stageIdx + 1) + ' / ' + DEFS.length, VIEW_W / 2, VIEW_H / 2 + 24);
  } else if (state === 'stageclear') {
    ctx.fillStyle = 'rgba(4,6,11,.6)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = C.teal; ctx.font = '700 34px "Courier New",monospace';
    ctx.fillText('SIGNAL ACQUIRED', VIEW_W / 2, VIEW_H / 2);
  } else if (state === 'clear') {
    ctx.fillStyle = 'rgba(4,6,11,.88)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = C.teal; ctx.font = '700 40px "Courier New",monospace';
    ctx.fillText('ALL SIGNALS CLAIMED', VIEW_W / 2, VIEW_H / 2 - 50);
    ctx.fillStyle = C.ink; ctx.font = '700 15px "Courier New",monospace';
    ctx.fillText('TOTAL DEATHS: ' + deaths + '    TIME: ' + mm + ':' + ss, VIEW_W / 2, VIEW_H / 2 - 8);
    ctx.fillStyle = C.violet;
    ctx.fillText('あなたはシグナルになった。', VIEW_W / 2, VIEW_H / 2 + 28);
    ctx.fillStyle = 'rgba(234,244,242,.6)';
    ctx.fillText('R — RESTART FROM STAGE 1', VIEW_W / 2, VIEW_H / 2 + 64);
  }
}

/* ---------- 起動 ---------- */
loadStage(stageIdx, true);
state = 'title';

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
  update(dt); render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
})();
