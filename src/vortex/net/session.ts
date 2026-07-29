import { createDefaultBuild, validateBuild } from "../content/build";
import {
  applyDraftPick,
  autoDraftPick,
  createDraftState,
  currentDraftPlayerIndex,
  draftBuildForPlayer,
  isDraftTurnExpired,
  withDraftPlayerCpu,
} from "../content/draft";
import {
  TOP_SLOTS,
  type DraftState,
  type PartId,
  type RogueBuildSpec,
  type TopBuildSpec,
  type VortexRoomSettings,
} from "../types";
import {
  autoChooseEndlessRewards,
  chooseEndlessReward,
  completeEndlessWave,
  createEndlessRun,
  generateEndlessEnemy,
  resolveRogueBuild,
  visualBuildFromRogue,
  type EndlessRunState,
} from "../endless";
import {
  createLaunchMeter,
  stopLaunchMeter,
  type LaunchMeterState,
} from "../launch";
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
  type VortexSessionEndReason,
  type VortexSnapshot,
  type EndlessStateView,
  type LaunchPhaseView,
  type VortexStartPayload,
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
  cpuLevel: 2,
};

export interface SessionCallbacks {
  onLobby?(lobby: VortexLobby): void;
  onRoomSettings?(settings: VortexRoomSettings): void;
  /**
   * Canonical host-authored draft state. `remainingMs` is sampled when the
   * update is sent and does not require the peers' monotonic clocks to match.
   */
  onDraftState?(draft: DraftState, remainingMs: number): void;
  onLaunchPhase?(launch: LaunchPhaseView): void;
  onEndlessState?(endless: EndlessStateView): void;
  onStart?(payload: VortexStartPayload): void;
  onSnapshot?(snapshot: VortexSnapshot): void;
  onResult?(result: VortexResult): void;
  onEnded?(reason: VortexSessionEndReason): void;
  onError?(message: string): void;
}

