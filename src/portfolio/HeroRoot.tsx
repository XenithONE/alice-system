import { useEffect, useRef, useState } from "react";
import { hasWebGL } from "../lib/webgl";
import { detectHeroQuality } from "./quality";
import type { HeroScene } from "./gl/brick/heroScene";

// Boots the toy-brick hero scene inside the hero region. Same proven lifecycle as
// GlRoot: a CSS poster paints first, this boots at idle and fades in; reduced
// motion still shows the frozen brick composition; without WebGL the poster and
// the DOM lockup stand alone. three.js is dynamically imported so it stays out of
// the initial entry payload.
export function HeroRoot() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [live, setLive] = useState(false);

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

        const next = createHeroScene(canvas, quality);
        if (disposed || version !== bootVersion) {
          next.dispose();
          return;
        }
        scene = next;
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

  return <canvas ref={canvasRef} className={`brick-hero-canvas ${live ? "is-live" : ""}`} aria-hidden="true" />;
}
