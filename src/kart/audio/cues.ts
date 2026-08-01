/**
 * Event → cue policy, pure.
 *
 * This is the file that decides what the player HEARS out of the 20 Hz event
 * stream — and just as important, what they don't: eight karts drifting and
 * boosting at once is a cacophony, so rival state-change events are filtered
 * here and only things that threaten or reward the focus seat get a voice.
 * Being pure (no backend, no DOM), the whole policy is measurable in Node.
 */

import type { RaceEvent } from "../sim/types";
import {
  boostVoice,
  chargeVoice,
  NK_VOICES,
  useVoice,
  wallVoice,
  type NkVoiceName,
  type VoiceRecipe,
} from "./voices";

export type NkCue =
  | { readonly kind: "voice"; readonly name: NkVoiceName; readonly gainScale?: number }
  | { readonly kind: "wall"; readonly speed: number }
  | { readonly kind: "boost"; readonly source: Parameters<typeof boostVoice>[0]; readonly tier: number }
  | { readonly kind: "charge"; readonly tier: number }
  | { readonly kind: "use"; readonly item: Parameters<typeof useVoice>[0]; readonly gainScale?: number };

/**
 * Shared with the FX dispatch loop: an event dropped by this budget is
 * dropped from BOTH senses, so eye and ear never disagree about which
 * events made the cut in a crowded frame.
 */
export const CUE_FRAME_BUDGET = 4;

export interface CueContext {
  readonly focusSeat: number;
  readonly laps: number;
  readonly focusX: number;
  readonly focusZ: number;
}

/** Hits farther than this are inaudible; closer ones fade linearly. */
const EARSHOT = 85;

function attenuate(context: CueContext, x: number, z: number): number {
  const distance = Math.hypot(x - context.focusX, z - context.focusZ);
  return Math.max(0.2, Math.min(1, 1 - distance / EARSHOT));
}

/** Resolves a cue to its recipe. Pure; the selftest leans on it. */
export function recipeForCue(cue: NkCue): VoiceRecipe | null {
  switch (cue.kind) {
    case "voice": {
      const base = NK_VOICES[cue.name];
      return cue.gainScale === undefined
        ? base
        : { ...base, gain: base.gain * cue.gainScale };
    }
    case "wall":
      return wallVoice(cue.speed);
    case "boost":
      return boostVoice(cue.source, cue.tier);
    case "charge":
      return chargeVoice(cue.tier);
    case "use": {
      const base = useVoice(cue.item);
      if (!base) return null;
      return cue.gainScale === undefined
        ? base
        : { ...base, gain: base.gain * cue.gainScale };
    }
  }
}

/**
 * The total mapping. The switch has no default so a new RaceEvent kind is a
 * compile error here, not a silent gap — the exact failure VORTEX's void
 * switch had when a skill family briefly rendered (and sounded) as nothing.
 */
export function cueForEvent(event: RaceEvent, context: CueContext): NkCue | null {
  const mine = "racer" in event && event.racer === context.focusSeat;
  switch (event.k) {
    case "countdown":
      return { kind: "voice", name: "countdown" };
    case "go":
      return { kind: "voice", name: "go" };
    case "pickup":
      return mine ? { kind: "voice", name: "pickup" } : null;
    case "item":
      return mine ? { kind: "voice", name: "item-granted" } : null;
    case "use":
      // Rivals firing shells is a threat worth hearing, quietly.
      return mine
        ? { kind: "use", item: event.item }
        : event.item === "green" || event.item === "red" || event.item === "bomb"
          ? { kind: "use", item: event.item, gainScale: 0.4 }
          : null;
    case "hit": {
      const heavy =
        event.cause === "bomb" || event.cause === "bolt" || event.cause === "star";
      const gainScale = mine ? 1 : attenuate(context, event.x, event.z);
      return { kind: "voice", name: heavy ? "squash" : "spinout", gainScale };
    }
    case "boost":
      return mine ? { kind: "boost", source: event.source, tier: event.tier } : null;
    case "drift":
      return mine ? { kind: "charge", tier: event.tier } : null;
    case "trick":
      return mine ? { kind: "voice", name: "trick" } : null;
    case "wall":
      return mine ? { kind: "wall", speed: event.speed } : null;
    case "respawn":
      return mine ? { kind: "voice", name: "respawn" } : null;
    case "lap":
      if (!mine) return null;
      return event.lap === context.laps - 1
        ? { kind: "voice", name: "final-lap" }
        : { kind: "voice", name: "lap" };
    case "finish":
      if (!mine) return null;
      return event.place === 1
        ? { kind: "voice", name: "fanfare-win" }
        : { kind: "voice", name: "fanfare-place" };
    case "blast":
      return {
        kind: "voice",
        name: "blast",
        gainScale: attenuate(context, event.x, event.z),
      };
  }
}
