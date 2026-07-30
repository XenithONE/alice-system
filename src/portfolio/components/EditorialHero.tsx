import { AI_TOOLS, STUDIO_TALLY, WORKS } from "../../data/works";

/*
 * The masthead carries no image.
 *
 * The page it replaces preloaded a 384 KB poster at fetchpriority="high" and
 * then pulled in three.js to animate a walkable harbour behind it — 656 KB
 * before a visitor could read what this studio makes. Moving the LCP element
 * from a picture to a line of type is the shortest possible answer to "it got
 * heavy", and it happens to be what an editorial front page wants anyway.
 *
 * Every number here is derived, so appending one Work to works.ts updates the
 * headline. Nothing to keep in sync by hand.
 */
export function EditorialHero() {
  const { live, inDev } = STUDIO_TALLY;
  return (
    <section className="hero" id="hero">
      {/* 00, so the folio series starts where the document does. */}
      <p className="hero-eyebrow">00 / MASTHEAD — AlicE sYsTeM / INDIE GAME STUDIO / 2026</p>

      <h1 className="hero-title">
        <span className="hero-line">{WORKS.length} works.</span>
        <span className="hero-line">
          <em>{live}</em> playable
        </span>
        <span className="hero-line">right now.</span>
      </h1>

      <p className="hero-lede">
        ブラウザで今すぐ遊べる{live}作品と、Unity で制作中の{inDev}タイトル。
        <br />
        すべて AI と共に組み上げています。
      </p>

      <p className="hero-tally">
        <span className="tk live">
          <i aria-hidden="true" />
          {live} LIVE
        </span>
        <span className="tk dev">
          <i aria-hidden="true" />
          {inDev} IN DEV
        </span>
        <span className="tk tools">
          <i aria-hidden="true" />
          {AI_TOOLS.length} AI TOOLS
        </span>
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
    </section>
  );
}
