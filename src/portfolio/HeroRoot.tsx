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
  keepPoster?: boolean;
}

function shouldUsePosterFallback(): boolean {
  const forcedQuality = new URLSearchParams(window.location.search).get("q");
  if (forcedQuality === "high" || forcedQuality === "balanced" || forcedQuality === "low") return false;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  const memory = "deviceMemory" in navigator
    ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4)
    : 4;
  return reducedMotion || Boolean(connection?.saveData) || memory < 3;
}

export function HeroRoot({
  poster,
  works,
  onHoverWork,
  onSelectWork,
  onState,
  onReady,
  onLiveChange,
  keepPoster = false
}: HeroRootProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [live, setLive] = useState(false);
  const [posterGone, setPosterGone] = useState(false);
  const eventsRef = useRef({ onHoverWork, onSelectWork, onState, onReady, onLiveChange });
  eventsRef.current = { onHoverWork, onSelectWork, onState, onReady, onLiveChange };
  const worksRef = useRef(works);

  useEffect(() => {
    eventsRef.current.onLiveChange?.(live);
    if (!live || keepPoster) {
      setPosterGone(false);
      return;
    }
    const timer = window.setTimeout(() => setPosterGone(true), 1100);
    return () => window.clearTimeout(timer);
  }, [keepPoster, live]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let booting = false;
    let bootVersion = 0;
    let scene: HarborScene | null = null;
    let idleId = 0;
    let timeoutId = 0;
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

    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(() => void boot(), { timeout: 1800 });
    } else {
      timeoutId = window.setTimeout(() => void boot(), 180);
    }

    return () => {
      disposed = true;
      bootVersion += 1;
      if (idleId) window.cancelIdleCallback?.(idleId);
      if (timeoutId) window.clearTimeout(timeoutId);
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
          style={{ backgroundImage: `url("${poster}")`, opacity: live && !keepPoster ? 0 : 1 }}
          onTransitionEnd={() => {
            if (live && !keepPoster) setPosterGone(true);
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
