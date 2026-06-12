/* レベル検証スクリプト（Node用）
   使い方: node validate.mjs
   levels/levelN.js を全部読み込み、形式エラーを報告します。 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
globalThis.window = { GAME_LEVELS: [] };

const files = readdirSync(dir).filter(f => /^level\d+\.js$/.test(f)).sort();
for (const f of files) eval(readFileSync(join(dir, f), 'utf8'));

const LEGAL = new Set([...'#^v<>!?*SFGXP.']);
const ENT_TYPES = new Set(['tspike', 'saw', 'shooter', 'fallblock', 'platform', 'msg']);
let errors = 0, warns = 0;
const err = (s, m) => { console.log(`  [ERR ] ${s}: ${m}`); errors++; };
const warn = (s, m) => { console.log(`  [warn] ${s}: ${m}`); warns++; };

window.GAME_LEVELS.forEach((lv, idx) => {
  const tag = `level${idx + 1} "${lv.name}"`;
  console.log(`\n== ${tag} ==`);
  const rows = lv.map || [];
  if (rows.length !== 17) err(tag, `rows=${rows.length} (must be 17)`);
  const w = Math.max(...rows.map(r => r.length));
  rows.forEach((r, i) => {
    if (r.length !== w) err(tag, `row${i} len=${r.length} != width=${w}`);
    [...r].forEach((ch, x) => { if (!LEGAL.has(ch)) err(tag, `row${i} col${x} illegal char "${ch}"`); });
  });
  const count = ch => rows.reduce((a, r) => a + [...r].filter(c => c === ch).length, 0);
  const find = ch => { const out = []; rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === ch) out.push([x, y]); })); return out; };
  if (count('P') !== 1) err(tag, `P count=${count('P')} (must be 1)`);
  if (count('G') < 1) err(tag, 'no real goal G');
  if (count('S') < 1) err(tag, 'no real savepoint S');
  const at = (x, y) => (rows[y] || '')[x] || '.';
  const solidish = c => '#!?*'.includes(c);
  for (const [px, py] of find('P')) {
    if (!solidish(at(px, py + 1))) err(tag, `no ground under P at [${px},${py}]`);
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
      if ('^v<>FX'.includes(at(px + dx, py + dy))) warn(tag, `lethal "${at(px + dx, py + dy)}" within 2 tiles of P`);
    }
  }
  for (const [sx, sy] of [...find('S'), ...find('F')]) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if ('^v<>'.includes(at(sx + dx, sy + dy))) warn(tag, `spike adjacent to save at [${sx},${sy}]`);
    }
    if (!solidish(at(sx, sy + 1)) && at(sx, sy + 1) !== 'S') warn(tag, `save at [${sx},${sy}] floats (no ground below)`);
  }
  const h = rows.length;
  const inB = (x, y) => x >= 0 && x < w && y >= 0 && y < h;
  (lv.entities || []).forEach((e, i) => {
    const et = `${tag} ent#${i}(${e.type})`;
    if (!ENT_TYPES.has(e.type)) { err(et, 'unknown type'); return; }
    const checkPt = (p, n) => { if (!p || p.length !== 2 || !inB(p[0], p[1])) err(et, `${n}=[${p}] out of bounds`); };
    const checkZone = z => { if (!z || z.length !== 4 || !inB(z[0], z[1]) || !inB(z[0] + z[2] - 1, z[1] + z[3] - 1)) err(et, `zone=[${z}] out of bounds`); };
    if (e.type === 'tspike') { checkPt(e.at, 'at'); checkZone(e.zone);
      if (!['up', 'down', 'left', 'right'].includes(e.dir)) err(et, `bad dir ${e.dir}`); }
    if (e.type === 'saw') { checkPt(e.from, 'from'); checkPt(e.to, 'to'); }
    if (e.type === 'shooter') { checkPt(e.at, 'at');
      if (!['up', 'down', 'left', 'right'].includes(e.dir)) err(et, `bad dir ${e.dir}`); }
    if (e.type === 'fallblock') { checkPt(e.at, 'at'); checkZone(e.zone); }
    if (e.type === 'platform') { checkPt(e.from, 'from'); checkPt(e.to, 'to'); }
    if (e.type === 'msg') { checkPt(e.at, 'at'); if (e.zone) checkZone(e.zone); }
  });
  console.log(`  size=${w}x${rows.length}  S=${count('S')} F=${count('F')} G=${count('G')} X=${count('X')} spikes=${count('^') + count('v') + count('<') + count('>')} fake=${count('!')} invis=${count('?')} crumble=${count('*')} ents=${(lv.entities || []).length}`);
});
console.log(`\nRESULT: ${errors} errors, ${warns} warnings, levels=${window.GAME_LEVELS.length}`);
process.exit(errors ? 1 : 0);
