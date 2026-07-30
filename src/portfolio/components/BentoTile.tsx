import { CATALOG, TIERS, artFor, tierOf } from "../bento";
import { EngineChip, StatusBadge, accession, primaryCta } from "./badges";
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
    // data-reveal makes the tile an entrance of its own. The vertical stagger
    // then comes free and is physically correct at every breakpoint and in
    // every filter state, because each tile is observed individually — band 4
    // arrives when band 4 arrives. Only the within-row offset needs CSS.
    <li className={`bento-tile bt-${tier} bt-${spec.mode}`} id={work.id} data-tier={tier} data-reveal>
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
            {/*
             * A catalogue number, from the helper this file's own module has
             * exported since the grid was written and nobody ever called.
             *
             * WorksBento passes 99 as the index for a filtered view, because a
             * subset has no ranking within the whole catalogue — so the number
             * is simply absent there rather than wrong.
             */}
            {index < CATALOG.length && (
              <span className="bt-accession">{accession(index, CATALOG.length)}</span>
            )}
            {/*
             * Only when the tile's own control goes somewhere else. On the two
             * tiles with no store link the title is already a button opening
             * this same dialog, so a 詳細 button beside it was a second tab
             * stop that did the identical thing — announced twice, useful once.
             *
             * It used to be a floating pill in the plate's top-right corner:
             * a second chrome object on the picture, at 9.9px, fighting the
             * status sticker for the corners. In the caption row it is a
             * caption-row control, which is what it always was.
             */}
            {tier !== "s" && cta.href && (
              <button type="button" className="bt-detail" onClick={() => onOpenDetail(work)}>
                詳細
                <span className="visually-hidden">（{work.title}）</span>
              </button>
            )}
          </p>
        </div>
      </div>
    </li>
  );
}
