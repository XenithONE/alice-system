/**
 * Every sound in NITRO CROWN, as data.
 *
 * Same shape as VORTEX CROWN's audio layer (copied, not imported — its types
 * are vortex-specific): a recipe is a plain object, the WebAudio rendering
 * lives in engine.ts, and audioSelftest measures that every race event has a
 * voice and no two voices are confusable. There is deliberately no BGM —
 * the engine drone owns the low-mid band, and a synth loop fighting it for
 * the same frequencies is worse than silence (user-confirmed decision).
 */

import type { BoostSource, ItemKind } from "../sim/types";

export interface VoiceRecipe {
  /** Primary oscillator. "noise" uses only the filtered noise layer. */
  readonly wave: OscillatorType | "noise";
  /** Start and end frequency (Hz); equal values hold a tone. */
  readonly from: number;
  readonly to: number;
  readonly durationSec: number;
  /** 0..1 pre-master level. */
  readonly gain: number;
  /** Optional second oscillator, a fixed interval above `from` (Hz). */
  readonly secondHz?: number;
  /** Optional vibrato. */
  readonly vibratoHz?: number;
  readonly vibratoDepthHz?: number;
  /** Optional parallel noise layer, 0..1 of `gain`, lowpassed at cutoff. */
  readonly noise?: number;
  readonly noiseCutoffHz?: number;
}

/**
 * The one-shot vocabulary. Silhouettes rhyme with what is on screen: the
 * countdown holds a tone and GO opens a chord; a spin-out corkscrews down;
 * a squash is all low thud; the final lap pushes upward because the race is
 * tightening; the bolt is the only voice that falls a whole octave-and-more,
 * because it is the only item that hits the entire field.
 */
export const NK_VOICES = {
  countdown: { wave: "square", from: 660, to: 660, durationSec: 0.14, gain: 0.3 },
  go: { wave: "square", from: 523, to: 523, secondHz: 262, durationSec: 0.55, gain: 0.46 },
  "roulette-tick": { wave: "square", from: 1240, to: 1240, durationSec: 0.03, gain: 0.12 },
  pickup: { wave: "sine", from: 660, to: 1050, durationSec: 0.16, gain: 0.3 },
  "item-granted": { wave: "triangle", from: 540, to: 810, durationSec: 0.13, gain: 0.28 },
  spinout: { wave: "sawtooth", from: 320, to: 88, durationSec: 0.5, gain: 0.5, noise: 0.35, noiseCutoffHz: 1400 },
  squash: { wave: "square", from: 170, to: 46, durationSec: 0.72, gain: 0.6, noise: 0.6, noiseCutoffHz: 480 },
  blast: { wave: "noise", from: 0, to: 0, durationSec: 1.05, gain: 0.72, noise: 1, noiseCutoffHz: 860 },
  "shell-fire": { wave: "sawtooth", from: 520, to: 250, durationSec: 0.2, gain: 0.42, noise: 0.3, noiseCutoffHz: 2600 },
  "bomb-throw": { wave: "sawtooth", from: 210, to: 84, durationSec: 0.3, gain: 0.4 },
  "banana-drop": { wave: "triangle", from: 300, to: 176, durationSec: 0.16, gain: 0.26 },
  "star-jingle": { wave: "triangle", from: 660, to: 1320, secondHz: 330, durationSec: 0.42, gain: 0.3 },
  bolt: { wave: "sawtooth", from: 1480, to: 190, durationSec: 0.38, gain: 0.5, noise: 0.25, noiseCutoffHz: 3200 },
  lap: { wave: "sine", from: 784, to: 784, secondHz: 196, durationSec: 0.26, gain: 0.32 },
  "final-lap": { wave: "square", from: 659, to: 988, vibratoHz: 11, vibratoDepthHz: 26, durationSec: 0.55, gain: 0.42 },
  "fanfare-win": { wave: "triangle", from: 523, to: 1046, secondHz: 262, durationSec: 1.0, gain: 0.5 },
  "fanfare-place": { wave: "triangle", from: 392, to: 587, secondHz: 196, durationSec: 0.7, gain: 0.4 },
  "wrong-way": { wave: "square", from: 415, to: 415, secondHz: 29, durationSec: 0.3, gain: 0.32 },
  respawn: { wave: "sine", from: 196, to: 640, durationSec: 0.32, gain: 0.3 },
  // Short, dry and low: the hop is a chirp of tyre, not a jump cue. It fires
  // on every drift press, so anything longer would carpet the whole race.
  hop: { wave: "square", from: 300, to: 210, durationSec: 0.07, gain: 0.16, noise: 0.4, noiseCutoffHz: 2600 },
  trick: { wave: "triangle", from: 520, to: 940, durationSec: 0.24, gain: 0.36 },
  "trick-land": { wave: "square", from: 700, to: 1150, durationSec: 0.2, gain: 0.4 },
  draft: { wave: "noise", from: 0, to: 0, durationSec: 0.45, gain: 0.3, noise: 0.85, noiseCutoffHz: 3400 },
  "ui-click": { wave: "square", from: 880, to: 880, durationSec: 0.05, gain: 0.15 },
} as const satisfies Record<string, VoiceRecipe>;

