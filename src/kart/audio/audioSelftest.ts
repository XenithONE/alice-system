/**
 * Gate: every race event has a voice, the loud things are loud, and mute
 * schedules NOTHING.
 *
 * The bug this guards against had no symptom on any single play session:
 * VORTEX once had a skill family whose cue resolved to nothing, and "no
 * sound" is indistinguishable from "sound I didn't notice". Totality is
 * checked by type (the cue switch has no default) AND by measurement here.
 *
 * Run: npx tsx src/kart/audio/audioSelftest.ts
 */
import { createGate } from "../gate";
import type { RaceEvent } from "../sim/types";
import {
  CUE_FRAME_BUDGET,
  cueForEvent,
  recipeForCue,
  type CueContext,
} from "./cues";
import { NitroAudio, type AudioBackend } from "./engine";
import {
  boostVoice,
  chargeVoice,
  NK_VOICES,
  useVoice,
  wallVoice,
  type VoiceRecipe,
} from "./voices";

const gate = createGate();

const FOCUS: CueContext = { focusSeat: 0, laps: 3, focusX: 0, focusZ: 0 };

/**
 * One representative event per kind, from the focus seat's perspective.
 * `Record<RaceEvent["k"], …>` makes a forgotten kind a compile error.
 */
const SAMPLE_EVENTS: Record<RaceEvent["k"], RaceEvent> = {
  countdown: { k: "countdown", n: 3 },
  go: { k: "go" },
  pickup: { k: "pickup", racer: 0, box: 0 },
  item: { k: "item", racer: 0, item: "red" },
  use: { k: "use", racer: 0, item: "banana" },
  hit: { k: "hit", racer: 0, by: 1, cause: "green", x: 0, y: 0, z: 0 },
  boost: { k: "boost", racer: 0, source: "mini", tier: 2 },
  drift: { k: "drift", racer: 0, tier: 1 },
  trick: { k: "trick", racer: 0 },
  wall: { k: "wall", racer: 0, speed: 30 },
  respawn: { k: "respawn", racer: 0 },
  lap: { k: "lap", racer: 0, lap: 1, lapTime: 30 },
  finish: { k: "finish", racer: 0, place: 1, time: 95 },
  blast: { k: "blast", x: 4, y: 0, z: 4 },
};

// [A0] totality: every event kind resolves to a playable recipe ─────────────
{
  const silent: string[] = [];
  for (const [kind, event] of Object.entries(SAMPLE_EVENTS)) {
    const cue = cueForEvent(event, FOCUS);
    const recipe = cue ? recipeForCue(cue) : null;
    if (!recipe || recipe.gain <= 0 || recipe.durationSec <= 0) silent.push(kind);
  }
  gate.check(
    "[A0] 全イベント種が自車視点で音になる",
    silent.length === 0,
    silent.length ? `無音: ${silent.join(", ")}` : `${Object.keys(SAMPLE_EVENTS).length} 種`,
  );
}

gate.expectFail(
  "[A0-neg] レシピの gain を 0 にすると A0 が落ちる",
  () => {
    const cue = cueForEvent(SAMPLE_EVENTS.go, FOCUS)!;
    const recipe = { ...recipeForCue(cue)!, gain: 0 };
    return recipe.gain > 0;
  },
  "go の音量を殺す",
);

// [A1] distinctness: no two one-shots share a signature ─────────────────────
{
  const signature = (recipe: VoiceRecipe): string =>
    [recipe.wave, recipe.from, recipe.to, recipe.durationSec.toFixed(2), recipe.secondHz ?? 0, recipe.noise ?? 0].join("|");
  const seen = new Map<string, string>();
  const clashes: string[] = [];
  for (const [name, recipe] of Object.entries(NK_VOICES)) {
    const sig = signature(recipe);
    const previous = seen.get(sig);
    if (previous) clashes.push(`${previous}=${name}`);
    seen.set(sig, name);
  }
  gate.check(
    "[A1] ワンショット同士の署名が重複しない",
    clashes.length === 0,
    clashes.length ? clashes.join(", ") : `${seen.size} 声`,
  );
}

// [A2] wall scrape scales with impact ───────────────────────────────────────
{
  const soft = wallVoice(9);
  const hard = wallVoice(38);
  gate.check(
    "[A2] 壁擦り音は速いほど大きく・長く・明るい",
    hard.gain > soft.gain && hard.durationSec > soft.durationSec &&
      (hard.noiseCutoffHz ?? 0) > (soft.noiseCutoffHz ?? 0),
    `gain ${soft.gain.toFixed(2)}→${hard.gain.toFixed(2)} / cutoff ${soft.noiseCutoffHz}→${hard.noiseCutoffHz}`,
  );
}

