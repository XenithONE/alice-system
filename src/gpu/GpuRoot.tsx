import { useEffect, useRef } from "react";
import { probeWebGpu, type GpuSupport } from "./support";

/**
 * A WebGPU canvas with a lifecycle that survives StrictMode, a device loss and
 * a reader changing their mind.
 *
 * Modelled on src/portfolio/gl/GlRoot.tsx, with five differences that are all
 * consequences of the backend rather than preferences:
 *
 *  1. support is asynchronous. hasWebGL() is a synchronous canvas call;
 *     WebGPU needs an adapter and a device, so the guard is an await and the
 *     chunk is not fetched until it resolves.
 *
 *  2. THERE IS NO webglcontextlost EVENT. A lost WebGPU device surfaces as
 *     renderer.onDeviceLost, whose default implementation logs to the console
 *     AND KEEPS THE LOOP RUNNING — every frame after that submits work to a
 *     dead device. The scene is required to replace it and call back here.
 *     There is also no restored event, so nothing reboots on its own: the page
 *     falls back to its DOM state and offers a reload, which is the honest
 *     thing to offer for a condition the page cannot fix.
 *
 *  3. building the world is asynchronous too — renderer.init() returns a
 *     promise, and so does every texture upload.
 *
 *  4. the frame loop is the renderer's. setAnimationLoop returns a PROMISE on
 *     this backend, so an unhandled rejection there is a silent stop.
 *
 *  5. THREE awaits, not one. GlRoot had a single import to guard; this has
 *     probe, import and createWorld. Each one is a place where a StrictMode
 *     double-mount can leave a whole second GPUDevice and a second copy of
 *     every buffer alive, with nothing on screen to say so. Every await below
 *     is followed by the same version check, and that repetition is the point.
 */

export interface GpuWorld {
  dispose(): void;
}

export interface GpuHooks {
  /** The scene MUST call this from renderer.onDeviceLost. */
  onDeviceLost(detail: string): void;
}

export type GpuFactory = (canvas: HTMLCanvasElement, hooks: GpuHooks) => Promise<GpuWorld>;

export type GpuState =
  | { kind: "idle" }
  | { kind: "live" }
  | { kind: "unsupported"; detail: string }
  | { kind: "failed"; detail: string };

export interface GpuRootProps {
  /** Class name for the canvas element. */
  className: string;
  /** Added to <html> while the world is live, removed the moment it is not. */
  liveClass: string;
  /**
   * The page's own dynamic import. Keeping it here rather than inside this
   * module is what puts the renderer chunk in the page's graph instead of in
   * a chunk shared with anything that ever imports GpuRoot.
   */
  load: () => Promise<GpuFactory>;
  /** The page decides policy — motion off, reader opted out, too small. */
  enabled: boolean;
  onState(state: GpuState): void;
}

export function GpuRoot({ className, liveClass, load, enabled, onState }: GpuRootProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /* onState changes identity every render; the effect must not restart for
     that, or every state report would tear the world down and rebuild it. */
  const report = useRef(onState);
  report.current = onState;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let booting = false;
    let bootVersion = 0;
    let world: GpuWorld | null = null;

    const stop = (): void => {
      try {
        world?.dispose();
      } catch (error) {
        /* A lost device makes driver cleanup throw. The DOM state still has to
           become the page, so this is caught rather than allowed to abort the
           teardown half-way. */
        if (import.meta.env.DEV) console.warn("GPU world cleanup failed.", error);
      }
      world = null;
      document.documentElement.classList.remove(liveClass);
    };

    const boot = async (): Promise<void> => {
      if (disposed || booting || world || !enabled) return;
      booting = true;
      const version = ++bootVersion;
      try {
        const support: GpuSupport = await probeWebGpu();
        if (disposed || version !== bootVersion) return; // await 1 of 3
        if (!support.ok) {
          report.current({ kind: "unsupported", detail: support.detail });
          return;
        }

        const factory = await load();
        if (disposed || version !== bootVersion) return; // await 2 of 3

        const next = await factory(canvas, {
          onDeviceLost: (detail) => {
            /* Bumping the version first is what stops a boot that is still in
               flight from installing itself over the top of this. */
            bootVersion += 1;
            booting = false;
            stop();
            report.current({ kind: "failed", detail });
          }
        });
        if (disposed || version !== bootVersion) {
          /* The world is already built and already owns a device. Dropping the
             reference would leave it running — dispose is the only way back. */
          next.dispose();
          return; // await 3 of 3
        }

        world = next;
        document.documentElement.classList.add(liveClass);
        report.current({ kind: "live" });
      } catch (error) {
        if (import.meta.env.DEV) console.warn("GPU world failed to start.", error);
        stop();
        report.current({
          kind: "failed",
          detail: error instanceof Error ? error.message : String(error)
        });
      } finally {
        if (version === bootVersion) booting = false;
      }
    };

    if (enabled) {
      /* Idle, with a timeout: a hidden or busy tab may never report idle, and
         the corridor should be standing by the moment the tab is looked at. */
      if (typeof window.requestIdleCallback === "function") {
        const id = window.requestIdleCallback(() => void boot(), { timeout: 1500 });
        return () => {
          disposed = true;
          bootVersion += 1;
          window.cancelIdleCallback?.(id);
          stop();
        };
      }
      const id = window.setTimeout(() => void boot(), 120);
      return () => {
        disposed = true;
        bootVersion += 1;
        window.clearTimeout(id);
        stop();
      };
    }

    report.current({ kind: "idle" });
    return () => {
      disposed = true;
      bootVersion += 1;
      stop();
    };
  }, [enabled, liveClass, load]);

  /* aria-hidden and no tabindex, permanently. Nothing inside the world is ever
     focusable, which is why focus cannot end up behind the wall. */
  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
