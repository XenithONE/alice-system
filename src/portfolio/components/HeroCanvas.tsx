import { useEffect, useRef, useState } from "react";
import { hasWebGL } from "../../lib/webgl";
import type { HeroSignalHandle } from "../gl/heroSignal";

const BASE = import.meta.env.BASE_URL;

/**
 * Lazy WebGL signal behind the masthead. Falls back to a static cover collage
 * when WebGL is missing, reduced-motion is on, or the viewport is narrow.
 */
export function HeroCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [mode, setMode] = useState<"pending" | "webgl" | "fallback">("pending");

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const narrow = window.matchMedia("(max-width: 720px)").matches;
    if (reduced || narrow || !hasWebGL()) {
      setMode("fallback");
      return;
    }

    let disposed = false;
    let handle: HeroSignalHandle | null = null;
    let idleId = 0;
    let timeoutId = 0;

    const boot = async (): Promise<void> => {
      if (disposed || !canvasRef.current) return;
      try {
        const { createHeroSignal } = await import("../gl/heroSignal");
        if (disposed || !canvasRef.current) return;
        handle = createHeroSignal(canvasRef.current);
        setMode("webgl");
      } catch {
        setMode("fallback");
      }
    };

    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(() => void boot(), { timeout: 1200 });
    } else {
      timeoutId = window.setTimeout(() => void boot(), 120);
    }

    return () => {
      disposed = true;
      if (idleId) window.cancelIdleCallback?.(idleId);
      if (timeoutId) window.clearTimeout(timeoutId);
      handle?.dispose();
    };
  }, []);

  const fallbackStyle = {
    backgroundImage: [
      "radial-gradient(ellipse at 70% 40%, rgba(230, 173, 70, 0.16), transparent 55%)",
      "radial-gradient(ellipse at 20% 80%, rgba(8, 169, 197, 0.12), transparent 50%)",
      "linear-gradient(105deg, rgba(6, 28, 49, 0.92) 0%, rgba(6, 28, 49, 0.55) 42%, rgba(6, 28, 49, 0.25) 100%)",
      `url(${BASE}assets/hollow-ward-poster.webp)`,
      `url(${BASE}assets/relic-road-brick.webp)`,
    ].join(", "),
    backgroundSize: "auto, auto, auto, cover, 48%",
    backgroundPosition: "center, center, center, center, right bottom",
    backgroundRepeat: "no-repeat",
  } as const;

  return (
    <div className="hero-stage" aria-hidden="true">
      <canvas
        ref={canvasRef}
        className={`hero-canvas ${mode === "webgl" ? "is-live" : ""}`}
      />
      <div
        className={`hero-fallback ${mode !== "webgl" ? "is-visible" : ""}`}
        style={fallbackStyle}
      />
      <div className="hero-veil" />
    </div>
  );
}
