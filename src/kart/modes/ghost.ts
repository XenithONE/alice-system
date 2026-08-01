/**
 * Time-trial ghosts: position recording, not input replay.
 *
 * Input replay is smaller but dies with every balance patch — a saved run
 * replayed through faster physics is a different race. Poses survive tuning.
 * Format ("NKG1", little-endian):
 *
 *   HEADER (57 B)
 *     u32 magic "NKG1" | u8 version | u8 flags (bit0 mirror, bits1-2 class)
 *     u8 hz | u8 laps | u32 trackHash | u32 lengthQ (track.length × 16)
 *     u32 frameCount | u32 totalMs | u32×3 lapMs
 *     i32×3 start x,y,z (×32) | i32 start yaw (×1024) | i8 slip (×16) | 3B pad
 *   FRAMES (9 B each, at 10 Hz)
 *     i16 dx,dy,dz (delta of ×32-quantized ints) | i16 dyaw (×1024) | i8 slip
 *
 * Quantize-THEN-delta: deltas of ints accumulate exactly, so decode error is
 * a constant ±1/64 m with zero drift. `lengthQ` is the geometry checksum — a
 * respline invalidates every stored ghost instead of replaying one through a
 * road that no longer exists.
 */

import { hashStr } from "../../lib/seed";

export const GHOST_MAGIC = 0x314b474e; // "NKG1" little-endian
/**
 * 2: the heading frame was corrected (track.ts), so every yaw stored by a v1
 * ghost is half a turn out. Bumping this makes `decodeGhost` drop them instead
 * of replaying a lap backwards.
 */
export const GHOST_VERSION = 2;
export const GHOST_HZ = 10;
const HEADER_BYTES = 57;
const FRAME_BYTES = 9;
const POSITION_SCALE = 32;
const YAW_SCALE = 1024;
const SLIP_SCALE = 16;
export const GHOST_MAX_FRAMES = 6000; // 600 s at 10 Hz
export const GHOST_BUDGET_BYTES = 30_000;

export interface GhostPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly slip: number;
}

export interface GhostData {
  readonly mirror: boolean;
  readonly speedClass: number;
  readonly laps: number;
  readonly totalMs: number;
  readonly lapMs: readonly [number, number, number];
  readonly frames: readonly GhostPose[];
}

export interface GhostExpectation {
  readonly trackId: string;
  readonly trackLength: number;
  readonly speedClass: number;
  readonly mirror: boolean;
}

export function ghostKey(
  trackId: string,
  speedClass: number,
  mirror: boolean,
): string {
  return `nk.ghost.v1.${trackId}.${speedClass}${mirror ? ".m" : ""}`;
}

/** Records poses at GHOST_HZ, deduplicating by frame index. */
export class GhostRecorder {
  private readonly frames: GhostPose[] = [];
  private lapMs: number[] = [];

  /** `raceSec` is elapsed − COUNTDOWN_SEC (216 exact ticks, no drift). */
  push(raceSec: number, pose: GhostPose): void {
    if (raceSec < 0) return;
    const index = Math.floor(raceSec * GHOST_HZ);
    if (index < this.frames.length) return;
    // Fill gaps (a dropped frame) by repeating the previous pose.
    while (this.frames.length < index) {
      const previous = this.frames[this.frames.length - 1] ?? pose;
      this.frames.push(previous);
      if (this.frames.length >= GHOST_MAX_FRAMES) return;
    }
    if (this.frames.length >= GHOST_MAX_FRAMES) return;
    this.frames.push(pose);
  }

  markLap(lapTimeSec: number): void {
    if (this.lapMs.length < 3) this.lapMs.push(Math.round(lapTimeSec * 1000));
  }

  get frameCount(): number {
    return this.frames.length;
  }

  finish(totalSec: number, mirror: boolean, speedClass: number, laps: number): GhostData {
    const lapMs: [number, number, number] = [
      this.lapMs[0] ?? 0,
      this.lapMs[1] ?? 0,
      this.lapMs[2] ?? 0,
    ];
    return {
      mirror,
      speedClass,
      laps,
      totalMs: Math.round(totalSec * 1000),
      lapMs,
      frames: this.frames.slice(),
    };
  }
}

function quantizePose(pose: GhostPose): [number, number, number, number, number] {
  return [
    Math.round(pose.x * POSITION_SCALE),
    Math.round(pose.y * POSITION_SCALE),
    Math.round(pose.z * POSITION_SCALE),
    Math.round(pose.yaw * YAW_SCALE),
    Math.max(-127, Math.min(127, Math.round(pose.slip * SLIP_SCALE))),
  ];
}

/** Unwrap yaw so deltas stay small across the ±π seam. */
function unwrapYaws(frames: readonly GhostPose[]): number[] {
  const yaws: number[] = [];
  let previous = frames[0]?.yaw ?? 0;
  let accumulated = previous;
  for (const frame of frames) {
    let delta = frame.yaw - previous;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    accumulated += delta;
    previous = frame.yaw;
    yaws.push(accumulated);
  }
  return yaws;
}

