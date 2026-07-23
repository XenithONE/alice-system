import type { Wire, WireConn } from "./protocol";

type JoinFrame = { rrJoin: true; clientId: string };
type AcceptFrame = { rrAccept: true; clientId: string };
type MsgFrame = {
  rrMsg: true;
  clientId: string;
  dir: "c2h" | "h2c";
  payload: unknown;
};
type CloseFrame = { rrClose: true; clientId: string; dir: "c2h" | "h2c" };

function clientId(): string {
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
    if (!this.closed) {
      this.channel.postMessage({ rrMsg: true, clientId: this.id, dir: this.outbound, payload } satisfies MsgFrame);
    }
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
      rrClose: true,
      clientId: this.id,
      dir: this.outbound,
    } satisfies CloseFrame);
    this.closed = true;
    this.closeCb();
  }

  deliver(payload: unknown): void {
    if (!this.closed) this.messageCb(payload);
  }

  channelClosed(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeCb();
  }

  remoteClosed(): void {
    this.channelClosed();
  }
}

export class BroadcastChannelWire implements Wire {
  private channel: BroadcastChannel | null = null;
  private listener: ((event: MessageEvent<unknown>) => void) | null = null;
  private readonly conns = new Map<string, ChannelConn>();

  async host(room: string, onConn: (conn: WireConn) => void): Promise<void> {
    this.close();
    const channel = new BroadcastChannel(`rr-${room}`);
    this.channel = channel;
    this.listener = (event: MessageEvent<unknown>): void => {
      const frame = event.data;
      if (!isRecord(frame) || typeof frame.clientId !== "string") return;
      if (frame.rrJoin === true) {
        if (!this.conns.has(frame.clientId)) {
          const conn = new ChannelConn(frame.clientId, channel, "h2c");
          this.conns.set(frame.clientId, conn);
          onConn(conn);
        }
        channel.postMessage({ rrAccept: true, clientId: frame.clientId } satisfies AcceptFrame);
        return;
      }
      if (frame.rrMsg === true && frame.dir === "c2h") {
        this.conns.get(frame.clientId)?.deliver(frame.payload);
        return;
      }
      if (frame.rrClose === true && frame.dir === "c2h") {
        this.conns.get(frame.clientId)?.remoteClosed();
        this.conns.delete(frame.clientId);
      }
    };
    channel.addEventListener("message", this.listener);
  }

  async join(room: string): Promise<WireConn> {
    this.close();
    const channel = new BroadcastChannel(`rr-${room}`);
    this.channel = channel;
    const id = clientId();
    return new Promise<WireConn>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        channel.removeEventListener("message", listener);
        channel.close();
        if (this.channel === channel) this.channel = null;
        reject(new Error("BroadcastChannel join timed out"));
      }, 4000);
      const listener = (event: MessageEvent<unknown>): void => {
        const frame = event.data;
        if (!isRecord(frame) || frame.clientId !== id) return;
        if (frame.rrAccept === true) {
          window.clearTimeout(timeout);
          const conn = new ChannelConn(id, channel, "c2h");
          this.conns.set(id, conn);
          resolve(conn);
          return;
        }
        if (frame.rrMsg === true && frame.dir === "h2c") {
          this.conns.get(id)?.deliver(frame.payload);
          return;
        }
        if (frame.rrClose === true && frame.dir === "h2c") {
          this.conns.get(id)?.remoteClosed();
          this.conns.delete(id);
        }
      };
      this.listener = listener;
      channel.addEventListener("message", listener);
      channel.postMessage({ rrJoin: true, clientId: id } satisfies JoinFrame);
    });
  }

  close(): void {
    if (this.channel && this.listener) this.channel.removeEventListener("message", this.listener);
    for (const conn of this.conns.values()) conn.channelClosed();
    this.conns.clear();
    this.channel?.close();
    this.channel = null;
    this.listener = null;
  }
}
