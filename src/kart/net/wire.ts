/**
 * Same-machine transport plus room-code handling.
 *
 * The BroadcastChannel wire is not a toy: it is how two tabs on one machine
 * play together, and it is the transport the wire gate drives, so the handshake
 * and the snapshot path are exercised on every run without a signalling server.
 */

import { NITRO_ROOM_PREFIX, type Wire, type WireConn } from "./protocol";

const ROOM_PATTERN = /^[A-Z0-9]{6}$/;
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/*
 * Liveness, sized for a browser rather than for a network.
 *
 * The first version pinged every 750 ms and hung up after 3 s of silence. A
 * background tab has its timers throttled to about one a second, so the moment
 * a player looked at anything else — the room code, a chat window — their
 * heartbeat fell behind, the host dropped them, and the guest was told the
 * host had left. Nothing was wrong with the connection.
 *
 * A dropped peer is worse than a slow one, and a tab that really closes sends
 * an explicit close frame anyway, so this only has to catch a crash.
 */
const HEARTBEAT_INTERVAL_MS = 2_000;
const HEARTBEAT_TIMEOUT_MS = 30_000;

type JoinFrame = { readonly nkJoin: true; readonly clientId: string };
type AcceptFrame = { readonly nkAccept: true; readonly clientId: string };
type Direction = "client-host" | "host-client";
type MessageFrame = {
  readonly nkMessage: true;
  readonly clientId: string;
  readonly direction: Direction;
  readonly payload: unknown;
};
type CloseFrame = {
  readonly nkClose: true;
  readonly clientId: string;
  readonly direction: Direction;
};
type HeartbeatFrame = {
  readonly nkHeartbeat: true;
  readonly clientId: string;
  readonly direction: Direction;
};

export function normalizeRoomCode(value: string): string {
  const trimmed = value.trim();
  const withoutPrefix = trimmed.toLowerCase().startsWith(NITRO_ROOM_PREFIX)
    ? trimmed.slice(NITRO_ROOM_PREFIX.length)
    : trimmed;
  const normalized = withoutPrefix.toUpperCase();
  if (!ROOM_PATTERN.test(normalized)) {
    throw new Error("ルームコードは英数字6文字です");
  }
  return normalized;
}

export function peerRoomId(roomCode: string): string {
  return NITRO_ROOM_PREFIX + normalizeRoomCode(roomCode);
}

/** Ambiguous glyphs (O/0, I/1) are left out so a code can be read aloud. */
export function makeRoomCode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += ROOM_ALPHABET[Math.floor(random() * ROOM_ALPHABET.length)];
  }
  return code;
}

function makeClientId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

class ChannelConnection implements WireConn {
  private messageCallback: (payload: unknown) => void = () => undefined;
  private closeCallback: () => void = () => undefined;
  private closed = false;

  constructor(
    readonly id: string,
    private readonly channel: BroadcastChannel,
    private readonly outbound: Direction,
  ) {}

  send(payload: unknown): void {
    if (this.closed) return;
    this.channel.postMessage({
      nkMessage: true,
      clientId: this.id,
      direction: this.outbound,
      payload,
    } satisfies MessageFrame);
  }

  onMessage(callback: (payload: unknown) => void): void {
    this.messageCallback = callback;
  }

  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  close(): void {
    if (this.closed) return;
    this.channel.postMessage({
      nkClose: true,
      clientId: this.id,
      direction: this.outbound,
    } satisfies CloseFrame);
    this.finishClose();
  }

  deliver(payload: unknown): void {
    if (!this.closed) this.messageCallback(payload);
  }

  remoteClosed(): void {
    this.finishClose();
  }

  private finishClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeCallback();
  }
}

