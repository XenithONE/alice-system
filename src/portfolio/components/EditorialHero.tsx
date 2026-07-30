import { CATALOG } from "../bento";
import { AI_TOOLS, STUDIO_TALLY } from "../../data/works";
import { HeroCanvas } from "./HeroCanvas";

/*
 * Masthead with a lazy WebGL signal behind the type.
 *
 * Content numbers still come from CATALOG / STUDIO_TALLY so the page never
 * contradicts itself. The 3D layer is optional: no WebGL, reduced motion, and
 * narrow viewports fall back to a cover collage without layout shift.
 */

const CONTENTS = [
  { folio: "01", label: "FEATURED", href: "#featured" },
  { folio: "02", label: "WORKS", href: "#games" },
  { folio: "03", label: "AI LAB", href: "#ai-lab" },
  { folio: "04", label: "PROMPT ARCHIVE", href: "#prompts" },
  { folio: "05", label: "STACK", href: "#stack" },
  { folio: "06", label: "NEXT TITLE", href: "#closing" },
] as const;

export function EditorialHero() {
  const { inDev } = STUDIO_TALLY;
  const total = CATALOG.length;
  const playable = CATALOG.filter((w) => w.status === "playable").length;

  return (
    <section className="hero" id="hero">
      <HeroCanvas />

      <div className="hero-lockup">
        <p className="section-index hero-folio">00 / MASTHEAD</p>

        <h1 className="hero-title">
          <span className="hero-line">{total} works.</span>
          <span className="hero-line">
            <em>{playable}</em> playable
          </span>
          <span className="hero-line">right now.</span>
        </h1>

        <p className="hero-lede">
          ブラウザで今すぐ遊べる{playable}作品と、Unity で制作中の{inDev}タイトル。
          <br />
          すべて AI と共に組み上げています。
        </p>

        <p className="hero-actions">
          <a className="cta lg live" href="#games">
            作品を見る
          </a>
          <a
            className="cta lg ghost"
            href="https://github.com/XenithONE/alice-system"
            target="_blank"
            rel="noreferrer"
          >
            制作を見る
          </a>
        </p>
      </div>

      <nav className="hero-contents" aria-label="目次">
        <p className="hero-contents-label">IN THIS ISSUE</p>
        <ul>
          {CONTENTS.map((entry) => (
            <li key={entry.folio}>
              <a href={entry.href}>
                <span className="hero-contents-folio">{entry.folio}</span>
                <span className="hero-contents-name">{entry.label}</span>
              </a>
            </li>
          ))}
        </ul>
        <dl className="hero-tally">
          <div className="tk live">
            <dt>PLAYABLE</dt>
            <dd>{playable}</dd>
          </div>
          <div className="tk dev">
            <dt>IN DEV</dt>
            <dd>{inDev}</dd>
          </div>
          <div className="tk tools">
            <dt>AI TOOLS</dt>
            <dd>{AI_TOOLS.length}</dd>
          </div>
        </dl>
      </nav>
    </section>
  );
}
