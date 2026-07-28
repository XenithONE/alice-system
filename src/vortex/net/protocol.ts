import {
  TOP_SLOTS,
  type DraftState,
  type PartId,
  type TopBuildSpec,
  type VortexRoomSettings,
} from "../types";
import { assertEndlessRun, type EndlessRunState } from "../endless";
import type { LaunchMeterSpec } from "../launch";
import type {
  KnockoutReason,
  MatchPhase,
  SeatIndex,
  SimEvent,
  SimRingArena,
  SkillRejectReason,
  SkillSlot,
} from "../sim/types";

export const VORTEX_PROTOCOL_VERSION = 1;
export const VORTEX_ROOM_PREFIX = "vc-";
export type VortexSessionEndReason = "host-left" | "host-ended";

export interface SkillSnapshot {
  readonly slot: SkillSlot;
  readonly skillId: string | null;
  readonly cooldown: number;
  readonly charges: number;
  readonly ready: boolean;
  readonly blocked: SkillRejectReason | null;
  readonly groupSize: number;
  readonly readyCount: number;
}

export interface TopSnapshot {
  readonly seat: SeatIndex;
  readonly alive: boolean;
  readonly hp: number;
  readonly hpMax: number;
  readonly spin: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly qx: number;
  readonly qy: number;
  readonly qz: number;
  readonly qw: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly skills: readonly SkillSnapshot[];
}

export interface VortexSnapshot {
  readonly tick: number;
  readonly elapsed: number;
  readonly phase: MatchPhase;
  readonly suddenDeathStage: number;
  readonly arenaId: SimRingArena["id"];
  readonly tops: readonly TopSnapshot[];
  readonly events: readonly SimEvent[];
}

export interface VortexResult {
  readonly winner: SeatIndex | null;
  /** Team id for co-op/team battles; seat id in ordinary free-for-all. */
  readonly winnerTeam: number | null;
  readonly reason: KnockoutReason | "draw";
  readonly durationSec: number;
  readonly knockouts: readonly {
    readonly seat: SeatIndex;
    readonly reason: KnockoutReason;
    readonly at: number;
  }[];
}

export interface LobbySeat {
  readonly seat: SeatIndex;
  readonly name: string;
  readonly occupant: "host" | "guest" | "cpu" | "empty";
  readonly ready: boolean;
  readonly build: TopBuildSpec | null;
}

export interface VortexLobby {
  readonly roomCode: string | null;
  readonly settings: VortexRoomSettings;
  readonly seats: readonly LobbySeat[];
}

export interface LaunchPhaseView {
  readonly v: 1;
  readonly phaseId: string;
  readonly kind: "match" | "endless";
  /** One for a normal match; the current wave for endless co-op. */
  readonly round: number;
  readonly wave: number | null;
  /** Seat-indexed deterministic meter specifications. */
  readonly specs: readonly LaunchMeterSpec[];
  /** Host-authored powers; null means that seat has not stopped yet. */
  readonly powers: readonly (number | null)[];
  readonly remainingMs: number;
}

export interface EndlessGameOverState {
  readonly wave: number;
  readonly cleared: number;
  readonly score: number;
}

export interface EndlessStateView {
  readonly v: 1;
  readonly revision: number;
  readonly phase: "battle" | "reward" | "game-over";
  readonly run: EndlessRunState;
  readonly remainingMs: number;
  readonly gameOver: EndlessGameOverState | null;
}

export interface VortexStartPayload {
  readonly seed: number;
  readonly settings: VortexRoomSettings;
  /** Visual/network builds. Endless stacked builds use stackCounts separately. */
  readonly builds: readonly TopBuildSpec[];
  readonly names: readonly string[];
  readonly launchPowers: readonly number[];
  readonly teamIds: readonly number[];
  readonly wave: number | null;
  /** Per-top counts in TOP_SLOTS order. */
  readonly stackCounts: readonly (readonly number[])[];
}

