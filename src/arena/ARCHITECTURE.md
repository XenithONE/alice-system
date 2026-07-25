# SCRAP CROWN — アーキテクチャ正本 v2（Claude=総指揮・監査 / Codex・Grok=実装）

2〜4人マルチの **物理演算ロボット競技**。BATTLEBOTS 方式：
プレイヤーは**パーツを購入して自分の機体を設計**し、金網アリーナで戦わせる。
勝敗は **KO（相手を動けなくする／ピットに落とす／燃やす）**、時間切れなら**ジャッジ判定**。

## 見た目の方針（v2で転換）

**このゲームはサイト本体のトイブリック言語を使わない。** ユーザーの明示指示。
狙うのは**実在の競技ロボット**：溶接された鋼板、チタン、削り出しの金属地、
ボルトとリベットの列、油圧シリンダ、チェーンガード、露出した配線。
塗装は剥がれ、角はへこみ、金属は焼けている。丸くて可愛いフォルムは作らない。
スタッド（円柱の突起）は**一切登場させない**。

---

## 不変の原則（実装者はこれを破ったら失格）

1. **`sim/` は three.js と DOM を import しない。** rapier と `types.ts` のみ。
   Node で直接動くこと（これが検収ゲートの前提）。
2. **物理を回すのはホストだけ。** ゲストは一切 `world.step()` を呼ばない。
   同期は**スナップショット複製**。決定論は**前提にしない**（＝lockstep 禁止）。
3. `sim/types.ts` / `net/protocol.ts` は **Claude 所有・変更禁止**。
4. **`Math.random` / `Date.now` を sim 内で呼ばない。**
5. **数値は `parts/catalog.ts` と `sim/balance.ts` に集約。**
6. ゲストの申告を**信用しない**。`BotSpec` は必ずホストが `validateBuild()` で検証。
7. **ロボットは自分自身と衝突しない**（`botCollisionGroups`）。
   これを外すと自機の車輪が武器と噛み合って**走行不能になる**（v1で実際に起きた）。
8. `spark` を import しない。**rapier はこのページ専用チャンク**に閉じ込める。

---

## 単位系

| 量 | 単位 | 基準値 |
|---|---|---|
| 長さ | m | アリーナ床 16×16、壁高 2.4、ピットは正方形の穴 |
| 質量 | kg | 物理量。**予算ではない** |
| **予算** | point | 部屋ごとにホストが 600/1000/1500/2200 から選ぶ |
| 時間 | s | 固定ステップ **1/60**、試合 **180s** |
| グリッド | cell | **1 cell = 0.12m** |

⭐**cost と mass を独立に設計する**こと。「安くて重い鋼板」対「高くて軽いチタン」が
成立しないと、ポイント制にした意味がない。

---

## ゲームルール

- 席は4固定。人間が埋まらない席は **AI**。全員同時プレイ。
- **操作**: `throttle`(-1..1) / `steer`(-1..1) / **`primary`(Space)** / **`secondary`(Shift)** /
  `selfRight`(R・要 srimech パーツ・クールダウン8s)。
- **KO条件**: `chassisHp <= 0` ／ **immobile 10秒** ／ **ピット落下** ／ **炎上死**
- **時間切れ = ジャッジ判定**（合計10点）: Damage 5 / Aggression 3 / Control 2
- 同点は **与ダメージ総量 → 残 chassisHp → 席番号が小さい方**。

---

## 製作ルール

- **予算はポイントのみ**。合計 `cost` ≤ `RoomSettings.pointBudget`。
- **武装は最大2基**：`slot:"primary"` を1つまで、`slot:"secondary"` を1つまで。
- 成立条件（`validateBuild` が全部チェック）
  1. 駆動パーツ **2個以上**（片側0はNG）
  2. 武装は各スロット最大1
  3. 全パーツがデッキ内に収まり、**セルの重複がない**
  4. `cost` 合計が予算以内、シャーシ必須
- 保存は localStorage、共有は BotSpec を base64url 化した1行コード。

---

## 武装の作動方式（v2の中核）

| `action` | 挙動 | 例 |
|---|---|---|
| `passive` | 試合開始から常時稼働。ボタン不要 | サイドソー、シェルスピナー |
| `held` | 押している間だけ。`fuel` を消費し、切れたら `DRY_LOCKOUT` 秒使用不可 | 火炎放射器、カッティングディスク |
| `triggered` | 一発＋`cooldown`。`MIN_TRIGGER_GAP` 未満の連打は無視 | フリッパー、スピア、アックス、クラッシャー |

