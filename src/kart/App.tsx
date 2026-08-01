import { useCallback, useEffect, useRef, useState } from "react";
import { nitroAudio } from "./audio/engine";
import { createInputSource, type InputSource } from "./input";
import {
  evaluateAchievements,
  KART_ACHIEVEMENTS,
} from "./meta/achievements";
import {
  applyDailyFinish,
  dailyCombo,
  kartDayKey,
  loadDaily,
  saveDaily,
  type DailyState,
} from "./meta/daily";
import {
  applyRace,
  comboKey,
  loadRecords,
  saveRecords,
  type NkRecords,
} from "./meta/records";
import {
  decodeGhost,
  encodeGhost,
  ghostKey,
  GhostSampler,
} from "./modes/ghost";
import {
  createTimeTrialSession,
  type TimeTrialSession,
} from "./modes/timeTrial";
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
import { COUNTDOWN_SEC, WEATHER_KINDS } from "./sim/balance";
import type { KartInput, RaceEvent, RaceResult, RaceState } from "./sim/types";
import { LIVERIES } from "./render/palette";
import { Hud } from "./ui/Hud";
import {
  DailyCard,
  GpSetup,
  LiveryPicker,
  RecordsScreen,
  TtSetup,
} from "./ui/MetaScreens";
import { Lobby, Menu, Results, SoloSetup, TouchControls } from "./ui/Screens";

type Screen =
  | "menu"
  | "solo-setup"
  | "gp-setup"
  | "tt-setup"
  | "records"
  | "lobby"
  | "race"
  | "results";

type Mode = "vs" | "gp" | "tt" | "daily" | "mp";

const NAME_KEY = "nk_name";
const LIVERY_KEY = "nk_livery";

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

function readLivery(): number {
  try {
    const raw = Number(window.localStorage.getItem(LIVERY_KEY));
    return Number.isInteger(raw) && raw >= 0 && raw < 16 ? raw : 0;
  } catch {
    return 0;
  }
}