export interface VortexSession {
  readonly seat: SeatIndex | null;
  start(): Promise<void>;
  /** Replace the pre-match custom build. Guest sessions send it to the host. */
  updateBuild(build: TopBuildSpec): boolean;
  /**
   * Submit the current seat's draft choice. Returns false when no draft is
   * active, it is another seat's turn, or the host rejects a local choice.
   * Guest acceptance remains host-authoritative and arrives via onDraftState.
   */
  submitDraftPick(partId: PartId): boolean;
  /** Stop the local seat's current deterministic launch meter. */
  submitLaunchStop(elapsedMs: number): boolean;
  /** Select the local seat's current host-authored endless reward. */
  submitEndlessReward(partId: PartId): boolean;
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
  /** Deterministic test/replay injection; production uses createVortexSim. */
  readonly createSim?: typeof createVortexSim;
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
    mode:
      source.mode === "draft"
        ? "draft"
        : source.mode === "endless"
          ? "endless"
          : "custom",
    playerCount,
    cpuCount:
      source.mode === "endless"
        ? 0
        : Math.max(
            0,
            Math.min(
              playerCount - 1,
              Math.floor(source.cpuCount ?? playerCount - 1),
            ),
          ),
    seed: Number.isFinite(source.seed) ? source.seed >>> 0 : 1,
    draftTurnSec: 12,
    cpuLevel:
      source.cpuLevel === 1 || source.cpuLevel === 3 ? source.cpuLevel : 2,
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

function lobbyBuildCostLimit(settings: VortexRoomSettings): number {
  return settings.mode === "draft"
    ? Number.POSITIVE_INFINITY
    : settings.costLimit;
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

const LAUNCH_PHASE_DURATION_MS = 8_000;
const ENDLESS_REWARD_DURATION_MS = 15_000;

type AnyResolvedBuild = ResolvedTopBuild<
  TopBuildSpec | RogueBuildSpec
>;

interface PreparedMatch {
  readonly seed: number;
  readonly specs: readonly TopBuildSpec[];
  readonly resolved: readonly AnyResolvedBuild[];
  readonly names: readonly string[];
  readonly teamIds: readonly number[];
  readonly wave: number | null;
  readonly stackCounts: readonly (readonly number[])[];
  readonly cpuSeats: readonly SeatIndex[];
}

interface LaunchSubmission {
  readonly ok: boolean;
  readonly reason?: string;
}

interface ActiveLaunch {
  readonly phaseId: string;
  readonly kind: LaunchPhaseView["kind"];
  readonly round: number;
  readonly wave: number | null;
  readonly deadlineMs: number;
  readonly meters: readonly LaunchMeterState[];
  powers: readonly (number | null)[];
  readonly complete: (powers: readonly number[]) => void | Promise<void>;
}

class LaunchAuthority {
  private active: ActiveLaunch | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sequence = 0;

  constructor(
    private readonly idPrefix: string,
    private readonly publishView: (view: LaunchPhaseView) => void,
  ) {}

  begin(options: {
    readonly seed: number;
    readonly kind: LaunchPhaseView["kind"];
    readonly round: number;
    readonly wave: number | null;
    readonly seatCount: number;
    readonly cpuSeats: readonly SeatIndex[];
    readonly complete: (powers: readonly number[]) => void | Promise<void>;
  }): void {
    this.dispose();
    const phaseId = `${this.idPrefix}-${options.kind}-${options.round}-${++this.sequence}`;
    const meters = Array.from({ length: options.seatCount }, (_, seat) =>
      createLaunchMeter({
        seed:
          (options.seed ^
            Math.imul(options.round + 1, 0x9e37_79b1) ^
            Math.imul(seat + 1, 0x85eb_ca6b)) >>>
          0,
        durationMs: LAUNCH_PHASE_DURATION_MS,
      }),
    );
    const powers: (number | null)[] = Array.from(
      { length: options.seatCount },
      () => null,
    );
    const cpuSet = new Set<number>(options.cpuSeats);
    for (let seat = 0; seat < options.seatCount; seat += 1) {
      if (!cpuSet.has(seat)) continue;
      powers[seat] = this.cpuPower(meters[seat]!, seat);
    }
    this.active = {
      phaseId,
      kind: options.kind,
      round: options.round,
      wave: options.wave,
      deadlineMs: nowMilliseconds() + LAUNCH_PHASE_DURATION_MS,
      meters,
      powers,
      complete: options.complete,
    };
    this.publish();
    if (this.isComplete()) {
      this.finish();
      return;
    }
    this.timer = setTimeout(
      () => this.resolveTimeout(),
      LAUNCH_PHASE_DURATION_MS + 1,
    );
  }

  submit(
    seat: SeatIndex,
    phaseId: string,
    stoppedAtMs: number,
  ): LaunchSubmission {
    const active = this.active;
    if (!active || active.phaseId !== phaseId) {
      return { ok: false, reason: "発射フェーズが更新されています。" };
    }
    if (seat < 0 || seat >= active.meters.length) {
      return { ok: false, reason: "発射席が無効です。" };
    }
    if (active.powers[seat] !== null) {
      return { ok: false, reason: "この発射入力は確定済みです。" };
    }
    const spec = active.meters[seat]!.spec;
    if (
      !Number.isFinite(stoppedAtMs) ||
      stoppedAtMs < 0 ||
      stoppedAtMs > spec.durationMs
    ) {
      return { ok: false, reason: "発射タイミングが範囲外です。" };
    }
    const hostElapsed = Math.max(
      0,
      Math.min(
        spec.durationMs,
        spec.durationMs - (active.deadlineMs - nowMilliseconds()),
      ),
    );
    if (
      stoppedAtMs > hostElapsed + 150 ||
      stoppedAtMs < hostElapsed - 750
    ) {
      return {
        ok: false,
        reason: "発射タイミングがホスト時計と一致しません。",
      };
    }
    const verifiedElapsed = Math.min(stoppedAtMs, hostElapsed);
    const stopped = stopLaunchMeter(
      active.meters[seat]!,
      verifiedElapsed,
    );
    const power = stopped.result?.power;
    if (
      power === undefined ||
      !Number.isFinite(power) ||
      power < 0 ||
      power > 1.25
    ) {
      return { ok: false, reason: "発射威力を検証できません。" };
    }
    active.powers = active.powers.map((value, index) =>
      index === seat ? power : value,
    );
    this.publish();
    if (this.isComplete()) this.finish();
    return { ok: true };
  }

  makeCpu(seat: SeatIndex): void {
    const active = this.active;
    if (
      !active ||
      seat < 0 ||
      seat >= active.meters.length ||
      active.powers[seat] !== null
    ) {
      return;
    }
    const power = this.cpuPower(active.meters[seat]!, seat);
    active.powers = active.powers.map((value, index) =>
      index === seat ? power : value,
    );
    this.publish();
    if (this.isComplete()) this.finish();
  }

  currentView(): LaunchPhaseView | null {
    const active = this.active;
    if (!active) return null;
    return {
      v: 1,
      phaseId: active.phaseId,
      kind: active.kind,
      round: active.round,
      wave: active.wave,
      specs: active.meters.map((meter) => meter.spec),
      powers: [...active.powers],
      remainingMs: Math.max(0, active.deadlineMs - nowMilliseconds()),
    };
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.active = null;
  }

  private cpuPower(meter: LaunchMeterState, seat: number): number {
    const span = meter.spec.durationMs - 900;
    const elapsed =
      450 +
      ((meter.spec.seed + Math.imul(seat + 3, 977)) %
        Math.max(1, span));
    return stopLaunchMeter(meter, elapsed).result?.power ?? 0.6;
  }

  private publish(): void {
    const view = this.currentView();
    if (view) this.publishView(view);
  }

  private isComplete(): boolean {
    return this.active?.powers.every((power) => power !== null) === true;
  }

  private resolveTimeout(): void {
    const active = this.active;
    if (!active) return;
    active.powers = active.powers.map((power, seat) =>
      power ??
      stopLaunchMeter(
        active.meters[seat]!,
        active.meters[seat]!.spec.durationMs,
      ).result?.power ??
      0.6,
    );
    this.publish();
    this.finish();
  }

  private finish(): void {
    const active = this.active;
    if (!active || !active.powers.every((power) => power !== null)) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const powers = active.powers as readonly number[];
    this.active = null;
    void Promise.resolve(active.complete(powers));
  }
}

function normalStackCounts(count: number): readonly (readonly number[])[] {
  return Array.from({ length: count }, () =>
    TOP_SLOTS.map(() => 1),
  );
}

function rogueStackCounts(build: RogueBuildSpec): readonly number[] {
  return TOP_SLOTS.map((slot) => build.parts[slot].length);
}

function isRogueBuildSpec(
  build: TopBuildSpec | RogueBuildSpec,
): build is RogueBuildSpec {
  return Array.isArray(build.parts.crest);
}

function mixWaveSeed(seed: number, wave: number): number {
  let value = (seed ^ Math.imul(wave, 0x9e37_79b1)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb_352d);
  value = Math.imul(value ^ (value >>> 15), 0x846c_a68b);
  return (value ^ (value >>> 16)) >>> 0;
}

abstract class AuthoritativeLoop {
  protected sim: VortexSim | null = null;
  /*
   * The room's CPU aggression (protocol v2). Lives on the base because the
   * loop is where aiActivation runs; both subclasses set it from their
   * settings when the loop starts.
   */
  protected cpuLevel: 1 | 2 | 3 = 2;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private lastLoopAt = 0;
  private accumulator = 0;
  private stepsSinceSnapshot = 0;
  protected stopped = false;

  protected beginLoop(sim: VortexSim, cpuLevel: 1 | 2 | 3 = 2): void {
    this.cpuLevel = cpuLevel;
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
        for (let seat = 0; seat < 8; seat += 1) {
          const typedSeat = seatIndex(seat);
          const slot = aiActivation(sim, typedSeat, this.cpuLevel);
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
  private readonly launchAuthority: LaunchAuthority;

  constructor(
    private readonly config: SoloSessionConfig,
    private readonly callbacks: SessionCallbacks,
    private readonly settings: VortexRoomSettings,
  ) {
    super();
    this.launchAuthority = new LaunchAuthority(
      `solo-${settings.seed.toString(16)}`,
      (launch) =>
        safeCallback(
          () => this.callbacks.onLaunchPhase?.(launch),
          this.callbacks.onError,
        ),
    );
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
      const cpuSeats = Array.from(
        { length: Math.max(0, count - 1) },
        (_, index) => seatIndex(index + 1),
      );
      const prepared: PreparedMatch = {
        seed: this.settings.seed,
        specs: builds.map((build) => build.source),
        resolved: builds,
        names,
        teamIds: builds.map((_, seat) => seat),
        wave: null,
        stackCounts: normalStackCounts(builds.length),
        cpuSeats,
      };
      this.launchAuthority.begin({
        seed: this.settings.seed,
        kind: "match",
        round: 1,
        wave: null,
        seatCount: count,
        cpuSeats,
        complete: async (launchPowers) => {
          try {
            await this.launchPrepared(prepared, launchPowers);
          } catch (error) {
            this.started = false;
            this.callbacks.onError?.(
              error instanceof Error
                ? error.message
                : "Failed to start solo match",
            );
          }
        },
      });
    } catch (error) {
      this.started = false;
      this.callbacks.onError?.(
        error instanceof Error ? error.message : "Failed to start solo match",
      );
      throw error;
    }
  }

  private async launchPrepared(
    prepared: PreparedMatch,
    launchPowers: readonly number[],
  ): Promise<void> {
    const payload: VortexStartPayload = {
      seed: this.settings.seed,
      settings: this.settings,
      builds: prepared.specs,
      names: prepared.names,
      launchPowers,
      teamIds: prepared.teamIds,
      wave: null,
      stackCounts: prepared.stackCounts,
    };
    this.callbacks.onStart?.(payload);
    const sim = await createVortexSim({
      seed: this.settings.seed,
      builds: prepared.resolved,
      names: prepared.names,
      launchPower: launchPowers,
      teamIds: prepared.teamIds,
      arenaId: this.settings.arenaId as never,
      cpuSeats: prepared.cpuSeats,
      countdownSec: this.config.countdownSec,
      suddenDeathSec: this.config.suddenDeathSec,
      maxDurationSec: this.config.maxDurationSec,
    });
    if (this.disposed) {
      sim.dispose();
      return;
    }
    this.beginLoop(sim, this.settings.cpuLevel);
  }

  activate(slot: SkillSlot): SkillActivationResult | null {
    return this.sim?.activate(this.seat, slot) ?? null;
  }

  updateBuild(_build: TopBuildSpec): boolean {
    return false;
  }

  submitDraftPick(_partId: PartId): boolean {
    return false;
  }

  submitLaunchStop(elapsedMs: number): boolean {
    const phase = this.launchAuthority.currentView();
    if (!phase || this.disposed) return false;
    return this.launchAuthority.submit(
      this.seat,
      phase.phaseId,
      elapsedMs,
    ).ok;
  }

  submitEndlessReward(_partId: PartId): boolean {
    return false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.launchAuthority.dispose();
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
  private draftState: DraftState | null = null;
  private draftTimer: ReturnType<typeof setTimeout> | null = null;
  private completingDraft = false;
  private readonly launchAuthority: LaunchAuthority;
  private endlessRun: EndlessRunState | null = null;
  private endlessView: EndlessStateView | null = null;
  private endlessRevision = 0;
  private rewardTimer: ReturnType<typeof setTimeout> | null = null;
  private rewardDeadlineMs = 0;

  constructor(
    private readonly wire: Wire,
    private readonly roomCode: string,
    private readonly config: HostSessionConfig,
    private readonly callbacks: SessionCallbacks,
    private readonly settings: VortexRoomSettings,
    private readonly resolver: NetworkBuildResolver,
  ) {
    super();
    this.launchAuthority = new LaunchAuthority(
      `host-${roomCode}`,
      (launch) => this.publishLaunchPhase(launch),
    );
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
    const validation = validateBuild(
      this.config.build,
      lobbyBuildCostLimit(this.settings),
    );
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
      this.sim !== null ||
      this.endlessRun !== null
    ) {
      return;
    }
    const humanSeats = this.seats
      .slice(0, this.settings.playerCount)
      .filter(
        (seat) => seat.occupant === "host" || seat.occupant === "guest",
      );
    const waitingForHuman = humanSeats.some(
      (seat) =>
        !seat.ready ||
        (this.settings.mode === "custom" && seat.build === null),
    );
    /*
     * Endless used to demand a real player in every seat, which made the
     * game's deepest mode (~1,900 lines of engine) effectively dead code:
     * it required 2-4 simultaneous humans on a personal site. Occupied
     * seats must still be ready with a build; vacant seats become CPUs,
     * exactly like every other mode. The engine side never cared — it has
     * carried a cpuSeats list and a disconnect-to-CPU handover all along.
     */
    const endlessNotReady =
      this.settings.mode === "endless" &&
      humanSeats.some((seat) => !seat.ready || seat.build === null);
    if (waitingForHuman || endlessNotReady) {
      const message =
        this.settings.mode === "draft"
          ? "参加プレイヤーの準備完了を待っています。"
          : this.settings.mode === "endless"
            ? "参加中プレイヤー全員のREADYとビルドが必要です。"
          : "参加プレイヤーのビルド確定を待っています。";
      this.callbacks.onError?.(message);
      throw new Error(message);
    }
    this.starting = true;
    try {
      if (this.settings.mode === "draft") {
        this.beginDraft();
        return;
      }
      if (this.settings.mode === "endless") {
        for (let seat = 0; seat < this.settings.playerCount; seat += 1) {
          if (!this.seats[seat]!.build) this.fillVacantSeat(seat);
        }
        this.publishLobby();
        this.beginEndlessRun();
        return;
      }
      await this.launchMatch();
    } catch (error) {
      this.failStart(error);
      throw error;
    }
  }

  submitDraftPick(partId: PartId): boolean {
    return this.acceptDraftPick(this.seat, partId, this.draftRevision());
  }

  submitLaunchStop(elapsedMs: number): boolean {
    const phase = this.launchAuthority.currentView();
    if (!phase || this.disposed) return false;
    return this.launchAuthority.submit(
      this.seat,
      phase.phaseId,
      elapsedMs,
    ).ok;
  }

  submitEndlessReward(partId: PartId): boolean {
    return this.acceptEndlessReward(this.seat, partId, this.endlessRevision);
  }

  updateBuild(_build: TopBuildSpec): boolean {
    return false;
  }

  activate(slot: SkillSlot): SkillActivationResult | null {
    return this.sim?.activate(this.seat, slot) ?? null;
  }

  private beginDraft(): void {
    const players = Array.from(
      { length: this.settings.playerCount },
      (_, seat) => {
        const current = this.seats[seat]!;
        if (current.occupant === "empty") {
          this.seats[seat] = {
            ...current,
            name: `CPU ${seat + 1}`,
            occupant: "cpu",
            ready: true,
            build: null,
          };
        }
        const participant = this.seats[seat]!;
        return {
          id: `seat-${seat + 1}`,
          name: participant.name,
          isCpu: participant.occupant === "cpu",
        };
      },
    );
    this.draftState = createDraftState({
      players,
      costLimit: this.settings.costLimit,
      seed: this.settings.seed,
      nowMs: nowMilliseconds(),
    });
    this.publishLobby();
    this.publishDraftState();
    this.advanceDraft();
  }

  private draftRevision(): number {
    return this.draftState?.claimedPartIds.length ?? -1;
  }

  private acceptDraftPick(
    seat: SeatIndex,
    partId: PartId,
    revision: number,
    connection?: WireConn,
  ): boolean {
    const draft = this.draftState;
    const reject = (reason: string): false => {
      if (connection) {
        connection.send({ t: "reject", reason } satisfies HostMessage);
      } else {
        this.callbacks.onError?.(reason);
      }
      return false;
    };
    if (
      this.disposed ||
      this.settings.mode !== "draft" ||
      draft === null ||
      draft.completed ||
      this.completingDraft ||
      this.sim !== null
    ) {
      return reject("進行中のドラフトがありません。");
    }
    if (revision !== draft.claimedPartIds.length) {
      return reject("ドラフト状態が更新されています。最新状態から選び直してください。");
    }
    if (currentDraftPlayerIndex(draft) !== seat) {
      return reject("現在はこのプレイヤーの手番ではありません。");
    }
    try {
      this.draftState = applyDraftPick(draft, partId, nowMilliseconds());
      this.publishDraftState();
      this.advanceDraft();
      return true;
    } catch (error) {
      return reject(
        error instanceof Error ? error.message : "ドラフト選択を確定できません。",
      );
    }
  }

  private advanceDraft(nowMs = nowMilliseconds()): void {
    this.clearDraftTimer();
    let draft = this.draftState;
    if (
      this.disposed ||
      draft === null ||
      draft.completed ||
      this.completingDraft
    ) {
      if (draft?.completed) this.completeDraft();
      return;
    }
    for (let guard = 0; guard < 28 && !draft.completed; guard += 1) {
      const playerIndex = currentDraftPlayerIndex(draft);
      if (playerIndex === null) break;
      const player = draft.players[playerIndex]!;
      if (!player.isCpu && !isDraftTurnExpired(draft, nowMs)) break;
      draft = autoDraftPick(draft, nowMs);
      this.draftState = draft;
      this.publishDraftState();
    }
    if (draft.completed) {
      this.completeDraft();
      return;
    }
    const delayMs = Math.max(0, draft.deadlineMs - nowMilliseconds());
    this.draftTimer = setTimeout(
      () => this.advanceDraft(nowMilliseconds()),
      delayMs + 1,
    );
  }

  private completeDraft(): void {
    const draft = this.draftState;
    if (
      this.disposed ||
      this.completingDraft ||
      draft === null ||
      !draft.completed
    ) {
      return;
    }
    this.completingDraft = true;
    this.clearDraftTimer();
    try {
      const specs = draft.players.map((player, seat) =>
        draftBuildForPlayer(draft, seat, player.name),
      );
      for (let seat = 0; seat < this.settings.playerCount; seat += 1) {
        this.seats[seat] = {
          ...this.seats[seat]!,
          ready: true,
          build: specs[seat]!,
        };
      }
      this.publishLobby();
      void this.launchMatch(specs).catch((error: unknown) => {
        this.completingDraft = false;
        this.failStart(error);
      });
    } catch (error) {
      this.completingDraft = false;
      this.failStart(error);
    }
  }

  private beginEndlessRun(): void {
    const players = this.seats
      .slice(0, this.settings.playerCount)
      .map((seat) => {
        if (!seat.build) {
          throw new Error(`${seat.name}の初期ビルドがありません。`);
        }
        return {
          id: `seat-${seat.seat + 1}`,
          name: seat.name,
          build: seat.build,
        };
      });
    this.endlessRun = createEndlessRun(this.settings.seed, players);
    this.endlessRevision = 1;
    this.endlessView = {
      v: 1,
      revision: this.endlessRevision,
      phase: "battle",
      run: this.endlessRun,
      remainingMs: 0,
      gameOver: null,
    };
    this.publishEndlessState();
    this.beginEndlessWaveLaunch();
  }

  private beginEndlessWaveLaunch(): void {
    const run = this.endlessRun;
    if (this.disposed || !run || run.phase !== "battle") return;
    this.starting = true;
    this.matchStarted = false;
    const playerResolved = run.players.map((player) =>
      resolveRogueBuild(player.build),
    );
    const enemyCount = this.settings.playerCount === 2 ? 1 : 2;
    const enemies = Array.from({ length: enemyCount }, (_, variant) =>
      generateEndlessEnemy(run.seed, run.wave, variant),
    );
    const specs: TopBuildSpec[] = [
      ...run.players.map((player) => visualBuildFromRogue(player.build)),
      ...enemies.map((enemy) => enemy.visualBuild),
    ];
    const resolved: AnyResolvedBuild[] = [
      ...playerResolved,
      ...enemies.map((enemy) => enemy.resolved),
    ];
    const names = [
      ...run.players.map((player) => player.name),
      ...enemies.map((enemy, index) =>
        enemy.isBoss
          ? `BOSS ${run.wave}-${index + 1}`
          : `ENEMY ${run.wave}-${index + 1}`,
      ),
    ];
    const teamIds = [
      ...run.players.map(() => 0),
      ...enemies.map(() => 1),
    ];
    const stackCounts = [
      ...run.players.map((player) => rogueStackCounts(player.build)),
      ...enemies.map((enemy) =>
        isRogueBuildSpec(enemy.sourceBuild)
          ? rogueStackCounts(enemy.sourceBuild)
          : TOP_SLOTS.map(() => 1),
      ),
    ];
    const cpuSeats = [
      ...this.seats
        .slice(0, this.settings.playerCount)
        .filter((seat) => seat.occupant === "cpu")
        .map((seat) => seat.seat),
      ...enemies.map((_, index) =>
        seatIndex(this.settings.playerCount + index),
      ),
    ];
    const waveSeed = mixWaveSeed(run.seed, run.wave);
    const prepared: PreparedMatch = {
      seed: waveSeed,
      specs,
      resolved,
      names,
      teamIds,
      wave: run.wave,
      stackCounts,
      cpuSeats,
    };
    this.launchAuthority.begin({
      seed: waveSeed,
      kind: "endless",
      round: run.wave,
      wave: run.wave,
      seatCount: specs.length,
      cpuSeats,
      complete: async (launchPowers) => {
        try {
          await this.startPreparedMatch(prepared, launchPowers);
        } catch (error) {
          this.failStart(error);
        }
      },
    });
  }

  private beginEndlessReward(): void {
    const run = this.endlessRun;
    if (!run || run.phase !== "battle") return;
    this.clearRewardTimer();
    this.endlessRun = completeEndlessWave(run);
    this.endlessRevision += 1;
    this.rewardDeadlineMs =
      nowMilliseconds() + ENDLESS_REWARD_DURATION_MS;
    this.endlessView = {
      v: 1,
      revision: this.endlessRevision,
      phase: "reward",
      run: this.endlessRun,
      remainingMs: ENDLESS_REWARD_DURATION_MS,
      gameOver: null,
    };
    this.publishEndlessState();

    for (const seat of this.seats.slice(0, this.settings.playerCount)) {
      if (seat.occupant !== "cpu") continue;
      const offer = this.endlessRun.rewardOffers.find(
        (candidate) => candidate.playerId === `seat-${seat.seat + 1}`,
      );
      const choice = offer?.choices[0];
      if (offer && choice) {
        this.acceptEndlessReward(
          seat.seat,
          choice.partId,
          this.endlessRevision,
          undefined,
          offer.id,
        );
      }
    }
    if (this.endlessRun?.phase === "reward") {
      this.rewardTimer = setTimeout(
        () => this.resolveEndlessRewardTimeout(),
        ENDLESS_REWARD_DURATION_MS + 1,
      );
    }
  }

  private acceptEndlessReward(
    seat: SeatIndex,
    partId: PartId,
    revision: number,
    connection?: WireConn,
    offerId?: string,
  ): boolean {
    const reject = (reason: string): false => {
      if (connection) {
        connection.send({ t: "reject", reason } satisfies HostMessage);
      } else {
        this.callbacks.onError?.(reason);
      }
      return false;
    };
    const run = this.endlessRun;
    if (
      this.disposed ||
      !run ||
      run.phase !== "reward" ||
      this.endlessView?.phase !== "reward"
    ) {
      return reject("進行中のENDLESS報酬選択がありません。");
    }
    if (revision !== this.endlessRevision) {
      return reject("ENDLESS報酬状態が更新されています。");
    }
    if (seat < 0 || seat >= this.settings.playerCount) {
      return reject("ENDLESSプレイヤー席が無効です。");
    }
    const playerId = `seat-${seat + 1}`;
    const offer = run.rewardOffers.find(
      (candidate) => candidate.playerId === playerId,
    );
    if (!offer || offer.selectedPartId !== null) {
      return reject("この報酬は選択済みです。");
    }
    if (offerId !== undefined && offer.id !== offerId) {
      return reject("報酬オファーIDが一致しません。");
    }
    if (!offer.choices.some((choice) => choice.partId === partId)) {
      return reject("提示されていない報酬は選べません。");
    }
    try {
      const next = chooseEndlessReward(run, playerId, partId);
      this.endlessRun = next;
      if (next.phase === "battle") {
        this.finishEndlessRewards();
      } else {
        this.endlessView = {
          v: 1,
          revision: this.endlessRevision,
          phase: "reward",
          run: next,
          remainingMs: Math.max(
            0,
            this.rewardDeadlineMs - nowMilliseconds(),
          ),
          gameOver: null,
        };
        this.publishEndlessState();
      }
      return true;
    } catch (error) {
      return reject(
        error instanceof Error
          ? error.message
          : "ENDLESS報酬を確定できません。",
      );
    }
  }

  private resolveEndlessRewardTimeout(): void {
    const run = this.endlessRun;
    if (!run || run.phase !== "reward") return;
    this.endlessRun = autoChooseEndlessRewards(run);
    this.finishEndlessRewards();
  }

  private finishEndlessRewards(): void {
    const run = this.endlessRun;
    if (!run || run.phase !== "battle") return;
    this.clearRewardTimer();
    this.endlessRevision += 1;
    this.endlessView = {
      v: 1,
      revision: this.endlessRevision,
      phase: "battle",
      run,
      remainingMs: 0,
      gameOver: null,
    };
    this.publishEndlessState();
    queueMicrotask(() => this.beginEndlessWaveLaunch());
  }

  private finishEndlessGame(result: VortexResult): void {
    const run = this.endlessRun;
    if (!run) return;
    this.clearRewardTimer();
    this.endlessRevision += 1;
    const cleared = run.clearedWaves;
    const score = Math.min(
      Number.MAX_SAFE_INTEGER,
      cleared * 1_000 + Math.round(result.durationSec),
    );
    this.endlessView = {
      v: 1,
      revision: this.endlessRevision,
      phase: "game-over",
      run,
      remainingMs: 0,
      gameOver: {
        wave: run.wave,
        cleared,
        score,
      },
    };
    this.publishEndlessState();
  }

  private publishLaunchPhase(launch: LaunchPhaseView): void {
    // Broadcast the exact canonical revision before a local callback can
    // synchronously submit and publish the next revision.
    this.broadcast({ t: "launch", launch });
    safeCallback(
      () => this.callbacks.onLaunchPhase?.(launch),
      this.callbacks.onError,
    );
  }

  private publishEndlessState(): void {
    const current = this.endlessView;
    if (!current) return;
    const endless: EndlessStateView =
      current.phase === "reward"
        ? {
            ...current,
            run: this.endlessRun ?? current.run,
            remainingMs: Math.max(
              0,
              this.rewardDeadlineMs - nowMilliseconds(),
            ),
          }
        : {
            ...current,
            run: this.endlessRun ?? current.run,
          };
    this.endlessView = endless;
    this.broadcast({ t: "endless", endless });
    safeCallback(
      () => this.callbacks.onEndlessState?.(endless),
      this.callbacks.onError,
    );
  }

  private clearRewardTimer(): void {
    if (this.rewardTimer !== null) clearTimeout(this.rewardTimer);
    this.rewardTimer = null;
    this.rewardDeadlineMs = 0;
  }

  /** Turns one vacant seat into a ready CPU. The single fill rule. */
  private fillVacantSeat(seat: number): TopBuildSpec {
    const current = this.seats[seat]!;
    const build =
      this.config.cpuBuilds?.[seat - 1] ??
      this.config.cpuBuilds?.[0] ??
      this.config.build;
    this.seats[seat] = {
      ...current,
      name: `CPU ${seat + 1}`,
      occupant: "cpu",
      ready: true,
      build,
    };
    return build;
  }

  private async launchMatch(
    draftedSpecs?: readonly TopBuildSpec[],
  ): Promise<void> {
    const resolved: ResolvedTopBuild<TopBuildSpec>[] = [];
    const specs: TopBuildSpec[] = [];
    const names: string[] = [];
    for (let seat = 0; seat < this.settings.playerCount; seat += 1) {
      const current = this.seats[seat]!;
      const build =
        draftedSpecs?.[seat] ?? current.build ?? this.fillVacantSeat(seat);
      specs.push(build);
      names.push(this.seats[seat]!.name);
      resolved.push(this.resolver(build, this.settings));
    }
    const cpuSeats = this.seats
      .slice(0, this.settings.playerCount)
      .filter((seat) => seat.occupant === "cpu")
      .map((seat) => seat.seat);
    const prepared: PreparedMatch = {
      seed: this.settings.seed,
      specs,
      resolved,
      names,
      teamIds: specs.map((_, seat) => seat),
      wave: null,
      stackCounts: normalStackCounts(specs.length),
      cpuSeats,
    };
    this.publishLobby();
    this.launchAuthority.begin({
      seed: this.settings.seed,
      kind: "match",
      round: 1,
      wave: null,
      seatCount: specs.length,
      cpuSeats,
      complete: async (launchPowers) => {
        try {
          await this.startPreparedMatch(prepared, launchPowers);
        } catch (error) {
          this.failStart(error);
        }
      },
    });
  }

  private async startPreparedMatch(
    prepared: PreparedMatch,
    launchPowers: readonly number[],
  ): Promise<void> {
    const payload: VortexStartPayload = {
      seed: prepared.seed,
      settings: this.settings,
      builds: prepared.specs,
      names: prepared.names,
      launchPowers,
      teamIds: prepared.teamIds,
      wave: prepared.wave,
      stackCounts: prepared.stackCounts,
    };
    this.broadcast({ t: "start", ...payload });
    this.callbacks.onStart?.(payload);
    const sim = await (this.config.createSim ?? createVortexSim)({
      seed: prepared.seed,
      builds: prepared.resolved,
      names: prepared.names,
      launchPower: launchPowers,
      teamIds: prepared.teamIds,
      arenaId: this.settings.arenaId as never,
      cpuSeats: prepared.cpuSeats,
    });
    if (this.disposed) {
      sim.dispose();
      return;
    }
    // A guest can leave while Rapier is initializing after the canonical
    // start payload has been sent.
    for (const lobbySeat of this.seats.slice(0, this.settings.playerCount)) {
      if (lobbySeat.occupant === "cpu") sim.setCpu(lobbySeat.seat, true);
    }
    this.matchStarted = true;
    this.starting = false;
    this.completingDraft = false;
    this.beginLoop(sim, this.settings.cpuLevel);
  }

  private failStart(error: unknown): void {
    this.starting = false;
    const message =
      error instanceof Error ? error.message : "Failed to start hosted match";
    this.callbacks.onError?.(message);
    this.broadcast({ t: "reject", reason: message });
  }

  private publishDraftState(): void {
    const draft = this.draftState;
    if (!draft) return;
    const remainingMs = draft.completed
      ? 0
      : Math.max(0, draft.deadlineMs - nowMilliseconds());
    safeCallback(
      () => this.callbacks.onDraftState?.(draft, remainingMs),
      this.callbacks.onError,
    );
    this.broadcast({ t: "draft", draft, remainingMs });
  }

  private clearDraftTimer(): void {
    if (this.draftTimer !== null) clearTimeout(this.draftTimer);
    this.draftTimer = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearDraftTimer();
    this.clearRewardTimer();
    this.launchAuthority.dispose();
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
    if (this.endlessRun !== null) {
      this.matchStarted = false;
      this.starting = false;
      if (result.winnerTeam === 0) {
        this.beginEndlessReward();
      } else {
        this.finishEndlessGame(result);
      }
      return;
    }
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
    if (
      this.disposed ||
      this.matchStarted ||
      this.starting ||
      this.endlessRun !== null
    ) {
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
      const validation = validateBuild(
        message.build,
        Number.POSITIVE_INFINITY,
      );
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
    if (message.t === "launch-stop") {
      const verdict = this.launchAuthority.submit(
        guest.seat,
        message.phaseId,
        message.stoppedAtMs,
      );
      if (!verdict.ok) {
        guest.connection.send({
          t: "reject",
          reason: verdict.reason ?? "発射入力を確定できません。",
        } satisfies HostMessage);
      }
      return;
    }
    if (message.t === "endless-pick") {
      this.acceptEndlessReward(
        guest.seat,
        message.partId,
        message.revision,
        guest.connection,
        message.offerId,
      );
      return;
    }
    if (message.t === "skill") {
      if (!this.sim || message.seq <= guest.lastSkillSequence) return;
      const receivedAt = nowMilliseconds();
      if (receivedAt - guest.lastSkillReceivedAt < 50) return;
      guest.lastSkillSequence = message.seq;
      guest.lastSkillReceivedAt = receivedAt;
      this.sim.activate(guest.seat, message.slot);
      return;
    }
    if (message.t === "draft-pick") {
      this.acceptDraftPick(
        guest.seat,
        message.partId,
        message.revision,
        guest.connection,
      );
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
      if (
        message.ready &&
        this.settings.mode !== "draft" &&
        guest.build !== null
      ) {
        const validation = validateBuild(
          guest.build,
          this.settings.costLimit,
        );
        if (!validation.ok) {
          guest.ready = false;
          this.seats[guest.seat] = {
            ...this.seats[guest.seat]!,
            ready: false,
          };
          guest.connection.send({
            t: "reject",
            reason: validation.errors.map((issue) => issue.message).join(" / "),
          } satisfies HostMessage);
          this.publishLobby();
          return;
        }
      }
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
    const disconnectedSeat = guest.seat;
    const current = this.seats[disconnectedSeat]!;
    if (this.sim) {
      this.seats[disconnectedSeat] = {
        ...current,
        name: `CPU ${disconnectedSeat + 1}`,
        occupant: "cpu",
        ready: true,
      };
      this.sim.setCpu(disconnectedSeat, true);
    } else if (this.draftState && this.starting) {
      this.seats[disconnectedSeat] = {
        ...current,
        name: `CPU ${disconnectedSeat + 1}`,
        occupant: "cpu",
        ready: true,
      };
      if (!this.draftState.completed) {
        this.draftState = withDraftPlayerCpu(
          this.draftState,
          disconnectedSeat,
        );
        this.publishDraftState();
        this.advanceDraft();
      }
    } else if (this.launchAuthority.currentView() !== null) {
      this.seats[disconnectedSeat] = {
        ...current,
        name: `CPU ${disconnectedSeat + 1}`,
        occupant: "cpu",
        ready: true,
      };
      this.launchAuthority.makeCpu(disconnectedSeat);
    } else if (this.endlessRun !== null) {
      this.seats[disconnectedSeat] = {
        ...current,
        name: `CPU ${disconnectedSeat + 1}`,
        occupant: "cpu",
        ready: true,
      };
      if (this.endlessRun.phase === "reward") {
        const offer = this.endlessRun.rewardOffers.find(
          (candidate) =>
            candidate.playerId === `seat-${disconnectedSeat + 1}` &&
            candidate.selectedPartId === null,
        );
        const choice = offer?.choices[0];
        if (offer && choice) {
          this.acceptEndlessReward(
            disconnectedSeat,
            choice.partId,
            this.endlessRevision,
            undefined,
            offer.id,
          );
        }
      }
    } else if (this.starting || this.matchStarted) {
      this.seats[disconnectedSeat] = {
        ...current,
        name: `CPU ${disconnectedSeat + 1}`,
        occupant: "cpu",
        ready: true,
      };
    } else {
      this.seats[disconnectedSeat] = {
        ...current,
        name: `CPU ${disconnectedSeat + 1}`,
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
  private endedNotified = false;
  private draftState: DraftState | null = null;
  private launchView: LaunchPhaseView | null = null;
  private launchSubmittedPhaseId: string | null = null;
  private endlessView: EndlessStateView | null = null;
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
      if (this.notifyEnded("host-left")) {
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

  updateBuild(build: TopBuildSpec): boolean {
    if (this.disposed || this.currentSeat === null) return false;
    this.ready = false;
    this.connection.send({ t: "build", build } satisfies ClientMessage);
    return true;
  }

  submitDraftPick(partId: PartId): boolean {
    const draft = this.draftState;
    if (
      this.disposed ||
      this.currentSeat === null ||
      draft === null ||
      draft.completed ||
      currentDraftPlayerIndex(draft) !== this.currentSeat
    ) {
      return false;
    }
    this.connection.send({
      t: "draft-pick",
      partId,
      revision: draft.claimedPartIds.length,
    } satisfies ClientMessage);
    return true;
  }

  submitLaunchStop(elapsedMs: number): boolean {
    const launch = this.launchView;
    const seat = this.currentSeat;
    if (
      this.disposed ||
      seat === null ||
      launch === null ||
      launch.powers[seat] !== null ||
      this.launchSubmittedPhaseId === launch.phaseId ||
      !Number.isFinite(elapsedMs) ||
      elapsedMs < 0 ||
      elapsedMs > launch.specs[seat]!.durationMs
    ) {
      return false;
    }
    this.launchSubmittedPhaseId = launch.phaseId;
    this.connection.send({
      t: "launch-stop",
      phaseId: launch.phaseId,
      stoppedAtMs: elapsedMs,
    } satisfies ClientMessage);
    return true;
  }

  submitEndlessReward(partId: PartId): boolean {
    const endless = this.endlessView;
    const seat = this.currentSeat;
    if (
      this.disposed ||
      seat === null ||
      endless === null ||
      endless.phase !== "reward"
    ) {
      return false;
    }
    const offer = endless.run.rewardOffers.find(
      (candidate) =>
        candidate.playerId === `seat-${seat + 1}` &&
        candidate.selectedPartId === null,
    );
    if (
      !offer ||
      !offer.choices.some((choice) => choice.partId === partId)
    ) {
      return false;
    }
    this.connection.send({
      t: "endless-pick",
      revision: endless.revision,
      offerId: offer.id,
      partId,
    } satisfies ClientMessage);
    return true;
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
        this.callbacks.onRoomSettings?.(payload.settings);
        return;
      case "lobby":
        this.callbacks.onLobby?.(payload.lobby);
        return;
      case "draft":
        this.draftState = payload.draft;
        this.callbacks.onDraftState?.(payload.draft, payload.remainingMs);
        return;
      case "launch":
        this.launchView = payload.launch;
        if (
          this.launchSubmittedPhaseId !== payload.launch.phaseId ||
          (this.currentSeat !== null &&
            payload.launch.powers[this.currentSeat] !== null)
        ) {
          this.launchSubmittedPhaseId = null;
        }
        this.callbacks.onLaunchPhase?.(payload.launch);
        return;
      case "endless":
        this.endlessView = payload.endless;
        this.callbacks.onEndlessState?.(payload.endless);
        return;
      case "start":
        this.launchView = null;
        this.launchSubmittedPhaseId = null;
        this.callbacks.onStart?.({
          seed: payload.seed,
          settings: payload.settings,
          builds: payload.builds,
          names: payload.names,
          launchPowers: payload.launchPowers,
          teamIds: payload.teamIds,
          wave: payload.wave,
          stackCounts: payload.stackCounts,
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
        if (this.notifyEnded(payload.reason)) {
          this.callbacks.onError?.(
            payload.reason === "host-left"
              ? "Host disconnected"
              : "Host ended the room",
          );
        }
        return;
    }
  }

  private notifyEnded(reason: VortexSessionEndReason): boolean {
    if (this.disposed || this.endedNotified) return false;
    this.endedNotified = true;
    this.stopInterpolation();
    this.callbacks.onEnded?.(reason);
    return true;
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
