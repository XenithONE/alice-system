import { useEffect, useRef, useState } from "react";
import { hasWebGL } from "../../lib/webgl";
import { detectHeroQuality } from "../quality";
import type { HeroScene } from "./heroScene";

// Lazy 3D hero: the CSS poster paints instantly; three loads at idle time via a
// dynamic import, then the canvas fades in. No WebGL → poster only.
export function HeroCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let scene: HeroScene | null = null;
    let idleId = 0;
    let timeoutId = 0;

    const boot = async (): Promise<void> => {
      if (disposed || !hasWebGL()) return;
      const { createHeroScene } = await import("./heroScene");
      if (disposed) return; // StrictMode double-mount: never init after cleanup
      scene = createHeroScene(canvas, detectHeroQuality());
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
      scene?.dispose();
      scene = null;
    };
  }, []);

  return <canvas ref={canvasRef} className={`hero-canvas ${live ? "is-live" : ""}`} aria-hidden="true" />;
}
