// Host-authoritative PeerJS room for THE HOLLOW WARD.
//
// The topology is deliberately a star: guests send poses and claims only to
// the host, while only the host may publish world state or finish a run.
// PeerJS is dynamically imported so solo play never downloads the networking
// chunk and remains unaffected by signalling outages.

import type { DataConnection, Peer } from "peerjs";
import {
  MAX_PLAYERS,
  NETWORK_LIMITS,
  PROTOCOL_VERSION,
  ROOM_PREFIX,
  ROOM_TIMERS,
  makeRoomCode,
  normalizePlayerName,
  normalizeRoomCode,
  validateMsg,
  type AuthoritativeState,
  type DownReason,
  type EndResult,
  type Msg,
  type PlayerInfo,
  type PlayerPose
} from "./protocol";

let peerModule: Promise<typeof import("peerjs")> | null = null;

function loadPeer(): Promise<typeof import("peerjs")> {
  peerModule ??= import("peerjs");
  return peerModule;
}

function createSessionId(): string {
  const words = new Uint32Array(3);
  try {
    crypto.getRandomValues(words);
  } catch {
    for (let index = 0; index < words.length; index += 1) {
      words[index] = Math.floor(Math.random() * 0xffffffff) >>> 0;
    }
  }
  return Array.from(words, (word) => word.toString(36).padStart(7, "0")).join("");
}

function validLocalPeerId(id: string): boolean {
  return id.length > 0 && id.length <= NETWORK_LIMITS.idLength &&
    /^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/.test(id);
}

interface Wire {
  send(message: Msg): void;
  onMessage(callback: (raw: unknown) => void): void;
  onClose(callback: () => void): void;
  close(): void;
}

class PeerWire implements Wire {
  private closed = false;

  constructor(private readonly connection: DataConnection) {}

  send(message: Msg): void {
    if (this.closed || !this.connection.open) return;
    try {
      this.connection.send(message);
    } catch {
      // The close/error event is the single source of lifecycle transitions.
    }
  }

  onMessage(callback: (raw: unknown) => void): void {
    this.connection.on("data", callback);
  }

  onClose(callback: () => void): void {
    let fired = false;
    const once = (): void => {
      if (fired) return;
      fired = true;
      this.closed = true;
      callback();
    };
    this.connection.on("close", once);
    this.connection.on("error", once);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.connection.close();
    } catch {
      // Already closed.
    }
  }
}

export type CloseReason =
  | "hostLost"
  | "rejected-version"
  | "rejected-in-game"
  | "rejected-full"
  | "invalid-code"
  | "room-not-found"
  | "broker"
  | "timeout"
  | "left";

export interface RoomCallbacks {
  onLobby?: (players: PlayerInfo[]) => void;
  onStart?: (seed: number, players: PlayerInfo[]) => void;
  onPose?: (from: string, pose: PlayerPose) => void;
  onState?: (state: AuthoritativeState) => void;
  onFileClaim?: (from: string, fileId: number) => void;
  onDown?: (from: string, reason: DownReason) => void;
  onEnd?: (result: EndResult) => void;
  onLeave?: (playerId: string) => void;
  onLatency?: (roundTripMs: number) => void;
  onError?: (message: string) => void;
  onClosed?: (reason: CloseReason) => void;
}

interface GuestRecord {
  wire: Wire;
  info: PlayerInfo;
  lastSeen: number;
  lastPoseSequence: number;
  windowStartedAt: number;
  messagesInWindow: number;
}

export class HorrorRoom {
  myId = "";
  myName = "";
  isHost = false;
  roomCode = "";
  sessionId = "";
  phase: "idle" | "lobby" | "game" | "ended" = "idle";
  players: PlayerInfo[] = [];

  private peer: Peer | null = null;
  private hostWire: Wire | null = null;
  private readonly guests = new Map<string, GuestRecord>();
  private readonly callbacks: RoomCallbacks;
  private readonly downPlayers = new Set<string>();
  private presenceTimer = 0;
  private pingSequence = 0;
  private lastPingAt = 0;
  private hostLastSeen = 0;
  private lastStateTick = -1;
  private lastLocalPoseSequence = -1;
  private destroyed = false;
  private readonly pendingPings = new Map<number, number>();

