import { CATALOG } from "../bento";

const GITHUB_REPOSITORY = "https://github.com/XenithONE/alice-system";

export function Footer() {
  return (
    <footer id="closing" className="site-footer" aria-labelledby="closing-title">
      <section className="closing-cta">
        <p className="section-index">06 / NEXT TITLE</p>
        <h2 id="closing-title">
          次のタイトルを、
          <br />
          一緒に待ってほしい。
        </h2>
        <p className="closing-copy">
          遊べる作品はいますぐ。制作中のタイトルは、公開したらここに並びます。AIと組んで、作り続ける。
        </p>

        <div className="footer-actions">
          <a className="cta lg wishlist is-static" aria-hidden="true">
            <span aria-hidden="true">◆</span> WISHLIST — COMING SOON
          </a>
          <a className="cta lg ghost" href={GITHUB_REPOSITORY} target="_blank" rel="noreferrer" data-magnetic>
            GitHubで制作を見る ↗
          </a>
        </div>

        {/*
          * A colophon. The footer carried three unrelated fragments — END OF
          * REEL, a copyright line and a giant wordmark — and on a site whose
          * subject is "made with AI", naming its own tools is the one closing
          * device that ties 04 / STACK to the end of the document.
          * Every value is already imported or literal: no new JS.
          */}
        <dl className="colophon" data-reveal>
          <div>
            <dt>TYPESET IN</dt>
            <dd>Barlow Condensed · Shippori Mincho · Noto Sans JP · Space Mono</dd>
          </div>
          <div>
            <dt>BUILT WITH</dt>
            <dd>React · Vite · TypeScript</dd>
          </div>
          <div>
            <dt>WORKS</dt>
            <dd>{CATALOG.length}</dd>
          </div>
          <div>
            <dt>VERSION</dt>
            <dd>v{__APP_VERSION__}</dd>
          </div>
        </dl>

        <div className="reel-end" data-reveal aria-hidden="true">
          <span className="reel-end-mark">END OF REEL</span>
        </div>
      </section>

      <div className="footer-shell">
        <nav className="footer-nav" aria-label="フッターナビゲーション">
          <a href="#games">GAMES</a>
          <a href="#ai-lab">LAB</a>
          <a href="#prompts">PROMPTS</a>
          <a href={GITHUB_REPOSITORY} target="_blank" rel="noreferrer">
            GITHUB
          </a>
        </nav>
        <p className="footer-meta">© 2026 AlicE sYsTeM — AI GAME STUDIO / v{__APP_VERSION__}</p>
      </div>

      <p className="footer-wordmark" aria-hidden="true">
        <span>Alic</span>
        <span className="footer-wordmark-accent">E</span>
        <span> s</span>
        <span className="footer-wordmark-accent">Y</span>
        <span>sTe</span>
        <span className="footer-wordmark-accent">M</span>
      </p>
    </footer>
  );
}
