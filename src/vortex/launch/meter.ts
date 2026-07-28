/**
 * Pure, deterministic launch-meter domain.
 *
 * The state and stop result contain JSON-safe data only. Rendering code may
 * sample `position` however often it likes; the result depends solely on the
 * serialised specification and elapsed milliseconds.
 */

export const LAUNCH_METER_VERSION = 1 as const;
export const LAUNCH_POWER_MIN = 0;
export const LAUNCH_POWER_MAX = 1.25;
export const LAUNCH_TIMEOUT_POWER = 0.6;

const DEFAULT_DURATION_MS = 3_200;
const MIN_DURATION_MS = 500;
const MAX_DURATION_MS = 30_000;
const MIN_ZONE_WIDTH = 0.02;

export type LaunchGrade =
  | "miss"
  | "good"
  | "great"
  | "perfect"
  | "timeout";

export interface LaunchTargetZone {
  readonly start: number;
  readonly end: number;
}

export interface LaunchMeterOptions {
  readonly seed: number;
  readonly durationMs?: number;
  readonly targetZone?: LaunchTargetZone;
  /** Optional explicit number of full left/right sweeps. */
  readonly sweepCount?: number;
}

export interface LaunchMeterSpec {
  readonly v: typeof LAUNCH_METER_VERSION;
  readonly seed: number;
  readonly durationMs: number;
  readonly targetZone: LaunchTargetZone;
  readonly sweepCount: number;
  readonly phaseOffset: number;
  readonly direction: -1 | 1;
}

export interface LaunchStopResult {
  readonly v: typeof LAUNCH_METER_VERSION;
  readonly seed: number;
  readonly stoppedAtMs: number;
  readonly position: number;
  readonly targetZone: LaunchTargetZone;
  /** Normalised timing quality. 1 is the exact centre of the target. */
  readonly score: number;
  /** Physics launch multiplier, always within 0..1.25. */
  readonly power: number;
  readonly grade: LaunchGrade;
  readonly timedOut: boolean;
}

export interface LaunchMeterState {
  readonly v: typeof LAUNCH_METER_VERSION;
  readonly spec: LaunchMeterSpec;
  readonly elapsedMs: number;
  readonly position: number;
  readonly status: "running" | "stopped";
  readonly result: LaunchStopResult | null;
}

function finite(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function fract(value: number): number {
  return value - Math.floor(value);
}

/**
 * A small integer hash avoids mutable RNG state while giving each seed a
 * distinct starting phase, direction and default sweep rate.
 */
function hashSeed(seed: number, salt: number): number {
  let value = ((seed >>> 0) ^ salt) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 4_294_967_296;
}

function normaliseZone(zone: LaunchTargetZone | undefined): LaunchTargetZone {
  const rawStart = finite(zone?.start, 0.4);
  const rawEnd = finite(zone?.end, 0.6);
  let start = clamp(Math.min(rawStart, rawEnd), 0, 1);
  let end = clamp(Math.max(rawStart, rawEnd), 0, 1);
  if (end - start < MIN_ZONE_WIDTH) {
    const centre = clamp((start + end) / 2, MIN_ZONE_WIDTH / 2, 1 - MIN_ZONE_WIDTH / 2);
    start = centre - MIN_ZONE_WIDTH / 2;
    end = centre + MIN_ZONE_WIDTH / 2;
  }
  return { start, end };
}

function normaliseSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0;
}

function makeSpec(options: LaunchMeterOptions): LaunchMeterSpec {
  const seed = normaliseSeed(options.seed);
  const durationMs = Math.round(
    clamp(finite(options.durationMs, DEFAULT_DURATION_MS), MIN_DURATION_MS, MAX_DURATION_MS),
  );
  // Keep the sweet spot readable on 60 Hz desktop and high-latency touch
  // screens. The meter still crosses the target several times, but a pass is
  // long enough to be a timing decision instead of a one-frame lottery.
  const generatedSweeps = 2.2 + hashSeed(seed, 0x91e10da5) * 1.2;
  return {
    v: LAUNCH_METER_VERSION,
    seed,
    durationMs,
    targetZone: normaliseZone(options.targetZone),
    sweepCount: clamp(finite(options.sweepCount, generatedSweeps), 0.5, 30),
    phaseOffset: hashSeed(seed, 0x4f1bbcdc),
    direction: hashSeed(seed, 0xa31d5271) < 0.5 ? -1 : 1,
  };
}

export function launchPositionAt(
  spec: LaunchMeterSpec,
  elapsedMs: number,
): number {
  const progress = clamp(finite(elapsedMs, 0), 0, spec.durationMs) / spec.durationMs;
  const phase = fract(
    spec.phaseOffset + spec.direction * spec.sweepCount * progress,
  );
  // Triangle wave: 0 -> 1 -> 0. It gives both directions equal timing width
  // and is stable at fixed elapsed values across render frame rates.
  return clamp(1 - Math.abs(phase * 2 - 1), 0, 1);
}

function scorePosition(position: number, zone: LaunchTargetZone): number {
  const centre = (zone.start + zone.end) / 2;
  const halfWidth = Math.max(MIN_ZONE_WIDTH / 2, (zone.end - zone.start) / 2);
  const miss = Math.abs(position - centre);
  if (miss <= halfWidth) {
    const precision = 1 - miss / halfWidth;
    return clamp(0.8 + precision * 0.2, 0, 1);
  }
  const outside = miss - halfWidth;
  const farthest = Math.max(halfWidth, Math.max(centre, 1 - centre) - halfWidth);
  return clamp(0.8 * (1 - outside / farthest), 0, 0.8);
}

