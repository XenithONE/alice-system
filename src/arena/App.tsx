import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BuilderPanel } from "./builder/BuilderPanel";
import { computeStats, validateBuild } from "./sim/build";
import { buildCatalog } from "./parts/catalog";
import { ARENAS } from "./parts/arenas";
import { createGuestSession, createHostSession, type GuestSession, type HostSession, type SessionDeps } from "./net/session";
import { createPeerWire } from "./net/peer";
import type { HostMessage, SeatInfo, Snapshot, Wire, WireConn } from "./net/protocol";
import type { ArenaDef, BotSpec, MatchInput, SeatIndex } from "./sim/types";
import { createArenaScene, type ArenaScene } from "./render/arenaScene";
import { TitleScreen } from "./ui/TitleScreen";
import { LobbyScreen } from "./ui/LobbyScreen";
import { MatchHud } from "./ui/MatchHud";
import { ResultScreen } from "./ui/ResultScreen";

type Screen = "title" | "garage" | "lobby" | "match" | "result";
type Mode = "solo" | "host" | "guest";
type Session = HostSession | GuestSession;
type ResultMessage = HostMessage & { t: "result" };

interface MatchConfig {
  readonly specs: readonly (BotSpec | null)[];
  readonly names: readonly string[];
  readonly arena: ArenaDef;
}

declare global {
  interface Window {
    __sc?: {
      screen(): Screen;
      debugTick(dt: number): void;
      getDebugState(): ReturnType<ArenaScene["getDebugState"]> | null;
      captureFrame(): string | null;
    };
  }
}

class DirectHostWire implements Wire {
  private disposed = false;
  async host(_roomId: string, _onConn: (conn: WireConn) => void): Promise<void> {
    if (this.disposed) throw new Error("Local session was closed");
  }
  async join(_roomId: string): Promise<WireConn> {
    throw new Error("Local direct wire has no guest transport");
  }
  dispose(): void {
    this.disposed = true;
  }
}

function roomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const random = new Uint32Array(6);
  crypto.getRandomValues(random);
  return Array.from(random, (value) => alphabet[value % alphabet.length]).join("");
}

function playerName(): string {
  return localStorage.getItem("sc.playerName")?.trim().slice(0, 40) || "スクラッパー";
}

function cloneSpec(spec: BotSpec): BotSpec {
  return {
    ...spec,
    parts: spec.parts.map((part) => ({ ...part, cell: [...part.cell] as [number, number] }))
  };
}

