export function SiteNav() {
  return (
    <header className="site-nav">
      <div className="site-nav-shell">
        <a className="wordmark" href="#top" data-magnetic>
          AlicE <b>sYsTeM</b>
        </a>
        <nav aria-label="sections">
          <a href="#works" data-magnetic>
            WORKS
          </a>
          <a href="#ai-lab" data-magnetic>
            AI LAB
          </a>
          <a href="#prompts" data-magnetic>
            PROMPTS
          </a>
        </nav>
      </div>
    </header>
  );
}
