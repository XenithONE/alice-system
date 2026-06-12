# iwbtg-clone（仮タイトル: "I WANNA BE THE SIGNAL"）— 共同開発メモ

「I Wanna Be The Guy」風の**即死トラップ系2Dアクション**（ブラウザ / HTML + JS）。
このフォルダ1つで完結し、公開先は → https://xenithone.github.io/alice-system/games/iwbtg/

> 📌 **はじめに読むファイル**: この README（全体像・分担・ルール）と [ASSET_SPEC.md](ASSET_SPEC.md)（絵の仕様・発注リスト）。

---

## 👥 役割分担

### 🎨 アート班 — 担当: 友人（Codex）
- キャラ / タイル / 罠 / 敵・ボス / 背景 / UI / エフェクト の**画像生成**
- 触るのは **`assets/` の中だけ**
- 仕様・命名・サイズは **[ASSET_SPEC.md](ASSET_SPEC.md)** に従う
- 「何を作るか」の**発注リスト**も ASSET_SPEC.md にある（優先度順・Codex用プロンプト例つき）

### ⚙️ エンジン班 — 担当: XenithONE + Claude
- ゲーム本体のコード（物理・当たり判定・**即死＆リスポーン**・セーブ・ボスAI）
- 触るのは **`index.html` / `engine.js` / `levels/*.json`**
- アートが届くまでは **「仮の四角」** で動かしておき、絵が来たら差し替えるだけ

### 🗺 レベルデザイン — 2人で分担
- 1ステージ = **`levels/levelN.json`**（ただのデータ）。1ファイル1ステージなので**競合しない**
- 「ステージ1=XenithONE、ステージ2=友人」のように割り振る

---

## 📁 フォルダ構成

```
games/iwbtg/
├─ index.html       … エンジン班（ゲーム起動HTML）
├─ engine.js        … エンジン班（ゲームロジック）
├─ levels/          … レベルデザイン（JSON・分担）
│   └─ level1.json
├─ assets/
│   ├─ sprites/     … アート班（画像をここに入れる）
│   └─ audio/       … アート班（BGM/SE）
├─ README.md        … このファイル（全体像・分担）
└─ ASSET_SPEC.md    … 絵の仕様 ＆ 発注リスト
```

👉 **アート班は `assets/` だけ・コード班は `*.js` だけ**を触る。別ファイルなので **Gitの競合がほぼ起きない**。これが2人開発の理想形。

---

## 🔒 競合しないためのルール（重要）

- **作業を始める前と push する前に、必ず `git pull`**
- push が弾かれたら（相手が先に push 済み）:
  ```bash
  git pull --rebase
  git push
  ```
- 1コミットは小さく、メッセージは具体的に。先頭に種別を付けると分かりやすい:
  - `art: add player_run sprite`
  - `engine: add double jump`
  - `level: stage1 first draft`
- `index.html` の設定配列など**2人が同じ箇所を同時に編集すると競合**しやすい。編集前に pull、終わったらすぐ push ＆ 連絡。

---

## 🎯 MVP（まず最小で動かす）

この4つが動けば「ゲーム」として成立 → そこから増やす:
1. プレイヤーが **歩く・ジャンプ・2段ジャンプ**
2. **スパイクに当たると即死**
3. **セーブポイントから復活**
4. ステージ1の**ゴールでクリア**

**MVPに必要な最小アセット**（アート班・最優先 → 詳細は ASSET_SPEC.md）:
`player_idle` / `player_run` / `player_jump` / `player_dead` /
`tile_ground` / `hazard_spike` / `savepoint` / `bg_stage1`

> エンジン班はこれらを待たず、仮の四角で MVP ループを先に完成させてOK。

---

## 🌐 公開のしかた（共通）

```bash
git pull
git add <変更したファイル>
git commit -m "種別: 内容"
git push
```
→ 約1分後に https://xenithone.github.io/alice-system/games/iwbtg/ に反映。
⚠️ このサイトは**全世界に公開**。push した内容は誰でも見られます。

トップページの GAMES 欄に**カードとして並べる**には、最後に `../../index.html` の
`GAMES` 配列に1行登録する（エンジン班が担当・完成が近づいたら）。

---

## ✅ 進捗 / TODO

- [x] リポジトリ準備・役割分担メモ（この README）
- [x] 絵の仕様＆発注リスト（ASSET_SPEC.md）
- [ ] 【アート班】MVP最小アセットを生成して `assets/sprites/` へ
- [ ] 【エンジン班】最小ループ（移動・2段ジャンプ・即死・セーブ復活）を scaffold
- [ ] 【分担】ステージ1のレベルデータ `levels/level1.json`
- [ ] アート差し替え → トップの GAMES に登録 → 公開
