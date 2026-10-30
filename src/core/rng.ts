/**
 * Deterministic, fast PRNG (mulberry32). Seeded so a level can be replayed
 * exactly — handy for tests and for the "retry level" flow.
 */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [0, n). */
  int(n: number): number;
  /** Integer in [min, max] inclusive. */
  range(min: number, max: number): number;
  /** Float in [min, max). */
  float(min: number, max: number): number;
  /** Uniform element pick. */
  pick<T>(items: readonly T[]): T;
  /** Weighted element pick; weights need not sum to 1. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
  /** In-place Fisher-Yates. */
  shuffle<T>(items: T[]): T[];
  chance(p: number): boolean;
  readonly seed: number;
}

export function createRng(seed = (Math.random() * 0xffffffff) >>> 0): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (n: number): number => {
    if (n <= 0) return 0;
    const v = Math.floor(next() * n);
    return Math.min(n - 1, Math.max(0, v));
  };

  return {
    next,
    int,
    range: (min, max) => min + int(max - min + 1),
    float: (min, max) => min + next() * (max - min),
    pick: (items) => items[int(items.length)] as (typeof items)[number],
    weighted: (items, weights) => {
      let total = 0;
      for (const w of weights) total += w;
      let r = next() * total;
      for (let i = 0; i < items.length; i++) {
        r -= weights[i] as number;
        if (r < 0) return items[i] as (typeof items)[number];
      }
      return items[items.length - 1] as (typeof items)[number];
    },
    shuffle: <T>(items: T[]): T[] => {
      for (let i = items.length - 1; i > 0; i--) {
        const j = int(i + 1);
        const tmp = items[i] as T;
        items[i] = items[j] as T;
        items[j] = tmp;
      }
      return items;
    },
    chance: (p) => next() < p,
    seed,
  };
}
