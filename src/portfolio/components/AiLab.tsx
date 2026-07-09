import { useState } from "react";
import { COMPARISONS, type Comparison, type ComparisonEntry } from "../../data/comparisons";

const BASE = import.meta.env.BASE_URL;

function copyText(text: string): boolean {
  try {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to textarea path */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    return true;
  } catch {
    return false;
  }
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      data-magnetic
      className={`copy-btn ${copied ? "done" : ""}`}
      onClick={() => {
        if (copyText(text)) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }
      }}
    >
      {copied ? "COPIED ✓" : "COPY"}
    </button>
  );
}

function EntryCard({ entry }: { entry: ComparisonEntry }) {
  return (
    <figure className="lab-entry">
      <div className="lab-entry-head">
        <b>{entry.model}</b>
        <span className="ai-badge">{entry.tool}</span>
      </div>
      {entry.asset && entry.assetType === "video" ? (
        <video src={BASE + entry.asset} muted loop playsInline controls preload="metadata" />
      ) : entry.asset ? (
        <img src={BASE + entry.asset} alt={`${entry.model} output`} loading="lazy" />
      ) : (
        <pre className="lab-text">{entry.text}</pre>
      )}
      {entry.notes && <figcaption>{entry.notes}</figcaption>}
    </figure>
  );
}

function ComparisonBlock({ comparison }: { comparison: Comparison }) {
  return (
    <article className="lab-block" data-reveal>
      <div className="lab-block-head">
        <h3>{comparison.title}</h3>
        <div className="lab-chips">
          <span className="chip">{comparison.category.toUpperCase()}</span>
          <span className="chip">{comparison.date}</span>
        </div>
      </div>
      <blockquote className="lab-prompt">
        <pre>{comparison.prompt}</pre>
        <CopyButton text={comparison.prompt} />
      </blockquote>
      <div className="lab-entries">
        {comparison.entries.map((entry) => (
          <EntryCard key={entry.model} entry={entry} />
        ))}
      </div>
    </article>
  );
}

function LabEmptyState() {
  return (
    <div className="lab-empty" data-reveal>
      <span className="lab-empty-mark">COMPARISONS INCOMING</span>
      <p>
        grok 4.5 / gpt 5.6 / gemini 3.5 pro — 各社最新モデルのリリースを待って、
        同一プロンプトによる出力比較をここに掲載します。
      </p>
      <div className="lab-ghosts" aria-hidden="true">
        {["GROK 4.5", "GPT-5.6", "GEMINI 3.5 PRO"].map((name) => (
          <div key={name} className="lab-ghost">
            <span>{name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AiLab() {
  return (
    <section id="ai-lab" className="section">
      <div className="section-head" data-reveal>
        <span className="kicker">02 — AI LAB</span>
        <div className="section-head-copy">
          <h2>Model Comparisons</h2>
          <p className="section-lead">
            全ツール最上位プランだからできる、同一プロンプトでのAIモデル比較実験。
          </p>
        </div>
      </div>
      {COMPARISONS.length === 0 ? (
        <LabEmptyState />
      ) : (
        COMPARISONS.map((comparison) => <ComparisonBlock key={comparison.id} comparison={comparison} />)
      )}
    </section>
  );
}
