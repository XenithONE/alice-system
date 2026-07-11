import { useEffect, useRef, useState } from "react";
import { hasWebGL } from "../../lib/webgl";
import { detectHeroQuality } from "../quality";
import type { GlScene } from "./glScene";

// Persistent full-viewport WebGL layer behind the whole page. The CSS poster and
// plain <img> covers paint first; this boots at idle and takes over visuals.
// Reduced-motion keeps this layer visible with ambient motion frozen. Without
// WebGL, the complete DOM composition and poster still stand alone.
export function GlRoot() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let booting = false;
    let bootVersion = 0;
    let scene: GlScene | null = null;
    let idleId = 0;
    let timeoutId = 0;
    let restoreRaf = 0;
    let experienceRaf = 0;

    const stopScene = (updateState: boolean): void => {
      try {
        scene?.dispose();
      } catch (error) {
        // Context loss can make driver cleanup throw. The DOM fallback must still
        // become active and a later context-restored event may safely reboot it.
        if (import.meta.env.DEV) console.warn("Creation core cleanup failed.", error);
      }
      scene = null;
      document.documentElement.classList.remove("gl-on");
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
        const { createGlScene } = await import("./glScene");
        if (disposed || version !== bootVersion) return; // StrictMode / context-loss guard

        const nextScene = createGlScene(canvas, quality);
        if (disposed || version !== bootVersion) {
          nextScene.dispose();
          return;
        }
        scene = nextScene;
        document.documentElement.classList.add("gl-on");
        setLive(true);
      } catch (error) {
        // The complete DOM composition remains visible when WebGL setup fails.
        if (import.meta.env.DEV) console.warn("Creation core unavailable; using DOM fallback.", error);
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

    const onExperienceChange = (): void => {
      bootVersion += 1;
      booting = false;
      stopScene(true);
      window.cancelAnimationFrame(experienceRaf);
      if (!document.documentElement.classList.contains("experience-3d-off")) {
        experienceRaf = window.requestAnimationFrame(() => void boot());
      }
    };

    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);
    // Listen on both common dispatch targets. A bubbling document event may invoke
    // this twice; the RAF cancellation makes the resulting reboot idempotent.
    document.addEventListener("alice:experience-change", onExperienceChange);
    window.addEventListener("alice:experience-change", onExperienceChange);

    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(() => void boot());
    } else {
      timeoutId = window.setTimeout(() => void boot(), 200);
    }

    return () => {
      disposed = true;
      bootVersion += 1;
      if (idleId) window.cancelIdleCallback?.(idleId);
      if (timeoutId) window.clearTimeout(timeoutId);
      window.cancelAnimationFrame(restoreRaf);
      window.cancelAnimationFrame(experienceRaf);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      document.removeEventListener("alice:experience-change", onExperienceChange);
      window.removeEventListener("alice:experience-change", onExperienceChange);
      stopScene(false);
    };
  }, []);

  return <canvas ref={canvasRef} className={`gl-canvas ${live ? "is-live" : ""}`} aria-hidden="true" />;
}
