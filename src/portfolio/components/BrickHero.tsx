import { useMemo, useRef, useState } from "react";
import { HeroRoot } from "../HeroRoot";
import type {
  HarborLandmark,
  HarborScene,
  HarborSceneState,
  HarborWorkItem
} from "../gl/harbor/harborScene";
import { WORKS } from "../../data/works";
import type { Work } from "../../data/works";

const BASE = import.meta.env.BASE_URL;

const DEFAULT_STATE: HarborSceneState = {
  mode: "intro",
  nearDock: false,
  activeWorkId: null,
  activeLandmark: "works",
  speed: 0,
  cinematicStop: 0,
  paused: false
};

const LANDMARKS: Array<{
  id: HarborLandmark;
  label: string;
  title: string;
  href: string;
}> = [
  { id: "works", label: "WORKS", title: "港の作品通り", href: "#games" },
  { id: "ai-lab", label: "AI LAB", title: "灯台の研究室", href: "#ai-lab" },
  { id: "prompts", label: "PROMPTS", title: "市場のアトリエ", href: "#prompts" },
  { id: "studio", label: "STUDIO", title: "城門のスタジオ", href: "#stack" }
];

function statusCopy(work: Work): string {
  if (work.status === "playable") return "PLAY NOW";
  if (work.status === "released") return "RELEASED";
  if (work.status === "coming-soon") return "COMING SOON";
  return "IN DEVELOPMENT";
}

function primaryHref(work: Work): string | null {
  if (work.status === "playable") return `${BASE}${work.href}`;
  if (work.storeLinks?.steam) return work.storeLinks.steam;
  if (work.storeLinks?.itch) return work.storeLinks.itch;
  if (work.storeLinks?.download) return work.storeLinks.download;
  return null;
}

function ProjectRail({
  work,
  onOpenDetail
}: {
  work: Work;
  onOpenDetail: (work: Work) => void;
}) {
  const href = primaryHref(work);
  return (
    <aside className="harbor-project-rail" aria-label={`${work.title} 作品情報`}>
      <button className="harbor-rail-close" type="button" onClick={() => onOpenDetail(work)}>
        詳細
      </button>
      <p className="harbor-rail-status">
        {statusCopy(work)} <span aria-hidden="true">·</span> {work.year}
      </p>
      <h2>{work.title}</h2>
      <p className="harbor-rail-ja">{work.titleJa}</p>
      <p className="harbor-rail-tags">{work.tags.join(" / ")}</p>
      <img src={`${BASE}${work.cover}`} alt="" />
      <p className="harbor-rail-description">{work.description}</p>
      <div className="harbor-rail-actions">
        {href ? (
          <a className="harbor-rail-primary" href={href}>
            今すぐ遊ぶ <span aria-hidden="true">→</span>
          </a>
        ) : (
          <button className="harbor-rail-primary" type="button" onClick={() => onOpenDetail(work)}>
            制作状況を見る <span aria-hidden="true">→</span>
          </button>
        )}
        <button className="harbor-rail-secondary" type="button" onClick={() => onOpenDetail(work)}>
          作品の詳細
        </button>
      </div>
    </aside>
  );
}

