import { SIGNAL_FRAGMENTS, type FragmentId, type World } from "../data/worlds";

const FRAG_KEY = "alice_eidolon";
const ACCORD_KEY = "alice_accord";
const TRUE_KEY = "alice_true";
const SEVEN_KEY = "alice_seven";
const VISITS_KEY = "alice_visits";
const HIDDEN_PLANET_KEY = "alice_planet_hint";

export interface ProgressState {
  fragments: Set<FragmentId>;
  accord: boolean;
  trueEnding: boolean;
  sevenWorlds: Set<string>;
  visits: number;
  hiddenPlanet: boolean;
  completedWorlds: Set<string>;
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
  const version = [
    [...fragments].sort().join(","),
    [...completedWorlds].sort().join(","),
    [...sevenWorlds].sort().join(","),
    accord ? "a" : "x",
    trueEnding ? "t" : "x",
    hiddenPlanet ? "h" : "x",
    visits
  ].join("|");

  return { fragments, accord, trueEnding, sevenWorlds, visits, hiddenPlanet, completedWorlds, version };
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
