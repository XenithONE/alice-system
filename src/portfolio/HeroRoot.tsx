import { useEffect, useRef, useState } from "react";
import { hasWebGL } from "../lib/webgl";
import { detectHeroQuality } from "./quality";
import type { HeroScene, HeroWorkItem } from "./gl/brick/heroScene";

// Boots the toy-brick gallery scene inside the hero region. Same proven
// lifecycle as GlRoot: a CSS poster paints first, this boots at idle and fades
// in; reduced motion shows the frozen (still interactive) composition; without
// WebGL the poster and the DOM lockup stand alone. three.js is dynamically
// imported so it stays out of the initial entry payload.
export interface HeroRootProps {
  poster?: string;
  works: HeroWorkItem[];
  onHoverWork: (id: string | null) => void;
  onSelectWork: (id: string) => void;
  /** fires when the GL scene becomes usable / stops being usable */
  onLiveChange?: (live: boolean) => void;
}

export function HeroRoot({ poster, works, onHoverWork, onSelectWork, onLiveChange }: HeroRootProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [live, setLive] = useState(false);
  const [posterGone, setPosterGone] = useState(false);
  const eventsRef = useRef({ onHoverWork, onSelectWork, onLiveChange });
  eventsRef.current = { onHoverWork, onSelectWork, onLiveChange };
  const worksRef = useRef(works);

  useEffect(() => {
    eventsRef.current.onLiveChange?.(live);
    if (!live) {
      setPosterGone(false); // context loss etc. → bring the poster back
      return;
    }
    // Cross-fade: keep the poster mounted while the canvas fades in, then drop
    // it. transitionend is the fast path; the timeout covers reduced motion
    // (transition: none) and any missed event.
    const t = window.setTimeout(() => setPosterGone(true), 1100);
    return () => window.clearTimeout(t);
  }, [live]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let booting = false;
    let bootVersion = 0;
    let scene: HeroScene | null = null;
    let idleId = 0;
    let timeoutId = 0;
    let restoreRaf = 0;

    const stopScene = (updateState: boolean): void => {
      try {
        scene?.dispose();
      } catch (error) {
        if (import.meta.env.DEV) console.warn("Brick hero cleanup failed.", error);
      }
      scene = null;
      delete (window as { __brickHero?: HeroScene }).__brickHero;
      // A torn-down scene can never emit onHover(null) itself — clear here so
      // the caption doesn't stay stuck on the last hovered work.
      eventsRef.current.onHoverWork(null);
      if (updateState && !disposed) setLive(false);
    };

    const boot = async (): Promise<void> => {
      if (
        disposed ||
        booting ||
        scene ||
        document.documentElement.classList.contains("experience-3d-off") ||
        !hasWebGL()
      ) return;
      const quality = detectHeroQuality();

      booting = true;
      const version = ++bootVersion;
      try {
        const { createHeroScene } = await import("./gl/brick/heroScene");
        if (disposed || version !== bootVersion) return;

        const next = createHeroScene(canvas, quality, worksRef.current, {
          onHover: (id) => eventsRef.current.onHoverWork(id),
          onSelect: (id) => eventsRef.current.onSelectWork(id)
        });
        if (disposed || version !== bootVersion) {
          next.dispose();
          return;
        }
        scene = next;
        // QA seam (used by the offscreen capture-verify loop; harmless in prod)
        (window as { __brickHero?: HeroScene }).__brickHero = next;
        setLive(true);
      } catch (error) {
        if (import.meta.env.DEV) console.warn("Brick hero unavailable; using DOM fallback.", error);
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
      idleId = window.requestIdleCallback(() => void boot(), { timeout: 2000 });
    } else {
      timeoutId = window.setTimeout(() => void boot(), 200);
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
          style={{ backgroundImage: `url("${poster}")`, opacity: live ? 0 : 1 }}
          onTransitionEnd={() => {
            if (live) setPosterGone(true);
          }}
          aria-hidden="true"
        />
      )}
      <canvas ref={canvasRef} className={`brick-hero-canvas ${live ? "is-live" : ""}`} aria-hidden="true" />
    </>
  );
}
