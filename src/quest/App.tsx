import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildContent } from "./content";
import type { CardDef, ClassId, Intent } from "./engine/types";
import { makeRoomCode, type LobbyView, type StateView, type Wire } from "./net/protocol";
import { PeerJsWire } from "./net/peer";
import { HostSession, GuestSession } from "./net/session";
import { BroadcastChannelWire } from "./net/wire";
import { drawBoard, hitTestNode, type BoardRenderOptions } from "./render/board";
import { sfx } from "./sfx";
import { ChoiceModal, useModalFocus } from "./ui/ChoiceModal";
import { CombatPanel } from "./ui/CombatPanel";
import { HandBar } from "./ui/HandBar";
import { Lobby } from "./ui/Lobby";
import { LogPanel } from "./ui/LogPanel";
import { PlayersPanel } from "./ui/PlayersPanel";

const content = buildContent();
const ROUND_LIMIT = 40;
type Screen = "title" | "lobby" | "game";
type Session = HostSession | GuestSession;

declare global {
  interface Window {
    __rr?: { getView: () => StateView | null; send: (intent: Intent) => void; screen: () => Screen };
  }
}

function cleanRoom(value: string): string {
  return value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 5);
}

const DENIALS: Record<string, string> = {
  "not your turn": "あなたのターンではありません",
  "wrong seat": "あなたのターンではありません",
  "game is not playing": "ゲーム中ではありません",
  "invalid seat": "無効なプレイヤーです",
  "not enough energy": "エナジーが足りません",
  "node is not adjacent": "隣接していないノードには移動できません",
  "portal requires 3 relics": "ポータルにはレリックが3個必要です",
  "not in combat": "戦闘中のみ使えます",
  "combat-only card": "このカードは戦闘中のみ使えます",
  "overworld-only card": "このカードはフィールドでのみ使えます",
  "combat active": "戦闘中はこの操作を行えません",
  "invalid hand card": "無効な手札です",
  "curse requires a living rival target": "生存しているライバルを選んでください",
  "invalid node": "無効な移動先です",
  "invalid choice": "無効な選択です",
  "choice required": "先に選択を完了してください",
  "no moves": "移動回数が残っていません",
  "curse cards cannot be played in combat": "呪いカードは戦闘中に使えません",
  "curse-giving cards cannot be played in combat": "呪いを与えるカードは戦闘中に使えません",
};

function denialMessage(reason: string): string {
  return DENIALS[reason] ?? `操作できません（${reason}）`;
}

function MuteToggle() {
  const [muted, setMuted] = useState(() => sfx.muted);
  const [musicOn, setMusicOn] = useState(() => sfx.musicOn);
  return (
    <div className="rr-title-tools">
      <button
        type="button"
        className="rr-button rr-mute-btn"
        aria-label={musicOn ? "BGMをオフ" : "BGMをオン"}
        aria-pressed={musicOn}
        title={musicOn ? "BGM OFF" : "BGM ON"}
        onClick={() => {
          const next = !musicOn;
          setMusicOn(next);
          sfx.music(next);
          if (!sfx.muted) sfx.play("ui-click");
        }}
      >{musicOn ? "♪" : "♩"}</button>
      <button
        type="button"
        className="rr-button rr-mute-btn"
        aria-label={muted ? "ミュート解除" : "ミュート"}
        aria-pressed={muted}
        onClick={() => {
          const next = !muted;
          sfx.setMuted(next);
          setMuted(next);
        }}
      >{muted ? "🔇" : "🔊"}</button>
    </div>
  );
}

