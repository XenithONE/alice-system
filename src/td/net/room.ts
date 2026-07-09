// P2P room layer for SIGNAL SIEGE. Star topology: guests hold exactly one
// connection (to the host); the host relays guest<->guest. peerjs is loaded via
// dynamic import so solo play never downloads it and a broker outage can never
// break solo. All inbound data passes validateMsg(); relay rules make loops
// structurally impossible (single relayer, sender-echo excluded, from-spoof drop).

import type { DataConnection, Peer } from "peerjs";
import {
  PROTO_V, ROOM_PREFIX, MAX_PLAYERS, TIMERS,
  makeRoomCode, validateMsg,
  type Msg, type PlayerInfo
} from "./protocol";

// ---------------------------------------------------------------- transport

export interface Wire {
  send: (m: Msg) => void;
  onMessage: (cb: (raw: unknown) => void) => void;
  onClose: (cb: () => void) => void;
  close: () => void;
}

class PeerWire implements Wire {
  constructor(private readonly conn: DataConnection) {}
  send(m: Msg): void {
    try {
      this.conn.send(m);
    } catch {
      /* connection raced shut — close handler deals with it */
    }
  }
  onMessage(cb: (raw: unknown) => void): void {
    this.conn.on("data", cb);
  }
  onClose(cb: () => void): void {
    this.conn.on("close", cb);
    this.conn.on("error", cb);
  }
  close(): void {
    try {
      this.conn.close();
    } catch {
      /* already closed */
    }
  }
}

/** In-memory Wire pair for tests — async delivery mimics the network. */
export function createLoopbackPair(): [Wire, Wire] {
  const make = (): { wire: Wire; deliver: (raw: unknown) => void; closeCb: () => void } => {
    let msgCb: (raw: unknown) => void = () => undefined;
    let closeCb: () => void = () => undefined;
    const box = {
      wire: {
        send: (_m: Msg) => undefined,
        onMessage: (cb: (raw: unknown) => void) => { msgCb = cb; },
        onClose: (cb: () => void) => { closeCb = cb; },
        close: () => undefined
      } as Wire,
      deliver: (raw: unknown) => msgCb(raw),
      closeCb: () => closeCb()
    };
    return box;
  };
  const a = make();
  const b = make();
  a.wire.send = (m) => { window.setTimeout(() => b.deliver(JSON.parse(JSON.stringify(m))), 0); };
  b.wire.send = (m) => { window.setTimeout(() => a.deliver(JSON.parse(JSON.stringify(m))), 0); };
  a.wire.close = () => { window.setTimeout(() => b.closeCb(), 0); };
  b.wire.close = () => { window.setTimeout(() => a.closeCb(), 0); };
  return [a.wire, b.wire];
}

let peerModule: Promise<typeof import("peerjs")> | null = null;
function loadPeer(): Promise<typeof import("peerjs")> {
  peerModule ??= import("peerjs");
  return peerModule;
}

// ---------------------------------------------------------------- room client

export type CloseReason =
  | "hostLost" | "rejected-version" | "rejected-in-game" | "rejected-full"
  | "broker" | "timeout" | "room-not-found" | "left";

export interface RoomCallbacks {
  onLobby?: (players: PlayerInfo[]) => void;
  onStart?: (seed: number, players: PlayerInfo[]) => void;
  onCreeps?: (msg: Extract<Msg, { t: "creeps" }>) => void;
  onOpponentStatus?: (msg: Extract<Msg, { t: "status" }>) => void;
  onOpponentBoard?: (msg: Extract<Msg, { t: "board" }>) => void;
  onWaveTick?: (wave: number) => void;
  onOver?: (from: string, reason: "dead" | "disconnect" | "leave") => void;
  onWin?: (winner: string) => void;
  onRematchStart?: (seed: number) => void;
  onRematchVotes?: (votes: string[]) => void;
  onClosed?: (reason: CloseReason) => void;
}

interface GuestRecord {
  wire: Wire;
  info: PlayerInfo;
  lastSeen: number;
  eliminated: boolean; // board state (this match)
  gone: boolean; // wire state (left/disconnected — excluded from rematch)
}

export class RoomClient {
  myId = "";
  myName = "";
  isHost = false;
  roomCode = "";
  phase: "idle" | "lobby" | "game" = "idle";
  players: PlayerInfo[] = [];