function gradeFor(score: number): Exclude<LaunchGrade, "timeout"> {
  if (score >= 0.94) return "perfect";
  if (score >= 0.84) return "great";
  if (score >= 0.6) return "good";
  return "miss";
}

function stopResult(
  spec: LaunchMeterSpec,
  elapsedMs: number,
  timedOut: boolean,
): LaunchStopResult {
  const stoppedAtMs = clamp(finite(elapsedMs, 0), 0, spec.durationMs);
  const position = launchPositionAt(spec, stoppedAtMs);
  const score = timedOut
    ? LAUNCH_TIMEOUT_POWER / LAUNCH_POWER_MAX
    : scorePosition(position, spec.targetZone);
  return {
    v: LAUNCH_METER_VERSION,
    seed: spec.seed,
    stoppedAtMs,
    position,
    targetZone: spec.targetZone,
    score,
    power: timedOut
      ? LAUNCH_TIMEOUT_POWER
      : clamp(score * LAUNCH_POWER_MAX, LAUNCH_POWER_MIN, LAUNCH_POWER_MAX),
    grade: timedOut ? "timeout" : gradeFor(score),
    timedOut,
  };
}

function runningState(spec: LaunchMeterSpec, elapsedMs: number): LaunchMeterState {
  const elapsed = clamp(finite(elapsedMs, 0), 0, spec.durationMs);
  return {
    v: LAUNCH_METER_VERSION,
    spec,
    elapsedMs: elapsed,
    position: launchPositionAt(spec, elapsed),
    status: "running",
    result: null,
  };
}

export function createLaunchMeter(options: LaunchMeterOptions): LaunchMeterState {
  return runningState(makeSpec(options), 0);
}

/**
 * Advances by a delta. Reaching the duration automatically resolves to the
 * deterministic timeout fallback so an unattended seat can never block play.
 */
export function advanceLaunchMeter(
  state: LaunchMeterState,
  deltaMs: number,
): LaunchMeterState {
  if (state.status === "stopped") return state;
  const elapsed = clamp(
    state.elapsedMs + Math.max(0, finite(deltaMs, 0)),
    0,
    state.spec.durationMs,
  );
  if (elapsed >= state.spec.durationMs) {
    const result = stopResult(state.spec, state.spec.durationMs, true);
    return {
      v: LAUNCH_METER_VERSION,
      spec: state.spec,
      elapsedMs: state.spec.durationMs,
      position: result.position,
      status: "stopped",
      result,
    };
  }
  return runningState(state.spec, elapsed);
}

/**
 * Resolves a manual stop. `elapsedMs` is optional to make event-timestamp
 * integration easy without coupling this domain to `performance.now()`.
 */
export function stopLaunchMeter(
  state: LaunchMeterState,
  elapsedMs = state.elapsedMs,
): LaunchMeterState {
  if (state.status === "stopped") return state;
  const timedOut = !Number.isFinite(elapsedMs) || elapsedMs >= state.spec.durationMs;
  const result = stopResult(
    state.spec,
    timedOut ? state.spec.durationMs : Math.max(0, elapsedMs),
    timedOut,
  );
  return {
    v: LAUNCH_METER_VERSION,
    spec: state.spec,
    elapsedMs: result.stoppedAtMs,
    position: result.position,
    status: "stopped",
    result,
  };
}

export function serializeLaunchMeter(state: LaunchMeterState): string {
  return JSON.stringify(state);
}

/**
 * Restores only validated primitives and recomputes position/result. This
 * prevents a caller-provided JSON payload from injecting a power above 1.25.
 */
export function deserializeLaunchMeter(serialized: string): LaunchMeterState {
  const value = JSON.parse(serialized) as {
    readonly v?: unknown;
    readonly spec?: Partial<LaunchMeterSpec>;
    readonly elapsedMs?: unknown;
    readonly status?: unknown;
  };
  if (
    value.v !== LAUNCH_METER_VERSION ||
    value.spec?.v !== LAUNCH_METER_VERSION ||
    typeof value.spec.seed !== "number" ||
    typeof value.spec.durationMs !== "number" ||
    typeof value.spec.sweepCount !== "number" ||
    typeof value.spec.phaseOffset !== "number" ||
    (value.spec.direction !== -1 && value.spec.direction !== 1) ||
    typeof value.spec.targetZone?.start !== "number" ||
    typeof value.spec.targetZone?.end !== "number"
  ) {
    throw new Error("Invalid VORTEX launch-meter payload");
  }
  const spec: LaunchMeterSpec = {
    v: LAUNCH_METER_VERSION,
    seed: normaliseSeed(value.spec.seed),
    durationMs: Math.round(
      clamp(finite(value.spec.durationMs, DEFAULT_DURATION_MS), MIN_DURATION_MS, MAX_DURATION_MS),
    ),
    targetZone: normaliseZone(value.spec.targetZone),
    sweepCount: clamp(finite(value.spec.sweepCount, 4), 0.5, 30),
    phaseOffset: fract(finite(value.spec.phaseOffset, 0)),
    direction: value.spec.direction,
  };
  const elapsed =
    typeof value.elapsedMs === "number" ? value.elapsedMs : 0;
  const restored = runningState(spec, elapsed);
  return value.status === "stopped"
    ? stopLaunchMeter(restored, elapsed)
    : restored;
}
