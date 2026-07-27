import { INTERPOLATION_DELAY_SEC } from "../sim/balance";
import type {
  SkillSnapshot,
  TopSnapshot,
  VortexSnapshot,
} from "./protocol";

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(first: number, second: number, amount: number): number {
  return first + (second - first) * amount;
}

function interpolateSkills(
  first: readonly SkillSnapshot[],
  second: readonly SkillSnapshot[],
  amount: number,
): readonly SkillSnapshot[] {
  return second.map((skill) => {
    const prior = first.find((candidate) => candidate.slot === skill.slot);
    const discrete = amount < 1 && prior ? prior : skill;
    return {
      ...discrete,
      cooldown: prior
        ? Math.max(0, lerp(prior.cooldown, skill.cooldown, amount))
        : skill.cooldown,
    };
  });
}

function interpolateTop(
  first: TopSnapshot,
  second: TopSnapshot,
  amount: number,
): TopSnapshot {
  const discrete = amount < 1 ? first : second;
  let qx = second.qx;
  let qy = second.qy;
  let qz = second.qz;
  let qw = second.qw;
  const dot =
    first.qx * qx + first.qy * qy + first.qz * qz + first.qw * qw;
  if (dot < 0) {
    qx = -qx;
    qy = -qy;
    qz = -qz;
    qw = -qw;
  }
  let iqx = lerp(first.qx, qx, amount);
  let iqy = lerp(first.qy, qy, amount);
  let iqz = lerp(first.qz, qz, amount);
  let iqw = lerp(first.qw, qw, amount);
  const length = Math.max(1e-8, Math.hypot(iqx, iqy, iqz, iqw));
  iqx /= length;
  iqy /= length;
  iqz /= length;
  iqw /= length;
  return {
    ...discrete,
    hp: lerp(first.hp, second.hp, amount),
    spin: lerp(first.spin, second.spin, amount),
    x: lerp(first.x, second.x, amount),
    y: lerp(first.y, second.y, amount),
    z: lerp(first.z, second.z, amount),
    qx: iqx,
    qy: iqy,
    qz: iqz,
    qw: iqw,
    vx: lerp(first.vx, second.vx, amount),
    vy: lerp(first.vy, second.vy, amount),
    vz: lerp(first.vz, second.vz, amount),
    skills: interpolateSkills(first.skills, second.skills, amount),
  };
}

/**
 * A 100 ms simulation-time buffer. It does not extrapolate authoritative
 * physics; a late packet holds the most recent safe pose instead.
 */
export class SnapshotInterpolator {
  private readonly snapshots: VortexSnapshot[] = [];
  private lastEventTick = -1;

  constructor(
    readonly delaySec = INTERPOLATION_DELAY_SEC,
    readonly capacity = 8,
  ) {}

  push(snapshot: VortexSnapshot): void {
    const latest = this.snapshots[this.snapshots.length - 1];
    if (latest && snapshot.tick <= latest.tick) return;
    this.snapshots.push(snapshot);
    while (this.snapshots.length > Math.max(2, this.capacity)) {
      this.snapshots.shift();
    }
  }

  clear(): void {
    this.snapshots.length = 0;
    this.lastEventTick = -1;
  }

  sample(): VortexSnapshot | null {
    const latest = this.snapshots[this.snapshots.length - 1];
    if (!latest) return null;
    const targetElapsed = latest.elapsed - Math.max(0, this.delaySec);
    let first = this.snapshots[0]!;
    let second = first;
    for (let index = 1; index < this.snapshots.length; index += 1) {
      const candidate = this.snapshots[index]!;
      if (candidate.elapsed >= targetElapsed) {
        second = candidate;
        first = this.snapshots[index - 1]!;
        break;
      }
      first = candidate;
      second = candidate;
    }
    const span = second.elapsed - first.elapsed;
    const amount =
      span <= 1e-8 ? 1 : clamp01((targetElapsed - first.elapsed) / span);
    const tops = second.tops.map((top) => {
      const prior = first.tops.find((candidate) => candidate.seat === top.seat);
      return prior ? interpolateTop(prior, top, amount) : top;
    });
    const discrete = amount < 1 ? first : second;
    const includeEvents = discrete.tick > this.lastEventTick;
    if (includeEvents) this.lastEventTick = discrete.tick;
    return {
      ...discrete,
      tick: Math.round(lerp(first.tick, second.tick, amount)),
      elapsed: lerp(first.elapsed, second.elapsed, amount),
      tops,
      events: includeEvents ? discrete.events : [],
    };
  }
}
