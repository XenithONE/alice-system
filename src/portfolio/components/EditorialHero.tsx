import { CATALOG } from "../bento";
import { AI_TOOLS, STUDIO_TALLY } from "../../data/works";

/*
 * The masthead carries no image.
 *
 * The page it replaces preloaded a 384 KB poster at fetchpriority="high" and
 * then pulled in three.js to animate a walkable harbour behind it — 656 KB
 * before a visitor could read what this studio makes. Moving the LCP element
 * from a picture to a line of type is the shortest possible answer to "it got
 * heavy", and it happens to be what an editorial front page wants anyway.
 *
 * It is a two-column masthead because the one-column version left the right
 * 55% of the fold empty — measured on the shipped page at 1440. A magazine
 * puts the contents there, so this does: the folio series the sections
 * already carry, with the count each one holds. That also closes a real gap,
 * because the nav omits STACK and NEXT TITLE and they were unreachable
 * without scrolling the whole document.
 *
 * Every number is derived. The headline used to say WORKS.length (14) while
 * the works section said CATALOG.length (16) two screens below it — the same
 * page contradicting itself, because the arena games are works on this page
 * and were not in that array.
 */
const CONTENTS = [
  { folio: "01", label: "WORKS", href: "#games" },
  { folio: "02", label: "AI LAB", href: "#ai-lab" },
  { folio: "03", label: "PROMPT ARCHIVE", href: "#prompts" },
  { folio: "04", label: "STACK", href: "#stack" },
  { folio: "05", label: "NEXT TITLE", href: "#closing" },
] as const;

export function EditorialHero() {
  const { inDev } = STUDIO_TALLY;
  const total = CATALOG.length;
  const playable = CATALOG.filter((w) => w.status === "playable").length;

  return (
    <section className="hero" id="hero">
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

      {/* The contents column. Mono, hung on a rule, numbered like the folios
          it points at — so the numbering that runs down the document is
          introduced before you meet it. */}
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
