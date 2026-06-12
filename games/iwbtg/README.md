# iwbtg

仮タイトル: **I WANNA BE THE SIGNAL**

`games/iwbtg/` は、即死トラップ系2Dアクションゲームを共同制作するための作業フォルダです。  
ブラウザで遊べる HTML / JavaScript ゲームとして、最終的に次のURLで公開します。

https://xenithone.github.io/alice-system/games/iwbtg/

## フォルダ構成

```text
games/iwbtg/
├─ index.html     ← ゲーム起動ページ（エンジン担当）
├─ engine.js      ← ゲームロジック（エンジン担当）
├─ levels/        ← ステージデータ。1ファイル = 1ステージ（レベル担当）
│  └─ level1.js
├─ assets/        ← アート素材（アート担当）
│  ├─ sprites/
│  └─ audio/
├─ README.md      ← このファイル（全体像・分担・ルール・TODO）
└─ ASSET_SPEC.md  ← 絵の仕様と発注リスト
```

## 役割分担

### アート担当

- キャラクター、床、壁、トゲ、背景、UI、エフェクトなどの画像を作る
- 画像は `assets/sprites/` に入れる
- 音素材を追加する場合は `assets/audio/` に入れる
- ファイル名、サイズ、優先順位は [ASSET_SPEC.md](ASSET_SPEC.md) に従う
- **置くだけで自動反映**: engine.js は `assets/sprites/` のPNGを自動で読み、
  見つかれば仮図形からスプライトに切り替える（コード変更不要）。
  ゲーム画面右上の表示が `SPRITES: PLACEHOLDER` → `SPRITES: LIVE` になれば成功

### エンジン担当

- `index.html` と `engine.js` を作る
- プレイヤー移動、ジャンプ、即死、リスポーン、セーブポイント、ゴール判定を実装する
- アート素材が未完成の間は仮図形で先に動くものを作る

### レベル担当

- `levels/level1.js` のようにステージデータを作る（1ステージ1ファイル・読み込み順に進行）
- 中身はASCIIマップ（17行固定）＋エンティティ配列。1文字 = 1タイル(32px):

```text
#  = 地形ブロック        ^ v < > = トゲ4方向（即死）
!  = 偽ブロック(触れると消える)  ? = 透明ブロック(常に固体・触ると見える)
*  = 崩落ブロック(乗ると壊れる)  S = セーブ  F = 偽セーブ(即死)
G  = ゴール扉  X = 偽ゴール(即死)  P = スタート  . = 空
```

- エンティティ（entities配列）: `tspike`(トリガー飛行トゲ) / `saw`(ノコギリ) /
  `shooter`(弾タレット) / `fallblock`(落下ブロック) / `platform`(移動足場) / `msg`(トロール文字)。
  書式は既存の levels/level3.js を参照（一番サンプルが多い）
- 作ったら `node levels/validate.mjs` で形式チェックできる
- URLに `?debug` を付けると 1-9キーでステージ移動、Gキーで無敵（テスト用）

## 共同作業ルール

- 作業前とpush前に `git pull` する
- pushが拒否されたら `git pull --rebase` してから再度 `git push`
- 1コミットは小さめにする
- 画像は `assets/`、コードは `index.html` / `engine.js`、レベルは `levels/` に分ける
- 公開サイトなので、既存キャラクターや既存ゲーム素材の流用はしない

## MVP

まずは次の4つが動けばゲームとして成立です。

1. プレイヤーが左右移動できる
2. ジャンプ、できれば2段ジャンプできる
3. トゲや罠に当たると即死してセーブポイントから復活する
4. ステージ1のゴールに着くとクリアになる

→ **エンジン側のMVPは仮図形で実装済み・動作確認済み。すでに遊べます:**
https://xenithone.github.io/alice-system/games/iwbtg/
（操作: ←→ 移動 / Z・SPACE ジャンプ2段 / R リトライ / M ミュート）

MVPに必要な最小アセット:

- `player_idle.png`
- `player_run.png`
- `player_jump.png`
- `player_dead.png`
- `tile_ground.png`
- `hazard_spike.png`
- `savepoint.png`
- `bg_stage1.png`

詳細は [ASSET_SPEC.md](ASSET_SPEC.md) を参照。

## 公開手順

```bash
git pull
git add games/iwbtg
git commit -m "iwbtg: add first playable"
git push
```

GitHub Pages の反映後、次のURLで確認します。

https://xenithone.github.io/alice-system/games/iwbtg/

トップページの Games 欄に出す場合は、ルートの `index.html` にある `GAMES` 配列へ `games/iwbtg/` を登録します。

## TODO

- [x] 共同作業用フォルダを作る / README / ASSET_SPEC
- [x] `index.html` / `engine.js` / 仮図形MVP（動作確認済み）
- [x] エンジンv2: 全16種のギミック（トゲ4方向・偽ブロック・透明ブロック・崩落・
      トリガー飛行トゲ・ノコギリ・弾タレット・落下ブロック・移動足場・偽セーブ・偽ゴール・
      トロールmsg・死亡カウンター・タイマー・グレース・デバッグモード）
- [x] 全4ステージ（FIRST SIGNAL (REMIX) / THE LIE / IRON RAIN / CORE APPROACH）＋ステージ進行
- [x] レベル検証スクリプト `levels/validate.mjs`
- [ ] MVP用アセットを `assets/sprites/` に追加する（優先度A 8枚 → 置くだけで自動反映）
- [ ] 追加スプライト: `hazard_saw` `hazard_bullet` `hazard_block_fall`（優先度B・仕様はASSET_SPEC）
- [ ] 音素材を `assets/audio/` に追加する（今は仮のビープ音）
- [ ] ステージ5以降 / ボス戦（エンジン拡張が必要になったらエンジン班へ）
- [ ] トップページの Games に登録する（アート反映後）
