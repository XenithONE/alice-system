/**
 * Gate: the audio layer keeps its three promises.
 *
 * 1. Every FX family has a voice, and no two voices are the same sound —
 *    the acoustic version of fxSelftest's colour-distance check. The
 *    compile-time Record already forces coverage; this measures DISTINCTNESS,
 *    which types cannot.
 * 2. Physics reaches the ear: a harder impact is strictly louder and longer.
 * 3. Mute means nothing is scheduled. Not zero-gain rendering — nothing.
 *    The backend is injected, so this is measured by counting.
 *
 * Run: npx tsx src/vortex/audio/selftest.ts
 */
import { FX_FAMILIES } from "../content/fxFamily";
import {
  AUDIO_STORAGE_KEY,
  recipeForCue,
  VortexAudio,
  type AudioBackend,
  type AudioCue,
} from "./engine";
import { EVENT_VOICES, impactVoice, SKILL_VOICES } from "./voices";

declare const process: { exitCode?: number };

const failures: string[] = [];
const check = (name: string, ok: boolean, detail: string): void => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
  if (!ok) failures.push(name);
};

/* 1 — coverage and distinctness ------------------------------------ */

const missing = FX_FAMILIES.filter(
  (family) => !(family in SKILL_VOICES) || SKILL_VOICES[family].gain <= 0,
);
check(
  "[A0] 9演出型すべてに音色がある",
  missing.length === 0,
  missing.length === 0 ? `${FX_FAMILIES.length} 型すべて` : missing.join(","),
);

const signatures = new Map<string, string>();
let duplicate: string | null = null;
for (const family of FX_FAMILIES) {
  const recipe = SKILL_VOICES[family];
  const signature = JSON.stringify([
    recipe.wave, recipe.from, recipe.to, recipe.secondHz,
    recipe.vibratoHz, recipe.noise,
  ]);
  const previous = signatures.get(signature);
  if (previous) duplicate = `${previous} と ${family}`;
  signatures.set(signature, family);
}
check(
  "[A1] 同じ音の型が二つ存在しない",
  duplicate === null,
  duplicate ?? "全9型のシグネチャが相異なる",
);

/* 2 — physics reaches the ear --------------------------------------- */

const soft = impactVoice(4);
const hard = impactVoice(40);
check(
  "[A2] 強い衝突ほど大きく長く鳴る",
  hard.gain > soft.gain * 1.5 && hard.durationSec > soft.durationSec,
  `gain ${soft.gain.toFixed(2)} -> ${hard.gain.toFixed(2)}, ` +
    `dur ${soft.durationSec.toFixed(2)}s -> ${hard.durationSec.toFixed(2)}s`,
);

check(
  "[A3] 場外と破壊は別の音",
  JSON.stringify(EVENT_VOICES["knockout-ring-out"]) !==
    JSON.stringify(EVENT_VOICES["knockout-destroyed"]),
  "knockout-ring-out ≠ knockout-destroyed",
);

/* 3 — the mute contract --------------------------------------------- */

function makeCountingBackend(): AudioBackend & {
  played: number;
  droneCalls: number[];
} {
  const backend = {
    played: 0,
    droneCalls: [] as number[],
    play() {
      backend.played += 1;
    },
    setDrone(level: number) {
      backend.droneCalls.push(level);
    },
    dispose() {},
  };
  return backend;
}

function makeStorage(initial?: string) {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set(AUDIO_STORAGE_KEY, initial);
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    dump: () => map.get(AUDIO_STORAGE_KEY),
  };
}

/*
 * Record over the one-shot kinds, so the compiler proves exhaustiveness —
 * `combo` was added to AudioCue and this list silently stopped covering the
 * union, which quietly demoted A4/A5 from "every cue kind" to "most".
 */
const ONE_SHOT_CUES: Record<
  Exclude<AudioCue["kind"], "sudden-death">,
  AudioCue
> = {
  skill: { kind: "skill", family: "lance" },
  impact: { kind: "impact", impulse: 20 },
  shockwave: { kind: "shockwave" },
  knockout: { kind: "knockout", reason: "ring-out" },
  combo: { kind: "combo" },
  launch: { kind: "launch" },
  deny: { kind: "deny" },
};
const EVERY_CUE: readonly AudioCue[] = [
  ...Object.values(ONE_SHOT_CUES),
  // Both knockout flavours, beyond the union-coverage minimum.
  { kind: "knockout", reason: "destroyed" },
];

{
  const backend = makeCountingBackend();
  const storage = makeStorage();
  const audio = new VortexAudio(() => backend, storage);
  audio.unlock();
  for (const cue of EVERY_CUE) audio.cue(cue);
  check(
    "[A4] ミュート解除時は全種類の合図が鳴る",
    backend.played === EVERY_CUE.length,
    `${backend.played}/${EVERY_CUE.length} 件がバックエンドに到達`,
  );

  audio.setMuted(true);
  const before = backend.played;
  for (const cue of EVERY_CUE) audio.cue(cue);
  audio.cue({ kind: "sudden-death", stage: 2 });
  check(
    "[A5] ミュート中はバックエンドに一切届かない",
    backend.played === before &&
      backend.droneCalls.every((level) => level === 0),
    `追加再生 ${backend.played - before} 件・ドローン呼び出し ${JSON.stringify(backend.droneCalls)}`,
  );

  audio.setMuted(false);
  check(
    "[A6] ミュート解除でサドンデスのドローンが正しい強度で復帰する",
    backend.droneCalls[backend.droneCalls.length - 1] === 2,
    `ドローン履歴 ${JSON.stringify(backend.droneCalls)}`,
  );
  check(
    "[A7] ミュート設定が保存される",
    storage.dump() === "on",
    `storage=${storage.dump()}`,
  );
}

{
  const backend = makeCountingBackend();
  const audio = new VortexAudio(() => backend, makeStorage("muted"));
  audio.unlock();
  for (const cue of EVERY_CUE) audio.cue(cue);
  check(
    "[A8] 保存されたミュートが次の起動で効いている",
    audio.muted && backend.played === 0,
    `muted=${audio.muted}, played=${backend.played}`,
  );
}

check(
  "[A9] sudden-death は one-shot ではなくドローン",
  recipeForCue({ kind: "sudden-death", stage: 1 }) === null,
  "recipeForCue(sudden-death) === null（setDrone 経路のみ）",
);

if (failures.length > 0) {
  console.log(`AUDIO SELFTEST FAIL — ${failures.join(" / ")}`);
  process.exitCode = 1;
} else {
  console.log("AUDIO SELFTEST PASS");
}