/** Diff previous StateView → play SFX. Engine untouched; App-only. */
function useViewSfx(view: StateView | null, curseOpen: boolean) {
  const prevView = useRef<StateView | null>(null);
  const prevCurse = useRef(false);
  const sawVictory = useRef(false);

  useEffect(() => {
    if (curseOpen && !prevCurse.current) sfx.play("modal-open");
    prevCurse.current = curseOpen;
  }, [curseOpen]);

  useEffect(() => {
    const prev = prevView.current;
    prevView.current = view;
    if (!view) return;

    if (view.state.phase === "finished" && !sawVictory.current) {
      sawVictory.current = true;
      sfx.play("magic");
    }
    if (view.state.phase !== "finished") sawVictory.current = false;

    if (!prev) return;

    const me = view.state.players[view.you];
    const prevMe = prev.state.players[prev.you];
    if (!me || !prevMe) return;

    const wasMyTurn = prev.state.phase === "playing" && prev.state.current === prev.you;
    const isMyTurn = view.state.phase === "playing" && view.state.current === view.you;

    // Personal: HP loss (any turn, including BOT dealing damage to you)
    if (me.hp < prevMe.hp) sfx.play("hit-take");

    // Personal: gold gain
    if (me.gold > prevMe.gold) sfx.play("coin");

    // Level-up / other modal choices
    const choice = view.yours.pendingChoice;
    const prevChoice = prev.yours.pendingChoice;
    if (choice && !prevChoice) {
      if (choice.t === "levelup") sfx.play("levelup");
      else sfx.play("modal-open");
    } else if (choice && prevChoice && choice.t === "levelup" && prevChoice.t !== "levelup") {
      sfx.play("levelup");
    }

    // Monster HP drop from my attack (my combat turn)
    const combat = view.state.combat;
    const prevCombat = prev.state.combat;
    if (combat && prevCombat && combat.monsterHp < prevCombat.monsterHp && wasMyTurn) {
      sfx.play("hit-deal");
    }

    // Card play / buy success — only attribute during own turn
    if (wasMyTurn || isMyTurn) {
      if (view.yours.hand.length < prev.yours.hand.length) {
        sfx.play("ui-confirm");
      } else if (me.gold < prevMe.gold && !combat) {
        sfx.play("ui-confirm");
      }
    }
  }, [view]);
}

function BoardCanvas({ view, reachable, onMove }: {
  view: StateView; reachable: Set<number>; onMove(node: number): void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [kbFocus, setKbFocus] = useState<number | null>(null);
  const [assetTick, setAssetTick] = useState(0);
  const reachableNodes = useMemo(() => [...reachable], [reachable]);
  const onAssetReady = useCallback(() => setAssetTick(t => t + 1), []);
  const opts = useMemo<BoardRenderOptions>(() => ({
    board: view.state.board, players: view.state.players, you: view.you,
    current: view.state.current, reachable, traps: view.state.traps, size, kbFocus,
    onAssetReady,
  }), [view, reachable, size, kbFocus, onAssetReady]);

  useEffect(() => {
    setKbFocus(current => current !== null && reachable.has(current) ? current : null);
  }, [reachable]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const box = canvas.getBoundingClientRect();
      setSize(old => old.w === box.width && old.h === box.height ? old : { w: box.width, h: box.height });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.w || !size.h) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBoard(ctx, opts);
  }, [opts, size, assetTick]);

  return <canvas ref={canvasRef} className="rr-board" tabIndex={0}
    aria-label="盤面。移動可能なとき、左右矢印キーで移動先を選び、Enterキーで移動します。クリックでも移動できます。"
    onKeyDown={event => {
      if (!reachableNodes.length) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const current = kbFocus === null ? (direction > 0 ? -1 : 0) : reachableNodes.indexOf(kbFocus);
        setKbFocus(reachableNodes[(current + direction + reachableNodes.length) % reachableNodes.length]!);
      } else if (event.key === "Enter" && kbFocus !== null && reachable.has(kbFocus)) {
        event.preventDefault();
        onMove(kbFocus);
      }
    }}
    onClick={event => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const box = canvas.getBoundingClientRect();
      const node = hitTestNode(opts, event.clientX - box.left, event.clientY - box.top);
      if (node !== null && reachable.has(node)) {
        sfx.play("ui-click");
        onMove(node);
      }
    }} />;
}

