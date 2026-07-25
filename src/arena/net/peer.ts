import type { DataConnection, Peer } from "peerjs";
import type { Wire, WireConn } from "./protocol";

const ROOM_PREFIX = "sc-";
const ROOM_RE = /^[A-Z0-9]{6}$/;

let peerModule: Promise<typeof import("peerjs")> | null = null;

function loadPeer(): Promise<typeof import("peerjs")> {
  peerModule ??= import("peerjs");
  return peerModule;
}

function roomPeerId(roomId: string): string {
  const normalized = roomId.trim().toUpperCase();
  if (!ROOM_RE.test(normalized)) {
    throw new Error("Room ID must be six uppercase letters or digits");
  }
  return ROOM_PREFIX + normalized;
}

class PeerConn implements WireConn {
  readonly id: string;
  private closeCb: () => void = () => undefined;
  private closed = false;

  constructor(private readonly conn: DataConnection) {
    this.id = conn.peer;
    const finish = (): void => this.finishClose();
    conn.on("close", finish);
    conn.on("error", finish);
  }

  send(payload: unknown): void {
    if (this.closed) return;
    try {
      this.conn.send(payload);
    } catch {
      this.finishClose();
    }
  }

  onMessage(cb: (msg: unknown) => void): void {
    this.conn.on("data", cb);
  }

  onClose(cb: () => void): void {
    this.closeCb = cb;
  }

  close(): void {
    if (this.closed) return;
    try {
      this.conn.close();
    } catch {
      // The unified close path below still runs.
    }
    this.finishClose();
  }

  peerClosed(): void {
    this.finishClose();
  }

  private finishClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeCb();
  }
}

class PeerWire implements Wire {
  private peer: Peer | null = null;
  private readonly conns = new Set<PeerConn>();

  async host(roomId: string, onConn: (conn: WireConn) => void): Promise<void> {
    this.dispose();
    const target = roomPeerId(roomId);
    const { Peer: PeerCtor } = await loadPeer();
    const peer = new PeerCtor(target, { debug: 0 });
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      peer.on("open", () => {
        if (settled) return;
        settled = true;
        this.peer = peer;
        resolve();
      });
      peer.on("error", (error: Error) => {
        if (settled) {
          this.closeConnections();
          return;
        }
        settled = true;
        peer.destroy();
        reject(error);
      });
    });
    peer.on("connection", (dataConn: DataConnection) => {
      dataConn.on("open", () => {
        const conn = new PeerConn(dataConn);
        this.conns.add(conn);
        conn.onClose(() => this.conns.delete(conn));
        onConn(conn);
      });
      dataConn.on("error", () => {
        try {
          dataConn.close();
        } catch {
          // Connection never opened, so there is no WireConn callback to notify.
        }
      });
    });
    peer.on("disconnected", () => this.closeConnections());
    peer.on("close", () => this.closeConnections());
  }

  async join(roomId: string): Promise<WireConn> {
    this.dispose();
    const target = roomPeerId(roomId);
    const { Peer: PeerCtor } = await loadPeer();
    const peer = new PeerCtor({ debug: 0 });
    return new Promise<WireConn>((resolve, reject) => {
      let settled = false;
      const fail = (error: Error): void => {
        if (settled) {
          this.closeConnections();
          return;
        }
        settled = true;
        peer.destroy();
        reject(error);
      };
      peer.on("error", fail);
      peer.on("open", () => {
        const dataConn = peer.connect(target, { reliable: true, serialization: "json" });
        dataConn.on("open", () => {
          if (settled) return;
          settled = true;
          this.peer = peer;
          const conn = new PeerConn(dataConn);
          this.conns.add(conn);
          conn.onClose(() => this.conns.delete(conn));
          resolve(conn);
        });
        dataConn.on("error", fail);
      });
      peer.on("disconnected", () => this.closeConnections());
      peer.on("close", () => this.closeConnections());
    });
  }

  dispose(): void {
    this.closeConnections();
    try {
      this.peer?.destroy();
    } catch {
      // Already destroyed.
    }
    this.peer = null;
  }

  private closeConnections(): void {
    for (const conn of this.conns) conn.peerClosed();
    this.conns.clear();
  }
}

export function createPeerWire(): Wire {
  return new PeerWire();
}
