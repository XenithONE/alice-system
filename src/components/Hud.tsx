import { SIGNAL_FRAGMENTS, WORLDS, assetPath, routePath, type World } from "../data/worlds";
import type { CosmosInfo, TimeTrialEvent } from "../lib/cosmosEngine";
import type { ProgressState } from "../lib/storage";

interface HudProps {
  selected: World | null;
  nearest: World | null;
  progress: ProgressState;
  info: CosmosInfo | null;
  aliceLine: string;
  trial: TimeTrialEvent | null;
  onLaunch: (world: World) => void;
  onFocus: (id: string) => void;
  onReset: () => void;
  onTerminal: () => void;
  onMissions: () => void;
  onStartTrial: () => void;
}

export function Hud({ selected, nearest, progress, info, aliceLine, trial, onLaunch, onFocus, onReset, onTerminal, onMissions, onStartTrial }: HudProps) {
  const active = selected ?? nearest;
  const completed = WORLDS.filter((world) => world.kind === "game" && progress.completedWorlds.has(world.id)).length;
  const visibleWorlds = WORLDS.filter((world) => !world.hidden || progress.hiddenPlanet);
  const particleBudget = info ? new Intl.NumberFormat("en-US").format(info.particles) : "...";
  const atlasPercent = Math.round((progress.sevenWorlds.size / 7) * 100);
  const fragmentPercent = Math.round((progress.fragments.size / SIGNAL_FRAGMENTS.length) * 100);

  return (
    <>
      <header className="topbar">
        <button className="brand" type="button" onClick={onReset} aria-label="AlicE sYsTeM">
          <b>AlicE</b> sYsTeM
        </button>
        <div className="status-strip" aria-label="system status">
          <span>GRAPHICS {info?.quality ?? "..."}</span>
          <span>WEBGL {info ? (info.webgl2 ? "2" : "1") : "..."}</span>
          <span>SPARK {info?.spark ? "ON" : "OFF"}</span>
          <span>BLOOM {info?.bloom ? "ON" : "OFF"}</span>
          <span>LENS {info?.gravity ? "ON" : "OFF"}</span>
          <span>RAYS {info?.rays ? "ON" : "OFF"}</span>
          <span>FLARE {info?.flare ? "ON" : "OFF"}</span>
          <span>MSAA {info?.msaa ?? 0}X</span>
          <span>PTS {particleBudget}</span>
          <span>{progress.trueEnding ? "TRUE SIGNAL" : progress.accord ? "ACCORD" : "SEEKING"}</span>
          {progress.loop > 0 && <span>LOOP {progress.loop}</span>}
          <span>v{__APP_VERSION__}</span>
        </div>
        <div className="top-actions">
          <button type="button" className="icon-button" onClick={onMissions} title="Missions / achievements">
            MSN
          </button>
          <button type="button" className="icon-button" onClick={onStartTrial} title="Start ring run">
            RUN
          </button>
          <button type="button" className="icon-button" onClick={onTerminal} title="Terminal">
            TTY
          </button>
          <button type="button" className="icon-button" onClick={onReset} title="Reset camera">
            RST
          </button>
        </div>
      </header>

      <section className="hero-copy" aria-label="AlicE sYsTeM">
        <div className="signal-mark">AI-GENERATED UNIVERSE</div>
        <h1>
          FLY.
          <br />
          EXPLORE.
          <br />
          <span>PLAY THE VOID.</span>
        </h1>
        <p>惑星へ接近してゲームやアプリを起動。宇宙の奥に隠された信号を辿れ。</p>
      </section>

      <aside className="telemetry-panel desktop-hud" aria-label="deep space telemetry">
        <div className="hud-caption">DEEP SPACE TELEMETRY</div>
        <dl>
          <div>
            <dt>BLACK HOLE</dt>
            <dd>{progress.hiddenPlanet ? "OBSERVER FOUND" : "GRAVITY WELL"}</dd>
          </div>
          <div>
            <dt>NEBULA FIELD</dt>
            <dd>{info?.quality === "LOW" ? "LITE" : "DENSE"}</dd>
          </div>
          <div>
            <dt>FRAG SYNC</dt>
            <dd>{fragmentPercent}%</dd>
          </div>
          <div>
            <dt>ATLAS</dt>
            <dd>{atlasPercent}%</dd>
          </div>
          <div>
            <dt>BEST RUN</dt>
            <dd>{progress.timeTrialBest > 0 ? `${(progress.timeTrialBest / 1000).toFixed(2)}S` : "NONE"}</dd>
          </div>
          <div>
            <dt>DISTANCE</dt>
            <dd>{Math.round(progress.distance).toLocaleString("en-US")}</dd>
          </div>
        </dl>
      </aside>

      <aside className="planet-panel" data-active={active ? "true" : "false"} aria-live="polite">
        {active ? (
          <>
            <div className="planet-cover" style={{ backgroundImage: `url(${assetPath(active.cover)})` }} />
            <div className="planet-meta">
              <div className="planet-kind">{active.kind === "app" ? "APP WORLD" : active.hidden ? "HIDDEN WORLD" : "GAME WORLD"}</div>
              <h2>{active.title}</h2>
              <p>{active.description}</p>
              <div className="tag-row">
                {active.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <div className="panel-actions">
                <button type="button" className="launch-button" onClick={() => onLaunch(active)}>
                  LAUNCH
                </button>
                <a className="ghost-button" href={routePath(active.url)} target="_blank" rel="noreferrer">
                  OPEN
                </a>
              </div>
            </div>
          </>
        ) : (
          <div className="planet-empty">
            <span>NO PLANET LOCK</span>
            <strong>Signal field open</strong>
          </div>
        )}
      </aside>

      <aside className="world-stack desktop-hud" aria-label="world quick focus">
        <div className="hud-caption">ORBITAL INDEX</div>
        {visibleWorlds.map((world) => {
          const done = progress.completedWorlds.has(world.id);
          const isActive = active?.id === world.id;
          return (
            <button key={world.id} type="button" className={isActive ? "active" : done ? "done" : ""} onClick={() => onFocus(world.id)}>
              <span>{world.title}</span>
              <b>{done ? "DONE" : world.kind === "app" ? "APP" : world.hidden ? "HID" : "LOCK"}</b>
            </button>
          );
        })}
      </aside>

      <aside className="progress-panel" aria-label="signal progress">
        <div className="fragment-row">
          <span>SIGNAL FRAGMENTS</span>
          <strong>
            {progress.fragments.size}/{SIGNAL_FRAGMENTS.length}
          </strong>
        </div>
        <div className="orbs" aria-hidden="true">
          {SIGNAL_FRAGMENTS.map((fragment) => (
            <i key={fragment} className={progress.fragments.has(fragment) ? "on" : ""} />
          ))}
        </div>
        <div className="world-row">
          <span>WORLDS CONQUERED</span>
          <strong>{completed}/7</strong>
        </div>
        <div className="world-row">
          <span>STARDUST</span>
          <strong>{progress.stardustTotal}</strong>
        </div>
      </aside>

      <nav className="radar" aria-label="world navigation">
        {visibleWorlds.map((world, index) => {
          const isActive = active?.id === world.id;
          const isComplete = progress.completedWorlds.has(world.id);
          const angle = (index / Math.max(1, visibleWorlds.length)) * Math.PI * 2 - Math.PI / 2;
          const radius = world.kind === "app" ? 29 : 38;
          return (
            <button
              key={world.id}
              type="button"
              className={isActive ? "on" : isComplete ? "done" : ""}
              style={{
                left: `${50 + Math.cos(angle) * radius}%`,
                top: `${50 + Math.sin(angle) * radius}%`
              }}
              onClick={() => onFocus(world.id)}
              title={world.title}
              aria-label={world.title}
            />
          );
        })}
      </nav>

      <div className={`alice-line ${aliceLine ? "show" : ""}`} role="status" aria-live="polite">
        {aliceLine}
      </div>

      <footer className="command-ribbon desktop-hud" aria-label="flight commands">
        <span>DRAG LOOK</span>
        <span>WASD MOVE</span>
        <span>SHIFT BOOST</span>
        <span>SPACE / CTRL Y-AXIS</span>
        <span>BH PROXIMITY UNLOCK</span>
      </footer>

      {trial && (
        <div className="timetrial-hud" role="status" aria-live="polite">
          <span>RING {Math.min(trial.index + 1, trial.total)}/{trial.total}</span>
          <strong>{(trial.ms / 1000).toFixed(2)}s</strong>
        </div>
      )}
    </>
  );
}
