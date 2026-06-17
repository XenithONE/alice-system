import { useCallback, useEffect, useRef, useState } from "react";
import { CosmosCanvas } from "./components/CosmosCanvas";
import { Hud } from "./components/Hud";
import { LaunchOverlay } from "./components/LaunchOverlay";
import { TerminalPanel } from "./components/TerminalPanel";
import { WebglFallback } from "./components/WebglFallback";
import { AchievementsPanel } from "./components/AchievementsPanel";
import { WORLDS, type FragmentId, type World } from "./data/worlds";
import { CosmosEngine, type CosmosInfo, type TimeTrialEvent } from "./lib/cosmosEngine";
import {
  addDistance,
  advanceLoop,
  bumpVisits,
  collectFragment,
  collectStardust,
  readProgress,
  recordTimeTrial,
  revealHiddenPlanet,
  unlockAchievements,
  unlockTrueEnding,
  type ProgressState
} from "./lib/storage";
import { ACHIEVEMENTS, evaluate, type AchievementExtras } from "./lib/achievements";

const FRAGMENT_LINES: Record<FragmentId, string> = {
  anomaly: "◈ flaw observed. one signal fragment recovered.",
  terminal: "◈ derelict console awake. terminal fragment recovered.",
  lantern: "◈ light carried through the dark.",
  rift: "◈ rift breach survived.",
  voice: "◈ AlicE heard your voice.",
  idle: "◈ the quiet noticed you."
};

