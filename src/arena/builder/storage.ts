import type { BotSpec, MountFace, PlacedPart, Rot4 } from "../sim/types";
import { MAX_BUILD_LEVEL } from "../sim/balance";

const GARAGE_KEY = "sc.garage.v1";
const MAX_SPECS = 64;
const MAX_PARTS = 128;
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FACES = new Set<MountFace>(["deck", "underside", "left", "right", "front", "rear", "internal"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 80 && ID_RE.test(value);
}

function decodePlacedPart(value: unknown): PlacedPart | null {
  if (!isRecord(value) || !isSafeId(value.partId)) return null;
  if (!Array.isArray(value.cell) || value.cell.length !== 2) return null;
  const [x, z] = value.cell;
  const candidateRot = value.rot;
  if (
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(z) ||
    x < -64 ||
    x > 64 ||
    z < -64 ||
    z > 64
  ) {
    return null;
  }
  if (
    typeof candidateRot !== "number" ||
    !Number.isInteger(candidateRot) ||
    candidateRot < 0 ||
    candidateRot > 3
  ) {
    return null;
  }
  /*
   * The storey has to survive the round trip. Dropping it does not merely
   * flatten the machine: level is part of the occupancy key, so every part
   * lands on top of the riser that was holding it up and validateBuild
   * rejects the whole build as overlapping. A saved multi-storey machine
   * would come back unusable.
   *
   * Emitted only when non-zero so a single-storey build encodes to exactly
   * the same bytes it did before v4 and old share codes stay valid.
   */
  const candidateLevel = value.level;
  const level =
    typeof candidateLevel === "number" &&
    Number.isInteger(candidateLevel) &&
    candidateLevel > 0 &&
    candidateLevel <= MAX_BUILD_LEVEL
      ? candidateLevel
      : 0;
  const base = {
    partId: value.partId,
    face: typeof value.face === "string" && FACES.has(value.face as MountFace) ? value.face as MountFace : "deck",
    cell: [x, z] as readonly [number, number],
    rot: candidateRot as Rot4
  };
  return level > 0 ? { ...base, level } : base;
}

function decodeValue(value: unknown): BotSpec | null {
  if (!isRecord(value) || value.v !== 2 && value.v !== 3) return null;
  const candidatePaint = value.paint;
  if (
    typeof value.name !== "string" ||
    value.name.length < 1 ||
    value.name.length > 80 ||
    /[\u0000-\u001f\u007f]/u.test(value.name)
  ) {
    return null;
  }
  if (!isSafeId(value.chassisId)) return null;
  if (
    typeof candidatePaint !== "number" ||
    !Number.isSafeInteger(candidatePaint) ||
    candidatePaint < 0 ||
    candidatePaint > 0xffffff
  ) {
    return null;
  }
  if (!Array.isArray(value.parts) || value.parts.length > MAX_PARTS) return null;
  const parts: PlacedPart[] = [];
  for (const candidate of value.parts) {
    const part = decodePlacedPart(candidate);
    if (!part) return null;
    parts.push(part);
  }
  return {
    v: 3,
    name: value.name,
    chassisId: value.chassisId,
    paint: candidatePaint,
    parts
  };
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function fromBase64Url(code: string): string | null {
  if (code.length < 1 || code.length > 32_768 || !/^[A-Za-z0-9_-]+$/u.test(code)) return null;
  const padded = code.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(code.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function loadGarage(): BotSpec[] {
  try {
    const raw = localStorage.getItem(GARAGE_KEY);
    if (raw === null || raw.length > 1_000_000) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > MAX_SPECS) return [];
    const specs: BotSpec[] = [];
    for (const value of parsed) {
      const spec = decodeValue(value);
      if (spec) specs.push(spec);
    }
    return specs;
  } catch {
    return [];
  }
}

export function saveGarage(specs: BotSpec[]): void {
  try {
    const safe = specs.slice(0, MAX_SPECS).map((spec) => decodeValue(spec)).filter((spec): spec is BotSpec => spec !== null);
    localStorage.setItem(GARAGE_KEY, JSON.stringify(safe));
  } catch {
    // Storage can be unavailable or full. Saving is deliberately best-effort.
  }
}

export function encodeSpec(spec: BotSpec): string {
  const safe = decodeValue(spec);
  if (!safe) throw new TypeError("BotSpec が不正です。");
  return toBase64Url(JSON.stringify(safe));
}

export function decodeSpec(code: string): BotSpec | null {
  if (typeof code !== "string") return null;
  const json = fromBase64Url(code.trim());
  if (json === null) return null;
  try {
    return decodeValue(JSON.parse(json) as unknown);
  } catch {
    return null;
  }
}
