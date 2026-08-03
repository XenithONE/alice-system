import type { CSSProperties } from "react";
import { CATALOG } from "../bento";
import { useCoverflow } from "../useCoverflow";
import { primaryCta, StatusBadge } from "./badges";

const BASE = import.meta.env.BASE_URL;

/*
 * FEATURED — glass plates in a shallow 3D space.
 *
 * Two shapes from one DOM, and the flat one is the base sheet:
 *
 *   coverflow  motion on + a fine pointer + preserve-3d + ≥900px.
 *              Four plates on a weak perspective; the centre one faces you
 *              and the others recede. Nothing turns on its own — wheel,
 *              drag, arrow keys and clicking a side plate all move the same
 *              index (useCoverflow). That is the whole difference between
 *              this and the carousel it resembles.
 *   grid       everything else. The two-column layout, unchanged.
 *
 * ⭐ The plate FRAMES its artwork rather than being covered by it, and that
 * is a contrast device as much as a compositional one: type never sits on
 * a work's cover, so the ground under every character is the plate's own
 * glass over a known white. The old full-bleed body could not be audited —
 * its background was whichever artwork happened to be behind it.
 *
 * Accessibility follows the shape: the list stays a list (a carousel is not
 * a listbox and these are not tabs), only the centre plate is reachable,
 * and the position is announced as text rather than implied by depth.
 */
export function FeaturedStrip() {
  const featured = CATALOG.filter((w) => w.featured);
  const flow = useCoverflow(featured.length);
  const current = featured[flow.active];

  return (
    <section id="featured" className="section featured-section" aria-labelledby="featured-title">
      <header className="section-head" data-reveal>
        <p className="section-index">01a / FEATURED</p>
        <h2 id="featured-title">いま注目のタイトル</h2>
        <p className="section-lede">特に手をかけた作品を、大きく。</p>
      </header>

      <div
        className={`glass-stage ${flow.enabled ? "is-3d" : ""}`}
        style={{ "--count": featured.length, "--active": flow.active } as CSSProperties}
      >
        <ul
          className="glass-rail"
          role="group"
          aria-label="注目のタイトル"
          tabIndex={flow.enabled ? 0 : -1}
          {...(flow.enabled ? flow.bind : {})}
        >
          {featured.map((work, i) => {
            const cta = primaryCta(work);
            const img = work.poster ?? work.cover;
            const d = i - flow.active;
            const dabs = Math.abs(d);
            /*
             * Offsets compress with distance, the way a real cover flow
             * stacks. A linear step put the far plate 168% out — past the
             * right edge of a 1440 viewport, where it was neither visible
             * nor clickable, which the hit-test gate caught. The first
             * neighbour steps 50%, every plate after it only 16% more, so
             * the far ones pile up near the edge instead of leaving.
             */
            const dx = d === 0 ? 0 : Math.sign(d) * (50 + (dabs - 1) * 16);
            const isCentre = !flow.enabled || d === 0;
            return (
              <li
                key={work.id}
                className="glass-panel"
                id={`featured-${work.id}`}
                style={{ "--d": d, "--dabs": dabs, "--dx": `${dx}%` } as CSSProperties}
                data-centre={isCentre ? "" : undefined}
              >
                {/*
                  * Bringing a plate forward is a real button, not a click
                  * handler on the <li>. A rotated element inside a
                  * preserve-3d context is not reliably hit-testable at the
                  * centre of its own bounding box — measured: the point
                  * returned the rail, so the plate was simply unclickable —
                  * and an element that exists to be pressed should be the
                  * thing the browser hit-tests.
                  *
                  * Pointer affordance only: aria-hidden and out of the tab
                  * order, because the arrows and the position readout are
                  * already the complete keyboard and screen-reader model.
                  */}
                {!isCentre && (
                  <button
                    type="button"
                    className="glass-select"
                    tabIndex={-1}
                    aria-hidden="true"
                    onClick={() => flow.setActive(i)}
                  />
                )}
                {/*
                  * The inert wrapper, not the plate itself.
                  *
                  * inert removes focus AND hides from assistive tech in one
                  * attribute, which is exactly what a plate turned away from
                  * the reader needs — aria-hidden alone would leave its link
                  * tabbable, a focus stop on something facing away. But inert
                  * also makes a subtree untouchable, so putting it on the <li>
                  * silently killed "click a side plate to bring it forward".
                  * Wrapping the content instead keeps the plate clickable and
                  * pointer-events: none (in the stylesheet) lets the click fall
                  * through to it.
                  */}
                <div className="glass-inner" inert={!isCentre}>
                  <div className="glass-media">
                    <img
                      src={BASE + img}
                      alt={work.titleJa ? `${work.title} — ${work.titleJa}` : work.title}
                      width={1280}
                      height={800}
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                    />
                  </div>
                  <div className="glass-body">
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
                </div>
              </li>
            );
          })}
        </ul>

        {/*
          * The controls are only meaningful while the plates are stacked in
          * depth; the grid needs no navigation. Position is spoken as text
          * because depth and opacity are not information a reader can be
          * assumed to perceive.
          */}
        {flow.enabled && (
          <div className="glass-controls">
            <button
              type="button"
              className="glass-arrow"
              onClick={() => flow.step(-1)}
              disabled={flow.active === 0}
              aria-label="前のタイトル"
            >
              ←
            </button>
            <p className="glass-position" aria-live="polite">
              {featured.length}件中{flow.active + 1}件目
              <span className="visually-hidden"> — {current?.title}</span>
            </p>
            <button
              type="button"
              className="glass-arrow"
              onClick={() => flow.step(1)}
              disabled={flow.active === featured.length - 1}
              aria-label="次のタイトル"
            >
              →
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
