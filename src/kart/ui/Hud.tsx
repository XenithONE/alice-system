import { useEffect, useRef } from "react";
import { ITEM_LABEL_JA } from "../sim/items";
import type { Track } from "../sim/track";
import type { ItemKind, RaceState } from "../sim/types";
import { liveryOf } from "../render/palette";

const PLACE_SUFFIX = ["", "st", "nd", "rd", "th", "th", "th", "th", "th"];

export function formatTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "--:--.---";
  const whole = Math.max(0, seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole - minutes * 60;
  return `${minutes}:${rest.toFixed(3).padStart(6, "0")}`;
}

/** Item glyphs. Drawn, not typed — an emoji font is not a guarantee. */
export function ItemGlyph({ item }: { item: ItemKind }): React.JSX.Element {
  switch (item) {
    case "mushroom":
    case "triple":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 12a9 9 0 0 1 18 0z" fill="#ff5c5c" />
          <circle cx="9" cy="9" r="1.9" fill="#fff" />
          <circle cx="15.5" cy="8" r="1.4" fill="#fff" />
          <path d="M9.5 12h5v6a2.5 2.5 0 0 1-5 0z" fill="#ffe8cf" />
        </svg>
      );
    case "banana":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M4 7c1 8 7 12 15 12-2-2-3-4-3.5-7C14.5 8 10 5 4 7z"
            fill="#f6d03c"
            stroke="#c8a41f"
            strokeWidth="1.2"
          />
        </svg>
      );
    case "green":
    case "red":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle
            cx="12"
            cy="12"
            r="8.5"
            fill={item === "green" ? "#3ddc63" : "#f0413c"}
          />
          <path d="M3.5 12h17" stroke="#fff" strokeWidth="2.2" />
          <circle cx="12" cy="12" r="3.4" fill="#fff" opacity="0.85" />
        </svg>
      );
    case "bomb":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="14" r="7.5" fill="#24262c" />
          <path d="M15 7c2-2 4-2 5 1" stroke="#ff8a2b" strokeWidth="2" fill="none" />
          <circle cx="9" cy="12" r="2" fill="#4a4f58" />
        </svg>
      );
    case "star":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 2.5 14.9 9l7.1.7-5.3 4.7 1.5 6.9L12 17.8 5.8 21.3l1.5-6.9L2 9.7 9.1 9z"
            fill="#ffe35c"
            stroke="#e0a800"
            strokeWidth="1"
          />
        </svg>
      );
    case "bolt":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M13.5 2 5 13.5h5L9 22l9.5-12.5h-5.2z" fill="#7cd6ff" stroke="#2e9fd8" strokeWidth="1" />
        </svg>
      );
    default:
      return <svg viewBox="0 0 24 24" aria-hidden="true" />;
  }
}

function Minimap({
  track,
  view,
  focusSeat,
}: {
  track: Track;
  view: RaceState;
  focusSeat: number;
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const size = 148;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, size, size);

    const { minX, maxX, minZ, maxZ } = track.bounds;
    const spanX = Math.max(1, maxX - minX);
    const spanZ = Math.max(1, maxZ - minZ);
    const span = Math.max(spanX, spanZ);
    const pad = 12;
    const scale = (size - pad * 2) / span;
    const offsetX = pad + (size - pad * 2 - spanX * scale) / 2;
    const offsetZ = pad + (size - pad * 2 - spanZ * scale) / 2;
    const project = (x: number, z: number): [number, number] => [
      offsetX + (x - minX) * scale,
      offsetZ + (z - minZ) * scale,
    ];

    context.lineJoin = "round";
    context.lineCap = "round";
    context.strokeStyle = "rgba(255,255,255,0.16)";
    context.lineWidth = 9;
    context.beginPath();
    track.samples.forEach((sample, index) => {
      const [px, pz] = project(sample.x, sample.z);
      if (index === 0) context.moveTo(px, pz);
      else context.lineTo(px, pz);
    });
    context.closePath();
    context.stroke();
    context.strokeStyle = "rgba(255,255,255,0.5)";
    context.lineWidth = 2;
    context.stroke();

    const start = track.samples[0]!;
    const [sx, sz] = project(start.x, start.z);
    context.fillStyle = "#ffffff";
    context.fillRect(sx - 3, sz - 3, 6, 6);

    for (const racer of view.racers) {
      const [px, pz] = project(racer.x, racer.z);
      const livery = liveryOf(racer.livery);
      context.beginPath();
      context.arc(px, pz, racer.id === focusSeat ? 5 : 3.4, 0, Math.PI * 2);
      context.fillStyle = `#${livery.signal.toString(16).padStart(6, "0")}`;
      context.fill();
      if (racer.id === focusSeat) {
        context.lineWidth = 2;
        context.strokeStyle = "#0b0d11";
        context.stroke();
      }
    }
  }, [track, view, focusSeat]);

  return <canvas ref={canvasRef} className="nk-minimap" aria-hidden="true" />;
}

