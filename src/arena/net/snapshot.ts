import type { MatchState, SimEvent } from "../sim/types";
import type { EntSnap, Snapshot } from "./protocol";
import { DEP_KEYFRAME_TICKS } from "../sim/balance";

export function shouldIncludeDeploy(
  previousVersion: number | undefined,
  version: number,
  tick: number
): boolean {
  return previousVersion !== version || tick % DEP_KEYFRAME_TICKS === 0;
}

/** Quantise authoritative state before the JSON transport stringifies it. */
export function snapshotFromState(
  state: MatchState,
  deployVersion: number,
  events: readonly SimEvent[],
  includeDeploy: boolean
): Snapshot {
  const q = (value: number, digits: number): number => {
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
  };
  const entitySnap = (entity: MatchState["entities"][number]): EntSnap => ({
    i: entity.id,
    k:
      (entity.kind === "caltrop"
        ? 0
        : entity.kind === "mine"
          ? 1
          : entity.kind === "oil"
            ? 2
            : entity.kind === "glue"
              ? 3
              : entity.kind === "net"
                ? 4
                : 5) *
        4 +
      entity.owner,
    x: q(entity.x, 3),
    y: q(entity.y, 3),
    z: q(entity.z, 3),
    r: q(entity.yaw, 3),
    s: entity.state
  });
  const roundedEvents = events.map((event) =>
    Object.fromEntries(
      Object.entries(event).map(([key, value]) => [
        key,
        typeof value === "number" ? q(value, 3) : value
      ])
    )
  ) as unknown as Snapshot["events"];
  const snapshot: Snapshot = {
    tick: state.tick,
    elapsed: q(state.elapsed, 3),
    phase: state.phase,
    bots: state.bots.map((bot) => ({
      seat: bot.seat,
      alive: bot.alive,
      hp: q(bot.chassisHp, 1),
      x: q(bot.pos[0], 3),
      y: q(bot.pos[1], 3),
      z: q(bot.pos[2], 3),
      qx: q(bot.quat[0], 3),
      qy: q(bot.quat[1], 3),
      qz: q(bot.quat[2], 3),
      qw: q(bot.quat[3], 3),
      w: bot.weapons.map((weapon) => ({
        idx: weapon.partIdx,
        slot: weapon.slot,
        on: weapon.active,
        a: q(weapon.angle, 2),
        o: q(weapon.omega, 2),
        c: q(weapon.charge, 2),
        f: q(weapon.fuel, 2)
      })),
      wp: 0,
      detach: bot.detached.reduce((mask, index) => mask + 2 ** index, 0),
      pc: bot.partCondition.map((condition) =>
        Math.max(0, Math.min(255, Math.round(condition * 255)))
      ),
      burn: q(bot.burningFor, 2),
      pl: [0, 255, 255, 0],
      st:
        (bot.nettedFor > 0 ? 1 : 0) |
        (bot.pinnedFor > 0 ? 2 : 0) |
        (bot.oiledFor > 0 ? 4 : 0) |
        (bot.tetheredBy !== null ? 8 : 0),
      th: bot.tetheredBy ?? -1
    })),
    proj: state.entities
      .filter((entity) => entity.kind === "net" || entity.kind === "harpoon")
      .map(entitySnap),
    dv: deployVersion,
    events: roundedEvents
  };
  if (includeDeploy) {
    (snapshot as { dep?: Snapshot["proj"] }).dep = state.entities
      .filter((entity) => entity.kind !== "net" && entity.kind !== "harpoon")
      .map(entitySnap);
  }
  return snapshot;
}
