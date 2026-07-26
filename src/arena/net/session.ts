import { FIXED_DT, INPUT_HZ, SNAPSHOT_HZ } from "../sim/balance";
import {
  NEUTRAL_INPUT,
  SEATS,
  DEFAULT_ROOM_SETTINGS,
  type ArenaDef,
  type ArenaSim,
  type BotSpec,
  type MatchInput,
  type RoomSettings,
  type SeatIndex,
} from "../sim/types";
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type HostMessage,
  type SeatInfo,
  type Snapshot,
  type Wire,
  type WireConn,
} from "./protocol";

export interface SessionDeps {
  validateBuild(spec: BotSpec, settings: RoomSettings): { ok: boolean; errors: readonly string[] };
  createSim(opts: {
    seed: number;
    specs: readonly (BotSpec | null)[];
    names: readonly string[];
    settings: RoomSettings;
  }): Promise<ArenaSim>;
  aiInput(sim: ArenaSim, seat: SeatIndex): MatchInput;
}

export interface HostSession {
  build(spec: BotSpec): void;
  ready(ready: boolean): void;
  updateSettings(settings: RoomSettings): void;
  input(input: MatchInput): void;
  dispose(): void;
}

export interface GuestSession {
  readonly seat: SeatIndex | null;
  build(spec: BotSpec): void;
  ready(ready: boolean): void;
  input(input: MatchInput): void;
  rematch(): void;
  dispose(): void;
}

interface HostOptions {
  hostName: string;
  initialSettings?: RoomSettings;
  onLobby(seats: readonly SeatInfo[], settings: RoomSettings): void;
  onSnapshot(s: Snapshot): void;
  onResult(r: HostMessage & { t: "result" }): void;
}

interface GuestOptions {
  name: string;
  onLobby(seats: readonly SeatInfo[], settings: RoomSettings): void;
  onStart(m: HostMessage & { t: "start" }): void;
  onSnapshot(s: Snapshot): void;
  onResult(r: HostMessage & { t: "result" }): void;
  onError(reason: string): void;
}

interface GuestRecord {
  readonly conn: WireConn;
  seat: SeatIndex | null;
  name: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isClientMessage(value: unknown): value is ClientMessage {
  if (!isRecord(value) || typeof value.t !== "string") return false;
  switch (value.t) {
    case "hello":
      return typeof value.v === "number" && typeof value.name === "string";
    case "build":
      return isRecord(value.spec);
    case "settings":
      return isRecord(value.settings);
    case "ready":
      return typeof value.ready === "boolean";
    case "input":
      return typeof value.seq === "number" && isRecord(value.input);
    case "rematch":
      return true;
    default:
      return false;
  }
}

function isHostMessage(value: unknown): value is HostMessage {
  return isRecord(value) && typeof value.t === "string" &&
    ["welcome", "lobby", "start", "snap", "result", "reject"].includes(value.t);
}

function validInput(value: MatchInput): boolean {
  return Number.isFinite(value.throttle) &&
    value.throttle >= -1 && value.throttle <= 1 &&
    Number.isFinite(value.steer) &&
    value.steer >= -1 && value.steer <= 1 &&
    typeof value.primary === "boolean" &&
    typeof value.secondary === "boolean" &&
    typeof value.tertiary === "boolean" &&
    typeof value.selfRight === "boolean";
}

function copyInput(value: MatchInput): MatchInput {
  return {
    throttle: value.throttle,
    steer: value.steer,
    primary: value.primary,
    secondary: value.secondary,
    tertiary: value.tertiary,
    selfRight: value.selfRight,
  };
}

function seatIndex(value: number): SeatIndex {
  return value as SeatIndex;
}

function arenaDescriptor(id: string): ArenaDef {
  return {
    id,
    name: id,
    nameJa: id,
    size: 16,
    wallHeight: 2.4,
    pit: null,
    saws: [],
    flameJets: [],
  };
}

function snapshotOf(sim: ArenaSim): Snapshot {
  const state = sim.getState();
  return {
    tick: state.tick,
    elapsed: state.elapsed,
    phase: state.phase,
    bots: state.bots.map((bot) => ({
      seat: bot.seat,
      alive: bot.alive,
      hp: bot.chassisHp,
      x: bot.pos[0],
      y: bot.pos[1],
      z: bot.pos[2],
      qx: bot.quat[0],
      qy: bot.quat[1],
      qz: bot.quat[2],
      qw: bot.quat[3],
      w: bot.weapons.map((weapon) => ({
        idx: weapon.partIdx,
        slot: weapon.slot,
        on: weapon.active,
        a: weapon.angle,
        o: weapon.omega,
        c: weapon.charge,
        f: weapon.fuel,
      })),
      wp: 0,
      detach: bot.detached.reduce((mask, index) => mask + 2 ** index, 0),
      pc: bot.partCondition.map((condition) =>
        Math.max(0, Math.min(255, Math.round(condition * 255)))
      ),
      burn: bot.burningFor,
      pl: [0, 255, 255, 0],
    })),
    events: sim.drainEvents(),
  };
}

class HostSessionImpl implements HostSession {
  private readonly guests = new Map<string, GuestRecord>();
  private readonly seats: SeatInfo[];
  private readonly inputs: MatchInput[] = Array.from({ length: SEATS }, () => copyInput(NEUTRAL_INPUT));
  private sim: ArenaSim | null = null;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private starting = false;
  private lastLoopAt = 0;
  private accumulator = 0;
  private stepsSinceSnapshot = 0;
  private settings: RoomSettings;

