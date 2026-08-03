import { useEffect, useRef } from "react";
import { hasWebGL2 } from "../../lib/webgl";
import { useMotion } from "../motion";
import type { FluidLayerHandle } from "../gl/fluidLayer";

/*
 * Mounts the fluid ground. Lifecycle lifted from GlRoot.tsx: idle boot with a
 * timeout floor, a boot version so StrictMode's double-invoke and a context
 * loss cannot interleave two live layers, dispose on the way out.
 *
 * Conditions, in order of cheapness: motion (the class), a fine pointer
 * (v13.0 ships the fluid desktop-first — the pointer is its instrument;
 * touch readers get the full CSS choreography instead), then WebGL2. Any
 * miss = the static ground, which is a complete page on its own.
 *
 * DOM side effects live HERE, not in the layer: `is-live` on the canvas
 * fades it in, `fluid-on` on <html> lets body go transparent (theme.css).
 * The cleanup must undo both — a dangling fluid-on with no canvas painting
 * would leave the page grounded on html's background alone.
 */
export function FluidRoot() {
  const motion = useMotion();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!motion) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (!hasWebGL2()) return;

    let disposed = false;
    let version = 0;
    let handle: FluidLayerHandle | null = null;
    let idleId = 0;
    let timeoutId = 0;

    const setLive = (on: boolean): void => {
      canvasRef.current?.classList.toggle("is-live", on);
      document.documentElement.classList.toggle("fluid-on", on);
    };

    const boot = async (): Promise<void> => {
      if (disposed || !canvasRef.current) return;
      const v = ++version;
      const { createFluidLayer } = await import("../gl/fluidLayer");
      if (disposed || v !== version || !canvasRef.current) return;
      handle = createFluidLayer(canvasRef.current, {
        onAlive: () => setLive(true),
        onDead: () => setLive(false),
        onContextLost: () => {
          // Dispose and re-boot after a beat — restored contexts arrive with
          // all objects invalid, so rebuilding wholesale is the honest path.
          setLive(false);
          handle?.dispose();
          handle = null;
          timeoutId = window.setTimeout(() => void boot(), 800);
        },
      });
    };

    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(() => void boot(), { timeout: 2000 });
    } else {
      timeoutId = window.setTimeout(() => void boot(), 300);
    }

    return () => {
      disposed = true;
      if (idleId) window.cancelIdleCallback?.(idleId);
      if (timeoutId) window.clearTimeout(timeoutId);
      handle?.dispose();
      handle = null;
      setLive(false);
    };
  }, [motion]);

  return <canvas ref={canvasRef} className="fluid-canvas" aria-hidden="true" />;
}
