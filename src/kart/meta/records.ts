/**
 * Records give play a memory — most of what makes a second session feel like
 * a continuation instead of a reset (vortex records.ts, whose storage
 * contract this copies: one versioned key, coerced tolerant reads, writes
 * that never throw).
 */

import type { RaceResult } from "../sim/types";

export const RECORDS_KEY = "nk.records.v1";

export interface ComboRecord {
  plays: number;
  wins: number;
  podiums: number;
  bestLapMs: number | null;
  bestRaceMs: number | null;
}

export interface TtRecord {
  bestMs: number | null;
  bestLapMs: number | null;
}

export interface NkRecords {
  v: 1;
  races: number;
  wins: number;
  podiums: number;
  miniTurbos: number;
  tricksLanded: number;
  itemHits: number;
  gpGolds: number;
  dailyFinishes: number;
  /** keyed `${trackId}|${speedClass}` + ("|m" when mirrored) */
  byCombo: Record<string, ComboRecord>;
  tt: Record<string, TtRecord>;
  /** `${cupId}|${speedClass}` + ("m" when mirrored) → won that cup */
  gpGold: Record<string, boolean>;
}

export function gpGoldKey(
  cupId: string,
  speedClass: number,
  mirror: boolean,
): string {
  return `${cupId}|${speedClass}${mirror ? "m" : ""}`;
}

/**
 * Reads a pre-split key as a CROWN win.
 *
 * The key used to be `${speedClass}` alone, because there was only one cup.
 * Left unmigrated, a player who had won it would find their "CUP CHAMPION"
 * achievement gone; migrated to the wrong cup, winning the easy one would
 * unlock the hard one's reward. The old cup WAS crown — same three circuits,
 * same order — so that is the honest reading.
 */
export function migrateGpGoldKey(key: string): string {
  if (key.includes("|")) return key;
  return `crown|${key}`;
}

export function emptyRecords(): NkRecords {
  return {
    v: 1,
    races: 0,
    wins: 0,
    podiums: 0,
    miniTurbos: 0,
    tricksLanded: 0,
    itemHits: 0,
    gpGolds: 0,
    dailyFinishes: 0,
    byCombo: {},
    tt: {},
    gpGold: {},
  };
}

export function comboKey(
  trackId: string,
  speedClass: number,
  mirror: boolean,
): string {
  return `${trackId}|${speedClass}${mirror ? "|m" : ""}`;
}

