import { useCallback, useEffect, useRef, useState } from "react";
import {
  GRID_W, CELL_PX, TOWERS, TOWER_KINDS, SENDS, SEND_KINDS, BOT_LEVELS, TICK_MS, MAX_TICKS_PER_FRAME,
  type TowerKind, type SendKind
} from "./engine/balance";
import { TdEngine, type CreepSendMsg, type TdStatus } from "./engine/tdEngine";
import { TdRenderer, BOARD_SIZE } from "./engine/render";
import { BotOpponent } from "./ai/bot";
import { RoomClient, createLoopbackPair, type CloseReason } from "./net/room";
import type { PlayerInfo } from "./net/protocol";

const BASE = import.meta.env.BASE_URL;
const NAME_KEY = "alice_td_name";

type Phase = "menu" | "lobby" | "playing" | "results";
type Mode = "solo" | "multi";

interface OpponentView {
  id: string;
  name: string;
  isBot: boolean;
  lives: number;
  income: number;
  wave: number;
  creeps: number;
  grid: number[] | null;
  state: "alive" | "lost" | "disconnected";
  blockedTiers?: SendKind[];
}

interface ResultView {
  won: boolean;
  waveReached: number;
  reason: string;
}

const CLOSE_COPY: Record<CloseReason, string> = {
  hostLost: "HOST SIGNAL LOST — ホストとの接続が失われ、この対戦は続行できません。",
  "rejected-version": "バージョンが一致しません。ページを再読み込みしてください。",
  "rejected-in-game": "この部屋は対戦中です。",
  "rejected-full": "この部屋は満員です。",
  broker: "接続サーバーに到達できませんでした。時間をおいて再試行してください。",
  timeout: "接続を確立できませんでした。一部のネットワーク環境（対称NAT同士など）ではP2P接続が成立しない場合があります。別の回線でお試しください。",
  "room-not-found": "その部屋は見つかりませんでした。コードを確認してください。",
  left: ""
};

// ---------------------------------------------------------------- board canvas

interface TdBoardProps {
  engine: TdEngine;
  multi: boolean;
  placing: TowerKind | null;
  onCellClick: (cell: number) => void;
  onRenderer: (r: TdRenderer) => void;
  onFrame: (ms: number) => void;
}

function TdBoard({ engine, multi, placing, onCellClick, onRenderer, onFrame }: TdBoardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const placingRef = useRef(placing);
  placingRef.current = placing;
  const frameRef = useRef(onFrame);
  frameRef.current = onFrame;
  // The click listener is registered once per mount; without a ref it would
  // capture the mount-time onCellClick (placing frozen at null) forever.
  const clickRef = useRef(onCellClick);
  clickRef.current = onCellClick;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new TdRenderer(canvas, engine);
    onRenderer(renderer);
    let last = performance.now();
    let acc = 0;
    let rafId = 0;
    let disposed = false;

    const step = (now: number): void => {
      const dt = Math.min(500, now - last);
      last = now;
      frameRef.current(dt);
      acc += dt;
      let ticks = 0;
      while (acc >= TICK_MS && ticks < MAX_TICKS_PER_FRAME) {
        engine.tick();
        acc -= TICK_MS;
        ticks += 1;
      }
      if (ticks === MAX_TICKS_PER_FRAME) acc = 0; // shed backlog beyond the per-frame cap
    };

    const loop = (now: number): void => {
      if (disposed) return;
      step(now);
      renderer.draw(Math.min(1, acc / TICK_MS));
      rafId = window.requestAnimationFrame(loop);
    };
    rafId = window.requestAnimationFrame(loop);

    // Background pump (multiplayer only): rAF stops when hidden; a 1Hz interval
    // keeps the sim (and the host's waveTicks) alive. Solo auto-pauses instead.
    const interval = window.setInterval(() => {
      if (!document.hidden || disposed) return;
      if (!multi) {
        last = performance.now(); // solo pause: drop elapsed time
        return;
      }
      step(performance.now());
    }, 1000);

    const onVisible = (): void => {
      if (!document.hidden) {
        last = performance.now();
        if (!multi) acc = 0;
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    const cellFromEvent = (e: PointerEvent | MouseEvent): number => {
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * BOARD_SIZE.w;
      const y = ((e.clientY - rect.top) / Math.max(1, rect.height)) * BOARD_SIZE.h;
      const col = Math.floor(x / CELL_PX);
      const row = Math.floor(y / CELL_PX);
      if (col < 0 || col >= GRID_W || row < 0 || y < 0) return -1;
      const cell = row * GRID_W + col;
      return cell >= 0 && cell < engine.towerType.length ? cell : -1;
    };
    const onMove = (e: PointerEvent): void => renderer.setHover(cellFromEvent(e), placingRef.current);
    const onLeave = (): void => renderer.setHover(-1, null);
    const onClick = (e: MouseEvent): void => {
      const cell = cellFromEvent(e);
      if (cell >= 0) clickRef.current(cell);
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("click", onClick);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(rafId);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("click", onClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, multi]);

  return <canvas ref={canvasRef} className="td-board" style={{ aspectRatio: `${BOARD_SIZE.w} / ${BOARD_SIZE.h}` }} />;
}

// ---------------------------------------------------------------- opponent mini view

function MiniBoard({ grid }: { grid: number[] | null }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !grid) return;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#0b0b0f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const colors = ["", "#cdaa6d", "#d8845a", "#7fc8e8", "#b58cff", "#e8e2d4"];
    for (let i = 0; i < grid.length; i += 1) {
      if (grid[i] === 0) continue;
      const type = Math.floor(grid[i] / 4);
      ctx.fillStyle = colors[type] ?? "#fff";
      ctx.fillRect((i % GRID_W) * 6, Math.floor(i / GRID_W) * 6, 5, 5);
    }
  }, [grid]);
  return <canvas ref={ref} width={GRID_W * 6} height={60} className="td-mini" />;
}

