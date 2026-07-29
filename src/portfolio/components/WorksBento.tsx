import { useMemo, useState } from "react";
import { CATALOG, packedOrder } from "../bento";
import { BentoTile } from "./BentoTile";
import type { Work } from "../../data/works";

type Filter = "all" | "play" | "store" | "experiments";

const FILTERS: { id: Filter; label: string; glyph: string }[] = [
  { id: "all", label: "ALL", glyph: "" },
  { id: "play", label: "PLAY IN BROWSER", glyph: "▶" },
  { id: "store", label: "STORE & DOWNLOAD", glyph: "◆" },
  { id: "experiments", label: "EXPERIMENTS", glyph: "✦" }
];

const MATCH: Record<Filter, (w: Work) => boolean> = {
  all: () => true,
  play: (w) => w.status === "playable" && w.kind === "game",
  store: (w) => w.engine === "Unity" || w.status === "released" || w.status === "coming-soon",
  experiments: (w) => w.kind === "experience" || w.kind === "synth"
};

export function WorksBento({ onOpenDetail }: { onOpenDetail: (w: Work) => void }) {
  const [filter, setFilter] = useState<Filter>("all");

  // Packed once for the full catalogue; a filtered view is a subset of that
  // order, which keeps a work in the same relative position however you slice it.
  const ordered = useMemo(() => packedOrder(CATALOG), []);
  const shown = useMemo(() => ordered.filter(MATCH[filter]), [ordered, filter]);

  return (
    <section id="games" className="section works-section" aria-labelledby="games-title">
      <header className="section-head" data-reveal>
        <p className="section-index">01 / WORKS — 全{CATALOG.length}作品</p>
        <h2 id="games-title">
          遊べるものは、いま。
          <br />
          次のタイトルは、もうすぐ。
        </h2>
        <p className="section-lede">
          タイルの大きさは、その作品にかけた重さです。ブラウザで今すぐ遊べる作品と、Unityで制作中のタイトル。
        </p>
      </header>

      <div className="catalog-filter" role="group" aria-label="ライブラリの絞り込み">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            className={`filter-tab ${filter === f.id ? "is-active" : ""}`}
            onClick={() => setFilter(f.id)}
          >
            {f.glyph && <span aria-hidden="true">{f.glyph} </span>}
            {f.label}
          </button>
        ))}
      </div>

      <p className="visually-hidden" aria-live="polite">
        {shown.length}件を表示しています。
      </p>

      {/*
       * data-mode="filtered" flattens every tile to one size. A subset has no
       * "importance within the whole catalogue" to encode — sizing three
       * survivors by a ranking drawn from sixteen just looks arbitrary — and a
       * uniform grid also cannot develop holes, which a re-packed subset could.
       */}
      <ol
        className="bento-grid"
        data-mode={filter === "all" ? "packed" : "filtered"}
        aria-labelledby="games-title"
      >
        {shown.map((work, index) => (
          <BentoTile
            key={work.id}
            work={work}
            index={filter === "all" ? index : 99}
            onOpenDetail={onOpenDetail}
          />
        ))}
      </ol>
    </section>
  );
}
