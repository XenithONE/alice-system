import { CATALOG } from "../bento";
import { primaryCta, StatusBadge } from "./badges";

const BASE = import.meta.env.BASE_URL;

/**
 * Large cinematic plates for featured titles. Content is 100% from works data —
 * titles, Japanese subtitles, and descriptions are never rewritten here.
 */
export function FeaturedStrip() {
  const featured = CATALOG.filter((w) => w.featured);

  return (
    <section id="featured" className="section featured-section" aria-labelledby="featured-title">
      <header className="section-head" data-reveal>
        <p className="section-index">01a / FEATURED</p>
        <h2 id="featured-title">
          いま注目のタイトル
        </h2>
        <p className="section-lede">
          特に手をかけた作品を、大きく。
        </p>
      </header>

      <div className="featured-grid">
        {featured.map((work) => {
          const cta = primaryCta(work);
          const img = work.poster ?? work.cover;
          return (
            <article key={work.id} className="featured-card" data-reveal id={`featured-${work.id}`}>
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
            </article>
          );
        })}
      </div>
    </section>
  );
}