// ---------------------------------------------------------------- app

export default function App() {
  const [phase, setPhase] = useState<Phase>("menu");
  const [mode, setMode] = useState<Mode>("solo");
  const [name, setName] = useState<string>(() => {
    // slice: an over-long stored name would null the hello in validateMsg (NAME_MAX)
    try { return (window.localStorage.getItem(NAME_KEY) || "PLAYER").slice(0, 16); } catch { return "PLAYER"; }
  });
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [lobby, setLobby] = useState<PlayerInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [netError, setNetError] = useState("");
  const [hud, setHud] = useState<TdStatus | null>(null);
  const [opponents, setOpponents] = useState<Record<string, OpponentView>>({});
  const [placing, setPlacing] = useState<TowerKind | null>(null);
  const [selectedCell, setSelectedCell] = useState(-1);
  const [target, setTarget] = useState("auto");
  const [result, setResult] = useState<ResultView | null>(null);
  const [selfDead, setSelfDead] = useState(false);
  const [toast, setToast] = useState("");
  const [rematchVotes, setRematchVotes] = useState<string[]>([]);
  const [engineNonce, setEngineNonce] = useState(0);

  const engineRef = useRef<TdEngine | null>(null);
  const rendererRef = useRef<TdRenderer | null>(null);
  const roomRef = useRef<RoomClient | null>(null);
  const botRef = useRef<BotOpponent | null>(null);
  const statusParity = useRef(0);
  const toastTimer = useRef(0);
  const opponentsRef = useRef(opponents);
  opponentsRef.current = opponents;
  const targetRef = useRef(target);
  targetRef.current = target;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const botLevelRef = useRef<keyof typeof BOT_LEVELS>("normal");

  const say = useCallback((text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2600);
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(NAME_KEY, name); } catch { /* private mode */ }
  }, [name]);

  const resolveTarget = useCallback((): string => {
    const alive = Object.values(opponentsRef.current).filter((o) => o.state === "alive");
    if (alive.length === 0) return "";
    const chosen = targetRef.current;
    if (chosen !== "auto" && alive.some((o) => o.id === chosen)) return chosen;
    let best = alive[0];
    for (const o of alive) {
      const s = o.lives * 1000 + o.income;
      const bs = best.lives * 1000 + best.income;
      if (s > bs || (s === bs && o.id < best.id)) best = o;
    }
    return best.id;
  }, []);

  // ------------------------------------------------ match setup

  const startMatch = useCallback((seed: number, matchMode: Mode, players: PlayerInfo[], botLevel?: keyof typeof BOT_LEVELS) => {
    engineRef.current?.dispose();
    const room = roomRef.current;
    const myId = room?.myId ?? "me";

    const engine = new TdEngine(seed, {
      onStatus: (s) => {
        setHud(s);
        if (modeRef.current === "solo") {
          botRef.current?.setWave(s.wave);
        } else if (room) {
          statusParity.current = (statusParity.current + 1) % 2;
          if (statusParity.current === 0) {
            room.sendGameMsg({ t: "status", from: myId, lives: s.lives, income: s.income, wave: s.wave, creeps: s.creepsAlive });
            const snap = engine.boardSnapshot();
            room.sendGameMsg({ t: "board", from: myId, grid: snap.grid, creeps: snap.creeps });
          }
        }
      },
      onWave: (waveNo) => {
        if (modeRef.current === "multi" && room?.isHost) {
          room.sendGameMsg({ t: "waveTick", wave: waveNo });
        }
      },
      onSendResolved: (r) => {
        if (!r.ok) {
          say("GOLD不足");
          return;
        }
        if (modeRef.current === "solo") {
          const through = botRef.current?.receiveAttack(r.kind) ?? false;
          if (!through) say("相手の防衛に阻まれた — 上位ユニットが必要");
        } else if (room) {
          const targetId = resolveTarget();
          if (targetId) room.sendGameMsg({ t: "creeps", from: myId, target: targetId, kind: r.kind, wave: r.wave, sendId: r.sendId });
        }
      },
      onLifeLost: (leak) => rendererRef.current?.kick(leak >= 2 ? 7 : 3.5),
      onGameOver: (r) => {
        if (modeRef.current === "solo") {
          // prev ?? …: the sim keeps ticking on the results screen, so a later
          // board death must never overwrite an already-earned VICTORY.
          setResult((prev) => prev ?? { won: false, waveReached: r.waveReached, reason: "リークが限界を超えた" });
          setPhase("results");
        } else {
          setSelfDead(true);
          roomRef.current?.reportSelfOver();
          say("敗北 — 観戦モード");
        }
      }
    });
    engineRef.current = engine;
    setEngineNonce((n) => n + 1);
    setHud(engine.status());
    setSelfDead(false);
    setResult(null);
    setPlacing(null);
    setSelectedCell(-1);
    setRematchVotes([]);

    if (matchMode === "solo") {
      const level = botLevel ?? "normal";
      botRef.current = new BotOpponent(level, (seed ^ 0xabcdef) >>> 0, {
        onCreeps: (msg) => engineRef.current?.receiveCreeps(msg),
        onStatus: (s) => {
          setOpponents((prev) => ({
            ...prev,
            bot: {
              id: "bot", name: `AUTOMATON·${BOT_LEVELS[level].name}`, isBot: true,
              lives: s.lives, income: s.income, wave: engineRef.current?.wave ?? 0,
              creeps: 0, grid: null, state: s.lives > 0 ? "alive" : "lost",
              blockedTiers: s.blockedTiers
            }
          }));
        },
        onOver: () => {
          if (engineRef.current) engineRef.current.dead = true; // freeze the sim — no post-win wave churn
          setResult({ won: true, waveReached: engineRef.current?.wave ?? 0, reason: "AUTOMATONを撃破" });
          setPhase("results");
        }
      });
      setOpponents({
        bot: { id: "bot", name: `AUTOMATON·${BOT_LEVELS[level].name}`, isBot: true, lives: 20, income: 15, wave: 0, creeps: 0, grid: null, state: "alive" }
      });
    } else {
      botRef.current = null;
      const views: Record<string, OpponentView> = {};
      for (const p of players) {
        if (p.id === myId) continue;
        views[p.id] = { id: p.id, name: p.name, isBot: false, lives: 20, income: 15, wave: 0, creeps: 0, grid: null, state: "alive" };
      }
      setOpponents(views);
    }
    setPhase("playing");
  }, [resolveTarget, say]);

  // ------------------------------------------------ room lifecycle

  const makeRoom = useCallback((): RoomClient => {
    const room: RoomClient = new RoomClient({
      onLobby: (players) => setLobby(players),
      onStart: (seed, players) => startMatch(seed, "multi", players),
      onCreeps: (msg) => engineRef.current?.receiveCreeps(msg as CreepSendMsg & { target: string }),
      onOpponentStatus: (msg) => {
        setOpponents((prev) => {
          const cur = prev[msg.from];
          if (!cur) return prev;
          return { ...prev, [msg.from]: { ...cur, lives: msg.lives, income: msg.income, wave: msg.wave, creeps: msg.creeps } };
        });
      },
      onOpponentBoard: (msg) => {
        setOpponents((prev) => {
          const cur = prev[msg.from];
          if (!cur) return prev;
          return { ...prev, [msg.from]: { ...cur, grid: msg.grid, creeps: msg.creeps } };
        });
      },
      onWaveTick: (wave) => engineRef.current?.syncWave(wave),
      onOver: (from, reason) => {
        if (from === room.myId) {
          // Host-side elimination of *us* (e.g. heartbeat timeout while our link
          // was one-way): without this we'd keep playing as a ghost.
          setSelfDead(true);
          if (reason !== "dead") say("接続不安定と判定されました — 観戦モード");
          return;
        }
        setOpponents((prev) => {
          const cur = prev[from];
          if (!cur) return prev;
          return { ...prev, [from]: { ...cur, state: reason === "dead" ? "lost" : "disconnected" } };
        });
      },
      onWin: (winner) => {
        if (engineRef.current) engineRef.current.dead = true; // match decided — freeze the sim
        const won = winner === room.myId;
        setResult({ won, waveReached: engineRef.current?.wave ?? 0, reason: won ? "最後の生存者" : "敗北" });
        setPhase("results");
      },
      onRematchStart: (seed) => startMatch(seed, "multi", room.players),
      onRematchVotes: (votes) => setRematchVotes(votes),
      onClosed: (reason) => {
        roomRef.current = null;
        if (reason !== "left") setNetError(CLOSE_COPY[reason] || "接続が終了しました。");
        setPhase("menu");
      }
    });
    return room;
  }, [startMatch]);

  const hostRoom = useCallback(async () => {
    setBusy(true);
    setNetError("");
    const room = makeRoom();
    const res = await room.host(name.trim() || "PLAYER");
    setBusy(false);
    if (res.ok) {
      roomRef.current = room;
      setMode("multi");
      setIsHost(true);
      setRoomCode(res.code);
      setPhase("lobby");
    } else {
      setNetError(CLOSE_COPY[res.reason]);
    }
  }, [makeRoom, name]);

  const joinRoom = useCallback(async () => {
    if (!joinCode.trim()) return;
    setBusy(true);
    setNetError("");
    const room = makeRoom();
    const res = await room.join(joinCode, name.trim() || "PLAYER");
    setBusy(false);
    if (res.ok) {
      roomRef.current = room;
      setMode("multi");
      setIsHost(false);
      setRoomCode(room.roomCode);
      setPhase("lobby");
    } else {
      setNetError(CLOSE_COPY[res.reason]);
    }
  }, [makeRoom, joinCode, name]);

  const startSolo = useCallback((level: keyof typeof BOT_LEVELS) => {
    botLevelRef.current = level; // remembered so REMATCH keeps the chosen difficulty
    setMode("solo");
    const seed = (Math.random() * 0xffffffff) >>> 0;
    startMatch(seed, "solo", [], level);
  }, [startMatch]);

  const leaveToMenu = useCallback(() => {
    roomRef.current?.leave();
    roomRef.current = null;
    engineRef.current?.dispose();
    botRef.current = null;
    setOpponents({});
    setPhase("menu");
  }, []);

  // ------------------------------------------------ board interactions

  const handleCellClick = useCallback((cell: number) => {
    const engine = engineRef.current;
    if (!engine || selfDead) return;
    if (placing) {
      engine.placeTower(cell, placing);
      return;
    }
    if (engine.towerType[cell] !== 0) {
      setSelectedCell(cell);
      rendererRef.current?.setSelected(cell);
    } else {
      setSelectedCell(-1);
      rendererRef.current?.setSelected(-1);
    }
  }, [placing, selfDead]);

  const handleFrame = useCallback((ms: number) => {
    if (modeRef.current === "solo" && !document.hidden) botRef.current?.advance(ms);
  }, []);

  // Esc clears placement/selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setPlacing(null);
        setSelectedCell(-1);
        rendererRef.current?.setSelected(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Debug hook (deterministic verification in headless previews)
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__td = {
      ui: { startSolo: (level: "easy" | "normal" | "hard" = "normal") => startSolo(level), phase: () => phase },
      engine: () => engineRef.current,
      pump: (n: number) => engineRef.current?.pump(n),
      state: () => engineRef.current?.debugState(),
      hash: () => engineRef.current?.stateHash(),
      place: (cell: number, kind: TowerKind) => engineRef.current?.placeTower(cell, kind),
      upgrade: (cell: number) => engineRef.current?.upgradeTower(cell),
      sell: (cell: number) => engineRef.current?.sellTower(cell),
      send: (kind: SendKind) => engineRef.current?.trySend(kind),
      injectCreeps: (msg: CreepSendMsg) => engineRef.current?.receiveCreeps(msg),
      makeEngine: (seed: number) => new TdEngine(seed),
      room: () => roomRef.current,
      RoomClient,
      loopback: createLoopbackPair
    };
    return () => { delete w.__td; };
  }, [phase, startSolo]);

  // ------------------------------------------------ render

  const aliveOpponents = Object.values(opponents).filter((o) => o.state === "alive");
  const selectedTower = selectedCell >= 0 && engineRef.current && engineRef.current.towerType[selectedCell] !== 0
    ? {
        cell: selectedCell,
        kind: TOWER_KINDS[engineRef.current.towerType[selectedCell] - 1],
        level: engineRef.current.towerLevel[selectedCell],
        invested: engineRef.current.towerInvested[selectedCell]
      }
    : null;

  return (
    <div className="td-shell">
      <header className="td-top">
        <a className="td-back" href={BASE}>← AlicE sYsTeM</a>
        <b>SIGNAL SIEGE</b>
        <span className="td-sub">VERSUS TOWER DEFENSE — v{__APP_VERSION__}</span>
      </header>

      {phase === "menu" && (
        <div className="td-menu">
          <h1>SIGNAL SIEGE</h1>
          <p className="td-tag">送るか、死ぬか。 — 対戦タワーディフェンス</p>
          {netError && <div className="td-error">{netError}</div>}
          <label className="td-field">
            <span>NAME</span>
            <input value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="td-menu-grid">
            <section>
              <h2>SOLO — vs AUTOMATON</h2>
              <div className="td-row">
                {(Object.keys(BOT_LEVELS) as Array<keyof typeof BOT_LEVELS>).map((level) => (
                  <button key={level} type="button" className="td-btn" onClick={() => startSolo(level)}>
                    {BOT_LEVELS[level].name}
                  </button>
                ))}
              </div>
            </section>
            <section>
              <h2>MULTIPLAYER — 最大3人 / P2P</h2>
              <div className="td-row">
                <button type="button" className="td-btn primary" disabled={busy} onClick={() => void hostRoom()}>
                  CREATE ROOM
                </button>
              </div>
              <div className="td-row">
                <input
                  className="td-code-input"
                  placeholder="ROOM CODE"
                  value={joinCode}
                  maxLength={5}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                />
                <button type="button" className="td-btn" disabled={busy || joinCode.trim().length < 5} onClick={() => void joinRoom()}>
                  JOIN
                </button>
              </div>
              <p className="td-note">サーバー不要のP2P接続。ホストが部屋コードを共有し、フレンドが入力して参加します。回線環境によっては接続できない場合があります。</p>
            </section>
          </div>
        </div>
      )}

      {phase === "lobby" && (
        <div className="td-menu">
          <h1>ROOM {roomCode}</h1>
          <button
            type="button"
            className="td-btn"
            onClick={() => { void navigator.clipboard?.writeText(roomCode).catch(() => undefined); say("コードをコピーしました"); }}
          >
            COPY CODE
          </button>
          <ul className="td-lobby">
            {lobby.map((p) => (
              <li key={p.id}>
                <b>{p.name}</b>
                <span>{p.isHost ? "HOST" : "GUEST"}</span>
              </li>
            ))}
          </ul>
          <div className="td-row">
            {isHost && (
              <button type="button" className="td-btn primary" disabled={lobby.length < 2} onClick={() => roomRef.current?.startGame()}>
                START ({lobby.length}/3)
              </button>
            )}
            {!isHost && <span className="td-note">ホストの開始を待っています…</span>}
            <button type="button" className="td-btn" onClick={leaveToMenu}>LEAVE</button>
          </div>
        </div>
      )}

      {(phase === "playing" || phase === "results") && engineRef.current && (
        <div className="td-game">
          <div className="td-main">
            <div className="td-statusbar">
              <span>LIVES <b className={hud && hud.lives <= 5 ? "danger" : ""}>{hud?.lives ?? "-"}</b></span>
              <span>GOLD <b>{hud?.gold ?? "-"}</b></span>
              <span>INCOME <b>+{hud?.income ?? "-"}</b></span>
              <span>WAVE <b>{hud?.wave ?? 0}</b></span>
              <span>NEXT <b>{hud ? Math.ceil(hud.nextWaveTicks / 30) : "-"}s</b></span>
            </div>
            <TdBoard
              key={engineNonce}
              engine={engineRef.current}
              multi={mode === "multi"}
              placing={placing}
              onCellClick={handleCellClick}
              onRenderer={(r) => { rendererRef.current = r; }}
              onFrame={handleFrame}
            />
            <div className="td-palette">
              {TOWER_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={`td-tower-btn ${placing === kind ? "on" : ""}`}
                  disabled={selfDead || (hud !== null && hud.gold < TOWERS[kind].cost)}
                  style={{ "--tw": TOWERS[kind].color } as React.CSSProperties}
                  onClick={() => { setPlacing(placing === kind ? null : kind); setSelectedCell(-1); rendererRef.current?.setSelected(-1); }}
                >
                  <b>{TOWERS[kind].name}</b>
                  <span>{TOWERS[kind].cost}g</span>
                </button>
              ))}
              {selectedTower && (
                <div className="td-inspector">
                  <b>{TOWERS[selectedTower.kind].name} L{selectedTower.level}</b>
                  {selectedTower.level < 3 && (
                    <button
                      type="button"
                      className="td-btn small"
                      disabled={selfDead || (hud !== null && hud.gold < TOWERS[selectedTower.kind].upCost[selectedTower.level - 1])}
                      onClick={() => engineRef.current?.upgradeTower(selectedTower.cell)}
                    >
                      UPGRADE {TOWERS[selectedTower.kind].upCost[selectedTower.level - 1]}g
                    </button>
                  )}
                  <button type="button" className="td-btn small" onClick={() => { engineRef.current?.sellTower(selectedTower.cell); setSelectedCell(-1); rendererRef.current?.setSelected(-1); }}>
                    SELL {Math.floor(selectedTower.invested * 0.7)}g
                  </button>
                </div>
              )}
            </div>
          </div>

          <aside className="td-side">
            <div className="td-panel">
              <div className="td-caption">SEND — 相手に送る（収入が増える）</div>
              {mode === "multi" && aliveOpponents.length > 1 && (
                <select className="td-target" value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="auto">TARGET: AUTO（リーダー）</option>
                  {aliveOpponents.map((o) => (
                    <option key={o.id} value={o.id}>TARGET: {o.name}</option>
                  ))}
                </select>
              )}
              <div className="td-sends">
                {SEND_KINDS.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className="td-send-btn"
                    disabled={selfDead || (hud !== null && hud.gold < SENDS[kind].cost)}
                    style={{ "--tw": SENDS[kind].color } as React.CSSProperties}
                    onClick={() => engineRef.current?.trySend(kind)}
                  >
                    <b>{SENDS[kind].name}</b>
                    <span>{SENDS[kind].cost}g / +{SENDS[kind].incomeBonus}収入</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="td-panel">
              <div className="td-caption">OPPONENTS</div>
              {Object.values(opponents).map((o) => (
                <div key={o.id} className={`td-opp ${o.state}`}>
                  <div className="td-opp-head">
                    <b>{o.name}</b>
                    <span>{o.state === "alive" ? `♥${o.lives}` : o.state === "lost" ? "ELIMINATED" : "SIGNAL LOST"}</span>
                  </div>
                  {o.isBot ? (
                    <div className="td-opp-meta">
                      INCOME +{o.income}
                      {o.blockedTiers && o.blockedTiers.length > 0 && <em> / 防御済: {o.blockedTiers.map((t) => SENDS[t].name).join("·")}</em>}
                    </div>
                  ) : (
                    <>
                      <MiniBoard grid={o.grid} />
                      <div className="td-opp-meta">W{o.wave} / +{o.income} / 敵{o.creeps}</div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </aside>

          {phase === "results" && result && (
            <div className="td-overlay">
              <div className="td-card">
                <h1 className={result.won ? "win" : "lose"}>{result.won ? "VICTORY" : "DEFEAT"}</h1>
                <p>{result.reason} — WAVE {result.waveReached}</p>
                <div className="td-row center">
                  {mode === "solo" ? (
                    <button type="button" className="td-btn primary" onClick={() => startSolo(botLevelRef.current)}>REMATCH</button>
                  ) : (
                    <button type="button" className="td-btn primary" onClick={() => roomRef.current?.voteRematch()}>
                      REMATCH {rematchVotes.length > 0 ? `(${rematchVotes.length})` : ""}
                    </button>
                  )}
                  <button type="button" className="td-btn" onClick={leaveToMenu}>MENU</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className={`td-toast ${toast ? "show" : ""}`}>{toast}</div>
    </div>
  );
}