  private peer: Peer | null = null;
  private hostWire: Wire | null = null; // guest side
  private readonly guests = new Map<string, GuestRecord>(); // host side
  private readonly cb: RoomCallbacks;
  private alive = new Set<string>();
  private rematchVotes = new Set<string>();
  private presenceTimer = 0;
  private hostLastSeen = 0;
  private destroyed = false;
  private readonly onPageHide = (): void => {
    this.broadcastFromHostOrSend({ t: "leave", from: this.myId });
  };

  constructor(callbacks: RoomCallbacks) {
    this.cb = callbacks;
  }

  // ------------------------------------------------ host

  async host(name: string): Promise<{ ok: true; code: string } | { ok: false; reason: CloseReason }> {
    const { Peer } = await loadPeer();
    this.myName = name;
    this.isHost = true;
    for (let attempt = 0; attempt < TIMERS.hostIdRetries; attempt += 1) {
      const code = makeRoomCode();
      const result = await new Promise<"ok" | "taken" | "broker">((resolve) => {
        const peer = new Peer(ROOM_PREFIX + code, { debug: 0 });
        const timeout = window.setTimeout(() => { peer.destroy(); resolve("broker"); }, TIMERS.joinTimeoutMs);
        let opened = false;
        peer.on("open", () => {
          opened = true;
          window.clearTimeout(timeout);
          this.peer = peer;
          resolve("ok");
        });
        peer.on("error", (err: Error & { type?: string }) => {
          // Post-open peer errors (broker blip, one failed negotiation) must NOT
          // destroy the room — live DataConnections keep working and the
          // 'disconnected' handler owns broker reconnection.
          if (opened) return;
          window.clearTimeout(timeout);
          peer.destroy();
          resolve(err.type === "unavailable-id" ? "taken" : "broker");
        });
      });
      if (result === "ok") {
        this.roomCode = code;
        this.myId = ROOM_PREFIX + code;
        this.phase = "lobby";
        this.players = [{ id: this.myId, name, isHost: true }];
        this.attachHostHandlers();
        this.startPresenceLoop();
        window.addEventListener("pagehide", this.onPageHide);
        this.cb.onLobby?.(this.players);
        return { ok: true, code };
      }
      if (result === "broker") return { ok: false, reason: "broker" };
      // "taken" → retry with a fresh code
    }
    return { ok: false, reason: "broker" };
  }

  private attachHostHandlers(): void {
    this.peer?.on("connection", (conn: DataConnection) => {
      const wire = new PeerWire(conn);
      let joinedId: string | null = null;
      wire.onMessage((raw) => {
        const msg = validateMsg(raw);
        if (!msg) return;
        if (msg.t === "hello") {
          if (msg.v !== PROTO_V) {
            wire.send({ t: "reject", reason: "version", detail: String(PROTO_V) });
            window.setTimeout(() => wire.close(), 300);
            return;
          }
          if (this.phase !== "lobby") {
            wire.send({ t: "reject", reason: "in-game" });
            window.setTimeout(() => wire.close(), 300);
            return;
          }
          if (this.players.length >= MAX_PLAYERS) {
            wire.send({ t: "reject", reason: "full" });
            window.setTimeout(() => wire.close(), 300);
            return;
          }
          joinedId = conn.peer;
          const info: PlayerInfo = { id: conn.peer, name: msg.name, isHost: false };
          this.guests.set(conn.peer, { wire, info, lastSeen: performance.now(), eliminated: false, gone: false });
          this.players = [this.players[0], ...[...this.guests.values()].map((g) => g.info)];
          wire.send({ t: "helloAck", v: PROTO_V, youId: conn.peer, players: this.players });
          this.broadcastToGuests({ t: "lobby", players: this.players }, null);
          this.cb.onLobby?.(this.players);
          return;
        }
        if (!joinedId) return; // pre-hello traffic: drop
        const rec = this.guests.get(joinedId);
        if (rec) rec.lastSeen = performance.now();
        // spoof guard: from must match the connection's peer id
        if ("from" in msg && msg.from !== joinedId) return;
        this.handleAsHost(msg, joinedId);
      });
      wire.onClose(() => {
        if (!joinedId) return;
        window.setTimeout(() => this.hostDropGuest(joinedId!, "disconnect"), TIMERS.hardCloseGraceMs);
      });
    });
    this.peer?.on("disconnected", () => {
      // Broker lost, NOT peers lost — existing DataConnections keep working.
      // Reconnect quietly so new joins/rematches can still reach us.
      let delay = 2000;
      const retry = (): void => {
        if (this.destroyed || !this.peer || !this.peer.disconnected) return;
        try { this.peer.reconnect(); } catch { /* give up silently */ }
        delay = Math.min(delay * 2, 8000);
        window.setTimeout(retry, delay);
      };
      window.setTimeout(retry, delay);
    });
  }

