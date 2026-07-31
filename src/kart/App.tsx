import { useCallback, useEffect, useRef, useState } from "react";
import { createInputSource, type InputSource } from "./input";
import {
  createGuestSession,
  createHostSession,
  createSoloSession,
  normalizeSettings,
  type NitroSession,
} from "./net/session";
import type { NitroLobby, RoomSettings } from "./net/protocol";
import { createBroadcastChannelWire, makeRoomCode } from "./net/wire";
import { createPeerWire } from "./net/peer";
import { createKartScene, type KartScene } from "./render/scene";
import {
  probeEnvironment,
  readQualityChoice,
  resolveQuality,
  type KartQuality,
} from "./render/quality";
import type { KartInput, RaceResult, RaceState } from "./sim/types";
import { Hud } from "./ui/Hud";
import { Lobby, Menu, Results, SoloSetup, TouchControls } from "./ui/Screens";

type Screen = "menu" | "solo-setup" | "lobby" | "race" | "results";

const NAME_KEY = "nk_name";

function readName(): string {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? "PLAYER";
  } catch {
    return "PLAYER";
  }
}

function storeName(value: string): void {
  try {
    window.localStorage.setItem(NAME_KEY, value);
  } catch {
    // Private browsing.
  }
}

/**
 * `?wire=bc` swaps WebRTC for a BroadcastChannel, so two tabs on one machine
 * can play without a signalling server. It is also the transport the wire gate
 * drives, which means the multiplayer path can be verified locally.
 */
function chooseWire() {
  const mode = new URLSearchParams(window.location.search).get("wire");
  return mode === "bc" ? createBroadcastChannelWire() : createPeerWire();
}

