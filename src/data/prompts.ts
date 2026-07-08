// Prompt showcase — curated prompts with copy-to-clipboard.

import type { AiTool } from "./works";

export interface PromptCard {
  id: string;
  title: string; // ja
  tool: AiTool;
  category: "image" | "video" | "code" | "music";
  prompt: string; // full copyable text
  note?: string; // ja: 用途・結果の要約
}

export const PROMPTS: PromptCard[] = [
  {
    id: "cover-art-structured",
    title: "ゲームカバーアート（5見出し構造化）",
    tool: "ChatGPT",
    category: "image",
    prompt: `[Subject]
A lone figure holding a flashlight toward a giant glowing eye in pitch darkness, cosmic horror game key art.

[Style]
Cinematic digital painting, deep blacks with a single teal accent light, film grain, high contrast chiaroscuro.

[Composition]
Low angle, figure small in lower third, the eye dominating the upper frame, strong negative space.

[Details]
Dust motes in the light beam, wet reflective floor, no text, no logo.

[Quality]
Ultra sharp focus on the eye, painterly falloff at the edges, 2:3 portrait aspect.`,
    note: "被写体/画風/構図/細部/品質の5見出しに分けると生成が安定する。ゲームカバー全般に流用可。"
  },
  {
    id: "video-multicut",
    title: "AI動画のマルチカット割り指定",
    tool: "Higgsfield",
    category: "video",
    prompt: `CUT 1 (0-2s): Slow push-in on an abandoned hospital corridor, flickering fluorescent light, handheld camera.
CUT 2 (2-4s): Close-up of a rusted locker door creaking open by itself, dust falling.
CUT 3 (4-7s): POV walking past a broken mirror, a pale face appears in the reflection for 3 frames only.
CUT 4 (7-10s): Wide shot, the corridor lights die one by one toward the camera, hard cut to black.
Genre: horror. Native audio: ambient hum, distant metal creak, sudden silence at the end.`,
    note: "1本の動画に必ずCUT番号で複数カットを列挙する。単一ショット指定より映画的になり破綻も減る。"
  },
  {
    id: "game-design-adversarial",
    title: "ゲーム実装＋敵対的レビューの依頼",
    tool: "Claude",
    category: "code",
    prompt: `このリポジトリに新しいミニゲームを1本実装してください。要件: (1) 既存ゲームのコアループ/物理/難易度は一切変更しない (2) reduced-motion と低スペック端末で段階的に劣化する (3) 実装後、あなた自身が「クリア不能ではないか」「入力が奪われる状況はないか」を敵対的にレビューし、見つけた欠陥を修正してから完了報告する。検証は決定論的なフレームポンプで行い、目視スクリーンショットに頼らないこと。`,
    note: "「実装して」で終わらせず、敵対的セルフレビューと決定論的検証まで指示すると欠陥の残留率が大きく下がる。"
  },
  {
    id: "synth-patch",
    title: "ホラー系シンセパッチの言語指定",
    tool: "Grok",
    category: "music",
    prompt: `Design a synth patch called "Abyssal Choir": two detuned saw oscillators (±35 cents), a third sine sub one octave down, slow attack (1.8s) and long release (4s), dark lowpass at 900Hz with slight resonance, cavernous reverb (6s decay, 40% wet), and a slow LFO (0.15Hz) on filter cutoff so it breathes. It should feel like a cathedral underwater.`,
    note: "音色は「感情＋空間の比喩」で締めると狙い通りになりやすい。数値レンジも必ず添える。"
  }
];