export default function App() {
  const [progress, setProgress] = useState<ProgressState>(() => readProgress(WORLDS));
  const [selected, setSelected] = useState<World | null>(null);
  const [nearest, setNearest] = useState<World | null>(null);
  const [launching, setLaunching] = useState<World | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [achievementsOpen, setAchievementsOpen] = useState(false);
  const [trial, setTrial] = useState<TimeTrialEvent | null>(null);
  const [info, setInfo] = useState<CosmosInfo | null>(null);
  const [aliceLine, setAliceLine] = useState("");
  const [webglError, setWebglError] = useState("");
  const engineRef = useRef<CosmosEngine | null>(null);
  const progressRef = useRef(progress);
  const visitBumped = useRef(false);
  const lineTimer = useRef<number | null>(null);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    if (visitBumped.current) return;
    visitBumped.current = true;
    bumpVisits();
    setProgress(readProgress(WORLDS));
  }, []);

  function speak(line: string): void {
    setAliceLine(line);
    if (lineTimer.current) window.clearTimeout(lineTimer.current);
    lineTimer.current = window.setTimeout(() => setAliceLine(""), 4200);
  }

  // Evaluate achievements against a fresh ProgressState; toast the first newly-earned one.
  function syncAchievements(state: ProgressState, extras?: AchievementExtras): ProgressState {
    const earned = evaluate(state, extras);
    const fresh = earned.filter((id) => !state.achievements.has(id));
    if (fresh.length === 0) return state;
    const next = unlockAchievements(earned, WORLDS);
    const ach = ACHIEVEMENTS.find((entry) => entry.id === fresh[0]);
    if (ach) speak(`ACHIEVEMENT // ${ach.title}`);
    return next;
  }

  useEffect(() => {
    const refresh = () => setProgress(syncAchievements(readProgress(WORLDS)));
    window.addEventListener("storage", refresh);
    const interval = window.setInterval(refresh, launching ? 1500 : 5000);
    return () => {
      window.removeEventListener("storage", refresh);
      window.clearInterval(interval);
    };
  }, [launching]);

  // Make the legacy parent.__markD() calls in some games refresh progress live.
  useEffect(() => {
    window.__markD = () => setProgress(syncAchievements(readProgress(WORLDS)));
    return () => {
      delete window.__markD;
    };
  }, []);

  const handleCollectFragment = useCallback((fragment: FragmentId) => {
    const alreadyHad = progressRef.current.fragments.has(fragment);
    const collected = collectFragment(fragment, WORLDS);
    if (!alreadyHad) {
      speak(FRAGMENT_LINES[fragment]);
      if (collected.accord) speak("◈ THE EIDOLON ACCORD is open.");
    }
    setProgress(syncAchievements(collected));
  }, []);

  const handleHiddenReveal = useCallback(() => {
    const already = progressRef.current.hiddenPlanet;
    const next = syncAchievements(revealHiddenPlanet(WORLDS));
    setProgress(next);
    if (!already) speak("◈ hidden planet surfaced beyond the mapped orbit.");
  }, []);

  const triggerHiddenReveal = useCallback(() => {
    if (engineRef.current) engineRef.current.revealHiddenPlanet();
    else handleHiddenReveal();
  }, [handleHiddenReveal]);

  const handleUnlockTrue = useCallback(() => {
    setProgress(syncAchievements(unlockTrueEnding(WORLDS)));
    speak("◈ THE SEVENTH SIGNAL is open.");
  }, []);

  const handleCollectStardust = useCallback((id: string) => {
    const next = syncAchievements(collectStardust(id, WORLDS));
    setProgress(next);
    if (next.stardustToday.size > 0 && next.stardustToday.size % 10 === 0) {
      speak(`STARDUST ${next.stardustToday.size} // total ${next.stardustTotal}`);
    }
  }, []);

  const handleFlyDistance = useCallback((units: number) => {
    addDistance(units);
  }, []);

  const handleTimeTrial = useCallback((event: TimeTrialEvent) => {
    if (event.phase === "finish") {
      setTrial(null);
      const next = syncAchievements(recordTimeTrial(event.ms, WORLDS), { timeTrialFinished: true });
      setProgress(next);
      speak(`RING RUN ${(event.ms / 1000).toFixed(2)}s${event.ms <= next.timeTrialBest ? " // NEW BEST" : ""}`);
    } else if (event.phase === "cancel") {
      setTrial(null);
    } else {
      setTrial(event);
    }
  }, []);

  const handleStartTrial = useCallback(() => {
    setAchievementsOpen(false);
    setTerminalOpen(false);
    engineRef.current?.startTimeTrial();
  }, []);

  const handleAdvanceLoop = useCallback(() => {
    const next = syncAchievements(advanceLoop(WORLDS));
    setProgress(next);
    speak(`◈ NEW LOOP ${next.loop} // the signal remembers.`);
  }, []);

  const handleLaunchClose = useCallback(() => {
    setLaunching(null);
    setProgress(syncAchievements(readProgress(WORLDS)));
  }, []);

  const handleFocus = useCallback((id: string) => {
    const world = WORLDS.find((entry) => entry.id === id) ?? null;
    if (world && (!world.hidden || progressRef.current.hiddenPlanet)) {
      setSelected(world);
      engineRef.current?.focusWorld(id);
    }
  }, []);

  const handleLaunch = useCallback((world: World) => {
    setSelected(world);
    setLaunching(world);
  }, []);

  const handleError = useCallback((message: string) => {
    setWebglError(message);
  }, []);

  const showFallback = Boolean(webglError);

  return (
    <div className="app-shell">
      {showFallback ? (
        <WebglFallback />
      ) : (
        <CosmosCanvas
          progress={progress}
          onSelectWorld={setSelected}
          onNearestWorld={setNearest}
          onCollectFragment={handleCollectFragment}
          onRevealHiddenPlanet={handleHiddenReveal}
          onReady={setInfo}
          onError={handleError}
          onCollectStardust={handleCollectStardust}
          onFlyDistance={handleFlyDistance}
          onTimeTrial={handleTimeTrial}
          onEngine={(engine) => {
            engineRef.current = engine;
          }}
        />
      )}

      {!showFallback && (
        <Hud
          selected={selected}
          nearest={nearest}
          progress={progress}
          info={info}
          aliceLine={aliceLine}
          trial={trial}
          onLaunch={handleLaunch}
          onFocus={handleFocus}
          onReset={() => engineRef.current?.resetCamera()}
          onTerminal={() => setTerminalOpen(true)}
          onMissions={() => setAchievementsOpen(true)}
          onStartTrial={handleStartTrial}
        />
      )}

      <LaunchOverlay world={launching} onClose={handleLaunchClose} />
      <AchievementsPanel open={achievementsOpen} progress={progress} onClose={() => setAchievementsOpen(false)} />
      <TerminalPanel
        open={terminalOpen}
        progress={progress}
        worlds={WORLDS}
        onClose={() => setTerminalOpen(false)}
        onCollect={handleCollectFragment}
        onRevealHidden={triggerHiddenReveal}
        onUnlockTrue={handleUnlockTrue}
        onMissions={() => setAchievementsOpen(true)}
        onStartTrial={handleStartTrial}
        onAdvanceLoop={handleAdvanceLoop}
      />
      <div className="grain" aria-hidden="true" />
      <div className="vignette" aria-hidden="true" />
    </div>
  );
}
