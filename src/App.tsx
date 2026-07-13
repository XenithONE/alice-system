import { useCallback, useEffect, useRef, useState } from "react";
import { GameCanvas } from "./components/GameCanvas";
import { Hud } from "./components/Hud";
import {
  type GameInfo,
  type GameMode,
  type HorrorEngine,
  type HorrorPlayerPose,
  type HorrorSessionPlayer,
  type HorrorWorldState,
  type JumpscareKind,
  type RunEndResult
} from "./lib/horrorEngine";
import { advanceLoop, readProgress, recordRun, recordScare, unlockAchievements, type ProgressState } from "./lib/storage";
import { ACHIEVEMENTS, evaluate } from "./lib/achievements";
import { HorrorRoom, type CloseReason } from "./horror/net/room";
import type {
  AuthoritativeState,
  DownReason,
  EndResult,
  PlayerInfo,
  PlayerPose,
  WardenMode
} from "./horror/net/protocol";

const SCARE_LINES: Record<JumpscareKind, string> = {
  chase: "◈ THE WARDEN FOUND YOU.",
  mirror: "◈ something looked back.",
  locker: "◈ something moved nearby.",
  finale: "◈ it was waiting at the door.",
  ambient: "◈ ...did you hear that?"
};

const CLOSE_LINES: Partial<Record<CloseReason, string>> = {
  hostLost: "HOST SIGNAL LOST // セッションを終了しました。",
  "rejected-version": "PROTOCOL MISMATCH // ページを再読み込みしてください。",
  "rejected-in-game": "その部屋はすでに探索中です。",
  "rejected-full": "その部屋は3人で満員です。",
  "invalid-code": "ルームコードを確認してください。",
  "room-not-found": "その部屋は見つかりませんでした。",
  broker: "接続サービスへ到達できませんでした。",
  timeout: "接続がタイムアウトしました。"
};

export type HorrorMenuPanel = "main" | "join" | "connecting" | "lobby";

function initialRoomCode(): string {
  if (typeof window === "undefined") return "";
  return (new URLSearchParams(window.location.search).get("room") ?? "").trim().toUpperCase().slice(0, 5);
}

function initialPlayerName(): string {
  if (typeof window === "undefined") return "WITNESS";
  try {
    return (window.localStorage.getItem("hw_player_name") ?? "WITNESS").slice(0, 16);
  } catch {
    return "WITNESS";
  }
}

function toEnginePlayer(player: PlayerInfo): HorrorSessionPlayer {
  return { id: player.id, name: player.name, isHost: player.isHost };
}

function toEnginePose(id: string, pose: PlayerPose, alive = true): HorrorPlayerPose {
  return {
    id,
    seq: pose.seq,
    x: pose.x,
    z: pose.z,
    yaw: pose.yaw,
    pitch: pose.pitch,
    hiding: pose.hiding,
    flashlight: pose.flashlight,
    watching: false,
    alive
  };
}