/** Encode to base64, or null when the run exceeds the storage budget. */
export function encodeGhost(
  ghost: GhostData,
  expectation: GhostExpectation,
): string | null {
  const count = ghost.frames.length;
  if (count < 2 || count > GHOST_MAX_FRAMES) return null;
  const bytes = new ArrayBuffer(HEADER_BYTES + count * FRAME_BYTES);
  const view = new DataView(bytes);
  view.setUint32(0, GHOST_MAGIC, true);
  view.setUint8(4, GHOST_VERSION);
  view.setUint8(
    5,
    (ghost.mirror ? 1 : 0) | ((ghost.speedClass & 3) << 1),
  );
  view.setUint8(6, GHOST_HZ);
  view.setUint8(7, ghost.laps);
  view.setUint32(8, hashStr(expectation.trackId), true);
  view.setUint32(12, Math.round(expectation.trackLength * 16), true);
  view.setUint32(16, count, true);
  view.setUint32(20, ghost.totalMs, true);
  view.setUint32(24, ghost.lapMs[0], true);
  view.setUint32(28, ghost.lapMs[1], true);
  view.setUint32(32, ghost.lapMs[2], true);

  const yaws = unwrapYaws(ghost.frames);
  const first = quantizePose(ghost.frames[0]!);
  const firstYawQ = Math.round(yaws[0]! * YAW_SCALE);
  view.setInt32(36, first[0], true);
  view.setInt32(40, first[1], true);
  view.setInt32(44, first[2], true);
  view.setInt32(48, firstYawQ, true);
  view.setInt8(52, first[4]);

  let px = first[0];
  let py = first[1];
  let pz = first[2];
  let pyaw = firstYawQ;
  for (let index = 0; index < count; index += 1) {
    const q = quantizePose(ghost.frames[index]!);
    const yawQ = Math.round(yaws[index]! * YAW_SCALE);
    const offset = HEADER_BYTES + index * FRAME_BYTES;
    const dx = q[0] - px;
    const dy = q[1] - py;
    const dz = q[2] - pz;
    const dyaw = yawQ - pyaw;
    if (
      Math.abs(dx) > 32767 ||
      Math.abs(dy) > 32767 ||
      Math.abs(dz) > 32767 ||
      Math.abs(dyaw) > 32767
    ) {
      return null; // teleporting run — refuse rather than corrupt
    }
    view.setInt16(offset, dx, true);
    view.setInt16(offset + 2, dy, true);
    view.setInt16(offset + 4, dz, true);
    view.setInt16(offset + 6, dyaw, true);
    view.setInt8(offset + 8, q[4]);
    px = q[0];
    py = q[1];
    pz = q[2];
    pyaw = yawQ;
  }

  const raw = new Uint8Array(bytes);
  let binary = "";
  for (let index = 0; index < raw.length; index += 1) {
    binary += String.fromCharCode(raw[index]!);
  }
  const encoded = btoa(binary);
  return encoded.length <= GHOST_BUDGET_BYTES ? encoded : null;
}

/** Decode; null (never throw) on any mismatch or corruption. */
export function decodeGhost(
  encoded: string,
  expectation: GhostExpectation,
): GhostData | null {
  try {
    const binary = atob(encoded);
    if (binary.length < HEADER_BYTES) return null;
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const view = new DataView(bytes.buffer);
    if (view.getUint32(0, true) !== GHOST_MAGIC) return null;
    if (view.getUint8(4) !== GHOST_VERSION) return null;
    const flags = view.getUint8(5);
    const mirror = (flags & 1) !== 0;
    const speedClass = (flags >> 1) & 3;
    if (mirror !== expectation.mirror) return null;
    if (speedClass !== expectation.speedClass) return null;
    if (view.getUint8(6) !== GHOST_HZ) return null;
    const laps = view.getUint8(7);
    if (view.getUint32(8, true) !== hashStr(expectation.trackId)) return null;
    if (
      view.getUint32(12, true) !== Math.round(expectation.trackLength * 16)
    ) {
      return null;
    }
    const count = view.getUint32(16, true);
    if (count < 2 || count > GHOST_MAX_FRAMES) return null;
    if (bytes.length !== HEADER_BYTES + count * FRAME_BYTES) return null;
    const totalMs = view.getUint32(20, true);
    const lapMs: [number, number, number] = [
      view.getUint32(24, true),
      view.getUint32(28, true),
      view.getUint32(32, true),
    ];
    let x = view.getInt32(36, true);
    let y = view.getInt32(40, true);
    let z = view.getInt32(44, true);
    let yaw = view.getInt32(48, true);
    const frames: GhostPose[] = [];
    for (let index = 0; index < count; index += 1) {
      const offset = HEADER_BYTES + index * FRAME_BYTES;
      x += index === 0 ? 0 : view.getInt16(offset, true);
      y += index === 0 ? 0 : view.getInt16(offset + 2, true);
      z += index === 0 ? 0 : view.getInt16(offset + 4, true);
      yaw += index === 0 ? 0 : view.getInt16(offset + 6, true);
      const slip = view.getInt8(offset + 8) / SLIP_SCALE;
      frames.push({
        x: x / POSITION_SCALE,
        y: y / POSITION_SCALE,
        z: z / POSITION_SCALE,
        yaw: yaw / YAW_SCALE,
        slip,
      });
    }
    return { mirror, speedClass, laps, totalMs, lapMs, frames };
  } catch {
    return null;
  }
}

/** Linear pose sampling; null once the ghost has finished (+grace). */
export class GhostSampler {
  constructor(private readonly ghost: GhostData) {}

  sample(raceSec: number): GhostPose | null {
    if (raceSec < 0) return this.ghost.frames[0] ?? null;
    const exact = raceSec * GHOST_HZ;
    const index = Math.floor(exact);
    const frames = this.ghost.frames;
    if (index >= frames.length - 1) {
      // Two seconds of standing at the finish, then fade away.
      return raceSec * 1000 < this.ghost.totalMs + 2000
        ? frames[frames.length - 1]!
        : null;
    }
    const t = exact - index;
    const a = frames[index]!;
    const b = frames[index + 1]!;
    let yawDelta = b.yaw - a.yaw;
    while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
    while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
      yaw: a.yaw + yawDelta * t,
      slip: a.slip + (b.slip - a.slip) * t,
    };
  }
}
