/**
 * The daily challenge: one fixed combination per calendar day, forever
 * replayable, best-of-day recorded, streak counted.
 *
 * `kartDayKey` is ZERO-PADDED and therefore string-sortable — deliberately
 * NOT the shared `seed.ts` `dayKey()` ("2026-8-1"), whose format the horror
 * game's stored seeds depend on and which sorts "2026-8-10" before
 * "2026-8-2". The trap is real enough that modesSelftest [M7] feeds the
 * unpadded form to the sort as its destructive control.
 */

import { hashStr, mulberry32 } from "../../lib/seed";
import { WEATHER_KINDS, type WeatherKind } from "../sim/balance";
import { TRACKS } from "../sim/tracks";

export const DAILY_KEY = "nk.daily.v1";

export function kartDayKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export interface DailyCombo {
  readonly dateKey: string;
  readonly trackId: string;
  readonly speedClass: number;
  readonly mirror: boolean;
  readonly weather: WeatherKind;
  readonly seed: number;
}

/** Pure: the same date always produces the same challenge. */
export function dailyCombo(dateKey: string): DailyCombo {
  const random = mulberry32(hashStr(`nk-daily:${dateKey}`));
  const track = TRACKS[Math.floor(random() * TRACKS.length)]!;
  const speedClass = Math.floor(random() * 3);
  const mirror = random() < 0.25;
  const weather =
    WEATHER_KINDS[random() < 0.3 ? 1 : 0] ?? "clear";
  const seed = Math.floor(random() * 0xffffffff) >>> 0;
  return { dateKey, trackId: track.id, speedClass, mirror, weather, seed };
}

export interface DailyState {
  v: 1;
  dateKey: string;
  bestMs: number | null;
  bestPlace: number | null;
  attempts: number;
  streak: number;
  lastFinishedKey: string | null;
}

export function emptyDaily(dateKey: string): DailyState {
  return {
    v: 1,
    dateKey,
    bestMs: null,
    bestPlace: null,
    attempts: 0,
    streak: 0,
    lastFinishedKey: null,
  };
}

function previousDayKey(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year!, (month ?? 1) - 1, day ?? 1);
  date.setDate(date.getDate() - 1);
  return kartDayKey(date);
}

/**
 * Pure: apply a finished daily attempt. Unlimited attempts; best-of-day
 * kept; streak = consecutive calendar days with at least one finish.
 */
export function applyDailyFinish(
  state: DailyState,
  dateKey: string,
  ms: number,
  place: number,
): DailyState {
  const next: DailyState = { ...state };
  if (next.dateKey !== dateKey) {
    next.dateKey = dateKey;
    next.bestMs = null;
    next.bestPlace = null;
    next.attempts = 0;
  }
  next.attempts += 1;
  if (next.bestMs === null || ms < next.bestMs) next.bestMs = ms;
  if (next.bestPlace === null || place < next.bestPlace) next.bestPlace = place;
  if (next.lastFinishedKey !== dateKey) {
    next.streak =
      next.lastFinishedKey === previousDayKey(dateKey) ? next.streak + 1 : 1;
    next.lastFinishedKey = dateKey;
  }
  return next;
}

export function loadDaily(dateKey: string): DailyState {
  try {
    const raw = window.localStorage.getItem(DAILY_KEY);
    if (!raw) return emptyDaily(dateKey);
    const parsed = JSON.parse(raw) as Partial<DailyState>;
    const state = emptyDaily(dateKey);
    if (typeof parsed.dateKey === "string") state.dateKey = parsed.dateKey;
    if (typeof parsed.bestMs === "number") state.bestMs = parsed.bestMs;
    if (typeof parsed.bestPlace === "number") state.bestPlace = parsed.bestPlace;
    if (typeof parsed.attempts === "number") state.attempts = Math.floor(parsed.attempts);
    if (typeof parsed.streak === "number") state.streak = Math.floor(parsed.streak);
    if (typeof parsed.lastFinishedKey === "string") {
      state.lastFinishedKey = parsed.lastFinishedKey;
    }
    // A stored state from an earlier day shows zeroed bests for today.
    if (state.dateKey !== dateKey) {
      return {
        ...state,
        dateKey,
        bestMs: null,
        bestPlace: null,
        attempts: 0,
      };
    }
    return state;
  } catch {
    return emptyDaily(dateKey);
  }
}

export function saveDaily(state: DailyState): void {
  try {
    window.localStorage.setItem(DAILY_KEY, JSON.stringify(state));
  } catch {
    // Private browsing.
  }
}
