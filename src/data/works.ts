// Portfolio / studio catalog. All href/cover/trailer/screenshot paths are
// BASE-relative — render them as `import.meta.env.BASE_URL + path` (never
// hardcode /alice-system/).
//
// ⚠ Never import VALUES from src/lib/horrorEngine.ts (or anything that reaches
//   it) into portfolio code — that would pull the 5MB spark chunk into the
//   portfolio entry. If a game type is ever needed here, use `import type` only.
//
// ── HOW TO ADD A NEW GAME (content-injection contract) ────────────────────────
// The whole studio front-end is driven by this one array. To announce a new
// Unity (or any) title, append ONE object — no component changes needed:
//   1. Drop a cover into public/assets/ (a placeholder is fine to start).
//   2. Add a Work with status:"in-dev" (or "coming-soon") + engine + platform.
//   3. Later, fill `trailer`, `screenshots`, and `storeLinks` and flip `status`
//      to "coming-soon" (wishlist live) or "released" (shipped). The card, its
//      badges, CTAs, and the detail dialog all update from data alone.
// `status` drives the badge + the primary CTA; `platform` + `storeLinks` drive
// where the CTA points. Green (--live) is reserved for browser "play now" only.

export type AiTool =
  | "Claude"
  | "ChatGPT"
  | "Gemini"
  | "Grok"
  | "Higgsfield"
  | "Runway"
  | "Genspark";

export const AI_TOOLS: AiTool[] = ["Claude", "ChatGPT", "Gemini", "Grok", "Higgsfield", "Runway", "Genspark"];

/** Where a title runs / can be acquired. */
export type Platform = "web" | "steam" | "itch" | "windows" | "mac" | "download";

/** Availability — drives the status badge and the primary CTA verb/color. */
export type WorkStatus = "playable" | "released" | "coming-soon" | "in-dev";

/** Build tech — shown as a small engine chip. */
export type Engine = "Three.js" | "Unity" | "Canvas 2D" | "Web Audio" | "WebGL";

export interface StoreLinks {
  steam?: string;
  itch?: string;
  download?: string;
}

export interface Work {
  id: string;
  title: string; // EN display title
  titleJa: string; // ja subtitle
  description: string; // ja, 1-2 sentences
  href: string; // BASE-relative (internal page) — play-now / experiment targets
  cover: string; // BASE-relative
  poster?: string; // optional portrait/key artwork for the hero
  year: string;
  kind: "game" | "synth" | "experience";
  engine: Engine;
  platform: Platform[];
  status: WorkStatus;
  tags: string[];
  aiTools: AiTool[];
  storeLinks?: StoreLinks; // external store / download targets (Unity titles)
  trailer?: string; // BASE-relative muted-loop video (optional)
  screenshots?: string[]; // BASE-relative gallery images (optional)
  releaseWindow?: string; // e.g. "2026" — shown on coming/in-dev cards
  progress?: number; // 0..1 dev progress meter for in-dev titles
  featured?: boolean; // eligible for the hero spotlight / switcher
}