export function BrickHero({ onOpenDetail }: { onOpenDetail: (work: Work) => void }) {
  const isolatedSkiffReview =
    new URLSearchParams(window.location.search).get("skiff-review") === "1";
  const sceneRef = useRef<HarborScene | null>(null);
  const [state, setState] = useState<HarborSceneState>(DEFAULT_STATE);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [glLive, setGlLive] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);

  const harborWorks = useMemo<HarborWorkItem[]>(
    () =>
      WORKS.map((work) => ({
        id: work.id,
        title: work.title,
        titleJa: work.titleJa,
        cover: `${BASE}${work.cover}`,
        status: work.status
      })),
    []
  );

  const focusedWork = useMemo(() => {
    const id = state.activeWorkId ?? hoveredId;
    if (!id) return null;
    return WORKS.find((work) => work.id === id) ?? null;
  }, [hoveredId, state.activeWorkId]);

  const mobileWork = WORKS[0]!;

  const selectWork = (id: string): void => {
    const work = WORKS.find((item) => item.id === id);
    if (work) onOpenDetail(work);
  };

  const startVoyage = (): void => {
    if (sceneRef.current) {
      sceneRef.current.startVoyage();
      return;
    }
    document.getElementById("games")?.scrollIntoView({ behavior: "smooth" });
  };

  const visitLandmark = (index: number): void => {
    setMapOpen(false);
    if (sceneRef.current && state.mode === "cinematic") {
      sceneRef.current.goToLandmark(index);
      return;
    }
    const target = document.querySelector<HTMLElement>(LANDMARKS[index]!.href);
    target?.scrollIntoView({ behavior: "smooth" });
  };

  const modeAnnouncement =
    state.mode === "walking"
      ? state.activeWorkId
        ? `${focusedWork?.title ?? "作品"}を調べられます。`
        : state.nearDock
          ? "小舟に戻れます。"
          : "港の遊歩道を歩いています。"
      : state.mode === "sailing"
        ? state.nearDock
          ? "桟橋に到着しました。上陸できます。"
          : "小舟で港を航海しています。"
        : state.mode === "cinematic"
          ? `${LANDMARKS[state.cinematicStop]!.title}を巡っています。`
          : "航海の準備ができました。";

  return (
    <section
      id="top"
      className={`brick-hero harbor-hero mode-${state.mode} ${glLive ? "is-live" : "is-fallback"} ${isolatedSkiffReview ? "is-skiff-review" : ""}`}
      aria-labelledby="hero-title"
    >
      <div className="bh-stage">
        <HeroRoot
          poster={`${BASE}assets/harbor/alice-harbor-poster.webp`}
          works={harborWorks}
          onHoverWork={setHoveredId}
          onSelectWork={selectWork}
          onState={setState}
          onReady={(scene) => {
            sceneRef.current = scene;
          }}
          onLiveChange={setGlLive}
        />
      </div>

      <header className="harbor-nav">
        <a className="harbor-wordmark" href="#top" aria-label="AlicE sYsTeM ホーム">
          AlicE sYsTeM
        </a>
        <nav className="harbor-primary-nav" aria-label="主要セクション">
          <a href="#games">WORKS</a>
          <a href="#ai-lab">AI LAB</a>
          <a href="#prompts">PROMPT ARCHIVE</a>
          <button type="button" onClick={() => setMapOpen((open) => !open)} aria-expanded={mapOpen}>
            MAP
          </button>
        </nav>
        <button
          className="harbor-mobile-menu"
          type="button"
          onClick={() => setMapOpen((open) => !open)}
          aria-expanded={mapOpen}
        >
          MAP
        </button>
      </header>

      {state.mode === "intro" && (
        <div className="bh-lockup harbor-lockup">
          <h1 id="hero-title">港を旅して、作品を遊ぶ。</h1>
          <button className="harbor-start" type="button" onClick={startVoyage}>
            航海をはじめる <span aria-hidden="true">→</span>
          </button>
        </div>
      )}

      {state.mode === "sailing" && (
        <>
          <div className="harbor-controls harbor-controls-sail" aria-hidden="true">
            <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移動</span>
            <span>視点操作</span>
            <span><kbd>←</kbd><kbd>→</kbd> 舵を切る</span>
          </div>
          <button
            className={`harbor-interact ${state.nearDock ? "is-ready" : ""}`}
            type="button"
            onClick={() => sceneRef.current?.interact()}
            disabled={!state.nearDock}
          >
            {state.nearDock ? "E　上陸する" : "桟橋へ近づく"}
          </button>
        </>
      )}

      {state.mode === "walking" && (
        <>
          <div className="harbor-controls harbor-controls-walk" aria-hidden="true">
            <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 歩く</span>
            <span><kbd>SHIFT</kbd> 走る</span>
            <span><kbd>E</kbd> 調べる</span>
          </div>
          {(state.activeWorkId || state.nearDock) && (
            <button className="harbor-interact is-ready" type="button" onClick={() => sceneRef.current?.interact()}>
              {state.activeWorkId ? `E　${focusedWork?.title ?? "作品"}を調べる` : "E　小舟に戻る"}
            </button>
          )}
        </>
      )}

      {(state.mode === "sailing" || state.mode === "walking") && (
        <button className="harbor-minimap" type="button" onClick={() => setMapOpen(true)} aria-label="港の地図を開く">
          <img src={`${BASE}assets/harbor/alice-harbor-poster.webp`} alt="" />
          <span>MAP</span>
          <i aria-hidden="true" />
        </button>
      )}

      {state.mode === "walking" && focusedWork && (
        <ProjectRail work={focusedWork} onOpenDetail={onOpenDetail} />
      )}

      {state.mode === "cinematic" && (
        <>
          <div className="harbor-cinematic-tools">
            <button
              type="button"
              onClick={() => sceneRef.current?.setPaused(!state.paused)}
              aria-pressed={state.paused}
            >
              {state.paused ? "再生" : "一時停止"}
            </button>
            <span aria-hidden="true">左右にスワイプ</span>
          </div>
          <nav className="harbor-route" aria-label="シネマティック航路">
            {LANDMARKS.map((landmark, index) => (
              <button
                key={landmark.id}
                type="button"
                className={state.cinematicStop === index ? "is-active" : ""}
                onClick={() => sceneRef.current?.goToLandmark(index)}
              >
                <i aria-hidden="true" />
                {landmark.label}
              </button>
            ))}
          </nav>
          <section className="harbor-mobile-sheet" aria-labelledby="mobile-work-title">
            <p className="harbor-rail-status">
              {statusCopy(mobileWork)} <span aria-hidden="true">·</span> {mobileWork.year}
            </p>
            <h2 id="mobile-work-title">{mobileWork.title}</h2>
            <p className="harbor-rail-ja">{mobileWork.titleJa}</p>
            <img src={`${BASE}${mobileWork.cover}`} alt="" />
            <div className="harbor-mobile-actions">
              {primaryHref(mobileWork) ? (
                <a href={primaryHref(mobileWork)!}>今すぐ遊ぶ <span aria-hidden="true">→</span></a>
              ) : (
                <button type="button" onClick={() => onOpenDetail(mobileWork)}>作品を見る</button>
              )}
              <a href="#games">全作品を見る</a>
            </div>
          </section>
        </>
      )}

      {mapOpen && (
        <aside id="harbor-map" className="harbor-map-panel" aria-label="港の地図">
          <div className="harbor-map-head">
            <p>HARBOR MAP</p>
            <button type="button" onClick={() => setMapOpen(false)} aria-label="地図を閉じる">
              閉じる
            </button>
          </div>
          <img src={`${BASE}assets/harbor/alice-harbor-poster.webp`} alt="ブロック港町の全景" />
          <ol>
            {LANDMARKS.map((landmark, index) => (
              <li key={landmark.id}>
                <button type="button" onClick={() => visitLandmark(index)}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{landmark.label}</strong>
                  <small>{landmark.title}</small>
                </button>
              </li>
            ))}
          </ol>
        </aside>
      )}

      <p className="sr-only" aria-live="polite">
        {modeAnnouncement}
      </p>
      <a className="harbor-scroll-cue" href="#games">
        WORKS <span aria-hidden="true">↓</span>
      </a>
    </section>
  );
}
