import { useState, type KeyboardEvent } from "react";
import { WORKS, type Work } from "../../data/works";

const BASE = import.meta.env.BASE_URL;
const VISIBLE_PLANE_OFFSETS = [0, 1, 2] as const;

const KIND_LABELS: Record<Work["kind"], string> = {
  game: "BROWSER GAME",
  synth: "WEB SYNTH",
  experience: "INTERACTIVE EXPERIENCE"
};

function wrapIndex(index: number): number {
  return (index + WORKS.length) % WORKS.length;
}

function formatIndex(index: number): string {
  return String(index + 1).padStart(2, "0");
}

export function Works() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedWork = WORKS[selectedIndex];

  const selectPrevious = (): void => setSelectedIndex((current) => wrapIndex(current - 1));
  const selectNext = (): void => setSelectedIndex((current) => wrapIndex(current + 1));

  const handleDeckKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      selectPrevious();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      selectNext();
    } else if (event.key === "Home") {
      event.preventDefault();
      setSelectedIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setSelectedIndex(WORKS.length - 1);
    }
  };

  return (
    <section id="works" className="section works-showcase" aria-labelledby="works-title">
      <header className="works-editorial" data-reveal>
        <p className="section-index">01 / SELECTED WORKS</p>
        <h2 id="works-title">
          遊べる作品から、
          <br />
          AIとの制作過程まで。
        </h2>
        <p>
          ブラウザで遊べるゲームや実験的なプロトタイプ。
          <br />
          そしてAIと共に試行錯誤した制作過程を公開しています。
        </p>
      </header>

      <div className="works-layout">
        <article className="selected-work" aria-labelledby={`selected-work-${selectedWork.id}`}>
          <p className="selected-work-number">
            {formatIndex(selectedIndex)} / {String(WORKS.length).padStart(2, "0")}
          </p>
          <h3 id={`selected-work-${selectedWork.id}`}>{selectedWork.title}</h3>
          <p className="selected-work-ja">{selectedWork.titleJa}</p>
          <p className="selected-work-description">{selectedWork.description}</p>

          <dl className="selected-work-meta">
            <div>
              <dt>TYPE</dt>
              <dd>{KIND_LABELS[selectedWork.kind]}</dd>
            </div>
            <div>
              <dt>MODEL</dt>
              <dd>{selectedWork.aiTools.join(" / ")}</dd>
            </div>
            <div>
              <dt>YEAR</dt>
              <dd>{selectedWork.year}</dd>
            </div>
          </dl>

          <p className="selected-work-tags">{selectedWork.tags.join(" / ")}</p>
          <a className="selected-work-link" href={BASE + selectedWork.href} data-magnetic>
            VIEW PROJECT
          </a>
        </article>

        <div
          className="works-stage"
          role="region"
          aria-label="選択作品のポスターデッキ。左右矢印キーでも移動できます。"
          tabIndex={0}
          onKeyDown={handleDeckKeyDown}
        >
          {VISIBLE_PLANE_OFFSETS.map((offset) => {
            const workIndex = wrapIndex(selectedIndex + offset);
            const work = WORKS[workIndex];
            const position = offset === 0 ? "active" : offset === 1 ? "next" : "following";

            return (
              <button
                key={work.id}
                className="work-poster"
                type="button"
                data-plane-position={position}
                data-work-id={work.id}
                aria-label={`${work.title}を選択`}
                aria-pressed={offset === 0}
                onClick={() => setSelectedIndex(workIndex)}
              >
                <span className="work-poster-spine" aria-hidden="true">
                  <span>AlicE sYsTeM</span>
                  <span>{formatIndex(workIndex)}</span>
                </span>
                <span className="work-poster-media work-cover" data-gl-cover>
                  <img
                    src={BASE + (work.poster ?? work.cover)}
                    alt=""
                    loading={offset === 0 ? "eager" : "lazy"}
                    draggable="false"
                  />
                </span>
                <span className="work-poster-title" aria-hidden="true">
                  {work.title}
                </span>
              </button>
            );
          })}
          <p className="works-deck-hint" aria-hidden="true">
            <span>CLICK / SELECT</span>
            <span>← → KEY / MOVE</span>
          </p>
        </div>

        <nav className="works-navigation" aria-label="作品を選択">
          <div className="works-counter" aria-hidden="true">
            <strong>{formatIndex(selectedIndex)}</strong>
            <span>/ {String(WORKS.length).padStart(2, "0")}</span>
          </div>
          <div className="works-step-controls">
            <button type="button" onClick={selectPrevious} aria-label="前の作品">
              PREV
            </button>
            <button type="button" onClick={selectNext} aria-label="次の作品">
              NEXT
            </button>
          </div>
          <ol className="works-index">
            {WORKS.map((work, index) => (
              <li key={work.id}>
                <button
                  type="button"
                  aria-label={`${formatIndex(index)} ${work.title}を選択`}
                  aria-pressed={selectedIndex === index}
                  onClick={() => setSelectedIndex(index)}
                >
                  {formatIndex(index)}
                </button>
              </li>
            ))}
          </ol>
        </nav>
      </div>

      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {formatIndex(selectedIndex)}、{selectedWork.title}を表示中
      </p>

      <details className="works-all">
        <summary>View all {WORKS.length} works</summary>
        <ol className="works-all-list">
          {WORKS.map((work, index) => (
            <li key={work.id} className={selectedIndex === index ? "is-selected" : undefined}>
              <button
                type="button"
                aria-current={selectedIndex === index ? "true" : undefined}
                onClick={() => setSelectedIndex(index)}
              >
                <span>{formatIndex(index)}</span>
                <strong>{work.title}</strong>
                <span>{work.titleJa}</span>
                <span>{work.year}</span>
              </button>
              <a href={BASE + work.href} aria-label={`${work.title}を開く`}>
                OPEN
              </a>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
