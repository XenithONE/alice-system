import { useCallback, useEffect, useRef, useState } from "react";
import { useMotion } from "./motion";

/*
 * The active index of a coverflow, and every way a reader can move it.
 *
 * The one rule that separates this from the 2010s carousel it resembles:
 * NOTHING moves on its own. Wheel, drag, arrow keys and a click on a side
 * panel all set the same index, and the panels follow. An auto-rotating
 * gallery reads as a demo from 2018 and, worse, takes the choice away from
 * the person who came to look.
 *
 * The hook returns `enabled` false when the 3D form should not exist at
 * all — motion off, no fine pointer for the drag affordances, or a browser
 * without preserve-3d. The caller then renders its flat grid, which is the
 * base sheet rather than a second implementation.
 */

export interface Coverflow {
  enabled: boolean;
  active: number;
  setActive: (i: number) => void;
  step: (delta: number) => void;
  /** Spread onto the element that owns the gesture surface. */
  bind: {
    onWheel: (e: React.WheelEvent) => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
    onPointerDown: (e: React.PointerEvent) => void;
  };
}

const supports3d = (): boolean =>
  typeof CSS !== "undefined" && CSS.supports("transform-style", "preserve-3d");

export function useCoverflow(count: number): Coverflow {
  const motion = useMotion();
  const [enabled, setEnabled] = useState(false);
  const [active, setActiveState] = useState(0);

  useEffect(() => {
    setEnabled(
      motion &&
        supports3d() &&
        window.matchMedia("(min-width: 900px) and (pointer: fine)").matches
    );
  }, [motion]);

  const clamp = useCallback(
    (i: number) => Math.max(0, Math.min(count - 1, i)),
    [count]
  );
  const setActive = useCallback((i: number) => setActiveState(clamp(i)), [clamp]);
  const step = useCallback((d: number) => setActiveState((a) => clamp(a + d)), [clamp]);

  /*
   * Wheel: one notch, one panel, with a cooldown — a trackpad emits dozens
   * of events per flick and without the gate a single gesture would fly
   * past every panel. Only horizontal-dominant or shift-wheel scrolling is
   * captured; a plain vertical wheel must still scroll the page, or the
   * section becomes a trap the reader cannot get out of.
   */
  const lastWheel = useRef(0);
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey;
      if (!horizontal) return;
      const now = e.timeStamp;
      if (now - lastWheel.current < 260) return;
      lastWheel.current = now;
      step(Math.sign(e.deltaX || e.deltaY));
    },
    [step]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const map: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
      if (e.key in map) {
        e.preventDefault();
        step(map[e.key]!);
      } else if (e.key === "Home") {
        e.preventDefault();
        setActive(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setActive(count - 1);
      }
    },
    [step, setActive, count]
  );

  /*
   * Drag with pointer capture. A drag that never passes the slop threshold
   * is left alone so it can become a click on the panel's own link —
   * otherwise every attempt to open a work would be swallowed as a gesture.
   */
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const el = e.currentTarget as HTMLElement;
      const startX = e.clientX;
      const startActive = active;
      let moved = false;

      const onMove = (ev: PointerEvent): void => {
        const dx = ev.clientX - startX;
        if (!moved && Math.abs(dx) < 8) return;
        if (!moved) {
          moved = true;
          el.setPointerCapture(ev.pointerId);
        }
        // 190px of travel per panel — heavy enough to feel like a bound book.
        setActive(startActive - Math.round(dx / 190));
      };
      const onUp = (ev: PointerEvent): void => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        if (moved && el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [active, setActive]
  );

  // A shorter catalogue must not leave the index stranded past the end.
  useEffect(() => setActiveState((a) => Math.max(0, Math.min(count - 1, a))), [count]);

  return { enabled, active, setActive, step, bind: { onWheel, onKeyDown, onPointerDown } };
}
