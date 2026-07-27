// Games that can only be entered through the harbor arena.
// Keep this catalog separate from WORKS: arena titles must not appear in the
// portfolio gallery, LIVE count, or sitemap.

export type ArenaGameId = "scrap-crown" | "vortex-crown";

export interface ArenaGame {
  id: ArenaGameId;
  title: string;
  titleJa: string;
  description: string;
  href: string;
  cover: string;
  year: string;
  engine: string;
  players: string;
  tags: readonly string[];
}

export const ARENA_GAMES: readonly ArenaGame[] = [
  {
    id: "scrap-crown",
    title: "SCRAP CROWN",
    titleJa: "物理演算ロボット闘技",
    description:
      "鋼板とチタンで競技ロボットを組み、限られたポイント内で武装を選ぶ。2〜4人で激突する物理演算メカバトル。",
    href: "scrap-crown.html",
    cover: "assets/scrap-crown-cover.webp",
    year: "2026",
    engine: "THREE.JS + RAPIER",
    players: "2–4P / CPU",
    tags: ["ROBOT BUILD", "PHYSICS", "P2P"]
  },
  {
    id: "vortex-crown",
    title: "VORTEX CROWN",
    titleJa: "七層機装スピントップバトル",
    description:
      "7部位・777パーツから機体を組み上げ、シナジーとActiveスキルで戦局を動かす。1人＋CPUから4人対戦まで対応。",
    href: "vortex-crown.html",
    cover: "assets/vortex-crown-cover.webp",
    year: "2026",
    engine: "THREE.JS + RAPIER",
    players: "1–4P / CPU",
    tags: ["777 PARTS", "DRAFT", "SKILL BATTLE"]
  }
] as const;