function TargetPicker({ players, you, classes, onPick, onCancel }: {
  players: StateView["state"]["players"]; you: number;
  classes: typeof content.classes; onPick(seat: number): void; onCancel(): void;
}) {
  const dialogRef = useModalFocus();
  const rivals = players.filter(player => player.seat !== you && player.hp > 0);
  return <div className="rr-modal-backdrop" role="presentation"><section ref={dialogRef}
    className="rr-modal rr-target-picker rr-panel" role="dialog" aria-modal="true" aria-labelledby="rr-target-title">
    <span className="rr-kicker">呪いの標的</span><h2 id="rr-target-title">ライバルを選んでください</h2>
    <div className="rr-target-list">{rivals.map(player => <button type="button" className="rr-chip rr-target-chip"
      style={{ borderColor: classes[player.cls].color }} key={player.seat}
      onClick={() => { sfx.play("ui-click"); onPick(player.seat); }}>
      <i style={{ background: classes[player.cls].color }} />{player.name}
    </button>)}</div>
    <button type="button" className="rr-button rr-target-cancel"
      onClick={() => { sfx.play("ui-click"); onCancel(); }}>キャンセル</button>
  </section></div>;
}

function WinnerDialog({ name }: { name: string }) {
  const dialogRef = useModalFocus();
  return <div className="rr-modal-backdrop"><section ref={dialogRef} className="rr-winner rr-panel"
    role="dialog" aria-modal="true" aria-labelledby="rr-winner-title">
    <span className="rr-winner-gem" role="img" aria-label="レリックジェム" />
    <span className="rr-crown-brick" aria-hidden="true" />
    <span className="rr-kicker">王冠ブリック</span>
    <h2 id="rr-winner-title">{name} の勝利！</h2>
    <p>もう一度遊ぶにはページを再読み込みしてください。</p>
    <button className="rr-button rr-button--red" onClick={() => { sfx.play("ui-click"); location.reload(); }}>REMATCH</button>
    <a className="rr-button" href="index.html#games">サイトへ戻る</a>
  </section></div>;
}

