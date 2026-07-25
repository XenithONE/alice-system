# SCRAP CROWN — アーキテクチャ正本（Claude=総指揮・監査 / Codex・Grok=実装）

2〜4人マルチの **物理演算ラジコン・バトルロボット**。BATTLEBOTS 方式：
プレイヤーは**パーツを組み合わせて自機を製作**し、金網アリーナで戦わせる。
勝敗は **KO（相手を動けなくする／ピットに落とす）**、時間切れなら**ジャッジ判定**。

見た目はサイトの**トイブリック言語**を踏襲しつつ、**傷だらけの工業機械**として扱う
（艶消し金属・削れた塗装・火花・曲がった装甲）。子供っぽくしない。

---

## 不変の原則（実装者はこれを破ったら失格）

1. **`sim/` は three.js と DOM を import しない。** rapier と `types.ts` のみ。
   Node で `npx tsx` から直接動くこと（これが検収ゲートの前提）。
2. **物理を回すのはホストだけ。** ゲストは一切 `world.step()` を呼ばない。
   同期は**スナップショット複製**。決定論は**前提にしない**（＝lockstep 禁止）。
3. `sim/types.ts` / `net/protocol.ts` は **Claude 所有・変更禁止**。
   不満は報告書で提案する（勝手に型を変えたら統合できない）。
4. **`Math.random` / `Date.now` を sim 内で呼ばない。** 乱数は注入された `Rng`、
   時間は引数の `dt` と `tick`。リプレイと自己テストが壊れる。
5. **数値は `parts/catalog.ts` と `sim/balance.ts` に集約。** ロジック中に
   マジックナンバーを散らさない（バランス調整が不可能になる）。
6. ゲストの申告を**信用しない**。`BotSpec` は必ずホストが `validateBuild()` で検証。
7. `spark` / `horrorEngine` を import しない。**rapier はこのページ専用チャンク**に
   閉じ込める（ポートフォリオの初回ロードに絶対に混ぜない）。

---

## 単位系（これを守らないと物理が破綻する）

| 量 | 単位 | 基準値 |
|---|---|---|
| 長さ | m | アリーナ床 16×16、壁高 2.4、ピット径 2.2 |
| 質量 | kg | 機体上限 **120kg**（＝ヘビー級。これが唯一の製作予算） |
| 時間 | s | 固定ステップ **1/60**、試合 **180s** |
| グリッド | cell | **1 cell = 0.12m**。パーツ寸法は必ず cell の整数倍 |

機体は 0.6〜1.2m 角。重力 −9.81。

---

## ゲームルール（確定仕様）

- 席は4固定。人間が埋まらない席は **AI**。全員同時プレイ（ターン制ではない）。
- 開始配置：16m アリーナの四隅寄り、中心を向く。カウントダウン3秒。
- **操作**: `throttle`(-1..1) / `steer`(-1..1) / `weapon`(押している間 加速) /
  `selfRight`(反転復帰。クールダウン8s、`hasSelfRight` パーツ必須)。
- **KO条件**（いずれかで敗退）
  - `chassisHp <= 0`
  - **immobile 10秒**（速度 < 0.15 m/s かつ 武器角速度 < 1 rad/s が継続）
  - **ピット落下**（y < -1.5）
- **時間切れ = ジャッジ判定**（BATTLEBOTS 準拠 合計10点）
  - Damage 5点：与ダメージ総量のシェア
  - Aggression 3点：相手方向への移動距離＋接触回数のシェア
  - Control 2点：相手を壁/ピットへ押した時間のシェア
- 同点は **与ダメージ総量 → 残 chassisHp → 席番号が小さい方**。

---

## 製作ルール（ビルダー）

- **予算は質量のみ**：合計 ≤ 120kg。パーツ質量がそのまま物理質量になる。
- シャーシは3種（light/medium/heavy）。**デッキは cell グリッド**で、
  パーツは footprint 分のセルを占有し、90°刻みで回転して載る。
- **成立条件**（`validateBuild` が全部チェック。1つでも欠けたら出撃不可）
  1. 駆動パーツ **2個以上**（左右対称でなくてもよいが片側0はNG）
  2. 武器は **0個か1個**（複数武器は v1 では非対応）
  3. 全パーツがデッキ内に収まり、**セルの重複がない**
  4. 合計質量 ≤ 120kg かつ シャーシ必須
  5. 重心が接地多角形の内側（極端な前後偏重を弾く）
- 保存は localStorage、共有は **BotSpec を base64url 化した1行コード**。

---

## バランス封筒（Grok のカタログ・Codex のチューニングはこの範囲内）

