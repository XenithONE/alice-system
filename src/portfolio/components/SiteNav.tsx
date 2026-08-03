import { useState } from "react";
import { CATALOG } from "../bento";
import { STUDIO_TALLY } from "../../data/works";
import { applyMotion, useMotion } from "../motion";

/*
 * The ticker counts the catalogue, not WORKS.
 *
 * STUDIO_TALLY is derived from works.ts alone, so the bar said "12 LIVE"
 * while the masthead two lines below said 14 playable and the works section
 * said 全16作品 — the arena games are works on this page and were missing
 * from every number the nav showed.
 */
const LIVE = CATALOG.filter((w) => w.status === "playable").length;

const THEME_KEY = "alice_theme";
const THEME_COLOR: Record<"dark" | "light", string> = {
  dark: "#061c31",
  light: "#f6efe2",
};

/*
 * The reader picks the stock. The <head> pre-paint script has already applied
 * a stored choice before first paint, so initial state is read off the
 * document rather than re-deciding it here — one writer at boot, one at the
 * button, never two.
 */
function applyTheme(light: boolean): void {
  const root = document.documentElement;
  if (light) root.dataset.theme = "light";
  else delete root.dataset.theme;
  try {
    window.localStorage.setItem(THEME_KEY, light ? "light" : "dark");
  } catch {
    /* private mode — the toggle still works for the session */
  }
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", light ? THEME_COLOR.light : THEME_COLOR.dark);
}

/*
 * The reader decides whether the page moves. html.motion-on is the single
 * source of truth (see motion.ts); this button is its only runtime writer.
 * aria-pressed carries the effective state — ON means moving even where the
 * OS asks for reduced motion, which is the whole point of the control on the
 * owner's own machine.
 */
function MotionToggle() {
  const on = useMotion();
  const toggle = (): void => applyMotion(on ? "off" : "on");
  return (
    <button
      type="button"
      className="nav-toggle"
      aria-pressed={on}
      aria-label="モーション"
      title="動きを切り替え"
      onClick={toggle}
      data-magnetic
    >
      {on ? (
        /* waves — the page is moving */
        <svg viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <path d="M1 4.2c2.2-2.2 4.3 2.2 6.5 0s4.3 2.2 6.5 0" />
          <path d="M1 7.7c2.2-2.2 4.3 2.2 6.5 0s4.3 2.2 6.5 0" />
          <path d="M1 11.2c2.2-2.2 4.3 2.2 6.5 0s4.3 2.2 6.5 0" />
        </svg>
      ) : (
        /* a flat line — the page is still */
        <svg viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <path d="M1 7.5h13" />
        </svg>
      )}
    </button>
  );
}

function ThemeToggle() {
  const [light, setLight] = useState(
    () => document.documentElement.dataset.theme === "light"
  );
  const toggle = (): void => {
    const next = !light;
    applyTheme(next);
    setLight(next);
  };
  return (
    <button
      type="button"
      className="nav-toggle"
      aria-pressed={light}
      aria-label="ライト配色"
      title="配色を切り替え"
      onClick={toggle}
      data-magnetic
    >
      {light ? (
        /* sun */
        <svg viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <circle cx="7.5" cy="7.5" r="3" />
          <path d="M7.5 0.6v2M7.5 12.4v2M0.6 7.5h2M12.4 7.5h2M2.6 2.6l1.4 1.4M11 11l1.4 1.4M12.4 2.6L11 4M4 11l-1.4 1.4" />
        </svg>
      ) : (
        /* moon */
        <svg viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <path d="M12.9 9.6A5.9 5.9 0 0 1 5.4 2.1a5.9 5.9 0 1 0 7.5 7.5Z" />
        </svg>
      )}
    </button>
  );
}

export function SiteNav() {
  return (
    <header className="site-nav">
      <div className="site-nav-shell">
        <a className="site-brand" href="#hero" data-magnetic aria-label="AlicE sYsTeM ホーム">
          AlicE sYsTeM
          <span className="site-brand-tag">INDIE GAME STUDIO</span>
        </a>

        <p className="studio-ticker" aria-label={`${LIVE}タイトルが今すぐ遊べます、${STUDIO_TALLY.inDev}タイトルが開発中`}>
          <span className="tk live">
            <i className="dot" aria-hidden="true" />
            {LIVE} LIVE
          </span>
          <span className="tk dev">
            <i className="dot" aria-hidden="true" />
            {STUDIO_TALLY.inDev} IN DEV
          </span>
        </p>

        <nav className="site-primary-nav" aria-label="主要セクション">
          <a href="#featured" data-magnetic>FEATURED</a>
          <a href="#games" data-magnetic>WORKS</a>
          <a href="#ai-lab" data-magnetic>LAB</a>
          <a href="#prompts" data-magnetic>PROMPTS</a>
          <a href="#stack" data-magnetic>STACK</a>
        </nav>

        {/* MOTION before THEME — the control with the larger effect sits first. */}
        <div className="nav-toggles">
          <MotionToggle />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