  constructor(
    private readonly wire: Wire,
    private readonly deps: SessionDeps,
    private readonly opts: HostOptions,
  ) {
    this.settings = { ...(opts.initialSettings ?? DEFAULT_ROOM_SETTINGS) };
    this.seats = Array.from({ length: SEATS }, (_, index): SeatInfo => ({
      seat: seatIndex(index),
      name: index === 0 ? opts.hostName : `AI ${index + 1}`,
      occupant: index === 0 ? "host" : "empty",
      ready: false,
      spec: null,
    }));
  }

  async open(roomId: string): Promise<void> {
    await this.wire.host(roomId, (conn) => this.attach(conn));
    if (this.disposed) {
      this.wire.dispose();
      return;
    }
    this.publishLobby();
  }

  build(spec: BotSpec): void {
    if (this.disposed || this.sim) return;
    const validation = this.validate(spec);
    if (!validation.ok) return;
    this.updateSeat(0, { spec, ready: false });
    this.publishLobby();
  }

  ready(ready: boolean): void {
    if (this.disposed || this.sim) return;
    const host = this.seats[0]!;
    const valid = host.spec !== null && this.validate(host.spec).ok;
    this.updateSeat(0, { ready: ready && valid });
    this.publishLobby();
    this.maybeStart();
  }

  updateSettings(settings: RoomSettings): void {
    if (this.disposed || this.sim || this.starting) return;
    const next = {
      pointBudget: Math.max(1, Math.round(settings.pointBudget)),
      arenaId: settings.arenaId.slice(0, 80),
      matchSec: Math.max(30, Math.round(settings.matchSec)),
    };
    if (next.pointBudget === this.settings.pointBudget &&
        next.arenaId === this.settings.arenaId &&
        next.matchSec === this.settings.matchSec) return;
    this.settings = next;
    for (const seat of this.seats) this.updateSeat(seat.seat, { ready: false });
    this.publishLobby();
  }

  input(input: MatchInput): void {
    if (validInput(input)) this.inputs[0] = copyInput(input);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.loopTimer !== null) clearTimeout(this.loopTimer);
    this.loopTimer = null;
    this.sim?.dispose();
    this.sim = null;
    for (const guest of this.guests.values()) guest.conn.close();
    this.guests.clear();
    this.wire.dispose();
  }

