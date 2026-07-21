import { STUDIO_TALLY } from "../../data/works";

export function SiteNav() {
  return (
    <header className="site-nav">
      <div className="site-nav-shell">
        <a className="site-brand" href="#top" data-magnetic aria-label="AlicE sYsTeM ホーム">
          AlicE sYsTeM
          <span className="site-brand-tag">INDIE GAME STUDIO</span>
        </a>

        <p className="studio-ticker" aria-label={`${STUDIO_TALLY.live}タイトルが今すぐ遊べます、${STUDIO_TALLY.inDev}タイトルが開発中`}>
          <span className="tk live">
            <i className="dot" aria-hidden="true" />
            {STUDIO_TALLY.live} LIVE
          </span>
          <span className="tk dev">
            <i className="dot" aria-hidden="true" />
            {STUDIO_TALLY.inDev} IN DEV
          </span>
        </p>

        <nav className="site-primary-nav" aria-label="主要セクション">
          <a href="#top" data-magnetic>NOW SHOWING</a>
          <a href="#games" data-magnetic>GAMES</a>
          <a href="#ai-lab" data-magnetic>LAB</a>
          <a href="#prompts" data-magnetic>PROMPTS</a>
        </nav>
      </div>
    </header>
  );
}
