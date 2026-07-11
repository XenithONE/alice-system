// Portfolio works catalog. All href/cover paths are BASE-relative — render them as
// `import.meta.env.BASE_URL + work.href` (never hardcode /alice-system/).
//
// ⚠ Never import VALUES from src/lib/horrorEngine.ts (or anything that reaches it)
//   into portfolio code — that would pull the 5MB spark chunk into the portfolio
//   entry. If a game type is ever needed here, use `import type` only.

export type AiTool =
  | "Claude"
  | "ChatGPT"
  | "Gemini"
  | "Grok"
  | "Higgsfield"
  | "Runway"
  | "Genspark";

export const AI_TOOLS: AiTool[] = ["Claude", "ChatGPT", "Gemini", "Grok", "Higgsfield", "Runway", "Genspark"];

export interface Work {
  id: string;
  title: string; // EN display title
  titleJa: string; // ja subtitle
  description: string; // ja, 1-2 sentences
  href: string; // BASE-relative
  cover: string; // BASE-relative
  poster?: string; // optional portrait artwork for the 3D works deck
  year: string;
  kind: "game" | "synth" | "experience";
  tags: string[];
  aiTools: AiTool[];
  featured?: boolean;
}

export const WORKS: Work[] = [
  {
    id: "signal-siege",
    title: "SIGNAL SIEGE",
    titleJa: "対戦タワーディフェンス",
    description: "ルームコードで友達とP2P対戦するタワーディフェンス。タワーで守り、クリープを送って攻める。ソロ(vs AI)対応。",
    href: "tower-defense.html",
    cover: "assets/tower-defense-cover.jpg",
    poster: "assets/signal-siege-poster.webp",
    year: "2026",
    kind: "game",
    tags: ["Canvas 2D", "Versus TD", "P2P", "PeerJS"],
    aiTools: ["Claude"]
  },
  {
    id: "hollow-ward",
    title: "THE HOLLOW WARD",
    titleJa: "廃病棟一人称ホラー",
    description: "見られている間だけ動けない怪物ワードンを避け、懐中電灯でCASE FILEを集めて脱出する3Dホラー。",
    href: "hollow-ward.html",
    cover: "assets/og.jpg",
    poster: "assets/hollow-ward-poster.webp",
    year: "2026",
    kind: "game",
    tags: ["Three.js", "Spark 2.1", "WebGL2", "Procedural"],
    aiTools: ["Claude"]
  },
  {
    id: "the-eidolon",
    title: "THE EIDOLON",
    titleJa: "闇の中の眼",
    description: "懐中電灯ひとつで虚空を探索し、信号の断片を5つ集めて脱出する一人称コズミックホラー。",
    href: "games/the-eidolon.html",
    cover: "assets/the-eidolon-cover.jpg",
    poster: "assets/the-eidolon-poster.webp",
    year: "2026",
    kind: "game",
    tags: ["Three.js", "Horror", "PointerLock"],
    aiTools: ["Claude", "ChatGPT"]
  },
  {
    id: "rift-courier",
    title: "RIFT COURIER",
    titleJa: "崩壊するリフトの配達人",
    description: "崩れゆく次元の裂け目を飛び、光のキーを集めて最終ゲートを抜ける3Dレールフライト。",
    href: "games/rift-courier.html",
    cover: "assets/rift-courier-cover.jpg",
    year: "2026",
    kind: "game",
    tags: ["Three.js", "Arcade", "3D Flight"],
    aiTools: ["Claude", "ChatGPT"]
  },
  {
    id: "iwbtg",
    title: "I WANNA BE THE SIGNAL",
    titleJa: "全力で騙してくる死にゲー",
    description: "偽の床、見えない壁、嘘のセーブ。プレイヤーを裏切り続ける高難度2Dカイゾーアクション。",
    href: "games/iwbtg/index.html",
    cover: "assets/iwbtg-cover.png",
    year: "2026",
    kind: "game",
    tags: ["Canvas 2D", "Platformer", "Kaizo"],
    aiTools: ["Claude", "ChatGPT"]
  },
  {
    id: "locker-hunt",
    title: "LOCKER HUNT",
    titleJa: "ロッカーの中の小さな影",
    description: "学校の廊下でロッカーを開け、小さな影を探すコメディホラー探索ゲーム。",
    href: "games/locker-hunt.html",
    cover: "assets/locker-hunt-cover.jpg",
    year: "2026",
    kind: "game",
    tags: ["Canvas 2D", "Horror", "Search"],
    aiTools: ["Claude", "ChatGPT"]
  },
  {
    id: "signal-runner",
    title: "SIGNAL RUNNER",
    titleJa: "崩れる信号の隙間を走る",
    description: "崩壊していく信号の隙間を縫って光る断片を回収するアーケード回避アクション。",
    href: "games/signal-runner.html",
    cover: "assets/signal-runner-cover.jpg",
    year: "2026",
    kind: "game",
    tags: ["Canvas 2D", "Arcade", "Dodge"],
    aiTools: ["Claude", "ChatGPT"]
  },
  {
    id: "constellation",
    title: "CONSTELLATION",
    titleJa: "星座の記憶パズル",
    description: "星を正しい順に結び、沈黙した信号を再同期する記憶パズル。エンドレスモード搭載。",
    href: "games/constellation.html",
    cover: "assets/constellation-cover.jpg",
    year: "2026",
    kind: "game",
    tags: ["Canvas 2D", "Puzzle", "Memory"],
    aiTools: ["Claude", "ChatGPT"]
  },
  {
    id: "dragons-keep",
    title: "DRAGON'S KEEP",
    titleJa: "ファンタジーピンボール",
    description: "城門マルチボール、ワームホール、魔の渦。自前物理エンジンのファンタジーピンボール。",
    href: "games/dragons-keep.html",
    cover: "assets/dragons-keep-cover.jpg",
    year: "2026",
    kind: "game",
    tags: ["Canvas 2D", "Pinball", "Physics"],
    aiTools: ["Claude", "ChatGPT"]
  },
  {
    id: "rlyeh-engine",
    title: "R'LYEH ENGINE",
    titleJa: "クトゥルフ的シンセサイザー",
    description: "瞬く巨大な眼と蠢く触手が音に反応する、宇宙的恐怖テーマのWebシンセスタジオ。",
    href: "sy.html",
    cover: "assets/entity.jpg",
    year: "2026",
    kind: "synth",
    tags: ["Web Audio", "Synth", "App"],
    aiTools: ["Claude", "ChatGPT", "Grok"]
  }
];
