import {
  VORTEX_ROOM_PREFIX,
  type Wire,
  type WireConn,
} from "./protocol";

const ROOM_PATTERN = /^[A-Z0-9]{6}$/;

type JoinFrame = { readonly vcJoin: true; readonly clientId: string };
type AcceptFrame = { readonly vcAccept: true; readonly clientId: string };
type MessageFrame = {
  readonly vcMessage: true;
  readonly clientId: string;
  readonly direction: "client-host" | "host-client";
  readonly payload: unknown;
};
type CloseFrame = {
  readonly vcClose: true;
  readonly clientId: string;
  readonly direction: "client-host" | "host-client";
};
type HeartbeatFrame = {
  readonly vcHeartbeat: true;
  readonly clientId: string;
  readonly direction: "client-host" | "host-client";
};

const HEARTBEAT_INTERVAL_MS = 750;
const HEARTBEAT_TIMEOUT_MS = 3_000;

export function normalizeRoomCode(value: string): string {
  const trimmed = value.trim();
  const withoutPrefix = trimmed.toLowerCase().startsWith(VORTEX_ROOM_PREFIX)
    ? trimmed.slice(VORTEX_ROOM_PREFIX.length)
    : trimmed;
  const normalized = withoutPrefix.toUpperCase();
  if (!ROOM_PATTERN.test(normalized)) {
    throw new Error("Room code must be six letters or digits");
  }
  return normalized;
}

export function peerRoomId(roomCode: string): string {
  return VORTEX_ROOM_PREFIX + normalizeRoomCode(roomCode);
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
    private readonly outbound: MessageFrame["direction"],
  ) {}

  send(payload: unknown): void {
    if (this.closed) return;
    this.channel.postMessage({
      vcMessage: true,
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
      vcClose: true,
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
      `${VORTEX_ROOM_PREFIX}broadcast-${normalizeRoomCode(roomCode)}`,
    );
    this.channel = channel;
    const listener = (event: MessageEvent<unknown>): void => {
      const frame = event.data;
      if (!isRecord(frame) || typeof frame.clientId !== "string") return;
      if (frame.vcJoin === true) {
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
          vcAccept: true,
          clientId: frame.clientId,
        } satisfies AcceptFrame);
        return;
      }
      if (
        frame.vcMessage === true &&
        frame.direction === "client-host"
      ) {
        this.lastSeenAt.set(frame.clientId, Date.now());
        this.connections.get(frame.clientId)?.deliver(frame.payload);
        return;
      }
      if (
        frame.vcHeartbeat === true &&
        frame.direction === "client-host"
      ) {
        this.lastSeenAt.set(frame.clientId, Date.now());
        return;
      }
      if (frame.vcClose === true && frame.direction === "client-host") {
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
          vcHeartbeat: true,
          clientId,
          direction: "host-client",
        } satisfies HeartbeatFrame);
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  async join(roomCode: string): Promise<WireConn> {
    this.dispose();
    const channel = new BroadcastChannel(
      `${VORTEX_ROOM_PREFIX}broadcast-${normalizeRoomCode(roomCode)}`,
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
        reject(new Error("BroadcastChannel room join timed out"));
      }, 4_000);
      const listener = (event: MessageEvent<unknown>): void => {
        const frame = event.data;
        if (!isRecord(frame) || frame.clientId !== clientId) return;
        if (frame.vcAccept === true) {
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
              vcHeartbeat: true,
              clientId,
              direction: "client-host",
            } satisfies HeartbeatFrame);
          }, HEARTBEAT_INTERVAL_MS);
          resolve(connection);
          return;
        }
        if (
          frame.vcMessage === true &&
          frame.direction === "host-client"
        ) {
          this.lastSeenAt.set(clientId, Date.now());
          this.connections.get(clientId)?.deliver(frame.payload);
          return;
        }
        if (
          frame.vcHeartbeat === true &&
          frame.direction === "host-client"
        ) {
          this.lastSeenAt.set(clientId, Date.now());
          return;
        }
        if (frame.vcClose === true && frame.direction === "host-client") {
          this.connections.get(clientId)?.remoteClosed();
          this.connections.delete(clientId);
          this.lastSeenAt.delete(clientId);
        }
      };
      this.listener = listener;
      channel.addEventListener("message", listener);
      channel.postMessage({
        vcJoin: true,
        clientId,
      } satisfies JoinFrame);
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
