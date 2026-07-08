import { useEffect } from "react";
import Lenis from "lenis";

// Shared scroll state the 3D hero reads without re-rendering React.
export const scrollState = { y: 0 };

// Smooth inertial scrolling. Skipped entirely under prefers-reduced-motion —
// native scroll + instant anchors apply there instead.
export function useLenis(): void {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const lenis = new Lenis({ lerp: 0.1, anchors: true });
    let rafId = 0;
    const raf = (time: number): void => {
      lenis.raf(time);
      rafId = window.requestAnimationFrame(raf);
    };
    rafId = window.requestAnimationFrame(raf);

    const onScroll = (instance: Lenis): void => {
      scrollState.y = instance.scroll;
      // Drive the hero's CSS parallax (opacity/translate) without React churn.
      document.documentElement.style.setProperty("--scroll-y", String(Math.round(instance.scroll)));
    };
    lenis.on("scroll", onScroll);

    return () => {
      window.cancelAnimationFrame(rafId);
      lenis.destroy();
    };
  }, []);
}