export type ClientMessage =
  | {
      readonly t: "hello";
      readonly v: number;
      readonly name: string;
      readonly build: TopBuildSpec;
    }
  | { readonly t: "build"; readonly build: TopBuildSpec }
  | { readonly t: "ready"; readonly ready: boolean }
  | {
      readonly t: "draft-pick";
      readonly partId: PartId;
      /** Number of canonical picks the client had observed when submitting. */
      readonly revision: number;
    }
  | {
      readonly t: "launch-stop";
      readonly phaseId: string;
      readonly stoppedAtMs: number;
    }
  | {
      readonly t: "endless-pick";
      readonly revision: number;
      readonly offerId: string;
      readonly partId: PartId;
    }
  | {
      readonly t: "skill";
      readonly seq: number;
      readonly slot: SkillSlot;
    }
  | { readonly t: "rematch" };

export type HostMessage =
  | {
      readonly t: "welcome";
      readonly v: number;
      readonly seat: SeatIndex;
      readonly settings: VortexRoomSettings;
    }
  | { readonly t: "lobby"; readonly lobby: VortexLobby }
  | ({ readonly t: "start" } & VortexStartPayload)
  | {
      readonly t: "draft";
      /** Host-authored, immutable canonical draft state. */
      readonly draft: DraftState;
      /** Remaining turn time at send time; avoids assuming synchronized clocks. */
      readonly remainingMs: number;
    }
  | { readonly t: "launch"; readonly launch: LaunchPhaseView }
  | { readonly t: "endless"; readonly endless: EndlessStateView }
  | { readonly t: "snapshot"; readonly snapshot: VortexSnapshot }
  | { readonly t: "result"; readonly result: VortexResult }
  | { readonly t: "reject"; readonly reason: string }
  | { readonly t: "ended"; readonly reason: VortexSessionEndReason };

export interface WireConn {
  readonly id: string;
  send(payload: unknown): void;
  onMessage(callback: (payload: unknown) => void): void;
  onClose(callback: () => void): void;
  close(): void;
}

export interface Wire {
  host(roomCode: string, onConnection: (connection: WireConn) => void): Promise<void>;
  join(roomCode: string): Promise<WireConn>;
  dispose(): void;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const RING_IDS = new Set([
  "core-bowl",
  "wide-dish",
  "pressure-crater",
  "wave-ring",
  "eclipse-ring",
]);
const MATCH_PHASES = new Set(["countdown", "live", "over"]);
const KNOCKOUT_REASONS = new Set(["ring-out", "destroyed"]);
const LOBBY_OCCUPANTS = new Set(["host", "guest", "cpu", "empty"]);
const RESULT_REASONS = new Set(["ring-out", "destroyed", "draw"]);
const SKILL_REJECT_REASONS = new Set([
  "match-not-live",
  "invalid-seat",
  "knocked-out",
  "empty-slot",
  "cooldown",
  "no-charges",
  "condition",
]);
const MAX_PART_ID_LENGTH = 128;
const MAX_NAME_LENGTH = 64;
const MAX_REASON_LENGTH = 2_048;
const MAX_SNAPSHOT_EVENTS = 256;
const MAX_PHASE_ID_LENGTH = 96;
const MAX_ENDLESS_STACK = 4_096;
const MAX_ENDLESS_TOTAL_PARTS = 32_768;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isIntegerBetween(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum
  );
}

function isBoundedString(
  value: unknown,
  maximum: number,
  minimum = 0,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum
  );
}

function isSeatIndex(value: unknown): value is SeatIndex {
  return isIntegerBetween(value, 0, 7);
}

function isSkillSlot(value: unknown): value is SkillSlot {
  return isIntegerBetween(value, 1, 7);
}

function isArenaId(value: unknown): value is SimRingArena["id"] {
  return typeof value === "string" && RING_IDS.has(value);
}

