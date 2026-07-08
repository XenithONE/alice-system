import { WORKS } from "../../data/works";

const BASE = import.meta.env.BASE_URL;

export function Works() {
  return (
    <section id="works" className="section">
      <div className="section-head" data-reveal>
        <span className="kicker">01 — WORKS</span>
        <h2>Games &amp; Apps</h2>
        <p className="section-lead">AIと共作したWebゲームとアプリ。すべてブラウザでそのまま遊べます。</p>
      </div>
      <div className="works-grid">
        {WORKS.map((work, i) => (
          <a
            key={work.id}
            className="work-card"
            href={BASE + work.href}
            data-reveal
            style={{ "--reveal-i": i % 3 } as React.CSSProperties}
          >
            <div className="work-cover">
              <img src={BASE + work.cover} alt={`${work.title} cover`} loading="lazy" />
            </div>
            <div className="work-meta">
              <div className="work-titles">
                <h3>{work.title}</h3>
                <span className="work-ja">{work.titleJa}</span>
              </div>
              <p className="work-desc">{work.description}</p>
              <div className="work-tags">
                {work.tags.map((tag) => (
                  <span key={tag} className="tag">{tag}</span>
                ))}
              </div>
              <div className="work-foot">
                <div className="work-ai">
                  {work.aiTools.map((tool) => (
                    <span key={tool} className="ai-badge">{tool}</span>
                  ))}
                </div>
                <span className="launch">LAUNCH ↗</span>
              </div>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
