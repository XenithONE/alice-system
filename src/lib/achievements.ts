import { SIGNAL_FRAGMENTS, WORLDS } from "../data/worlds";
import type { ProgressState } from "./storage";

export interface Achievement {
  id: string;
  title: string;
  desc: string;
}

export interface AchievementExtras {
  timeTrialFinished?: boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first_fragment", title: "FIRST LIGHT", desc: "信号の断片を1つ回収する。" },
  { id: "all_fragments", title: "EIDOLON ACCORD", desc: "6つの断片をすべて回収する。" },
  { id: "first_world", title: "TOUCHDOWN", desc: "最初のゲーム惑星を制覇する。" },
  { id: "seven_worlds", title: "ATLAS COMPLETE", desc: "7つのゲーム惑星をすべて制覇する。" },
  { id: "hidden_planet", title: "OBSERVER", desc: "隠された惑星を出現させる。" },
  { id: "true_ending", title: "SEVENTH SIGNAL", desc: "真のエンディングを解放する。" },
  { id: "stardust_50", title: "DUST DIVER", desc: "スターダストを累計50個集める。" },
  { id: "stardust_250", title: "STARGAZER", desc: "スターダストを累計250個集める。" },
  { id: "ring_run", title: "COURIER", desc: "リングランを完走する。" },
  { id: "fast_run", title: "LIGHT SPEED", desc: "リングランを30秒以内で完走する。" },
  { id: "distance_2k", title: "WAYFARER", desc: "累計2000ユニット飛行する。" },
  { id: "ng_plus", title: "ETERNAL RETURN", desc: "新たなループ(NG+)を始める。" }
];

const GAME_WORLDS = WORLDS.filter((world) => world.kind === "game").length;

// Pure read-only evaluation: returns every achievement id currently satisfied.
export function evaluate(p: ProgressState, extras: AchievementExtras = {}): string[] {
  const out: string[] = [];
  if (p.fragments.size >= 1) out.push("first_fragment");
  if (p.fragments.size >= SIGNAL_FRAGMENTS.length) out.push("all_fragments");
  if (p.sevenWorlds.size >= 1) out.push("first_world");
  if (p.sevenWorlds.size >= GAME_WORLDS) out.push("seven_worlds");
  if (p.hiddenPlanet) out.push("hidden_planet");
  if (p.trueEnding) out.push("true_ending");
  if (p.stardustTotal >= 50) out.push("stardust_50");
  if (p.stardustTotal >= 250) out.push("stardust_250");
  if (p.timeTrialBest > 0 || extras.timeTrialFinished) out.push("ring_run");
  if (p.timeTrialBest > 0 && p.timeTrialBest <= 30000) out.push("fast_run");
  if (p.distance >= 2000) out.push("distance_2k");
  if (p.loop >= 1) out.push("ng_plus");
  return out;
}