function isRoomSettings(value: unknown): value is VortexRoomSettings {
  if (!isRecord(value)) return false;
  if (
    !isFiniteNumber(value.costLimit) ||
    value.costLimit <= 0 ||
    value.costLimit > Number.MAX_SAFE_INTEGER ||
    !isArenaId(value.arenaId) ||
    (value.mode !== "custom" &&
      value.mode !== "draft" &&
      value.mode !== "endless") ||
    !isIntegerBetween(value.playerCount, 2, 4) ||
    !isIntegerBetween(value.cpuCount, 0, 3) ||
    (value.cpuCount as number) >= (value.playerCount as number) ||
    !isIntegerBetween(value.seed, 0, 0xffff_ffff) ||
    value.draftTurnSec !== 12
  ) {
    return false;
  }
  if (value.mode === "endless" && value.cpuCount !== 0) return false;
  return true;
}

export function isTopBuildMessage(value: unknown): value is TopBuildSpec {
  if (
    !isRecord(value) ||
    value.v !== 1 ||
    !isBoundedString(value.name, MAX_NAME_LENGTH, 1) ||
    !isIntegerBetween(value.paint, 0, 0xff_ffff) ||
    !isRecord(value.parts)
  ) {
    return false;
  }
  const parts = value.parts;
  return TOP_SLOTS.every((slot) =>
    isBoundedString(parts[slot], MAX_PART_ID_LENGTH, 1),
  );
}

function isLobbySeat(value: unknown): value is LobbySeat {
  return (
    isRecord(value) &&
    isIntegerBetween(value.seat, 0, 3) &&
    isBoundedString(value.name, MAX_NAME_LENGTH, 1) &&
    typeof value.occupant === "string" &&
    LOBBY_OCCUPANTS.has(value.occupant) &&
    typeof value.ready === "boolean" &&
    (value.build === null || isTopBuildMessage(value.build))
  );
}

function isLaunchMeterSpec(value: unknown): value is LaunchMeterSpec {
  return (
    isRecord(value) &&
    value.v === 1 &&
    isIntegerBetween(value.seed, 0, 0xffff_ffff) &&
    value.durationMs === 8_000 &&
    isRecord(value.targetZone) &&
    isFiniteNumber(value.targetZone.start) &&
    isFiniteNumber(value.targetZone.end) &&
    value.targetZone.start >= 0 &&
    value.targetZone.start < value.targetZone.end &&
    value.targetZone.end <= 1 &&
    isFiniteNumber(value.sweepCount) &&
    value.sweepCount >= 0.5 &&
    value.sweepCount <= 30 &&
    isFiniteNumber(value.phaseOffset) &&
    value.phaseOffset >= 0 &&
    value.phaseOffset < 1 &&
    (value.direction === -1 || value.direction === 1)
  );
}

function isLaunchPhase(value: unknown): value is LaunchPhaseView {
  if (
    !isRecord(value) ||
    value.v !== 1 ||
    !isBoundedString(value.phaseId, MAX_PHASE_ID_LENGTH, 1) ||
    (value.kind !== "match" && value.kind !== "endless") ||
    !isIntegerBetween(value.round, 1, Number.MAX_SAFE_INTEGER) ||
    !(
      value.wave === null ||
      isIntegerBetween(value.wave, 1, Number.MAX_SAFE_INTEGER)
    ) ||
    !Array.isArray(value.specs) ||
    value.specs.length < 2 ||
    value.specs.length > 8 ||
    !value.specs.every(isLaunchMeterSpec) ||
    !Array.isArray(value.powers) ||
    value.powers.length !== value.specs.length ||
    !value.powers.every(
      (power) =>
        power === null ||
        (isFiniteNumber(power) && power >= 0 && power <= 1.25),
    ) ||
    !isFiniteNumber(value.remainingMs) ||
    value.remainingMs < 0 ||
    value.remainingMs > 8_000
  ) {
    return false;
  }
  return value.kind === "endless"
    ? value.wave === value.round
    : value.wave === null && value.round === 1;
}

