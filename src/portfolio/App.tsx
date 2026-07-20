import { useEffect } from "react";
import { SiteNav } from "./components/SiteNav";
import { Works } from "./components/Works";
import { AiLab } from "./components/AiLab";
import { Prompts } from "./components/Prompts";
import { StackStrip } from "./components/StackStrip";
import { Footer } from "./components/Footer";
import { CursorFX } from "./components/CursorFX";
import { ExperienceControls, useExperienceSettings } from "./components/ExperienceControls";
import { GlRoot } from "./gl/GlRoot";
import { useReveal } from "./useReveal";

const BASE = import.meta.env.BASE_URL;

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

  const experience = useExperienceSettings();
  const posterUrl = `${BASE}assets/creation-core-poster.webp`;

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
    <div id="top" className="portfolio">
      <a className="skip-link" href="#main-content">
        本文へ移動
      </a>
      <GlRoot />
      <CursorFX />
      <ScrollProgress />
      <SiteNav />
      <ExperienceControls
        threeDEnabled={experience.threeDEnabled}
        quality={experience.quality}
        onThreeDChange={experience.setThreeDEnabled}
        onQualityChange={experience.setQuality}
      />

      <main id="main-content">
        <section className="hero" data-chapter aria-labelledby="hero-title">
          <div
            className="hero-poster"
            style={{ backgroundImage: `url("${posterUrl}")` }}
            aria-hidden="true"
            data-fallback-poster
          />
          <span className="hero-ghost" aria-hidden="true">
            金継
          </span>

          <div className="hero-shell">
            <p className="hero-kicker" aria-hidden="true">
              KINTSUGI ARCHIVE — EXPERIMENTS WITH AI
            </p>
            <h1 id="hero-title" className="hero-title">
              AlicE sYsTeM
            </h1>
            <p className="hero-wall">
              壊れたものを、金で継ぐ。
              <span>ゲーム、映像、プロンプト — AIと共に壊し、直し、遊べる形にした実験の保管庫。</span>
            </p>
            <div className="hero-actions" role="group" aria-label="サイトを探索">
              <a className="hero-cta" href="#works" data-magnetic>
                作品保管庫へ<i aria-hidden="true">↓</i>
              </a>
              <button
                className="hero-skip-3d"
                type="button"
                aria-pressed={!experience.threeDEnabled}
                onClick={() => experience.setThreeDEnabled(!experience.threeDEnabled)}
              >
                {experience.threeDEnabled ? "3Dをスキップ" : "3Dを再開"}
              </button>
            </div>
          </div>

          <p className="hero-accession" aria-hidden="true">
            <span>No.00 / HERO</span>
            <span>SCROLL TO UNSEAL</span>
            <i />
          </p>
        </section>

        <Works />
        <AiLab />
        <Prompts />
        <StackStrip />
      </main>

      <Footer />
      <div className="grain" aria-hidden="true" />
    </div>
  );
}