  private attach(conn: WireConn): void {
    if (this.disposed) {
      conn.close();
      return;
    }
    const guest: GuestRecord = { conn, seat: null, name: "" };
    this.guests.set(conn.id, guest);
    conn.onMessage((raw) => {
      try {
        if (isClientMessage(raw)) this.receive(guest, raw);
      } catch {
        conn.send({ t: "reject", reason: "Invalid message" } satisfies HostMessage);
      }
    });
    conn.onClose(() => this.disconnect(guest));
  }

  private receive(guest: GuestRecord, msg: ClientMessage): void {
    if (msg.t === "hello") {
      if (guest.seat !== null) return;
      if (msg.v !== PROTOCOL_VERSION) {
        guest.conn.send({ t: "reject", reason: "Protocol version mismatch" } satisfies HostMessage);
        guest.conn.close();
        return;
      }
      if (this.sim || this.starting) {
        guest.conn.send({ t: "reject", reason: "Match already started" } satisfies HostMessage);
        guest.conn.close();
        return;
      }
      const reserved = new Set(
        [...this.guests.values()]
          .map((record) => record.seat)
          .filter((seat): seat is SeatIndex => seat !== null),
      );
      const free = this.seats.find(
        (seat) => seat.seat > 0 && seat.occupant === "empty" && !reserved.has(seat.seat),
      );
      if (!free) {
        guest.conn.send({ t: "reject", reason: "Room is full" } satisfies HostMessage);
        guest.conn.close();
        return;
      }
      guest.seat = free.seat;
      guest.name = msg.name.trim().slice(0, 40) || `Player ${free.seat + 1}`;
      this.updateSeat(free.seat, { name: guest.name });
      guest.conn.send({
        t: "welcome",
        v: PROTOCOL_VERSION,
        seat: free.seat,
        arena: arenaDescriptor(this.settings.arenaId),
        settings: this.settings,
      } satisfies HostMessage);
      guest.conn.send({ t: "lobby", seats: this.copySeats(), settings: this.settings } satisfies HostMessage);
      return;
    }
    if (guest.seat === null) return;
    const seat = guest.seat;
    if (msg.t === "input") {
      if (validInput(msg.input)) this.inputs[seat] = copyInput(msg.input);
      return;
    }
    if (msg.t === "settings") return;
    if (this.sim || this.starting) return;
    if (msg.t === "build") {
      const validation = this.validate(msg.spec);
      if (!validation.ok) {
        this.updateSeat(seat, { occupant: "empty", spec: null, ready: false });
        guest.conn.send({
          t: "reject",
          reason: validation.errors.join("\n") || "Invalid build",
        } satisfies HostMessage);
        this.publishLobby();
        return;
      }
      this.updateSeat(seat, { name: guest.name, occupant: "guest", spec: msg.spec, ready: false });
      this.publishLobby();
      return;
    }
    if (msg.t === "ready") {
      const current = this.seats[seat]!;
      const valid = current.spec !== null && this.validate(current.spec).ok;
      this.updateSeat(seat, { ready: msg.ready && current.occupant === "guest" && valid });
      this.publishLobby();
      this.maybeStart();
      return;
    }
  }

  private validate(spec: BotSpec): { ok: boolean; errors: readonly string[] } {
    try {
      return this.deps.validateBuild(spec, this.settings);
    } catch {
      return { ok: false, errors: ["Build validation failed"] };
    }
  }

  private disconnect(guest: GuestRecord): void {
    if (!this.guests.delete(guest.conn.id) || guest.seat === null) return;
    if (!this.sim && !this.starting) {
      this.updateSeat(guest.seat, {
        name: `AI ${guest.seat + 1}`,
        occupant: "empty",
        ready: false,
        spec: null,
      });
      this.publishLobby();
      return;
    }
    this.inputs[guest.seat] = copyInput(NEUTRAL_INPUT);
    this.updateSeat(guest.seat, {
      name: `AI ${guest.seat + 1}`,
      occupant: "ai",
      ready: true,
    });
    this.publishLobby();
  }

