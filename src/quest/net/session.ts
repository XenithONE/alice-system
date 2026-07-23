import { chooseIntent } from "../engine/bot";
import { applyIntent, createGame } from "../engine/engine";
import { mulberry32 } from "../engine/rng";
import type { ClassId, Content, GameState, Intent, PlayerState, Rng } from "../engine/types";
import {
  PROTO_VERSION,
  type C2H,
  type H2C,
  type LobbySeat,
  type LobbyView,
  type RivalView,
  type StateView,
  type Wire,
  type WireConn,
} from "./protocol";

export interface HostSessionOptions {
  name: string;
  cls: ClassId;
  roundLimit: number;
  seed: number;
  botFill: boolean;
}

type GuestRecord = { conn: WireConn; seat: number | null };
type Callback<T> = (value: T) => void;

function isC2H(value: unknown): value is C2H {
  if (typeof value !== "object" || value === null || !("t" in value) || typeof value.t !== "string") return false;
  const msg = value as Record<string, unknown>;
  switch (msg.t) {
    case "hello":
      return typeof msg.proto === "number" && typeof msg.name === "string";
    case "cfg":
      return (msg.cls === undefined || typeof msg.cls === "string") &&
        (msg.ready === undefined || typeof msg.ready === "boolean");
    case "intent": {
      const intent = msg.intent;
      return typeof msg.seq === "number" && Number.isFinite(msg.seq) &&
        typeof intent === "object" && intent !== null &&
        "k" in intent && typeof intent.k === "string";
    }
    case "ping":
      return typeof msg.at === "number" && Number.isFinite(msg.at);
    default:
      return false;
  }
}

function rival(player: PlayerState): RivalView {
  const { deck, hand, discard, exhaust: _exhaust, pendingChoice: _pendingChoice, ...visible } = player;
  return { ...visible, deckN: deck.length, handN: hand.length, discardN: discard.length };
}

function stateView(state: GameState, you: number): StateView {
  const owner = state.players[you]!;
  const { players: _players, ...publicState } = state;
  return {
    you,
    state: { ...publicState, players: state.players.map(rival) },
    yours: {
      deck: [...owner.deck].sort((a, b) => a.localeCompare(b)),
      hand: [...owner.hand],
      discard: [...owner.discard],
      exhaust: [...owner.exhaust],
      pendingChoice: owner.pendingChoice
        ? { ...owner.pendingChoice, options: [...owner.pendingChoice.options] }
        : null,
    },
  };
}

export class HostSession {
  private readonly guests = new Map<string, GuestRecord>();
  private readonly lobby: LobbyView;
  private state: GameState | null = null;
  private rng: Rng;
  private stateSeq = 0;
  private botLoopRunning = false;
  private stateCb: Callback<StateView> = () => undefined;
  private lobbyCb: Callback<LobbyView> = () => undefined;
  private deniedCb: Callback<Extract<H2C, { t: "denied" }>> = () => undefined;

  constructor(
    private readonly wire: Wire,
    private readonly content: Content,
    private readonly opts: HostSessionOptions,
  ) {
    this.rng = mulberry32(opts.seed);
    this.lobby = {
      hostSeat: 0,
      roundLimit: opts.roundLimit,
      seats: Array.from({ length: 4 }, (_, seat): LobbySeat => ({
        seat,
        name: seat === 0 ? opts.name : `BOT ${seat + 1}`,
        // bots rotate classes so a filled table is varied, not four knights
        cls: seat === 0 ? opts.cls : (["knight", "rogue", "mage", "cleric"] as const)[seat % 4]!,
        ready: seat === 0,
        bot: seat !== 0 && opts.botFill,
        connected: seat === 0,
      })),
    };
  }

  async host(room: string): Promise<void> {
    await this.wire.host(room, (conn) => this.attach(conn));
  }

  onState(cb: Callback<StateView>): void {
    this.stateCb = cb;
  }

  onLobby(cb: Callback<LobbyView>): void {
    this.lobbyCb = cb;
    cb(this.copyLobby());
  }

  onDenied(cb: Callback<Extract<H2C, { t: "denied" }>>): void {
    this.deniedCb = cb;
  }

  sendIntent(intent: Intent): void {
    this.handleIntent(0, 0, intent);
  }

  cfg(cls: ClassId): void {
    if (this.state) return;
    this.lobby.seats[0]!.cls = cls;
    this.broadcastLobby();
  }

