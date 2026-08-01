/**
 * RaceState → wire frame.
 *
 * Quantisation is part of the protocol, not a cosmetic detail: it is what
 * makes two hosts running the same tick produce byte-identical frames, which
 * is how wireSelftest can prove a change did not alter the wire.
 */

import type { RaceState } from "../sim/types";
import {
  BOOST_SOURCE_CODES,
  FLAG_AIRBORNE,
  FLAG_FINISHED,
  FLAG_GRACE,
  FLAG_OFF_ROAD,
  FLAG_STALL,
  FLAG_TRICK,
  FLAG_SLIPSTREAM,
  FLAG_WRONG_WAY,
  ITEM_CODES,
  PHASE_CODES,
  type HazardFrame,
  type NitroSnapshot,
  type ProjectileFrame,
  type RacerFrame,
} from "./protocol";

function q(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function encodeSnapshot(state: RaceState): NitroSnapshot {
  const racers: RacerFrame[] = state.racers.map((racer) => {
    let flags = 0;
    if (racer.finished) flags |= FLAG_FINISHED;
    if (racer.wrongWay) flags |= FLAG_WRONG_WAY;
    if (racer.offRoad) flags |= FLAG_OFF_ROAD;
    if (racer.airborne) flags |= FLAG_AIRBORNE;
    if (racer.graceTimer > 0) flags |= FLAG_GRACE;
    if (racer.stalled) flags |= FLAG_STALL;
    if (racer.tricking) flags |= FLAG_TRICK;
    if (racer.drafting) flags |= FLAG_SLIPSTREAM;
    return {
      i: racer.id,
      x: q(racer.x, 2),
      y: q(racer.y, 2),
      z: q(racer.z, 2),
      a: q(racer.yaw, 3),
      l: q(racer.slip, 3),
      v: q(racer.speed, 2),
      d: racer.driftDir,
      h: q(racer.driftCharge, 2),
      t: racer.driftTier,
      b: q(racer.boostTimer, 2),
      u: racer.boostSource === null
        ? -1
        : BOOST_SOURCE_CODES.indexOf(racer.boostSource),
      p: q(racer.spinTimer, 2),
      q: q(racer.squashTimer, 2),
      r: q(racer.starTimer, 2),
      o: q(racer.boltTimer, 2),
      m: racer.item === null ? -1 : ITEM_CODES.indexOf(racer.item),
      c: racer.itemCharges,
      w: q(racer.rouletteTimer, 2),
      g: q(racer.distance, 2),
      k: racer.lap,
      e: racer.place,
      f: flags,
      n: racer.finishTime === null ? -1 : q(racer.finishTime, 3),
      s: racer.bestLap === null ? -1 : q(racer.bestLap, 3),
      j: racer.lastLap === null ? -1 : q(racer.lastLap, 3),
    };
  });
  const shots: ProjectileFrame[] = state.projectiles.map((projectile) => ({
    i: projectile.id,
    t: projectile.kind === "green" ? 0 : projectile.kind === "red" ? 1 : 2,
    o: projectile.owner,
    x: q(projectile.x, 2),
    y: q(projectile.y, 2),
    z: q(projectile.z, 2),
    a: q(projectile.yaw, 3),
  }));
  const drops: HazardFrame[] = state.hazards.map((hazard) => ({
    i: hazard.id,
    o: hazard.owner,
    x: q(hazard.x, 2),
    y: q(hazard.y, 2),
    z: q(hazard.z, 2),
  }));
  return {
    tick: state.tick,
    elapsed: q(state.elapsed, 3),
    ph: PHASE_CODES.indexOf(state.phase),
    cd: q(state.countdown, 2),
    racers,
    shots,
    drops,
    boxes: state.boxCooldowns.map((cooldown) => q(cooldown, 1)),
    events: [],
  };
}