export type NkVoiceName = keyof typeof NK_VOICES;

/**
 * Wall scrape: pitch, volume and length all come from the same impact speed
 * the camera shake reads, so a hit that shakes hard also sounds hard.
 */
export function wallVoice(speed: number): VoiceRecipe {
  const power = Math.max(0, Math.min(1, speed / 42));
  return {
    wave: "noise",
    from: 0,
    to: 0,
    durationSec: 0.08 + power * 0.14,
    gain: 0.16 + power * 0.36,
    noise: 1,
    noiseCutoffHz: 700 + power * 1900,
  };
}

/**
 * Boost by source and, for mini-turbos, by tier — the three tiers rise in
 * pitch the same way their spark colours heat up (blue → orange → purple).
 */
export function boostVoice(source: BoostSource, tier: number): VoiceRecipe {
  if (source === "mini") {
    const step = Math.max(1, Math.min(3, tier));
    const base = [330, 440, 554][step - 1]!;
    return {
      wave: "sawtooth",
      from: base,
      to: base * 2,
      durationSec: 0.3 + step * 0.08,
      gain: 0.34 + step * 0.05,
    };
  }
  switch (source) {
    case "mushroom":
      return { wave: "sawtooth", from: 440, to: 990, durationSec: 0.4, gain: 0.42, noise: 0.2, noiseCutoffHz: 2400 };
    case "pad":
      return { wave: "sawtooth", from: 392, to: 784, durationSec: 0.34, gain: 0.38 };
    case "rocket":
      return { wave: "sawtooth", from: 523, to: 1568, durationSec: 0.55, gain: 0.46, noise: 0.3, noiseCutoffHz: 3000 };
    case "star":
      return NK_VOICES["star-jingle"];
    case "draft":
      return NK_VOICES.draft;
    case "trick":
      return NK_VOICES["trick-land"];
  }
}

/** The mini-turbo CHARGE chime — a tier was reached, not yet released. */
export function chargeVoice(tier: number): VoiceRecipe {
  const step = Math.max(1, Math.min(3, tier));
  const base = [523, 659, 784][step - 1]!;
  return { wave: "triangle", from: base, to: base, durationSec: 0.09, gain: 0.24 };
}

/** Firing/­dropping an item. Boost items are covered by their boost event. */
export function useVoice(item: ItemKind): VoiceRecipe | null {
  switch (item) {
    case "mushroom":
    case "triple":
      // The sim emits a boost event in the same tick; two voices would stack.
      return null;
    case "banana":
      return NK_VOICES["banana-drop"];
    case "green":
    case "red":
      return NK_VOICES["shell-fire"];
    case "bomb":
      return NK_VOICES["bomb-throw"];
    case "star":
      return NK_VOICES["star-jingle"];
    case "bolt":
      return NK_VOICES.bolt;
  }
}
