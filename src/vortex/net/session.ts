import { createDefaultBuild, validateBuild } from "../content/build";
import type {
  TopBuildSpec,
  VortexRoomSettings,
} from "../types";
import {
  aiActivation,
  createVortexSim,
  resolveCatalogBuild,
  type ResolvedTopBuild,
  type SeatIndex,
  type SkillActivationResult,
  type SkillSlot,
  type VortexSim,
} from "../sim";
import {
  FIXED_DT,
  MAX_CATCHUP_STEPS,
  SNAPSHOT_EVERY_TICKS,
} from "../sim/balance";
import { SnapshotInterpolator } from "./interpolation";
import { createPeerWire } from "./peer";
import {
  VORTEX_PROTOCOL_VERSION,
  isClientMessage,
  isHostMessage,
  type ClientMessage,
  type HostMessage,
  type LobbySeat,
  type VortexLobby,
  type VortexResult,
  type VortexSnapshot,
  type Wire,
  type WireConn,
} from "./protocol";
import { resultFromSim, snapshotFromSim } from "./snapshot";
import { normalizeRoomCode } from "./wire";

export const DEFAULT_VORTEX_ROOM_SETTINGS: VortexRoomSettings = {
  costLimit: 1000,
  arenaId: "core-bowl",
  mode: "custom",
  playerCount: 4,
  cpuCount: 3,
  seed: 1,
  draftTurnSec: 12,
};

export interface SessionCallbacks {
  onLobby?(lobby: VortexLobby): void;
  onStart?(payload: {
    readonly seed: number;
    readonly settings: VortexRoomSettings;
    readonly builds: readonly TopBuildSpec[];
    readonly names: readonly string[];
  }): void;
  onSnapshot?(snapshot: VortexSnapshot): void;
  onResult?(result: VortexResult): void;
  onError?(message: string): void;
}

export interface VortexSession {
  readonly seat: SeatIndex | null;
  start(): Promise<void>;
  activate(slot: SkillSlot): SkillActivationResult | null;
  dispose(): void;
}

export interface SoloSessionConfig {
  /** One human build plus optional explicit CPU builds. */
  readonly builds: readonly (
    | TopBuildSpec
    | ResolvedTopBuild<TopBuildSpec>
  )[];
  readonly names?: readonly string[];
  readonly playerCount?: 2 | 3 | 4;
  readonly arenaId?: string;
  readonly seed?: number;
  readonly countdownSec?: number;
  readonly suddenDeathSec?: number;
  readonly maxDurationSec?: number;
  readonly settings?: Partial<VortexRoomSettings>;
}

export type NetworkBuildResolver = (
  build: TopBuildSpec,
  settings: VortexRoomSettings,
) => ResolvedTopBuild<TopBuildSpec>;

export interface HostSessionConfig {
  readonly roomCode: string;
  readonly name: string;
  readonly build: TopBuildSpec;
  readonly settings?: Partial<VortexRoomSettings>;
  readonly cpuBuilds?: readonly TopBuildSpec[];
  readonly wire?: Wire;
  readonly resolveBuild?: NetworkBuildResolver;
}

export interface GuestSessionConfig {
  readonly name: string;
  readonly build: TopBuildSpec;
  readonly wire?: Wire;
  /** Defaults to the required 100 ms interpolation buffer. */
  readonly interpolate?: boolean;
}