export const WORKS: Work[] = [
  // ── COMING FROM THE STUDIO — Unity titles (store / download) ────────────────
  {
    id: "huntcontract",
    title: "HuntContract",
    titleJa: "協力型 討伐ホラーFPS",
    description:
      "Unity製の非対称・協力ホラーFPS。契約を受けたハンター達が、二層思考で襲ってくる殺人鬼から標的を狩り、生きて帰る。",
    href: "#huntcontract",
    cover: "assets/huntcontract-brick.webp",
    year: "2026",
    kind: "game",
    engine: "Unity",
    platform: ["steam", "windows"],
    status: "in-dev",
    tags: ["Co-op FPS", "Horror", "Asymmetric"],
    aiTools: ["Claude"],
    releaseWindow: "2026",
    progress: 0.45,
    featured: true
  },
  {
    id: "demiurge",
    title: "Demiurge",
    titleJa: "広大平面のゴッドシム",
    description:
      "Unity製の広大な平面世界を見下ろすサンドボックス・ゴッドシム。人と魔物と獣が暮らす大地に、太陽と季節と気候をもたらす。",
    href: "#demiurge",
    cover: "assets/demiurge-brick.webp",
    year: "2027",
    kind: "game",
    engine: "Unity",
    platform: ["steam", "windows"],
    status: "in-dev",
    tags: ["God-Sim", "Sandbox", "Simulation"],
    aiTools: ["Claude"],
    releaseWindow: "2027",
    progress: 0.3
  },

  // ── NOW PLAYING — browser titles (play now) ─────────────────────────────────
  {
    id: "relic-road",
    title: "RELIC ROAD",
    titleJa: "カード×ボードRPG（2〜4人）",
    description:
      "ブロック世界の地図をカードで駆けるデッキ構築ボードRPG。モンスターを倒してレベルアップ、3つのレリックと最終守護者を制した者が勝つ。ルームコードで2〜4人、空席はBOTが参戦。",
    href: "relic-road.html",
    cover: "assets/relic-road-brick.webp",
    year: "2026",
    kind: "game",
    engine: "Canvas 2D",
    platform: ["web"],
    status: "playable",
    tags: ["2–4P Multi", "Deckbuilder", "Board-RPG"],
    aiTools: ["Claude", "ChatGPT", "Grok"],
    featured: true
  },
  {
    id: "hollow-ward",
    title: "THE HOLLOW WARD",
    titleJa: "廃病棟協力型3Dホラー",
    description:
      "ルームコードで1〜3人が協力。CASE FILEを共有し、見られている間だけ動けない怪物ワードンから廃病棟を脱出する3Dホラー。ソロプレイ対応。",
    href: "hollow-ward.html",
    cover: "assets/hollow-ward-brick.webp",
    poster: "assets/hollow-ward-poster.webp",
    year: "2026",
    kind: "game",
    engine: "Three.js",
    platform: ["web"],
    status: "playable",
    tags: ["1–3P Co-op", "Horror", "Room Code"],
    aiTools: ["Claude"],
    featured: true
  },
  {
    id: "signal-siege",
    title: "SIGNAL SIEGE",
    titleJa: "対戦タワーディフェンス",
    description:
      "ルームコードで友達とP2P対戦するタワーディフェンス。タワーで守り、クリープを送って攻める。ソロ(vs AI)対応。",
    href: "tower-defense.html",
    cover: "assets/signal-siege-brick.webp",
    poster: "assets/signal-siege-poster.webp",
    year: "2026",
    kind: "game",
    engine: "Canvas 2D",
    platform: ["web"],
    status: "playable",
    tags: ["Versus TD", "P2P", "PeerJS"],
    aiTools: ["Claude"],
    featured: true
  },
  {
    id: "the-eidolon",
    title: "THE EIDOLON",
    titleJa: "闇の中の眼",
    description: "懐中電灯ひとつで虚空を探索し、信号の断片を5つ集めて脱出する一人称コズミックホラー。",
    href: "games/the-eidolon.html",
    cover: "assets/the-eidolon-brick.webp",
    poster: "assets/the-eidolon-poster.webp",
    year: "2026",
    kind: "game",
    engine: "Three.js",
    platform: ["web"],
    status: "playable",
    tags: ["Horror", "PointerLock", "First-Person"],
    aiTools: ["Claude", "ChatGPT"]
  },
  {
    id: "rift-courier",
    title: "RIFT COURIER",
    titleJa: "崩壊するリフトの配達人",
    description: "崩れゆく次元の裂け目を飛び、光のキーを集めて最終ゲートを抜ける3Dレールフライト。",
    href: "games/rift-courier.html",
    cover: "assets/rift-courier-brick.webp",
    year: "2026",
    kind: "game",
    engine: "Three.js",
    platform: ["web"],
    status: "playable",
    tags: ["Arcade", "3D Flight"],
    aiTools: ["Claude", "ChatGPT"]
  },
  {
    id: "iwbtg",
    title: "I WANNA BE THE SIGNAL",
    titleJa: "全力で騙してくる死にゲー",
    description: "偽の床、見えない壁、嘘のセーブ。プレイヤーを裏切り続ける高難度2Dカイゾーアクション。",
    href: "games/iwbtg/index.html",
    cover: "assets/iwbtg-brick.webp",
    year: "2026",
    kind: "game",
    engine: "Canvas 2D",
    platform: ["web"],
    status: "playable",
    tags: ["Platformer", "Kaizo"],
    aiTools: ["Claude", "ChatGPT"]
  },
  {
    id: "locker-hunt",
    title: "LOCKER HUNT",
    titleJa: "ロッカーの中の小さな影",
    description: "学校の廊下でロッカーを開け、小さな影を探すコメディホラー探索ゲーム。",
    href: "games/locker-hunt.html",
    cover: "assets/locker-hunt-brick.webp",
    year: "2026",
    kind: "game",
    engine: "Canvas 2D",
    platform: ["web"],
    status: "playable",
    tags: ["Horror", "Search"],
    aiTools: ["Claude", "ChatGPT"]
  },
  {
    id: "signal-runner",
    title: "SIGNAL RUNNER",
    titleJa: "崩れる信号の隙間を走る",
    description: "崩壊していく信号の隙間を縫って光る断片を回収するアーケード回避アクション。",
    href: "games/signal-runner.html",
    cover: "assets/signal-runner-brick.webp",
    year: "2026",
    kind: "game",
    engine: "Canvas 2D",
    platform: ["web"],
    status: "playable",
    tags: ["Arcade", "Dodge"],
    aiTools: ["Claude", "ChatGPT"]
  },
  {
    id: "constellation",
    title: "CONSTELLATION",
    titleJa: "星座の記憶パズル",
    description: "星を正しい順に結び、沈黙した信号を再同期する記憶パズル。エンドレスモード搭載。",
    href: "games/constellation.html",
    cover: "assets/constellation-brick.webp",
    year: "2026",
    kind: "game",
    engine: "Canvas 2D",
    platform: ["web"],
    status: "playable",
    tags: ["Puzzle", "Memory"],
    aiTools: ["Claude", "ChatGPT"]
  },
  {
    id: "dragons-keep",
    title: "DRAGON'S KEEP",
    titleJa: "ファンタジーピンボール",
    description: "城門マルチボール、ワームホール、魔の渦。自前物理エンジンのファンタジーピンボール。",
    href: "games/dragons-keep.html",
    cover: "assets/dragons-keep-brick.webp",
    year: "2026",
    kind: "game",
    engine: "Canvas 2D",
    platform: ["web"],
    status: "playable",
    tags: ["Pinball", "Physics"],
    aiTools: ["Claude", "ChatGPT"]
  },

  // ── EXPERIMENTS — playable web toys ─────────────────────────────────────────
  {
    id: "atelier-adrift",
    title: "ATELIER ADRIFT",
    titleJa: "ローポリの海の実験室",
    description:
      "自作の海シェーダ(dFdx面取り法線＋合成正弦波)で描く、明るいファンタジー・ローポリの群島。ダ・ヴィンチの機械を積んだ帆船が波に乗る、遊べるThree.js実験作。",
    href: "atelier.html",
    cover: "assets/atelier-adrift-brick.webp",
    year: "2026",
    kind: "experience",
    engine: "Three.js",
    platform: ["web"],
    status: "playable",
    tags: ["WebGL", "Shader", "Low-Poly"],
    aiTools: ["Claude", "Grok"]
  },
  {
    id: "rlyeh-engine",
    title: "R'LYEH ENGINE",
    titleJa: "クトゥルフ的シンセサイザー",
    description: "瞬く巨大な眼と蠢く触手が音に反応する、宇宙的恐怖テーマのWebシンセスタジオ。",
    href: "sy.html",
    cover: "assets/rlyeh-engine-brick.webp",
    year: "2026",
    kind: "synth",
    engine: "Web Audio",
    platform: ["web"],
    status: "playable",
    tags: ["Synth", "App", "Audio"],
    aiTools: ["Claude", "ChatGPT", "Grok"]
  }
];

/** Live status tallies for the nav ticker ("● N LIVE · N IN DEV"). */
export const STUDIO_TALLY = {
  live: WORKS.filter((w) => w.status === "playable").length,
  inDev: WORKS.filter((w) => w.status === "in-dev" || w.status === "coming-soon").length
};
