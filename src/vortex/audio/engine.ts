/**
 * The audio layer's only stateful object.
 *
 * Shape mirrors the host-authority rule: audio, like rendering, is a pure
 * OUTPUT of the simulation's event stream. Nothing here touches the sim, and
 * everything here can be thrown away without a gameplay consequence.
 *
 * The WebAudio calls live behind `AudioBackend` so that the mute contract is
 * measurable in node: the selftest injects a counting backend and asserts
 * that a muted engine schedules NOTHING — not "renders at zero volume",
 * nothing. Mute-as-zero-gain is the classic way muted games still burn a
 * core; mute here means the cue never reaches the backend.
 */
import type { FxFamily } from "../content/fxFamily";
import {
  EVENT_VOICES,
  impactVoice,
  SKILL_VOICES,
  type EventVoiceName,
  type VoiceRecipe,
} from "./voices";

export type AudioCue =
  | { readonly kind: "skill"; readonly family: FxFamily }
  | { readonly kind: "impact"; readonly impulse: number }
  | { readonly kind: "shockwave" }
  | { readonly kind: "knockout"; readonly reason: "ring-out" | "destroyed" }
  | { readonly kind: "sudden-death"; readonly stage: number }
  | { readonly kind: "launch" }
  | { readonly kind: "deny" };

export interface AudioSink {
  cue(cue: AudioCue): void;
}

export interface AudioBackend {
  play(recipe: VoiceRecipe): void;
  /** 0 = silence; >0 = sudden-death drone intensity. Idempotent. */
  setDrone(level: number): void;
  dispose(): void;
}

