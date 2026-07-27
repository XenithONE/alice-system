export interface SeededRng {
  (): number;
  int(maxExclusive: number): number;
  range(min: number, max: number): number;
}

export function mulberry32(seed: number): SeededRng {
  let state = seed >>> 0;
  const rng = (() => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }) as SeededRng;
  rng.int = (maxExclusive: number): number =>
    Math.floor(rng() * Math.max(1, Math.floor(maxExclusive)));
  rng.range = (min: number, max: number): number => min + (max - min) * rng();
  return rng;
}