export interface HudProps {
  readonly track: Track;
  readonly view: RaceState;
  readonly focusSeat: number;
  readonly quality: string;
}

export function Hud({ track, view, focusSeat, quality }: HudProps): React.JSX.Element | null {
  const me = view.racers.find((racer) => racer.id === focusSeat) ?? view.racers[0];
  if (!me) return null;
  const total = view.racers.length;
  const speed = Math.round(Math.abs(me.speed) * 3.6);
  const countdownNumber =
    view.phase === "countdown" ? Math.ceil(view.countdown) : 0;

  return (
    <div className="nk-hud">
      <div className="nk-hud-topleft">
        <div className="nk-place">
          <span className="nk-place-num">{me.place}</span>
          <span className="nk-place-suffix">
            {PLACE_SUFFIX[me.place] ?? "th"}
          </span>
          <span className="nk-place-of">/ {total}</span>
        </div>
        <div className="nk-lap">
          LAP <b>{Math.min(me.lap, view.laps)}</b>
          <span>/ {view.laps}</span>
        </div>
        <div className="nk-times">
          <div>
            <span>TIME</span>
            <b>{formatTime(view.elapsed)}</b>
          </div>
          <div>
            <span>BEST</span>
            <b>{formatTime(me.bestLap)}</b>
          </div>
        </div>
      </div>

      <div className="nk-hud-topright">
        <Minimap track={track} view={view} focusSeat={focusSeat} />
        <ol className="nk-standings">
          {view.racers
            .slice()
            .sort((a, b) => a.place - b.place)
            .map((racer) => (
              <li
                key={racer.id}
                className={racer.id === focusSeat ? "is-me" : undefined}
              >
                <i
                  style={{
                    background: `#${liveryOf(racer.livery)
                      .signal.toString(16)
                      .padStart(6, "0")}`,
                  }}
                />
                <span className="nk-standings-place">{racer.place}</span>
                <span className="nk-standings-name">{racer.name}</span>
              </li>
            ))}
        </ol>
      </div>

      <div className="nk-hud-bottomleft">
        <div
          className={`nk-item ${me.rouletteTimer > 0 ? "is-rolling" : ""} ${
            me.item ? "is-held" : ""
          }`}
        >
          {me.item ? (
            <>
              <ItemGlyph item={me.item} />
              {me.itemCharges > 1 ? (
                <span className="nk-item-count">×{me.itemCharges}</span>
              ) : null}
              <span className="nk-item-label">{ITEM_LABEL_JA[me.item]}</span>
            </>
          ) : me.rouletteTimer > 0 ? (
            <span className="nk-item-label">…</span>
          ) : (
            <span className="nk-item-label nk-item-empty">ITEM</span>
          )}
        </div>
      </div>

      <div className="nk-hud-bottomright">
        <div className="nk-speed">
          <b>{speed}</b>
          <span>km/h</span>
        </div>
        <div
          className={`nk-charge tier-${Math.min(3, me.driftTier)} ${
            me.driftDir !== 0 ? "is-on" : ""
          }`}
        >
          <i style={{ width: `${Math.min(100, (me.driftCharge / 3.05) * 100)}%` }} />
        </div>
        <div className="nk-quality">{quality}</div>
      </div>

      {countdownNumber > 0 ? (
        <div className="nk-centre nk-countdown" key={countdownNumber}>
          {countdownNumber}
        </div>
      ) : null}
      {view.phase === "race" && view.elapsed < 1.4 ? (
        <div className="nk-centre nk-go">GO!</div>
      ) : null}
      {me.wrongWay ? <div className="nk-centre nk-wrong">逆走</div> : null}
      {me.lap === view.laps && !me.finished && view.phase === "race" ? (
        <div className="nk-final-lap">FINAL LAP</div>
      ) : null}
      {me.finished ? (
        <div className="nk-centre nk-finished">
          FINISH
          <small>{me.place} 位</small>
        </div>
      ) : null}
    </div>
  );
}