  private handleAsHost(msg: Msg, fromId: string): void {
    switch (msg.t) {
      case "ping": {
        this.guests.get(fromId)?.wire.send({ t: "pong" });
        return;
      }
      case "leave": {
        this.hostDropGuest(fromId, "leave");
        return;
      }
      case "rematch": {
        this.rematchVotes.add(fromId);
        this.checkRematch();
        return;
      }
      case "creeps": {
        // stop relaying sends aimed at eliminated players (target-side drop remains the backstop)
        const targetRec = this.guests.get(msg.target);
        if (targetRec?.eliminated) return;
        this.deliverLocal(msg);
        this.relay(msg, fromId);
        return;
      }
      case "over": {
        this.markEliminated(fromId, msg.reason);
        return;
      }
      case "status":
      case "board": {
        this.deliverLocal(msg);
        this.relay(msg, fromId);
        return;
      }
      default:
        return; // guests may not send host-only message types
    }
  }

  private relay(msg: Msg, originId: string): void {
    for (const [id, rec] of this.guests) {
      if (id === originId || rec.eliminated) continue;
      rec.wire.send(msg);
    }
  }

  private broadcastToGuests(msg: Msg, exceptId: string | null): void {
    for (const [id, rec] of this.guests) {
      if (id === exceptId) continue;
      rec.wire.send(msg);
    }
  }

  private hostDropGuest(id: string, reason: "disconnect" | "leave"): void {
    const rec = this.guests.get(id);
    if (!rec) return;
    if (this.phase === "lobby") {
      this.guests.delete(id);
      this.players = [this.players[0], ...[...this.guests.values()].map((g) => g.info)];
      this.broadcastToGuests({ t: "lobby", players: this.players }, null);
      this.cb.onLobby?.(this.players);
      return;
    }
    rec.gone = true;
    this.rematchVotes.delete(id);
    if (!rec.eliminated) this.markEliminated(id, reason);
    this.checkRematch(); // remaining voters may now satisfy the (shrunken) threshold
  }

  private markEliminated(id: string, reason: "dead" | "disconnect" | "leave"): void {
    const rec = this.guests.get(id);
    if (rec) {
      if (rec.eliminated) return;
      rec.eliminated = true;
    }
    if (!this.alive.has(id)) return;
    this.alive.delete(id);
    const overMsg: Msg = { t: "over", from: id, reason };
    this.deliverLocal(overMsg);
    this.broadcastToGuests(overMsg, null);
    if (this.alive.size === 1) {
      const winner = [...this.alive][0];
      const winMsg: Msg = { t: "win", winner };
      this.deliverLocal(winMsg);
      this.broadcastToGuests(winMsg, null);
    }
  }

  /** Host reports its own defeat. */
  reportSelfOver(): void {
    if (this.isHost) this.markEliminated(this.myId, "dead");
    else this.sendToHost({ t: "over", from: this.myId, reason: "dead" });
  }

  voteRematch(): void {
    if (this.isHost) {
      this.rematchVotes.add(this.myId);
      this.checkRematch();
    } else {
      this.sendToHost({ t: "rematch", from: this.myId });
    }
  }

  private checkRematch(): void {
    // Threshold = host + guests whose wire is still up; leavers can never vote.
    const need = 1 + [...this.guests.values()].filter((g) => !g.gone).length;
    const votes = [...this.rematchVotes];
    this.cb.onRematchVotes?.(votes);
    this.broadcastToGuests({ t: "rematchVotes", votes }, null);
    if (votes.length > 0 && votes.length >= need) {
      // Prune departed guests so the rematch roster/alive set has no ghosts.
      for (const [id, rec] of this.guests) if (rec.gone) this.guests.delete(id);
      this.players = [this.players[0], ...[...this.guests.values()].map((g) => g.info)];
      this.broadcastToGuests({ t: "lobby", players: this.players }, null);
      const seed = (Math.random() * 0xffffffff) >>> 0;
      this.rematchVotes.clear();
      this.beginMatch(seed);
      this.broadcastToGuests({ t: "rematchStart", seed }, null);
      this.cb.onRematchStart?.(seed);
    }
  }

  startGame(): void {
    if (!this.isHost || this.phase !== "lobby") return;
    const seed = (Math.random() * 0xffffffff) >>> 0;
    this.beginMatch(seed);
    this.broadcastToGuests({ t: "start", seed, players: this.players }, null);
    this.cb.onStart?.(seed, this.players);
  }