// [A3] mini-turbo tiers rise in pitch; charge chimes too ────────────────────
{
  const tiers = [1, 2, 3].map((tier) => boostVoice("mini", tier).from);
  const charges = [1, 2, 3].map((tier) => chargeVoice(tier).from);
  const rising = (values: number[]): boolean =>
    values.every((value, index) => index === 0 || value > values[index - 1]!);
  gate.check(
    "[A3] ミニターボ3段が音程で上昇する（発火・チャージとも）",
    rising(tiers) && rising(charges),
    `boost ${tiers.join("→")} / charge ${charges.join("→")}`,
  );
}

// [A4/A5] the mute contract, measured ───────────────────────────────────────
function countingBackend(): AudioBackend & { played: number; engineCalls: number; squealCalls: number } {
  const backend = {
    played: 0,
    engineCalls: 0,
    squealCalls: 0,
    play() {
      backend.played += 1;
    },
    setEngine() {
      backend.engineCalls += 1;
    },
    setSqueal() {
      backend.squealCalls += 1;
    },
    dispose() {},
  };
  return backend;
}

{
  const backend = countingBackend();
  const audio = new NitroAudio(() => backend, {
    getItem: () => "muted",
    setItem: () => undefined,
  });
  audio.unlock();
  audio.beginFrame();
  for (const event of Object.values(SAMPLE_EVENTS)) {
    audio.beginFrame();
    audio.cue(cueForEvent(event, FOCUS));
  }
  audio.setEngine(0.8, 0.5);
  audio.setSqueal(0.7);
  gate.check(
    "[A4] ミュート中は backend に一切届かない（連続音セッター含む）",
    backend.played === 0 && backend.engineCalls === 0 && backend.squealCalls === 0,
    `play=${backend.played} engine=${backend.engineCalls} squeal=${backend.squealCalls}`,
  );

  // Unmuting must bring the continuous paths in at the REMEMBERED levels.
  audio.setMuted(false);
  gate.check(
    "[A5] ミュート解除で記憶していたエンジン/スキールが復帰する",
    backend.engineCalls > 0 && backend.squealCalls > 0,
    `engine=${backend.engineCalls} squeal=${backend.squealCalls}`,
  );
}

gate.expectFail(
  "[A4-neg] ミュートを無視する実装なら A4 が落ちる",
  () => {
    const backend = countingBackend();
    // A broken policy that forwards the recipe despite the muted flag:
    const recipe = recipeForCue({ kind: "voice", name: "go" });
    if (recipe) backend.play(recipe);
    return backend.played === 0;
  },
  "常時転送の対照",
);

// [A6] the frame budget holds ───────────────────────────────────────────────
{
  const backend = countingBackend();
  const audio = new NitroAudio(() => backend, null);
  audio.unlock();
  audio.beginFrame();
  for (let i = 0; i < 30; i += 1) {
    audio.cue({ kind: "voice", name: "pickup" });
  }
  gate.check(
    "[A6] 1フレーム30イベントでも backend 到達は予算以内",
    backend.played <= CUE_FRAME_BUDGET,
    `${backend.played} / ${CUE_FRAME_BUDGET}`,
  );
}

gate.expectFail(
  "[A6-neg] beginFrame を挟み続けると予算が効かない（予算がフレーム単位である証明）",
  () => {
    const backend = countingBackend();
    const audio = new NitroAudio(() => backend, null);
    audio.unlock();
    for (let i = 0; i < 30; i += 1) {
      audio.beginFrame();
      audio.cue({ kind: "voice", name: "pickup" });
    }
    return backend.played <= CUE_FRAME_BUDGET;
  },
  "毎キューで beginFrame",
);

// [A7] rival filtering: the policy stays quiet about other karts' routine ───
{
  const rival: CueContext = { ...FOCUS, focusSeat: 5 };
  const noisy = (["pickup", "item", "boost", "drift", "respawn", "lap", "finish"] as const)
    .map((kind) => cueForEvent(SAMPLE_EVENTS[kind], rival))
    .filter((cue) => cue !== null);
  const audibleThreat = cueForEvent(SAMPLE_EVENTS.hit, rival);
  gate.check(
    "[A7] 他車の日常イベントは無音・被弾/爆発は距離減衰で聞こえる",
    noisy.length === 0 && audibleThreat !== null,
    `日常 ${noisy.length} 件が鳴った / 脅威 ${audibleThreat ? "可聴" : "無音"}`,
  );
}

// [A8] boost items do not double-voice with their use event ─────────────────
{
  gate.check(
    "[A8] キノコの use は無音（同 tick の boost が鳴るため）",
    useVoice("mushroom") === null && useVoice("triple") === null && useVoice("banana") !== null,
    "mushroom/triple → null, banana → 音",
  );
}

gate.finish("AUDIO SELFTEST");
