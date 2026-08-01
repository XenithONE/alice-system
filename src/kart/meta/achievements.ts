/**
 * Achievements and livery unlocks, derived — never stored.
 *
 * `unlockedLiveries` is a pure function of the records blob (the pattern
 * `lib/achievements.ts` uses for the horror game): there is no `unlocked[]`
 * array to corrupt or migrate, and the "NEW COLOR" toast is simply the diff
 * of evaluate() before and after the single records write.
 */

import { CHARACTERS } from "../content/characters";
import { MACHINES } from "../content/machines";
import type { UnlockRule } from "../content/index";
import type { DailyState } from "./daily";
import type { NkRecords } from "./records";

export interface KartAchievement {
  readonly id: string;
  readonly title: string;
  readonly desc: string;
  /** Livery index 8..15 this achievement unlocks, if any. */
  readonly liveryUnlock?: number;
}

export const KART_ACHIEVEMENTS: readonly KartAchievement[] = [
  { id: "first_win", title: "FIRST CROWN", desc: "レースで1位を取る", liveryUnlock: 8 },
  { id: "wins_5", title: "SERIAL WINNER", desc: "通算5勝", liveryUnlock: 9 },
  { id: "gp_gold", title: "CUP CHAMPION", desc: "グランプリで総合優勝", liveryUnlock: 10 },
  { id: "gp_gold_200", title: "APEX MASTER", desc: "200ccのグランプリで総合優勝", liveryUnlock: 11 },
  { id: "mirror_win", title: "MIRROR BREAKER", desc: "ミラーで1勝する", liveryUnlock: 12 },
  { id: "daily_streak_3", title: "REGULAR", desc: "デイリー3日連続完走", liveryUnlock: 13 },
  { id: "tt_all", title: "TIME LORD", desc: "全コースでタイムトライアル記録を残す", liveryUnlock: 14 },
  { id: "races_25", title: "VETERAN", desc: "通算25レース", liveryUnlock: 15 },
  { id: "turbo_100", title: "DRIFT KING", desc: "ミニターボ累計100回" },
  { id: "trick_25", title: "AERIALIST", desc: "トリック着地25回" },
  { id: "hits_30", title: "SHARPSHOOTER", desc: "アイテム命中30回" },
  { id: "podium_10", title: "CONSISTENT", desc: "表彰台10回" },
];

/** Pure, read-only: every achievement id currently satisfied. */
export function evaluateAchievements(
  records: NkRecords,
  daily: Pick<DailyState, "streak">,
): string[] {
  const earned: string[] = [];
  const has = (id: string, ok: boolean): void => {
    if (ok) earned.push(id);
  };
  const trackCount = 3;
  const ttTracks = new Set(
    Object.keys(records.tt)
      .filter((key) => records.tt[key]?.bestMs !== null)
      .map((key) => key.split("|")[0]!),
  );
  const mirrorWins = Object.entries(records.byCombo).some(
    ([key, combo]) => key.endsWith("|m") && combo.wins > 0,
  );
  /*
   * Against the speed-class half of the key, not its start. The key gained a
   * `${cupId}|` prefix when the cups split, and `startsWith("2")` silently
   * stopped matching anything — the achievement would have quietly become
   * unobtainable rather than erroring.
   */
  const gold200 = Object.keys(records.gpGold).some(
    (key) => (key.split("|")[1] ?? key).startsWith("2"),
  );

  has("first_win", records.wins >= 1);
  has("wins_5", records.wins >= 5);
  has("gp_gold", records.gpGolds >= 1);
  has("gp_gold_200", gold200);
  has("mirror_win", mirrorWins);
  has("daily_streak_3", daily.streak >= 3);
  has("tt_all", ttTracks.size >= trackCount);
  has("races_25", records.races >= 25);
  has("turbo_100", records.miniTurbos >= 100);
  has("trick_25", records.tricksLanded >= 25);
  has("hits_30", records.itemHits >= 30);
  has("podium_10", records.podiums >= 10);
  return earned;
}

/** Liveries 0..7 are free; 8..15 come from achievements. */
export function unlockedLiveries(
  records: NkRecords,
  daily: Pick<DailyState, "streak">,
): Set<number> {
  const unlocked = new Set<number>([0, 1, 2, 3, 4, 5, 6, 7]);
  const earned = new Set(evaluateAchievements(records, daily));
  for (const achievement of KART_ACHIEVEMENTS) {
    if (achievement.liveryUnlock !== undefined && earned.has(achievement.id)) {
      unlocked.add(achievement.liveryUnlock);
    }
  }
  return unlocked;
}

/**
 * Which garage entries are open, derived the same way the liveries are — the
 * unlock rule lives on the catalog entry, so adding a character cannot leave
 * an unlock table out of date behind it.
 */
export function unlockedKit(
  records: NkRecords,
  daily: Pick<DailyState, "streak">,
): { characters: Set<string>; machines: Set<string> } {
  const earned = new Set(evaluateAchievements(records, daily));
  const open = (rule: UnlockRule): boolean =>
    rule.kind === "free" || earned.has(rule.id);
  return {
    characters: new Set(
      CHARACTERS.filter((entry) => open(entry.unlock)).map((entry) => entry.id),
    ),
    machines: new Set(
      MACHINES.filter((entry) => open(entry.unlock)).map((entry) => entry.id),
    ),
  };
}
