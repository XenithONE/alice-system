export function SiteNav() {
  return (
    <header className="site-nav site-header">
      <div className="site-nav-shell">
        <a className="wordmark site-brand" href="#top" data-magnetic aria-label="AlicE sYsTeM ホーム">
          AlicE sYsTeM
        </a>
        <nav className="site-primary-nav" aria-label="主要セクション">
          <a href="#works" data-magnetic>
            WORKS
          </a>
          <a href="#ai-lab" data-magnetic>
            LAB
          </a>
          <a href="#prompts" data-magnetic>
            PROMPTS
          </a>
        </nav>
      </div>
    </header>
  );
}
