import { SIGNAL_FRAGMENTS, type FragmentId, type World } from "../data/worlds";
import { dayKey } from "./seed";

const FRAG_KEY = "alice_eidolon";
const ACCORD_KEY = "alice_accord";
const TRUE_KEY = "alice_true";
const SEVEN_KEY = "alice_seven";
const VISITS_KEY = "alice_visits";
const HIDDEN_PLANET_KEY = "alice_planet_hint";
// v1.1 gameplay keys (all additive)
const STARDUST_TOTAL_KEY = "alice_stardust_total";
const STARDUST_BEST_KEY = "alice_stardust_best";
const STARDUST_SET_KEY = "alice_stardust_set";
const STARDUST_DAY_KEY = "alice_stardust_day";
const ACH_KEY = "alice_ach";
const TT_BEST_KEY = "alice_timetrial_best";
const DISTANCE_KEY = "alice_distance";
const LOOP_KEY = "alice_loop";

export interface ProgressState {
  fragments: Set<FragmentId>;
  accord: boolean;
  trueEnding: boolean;
  sevenWorlds: Set<string>;
  visits: number;
  hiddenPlanet: boolean;
  completedWorlds: Set<string>;
  // v1.1 gameplay
  stardustTotal: number;
  stardustBest: number;
  stardustToday: Set<string>;
  achievements: Set<string>;
  timeTrialBest: number;
  distance: number;
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
    // localStorage can be unavailable in private browser modes.
  }
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

function readNumber(key: string): number {
  const value = Number(read(key) || "0");
  return Number.isFinite(value) ? value : 0;
}

function fragmentSet(): Set<FragmentId> {
  const allowed = new Set<string>(SIGNAL_FRAGMENTS);
  return new Set(readJsonArray(FRAG_KEY).filter((item): item is FragmentId => allowed.has(item)));
}

function completedSet(worlds: World[]): Set<string> {
  const completed = new Set<string>();
  for (const world of worlds) {
    if (world.statusKey && read(world.statusKey) === "1") completed.add(world.id);
  }
  return completed;
}

function sevenSet(worlds: World[]): Set<string> {
  const saved = new Set(readJsonArray(SEVEN_KEY));
  for (const world of worlds) {
    if (world.kind === "game" && world.statusKey && read(world.statusKey) === "1") saved.add(world.id);
  }
  saveJsonArray(SEVEN_KEY, saved);
  return saved;
}

export function bumpVisits(): void {
  const visits = Math.max(0, Number(read(VISITS_KEY) || "0")) + 1;
  write(VISITS_KEY, String(visits));
}

export function readProgress(worlds: World[]): ProgressState {
  const fragments = fragmentSet();
  const completedWorlds = completedSet(worlds);
  const sevenWorlds = sevenSet(worlds);
  const visits = Math.max(1, Number(read(VISITS_KEY) || "1"));
  const hiddenPlanet = read(HIDDEN_PLANET_KEY) === "1";
  const accord = read(ACCORD_KEY) === "1" || fragments.size >= SIGNAL_FRAGMENTS.length;
  if (accord) write(ACCORD_KEY, "1");
  const trueEnding = read(TRUE_KEY) === "1";

  // v1.1: daily reset of the per-day collected stardust set
  const today = dayKey();
  if (read(STARDUST_DAY_KEY) !== today) {
    write(STARDUST_DAY_KEY, today);
    saveJsonArray(STARDUST_SET_KEY, []);
  }
  const stardustTotal = readNumber(STARDUST_TOTAL_KEY);
  const stardustBest = readNumber(STARDUST_BEST_KEY);
  const stardustToday = new Set(readJsonArray(STARDUST_SET_KEY));
  const achievements = new Set(readJsonArray(ACH_KEY));
  const timeTrialBest = readNumber(TT_BEST_KEY);
  const distance = readNumber(DISTANCE_KEY);
  const loop = readNumber(LOOP_KEY);

  // Only cheap, HUD-affecting scalars go into version (distance changes constantly → excluded).
  const version = [
    [...fragments].sort().join(","),
    [...completedWorlds].sort().join(","),
    [...sevenWorlds].sort().join(","),
    accord ? "a" : "x",
    trueEnding ? "t" : "x",
    hiddenPlanet ? "h" : "x",
    visits,
    stardustTotal,
    achievements.size,
    loop
  ].join("|");

  return {
    fragments,
    accord,
    trueEnding,
    sevenWorlds,
    visits,
    hiddenPlanet,
    completedWorlds,
    stardustTotal,
    stardustBest,
    stardustToday,
    achievements,
    timeTrialBest,
    distance,
    loop,
    version
  };
}

export function collectFragment(id: FragmentId, worlds: World[]): ProgressState {
  const fragments = fragmentSet();
  fragments.add(id);
  saveJsonArray(FRAG_KEY, fragments);
  if (fragments.size >= SIGNAL_FRAGMENTS.length) write(ACCORD_KEY, "1");
  return readProgress(worlds);
}

export function revealHiddenPlanet(worlds: World[]): ProgressState {
  write(HIDDEN_PLANET_KEY, "1");
  return readProgress(worlds);
}

export function unlockTrueEnding(worlds: World[]): ProgressState {
  write(TRUE_KEY, "1");
  return readProgress(worlds);
}

export function syncSevenWorld(id: string, worlds: World[]): ProgressState {
  const saved = new Set(readJsonArray(SEVEN_KEY));
  saved.add(id);
  saveJsonArray(SEVEN_KEY, saved);
  return readProgress(worlds);
}

// ---- v1.1 gameplay mutators (all additive, idempotent where it matters) ----

export function collectStardust(id: string, worlds: World[]): ProgressState {
  const today = dayKey();
  if (read(STARDUST_DAY_KEY) !== today) {
    write(STARDUST_DAY_KEY, today);
    saveJsonArray(STARDUST_SET_KEY, []);
  }
  const set = new Set(readJsonArray(STARDUST_SET_KEY));
  if (set.has(id)) return readProgress(worlds); // idempotent
  set.add(id);
  saveJsonArray(STARDUST_SET_KEY, set);
  write(STARDUST_TOTAL_KEY, String(readNumber(STARDUST_TOTAL_KEY) + 1));
  write(STARDUST_BEST_KEY, String(Math.max(readNumber(STARDUST_BEST_KEY), set.size)));
  return readProgress(worlds);
}

export function unlockAchievements(ids: string[], worlds: World[]): ProgressState {
  const set = new Set(readJsonArray(ACH_KEY));
  let changed = false;
  for (const id of ids) {
    if (!set.has(id)) {
      set.add(id);
      changed = true;
    }
  }
  if (changed) saveJsonArray(ACH_KEY, set);
  return readProgress(worlds);
}

export function recordTimeTrial(ms: number, worlds: World[]): ProgressState {
  const prev = readNumber(TT_BEST_KEY);
  if (!prev || ms < prev) write(TT_BEST_KEY, String(Math.round(ms)));
  return readProgress(worlds);
}

// Hot path (per ~25 units). No ProgressState rebuild to avoid React churn.
export function addDistance(units: number): void {
  if (units <= 0) return;
  write(DISTANCE_KEY, String(Math.round(readNumber(DISTANCE_KEY) + units)));
}

export function advanceLoop(worlds: World[]): ProgressState {
  write(LOOP_KEY, String(readNumber(LOOP_KEY) + 1));
  return readProgress(worlds);
}
