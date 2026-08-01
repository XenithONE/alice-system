/**
 * The audio layer's only stateful object, plus the WebAudio backend.
 *
 * Contract copied from VORTEX CROWN verbatim, because it earned it there:
 * mute means the cue NEVER REACHES the backend — not "renders at zero
 * volume", nothing. Mute-as-zero-gain is the classic way muted games still
 * burn a core, and the selftest injects a counting backend to prove this one
 * doesn't.
 *
 * Two continuous paths generalize vortex's sudden-death drone:
 *  - the ENGINE (pitch-mapped: two detuned saws + a sub sine through a
 *    lowpass, 60→240 Hz by rpm, opened up by boost) — local kart only;
 *  - the SQUEAL (a bandpassed noise loop whose gain/centre follow slip).
 * Both are idempotent setters whose levels are remembered while muted or
 * locked, so unmuting mid-drift sounds right instead of starting from zero.
 */

import { CUE_FRAME_BUDGET, recipeForCue, type NkCue } from "./cues";
import type { VoiceRecipe } from "./voices";

export interface AudioBackend {
  play(recipe: VoiceRecipe): void;
  /** rpm01 0..1 maps to pitch; boost01 0..1 opens the filter. Idempotent. */
  setEngine(rpm01: number, boost01: number): void;
  /** 0 silences; >0 is squeal intensity. Idempotent. */
  setSqueal(level01: number): void;
  dispose(): void;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Same naming family as nk_quality / nk_name. */
export const AUDIO_STORAGE_KEY = "nk.audio.v1";

export class NitroAudio {
  private backend: AudioBackend | null = null;
  private mutedState: boolean;
  private engineRpm = 0;
  private engineBoost = 0;
  private squealLevel = 0;
  private budgetLeft = CUE_FRAME_BUDGET;

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
      this.backend?.setEngine(0, 0);
      this.backend?.setSqueal(0);
    } else {
      this.backend?.setEngine(this.engineRpm, this.engineBoost);
      this.backend?.setSqueal(this.squealLevel);
    }
  }

  /**
   * Browsers refuse an AudioContext before a user gesture. Call from any
   * click/keydown; every call after the first is free.
   */
  unlock(): void {
    if (this.backend) return;
    this.backend = this.createBackend();
    if (this.backend && !this.mutedState) {
      this.backend.setEngine(this.engineRpm, this.engineBoost);
      this.backend.setSqueal(this.squealLevel);
    }
  }

  /** Call once per rendered frame, before the event loop dispatches cues. */
  beginFrame(): void {
    this.budgetLeft = CUE_FRAME_BUDGET;
  }

  cue(cue: NkCue | null): void {
    if (!cue) return;
    if (this.budgetLeft <= 0) return;
    this.budgetLeft -= 1;
    if (this.mutedState || !this.backend) return;
    const recipe = recipeForCue(cue);
    if (recipe) this.backend.play(recipe);
  }

  setEngine(rpm01: number, boost01: number): void {
    this.engineRpm = rpm01;
    this.engineBoost = boost01;
    if (!this.mutedState) this.backend?.setEngine(rpm01, boost01);
  }

  setSqueal(level01: number): void {
    this.squealLevel = level01;
    if (!this.mutedState) this.backend?.setSqueal(level01);
  }

  /** Between races: silence the continuous paths, keep the mute preference. */
  reset(): void {
    this.engineRpm = 0;
    this.engineBoost = 0;
    this.squealLevel = 0;
    this.backend?.setEngine(0, 0);
    this.backend?.setSqueal(0);
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
  // Deterministic noise: same build, same sound — literally.
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
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!Ctor) return null;
  const context = new Ctor();
  void context.resume();
  const master = context.createGain();
  master.gain.value = 0.5;
  master.connect(context.destination);
  const noiseBuffer = makeNoiseBuffer(context);

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
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, recipe.to), end);
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

  // ── Engine (persistent nodes, parameter-ramped) ─────────────────────────
  let engineNodes: {
    saws: OscillatorNode[];
    sub: OscillatorNode;
    filter: BiquadFilterNode;
    gain: GainNode;
  } | null = null;

  function ensureEngine(): NonNullable<typeof engineNodes> {
    if (engineNodes) return engineNodes;
    const gain = context.createGain();
    gain.gain.value = 0.0001;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 500;
    filter.connect(gain);
    gain.connect(master);
    const saws = [0, 1.8].map((detune) => {
      const oscillator = context.createOscillator();
      oscillator.type = "sawtooth";
      oscillator.frequency.value = 60 + detune;
      oscillator.connect(filter);
      oscillator.start();
      return oscillator;
    });
    const sub = context.createOscillator();
    sub.type = "sine";
    sub.frequency.value = 30;
    sub.connect(filter);
    sub.start();
    engineNodes = { saws, sub, filter, gain };
    return engineNodes;
  }

  function setEngine(rpm01: number, boost01: number): void {
    const rpm = Math.max(0, Math.min(1, rpm01));
    const boost = Math.max(0, Math.min(1, boost01));
    if (rpm <= 0.001 && boost <= 0.001) {
      if (engineNodes) {
        engineNodes.gain.gain.setTargetAtTime(0.0001, context.currentTime, 0.12);
      }
      return;
    }
    const nodes = ensureEngine();
    const now = context.currentTime;
    const frequency = (60 + rpm * 180) * (1 + boost * 0.35);
    nodes.saws[0]!.frequency.setTargetAtTime(frequency, now, 0.05);
    nodes.saws[1]!.frequency.setTargetAtTime(frequency * 1.012 + 1.8, now, 0.05);
    nodes.sub.frequency.setTargetAtTime(frequency / 2, now, 0.05);
    nodes.filter.frequency.setTargetAtTime(420 + rpm * 900 + boost * 1400, now, 0.07);
    nodes.gain.gain.setTargetAtTime(0.1 + rpm * 0.1 + boost * 0.06, now, 0.08);
  }

  // ── Squeal (persistent noise loop) ──────────────────────────────────────
  let squealNodes: { filter: BiquadFilterNode; gain: GainNode } | null = null;

  function ensureSqueal(): NonNullable<typeof squealNodes> {
    if (squealNodes) return squealNodes;
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1100;
    filter.Q.value = 5;
    const gain = context.createGain();
    gain.gain.value = 0.0001;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start();
    squealNodes = { filter, gain };
    return squealNodes;
  }

  function setSqueal(level01: number): void {
    const level = Math.max(0, Math.min(1, level01));
    if (level <= 0.001) {
      if (squealNodes) {
        squealNodes.gain.gain.setTargetAtTime(0.0001, context.currentTime, 0.08);
      }
      return;
    }
    const nodes = ensureSqueal();
    const now = context.currentTime;
    nodes.filter.frequency.setTargetAtTime(900 + level * 900, now, 0.06);
    nodes.gain.gain.setTargetAtTime(level * 0.22, now, 0.05);
  }

  return {
    play,
    setEngine,
    setSqueal,
    dispose() {
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

/** The app-wide instance. The scene receives it and knows nothing else. */
export const nitroAudio = new NitroAudio(createWebAudioBackend, browserStorage());

/*
 * Debug seam, same contract as window.__nitroCrown: audio cannot be heard by
 * the verification harness, so its state has to be readable. Unconditional —
 * a conditional seam is absent exactly when needed.
 */
(globalThis as { __nkAudio?: NitroAudio }).__nkAudio = nitroAudio;
