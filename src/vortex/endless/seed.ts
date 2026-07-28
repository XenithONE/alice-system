import type { EndlessSeed } from "./types";

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function canonicalEndlessSeed(seed: EndlessSeed): number {
  if (typeof seed === "number" && Number.isFinite(seed)) {
    return Math.trunc(seed) >>> 0;
  }
  return fnv1a(String(seed));
}

/** Order-sensitive seed mixer whose output is stable across JS runtimes. */
export function mixEndlessSeed(
  seed: EndlessSeed,
  ...components: readonly (number | string)[]
): number {
  let mixed = canonicalEndlessSeed(seed) ^ 0x9e3779b9;
  for (const component of components) {
    const value =
      typeof component === "number"
        ? Math.trunc(component) >>> 0
        : fnv1a(component);
    mixed ^= value + 0x9e3779b9 + ((mixed << 6) >>> 0) + (mixed >>> 2);
    mixed = Math.imul(mixed ^ (mixed >>> 16), 0x85ebca6b);
    mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35);
    mixed ^= mixed >>> 16;
  }
  return mixed >>> 0;
}

export function deterministicId(prefix: string, seed: number): string {
  return `${prefix}-${seed.toString(36).padStart(7, "0")}`;
}

