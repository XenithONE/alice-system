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
        <section className="hero" aria-labelledby="hero-title" data-creation-hero>
          <div
            className="hero-poster"
            style={{ backgroundImage: `url("${posterUrl}")` }}
            aria-hidden="true"
            data-fallback-poster
          />

          <div className="hero-shell">
            <div className="hero-copy" data-reveal>
              <h1 id="hero-title" className="hero-title">
                AIと創る、
                <br />
                遊べる実験室。
              </h1>
              <p className="hero-intro">
                ゲーム、映像、プロンプト、モデル比較。
                <br />
                AIとの制作実験を、触れる作品として公開しています。
              </p>
              <div className="hero-actions" role="group" aria-label="サイトを探索">
                <a className="hero-cta" href="#works" data-magnetic>
                  作品を探索
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

            <div className="hero-scroll-cue" aria-hidden="true">
              <span>SCROLL</span>
              <i />
            </div>
          </div>

          <a className="hero-next-section" href="#works" aria-label="次のセクション、作品へ">
            <span className="hero-next-index">01</span>
            <strong className="hero-next-title">WORKS</strong>
            <span className="hero-next-copy">AIで制作した、インタラクティブ作品のコレクション。</span>
            <span className="hero-next-action">VIEW 01</span>
          </a>
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
