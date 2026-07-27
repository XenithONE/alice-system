import { TOP_SLOTS, type TopBuildSpec, type TopSlot } from "../types";
import { validateBuild } from "../content/build";

export const VORTEX_GARAGE_KEY = "vc.garage.v1";
export const MAX_GARAGE_BUILDS = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeValue(value: unknown): TopBuildSpec | null {
  if (!isRecord(value) || value.v !== 1 || !isRecord(value.parts)) return null;
  if (
    typeof value.name !== "string" ||
    value.name.trim().length < 1 ||
    value.name.length > 64 ||
    /[\u0000-\u001f\u007f]/u.test(value.name)
  ) {
    return null;
  }
  if (
    !Number.isSafeInteger(value.paint) ||
    (value.paint as number) < 0 ||
    (value.paint as number) > 0xffffff
  ) {
    return null;
  }
  const parts = {} as Record<TopSlot, string>;
  for (const slot of TOP_SLOTS) {
    const partId = value.parts[slot];
    if (
      typeof partId !== "string" ||
      partId.length < 1 ||
      partId.length > 96 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(partId)
    ) {
      return null;
    }
    parts[slot] = partId;
  }
  const candidate: TopBuildSpec = {
    v: 1,
    name: value.name,
    paint: value.paint as number,
    parts
  };
  return validateBuild(candidate, Number.POSITIVE_INFINITY).ok ? candidate : null;
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function fromBase64Url(code: string): string | null {
  if (
    code.length < 1 ||
    code.length > 16_384 ||
    code.length % 4 === 1 ||
    !/^[A-Za-z0-9_-]+$/u.test(code)
  ) {
    return null;
  }
  const padded = code
    .replace(/-/gu, "+")
    .replace(/_/gu, "/")
    .padEnd(Math.ceil(code.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function storage(): Storage | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

export function encodeBuild(build: TopBuildSpec): string {
  const safe = decodeValue(build);
  if (safe === null) throw new TypeError("共有できないVORTEX CROWNビルドです。");
  return toBase64Url(JSON.stringify(safe));
}

export function decodeBuild(code: string): TopBuildSpec | null {
  if (typeof code !== "string") return null;
  const json = fromBase64Url(code.trim());
  if (json === null) return null;
  try {
    return decodeValue(JSON.parse(json) as unknown);
  } catch {
    return null;
  }
}

export function loadGarage(): TopBuildSpec[] {
  try {
    const raw = storage()?.getItem(VORTEX_GARAGE_KEY);
    if (raw === null || raw === undefined || raw.length > 1_000_000) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > MAX_GARAGE_BUILDS) return [];
    const result: TopBuildSpec[] = [];
    for (const value of parsed) {
      const decoded = decodeValue(value);
      if (decoded !== null) result.push(decoded);
    }
    return result;
  } catch {
    return [];
  }
}

export function saveGarage(builds: readonly TopBuildSpec[]): void {
  try {
    const safe: TopBuildSpec[] = [];
    for (const build of builds.slice(0, MAX_GARAGE_BUILDS)) {
      const decoded = decodeValue(build);
      if (decoded !== null) safe.push(decoded);
    }
    storage()?.setItem(VORTEX_GARAGE_KEY, JSON.stringify(safe));
  } catch {
    // localStorage can be unavailable, private, or full. Saving is best effort.
  }
}

export function upsertGarageBuild(
  builds: readonly TopBuildSpec[],
  nextBuild: TopBuildSpec
): TopBuildSpec[] {
  const safe = decodeValue(nextBuild);
  if (safe === null) throw new TypeError("保存できないVORTEX CROWNビルドです。");
  const deduped = builds.filter((build) => build.name !== safe.name);
  return [safe, ...deduped].slice(0, MAX_GARAGE_BUILDS);
}

/** Compatibility aliases for callers that describe the payload as a spec. */
export const encodeSpec = encodeBuild;
export const decodeSpec = decodeBuild;
