import { useEffect } from "react";
import { SiteNav } from "./components/SiteNav";
import { Works } from "./components/Works";
import { AiLab } from "./components/AiLab";
import { Prompts } from "./components/Prompts";
import { StackStrip } from "./components/StackStrip";
import { Footer } from "./components/Footer";
import { Marquee } from "./components/Marquee";
import { CursorFX } from "./components/CursorFX";
import { GlRoot } from "./gl/GlRoot";
import { useReveal } from "./useReveal";
import { useLenis, scrollState } from "./useLenis";

function SplitTitle({ text, outline }: { text: string; outline?: boolean }) {
  return (
    <span className={outline ? "split outline" : "split"} aria-hidden="true">
      {[...text].map((ch, i) => (
        <i key={i} style={{ "--ch-i": i } as React.CSSProperties}>
          {ch === " " ? "\u00a0" : ch}
        </i>
      ))}
    </span>
  );
}

function ScrollProgress() {
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(".scroll-progress");
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    const tick = (): void => {
      const y = scrollState.y || window.scrollY || 0;
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      el.style.width = `${Math.min(100, (y / max) * 100)}%`;
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  return <div className="scroll-progress" aria-hidden="true" />;
}

export default function PortfolioApp() {
  useReveal();
  useLenis();

  return (
    <div id="top" className="portfolio">
      <GlRoot />
      <CursorFX />
      <ScrollProgress />
      <SiteNav />
      <main>
        <section className="hero" aria-label="AlicE sYsTeM">
          <div className="hero-poster" aria-hidden="true" />
          <div className="hero-content">
            <div className="hero-main">
              <p className="hero-kicker">AI CREATIVE PORTFOLIO</p>
              <h1 className="hero-title">
                <span className="visually-hidden">AlicE sYsTeM</span>
                <SplitTitle text="AlicE" />
                <br />
                <SplitTitle text="sYsTeM" outline />
              </h1>
              <p className="hero-tagline">AIと創る、遊べる実験室。</p>
            </div>
            <aside className="hero-side" data-reveal>
              <span className="hero-side-label">SCROLL TO EXPLORE</span>
              <p>
                Webゲーム、シンセ、モデル比較ラボ、プロンプト集。
                AIと共作した作品をブラウザでそのまま体験できます。
              </p>
              <div className="hero-meta-row">
                <span className="hero-chip">GAMES</span>
                <span className="hero-chip">APPS</span>
                <span className="hero-chip">PROMPTS</span>
                <span className="hero-chip">MODEL LAB</span>
                <span className="hero-chip">v{__APP_VERSION__}</span>
              </div>
            </aside>
          </div>
          <div className="scroll-cue" aria-hidden="true">
            <span>SCROLL</span>
            <i />
          </div>
        </section>
        <Marquee text="PLAY THE LAB — AI CREATIVE WORKS" />
        <Works />
        <AiLab />
        <Prompts />
        <Marquee text="GAMES — APPS — PROMPTS — MODEL LAB" />
        <StackStrip />
      </main>
      <Footer />
      <div className="grain" aria-hidden="true" />
    </div>
  );
}
