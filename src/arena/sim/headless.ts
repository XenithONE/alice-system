import { buildCatalog } from "../parts/catalog";
import { ARENAS } from "../parts/arenas";
import { aiInput } from "./ai";
import { FIXED_DT } from "./balance";
import { initPhysics, createArenaSim } from "./world";
import type { SeatIndex } from "./types";

declare const process: {
  stdout: { write(value: string): void };
  exitCode?: number;
};

interface GateOutput {
  matches: number;
  finished: number;
  exceptions: number;
  nanFrames: number;
  koFinishes: number;
  judgeFinishes: number;
  detachTotal: number;
  winsBySeat: [number, number, number, number];
  avgStepMs: number;
  avgDurationSec: number;
}

const MATCHES = 20;
const MAX_DURATION_SEC = 200;

function finiteState(values: readonly number[]): boolean {
  return values.every(Number.isFinite);
}

async function main(): Promise<void> {
  await initPhysics();
  const catalog = buildCatalog();
  let finished = 0;
  let exceptions = 0;
  let nanFrames = 0;
  let koFinishes = 0;
  let judgeFinishes = 0;
  let detachTotal = 0;
  const winsBySeat: [number, number, number, number] = [0, 0, 0, 0];
  let stepMilliseconds = 0;
  let stepCount = 0;
  let durationTotal = 0;

  for (let match = 0; match < MATCHES; match += 1) {
    let sim: ReturnType<typeof createArenaSim> | null = null;
    try {
      const specs = [0, 1, 2, 3].map(
        (seat) => catalog.presets[(seat + match) % catalog.presets.length]!
      );
      sim = createArenaSim({
        seed: match + 1,
        specs,
        names: specs.map((spec) => spec.name),
        catalog,
        arena: ARENAS[match % 4 === 0 ? 0 : 1]!
      });
      const maxSteps = Math.ceil((MAX_DURATION_SEC + 3) / FIXED_DT);
      for (let step = 0; step < maxSteps && !sim.result(); step += 1) {
        const inputs = [0, 1, 2, 3].map((seat) => aiInput(sim!, seat as SeatIndex));
        const before = performance.now();
        sim.step(inputs);
        stepMilliseconds += performance.now() - before;
        stepCount += 1;
        const state = sim.getState();
        for (const bot of state.bots) {
          if (
            !finiteState([
              bot.chassisHp,
              bot.pos[0],
              bot.pos[1],
              bot.pos[2],
              bot.quat[0],
              bot.quat[1],
              bot.quat[2],
              bot.quat[3],
              bot.vel[0],
              bot.vel[1],
              bot.vel[2],
              bot.weaponOmega,
              bot.weaponAngle
            ])
          ) {
            nanFrames += 1;
          }
        }
        for (const event of sim.drainEvents()) {
          if (event.t === "detach") detachTotal += 1;
        }
      }
      const result = sim.result();
      if (result && result.durationSec <= MAX_DURATION_SEC) {
        finished += 1;
        durationTotal += result.durationSec;
        if (result.reason === "ko") koFinishes += 1;
        if (result.reason === "judges") judgeFinishes += 1;
        if (result.winner !== null) winsBySeat[result.winner] += 1;
      }
    } catch {
      exceptions += 1;
    } finally {
      try {
        sim?.dispose();
      } catch {
        exceptions += 1;
      }
    }
  }

  const output: GateOutput = {
    matches: MATCHES,
    finished,
    exceptions,
    nanFrames,
    koFinishes,
    judgeFinishes,
    detachTotal,
    winsBySeat,
    avgStepMs: Number((stepCount > 0 ? stepMilliseconds / stepCount : 0).toFixed(2)),
    avgDurationSec: Number((finished > 0 ? durationTotal / finished : 0).toFixed(1))
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);

  const passed =
    output.finished === MATCHES &&
    output.exceptions === 0 &&
    output.nanFrames === 0 &&
    output.winsBySeat.every((wins) => wins >= 2) &&
    output.koFinishes >= 8 &&
    output.detachTotal >= 15 &&
    output.avgStepMs < 4;
  if (!passed) process.exitCode = 1;
}

void main();
