# ASSET_SPEC — アート仕様 ＆ 発注リスト（🎨 アート班 / 友人・Codex 向け）

このファイル通りに画像を作って **`assets/sprites/`** に入れてください。
仕様を固定しておけば、エンジン班を待たずにどんどん量産できます。

---

## 🧱 共通仕様（全アセット共通）

- **基準グリッド: 32 × 32 px**（タイル・キャラの基本単位）
  - キャラが大きい場合は 32×48 などでもOK。ただし**そのファイルの実寸をこの表に必ず明記**して統一する
- **形式: PNG / 透過背景 必須 / ピクセルくっきり**
  - アンチエイリアス無し（ニアレストネイバー）。輪郭をぼかさない
- **画風: レトロ・ピクセルアート**
  - 限定パレット（8〜16色程度）／暗めネオン／サイト世界観に合わせる
- **オリジナルのみ**：任天堂等の既存キャラの流用は **NG**（公開サイトのため）。Codex生成なら全部オリジナルになるので問題なし
- キャラは**足元をグリッド下端に**揃える。余白は透過

### 🎨 パレット（統一の目安）
| 用途 | 色 |
|---|---|
| 背景・暗部 | `#04060b`（ほぼ黒） |
| 明部・主線 | `#eaf4f2` |
| アクセント1 | teal `#33e7c8` |
| アクセント2 | violet `#7b4dff` |
| 危険物（警告色） | red `#ff3b5c` |

---

## 🏷 命名規則

`種別_名前[_状態].png`

例: `player_run.png` / `tile_ground.png` / `hazard_spike.png` / `boss_01_idle.png`

## 🎞 スプライトシート（アニメするもの）

- 1動作 = **横1列**に等間隔でフレームを並べる（左→右）
- 1フレーム = 基準サイズ（例 32×32）。全フレーム同じサイズ
- コマ数の目安: `idle=2` / `run=6` / `jump=2` / `dead=4`

---

## 📋 発注リスト（優先度順）

> Codexへの渡し方: 各行の「プロンプト例」をベースに生成 → 透過・等倍ピクセルで書き出し → `assets/sprites/` に正しいファイル名で保存。

### ▶ 最優先 ＝ MVP（これだけで遊べる）

| ファイル名 | 内容 | 実寸 / コマ | Codexプロンプト例 |
|---|---|---|---|
| `player_idle.png` | 主人公・待機 | 32×32 / 2 | pixel art, small original hero idle, transparent background, 32x32, retro limited palette, crisp pixels, no anti-aliasing, 2-frame sprite sheet horizontal |
| `player_run.png` | 主人公・走り | 32×32 / 6 | …running cycle, 6-frame sprite sheet horizontal |
| `player_jump.png` | 主人公・ジャンプ | 32×32 / 2 | …jump pose (up / fall), 2 frames |
| `player_dead.png` | 主人公・死亡（赤く爆散） | 32×32 / 4 | …bursting into red particles death animation, 4 frames |
| `tile_ground.png` | 地面タイル（**継ぎ目なし**） | 32×32 / 1 | seamless tileable ground block, dark metal, retro pixel, 32x32 |
| `tile_wall.png` | 壁タイル（継ぎ目なし） | 32×32 / 1 | seamless tileable wall block |
| `hazard_spike.png` | トゲ（即死） | 32×32 / 1 | red warning spikes pointing up, danger, pixel art, transparent bg, 32x32 |
| `savepoint.png` | セーブポイント（きらめく） | 32×32 / 4 | glowing teal save crystal with sparkle, 4-frame animation |
| `bg_stage1.png` | ステージ1背景 | 960×540 / 1 | dark nebula parallax background, subtle teal/violet, low contrast |

### ▶ 次 ＝ ステージを面白くする

| ファイル名 | 内容 | 実寸 / コマ | メモ |
|---|---|---|---|
| `hazard_saw.png` | 回転ノコギリ | 32×32 / 4 | spinning saw blade |
| `hazard_block_fall.png` | 落下ブロック | 32×32 / 1 | 上から降ってくる即死ブロック |
| `hazard_bullet.png` | 弾 | 16×16 / 1 | small glowing projectile |
| `enemy_01.png` | ザコ敵 | 32×32 / 4 | 歩行アニメ |
| `spring.png` | ジャンプ台 | 32×32 / 2 | 通常 / 縮み |
| `door_goal.png` | ゴール扉 | 32×48 / 1 | クリア地点 |

### ▶ ボス・演出（後回しでOK）

| ファイル名 | 内容 | 実寸 / コマ | メモ |
|---|---|---|---|
| `boss_01_idle.png` / `_attack.png` / `_dead.png` | ボス | 64×64〜 / 各複数 | original neon monster boss |
| `title_logo.png` | タイトルロゴ | 横長 | neon title "I WANNA BE THE SIGNAL" |
| `fx_explosion.png` | 爆発エフェクト | 32×32 / 6 | |
| `fx_hit.png` | 被弾エフェクト | 32×32 / 3 | |

---

## 📦 納品のしかた（アート班）

1. 上の**ファイル名どおり**に PNG を `assets/sprites/` に置く
2. 公開:
   ```bash
   git pull
   git add assets/sprites/<ファイル名>.png
   git commit -m "art: add <ファイル名>"
   git push
   ```
3. README.md の TODO にチェックを入れる
4. サイズ・コマ数を変えた場合は、この表の該当行を更新して push（コード班が読み込み側を合わせる）

> 困ったら README.md の「役割分担」を見るか、エンジン班に連絡。