## ダメージモデル（効果別）

| `effect` | 計算 |
|---|---|
| `spin` | 接触力積 × `damageMul` ×（`SPIN_DAMAGE_FLOOR` + (1-floor)×\|ω\|/maxOmega）。回転が乗っていないと痛くない |
| `grind` | 接触継続中、`SUSTAINED_TICK` 秒ごとに `dps × SUSTAINED_TICK` |
| `clamp` | 掴んでいる間 `dps` を与え続け、相手の移動を強く妨げる。`CLAMP_BREAK_IMPULSE` 超で解除 |
| `flame` | コーン内の敵に `dps`。**装甲は `FLAME_ARMOR_FACTOR` 倍しか効かない**。命中で `BURN_SEC` 秒 `BURN_DPS` の延焼 |
| `impulse` | 接触した相手へ `impulse` [N·s] を直接付与（フリッパーは上向き成分を強く）。スピアは `SPEAR_PIERCE` 倍 |
| `static` | `damageMul` が低い。勝ち筋は幾何（潜り込み）と耐久 |

**必須のガード**: `MIN_HIT_IMPULSE` 未満は無視 ／ 1接触は `MAX_HIT_DAMAGE` でクランプ ／
同一ペアは `CONTACT_COOLDOWN` 秒に1回 ／ 武器側の自傷は `selfDamageMul`。
装甲パーツの `spinnerResist` / `flameResist` を適用する。

**`impulse` 実装の禁止事項**: v1 は位置モーターとトルク力積の**二重駆動**で、
ゲインを `dt` で割って60倍に膨らませていた。腕が発散して自機を場外へ投げ飛ばした。
**駆動は一系統に統一**し、相手を飛ばすのは接触時に相手へ与える力積で表現する。

---

## ネットワーク（ホスト権威スナップショット・決定論なし）

```
ホスト: 60Hz で world.step() → 20Hz で Snapshot 配信
ゲスト: 30Hz で InputFrame 送信 / 受信スナップショットを 100ms バッファで補間
```

- ゲストは自機も補間表示（予測なし）。ホストが遅延ゼロで有利である旨をロビーに明記。
- `RoomSettings` は `welcome` / `lobby` / `start` に載る。**変更はホストのみ**。
  予算を変えたら**全員の ready を解除**する（古い予算の機体が通ってしまうため）。
- 通信は `Wire` 抽象越し。PeerJS（本番）と BroadcastChannel（2タブ検証）。

---

## 受け入れゲート（Claudeが監査で実行。自己申告の「PASS」は信用しない）

⭐**v1 の教訓**: 20試合ゲートは「ロボットが走れない」「戦闘が止まる」の2件が
**両方生きたまま全項目PASSした**。ゲートは「試合が終わるか」しか見ておらず、
**ロボットが動けるかを一度も測っていなかった**。以下は全て必須。

- **G-A 戦闘** `npx tsx src/arena/sim/headless.ts`
  - 20試合完走 / 例外0 / NaN 0 / 各席 ≧2勝 / **KO決着 ≧10** / 脱落 ≧15 / 平均step < 4ms
  - ⭐**武装カバレッジ**: `spin` `grind` `impulse` `clamp` `flame` の**5効果すべて**が
    通算ダメージ > 0。`triggeredFires > 0`、`clampHolds > 0`
- **G-B 移動** `npx tsx src/arena/sim/driveSelftest.ts`
  - 全プリセットが**ビルダー表示速度の7割以上**を実測で出す
- **G-C 製作** `npx tsx src/arena/sim/buildSelftest.ts`
  - 予算超過・セル重複・デッキ外・駆動不足・同スロット2個・不明IDを全て拒否
- **G-D ビルド** `npm run build` 緑 ＋ rapier がポートフォリオ入口に混入しない
- **G-E 対戦** 2タブ BroadcastChannel で人間1＋AI3が成立
- **G-F 外観** `brickKit` 参照0件・スタッド生成0件（grep で証明）
- **G-G** 敵対的レビュー → カバー差し替え → `works.ts` 登録 → デプロイ → ライブ実測