  private beginMatch(seed: number): void {
    void seed;
    this.phase = "game";
    this.alive = new Set(this.players.map((p) => p.id));
    for (const rec of this.guests.values()) rec.eliminated = false;
  }

  // ------------------------------------------------ guest

  async join(code: string, name: string): Promise<{ ok: true } | { ok: false; reason: CloseReason }> {
    const { Peer } = await loadPeer();
    this.myName = name;
    this.isHost = false;
    const target = ROOM_PREFIX + code.trim().toUpperCase();
    return new Promise((resolve) => {
      const peer = new Peer({ debug: 0 });
      let settled = false;
      const fail = (reason: CloseReason): void => {
        if (settled) return;
        settled = true;
        peer.destroy();
        resolve({ ok: false, reason });
      };
      const timeout = window.setTimeout(() => fail("timeout"), TIMERS.joinTimeoutMs);
      peer.on("error", (err: Error & { type?: string }) => {
        if (err.type === "peer-unavailable") fail("room-not-found");
        else if (!settled) fail("broker");
      });
      peer.on("open", () => {
        const conn = peer.connect(target, { reliable: true, serialization: "json" });
        const wire = new PeerWire(conn);
        conn.on("open", () => {
          wire.send({ t: "hello", v: PROTO_V, name, app: __APP_VERSION__ });
        });
        wire.onMessage((raw) => {
          const msg = validateMsg(raw);
          if (!msg) return;
          this.hostLastSeen = performance.now();
          if (msg.t === "helloAck") {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeout);
            this.peer = peer;
            this.hostWire = wire;
            this.myId = msg.youId;
            this.roomCode = code.trim().toUpperCase();
            this.phase = "lobby";
            this.players = msg.players;
            this.startPresenceLoop();
            window.addEventListener("pagehide", this.onPageHide);
            this.cb.onLobby?.(msg.players);
            resolve({ ok: true });
            return;
          }
          if (msg.t === "reject") {
            window.clearTimeout(timeout);
            fail(msg.reason === "version" ? "rejected-version" : msg.reason === "full" ? "rejected-full" : "rejected-in-game");
            return;
          }
          this.handleAsGuest(msg);
        });
        wire.onClose(() => {
          if (!settled) fail("room-not-found");
          else this.shutdown("hostLost");
        });
      });
    });
  }

  private handleAsGuest(msg: Msg): void {
    switch (msg.t) {
      case "lobby":
        this.players = msg.players;
        this.cb.onLobby?.(msg.players);
        return;
      case "start":
        this.phase = "game";
        this.players = msg.players;
        this.alive = new Set(msg.players.map((p) => p.id));
        this.cb.onStart?.(msg.seed, msg.players);
        return;
      case "creeps":
        if (msg.target === this.myId) this.cb.onCreeps?.(msg);
        return;
      case "status":
        if (msg.from !== this.myId) this.cb.onOpponentStatus?.(msg);
        return;
      case "board":
        if (msg.from !== this.myId) this.cb.onOpponentBoard?.(msg);
        return;
      case "waveTick":
        this.cb.onWaveTick?.(msg.wave);
        return;
      case "over":
        this.alive.delete(msg.from);
        this.cb.onOver?.(msg.from, msg.reason);
        return;
      case "win":
        this.cb.onWin?.(msg.winner);
        return;
      case "rematchVotes":
        this.cb.onRematchVotes?.(msg.votes);
        return;
      case "rematchStart":
        this.phase = "game";
        this.alive = new Set(this.players.map((p) => p.id));
        this.cb.onRematchStart?.(msg.seed);
        return;
      case "leave":
        if (msg.from === this.players.find((p) => p.isHost)?.id) this.shutdown("hostLost");
        return;
      case "pong":
        return;
      default:
        return;
    }
  }

  // ------------------------------------------------ shared

  /** Local delivery of a message on the HOST (host has no wire to itself). */
  private deliverLocal(msg: Msg): void {
    switch (msg.t) {
      case "creeps":
        if (msg.target === this.myId) this.cb.onCreeps?.(msg);
        return;
      case "status":
        if (msg.from !== this.myId) this.cb.onOpponentStatus?.(msg);
        return;
      case "board":
        if (msg.from !== this.myId) this.cb.onOpponentBoard?.(msg);
        return;
      case "over":
        this.cb.onOver?.(msg.from, msg.reason);
        return;
      case "win":
        this.cb.onWin?.(msg.winner);
        return;
      default:
        return;
    }
  }

  /** Outbound from the local player: host broadcasts, guest sends to host. */
  broadcastFromHostOrSend(msg: Msg): void {
    if (this.isHost) this.broadcastToGuests(msg, null);
    else this.sendToHost(msg);
  }

  private sendToHost(msg: Msg): void {
    this.hostWire?.send(msg);
  }

  /** Host's own board defeat / creeps / status flow through the same entry point. */
  sendGameMsg(msg: Msg): void {
    if (this.isHost) {
      if (msg.t === "over") {
        this.markEliminated(this.myId, msg.reason);
        return;
      }
      if (msg.t === "creeps") {
        const targetRec = this.guests.get(msg.target);
        if (targetRec?.eliminated) return;
      }
      this.broadcastToGuests(msg, null);
    } else {
      this.sendToHost(msg);
    }
  }

  private startPresenceLoop(): void {
    this.hostLastSeen = performance.now();
    this.presenceTimer = window.setInterval(() => {
      const now = performance.now();
      if (this.isHost) {
        if (this.phase !== "game") return;
        for (const [id, rec] of this.guests) {
          if (!rec.eliminated && now - rec.lastSeen > TIMERS.heartbeatTimeoutMs) {
            this.hostDropGuest(id, "disconnect");
          }
        }
      } else {
        // Keepalive: without this, a host whose board died (tick() early-returns,
        // so no periodic sends) reads as silence and we'd false-kick on hostLost.
        // The ping also gives the lobby real liveness in both directions.
        this.sendToHost({ t: "ping" });
        if ((this.phase === "game" || this.phase === "lobby") && now - this.hostLastSeen > TIMERS.heartbeatTimeoutMs) {
          this.shutdown("hostLost");
        }
      }
    }, TIMERS.presencePollMs);
  }

  private shutdown(reason: CloseReason): void {
    if (this.destroyed) return;
    this.destroyed = true;
    window.clearInterval(this.presenceTimer);
    window.removeEventListener("pagehide", this.onPageHide);
    try { this.peer?.destroy(); } catch { /* already down */ }
    this.peer = null;
    this.hostWire = null;
    this.guests.clear();
    this.phase = "idle";
    this.cb.onClosed?.(reason);
  }

  leave(): void {
    this.broadcastFromHostOrSend({ t: "leave", from: this.myId });
    this.shutdown("left");
  }

  /** Test seam: attach a pre-built wire as a guest connection (loopback tests). */
  _testAttachGuestWire(wire: Wire, guestId: string): void {
    let joined = false;
    wire.onMessage((raw) => {
      const msg = validateMsg(raw);
      if (!msg) return;
      if (msg.t === "hello") {
        if (this.players.length >= MAX_PLAYERS || this.phase !== "lobby") {
          wire.send({ t: "reject", reason: this.phase !== "lobby" ? "in-game" : "full" });
          return;
        }
        joined = true;
        this.guests.set(guestId, { wire, info: { id: guestId, name: msg.name, isHost: false }, lastSeen: performance.now(), eliminated: false, gone: false });
        this.players = [this.players[0], ...[...this.guests.values()].map((g) => g.info)];
        wire.send({ t: "helloAck", v: PROTO_V, youId: guestId, players: this.players });
        this.cb.onLobby?.(this.players);
        return;
      }
      if (!joined) return;
      const rec = this.guests.get(guestId);
      if (rec) rec.lastSeen = performance.now();
      if ("from" in msg && msg.from !== guestId) return;
      this.handleAsHost(msg, guestId);
    });
  }

  /** Test seam: initialize as host without any Peer (loopback tests). */
  _testInitHost(name: string): void {
    this.isHost = true;
    this.myId = "host";
    this.myName = name;
    this.roomCode = "TEST1";
    this.phase = "lobby";
    this.players = [{ id: "host", name, isHost: true }];
    this.startPresenceLoop();
  }

  /** Test seam: initialize as guest over a pre-built wire (loopback tests). */
  _testInitGuest(name: string, wire: Wire): void {
    this.isHost = false;
    this.myName = name;
    this.hostWire = wire;
    wire.onMessage((raw) => {
      const msg = validateMsg(raw);
      if (!msg) return;
      this.hostLastSeen = performance.now();
      if (msg.t === "helloAck") {
        this.myId = msg.youId;
        this.phase = "lobby";
        this.players = msg.players;
        this.startPresenceLoop();
        this.cb.onLobby?.(msg.players);
        return;
      }
      if (msg.t === "reject") return;
      this.handleAsGuest(msg);
    });
    wire.send({ t: "hello", v: PROTO_V, name, app: "test" });
  }
}
