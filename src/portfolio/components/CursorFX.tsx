import { useEffect, useRef } from "react";

// Custom cursor (dot + trailing ring, difference blend) with a magnetic pull on
// [data-magnetic] elements. Desktop fine-pointer only; disabled for reduced motion.
export function CursorFX() {
  const dotRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const dot = dotRef.current;
    const ring = ringRef.current;
    if (!dot || !ring) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    document.documentElement.classList.add("cursor-on");
    let x = -100;
    let y = -100;
    let ringX = -100;
    let ringY = -100;
    let scale = 1;
    let scaleTarget = 1;
    let magnetic: HTMLElement | null = null;
    let rafId = 0;

    let hidden = false;
    const onMove = (e: PointerEvent): void => {
      if (hidden) { dot.style.opacity = "1"; ring.style.opacity = "1"; hidden = false; }
      x = e.clientX;
      y = e.clientY;
      const target = (e.target as HTMLElement | null)?.closest?.("a, button, [data-magnetic]") as HTMLElement | null;
      scaleTarget = target ? 1.65 : 1;
      const nextMagnetic = (e.target as HTMLElement | null)?.closest?.("[data-magnetic]") as HTMLElement | null;
      if (magnetic && magnetic !== nextMagnetic) magnetic.style.transform = "";
      magnetic = nextMagnetic;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const onLeave = (): void => {
      scaleTarget = 1;
      if (magnetic) { magnetic.style.transform = ""; magnetic = null; }
      // Hide instead of freezing at the viewport edge when the OS cursor leaves.
      dot.style.opacity = "0";
      ring.style.opacity = "0";
      hidden = true;
    };
    document.documentElement.addEventListener("pointerleave", onLeave);

    const loop = (): void => {
      ringX += (x - ringX) * 0.16;
      ringY += (y - ringY) * 0.16;
      scale += (scaleTarget - scale) * 0.14;
      dot.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      ring.style.transform = `translate3d(${ringX}px, ${ringY}px, 0) translate(-50%, -50%) scale(${scale})`;
      if (magnetic) {
        const rect = magnetic.getBoundingClientRect();
        const dx = x - (rect.left + rect.width / 2);
        const dy = y - (rect.top + rect.height / 2);
        magnetic.style.transform = `translate(${dx * 0.18}px, ${dy * 0.18}px)`;
      }
      rafId = window.requestAnimationFrame(loop);
    };
    rafId = window.requestAnimationFrame(loop);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.documentElement.classList.remove("cursor-on");
      if (magnetic) magnetic.style.transform = "";
    };
  }, []);

  return (
    <>
      <div ref={dotRef} className="cursor-dot" aria-hidden="true" />
      <div ref={ringRef} className="cursor-ring" aria-hidden="true" />
    </>
  );
}
