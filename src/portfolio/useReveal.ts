import { useEffect } from "react";

// Single IntersectionObserver: adds .is-in to every [data-reveal] element once it
// enters the viewport. Reduced-motion visibility is handled purely in CSS (elements
// are forced visible there), so this hook can stay dumb and cheap.
export function useReveal(): void {
  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (elements.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15 }
    );
    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, []);
}
