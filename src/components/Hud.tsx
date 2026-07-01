import { useEffect, useRef, useState } from "react";
import type { GameInfo, GameMode, JumpscareKind, LossKind, RunEndResult } from "../lib/horrorEngine";
import type { ProgressState } from "../lib/storage";
import { getQualityChoice, setQualityChoice, type QualityChoice } from "../lib/webgl";

interface HudProps {
  mode: GameMode;
  info: GameInfo | null;
  filesFound: number;
  filesTotal: number;
  fear: number;
  elapsedMs: number;
  hiding: boolean;
  flashlightOn: boolean;
  progress: ProgressState;
  lastRun: RunEndResult | null;
  toastLine: string;
  jumpscareToken: number;
  jumpscareKind: JumpscareKind | null;
  isTouch: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onHide: () => void;
  onFlashlight: () => void;
  onMute: (muted: boolean) => void;
  onBloom: (enabled: boolean) => void;
  onShake: (enabled: boolean) => void;
  onLookSens: (v: number) => void;
}

function fmtTime(ms: number): string {
  if (ms <= 0 || !Number.isFinite(ms)) return "--:--.-";
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m).padStart(2, "0")}:${r < 10 ? "0" : ""}${r.toFixed(1)}`;
}

function lossText(kind: LossKind | undefined): { title: string; tagline: string; body: string } {
  if (kind === "fear") {
    return {
      title: "Consumed",
      tagline: "THE FEAR WON",
      body: "恐怖が限界を超えた。闇の中で、あなたの光は内側から消えた。"
    };
  }
  return {
    title: "Taken",
    tagline: "THE WARDEN FOUND YOU",
    body: "見ていない間に、距離を詰められた。振り返るのが遅かった。"
  };
}

export function Hud({
  mode, info, filesFound, filesTotal, fear, elapsedMs, hiding, flashlightOn, progress, lastRun, toastLine,
  jumpscareToken, jumpscareKind, isTouch,
  onStart, onPause, onResume, onHide, onFlashlight, onMute, onBloom, onShake, onLookSens
}: HudProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [bloom, setBloom] = useState(true);
  const [shake, setShake] = useState(true);
  const [lookSens, setLookSensState] = useState(0.0022);
  const [flashActive, setFlashActive] = useState(false);
  const flashTimer = useRef<number | null>(null);

  const gfxChoice = getQualityChoice();
  const GFX_CYCLE: QualityChoice[] = ["auto", "high", "balanced", "low"];
  const cycleGraphics = (): void => {
    const next = GFX_CYCLE[(GFX_CYCLE.indexOf(gfxChoice) + 1) % GFX_CYCLE.length];
    setQualityChoice(next);
    window.location.reload();
  };

  useEffect(() => {
    if (jumpscareToken === 0) return;
    setFlashActive(true);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashActive(false), 220);
    return () => {
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
    };
  }, [jumpscareToken]);

  const toggleMute = (): void => {
    const next = !muted;
    setMuted(next);
    onMute(next);
  };
  const toggleBloom = (): void => {
    const next = !bloom;
    setBloom(next);
    onBloom(next);
  };
  const toggleShake = (): void => {
    const next = !shake;
    setShake(next);
    onShake(next);
  };
  const changeSens = (v: number): void => {
    setLookSensState(v);
    onLookSens(v);
  };

  const loss = mode === "lost" ? lossText(lastRun?.lossKind) : null;

  return (
    <>
      <div className={`jump-flash ${flashActive ? "show" : ""}`} data-kind={jumpscareKind ?? ""} aria-hidden="true" />
      <div className="grain" aria-hidden="true" />
      <div className="veil" aria-hidden="true" />

      <header className="topbar">
        <div className="brand">
          THE <b>HOLLOW</b> WARD
        </div>
        <div className="status-strip" aria-label="system status">
          <button
            type="button"
            className="gfx-chip"
            onClick={cycleGraphics}
            title="Graphics quality — click to cycle AUTO / HIGH / BALANCED / LOW (reloads to apply)."
          >
            GFX {gfxChoice === "auto" ? `AUTO·${info?.quality ?? "..."}` : `${info?.quality ?? gfxChoice.toUpperCase()}*`}
          </button>
          <span>WEBGL {info ? (info.webgl2 ? "2" : "1") : "..."}</span>
          <span>SPARK {info?.spark ? "ON" : "OFF"}</span>
          <span>v{__APP_VERSION__}</span>
        </div>
        <div className="top-actions">
          <button type="button" className="icon-button" onClick={() => setSettingsOpen((v) => !v)} title="Settings">
            SETTINGS
          </button>
          <button type="button" className="icon-button" onClick={toggleMute} title="Mute">
            {muted ? "SOUND OFF" : "SOUND ON"}
          </button>
        </div>
      </header>

      {settingsOpen && (
        <div id="settingsPanel" className="show">
          <div className="hd">SETTINGS</div>
          <div className="row">
            <label>Bloom / glow</label>
            <input type="checkbox" checked={bloom} onChange={toggleBloom} />
          </div>
          <div className="row">
            <label>Screen shake</label>
            <input type="checkbox" checked={shake} onChange={toggleShake} />
          </div>
          <div className="row">
            <label>Look sens</label>
            <input type="range" min={0.001} max={0.004} step={0.0002} value={lookSens} onChange={(e) => changeSens(parseFloat(e.target.value))} />
          </div>
        </div>
      )}

      {(mode === "playing" || mode === "paused") && (
        <>
          <div className="objective">
            <div>{filesFound >= filesTotal ? "出口を探せ — 赤いサインの先" : `CASE FILES を ${filesTotal} 個集めろ`}</div>
            <div className="sub">{hiding ? "隠れている — Eで出る" : "光を頼りに進め。見られていないと、近づいてくる。"}</div>
          </div>

          <div className="hud">
            <div className="panel readout">
              <span>TIME <b>{fmtTime(elapsedMs)}</b></span>
              <span>BEST <b>{fmtTime(progress.bestMs)}</b></span>
              <span>FILES <b>{filesFound}/{filesTotal}</b></span>
              <span>FLASHLIGHT <b>{flashlightOn ? "ON" : "OFF"}</b></span>
              <span>FEAR<span className="meter"><i style={{ width: `${Math.min(100, fear)}%` }} /></span></span>
            </div>
            <div className="panel keys desktop-hud">
              MOVE: WASD<br />LOOK: MOUSE<br />HIDE: E &nbsp; LIGHT: F<br />PAUSE: ESC
            </div>
          </div>

          {isTouch && (
            <div className="touch-actions">
              <button type="button" className="touch-btn" onClick={onHide}>{hiding ? "OUT" : "HIDE"}</button>
              <button type="button" className="touch-btn" onClick={onFlashlight}>LIGHT</button>
            </div>
          )}

          {!isTouch && mode === "playing" && (
            <button type="button" className="pause-btn" onClick={onPause}>PAUSE</button>
          )}
        </>
      )}

      {mode === "paused" && (
        <div className="overlay">
          <div className="card">
            <h1>Paused</h1>
            <div className="tagline">THE WARD WAITS</div>
            <div className="actions">
              <button className="btn primary" type="button" onClick={onResume}>RESUME</button>
            </div>
          </div>
        </div>
      )}

      {mode === "menu" && (
        <div className="overlay">
          <div className="card">
            <h1>The Hollow Ward</h1>
            <div className="tagline">DON'T LOOK AWAY</div>
            <p>
              廃病棟に6つのCASE FILEが眠っている。懐中電灯を頼りに集め、出口へ向かえ。<br />
              ワードンは見られている間だけ動けない——目を離すな。ただし、隠れれば見つからない。
            </p>
            <div className="actions">
              <button className="btn primary" type="button" onClick={onStart}>ENTER THE WARD</button>
            </div>
            <div id="primer">
              <div className="ph">3 THINGS TO KNOW</div>
              <ul>
                <li>WASD＋マウス（スマホは画面左右のスティック）で移動・視点</li>
                <li>ワードンを見ている間は動けない。目を離すと距離を詰めてくる</li>
                <li>ロッカーの近くでEを押すと隠れられる（見つからなくなる）</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {mode === "won" && lastRun && (
        <div className="overlay">
          <div className="card">
            <h1>Light Carried</h1>
            <div className="tagline">YOU ESCAPED THE WARD</div>
            <p>
              出口を抜けた。{fmtTime(lastRun.ms)} — SCORE {lastRun.score}<br />
              ジャンプスケア {lastRun.scares} 回 / 隠れた回数 {lastRun.hides} 回
            </p>
            <div className="actions">
              <button className="btn primary" type="button" onClick={onStart}>ESCAPE AGAIN</button>
            </div>
          </div>
        </div>
      )}

      {mode === "lost" && loss && (
        <div className="overlay">
          <div className="card">
            <h1>{loss.title}</h1>
            <div className="tagline">{loss.tagline}</div>
            <p>{loss.body}</p>
            <div className="actions">
              <button className="btn primary" type="button" onClick={onStart}>TRY AGAIN</button>
            </div>
          </div>
        </div>
      )}

      <div className={`alice-line ${toastLine ? "show" : ""}`} role="status" aria-live="polite">
        {toastLine}
      </div>
    </>
  );
}
