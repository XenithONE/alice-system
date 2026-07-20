const GITHUB_REPOSITORY = "https://github.com/XenithONE/alice-system";

export function Footer() {
  return (
    <footer id="closing" className="site-footer" data-chapter data-creation-close aria-labelledby="closing-title">
      <section className="closing-cta">
        <p className="section-index">04 / 落款 — NEXT EXPERIMENT</p>
        <h2 id="closing-title">次の実験へ。</h2>
        <p className="closing-copy">描いては、組み上げる。AIと人のあいだの遊びは、まだ終わらない。</p>

        <div className="seal-wrap" data-reveal aria-hidden="true">
          <span className="seal">完</span>
          <span className="seal-caption">ALICE SYSTEM — SEALED 2026</span>
        </div>

        <a className="closing-cta-link" href={GITHUB_REPOSITORY} target="_blank" rel="noreferrer" data-magnetic>
          GitHubで制作を見る
        </a>
      </section>

      <div className="footer-shell">
        <nav className="footer-nav" aria-label="フッターナビゲーション">
          <a href="#works">WORKS</a>
          <a href="#ai-lab">LAB</a>
          <a href="#prompts">PROMPTS</a>
          <a href={GITHUB_REPOSITORY} target="_blank" rel="noreferrer">
            GITHUB
          </a>
        </nav>
        <p className="footer-meta">© 2026 AI CREATIVE WORKS / v{__APP_VERSION__}</p>
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
