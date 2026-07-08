// AI Lab — same-prompt comparisons across AI models.
//
// ── 追加手順（これだけでサイトに表示されます） ─────────────────────────────
// 1. 画像/動画を public/assets/lab/ に置く（例: public/assets/lab/portrait-grok45.jpg）
// 2. 下の COMPARISONS 配列に 1 エントリ追記する:
//      {
//        id: "portrait-2026-07",
//        title: "同一プロンプト・ポートレート生成",
//        prompt: "（使った共通プロンプト全文）",
//        date: "2026-07-12",
//        category: "image",
//        entries: [
//          { model: "Grok 4.5", tool: "Grok", asset: "assets/lab/portrait-grok45.jpg", assetType: "image", notes: "所感" },
//          { model: "GPT-5.6", tool: "ChatGPT", asset: "assets/lab/portrait-gpt56.jpg", assetType: "image" },
//          { model: "Gemini 3.5 Pro", tool: "Gemini", asset: "assets/lab/portrait-gemini35.jpg", assetType: "image" }
//        ]
//      }
// 3. コミット & push → CI が自動デプロイ。コンポーネント側の変更は一切不要。
//    text/code カテゴリなら asset の代わりに text: "出力全文" を使う。
// ────────────────────────────────────────────────────────────────────────

import type { AiTool } from "./works";

export type ComparisonCategory = "image" | "text" | "video" | "code";

export interface ComparisonEntry {
  model: string; // 表示名: "Grok 4.5" / "GPT-5.6" / "Gemini 3.5 Pro" など
  tool: AiTool; // バッジ表示に使うツール名
  asset?: string; // BASE-relative パス（image/video カテゴリ用）
  assetType?: "image" | "video"; // asset を置いたら必須
  text?: string; // text/code カテゴリの生出力
  notes?: string; // 所感・コメント（任意）
}

export interface Comparison {
  id: string;
  title: string;
  prompt: string; // 共通プロンプト（コピー可能ブロックとして表示）
  date: string; // ISO "2026-07-12"
  category: ComparisonCategory;
  entries: ComparisonEntry[]; // 2〜4想定
}

export const COMPARISONS: Comparison[] = [];