  startGame(): void {
    if (this.state) return;
    if (!this.opts.botFill && this.lobby.seats.some((seat) => !seat.connected)) return;
    const seats = this.lobby.seats.map((seat) => ({
      name: seat.name,
      cls: seat.cls,
      bot: seat.bot || !seat.connected,
    }));
    this.state = createGame(this.content, this.opts.seed, seats);
    this.state.roundLimit = this.opts.roundLimit;
    for (const player of this.state.players) {
      const lobbySeat = this.lobby.seats[player.seat]!;
      player.bot = lobbySeat.bot || !lobbySeat.connected;
      player.connected = lobbySeat.connected;
    }
    this.broadcastState();
    void this.advanceBots();
  }

  close(): void {
    this.wire.close();
  }

  private attach(conn: WireConn): void {
    const record: GuestRecord = { conn, seat: null };
    this.guests.set(conn.id, record);
    conn.onMessage((raw) => {
      try {
        if (isC2H(raw)) this.handleMessage(record, raw);
      } catch {
        // Untrusted malformed messages must never escape the connection boundary.
      }
    });
    conn.onClose(() => this.disconnect(record));
  }

  private handleMessage(guest: GuestRecord, msg: C2H): void {
    if (msg.t === "hello") {
      if (guest.seat !== null) return;
      if (msg.proto !== PROTO_VERSION) {
        guest.conn.send({ t: "bye", reason: "プロトコルのバージョンが違います" } satisfies H2C);
        guest.conn.close();
        return;
      }
      if (this.state) {
        guest.conn.send({ t: "bye", reason: "ゲームは開始済みです" } satisfies H2C);
        guest.conn.close();
        return;
      }
      const seat = this.lobby.seats.find((candidate) => candidate.seat > 0 && !candidate.connected);
      if (!seat) {
        guest.conn.send({ t: "bye", reason: "部屋が満員です" } satisfies H2C);
        guest.conn.close();
        return;
      }
      guest.seat = seat.seat;
      seat.name = msg.name.trim().slice(0, 40) || `Player ${seat.seat + 1}`;
      seat.bot = false;
      seat.connected = true;
      seat.ready = false;
      guest.conn.send({ t: "welcome", seat: seat.seat, proto: PROTO_VERSION } satisfies H2C);
      this.broadcastLobby();
      return;
    }
    if (msg.t === "ping") {
      guest.conn.send({ t: "pong", at: msg.at } satisfies H2C);
      return;
    }
    if (guest.seat === null) return;
    if (msg.t === "cfg" && !this.state) {
      const seat = this.lobby.seats[guest.seat]!;
      if (msg.cls !== undefined && (["knight", "rogue", "mage", "cleric"] as string[]).includes(msg.cls)) {
        seat.cls = msg.cls as ClassId;
      }
      if (typeof msg.ready === "boolean") seat.ready = msg.ready;
      this.broadcastLobby();
      return;
    }
    if (msg.t === "intent") this.handleIntent(guest.seat, msg.seq, msg.intent, guest.conn);
  }

  private handleIntent(seat: number, seq: number, intent: Intent, conn?: WireConn): void {
    if (!this.state || this.state.phase !== "playing") {
      const denied = { t: "denied", seq, reason: "ゲーム中ではありません" } satisfies H2C;
      if (conn) conn.send(denied);
      else this.deniedCb(denied);
      return;
    }
    let result;
    try {
      result = applyIntent(this.content, this.state, seat, intent, this.rng);
    } catch {
      const denied = { t: "denied", seq, reason: "不正な操作です" } satisfies H2C;
      if (conn) conn.send(denied);
      else this.deniedCb(denied);
      return;
    }
    if (!result.ok) {
      const denied = { t: "denied", seq, reason: result.error ?? "許可されていない操作です" } satisfies H2C;
      if (conn) conn.send(denied);
      else this.deniedCb(denied);
      return;
    }
    this.broadcastState();
    void this.advanceBots();
  }

