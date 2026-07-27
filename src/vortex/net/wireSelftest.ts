import { createDefaultBuild } from "../content/build";
import type { VortexSnapshot, WireConn } from "./protocol";
import { SnapshotInterpolator } from "./interpolation";
import {
  createGuestSession,
  createHostSession,
  type VortexSession,
} from "./session";
import {
  createBroadcastChannelWire,
  normalizeRoomCode,
  peerRoomId,
} from "./wire";

declare const process: {
  stdout: { write(value: string): void };
  exitCode?: number;
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(
  predicate: () => boolean,
  message: string,
  timeoutMs = 2500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await delay(10);
  }
}

function snapshot(tick: number, elapsed: number, x: number): VortexSnapshot {
  return {
    tick,
    elapsed,
    phase: "live",
    suddenDeathStage: 0,
    arenaId: "core-bowl",
    tops: [
      {
        seat: 0,
        alive: true,
        hp: 100,
        hpMax: 100,
        spin: 80,
        x,
        y: 0,
        z: 0,
        qx: 0,
        qy: 0,
        qz: 0,
        qw: 1,
        vx: 0,
        vy: 0,
        vz: 0,
        skills: [],
      },
    ],
    events: [],
  };
}

async function lowLevelWireGate(): Promise<void> {
  const hostWire = createBroadcastChannelWire();
  const guestWire = createBroadcastChannelWire();
  let hostConnection: WireConn | null = null;
  let fromGuest: unknown = null;
  let fromHost: unknown = null;
  let hostSawClose = false;
  try {
    await hostWire.host("WIR001", (connection) => {
      hostConnection = connection;
      connection.onMessage((payload) => {
        fromGuest = payload;
        connection.send({ ack: payload });
      });
      connection.onClose(() => {
        hostSawClose = true;
      });
    });
    const guest = await guestWire.join("WIR001");
    guest.onMessage((payload) => {
      fromHost = payload;
    });
    guest.send({ ping: 7 });
    await waitFor(
      () => fromGuest !== null && fromHost !== null,
      "BroadcastChannel did not round-trip",
    );
    guest.close();
    await waitFor(() => hostSawClose, "host did not receive guest close");
    if (hostConnection === null) throw new Error("host never accepted connection");
  } finally {
    guestWire.dispose();
    hostWire.dispose();
  }
}

async function hostCloseGate(): Promise<void> {
  const hostWire = createBroadcastChannelWire();
  const guestWire = createBroadcastChannelWire();
  let guestSawClose = false;
  try {
    await hostWire.host("HST001", () => undefined);
    const guest = await guestWire.join("HST001");
    guest.onClose(() => {
      guestSawClose = true;
    });
    hostWire.dispose();
    await waitFor(
      () => guestSawClose,
      "guest did not terminate after host closed",
    );
  } finally {
    guestWire.dispose();
    hostWire.dispose();
  }
}

function interpolationGate(): void {
  const interpolator = new SnapshotInterpolator(0.1);
  interpolator.push(snapshot(0, 0, 0));
  interpolator.push(snapshot(12, 0.2, 10));
  const sampled = interpolator.sample();
  if (!sampled || Math.abs(sampled.tops[0]!.x - 5) > 0.001) {
    throw new Error("100 ms snapshot interpolation failed");
  }
}

async function sessionGate(): Promise<void> {
  const hostWire = createBroadcastChannelWire();
  const guestWire = createBroadcastChannelWire();
  const build = createDefaultBuild("WIRE-HOST");
  let host: VortexSession | null = null;
  let guest: VortexSession | null = null;
  let guestSeat: number | null = null;
  let guestStarted = false;
  let cpuTakeover = false;
  let hostError: string | null = null;
  try {
    host = await createHostSession(
      {
        roomCode: "SES001",
        name: "HOST",
        build,
        settings: {
          playerCount: 2,
          cpuCount: 0,
          seed: 0x51e551,
        },
        wire: hostWire,
      },
      {
        onLobby(lobby) {
          guestSeat = lobby.seats.find(
            (seat) => seat.occupant === "guest",
          )?.seat ?? guestSeat;
          cpuTakeover =
            cpuTakeover ||
            lobby.seats.some(
              (seat) => seat.seat === guestSeat && seat.occupant === "cpu",
            );
        },
        onError(message) {
          hostError = message;
        },
      },
    );
    guest = await createGuestSession(
      "SES001",
      {
        name: "GUEST",
        build: { ...build, name: "WIRE-GUEST" },
        wire: guestWire,
        interpolate: false,
      },
      {
        onStart() {
          guestStarted = true;
        },
      },
    );
    await waitFor(() => guestSeat !== null, "guest never joined host lobby");
    await guest.start();
    await delay(25);
    await host.start();
    await waitFor(() => guestStarted, "guest did not receive match start");
    guest.dispose();
    guest = null;
    await waitFor(() => cpuTakeover, "guest disconnect did not become CPU");
    if (hostError !== null) throw new Error(hostError);
  } finally {
    guest?.dispose();
    host?.dispose();
  }
}

async function main(): Promise<void> {
  let failures = 0;
  const errors: string[] = [];
  try {
    if (normalizeRoomCode("vc-ab12cd") !== "AB12CD") {
      throw new Error("room normalization failed");
    }
    if (peerRoomId("ab12cd") !== "vc-AB12CD") {
      throw new Error("PeerJS room prefix failed");
    }
    interpolationGate();
    await lowLevelWireGate();
    await hostCloseGate();
    await sessionGate();
  } catch (error) {
    failures += 1;
    errors.push(error instanceof Error ? error.message : String(error));
  }
  const output = {
    protocol: 1,
    prefix: "vc-",
    broadcastRoundTrip: failures === 0,
    interpolationMs: 100,
    cpuTakeover: failures === 0,
    hostDisconnectEnds: failures === 0,
    failures,
    errors,
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
  if (failures > 0) process.exitCode = 1;
}

void main();
