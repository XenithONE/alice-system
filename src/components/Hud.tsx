import { useEffect, useRef, useState } from "react";
import type { PlayerInfo } from "../horror/net/protocol";
import { ACHIEVEMENTS } from "../lib/achievements";
import type { GameInfo, GameMode, JumpscareKind, LossKind, RunEndResult } from "../lib/horrorEngine";
import type { ProgressState } from "../lib/storage";
import { getQualityChoice, setQualityChoice, type QualityChoice } from "../lib/webgl";

type MenuPanel = "main" | "join" | "connecting" | "lobby";

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
  networked: boolean;
  menuPanel: MenuPanel;
  playerName: string;
  joinCode: string;
  roomCode: string;
  lobbyPlayers: PlayerInfo[];
  localPlayerId: string;
  isHost: boolean;
  latencyMs: number;
  networkError: string;
  onPlayerNameChange: (value: string) => void;
  onJoinCodeChange: (value: string) => void;
  onMenuPanelChange: (panel: MenuPanel) => void;
  onSolo: () => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  onStartRoom: () => void;
  onLeaveRoom: () => void;
  onCopyInvite: () => void;
  onReplay: () => void;
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

function PlayerRoster({ players, localPlayerId }: { players: PlayerInfo[]; localPlayerId: string }) {
  const slots = [0, 1, 2].map((slot) => players.find((player) => player.slot === slot));
  return (
    <div className="lobby-roster" aria-label={`${players.length} of 3 witnesses connected`}>
      {slots.map((player, slot) => (
        <div className={`lobby-slot ${player ? "occupied" : "vacant"}`} data-slot={slot} key={slot}>
          <span className="slot-signal" aria-hidden="true" />
          <span className="slot-index">0{slot + 1}</span>
          <span className="slot-name">{player?.name ?? "AWAITING SIGNAL"}</span>
          {player && (
            <span className="slot-role">
              {player.id === localPlayerId ? "YOU" : player.isHost ? "HOST" : "LINKED"}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export function Hud({
  mode, info, filesFound, filesTotal, fear, elapsedMs, hiding, flashlightOn, progress, lastRun, toastLine,
  jumpscareToken, jumpscareKind, isTouch, networked, menuPanel, playerName, joinCode, roomCode,
  lobbyPlayers, localPlayerId, isHost, latencyMs, networkError, onPlayerNameChange, onJoinCodeChange,
  onMenuPanelChange, onSolo, onCreateRoom, onJoinRoom, onStartRoom, onLeaveRoom, onCopyInvite, onReplay,
  onPause, onResume, onHide, onFlashlight, onMute, onBloom, onShake, onLookSens
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

  useEffect(() => {
    // Settings must never sit above a newly opened pause/end/menu overlay.
    setSettingsOpen(false);
  }, [mode]);

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
  const activePlayers = lobbyPlayers.slice().sort((a, b) => a.slot - b.slot);
  const connectionQuality = latencyMs <= 0 ? "waiting" : latencyMs < 120 ? "good" : latencyMs < 240 ? "fair" : "poor";
  const validJoinCode = joinCode.length === 5;
  const terminalMode = mode === "won" || mode === "lost";

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
          {networked && (
            <span className="link-chip" data-quality={connectionQuality}>
              <i aria-hidden="true" /> LINK {activePlayers.length}/3 · {latencyMs > 0 ? `${latencyMs}MS` : "SYNC"}
            </span>
          )}
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
        {!terminalMode && (
          <div className="top-actions">
            <button type="button" className="icon-button" onClick={() => setSettingsOpen((v) => !v)} title="Settings">
              SETTINGS
            </button>
            <button type="button" className="icon-button" onClick={toggleMute} title="Mute">
              {muted ? "SOUND OFF" : "SOUND ON"}
            </button>
          </div>
        )}
      </header>

      {settingsOpen && (
        <div id="settingsPanel" className="show">
          <div className="hd">SETTINGS</div>
          {networked && <div className="live-session-note"><i aria-hidden="true" /> LIVE LINK — WORLD CONTINUES</div>}
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
            <div>{filesFound >= filesTotal ? "出口を探せ — 赤いサインの先" : `${networked ? "SHARED " : ""}CASE FILES を ${filesTotal} 個集めろ`}</div>
            <div className="sub">
              {hiding ? "隠れている — Eで出る" : networked ? "誰か一人でも見ていれば、ワードンは動けない。" : "光を頼りに進め。見られていないと、近づいてくる。"}
            </div>
          </div>

          {networked && activePlayers.length > 0 && (
            <div className="teammate-strip" aria-label="linked witnesses">
              <div className="team-label"><i aria-hidden="true" /> WARD LINK</div>
              <div className="team-members">
                {activePlayers.map((player) => (
                  <span className="teammate-chip" data-slot={player.slot} key={player.id}>
                    <i aria-hidden="true" />
                    <b>{player.name}</b>
                    <em>{player.id === localPlayerId ? "YOU" : player.isHost ? "HOST" : "LIVE"}</em>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="hud">
            <div className="panel readout">
              <span>TIME <b>{fmtTime(elapsedMs)}</b></span>
              <span>BEST <b>{fmtTime(progress.bestMs)}</b></span>
              <span>FILES <b>{filesFound}/{filesTotal}</b></span>
              <span>FLASHLIGHT <b>{flashlightOn ? "ON" : "OFF"}</b></span>
              <span>FEAR<span className="meter"><i style={{ width: `${Math.min(100, fear)}%` }} /></span></span>
            </div>
            <div className="panel keys desktop-hud">
              MOVE: WASD<br />LOOK: MOUSE<br />HIDE: E &nbsp; LIGHT: F<br />{networked ? "LIVE LINK: NO PAUSE" : "PAUSE: ESC"}
            </div>
          </div>

          {isTouch && (
            <div className="touch-actions">
              <button type="button" className="touch-btn" onClick={onHide}>{hiding ? "OUT" : "HIDE"}</button>
              <button type="button" className="touch-btn" onClick={onFlashlight}>LIGHT</button>
            </div>
          )}

          {!isTouch && !networked && mode === "playing" && (
            <button type="button" className="pause-btn" onClick={onPause}>PAUSE</button>
          )}
        </>
      )}

      {mode === "paused" && (
        <div className="overlay">
          <div className="card compact-card">
            <h1>{networked ? "Link Open" : "Paused"}</h1>
            <div className="tagline">{networked ? "THE WARD DOES NOT WAIT" : "THE WARD WAITS"}</div>
            {networked && <p>通信中の病棟は停止しません。戻るまで仲間の視界があなたを守ります。</p>}
            <div className="actions">
              <button className="btn primary" type="button" onClick={onResume}>RESUME</button>
            </div>
          </div>
        </div>
      )}

      {mode === "menu" && (
        <div className="overlay menu-overlay">
          <div className={`card menu-card panel-${menuPanel}`}>
            {menuPanel === "main" && (
              <>
                <div className="eyebrow"><i aria-hidden="true" /> CO-OP HORROR · 1—3 WITNESSES</div>
                <h1>The Hollow Ward</h1>
                <div className="tagline">DON&apos;T LOOK AWAY</div>
                <div className="build-tag" aria-label="version 2, brick update">v2 — BRICK UPDATE</div>
                <p>
                  6つのCASE FILEを回収して廃病棟から脱出せよ。<br className="desktop-break" />
                  ワードンは、誰かに見られている間だけ動けない。
                </p>

                <label className="identity-field">
                  <span>WITNESS NAME</span>
                  <input
                    type="text"
                    value={playerName}
                    maxLength={16}
                    autoComplete="nickname"
                    spellCheck={false}
                    onChange={(event) => onPlayerNameChange(event.target.value)}
                    placeholder="WITNESS"
                  />
                </label>

                <div className="session-picker">
                  <button className="session-choice solo-choice" type="button" onClick={onSolo}>
                    <span className="choice-index">01</span>
                    <span><b>SOLO DESCENT</b><small>一人で病棟へ入る</small></span>
                    <i aria-hidden="true">→</i>
                  </button>
                  <button className="session-choice host-choice" type="button" onClick={onCreateRoom}>
                    <span className="choice-index">02</span>
                    <span><b>CREATE ROOM</b><small>コードを作り、最大2人を招待</small></span>
                    <i aria-hidden="true">＋</i>
                  </button>
                  <button className="session-choice join-choice" type="button" onClick={() => onMenuPanelChange("join")}>
                    <span className="choice-index">03</span>
                    <span><b>JOIN ROOM</b><small>5文字のコードでリンク</small></span>
                    <i aria-hidden="true">↗</i>
                  </button>
                </div>

                <div className="profile-line" aria-label="player progress">
                  <span>RUNS <b>{progress.runs}</b></span>
                  <span>ESCAPES <b>{progress.wins}</b></span>
                  <span>ACHIEVEMENTS <b>{progress.achievements.size}/{ACHIEVEMENTS.length}</b></span>
                  <span>BEST <b>{fmtTime(progress.bestMs)}</b></span>
                </div>
              </>
            )}

            {menuPanel === "join" && (
              <form className="join-form" onSubmit={(event) => { event.preventDefault(); if (validJoinCode) onJoinRoom(); }}>
                <div className="eyebrow"><i aria-hidden="true" /> ENCRYPTED WARD LINK</div>
                <h1>Join The Ward</h1>
                <div className="tagline">ENTER THE ROOM CODE</div>
                <p>ホストから受け取った5文字のコードを入力してください。</p>
                <label className="identity-field compact">
                  <span>WITNESS NAME</span>
                  <input
                    type="text"
                    value={playerName}
                    maxLength={16}
                    autoComplete="nickname"
                    spellCheck={false}
                    onChange={(event) => onPlayerNameChange(event.target.value)}
                  />
                </label>
                <label className="room-code-field">
                  <span>ROOM CODE</span>
                  <input
                    type="text"
                    value={joinCode}
                    maxLength={5}
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    autoFocus
                    onChange={(event) => onJoinCodeChange(event.target.value)}
                    placeholder="— — — — —"
                    aria-describedby="room-code-hint"
                  />
                </label>
                <div id="room-code-hint" className="form-hint">A—Z / 2—9 · 5 CHARACTERS</div>
                <div className="actions">
                  <button className="btn quiet" type="button" onClick={() => onMenuPanelChange("main")}>BACK</button>
                  <button className="btn primary" type="submit" disabled={!validJoinCode}>CONNECT</button>
                </div>
              </form>
            )}

            {menuPanel === "connecting" && (
              <div className="connecting-state" role="status" aria-live="polite">
                <div className="signal-loader" aria-hidden="true"><i /><i /><i /></div>
                <div className="eyebrow">SEARCHING THE STATIC</div>
                <h1>Linking</h1>
                <div className="tagline">DO NOT CLOSE THIS WINDOW</div>
                <p>安全な接続経路を探しています。通常は数秒で完了します。</p>
              </div>
            )}

            {menuPanel === "lobby" && (
              <div className="lobby-card">
                <div className="eyebrow"><i aria-hidden="true" /> {isHost ? "YOU CONTROL THE SIGNAL" : "HOST CONTROLS THE SIGNAL"}</div>
                <h1>Signal Room</h1>
                <div className="tagline">{lobbyPlayers.length}/3 WITNESSES LINKED</div>
                <button type="button" className="room-code-display" onClick={onCopyInvite} title="Copy invite link">
                  <small>ROOM CODE · CLICK TO COPY</small>
                  <strong>{roomCode || "·····"}</strong>
                  <span>COPY LINK</span>
                </button>
                <PlayerRoster players={lobbyPlayers} localPlayerId={localPlayerId} />
                <div className="lobby-status">
                  <i aria-hidden="true" />
                  {isHost
                    ? lobbyPlayers.length < 2 ? "WAITING FOR ONE MORE WITNESS" : "TEAM READY — ENTER WHEN PREPARED"
                    : "WAITING FOR HOST TO OPEN THE WARD"}
                </div>
                <div className="actions lobby-actions">
                  <button className="btn quiet danger" type="button" onClick={onLeaveRoom}>LEAVE ROOM</button>
                  {isHost && (
                    <button className="btn primary" type="button" onClick={onStartRoom} disabled={lobbyPlayers.length < 2}>
                      ENTER TOGETHER
                    </button>
                  )}
                </div>
              </div>
            )}

            {networkError && <div className="network-error" role="alert"><b>LINK ERROR</b><span>{networkError}</span></div>}

            {menuPanel === "main" && (
              <div id="primer">
                <div className="ph">3 THINGS TO KNOW</div>
                <ul>
                  <li>WASD＋マウス（スマホは画面左右のスティック）で移動・視点</li>
                  <li>ワードンを見ている間は動けない。マルチでは全員の視線が有効</li>
                  <li>ロッカーの近くでEを押すと隠れられる（見つからなくなる）</li>
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {mode === "won" && lastRun && (
        <div className="overlay">
          <div className="card end-card won-card">
            <div className="eyebrow"><i aria-hidden="true" /> {networked ? "WARD LINK SURVIVED" : "SURVIVOR RECORDED"}</div>
            <h1>Light Carried</h1>
            <div className="tagline">{networked ? "YOUR SIGNALS LEFT TOGETHER" : "YOU ESCAPED THE WARD"}</div>
            <p>
              出口を抜けた。{fmtTime(lastRun.ms)} — SCORE {lastRun.score}<br />
              ジャンプスケア {lastRun.scares} 回 / 隠れた回数 {lastRun.hides} 回
            </p>
            <div className="actions">
              <button className="btn primary" type="button" onClick={onReplay}>{networked ? "CLOSE THE LINK" : "ESCAPE AGAIN"}</button>
            </div>
          </div>
        </div>
      )}

      {mode === "lost" && loss && (
        <div className="overlay loss-overlay">
          <div className="card end-card lost-card">
            <div className="eyebrow"><i aria-hidden="true" /> {networked ? "TEAM SIGNAL TERMINATED" : "SIGNAL TERMINATED"}</div>
            <h1>{loss.title}</h1>
            <div className="tagline">{networked ? "THE WARD TOOK THE LINK" : loss.tagline}</div>
            <p>{loss.body}</p>
            {networked && <p className="end-note">セッションを閉じ、全員がタイトルへ戻ります。</p>}
            <div className="actions">
              <button className="btn primary" type="button" onClick={onReplay}>{networked ? "CLOSE THE LINK" : "TRY AGAIN"}</button>
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
