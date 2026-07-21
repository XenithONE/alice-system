import type { Work, WorkStatus, Platform } from "../../data/works";

const BASE = import.meta.env.BASE_URL;

// ── status ─────────────────────────────────────────────────────────────────
// Availability language. Colour + fill-style + glyph + label all encode the
// state so it survives grayscale / colour-blindness. Green (--live) is reserved
// exclusively for browser "play now" and never appears on a store/Unity title.
const STATUS_META: Record<WorkStatus, { label: string; glyph: string; cls: string }> = {
  playable: { label: "PLAYABLE", glyph: "▶", cls: "st-live" },
  released: { label: "OUT NOW", glyph: "◆", cls: "st-store" },
  "coming-soon": { label: "COMING SOON", glyph: "◷", cls: "st-dev" },
  "in-dev": { label: "IN DEVELOPMENT", glyph: "◷", cls: "st-dev" }
};

export function StatusBadge({ status }: { status: WorkStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={`badge status ${m.cls}`}>
      <i className="dot" aria-hidden="true" />
      {m.label}
    </span>
  );
}

// ── platform ───────────────────────────────────────────────────────────────
const PLATFORM_META: Record<Platform, { label: string; glyph: string }> = {
  web: { label: "BROWSER", glyph: "▶" },
  steam: { label: "STEAM", glyph: "◆" },
  itch: { label: "ITCH.IO", glyph: "✦" },
  windows: { label: "WINDOWS", glyph: "⊞" },
  mac: { label: "MAC", glyph: "⌘" },
  download: { label: "DOWNLOAD", glyph: "↓" }
};

export function PlatformRow({ platform }: { platform: Platform[] }) {
  return (
    <span className="platform-row" aria-label={`対応プラットフォーム: ${platform.map((p) => PLATFORM_META[p].label).join(", ")}`}>
      {platform.map((p) => (
        <span key={p} className="badge platform" data-plat={p}>
          <span aria-hidden="true">{PLATFORM_META[p].glyph}</span>
          {PLATFORM_META[p].label}
        </span>
      ))}
    </span>
  );
}

export function EngineChip({ engine }: { engine: string }) {
  return <span className="engine-chip">{engine.toUpperCase()}</span>;
}

export function MadeWith({ tools }: { tools: string[] }) {
  return (
    <span className="made-with" aria-label={`制作: AIと共作 (${tools.join(", ")})`}>
      MADE WITH <b aria-hidden="true">◆</b> {tools.slice(0, 3).join(" · ").toUpperCase()}
    </span>
  );
}

// ── primary CTA (status-driven) ──────────────────────────────────────────────
export type CtaTone = "live" | "wishlist" | "download" | "dev";
export interface Cta {
  label: string;
  glyph: string;
  tone: CtaTone;
  href?: string; // present => actionable
  external?: boolean; // opens store in a new tab
  jaAria: string;
}

/** The single contextual primary action for a title. Green only for play-now. */
export function primaryCta(w: Work): Cta {
  if (w.status === "playable") {
    return { label: "PLAY IN BROWSER", glyph: "▶", tone: "live", href: BASE + w.href, jaAria: `${w.title} をブラウザで今すぐプレイ` };
  }
  if (w.status === "released") {
    if (w.storeLinks?.steam) return { label: "GET ON STEAM", glyph: "◆", tone: "wishlist", href: w.storeLinks.steam, external: true, jaAria: `${w.title} をSteamで入手` };
    if (w.storeLinks?.itch) return { label: "GET ON ITCH.IO", glyph: "✦", tone: "wishlist", href: w.storeLinks.itch, external: true, jaAria: `${w.title} をitch.ioで入手` };
    if (w.storeLinks?.download) return { label: "DOWNLOAD", glyph: "↓", tone: "download", href: w.storeLinks.download, external: true, jaAria: `${w.title} をダウンロード` };
  }
  // coming-soon / in-dev
  if (w.storeLinks?.steam) return { label: "WISHLIST ON STEAM", glyph: "◆", tone: "wishlist", href: w.storeLinks.steam, external: true, jaAria: `${w.title} をSteamでウィッシュリスト登録` };
  return { label: "COMING SOON", glyph: "◷", tone: "dev", jaAria: `${w.title} は開発中・近日公開` };
}

export function accession(index: number, total: number): string {
  return `No.${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
}
