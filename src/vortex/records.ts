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
    return {
      ...EMPTY_RECORDS,
      ...parsed,
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
  return save({
    ...current,
    matches: current.matches + 1,
    wins: current.wins + (entry.outcome === "win" ? 1 : 0),
    losses: current.losses + (entry.outcome === "loss" ? 1 : 0),
    draws: current.draws + (entry.outcome === "draw" ? 1 : 0),
    ringOuts: current.ringOuts + (entry.reason === "ring-out" ? 1 : 0),
    destroys: current.destroys + (entry.reason === "destroyed" ? 1 : 0),
    recent: [entry, ...current.recent].slice(0, RECENT_LIMIT),
  });
}

export function recordEndlessWave(wave: number): VortexRecords {
  const current = loadRecords();
  if (wave <= current.bestWave) return current;
  return save({ ...current, bestWave: wave });
}