  private maybeStart(): void {
    if (this.disposed || this.sim || this.starting) return;
    const humans = this.seats.filter((seat) => seat.occupant === "host" || seat.occupant === "guest");
    if (humans.length === 0 || humans.some((seat) => !seat.ready || seat.spec === null)) return;
    this.starting = true;
    const aiSpec = this.seats[0]!.spec;
    for (let index = 1; index < SEATS; index += 1) {
      if (this.seats[index]!.occupant === "empty") {
        this.updateSeat(seatIndex(index), {
          name: `AI ${index + 1}`,
          occupant: "ai",
          ready: true,
          spec: aiSpec,
        });
      }
    }
    this.publishLobby();
    const specs = this.seats.map((seat) => seat.spec);
    const names = this.seats.map((seat) => seat.name);
    const seed = Date.now() >>> 0;
    const start = { t: "start", specs, names, seed, settings: this.settings } satisfies HostMessage;
    this.broadcast(start);
    void this.createAndRun(seed, specs, names);
  }

  private async createAndRun(
    seed: number,
    specs: readonly (BotSpec | null)[],
    names: readonly string[],
  ): Promise<void> {
    try {
      const sim = await this.deps.createSim({ seed, specs, names, settings: this.settings });
      if (this.disposed) {
        sim.dispose();
        return;
      }
      this.sim = sim;
      this.lastLoopAt = performance.now();
      this.accumulator = 0;
      this.stepsSinceSnapshot = 0;
      this.scheduleLoop();
    } catch {
      this.starting = false;
      this.broadcast({ t: "reject", reason: "Failed to create simulation" });
    }
  }

  private scheduleLoop(): void {
    if (this.disposed || !this.sim) return;
    this.loopTimer = setTimeout(() => this.runLoop(), 4);
  }

  private runLoop(): void {
    this.loopTimer = null;
    const sim = this.sim;
    if (this.disposed || !sim) return;
    const now = performance.now();
    this.accumulator += Math.max(0, (now - this.lastLoopAt) / 1_000);
    this.lastLoopAt = now;
    const available = Math.floor(this.accumulator / FIXED_DT);
    const steps = Math.min(available, 5);
    if (available > 5) this.accumulator = 0;
    else this.accumulator -= steps * FIXED_DT;

    for (let count = 0; count < steps; count += 1) {
      const frameInputs = this.seats.map((seat) =>
        seat.occupant === "ai" ? this.safeAiInput(sim, seat.seat) : this.inputs[seat.seat]!,
      );
      sim.step(frameInputs);
      this.stepsSinceSnapshot += 1;
      if (this.stepsSinceSnapshot >= Math.max(1, Math.round(1 / (FIXED_DT * SNAPSHOT_HZ)))) {
        this.stepsSinceSnapshot = 0;
        const snapshot = snapshotOf(sim);
        this.opts.onSnapshot(snapshot);
        this.broadcast({ t: "snap", s: snapshot });
      }
      const result = sim.result();
      if (result) {
        const message = {
          t: "result",
          winner: result.winner,
          reason: result.reason,
          scores: result.scores,
          kos: result.kos,
        } satisfies HostMessage;
        this.broadcast(message);
        this.opts.onResult(message);
        sim.dispose();
        this.sim = null;
        return;
      }
    }
    this.scheduleLoop();
  }

  private safeAiInput(sim: ArenaSim, seat: SeatIndex): MatchInput {
    try {
      const input = this.deps.aiInput(sim, seat);
      return validInput(input) ? input : NEUTRAL_INPUT;
    } catch {
      return NEUTRAL_INPUT;
    }
  }

