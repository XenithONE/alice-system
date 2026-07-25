import type { Wire, WireConn } from "./protocol";

type JoinFrame = { scJoin: true; clientId: string };
type AcceptFrame = { scAccept: true; clientId: string };
type MsgFrame = {
  scMsg: true;
  clientId: string;
  dir: "c2h" | "h2c";
  payload: unknown;
};
type CloseFrame = { scClose: true; clientId: string; dir: "c2h" | "h2c" };

function makeClientId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

class ChannelConn implements WireConn {
  private messageCb: (msg: unknown) => void = () => undefined;
  private closeCb: () => void = () => undefined;
  private closed = false;

  constructor(
    readonly id: string,
    private readonly channel: BroadcastChannel,
    private readonly outbound: MsgFrame["dir"],
  ) {}

  send(payload: unknown): void {
    if (this.closed) return;
    this.channel.postMessage({
      scMsg: true,
      clientId: this.id,
      dir: this.outbound,
      payload,
    } satisfies MsgFrame);
  }

  onMessage(cb: (msg: unknown) => void): void {
    this.messageCb = cb;
  }

  onClose(cb: () => void): void {
    this.closeCb = cb;
  }

  close(): void {
    if (this.closed) return;
    this.channel.postMessage({
      scClose: true,
      clientId: this.id,
      dir: this.outbound,
    } satisfies CloseFrame);
    this.finishClose();
  }

  deliver(payload: unknown): void {
    if (!this.closed) this.messageCb(payload);
  }

  remoteClosed(): void {
    this.finishClose();
  }

  channelClosed(): void {
    this.finishClose();
  }

  private finishClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeCb();
  }
}

class ChannelWire implements Wire {
  private channel: BroadcastChannel | null = null;
  private listener: ((event: MessageEvent<unknown>) => void) | null = null;
  private readonly conns = new Map<string, ChannelConn>();

  async host(roomId: string, onConn: (conn: WireConn) => void): Promise<void> {
    this.dispose();
    const channel = new BroadcastChannel(`sc-${roomId}`);
    this.channel = channel;
    const listener = (event: MessageEvent<unknown>): void => {
      const frame = event.data;
      if (!isRecord(frame) || typeof frame.clientId !== "string") return;
      if (frame.scJoin === true) {
        let conn = this.conns.get(frame.clientId);
        if (!conn) {
          conn = new ChannelConn(frame.clientId, channel, "h2c");
          this.conns.set(frame.clientId, conn);
          onConn(conn);
        }
        channel.postMessage({ scAccept: true, clientId: frame.clientId } satisfies AcceptFrame);
        return;
      }
      if (frame.scMsg === true && frame.dir === "c2h") {
        this.conns.get(frame.clientId)?.deliver(frame.payload);
        return;
      }
      if (frame.scClose === true && frame.dir === "c2h") {
        this.conns.get(frame.clientId)?.remoteClosed();
        this.conns.delete(frame.clientId);
      }
    };
    this.listener = listener;
    channel.addEventListener("message", listener);
  }

  async join(roomId: string): Promise<WireConn> {
    this.dispose();
    const channel = new BroadcastChannel(`sc-${roomId}`);
    this.channel = channel;
    const id = makeClientId();
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
        reject(new Error("BroadcastChannel join timed out"));
      }, 4_000);
      const listener = (event: MessageEvent<unknown>): void => {
        const frame = event.data;
        if (!isRecord(frame) || frame.clientId !== id) return;
        if (frame.scAccept === true) {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          const conn = new ChannelConn(id, channel, "c2h");
          this.conns.set(id, conn);
          resolve(conn);
          return;
        }
        if (frame.scMsg === true && frame.dir === "h2c") {
          this.conns.get(id)?.deliver(frame.payload);
          return;
        }
        if (frame.scClose === true && frame.dir === "h2c") {
          this.conns.get(id)?.remoteClosed();
          this.conns.delete(id);
        }
      };
      this.listener = listener;
      channel.addEventListener("message", listener);
      channel.postMessage({ scJoin: true, clientId: id } satisfies JoinFrame);
    });
  }

  dispose(): void {
    if (this.channel && this.listener) {
      this.channel.removeEventListener("message", this.listener);
    }
    for (const conn of this.conns.values()) conn.channelClosed();
    this.conns.clear();
    this.channel?.close();
    this.channel = null;
    this.listener = null;
  }
}

export function createChannelWire(): Wire {
  return new ChannelWire();
}
