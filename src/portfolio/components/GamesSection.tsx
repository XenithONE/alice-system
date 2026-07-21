import { useMemo, useState } from "react";
import { WORKS, type Work } from "../../data/works";
import { GameCard } from "./GameCard";

type Filter = "all" | "play" | "store" | "experiments";

const FILTERS: { id: Filter; label: string; glyph: string }[] = [
  { id: "all", label: "ALL", glyph: "" },
  { id: "play", label: "PLAY IN BROWSER", glyph: "▶" },
  { id: "store", label: "STORE & DOWNLOAD", glyph: "◆" },
  { id: "experiments", label: "EXPERIMENTS", glyph: "✦" }
];

const isStudio = (w: Work): boolean => w.engine === "Unity" || w.status === "released" || w.status === "coming-soon";
const isExperiment = (w: Work): boolean => w.kind === "experience" || w.kind === "synth";
const isBrowserGame = (w: Work): boolean => w.status === "playable" && w.kind === "game";

interface GroupProps {
  id: string;
  eyebrow: string;
  title: string;
  note: string;
  works: Work[];
  variant: "strip" | "grid";
  onOpenDetail: (w: Work) => void;
}

function Group({ id, eyebrow, title, note, works, variant, onOpenDetail }: GroupProps) {
  if (works.length === 0) return null;
  return (
    // No data-reveal here: groups mount/unmount as filters change, and useReveal
    // only observes nodes present at initial mount — gating this would leave
    // filter-swapped groups stuck at opacity:0. Groups render visible immediately.
    <div className={`game-group ${variant}`}>
      <header className="group-head">
        <p className="group-eyebrow">
          <i className="tick" aria-hidden="true" /> {eyebrow}
        </p>
        <h3 id={id}>{title}</h3>
        <p className="group-note">{note}</p>
      </header>
      <ol className={variant === "strip" ? "shelf-strip" : "shelf-grid"} aria-labelledby={id}>
        {works.map((w) => (
          <li key={w.id}>
            <GameCard
              work={w}
              index={WORKS.indexOf(w)}
              total={WORKS.length}
              onOpenDetail={onOpenDetail}
              eager={WORKS.indexOf(w) < 2}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

export function GamesSection({ onOpenDetail }: { onOpenDetail: (w: Work) => void }) {
  const [filter, setFilter] = useState<Filter>("all");

  const groups = useMemo(
    () => ({
      studio: WORKS.filter(isStudio),
      browser: WORKS.filter(isBrowserGame),
      experiments: WORKS.filter(isExperiment)
    }),
    []
  );

  const flat = useMemo(() => {
    if (filter === "play") return groups.browser;
    if (filter === "store") return groups.studio;
    if (filter === "experiments") return groups.experiments;
    return [];
  }, [filter, groups]);

  return (
    <section id="games" className="section games-section" aria-labelledby="games-title">
      <header className="section-head" data-reveal>
        <p className="section-index">01 / GAMES — 作品ライブラリ</p>
        <h2 id="games-title">
          遊べるものは、いま。
          <br />
          次のタイトルは、もうすぐ。
        </h2>
        <p className="section-lede">
          ブラウザで今すぐ遊べる作品と、Unityで制作中のタイトル。すべてAIと共に組み上げています。
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

      {filter === "all" ? (
        <div className="catalog-groups">
          <Group
            id="grp-studio"
            eyebrow="COMING FROM THE STUDIO — 制作中"
            title="スタジオの新作"
            note="Unityで開発中。トレーラーとストアは近日公開。"
            works={groups.studio}
            variant="grid"
            onOpenDetail={onOpenDetail}
          />
          <Group
            id="grp-browser"
            eyebrow="NOW PLAYING — 今すぐ遊べる"
            title="ブラウザで、いま遊ぶ"
            note="インストール不要。クリックしてその場でプレイ。"
            works={groups.browser}
            variant="strip"
            onOpenDetail={onOpenDetail}
          />
          <Group
            id="grp-exp"
            eyebrow="EXPERIMENTS — 実験作"
            title="実験と、道具箱"
            note="シェーダやオーディオの遊び場。"
            works={groups.experiments}
            variant="grid"
            onOpenDetail={onOpenDetail}
          />
        </div>
      ) : (
        <ol className="shelf-grid catalog-flat" aria-label={`絞り込み: ${filter}`}>
          {flat.map((w) => (
            <li key={w.id}>
              <GameCard work={w} index={WORKS.indexOf(w)} total={WORKS.length} onOpenDetail={onOpenDetail} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
