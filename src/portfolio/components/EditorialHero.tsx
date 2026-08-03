import type { CSSProperties } from "react";
import { CATALOG } from "../bento";

const BASE = import.meta.env.BASE_URL;

/*
 * Signal Issue masthead, full-viewport and kinetic.
 *
 * The fluid ground (FluidRoot, document-level z:-1) is the hero's backdrop;
 * the constellation canvas that used to live here is retired — two render
 * loops behind one composition was paying the frame budget twice for two
 * competing protagonists. The static collage below remains as the ground
 * for no-WebGL / motion-off readers, and for the light issue (whose hero
 * pins an opaque dark plate that occludes the document fluid).
 *
 * The masthead sets letter by letter. Accessibility shape: the h1 carries
 * aria-label with the plain name and every visual span is aria-hidden — a
 * screen reader hears "AlicE sYsTeM", never "A l i c E".
 */

const fallbackStyle: CSSProperties = {
  backgroundImage: [
    /* a static breath of the SPECTRUM so even the still page carries it */
    "radial-gradient(ellipse at 74% 38%, rgba(224, 81, 124, 0.12), transparent 52%)",
    "radial-gradient(ellipse at 70% 40%, rgba(230, 173, 70, 0.16), transparent 55%)",
    "radial-gradient(ellipse at 20% 80%, rgba(8, 169, 197, 0.12), transparent 50%)",
    "linear-gradient(105deg, rgba(6, 28, 49, 0.92) 0%, rgba(6, 28, 49, 0.55) 42%, rgba(6, 28, 49, 0.25) 100%)",
    `url(${BASE}assets/hollow-ward-poster.webp)`,
    `url(${BASE}assets/relic-road-brick.webp)`,
  ].join(", "),
  backgroundSize: "auto, auto, auto, auto, cover, 48%",
  backgroundPosition: "center, center, center, center, center, right bottom",
  backgroundRepeat: "no-repeat",
};

/* Visual letters. --ci drives the stagger; the wrapper hides them from AT. */
function Chars({ text, from }: { text: string; from: number }) {
  return (
    <>
      {text.split("").map((c, i) => (
        <span key={i} className="hero-char" style={{ "--ci": from + i } as CSSProperties}>
          {c}
        </span>
      ))}
    </>
  );
}

export function EditorialHero() {
  const playable = CATALOG.filter((w) => w.status === "playable").length;

  return (
    <section className="hero" id="hero">
      <div className="hero-stage" aria-hidden="true">
        <div className="hero-fallback is-visible" style={fallbackStyle} />
        <div className="hero-veil" />
      </div>
      <div className="hero-scan" aria-hidden="true" />

      <div className="hero-lockup">
        <p className="section-index hero-folio">00 / SIGNAL ISSUE</p>

        <h1 className="hero-title" aria-label="AlicE sYsTeM">
          <span className="hero-line" aria-hidden="true">
            <Chars text="AlicE" from={0} />
          </span>
          <span className="hero-line" aria-hidden="true">
            <Chars text="sYs" from={5} />
            <em>
              <Chars text="Te" from={8} />
            </em>
            <Chars text="M" from={10} />
          </span>
        </h1>

        <p className="hero-signal" aria-label={`${playable} titles playable, AI-built catalog`}>
          <span className="hero-signal-live">{playable} playable</span>
          <span className="hero-signal-sep" aria-hidden="true">
            ·
          </span>
          <span>AI-built catalog</span>
        </p>

        <p className="hero-lede">AI と作る、いま遊べるゲームカタログ。</p>

        <p className="hero-actions">
          <a className="cta lg live" href="#games">
            作品を見る
          </a>
          <a
            className="cta lg ghost"
            href="https://github.com/XenithONE/alice-system"
            target="_blank"
            rel="noreferrer"
          >
            制作を見る
          </a>
        </p>
      </div>

      {/* The reader's invitation down — decorative, and scrubbed away within
          the first 12svh of scroll where timelines exist. */}
      <div className="hero-cue" aria-hidden="true">
        <span className="hero-cue-track">
          <span className="hero-cue-dash" />
        </span>
        <span className="hero-cue-label">SCROLL</span>
      </div>

      {/*
        * The wire ticker: the catalogue's headline numbers on a slow loop at
        * the masthead's foot. aria-hidden — .hero-signal above already
        * announces the same facts — and the track is two identical runs so
        * the -50% loop is seamless. Numbers come from CATALOG like everything
        * else, so appending a Work updates the wire too.
        */}
      <div className="wire-ticker" aria-hidden="true">
        <p className="wire-ticker-track">
          {[0, 1].map((n) => (
            <span key={n} className="wire-ticker-run">
              ▶ {playable} PLAYABLE NOW · ◆ AI-BUILT CATALOG · ✦ 全{CATALOG.length}作品 · SIGNAL ISSUE · EST. 2026 ·
            </span>
          ))}
        </p>
      </div>
    </section>
  );
}
