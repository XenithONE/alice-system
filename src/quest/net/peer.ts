import type { DataConnection, Peer } from "peerjs";
import { ROOM_PREFIX, type Wire, type WireConn } from "./protocol";

let peerModule: Promise<typeof import("peerjs")> | null = null;

function loadPeer(): Promise<typeof import("peerjs")> {
  peerModule ??= import("peerjs");
  return peerModule;
}

class PeerConn implements WireConn {
  readonly id: string;

  constructor(private readonly conn: DataConnection) {
    this.id = conn.peer;
  }

  send(msg: unknown): void {
    try {
      this.conn.send(msg);
    } catch {
      // A racing close/error event owns connection teardown.
    }
  }

  onMessage(cb: (msg: unknown) => void): void {
    this.conn.on("data", cb);
  }

  onClose(cb: () => void): void {
    let fired = false;
    const once = (): void => {
      if (fired) return;
      fired = true;
      cb();
    };
    this.conn.on("close", once);
    this.conn.on("error", once);
  }

  close(): void {
    try {
      this.conn.close();
    } catch {
      // Already closed.
    }
  }
}

export class PeerJsWire implements Wire {
  private peer: Peer | null = null;

  async host(room: string, onConn: (conn: WireConn) => void): Promise<void> {
    this.close();
    const { Peer: PeerCtor } = await loadPeer();
    const peer = new PeerCtor(ROOM_PREFIX + room, { debug: 0 });
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      peer.on("open", () => {
        if (settled) return;
        settled = true;
        this.peer = peer;
        resolve();
      });
      peer.on("error", (error: Error) => {
        if (settled) return;
        settled = true;
        peer.destroy();
        reject(error);
      });
    });
    peer.on("connection", (conn: DataConnection) => {
      conn.on("open", () => onConn(new PeerConn(conn)));
    });
  }

  async join(room: string): Promise<WireConn> {
    this.close();
    const { Peer: PeerCtor } = await loadPeer();
    const peer = new PeerCtor({ debug: 0 });
    return new Promise<WireConn>((resolve, reject) => {
      let settled = false;
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        peer.destroy();
        reject(error);
      };
      peer.on("error", fail);
      peer.on("open", () => {
        const conn = peer.connect(ROOM_PREFIX + room, { reliable: true, serialization: "json" });
        conn.on("open", () => {
          if (settled) return;
          settled = true;
          this.peer = peer;
          resolve(new PeerConn(conn));
        });
        conn.on("error", fail);
      });
    });
  }

  close(): void {
    try {
      this.peer?.destroy();
    } catch {
      // Already destroyed.
    }
    this.peer = null;
  }
}