function hasBoundedRogueBuilds(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.players)) return false;
  let totalParts = 0;
  for (const player of value.players) {
    if (!isRecord(player) || !isRecord(player.build)) return false;
    const parts = player.build.parts;
    if (!isRecord(parts)) return false;
    for (const slot of TOP_SLOTS) {
      const stack = parts[slot];
      if (
        !Array.isArray(stack) ||
        stack.length < 1 ||
        stack.length > MAX_ENDLESS_STACK ||
        !stack.every((id) =>
          isBoundedString(id, MAX_PART_ID_LENGTH, 1),
        )
      ) {
        return false;
      }
      totalParts += stack.length;
      if (totalParts > MAX_ENDLESS_TOTAL_PARTS) return false;
    }
  }
  return true;
}

function isEndlessState(value: unknown): value is EndlessStateView {
  if (
    !isRecord(value) ||
    value.v !== 1 ||
    !isIntegerBetween(value.revision, 0, Number.MAX_SAFE_INTEGER) ||
    (value.phase !== "battle" &&
      value.phase !== "reward" &&
      value.phase !== "game-over") ||
    !isFiniteNumber(value.remainingMs) ||
    value.remainingMs < 0 ||
    value.remainingMs > 15_000 ||
    !hasBoundedRogueBuilds(value.run)
  ) {
    return false;
  }
  try {
    assertEndlessRun(value.run);
  } catch {
    return false;
  }
  const run = value.run;
  if (
    (value.phase === "reward") !== (run.phase === "reward") ||
    (value.phase === "battle" && run.phase !== "battle")
  ) {
    return false;
  }
  if (value.phase === "game-over") {
    return (
      run.phase === "battle" &&
      isRecord(value.gameOver) &&
      isIntegerBetween(value.gameOver.wave, 1, Number.MAX_SAFE_INTEGER) &&
      isIntegerBetween(value.gameOver.cleared, 0, Number.MAX_SAFE_INTEGER) &&
      value.gameOver.cleared <= value.gameOver.wave - 1 &&
      isIntegerBetween(value.gameOver.score, 0, Number.MAX_SAFE_INTEGER) &&
      value.remainingMs === 0
    );
  }
  return value.gameOver === null &&
    (value.phase === "reward" ? value.remainingMs <= 15_000 : value.remainingMs === 0);
}

function isLobby(value: unknown): value is VortexLobby {
  if (
    !isRecord(value) ||
    !(
      value.roomCode === null ||
      isBoundedString(value.roomCode, 64, 1)
    ) ||
    !isRoomSettings(value.settings) ||
    !Array.isArray(value.seats) ||
    value.seats.length !== 4 ||
    !value.seats.every(isLobbySeat)
  ) {
    return false;
  }
  return new Set(value.seats.map((seat) => seat.seat)).size === 4;
}

