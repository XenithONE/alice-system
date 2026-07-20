import { useState } from "react";
import { PROMPTS, type PromptCard } from "../../data/prompts";
import { CopyButton } from "./AiLab";

const CATEGORY_LABELS: Record<PromptCard["category"], string> = {
  image: "IMAGE",
  video: "VIDEO",
  code: "CODE",
  music: "MUSIC"
};

function promptIndex(index: number): string {
  return String(index + 1).padStart(2, "0");
}

export function Prompts() {
  const [expandedId, setExpandedId] = useState(PROMPTS[0]?.id ?? "");

  return (
    <section id="prompts" className="section prompt-archive" data-chapter aria-labelledby="prompts-title">
      <header className="prompts-editorial" data-reveal>
        <p className="section-index">03 / PROMPT ARCHIVE</p>
        <h2 id="prompts-title">
          制作の裏側を、
          <br />
          再利用できる形で。
        </h2>
        <p>
          実際の制作で使用したプロンプトと手法を、
          <br />
          文脈ごとにアーカイブしています。
        </p>
      </header>

      <div className="prompt-accordion" role="region" aria-label="プロンプト一覧" data-reveal>
        {PROMPTS.map((prompt, index) => {
          const isExpanded = prompt.id === expandedId;
          const headingId = `prompt-heading-${prompt.id}`;
          const panelId = `prompt-panel-${prompt.id}`;

          return (
            <article key={prompt.id} className={`prompt-row ${isExpanded ? "is-expanded" : ""}`.trim()}>
              <h3 id={headingId} className="prompt-row-heading">
                <button
                  className="prompt-disclosure"
                  type="button"
                  aria-expanded={isExpanded}
                  aria-controls={panelId}
                  onClick={() =>
                    setExpandedId((currentId) => (currentId === prompt.id ? "" : prompt.id))
                  }
                >
                  <span className="prompt-row-index">{promptIndex(index)}</span>
                  <span className="prompt-row-title">{prompt.title}</span>
                  <span className="prompt-row-meta">
                    {prompt.tool} / {CATEGORY_LABELS[prompt.category]}
                  </span>
                  <span className="prompt-row-state" aria-hidden="true">
                    {isExpanded ? "CLOSE" : "OPEN"}
                  </span>
                </button>
              </h3>

              <div
                id={panelId}
                className="prompt-panel"
                role="region"
                aria-labelledby={headingId}
                hidden={!isExpanded}
              >
                <div className="prompt-panel-inner">
                  <pre>{prompt.prompt}</pre>
                  <div className="prompt-panel-actions">
                    {prompt.note ? <p className="prompt-note">{prompt.note}</p> : null}
                    <CopyButton
                      text={prompt.prompt}
                      label="COPY PROMPT"
                      accessibleLabel={`${prompt.title}をコピー`}
                    />
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
