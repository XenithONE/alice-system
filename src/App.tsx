import { useCallback, useRef, useState } from "react";
import { GameCanvas } from "./components/GameCanvas";
import { Hud } from "./components/Hud";
import type { GameInfo, GameMode, HorrorEngine, JumpscareKind, RunEndResult } from "./lib/horrorEngine";
import { advanceLoop, readProgress, recordRun, recordScare, unlockAchievements, type ProgressState } from "./lib/storage";
import { ACHIEVEMENTS, evaluate } from "./lib/achievements";

const SCARE_LINES: Record<JumpscareKind, string> = {
  chase: "◈ THE WARDEN FOUND YOU.",
  mirror: "◈ something looked back.",
  locker: "◈ something moved nearby.",
  finale: "◈ it was waiting at the door.",
  ambient: "◈ ...did you hear that?"
};

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

  const engineRef = useRef<HorrorEngine | null>(null);
  const loopRef = useRef(progress.loop);
  const toastTimer = useRef<number | null>(null);
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
    const ach = ACHIEVEMENTS.find((entry) => entry.id === fresh[0]);
    if (ach) speak(`ACHIEVEMENT // ${ach.title}`);
    return next;
  }, [speak]);

  const handleReady = useCallback((gameInfo: GameInfo) => setInfo(gameInfo), []);
  const handleError = useCallback((message: string) => setWebglError(message), []);
  const handleFilesUpdate = useCallback((found: number, total: number) => { setFilesFound(found); setFilesTotal(total); }, []);
  const handleFear = useCallback((value: number) => setFear(value), []);
  const handleTime = useCallback((ms: number) => setElapsedMs(ms), []);
  const handleHideChange = useCallback((value: boolean) => setHiding(value), []);
  const handleFlashlightChange = useCallback((value: boolean) => setFlashlightOn(value), []);
  const handleModeChange = useCallback((next: GameMode) => setMode(next), []);

  const handleJumpscare = useCallback((kind: JumpscareKind) => {
    setJumpscareKind(kind);
    setJumpscareToken((t) => t + 1);
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
      // Subsequent wins gently remix the ward layout (NG+) on the next run.
      next = syncAchievements(advanceLoop());
      loopRef.current = next.loop;
    } else if (result.won && next.wins === 1) {
      loopRef.current = next.loop;
    }
    setProgress(next);
  }, [syncAchievements]);

  const handleEngine = useCallback((engine: HorrorEngine) => { engineRef.current = engine; }, []);

  const handleStart = useCallback(() => {
    engineRef.current?.setLoop(loopRef.current);
    engineRef.current?.start();
  }, []);
  const handlePause = useCallback(() => engineRef.current?.pause(), []);
  const handleResume = useCallback(() => engineRef.current?.resume(), []);
  const handleHide = useCallback(() => engineRef.current?.toggleHide(), []);
  const handleFlashlight = useCallback(() => engineRef.current?.toggleFlashlight(), []);
  const handleMute = useCallback((muted: boolean) => engineRef.current?.setMuted(muted), []);
  const handleBloom = useCallback((enabled: boolean) => engineRef.current?.setBloomEnabled(enabled), []);
  const handleShake = useCallback((enabled: boolean) => engineRef.current?.setShakeEnabled(enabled), []);
  const handleLookSens = useCallback((v: number) => engineRef.current?.setLookSens(v), []);

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
          onStart={handleStart}
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
