import { useEffect, useId, useRef } from "react";

const BASE = import.meta.env.BASE_URL;

export interface ArcadeHouse {
  id: string;
  title: string;
  titleJa: string;
  href: string;
  cover: string;
  status: string;
  description: string;
}

export function ArcadeOverlay({
  house,
  onClose
}: {
  house: ArcadeHouse | null;
  onClose(): void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!house) return;
    const dialog = dialogRef.current;
    const iframe = iframeRef.current;
    if (!dialog) return;

    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    if (!dialog.open) dialog.showModal();
    closeRef.current?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    let iframeDocument: Document | null = null;
    const attachIframeKeydown = (): void => {
      iframeDocument?.removeEventListener("keydown", onKeyDown);
      iframeDocument = iframe?.contentDocument ?? null;
      iframeDocument?.addEventListener("keydown", onKeyDown);
    };

    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const previousBodyStyle = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      left: document.body.style.left,
      width: document.body.style.width
    };
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = `-${scrollX}px`;
    document.body.style.width = "100%";

    document.addEventListener("keydown", onKeyDown);
    iframe?.addEventListener("load", attachIframeKeydown);
    if (iframe?.contentDocument?.readyState === "complete") attachIframeKeydown();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      iframe?.removeEventListener("load", attachIframeKeydown);
      iframeDocument?.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousBodyStyle.overflow;
      document.body.style.position = previousBodyStyle.position;
      document.body.style.top = previousBodyStyle.top;
      document.body.style.left = previousBodyStyle.left;
      document.body.style.width = previousBodyStyle.width;
      window.scrollTo(scrollX, scrollY);
      returnFocusRef.current?.focus({ preventScroll: true });
      returnFocusRef.current = null;
    };
  }, [house, onClose]);

  if (!house) return null;

  const openDevStatus = (): void => {
    onClose();
    if (house.href.startsWith("#")) {
      window.setTimeout(() => {
        document.querySelector<HTMLElement>(house.href)?.scrollIntoView({ behavior: "smooth" });
      }, 0);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="hb-arcade"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="hb-arcade-bar">
        <button ref={closeRef} className="hb-arcade-close" type="button" onClick={onClose}>
          <span aria-hidden="true">◀</span> 港に戻る
        </button>
        <h2 id={titleId}>
          <span>{house.title}</span>
          <small>{house.titleJa}</small>
        </h2>
        {house.status === "playable" ? (
          <a
            className="hb-arcade-external"
            href={`${BASE}${house.href}`}
            target="_blank"
            rel="noreferrer"
          >
            <span aria-hidden="true">⛶</span> 別タブで開く
          </a>
        ) : (
          <span className="hb-arcade-status">IN DEVELOPMENT</span>
        )}
        <small className="hb-arcade-escape-hint">ESC で港に戻る</small>
      </header>

      {house.status === "playable" ? (
        <iframe
          ref={iframeRef}
          src={`${BASE}${house.href}`}
          title={house.title}
          className="hb-arcade-frame"
          allow="autoplay; fullscreen; gamepad"
        />
      ) : (
        <section className="hb-arcade-showcase">
          <img src={`${BASE}${house.cover}`} alt={`${house.title} キービジュアル`} />
          <div className="hb-arcade-showcase-copy">
            <p className="hb-arcade-kicker">GAME HOUSE / WORK IN PROGRESS</p>
            <h3>{house.title}</h3>
            <p>{house.description}</p>
            <div
              className="hb-arcade-progress"
              role="progressbar"
              aria-label="制作進捗"
              aria-valuetext="制作中"
            >
              <span />
            </div>
            <button type="button" onClick={openDevStatus}>
              制作状況を見る <span aria-hidden="true">→</span>
            </button>
          </div>
        </section>
      )}
    </dialog>
  );
}
