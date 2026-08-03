import { useEffect, useMemo, useRef, useState } from "react";
import { CATALOG, packedOrder } from "../bento";
import { BentoTile } from "./BentoTile";
import { useMotion } from "../motion";
import type { Work } from "../../data/works";

/*
 * Pointer tilt for the plate wall. One delegated listener set on the grid,
 * one rAF, and only the tile under the pointer is ever touched: its rect is
 * read once on enter, will-change is granted for the hover's duration only,
 * and the transform is written directly (no transition — the follow IS the
 * animation; the release snaps, which at 2.2° reads as a plate settling).
 *
 * Property ownership holds: transform = pointer (this), translate = reveal,
 * scale = hover zoom. Max 2.2° — a plate on a wall, not a card trick.
 */
const TILT_DEG = 2.2;

function usePlateTilt(gridRef: React.RefObject<HTMLOListElement | null>, motion: boolean): void {
  useEffect(() => {
    const grid = gridRef.current;
    if (!motion || !grid) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    let tile: HTMLElement | null = null;
    let rect: DOMRect | null = null;
    let raf = 0;
    let px = 0;
    let py = 0;

    const apply = (): void => {
      raf = 0;
      if (!tile || !rect) return;
      const rx = ((py - (rect.top + rect.height / 2)) / rect.height) * -TILT_DEG;
      const ry = ((px - (rect.left + rect.width / 2)) / rect.width) * TILT_DEG;
      tile.style.transform = `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
    };
    const release = (): void => {
      if (tile) {
        tile.style.transform = "";
        tile.style.willChange = "";
      }
      tile = null;
      rect = null;
    };
    const onOver = (e: PointerEvent): void => {
      const next = (e.target as HTMLElement | null)?.closest<HTMLElement>(".bento-tile") ?? null;
      if (next === tile) return;
      release();
      if (!next) return;
      tile = next;
      rect = next.getBoundingClientRect();
      next.style.willChange = "transform";
    };
    const onMove = (e: PointerEvent): void => {
      px = e.clientX;
      py = e.clientY;
      if (!raf) raf = window.requestAnimationFrame(apply);
    };
    const onOut = (e: PointerEvent): void => {
      const to = e.relatedTarget as HTMLElement | null;
      if (tile && (!to || !tile.contains(to))) release();
    };

    grid.addEventListener("pointerover", onOver);
    grid.addEventListener("pointermove", onMove, { passive: true });
    grid.addEventListener("pointerout", onOut);
    return () => {
      window.cancelAnimationFrame(raf);
      release();
      grid.removeEventListener("pointerover", onOver);
      grid.removeEventListener("pointermove", onMove);
      grid.removeEventListener("pointerout", onOut);
    };
  }, [gridRef, motion]);
}

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
  const gridRef = useRef<HTMLOListElement | null>(null);
  usePlateTilt(gridRef, useMotion());

  // Packed once for the full catalogue; a filtered view is a subset of that
  // order, which keeps a work in the same relative position however you slice it.
  const ordered = useMemo(() => packedOrder(CATALOG), []);
  const shown = useMemo(() => ordered.filter(MATCH[filter]), [ordered, filter]);

  return (
    <section id="games" className="section works-section" aria-labelledby="games-title">
      <header className="section-head" data-reveal>
        <p className="section-index">02 / WORKS — 全{CATALOG.length}作品</p>
        <h2 id="games-title">
          遊べるものは、いま。
          <br />
          次のタイトルは、もうすぐ。
        </h2>
        <p className="section-lede">
          ブラウザで今すぐ遊べる作品と、Unity で制作中のタイトル。
          <br />
          大きいタイルほど、長く手をかけています。
        </p>
      </header>

      {/*
        * The one line worth setting large. It was the first clause of the
        * lede — the sentence that explains the whole grid, buried at 16px in
        * a paragraph nobody reads before they start looking at pictures.
        * Promoting it is what an editor does with a lede's best sentence.
        */}
      <p className="pull-quote" data-reveal>
        タイルの大きさは、
        <br />
        その作品にかけた重さです。
      </p>

      <div className="catalog-filter" role="group" aria-label="ライブラリの絞り込み">
        <p className="catalog-filter-label" aria-hidden="true">
          SCAN /
        </p>
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
        ref={gridRef}
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
