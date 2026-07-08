import { useEffect, useRef, useState } from "react";
import { hasWebGL } from "../../lib/webgl";
import { detectHeroQuality } from "../quality";
import type { GlScene } from "./glScene";

// Persistent full-viewport WebGL layer behind the whole page. The CSS poster and
// plain <img> covers paint first; this boots at idle and takes over visuals.
// Never boots under reduced-motion / low tier / no WebGL — the DOM site stands alone.
export function GlRoot() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let scene: GlScene | null = null;
    let idleId = 0;
    let timeoutId = 0;

    const boot = async (): Promise<void> => {
      if (disposed || !hasWebGL()) return;
      const quality = detectHeroQuality();
      if (quality.tier === "low" || !quality.animate) return; // DOM-only path
      const { createGlScene } = await import("./glScene");
      if (disposed) return; // StrictMode double-mount guard
      scene = createGlScene(canvas, quality);
      document.documentElement.classList.add("gl-on");
      setLive(true);
    };

    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(() => void boot());
    } else {
      timeoutId = window.setTimeout(() => void boot(), 200);
    }

    return () => {
      disposed = true;
      if (idleId) window.cancelIdleCallback?.(idleId);
      if (timeoutId) window.clearTimeout(timeoutId);
      document.documentElement.classList.remove("gl-on");
      scene?.dispose();
      scene = null;
    };
  }, []);

  return <canvas ref={canvasRef} className={`gl-canvas ${live ? "is-live" : ""}`} aria-hidden="true" />;
}
