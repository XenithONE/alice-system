import { CATALOG } from "../bento";
import { HeroCanvas } from "./HeroCanvas";

/*
 * Signal Issue masthead — brand-first, full-bleed WebGL signal behind type.
 *
 * Numbers still come from CATALOG so the page never contradicts the nav
 * ticker. Contents list and tallies used to live here; they duplicated the
 * sticky nav and crowded the brand off the first viewport.
 */

export function EditorialHero() {
  const playable = CATALOG.filter((w) => w.status === "playable").length;

  return (
    <section className="hero" id="hero">
      <HeroCanvas />
      <div className="hero-scan" aria-hidden="true" />

      <div className="hero-lockup">
        <p className="section-index hero-folio">00 / SIGNAL ISSUE</p>

        <h1 className="hero-title">
          <span className="hero-line">AlicE</span>
          <span className="hero-line">
            sYs<em>Te</em>M
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
