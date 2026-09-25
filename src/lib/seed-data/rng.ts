/**
 * Deterministic PRNG. The seed must produce byte-identical data on every run —
 * that is what makes `npm run seed` idempotent and what stops the analytics
 * numbers moving between demos.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  next(): number;
  int(minInclusive: number, maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
  shuffle<T>(items: T[]): T[];
}

export function makeRng(seed: number): Rng {
  const rand = mulberry32(seed);
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min));
  return {
    next: rand,
    int,
    pick<T>(items: readonly T[]): T {
      const item = items[int(0, items.length)];
      if (item === undefined) throw new Error("pick() from an empty list");
      return item;
    },
    chance: (p: number) => rand() < p,
    shuffle<T>(items: T[]): T[] {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i + 1);
        const a = out[i]!;
        const b = out[j]!;
        out[i] = b;
        out[j] = a;
      }
      return out;
    },
  };
}