function isDraftState(value: unknown): value is DraftState {
  if (
    !isRecord(value) ||
    value.v !== 1 ||
    !isIntegerBetween(value.seed, 1, 0xffff_ffff) ||
    !Array.isArray(value.players) ||
    value.players.length < 2 ||
    value.players.length > 4 ||
    !Array.isArray(value.baseOrder) ||
    value.baseOrder.length !== value.players.length ||
    !Array.isArray(value.picks) ||
    value.picks.length !== value.players.length ||
    !Array.isArray(value.claimedPartIds) ||
    value.claimedPartIds.length > 28 ||
    !isIntegerBetween(value.slotIndex, 0, 7) ||
    !isIntegerBetween(value.pickIndex, 0, value.players.length - 1) ||
    !isFiniteNumber(value.costLimit) ||
    value.costLimit <= 0 ||
    value.costLimit > Number.MAX_SAFE_INTEGER ||
    value.turnDurationMs !== 12_000 ||
    !isFiniteNumber(value.deadlineMs) ||
    value.deadlineMs < 0 ||
    typeof value.completed !== "boolean"
  ) {
    return false;
  }
  const players = value.players;
  const baseOrder = value.baseOrder;
  const picksByPlayer = value.picks;
  const claimedPartIds = value.claimedPartIds;
  const playersValid = players.every(
    (player) =>
      isRecord(player) &&
      isBoundedString(player.id, 64, 1) &&
      isBoundedString(player.name, MAX_NAME_LENGTH, 1) &&
      typeof player.isCpu === "boolean",
  );
  if (
    !playersValid ||
    new Set(
      players.map((player) =>
        isRecord(player) ? player.id : undefined,
      ),
    ).size !== players.length ||
    !baseOrder.every((seat) =>
      isIntegerBetween(seat, 0, players.length - 1),
    ) ||
    new Set(baseOrder).size !== players.length ||
    !claimedPartIds.every((id) =>
      isBoundedString(id, MAX_PART_ID_LENGTH, 1),
    ) ||
    new Set(claimedPartIds).size !== claimedPartIds.length ||
    value.completed !== (value.slotIndex === TOP_SLOTS.length)
  ) {
    return false;
  }
  const pickedIds: string[] = [];
  for (const picks of picksByPlayer) {
    if (!isRecord(picks)) return false;
    for (const slot of TOP_SLOTS) {
      const id = picks[slot];
      if (id === undefined) continue;
      if (!isBoundedString(id, MAX_PART_ID_LENGTH, 1)) return false;
      pickedIds.push(id);
    }
  }
  const expectedPicks =
    value.slotIndex * value.players.length +
    (value.completed ? 0 : value.pickIndex);
  if (
    pickedIds.length !== expectedPicks ||
    pickedIds.length !== claimedPartIds.length ||
    new Set(pickedIds).size !== pickedIds.length
  ) {
    return false;
  }
  const claimed = new Set(claimedPartIds);
  return pickedIds.every((id) => claimed.has(id));
}

function isSkillSnapshot(value: unknown): value is SkillSnapshot {
  return (
    isRecord(value) &&
    isSkillSlot(value.slot) &&
    (value.skillId === null ||
      isBoundedString(value.skillId, MAX_PART_ID_LENGTH, 1)) &&
    isFiniteNumber(value.cooldown) &&
    value.cooldown >= 0 &&
    isIntegerBetween(value.charges, -1, 1_000) &&
    typeof value.ready === "boolean" &&
    isIntegerBetween(value.groupSize, 0, MAX_ENDLESS_STACK) &&
    isIntegerBetween(value.readyCount, 0, value.groupSize as number) &&
    (value.blocked === null ||
      (typeof value.blocked === "string" &&
        SKILL_REJECT_REASONS.has(value.blocked)))
  );
}

function isTopSnapshot(value: unknown): value is TopSnapshot {
  if (
    !isRecord(value) ||
    !isSeatIndex(value.seat) ||
    typeof value.alive !== "boolean" ||
    !isFiniteNumber(value.hp) ||
    value.hp < 0 ||
    !isFiniteNumber(value.hpMax) ||
    value.hpMax <= 0 ||
    !isFiniteNumber(value.spin) ||
    value.spin < 0 ||
    ![
      value.x,
      value.y,
      value.z,
      value.qx,
      value.qy,
      value.qz,
      value.qw,
      value.vx,
      value.vy,
      value.vz,
    ].every(isFiniteNumber) ||
    !Array.isArray(value.skills) ||
    value.skills.length > 7 ||
    !value.skills.every(isSkillSnapshot)
  ) {
    return false;
  }
  return (
    new Set(value.skills.map((skill) => skill.slot)).size ===
    value.skills.length
  );
}

