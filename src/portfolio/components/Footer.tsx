const GITHUB_REPOSITORY = "https://github.com/XenithONE/alice-system";

export function Footer() {
  return (
    <footer id="closing" className="site-footer" aria-labelledby="closing-title">
      <section className="closing-cta">
        <p className="section-index">05 / NEXT TITLE</p>
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

        <div className="reel-end" data-reveal aria-hidden="true">
          <span className="reel-end-mark">END OF REEL</span>
          <span className="reel-end-caption">AlicE sYsTeM — BUILT WITH AI · 2026</span>
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
