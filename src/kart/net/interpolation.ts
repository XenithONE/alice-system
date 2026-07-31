/**
 * A 100 ms buffer, held one snapshot behind the host's clock.
 *
 * It interpolates poses and holds everything discrete. It never extrapolates:
 * a late packet shows the most recent real pose rather than a guess, because a
 * guessed kart that snaps back reads as a physics bug to the player, and there
 * is nothing they can do about it.
 *
 * Events are the exception. They are one-shot, so they are released exactly
 * once — at the tick they first become visible — or a hit would play its sound
 * on every frame the buffer sat on it.
 */

import { INTERPOLATION_DELAY_SEC } from "../sim/balance";
import type { NitroSnapshot, RacerFrame } from "./protocol";

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function lerp(first: number, second: number, amount: number): number {
  return first + (second - first) * amount;
}

/** Angles are interpolated the short way round; yaw wraps every lap. */
function lerpAngle(first: number, second: number, amount: number): number {
  let delta = (second - first) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta <= -Math.PI) delta += Math.PI * 2;
  return first + delta * amount;
}

function blendRacer(
  first: RacerFrame,
  second: RacerFrame,
  amount: number,
): RacerFrame {
  const discrete = amount < 1 ? first : second;
  return {
    ...discrete,
    x: lerp(first.x, second.x, amount),
    y: lerp(first.y, second.y, amount),
    z: lerp(first.z, second.z, amount),
    a: lerpAngle(first.a, second.a, amount),
    // slip is an angle: it spins through π during a spin-out.
    l: lerpAngle(first.l, second.l, amount),
    v: lerp(first.v, second.v, amount),
    h: lerp(first.h, second.h, amount),
    b: lerp(first.b, second.b, amount),
    p: lerp(first.p, second.p, amount),
    q: lerp(first.q, second.q, amount),
    r: lerp(first.r, second.r, amount),
    o: lerp(first.o, second.o, amount),
    w: lerp(first.w, second.w, amount),
    g: lerp(first.g, second.g, amount),
  };
}

export class SnapshotInterpolator {
  private readonly frames: NitroSnapshot[] = [];
  private lastEventTick = -1;

  constructor(
    readonly delaySec = INTERPOLATION_DELAY_SEC,
    readonly capacity = 10,
  ) {}

  push(snapshot: NitroSnapshot): void {
    const latest = this.frames[this.frames.length - 1];
    if (latest && snapshot.tick <= latest.tick) return;
    this.frames.push(snapshot);
    while (this.frames.length > Math.max(2, this.capacity)) this.frames.shift();
  }

  clear(): void {
    this.frames.length = 0;
    this.lastEventTick = -1;
  }

  get depth(): number {
    return this.frames.length;
  }

  sample(): NitroSnapshot | null {
    const latest = this.frames[this.frames.length - 1];
    if (!latest) return null;
    const target = latest.elapsed - Math.max(0, this.delaySec);
    let first = this.frames[0]!;
    let second = first;
    for (let index = 1; index < this.frames.length; index += 1) {
      const candidate = this.frames[index]!;
      if (candidate.elapsed >= target) {
        second = candidate;
        first = this.frames[index - 1]!;
        break;
      }
      first = candidate;
      second = candidate;
    }
    const span = second.elapsed - first.elapsed;
    const amount = span <= 1e-8 ? 1 : clamp01((target - first.elapsed) / span);
    const discrete = amount < 1 ? first : second;

    const racers = second.racers.map((racer) => {
      const prior = first.racers.find((candidate) => candidate.i === racer.i);
      return prior ? blendRacer(prior, racer, amount) : racer;
    });

    // Projectiles are short-lived and identified; blend the ones that survived
    // both frames and take the newcomers as they arrive.
    const shots = second.shots.map((shot) => {
      const prior = first.shots.find((candidate) => candidate.i === shot.i);
      if (!prior) return shot;
      return {
        ...shot,
        x: lerp(prior.x, shot.x, amount),
        y: lerp(prior.y, shot.y, amount),
        z: lerp(prior.z, shot.z, amount),
        a: lerpAngle(prior.a, shot.a, amount),
      };
    });

    const releaseEvents = discrete.tick > this.lastEventTick;
    if (releaseEvents) this.lastEventTick = discrete.tick;

    return {
      ...discrete,
      tick: Math.round(lerp(first.tick, second.tick, amount)),
      elapsed: lerp(first.elapsed, second.elapsed, amount),
      cd: lerp(first.cd, second.cd, amount),
      racers,
      shots,
      drops: second.drops,
      boxes: second.boxes,
      events: releaseEvents ? discrete.events : [],
    };
  }
}