function toEngineWardenMode(mode: WardenMode): "wander" | "hunt" {
  return mode === "hunt" || mode === "stalk" || mode === "investigate" || mode === "rage" || mode === "drag"
    ? "hunt"
    : "wander";
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export default function App() {
  const [progress, setProgress] = useState<ProgressState>(() => readProgress());
  const [mode, setMode] = useState<GameMode>("menu");
  const [info, setInfo] = useState<GameInfo | null>(null);
  const [filesFound, setFilesFound] = useState(0);
  const [filesTotal, setFilesTotal] = useState(6);
  const [fear, setFear] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [hiding, setHiding] = useState(false);
  const [flashlightOn, setFlashlightOn] = useState(true);
  const [lastRun, setLastRun] = useState<RunEndResult | null>(null);
  const [toastLine, setToastLine] = useState("");
  const [jumpscareToken, setJumpscareToken] = useState(0);
  const [jumpscareKind, setJumpscareKind] = useState<JumpscareKind | null>(null);
  const [webglError, setWebglError] = useState("");

  const invitedCode = initialRoomCode();
  const [menuPanel, setMenuPanel] = useState<HorrorMenuPanel>(invitedCode ? "join" : "main");
  const [playerName, setPlayerName] = useState(initialPlayerName);
  const [joinCode, setJoinCode] = useState(invitedCode);
  const [roomCode, setRoomCode] = useState("");
  const [lobbyPlayers, setLobbyPlayers] = useState<PlayerInfo[]>([]);
  const [networkError, setNetworkError] = useState("");
  const [latencyMs, setLatencyMs] = useState(0);
  const [networked, setNetworked] = useState(false);

  const engineRef = useRef<HorrorEngine | null>(null);
  const roomRef = useRef<HorrorRoom | null>(null);
  const poseCacheRef = useRef(new Map<string, PlayerPose>());
  const loopRef = useRef(progress.loop);
  const toastTimer = useRef<number | null>(null);
  const fearRef = useRef(0);
  const networkedRef = useRef(false);
  const endingRef = useRef(false);
  const isTouch = typeof window !== "undefined" && (window.matchMedia("(hover: none)").matches || "ontouchstart" in window);

  const speak = useCallback((line: string) => {
    setToastLine(line);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastLine(""), 4200);
  }, []);

  const syncAchievements = useCallback((state: ProgressState, extras?: Parameters<typeof evaluate>[1]): ProgressState => {
    const earned = evaluate(state, extras);
    const fresh = earned.filter((id) => !state.achievements.has(id));
    if (fresh.length === 0) return state;
    const next = unlockAchievements(earned);
    const achievement = ACHIEVEMENTS.find((entry) => entry.id === fresh[0]);
    if (achievement) speak(`ACHIEVEMENT // ${achievement.title}`);
    return next;
  }, [speak]);

  const handleReady = useCallback((gameInfo: GameInfo) => setInfo(gameInfo), []);
  const handleError = useCallback((message: string) => setWebglError(message), []);
  const handleFilesUpdate = useCallback((found: number, total: number) => { setFilesFound(found); setFilesTotal(total); }, []);
  const handleFear = useCallback((value: number) => { fearRef.current = value; setFear(value); }, []);
  const handleTime = useCallback((ms: number) => setElapsedMs(ms), []);
  const handleHideChange = useCallback((value: boolean) => setHiding(value), []);
  const handleFlashlightChange = useCallback((value: boolean) => setFlashlightOn(value), []);
  const handleModeChange = useCallback((next: GameMode) => setMode(next), []);

  const handleJumpscare = useCallback((kind: JumpscareKind) => {
    setJumpscareKind(kind);
    setJumpscareToken((token) => token + 1);
    setProgress(syncAchievements(recordScare(kind)));
    speak(SCARE_LINES[kind]);
  }, [speak, syncAchievements]);

  const handleRunEnd = useCallback((result: RunEndResult) => {
    setLastRun(result);
    let next = syncAchievements(recordRun({ won: result.won, ms: result.ms, score: result.score }), {
      wonThisRun: result.won,
      scaresThisRun: result.scares,
      hidesThisRun: result.hides,
      msThisRun: result.ms
    });
    if (result.won && next.wins >= 1 && loopRef.current === next.loop && next.wins > 1) {
      next = syncAchievements(advanceLoop());
      loopRef.current = next.loop;
    } else if (result.won && next.wins === 1) {
      loopRef.current = next.loop;
    }
    setProgress(next);

    const room = roomRef.current;
    if (!room || room.phase !== "game") return;
    if (room.isHost && !endingRef.current) {
      endingRef.current = true;
      room.end({
        won: result.won,
        reason: result.won ? "escaped" : "all-down",
        elapsedMs: result.ms,
        escapedIds: result.won ? room.players.map((player) => player.id) : [],
        downPlayerId: result.won ? null : (result.downPlayerId ?? room.myId),
        lossKind: result.won ? null : (result.lossKind ?? "caught")
      });
    } else if (!room.isHost && !endingRef.current && !result.won) {
      room.reportDown(result.lossKind === "fear" ? "fear" : "caught");
    }
  }, [syncAchievements]);

  const handleEngine = useCallback((engine: HorrorEngine) => { engineRef.current = engine; }, []);

  const makeRoom = useCallback((): HorrorRoom => {
    let room: HorrorRoom;
    room = new HorrorRoom({
      onLobby: (players) => {
        setLobbyPlayers(players);
        setRoomCode(room.roomCode);
        setMenuPanel("lobby");
      },
      onStart: (seed, players) => {
        endingRef.current = false;
        poseCacheRef.current.clear();
        networkedRef.current = true;
        setNetworked(true);
        setLobbyPlayers(players);
        setNetworkError("");
        engineRef.current?.configureSession({
          role: room.isHost ? "host" : "guest",
          seed,
          localId: room.myId,
          players: players.map(toEnginePlayer)
        });
        engineRef.current?.start();
        speak(room.isHost ? "WARD LINK ACTIVE // あなたがHOSTです。" : "WARD LINK ACTIVE // HOSTへ同期しました。");
      },
      onPose: (from, pose) => {
        poseCacheRef.current.set(from, pose);
        engineRef.current?.applyRemotePose(toEnginePose(from, pose));
      },
      onState: (state: AuthoritativeState) => {
        for (const player of state.players) {
          poseCacheRef.current.set(player.id, player);
          if (player.id !== room.myId) engineRef.current?.applyRemotePose(toEnginePose(player.id, player, !player.down));
        }
        engineRef.current?.applyAuthorityState({
          seq: state.tick,
          sentAt: performance.now(),
          wardenX: state.warden.x,
          wardenZ: state.warden.z,
          wardenYaw: state.warden.yaw,
          wardenMode: toEngineWardenMode(state.warden.mode),
          collected: state.claimedFiles,
          exitOpen: state.exitOpen,
          elapsedMs: state.elapsedMs
        });
      },
      onFileClaim: (from, fileId) => {
        if (room.isHost && engineRef.current?.acceptFileClaim(fileId, from)) {
          const player = room.players.find((entry) => entry.id === from);
          speak(`CASE ${String(fileId + 1).padStart(2, "0")} SECURED // ${player?.name ?? "WITNESS"}`);
        }
      },
      onDown: (from, reason: DownReason) => {
        if (!room.isHost || endingRef.current) return;
        const player = room.players.find((entry) => entry.id === from);
        speak(`${player?.name ?? "WITNESS"} LOST // ${reason.toUpperCase()}`);
        engineRef.current?.finishNetworkRun(false, reason, from);
      },
      onEnd: (result: EndResult) => {
        if (room.isHost) return;
        endingRef.current = true;
        engineRef.current?.finishNetworkRun(
          result.won,
          result.lossKind ?? undefined,
          result.downPlayerId ?? undefined,
          !result.won && result.lossKind === "caught" && result.downPlayerId === room.myId,
          result.elapsedMs
        );
      },
      onLeave: (playerId) => {
        engineRef.current?.markRemoteDisconnected(playerId);
        const player = room.players.find((entry) => entry.id === playerId);
        speak(`${player?.name ?? "WITNESS"} SIGNAL LOST`);
      },
      onLatency: (ms) => setLatencyMs(Math.round(ms)),
      onError: (message) => setNetworkError(message),
      onClosed: (reason) => {
        if (reason === "left") return;
        const line = CLOSE_LINES[reason] ?? "NETWORK SESSION CLOSED";
        setNetworkError(line);
        speak(line);
        const wasActiveRun = networkedRef.current;
        if (wasActiveRun) {
          endingRef.current = true;
          // Preserve the network result treatment until the player closes the
          // end card; otherwise a dropped host looked like an unrelated solo loss.
          engineRef.current?.finishNetworkRun(false, "caught", room.myId);
          setNetworked(true);
        } else {
          networkedRef.current = false;
          setNetworked(false);
        }
        setMenuPanel("main");
      }
    });
    roomRef.current = room;
    return room;
  }, [speak]);

  const persistName = useCallback((name: string) => {
    const clean = name.trim().slice(0, 16) || "WITNESS";
    setPlayerName(clean);
    try { window.localStorage.setItem("hw_player_name", clean); } catch { /* private mode */ }
    return clean;
  }, []);

  const handleSolo = useCallback(() => {
    roomRef.current?.leave();
    roomRef.current = null;
    networkedRef.current = false;
    endingRef.current = false;
    setNetworked(false);
    setNetworkError("");
    engineRef.current?.setLoop(loopRef.current);
    engineRef.current?.configureSession({
      role: "solo",
      seed: null,
      localId: "solo",
      players: [{ id: "solo", name: playerName || "WITNESS", isHost: true }]
    });
    engineRef.current?.start();
  }, [playerName]);

  const handleCreateRoom = useCallback(async () => {
    engineRef.current?.primeAudio();
    setNetworkError("");
    setMenuPanel("connecting");
    const room = makeRoom();
    const result = await room.host(persistName(playerName));
    if (!result.ok) {
      setNetworkError(CLOSE_LINES[result.reason] ?? "ルームを作成できませんでした。");
      setMenuPanel("main");
      roomRef.current = null;
      return;
    }
    setRoomCode(result.code);
    setLobbyPlayers(room.players);
    setMenuPanel("lobby");
  }, [makeRoom, persistName, playerName]);

  const handleJoinRoom = useCallback(async () => {
    // JOIN is the guest's last guaranteed user gesture before the host starts
    // the run asynchronously, so unlock Web Audio here.
    engineRef.current?.primeAudio();
    setNetworkError("");
    setMenuPanel("connecting");
    const room = makeRoom();
    const result = await room.join(joinCode, persistName(playerName));
    if (!result.ok) {
      setNetworkError(CLOSE_LINES[result.reason] ?? "ルームへ参加できませんでした。");
      setMenuPanel("join");
      roomRef.current = null;
      return;
    }
    setRoomCode(room.roomCode);
    setLobbyPlayers(room.players);
    setMenuPanel("lobby");
  }, [joinCode, makeRoom, persistName, playerName]);

  const handleStartRoom = useCallback(() => {
    if (lobbyPlayers.length < 2) {
      setNetworkError("もう1人参加すると開始できます。1人で遊ぶ場合はSOLOを選んでください。");
      return;
    }
    roomRef.current?.start();
  }, [lobbyPlayers.length]);

  const handleLeaveRoom = useCallback(() => {
    roomRef.current?.leave();
    roomRef.current = null;
    networkedRef.current = false;
    endingRef.current = false;
    setNetworked(false);
    setLobbyPlayers([]);
    setRoomCode("");
    setNetworkError("");
    setMenuPanel("main");
    engineRef.current?.returnToMenu();
  }, []);

  const handleCopyInvite = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomCode);
    if (!navigator.clipboard) {
      speak(`ROOM CODE // ${roomCode}`);
      return;
    }
    void navigator.clipboard.writeText(url.toString()).then(
      () => speak("INVITE LINK COPIED"),
      () => speak(`ROOM CODE // ${roomCode}`)
    );
  }, [roomCode, speak]);

  const handleLocalPose = useCallback((pose: HorrorPlayerPose) => {
    const room = roomRef.current;
    if (!room || room.phase !== "game") return;
    const networkPose: PlayerPose = {
      seq: pose.seq,
      tick: pose.seq,
      x: pose.x,
      y: 1.62,
      z: pose.z,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: wrapAngle(pose.yaw),
      pitch: pose.pitch,
      flashlight: pose.flashlight,
      hiding: pose.hiding
    };
    poseCacheRef.current.set(room.myId, networkPose);
    room.sendPose(networkPose);
  }, []);

  const handleAuthorityState = useCallback((state: HorrorWorldState) => {
    const room = roomRef.current;
    if (!room?.isHost || room.phase !== "game") return;
    const fallback: PlayerPose = {
      seq: 0, tick: 0, x: 0, y: 1.62, z: 0, vx: 0, vy: 0, vz: 0,
      yaw: 0, pitch: 0, flashlight: true, hiding: false
    };
    room.sendState({
      tick: state.seq,
      elapsedMs: state.elapsedMs,
      players: room.players.map((player) => ({
        id: player.id,
        ...(poseCacheRef.current.get(player.id) ?? fallback),
        fear: player.id === room.myId ? fearRef.current : 0,
        down: false
      })),
      warden: {
        x: state.wardenX,
        y: 0,
        z: state.wardenZ,
        yaw: state.wardenYaw,
        mode: state.wardenMode === "hunt" ? "hunt" : "roam",
        targetId: null
      },
      claimedFiles: state.collected,
      exitOpen: state.exitOpen
    });
  }, []);

  const handleFileClaim = useCallback((fileId: number) => {
    roomRef.current?.claimFile(fileId);
  }, []);

  const handleReplay = useCallback(() => {
    if (networkedRef.current) handleLeaveRoom();
    else handleSolo();
  }, [handleLeaveRoom, handleSolo]);

  const handlePause = useCallback(() => engineRef.current?.pause(), []);
  const handleResume = useCallback(() => engineRef.current?.resume(), []);
  const handleHide = useCallback(() => engineRef.current?.toggleHide(), []);
  const handleFlashlight = useCallback(() => engineRef.current?.toggleFlashlight(), []);
  const handleMute = useCallback((muted: boolean) => engineRef.current?.setMuted(muted), []);
  const handleBloom = useCallback((enabled: boolean) => engineRef.current?.setBloomEnabled(enabled), []);
  const handleShake = useCallback((enabled: boolean) => engineRef.current?.setShakeEnabled(enabled), []);
  const handleLookSens = useCallback((value: number) => engineRef.current?.setLookSens(value), []);

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    roomRef.current?.leave();
  }, []);

  return (
    <div className="app-shell">
      {webglError ? (
        <div className="webgl-fallback">
          <h1>THE HOLLOW WARD</h1>
          <p>この環境では3D描画を初期化できませんでした。WebGL対応のブラウザでお試しください。</p>
        </div>
      ) : (
        <GameCanvas
          loop={loopRef.current}
          onReady={handleReady}
          onError={handleError}
          onFilesUpdate={handleFilesUpdate}
          onFear={handleFear}
          onTime={handleTime}
          onJumpscare={handleJumpscare}
          onHideChange={handleHideChange}
          onFlashlightChange={handleFlashlightChange}
          onModeChange={handleModeChange}
          onRunEnd={handleRunEnd}
          onLocalPose={handleLocalPose}
          onAuthorityState={handleAuthorityState}
          onFileClaim={handleFileClaim}
          onEngine={handleEngine}
        />
      )}

      {!webglError && (
        <Hud
          mode={mode}
          info={info}
          filesFound={filesFound}
          filesTotal={filesTotal}
          fear={fear}
          elapsedMs={elapsedMs}
          hiding={hiding}
          flashlightOn={flashlightOn}
          progress={progress}
          lastRun={lastRun}
          toastLine={toastLine}
          jumpscareToken={jumpscareToken}
          jumpscareKind={jumpscareKind}
          isTouch={isTouch}
          networked={networked}
          menuPanel={menuPanel}
          playerName={playerName}
          joinCode={joinCode}
          roomCode={roomCode}
          lobbyPlayers={lobbyPlayers}
          localPlayerId={roomRef.current?.myId ?? ""}
          isHost={roomRef.current?.isHost ?? false}
          latencyMs={latencyMs}
          networkError={networkError}
          onPlayerNameChange={setPlayerName}
          onJoinCodeChange={(value) => setJoinCode(value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 5))}
          onMenuPanelChange={setMenuPanel}
          onSolo={handleSolo}
          onCreateRoom={() => { void handleCreateRoom(); }}
          onJoinRoom={() => { void handleJoinRoom(); }}
          onStartRoom={handleStartRoom}
          onLeaveRoom={handleLeaveRoom}
          onCopyInvite={handleCopyInvite}
          onReplay={handleReplay}
          onPause={handlePause}
          onResume={handleResume}
          onHide={handleHide}
          onFlashlight={handleFlashlight}
          onMute={handleMute}
          onBloom={handleBloom}
          onShake={handleShake}
          onLookSens={handleLookSens}
        />
      )}
    </div>
  );
}