function storeLivery(value: number): void {
  try {
    window.localStorage.setItem(LIVERY_KEY, String(value));
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
  const [livery, setLivery] = useState(readLivery);
  const [settings, setSettings] = useState<RoomSettings>(() =>
    normalizeSettings({ playerCount: 1 }),
  );
  const [lobby, setLobby] = useState<NitroLobby | null>(null);
  const [result, setResult] = useState<RaceResult | null>(null);
  const [view, setView] = useState<RaceState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [records, setRecords] = useState<NkRecords>(() => loadRecords());
  const [daily, setDaily] = useState<DailyState>(() => loadDaily(kartDayKey()));
  const [newBests, setNewBests] = useState<{ bestLap: boolean; bestRace: boolean }>();
  const [unlockToast, setUnlockToast] = useState<readonly string[]>([]);
  const [quality] = useState<KartQuality>(() =>
    resolveQuality(readQualityChoice(), probeEnvironment()),
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionRef = useRef<NitroSession | null>(null);
  const sceneRef = useRef<KartScene | null>(null);
  const inputRef = useRef<InputSource | null>(null);
  const rafRef = useRef(0);
  const lastResultRef = useRef<RaceResult | null>(null);
  const modeRef = useRef<Mode>("vs");
  /** Per-race presentation counters the records blob wants. */
  const raceStatsRef = useRef({ miniTurbos: 0, tricksLanded: 0, itemHits: 0 });
  const ghostSamplerRef = useRef<GhostSampler | null>(null);

  const teardownSession = useCallback(() => {
    sessionRef.current?.dispose();
    sessionRef.current = null;
    setLobby(null);
    setView(null);
    setReady(false);
    ghostSamplerRef.current = null;
  }, []);

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    sceneRef.current?.dispose();
    sceneRef.current = null;
    inputRef.current?.dispose();
    sessionRef.current?.dispose();
  }, []);

  // Browsers refuse an AudioContext before a gesture; unlock() is idempotent
  // so the listeners simply stay attached (vortex precedent). M mutes.
  const [muted, setMuted] = useState(() => nitroAudio.muted);
  useEffect(() => {
    const unlock = (): void => nitroAudio.unlock();
    const onKey = (event: KeyboardEvent): void => {
      nitroAudio.unlock();
      if (event.code === "KeyM") {
        nitroAudio.setMuted(!nitroAudio.muted);
        setMuted(nitroAudio.muted);
      }
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  /**
   * The single place a finished race becomes history: records, ghost, daily,
   * unlock toast. Guarded by result identity in the callers — each race
   * produces a new result object, so this runs exactly once per race.
   */
  const handleRaceOutcome = useCallback(
    (outcome: RaceResult) => {
      const session = sessionRef.current;
      if (!session) return;
      const mode = modeRef.current;
      const stats = raceStatsRef.current;
      const cup = session.cup();
      const wonCup =
        cup?.finished === true &&
        cup.standings[0]?.seat === session.seat;
      const before = new Set(evaluateAchievements(records, daily));
      const { records: nextRecords, newBests: bests } = applyRace(records, {
        kind: mode === "tt" ? "tt" : mode === "daily" ? "daily" : "race",
        result: outcome,
        seat: session.seat,
        speedClass: session.settings.speedClass,
        mirror: session.settings.mirror,
        miniTurbos: stats.miniTurbos,
        tricksLanded: stats.tricksLanded,
        itemHits: stats.itemHits,
        gpGoldClass: wonCup ? session.settings.speedClass : null,
      });

      let nextDaily = daily;
      if (mode === "daily") {
        const mine = outcome.standings.find(
          (standing) => standing.id === session.seat,
        );
        if (mine?.finished && mine.time !== null) {
          nextDaily = applyDailyFinish(
            daily,
            kartDayKey(),
            Math.round((mine.time - COUNTDOWN_SEC) * 1000),
            mine.place,
          );
          saveDaily(nextDaily);
          setDaily(nextDaily);
        }
      }

      // Time trial: persist the ghost when the run is the new best.
      if (mode === "tt" && bests.bestRace) {
        const tt = session as TimeTrialSession;
        const ghost = tt.ghostPayload();
        if (ghost) {
          const encoded = encodeGhost(ghost, {
            trackId: session.track.spec.id,
            trackLength: tt.trackLength,
            speedClass: session.settings.speedClass,
            mirror: session.settings.mirror,
          });
          if (encoded) {
            try {
              window.localStorage.setItem(
                ghostKey(
                  session.track.spec.id,
                  session.settings.speedClass,
                  session.settings.mirror,
                ),
                encoded,
              );
            } catch {
              // Private browsing.
            }
          }
        }
      }

      saveRecords(nextRecords);
      setRecords(nextRecords);
      setNewBests(bests);
      const after = evaluateAchievements(nextRecords, nextDaily);
      const fresh = after.filter((id) => !before.has(id));
      setUnlockToast(
        fresh
          .map((id) => KART_ACHIEVEMENTS.find((a) => a.id === id))
          .filter((a) => a?.liveryUnlock !== undefined)
          .map((a) => LIVERIES[a!.liveryUnlock!]!.name),
      );
      raceStatsRef.current = { miniTurbos: 0, tricksLanded: 0, itemHits: 0 };
    },
    [records, daily],
  );
  const handleRaceOutcomeRef = useRef(handleRaceOutcome);
  handleRaceOutcomeRef.current = handleRaceOutcome;

  // ── The race loop ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (screen !== "race") return;
    const canvas = canvasRef.current;
    const session = sessionRef.current;
    if (!canvas || !session) return;

    const input = createInputSource();
    inputRef.current = input;
    const weather =
      WEATHER_KINDS[session.settings.weather] ?? "clear";
    const scene = createKartScene({
      canvas,
      track: session.track,
      quality,
      weather,
      audio: nitroAudio,
      disableShed:
        new URLSearchParams(window.location.search).get("shed") === "off",
    });
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

    const collectStats = (events: readonly RaceEvent[], seat: number): void => {
      for (const event of events) {
        if (event.k === "boost" && event.racer === seat) {
          if (event.source === "mini") raceStatsRef.current.miniTurbos += 1;
          if (event.source === "trick") raceStatsRef.current.tricksLanded += 1;
        }
        if (event.k === "hit" && event.by === seat && event.racer !== seat) {
          raceStatsRef.current.itemHits += 1;
        }
      }
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
      collectStats(events, live.seat);
      scene.advance(
        dt,
        state,
        events,
        focusOverride ?? live.seat,
        command.lookBack,
      );

      // Ghost playback (time trial only).
      const sampler = ghostSamplerRef.current;
      if (sampler && state) {
        scene.setGhostPose(
          state.phase === "race"
            ? sampler.sample(state.elapsed - COUNTDOWN_SEC)
            : null,
        );
      }

      uiTimer += dt;
      if (uiTimer > 1 / 20) {
        uiTimer = 0;
        setView(state);
      }

      const outcome = live.result();
      if (outcome && lastResultRef.current !== outcome) {
        lastResultRef.current = outcome;
        handleRaceOutcomeRef.current(outcome);
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
        mode: modeRef.current,
        cup: sessionRef.current?.cup() ?? null,
      }),
      setInput: (partial: Partial<KartInput> | null) => {
        inputOverride = partial;
      },
      setFocus: (seat: number | null) => {
        focusOverride = seat;
      },
      probeCorridor: (maxHeight?: number) => scene.probeCorridor(maxHeight),
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
  const beginLocalRace = useCallback(() => {
    lastResultRef.current = null;
    setResult(null);
    setNewBests(undefined);
    setUnlockToast([]);
    raceStatsRef.current = { miniTurbos: 0, tricksLanded: 0, itemHits: 0 };
    setScreen("race");
  }, []);

  const startSolo = useCallback(
    (gp: boolean) => {
      teardownSession();
      modeRef.current = gp ? "gp" : "vs";
      sessionRef.current = createSoloSession({
        name: name || "PLAYER",
        livery,
        settings: {
          ...settings,
          gp,
          playerCount: 1,
          seed: (Math.random() * 1e9) >>> 0,
        },
      });
      ghostSamplerRef.current = null;
      beginLocalRace();
    },
    [name, settings, livery, teardownSession, beginLocalRace],
  );

  const startTimeTrial = useCallback(() => {
    teardownSession();
    modeRef.current = "tt";
    const session = createTimeTrialSession({
      name: name || "PLAYER",
      trackId: settings.trackId,
      speedClass: settings.speedClass,
      mirror: settings.mirror,
      livery,
    });
    sessionRef.current = session;
    // Load the best ghost for this combo, if one survives validation.
    ghostSamplerRef.current = null;
    try {
      const stored = window.localStorage.getItem(
        ghostKey(settings.trackId, settings.speedClass, settings.mirror),
      );
      if (stored) {
        const ghost = decodeGhost(stored, {
          trackId: session.track.spec.id,
          trackLength: session.trackLength,
          speedClass: settings.speedClass,
          mirror: settings.mirror,
        });
        if (ghost) ghostSamplerRef.current = new GhostSampler(ghost);
      }
    } catch {
      // Private browsing.
    }
    beginLocalRace();
  }, [name, settings, livery, teardownSession, beginLocalRace]);

  const startDaily = useCallback(() => {
    teardownSession();
    modeRef.current = "daily";
    const combo = dailyCombo(kartDayKey());
    sessionRef.current = createSoloSession({
      name: name || "PLAYER",
      livery,
      settings: {
        trackId: combo.trackId,
        speedClass: combo.speedClass,
        mirror: combo.mirror,
        weather: combo.weather === "rain" ? 1 : 0,
        seed: combo.seed,
        laps: 3,
        racerCount: 8,
        cpuLevel: 2,
        items: true,
        playerCount: 1,
        gp: false,
      },
    });
    ghostSamplerRef.current = null;
    beginLocalRace();
  }, [name, livery, teardownSession, beginLocalRace]);

  const startHost = useCallback(async () => {
    teardownSession();
    modeRef.current = "mp";
    setError(null);
    setBusy("ルームを作成しています…");
    try {
      const roomCode = makeRoomCode();
      const session = await createHostSession({
        roomCode,
        name: name || "PLAYER",
        wire: chooseWire(),
        livery,
        settings: { ...settings, playerCount: 4 },
        callbacks: {
          onLobby: setLobby,
          onStart: () => {
            lastResultRef.current = null;
            setResult(null);
            setScreen("race");
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
        cause instanceof Error ? cause.message : "ルームを作成できませんでした",
      );
    }
  }, [name, settings, livery, teardownSession]);

  const startGuest = useCallback(
    async (code: string) => {
      teardownSession();
      modeRef.current = "mp";
      setError(null);
      setBusy("ルームに接続しています…");
      try {
        const session = await createGuestSession({
          roomCode: code,
          name: name || "PLAYER",
          wire: chooseWire(),
          livery,
          callbacks: {
            onLobby: setLobby,
            onStart: () => {
              lastResultRef.current = null;
              setResult(null);
              setScreen("race");
            },
            onResult: (outcome) => {
              if (lastResultRef.current !== outcome) {
                lastResultRef.current = outcome;
                handleRaceOutcomeRef.current(outcome);
                setResult(outcome);
                setScreen("results");
              }
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
    [name, livery, teardownSession],
  );

  const leave = useCallback(() => {
    teardownSession();
    lastResultRef.current = null;
    setResult(null);
    setScreen("menu");
  }, [teardownSession]);

  const session = sessionRef.current;
  const isHost = session?.kind === "host";
  const cup = session?.cup() ?? null;

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
              cup={cup}
            />
          ) : (
            <div className="nk-loading">コースを読み込み中…</div>
          )}
          {inputRef.current ? (
            <TouchControls touch={inputRef.current.touch} />
          ) : null}
          <button
            type="button"
            className="nk-exit nk-mute"
            aria-label={muted ? "音を出す" : "音を消す"}
            title="M"
            onClick={() => {
              nitroAudio.unlock();
              nitroAudio.setMuted(!nitroAudio.muted);
              setMuted(nitroAudio.muted);
            }}
          >
            {muted ? "音 OFF" : "音 ON"}
          </button>
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
          onGp={() => setScreen("gp-setup")}
          onTt={() => setScreen("tt-setup")}
          onRecords={() => setScreen("records")}
          onHost={() => void startHost()}
          onJoin={(code) => void startGuest(code)}
          busy={busy}
          error={error}
          dailyCard={<DailyCard daily={daily} onStart={startDaily} />}
          liveryPicker={
            <LiveryPicker
              records={records}
              daily={daily}
              value={livery}
              onChange={(value) => {
                setLivery(value);
                storeLivery(value);
              }}
            />
          }
        />
      ) : null}

      {screen === "solo-setup" ? (
        <SoloSetup
          settings={settings}
          onChange={(patch) =>
            setSettings((current) => normalizeSettings({ ...current, ...patch }))
          }
          onStart={() => startSolo(false)}
          onBack={() => setScreen("menu")}
        />
      ) : null}

      {screen === "gp-setup" ? (
        <GpSetup
          settings={settings}
          onChange={(patch) =>
            setSettings((current) => normalizeSettings({ ...current, ...patch }))
          }
          onStart={() => startSolo(true)}
          onBack={() => setScreen("menu")}
        />
      ) : null}

      {screen === "tt-setup" ? (
        <TtSetup
          settings={settings}
          records={records}
          onChange={(patch) =>
            setSettings((current) => normalizeSettings({ ...current, ...patch }))
          }
          onStart={startTimeTrial}
          onBack={() => setScreen("menu")}
        />
      ) : null}

      {screen === "records" ? (
        <RecordsScreen
          records={records}
          daily={daily}
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
          canRematch={
            session?.kind === "solo" && modeRef.current !== "gp"
          }
          cup={cup}
          isHost={session?.kind !== "guest"}
          newBests={newBests}
          unlockToast={unlockToast}
          rematchLabel={
            modeRef.current === "tt"
              ? "もう一度（ゴースト更新）"
              : modeRef.current === "daily"
                ? "もう一度挑戦"
                : "もう一度"
          }
          onNextRound={() => {
            if (session?.beginRace()) {
              lastResultRef.current = null;
              setResult(null);
              setScreen("race");
            }
          }}
          onRematch={() => {
            if (modeRef.current === "tt") startTimeTrial();
            else if (modeRef.current === "daily") startDaily();
            else startSolo(false);
          }}
          onMenu={leave}
        />
      ) : null}
    </div>
  );
}
