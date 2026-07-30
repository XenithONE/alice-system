/**
 * Match records. Until v3 the garage was the ONLY thing this game persisted:
 * a finished match — win or loss, best endless wave, anything — evaporated on
 * navigation. Records give play a memory, which is most of what makes a
 * second session feel like a continuation instead of a reset.
 *
 * Storage contract matches the neighbours (vc.garage.v1, vc.audio.v1):
 * one versioned key, tolerant reads, writes that never throw.
 */

export const RECORDS_STORAGE_KEY = "vc.records.v1";
const RECENT_LIMIT = 8;

export interface MatchRecordEntry {
  /** epoch ms — display only, never used in game logic. */
  readonly at: number;
  readonly mode: "solo" | "network" | "endless";
  readonly arenaId: string;
  readonly outcome: "win" | "loss" | "draw";
  readonly reason: string;
  readonly durationSec: number;
}

export interface VortexRecords {
  readonly v: 1;
  readonly matches: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly ringOuts: number;
  readonly destroys: number;
  readonly bestWave: number;
  readonly recent: readonly MatchRecordEntry[];
}

export const EMPTY_RECORDS: VortexRecords = {
  v: 1,
  matches: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  ringOuts: 0,
  destroys: 0,
  bestWave: 0,
  recent: [],
};

function storage(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadRecords(): VortexRecords {
  try {
    const raw = storage()?.getItem(RECORDS_STORAGE_KEY);
    if (!raw) return EMPTY_RECORDS;
    const parsed = JSON.parse(raw) as Partial<VortexRecords>;
    if (parsed.v !== 1) return EMPTY_RECORDS;
    // Coerced, not trusted: a tampered stringly `wins` would otherwise flow
    // through `+ 1` as concatenation, get persisted, and inflate forever.
    const count = (value: unknown): number =>
      typeof value === "number" && Number.isFinite(value) && value >= 0
        ? Math.floor(value)
        : 0;
    return {
      ...EMPTY_RECORDS,
      matches: count(parsed.matches),
      wins: count(parsed.wins),
      losses: count(parsed.losses),
      draws: count(parsed.draws),
      ringOuts: count(parsed.ringOuts),
      destroys: count(parsed.destroys),
      bestWave: count(parsed.bestWave),
      recent: Array.isArray(parsed.recent)
        ? parsed.recent.slice(0, RECENT_LIMIT)
        : [],
    };
  } catch {
    return EMPTY_RECORDS;
  }
}

function save(records: VortexRecords): VortexRecords {
  try {
    storage()?.setItem(RECORDS_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Full or blocked storage must never break the result screen.
  }
  return records;
}

export function recordMatch(entry: MatchRecordEntry): VortexRecords {
  const current = loadRecords();
  /*
   * Endless is co-op waves: its runs always "end", and counting each as a
   * loss inflated the loss tally with a number that measured persistence,
   * not defeat. Endless keeps its own score (bestWave) and the recent
   * list; the W/L line stays a versus record.
   */
  const versus = entry.mode !== "endless";
  return save({
    ...current,
    matches: current.matches + 1,
    wins: current.wins + (versus && entry.outcome === "win" ? 1 : 0),
    losses: current.losses + (versus && entry.outcome === "loss" ? 1 : 0),
    draws: current.draws + (versus && entry.outcome === "draw" ? 1 : 0),
    ringOuts: current.ringOuts + (versus && entry.reason === "ring-out" ? 1 : 0),
    destroys: current.destroys + (versus && entry.reason === "destroyed" ? 1 : 0),
    recent: [entry, ...current.recent].slice(0, RECENT_LIMIT),
  });
}

export function recordEndlessWave(wave: number): VortexRecords {
  const current = loadRecords();
  if (wave <= current.bestWave) return current;
  return save({ ...current, bestWave: wave });
}
