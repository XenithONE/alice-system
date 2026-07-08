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
import { useLenis } from "./useLenis";

function SplitTitle({ text, outline }: { text: string; outline?: boolean }) {
  return (
    <span className={outline ? "split outline" : "split"} aria-hidden="true">
      {[...text].map((ch, i) => (
        <i key={i} style={{ "--ch-i": i } as React.CSSProperties}>
          {ch === " " ? " " : ch}
        </i>
      ))}
    </span>
  );
}

export default function PortfolioApp() {
  useReveal();
  useLenis();

  return (
    <div id="top" className="portfolio">
      <GlRoot />
      <CursorFX />
      <SiteNav />
      <main>
        <section className="hero" aria-label="AlicE sYsTeM">
          <div className="hero-poster" aria-hidden="true" />
          <div className="hero-content">
            <p className="hero-kicker">AI CREATIVE PORTFOLIO</p>
            <h1 className="hero-title">
              <span className="visually-hidden">AlicE sYsTeM</span>
              <SplitTitle text="AlicE" />
              <SplitTitle text=" sYsTeM" outline />
            </h1>
            <p className="hero-tagline">AIと創る、遊べる実験室。</p>
            <p className="hero-meta">
              GAMES / APPS / PROMPTS / MODEL LAB — v{__APP_VERSION__} — 2026
            </p>
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