function isSimEvent(value: unknown): value is SimEvent {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "impact":
      return (
        isSeatIndex(value.attacker) &&
        isSeatIndex(value.victim) &&
        isFiniteNumber(value.damage) &&
        value.damage >= 0 &&
        isFiniteNumber(value.impulse) &&
        value.impulse >= 0 &&
        Array.isArray(value.point) &&
        value.point.length === 3 &&
        value.point.every(isFiniteNumber)
      );
    case "skill":
      return (
        isSeatIndex(value.seat) &&
        isSkillSlot(value.slot) &&
        isBoundedString(value.skillId, MAX_PART_ID_LENGTH, 1)
      );
    case "shockwave":
      return (
        isSeatIndex(value.seat) &&
        isFiniteNumber(value.radius) &&
        value.radius >= 0
      );
    case "knockout":
      return (
        isSeatIndex(value.seat) &&
        typeof value.reason === "string" &&
        KNOCKOUT_REASONS.has(value.reason) &&
        (value.by === null || isSeatIndex(value.by))
      );
    case "sudden-death":
      return isIntegerBetween(value.stage, 1, 6);
    default:
      return false;
  }
}

function isSnapshot(value: unknown): value is VortexSnapshot {
  if (
    !isRecord(value) ||
    !isIntegerBetween(value.tick, 0, Number.MAX_SAFE_INTEGER) ||
    !isFiniteNumber(value.elapsed) ||
    value.elapsed < 0 ||
    typeof value.phase !== "string" ||
    !MATCH_PHASES.has(value.phase) ||
    !isIntegerBetween(value.suddenDeathStage, 0, 6) ||
    !isArenaId(value.arenaId) ||
    !Array.isArray(value.tops) ||
    value.tops.length < 1 ||
    value.tops.length > 8 ||
    !value.tops.every(isTopSnapshot) ||
    new Set(value.tops.map((top) => top.seat)).size !== value.tops.length ||
    !Array.isArray(value.events) ||
    value.events.length > MAX_SNAPSHOT_EVENTS ||
    !value.events.every(isSimEvent)
  ) {
    return false;
  }
  return true;
}

function isResult(value: unknown): value is VortexResult {
  if (
    !isRecord(value) ||
    !(value.winner === null || isSeatIndex(value.winner)) ||
    !(
      value.winnerTeam === null ||
      isIntegerBetween(value.winnerTeam, 0, 7)
    ) ||
    typeof value.reason !== "string" ||
    !RESULT_REASONS.has(value.reason) ||
    !isFiniteNumber(value.durationSec) ||
    value.durationSec < 0 ||
    !Array.isArray(value.knockouts) ||
    value.knockouts.length > 8
  ) {
    return false;
  }
  return value.knockouts.every(
    (knockout) =>
      isRecord(knockout) &&
      isSeatIndex(knockout.seat) &&
      typeof knockout.reason === "string" &&
      KNOCKOUT_REASONS.has(knockout.reason) &&
      isFiniteNumber(knockout.at) &&
      knockout.at >= 0,
  );
}

export function isClientMessage(value: unknown): value is ClientMessage {
  if (!isRecord(value) || typeof value.t !== "string") return false;
  switch (value.t) {
    case "hello":
      return (
        isIntegerBetween(value.v, 0, 1_000) &&
        isBoundedString(value.name, MAX_NAME_LENGTH, 1) &&
        isTopBuildMessage(value.build)
      );
    case "build":
      return isTopBuildMessage(value.build);
    case "ready":
      return typeof value.ready === "boolean";
    case "draft-pick":
      return (
        typeof value.partId === "string" &&
        value.partId.length > 0 &&
        value.partId.length <= 128 &&
        Number.isSafeInteger(value.revision) &&
        (value.revision as number) >= 0
      );
    case "launch-stop":
      return (
        isBoundedString(value.phaseId, MAX_PHASE_ID_LENGTH, 1) &&
        isFiniteNumber(value.stoppedAtMs) &&
        value.stoppedAtMs >= 0 &&
        value.stoppedAtMs <= 8_000
      );
    case "endless-pick":
      return (
        isIntegerBetween(value.revision, 0, Number.MAX_SAFE_INTEGER) &&
        isBoundedString(value.offerId, 128, 1) &&
        isBoundedString(value.partId, MAX_PART_ID_LENGTH, 1)
      );
    case "skill":
      return (
        isIntegerBetween(value.seq, 0, Number.MAX_SAFE_INTEGER) &&
        isSkillSlot(value.slot)
      );
    case "rematch":
      return true;
    default:
      return false;
  }
}

