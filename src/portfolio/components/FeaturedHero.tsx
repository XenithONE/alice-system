import { useMemo, useState } from "react";
import { WORKS, STUDIO_TALLY, type Work } from "../../data/works";
import { StatusBadge, PlatformRow, EngineChip, MadeWith, primaryCta } from "./badges";

const BASE = import.meta.env.BASE_URL;

export function FeaturedHero({ onOpenDetail }: { onOpenDetail: (w: Work) => void }) {
  // Play-now titles lead the switcher so the first impression has a green CTA.
  const featured = useMemo(
    () =>
      WORKS.filter((w) => w.featured).sort(
        (a, b) => (a.status === "playable" ? 0 : 1) - (b.status === "playable" ? 0 : 1)
      ),
    []
  );
  const [active, setActive] = useState(0);
  const work = featured[active] ?? WORKS[0]!;
  const cta = primaryCta(work);

  const ticker = useMemo(() => {
    const parts = [
      "NOW SHOWING",
      ...featured.map((w) => (w.status === "playable" ? w.title : `${w.title} — IN DEV`)),
      `${STUDIO_TALLY.live} PLAYABLE`,
      "WISHLIST THE NEXT TITLE"
    ];
    return parts.join("   ✦   ");
  }, [featured]);

  return (
    <section id="top" className="hero" aria-labelledby="hero-title">
      <div className="hero-stage" aria-hidden="true">
        {featured.map((w, i) => (
          <div
            key={w.id}
            className={`hero-media ${i === active ? "is-active" : ""}`}
            style={{ backgroundImage: `url("${BASE + w.cover}")` }}
          />
        ))}
        <div className="hero-grade" />
        <div className="hero-grain" />
      </div>

      <div className="hero-lockup">
        <p className="hero-studio">AlicE sYsTeM — AIと作るゲームスタジオ</p>
        <p className="hero-kicker">
          <i className="rec-dot" aria-hidden="true" /> NOW SHOWING — FEATURED TITLE
        </p>
        <div className="hero-badges">
          <StatusBadge status={work.status} />
          <PlatformRow platform={work.platform} />
        </div>
        <h1 id="hero-title" className="hero-title">
          {work.title}
        </h1>
        <p className="hero-ja">{work.titleJa}</p>
        <p className="hero-logline">{work.description}</p>
        <p className="hero-spec">
          <EngineChip engine={work.engine} />
          <span>{work.tags.slice(0, 3).join(" · ")}</span>
        </p>
        <div className="hero-cta">
          {cta.href ? (
            <a
              className={`cta lg ${cta.tone}`}
              href={cta.href}
              aria-label={cta.jaAria}
              {...(cta.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              <span aria-hidden="true">{cta.glyph}</span> {cta.label}
              {cta.external ? <i aria-hidden="true"> ↗</i> : null}
            </a>
          ) : (
            <span className={`cta lg ${cta.tone} is-static`} aria-label={cta.jaAria}>
              <span aria-hidden="true">{cta.glyph}</span> {cta.label}
            </span>
          )}
          <button type="button" className="cta lg ghost" onClick={() => onOpenDetail(work)}>
            詳細を見る
          </button>
        </div>
        <MadeWith tools={work.aiTools} />
      </div>

      {featured.length > 1 && (
        <div className="hero-switcher" role="group" aria-label="注目タイトルを切り替え">
          {featured.map((w, i) => (
            <button
              key={w.id}
              type="button"
              aria-pressed={i === active}
              className={`reel ${i === active ? "is-active" : ""}`}
              onClick={() => setActive(i)}
              title={w.title}
            >
              <img src={BASE + w.cover} alt={w.title} loading="lazy" draggable="false" />
              <span className="reel-status" data-status={w.status} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      <div className="hero-marquee" aria-hidden="true">
        <div className="marquee-track">
          <span>{ticker}</span>
          <span>{ticker}</span>
        </div>
      </div>

      <a className="hero-scrolltip" href="#games" aria-label="ライブラリへスクロール">
        LIBRARY <i aria-hidden="true">↓</i>
      </a>
    </section>
  );
}
