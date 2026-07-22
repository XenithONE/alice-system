import { useMemo, useState } from "react";
import { HeroRoot } from "../HeroRoot";
import type { HeroWorkItem } from "../gl/brick/heroScene";
import { STUDIO_TALLY, WORKS } from "../../data/works";
import type { Work } from "../../data/works";

const BASE = import.meta.env.BASE_URL;

// Gallery wall order — maps 1:1 onto heroScene's SLOTS (front 5, middle 4,
// top 4). Featured / flagship titles take the front row.
const WALL_ORDER = [
  "hollow-ward",
  "signal-siege",
  "huntcontract",
  "demiurge",
  "dragons-keep",
  "the-eidolon",
  "atelier-adrift",
  "rift-courier",
  "iwbtg",
  "locker-hunt",
  "signal-runner",
  "constellation",
  "rlyeh-engine"
];

const STATUS_NOTE: Record<Work["status"], string> = {
  playable: "クリックで詳細 — ブラウザで今すぐ遊べます",
  released: "クリックで詳細",
  "coming-soon": "クリックで詳細 — まもなく登場",
  "in-dev": "クリックで詳細 — Unityで制作中"
};

// The site's marquee: a full-bleed toy-brick GALLERY of the 13 works (cover art
// framed in studded brick panels, three-tier wall) with the red "A" landmark.
// Hovering a panel lifts it and names it here; clicking opens its detail
// dialog. Without WebGL / while booting, the poster + DOM lockup stand alone —
// the catalog below is always the primary, accessible browse path.
export function BrickHero({ onOpenDetail }: { onOpenDetail: (work: Work) => void }) {
  const [hovered, setHovered] = useState<Work | null>(null);
  const [glLive, setGlLive] = useState(false);

  const wallWorks = useMemo<HeroWorkItem[]>(() => {
    const byId = new Map(WORKS.map((w) => [w.id, w]));
    return WALL_ORDER.map((id) => byId.get(id))
      .filter((w): w is Work => Boolean(w))
      .map((w) => ({ id: w.id, title: w.title, cover: `${BASE}${w.cover}` }));
  }, []);

  const handleHover = (id: string | null): void => {
    setHovered(id ? (WORKS.find((w) => w.id === id) ?? null) : null);
  };
  const handleSelect = (id: string): void => {
    const work = WORKS.find((w) => w.id === id);
    if (work) onOpenDetail(work);
  };

  return (
    <section id="top" className="brick-hero" aria-labelledby="hero-title">
      <div className="bh-stage">
        <HeroRoot
          poster={`${BASE}assets/brick-hero-poster.webp`}
          works={wallWorks}
          onHoverWork={handleHover}
          onSelectWork={handleSelect}
          onLiveChange={setGlLive}
        />
      </div>
      <div className="bh-scrim" aria-hidden="true" />

      <div className="bh-lockup">
        <p className="bh-kicker">AIと作る、遊べるゲームスタジオ</p>
        <h1 id="hero-title" className="bh-title">
          AlicE <span>sYsTeM</span>
        </h1>
        <p className="bh-tag">
          ブロックを組むように、AIと一緒に作品を組み上げる。
          <br />
          全13作品を、そのまま3Dギャラリーに展示中。
        </p>
        <p className="bh-tally" aria-label={`${STUDIO_TALLY.live}タイトルが今すぐ遊べます、${STUDIO_TALLY.inDev}タイトルが制作中`}>
          <span className="tk live">
            <i aria-hidden="true" />
            {STUDIO_TALLY.live} 遊べる
          </span>
          <span className="tk dev">
            <i aria-hidden="true" />
            {STUDIO_TALLY.inDev} 制作中
          </span>
        </p>
        <div className="bh-actions">
          <a className="bh-cta primary" href="#games" data-magnetic>
            作品を見る <i aria-hidden="true">↓</i>
          </a>
          <a className="bh-cta ghost" href="#ai-lab" data-magnetic>
            AI Lab
          </a>
        </div>
        <p className="sr-only">
          背景の3Dギャラリーは装飾です。すべての作品は下の作品一覧から閲覧・プレイできます。
        </p>
      </div>

      {/* only while the 3D gallery is actually interactive — the poster
          fallback must not instruct users to hover/tap a static image */}
      {glLive && (
        <p className="bh-caption" data-active={hovered ? "true" : "false"} aria-hidden="true">
          {hovered ? (
            <>
              <strong>{hovered.title}</strong>
              <span className="cap-ja">{hovered.titleJa}</span>
              <span className="cap-note">{STATUS_NOTE[hovered.status]}</span>
            </>
          ) : (
            <span className="cap-note">
              <span className="only-fine">カバーにカーソルを合わせて、クリックで詳細</span>
              <span className="only-coarse">カバーをタップで詳細</span>
            </span>
          )}
        </p>
      )}
    </section>
  );
}
