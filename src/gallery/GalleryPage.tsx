import { useCallback, useEffect, useState, type CSSProperties, type FocusEvent } from "react";
import { EXHIBITS, cardArt } from "./exhibits";
import { accession, primaryCta, StatusBadge } from "../portfolio/components/badges";
import { applyMotion, useMotion } from "../portfolio/motion";
import { GpuRoot, type GpuFactory, type GpuState } from "../gpu/GpuRoot";
import { ACTIVE_EVENT, HOVER_EVENT, watchIndex } from "./channel";

const BASE = import.meta.env.BASE_URL;

/*
 * LONG GALLERY — the catalogue IS the page.
 *
 * The list below is not a fallback. It is the document: seventeen rows, each
 * a real link to a real work, readable and operable with no canvas at all.
 * When the corridor is live the same seventeen rows become the thing that
 * drives it — each <li> is a fixed slab of scroll height, so the browser's own
 * scrollbar, PageDown, Home/End, find-in-page and scroll restoration all move
 * the camera for free. Nothing here calls preventDefault, and no smooth-scroll
 * library is installed, which is why that sentence can be true.
 *
 * The rows go transparent rather than away when the corridor takes over
 * (gallery.css, html.cg-live): an element that is still in the tree is still
 * focusable and still spoken, so a keyboard reader walks the same catalogue a
 * mouse reader flies through. Focus brings the row back, full size, in the
 * middle of the screen — see .cg-card:focus-visible.
 *
 * The canvas never enters the tab order and holds nothing focusable, so
 * "focus jumped to something behind the wall" cannot happen here by
 * construction rather than by care.
 */

export type GalleryStatus =
  | { kind: "catalogue" } // nothing has tried to boot yet, or nothing needs to
  | { kind: "live" }
  | { kind: "still" } // the reader asked the page not to move
  | { kind: "unsupported"; detail: string }
  | { kind: "failed" };

const TOTAL = EXHIBITS.length;

/*
 * The reader decides whether the page moves, here as on the top page, and
 * html.motion-on stays the single source of truth. On this page the control
 * carries more weight than usual: a corridor the camera walks IS motion, so
 * OFF is what turns the 3D off, and the note under the masthead says so
 * instead of leaving a reader to wonder why the wall never appeared.
 */
function MotionToggle() {
  const on = useMotion();
  return (
    <button
      type="button"
      className="nav-toggle"
      aria-pressed={on}
      aria-label="モーション"
      title="動きを切り替え"
      onClick={() => applyMotion(on ? "off" : "on")}
    >
      {on ? (
        <svg viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <path d="M1 4.2c2.2-2.2 4.3 2.2 6.5 0s4.3 2.2 6.5 0" />
          <path d="M1 7.7c2.2-2.2 4.3 2.2 6.5 0s4.3 2.2 6.5 0" />
          <path d="M1 11.2c2.2-2.2 4.3 2.2 6.5 0s4.3 2.2 6.5 0" />
        </svg>
      ) : (
        <svg viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <path d="M1 7.5h13" />
        </svg>
      )}
    </button>
  );
}

/**
 * What the corridor looks like, for the readers who cannot enter it.
 *
 * A real frame from the real thing, captured through the same pipeline and the
 * same lamps — not a drawing of it. harbor.html's poster is 393 KB, which is
 * a poster costing more than the page it stands in for; this is 21 KB because
 * it is a webp of a room that is mostly one colour.
 *
 * Shown only when the corridor is definitely not coming: while the boot is
 * still in flight the page is the catalogue and needs no apology for it.
 */
function CorridorPoster() {
  return (
    <figure className="cg-poster">
      <img
        src={`${BASE}assets/gallery/long-gallery-poster.webp`}
        alt="LONG GALLERY の回廊。曲がった白い廊下の壁から、作品のカバーを貼った板が読者の方へ振られて突き出している。"
        width={1600}
        height={900}
        loading="lazy"
        decoding="async"
      />
      <figcaption>WebGPU で描かれる回廊（実際のレンダリング）</figcaption>
    </figure>
  );
}

