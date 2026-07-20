import { WORKS, type Work } from "../../data/works";

const BASE = import.meta.env.BASE_URL;

const KIND_LABELS: Record<Work["kind"], string> = {
  game: "BROWSER GAME",
  synth: "WEB SYNTH",
  experience: "INTERACTIVE EXPERIENCE"
};

function accession(index: number): string {
  return `No.${String(index + 1).padStart(2, "0")}`;
}

/** Notify the GL monolith which work is under the pointer (it answers with a
 * seam pulse — the "crack projection" reaction). */
function emitHover(index: number | null): void {
  window.dispatchEvent(new CustomEvent("alice:work-hover", { detail: { index } }));
}

export function Works() {
  return (
    <section id="works" className="section works-catalog" data-chapter aria-labelledby="works-title">
      <header className="catalog-head" data-reveal>
        <p className="section-index">01 / WORKS — 作品保管庫</p>
        <h2 id="works-title">
          十の機械を、
          <br />
          組み上げた。
        </h2>
        <p className="catalog-lede">
          ブラウザで遊べるゲーム、実験的なプロトタイプ。
          AIと共に壊し、直し、公開してきた記録。
        </p>
      </header>

      <ol className="catalog" aria-label={`全${WORKS.length}作品`}>
        {WORKS.map((work, index) => (
          <li key={work.id} data-reveal>
            <a
              className="catalog-row"
              href={BASE + work.href}
              onMouseEnter={() => emitHover(index)}
              onMouseLeave={() => emitHover(null)}
              onFocus={() => emitHover(index)}
              onBlur={() => emitHover(null)}
            >
              <span className="cat-no" aria-hidden="true">
                {accession(index)}
                <i>/ {String(WORKS.length).padStart(2, "0")}</i>
              </span>
              <span className="cat-cover">
                <img src={BASE + work.cover} alt="" loading={index < 2 ? "eager" : "lazy"} draggable="false" />
              </span>
              <span className="cat-body">
                <strong className="cat-title">{work.title}</strong>
                <span className="cat-ja">{work.titleJa}</span>
                <span className="cat-desc">{work.description}</span>
              </span>
              <span className="cat-meta">
                <span className="cat-kind">{KIND_LABELS[work.kind]}</span>
                <span className="cat-tags">{work.tags.join(" · ")}</span>
                <span className="cat-tools">{work.aiTools.join(" / ")} — {work.year}</span>
              </span>
              <span className="cat-open" aria-hidden="true">
                PLAY<i>↗</i>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