  private updateSeat(seat: SeatIndex, patch: Partial<SeatInfo>): void {
    this.seats[seat] = { ...this.seats[seat]!, ...patch };
  }

  private copySeats(): readonly SeatInfo[] {
    return this.seats.map((seat) => ({ ...seat }));
  }

  private publishLobby(): void {
    const seats = this.copySeats();
    this.opts.onLobby(seats, this.settings);
    this.broadcast({ t: "lobby", seats, settings: this.settings });
  }

  private broadcast(message: HostMessage): void {
    for (const guest of this.guests.values()) {
      if (guest.seat !== null) guest.conn.send(message);
    }
  }
}

class GuestSessionImpl implements GuestSession {
  private currentSeat: SeatIndex | null = null;
  private currentInput: MatchInput = copyInput(NEUTRAL_INPUT);
  private seq = 0;
  private inputTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(
    private readonly wire: Wire,
    private readonly conn: WireConn,
    private readonly opts: GuestOptions,
  ) {
    conn.onMessage((raw) => this.receive(raw));
    conn.onClose(() => {
      if (!this.disposed) this.opts.onError("Connection closed");
      this.stopInputLoop();
    });
    conn.send({ t: "hello", v: PROTOCOL_VERSION, name: opts.name } satisfies ClientMessage);
  }

  get seat(): SeatIndex | null {
    return this.currentSeat;
  }

  build(spec: BotSpec): void {
    if (!this.disposed) this.conn.send({ t: "build", spec } satisfies ClientMessage);
  }

  ready(ready: boolean): void {
    if (!this.disposed) this.conn.send({ t: "ready", ready } satisfies ClientMessage);
  }

  input(input: MatchInput): void {
    if (validInput(input)) this.currentInput = copyInput(input);
  }

  rematch(): void {
    if (!this.disposed) this.conn.send({ t: "rematch" } satisfies ClientMessage);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopInputLoop();
    this.conn.close();
    this.wire.dispose();
  }

  private receive(raw: unknown): void {
    if (!isHostMessage(raw)) return;
    switch (raw.t) {
      case "welcome":
        if (raw.v !== PROTOCOL_VERSION) {
          this.opts.onError("Protocol version mismatch");
          return;
        }
        this.currentSeat = raw.seat;
        return;
      case "lobby":
        this.opts.onLobby(raw.seats, raw.settings);
        return;
      case "start":
        this.opts.onStart(raw);
        this.startInputLoop();
        return;
      case "snap":
        this.opts.onSnapshot(raw.s);
        return;
      case "result":
        this.stopInputLoop();
        this.opts.onResult(raw);
        return;
      case "reject":
        this.opts.onError(raw.reason);
        return;
    }
  }

  private startInputLoop(): void {
    if (this.inputTimer !== null || this.disposed) return;
    const send = (): void => {
      this.conn.send({
        t: "input",
        seq: ++this.seq,
        input: this.currentInput,
      } satisfies ClientMessage);
    };
    send();
    this.inputTimer = setInterval(send, 1_000 / INPUT_HZ);
  }

  private stopInputLoop(): void {
    if (this.inputTimer !== null) clearInterval(this.inputTimer);
    this.inputTimer = null;
  }
}

export async function createHostSession(
  wire: Wire,
  roomId: string,
  deps: SessionDeps,
  opts: HostOptions,
): Promise<HostSession> {
  const session = new HostSessionImpl(wire, deps, opts);
  try {
    await session.open(roomId);
    return session;
  } catch (error) {
    session.dispose();
    throw error;
  }
}

export async function createGuestSession(
  wire: Wire,
  roomId: string,
  opts: GuestOptions,
): Promise<GuestSession> {
  let conn: WireConn;
  try {
    conn = await wire.join(roomId);
  } catch (error) {
    wire.dispose();
    opts.onError(error instanceof Error ? error.message : "Failed to join room");
    throw error;
  }
  return new GuestSessionImpl(wire, conn, opts);
}
