import type { ProgressState } from "./storage";

export interface Achievement {
  id: string;
  title: string;
  desc: string;
}

export interface AchievementExtras {
  wonThisRun?: boolean;
  scaresThisRun?: number;
  hidesThisRun?: number;
  msThisRun?: number;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first_scare", title: "SOMETHING MOVED", desc: "初めてジャンプスケアに遭遇する。" },
  { id: "all_scares", title: "SEEN IT ALL", desc: "5種類のジャンプスケアすべてを経験する。" },
  { id: "first_escape", title: "OUT THE WARD", desc: "初めて脱出に成功する。" },
  { id: "speed_escape", title: "DON'T LOOK BACK", desc: "90秒以内に脱出する。" },
  { id: "flawless", title: "UNSEEN", desc: "ジャンプスケアなしで脱出する。" },
  { id: "ghost", title: "GHOST PATIENT", desc: "1回の脱出で3回以上隠れる。" },
  { id: "veteran", title: "REPEAT VISITOR", desc: "合計5回プレイする。" },
  { id: "ng_plus", title: "STILL HERE", desc: "脱出後、もう一度病棟へ戻る（NG+）。" }
];

// Pure read-only evaluation: returns every achievement id currently satisfied.
export function evaluate(p: ProgressState, extras: AchievementExtras = {}): string[] {
  const out: string[] = [];
  if (p.scaresSeen.size >= 1) out.push("first_scare");
  if (p.scaresSeen.size >= 5) out.push("all_scares");
  if (p.wins >= 1) out.push("first_escape");
  if (p.bestMs > 0 && p.bestMs <= 90000) out.push("speed_escape");
  if (extras.wonThisRun && (extras.scaresThisRun ?? 1) === 0) out.push("flawless");
  if (extras.wonThisRun && (extras.hidesThisRun ?? 0) >= 3) out.push("ghost");
  if (p.runs >= 5) out.push("veteran");
  if (p.loop >= 1) out.push("ng_plus");
  return out;
}
