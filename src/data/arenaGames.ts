// The two arena titles.
//
// This catalogue stays separate from WORKS, but the reason has narrowed. It is
// no longer "these must not be shown" — the harbour became a hidden page, and
// hiding the only way in would have made two finished games unreachable. They
// are now in the works grid, through the ARENA_AS_WORKS adapter in bento.ts.
//
// Separate because merging them would move numbers that are about WORKS:
// STUDIO_TALLY.live is the studio's own count and the sitemap lists the pages
// the site advertises. bentoSelftest [D1] holds that line — it asserts the
// tally still counts WORKS only while the catalogue counts more.
//
// So: show them, do not adopt them.

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