class BroadcastChannelWire implements Wire {
  private channel: BroadcastChannel | null = null;
  private listener: ((event: MessageEvent<unknown>) => void) | null = null;
  private readonly connections = new Map<string, ChannelConnection>();
  private readonly lastSeenAt = new Map<string, number>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  async host(
    roomCode: string,
    onConnection: (connection: WireConn) => void,
  ): Promise<void> {
    this.dispose();
    const channel = new BroadcastChannel(
      `${NITRO_ROOM_PREFIX}bc-${normalizeRoomCode(roomCode)}`,
    );
    this.channel = channel;
    const listener = (event: MessageEvent<unknown>): void => {
      const frame = event.data;
      if (!isRecord(frame) || typeof frame.clientId !== "string") return;
      if (frame.nkJoin === true) {
        let connection = this.connections.get(frame.clientId);
        if (!connection) {
          connection = new ChannelConnection(
            frame.clientId,
            channel,
            "host-client",
          );
          this.connections.set(frame.clientId, connection);
          onConnection(connection);
        }
        this.lastSeenAt.set(frame.clientId, Date.now());
        channel.postMessage({
          nkAccept: true,
          clientId: frame.clientId,
        } satisfies AcceptFrame);
        return;
      }
      if (frame.nkMessage === true && frame.direction === "client-host") {
        this.lastSeenAt.set(frame.clientId, Date.now());
        this.connections.get(frame.clientId)?.deliver(frame.payload);
        return;
      }
      if (frame.nkHeartbeat === true && frame.direction === "client-host") {
        this.lastSeenAt.set(frame.clientId, Date.now());
        return;
      }
      if (frame.nkClose === true && frame.direction === "client-host") {
        this.connections.get(frame.clientId)?.remoteClosed();
        this.connections.delete(frame.clientId);
        this.lastSeenAt.delete(frame.clientId);
      }
    };
    this.listener = listener;
    channel.addEventListener("message", listener);
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const [clientId, connection] of this.connections) {
        const lastSeen = this.lastSeenAt.get(clientId) ?? now;
        if (now - lastSeen > HEARTBEAT_TIMEOUT_MS) {
          connection.remoteClosed();
          this.connections.delete(clientId);
          this.lastSeenAt.delete(clientId);
          continue;
        }
        channel.postMessage({
          nkHeartbeat: true,
          clientId,
          direction: "host-client",
        } satisfies HeartbeatFrame);
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  async join(roomCode: string): Promise<WireConn> {
    this.dispose();
    const channel = new BroadcastChannel(
      `${NITRO_ROOM_PREFIX}bc-${normalizeRoomCode(roomCode)}`,
    );
    this.channel = channel;
    const clientId = makeClientId();
    return new Promise<WireConn>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        channel.removeEventListener("message", listener);
        channel.close();
        if (this.channel === channel) {
          this.channel = null;
          this.listener = null;
        }
        reject(new Error("ルームが見つかりませんでした"));
      }, 4_000);
      const listener = (event: MessageEvent<unknown>): void => {
        const frame = event.data;
        if (!isRecord(frame) || frame.clientId !== clientId) return;
        if (frame.nkAccept === true) {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          const connection = new ChannelConnection(
            clientId,
            channel,
            "client-host",
          );
          this.connections.set(clientId, connection);
          this.lastSeenAt.set(clientId, Date.now());
          this.heartbeatTimer = setInterval(() => {
            const now = Date.now();
            const lastSeen = this.lastSeenAt.get(clientId) ?? now;
            if (now - lastSeen > HEARTBEAT_TIMEOUT_MS) {
              connection.remoteClosed();
              this.connections.delete(clientId);
              this.lastSeenAt.delete(clientId);
              this.disposeChannel();
              return;
            }
            channel.postMessage({
              nkHeartbeat: true,
              clientId,
              direction: "client-host",
            } satisfies HeartbeatFrame);
          }, HEARTBEAT_INTERVAL_MS);
          resolve(connection);
          return;
        }
        if (frame.nkMessage === true && frame.direction === "host-client") {
          this.lastSeenAt.set(clientId, Date.now());
          this.connections.get(clientId)?.deliver(frame.payload);
          return;
        }
        if (frame.nkHeartbeat === true && frame.direction === "host-client") {
          this.lastSeenAt.set(clientId, Date.now());
          return;
        }
        if (frame.nkClose === true && frame.direction === "host-client") {
          this.connections.get(clientId)?.remoteClosed();
          this.connections.delete(clientId);
          this.lastSeenAt.delete(clientId);
        }
      };
      this.listener = listener;
      channel.addEventListener("message", listener);
      channel.postMessage({ nkJoin: true, clientId } satisfies JoinFrame);
    });
  }

  dispose(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.channel && this.listener) {
      this.channel.removeEventListener("message", this.listener);
    }
    for (const connection of this.connections.values()) connection.close();
    this.connections.clear();
    this.lastSeenAt.clear();
    this.channel?.close();
    this.channel = null;
    this.listener = null;
  }

  private disposeChannel(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.channel && this.listener) {
      this.channel.removeEventListener("message", this.listener);
    }
    this.channel?.close();
    this.channel = null;
    this.listener = null;
  }
}

export function createBroadcastChannelWire(): Wire {
  if (typeof BroadcastChannel === "undefined") {
    throw new Error("BroadcastChannel is not available in this environment");
  }
  return new BroadcastChannelWire();
}
