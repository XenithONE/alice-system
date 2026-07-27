import { RING_ARENAS, sampleRingHeight } from "../sim";
import {
  sampleBattleArenaHeight,
  type BattleArenaVisual,
} from "./battleScene";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

let samples = 0;
let maximumError = 0;

for (const arena of RING_ARENAS) {
  const visual: BattleArenaVisual = {
    id: arena.id,
    radius: arena.outRadius,
    lipHeight: 0.42,
    profile: arena.profile.map(
      (point) => [point.radius / arena.outRadius, point.height] as const,
    ),
    waveAmplitude: arena.waveAmplitude,
    waveCount: arena.waveCount,
  };
  for (let radialIndex = 0; radialIndex <= 60; radialIndex += 1) {
    const radius = arena.outRadius * radialIndex / 60;
    for (let angularIndex = 0; angularIndex < 32; angularIndex += 1) {
      const angle = angularIndex / 32 * Math.PI * 2;
      const renderHeight = sampleBattleArenaHeight(
        visual,
        radius / arena.outRadius,
        angle,
      );
      const physicsHeight = sampleRingHeight(arena, radius, angle);
      const error = Math.abs(renderHeight - physicsHeight);
      maximumError = Math.max(maximumError, error);
      samples += 1;
      assert(
        error < 1e-9,
        `${arena.id} render/physics surface diverged by ${error}m`,
      );
    }
  }
}

console.log(JSON.stringify({ rings: RING_ARENAS.length, samples, maximumError }));
