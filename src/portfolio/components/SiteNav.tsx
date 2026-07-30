import { CATALOG } from "../bento";
import { STUDIO_TALLY } from "../../data/works";

/*
 * The ticker counts the catalogue, not WORKS.
 *
 * STUDIO_TALLY is derived from works.ts alone, so the bar said "12 LIVE"
 * while the masthead two lines below said 14 playable and the works section
 * said 全16作品 — the arena games are works on this page and were missing
 * from every number the nav showed.
 */
const LIVE = CATALOG.filter((w) => w.status === "playable").length;

export function SiteNav() {
  return (
    <header className="site-nav">
      <div className="site-nav-shell">
        <a className="site-brand" href="#hero" data-magnetic aria-label="AlicE sYsTeM ホーム">
          AlicE sYsTeM
          <span className="site-brand-tag">INDIE GAME STUDIO</span>
        </a>

        <p className="studio-ticker" aria-label={`${LIVE}タイトルが今すぐ遊べます、${STUDIO_TALLY.inDev}タイトルが開発中`}>
          <span className="tk live">
            <i className="dot" aria-hidden="true" />
            {LIVE} LIVE
          </span>
          <span className="tk dev">
            <i className="dot" aria-hidden="true" />
            {STUDIO_TALLY.inDev} IN DEV
          </span>
        </p>

        <nav className="site-primary-nav" aria-label="主要セクション">
          <a href="#featured" data-magnetic>FEATURED</a>
          <a href="#games" data-magnetic>WORKS</a>
          <a href="#ai-lab" data-magnetic>LAB</a>
          <a href="#prompts" data-magnetic>PROMPTS</a>
          <a href="#stack" data-magnetic>STACK</a>
        </nav>
      </div>
    </header>
  );
}