  private async advanceBots(): Promise<void> {
    if (this.botLoopRunning) return;
    this.botLoopRunning = true;
    try {
      let trackedTurn = this.turnKey();
      let intentsThisTurn = 0;
      while (this.state?.phase === "playing" && this.state.players[this.state.current]?.bot) {
        const currentTurn = this.turnKey();
        if (currentTurn !== trackedTurn) {
          trackedTurn = currentTurn;
          intentsThisTurn = 0;
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 350));
        if (!this.state || this.state.phase !== "playing") break;
        const seat = this.state.current;
        const intent = intentsThisTurn >= 200
          ? { k: "endTurn" } satisfies Intent
          : chooseIntent(this.content, this.state, seat, this.rng);
        intentsThisTurn += 1;
        const result = applyIntent(this.content, this.state, seat, intent, this.rng);
        if (!result.ok) {
          this.broadcastToast(`BOT ${seat + 1} の操作が拒否されました: ${result.error ?? ""}`);
          break;
        }
        this.broadcastState();
      }
    } finally {
      this.botLoopRunning = false;
    }
  }

  private turnKey(): string {
    return this.state ? `${this.state.round}:${this.state.current}` : "";
  }

  private broadcastState(): void {
    if (!this.state) return;
    const seq = ++this.stateSeq;
    this.stateCb(stateView(this.state, 0));
    for (const guest of this.guests.values()) {
      if (guest.seat !== null) {
        guest.conn.send({ t: "state", seq, view: stateView(this.state, guest.seat) } satisfies H2C);
      }
    }
  }

  private disconnect(guest: GuestRecord): void {
    this.guests.delete(guest.conn.id);
    if (guest.seat === null) return;
    const seat = this.lobby.seats[guest.seat]!;
    seat.connected = false;
    seat.ready = false;
    if (!this.state) {
      seat.name = `BOT ${seat.seat + 1}`;
      seat.bot = this.opts.botFill;
      this.broadcastLobby();
      return;
    }
    seat.bot = true;
    const player = this.state.players[seat.seat]!;
    player.bot = true;
    player.connected = false;
    this.broadcastToast(`${player.name} が切断したためBOTが引き継ぎます`);
    this.broadcastState();
    void this.advanceBots();
  }

  private broadcastLobby(): void {
    const lobby = this.copyLobby();
    this.lobbyCb(lobby);
    for (const guest of this.guests.values()) {
      if (guest.seat !== null) guest.conn.send({ t: "lobby", lobby } satisfies H2C);
    }
  }

  private copyLobby(): LobbyView {
    return { ...this.lobby, seats: this.lobby.seats.map((seat) => ({ ...seat })) };
  }

  private broadcastToast(msgJa: string): void {
    for (const guest of this.guests.values()) {
      if (guest.seat !== null) guest.conn.send({ t: "toast", msgJa } satisfies H2C);
    }
  }
}

export class GuestSession {
  private seq = 0;
  private seat: number | null = null;
  private seatCb: Callback<number> = () => undefined;
  private lobbyCb: Callback<LobbyView> = () => undefined;
  private stateCb: Callback<StateView> = () => undefined;
  private deniedCb: Callback<Extract<H2C, { t: "denied" }>> = () => undefined;
  private toastCb: Callback<string> = () => undefined;
  private byeCb: Callback<string> = () => undefined;

  constructor(private readonly conn: WireConn, name: string) {
    conn.onMessage((raw) => this.receive(raw));
    conn.send({ t: "hello", proto: PROTO_VERSION, name } satisfies C2H);
  }

  onLobby(cb: Callback<LobbyView>): void { this.lobbyCb = cb; }
  onState(cb: Callback<StateView>): void { this.stateCb = cb; }
  onSeat(cb: Callback<number>): void {
    this.seatCb = cb;
    if (this.seat !== null) cb(this.seat);
  }
  onDenied(cb: Callback<Extract<H2C, { t: "denied" }>>): void { this.deniedCb = cb; }
  onToast(cb: Callback<string>): void { this.toastCb = cb; }
  onBye(cb: Callback<string>): void { this.byeCb = cb; }

  cfg(cls?: ClassId, ready?: boolean): void {
    this.conn.send({ t: "cfg", cls, ready } satisfies C2H);
  }

  sendIntent(intent: Intent): number {
    const seq = ++this.seq;
    this.conn.send({ t: "intent", seq, intent } satisfies C2H);
    return seq;
  }

  close(): void {
    this.conn.close();
  }

  private receive(raw: unknown): void {
    if (typeof raw !== "object" || raw === null || !("t" in raw)) return;
    const msg = raw as H2C;
    switch (msg.t) {
      case "welcome":
        this.seat = msg.seat;
        this.seatCb(msg.seat);
        break;
      case "lobby": this.lobbyCb(msg.lobby); break;
      case "state": this.stateCb(msg.view); break;
      case "denied": this.deniedCb(msg); break;
      case "toast": this.toastCb(msg.msgJa); break;
      case "bye": this.byeCb(msg.reason); break;
      default: break;
    }
  }
}