export function App() {
  const catalog = useMemo(() => buildCatalog(), []);
  const query = useMemo(() => new URLSearchParams(location.search), []);
  const [screen, setScreen] = useState<Screen>("title");
  const [mode, setMode] = useState<Mode>("solo");
  const [room, setRoom] = useState("");
  const [mySeat, setMySeat] = useState<SeatIndex>(0);
  const [spec, setSpec] = useState<BotSpec>(() => cloneSpec(catalog.presets[0]!));
  const [seats, setSeats] = useState<readonly SeatInfo[]>([]);
  const [ready, setReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [matchConfig, setMatchConfig] = useState<MatchConfig | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [result, setResult] = useState<ResultMessage | null>(null);
  const [paused, setPaused] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<ArenaScene | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const latestSnapshotRef = useRef<Snapshot | null>(null);
  const currentScreenRef = useRef<Screen>(screen);
  const configRef = useRef<MatchConfig | null>(null);
  const arena = ARENAS[1] ?? ARENAS[0]!;

  useEffect(() => {
    currentScreenRef.current = screen;
  }, [screen]);
  useEffect(() => {
    configRef.current = matchConfig;
  }, [matchConfig]);
  useEffect(() => () => {
    sessionRef.current?.dispose();
    sceneRef.current?.dispose();
  }, []);

  const sessionDeps = useMemo<SessionDeps>(() => ({
    validateBuild: (candidate) => validateBuild(candidate, catalog),
    createSim: async ({ seed, specs, names, arenaId }) => {
      const [{ initPhysics, createArenaSim }, { ARENAS: availableArenas }] = await Promise.all([
        import("./sim/world"),
        import("./parts/arenas")
      ]);
      await initPhysics();
      const selectedArena = availableArenas.find((item) => item.id === arenaId) ?? availableArenas[0]!;
      return createArenaSim({ seed, specs, names, catalog, arena: selectedArena });
    },
    aiInput: (sim, seat) => {
      const state = sim.getState();
      const bot = state.bots.find((candidate) => candidate.seat === seat);
      const rivals = state.bots.filter((candidate) => candidate.alive && candidate.seat !== seat);
      if (!bot?.alive || state.phase !== "live" || rivals.length === 0) {
        return { throttle: 0, steer: 0, weapon: false, selfRight: false };
      }
      const target = rivals.reduce((best, candidate) => {
        const candidateDistance = Math.hypot(candidate.pos[0] - bot.pos[0], candidate.pos[2] - bot.pos[2]);
        const bestDistance = Math.hypot(best.pos[0] - bot.pos[0], best.pos[2] - bot.pos[2]);
        return candidateDistance < bestDistance ? candidate : best;
      });
      const targetAngle = Math.atan2(target.pos[0] - bot.pos[0], target.pos[2] - bot.pos[2]);
      const siny = 2 * (bot.quat[3] * bot.quat[1] + bot.quat[0] * bot.quat[2]);
      const cosy = 1 - 2 * (bot.quat[1] ** 2 + bot.quat[2] ** 2);
      const yaw = Math.atan2(siny, cosy);
      const delta = Math.atan2(Math.sin(targetAngle - yaw), Math.cos(targetAngle - yaw));
      return {
        throttle: Math.abs(delta) > 1.2 ? 0.25 : 1,
        steer: Math.max(-1, Math.min(1, delta)),
        weapon: true,
        selfRight: bot.inverted
      };
    }
  }), [catalog]);

  const receiveSnapshot = useCallback((next: Snapshot): void => {
    latestSnapshotRef.current = next;
    setSnapshot(next);
    sceneRef.current?.pushSnapshot(next);
    setScreen("match");
  }, []);

  const receiveResult = useCallback((next: ResultMessage): void => {
    setResult(next);
    window.setTimeout(() => setScreen("result"), 700);
  }, []);

  const resetSession = useCallback((): void => {
    sessionRef.current?.dispose();
    sessionRef.current = null;
    sceneRef.current?.dispose();
    sceneRef.current = null;
    setSeats([]);
    setReady(false);
    setConnecting(false);
    setError("");
    setMatchConfig(null);
    setSnapshot(null);
    latestSnapshotRef.current = null;
    setResult(null);
    setPaused(false);
  }, []);

  const startFlow = (nextMode: Mode, nextRoom = ""): void => {
    resetSession();
    setMode(nextMode);
    setRoom(nextMode === "solo" ? "LOCAL" : nextMode === "host" ? roomCode() : nextRoom);
    setMySeat(0);
    setScreen("garage");
  };

  const beginSession = useCallback(async (launchSpec: BotSpec): Promise<void> => {
    resetSession();
    setSpec(cloneSpec(launchSpec));
    setConnecting(true);
    setScreen("lobby");
    const name = playerName();
    try {
      if (mode === "guest") {
        let guest: GuestSession | null = null;
        guest = await createGuestSession(createPeerWire(), room, {
          name,
          onLobby: (nextSeats) => {
            setSeats(nextSeats);
            if (guest?.seat !== null && guest?.seat !== undefined) setMySeat(guest.seat);
          },
          onStart: (message) => {
            const seat = guest?.seat ?? 0;
            setMySeat(seat);
            setMatchConfig({ specs: message.specs, names: message.names, arena });
          },
          onSnapshot: receiveSnapshot,
          onResult: receiveResult,
          onError: setError
        });
        sessionRef.current = guest;
        guest.build(launchSpec);
      } else {
        const wire = mode === "solo" ? new DirectHostWire() : createPeerWire();
        const host = await createHostSession(wire, room, sessionDeps, {
          hostName: name,
          arenaId: arena.id,
          onLobby: (nextSeats) => {
            setSeats(nextSeats);
            if (nextSeats.every((seat) => seat.ready && seat.spec !== null)) {
              setMatchConfig({
                specs: nextSeats.map((seat) => seat.spec),
                names: nextSeats.map((seat) => seat.name),
                arena
              });
            }
          },
          onSnapshot: receiveSnapshot,
          onResult: receiveResult
        });
        sessionRef.current = host;
        host.build(launchSpec);
      }
      setConnecting(false);
    } catch (reason) {
      setConnecting(false);
      setError(reason instanceof Error ? reason.message : "セッションを開始できませんでした。");
    }
  }, [arena, mode, receiveResult, receiveSnapshot, resetSession, room, sessionDeps]);

  const toggleReady = (next: boolean): void => {
    setReady(next);
    sessionRef.current?.ready(next);
  };

  useEffect(() => {
    if (screen !== "match" || !matchConfig || !canvasRef.current) return;
    const scene = createArenaScene(canvasRef.current, catalog, {});
    scene.setup(matchConfig.specs, matchConfig.names, matchConfig.arena, mySeat);
    if (latestSnapshotRef.current) scene.pushSnapshot(latestSnapshotRef.current);
    scene.setPaused(paused);
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      if (sceneRef.current === scene) sceneRef.current = null;
    };
  }, [catalog, matchConfig, mySeat, screen]);

  useEffect(() => {
    sceneRef.current?.setPaused(paused);
  }, [paused]);

  useEffect(() => {
    if (screen !== "match") return;
    const pressed = new Set<string>();
    const sendInput = (): void => {
      const input: MatchInput = {
        throttle: (pressed.has("KeyW") ? 1 : 0) - (pressed.has("KeyS") ? 1 : 0),
        steer: (pressed.has("KeyD") ? 1 : 0) - (pressed.has("KeyA") ? 1 : 0),
        weapon: pressed.has("Space"),
        selfRight: pressed.has("KeyR")
      };
      sessionRef.current?.input(input);
    };
    const down = (event: KeyboardEvent): void => {
      if (["KeyW", "KeyA", "KeyS", "KeyD", "Space", "KeyR"].includes(event.code)) {
        event.preventDefault();
        pressed.add(event.code);
        sendInput();
      }
    };
    const up = (event: KeyboardEvent): void => {
      pressed.delete(event.code);
      sendInput();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      sessionRef.current?.input({ throttle: 0, steer: 0, weapon: false, selfRight: false });
    };
  }, [screen]);

  useEffect(() => {
    window.__sc = {
      screen: () => currentScreenRef.current,
      debugTick: (dt) => sceneRef.current?.debugTick(dt),
      getDebugState: () => sceneRef.current?.getDebugState() ?? null,
      captureFrame: () => sceneRef.current?.captureFrame() ?? null
    };
    return () => {
      delete window.__sc;
    };
  }, []);

  const maxHp = useMemo(() => matchConfig?.specs.map((candidate) => {
    if (!candidate) return 1;
    const chassis = catalog.byId.get(candidate.chassisId);
    return chassis?.category === "chassis" ? chassis.hp : 1;
  }) ?? [], [catalog, matchConfig]);

  const toTitle = (): void => {
    resetSession();
    setScreen("title");
  };

  if (screen === "title") {
    return <TitleScreen initialRoom={query.get("room") ?? ""} onSolo={() => startFlow("solo")}
      onHost={() => startFlow("host")} onJoin={(code) => startFlow("guest", code)} />;
  }
  if (screen === "garage") {
    return (
      <main className="sc-garage-screen">
        <header className="sc-garage-head">
          <button className="sc-text-button" type="button" onClick={toTitle}>← タイトルへ</button>
          <div><span>BOT WORKSHOP</span><strong>{mode === "solo" ? "SOLO" : room}</strong></div>
        </header>
        <BuilderPanel initialSpec={spec} onLaunch={(next) => void beginSession(next)} />
      </main>
    );
  }
  if (screen === "lobby") {
    return <LobbyScreen room={room} seats={seats} mySeat={mySeat} ready={ready} loading={connecting} error={error}
      massOf={(seat) => seat.spec ? computeStats(seat.spec, catalog).mass : null}
      onReady={toggleReady} onBack={toTitle} />;
  }
  if (screen === "result" && result && matchConfig) {
    return <ResultScreen result={result} names={matchConfig.names}
      onRematch={() => { resetSession(); void beginSession(spec); }}
      onGarage={() => { resetSession(); setScreen("garage"); }} />;
  }
  return (
    <main className="sc-match">
      <canvas ref={canvasRef} className="sc-match__canvas" aria-label="SCRAP CROWN 試合アリーナ" />
      <MatchHud snapshot={snapshot} names={matchConfig?.names ?? []} mySeat={mySeat} maxHp={maxHp}
        paused={paused} onPause={() => setPaused((value) => !value)} />
    </main>
  );
}
