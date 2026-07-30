import type { VortexSim } from "../sim/types";
import type {
  TopSnapshot,
  VortexResult,
  VortexSnapshot,
} from "./protocol";

function quantize(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function snapshotFromSim(sim: VortexSim): VortexSnapshot {
  const state = sim.getState();
  return {
    tick: state.tick,
    elapsed: quantize(state.elapsed, 3),
    phase: state.phase,
    suddenDeathStage: state.suddenDeathStage,
    arenaId: state.arenaId,
    tops: state.tops.map(
      (top): TopSnapshot => ({
        seat: top.seat,
        alive: top.alive,
        phasing: top.phasing,
        hp: quantize(top.hp, 1),
        hpMax: quantize(top.hpMax, 1),
        spin: quantize(top.spin, 2),
        x: quantize(top.position[0], 3),
        y: quantize(top.position[1], 3),
        z: quantize(top.position[2], 3),
        qx: quantize(top.rotation[0], 4),
        qy: quantize(top.rotation[1], 4),
        qz: quantize(top.rotation[2], 4),
        qw: quantize(top.rotation[3], 4),
        vx: quantize(top.velocity[0], 3),
        vy: quantize(top.velocity[1], 3),
        vz: quantize(top.velocity[2], 3),
        skills: top.skills.map((skill) => ({
          slot: skill.slot,
          skillId: skill.skillId,
          cooldown: quantize(skill.cooldownRemaining, 2),
          charges: skill.chargesRemaining,
          ready: skill.ready,
          blocked: skill.blockedReason,
          groupSize: skill.groupSize ?? (skill.skillId === null ? 0 : 1),
          readyCount:
            skill.readyCount ??
            (skill.ready && skill.skillId !== null ? 1 : 0),
        })),
      }),
    ),
    events: sim.drainEvents().map((event) =>
      Object.fromEntries(
        Object.entries(event).map(([key, value]) => [
          key,
          typeof value === "number" ? quantize(value, 3) : value,
        ]),
      ),
    ) as unknown as VortexSnapshot["events"],
  };
}

export function resultFromSim(sim: VortexSim): VortexResult | null {
  const result = sim.result();
  if (!result) return null;
  return {
    winner: result.winner,
    winnerTeam: result.winnerTeam ?? result.winner,
    reason: result.reason,
    durationSec: quantize(result.durationSec, 3),
    knockouts: result.knockouts.map((knockout) => ({
      ...knockout,
      at: quantize(knockout.at, 3),
    })),
  };
}
