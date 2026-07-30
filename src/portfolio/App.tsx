import { useEffect, useState } from "react";
import { SiteNav } from "./components/SiteNav";
import { EditorialHero } from "./components/EditorialHero";
import { WorksBento } from "./components/WorksBento";
import { GameDetail } from "./components/GameDetail";
import { AiLab } from "./components/AiLab";
import { Prompts } from "./components/Prompts";
import { StackStrip } from "./components/StackStrip";
import { Footer } from "./components/Footer";
import { CursorFX } from "./components/CursorFX";
import { useReveal } from "./useReveal";
import type { Work } from "../data/works";

export default function PortfolioApp() {
  useReveal();
  const [detail, setDetail] = useState<Work | null>(null);

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
