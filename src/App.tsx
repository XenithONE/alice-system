import { useCallback, useEffect, useRef, useState } from "react";
import { CosmosCanvas } from "./components/CosmosCanvas";
import { Hud } from "./components/Hud";
import { LaunchOverlay } from "./components/LaunchOverlay";
import { TerminalPanel } from "./components/TerminalPanel";
import { WebglFallback } from "./components/WebglFallback";
import { WORLDS, type FragmentId, type World } from "./data/worlds";
import { CosmosEngine, type CosmosInfo } from "./lib/cosmosEngine";
import {
  bumpVisits,
  collectFragment,
  readProgress,
  revealHiddenPlanet,
  unlockTrueEnding,
  type ProgressState
} from "./lib/storage";

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

  useEffect(() => {
    const refresh = () => setProgress(readProgress(WORLDS));
    window.addEventListener("storage", refresh);
    const interval = window.setInterval(refresh, launching ? 900 : 2200);
    return () => {
      window.removeEventListener("storage", refresh);
      window.clearInterval(interval);
    };
  }, [launching]);

  function speak(line: string): void {
    setAliceLine(line);
    if (lineTimer.current) window.clearTimeout(lineTimer.current);
    lineTimer.current = window.setTimeout(() => setAliceLine(""), 4200);
  }

  const handleCollectFragment = useCallback((fragment: FragmentId) => {
    const alreadyHad = progressRef.current.fragments.has(fragment);
    const next = collectFragment(fragment, WORLDS);
    setProgress(next);
    if (!alreadyHad) {
      speak(FRAGMENT_LINES[fragment]);
      if (next.accord) speak("◈ THE EIDOLON ACCORD is open.");
    }
  }, []);

  const handleHiddenReveal = useCallback(() => {
    const already = progressRef.current.hiddenPlanet;
    const next = revealHiddenPlanet(WORLDS);
    setProgress(next);
    if (!already) speak("◈ hidden planet surfaced beyond the mapped orbit.");
  }, []);

  const triggerHiddenReveal = useCallback(() => {
    if (engineRef.current) engineRef.current.revealHiddenPlanet();
    else handleHiddenReveal();
  }, [handleHiddenReveal]);

  const handleUnlockTrue = useCallback(() => {
    const next = unlockTrueEnding(WORLDS);
    setProgress(next);
    speak("◈ THE SEVENTH SIGNAL is open.");
  }, []);

  const handleLaunchClose = useCallback(() => {
    setLaunching(null);
    setProgress(readProgress(WORLDS));
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
          onLaunch={handleLaunch}
          onFocus={handleFocus}
          onReset={() => engineRef.current?.resetCamera()}
          onTerminal={() => setTerminalOpen(true)}
        />
      )}

      <LaunchOverlay world={launching} onClose={handleLaunchClose} />
      <TerminalPanel
        open={terminalOpen}
        progress={progress}
        worlds={WORLDS}
        onClose={() => setTerminalOpen(false)}
        onCollect={handleCollectFragment}
        onRevealHidden={triggerHiddenReveal}
        onUnlockTrue={handleUnlockTrue}
      />
      <div className="grain" aria-hidden="true" />
      <div className="vignette" aria-hidden="true" />
    </div>
  );
}