function StatusNote({ status }: { status: GalleryStatus }) {
  switch (status.kind) {
    case "live":
      return (
        <p className="cg-note is-live">
          回廊を歩いています。スクロールで前へ進み、額を押すとその作品が開きます。
        </p>
      );
    case "still":
      return (
        <p className="cg-note">
          動きをオフにしているため、一覧として表示しています。右上のボタンで回廊に入れます。
        </p>
      );
    case "unsupported":
      return (
        <p className="cg-note">
          この環境では回廊を描けないため、一覧として表示しています（{status.detail}）。
        </p>
      );
    case "failed":
      return (
        <p className="cg-note">
          回廊の起動に失敗したため、一覧として表示しています。再読み込みで直ることがあります。
        </p>
      );
    default:
      return null;
  }
}

/*
 * The corridor's chunk, behind a thunk.
 *
 * Declared at module scope because GpuRoot's effect depends on this function's
 * identity: an arrow function written inline in the JSX is a new value every
 * render, which would tear the world down and build another one every time
 * React re-rendered this component for any reason at all.
 */
const loadCorridor: GpuFactory = (canvas, hooks) =>
  import("./scene/world").then((m) => m.createGalleryWorld(canvas, hooks));
const load = () => Promise.resolve(loadCorridor);

/**
 * The label beside the frame the reader is standing at.
 *
 * A wall label, not a HUD: solid ground, ruled edge, accession number, and one
 * real link. Solid because a translucent panel over a rendered corridor has no
 * ground a contrast check can measure — v14 shipped a whole strip of glass
 * plates whose type was near-illegible on the dark issue and reported zero
 * failures, because the auditor skips any element sitting on a
 * background-image.
 */
function WallLabel({ index, hovered }: { index: number; hovered: number }) {
  /* What the pointer is over wins over where the reader is standing: the
     label should answer "what is this one" while they are reaching for it. */
  const shown = hovered >= 0 ? hovered : index;
  const work = EXHIBITS[shown];
  if (!work) return null;
  const cta = primaryCta(work);
  return (
    <aside className="cg-label" aria-live="polite">
      <p className="cg-label-no">{accession(shown, TOTAL)}</p>
      <p className="cg-label-title">{work.title}</p>
      <p className="cg-label-ja">{work.titleJa}</p>
      <a className="cg-label-cta" href={cta.href ?? BASE + work.href}>
        <span aria-hidden="true">{cta.glyph}</span> {cta.label}
      </a>
    </aside>
  );
}

