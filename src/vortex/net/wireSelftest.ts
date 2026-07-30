import {
  createDefaultBuild,
  validateBuild,
} from "../content/build";
import {
  createDraftState,
  currentDraftPlayerIndex,
  legalDraftPicks,
} from "../content/draft";
import { getPartsForSlot } from "../content/catalog";
import { createEndlessRun } from "../endless";
import { createLaunchMeter } from "../launch";
import {
  RING_ARENAS,
  type CreateVortexSimOptions,
  type MatchResult,
  type MatchState,
  type SeatIndex,
  type SkillActivationResult,
  type SkillSlot,
  type VortexSim,
} from "../sim";
import {
  TOP_SLOTS,
  type DraftState,
  type TopBuildSpec,
  type VortexPlayerCount,
  type VortexRoomSettings,
} from "../types";
import {
  isHostMessage,
  type HostMessage,
  type LaunchPhaseView,
  type VortexSnapshot,
  type WireConn,
  VORTEX_PROTOCOL_VERSION,
} from "./protocol";
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

/*
 * A harness timeout, not a performance budget. It waits for asynchronous
 * message delivery, so exceeding it on a loaded machine says nothing about the
 * protocol - it says the event loop was busy. 2500ms was tight enough to turn
 * that into a red gate; 15s still catches a genuine hang in seconds of human
 * patience while never firing for load.
 */
async function waitFor(
  predicate: () => boolean,
  message: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await delay(10);
  }
}

function scriptedTeamSimFactory(
  winners: readonly (0 | 1 | null)[],
): <TSource>(
  options: CreateVortexSimOptions<TSource>,
) => Promise<VortexSim> {
  let battleIndex = 0;
  return async <TSource>(
    options: CreateVortexSimOptions<TSource>,
  ): Promise<VortexSim> => {
    const winnerTeam =
      winners[Math.min(battleIndex, winners.length - 1)] ?? null;
    battleIndex += 1;
    let tick = 0;
    let disposed = false;
    const cpu = new Set<number>(options.cpuSeats ?? []);
    const teams = options.teamIds ?? options.builds.map((_, seat) => seat);
    const activeSeats = options.builds
      .map((build, seat) => (build === null ? null : seat))
      .filter((seat): seat is number => seat !== null);
    const winnerSeat =
      winnerTeam === null
        ? null
        : (activeSeats.find((seat) => teams[seat] === winnerTeam) ?? null);
    const matchResult = (): MatchResult => ({
      winner:
        winnerSeat === null ? null : (winnerSeat as SeatIndex),
      winnerTeam,
      reason: winnerTeam === null ? "draw" : "destroyed",
      durationSec: 0.05,
      knockouts:
        winnerTeam === null
          ? []
          : activeSeats
              .filter((seat) => teams[seat] !== winnerTeam)
              .map((seat) => ({
                seat: seat as SeatIndex,
                reason: "destroyed" as const,
                at: 0.05,
              })),
    });
    const getState = (): MatchState => ({
      tick,
      elapsed: tick / 60,
      phase: tick > 0 ? "over" : "live",
      suddenDeathStage: 0,
      arenaId: RING_ARENAS[0]!.id,
      tops: activeSeats.map((seat) => {
        const alive = tick === 0 || teams[seat] === winnerTeam;
        return {
          seat: seat as SeatIndex,
          name: options.names?.[seat] ?? `TOP ${seat + 1}`,
          alive,
          phasing: false,
          hp: alive ? 100 : 0,
          hpMax: 100,
          spin: alive ? 80 : 0,
          position: [seat * 0.2, 0, 0] as const,
          rotation: [0, 0, 0, 1] as const,
          velocity: [0, 0, 0] as const,
          skills: [],
          lastHitAt: -1,
          cpu: cpu.has(seat),
        };
      }),
    });
    const rejected = (
      seat: SeatIndex,
      slot: SkillSlot,
    ): SkillActivationResult => ({
      ok: false,
      seat,
      slot,
      reason: "empty-slot",
    });
    return {
      get tick() {
        return tick;
      },
      get elapsed() {
        return tick / 60;
      },
      get phase() {
        return tick > 0 ? "over" : "live";
      },
      arena: RING_ARENAS[0]!,
      step() {
        if (!disposed) tick += 1;
      },
      activate: rejected,
      canActivate: rejected,
      setCpu(seat, enabled) {
        if (enabled) cpu.add(seat);
        else cpu.delete(seat);
      },
      isCpu(seat) {
        return cpu.has(seat);
      },
      getState,
      drainEvents() {
        return [];
      },
      result() {
        return tick > 0 ? matchResult() : null;
      },
      diagnostics() {
        return {
          rigidBodies: activeSeats.length,
          colliders: activeSeats.length,
          topRigidBodies: activeSeats.length,
          topColliders: activeSeats.map(() => 1),
          passiveTriggers: [],
          stepCount: tick,
        };
      },
      dispose() {
        disposed = true;
      },
    };
  };
}

function overBudgetDraftPlaceholder(name: string): TopBuildSpec {
  const base = createDefaultBuild(name);
  const parts = Object.fromEntries(
    TOP_SLOTS.map((slot) => {
      const mostExpensive = [...getPartsForSlot(slot)].sort(
        (first, second) =>
          second.cost - first.cost || first.id.localeCompare(second.id),
      )[0]!;
      return [slot, mostExpensive.id];
    }),
  ) as TopBuildSpec["parts"];
  const build = { ...base, name, parts };
  if (!validateBuild(build, Number.POSITIVE_INFINITY).ok) {
    throw new Error("draft placeholder structural validation failed");
  }
  if (validateBuild(build, 700).ok) {
    throw new Error("draft placeholder must exceed the room budget");
  }
  return build;
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
      phasing: false,
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
        skills: [
          {
            slot: 1,
            skillId: "stacked-test",
            cooldown: 0,
            charges: -1,
            ready: true,
            blocked: null,
            groupSize: 3,
            readyCount: 2,
          },
        ],
      },
    ],
    events: [],
  };
}

