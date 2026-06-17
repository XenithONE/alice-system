// Deterministic seeding for daily / NG+ variation of stardust + ring placement.
// Shared by storage, engine, and tests so layouts are reproducible per (day, loop).

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function dayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Varies by calendar day (daily remix) and by NG+ loop; salt separates subsystems.
export function dailySeed(loop: number, salt = 0): number {
  return (hashStr(dayKey()) ^ Math.imul(loop + 1, 0x9e3779b1) ^ salt) >>> 0;
}
