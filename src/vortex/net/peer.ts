import type { DataConnection, Peer } from "peerjs";
import type { Wire, WireConn } from "./protocol";
import { peerRoomId } from "./wire";

let peerModule: Promise<typeof import("peerjs")> | null = null;

function loadPeer(): Promise<typeof import("peerjs")> {
  peerModule ??= import("peerjs");
  return peerModule;
}

class PeerConnection implements WireConn {
  readonly id: string;
  private closeCallback: () => void = () => undefined;
  private closed = false;

  constructor(private readonly connection: DataConnection) {
    this.id = connection.peer;
    const finish = (): void => this.finishClose();
    connection.on("close", finish);
    connection.on("error", finish);
  }

  send(payload: unknown): void {
    if (this.closed) return;
    try {
      this.connection.send(payload);
    } catch {
      this.finishClose();
    }
  }

  onMessage(callback: (payload: unknown) => void): void {
    this.connection.on("data", callback);
  }

  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  close(): void {
    if (this.closed) return;
    try {
      this.connection.close();
    } finally {
      this.finishClose();
    }
  }

  peerClosed(): void {
    this.finishClose();
  }

  private finishClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeCallback();
  }
}

class PeerWire implements Wire {
  private peer: Peer | null = null;
  private readonly connections = new Set<PeerConnection>();

  async host(
    roomCode: string,
    onConnection: (connection: WireConn) => void,
  ): Promise<void> {
    this.dispose();
    const target = peerRoomId(roomCode);
    const { Peer: PeerConstructor } = await loadPeer();
    const peer = new PeerConstructor(target, { debug: 0 });
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
    peer.on("connection", (dataConnection: DataConnection) => {
      dataConnection.on("open", () => {
        const connection = new PeerConnection(dataConnection);
        this.connections.add(connection);
        connection.onClose(() => this.connections.delete(connection));
        onConnection(connection);
      });
      dataConnection.on("error", () => {
        try {
          dataConnection.close();
        } catch {
          // It never became an exposed WireConn.
        }
      });
    });
    peer.on("disconnected", () => this.closeConnections());
    peer.on("close", () => this.closeConnections());
  }

  async join(roomCode: string): Promise<WireConn> {
    this.dispose();
    const target = peerRoomId(roomCode);
    const { Peer: PeerConstructor } = await loadPeer();
    const peer = new PeerConstructor({ debug: 0 });
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
        const dataConnection = peer.connect(target, {
          reliable: true,
          serialization: "json",
        });
        dataConnection.on("open", () => {
          if (settled) return;
          settled = true;
          this.peer = peer;
          const connection = new PeerConnection(dataConnection);
          this.connections.add(connection);
          connection.onClose(() => this.connections.delete(connection));
          resolve(connection);
        });
        dataConnection.on("error", fail);
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
      // PeerJS may already have destroyed it after an error.
    }
    this.peer = null;
  }

  private closeConnections(): void {
    for (const connection of this.connections) connection.peerClosed();
    this.connections.clear();
  }
}

export function createPeerWire(): Wire {
  return new PeerWire();
}
