import { useEffect, useRef } from "react";
import type { Work } from "../../data/works";
import { StatusBadge, PlatformRow, EngineChip, MadeWith } from "./badges";

const BASE = import.meta.env.BASE_URL;

/** Accessible detail sheet. This is the content-injection surface: a Unity
 * coming-soon title renders fully from placeholder cover + description, then
 * gains trailer / screenshots / store buttons as the data is filled in. */
export function GameDetail({ work, onClose }: { work: Work | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (work && !d.open) d.showModal();
    else if (!work && d.open) d.close();
  }, [work]);

  const onBackdrop = (e: React.MouseEvent<HTMLDialogElement>): void => {
    if (e.target === ref.current) onClose();
  };

  return (
    <dialog ref={ref} className="game-detail" onClose={onClose} onClick={onBackdrop} aria-label="タイトル詳細">
      {work && (
        <div className="detail-shell">
          <button type="button" className="detail-close" onClick={onClose} aria-label="閉じる">
            ✕
          </button>

          <div className="detail-media">
            {work.trailer ? (
              <video src={BASE + work.trailer} poster={BASE + work.cover} controls playsInline preload="metadata" />
            ) : (
              <img src={BASE + work.cover} alt={`${work.title} のキーアート`} />
            )}
          </div>

          <div className="detail-body">
            <div className="detail-badges">
              <StatusBadge status={work.status} />
              <EngineChip engine={work.engine} />
              <PlatformRow platform={work.platform} />
            </div>
            <h2 className="detail-title">{work.title}</h2>
            <p className="detail-ja">{work.titleJa}</p>
            <p className="detail-desc">{work.description}</p>

            {typeof work.progress === "number" && (work.status === "in-dev" || work.status === "coming-soon") && (
              <div className="detail-progress" role="img" aria-label={`開発進捗 約${Math.round(work.progress * 100)}%`}>
                <span className="bar" style={{ width: `${Math.round(work.progress * 100)}%` }} />
                <span className="label">
                  開発進捗 {Math.round(work.progress * 100)}%{work.releaseWindow ? ` · 予定 ${work.releaseWindow}` : ""}
                </span>
              </div>
            )}

            {work.screenshots && work.screenshots.length > 0 && (
              <div className="detail-shots">
                {work.screenshots.map((s, i) => (
                  <img key={i} src={BASE + s} alt={`${work.title} スクリーンショット ${i + 1}`} loading="lazy" />
                ))}
              </div>
            )}

            <div className="detail-actions">
              {work.status === "playable" && (
                <a className="cta lg live" href={BASE + work.href} {...(work.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                  <span aria-hidden="true">▶</span> {work.kind === "synth" ? "スタジオを開く" : "プレイする"}
                </a>
              )}
              {work.storeLinks?.steam && (
                <a className="cta lg wishlist" href={work.storeLinks.steam} target="_blank" rel="noopener noreferrer">
                  <span aria-hidden="true">◆</span> Steam <i aria-hidden="true">↗</i>
                </a>
              )}
              {work.storeLinks?.itch && (
                <a className="cta lg wishlist" href={work.storeLinks.itch} target="_blank" rel="noopener noreferrer">
                  <span aria-hidden="true">✦</span> itch.io <i aria-hidden="true">↗</i>
                </a>
              )}
              {work.storeLinks?.download && (
                <a className="cta lg download" href={work.storeLinks.download} target="_blank" rel="noopener noreferrer">
                  <span aria-hidden="true">↓</span> ダウンロード
                </a>
              )}
              {(work.status === "in-dev" || work.status === "coming-soon") && !work.storeLinks && (
                <span className="cta lg dev is-static">
                  <span aria-hidden="true">◷</span> ストアページ近日公開
                </span>
              )}
            </div>

            <div className="detail-meta">
              <span className="detail-tags">{work.tags.join(" · ")} — {work.year}</span>
              <MadeWith tools={work.aiTools} />
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}
