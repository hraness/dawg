/**
 * Seeded property-test helpers: a mulberry32 PRNG, small pickers and a case
 * runner. `DAWG_FUZZ=N` raises the case count and `DAWG_SEED=S` replays a
 * failing seed; a failure names its seed.
 */

export type Rng = Readonly<{
  /** Uniform in [0, 1). */
  next(): number;
  /** Integer in [lo, hi]. */
  int(lo: number, hi: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
}>;

export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number): number =>
    lo + Math.floor(next() * (hi - lo + 1));
  return Object.freeze({
    next,
    int,
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error("pick from an empty list");
      return items[int(0, items.length - 1)]!;
    },
    chance: (p: number) => next() < p,
  });
}

/** Case count: `DAWG_FUZZ` when set, else `fallback`. */
export function caseCount(fallback: number): number {
  const raw = Number(process.env.DAWG_FUZZ);
  return Number.isInteger(raw) && raw > 0 ? raw : fallback;
}

/**
 * Runs `body` once per seed (`base`, `base + 1`, ...), or only for
 * `DAWG_SEED`. A thrown error is rethrown with its seed attached.
 */
export function forAllSeeds(
  base: number,
  cases: number,
  body: (rng: Rng, seed: number) => void,
): void {
  const fixed = Number(process.env.DAWG_SEED);
  const seeds = Number.isInteger(fixed)
    ? [fixed]
    : Array.from({ length: cases }, (_, index) => base + index);
  for (const seed of seeds) {
    try {
      body(mulberry32(seed), seed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`property failed at DAWG_SEED=${seed}: ${message}`, {
        cause: error,
      });
    }
  }
}
