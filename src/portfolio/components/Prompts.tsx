import { PROMPTS } from "../../data/prompts";
import { CopyButton } from "./AiLab";

export function Prompts() {
  return (
    <section id="prompts" className="section">
      <div className="section-head" data-reveal>
        <span className="kicker">03 — PROMPTS</span>
        <div className="section-head-copy">
          <h2>Prompt Library</h2>
          <p className="section-lead">
            制作で実際に使っているプロンプトの型。ワンクリックでコピーできます。
          </p>
        </div>
      </div>
      <div className="prompt-grid">
        {PROMPTS.map((card, i) => (
          <article key={card.id} className="prompt-card" data-reveal style={{ "--reveal-i": i % 2 } as React.CSSProperties}>
            <div className="prompt-head">
              <h3>{card.title}</h3>
              <div className="lab-chips">
                <span className="ai-badge">{card.tool}</span>
                <span className="chip">{card.category.toUpperCase()}</span>
              </div>
            </div>
            <div className="prompt-body">
              <pre>{card.prompt}</pre>
              <div className="prompt-fade" aria-hidden="true" />
            </div>
            <div className="prompt-foot">
              {card.note && <p className="prompt-note">{card.note}</p>}
              <CopyButton text={card.prompt} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
