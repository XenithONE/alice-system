import { SiteNav } from "./components/SiteNav";
import { Works } from "./components/Works";
import { AiLab } from "./components/AiLab";
import { Prompts } from "./components/Prompts";
import { StackStrip } from "./components/StackStrip";
import { Footer } from "./components/Footer";
import { useReveal } from "./useReveal";
import { useLenis } from "./useLenis";
import { HeroCanvas } from "./hero/HeroCanvas";

export default function PortfolioApp() {
  useReveal();
  useLenis();

  return (
    <div id="top" className="portfolio">
      <SiteNav />
      <main>
        <section className="hero" aria-label="AlicE sYsTeM">
          <div className="hero-poster" aria-hidden="true" />
          <HeroCanvas />
          <div className="hero-content">
            <p className="hero-kicker">AI CREATIVE PORTFOLIO</p>
            <h1 className="hero-title">
              AlicE <b>sYsTeM</b>
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
