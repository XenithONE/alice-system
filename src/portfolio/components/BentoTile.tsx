import { TIERS, artFor, tierOf } from "../bento";
import { EngineChip, StatusBadge, primaryCta } from "./badges";
import type { Work } from "../../data/works";

const BASE = import.meta.env.BASE_URL;

const STATUS_JA: Record<Work["status"], string> = {
  playable: "ブラウザで今すぐ遊べます",
  released: "リリース済み",
  "coming-soon": "近日公開",
  "in-dev": "開発中"
};

interface Props {
  work: Work;
  /** position in the packed reading order; the first two load eagerly */
  index: number;
  onOpenDetail: (work: Work) => void;
}

/**
 * One tile.
 *
 * The whole tile is one link — a stretched anchor rather than a card full of
 * separate targets. That keeps the tab order to one stop per work and gives
 * touch the entire rectangle instead of a title-sized sliver.
 *
 * The secondary text is always in the DOM and only fades in on hover or focus.
 * Two rules make that safe: :focus-within so a keyboard reaches the same state
 * a mouse does, and @media (hover: none) in the stylesheet pinning it visible,
 * because a phone has no hover and would otherwise never see it.
 */
export function BentoTile({ work, index, onOpenDetail }: Props) {
  const tier = tierOf(work);
  const spec = TIERS[tier];
  const cta = primaryCta(work);
  const art = artFor(work, tier, BASE);
  const eager = index < 2;

  return (
    <li className={`bento-tile bt-${tier} bt-${spec.mode}`} id={work.id} data-tier={tier}>
      <div className="bt-media">
        {/*
         * width/height are the source's, not the tile's — they only have to
         * state the aspect ratio so the box is reserved before the bytes
         * arrive. srcset then picks a width against the grid's breakpoints;
         * the tiles are 344 CSS px for all but the XL, so the 1280 file was
         * about four times the pixels being drawn.
         */}
        <img
          src={art.src}
          {...(art.srcSet ? { srcSet: art.srcSet, sizes: art.sizes } : {})}
          alt=""
          width={art.width}
          height={art.height}
          loading={eager ? "eager" : "lazy"}
          decoding={eager ? "sync" : "async"}
          {...(index === 0 ? { fetchPriority: "high" as const } : {})}
          draggable={false}
        />
      </div>

      <div className="bt-body">
        <p className="bt-badges">
          <StatusBadge status={work.status} />
        </p>

        <h3 className="bt-title">
          {/*
           * primaryCta has no href for an in-dev title with no store page yet,
           * so an <a> would be a dead element there — present, unfocusable, and
           * looking exactly like the ones that work. Those tiles open the
           * detail dialog instead, and either way the tile is one target.
           */}
          {cta.href ? (
            <a
              className="bt-link"
              href={cta.href}
              aria-label={cta.jaAria}
              {...(cta.external ? { target: "_blank", rel: "noreferrer" } : {})}
            >
              {work.title}
              <span className="visually-hidden">
                {" "}
                {work.titleJa}。{STATUS_JA[work.status]}
              </span>
            </a>
          ) : (
            <button type="button" className="bt-link" onClick={() => onOpenDetail(work)} aria-label={cta.jaAria}>
              {work.title}
              <span className="visually-hidden">
                {" "}
                {work.titleJa}。{STATUS_JA[work.status]}
              </span>
            </button>
          )}
        </h3>
        <p className="bt-ja">{work.titleJa}</p>

        <div className="bt-meta">
          <p className="bt-desc">{work.description}</p>
          <p className="bt-chips">
            <EngineChip engine={work.engine} />
            <span className="bt-year">{work.year}</span>
          </p>
        </div>
      </div>

      {/*
       * Only when the tile's own control goes somewhere else. On the two tiles
       * with no store link the title is already a button opening this same
       * dialog, so a 詳細 button beside it was a second tab stop that did the
       * identical thing — announced twice, useful once.
       */}
      {tier !== "s" && cta.href && (
        <button type="button" className="bt-detail" onClick={() => onOpenDetail(work)}>
          詳細
          <span className="visually-hidden">（{work.title}）</span>
        </button>
      )}
    </li>
  );
}
