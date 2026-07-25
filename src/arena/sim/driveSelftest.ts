// Isolate the drivetrain from the AI: one bot, empty arena, throttle pinned to
// 1, measure the speed it actually reaches against the speed the builder
// promises the player. A big gap means the game lies to the player in the
// workshop and feels dead in the arena.
import { buildCatalog, PRESETS } from "../parts/catalog";
import { ARENAS } from "../parts/arenas";
import { createArenaSim, initPhysics } from "./world";
import { computeStats } from "./build";
import type { MatchInput } from "./types";

// Node-only gate script (same shim as buildSelftest.ts).
declare const process: { exitCode?: number };

const FULL: MatchInput = { throttle: 1, steer: 0, weapon: false, selfRight: false };
const IDLE: MatchInput = { throttle: 0, steer: 0, weapon: false, selfRight: false };

const main = async (): Promise<void> => {
  await initPhysics();
  const catalog = buildCatalog();
  const rows = [];

  for (const preset of PRESETS) {
    // lone bot: the other three seats stay empty so nothing interferes
    const sim = createArenaSim({
      seed: 7,
      // two bots: with a lone entrant the match ends before it starts and the
      // driver correctly ignores input, which reads as "cannot move".
      specs: [preset, PRESETS[2]!, null, null],
      names: [preset.name, "sparring", "", ""],
      catalog,
      arena: ARENAS[0]!
    });
    const promised = computeStats(preset, catalog).topSpeed;
    // burn the countdown
    for (let i = 0; i < 200; i += 1) sim.step([IDLE, IDLE, IDLE, IDLE]);
    // Peak speed during acceleration. Steady state is meaningless here: both
    // bots drive at each other and the arena is only 16 m across, so by t=4s
    // they have already crashed.
    const y0 = sim.getState().bots[0]!.pos[1];
    let measured = 0;
    for (let i = 0; i < 240; i += 1) {
      sim.step([FULL, FULL, FULL, FULL]);
      const s0 = sim.getState().bots[0]!;
      measured = Math.max(measured, Math.hypot(s0.vel[0], s0.vel[2]));
    }
    rows.push({
      bot: preset.name,
      promisedTopSpeed: +promised.toFixed(2),
      measuredSpeed: +measured.toFixed(2),
      ratio: +(measured / promised).toFixed(2),
      chassisY: +y0.toFixed(3),
      phase: sim.phase,
      velFromSim: +Math.hypot(sim.getState().bots[0]!.vel[0], sim.getState().bots[0]!.vel[2]).toFixed(2)
    });
    sim.dispose();
  }
  // A robot that cannot reach the speed the workshop advertises makes the
  // whole builder a lie, and it is invisible in a match-outcome gate: bots that
  // barely move still finish matches, just on the judges' cards.
  const failures = rows.filter((r) => r.ratio < 0.7).map((r) => `${r.bot} ${r.ratio}`);
  console.log(JSON.stringify({ rows, failures }, null, 2));
  console.log(failures.length ? "DRIVE SELFTEST FAIL" : "DRIVE SELFTEST PASS");
  if (failures.length) process.exitCode = 1;
};

main().catch((e) => { console.error("DRIVE SELFTEST FAIL:", e); process.exitCode = 1; });