function hostMessageGuardGate(): void {
  const settings = {
    costLimit: 700,
    arenaId: "core-bowl",
    mode: "custom",
    playerCount: 2,
    cpuCount: 0,
    seed: 0x51afe,
    draftTurnSec: 12,
    cpuLevel: 2,
  } satisfies VortexRoomSettings;
  const build = createDefaultBuild("GUARD-BUILD");
  const lobby = {
    roomCode: "GUARD1",
    settings,
    seats: [
      {
        seat: 0,
        name: "HOST",
        occupant: "host",
        ready: true,
        build,
      },
      {
        seat: 1,
        name: "GUEST",
        occupant: "guest",
        ready: false,
        build,
      },
      {
        seat: 2,
        name: "CPU 3",
        occupant: "empty",
        ready: false,
        build: null,
      },
      {
        seat: 3,
        name: "CPU 4",
        occupant: "empty",
        ready: false,
        build: null,
      },
    ],
  } as const;
  const draft = createDraftState({
    players: [
      { id: "seat-1", name: "HOST", isCpu: false },
      { id: "seat-2", name: "GUEST", isCpu: false },
    ],
    costLimit: 700,
    seed: settings.seed,
    nowMs: 0,
  });
  const launchSpec = createLaunchMeter({
    seed: settings.seed,
    durationMs: 8_000,
  }).spec;
  const launch = {
    v: 1,
    phaseId: "guard-launch-1",
    kind: "match",
    round: 1,
    wave: null,
    specs: [
      launchSpec,
      createLaunchMeter({
        seed: settings.seed + 1,
        durationMs: 8_000,
      }).spec,
    ],
    powers: [1, null],
    remainingMs: 4_000,
  } as const;
  const endlessRun = createEndlessRun(settings.seed, [
    { id: "seat-1", name: "HOST", build },
    {
      id: "seat-2",
      name: "GUEST",
      build: { ...build, name: "GUARD-GUEST" },
    },
  ]);
  const endless = {
    v: 1,
    revision: 1,
    phase: "battle",
    run: endlessRun,
    remainingMs: 0,
    gameOver: null,
  } as const;
  const validSnapshot = snapshot(3, 0.05, 1);
  const validResult = {
    winner: 0,
    winnerTeam: 0,
    reason: "ring-out",
    durationSec: 15,
    knockouts: [{ seat: 1, reason: "ring-out", at: 15 }],
  } as const;
  const valid: readonly HostMessage[] = [
    {
      t: "welcome",
      v: VORTEX_PROTOCOL_VERSION,
      seat: 1,
      settings,
    },
    { t: "lobby", lobby },
    { t: "draft", draft, remainingMs: 12_000 },
    { t: "launch", launch },
    { t: "endless", endless },
    {
      t: "start",
      seed: settings.seed,
      settings,
      builds: [build, { ...build, name: "GUARD-GUEST" }],
      names: ["HOST", "GUEST"],
      launchPowers: [1, 0.8],
      teamIds: [0, 1],
      wave: null,
      stackCounts: [
        [1, 1, 1, 1, 1, 1, 1],
        [1, 1, 1, 1, 1, 1, 1],
      ],
    },
    { t: "snapshot", snapshot: validSnapshot },
    { t: "result", result: validResult },
    { t: "reject", reason: "Expected rejection" },
    { t: "ended", reason: "host-ended" },
  ];
  for (const message of valid) {
    const tag = message.t;
    if (!isHostMessage(message)) {
      throw new Error(`valid host message was rejected: ${tag}`);
    }
  }

  const huge = Array.from({ length: 10_000 }, () => null);
  const malformed: readonly [string, unknown][] = [
    [
      "welcome",
      {
        ...valid[0],
        settings: { ...settings, seed: Number.NaN },
      },
    ],
    [
      "lobby",
      {
        t: "lobby",
        lobby: { ...lobby, seats: huge },
      },
    ],
    [
      "draft",
      {
        t: "draft",
        draft: { ...draft, claimedPartIds: huge },
        remainingMs: Number.POSITIVE_INFINITY,
      },
    ],
    [
      "start",
      {
        t: "start",
        seed: settings.seed,
        settings,
        builds: huge,
        names: huge,
      },
    ],
    [
      "launch-array",
      {
        t: "launch",
        launch: { ...launch, specs: huge, powers: huge },
      },
    ],
    [
      "launch-power",
      {
        t: "launch",
        launch: { ...launch, powers: [1.251, null] },
      },
    ],
    [
      "endless-stack",
      {
        t: "endless",
        endless: {
          ...endless,
          run: {
            ...endlessRun,
            players: endlessRun.players.map((player, index) =>
              index === 0
                ? {
                    ...player,
                    build: {
                      ...player.build,
                      parts: {
                        ...player.build.parts,
                        crest: Array.from(
                          { length: 5_000 },
                          () => player.build.parts.crest[0],
                        ),
                      },
                    },
                  }
                : player,
            ),
          },
        },
      },
    ],
    [
      "start-build",
      {
        t: "start",
        seed: settings.seed,
        settings,
        builds: [{ ...build, parts: { crest: "only-one-slot" } }, build],
        names: ["HOST", "GUEST"],
      },
    ],
    [
      "snapshot",
      {
        t: "snapshot",
        snapshot: { ...validSnapshot, events: huge },
      },
    ],
    [
      "snapshot-finite",
      {
        t: "snapshot",
        snapshot: {
          ...validSnapshot,
          tops: [
            {
              ...validSnapshot.tops[0],
              x: Number.NaN,
            },
          ],
        },
      },
    ],
    [
      "result",
      {
        t: "result",
        result: { ...validResult, durationSec: Number.POSITIVE_INFINITY },
      },
    ],
    [
      "result-array",
      {
        t: "result",
        result: { ...validResult, knockouts: huge },
      },
    ],
    ["reject", { t: "reject", reason: "x".repeat(3_000) }],
    ["ended", { t: "ended", reason: "peer-vanished" }],
    [
      "throwing-getter",
      Object.defineProperty({}, "t", {
        get(): never {
          throw new Error("malformed accessor");
        },
      }),
    ],
  ];
  for (const [label, message] of malformed) {
    let accepted = false;
    try {
      accepted = isHostMessage(message);
    } catch (error) {
      throw new Error(
        `${label} host guard threw: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (accepted) {
      throw new Error(`malformed host message was accepted: ${label}`);
    }
  }
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

async function endedCallbackGate(): Promise<void> {
  async function runCase(
    roomCode: string,
    expected: "host-left" | "host-ended",
    unexpectedClose: boolean,
  ): Promise<void> {
    const hostWire = createBroadcastChannelWire();
    const guestWire = createBroadcastChannelWire();
    const build = createDefaultBuild(`ENDED-${expected}`);
    let host: VortexSession | null = null;
    let guest: VortexSession | null = null;
    const ended: string[] = [];
    try {
      host = await createHostSession(
        {
          roomCode,
          name: "ENDED HOST",
          build,
          settings: { playerCount: 2, cpuCount: 0 },
          wire: hostWire,
        },
      );
      guest = await createGuestSession(
        roomCode,
        {
          name: "ENDED GUEST",
          build,
          wire: guestWire,
          interpolate: false,
        },
        {
          onEnded(reason) {
            ended.push(reason);
          },
        },
      );
      await waitFor(() => guest?.seat === 1, "ended callback guest did not join");
      if (unexpectedClose) {
        hostWire.dispose();
      } else {
        host.dispose();
        host = null;
      }
      await waitFor(
        () => ended.length === 1,
        `${expected} did not notify the guest`,
      );
      await delay(25);
      if (ended.length !== 1 || ended[0] !== expected) {
        throw new Error(
          `${expected} callback was duplicated or reported the wrong reason`,
        );
      }
    } finally {
      guest?.dispose();
      host?.dispose();
      guestWire.dispose();
      hostWire.dispose();
    }
  }

  await runCase("END001", "host-ended", false);
  await runCase("END002", "host-left", true);
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
  const overBudget = overBudgetDraftPlaceholder("WIRE-OVER-BUDGET");
  const rejectedUpdate = {
    ...overBudget,
    name: "WIRE-OVER-BUDGET-UPDATE",
  };
  const validGuestBuild = { ...build, name: "WIRE-GUEST-VALID" };
  let host: VortexSession | null = null;
  let guest: VortexSession | null = null;
  let guestSeat: number | null = null;
  let guestReady = false;
  let hostSawValidUpdate = false;
  let hostSawRejectedUpdate = false;
  let roomSettingsReceived = false;
  let guestStarted = false;
  let cpuTakeover = false;
  let launchAuthorityChecked = false;
  let guestLaunchSubmitted = false;
  let hostError: string | null = null;
  const guestErrors: string[] = [];
  try {
    host = await createHostSession(
      {
        roomCode: "SES001",
        name: "HOST",
        build,
        settings: {
          mode: "custom",
          playerCount: 2,
          cpuCount: 0,
          costLimit: 700,
          seed: 0x51e551,
        },
        wire: hostWire,
      },
      {
        onLobby(lobby) {
          guestSeat = lobby.seats.find(
            (seat) => seat.occupant === "guest",
          )?.seat ?? guestSeat;
          const joinedSeat = lobby.seats.find(
            (seat) => seat.occupant === "guest",
          );
          guestReady = joinedSeat?.ready === true;
          hostSawValidUpdate =
            hostSawValidUpdate ||
            joinedSeat?.build?.name === validGuestBuild.name;
          hostSawRejectedUpdate =
            hostSawRejectedUpdate ||
            joinedSeat?.build?.name === rejectedUpdate.name;
          cpuTakeover =
            cpuTakeover ||
            lobby.seats.some(
              (seat) => seat.seat === guestSeat && seat.occupant === "cpu",
            );
        },
        onError(message) {
          hostError = message;
        },
        onLaunchPhase(launch) {
          if (launch.powers[0] !== null) return;
          if (host?.submitLaunchStop(8_000) !== false) {
            throw new Error("host accepted a forged future launch stop");
          }
          const elapsed = Math.max(0, 8_000 - launch.remainingMs);
          if (!host?.submitLaunchStop(elapsed)) {
            throw new Error("host rejected its canonical launch stop");
          }
          if (host.submitLaunchStop(elapsed)) {
            throw new Error("host accepted a duplicate launch stop");
          }
          launchAuthorityChecked = true;
        },
      },
    );
    guest = await createGuestSession(
      "SES001",
      {
        name: "GUEST",
        build: overBudget,
        wire: guestWire,
        interpolate: false,
      },
      {
        onRoomSettings(settings) {
          roomSettingsReceived =
            settings.mode === "custom" && settings.costLimit === 700;
        },
        onStart() {
          guestStarted = true;
        },
        onError(message) {
          guestErrors.push(message);
        },
        onLaunchPhase(launch) {
          if (guestLaunchSubmitted) return;
          const seat = guest?.seat;
          if (
            seat === null ||
            seat === undefined ||
            launch.powers[seat] !== null
          ) {
            return;
          }
          const elapsed = Math.max(0, 8_000 - launch.remainingMs);
          if (!guest?.submitLaunchStop(elapsed)) {
            throw new Error("guest rejected its canonical launch stop");
          }
          guestLaunchSubmitted = true;
          if (guest.submitLaunchStop(elapsed)) {
            throw new Error("guest accepted a duplicate launch stop");
          }
        },
      },
    );
    await waitFor(() => guestSeat !== null, "guest never joined host lobby");
    await waitFor(
      () => roomSettingsReceived,
      "guest did not receive room settings with welcome",
    );
    // The structural preflight permits welcome, but the real room budget is
    // enforced before ready can become canonical.
    await guest.start();
    await waitFor(
      () => guestErrors.length === 1 && !guestReady,
      "over-budget preflight build was not rejected at ready",
    );
    if (!guest.updateBuild(rejectedUpdate)) {
      throw new Error("guest could not submit an over-budget build update");
    }
    await waitFor(
      () => guestErrors.length === 2,
      "over-budget build message bypassed the real room limit",
    );
    if (hostSawRejectedUpdate) {
      throw new Error("host made an over-budget build update canonical");
    }
    if (!guest.updateBuild(validGuestBuild)) {
      throw new Error("guest could not send a valid build update");
    }
    await waitFor(
      () => hostSawValidUpdate && !guestReady,
      "host did not accept the valid pre-ready build update",
    );
    await guest.start();
    await waitFor(() => guestReady, "valid updated build did not become ready");
    await host.start();
    await waitFor(() => guestStarted, "guest did not receive match start");
    guest.dispose();
    guest = null;
    await waitFor(() => cpuTakeover, "guest disconnect did not become CPU");
    if (hostError !== null) throw new Error(hostError);
    if (!launchAuthorityChecked) {
      throw new Error("launch authority checks did not execute");
    }
  } finally {
    guest?.dispose();
    host?.dispose();
  }
}

async function quickDraftSeatCountGate(
  playerCount: 2 | 4,
): Promise<void> {
  const hostWire = createBroadcastChannelWire();
  const guestWire = createBroadcastChannelWire();
  const placeholder = overBudgetDraftPlaceholder(`DRAFT-${playerCount}`);
  let host: VortexSession | null = null;
  let guest: VortexSession | null = null;
  let hostDraft: DraftState | null = null;
  let guestDraft: DraftState | null = null;
  let ready = false;
  let startedBuilds: readonly TopBuildSpec[] | null = null;
  const history: DraftState[] = [];
  const roomCode = playerCount === 2 ? "DRF002" : "DRF004";
  const draftNow = (): DraftState => {
    if (!hostDraft) throw new Error(`${playerCount}-seat draft is unavailable`);
    return hostDraft;
  };
  try {
    host = await createHostSession(
      {
        roomCode,
        name: `${playerCount}P HOST`,
        build: placeholder,
        settings: {
          mode: "draft",
          playerCount,
          cpuCount: playerCount === 4 ? 2 : 0,
          costLimit: 700,
          seed: 0x510000 + playerCount,
        },
        wire: hostWire,
      },
      {
        onLobby(lobby) {
          ready = lobby.seats[1]?.ready === true;
        },
        onDraftState(draft) {
          hostDraft = draft;
          history.push(draft);
        },
        onStart(payload) {
          startedBuilds = payload.builds;
        },
        onLaunchPhase(launch) {
          if (launch.powers[0] === null) {
            host?.submitLaunchStop(Math.max(0, 8_000 - launch.remainingMs));
          }
        },
      },
    );
    guest = await createGuestSession(
      roomCode,
      {
        name: `${playerCount}P GUEST`,
        build: { ...placeholder, name: `${playerCount}P OVER-BUDGET` },
        wire: guestWire,
        interpolate: false,
      },
      {
        onDraftState(draft) {
          guestDraft = draft;
        },
        onLaunchPhase(launch) {
          const seat = guest?.seat;
          if (seat !== null && seat !== undefined && launch.powers[seat] === null) {
            guest?.submitLaunchStop(Math.max(0, 8_000 - launch.remainingMs));
          }
        },
      },
    );
    await waitFor(() => guest?.seat === 1, `${playerCount}-seat guest did not join`);
    await guest.start();
    await waitFor(() => ready, `${playerCount}-seat guest did not become ready`);
    await host.start();
    await waitFor(
      () => hostDraft !== null && guestDraft !== null,
      `${playerCount}-seat canonical draft was not broadcast`,
    );
    for (let guard = 0; guard < 40 && !draftNow().completed; guard += 1) {
      const draft = draftNow();
      const revision = draft.claimedPartIds.length;
      const current = currentDraftPlayerIndex(draft);
      const part = legalDraftPicks(draft)[0];
      if (!part) throw new Error(`${playerCount}-seat draft has no legal pick`);
      if (current === 0) {
        if (!host.submitDraftPick(part.id)) {
          throw new Error(`${playerCount}-seat host pick was rejected`);
        }
      } else if (current === 1) {
        await waitFor(
          () =>
            guestDraft !== null &&
            guestDraft.claimedPartIds.length === revision,
          `${playerCount}-seat guest draft did not converge`,
        );
        if (!guest.submitDraftPick(part.id)) {
          throw new Error(`${playerCount}-seat guest pick was rejected locally`);
        }
      } else {
        await waitFor(
          () =>
            draftNow().claimedPartIds.length > revision ||
            draftNow().completed,
          `${playerCount}-seat CPU pick did not advance`,
        );
        continue;
      }
      await waitFor(
        () => draftNow().claimedPartIds.length > revision,
        `${playerCount}-seat host did not accept a legal pick`,
      );
    }
    const finalDraft = draftNow();
    const expectedPicks = playerCount * TOP_SLOTS.length;
    if (
      !finalDraft.completed ||
      finalDraft.claimedPartIds.length !== expectedPicks ||
      new Set(finalDraft.claimedPartIds).size !== expectedPicks
    ) {
      throw new Error(`${playerCount}-seat draft did not complete uniquely`);
    }
    const latestByRevision = new Map<number, DraftState>();
    for (const draft of history) {
      latestByRevision.set(draft.claimedPartIds.length, draft);
    }
    const order: number[] = [];
    for (let revision = 1; revision <= expectedPicks; revision += 1) {
      const before = latestByRevision.get(revision - 1);
      const after = latestByRevision.get(revision);
      const picked = after?.claimedPartIds[revision - 1];
      const picker = before ? currentDraftPlayerIndex(before) : null;
      if (
        !before ||
        !after ||
        picker === null ||
        picked === undefined ||
        !legalDraftPicks(before).some((part) => part.id === picked)
      ) {
        throw new Error(`${playerCount}-seat host accepted an illegal revision`);
      }
      order.push(picker);
    }
    const expectedOrder = TOP_SLOTS.flatMap((_, slotIndex) =>
      slotIndex % 2 === 0
        ? [...finalDraft.baseOrder]
        : [...finalDraft.baseOrder].reverse(),
    );
    if (
      order.length !== expectedOrder.length ||
      order.some((seat, index) => seat !== expectedOrder[index])
    ) {
      throw new Error(`${playerCount}-seat draft was not snake ordered`);
    }
    await waitFor(
      () => startedBuilds !== null,
      `${playerCount}-seat draft did not start a match`,
      5_000,
    );
    const builds =
      startedBuilds as unknown as readonly TopBuildSpec[] | null;
    if (
      builds === null ||
      builds.length !== playerCount ||
      builds.some((build) => !validateBuild(build, 700).ok)
    ) {
      throw new Error(`${playerCount}-seat draft produced invalid builds`);
    }
  } finally {
    guest?.dispose();
    host?.dispose();
  }
}

async function launchTimeoutGate(): Promise<boolean> {
  const wire = createBroadcastChannelWire();
  const build = createDefaultBuild("LAUNCH-TIMEOUT");
  let host: VortexSession | null = null;
  let initialPhase = false;
  let timedOutPower: number | null = null;
  try {
    host = await createHostSession(
      {
        roomCode: "LTO001",
        name: "TIMEOUT HOST",
        build,
        settings: {
          mode: "custom",
          playerCount: 2,
          cpuCount: 1,
          costLimit: 1000,
          seed: 0x710001,
        },
        wire,
        createSim: scriptedTeamSimFactory([0]),
      },
      {
        onLaunchPhase(launch) {
          initialPhase =
            initialPhase ||
            (launch.remainingMs > 7_500 &&
              launch.powers[0] === null &&
              launch.powers[1] !== null);
        },
        onStart(payload) {
          timedOutPower = payload.launchPowers[0] ?? null;
        },
      },
    );
    await host.start();
    await waitFor(
      () => timedOutPower !== null,
      "unattended launch did not auto-resolve after eight seconds",
      9_000,
    );
    return initialPhase && Math.abs((timedOutPower ?? 0) - 0.6) < 1e-8;
  } finally {
    host?.dispose();
    wire.dispose();
  }
}

interface DraftSessionGateResult {
  readonly seatCounts: readonly VortexPlayerCount[];
  readonly snake: boolean;
  readonly timeoutAutoPick: boolean;
  readonly disconnectAutoPick: boolean;
  readonly stalePickRejected: boolean;
  readonly startedFromDraft: boolean;
}

interface EndlessNetworkGateResult {
  readonly seatCounts: readonly VortexPlayerCount[];
  readonly multiWave: boolean;
  readonly everyPlayerRewarded: boolean;
  readonly sameSlotStacks: boolean;
  readonly disconnectCpu: boolean;
  readonly gameOver: boolean;
  readonly teamPayload: boolean;
  readonly launchAuthority: boolean;
}

async function endlessSeatGate(
  playerCount: VortexPlayerCount,
  disconnectDuringReward: boolean,
): Promise<{
  readonly waves: number;
  readonly everyPlayerRewarded: boolean;
  readonly sameSlotStacks: boolean;
  readonly disconnectCpu: boolean;
  readonly gameOver: boolean;
  readonly teamPayload: boolean;
  readonly launchPhases: number;
}> {
  const hostWire = createBroadcastChannelWire();
  const guestWires = Array.from(
    { length: playerCount - 1 },
    () => createBroadcastChannelWire(),
  );
  const build = createDefaultBuild(`ENDLESS-${playerCount}`);
  const roomCode = `EN${playerCount}00${disconnectDuringReward ? 1 : 0}`;
  const hostLaunchSeen = new Set<string>();
  const guestLaunchSeen = guestWires.map(() => new Set<string>());
  const guestOfferSeen = guestWires.map(() => new Set<string>());
  const hostOfferSeen = new Set<string>();
  const guests: (VortexSession | null)[] = guestWires.map(() => null);
  const errors: string[] = [];
  let host: VortexSession | null = null;
  let fullHumanLobby = false;
  let allHumanReady = false;
  let disconnectCpu = false;
  let disconnected = false;
  let gameOverView:
    | {
        readonly wave: number;
        readonly cleared: number;
        readonly score: number;
      }
    | null = null;
  let finalPartTotals: readonly number[] = [];
  let sameSlotStacks = false;
  let waves = 0;
  let teamPayload = true;
  let launchPhases = 0;
  let normalResults = 0;

  function submitLaunch(
    session: VortexSession | null,
    seen: Set<string>,
    seat: number | null,
    launch: LaunchPhaseView,
  ): void {
    if (
      !session ||
      seat === null ||
      launch.powers[seat] !== null ||
      seen.has(launch.phaseId)
    ) {
      return;
    }
    seen.add(launch.phaseId);
    const elapsed = Math.max(0, 8_000 - launch.remainingMs);
    if (!session.submitLaunchStop(elapsed)) {
      throw new Error(
        `${playerCount}P seat ${seat} could not stop launch ${launch.phaseId}`,
      );
    }
  }

  try {
    host = await createHostSession(
      {
        roomCode,
        name: `${playerCount}P HOST`,
        build,
        settings: {
          mode: "endless",
          playerCount,
          cpuCount: 0,
          costLimit: 1000,
          seed: 0xe00000 + playerCount,
        },
        wire: hostWire,
        createSim: scriptedTeamSimFactory([0, 0, 1]),
      },
      {
        onLobby(lobby) {
          const active = lobby.seats.slice(0, playerCount);
          fullHumanLobby =
            fullHumanLobby ||
            active.every(
              (seat, index) =>
                seat.occupant === (index === 0 ? "host" : "guest"),
            );
          allHumanReady =
            allHumanReady ||
            active.every(
              (seat, index) =>
                seat.occupant === (index === 0 ? "host" : "guest") &&
                seat.ready,
            );
          disconnectCpu =
            disconnectCpu ||
            active.some(
              (seat) =>
                seat.seat > 0 && seat.occupant === "cpu",
            );
        },
        onLaunchPhase(launch) {
          launchPhases = Math.max(launchPhases, launch.round);
          submitLaunch(host, hostLaunchSeen, 0, launch);
        },
        onStart(payload) {
          waves = Math.max(waves, payload.wave ?? 0);
          const expectedEnemies = playerCount === 2 ? 1 : 2;
          teamPayload =
            teamPayload &&
            payload.wave !== null &&
            payload.builds.length === playerCount + expectedEnemies &&
            payload.launchPowers.length === payload.builds.length &&
            payload.launchPowers.every(
              (power) => power >= 0 && power <= 1.25,
            ) &&
            payload.teamIds
              .slice(0, playerCount)
              .every((team) => team === 0) &&
            payload.teamIds
              .slice(playerCount)
              .every((team) => team === 1) &&
            payload.stackCounts.length === payload.builds.length;
          sameSlotStacks =
            sameSlotStacks ||
            payload.stackCounts
              .slice(0, playerCount)
              .some((counts) => counts.some((count) => count > 1));
        },
        onEndlessState(endless) {
          const totals = endless.run.players.map((player) =>
            TOP_SLOTS.reduce(
              (total, slot) => total + player.build.parts[slot].length,
              0,
            ),
          );
          if (
            totals.reduce((sum, value) => sum + value, 0) >
            finalPartTotals.reduce((sum, value) => sum + value, 0)
          ) {
            finalPartTotals = totals;
          }
          sameSlotStacks =
            sameSlotStacks ||
            endless.run.players.some((player) =>
              TOP_SLOTS.some(
                (slot) => player.build.parts[slot].length > 1,
              ),
            );
          if (endless.phase === "reward") {
            const offer = endless.run.rewardOffers.find(
              (candidate) =>
                candidate.playerId === "seat-1" &&
                candidate.selectedPartId === null,
            );
            const choice = offer?.choices[0];
            if (offer && choice && !hostOfferSeen.has(offer.id)) {
              hostOfferSeen.add(offer.id);
              if (!host?.submitEndlessReward(choice.partId)) {
                throw new Error(`${playerCount}P host reward was rejected`);
              }
            }
          }
          if (endless.phase === "game-over") {
            gameOverView = endless.gameOver;
          }
        },
        onResult() {
          normalResults += 1;
        },
        onError(message) {
          errors.push(message);
        },
      },
    );

    for (let index = 0; index < guestWires.length; index += 1) {
      const guestIndex = index;
      const seatNumber = guestIndex + 1;
      const guest = await createGuestSession(
        roomCode,
        {
          name: `${playerCount}P GUEST ${seatNumber}`,
          build: { ...build, name: `${playerCount}P GUEST ${seatNumber}` },
          wire: guestWires[guestIndex]!,
          interpolate: false,
        },
        {
          onLaunchPhase(launch) {
            submitLaunch(
              guests[guestIndex],
              guestLaunchSeen[guestIndex]!,
              guests[guestIndex]?.seat ?? null,
              launch,
            );
          },
          onEndlessState(endless) {
            if (endless.phase !== "reward") return;
            if (
              disconnectDuringReward &&
              !disconnected &&
              guestIndex === guestWires.length - 1 &&
              endless.run.wave === 1
            ) {
              disconnected = true;
              const current = guests[guestIndex];
              guests[guestIndex] = null;
              current?.dispose();
              return;
            }
            const playerId = `seat-${seatNumber + 1}`;
            const offer = endless.run.rewardOffers.find(
              (candidate) =>
                candidate.playerId === playerId &&
                candidate.selectedPartId === null,
            );
            const choice = offer?.choices[0];
            if (
              !offer ||
              !choice ||
              guestOfferSeen[guestIndex]!.has(offer.id)
            ) {
              return;
            }
            guestOfferSeen[guestIndex]!.add(offer.id);
            if (!guests[guestIndex]?.submitEndlessReward(choice.partId)) {
              throw new Error(
                `${playerCount}P guest ${seatNumber} reward was rejected`,
              );
            }
          },
          onError(message) {
            if (!disconnected) errors.push(message);
          },
        },
      );
      guests[guestIndex] = guest;
    }

    await waitFor(
      () => guests.every((guest) => guest?.seat !== null),
      `${playerCount}P endless guests did not join`,
    );
    for (const guest of guests) await guest!.start();
    await waitFor(
      () => fullHumanLobby && allHumanReady,
      `${playerCount}P endless lobby was not fully human/ready`,
    );
    await host.start();
    await waitFor(
      () => gameOverView !== null,
      `${playerCount}P endless did not reach scripted game over`,
      8_000,
    );
    const gameOver = gameOverView as {
      readonly wave: number;
      readonly cleared: number;
      readonly score: number;
    } | null;
    if (
      gameOver === null ||
      gameOver.wave !== 3 ||
      gameOver.cleared !== 2 ||
      gameOver.score < 2_000
    ) {
      throw new Error(`${playerCount}P endless game-over counters are invalid`);
    }
    if (normalResults !== 0) {
      throw new Error("endless wave leaked the ordinary result callback");
    }
    if (errors.length > 0) throw new Error(errors.join(" / "));
    const everyPlayerRewarded =
      finalPartTotals.length === playerCount &&
      finalPartTotals.every((total) => total >= 9);
    if (!everyPlayerRewarded) {
      throw new Error(`${playerCount}P did not reward every player twice`);
    }
    if (!sameSlotStacks) {
      throw new Error(`${playerCount}P rewards did not create same-slot stacks`);
    }
    if (disconnectDuringReward && (!disconnected || !disconnectCpu)) {
      throw new Error("reward disconnect did not become an auto-picking CPU");
    }
    if (!teamPayload || waves < 3 || launchPhases < 3) {
      throw new Error(`${playerCount}P endless start/launch payload regressed`);
    }
    return {
      waves,
      everyPlayerRewarded,
      sameSlotStacks,
      disconnectCpu: !disconnectDuringReward || disconnectCpu,
      gameOver: true,
      teamPayload,
      launchPhases,
    };
  } finally {
    for (const guest of guests) guest?.dispose();
    host?.dispose();
    for (const wire of guestWires) wire.dispose();
    hostWire.dispose();
  }
}

/**
 * The one behavior v3 added to session.ts — starting endless with VACANT
 * seats — shipped with zero coverage: every endless gate seats a full human
 * squad. This is the solo-host start: one human, no guests, start() must
 * fill seat 1 with a CPU wingmate, run the launch authority, and produce a
 * wave-1 payload shaped exactly like the full-squad one.
 */
async function endlessSoloStartGate(): Promise<boolean> {
  const hostWire = createBroadcastChannelWire();
  const build = createDefaultBuild("ENDLESS-SOLO");
  let host: VortexSession | null = null;
  let cpuWingmate = false;
  let startPayloadOk = false;
  const launchSeen = new Set<string>();
  try {
    host = await createHostSession(
      {
        roomCode: "ENSOLO",
        name: "SOLO HOST",
        build,
        settings: {
          mode: "endless",
          playerCount: 2,
          cpuCount: 0,
          costLimit: 1000,
          seed: 0xe50101,
        },
        wire: hostWire,
        createSim: scriptedTeamSimFactory([0, 0, 1]),
      },
      {
        onLobby(lobby) {
          cpuWingmate =
            cpuWingmate ||
            (lobby.seats[1]?.occupant === "cpu" &&
              lobby.seats[1]?.build !== null);
        },
        onLaunchPhase(launch) {
          if (launch.powers[0] === null && !launchSeen.has(launch.phaseId)) {
            launchSeen.add(launch.phaseId);
            host?.submitLaunchStop(Math.max(0, 8_000 - launch.remainingMs));
          }
        },
        onStart(payload) {
          startPayloadOk =
            startPayloadOk ||
            (payload.wave === 1 &&
              payload.builds.length === 3 &&
              payload.teamIds[0] === 0 &&
              payload.teamIds[1] === 0 &&
              payload.teamIds[2] === 1);
        },
      },
    );
    await host.start();
    await waitFor(
      () => cpuWingmate && startPayloadOk,
      "solo endless start did not fill the vacant seat and launch wave 1",
    );
    return true;
  } finally {
    host?.dispose();
  }
}

async function endlessNetworkGate(): Promise<EndlessNetworkGateResult> {
  const two = await endlessSeatGate(2, false);
  const three = await endlessSeatGate(3, true);
  const four = await endlessSeatGate(4, false);
  const results = [two, three, four];
  return {
    seatCounts: [2, 3, 4],
    multiWave: results.every((result) => result.waves >= 3),
    everyPlayerRewarded: results.every(
      (result) => result.everyPlayerRewarded,
    ),
    sameSlotStacks: results.every((result) => result.sameSlotStacks),
    disconnectCpu: three.disconnectCpu,
    gameOver: results.every((result) => result.gameOver),
    teamPayload: results.every((result) => result.teamPayload),
    launchAuthority: results.every((result) => result.launchPhases >= 3),
  };
}

async function draftSessionGate(): Promise<DraftSessionGateResult> {
  const hostWire = createBroadcastChannelWire();
  const guestOneWire = createBroadcastChannelWire();
  const guestTwoWire = createBroadcastChannelWire();
  const placeholder = overBudgetDraftPlaceholder("DRAFT-PLACEHOLDER");
  let host: VortexSession | null = null;
  let guestOne: VortexSession | null = null;
  let guestTwo: VortexSession | null = null;
  let hostDraft: DraftState | null = null;
  let guestTwoDraft: DraftState | null = null;
  let initialRemainingMs: number | null = null;
  let latestLobbyGuestReady = 0;
  let disconnectedSeatIsCpu = false;
  let hostStartBuilds: readonly TopBuildSpec[] | null = null;
  let guestTwoStarted = false;
  const history: DraftState[] = [];
  const hostErrors: string[] = [];
  const guestTwoErrors: string[] = [];

  const currentHostDraft = (): DraftState => {
    if (hostDraft === null) throw new Error("host draft state is unavailable");
    return hostDraft;
  };

  async function waitForGuestTwoRevision(revision: number): Promise<void> {
    await waitFor(
      () =>
        guestTwoDraft !== null &&
        guestTwoDraft.claimedPartIds.length === revision,
      "guest draft state did not converge to host",
    );
  }

  async function submitCurrent(session: VortexSession): Promise<void> {
    const before = currentHostDraft();
    const revision = before.claimedPartIds.length;
    const part = legalDraftPicks(before)[0];
    if (!part) throw new Error("draft had no legal current pick");
    if (session !== host) await waitForGuestTwoRevision(revision);
    if (!session.submitDraftPick(part.id)) {
      throw new Error("current player could not submit a legal draft pick");
    }
    await waitFor(
      () => currentHostDraft().claimedPartIds.length > revision,
      "host did not accept a legal draft pick",
    );
  }

  try {
    host = await createHostSession(
      {
        roomCode: "DRF001",
        name: "DRAFT HOST",
        build: placeholder,
        settings: {
          mode: "draft",
          playerCount: 3,
          cpuCount: 0,
          costLimit: 700,
          seed: 0xd2a67,
        },
        wire: hostWire,
      },
      {
        onLobby(lobby) {
          latestLobbyGuestReady = lobby.seats
            .slice(0, 3)
            .filter(
              (seat) => seat.occupant === "guest" && seat.ready,
            ).length;
          disconnectedSeatIsCpu =
            disconnectedSeatIsCpu ||
            lobby.seats.some(
              (seat) => seat.seat === 1 && seat.occupant === "cpu",
            );
        },
        onDraftState(draft, remainingMs) {
          hostDraft = draft;
          history.push(draft);
          if (initialRemainingMs === null) initialRemainingMs = remainingMs;
        },
        onStart(payload) {
          hostStartBuilds = payload.builds;
        },
        onError(message) {
          hostErrors.push(message);
        },
        onLaunchPhase(launch) {
          if (launch.powers[0] === null) {
            host?.submitLaunchStop(Math.max(0, 8_000 - launch.remainingMs));
          }
        },
      },
    );
    guestOne = await createGuestSession(
      "DRF001",
      {
        name: "DRAFT GUEST 1",
        build: { ...placeholder, name: "OVER-BUDGET GUEST 1" },
        wire: guestOneWire,
        interpolate: false,
      },
    );
    guestTwo = await createGuestSession(
      "DRF001",
      {
        name: "DRAFT GUEST 2",
        build: { ...placeholder, name: "OVER-BUDGET GUEST 2" },
        wire: guestTwoWire,
        interpolate: false,
      },
      {
        onDraftState(draft) {
          guestTwoDraft = draft;
        },
        onStart() {
          guestTwoStarted = true;
        },
        onError(message) {
          guestTwoErrors.push(message);
        },
        onLaunchPhase(launch) {
          const seat = guestTwo?.seat;
          if (
            seat !== null &&
            seat !== undefined &&
            launch.powers[seat] === null
          ) {
            guestTwo?.submitLaunchStop(
              Math.max(0, 8_000 - launch.remainingMs),
            );
          }
        },
      },
    );
    await waitFor(
      () => guestOne?.seat === 1 && guestTwo?.seat === 2,
      "draft guests did not receive deterministic seats",
    );
    await guestOne.start();
    await guestTwo.start();
    await waitFor(
      () => latestLobbyGuestReady === 2,
      "draft guests did not become ready",
    );
    await host.start();
    await waitFor(
      () => hostDraft !== null && guestTwoDraft !== null,
      "canonical draft state was not broadcast",
    );
    if (
      initialRemainingMs === null ||
      initialRemainingMs <= 11_000 ||
      initialRemainingMs > 12_000 ||
      currentHostDraft().turnDurationMs !== 12_000
    ) {
      throw new Error("draft did not expose a 12 second canonical deadline");
    }

    // Deliberately leave seat 1 idle on its first turn.
    let timeoutAutoPick = false;
    for (let guard = 0; guard < 12 && !timeoutAutoPick; guard += 1) {
      const draft = currentHostDraft();
      const current = currentDraftPlayerIndex(draft);
      if (current === 1) {
        const revision = draft.claimedPartIds.length;
        await waitFor(
          () => currentHostDraft().claimedPartIds.length > revision,
          "host did not auto-pick an expired human draft turn",
          13_500,
        );
        timeoutAutoPick = true;
      } else if (current === 0) {
        await submitCurrent(host);
      } else if (current === 2) {
        await submitCurrent(guestTwo);
      } else {
        throw new Error("draft exposed an invalid current player");
      }
    }
    if (!timeoutAutoPick) throw new Error("seat 1 never received a timeout turn");

    let disconnectAutoPick = false;
    let stalePickRejected = false;
    for (let guard = 0; guard < 40 && !currentHostDraft().completed; guard += 1) {
      const draft = currentHostDraft();
      const current = currentDraftPlayerIndex(draft);
      if (current === 1 && guestOne !== null) {
        const revision = draft.claimedPartIds.length;
        guestOne.dispose();
        guestOne = null;
        await waitFor(
          () =>
            disconnectedSeatIsCpu &&
            currentHostDraft().players[1]?.isCpu === true &&
            currentHostDraft().claimedPartIds.length > revision,
          "disconnected draft player was not converted to CPU and auto-picked",
        );
        disconnectAutoPick = true;
        continue;
      }
      if (current === 0) {
        await submitCurrent(host);
        continue;
      }
      if (current === 2 && !stalePickRejected) {
        const revision = draft.claimedPartIds.length;
        const part = legalDraftPicks(draft)[0];
        if (!part) throw new Error("guest had no legal draft pick");
        await waitForGuestTwoRevision(revision);
        if (
          !guestTwo.submitDraftPick(part.id) ||
          !guestTwo.submitDraftPick(part.id)
        ) {
          throw new Error("guest could not submit duplicate in-flight requests");
        }
        await waitFor(
          () => currentHostDraft().claimedPartIds.length > revision,
          "host did not accept the first guest draft request",
        );
        await waitFor(
          () =>
            guestTwoErrors.some((message) =>
              message.includes("最新状態"),
            ),
          "host did not reject the stale duplicate draft request",
        );
        stalePickRejected = true;
        continue;
      }
      if (current === 2) {
        await submitCurrent(guestTwo);
        continue;
      }
      if (current === 1) {
        await waitFor(
          () =>
            currentDraftPlayerIndex(currentHostDraft()) !== 1 ||
            currentHostDraft().completed,
          "CPU draft turn did not advance",
        );
        continue;
      }
      if (current === null && !draft.completed) {
        throw new Error("draft lost its current player before completion");
      }
    }

    const finalDraft = currentHostDraft();
    if (!finalDraft.completed || finalDraft.claimedPartIds.length !== 21) {
      throw new Error("three-player draft did not complete all 21 picks");
    }
    if (new Set(finalDraft.claimedPartIds).size !== 21) {
      throw new Error("claimed draft parts were reused");
    }

    const latestByRevision = new Map<number, DraftState>();
    for (const draft of history) {
      latestByRevision.set(draft.claimedPartIds.length, draft);
    }
    const actualOrder: number[] = [];
    for (let revision = 1; revision <= 21; revision += 1) {
      const before = latestByRevision.get(revision - 1);
      const after = latestByRevision.get(revision);
      if (!before || !after) {
        throw new Error(`canonical draft revision ${revision} was not broadcast`);
      }
      const picker = currentDraftPlayerIndex(before);
      const pickedPart = after.claimedPartIds[revision - 1];
      if (
        picker === null ||
        pickedPart === undefined ||
        !legalDraftPicks(before).some((part) => part.id === pickedPart)
      ) {
        throw new Error(`host accepted an illegal pick at revision ${revision}`);
      }
      actualOrder.push(picker);
      if (
        !after.completed &&
        legalDraftPicks(after).some((part) =>
          after.claimedPartIds.includes(part.id),
        )
      ) {
        throw new Error("claimed part remained available after canonical pick");
      }
    }
    const expectedOrder = TOP_SLOTS.flatMap((_, slotIndex) =>
      slotIndex % 2 === 0
        ? [...finalDraft.baseOrder]
        : [...finalDraft.baseOrder].reverse(),
    );
    const snake =
      actualOrder.length === expectedOrder.length &&
      actualOrder.every((seat, index) => seat === expectedOrder[index]);
    if (!snake) throw new Error("canonical draft order was not snake ordered");

    await waitFor(
      () => hostStartBuilds !== null && guestTwoStarted,
      "completed draft did not transition to the existing match start",
      5_000,
    );
    const startedBuilds =
      hostStartBuilds as unknown as readonly TopBuildSpec[] | null;
    if (
      startedBuilds === null ||
      startedBuilds.length !== 3 ||
      startedBuilds.some((build) => !validateBuild(build, 700).ok)
    ) {
      throw new Error("draft start payload contained an invalid final build");
    }
    for (let seat = 0; seat < 3; seat += 1) {
      const build = startedBuilds[seat]!;
      if (
        TOP_SLOTS.some(
          (slot) => build.parts[slot] !== finalDraft.picks[seat]?.[slot],
        )
      ) {
        throw new Error("match start build did not match canonical draft picks");
      }
    }
    if (!disconnectAutoPick || !stalePickRejected) {
      throw new Error("draft authority edge cases did not execute");
    }
    const unexpectedHostErrors = hostErrors;
    const unexpectedGuestErrors = guestTwoErrors.filter(
      (message) => !message.includes("最新状態"),
    );
    if (unexpectedHostErrors.length > 0 || unexpectedGuestErrors.length > 0) {
      throw new Error(
        [...unexpectedHostErrors, ...unexpectedGuestErrors].join(" / "),
      );
    }
    return {
      seatCounts: [2, 3, 4],
      snake,
      timeoutAutoPick,
      disconnectAutoPick,
      stalePickRejected,
      startedFromDraft: true,
    };
  } finally {
    guestOne?.dispose();
    guestTwo?.dispose();
    host?.dispose();
  }
}

async function main(): Promise<void> {
  let failures = 0;
  const errors: string[] = [];
  let draft: DraftSessionGateResult = {
    seatCounts: [],
    snake: false,
    timeoutAutoPick: false,
    disconnectAutoPick: false,
    stalePickRejected: false,
    startedFromDraft: false,
  };
  let endless: EndlessNetworkGateResult = {
    seatCounts: [],
    multiWave: false,
    everyPlayerRewarded: false,
    sameSlotStacks: false,
    disconnectCpu: false,
    gameOver: false,
    teamPayload: false,
    launchAuthority: false,
  };
  let launchTimeout = false;
  try {
    if (normalizeRoomCode("vc-ab12cd") !== "AB12CD") {
      throw new Error("room normalization failed");
    }
    if (peerRoomId("ab12cd") !== "vc-AB12CD") {
      throw new Error("PeerJS room prefix failed");
    }
    hostMessageGuardGate();
    interpolationGate();
    await lowLevelWireGate();
    await hostCloseGate();
    await endedCallbackGate();
    await sessionGate();
    await quickDraftSeatCountGate(2);
    draft = await draftSessionGate();
    await quickDraftSeatCountGate(4);
    launchTimeout = await launchTimeoutGate();
    if (!launchTimeout) {
      throw new Error("launch timeout fallback was not exactly 0.6");
    }
    endless = await endlessNetworkGate();
    if (!(await endlessSoloStartGate())) {
      throw new Error("endless solo start gate failed");
    }
  } catch (error) {
    failures += 1;
    errors.push(error instanceof Error ? error.message : String(error));
  }
  /*
   * ASSERTED, not reported. The old line `protocol: 1` was pure output —
   * when the version moved to 2 nothing here would have noticed a stale
   * constant, and a v1 guest on a v2 host dies as a silent freeze, the
   * worst failure shape this codebase knows.
   */
  if (VORTEX_PROTOCOL_VERSION !== 3) {
    failures += 1;
    errors.push(
      `protocol version expected 3 (combo events + phasing flag), got ${VORTEX_PROTOCOL_VERSION}`,
    );
  }
  const output = {
    protocol: VORTEX_PROTOCOL_VERSION,
    prefix: "vc-",
    hostMessageGuard: failures === 0,
    broadcastRoundTrip: failures === 0,
    interpolationMs: 100,
    cpuTakeover: failures === 0,
    hostDisconnectEnds: failures === 0,
    roomSettingsCallback: failures === 0,
    endedCallbackOnce: failures === 0,
    customBuildPreflight: failures === 0,
    launchTimeout,
    draft,
    endless,
    failures,
    errors,
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
  if (failures > 0) process.exitCode = 1;
}

void main();
