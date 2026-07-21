import { HeroRoot } from "../HeroRoot";
import { STUDIO_TALLY } from "../../data/works";

const BASE = import.meta.env.BASE_URL;

// The site's marquee: a toy-brick "AlicE sYsTeM" monument (three.js) beside the
// studio lockup. Decorative — the catalog below is the site. Without WebGL /
// reduced motion the DOM lockup still leads and the frozen brick pose shows.
export function BrickHero() {
  return (
    <section id="top" className="brick-hero" aria-labelledby="hero-title">
      <div className="bh-stage">
        <HeroRoot poster={`${BASE}assets/brick-hero-poster.webp`} />
      </div>

      <div className="bh-lockup">
        <p className="bh-kicker">AIと作る、遊べるゲームスタジオ</p>
        <h1 id="hero-title" className="bh-title">
          AlicE <span>sYsTeM</span>
        </h1>
        <p className="bh-tag">
          ブロックを組むように、AIと一緒に作品を組み上げる。
          <br />
          ブラウザで今すぐ遊べるゲームから、Unityで制作中の新作まで。
        </p>
        <p className="bh-tally" aria-label={`${STUDIO_TALLY.live}タイトルが今すぐ遊べます、${STUDIO_TALLY.inDev}タイトルが制作中`}>
          <span className="tk live">
            <i aria-hidden="true" />
            {STUDIO_TALLY.live} 遊べる
          </span>
          <span className="tk dev">
            <i aria-hidden="true" />
            {STUDIO_TALLY.inDev} 制作中
          </span>
        </p>
        <div className="bh-actions">
          <a className="bh-cta primary" href="#games" data-magnetic>
            作品を見る <i aria-hidden="true">↓</i>
          </a>
          <a className="bh-cta ghost" href="#ai-lab" data-magnetic>
            AI Lab
          </a>
        </div>
      </div>
    </section>
  );
}