function nowMilliseconds(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function seatIndex(value: number): SeatIndex {
  return value as SeatIndex;
}

function copySettings(
  partial: Partial<VortexRoomSettings> | undefined,
): VortexRoomSettings {
  const source = { ...DEFAULT_VORTEX_ROOM_SETTINGS, ...partial };
  const playerCount =
    source.playerCount === 2 || source.playerCount === 3 || source.playerCount === 4
      ? source.playerCount
      : 4;
  const costLimit =
    typeof source.costLimit === "number" && source.costLimit > 0
      ? Number.isFinite(source.costLimit)
        ? source.costLimit
        : Number.MAX_SAFE_INTEGER
      : 1000;
  return {
    costLimit,
    arenaId:
      typeof source.arenaId === "string" && source.arenaId.length > 0
        ? source.arenaId.slice(0, 64)
        : "core-bowl",
    mode: source.mode === "draft" ? "draft" : "custom",
    playerCount,
    cpuCount: Math.max(
      0,
      Math.min(playerCount - 1, Math.floor(source.cpuCount ?? playerCount - 1)),
    ),
    seed: Number.isFinite(source.seed) ? source.seed >>> 0 : 1,
    draftTurnSec: 12,
  };
}

function isResolvedBuild(
  value: TopBuildSpec | ResolvedTopBuild<TopBuildSpec>,
): value is ResolvedTopBuild<TopBuildSpec> {
  return (
    "source" in value &&
    Array.isArray(value.parts) &&
    typeof value.cost === "number"
  );
}

function defaultResolver(
  build: TopBuildSpec,
  settings: VortexRoomSettings,
): ResolvedTopBuild<TopBuildSpec> {
  return resolveCatalogBuild(build, settings.costLimit);
}

function safeCallback(
  callback: (() => void) | undefined,
  onError: ((message: string) => void) | undefined,
): void {
  if (!callback) return;
  try {
    callback();
  } catch (error) {
    onError?.(
      error instanceof Error ? error.message : "Session callback failed",
    );
  }
}

abstract class AuthoritativeLoop {
  protected sim: VortexSim | null = null;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private lastLoopAt = 0;
  private accumulator = 0;
  private stepsSinceSnapshot = 0;
  protected stopped = false;

  protected beginLoop(sim: VortexSim): void {
    this.sim = sim;
    this.lastLoopAt = nowMilliseconds();
    this.accumulator = 0;
    this.stepsSinceSnapshot = 0;
    this.stopped = false;
    this.publishSnapshot(snapshotFromSim(sim));
    this.scheduleLoop();
  }

  protected stopLoop(disposeSim = true): void {
    this.stopped = true;
    if (this.loopTimer !== null) clearTimeout(this.loopTimer);
    this.loopTimer = null;
    if (disposeSim) this.sim?.dispose();
    this.sim = null;
  }

  protected abstract publishSnapshot(snapshot: VortexSnapshot): void;
  protected abstract publishResult(result: VortexResult): void;

  private scheduleLoop(): void {
    if (this.stopped || !this.sim) return;
    this.loopTimer = setTimeout(() => this.runLoop(), 4);
  }

  private runLoop(): void {
    this.loopTimer = null;
    const sim = this.sim;
    if (this.stopped || !sim) return;
    const now = nowMilliseconds();
    this.accumulator += Math.max(0, (now - this.lastLoopAt) / 1000);
    this.lastLoopAt = now;
    const available = Math.floor(this.accumulator / FIXED_DT);
    const steps = Math.min(available, MAX_CATCHUP_STEPS);
    if (available > MAX_CATCHUP_STEPS) this.accumulator = 0;
    else this.accumulator -= steps * FIXED_DT;

    for (let count = 0; count < steps; count += 1) {
      if (sim.tick % 12 === 0) {
        for (let seat = 0; seat < 4; seat += 1) {
          const typedSeat = seatIndex(seat);
          const slot = aiActivation(sim, typedSeat);
          if (slot !== null) sim.activate(typedSeat, slot);
        }
      }
      sim.step();
      this.stepsSinceSnapshot += 1;
      if (this.stepsSinceSnapshot >= SNAPSHOT_EVERY_TICKS) {
        this.stepsSinceSnapshot = 0;
        this.publishSnapshot(snapshotFromSim(sim));
      }
      const result = resultFromSim(sim);
      if (result) {
        // Always deliver one terminal pose before the result panel opens.
        if (this.stepsSinceSnapshot !== 0) {
          this.stepsSinceSnapshot = 0;
          this.publishSnapshot(snapshotFromSim(sim));
        }
        this.publishResult(result);
        this.stopLoop();
        return;
      }
    }
    this.scheduleLoop();
  }
}

class SoloSessionImpl extends AuthoritativeLoop implements VortexSession {
  readonly seat = 0 as SeatIndex;
  private started = false;
  private disposed = false;

  constructor(
    private readonly config: SoloSessionConfig,
    private readonly callbacks: SessionCallbacks,
    private readonly settings: VortexRoomSettings,
  ) {
    super();
  }

  async start(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;
    try {
      const requested = this.config.builds.length;
      if (requested < 1) throw new Error("Solo mode needs a player build");
      const count = this.config.playerCount ?? this.settings.playerCount;
      const first = this.config.builds[0]!;
      const builds = Array.from({ length: count }, (_, seat) => {
        const entry = this.config.builds[seat] ?? first;
        return isResolvedBuild(entry)
          ? entry
          : defaultResolver(entry, this.settings);
      });
      const names = builds.map(
        (build, seat) =>
          this.config.names?.[seat] ??
          (seat === 0 ? build.name : `CPU ${seat + 1}`),
      );
      this.callbacks.onStart?.({
        seed: this.settings.seed,
        settings: this.settings,
        builds: builds.map((build) => build.source),
        names,
      });
      const sim = await createVortexSim({
        seed: this.settings.seed,
        builds,
        names,
        arenaId: this.settings.arenaId as never,
        cpuSeats: Array.from(
          { length: Math.max(0, count - 1) },
          (_, index) => seatIndex(index + 1),
        ),
        countdownSec: this.config.countdownSec,
        suddenDeathSec: this.config.suddenDeathSec,
        maxDurationSec: this.config.maxDurationSec,
      });
      if (this.disposed) {
        sim.dispose();
        return;
      }
      this.beginLoop(sim);
    } catch (error) {
      this.started = false;
      this.callbacks.onError?.(
        error instanceof Error ? error.message : "Failed to start solo match",
      );
      throw error;
    }
  }

  activate(slot: SkillSlot): SkillActivationResult | null {
    return this.sim?.activate(this.seat, slot) ?? null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopLoop();
  }

  protected publishSnapshot(snapshot: VortexSnapshot): void {
    safeCallback(
      () => this.callbacks.onSnapshot?.(snapshot),
      this.callbacks.onError,
    );
  }

  protected publishResult(result: VortexResult): void {
    safeCallback(
      () => this.callbacks.onResult?.(result),
      this.callbacks.onError,
    );
  }
}

interface GuestRecord {
  readonly connection: WireConn;
  seat: SeatIndex | null;
  name: string;
  build: TopBuildSpec | null;
  ready: boolean;
  lastSkillSequence: number;
  lastSkillReceivedAt: number;
}

class HostSessionImpl extends AuthoritativeLoop implements VortexSession {
  readonly seat = 0 as SeatIndex;
  private readonly guests = new Map<string, GuestRecord>();
  private readonly seats: LobbySeat[];
  private disposed = false;
  private starting = false;
  private matchStarted = false;

  constructor(
    private readonly wire: Wire,
    private readonly roomCode: string,
    private readonly config: HostSessionConfig,
    private readonly callbacks: SessionCallbacks,
    private readonly settings: VortexRoomSettings,
    private readonly resolver: NetworkBuildResolver,
  ) {
    super();
    this.seats = Array.from({ length: 4 }, (_, seat): LobbySeat => ({
      seat: seatIndex(seat),
      name:
        seat === 0
          ? config.name.trim().slice(0, 40) || "HOST"
          : `CPU ${seat + 1}`,
      occupant: seat === 0 ? "host" : "empty",
      ready: seat === 0,
      build: seat === 0 ? config.build : null,
    }));
  }

  async open(): Promise<void> {
    const validation = validateBuild(this.config.build, this.settings.costLimit);
    if (!validation.ok) {
      throw new Error(validation.errors.map((issue) => issue.message).join(" / "));
    }
    await this.wire.host(this.roomCode, (connection) =>
      this.attach(connection),
    );
    if (this.disposed) {
      this.wire.dispose();
      return;
    }
    this.publishLobby();
  }

  async start(): Promise<void> {
    if (
      this.disposed ||
      this.starting ||
      this.matchStarted ||
      this.sim !== null
    ) {
      return;
    }
    const humanSeats = this.seats
      .slice(0, this.settings.playerCount)
      .filter(
        (seat) => seat.occupant === "host" || seat.occupant === "guest",
      );
    if (humanSeats.some((seat) => !seat.ready || !seat.build)) {
      const message = "参加プレイヤーのビルド確定を待っています。";
      this.callbacks.onError?.(message);
      throw new Error(message);
    }
    this.starting = true;
    try {
      const fallback = this.config.build;
      const resolved: ResolvedTopBuild<TopBuildSpec>[] = [];
      const specs: TopBuildSpec[] = [];
      const names: string[] = [];
      for (let seat = 0; seat < this.settings.playerCount; seat += 1) {
        const current = this.seats[seat]!;
        let build = current.build;
        if (!build) {
          build =
            this.config.cpuBuilds?.[seat - 1] ??
            this.config.cpuBuilds?.[0] ??
            fallback;
          this.seats[seat] = {
            ...current,
            name: `CPU ${seat + 1}`,
            occupant: "cpu",
            ready: true,
            build,
          };
        }
        specs.push(build);
        names.push(this.seats[seat]!.name);
        resolved.push(this.resolver(build, this.settings));
      }
      this.publishLobby();
      const startMessage = {
        t: "start",
        seed: this.settings.seed,
        settings: this.settings,
        builds: specs,
        names,
      } satisfies HostMessage;
      this.broadcast(startMessage);
      this.callbacks.onStart?.({
        seed: this.settings.seed,
        settings: this.settings,
        builds: specs,
        names,
      });
      const cpuSeats = this.seats
        .slice(0, this.settings.playerCount)
        .filter((seat) => seat.occupant === "cpu")
        .map((seat) => seat.seat);
      const sim = await createVortexSim({
        seed: this.settings.seed,
        builds: resolved,
        names,
        arenaId: this.settings.arenaId as never,
        cpuSeats,
      });
      if (this.disposed) {
        sim.dispose();
        return;
      }
      this.matchStarted = true;
      this.starting = false;
      this.beginLoop(sim);
    } catch (error) {
      this.starting = false;
      const message =
        error instanceof Error ? error.message : "Failed to start hosted match";
      this.callbacks.onError?.(message);
      this.broadcast({ t: "reject", reason: message });
      throw error;
    }
  }

  activate(slot: SkillSlot): SkillActivationResult | null {
    return this.sim?.activate(this.seat, slot) ?? null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.broadcast({ t: "ended", reason: "host-ended" });
    this.stopLoop();
    for (const guest of this.guests.values()) guest.connection.close();
    this.guests.clear();
    this.wire.dispose();
  }

  protected publishSnapshot(snapshot: VortexSnapshot): void {
    this.callbacks.onSnapshot?.(snapshot);
    this.broadcast({ t: "snapshot", snapshot });
  }

  protected publishResult(result: VortexResult): void {
    this.callbacks.onResult?.(result);
    this.broadcast({ t: "result", result });
    this.matchStarted = false;
    for (const seat of this.seats) {
      if (seat.occupant === "guest") {
        this.seats[seat.seat] = { ...seat, ready: false };
      }
    }
    for (const guest of this.guests.values()) guest.ready = false;
    this.publishLobby();
  }

  private attach(connection: WireConn): void {
    if (this.disposed || this.matchStarted || this.starting) {
      connection.send({ t: "reject", reason: "Match already started" } satisfies HostMessage);
      connection.close();
      return;
    }
    const guest: GuestRecord = {
      connection,
      seat: null,
      name: "",
      build: null,
      ready: false,
      lastSkillSequence: -1,
      lastSkillReceivedAt: Number.NEGATIVE_INFINITY,
    };
    this.guests.set(connection.id, guest);
    connection.onMessage((payload) => {
      try {
        if (isClientMessage(payload)) this.receive(guest, payload);
      } catch (error) {
        connection.send({
          t: "reject",
          reason: error instanceof Error ? error.message : "Invalid message",
        } satisfies HostMessage);
      }
    });
    connection.onClose(() => this.disconnect(guest));
  }

  private receive(guest: GuestRecord, message: ClientMessage): void {
    if (message.t === "hello") {
      if (guest.seat !== null) return;
      if (message.v !== VORTEX_PROTOCOL_VERSION) {
        guest.connection.send({
          t: "reject",
          reason: "Protocol version mismatch",
        } satisfies HostMessage);
        guest.connection.close();
        return;
      }
      const reserved = new Set(
        [...this.guests.values()]
          .map((entry) => entry.seat)
          .filter((seat): seat is SeatIndex => seat !== null),
      );
      const free = this.seats
        .slice(1, this.settings.playerCount)
        .find(
          (seat) => seat.occupant === "empty" && !reserved.has(seat.seat),
        );
      if (!free) {
        guest.connection.send({
          t: "reject",
          reason: "Room is full",
        } satisfies HostMessage);
        guest.connection.close();
        return;
      }
      const validation = validateBuild(message.build, this.settings.costLimit);
      if (!validation.ok) {
        guest.connection.send({
          t: "reject",
          reason: validation.errors.map((issue) => issue.message).join(" / "),
        } satisfies HostMessage);
        guest.connection.close();
        return;
      }
      guest.seat = free.seat;
      guest.name =
        message.name.trim().slice(0, 40) || `PLAYER ${free.seat + 1}`;
      guest.build = message.build;
      this.seats[free.seat] = {
        ...free,
        name: guest.name,
        occupant: "guest",
        ready: false,
        build: message.build,
      };
      guest.connection.send({
        t: "welcome",
        v: VORTEX_PROTOCOL_VERSION,
        seat: free.seat,
        settings: this.settings,
      } satisfies HostMessage);
      this.publishLobby();
      return;
    }
    if (guest.seat === null) return;
    if (message.t === "skill") {
      if (!this.sim || message.seq <= guest.lastSkillSequence) return;
      const receivedAt = nowMilliseconds();
      if (receivedAt - guest.lastSkillReceivedAt < 50) return;
      guest.lastSkillSequence = message.seq;
      guest.lastSkillReceivedAt = receivedAt;
      this.sim.activate(guest.seat, message.slot);
      return;
    }
    if (this.sim || this.starting || this.matchStarted) return;
    if (message.t === "build") {
      const validation = validateBuild(message.build, this.settings.costLimit);
      if (!validation.ok) {
        guest.connection.send({
          t: "reject",
          reason: validation.errors.map((issue) => issue.message).join(" / "),
        } satisfies HostMessage);
        return;
      }
      guest.build = message.build;
      guest.ready = false;
      this.seats[guest.seat] = {
        ...this.seats[guest.seat]!,
        build: message.build,
        ready: false,
      };
      this.publishLobby();
      return;
    }
    if (message.t === "ready") {
      guest.ready = message.ready;
      this.seats[guest.seat] = {
        ...this.seats[guest.seat]!,
        ready: message.ready && guest.build !== null,
      };
      this.publishLobby();
    }
  }

  private disconnect(guest: GuestRecord): void {
    if (!this.guests.delete(guest.connection.id) || guest.seat === null) return;
    const current = this.seats[guest.seat]!;
    if (this.sim) {
      this.seats[guest.seat] = {
        ...current,
        name: `CPU ${guest.seat + 1}`,
        occupant: "cpu",
        ready: true,
      };
      this.sim.setCpu(guest.seat, true);
    } else {
      this.seats[guest.seat] = {
        ...current,
        name: `CPU ${guest.seat + 1}`,
        occupant: "empty",
        ready: false,
        build: null,
      };
    }
    this.publishLobby();
  }

  private lobby(): VortexLobby {
    return {
      roomCode: this.roomCode,
      settings: this.settings,
      seats: this.seats.map((seat) => ({ ...seat })),
    };
  }

  private publishLobby(): void {
    const lobby = this.lobby();
    this.callbacks.onLobby?.(lobby);
    this.broadcast({ t: "lobby", lobby });
  }

  private broadcast(message: HostMessage): void {
    for (const guest of this.guests.values()) {
      if (guest.seat !== null) guest.connection.send(message);
    }
  }
}

class GuestSessionImpl implements VortexSession {
  private currentSeat: SeatIndex | null = null;
  private sequence = 0;
  private disposed = false;
  private ready = false;
  private hostEnded = false;
  private interpolationTimer: ReturnType<typeof setInterval> | null = null;
  private readonly interpolator = new SnapshotInterpolator();

  constructor(
    private readonly wire: Wire,
    private readonly connection: WireConn,
    private readonly config: GuestSessionConfig,
    private readonly callbacks: SessionCallbacks,
  ) {
    connection.onMessage((payload) => this.receive(payload));
    connection.onClose(() => {
      this.stopInterpolation();
      if (!this.disposed && !this.hostEnded) {
        this.callbacks.onError?.("Host disconnected");
      }
    });
    connection.send({
      t: "hello",
      v: VORTEX_PROTOCOL_VERSION,
      name: config.name,
      build: config.build,
    } satisfies ClientMessage);
  }

  get seat(): SeatIndex | null {
    return this.currentSeat;
  }

  async start(): Promise<void> {
    if (this.disposed || this.ready) return;
    this.ready = true;
    this.connection.send({ t: "ready", ready: true } satisfies ClientMessage);
  }

  activate(slot: SkillSlot): SkillActivationResult | null {
    if (this.disposed || this.currentSeat === null) return null;
    this.connection.send({
      t: "skill",
      seq: ++this.sequence,
      slot,
    } satisfies ClientMessage);
    return null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopInterpolation();
    this.connection.close();
    this.wire.dispose();
  }

  private receive(payload: unknown): void {
    if (!isHostMessage(payload)) return;
    switch (payload.t) {
      case "welcome":
        if (payload.v !== VORTEX_PROTOCOL_VERSION) {
          this.callbacks.onError?.("Protocol version mismatch");
          return;
        }
        this.currentSeat = payload.seat;
        return;
      case "lobby":
        this.callbacks.onLobby?.(payload.lobby);
        return;
      case "start":
        this.callbacks.onStart?.({
          seed: payload.seed,
          settings: payload.settings,
          builds: payload.builds,
          names: payload.names,
        });
        return;
      case "snapshot":
        if (this.config.interpolate === false) {
          this.callbacks.onSnapshot?.(payload.snapshot);
        } else {
          this.interpolator.push(payload.snapshot);
          this.startInterpolation();
        }
        return;
      case "result":
        this.flushInterpolation();
        this.stopInterpolation();
        this.ready = false;
        this.callbacks.onResult?.(payload.result);
        return;
      case "reject":
        this.callbacks.onError?.(payload.reason);
        return;
      case "ended":
        this.hostEnded = true;
        this.stopInterpolation();
        if (!this.disposed) {
          this.callbacks.onError?.(
            payload.reason === "host-left"
              ? "Host disconnected"
              : "Host ended the room",
          );
        }
        return;
    }
  }

  private startInterpolation(): void {
    if (this.interpolationTimer !== null || this.disposed) return;
    this.flushInterpolation();
    this.interpolationTimer = setInterval(
      () => this.flushInterpolation(),
      1000 / 60,
    );
  }

  private flushInterpolation(): void {
    const snapshot = this.interpolator.sample();
    if (snapshot) this.callbacks.onSnapshot?.(snapshot);
  }

  private stopInterpolation(): void {
    if (this.interpolationTimer !== null) {
      clearInterval(this.interpolationTimer);
    }
    this.interpolationTimer = null;
  }
}

export async function createSoloSession(
  config: SoloSessionConfig,
  callbacks: SessionCallbacks = {},
): Promise<VortexSession> {
  const settings = copySettings({
    ...config.settings,
    playerCount: config.playerCount ?? config.settings?.playerCount ?? 4,
    arenaId: config.arenaId ?? config.settings?.arenaId ?? "core-bowl",
    seed: config.seed ?? config.settings?.seed ?? (Date.now() >>> 0),
  });
  const session = new SoloSessionImpl(config, callbacks, settings);
  const firstBuild = config.builds[0];
  const source = firstBuild
    ? isResolvedBuild(firstBuild)
      ? firstBuild.source
      : firstBuild
    : null;
  callbacks.onLobby?.({
    roomCode: null,
    settings,
    seats: Array.from({ length: 4 }, (_, seat): LobbySeat => ({
      seat: seatIndex(seat),
      name:
        config.names?.[seat] ??
        (seat === 0 ? source?.name ?? "PLAYER" : `CPU ${seat + 1}`),
      occupant:
        seat >= settings.playerCount ? "empty" : seat === 0 ? "host" : "cpu",
      ready: seat < settings.playerCount,
      build: seat < settings.playerCount ? source : null,
    })),
  });
  return session;
}

export async function createHostSession(
  config: HostSessionConfig,
  callbacks: SessionCallbacks = {},
): Promise<VortexSession> {
  const roomCode = normalizeRoomCode(config.roomCode);
  const wire = config.wire ?? createPeerWire();
  const settings = copySettings({
    ...config.settings,
    seed: config.settings?.seed ?? (Date.now() >>> 0),
  });
  const session = new HostSessionImpl(
    wire,
    roomCode,
    config,
    callbacks,
    settings,
    config.resolveBuild ?? defaultResolver,
  );
  try {
    await session.open();
    return session;
  } catch (error) {
    session.dispose();
    throw error;
  }
}

export async function createGuestSession(
  roomCode: string,
  config: GuestSessionConfig,
  callbacks?: SessionCallbacks,
): Promise<VortexSession>;
export async function createGuestSession(
  roomCode: string,
  callbacks?: SessionCallbacks,
): Promise<VortexSession>;
export async function createGuestSession(
  roomCode: string,
  configOrCallbacks: GuestSessionConfig | SessionCallbacks = {},
  optionalCallbacks: SessionCallbacks = {},
): Promise<VortexSession> {
  const hasConfig =
    "build" in configOrCallbacks && "name" in configOrCallbacks;
  const config: GuestSessionConfig = hasConfig
    ? (configOrCallbacks as GuestSessionConfig)
    : {
        name: "PLAYER",
        build: createDefaultBuild("GUEST"),
      };
  const callbacks = hasConfig
    ? optionalCallbacks
    : (configOrCallbacks as SessionCallbacks);
  const wire = config.wire ?? createPeerWire();
  let connection: WireConn;
  try {
    connection = await wire.join(normalizeRoomCode(roomCode));
  } catch (error) {
    wire.dispose();
    const message =
      error instanceof Error ? error.message : "Failed to join room";
    callbacks.onError?.(message);
    throw error;
  }
  return new GuestSessionImpl(wire, connection, config, callbacks);
}