  private readonly onPageHide = (): void => {
    if (this.phase === "idle" || !this.myId) return;
    const message: Msg = { t: "leave", from: this.myId };
    if (this.isHost) this.broadcastToGuests(message);
    else this.hostWire?.send(message);
  };

  private readonly onVisibilityChange = (): void => {
    if (document.hidden || this.destroyed) return;
    // Background tabs can have timers suspended for longer than the heartbeat
    // timeout. Resume with a fresh grace window instead of declaring a false
    // disconnect before the first new ping/pong can complete.
    const now = performance.now();
    this.hostLastSeen = now;
    this.lastPingAt = 0;
    for (const guest of this.guests.values()) guest.lastSeen = now;
  };

  constructor(callbacks: RoomCallbacks = {}) {
    this.callbacks = callbacks;
  }

  async host(name: string): Promise<{ ok: true; code: string } | { ok: false; reason: CloseReason }> {
    if (this.phase !== "idle" || this.destroyed) return { ok: false, reason: "broker" };

    let PeerConstructor: typeof import("peerjs").Peer;
    try {
      ({ Peer: PeerConstructor } = await loadPeer());
    } catch (error) {
      this.callbacks.onError?.(`PeerJS load failed: ${String(error)}`);
      return { ok: false, reason: "broker" };
    }

    this.myName = normalizePlayerName(name);
    this.isHost = true;

    for (let attempt = 0; attempt < ROOM_TIMERS.hostIdRetries; attempt += 1) {
      const code = makeRoomCode();
      const peerId = ROOM_PREFIX + code;
      const result = await new Promise<
        { kind: "ok"; peer: Peer } | { kind: "taken" } | { kind: "broker" }
      >((resolve) => {
        let peer: Peer;
        try {
          peer = new PeerConstructor(peerId, { debug: 0 });
        } catch {
          resolve({ kind: "broker" });
          return;
        }
        let settled = false;
        const timer = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          peer.destroy();
          resolve({ kind: "broker" });
        }, ROOM_TIMERS.joinTimeoutMs);

        peer.on("open", () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          resolve({ kind: "ok", peer });
        });
        peer.on("error", (error: Error & { type?: string }) => {
          if (settled) {
            this.callbacks.onError?.(`PeerJS: ${error.type ?? error.message}`);
            return;
          }
          settled = true;
          window.clearTimeout(timer);
          peer.destroy();
          resolve({ kind: error.type === "unavailable-id" ? "taken" : "broker" });
        });
      });

      if (result.kind === "taken") continue;
      if (result.kind === "broker") return { ok: false, reason: "broker" };

      this.peer = result.peer;
      this.roomCode = code;
      this.myId = peerId;
      this.sessionId = createSessionId();
      this.phase = "lobby";
      this.players = [{ id: this.myId, name: this.myName, slot: 0, isHost: true }];
      this.attachHostPeerHandlers();
      this.startPresenceLoop();
      window.addEventListener("pagehide", this.onPageHide);
      document.addEventListener("visibilitychange", this.onVisibilityChange);
      this.callbacks.onLobby?.([...this.players]);
      return { ok: true, code };
    }

    return { ok: false, reason: "broker" };
  }

  private attachHostPeerHandlers(): void {
    this.peer?.on("connection", (connection: DataConnection) => this.acceptGuestConnection(connection));
    this.attachSignallingReconnect();
    this.peer?.on("close", () => {
      if (!this.destroyed) this.shutdown("broker");
    });
  }

  private acceptGuestConnection(connection: DataConnection): void {
    const wire = new PeerWire(connection);
    let joinedId: string | null = null;
    let preHelloMessages = 0;
    const helloTimer = window.setTimeout(() => wire.close(), ROOM_TIMERS.helloTimeoutMs);

    wire.onMessage((raw) => {
      const message = validateMsg(raw);
      if (!message) return;

      if (!joinedId) {
        preHelloMessages += 1;
        if (preHelloMessages > 4 || message.t !== "hello") {
          wire.close();
          return;
        }
        if (message.v !== PROTOCOL_VERSION || message.app !== __APP_VERSION__) {
          wire.send({ t: "reject", reason: "version", detail: `${PROTOCOL_VERSION}/${__APP_VERSION__}` });
          window.setTimeout(() => wire.close(), 200);
          return;
        }
        if (this.phase !== "lobby") {
          wire.send({ t: "reject", reason: "in-game" });
          window.setTimeout(() => wire.close(), 200);
          return;
        }
        if (this.players.length >= MAX_PLAYERS) {
          wire.send({ t: "reject", reason: "full" });
          window.setTimeout(() => wire.close(), 200);
          return;
        }
        if (!validLocalPeerId(connection.peer) || this.guests.has(connection.peer)) {
          wire.close();
          return;
        }

        const slot = this.nextOpenSlot();
        if (slot === null) {
          wire.send({ t: "reject", reason: "full" });
          window.setTimeout(() => wire.close(), 200);
          return;
        }

        window.clearTimeout(helloTimer);
        joinedId = connection.peer;
        const info: PlayerInfo = {
          id: joinedId,
          name: normalizePlayerName(message.name),
          slot,
          isHost: false
        };
        this.guests.set(joinedId, {
          wire,
          info,
          lastSeen: performance.now(),
          lastPoseSequence: -1,
          windowStartedAt: performance.now(),
          messagesInWindow: 0
        });
        this.rebuildPlayers();
        wire.send({
          t: "ack",
          v: PROTOCOL_VERSION,
          sessionId: this.sessionId,
          youId: joinedId,
          players: this.players
        });
        this.broadcastToGuests({ t: "lobby", players: this.players });
        this.callbacks.onLobby?.([...this.players]);
        return;
      }

      const guest = this.guests.get(joinedId);
      if (!guest || !this.allowGuestMessage(guest)) return;
      guest.lastSeen = performance.now();

      // A sender never gets to choose its identity. Any mismatch is a spoof.
      if ("from" in message && message.from !== joinedId) return;
      this.handleAsHost(message, guest);
    });

    wire.onClose(() => {
      window.clearTimeout(helloTimer);
      if (!joinedId) return;
      window.setTimeout(() => this.dropGuest(joinedId!), ROOM_TIMERS.closeGraceMs);
    });
  }

  private nextOpenSlot(): number | null {
    const used = new Set(this.players.map((player) => player.slot));
    for (let slot = 1; slot < MAX_PLAYERS; slot += 1) if (!used.has(slot)) return slot;
    return null;
  }

  private allowGuestMessage(guest: GuestRecord): boolean {
    const now = performance.now();
    if (now - guest.windowStartedAt >= 1_000) {
      guest.windowStartedAt = now;
      guest.messagesInWindow = 0;
    }
    guest.messagesInWindow += 1;
    return guest.messagesInWindow <= 120;
  }

  private handleAsHost(message: Msg, guest: GuestRecord): void {
    switch (message.t) {
      case "ping":
        guest.wire.send({ t: "pong", n: message.n });
        return;
      case "leave":
        this.dropGuest(guest.info.id);
        return;
      case "pose": {
        if (this.phase !== "game" || message.seq <= guest.lastPoseSequence) return;
        guest.lastPoseSequence = message.seq;
        const { t: _type, from, ...pose } = message;
        this.callbacks.onPose?.(from, pose);
        return;
      }
      case "fileClaim":
        if (this.phase === "game") this.callbacks.onFileClaim?.(message.from, message.fileId);
        return;
      case "down":
        if (this.phase !== "game" || this.downPlayers.has(message.from)) return;
        this.downPlayers.add(message.from);
        this.callbacks.onDown?.(message.from, message.reason);
        return;
      default:
        // start/state/end are host-only. ack/lobby/reject are never guest input.
        return;
    }
  }

  private rebuildPlayers(): void {
    const host = this.players.find((player) => player.isHost) ?? {
      id: this.myId,
      name: this.myName,
      slot: 0,
      isHost: true
    };
    this.players = [host, ...Array.from(this.guests.values(), (guest) => guest.info)]
      .sort((a, b) => a.slot - b.slot);
  }

  private dropGuest(id: string): void {
    const guest = this.guests.get(id);
    if (!guest) return;
    this.guests.delete(id);
    guest.wire.close();
    this.downPlayers.delete(id);
    this.rebuildPlayers();
    this.broadcastToGuests({ t: "lobby", players: this.players });
    this.callbacks.onLobby?.([...this.players]);
    this.callbacks.onLeave?.(id);
  }

  async join(codeInput: string, name: string): Promise<{ ok: true } | { ok: false; reason: CloseReason }> {
    if (this.phase !== "idle" || this.destroyed) return { ok: false, reason: "broker" };
    const code = normalizeRoomCode(codeInput);
    if (!code) return { ok: false, reason: "invalid-code" };

    let PeerConstructor: typeof import("peerjs").Peer;
    try {
      ({ Peer: PeerConstructor } = await loadPeer());
    } catch (error) {
      this.callbacks.onError?.(`PeerJS load failed: ${String(error)}`);
      return { ok: false, reason: "broker" };
    }

    this.myName = normalizePlayerName(name);
    this.isHost = false;
    const targetId = ROOM_PREFIX + code;

    return new Promise((resolve) => {
      let peer: Peer;
      try {
        peer = new PeerConstructor({ debug: 0 });
      } catch {
        resolve({ ok: false, reason: "broker" });
        return;
      }

      let settled = false;
      let wire: Wire | null = null;
      const timer = window.setTimeout(() => fail("timeout"), ROOM_TIMERS.joinTimeoutMs);

      const fail = (reason: CloseReason): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        wire?.close();
        peer.destroy();
        resolve({ ok: false, reason });
      };

      peer.on("error", (error: Error & { type?: string }) => {
        if (!settled) {
          fail(error.type === "peer-unavailable" ? "room-not-found" : "broker");
          return;
        }
        this.callbacks.onError?.(`PeerJS: ${error.type ?? error.message}`);
      });

      peer.on("open", () => {
        const connection = peer.connect(targetId, {
          label: `horror-v${PROTOCOL_VERSION}`,
          reliable: true,
          serialization: "json"
        });
        if (!connection) {
          fail("broker");
          return;
        }
        wire = new PeerWire(connection);

        connection.on("open", () => {
          wire?.send({ t: "hello", v: PROTOCOL_VERSION, name: this.myName, app: __APP_VERSION__ });
        });
        wire.onMessage((raw) => {
          const message = validateMsg(raw);
          if (!message) return;
          this.hostLastSeen = performance.now();

          if (message.t === "ack") {
            if (settled) return;
            if (message.v !== PROTOCOL_VERSION || !message.players.some((player) => player.id === message.youId)) {
              fail("rejected-version");
              return;
            }
            const host = message.players.find((player) => player.isHost);
            if (!host || host.id !== targetId) {
              fail("room-not-found");
              return;
            }

            settled = true;
            window.clearTimeout(timer);
            this.peer = peer;
            this.hostWire = wire;
            this.myId = message.youId;
            this.roomCode = code;
            this.sessionId = message.sessionId;
            this.phase = "lobby";
            this.players = message.players;
            this.attachSignallingReconnect();
            this.startPresenceLoop();
            window.addEventListener("pagehide", this.onPageHide);
            document.addEventListener("visibilitychange", this.onVisibilityChange);
            this.callbacks.onLobby?.([...this.players]);
            resolve({ ok: true });
            return;
          }

          if (message.t === "reject" && !settled) {
            const reason: CloseReason = message.reason === "version"
              ? "rejected-version"
              : message.reason === "full"
                ? "rejected-full"
                : "rejected-in-game";
            fail(reason);
            return;
          }

          if (settled) this.handleAsGuest(message, targetId);
        });
        wire.onClose(() => {
          if (!settled) fail("room-not-found");
          else this.shutdown("hostLost");
        });
      });
    });
  }

  private handleAsGuest(message: Msg, hostId: string): void {
    switch (message.t) {
      case "lobby": {
        const host = message.players.find((player) => player.isHost);
        if (!host || host.id !== hostId || !message.players.some((player) => player.id === this.myId)) return;
        const previousIds = new Set(this.players.map((player) => player.id));
        this.players = message.players;
        for (const id of previousIds) {
          if (id !== this.myId && !this.players.some((player) => player.id === id)) this.callbacks.onLeave?.(id);
        }
        this.callbacks.onLobby?.([...this.players]);
        return;
      }
      case "start": {
        if (this.phase !== "lobby") return;
        const host = message.players.find((player) => player.isHost);
        if (!host || host.id !== hostId || !message.players.some((player) => player.id === this.myId)) return;
        this.phase = "game";
        this.players = message.players;
        this.downPlayers.clear();
        this.lastStateTick = -1;
        this.lastLocalPoseSequence = -1;
        this.callbacks.onStart?.(message.seed, [...message.players]);
        return;
      }
      case "state": {
        if (this.phase !== "game" || message.tick <= this.lastStateTick) return;
        const roster = new Set(this.players.map((player) => player.id));
        if (message.players.some((player) => !roster.has(player.id))) return;
        if (message.warden.targetId !== null && !roster.has(message.warden.targetId)) return;
        this.lastStateTick = message.tick;
        const { t: _type, ...state } = message;
        this.callbacks.onState?.(state);
        return;
      }
      case "end": {
        if (this.phase !== "game") return;
        if (message.escapedIds.some((id) => !this.players.some((player) => player.id === id))) return;
        if (message.downPlayerId !== null && !this.players.some((player) => player.id === message.downPlayerId)) return;
        this.phase = "ended";
        const { t: _type, ...result } = message;
        this.callbacks.onEnd?.(result);
        return;
      }
      case "leave":
        if (message.from === hostId) this.shutdown("hostLost");
        return;
      case "pong": {
        const sentAt = this.pendingPings.get(message.n);
        if (sentAt === undefined) return;
        this.pendingPings.delete(message.n);
        this.callbacks.onLatency?.(Math.max(0, performance.now() - sentAt));
        return;
      }
      default:
        // pose/fileClaim/down are guest-to-host only; host cannot echo them.
        return;
    }
  }

  start(seed: number = Math.floor(Math.random() * 0xffffffff) >>> 0): boolean {
    if (!this.isHost || this.phase !== "lobby" || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return false;
    const message = validateMsg({ t: "start", seed, players: this.players });
    if (!message || message.t !== "start") return false;
    this.phase = "game";
    this.downPlayers.clear();
    this.lastStateTick = -1;
    this.lastLocalPoseSequence = -1;
    this.broadcastToGuests(message);
    this.callbacks.onStart?.(seed, [...this.players]);
    return true;
  }

  sendPose(pose: PlayerPose): boolean {
    if (this.phase !== "game" || !this.myId) return false;
    const message = validateMsg({ t: "pose", from: this.myId, ...pose });
    if (!message || message.t !== "pose" || message.seq <= this.lastLocalPoseSequence) return false;
    this.lastLocalPoseSequence = message.seq;
    const { t: _type, from, ...validatedPose } = message;
    if (this.isHost) this.callbacks.onPose?.(from, validatedPose);
    else this.hostWire?.send(message);
    return true;
  }

  sendState(state: AuthoritativeState): boolean {
    if (!this.isHost || this.phase !== "game") return false;
    const message = validateMsg({ t: "state", ...state });
    if (!message || message.t !== "state" || message.tick <= this.lastStateTick) return false;
    const roster = new Set(this.players.map((player) => player.id));
    if (message.players.some((player) => !roster.has(player.id))) return false;
    if (message.warden.targetId !== null && !roster.has(message.warden.targetId)) return false;
    this.lastStateTick = message.tick;
    this.broadcastToGuests(message);
    return true;
  }

  claimFile(fileId: number): boolean {
    if (this.phase !== "game" || !this.myId) return false;
    const message = validateMsg({ t: "fileClaim", from: this.myId, fileId });
    if (!message || message.t !== "fileClaim") return false;
    if (this.isHost) this.callbacks.onFileClaim?.(this.myId, message.fileId);
    else this.hostWire?.send(message);
    return true;
  }

  reportDown(reason: DownReason): boolean {
    if (this.phase !== "game" || !this.myId || this.downPlayers.has(this.myId)) return false;
    const message = validateMsg({ t: "down", from: this.myId, reason });
    if (!message || message.t !== "down") return false;
    this.downPlayers.add(this.myId);
    if (this.isHost) this.callbacks.onDown?.(this.myId, reason);
    else this.hostWire?.send(message);
    return true;
  }

  end(result: EndResult): boolean {
    if (!this.isHost || this.phase !== "game") return false;
    const message = validateMsg({ t: "end", ...result });
    if (!message || message.t !== "end") return false;
    if (message.escapedIds.some((id) => !this.players.some((player) => player.id === id))) return false;
    if (message.downPlayerId !== null && !this.players.some((player) => player.id === message.downPlayerId)) return false;
    this.phase = "ended";
    this.broadcastToGuests(message);
    const { t: _type, ...validatedResult } = message;
    this.callbacks.onEnd?.(validatedResult);
    return true;
  }

  leave(): void {
    if (this.destroyed) return;
    this.onPageHide();
    this.shutdown("left");
  }

  private broadcastToGuests(message: Msg): void {
    for (const guest of this.guests.values()) guest.wire.send(message);
  }

  private attachSignallingReconnect(): void {
    this.peer?.on("disconnected", () => {
      let delay = 1_000;
      const retry = (): void => {
        if (this.destroyed || !this.peer || !this.peer.disconnected) return;
        try {
          this.peer.reconnect();
        } catch {
          // A later retry may succeed after a transient signalling outage.
        }
        delay = Math.min(delay * 2, 8_000);
        window.setTimeout(retry, delay);
      };
      window.setTimeout(retry, delay);
    });
  }

  private startPresenceLoop(): void {
    this.hostLastSeen = performance.now();
    this.lastPingAt = 0;
    window.clearInterval(this.presenceTimer);
    this.presenceTimer = window.setInterval(() => {
      const now = performance.now();
      if (this.isHost) {
        for (const [id, guest] of this.guests) {
          if (now - guest.lastSeen > ROOM_TIMERS.heartbeatTimeoutMs) this.dropGuest(id);
        }
        return;
      }

      if (now - this.lastPingAt >= ROOM_TIMERS.pingIntervalMs) {
        this.lastPingAt = now;
        this.pingSequence = (this.pingSequence + 1) >>> 0;
        this.pendingPings.set(this.pingSequence, now);
        while (this.pendingPings.size > 8) {
          const oldest = this.pendingPings.keys().next().value as number | undefined;
          if (oldest === undefined) break;
          this.pendingPings.delete(oldest);
        }
        this.hostWire?.send({ t: "ping", n: this.pingSequence });
      }

      if ((this.phase === "lobby" || this.phase === "game" || this.phase === "ended") &&
          now - this.hostLastSeen > ROOM_TIMERS.heartbeatTimeoutMs) {
        this.shutdown("hostLost");
      }
    }, ROOM_TIMERS.presencePollMs);
  }

  private shutdown(reason: CloseReason): void {
    if (this.destroyed) return;
    this.destroyed = true;
    window.clearInterval(this.presenceTimer);
    window.removeEventListener("pagehide", this.onPageHide);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.pendingPings.clear();
    this.hostWire?.close();
    this.hostWire = null;
    for (const guest of this.guests.values()) guest.wire.close();
    this.guests.clear();
    try {
      this.peer?.destroy();
    } catch {
      // Already destroyed by PeerJS.
    }
    this.peer = null;
    this.phase = "idle";
    this.callbacks.onClosed?.(reason);
  }
}
