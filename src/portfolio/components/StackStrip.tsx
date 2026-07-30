import { AI_TOOLS } from "../../data/works";

export function StackStrip() {
  return (
    <section id="stack" className="stack-rail" aria-labelledby="stack-title" data-reveal>
      <div className="stack-rail-inner">
        {/* The folio series ran 01, 02, 03, then 05 — this section had no
            number. A numbering system with a gap is worse than none. */}
        <p className="section-index">04 / STACK</p>
        <h2 id="stack-title">AI STACK</h2>
        <p className="stack-rail-caption">制作ごとに最適なモデルを選び、組み合わせて運用。</p>
        <ul className="stack-rail-list">
          {AI_TOOLS.map((tool) => (
            <li key={tool}>{tool}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
