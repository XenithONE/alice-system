# RELIC ROAD — アーキテクチャ正本（Claude=総指揮・監査 / Codex・Grok=実装）

2〜4人マルチ（欠員BOT補充）の **カード×ボード×RPG**。ブロック世界の分岐マップを
カードで移動し、モンスターとカードバトル、レベルアップでデッキ構築、
**3つのレリック祠の守護者を倒して中央ポータルの最終守護者を制した者が勝ち**。

## 不変の原則（実装者はこれを破ったら失格）
1. `engine/` は **純粋リデューサ**。`Date.now` / `Math.random` / DOM / import three 禁止。
   乱数は必ず注入された `Rng`。同じ (seed, intent列) → 同じ結果。
2. `types.ts` / `protocol.ts` は Claude 所有。**変更禁止**（不満は報告書で提案）。
3. 隠匿情報（手札・山札順）はホストのみが知る。ゲストへは `StateView` でフィルタ。
4. 描画はイベント駆動（状態変化時のみ）。常時rAFループ禁止（短いtweenのみ可）。
5. UI文言は日本語、カード名はEN+日本語サブ。見た目はトイブリック言語
   （スタッド・光沢プラ・パレット #c91a09/#0055bf/#f2cd37/#4b9f4a/#f4f4f4・紫可）。
6. spark/horrorEngine を import しない。three も不要（盤面はCanvas 2D）。

## ゲームルール（確定仕様）
- 席は4固定。人間が埋まらない席は BOT。ターン制（seat順ラウンド）。
- **ターン**: 開始時 手札5枚まで補充・energy=3・moves=0 →
  カードプレイ（energy消費）と移動（moves消費・隣接ノードへ）を任意回 → endTurn。
- **ノード効果（進入時に強制発火）**: monster/elite/shrine=戦闘開始、event=イベント抽選(tier)、
  shop=購買可能状態、camp=rest可能+visitedCampsに記録、trap(他人の罠)=ダメージ後解除。
- **戦闘**（当該プレイヤーのみ・他席は観戦）: ラウンド毎 energy=3・手札補充5。
  attack/skillカードをプレイ → `combatEnd` でモンスター行動（intent事前公開）。
  block はそのラウンドのみ。flee=被intentダメージの半分を受け直前ノードへ。
  勝利: XP/gold/loot。**死亡**: 最寄りvisitedCamp(無ければstart)で全回復・gold半減・deaths+1。
- **レベル**: xp >= level*8 で level+1（最大5）・maxHp+4・全回復・
  `levelChoices[level-2]` の3枚から1枚選びdiscardへ（pendingChoice=levelup）。
- **shrine守護者**(3体) 撃破で relic 獲得（shrineIndexが揃うと中央portal解禁）。
  倒された祠は再挑戦可（他プレイヤーも各自撃破する必要がある＝レース）。
- **portal**: relics 3つ所持者のみ進入可 → final守護者戦 → 勝てば winner=seat。
- **roundLimit=40** で sudden death: relics数 → level(降順) → xp(降順) → gold(降順)
  → 同点なら**席番号が大きい方**（後手番補償）。level+xpの合算は禁止（レベルアップで
  残xpがリセットされ進行が非単調になるため — レビュー裁定 2026-07-23）。
- **rest はenergy 2消費**（実質1ターン1回）: 40%回復＋呪い1枚除去。
- **scry n**: 山札の上n枚を確認し、その中の呪いを山札の底へ送る（他は順序維持）。
- 対人直接戦闘なし。妨害は curse カード（`curseGive`）と `trapNode` のみ。

## バランス封筒（Grokのコンテンツ・Codexのチューニングはこの範囲内）
| 対象 | HP | ATK | armor | XP | gold |
|---|---|---|---|---|---|
| tier1 monster | 8–14 | 2–4 | 0–1 | 3–5 | 4–8 |
| tier2 monster | 16–26 | 4–7 | 0–2 | 6–9 | 8–14 |
| tier3 monster | 28–42 | 7–10 | 1–3 | 10–14 | 12–20 |
| elite | tier表の×1.5 | +1 | +1 | ×1.5 | ×1.5 |
| shrine守護 | 40–55 | 8–11 | 2 | 15 | 20 |
| final守護 | 70–85 | 11–13 | 2–3 | — | — |

カード: energy1=基準値(dmg5 / block5 / move2 / draw1相当)。energy2≒×2.2、energy3≒×3.5。
rarity↑は数値でなく**効果の面白さ**を上げる（コンボ・条件付き大効果）。
クラスHP: knight 32 / cleric 26 / rogue 24 / mage 20。

## モジュール分担
```
engine/types.ts    ← Claude（済・変更禁止）
engine/rng.ts      ← Claude（済）
net/protocol.ts    ← Claude（済・変更禁止）
engine/board.ts    ← Codex C1: generateBoard(seed): Board
engine/effects.ts  ← Codex C1/C2: 効果インタープリタ
engine/engine.ts   ← Codex C1/C2: createGame/applyIntent/legalIntents
engine/bot.ts      ← Codex C3: chooseIntent(content,state,seat): Intent
engine/selftest.ts ← Codex C3: node実行・BOT4体×20シード完走がゲート
content/*.ts       ← Grok G1: cards/monsters/classes/events（スキーマ厳守）
content/index.ts   ← Grok G1: buildContent(): Content（全登録＋整合チェック関数）
net/wire.ts        ← Codex C4: BroadcastChannelWire（同一端末2タブ用）
net/peer.ts        ← Codex C4: PeerJSWire（src/td/net の実装パターンを踏襲）
net/session.ts     ← Codex C4: ホストループ（intent検証→engine→view配信）＋ゲスト
render/board.ts    ← Codex C5: Canvas盤面（イベント駆動draw(state, view)）
ui/*.tsx, App.tsx  ← Codex C5 + Claude統合
```

## board.ts 仕様（C1）
- ノード約40。中心(0.5,0.5)に portal。半径帯: tier1(外周r≈0.42)→tier2(r≈0.30)→tier3(r≈0.18)。
- start 1個（外周、4人共通スポーン）。shrine 3個は tier3 帯で角度等間隔（±15°ジッタ）。
- 分布目安: monster 14 / event 7 / shop 3 / camp 4 / elite 3 / path 残り。
- 各ノード edges 2–4。**連結保証**必須（start から全ノード到達）。交差辺は最小化（角度ソートで隣接接続）。
- 座標は[0,1]²。同一seedで完全再現。

## 受け入れゲート（Claudeが監査で実行）
- G-A: `npx tsx src/quest/engine/selftest.ts` — 20シード×BOT4で全ゲーム
  roundLimit内に決着・不正intentゼロ・例外ゼロ・勝者分布が1席独占でない(各席≧2勝)。
- G-B: `npm run build` 緑・landing隔離不変（three/spark非import）。
- G-C: 2タブ×BroadcastChannelWireで人間1+BOT3のゲーム進行（intent往復・view反映）。
- G-D: 敵対的レビュー（Claude艦隊）＋Grok/Codex相互レビュー。
- G-E: カバー生成（Codex imagegen・brandless studs）→ works.ts 登録 → デプロイ。
