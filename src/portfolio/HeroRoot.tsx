import { useEffect, useRef, useState } from "react";
import { hasWebGL } from "../lib/webgl";
import { detectHeroQuality } from "./quality";
import type {
  HarborScene,
  HarborSceneState,
  HarborWorkItem
} from "./gl/harbor/harborScene";

export interface HeroRootProps {
  poster?: string;
  works: HarborWorkItem[];
  onHoverWork: (id: string | null) => void;
  onSelectWork: (id: string) => void;
  onState: (state: HarborSceneState) => void;
  onReady?: (scene: HarborScene | null) => void;
  onLiveChange?: (live: boolean) => void;
}

function shouldUsePosterFallback(): boolean {
  const forcedQuality = new URLSearchParams(window.location.search).get("q");
  if (forcedQuality === "high" || forcedQuality === "balanced" || forcedQuality === "low") return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return Boolean(connection?.saveData);
}

export function HeroRoot({
  poster,
  works,
  onHoverWork,
  onSelectWork,
  onState,
  onReady,
  onLiveChange
}: HeroRootProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [live, setLive] = useState(false);
  const [posterGone, setPosterGone] = useState(false);
  const eventsRef = useRef({ onHoverWork, onSelectWork, onState, onReady, onLiveChange });
  eventsRef.current = { onHoverWork, onSelectWork, onState, onReady, onLiveChange };
  const worksRef = useRef(works);

  useEffect(() => {
    eventsRef.current.onLiveChange?.(live);
    if (!live) {
      setPosterGone(false);
      return;
    }
    const timer = window.setTimeout(() => setPosterGone(true), 1100);
    return () => window.clearTimeout(timer);
  }, [live]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let booting = false;
    let bootVersion = 0;
    let scene: HarborScene | null = null;
    let restoreRaf = 0;

    const stopScene = (updateState: boolean): void => {
      try {
        scene?.dispose();
      } catch (error) {
        if (import.meta.env.DEV) console.warn("Harbor world cleanup failed.", error);
      }
      scene = null;
      delete (window as { __harborHero?: HarborScene }).__harborHero;
      eventsRef.current.onHoverWork(null);
      eventsRef.current.onReady?.(null);
      if (updateState && !disposed) setLive(false);
    };

    const boot = async (): Promise<void> => {
      if (
        disposed ||
        booting ||
        scene ||
        document.documentElement.classList.contains("experience-3d-off") ||
        shouldUsePosterFallback() ||
        !hasWebGL()
      ) return;
      const quality = detectHeroQuality();
      booting = true;
      const version = ++bootVersion;
      try {
        const { createHarborScene } = await import("./gl/harbor/harborScene");
        if (disposed || version !== bootVersion) return;

        const next = createHarborScene(canvas, quality, worksRef.current, {
          onHoverWork: (id) => eventsRef.current.onHoverWork(id),
          onSelectWork: (id) => eventsRef.current.onSelectWork(id),
          onState: (state) => eventsRef.current.onState(state)
        });
        if (disposed || version !== bootVersion) {
          next.dispose();
          return;
        }
        scene = next;
        (window as { __harborHero?: HarborScene }).__harborHero = next;
        eventsRef.current.onReady?.(next);
        setLive(true);
      } catch (error) {
        if (import.meta.env.DEV) console.warn("Harbor world unavailable; using poster fallback.", error);
        stopScene(true);
      } finally {
        if (version === bootVersion) booting = false;
      }
    };

    const onContextLost = (event: Event): void => {
      event.preventDefault();
      bootVersion += 1;
      booting = false;
      stopScene(true);
    };
    const onContextRestored = (): void => {
      if (disposed) return;
      window.cancelAnimationFrame(restoreRaf);
      restoreRaf = window.requestAnimationFrame(() => void boot());
    };

    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);

    // The harbor is the hero, so start it on the first paint. Low-memory devices
    // use the low tier; the poster is only a loading cover or WebGL fallback.
    restoreRaf = window.requestAnimationFrame(() => void boot());

    return () => {
      disposed = true;
      bootVersion += 1;
      window.cancelAnimationFrame(restoreRaf);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      stopScene(false);
    };
  }, []);

  return (
    <>
      {poster && !posterGone && (
        <div
          className="bh-poster"
          style={{ backgroundImage: `url("${poster}")`, opacity: live ? 0 : 1 }}
          onTransitionEnd={() => {
            if (live) setPosterGone(true);
          }}
          aria-hidden="true"
        />
      )}
      <canvas
        ref={canvasRef}
        className={`brick-hero-canvas ${live ? "is-live" : ""}`}
        aria-hidden="true"
      />
    </>
  );
}