export default function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>("menu");
  const [name, setName] = useState(readName);
  const [settings, setSettings] = useState<RoomSettings>(() =>
    normalizeSettings({ playerCount: 1 }),
  );
  const [lobby, setLobby] = useState<NitroLobby | null>(null);
  const [result, setResult] = useState<RaceResult | null>(null);
  const [view, setView] = useState<RaceState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [quality] = useState<KartQuality>(() =>
    resolveQuality(readQualityChoice(), probeEnvironment()),
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionRef = useRef<NitroSession | null>(null);
  const sceneRef = useRef<KartScene | null>(null);
  const inputRef = useRef<InputSource | null>(null);
  const rafRef = useRef(0);
  const lastResultRef = useRef<RaceResult | null>(null);

  const teardownSession = useCallback(() => {
    sessionRef.current?.dispose();
    sessionRef.current = null;
    setLobby(null);
    setView(null);
    setReady(false);
  }, []);

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    sceneRef.current?.dispose();
    sceneRef.current = null;
    inputRef.current?.dispose();
    sessionRef.current?.dispose();
  }, []);

  // ── The race loop ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (screen !== "race") return;
    const canvas = canvasRef.current;
    const session = sessionRef.current;
    if (!canvas || !session) return;

    const input = createInputSource();
    inputRef.current = input;
    const scene = createKartScene({ canvas, track: session.track, quality });
    sceneRef.current = scene;

    const resize = (): void => {
      const parent = canvas.parentElement;
      scene.resize(
        parent?.clientWidth ?? window.innerWidth,
        parent?.clientHeight ?? window.innerHeight,
      );
    };
    resize();
    window.addEventListener("resize", resize);

    let previous = performance.now();
    let uiTimer = 0;
    /*
     * Test-only steering override. It has to live here, ahead of the read,
     * because `step` re-reads the live input source every frame — a seam that
     * merely called `sendInput` was overwritten by the (empty) keyboard state
     * on the very next line, and every automated drive test measured a
     * stationary kart while the CPUs drove past it.
     */
    let inputOverride: Partial<KartInput> | null = null;
    /** Test-only spectator camera: follow another seat. */
    let focusOverride: number | null = null;

    const frame = (now: number): void => {
      rafRef.current = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - previous) / 1000);
      previous = now;
      step(dt);
    };

    const step = (dt: number): void => {
      const live = sessionRef.current;
      if (!live) return;
      const raw = input.read(dt);
      const command = inputOverride ? { ...raw, ...inputOverride } : raw;
      live.sendInput(command);
      live.tick(dt);
      const state = live.view();
      const events = live.drainEvents();
      scene.advance(
        dt,
        state,
        events,
        focusOverride ?? live.seat,
        command.lookBack,
      );

      uiTimer += dt;
      if (uiTimer > 1 / 20) {
        uiTimer = 0;
        setView(state);
      }

      const outcome = live.result();
      if (outcome && lastResultRef.current !== outcome) {
        lastResultRef.current = outcome;
        setResult(outcome);
        setScreen("results");
      }
    };

    /*
     * QA seam. The Browser pane reports `document.hidden === true`, where
     * requestAnimationFrame never fires — without an explicit step-and-read
     * pair there is no way to verify a 3D scene on this site at all.
     */
    const seam = {
      step,
      getDebugState: () => ({
        ...scene.getDebugState(),
        phase: sessionRef.current?.view()?.phase ?? null,
        elapsed: sessionRef.current?.view()?.elapsed ?? 0,
        racers: sessionRef.current?.view()?.racers.length ?? 0,
        leaderDistance:
          sessionRef.current?.view()?.racers.find((racer) => racer.place === 1)
            ?.distance ?? 0,
        kind: sessionRef.current?.kind ?? null,
      }),
      setInput: (partial: Partial<KartInput> | null) => {
        inputOverride = partial;
      },
      setFocus: (seat: number | null) => {
        focusOverride = seat;
      },
    };
    (window as unknown as { __nitroCrown?: unknown }).__nitroCrown = seam;

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      delete (window as unknown as { __nitroCrown?: unknown }).__nitroCrown;
      scene.dispose();
      sceneRef.current = null;
      input.dispose();
      inputRef.current = null;
    };
  }, [screen, quality]);

  // ── Entry points ──────────────────────────────────────────────────────────
  const startSolo = useCallback(() => {
    teardownSession();
    lastResultRef.current = null;
    setResult(null);
    sessionRef.current = createSoloSession({
      name: name || "PLAYER",
      settings: { ...settings, playerCount: 1, seed: (Math.random() * 1e9) >>> 0 },
    });
    setScreen("race");
  }, [name, settings, teardownSession]);

  const startHost = useCallback(async () => {
    teardownSession();
    setError(null);
    setBusy("ルームを作成しています…");
    try {
      const roomCode = makeRoomCode();
      const session = await createHostSession({
        roomCode,
        name: name || "PLAYER",
        wire: chooseWire(),
        settings: { ...settings, playerCount: 4 },
        callbacks: {
          onLobby: setLobby,
          onStart: () => setScreen("race"),
          onError: setError,
        },
      });
      sessionRef.current = session;
      setBusy(null);
      setScreen("lobby");
    } catch (cause) {
      setBusy(null);
      setError(
        cause instanceof Error ? cause.message : "ルームを作成できませんでした",
      );
    }
  }, [name, settings, teardownSession]);

  const startGuest = useCallback(
    async (code: string) => {
      teardownSession();
      setError(null);
      setBusy("ルームに接続しています…");
      try {
        const session = await createGuestSession({
          roomCode: code,
          name: name || "PLAYER",
          wire: chooseWire(),
          callbacks: {
            onLobby: setLobby,
            onStart: () => {
              lastResultRef.current = null;
              setResult(null);
              setScreen("race");
            },
            onResult: (outcome) => {
              lastResultRef.current = outcome;
              setResult(outcome);
              setScreen("results");
            },
            onEnded: () => {
              setError("ホストが退出しました");
              teardownSession();
              setScreen("menu");
            },
            onError: setError,
          },
        });
        sessionRef.current = session;
        setBusy(null);
        setScreen("lobby");
      } catch (cause) {
        setBusy(null);
        setError(
          cause instanceof Error ? cause.message : "ルームに参加できませんでした",
        );
      }
    },
    [name, teardownSession],
  );

  const leave = useCallback(() => {
    teardownSession();
    lastResultRef.current = null;
    setResult(null);
    setScreen("menu");
  }, [teardownSession]);

  const session = sessionRef.current;
  const isHost = session?.kind === "host";

  return (
    <div className="nk-root">
      {screen === "race" ? (
        <div className="nk-stage">
          <canvas ref={canvasRef} className="nk-canvas" />
          {view ? (
            <Hud
              track={session!.track}
              view={view}
              focusSeat={session!.seat}
              quality={quality.label}
            />
          ) : (
            <div className="nk-loading">コースを読み込み中…</div>
          )}
          {inputRef.current ? (
            <TouchControls touch={inputRef.current.touch} />
          ) : null}
          <button type="button" className="nk-exit" onClick={leave}>
            退出
          </button>
        </div>
      ) : null}

      {screen === "menu" ? (
        <Menu
          name={name}
          onName={(value) => {
            setName(value);
            storeName(value);
          }}
          onSolo={() => setScreen("solo-setup")}
          onHost={() => void startHost()}
          onJoin={(code) => void startGuest(code)}
          busy={busy}
          error={error}
        />
      ) : null}

      {screen === "solo-setup" ? (
        <SoloSetup
          settings={settings}
          onChange={(patch) =>
            setSettings((current) => normalizeSettings({ ...current, ...patch }))
          }
          onStart={startSolo}
          onBack={() => setScreen("menu")}
        />
      ) : null}

      {screen === "lobby" ? (
        <Lobby
          lobby={lobby}
          isHost={isHost}
          roomCode={session?.roomCode ?? null}
          ready={ready}
          onReady={(value) => {
            setReady(value);
            session?.setReady(value);
          }}
          onSettings={(patch) => session?.updateSettings(patch)}
          onStart={() => {
            lastResultRef.current = null;
            setResult(null);
            if (session?.beginRace()) setScreen("race");
          }}
          onLeave={leave}
          note={
            isHost
              ? "同じルームコードを相手に伝えてください。空席は CPU が埋めます。"
              : "ホストの開始を待っています。"
          }
        />
      ) : null}

      {screen === "results" && result ? (
        <Results
          result={result}
          focusSeat={session?.seat ?? 0}
          canRematch={session?.kind === "solo"}
          onRematch={startSolo}
          onMenu={leave}
        />
      ) : null}
    </div>
  );
}
