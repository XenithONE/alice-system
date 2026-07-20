import { useEffect, useRef, useState } from "react";
import { COMPARISONS, type Comparison, type ComparisonEntry } from "../../data/comparisons";

const BASE = import.meta.env.BASE_URL;

const LAB_MODELS = ["GROK 4.5", "GPT-5.6", "GEMINI 3.5 PRO"] as const;
const PREPARATION_STAGES = [
  { label: "共通プロンプト", status: "準備中" },
  { label: "出力収集", status: "未実施" },
  { label: "人手レビュー", status: "未実施" },
  { label: "掲載判定", status: "待機中" }
] as const;

const WAVE_PATHS = [
  "M0 214 C74 194 96 240 164 220 C236 198 250 116 326 128 C394 138 404 206 474 194 C548 182 570 74 650 92 C700 104 724 138 760 126",
  "M0 228 C76 210 108 250 174 228 C244 204 258 136 324 144 C398 154 420 224 486 204 C554 184 574 96 646 108 C700 116 724 152 760 142",
  "M0 198 C76 176 104 226 166 204 C226 182 254 94 330 110 C406 126 420 190 480 180 C546 168 574 54 654 76 C704 90 730 122 760 112",
  "M0 242 C70 230 112 260 180 240 C248 220 274 164 334 166 C402 170 426 238 494 220 C564 200 594 126 658 132 C708 136 732 168 760 158"
] as const;

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // The browser may reject clipboard access outside a secure context.
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  } catch {
    return false;
  }
}

interface CopyButtonProps {
  text: string;
  label?: string;
  accessibleLabel?: string;
}

export function CopyButton({ text, label = "COPY", accessibleLabel }: CopyButtonProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (resetTimer.current !== undefined) window.clearTimeout(resetTimer.current);
    },
    []
  );

  const handleCopy = async (): Promise<void> => {
    if (resetTimer.current !== undefined) window.clearTimeout(resetTimer.current);
    const copied = await copyText(text);
    setCopyState(copied ? "copied" : "error");
    resetTimer.current = window.setTimeout(() => setCopyState("idle"), 1800);
  };

  const visibleLabel = copyState === "copied" ? "COPIED" : copyState === "error" ? "TRY AGAIN" : label;

  return (
    <span className="copy-control">
      <button
        type="button"
        data-magnetic
        className={`copy-btn ${copyState === "idle" ? "" : `is-${copyState}`}`.trim()}
        aria-label={accessibleLabel}
        onClick={() => void handleCopy()}
      >
        {visibleLabel}
      </button>
      <span className="visually-hidden" aria-live="polite">
        {copyState === "copied" ? "クリップボードにコピーしました" : copyState === "error" ? "コピーできませんでした" : ""}
      </span>
    </span>
  );
}

function ResearchWaveform() {
  return (
    <figure className="lab-waveform" aria-hidden="true">
      <svg viewBox="0 0 760 280" preserveAspectRatio="none" focusable="false">
        <g className="lab-waveform-guides">
          <line x1="76" y1="30" x2="76" y2="250" />
          <line x1="228" y1="30" x2="228" y2="250" />
          <line x1="380" y1="30" x2="380" y2="250" />
          <line x1="532" y1="30" x2="532" y2="250" />
          <line x1="684" y1="30" x2="684" y2="250" />
        </g>
        <g className="lab-waveform-lines">
          {WAVE_PATHS.map((path) => (
            <path key={path} d={path} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
        <g className="lab-waveform-points">
          <circle cx="228" cy="182" r="3" />
          <circle cx="380" cy="154" r="4" />
          <circle cx="532" cy="172" r="3" />
          <circle cx="684" cy="112" r="4" />
        </g>
      </svg>
      <figcaption>RESEARCH NOTEBOOK / VISUAL TRACE</figcaption>
    </figure>
  );
}

function PreparationMatrix() {
  return (
    <div className="lab-matrix-wrap">
      <p className="lab-scroll-hint" aria-hidden="true">
        ← 横にスクロール →
      </p>
      <table className="lab-matrix">
        <caption>次回モデル比較の準備状況</caption>
        <thead>
          <tr>
            <th scope="col">PROCESS</th>
            {LAB_MODELS.map((model) => (
              <th key={model} scope="col">
                {model}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PREPARATION_STAGES.map((stage) => (
            <tr key={stage.label}>
              <th scope="row">{stage.label}</th>
              {LAB_MODELS.map((model) => (
                <td key={model} data-status={stage.status}>
                  {stage.status}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="lab-matrix-note">数値評価は、実際の出力を収集してから掲載します。</p>
    </div>
  );
}

function EntryOutput({ entry }: { entry: ComparisonEntry }) {
  if (entry.asset && entry.assetType === "video") {
    return <video src={BASE + entry.asset} muted loop playsInline controls preload="metadata" />;
  }
  if (entry.asset) {
    return <img src={BASE + entry.asset} alt={`${entry.model}の比較出力`} loading="lazy" />;
  }
  return <pre className="lab-output-text">{entry.text ?? "出力は未登録です。"}</pre>;
}

function ComparisonResult({ comparison }: { comparison: Comparison }) {
  return (
    <article className="lab-result" data-reveal>
      <header className="lab-result-header">
        <p>
          {comparison.category.toUpperCase()} / {comparison.date}
        </p>
        <h3>{comparison.title}</h3>
      </header>
      <blockquote className="lab-result-prompt">
        <pre>{comparison.prompt}</pre>
        <CopyButton
          text={comparison.prompt}
          label="COPY PROMPT"
          accessibleLabel={`${comparison.title}の共通プロンプトをコピー`}
        />
      </blockquote>
      <div className="lab-result-outputs">
        {comparison.entries.map((entry) => (
          <figure key={entry.model} className="lab-result-output">
            <div className="lab-result-model">
              <strong>{entry.model}</strong>
              <span>{entry.tool}</span>
            </div>
            <EntryOutput entry={entry} />
            {entry.notes ? <figcaption>{entry.notes}</figcaption> : null}
          </figure>
        ))}
      </div>
    </article>
  );
}

function LabEmptyState() {
  return (
    <div className="lab-empty" role="status" data-reveal>
      <p className="lab-empty-label">DATASET / EMPTY</p>
      <h3>比較結果は、まだ公開していません。</h3>
      <p>
        同じ条件で生成した出力と、人の目によるレビューが揃ってから掲載します。
        現在は比較手順と共通プロンプトを準備中です。
      </p>
    </div>
  );
}

export function AiLab() {
  return (
    <section id="ai-lab" className="section lab-notebook" data-chapter aria-labelledby="lab-title">
      <div className="lab-notebook-grid">
        <div className="lab-editorial" data-reveal>
          <p className="section-index">02 / AI LAB</p>
          <h2 id="lab-title">
            同じ問いを、
            <br />
            違う知性へ。
          </h2>
          <p>
            同一プロンプトに対する複数モデルの応答を比較し、
            思考の傾向とアウトプットの差異を記録する実験ノート。
          </p>
          <ResearchWaveform />
        </div>

        <div className="lab-preparation" data-reveal>
          <header className="lab-preparation-header">
            <p>MODEL PREPARATION MATRIX</p>
            <h3>次の比較実験を準備中</h3>
          </header>
          <PreparationMatrix />
        </div>
      </div>

      {COMPARISONS.length === 0 ? (
        <LabEmptyState />
      ) : (
        <section className="lab-results" aria-label="公開済みモデル比較">
          {COMPARISONS.map((comparison) => (
            <ComparisonResult key={comparison.id} comparison={comparison} />
          ))}
        </section>
      )}
    </section>
  );
}