/** Resolves a cue to the recipe it plays. Pure; the selftest leans on it. */
export function recipeForCue(cue: AudioCue): VoiceRecipe | null {
  switch (cue.kind) {
    case "skill":
      return SKILL_VOICES[cue.family];
    case "impact":
      return impactVoice(cue.impulse);
    case "shockwave":
      return EVENT_VOICES.shockwave;
    case "knockout":
      return EVENT_VOICES[
        `knockout-${cue.reason}` as EventVoiceName
      ];
    case "launch":
      return EVENT_VOICES.launch;
    case "deny":
      return EVENT_VOICES.deny;
    case "sudden-death":
      // Continuous, not one-shot — handled by the drone path.
      return null;
  }
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Same store, same naming family as vc.garage.v1. */
export const AUDIO_STORAGE_KEY = "vc.audio.v1";

export class VortexAudio implements AudioSink {
  private backend: AudioBackend | null = null;
  private mutedState: boolean;
  private droneLevel = 0;

  constructor(
    private readonly createBackend: () => AudioBackend | null,
    private readonly storage: StorageLike | null,
  ) {
    this.mutedState = this.readMuted();
  }

  private readMuted(): boolean {
    try {
      return this.storage?.getItem(AUDIO_STORAGE_KEY) === "muted";
    } catch {
      return false;
    }
  }

  get muted(): boolean {
    return this.mutedState;
  }

  setMuted(muted: boolean): void {
    this.mutedState = muted;
    try {
      this.storage?.setItem(AUDIO_STORAGE_KEY, muted ? "muted" : "on");
    } catch {
      // Storage being unavailable must never break the game.
    }
    if (muted) {
      this.backend?.setDrone(0);
    } else if (this.droneLevel > 0) {
      this.backend?.setDrone(this.droneLevel);
    }
  }

  /**
   * Browsers refuse an AudioContext before a user gesture. Call this from
   * any click/keydown; every call after the first is free.
   */
  unlock(): void {
    if (this.backend) return;
    this.backend = this.createBackend();
    if (this.backend && !this.mutedState && this.droneLevel > 0) {
      this.backend.setDrone(this.droneLevel);
    }
  }

  cue(cue: AudioCue): void {
    if (cue.kind === "sudden-death") {
      // Remembered even while muted or locked, so unmuting mid-sudden-death
      // brings the drone in at the right intensity instead of at zero.
      this.droneLevel = Math.max(this.droneLevel, cue.stage);
      if (!this.mutedState) this.backend?.setDrone(this.droneLevel);
      return;
    }
    if (this.mutedState || !this.backend) return;
    const recipe = recipeForCue(cue);
    if (recipe) this.backend.play(recipe);
  }

  /** Between matches: kill the drone, keep the mute preference. */
  reset(): void {
    this.droneLevel = 0;
    this.backend?.setDrone(0);
  }

  dispose(): void {
    this.backend?.dispose();
    this.backend = null;
  }
}

/* ------------------------------------------------------------------ */
/* WebAudio backend — the only part that needs a browser.              */
/* ------------------------------------------------------------------ */

function makeNoiseBuffer(context: AudioContext): AudioBuffer {
  const length = Math.floor(context.sampleRate * 0.5);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  // mulberry-style deterministic noise; Math.random would be fine for audio,
  // but determinism keeps "same build, same sound" literally true.
  let state = 0x9e3779b9;
  for (let index = 0; index < length; index += 1) {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    data[index] = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  }
  return buffer;
}

export function createWebAudioBackend(): AudioBackend | null {
  const Ctor =
    (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!Ctor) return null;
  const context = new Ctor();
  void context.resume();
  const master = context.createGain();
  master.gain.value = 0.5;
  master.connect(context.destination);
  const noiseBuffer = makeNoiseBuffer(context);

  let droneNodes: { gain: GainNode; stop(): void } | null = null;

  function play(recipe: VoiceRecipe): void {
    if (context.state === "suspended") void context.resume();
    const now = context.currentTime;
    const end = now + recipe.durationSec;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(recipe.gain, now);
    envelope.gain.exponentialRampToValueAtTime(0.001, end);
    envelope.connect(master);

    if (recipe.wave !== "noise") {
      const oscillator = context.createOscillator();
      oscillator.type = recipe.wave;
      oscillator.frequency.setValueAtTime(Math.max(1, recipe.from), now);
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(1, recipe.to),
        end,
      );
      if (recipe.vibratoHz && recipe.vibratoDepthHz) {
        const lfo = context.createOscillator();
        lfo.frequency.value = recipe.vibratoHz;
        const depth = context.createGain();
        depth.gain.value = recipe.vibratoDepthHz;
        lfo.connect(depth);
        depth.connect(oscillator.frequency);
        lfo.start(now);
        lfo.stop(end);
      }
      oscillator.connect(envelope);
      oscillator.start(now);
      oscillator.stop(end);
      if (recipe.secondHz) {
        const second = context.createOscillator();
        second.type = recipe.wave;
        second.frequency.setValueAtTime(recipe.from + recipe.secondHz, now);
        second.connect(envelope);
        second.start(now);
        second.stop(end);
      }
    }

    if (recipe.noise) {
      const source = context.createBufferSource();
      source.buffer = noiseBuffer;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = recipe.noiseCutoffHz ?? 1200;
      const noiseGain = context.createGain();
      noiseGain.gain.value = recipe.noise;
      source.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(envelope);
      source.start(now);
      source.stop(end);
    }
  }

  function setDrone(level: number): void {
    if (level <= 0) {
      droneNodes?.stop();
      droneNodes = null;
      return;
    }
    const target = Math.min(0.4, 0.1 + level * 0.1);
    if (droneNodes) {
      droneNodes.gain.gain.linearRampToValueAtTime(
        target,
        context.currentTime + 0.6,
      );
      return;
    }
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.linearRampToValueAtTime(target, context.currentTime + 1.2);
    gain.connect(master);
    const voices: OscillatorNode[] = [55, 55.7, 110.4].map((frequency) => {
      const oscillator = context.createOscillator();
      oscillator.type = "sawtooth";
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      oscillator.start();
      return oscillator;
    });
    droneNodes = {
      gain,
      stop() {
        const now = context.currentTime;
        gain.gain.linearRampToValueAtTime(0.0001, now + 0.4);
        for (const voice of voices) voice.stop(now + 0.5);
      },
    };
  }

  return {
    play,
    setDrone,
    dispose() {
      droneNodes?.stop();
      void context.close();
    },
  };
}

function browserStorage(): StorageLike | null {
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
  } catch {
    return null;
  }
}

/** The app-wide instance. Renderers receive it as a plain AudioSink. */
export const vortexAudio = new VortexAudio(createWebAudioBackend, browserStorage());

/*
 * Debug seam, same contract as window.__vortexScene: the battle canvas cannot
 * be screenshotted from the verification harness and audio cannot be heard,
 * so state has to be readable. Assigned unconditionally — it is tiny, and a
 * conditional seam is a seam that is absent exactly when needed.
 */
(globalThis as { __vortexAudio?: VortexAudio }).__vortexAudio = vortexAudio;
