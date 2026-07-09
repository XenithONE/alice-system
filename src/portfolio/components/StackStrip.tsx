import { AI_TOOLS } from "../../data/works";

export function StackStrip() {
  return (
    <section className="stack-strip" aria-label="AI stack" data-reveal>
      <div className="stack-inner">
        <span className="stack-caption">AI STACK — 全ツール最上位プランで運用</span>
        <div className="stack-row">
          {AI_TOOLS.map((tool) => (
            <span key={tool} className="stack-badge">
              {tool}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
