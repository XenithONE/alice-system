/**
 * Every sound in the game, as data.
 *
 * The visual layer already learned this lesson: eight (now nine) skill looks
 * are derived from `effects`, colours live in one table, and a gate measures
 * that no two are confusable. Sound follows the same shape. A recipe is a
 * plain object; the WebAudio rendering lives in engine.ts; and because
 * `SKILL_VOICES` is a `Record<FxFamily, …>`, adding a tenth family without a
 * voice is a compile error, not a silent gap — the exact failure mode
 * `playSkillCue`'s void switch had when phaseshift briefly rendered as
 * nothing.
 */
import { FX_FAMILY_SPECS, type FxFamily } from "../content/fxFamily";

export interface VoiceRecipe {
  /** Primary oscillator. "noise" uses a filtered noise buffer instead. */
  readonly wave: OscillatorType | "noise";
  /** Start and end frequency (Hz); equal values hold a tone. */
  readonly from: number;
  readonly to: number;
  /** Seconds. Skill voices reuse the FX duration so eye and ear agree. */
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

const skillDuration = (family: FxFamily): number =>
  FX_FAMILY_SPECS[family].duration;

/**
 * One silhouette per family, and the silhouettes rhyme with the visuals:
 * aegis GROWS a chord, phaseshift FALLS AWAY (the shell collapses inward on
 * screen), lance rises along its line of attack, siphon descends because
 * something is being taken.
 */
export const SKILL_VOICES: Record<FxFamily, VoiceRecipe> = {
  lance: {
    wave: "sawtooth", from: 220, to: 880,
    durationSec: skillDuration("lance"), gain: 0.42,
  },
  orbit: {
    wave: "sine", from: 330, to: 330,
    vibratoHz: 9, vibratoDepthHz: 42,
    durationSec: skillDuration("orbit"), gain: 0.4,
  },
  shockring: {
    wave: "square", from: 78, to: 44,
    noise: 0.55, noiseCutoffHz: 420,
    durationSec: skillDuration("shockring"), gain: 0.62,
  },
  anchor: {
    wave: "square", from: 110, to: 76,
    durationSec: skillDuration("anchor"), gain: 0.5,
  },
  aegis: {
    wave: "triangle", from: 392, to: 392, secondHz: 196,
    durationSec: skillDuration("aegis"), gain: 0.36,
  },
  overclock: {
    wave: "square", from: 440, to: 1320,
    durationSec: skillDuration("overclock"), gain: 0.34,
  },
  siphon: {
    wave: "sine", from: 660, to: 220, vibratoHz: 6, vibratoDepthHz: 18,
    durationSec: skillDuration("siphon"), gain: 0.4,
  },
  reboot: {
    wave: "triangle", from: 523, to: 784,
    durationSec: skillDuration("reboot"), gain: 0.4,
  },
  phaseshift: {
    wave: "sine", from: 880, to: 440,
    noise: 0.35, noiseCutoffHz: 2400,
    durationSec: skillDuration("phaseshift"), gain: 0.32,
  },
};

/** The arena-level sounds that are not any skill's voice. */
export const EVENT_VOICES = {
  "knockout-ring-out": {
    wave: "sine", from: 760, to: 110, durationSec: 0.9, gain: 0.7,
    noise: 0.25, noiseCutoffHz: 900,
  },
  "knockout-destroyed": {
    wave: "square", from: 96, to: 38, durationSec: 0.6, gain: 0.75,
    noise: 0.8, noiseCutoffHz: 1600,
  },
  shockwave: {
    wave: "square", from: 70, to: 46, durationSec: 0.4, gain: 0.5,
    noise: 0.5, noiseCutoffHz: 500,
  },
  combo: {
    // Rising major arpeggio silhouette — a REWARD sound, unlike any skill's.
    wave: "triangle", from: 523, to: 1046, secondHz: 262,
    durationSec: 0.5, gain: 0.5,
  },
  launch: {
    wave: "sawtooth", from: 190, to: 640, durationSec: 0.35, gain: 0.4,
  },
  deny: {
    wave: "square", from: 168, to: 128, durationSec: 0.09, gain: 0.24,
  },
} as const satisfies Record<string, VoiceRecipe>;

export type EventVoiceName = keyof typeof EVENT_VOICES;

/**
 * Impact is the one voice computed rather than authored: its loudness and
 * pitch carry the physics. `impulse` arrives from the same SimEvent field
 * the camera shake reads, so a hit that shakes hard also sounds hard.
 */
export function impactVoice(impulse: number): VoiceRecipe {
  const power = Math.max(0, Math.min(1, impulse / 42));
  return {
    wave: "noise",
    from: 900 + power * 1400,
    to: 300,
    durationSec: 0.1 + power * 0.14,
    gain: 0.16 + power * 0.6,
    noiseCutoffHz: 900 + power * 2400,
    noise: 1,
  };
}