/** Coerced, not trusted: a tampered stringly count must not concatenate. */
function count(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function millis(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

export function coerceRecords(raw: unknown): NkRecords {
  const empty = emptyRecords();
  if (typeof raw !== "object" || raw === null) return empty;
  const source = raw as Record<string, unknown>;
  const records: NkRecords = {
    ...empty,
    races: count(source.races),
    wins: count(source.wins),
    podiums: count(source.podiums),
    miniTurbos: count(source.miniTurbos),
    tricksLanded: count(source.tricksLanded),
    itemHits: count(source.itemHits),
    gpGolds: count(source.gpGolds),
    dailyFinishes: count(source.dailyFinishes),
  };
  if (typeof source.byCombo === "object" && source.byCombo !== null) {
    for (const [key, value] of Object.entries(source.byCombo as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null) continue;
      const entry = value as Record<string, unknown>;
      records.byCombo[key] = {
        plays: count(entry.plays),
        wins: count(entry.wins),
        podiums: count(entry.podiums),
        bestLapMs: millis(entry.bestLapMs),
        bestRaceMs: millis(entry.bestRaceMs),
      };
    }
  }
  if (typeof source.tt === "object" && source.tt !== null) {
    for (const [key, value] of Object.entries(source.tt as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null) continue;
      const entry = value as Record<string, unknown>;
      records.tt[key] = {
        bestMs: millis(entry.bestMs),
        bestLapMs: millis(entry.bestLapMs),
      };
    }
  }
  if (typeof source.gpGold === "object" && source.gpGold !== null) {
    // Migrated on read, which is why no stored version number has to change:
    // `coerceRecords` already rebuilds the blob from whatever was on disk.
    for (const [key, value] of Object.entries(source.gpGold as Record<string, unknown>)) {
      if (value === true) records.gpGold[migrateGpGoldKey(key)] = true;
    }
  }
  return records;
}

export interface RaceOutcomeEntry {
  readonly kind: "race" | "tt" | "daily";
  readonly result: RaceResult;
  readonly seat: number;
  readonly speedClass: number;
  readonly mirror: boolean;
  readonly miniTurbos: number;
  readonly tricksLanded: number;
  readonly itemHits: number;
  /** Set on the FINAL round of a won cup. */
  readonly gpGoldClass: number | null;
  /** Which cup it was. Only read when `gpGoldClass` is set. */
  readonly cupId: string;
}

export interface NewBests {
  readonly bestLap: boolean;
  readonly bestRace: boolean;
}

/** Pure: apply one finished race. Same-object replay must not double-count —
 * the caller guards with result identity; this stays pure regardless. */
export function applyRace(
  records: NkRecords,
  entry: RaceOutcomeEntry,
): { records: NkRecords; newBests: NewBests } {
  const next: NkRecords = JSON.parse(JSON.stringify(records)) as NkRecords;
  const mine = entry.result.standings.find(
    (standing) => standing.id === entry.seat,
  );
  let bestLap = false;
  let bestRace = false;
  next.races += 1;
  next.miniTurbos += entry.miniTurbos;
  next.tricksLanded += entry.tricksLanded;
  next.itemHits += entry.itemHits;
  if (entry.kind === "daily" && mine?.finished) next.dailyFinishes += 1;
  if (mine) {
    if (mine.place === 1) next.wins += 1;
    if (mine.place <= 3) next.podiums += 1;
    const key = comboKey(entry.result.trackId, entry.speedClass, entry.mirror);
    const combo =
      next.byCombo[key] ??
      { plays: 0, wins: 0, podiums: 0, bestLapMs: null, bestRaceMs: null };
    combo.plays += 1;
    if (mine.place === 1) combo.wins += 1;
    if (mine.place <= 3) combo.podiums += 1;
    if (mine.bestLap !== null) {
      const lapMs = Math.round(mine.bestLap * 1000);
      if (combo.bestLapMs === null || lapMs < combo.bestLapMs) {
        combo.bestLapMs = lapMs;
        bestLap = true;
      }
    }
    if (mine.finished && mine.time !== null) {
      const raceMs = Math.round(mine.time * 1000);
      if (combo.bestRaceMs === null || raceMs < combo.bestRaceMs) {
        combo.bestRaceMs = raceMs;
        bestRace = true;
      }
    }
    next.byCombo[key] = combo;

    if (entry.kind === "tt" && mine.finished && mine.time !== null) {
      const tt = next.tt[key] ?? { bestMs: null, bestLapMs: null };
      const raceMs = Math.round(mine.time * 1000);
      if (tt.bestMs === null || raceMs < tt.bestMs) tt.bestMs = raceMs;
      if (mine.bestLap !== null) {
        const lapMs = Math.round(mine.bestLap * 1000);
        if (tt.bestLapMs === null || lapMs < tt.bestLapMs) tt.bestLapMs = lapMs;
      }
      next.tt[key] = tt;
    }
  }
  if (entry.gpGoldClass !== null) {
    const goldKey = gpGoldKey(entry.cupId, entry.gpGoldClass, entry.mirror);
    if (!next.gpGold[goldKey]) {
      next.gpGold[goldKey] = true;
      next.gpGolds += 1;
    }
  }
  return { records: next, newBests: { bestLap, bestRace } };
}

export function loadRecords(): NkRecords {
  try {
    const raw = window.localStorage.getItem(RECORDS_KEY);
    return raw ? coerceRecords(JSON.parse(raw)) : emptyRecords();
  } catch {
    return emptyRecords();
  }
}

export function saveRecords(records: NkRecords): void {
  try {
    window.localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  } catch {
    // Private browsing must never break the game.
  }
}