export function App() {
  const query = useMemo(() => new URLSearchParams(location.search), []);
  const initialRoom = cleanRoom(query.get("room") ?? "");
  const [screen, setScreen] = useState<Screen>(initialRoom.length === 5 ? "title" : "title");
  const [joining, setJoining] = useState(initialRoom.length === 5);
  const [roomInput, setRoomInput] = useState(initialRoom);
  const [room, setRoom] = useState("");
  const [name, setName] = useState(() => localStorage.getItem("rr_name") || "冒険者");
  const [lobby, setLobby] = useState<LobbyView | null>(null);
  const [view, setView] = useState<StateView | null>(null);
  const [you, setYou] = useState(0);
  const [isHost, setIsHost] = useState(false);
  const [toast, setToast] = useState("");
  const [curseHand, setCurseHand] = useState<number | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const wireRef = useRef<Wire | null>(null);
  const latestView = useRef<StateView | null>(null);
  const latestScreen = useRef<Screen>(screen);

  useEffect(() => { latestScreen.current = screen; }, [screen]);
  useEffect(() => { latestView.current = view; }, [view]);
  useEffect(() => () => sessionRef.current?.close(), []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useViewSfx(view, curseHand !== null);

  const send = useCallback((intent: Intent) => sessionRef.current?.sendIntent(intent), []);
  useEffect(() => {
    window.__rr = { getView: () => latestView.current, send, screen: () => latestScreen.current };
    return () => { delete window.__rr; };
  }, [send]);

  const rememberName = (value: string) => {
    setName(value);
    localStorage.setItem("rr_name", value);
  };
  const newWire = (): Wire => query.get("wire") === "bc" ? new BroadcastChannelWire() : new PeerJsWire();
  const showDenied = (reason: string) => {
    sfx.play("ui-error");
    setToast(denialMessage(reason));
  };
  const connectHost = async (solo: boolean) => {
    sfx.play("ui-click");
    const code = makeRoomCode(Math.random);
    const wire: Wire = solo ? new BroadcastChannelWire() : newWire();
    const host = new HostSession(wire, content, {
      name: name.trim() || "冒険者", cls: "knight", roundLimit: ROUND_LIMIT,
      seed: (Math.random() * 0xffffffff) >>> 0, botFill: true,
    });
    host.onLobby(setLobby);
    host.onState(next => { setView(next); setScreen("game"); });
    host.onDenied(msg => showDenied(msg.reason));
    try {
      await host.host(code);
      wireRef.current = wire; sessionRef.current = host;
      setRoom(code); setYou(0); setIsHost(true); setScreen("lobby");
      if (solo) host.startGame();
    } catch (error) {
      host.close();
      sfx.play("ui-error");
      setToast(error instanceof Error ? error.message : "部屋を作成できませんでした");
    }
  };
  const connectGuest = async () => {
    sfx.play("ui-click");
    const code = cleanRoom(roomInput);
    if (code.length !== 5) { sfx.play("ui-error"); setToast("5文字のルームコードを入力してください"); return; }
    const wire = newWire();
    try {
      const conn = await wire.join(code);
      const guest = new GuestSession(conn, name.trim() || "冒険者");
      guest.onSeat(setYou);
      guest.onLobby(next => { setLobby(next); setScreen("lobby"); });
      guest.onState(next => { setView(next); setYou(next.you); setScreen("game"); });
      guest.onDenied(msg => showDenied(msg.reason));
      guest.onToast(setToast);
      guest.onBye(reason => {
        setToast(reason);
        guest.close();
        if (sessionRef.current === guest) sessionRef.current = null;
        wireRef.current = null;
        setLobby(null); setView(null); setRoom(""); setIsHost(false); setScreen("title");
      });
      wireRef.current = wire; sessionRef.current = guest;
      setRoom(code); setIsHost(false);
    } catch (error) {
      wire.close();
      sfx.play("ui-error");
      setToast(error instanceof Error ? error.message : "部屋に参加できませんでした");
    }
  };

  const myTurn = !!view && view.state.phase === "playing" && view.state.current === view.you;
  const me = view?.state.players[view.you];
  const node = view?.state.board.nodes.find(candidate => candidate.id === me?.node);
  const reachable = useMemo(() => {
    if (!view || !myTurn || view.state.moves <= 0 || !me || view.state.combat || view.yours.pendingChoice) return new Set<number>();
    const edges = view.state.board.nodes.find(candidate => candidate.id === me.node)?.edges ?? [];
    return new Set(edges.filter(id => {
      const target = view.state.board.nodes.find(candidate => candidate.id === id);
      return target?.kind !== "portal" || me.relics.length >= 3;
    }));
  }, [view, myTurn, me]);
  const handEntries = (view?.yours.hand ?? []).map((id, index) => ({ card: content.cards[id], index }))
    .filter((entry): entry is { card: CardDef; index: number } => !!entry.card);
  const canPlay = (displayIndex: number) => {
    const card = handEntries[displayIndex]?.card;
    if (!card || !myTurn || !!view?.yours.pendingChoice || card.energy > (view?.state.energy ?? 0)) return false;
    if (view?.state.combat) {
      return !card.overworldOnly && card.kind !== "curse" && !card.effects.some(effect => effect.t === "curseGive");
    }
    return !card.combatOnly;
  };
  const playCard = (displayIndex: number) => {
    const entry = handEntries[displayIndex];
    if (!entry) return;
    if (!view?.state.combat && entry.card.effects.some(effect => effect.t === "curseGive")) {
      setCurseHand(entry.index);
      return;
    }
    send(view?.state.combat ? { k: "combatCard", hand: entry.index } : { k: "playCard", hand: entry.index });
  };

  if (screen === "title") return <main className="rr-title">
    <MuteToggle />
    <section className="rr-hero">
      <span className="rr-version">v1.0 BRICK WORLD</span>
      <h1><span>RELIC</span><span>ROAD</span></h1>
      <p>2〜4人で遊べるカード×ボードRPG。空いた席はBOTが参戦します。</p>
      <label className="rr-field">冒険者名<input value={name} maxLength={18} onChange={e => rememberName(e.target.value)} /></label>
      <div className="rr-title-actions">
        <button className="rr-button rr-button--red" type="button" onClick={() => void connectHost(true)}>SOLO</button>
        <button className="rr-button rr-button--blue" type="button" onClick={() => void connectHost(false)}>CREATE ROOM</button>
        <button className="rr-button" type="button" onClick={() => {
          sfx.play("ui-click");
          if (!joining) setJoining(true);
          else if (roomInput.length === 5) void connectGuest();
        }}>JOIN</button>
      </div>
      {joining && <form className="rr-join" onSubmit={e => { e.preventDefault(); void connectGuest(); }}>
        <input aria-label="ルームコード" autoFocus placeholder="ABCDE" value={roomInput}
          onChange={e => setRoomInput(cleanRoom(e.target.value))} maxLength={5} />
        <button className="rr-button rr-button--blue" disabled={roomInput.length !== 5}>参加</button>
      </form>}
      <div className="rr-settings"><span>PLAYERS 2–4 + BOT FILL</span><span>ROUND LIMIT {ROUND_LIMIT}</span></div>
    </section>{toast && <div className="rr-toast">{toast}</div>}
  </main>;

  if (screen === "lobby" && lobby) {
    const humanReady = lobby.seats.some(seat => seat.connected && !seat.bot && seat.ready);
    return <main className="rr-shell">
      <div className="rr-game-header"><MuteToggle /></div>
      <Lobby lobby={lobby} you={you} isHost={isHost} room={room}
        onCls={(cls: ClassId) => isHost ? (sessionRef.current as HostSession).cfg(cls) : (sessionRef.current as GuestSession).cfg(cls)}
        onReady={ready => isHost ? undefined : (sessionRef.current as GuestSession).cfg(undefined, ready)}
        onStart={() => (sessionRef.current as HostSession).startGame()} canStart={isHost && humanReady} />
      {toast && <div className="rr-toast">{toast}</div>}
    </main>;
  }

  if (!view || !me) return <main className="rr-shell"><p>接続中…</p></main>;
  const combat = view.state.combat;
  const ownCombat = !!combat && myTurn;
  const monster = combat ? content.monsters[combat.monsterId] : undefined;
  const stock = node?.kind === "shop" ? (view.state.shopStock[node.id] ?? []).map(id => content.cards[id]).filter(Boolean) : [];
  const winner = view.state.winner === null ? null : view.state.players[view.state.winner];
  return <main className="rr-game">
    <div className="rr-game-header"><MuteToggle /></div>
    <div className="rr-game-layout">
      <div className="rr-board-wrap"><BoardCanvas view={view} reachable={reachable} onMove={target => send({ k: "moveTo", node: target })} />
        {combat && !ownCombat && <div className="rr-combat-banner">{view.state.players[view.state.current]?.name} が戦闘中...</div>}
      </div>
      <div className="rr-sidebar"><PlayersPanel players={view.state.players} you={view.you} current={view.state.current} classes={content.classes} />
        <LogPanel log={view.state.log} /></div>
    </div>
    <div className="rr-bottom-stack">
      {ownCombat && monster && <CombatPanel combat={combat} monster={monster} player={me} />}
      {stock.length > 0 && <div className="rr-buybar rr-panel"><strong>ショップ</strong>{stock.map(card =>
        <button type="button" className="rr-chip" key={card.id} disabled={!myTurn || me.gold < card.price}
          onClick={() => { sfx.play("ui-click"); send({ k: "buy", card: card.id }); }}>{card.nameJa}・{card.price} G</button>)}</div>}
      {node?.kind === "camp" && !combat && <div className="rr-restbar"><button className="rr-button" type="button"
        disabled={!myTurn || !!view.yours.pendingChoice}
        onClick={() => { sfx.play("ui-click"); send({ k: "rest" }); }}>REST・休息する</button></div>}
      <HandBar hand={handEntries.map(entry => entry.card)} energy={view.state.energy} moves={view.state.moves}
        canPlay={canPlay} onPlay={playCard}
        onEndTurn={() => send({ k: "endTurn" })} myTurn={myTurn} inCombat={ownCombat}
        onCombatEnd={() => send({ k: "combatEnd" })} onFlee={() => send({ k: "flee" })} />
    </div>
    {view.yours.pendingChoice && <ChoiceModal choice={view.yours.pendingChoice}
      event={view.yours.pendingChoice.eventId ? content.events[view.yours.pendingChoice.eventId] : undefined}
      cards={content.cards} gold={me.gold} onChoose={idx => send({ k: "choose", idx })} />}
    {curseHand !== null && <TargetPicker players={view.state.players} you={view.you} classes={content.classes}
      onPick={targetSeat => { send({ k: "playCard", hand: curseHand, targetSeat }); setCurseHand(null); }}
      onCancel={() => setCurseHand(null)} />}
    {view.state.phase === "finished" && winner && <WinnerDialog name={winner.name} />}
    {toast && <div className="rr-toast">{toast}</div>}
  </main>;
}
