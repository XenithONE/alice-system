/* ============================================================
   I WANNA BE THE SIGNAL — engine.js v2.1 BRICK UPDATE（高難度・複数ステージ版）
   見た目のみトイブリック調に刷新（カバーアート iwbtg-brick.webp 準拠）。
   物理・当たり判定・難易度・セーブキーは v2 と完全に同一。
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
const kit=window.AliceGameKit&&window.AliceGameKit.install({
  id:'iwbtg',
  title:'I Wanna Be The Signal',
  bonusKey:'alice_bonus_iwbtg',
  accent:'#33e7c8',
  mission:'Clear all stages. Death Echo marks recent trap lessons.'
});

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

/* ---------- v2.1 BRICK UPDATE: 起動時に一度だけ焼くトイブリック用オフスクリーンスプライト ----------
   ・全て手続き描画（外部画像なし）。毎フレーム再生成しない・shadowBlur不使用
   ・当たり判定・物理・難易度には一切影響しない（描画専用） */
function mkCv(w, h, fn) { const c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d')); return c; }
function rr(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function stud(g, cx, cy, r, fill, rim) {
  g.fillStyle = rim; g.beginPath(); g.arc(cx, cy + 1, r, 0, 7); g.fill();
  g.fillStyle = fill; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
  g.fillStyle = 'rgba(255,255,255,.45)'; g.beginPath(); g.arc(cx - r * .3, cy - r * .35, r * .35, 0, 7); g.fill();
}
const BT = { red:'#c91a09', redDark:'#8f1206', blue:'#0055bf', blueDark:'#003d8f', azure:'#3399ff',
  yellow:'#f2cd37', yellowDark:'#b8941f', green:'#4b9f4a', greenLight:'#66c05f', greenDark:'#37753a',
  white:'#f4f4f4', gray:'#6d6e6c', grayLight:'#7f807e', grayDark:'#4b4d4b', ink:'#12314f' };
const BR = {};
{
  // 上面が露出した地形ブロック（緑キャップ＋スタッド、下は灰ブリック）
  BR.top = mkCv(32, 32, g => {
    g.fillStyle = BT.gray; rr(g, 1, 12, 30, 19, 3); g.fill();
    g.fillStyle = 'rgba(255,255,255,.15)'; g.fillRect(3, 13, 26, 2);
    g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(3, 28, 26, 3);
    g.fillStyle = BT.greenDark; rr(g, 0, 2, 32, 13, 3); g.fill();
    g.fillStyle = BT.green; rr(g, 0, 0, 32, 13, 3); g.fill();
    g.fillStyle = 'rgba(255,255,255,.3)'; g.fillRect(2, 1.5, 28, 2);
    stud(g, 10, 7, 4, BT.greenLight, BT.greenDark);
    stud(g, 22, 7, 4, BT.greenLight, BT.greenDark);
  });
  // 埋まっている地形ブロック（灰ブリック）
  BR.mid = mkCv(32, 32, g => {
    g.fillStyle = BT.grayDark; rr(g, 1, 2, 30, 30, 3); g.fill();
    g.fillStyle = BT.gray; rr(g, 1, 1, 30, 29, 3); g.fill();
    g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(3, 2.5, 26, 2);
    g.fillStyle = 'rgba(0,0,0,.16)'; g.fillRect(3, 27, 26, 2);
    stud(g, 10, 9, 4, BT.grayLight, BT.grayDark);
    stud(g, 22, 9, 4, BT.grayLight, BT.grayDark);
  });
  // 島の底に巻く黄黒ハザードテープ（カバーの縞バンド）
  BR.strip = mkCv(32, 7, g => {
    g.fillStyle = BT.yellow; g.fillRect(0, 0, 32, 7);
    g.fillStyle = '#20242b';
    for (let x = -10; x < 40; x += 16) {
      g.beginPath(); g.moveTo(x, 7); g.lineTo(x + 7, 0); g.lineTo(x + 15, 0); g.lineTo(x + 8, 7);
      g.closePath(); g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(0, 0, 32, 1.5);
  });
  // タレット用の黄黒ハザードブリック
  BR.hazard = mkCv(32, 32, g => {
    g.fillStyle = BT.yellowDark; rr(g, 1, 2, 30, 30, 3); g.fill();
    g.fillStyle = BT.yellow; rr(g, 1, 1, 30, 29, 3); g.fill();
    g.save(); rr(g, 1, 1, 30, 29, 3); g.clip();
    g.fillStyle = '#20242b';
    for (let x = -24; x < 48; x += 16) {
      g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 16, 0); g.lineTo(x + 24, 0); g.lineTo(x + 8, 32);
      g.closePath(); g.fill();
    }
    g.restore();
    g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(3, 2, 26, 2);
    g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(3, 27, 26, 2);
  });
  // トゲ（赤／白帯コーン・シルエットは従来の三角形と同一）
  const spikeCv = (col, dark) => mkCv(32, 32, g => {
    for (let i = 0; i < 2; i++) {
      const bx = 2 + i * 16;
      g.beginPath(); g.moveTo(bx, 32); g.lineTo(bx + 6, 8); g.lineTo(bx + 12, 32); g.closePath();
      g.fillStyle = col; g.fill();
      g.save(); g.clip();
      g.fillStyle = 'rgba(244,244,244,.9)'; g.fillRect(bx, 17, 14, 5);
      g.fillStyle = 'rgba(255,255,255,.3)'; g.fillRect(bx + 4, 8, 2, 24);
      g.restore();
      g.strokeStyle = dark; g.lineWidth = 1.5; g.stroke();
    }
  });
  BR.spike = spikeCv(BT.red, BT.redDark);
  BR.spikeHot = spikeCv('#ff5a3c', '#a8300f');
  // 黄色いブリックくん（カバーの主人公。1スタッド頭＋困り顔）
  const playerCv = (body, dark, feet) => mkCv(32, 32, g => {
    g.fillStyle = dark; rr(g, 12, 0, 8, 4, 1.5); g.fill();
    g.fillStyle = body; rr(g, 12, 0, 8, 3, 1.5); g.fill();
    g.fillStyle = dark; rr(g, 1, 12, 5, 9, 2); g.fill(); rr(g, 26, 12, 5, 9, 2); g.fill();
    g.fillStyle = dark; rr(g, 4, 4, 24, 24, 4); g.fill();
    g.fillStyle = body; rr(g, 4, 3, 24, 24, 4); g.fill();
    g.fillStyle = 'rgba(255,255,255,.38)'; g.fillRect(7, 5, 18, 2);
    g.fillStyle = BT.white;
    g.beginPath(); g.arc(14.5, 12, 3, 0, 7); g.fill();
    g.beginPath(); g.arc(22.5, 12, 3, 0, 7); g.fill();
    g.fillStyle = BT.ink;
    g.beginPath(); g.arc(15.5, 12.3, 1.5, 0, 7); g.fill();
    g.beginPath(); g.arc(23.5, 12.3, 1.5, 0, 7); g.fill();
    g.strokeStyle = BT.ink; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(11.5, 7.5); g.lineTo(16.5, 9); g.moveTo(25.5, 7.5); g.lineTo(20.5, 9); g.stroke();
    g.fillStyle = BT.ink; rr(g, 16.5, 17.5, 6, 4.5, 2); g.fill();
    g.fillStyle = feet; rr(g, 6.5, 27, 8, 5, 2); g.fill(); rr(g, 17.5, 27, 8, 5, 2); g.fill();
  });
  BR.player = playerCv(BT.yellow, BT.yellowDark, '#8a6f14');
  BR.playerGod = playerCv('#8e63ff', '#5b34c9', '#41249c');
  // ノコギリ（赤いプラ歯車＋白スタッド軸）
  BR.saw = mkCv(40, 40, g => {
    g.translate(20, 20);
    g.fillStyle = BT.redDark;
    for (let i = 0; i < 8; i++) {
      g.rotate(Math.PI / 4);
      g.beginPath(); g.moveTo(8, -4.5); g.lineTo(17, 0); g.lineTo(8, 4.5); g.closePath(); g.fill();
    }
    g.beginPath(); g.arc(0, 0, 13, 0, 7); g.fill();
    g.fillStyle = BT.red; g.beginPath(); g.arc(0, 0, 11.5, 0, 7); g.fill();
    for (let i = 0; i < 8; i++) {
      g.rotate(Math.PI / 4);
      g.beginPath(); g.moveTo(9, -2.5); g.lineTo(15, 0); g.lineTo(9, 2.5); g.closePath(); g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,.22)'; g.beginPath(); g.arc(-3.5, -4.5, 5.5, 0, 7); g.fill();
    stud(g, 0, 0, 4.5, BT.white, '#b9bcbf');
  });
  // 弾（赤い丸ポッチ）
  BR.bullet = mkCv(16, 16, g => {
    g.fillStyle = 'rgba(201,26,9,.3)'; g.beginPath(); g.arc(8, 8, 7.5, 0, 7); g.fill();
    g.fillStyle = BT.redDark; g.beginPath(); g.arc(8, 8.8, 5.2, 0, 7); g.fill();
    g.fillStyle = BT.red; g.beginPath(); g.arc(8, 7.8, 5, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,.5)'; g.beginPath(); g.arc(6.3, 6, 1.8, 0, 7); g.fill();
  });
  // 移動足場（濃青プレート＋アズールスタッド。空色と混ざらない配色）
  BR.plat = mkCv(32, 12, g => {
    g.fillStyle = BT.blueDark; rr(g, 0, 2, 32, 10, 3); g.fill();
    g.fillStyle = BT.blue; rr(g, 0, 0, 32, 10, 3); g.fill();
    g.fillStyle = 'rgba(255,255,255,.3)'; g.fillRect(2, 1, 28, 2);
    stud(g, 10, 5, 3, BT.azure, BT.blueDark);
    stud(g, 22, 5, 3, BT.azure, BT.blueDark);
  });
  // ゴール扉（紫ブリック積み。偽ゴールも同一見た目＝罠仕様は不変）
  BR.door = mkCv(32, 48, g => {
    g.fillStyle = '#48279e'; rr(g, 2, 1, 28, 47, 4); g.fill();
    g.fillStyle = '#7b4dff'; rr(g, 2, 0, 28, 46, 4); g.fill();
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(4, 15, 24, 2); g.fillRect(4, 31, 24, 2);
    g.fillStyle = 'rgba(255,255,255,.3)'; g.fillRect(4, 1.5, 24, 2);
    stud(g, 11, 8, 3.5, '#9a73ff', '#48279e');
    stud(g, 21, 8, 3.5, '#9a73ff', '#48279e');
    g.fillStyle = '#33e7c8'; g.fillRect(21, 21, 4, 7);
  });
  // 背景3層（空グラデ／ブリック雲／遠景の浮島）— 起動時に1回だけ描く
  BR.sky = mkCv(VIEW_W, VIEW_H, g => {
    const gr = g.createLinearGradient(0, 0, 0, VIEW_H);
    gr.addColorStop(0, '#7cc4f8'); gr.addColorStop(.55, '#48a5f0'); gr.addColorStop(1, '#2f8fe0');
    g.fillStyle = gr; g.fillRect(0, 0, VIEW_W, VIEW_H);
  });
  BR.clouds = mkCv(VIEW_W, VIEW_H, g => {
    const puffs = [[70, 64, 4], [300, 132, 3], [520, 52, 5], [705, 168, 3], [858, 96, 4], [180, 226, 3]];
    for (const [bx, by, n] of puffs) {
      const cw = 24, ch = 15;
      g.fillStyle = 'rgba(210,229,243,.9)';
      rr(g, bx, by + 4, n * cw - 2, ch, 4); g.fill();
      g.fillStyle = 'rgba(248,251,253,.96)';
      for (let i = 0; i < n; i++) { rr(g, bx + i * cw, by, cw - 2, ch, 4); g.fill(); }
      for (let i = 0; i < n - 2; i++) { rr(g, bx + cw * .9 + i * cw, by - ch + 4, cw - 2, ch, 4); g.fill(); }
    }
  });
  BR.isles = mkCv(VIEW_W, VIEW_H, g => {
    const isl = [[120, 300, 3], [420, 236, 4], [700, 320, 3], [905, 212, 2]];
    for (const [bx, by, n] of isl) {
      const cw = 16;
      g.fillStyle = '#8ea4b2'; rr(g, bx + 3, by + 9, n * cw - 6, 8, 2); g.fill();
      g.fillStyle = '#7f95a4'; rr(g, bx + 7, by + 16, n * cw - 14, 7, 2); g.fill();
      if (n > 2) { g.fillStyle = '#71879a'; rr(g, bx + 11, by + 22, n * cw - 22, 6, 2); g.fill(); }
      g.fillStyle = '#79c178'; rr(g, bx, by, n * cw, 10, 3); g.fill();
      g.fillStyle = 'rgba(255,255,255,.3)'; g.fillRect(bx + 2, by + 1, n * cw - 4, 1.5);
      for (let i = 0; i < n; i++) stud(g, bx + 8 + i * cw, by + 5, 3, '#8fd18d', '#5c9e5f');
    }
    g.fillStyle = '#9c6b4a'; g.fillRect(478, 218, 3, 18);
    g.fillStyle = '#e04a3a';
    g.beginPath(); g.moveTo(481, 218); g.lineTo(495, 222.5); g.lineTo(481, 227); g.closePath(); g.fill();
  });
}

/* ---------- サウンド ---------- */
let actx = null, mute = localStorage.getItem('signal_mute') === '1';
let musicMute = localStorage.getItem('signal_music') === '1';   // [N]トグル（'1'=BGM OFF）
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

/* ---------- 追加: 手続き的BGM（WebAudioシンセ。state==='play' && !mute && !musicMute のみ発音） ----------
   ・既存 actx を共有（第2のAudioContextは作らない）
   ・musicGain 経由で短いベース＋アルペジオのループを setInterval で駆動
   ・厳格ゲート: play 以外（title/card/pause/dead/stageclear/clear）では一切鳴らさない
   ・物理/update には一切触れない（純粋にオーディオのみ） */
let musicGain = null, musicTimer = null, musicStep = 0;
const MUSIC_BPM = 132;                                   // 1/8音符ステップ間隔の基準
const MUSIC_INT = (60000 / MUSIC_BPM) / 2;               // 8分音符（ms）
const MUSIC_BASS = [55.00, 55.00, 65.41, 49.00];         // A1 A1 C2 G1（小節ごと）
const MUSIC_ARP  = [220.00, 261.63, 329.63, 392.00,      // A3 C4 E4 G4 …
                    329.63, 261.63, 392.00, 523.25];     // E4 C4 G4 C5
function musicVoice(freq, dur, type, gain) {
  try {
    const o = actx.createOscillator(), gn = actx.createGain();
    o.type = type; o.frequency.value = freq; o.connect(gn); gn.connect(musicGain);
    const t = actx.currentTime;
    gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(gain, t + 0.012);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.start(t); o.stop(t + dur);
  } catch (e) {}
}
function musicTick() {
  // 厳格ゲート: play 以外、またはミュート時は無音（タイマーは回り続けるが発音しない）
  if (state !== 'play' || mute || musicMute || !actx || !musicGain) return;
  const step = musicStep % 8;
  if (step === 0) musicVoice(MUSIC_BASS[(musicStep >> 3) % MUSIC_BASS.length], 0.42, 'triangle', 0.16);
  if (step % 2 === 0) musicVoice(MUSIC_BASS[(musicStep >> 3) % MUSIC_BASS.length] * 2, 0.16, 'square', 0.05);
  musicVoice(MUSIC_ARP[step], 0.20, 'square', 0.045);
  musicStep++;
}
function startMusic() {
  // 最初のジェスチャ後（actx.resume 済み）に遅延起動。多重起動はしない。
  if (musicTimer || !actx) return;
  try {
    musicGain = actx.createGain();
    musicGain.gain.value = 0.5;
    musicGain.connect(actx.destination);
    musicStep = 0;
    musicTimer = setInterval(musicTick, MUSIC_INT);
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
const deathMarks = [];
let kitT = 0;

/* ---------- 追加: 演出・スコア・設定（描画とスコアのみ。物理/衝突には一切触れない） ---------- */
const REDUCE = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();
let shake = 0, flash = 0;                         // 画面シェイク量・死亡フラッシュ（描画カメラ専用のオフセット）
let combo = 0;                                    // ノーデス連続クリア数
let bestCombo = parseInt(localStorage.getItem('signal_bestcombo'), 10) || 0;
let bestTime = parseFloat(localStorage.getItem('signal_besttime')) || 0;
let bestStage = parseInt(localStorage.getItem('signal_beststage'), 10) || 0;
let seenOnboard = localStorage.getItem('signal_seen') === '1';   // 初回オンボーディングカード既読フラグ（表示専用）

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
  if(kit){kit.mission('Stage '+(stageIdx+1)+'/'+DEFS.length+' - Death Echo marks recent danger.');kit.setMetric('STAGE',(stageIdx+1)+'/'+DEFS.length);}
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
  combo = 0;                                       // ノーデス連続クリアをリセット（スコアのみ）
  shake = REDUCE ? 0 : 16; flash = REDUCE ? 0.25 : 0.6;  // 描画専用の演出（物理には無関係）
  burst(P.x, P.y - P.h / 2, C.red, 28);
  deathMarks.push({stage:stageIdx,x:P.x,y:P.y - P.h / 2});
  while(deathMarks.length>10) deathMarks.shift();
  if(kit){kit.toast('DEATH ECHO RECORDED');kit.spark(undefined,undefined,18,'#ff3b5c','ring');}
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
  // BGMトグル [N]（state不問・どの画面でも切替可。発音ゲートは musicTick 側が担保）
  if (e.key === 'n' || e.key === 'N') {
    musicMute = !musicMute; localStorage.setItem('signal_music', musicMute ? '1' : '0');
    toastMsg(musicMute ? 'MUSIC OFF' : 'MUSIC ON'); startMusic(); return;
  }
  if (state === 'title') {
    if (e.key === '0' && stageIdx > 0) { loadStage(0, true); toastMsg('PROGRESS RESET'); return; }
    try { localStorage.setItem('signal_seen', '1'); } catch (e2) {}   // 初回オンボーディングカードを既読化
    seenOnboard = true;
    state = 'card'; cardT = 1.2; tone(660, .1, 'square', .05); startMusic(); return;
  }
  if (state === 'clear') {
    if (e.key === 'r' || e.key === 'R') { loadStage(0); runT = 0; }
    return;
  }
  // 一時停止トグル（ESC / P）— update() は 'pause' で即 return するため物理は完全停止
  if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
    if (state === 'play') { state = 'pause'; tone(330, .06, 'sine', .04); return; }
    if (state === 'pause') { state = 'play'; tone(440, .06, 'sine', .04); startMusic(); return; }
  }
  // ミュートは play/dead/pause で有効（一時停止画面からも切替可）
  if (e.key === 'm' || e.key === 'M') { mute = !mute; localStorage.setItem('signal_mute', mute ? '1' : '0'); toastMsg(mute ? 'MUTE ON' : 'MUTE OFF'); startMusic(); return; }
  if (state === 'pause') return;   // 一時停止中はジャンプ等のゲーム入力を無視
  if (state !== 'play' && state !== 'dead') return;
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
  if (state === 'pause') return;   // 一時停止: シミュレーションを完全凍結（描画ループは継続）
  time += dt;
  if (toastT > 0) toastT -= dt;
  updateParts(dt);
  // 演出の減衰（描画専用オフセット。物理には無関係）
  if (shake > 0) shake = Math.max(0, shake - 60 * dt);
  if (flash > 0) flash = Math.max(0, flash - 1.6 * dt);
  if (state === 'card') { cardT -= dt; if (cardT <= 0) state = 'play'; return; }
  if (state === 'dead') { deadT += dt; if (deadT > 0.9) respawn(); return; }
  if (state === 'stageclear') {
    clearT -= dt;
    if (clearT <= 0) {
      if (stageIdx + 1 < DEFS.length) loadStage(stageIdx + 1);
      else { state = 'clear'; localStorage.setItem('signal_stage', 0);
        try{localStorage.setItem('alice_bonus_iwbtg','1');}catch(e){}
        if(kit)kit.complete('All signal stages cleared.');
        if (bestTime === 0 || runT < bestTime) { bestTime = runT; localStorage.setItem('signal_besttime', runT.toFixed(2)); } }
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
      // スコア記録（進行はゲートしない・難易度は不変）
      combo++; if (combo > bestCombo) { bestCombo = combo; localStorage.setItem('signal_bestcombo', bestCombo); }
      if (stageIdx + 1 > bestStage) { bestStage = stageIdx + 1; localStorage.setItem('signal_beststage', bestStage); }
      if(kit){kit.toast('STAGE '+(stageIdx+1)+' CLEAR');kit.spark(undefined,undefined,32,'#33e7c8','ring');}
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
  const img = bright ? BR.spikeHot : BR.spike;   // 事前レンダ済みブリックコーン（赤/白）
  if (dir === 'up') { ctx.drawImage(img, x, y); return; }
  ctx.save(); ctx.translate(x + 16, y + 16);
  ctx.rotate({ up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 }[dir]);
  ctx.drawImage(img, -16, -16);
  ctx.restore();
}

// トイスタジオ調ソフトビネット + 微細スキャンライン（ビネットは初回のみ焼いてキャッシュ）
let vignCv = null;
function drawCRT() {
  if (!vignCv) vignCv = mkCv(VIEW_W, VIEW_H, g => {
    const gr = g.createRadialGradient(VIEW_W / 2, VIEW_H * 0.46, VIEW_H * 0.35, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.62);
    gr.addColorStop(0, 'rgba(9,26,48,0)'); gr.addColorStop(1, 'rgba(9,26,48,0.30)');
    g.fillStyle = gr; g.fillRect(0, 0, VIEW_W, VIEW_H);
  });
  ctx.drawImage(vignCv, 0, 0);
  ctx.globalAlpha = 0.045; ctx.fillStyle = '#0b2a4a';
  const off = REDUCE ? 0 : Math.floor(time * 30) % 4;   // reduced-motion ではスクロールを停止
  for (let y = off; y < VIEW_H; y += 4) ctx.fillRect(0, y, VIEW_W, 1);
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(244,244,244,0.07)';
  ctx.fillRect(0, 0, VIEW_W, 8); ctx.fillRect(0, VIEW_H - 8, VIEW_W, 8);
}

function render() {
  const camX = Math.max(0, Math.min(P.x - VIEW_W / 2, LV.w * TILE - VIEW_W));
  const camY = Math.max(0, Math.min(P.y - VIEW_H * 0.6, Math.max(0, LV.h * TILE - VIEW_H)));
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // 背景: ステージ別PNGがあれば使用、無ければ stage1、それも無ければ手続き的な星空にフォールバック
  const bg = SPR['bg_stage' + (stageIdx + 1)] || SPR['bg_stage1'];
  if (bg) {
    const off = (camX * 0.3) % VIEW_W;
    ctx.drawImage(bg.img, 0, 0, bg.fw, bg.fh, -off, 0, VIEW_W, VIEW_H);
    ctx.drawImage(bg.img, 0, 0, bg.fw, bg.fh, VIEW_W - off, 0, VIEW_W, VIEW_H);
  } else {
    // 明るい空色＋ブリック雲＋遠景の浮島（全て起動時に事前レンダ済み。パララックスで2枚wrap描画）
    ctx.drawImage(BR.sky, 0, 0);
    let boff = (camX * 0.16) % VIEW_W;
    ctx.drawImage(BR.clouds, -boff, 0); ctx.drawImage(BR.clouds, VIEW_W - boff, 0);
    boff = (camX * 0.34) % VIEW_W;
    ctx.drawImage(BR.isles, -boff, 0); ctx.drawImage(BR.isles, VIEW_W - boff, 0);
  }

  // 画面シェイク: 描画カメラのオフセットのみ（P.x/P.y・衝突判定には一切影響しない）
  const sx = shake ? (Math.random() * 2 - 1) * shake : 0;
  const sy = shake ? (Math.random() * 2 - 1) * shake : 0;
  ctx.save(); ctx.translate(-camX + sx, -camY + sy);
  const tx0 = Math.floor(camX / TILE) - 1, tx1 = Math.ceil((camX + VIEW_W) / TILE) + 1;

  // ブリックタイル: 上が空いていれば緑キャップ、下が空いていれば黄黒テープ（見た目のみ・判定不変）
  const drawBlock = (x, y, cap, tape) => {
    if (spr('tile_ground', 0, x, y, TILE, TILE)) return;
    ctx.drawImage(cap ? BR.top : BR.mid, x, y);
    if (tape) ctx.drawImage(BR.strip, x, y + TILE - 7);
  };
  // 通常地形
  LV.plain.forEach(k => {
    const [tx, ty] = k.split(',').map(Number);
    if (tx < tx0 || tx > tx1) return;
    drawBlock(tx * TILE, ty * TILE, !solid.has(keyOf(tx, ty - 1)), !solid.has(keyOf(tx, ty + 1)));
  });
  // 偽ブロック（見た目は完全に同じ＝それが罠）
  fakeSt.forEach((f, k) => {
    if (f.st === 2) return;
    const [tx, ty] = k.split(',').map(Number);
    if (tx < tx0 || tx > tx1) return;
    drawBlock(tx * TILE, ty * TILE, !solid.has(keyOf(tx, ty - 1)), !solid.has(keyOf(tx, ty + 1)));
  });
  // 透明ブロック（発見後のみ・紫の枠）
  LV.invis.forEach(k => {
    if (!revealed.has(k)) return;
    const [tx, ty] = k.split(',').map(Number);
    if (tx < tx0 || tx > tx1) return;
    const x = tx * TILE, y = ty * TILE;
    drawBlock(x, y, !solid.has(keyOf(tx, ty - 1)), !solid.has(keyOf(tx, ty + 1)));
    ctx.strokeStyle = C.violet; ctx.globalAlpha = .8; ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 1.5, y + 1.5, TILE - 3, TILE - 3); ctx.globalAlpha = 1;
  });
  // 崩落ブロック（ヒビ入り）
  crumSt.forEach((c, k) => {
    if (c.st === 2) return;
    const [tx, ty] = k.split(',').map(Number);
    if (tx < tx0 || tx > tx1) return;
    const x = tx * TILE, y = ty * TILE;
    drawBlock(x, y, !solid.has(keyOf(tx, ty - 1)), !solid.has(keyOf(tx, ty + 1)));
    ctx.strokeStyle = 'rgba(32,36,43,.55)'; ctx.lineWidth = 1;
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
  // 落下ブロック（待機中は周囲の通常ブリックと同一見た目＝罠仕様を維持）
  for (const f of fallblocks) {
    if (f.st === 2) continue;
    if (!spr('hazard_block_fall', 0, f.x, f.y, TILE, TILE)) {
      drawBlock(f.x, f.y, !isSolid(f.tx, f.ty - 1), !isSolid(f.tx, f.ty + 1));
      if (f.st === 1) { ctx.fillStyle = 'rgba(201,26,9,.35)'; ctx.fillRect(f.x, f.y, TILE, TILE); }
    }
  }
  // 移動足場（濃青ブリックプレート・上面座標は従来と同一）
  for (const p of platforms) {
    for (let pdx = 0; pdx + TILE <= p.w; pdx += TILE) ctx.drawImage(BR.plat, p.x + pdx, p.y);
    if (p.w % TILE) ctx.drawImage(BR.plat, p.x + p.w - TILE, p.y);
  }
  // タレット（黄黒ハザードブリック＋砲身）
  for (const sh of shooters) {
    const x = sh.tx * TILE, y = sh.ty * TILE;
    if (!spr('tile_ground', 0, x, y, TILE, TILE)) ctx.drawImage(BR.hazard, x, y);
    ctx.fillStyle = '#2a2d33'; ctx.fillRect(x + 8, y + 8, 16, 16);
    const v = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[sh.dir];
    ctx.fillStyle = BT.red; ctx.fillRect(x + 14 + v[0] * 10, y + 14 + v[1] * 10, 6, 6);
  }
  // ノコギリ（事前レンダ済み赤歯車を回転描画）
  for (const s of saws) {
    if (!spr('hazard_saw', time * 10, s.x - 16, s.y - 16, TILE, TILE)) {
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(time * 7);
      ctx.drawImage(BR.saw, -20, -20);
      ctx.restore();
    }
  }
  // トリガースパイク（飛行中のみ表示）
  for (const t of tspikes) if (t.st === 1) drawSpikeShape(t.x, t.y, t.dir, true);
  // 弾（赤い丸ポッチ）
  for (const b of bullets) {
    if (!spr('hazard_bullet', 0, b.x - 8, b.y - 8, 16, 16)) ctx.drawImage(BR.bullet, b.x - 8, b.y - 8);
  }
  // ゴール扉（偽も同じ見た目・紫ブリック扉）
  for (const g of LV.goals) {
    const x = g.tx * TILE, yB = (g.ty + 1) * TILE;
    if (spr('door_goal', 0, x, yB - 48, TILE, 48)) continue;
    ctx.fillStyle = C.violet; ctx.globalAlpha = .22; ctx.fillRect(x - 6, yB - 54, TILE + 12, 54); ctx.globalAlpha = 1;
    ctx.drawImage(BR.door, x, yB - 48);
  }
  // セーブ（偽も同じ見た目）
  LV.saves.forEach((s, i) => {
    const x = s.tx * TILE, y = s.ty * TILE, on = i === activeSave && !s.fake;
    if (spr('savepoint', time * 6, x, y, TILE, TILE)) return;
    const cx = x + 16, cy = y + 16 + Math.sin(time * 3 + i) * 3;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.PI / 4);
    ctx.fillStyle = on ? C.teal : '#1fa38c';
    ctx.fillRect(-7, -7, 14, 14);
    ctx.fillStyle = 'rgba(255,255,255,.38)'; ctx.fillRect(-7, -7, 14, 4);     // プラ光沢
    ctx.strokeStyle = 'rgba(9,38,66,.55)'; ctx.lineWidth = 1.5; ctx.strokeRect(-7, -7, 14, 14);
    ctx.restore();
    if (on) { ctx.strokeStyle = C.teal; ctx.globalAlpha = .5;
      ctx.beginPath(); ctx.arc(cx, cy, 13 + Math.sin(time * 5) * 2, 0, 7); ctx.stroke(); ctx.globalAlpha = 1; }
  });
  // メッセージ（明るい空でも読めるよう白フチ＋濃紺インク）
  ctx.font = '700 12px "Courier New",monospace'; ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  for (const m of msgs) {
    if (m.zone && !rectsHit(P.x - P.w / 2, P.y - P.h, P.x + P.w / 2, P.y,
        m.zone[0], m.zone[1], m.zone[0] + m.zone[2], m.zone[1] + m.zone[3])) continue;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(244,244,244,.85)';
    ctx.strokeText(m.text, m.x, m.y + 12);
    ctx.fillStyle = 'rgba(26,49,90,.95)';
    ctx.fillText(m.text, m.x, m.y + 12);
  }
  // Death Echo: recent death positions remain as non-colliding visual memory.
  for (const mark of deathMarks) {
    if (mark.stage !== stageIdx) continue;
    ctx.save();
    ctx.translate(mark.x, mark.y);
    ctx.globalAlpha = 0.32 + 0.18 * Math.sin(time * 5);
    ctx.strokeStyle = C.red;
    ctx.fillStyle = 'rgba(255,59,92,.16)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 15 + Math.sin(time * 4) * 2, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-10, -10); ctx.lineTo(10, 10); ctx.moveTo(10, -10); ctx.lineTo(-10, 10); ctx.stroke();
    ctx.font = '700 9px "Courier New",monospace'; ctx.textAlign = 'center'; ctx.fillText('ECHO', 0, -22);
    ctx.restore();
  }
  // プレイヤー
  if (state !== 'dead') {
    const px = P.x - 16, py = P.y - 32;
    const moving = Math.abs(P.vx) > 1;
    let name = 'player_idle', fr = time * 4;
    if (!P.ground) { name = 'player_jump'; fr = P.vy < 0 ? 0 : 1; }
    else if (moving) { name = 'player_run'; fr = P.anim * 10; }
    if (!spr(name, fr, px, py, 32, 32, P.face < 0)) {
      // 黄色いブリックくん（事前レンダ済み・スプライトと同じ32x32配置。当たり判定は従来通り20x28）
      const img = god ? BR.playerGod : BR.player;
      if (P.face < 0) { ctx.save(); ctx.translate(px + 32, py); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0); ctx.restore(); }
      else ctx.drawImage(img, px, py);
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

  // 死亡フラッシュ（フルスクリーンの赤・カメラ復帰後に重ねる）
  if (flash > 0) { ctx.fillStyle = 'rgba(255,59,92,' + (flash * 0.5).toFixed(3) + ')'; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }

  /* ---- HUD ---- */
  // 明るい空でもHUDが読めるよう上端に半透明の濃紺帯（表示専用）
  ctx.fillStyle = 'rgba(10,32,60,.42)';
  ctx.fillRect(0, 0, VIEW_W, combo > 1 ? 66 : 48);
  const mm = Math.floor(runT / 60), ss = (runT % 60).toFixed(1).padStart(4, '0');
  ctx.font = '700 13px "Courier New",monospace';
  ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(234,244,242,.85)';
  ctx.fillText('DEATHS ' + String(deaths).padStart(3, '0'), 14, 22);
  ctx.fillStyle = 'rgba(234,244,242,.5)';
  ctx.fillText('TIME ' + mm + ':' + ss, 14, 40);
  if (combo > 1) { ctx.fillStyle = C.teal; ctx.textAlign = 'left';
    ctx.fillText('COMBO x' + combo + ' NO-DEATH', 14, 58); }
  ctx.textAlign = 'center';
  ctx.fillText((stageIdx + 1) + '/' + DEFS.length + '  ' + LV.name, VIEW_W / 2, 22);
  ctx.textAlign = 'right';
  ctx.fillStyle = SPR.player_run ? 'rgba(51,231,200,.8)' : 'rgba(234,244,242,.35)';
  ctx.fillText(SPR.player_run ? 'SPRITES: LIVE' : 'SPRITES: PLACEHOLDER', VIEW_W - 14, 22);
  if (DEBUG) { ctx.fillStyle = C.violet; ctx.fillText('DEBUG' + (god ? ' / GOD' : ''), VIEW_W - 14, 40); }
  if (toastT > 0) {
    ctx.textAlign = 'center';
    ctx.font = '700 15px "Courier New",monospace';
    const tw = ctx.measureText(toast).width;
    ctx.fillStyle = 'rgba(10,32,60,.55)';
    ctx.fillRect(VIEW_W / 2 - tw / 2 - 12, 76, tw + 24, 23);
    ctx.fillStyle = C.teal;
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
    ctx.fillStyle = '#f2cd37'; ctx.font = '700 12px "Courier New",monospace';
    ctx.fillText('v2 — BRICK UPDATE', VIEW_W / 2, VIEW_H / 2 - 18);
    ctx.fillStyle = 'rgba(234,244,242,.75)'; ctx.font = '700 14px "Courier New",monospace';
    ctx.fillText('← → MOVE   Z / SPACE JUMP ×2   R RETRY   M MUTE   ESC PAUSE', VIEW_W / 2, VIEW_H / 2 + 14);
    ctx.fillStyle = C.teal; ctx.font = '700 12px "Courier New",monospace';
    ctx.fillText('[N] MUSIC ' + (musicMute ? 'OFF' : 'ON') + '   ·   [M] SOUND ' + (mute ? 'OFF' : 'ON'), VIEW_W / 2, VIEW_H / 2 + 34);
    if (stageIdx > 0) {
      ctx.fillStyle = C.teal; ctx.font = '700 14px "Courier New",monospace';
      ctx.fillText('CONTINUE: STAGE ' + (stageIdx + 1) + '   (0キーで最初から)', VIEW_W / 2, VIEW_H / 2 + 56);
    }
    ctx.fillStyle = C.teal; ctx.font = '700 14px "Courier New",monospace';
    ctx.fillText(Math.sin(time * 4) > 0 ? '— PRESS ANY KEY —' : '', VIEW_W / 2, VIEW_H / 2 + 86);
    ctx.fillStyle = C.red; ctx.font = '700 12px "Courier New",monospace';
    ctx.fillText('警告: この世界はあなたを騙します。全てを疑え。', VIEW_W / 2, VIEW_H / 2 + 120);
    if (bestStage > 0) {
      ctx.fillStyle = 'rgba(51,231,200,.7)'; ctx.font = '700 12px "Courier New",monospace';
      const bt = bestTime ? '  BEST ' + Math.floor(bestTime / 60) + ':' + (bestTime % 60).toFixed(1).padStart(4, '0') : '';
      ctx.fillText('BEST  STAGE ' + bestStage + ' / ' + DEFS.length + bt, VIEW_W / 2, VIEW_H / 2 + 144);
    }
    // 初回オンボーディングカード（signal_seen 未設定時のみ・1回だけ前面に提示。表示専用で状態/入力は変えない）
    if (!seenOnboard) {
      const cw = 620, ch = 300, cx = (VIEW_W - cw) / 2, cy = (VIEW_H - ch) / 2;
      ctx.fillStyle = 'rgba(4,6,11,.96)'; ctx.fillRect(cx, cy, cw, ch);
      ctx.strokeStyle = C.violet; ctx.lineWidth = 2; ctx.strokeRect(cx + 1, cy + 1, cw - 2, ch - 2);
      ctx.textAlign = 'center';
      ctx.fillStyle = C.teal; ctx.font = '700 18px "Courier New",monospace';
      ctx.fillText('はじめに — WELCOME, SIGNAL', VIEW_W / 2, cy + 40);
      ctx.fillStyle = C.red; ctx.font = '700 15px "Courier New",monospace';
      ctx.fillText('セーブもゴールも嘘をつく — 全てを疑え', VIEW_W / 2, cy + 80);
      ctx.fillStyle = 'rgba(234,244,242,.85)'; ctx.font = '700 13px "Courier New",monospace';
      ctx.fillText('一見安全なブロック・セーブ・ゴールが即死トラップのことがある。', VIEW_W / 2, cy + 108);
      ctx.fillText('だが恐れるな — 死んでも即リトライ。死んで覚えるゲームだ。', VIEW_W / 2, cy + 132);
      ctx.fillStyle = C.ink; ctx.font = '700 15px "Courier New",monospace';
      ctx.fillText('◆ ← →  : 移動', VIEW_W / 2, cy + 176);
      ctx.fillText('◆ Z / SPACE  : ジャンプ（空中でもう1回＝2段ジャンプ）', VIEW_W / 2, cy + 204);
      ctx.fillStyle = 'rgba(234,244,242,.55)'; ctx.font = '700 12px "Courier New",monospace';
      ctx.fillText('R リトライ ・ M サウンド ・ N BGM ・ ESC ポーズ', VIEW_W / 2, cy + 240);
      ctx.fillStyle = C.teal; ctx.font = '700 14px "Courier New",monospace';
      ctx.fillText('— PRESS ANY KEY TO BEGIN —', VIEW_W / 2, cy + ch - 24);
    }
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
  } else if (state === 'pause') {
    ctx.fillStyle = 'rgba(4,6,11,.86)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = C.ink; ctx.font = '700 30px "Courier New",monospace';
    ctx.fillText('PAUSED', VIEW_W / 2, VIEW_H / 2 - 70);
    ctx.fillStyle = C.violet; ctx.font = '700 13px "Courier New",monospace';
    ctx.fillText('OBJECTIVE: 嘘を見抜き、本物のシグナル(ゴール)に到達せよ。', VIEW_W / 2, VIEW_H / 2 - 36);
    ctx.fillStyle = 'rgba(234,244,242,.8)';
    ctx.fillText('← → MOVE   Z / SPACE JUMP ×2   R RETRY', VIEW_W / 2, VIEW_H / 2 + 2);
    ctx.fillStyle = C.teal;
    ctx.fillText('[M] ' + (mute ? 'SOUND OFF' : 'SOUND ON') + '   ·   [N] MUSIC ' + (musicMute ? 'OFF' : 'ON') + '   ·   MOTION ' + (REDUCE ? 'REDUCED' : 'ON') + '   ·   [ESC] RESUME', VIEW_W / 2, VIEW_H / 2 + 36);
    if (combo > 1) { ctx.fillStyle = 'rgba(51,231,200,.7)';
      ctx.fillText('NO-DEATH COMBO x' + combo, VIEW_W / 2, VIEW_H / 2 + 64); }
  } else if (state === 'clear') {
    ctx.fillStyle = 'rgba(4,6,11,.88)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = C.teal; ctx.font = '700 40px "Courier New",monospace';
    ctx.fillText('ALL SIGNALS CLAIMED', VIEW_W / 2, VIEW_H / 2 - 50);
    ctx.fillStyle = C.ink; ctx.font = '700 15px "Courier New",monospace';
    ctx.fillText('TOTAL DEATHS: ' + deaths + '    TIME: ' + mm + ':' + ss, VIEW_W / 2, VIEW_H / 2 - 8);
    if (bestTime > 0) { ctx.fillStyle = 'rgba(51,231,200,.7)'; ctx.font = '700 13px "Courier New",monospace';
      ctx.fillText('BEST TIME ' + Math.floor(bestTime / 60) + ':' + (bestTime % 60).toFixed(1).padStart(4, '0') + '   BEST COMBO ' + bestCombo, VIEW_W / 2, VIEW_H / 2 + 16); }
    ctx.fillStyle = C.violet;
    ctx.fillText('あなたはシグナルになった。', VIEW_W / 2, VIEW_H / 2 + 28);
    ctx.fillStyle = 'rgba(234,244,242,.6)';
    ctx.fillText('R — RESTART FROM STAGE 1', VIEW_W / 2, VIEW_H / 2 + 64);
  }

  // CRTグレード（HUD・オーバーレイの後＝フレーム最終段。全ステージを統一した見栄えに）
  drawCRT();
}

/* ---------- 起動 ---------- */
loadStage(stageIdx, true);
state = 'title';

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
  update(dt); render();
  if (kit && LV) {
    kitT += dt;
    if (kitT > .45) {
      kitT = 0;
      kit.setMetric('STAGE', (stageIdx + 1) + '/' + DEFS.length);
      kit.setMetric('DEATHS', deaths);
      kit.setMetric('TIME', Math.floor(runT / 60) + ':' + (runT % 60).toFixed(1).padStart(4, '0'));
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
})();