| 分類 | 質量 kg | HP | 主要数値 |
|---|---|---|---|
| chassis light | 18–24 | 260–320 | deck 5×7 cell |
| chassis medium | 28–36 | 340–420 | deck 7×9 cell |
| chassis heavy | 40–52 | 460–560 | deck 9×11 cell |
| wheel 小/中/大 | 3–5 / 6–9 / 10–14 | 40–90 | torque 18–70 N·m, μ 0.9–1.4 |
| track（履帯） | 14–18 | 120 | torque 55, μ 1.6, 最高速 低 |
| spinner disc | 22–34 | 150–220 | ω_max 180–260 rad/s, I 0.5–1.1, dmgMul 2.2–3.0 |
| drum spinner | 26–38 | 200–280 | ω_max 120–170, I 1.2–2.0, dmgMul 1.8–2.4 |
| flipper | 20–30 | 180–240 | 力積 900–1500 N·s, cd 2.5s |
| hammer | 16–26 | 160–220 | 力積 500–900 N·s, cd 1.6s |
| saw | 10–16 | 90–130 | ω_max 300, dmgMul 1.1, 継続ダメージ寄り |
| wedge（受け） | 8–16 | 220–300 | dmgMul 0.3, 相手を浮かせる |
| armor plate | 6–14 | 200–340 | armor 12–28 |

**設計意図**：spinner は一撃が重いが**自傷**する（反作用ダメージ25%）。
flipper は damage を稼げないが **control/aggression と ピット落とし**が強い。
wedge は damage を通しにくいが**耐久で判定勝ち**を狙える。3すくみを壊さないこと。

---

## ダメージモデル（Codex はこの式を実装する）

```
接触ごとに rapier の ContactForceEvent から総力積 J [N·s] を得る
attackFactor = 武器なら dmgMul * (0.25 + 0.75 * |ω| / ω_max)   ← 回転が乗っていないと痛くない
             = 非武器なら 0.35
raw    = J * attackFactor * IMPACT_SCALE
damage = max(0, raw - defenderPart.armor)
被弾パーツ = 接触コライダーが属するパーツ（chassis なら chassisHp）
パーツ hp <= 0 → ジョイント破棄しデブリ化（chassis から collider を除去）
武器側にも raw * 0.25 の自傷（wedge/armor は自傷なし）
```

**必須のガード**：1接触あたりのダメージ上限、同一ペアの連続接触は
`CONTACT_COOLDOWN` 秒でクランプ（フレーム跨ぎの多重計上でHPが即溶けるのを防ぐ）。

---

## ネットワーク（ホスト権威スナップショット・決定論なし）

```
ホスト: 60Hz で world.step() → 20Hz で Snapshot 配信
ゲスト: 30Hz で InputFrame 送信 / 受信スナップショットを 100ms バッファで補間
```

- ゲストは**自機も補間表示**（v1 は予測なし）。ホストは遅延ゼロなので、
  人間が2人以上なら**ホストが有利**である旨をロビーに明記する。
- Snapshot は毎回**全機フル状態**（差分圧縮なし）。4機で ~250B/回・20Hz＝5KB/s。
- 通信は `net/wire.ts` の `Wire` 抽象越し。実装は **PeerJS**（本番）と
  **BroadcastChannel**（同一端末2タブ検証）の2つ。`src/quest/net/` から移植する。

---

## モジュール分担

```
ARCHITECTURE.md      ← Claude（本書）
sim/types.ts         ← Claude（済・変更禁止）
net/protocol.ts      ← Claude（済・変更禁止）
sim/balance.ts       ← Claude（済・定数の唯一の置き場）
sim/rng.ts           ← Claude（済）

parts/catalog.ts     ← Grok G1: 全パーツ数値＋プリセット機体4体
sim/assemble.ts      ← Codex C1: BotSpec → rapier 剛体/ジョイント/コライダー
sim/world.ts         ← Codex C1: アリーナ・ハザード・固定ステップ・step()
sim/damage.ts        ← Codex C2: 接触→ダメージ→脱落→KO/ピット/ジャッジ集計
sim/driver.ts        ← Codex C2: 入力→モーター（駆動・操舵・武器・セルフライト）
sim/ai.ts            ← Codex C3: AI（追跡/武器スピンアップ/ピット誘導/逃走）
sim/headless.ts      ← Codex C3: node 実行のセルフテスト（検収ゲート）
builder/*            ← Codex C4: グリッド編集・検証・ステータス・保存/共有
render/*             ← Codex C5: three.js アリーナ/機体/火花/破片/カメラ
net/{wire,peer,session}.ts ← Codex C6: quest から移植＋ホストループ
ui/*.tsx, App.tsx    ← Codex C6 + Claude 統合
scrap-crown.html / vite入口 / works.ts ← Claude
```

---

## 受け入れゲート（Claude が監査で実行。自己申告の「PASS」は信用しない）

- **G-A** `npx tsx src/arena/sim/headless.ts` — 20シード × AI4機で
  - 全試合が 200s 以内に決着、例外ゼロ、NaN ゼロ
  - 勝者が1席独占でない（各席 ≧2勝）
  - **KO決着が 8試合以上**（判定ばかり＝ダメージが機能していない証拠）
  - **パーツ脱落が通算 15回以上**（脱落が0＝ダメージモデルが死んでいる）
  - 平均 step 時間 < 4ms（60Hz に間に合う）
- **G-B** `npm run build` 緑 ＋ **rapier がポートフォリオ入口のチャンクに混入しない**
- **G-C** 2タブ BroadcastChannel で 人間1＋AI3 の試合が成立
  （入力往復・スナップショット反映・結果一致）
- **G-D** 敵対的レビュー（Claude艦隊＋Grok/Codex 相互）で confirmed 修正
- **G-E** カバー生成 → `works.ts` 登録 → デプロイ → ライブ実測
