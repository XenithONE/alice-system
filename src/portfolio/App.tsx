import { useEffect, useState } from "react";
import { SiteNav } from "./components/SiteNav";
import { EditorialHero } from "./components/EditorialHero";
import { FeaturedStrip } from "./components/FeaturedStrip";
import { WorksBento } from "./components/WorksBento";
import { GameDetail } from "./components/GameDetail";
import { AiLab } from "./components/AiLab";
import { Prompts } from "./components/Prompts";
import { StackStrip } from "./components/StackStrip";
import { Footer } from "./components/Footer";
import { CursorFX } from "./components/CursorFX";
import { FluidRoot } from "./components/FluidRoot";
import { useReveal } from "./useReveal";
import { watchOsPreference } from "./motion";
import type { Work } from "../data/works";

export default function PortfolioApp() {
  useReveal();
  const [detail, setDetail] = useState<Work | null>(null);

  // Follow the OS motion preference live — but only while the reader has not
  // chosen explicitly. The boot script resolved the initial state pre-paint.
  useEffect(() => watchOsPreference(), []);

  // .fonts-in gates the masthead's per-letter entrance: Barlow arriving
  // mid-stagger would make the glyphs jump widths while they rise. 300ms is
  // the floor — past that the entrance runs on whatever face is present.
  useEffect(() => {
    const apply = (): void => document.documentElement.classList.add("fonts-in");
    const timer = window.setTimeout(apply, 300);
    document.fonts?.ready.then(apply).catch(apply);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const targetId = window.location.hash.slice(1);
    if (!targetId) return;

    /*
     * The walkable harbour lives on its own page now and is deliberately not
     * linked from anywhere — noindex, absent from the sitemap. #harbor is the
     * way in for someone who knows it is there.
     */
    if (targetId === "harbor") {
      window.location.replace(`${import.meta.env.BASE_URL}harbor.html`);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(targetId);
      if (!target) return;
      const root = document.documentElement;
      const previousBehavior = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      target.scrollIntoView({ block: "start" });
      root.style.scrollBehavior = previousBehavior;
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="portfolio">
      <a className="skip-link" href="#main-content">
        本文へ移動
      </a>
      <FluidRoot />
      <CursorFX />
      {/*
       * Driven entirely by CSS: animation-timeline: scroll(root block). What
       * used to be here was a useEffect, a rAF coalescer, two listeners and a
       * scrollHeight read that forced layout on every scroll frame — for a
       * 2px decoration. Where the timeline is unsupported the bar stays at
       * width 0 and is simply absent, which is also what reduced-motion gets,
       * so there is one behaviour to reason about rather than two.
       */}
      <div className="scroll-progress" aria-hidden="true" />
      <SiteNav />
      <main id="main-content">
        <EditorialHero />
        <FeaturedStrip />
        <WorksBento onOpenDetail={setDetail} />
        <AiLab />
        <Prompts />
        <StackStrip />
      </main>

      <Footer />
      <GameDetail work={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
