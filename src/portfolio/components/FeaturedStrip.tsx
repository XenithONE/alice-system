import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { CATALOG } from "../bento";
import { primaryCta, StatusBadge } from "./badges";

const BASE = import.meta.env.BASE_URL;

/*
 * Large cinematic plates for featured titles. Content is 100% from works data —
 * titles, Japanese subtitles, and descriptions are never rewritten here.
 *
 * Three shapes, decided by CSS alone (theme.css):
 *   ≥1000px + motion-on + view() timelines — the sticky scrolly: vertical
 *     scroll pans the plates horizontally through a pinned viewport. --fcount
 *     sizes the runway, so appending a featured Work lengthens the ride.
 *   ≥900px otherwise — the two-column grid (the base sheet).
 *   <900px — a native snap carousel; a horizontal flick is touch's mother
 *     tongue, and the browser drives it, not a timeline.
 *
 * DOM order always equals reading order; nothing here is aria-hidden, so a
 * screen reader hears the same catalogue in every shape.
 */
export function FeaturedStrip() {
  const featured = CATALOG.filter((w) => w.featured);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  /*
   * The one job CSS cannot do: when Tab reaches a card the browser scrolls
   * the CARD into view, but in scrolly mode the card's position is a
   * function of scrollY — the browser does not know the mapping, so focus
   * could land on a plate panned half out of the pin (WCAG 2.4.11). This
   * maps focus → the scrollY that centres that card. Instant, no easing:
   * the reader asked for a place, not a ride.
   */
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onFocusIn = (e: FocusEvent): void => {
      const scrolly =
        window.matchMedia("(min-width: 1000px)").matches &&
        document.documentElement.classList.contains("motion-on") &&
        typeof CSS !== "undefined" &&
        CSS.supports("animation-timeline: view()");
      if (!scrolly) return;
      const card = (e.target as HTMLElement | null)?.closest(".featured-card");
      if (!card) return;
      const cards = [...wrap.querySelectorAll(".featured-card")];
      const i = cards.indexOf(card);
      if (i < 0) return;
      const top = wrap.getBoundingClientRect().top + window.scrollY;
      const span = Math.max(0, wrap.offsetHeight - window.innerHeight);
      window.scrollTo({
        top: top + (span * i) / Math.max(1, cards.length - 1),
        behavior: "instant" as ScrollBehavior,
      });
    };
    wrap.addEventListener("focusin", onFocusIn);
    return () => wrap.removeEventListener("focusin", onFocusIn);
  }, []);

  return (
    <section id="featured" className="section featured-section" aria-labelledby="featured-title">
      <div
        className="featured-scrolly"
        ref={wrapRef}
        style={{ "--fcount": featured.length } as CSSProperties}
      >
        <div className="featured-sticky">
          <header className="section-head" data-reveal>
            <p className="section-index">01a / FEATURED</p>
            <h2 id="featured-title">
              いま注目のタイトル
            </h2>
            <p className="section-lede">
              特に手をかけた作品を、大きく。
            </p>
          </header>

          <p className="featured-progress" aria-hidden="true">
            <span />
          </p>

          <ul className="featured-track">
            {featured.map((work) => {
              const cta = primaryCta(work);
              const img = work.poster ?? work.cover;
              return (
                <li key={work.id} className="featured-card" data-reveal id={`featured-${work.id}`}>
                  <div className="featured-media">
                    <img
                      src={BASE + img}
                      alt={work.titleJa ? `${work.title} — ${work.titleJa}` : work.title}
                      width={1280}
                      height={800}
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                    />
                    <div className="featured-shade" />
                  </div>
                  <div className="featured-body">
                    <p className="featured-kicker">
                      <StatusBadge status={work.status} />
                    </p>
                    <h3 className="featured-title">{work.title}</h3>
                    <p className="featured-ja">{work.titleJa}</p>
                    <p className="featured-desc">{work.description}</p>
                    <div className="featured-actions">
                      {cta.href ? (
                        <a
                          className={`cta ${cta.tone}`}
                          href={cta.href}
                          aria-label={cta.jaAria}
                          {...(cta.external ? { target: "_blank", rel: "noreferrer" } : {})}
                        >
                          <span aria-hidden="true">{cta.glyph}</span> {cta.label}
                        </a>
                      ) : (
                        <span className={`cta ${cta.tone} is-static`}>
                          <span aria-hidden="true">{cta.glyph}</span> {cta.label}
                          {work.releaseWindow ? ` — ${work.releaseWindow}` : ""}
                        </span>
                      )}
                      <span className="engine-chip">{work.engine.toUpperCase()}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
