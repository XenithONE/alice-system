/**
 * Liveries. Eight karts have to be told apart at 40 m/s from behind, in a
 * mirror, and as three pixels on the minimap — so hue separation matters more
 * than prettiness, and every pair is at least 40° apart on the wheel.
 */

export interface Livery {
  readonly name: string;
  /** Body paint. */
  readonly body: number;
  /** Secondary panels and the spoiler. */
  readonly trim: number;
  /** Driver suit and helmet. */
  readonly suit: number;
  /** Minimap dot and HUD accent — the brightest reading of the body colour. */
  readonly signal: number;
}

export const LIVERIES: readonly Livery[] = [
  { name: "CRIMSON", body: 0xe23b3b, trim: 0x2b1414, suit: 0xffd9d0, signal: 0xff5a5a },
  { name: "AZURE", body: 0x2f7fe0, trim: 0x101f38, suit: 0xd6ecff, signal: 0x4da2ff },
  { name: "LIME", body: 0x54c23a, trim: 0x12280f, suit: 0xe6ffd8, signal: 0x76e85a },
  { name: "AMBER", body: 0xf0a220, trim: 0x3a2405, suit: 0xfff0d0, signal: 0xffc247 },
  { name: "VIOLET", body: 0x9350e0, trim: 0x22103c, suit: 0xefe0ff, signal: 0xb579ff },
  { name: "TEAL", body: 0x1fb8b0, trim: 0x0a2b29, suit: 0xd9fffb, signal: 0x3fe2d8 },
  { name: "ROSE", body: 0xec5aa6, trim: 0x3a0f26, suit: 0xffe2f0, signal: 0xff7ec0 },
  { name: "SLATE", body: 0xb9c3cc, trim: 0x232a30, suit: 0xf2f6fa, signal: 0xdfe8f0 },
];

export function liveryOf(index: number): Livery {
  return LIVERIES[((index % LIVERIES.length) + LIVERIES.length) % LIVERIES.length]!;
}

/** Drift charge colours — the same three the sparks and the HUD both use. */
export const DRIFT_TIER_COLORS: readonly number[] = [
  0xbfd4e8, // charging, no tier yet
  0x35a7ff, // blue
  0xff9c1a, // orange
  0xff3bd0, // purple
];

export const BOOST_FLAME_COLORS: Readonly<Record<string, number>> = {
  mini: 0x6fd8ff,
  mushroom: 0xffb347,
  pad: 0x39f2c0,
  rocket: 0xffe66b,
  star: 0xfff3a0,
};
