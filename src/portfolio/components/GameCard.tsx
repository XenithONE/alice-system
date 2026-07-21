import type { Work } from "../../data/works";
import { StatusBadge, EngineChip, MadeWith, primaryCta, accession } from "./badges";

const BASE = import.meta.env.BASE_URL;

interface GameCardProps {
  work: Work;
  index: number;
  total: number;
  onOpenDetail: (work: Work) => void;
  eager?: boolean;
}

/** One title in a shelf. The cover opens the detail dialog; the CTA row carries
 * the contextual primary action (play / wishlist / coming-soon) + a details
 * button. Hover and keyboard-focus share the same rich state (:focus-within). */
export function GameCard({ work, index, total, onOpenDetail, eager }: GameCardProps) {
  const cta = primaryCta(work);
  const genre = work.tags.slice(0, 2).join(" · ");

  return (
    <article className="game-card" data-status={work.status}>
      <button
        type="button"
        className="gc-media"
        onClick={() => onOpenDetail(work)}
        aria-label={`${work.title} の詳細を開く`}
      >
        <img
          src={BASE + work.cover}
          alt=""
          loading={eager ? "eager" : "lazy"}
          draggable="false"
        />
        <span className="gc-scrim" aria-hidden="true" />
        <span className="gc-media-top">
          <StatusBadge status={work.status} />
          <EngineChip engine={work.engine} />
        </span>
        <span className="gc-accession" aria-hidden="true">
          {accession(index, total)}
        </span>
      </button>

      <div className="gc-body">
        <div className="gc-heading">
          <h3 className="gc-title">{work.title}</h3>
          <span className="gc-ja">{work.titleJa}</span>
        </div>
        <p className="gc-genre">{genre}</p>
        <p className="gc-desc">{work.description}</p>

        {typeof work.progress === "number" && work.status === "in-dev" && (
          <div className="gc-progress" role="img" aria-label={`開発進捗 約${Math.round(work.progress * 100)}%`}>
            <span className="gc-progress-bar" style={{ width: `${Math.round(work.progress * 100)}%` }} />
            <span className="gc-progress-label">
              IN DEV · {Math.round(work.progress * 100)}%{work.releaseWindow ? ` · ${work.releaseWindow}` : ""}
            </span>
          </div>
        )}

        <div className="gc-foot">
          <div className="gc-cta">
            {cta.href ? (
              <a
                className={`cta ${cta.tone}`}
                href={cta.href}
                aria-label={cta.jaAria}
                {...(cta.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              >
                <span aria-hidden="true">{cta.glyph}</span> {cta.label}
                {cta.external ? <i aria-hidden="true"> ↗</i> : null}
              </a>
            ) : (
              <span className={`cta ${cta.tone} is-static`} aria-label={cta.jaAria}>
                <span aria-hidden="true">{cta.glyph}</span> {cta.label}
              </span>
            )}
            <button type="button" className="cta ghost" onClick={() => onOpenDetail(work)}>
              詳細
            </button>
          </div>
          <MadeWith tools={work.aiTools} />
        </div>
      </div>
    </article>
  );
}
