import { useEffect, useState } from "react";
import { SiteNav } from "./components/SiteNav";
import { BrickHero } from "./components/BrickHero";
import { GamesSection } from "./components/GamesSection";
import { GameDetail } from "./components/GameDetail";
import { AiLab } from "./components/AiLab";
import { Prompts } from "./components/Prompts";
import { StackStrip } from "./components/StackStrip";
import { Footer } from "./components/Footer";
import { CursorFX } from "./components/CursorFX";
import { useReveal } from "./useReveal";
import type { Work } from "../data/works";

function ScrollProgress() {
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(".scroll-progress");
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    const update = (): void => {
      raf = 0;
      const y = window.scrollY || 0;
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      el.style.width = `${Math.min(100, (y / max) * 100)}%`;
    };
    const schedule = (): void => {
      if (!raf) raf = window.requestAnimationFrame(update);
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    schedule();
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return <div className="scroll-progress" aria-hidden="true" />;
}

export default function PortfolioApp() {
  useReveal();
  const [detail, setDetail] = useState<Work | null>(null);

  useEffect(() => {
    const targetId = window.location.hash.slice(1);
    if (!targetId) return;

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
      <ScrollProgress />
      <SiteNav />

      <main id="main-content">
        <BrickHero onOpenDetail={setDetail} />
        <GamesSection onOpenDetail={setDetail} />
        <AiLab />
        <Prompts />
        <StackStrip />
      </main>

      <Footer />
      <GameDetail work={detail} onClose={() => setDetail(null)} />
      <div className="grain" aria-hidden="true" />
    </div>
  );
}
