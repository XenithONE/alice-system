import { AI_TOOLS } from "../../data/works";

export function StackStrip() {
  return (
    <section className="stack-rail" aria-labelledby="stack-title" data-reveal>
      <div className="stack-rail-inner">
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
