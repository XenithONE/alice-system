# iwbtg

仮タイトル: **I WANNA BE THE SIGNAL**

`games/iwbtg/` は、即死トラップ系2Dアクションゲームを共同制作するための作業フォルダです。  
ブラウザで遊べる HTML / JavaScript ゲームとして、最終的に次のURLで公開します。

https://xenithone.github.io/alice-system/games/iwbtg/

## フォルダ構成

```text
games/iwbtg/
├─ README.md      ← 全体像・役割分担・ルール・MVP・TODO
├─ ASSET_SPEC.md  ← 絵の仕様＆発注リスト（優先度順・Codex用プロンプト例つき）
├─ assets/        ← 友人が画像を入れる場所（sprites / audio）
│  ├─ sprites/
│  └─ audio/
└─ levels/        ← レベルデータ置き場
```

## 役割分担

### アート担当

- キャラクター、床、壁、トゲ、背景、UI、エフェクトなどの画像を作る
- 画像は `assets/sprites/` に入れる
- 音素材を追加する場合は `assets/audio/` に入れる
- ファイル名、サイズ、優先順位は [ASSET_SPEC.md](ASSET_SPEC.md) に従う

### エンジン担当

- `index.html` と `engine.js` を作る
- プレイヤー移動、ジャンプ、即死、リスポーン、セーブポイント、ゴール判定を実装する
- アート素材が未完成の間は仮図形で先に動くものを作る

### レベル担当

- `levels/level1.json` のようにステージデータを作る
- 1ステージ1ファイルにして、編集範囲がぶつかりにくい形にする
- 最初は短くてよいので、遊べる導線を優先する

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

- [x] 共同作業用フォルダを作る
- [x] READMEを整える
- [x] ASSET_SPECを整える
- [ ] MVP用アセットを `assets/sprites/` に追加する
- [ ] `index.html` を作る
- [ ] `engine.js` を作る
- [ ] `levels/level1.json` を作る
- [ ] 仮図形だけでMVPを動かす
- [ ] アート素材を読み込む
- [ ] トップページの Games に登録する
