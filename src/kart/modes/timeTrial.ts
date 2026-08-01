/**
 * Time trial: one kart, three laps, no items except the starting triple
 * mushroom, clear weather always (records must be condition-pure), fixed
 * seed (nothing random remains once items are off and the grid is one).
 *
 * Bypasses `normalizeSettings` on purpose — it clamps racerCount to ≥2 to
 * match the wire validator, a floor that is correct for rooms and wrong
 * here. TT never touches the wire.
 */

import { COUNTDOWN_SEC } from "../sim/balance";
import { createKartSim } from "../sim/sim";
import { buildTrack, maybeMirror, type Track } from "../sim/track";
import { trackSpecById } from "../sim/tracks";
import type { KartInput, RaceEvent, RaceResult, RaceState } from "../sim/types";
import type { NitroSession } from "../net/session";
import { DEFAULT_ROOM_SETTINGS } from "../net/session";
import { GhostRecorder, type GhostData } from "./ghost";

export const TT_LAPS = 3;

export interface TimeTrialConfig {
  readonly name: string;
  readonly trackId: string;
  readonly speedClass: number;
  readonly mirror: boolean;
  readonly livery?: number;
}

export interface TimeTrialSession extends NitroSession {
  /** The finished run's ghost, once the sim has a result. */
  ghostPayload(): GhostData | null;
  readonly trackLength: number;
}

export function createTimeTrialSession(
  config: TimeTrialConfig,
): TimeTrialSession {
  const track: Track = buildTrack(
    maybeMirror(trackSpecById(config.trackId), config.mirror),
  );
  const sim = createKartSim({
    trackId: track.spec.id,
    laps: TT_LAPS,
    seed: 1,
    racers: [
      {
        name: config.name,
        cpu: false,
        livery: config.livery ?? 0,
      },
    ],
    items: false,
    startTriple: true,
    track,
    speedClass: config.speedClass,
    weather: "clear",
  });

  const recorder = new GhostRecorder();
  let events: RaceEvent[] = [];
  let ghost: GhostData | null = null;

  return {
    kind: "solo",
    seat: 0,
    roomCode: null,
    track,
    trackLength: track.length,
    settings: {
      ...DEFAULT_ROOM_SETTINGS,
      trackId: track.spec.id,
      laps: TT_LAPS,
      racerCount: 2, // display only; the sim runs one kart
      playerCount: 1,
      items: false,
      speedClass: config.speedClass,
      mirror: config.mirror,
    },
    racing: true,
    cup() {
      return null;
    },
    setReady() {},
    beginRace() {
      return false;
    },
    updateSettings() {},
    sendInput(input: KartInput) {
      sim.setInput(0, input);
    },
    tick(dtSec: number) {
      sim.advance(dtSec);
      const drained = sim.drainEvents();
      for (const event of drained) {
        if (event.k === "lap" && event.racer === 0) {
          recorder.markLap(event.lapTime);
        }
      }
      events.push(...drained);
      const state = sim.getState();
      const me = state.racers[0];
      if (me && state.phase === "race" && !me.finished) {
        recorder.push(state.elapsed - COUNTDOWN_SEC, {
          x: me.x,
          y: me.y,
          z: me.z,
          yaw: me.yaw,
          slip: me.slip,
        });
      }
      const outcome = sim.result();
      if (outcome && !ghost) {
        const mine = outcome.standings.find((standing) => standing.id === 0);
        if (mine?.finished && mine.time !== null) {
          ghost = recorder.finish(
            mine.time - COUNTDOWN_SEC > 0 ? mine.time - COUNTDOWN_SEC : mine.time,
            config.mirror,
            config.speedClass,
            TT_LAPS,
          );
        }
      }
    },
    view(): RaceState | null {
      return sim.getState();
    },
    drainEvents() {
      const drained = events;
      events = [];
      return drained;
    },
    result(): RaceResult | null {
      return sim.result();
    },
    ghostPayload() {
      return ghost;
    },
    dispose() {},
  };
}
