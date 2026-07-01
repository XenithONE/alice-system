// Persistence for THE HOLLOW WARD. All keys are namespaced `hw_` (Hollow Ward).

const BEST_MS_KEY = "hw_best_ms";
const BEST_SCORE_KEY = "hw_best_score";
const ACH_KEY = "hw_ach";
const RUNS_KEY = "hw_runs";
const WINS_KEY = "hw_wins";
const SCARES_SEEN_KEY = "hw_scares_seen";
const LOOP_KEY = "hw_loop";

export interface ProgressState {
  bestMs: number;
  bestScore: number;
  achievements: Set<string>;
  runs: number;
  wins: number;
  scaresSeen: Set<string>;
  loop: number;
  version: string;
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorage can be unavailable in private browsing modes.
  }
}

function readNumber(key: string): number {
  const value = Number(read(key) || "0");
  return Number.isFinite(value) ? value : 0;
}

function readJsonArray(key: string): string[] {
  try {
    const value = window.localStorage.getItem(key);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function saveJsonArray(key: string, values: Iterable<string>): void {
  write(key, JSON.stringify([...values]));
}

export function readProgress(): ProgressState {
  const bestMs = readNumber(BEST_MS_KEY);
  const bestScore = readNumber(BEST_SCORE_KEY);
  const achievements = new Set(readJsonArray(ACH_KEY));
  const runs = readNumber(RUNS_KEY);
  const wins = readNumber(WINS_KEY);
  const scaresSeen = new Set(readJsonArray(SCARES_SEEN_KEY));
  const loop = readNumber(LOOP_KEY);

  const version = [bestMs, bestScore, achievements.size, runs, wins, scaresSeen.size, loop].join("|");

  return { bestMs, bestScore, achievements, runs, wins, scaresSeen, loop, version };
}

export function unlockAchievements(ids: string[]): ProgressState {
  const set = new Set(readJsonArray(ACH_KEY));
  let changed = false;
  for (const id of ids) {
    if (!set.has(id)) {
      set.add(id);
      changed = true;
    }
  }
  if (changed) saveJsonArray(ACH_KEY, set);
  return readProgress();
}

export function recordScare(kind: string): ProgressState {
  const set = new Set(readJsonArray(SCARES_SEEN_KEY));
  if (!set.has(kind)) {
    set.add(kind);
    saveJsonArray(SCARES_SEEN_KEY, set);
  }
  return readProgress();
}

export interface RunResult {
  won: boolean;
  ms: number;
  score: number;
}

export function recordRun(result: RunResult): ProgressState {
  write(RUNS_KEY, String(readNumber(RUNS_KEY) + 1));
  if (result.won) {
    write(WINS_KEY, String(readNumber(WINS_KEY) + 1));
    const prevMs = readNumber(BEST_MS_KEY);
    if (!prevMs || result.ms < prevMs) write(BEST_MS_KEY, String(Math.round(result.ms)));
    const prevScore = readNumber(BEST_SCORE_KEY);
    if (result.score > prevScore) write(BEST_SCORE_KEY, String(Math.round(result.score)));
  }
  return readProgress();
}

export function advanceLoop(): ProgressState {
  write(LOOP_KEY, String(readNumber(LOOP_KEY) + 1));
  return readProgress();
}
