import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  ARENA_GAMES,
  type ArenaGame,
  type ArenaGameId
} from "../../data/arenaGames";

const BASE = import.meta.env.BASE_URL;

export interface ArcadeHouse {
  id: string;
  title: string;
  titleJa: string;
  href: string;
  cover: string;
  status: string;
  description: string;
  arcadeMode?: "house" | "arena";
}

function baseHref(path: string): string {
  return `${BASE}${path.replace(/^\/+/, "")}`;
}

function ArenaLobby({
  onSelect,
  triggerRefs
}: {
  onSelect(game: ArenaGame): void;
  triggerRefs: React.MutableRefObject<Map<ArenaGameId, HTMLButtonElement>>;
}) {
  return (
    <section className="hb-arena-lobby" aria-labelledby="hb-arena-lobby-title">
      <header className="hb-arena-lobby-intro">
        <p>ALICE HARBOR / GRAND ARENA</p>
        <h3 id="hb-arena-lobby-title">二つの王冠。ひとつの闘技場。</h3>
        <span>競技を選択してください。ゲームは選択後に読み込まれます。</span>
      </header>

      <div className="hb-arena-games">
        {ARENA_GAMES.map((game, index) => (
          <button
            key={game.id}
            ref={(node) => {
              if (node) triggerRefs.current.set(game.id, node);
              else triggerRefs.current.delete(game.id);
            }}
            className="hb-arena-game"
            type="button"
            onClick={() => onSelect(game)}
            style={{ "--arena-card-index": index } as React.CSSProperties}
            aria-label={`${game.title}、${game.titleJa}を遊ぶ`}
          >
            <span className="hb-arena-game-media">
              <img
                src={baseHref(game.cover)}
                alt=""
                loading="eager"
                decoding="async"
              />
              <span className="hb-arena-game-number" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="hb-arena-game-enter">
                ENTER <span aria-hidden="true">↗</span>
              </span>
            </span>
            <span className="hb-arena-game-body">
              <span className="hb-arena-game-meta">
                {game.players} <i aria-hidden="true" /> {game.year}
              </span>
              <strong>{game.title}</strong>
              <small>{game.titleJa}</small>
              <span className="hb-arena-game-description">{game.description}</span>
              <span className="hb-arena-game-footer">
                <span className="hb-arena-game-tags" aria-label="ゲームの特徴">
                  {game.tags.map((tag) => <em key={tag}>{tag}</em>)}
                </span>
                <span className="hb-arena-game-engine">{game.engine}</span>
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
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
  const lobbyBackRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const selectedGameIdRef = useRef<ArenaGameId | null>(null);
  const pendingLobbyFocusRef = useRef<ArenaGameId | null>(null);
  const gameTriggerRefs = useRef<Map<ArenaGameId, HTMLButtonElement>>(new Map());
  const [selectedGameId, setSelectedGameId] = useState<ArenaGameId | null>(null);

  const isArena = house?.arcadeMode === "arena";
  const selectedGame = isArena
    ? ARENA_GAMES.find((game) => game.id === selectedGameId) ?? null
    : null;
  selectedGameIdRef.current = selectedGame?.id ?? null;

  const returnToLobby = useCallback((): void => {
    const previousGameId = selectedGameIdRef.current;
    if (!previousGameId) return;
    pendingLobbyFocusRef.current = previousGameId;
    selectedGameIdRef.current = null;
    setSelectedGameId(null);
  }, []);

  useEffect(() => {
    setSelectedGameId(null);
    selectedGameIdRef.current = null;
    pendingLobbyFocusRef.current = null;
  }, [house?.id]);

  useEffect(() => {
    if (selectedGameId !== null || !pendingLobbyFocusRef.current) return;
    const gameId = pendingLobbyFocusRef.current;
    pendingLobbyFocusRef.current = null;
    window.requestAnimationFrame(() => {
      gameTriggerRefs.current.get(gameId)?.focus({ preventScroll: true });
    });
  }, [selectedGameId]);

  useEffect(() => {
    if (!house) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    if (!dialog.open) dialog.showModal();
    closeRef.current?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (house.arcadeMode === "arena" && selectedGameIdRef.current) {
        returnToLobby();
      } else {
        onClose();
      }
    };

    const onMessage = (event: MessageEvent): void => {
      if (
        event.origin !== window.location.origin ||
        event.source !== iframeRef.current?.contentWindow ||
        !event.data ||
        typeof event.data !== "object" ||
        event.data.type !== "alice-arena:navigate"
      ) return;
      if (event.data.target === "lobby" && house.arcadeMode === "arena") {
        returnToLobby();
      } else if (event.data.target === "harbor") {
        onClose();
      }
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
    window.addEventListener("message", onMessage);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("message", onMessage);
      document.body.style.overflow = previousBodyStyle.overflow;
      document.body.style.position = previousBodyStyle.position;
      document.body.style.top = previousBodyStyle.top;
      document.body.style.left = previousBodyStyle.left;
      document.body.style.width = previousBodyStyle.width;
      window.scrollTo(scrollX, scrollY);
      returnFocusRef.current?.focus({ preventScroll: true });
      returnFocusRef.current = null;
    };
  }, [house, onClose, returnToLobby]);

  const frameTarget = selectedGame ?? (
    !isArena && house?.status === "playable" ? house : null
  );

  useEffect(() => {
    if (!frameTarget) return;
    const iframe = iframeRef.current;
    if (!iframe) return;

    let iframeDocument: Document | null = null;
    const onIframeKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (isArena) returnToLobby();
      else onClose();
    };
    const attachIframeKeydown = (): void => {
      iframeDocument?.removeEventListener("keydown", onIframeKeyDown);
      try {
        iframeDocument = iframe.contentDocument;
        iframeDocument?.addEventListener("keydown", onIframeKeyDown);
      } catch {
        iframeDocument = null;
      }
    };

    iframe.addEventListener("load", attachIframeKeydown);
    if (iframe.contentDocument?.readyState === "complete") attachIframeKeydown();

    return () => {
      iframe.removeEventListener("load", attachIframeKeydown);
      iframeDocument?.removeEventListener("keydown", onIframeKeyDown);
    };
  }, [frameTarget, isArena, onClose, returnToLobby]);

  useEffect(() => {
    if (!selectedGame) return;
    window.requestAnimationFrame(() => {
      lobbyBackRef.current?.focus({ preventScroll: true });
    });
  }, [selectedGame]);

  if (!house) return null;

  const openDevStatus = (): void => {
    onClose();
    if (house.href.startsWith("#")) {
      window.setTimeout(() => {
        document.querySelector<HTMLElement>(house.href)?.scrollIntoView({ behavior: "smooth" });
      }, 0);
    }
  };

  const headingTitle = selectedGame?.title ?? (isArena ? "GRAND ARENA" : house.title);
  const headingSubtitle = selectedGame?.titleJa ?? (isArena ? "闘技場ゲームロビー" : house.titleJa);
  const escapeCopy = selectedGame
    ? "ESC で闘技場ロビーへ"
    : "ESC で港に戻る";

  return (
    <dialog
      ref={dialogRef}
      className={`hb-arcade ${isArena ? "is-arena" : ""} ${selectedGame ? "is-playing" : ""}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (selectedGame) returnToLobby();
        else onClose();
      }}
    >
      <header className="hb-arcade-bar">
        <div className="hb-arcade-nav-actions">
          {selectedGame ? (
            <button
              ref={lobbyBackRef}
              className="hb-arcade-close"
              type="button"
              onClick={returnToLobby}
            >
              <span aria-hidden="true">◀</span> 闘技場ロビー
            </button>
          ) : null}
          <button
            ref={closeRef}
            className={selectedGame ? "hb-arcade-port" : "hb-arcade-close"}
            type="button"
            onClick={onClose}
          >
            港に戻る
          </button>
        </div>
        <h2 id={titleId}>
          <span>{headingTitle}</span>
          <small>{headingSubtitle}</small>
        </h2>
        {frameTarget ? (
          <a
            className="hb-arcade-external"
            href={baseHref(frameTarget.href)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span aria-hidden="true">⛶</span> 別タブで開く
          </a>
        ) : isArena ? (
          <span className="hb-arcade-status">{ARENA_GAMES.length} TITLES / PLAYABLE</span>
        ) : (
          <span className="hb-arcade-status">IN DEVELOPMENT</span>
        )}
        <small className="hb-arcade-escape-hint">{escapeCopy}</small>
      </header>

      {isArena && !selectedGame ? (
        <ArenaLobby
          triggerRefs={gameTriggerRefs}
          onSelect={(game) => setSelectedGameId(game.id)}
        />
      ) : frameTarget ? (
        <iframe
          key={frameTarget.href}
          ref={iframeRef}
          src={baseHref(frameTarget.href)}
          title={frameTarget.title}
          className="hb-arcade-frame"
          allow="autoplay; fullscreen; gamepad"
        />
      ) : (
        <section className="hb-arcade-showcase">
          <img src={baseHref(house.cover)} alt={`${house.title} キービジュアル`} />
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
