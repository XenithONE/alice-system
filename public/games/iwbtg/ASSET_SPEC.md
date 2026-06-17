# ASSET_SPEC

`games/iwbtg/` 用の絵の仕様と発注リストです。  
作った画像は基本的に `assets/sprites/` に入れてください。音素材は `assets/audio/` に入れます。

## 共通仕様

- 形式: PNG
- 背景: 透明
- 画風: レトロなピクセルアート
- 基準サイズ: 32 x 32 px
- アンチエイリアスなし
- パレット: 暗い背景に、teal / violet / red のアクセント
- 既存ゲーム、既存キャラクター、既存素材の流用は禁止

推奨カラー:

| 用途 | 色 |
|---|---|
| 背景・影 | `#04060b` |
| 明部 | `#eaf4f2` |
| アクセント1 | `#33e7c8` |
| アクセント2 | `#7b4dff` |
| 危険物 | `#ff3b5c` |

## 命名ルール

```text
種類_名前[_状態].png
```

例:

- `player_idle.png`
- `player_run.png`
- `tile_ground.png`
- `hazard_spike.png`
- `boss_01_idle.png`

## スプライトシート

- 横一列にフレームを並べる
- 1フレームのサイズは原則 32 x 32 px
- 例: 6フレームの走りアニメは 192 x 32 px
- 全フレームのサイズを揃える

## 優先度A: MVP必須

| ファイル名 | 内容 | サイズ / フレーム | Codex用プロンプト例 |
|---|---|---:|---|
| `player_idle.png` | 主人公の待機 | 64 x 32 / 2 | original tiny neon runner hero, idle animation, 2-frame horizontal sprite sheet, transparent background, 32x32 per frame, crisp retro pixel art, limited palette |
| `player_run.png` | 主人公の走り | 192 x 32 / 6 | original tiny neon runner hero, running cycle, 6-frame horizontal sprite sheet, transparent background, 32x32 per frame, crisp retro pixel art |
| `player_jump.png` | 主人公のジャンプ | 64 x 32 / 2 | original tiny neon runner hero, jump and fall poses, 2-frame horizontal sprite sheet, transparent background, crisp retro pixel art |
| `player_dead.png` | 主人公の死亡 | 128 x 32 / 4 | original tiny neon runner hero bursting into red particles, death animation, 4-frame horizontal sprite sheet, transparent background |
| `tile_ground.png` | 地面タイル | 32 x 32 / 1 | seamless dark metal ground block, teal edge highlights, 32x32, transparent not needed if tile fills canvas, crisp retro pixel art |
| `tile_wall.png` | 壁タイル | 32 x 32 / 1 | seamless dark wall block, violet shadow, 32x32, crisp retro pixel art |
| `hazard_spike.png` | 即死トゲ | 32 x 32 / 1 | red warning spike trap pointing up, 32x32, transparent background, crisp retro pixel art |
| `savepoint.png` | セーブポイント | 128 x 32 / 4 | glowing teal save crystal, sparkle animation, 4-frame horizontal sprite sheet, transparent background |
| `bg_stage1.png` | ステージ1背景 | 960 x 540 / 1 | dark signal void background, subtle teal and violet nebula, low contrast, pixel art style, no characters |

## 優先度B: ステージを面白くする

| ファイル名 | 内容 | サイズ / フレーム | メモ |
|---|---|---:|---|
| `hazard_saw.png` | 回転ノコギリ | 128 x 32 / 4 | 横一列の回転アニメ |
| `hazard_block_fall.png` | 落下ブロック | 32 x 32 / 1 | 上から落ちる即死ブロック |
| `hazard_bullet.png` | 弾 | 16 x 16 / 1 | 小さい発光弾 |
| `enemy_01.png` | ザコ敵 | 128 x 32 / 4 | 歩行アニメ |
| `spring.png` | ジャンプ台 | 64 x 32 / 2 | 通常 / 縮み |
| `door_goal.png` | ゴール扉 | 32 x 64 / 1 | クリア地点 |

## 優先度C: 後回しでよい

| ファイル名 | 内容 | サイズ / フレーム |
|---|---|---:|
| `boss_01_idle.png` | ボス待機 | 256 x 64 / 4 |
| `boss_01_attack.png` | ボス攻撃 | 384 x 64 / 6 |
| `boss_01_dead.png` | ボス死亡 | 384 x 64 / 6 |
| `title_logo.png` | タイトルロゴ | 横長 |
| `fx_explosion.png` | 爆発エフェクト | 192 x 32 / 6 |
| `fx_hit.png` | ヒットエフェクト | 96 x 32 / 3 |

## 納品チェック

- [ ] 指定ファイル名になっている
- [ ] `assets/sprites/` に置いた
- [ ] 透明背景になっている
- [ ] サイズとフレーム数が表と一致している
- [ ] 既存作品のキャラクターや素材を使っていない