export function isHostMessage(value: unknown): value is HostMessage {
  try {
    if (!isRecord(value) || typeof value.t !== "string") return false;
    switch (value.t) {
      case "welcome":
        return (
          isIntegerBetween(value.v, 0, 1_000) &&
          isSeatIndex(value.seat) &&
          isRoomSettings(value.settings)
        );
      case "lobby":
        return isLobby(value.lobby);
      case "draft":
        return (
          isDraftState(value.draft) &&
          isFiniteNumber(value.remainingMs) &&
          value.remainingMs >= 0 &&
          value.remainingMs <= 12_000
        );
      case "launch":
        return isLaunchPhase(value.launch);
      case "endless":
        return isEndlessState(value.endless);
      case "start": {
        if (
          !isIntegerBetween(value.seed, 0, 0xffff_ffff) ||
          !isRoomSettings(value.settings) ||
          !Array.isArray(value.builds) ||
          value.builds.length < 2 ||
          value.builds.length > 8 ||
          !value.builds.every(isTopBuildMessage) ||
          !Array.isArray(value.names) ||
          value.names.length !== value.builds.length ||
          value.names.length > 8 ||
          !value.names.every((name) =>
            isBoundedString(name, MAX_NAME_LENGTH, 1),
          ) ||
          !Array.isArray(value.launchPowers) ||
          value.launchPowers.length !== value.builds.length ||
          !value.launchPowers.every(
            (power) =>
              isFiniteNumber(power) && power >= 0 && power <= 1.25,
          ) ||
          !Array.isArray(value.teamIds) ||
          value.teamIds.length !== value.builds.length ||
          !value.teamIds.every((team) => isIntegerBetween(team, 0, 7)) ||
          new Set(value.teamIds).size < 2 ||
          !(
            value.wave === null ||
            isIntegerBetween(value.wave, 1, Number.MAX_SAFE_INTEGER)
          ) ||
          !Array.isArray(value.stackCounts) ||
          value.stackCounts.length !== value.builds.length ||
          !value.stackCounts.every(
            (counts) =>
              Array.isArray(counts) &&
              counts.length === TOP_SLOTS.length &&
              counts.every((count) =>
                isIntegerBetween(count, 1, MAX_ENDLESS_STACK),
              ),
          )
        ) {
          return false;
        }
        if (value.settings.mode === "endless") {
          const enemyCount = value.settings.playerCount === 2 ? 1 : 2;
          return (
            value.wave !== null &&
            value.builds.length === value.settings.playerCount + enemyCount &&
            value.teamIds
              .slice(0, value.settings.playerCount)
              .every((team) => team === 0) &&
            value.teamIds
              .slice(value.settings.playerCount)
              .every((team) => team === 1)
          );
        }
        return (
          value.wave === null &&
          value.builds.length === value.settings.playerCount
        );
      }
      case "snapshot":
        return isSnapshot(value.snapshot);
      case "result":
        return isResult(value.result);
      case "reject":
        return isBoundedString(value.reason, MAX_REASON_LENGTH, 1);
      case "ended":
        return value.reason === "host-left" || value.reason === "host-ended";
      default:
        return false;
    }
  } catch {
    return false;
  }
}