export function GalleryPage() {
  const motion = useMotion();
  const [gpu, setGpu] = useState<GpuState>({ kind: "idle" });
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState(-1);
  const onState = useCallback((next: GpuState) => setGpu(next), []);

  useEffect(() => watchIndex(ACTIVE_EVENT, setActive), []);
  useEffect(() => watchIndex(HOVER_EVENT, setHovered), []);

  /*
   * Tabbing through the catalogue walks the corridor.
   *
   * Centring the row is all it takes, because the camera is a function of the
   * scroll position and nothing else — there is no camera API to call, no
   * animation to start, and therefore no second way for the two to disagree.
   * It has to be explicit rather than left to the browser: a focused .cg-card
   * is position: fixed while the corridor is live, and the browser does not
   * scroll anything to reveal an element that is already in the viewport.
   */
  const walkTo = useCallback((event: FocusEvent<HTMLAnchorElement>) => {
    event.currentTarget.closest("li")?.scrollIntoView({ block: "center" });
  }, []);

  /*
   * The corridor IS motion — the camera walks whether or not the reader moved
   * the mouse — so the site's one motion switch is what turns it on. A reader
   * whose OS asks for reduced motion gets the catalogue and a control in the
   * masthead that says so, rather than a page that silently decided for them.
   */
  const status: GalleryStatus = !motion
    ? { kind: "still" }
    : gpu.kind === "live"
      ? { kind: "live" }
      : gpu.kind === "unsupported"
        ? { kind: "unsupported", detail: gpu.detail }
        : gpu.kind === "failed"
          ? { kind: "failed" }
          : { kind: "catalogue" };
  const live = status.kind === "live";

  return (
    <div className="cg">
      <a className="skip-link" href="#cg-catalogue">
        作品一覧へ移動
      </a>

      <div className="cg-stage">
        <GpuRoot
          className="cg-canvas"
          liveClass="cg-live"
          load={load}
          enabled={motion}
          onState={onState}
        />
      </div>

      <header className="cg-masthead">
        <a className="cg-back" href={BASE}>
          <span aria-hidden="true">←</span> AlicE sYsTeM
        </a>
        <MotionToggle />
      </header>

      <section className="cg-intro">
        <p className="cg-eyebrow">WEBGPU · 実験作</p>
        <h1 className="cg-title">LONG GALLERY</h1>
        <p className="cg-sub">曲がった回廊</p>
        <p className="cg-lede">
          全{TOTAL}作品を、一本の曲線に沿って掛けた回廊。スクロールがそのまま歩みになります。
        </p>
        <StatusNote status={status} />
        {(status.kind === "still" || status.kind === "unsupported" || status.kind === "failed") && (
          <CorridorPoster />
        )}
      </section>

      {live && <WallLabel index={active} hovered={hovered} />}

      <ol className="cg-list" id="cg-catalogue" aria-label={`作品${TOTAL}点`}>
        {EXHIBITS.map((work, i) => {
          const art = cardArt(work, BASE);
          const cta = primaryCta(work);
          return (
            <li className="cg-item" key={work.id} style={{ "--i": i } as CSSProperties}>
              <a
                className="cg-card"
                onFocus={walkTo}
                href={cta.href ?? BASE + work.href}
                {...(cta.external ? { target: "_blank", rel: "noreferrer" } : {})}
              >
                <figure className="cg-plate">
                  {/*
                   * Not rendered while the corridor is live. The frames on the
                   * wall are the same derived files, loaded by the texture
                   * budget at the width the wall needs — leaving seventeen
                   * invisible <img> in the tree would fetch every cover a
                   * second time at a width nothing draws.
                   */}
                  {!live && (
                    <img
                      src={art.src}
                      srcSet={art.srcSet || undefined}
                      sizes={art.sizes || undefined}
                      alt={work.titleJa ? `${work.title} — ${work.titleJa}` : work.title}
                      width={art.width}
                      height={art.height}
                      loading={i < 2 ? "eager" : "lazy"}
                      decoding="async"
                    />
                  )}
                </figure>
                <div className="cg-body">
                  <p className="cg-accession">{accession(i, TOTAL)}</p>
                  <h2 className="cg-work">{work.title}</h2>
                  <p className="cg-ja">{work.titleJa}</p>
                  <p className="cg-desc">{work.description}</p>
                  <p className="cg-meta">
                    <StatusBadge status={work.status} />
                    <span className="engine-chip">{work.engine.toUpperCase()}</span>
                    <span className="cg-year">{work.year}</span>
                  </p>
                  <span className={`cta ${cta.tone} is-static`}>
                    <span aria-hidden="true">{cta.glyph}</span> {cta.label}
                  </span>
                </div>
              </a>
            </li>
          );
        })}
      </ol>

      <footer className="cg-foot">
        <p className="cg-foot-line">
          LONG GALLERY — エリザベス朝の館にあった、歩きながら絵を見るための細長い部屋。
        </p>
        <a className="cg-back" href={BASE}>
          <span aria-hidden="true">←</span> カタログに戻る
        </a>
      </footer>
    </div>
  );
}
