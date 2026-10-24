/** A small seeded generator: the same seed always writes the same song. */
export class Rng {
  private state: number;
  constructor(readonly seed: number) {
    this.state = (seed >>> 0) ^ 0x9e3779b9;
    for (let i = 0; i < 4; i++) this.next();
  }
  /** Mulberry32: a float in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** An integer in [lo, hi]. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("rng: nothing to pick from");
    return items[Math.floor(this.next() * items.length)]!;
  }
  /** One key of `weights`, chosen in proportion to its weight. */
  weighted<K extends string>(weights: Readonly<Partial<Record<K, number>>>): K {
    const entries = Object.entries(weights) as [K, number][];
    const total = entries.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
    let roll = this.next() * total;
    for (const [key, weight] of entries) {
      roll -= Math.max(0, weight);
      if (roll < 0) return key;
    }
    return entries.at(-1)![0];
  }
  /** An index of `weights`, chosen in proportion to its weight. */
  index(weights: readonly number[]): number {
    const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
    let roll = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      roll -= Math.max(0, weights[i]!);
      if (roll < 0) return i;
    }
    return weights.length - 1;
  }
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }
  /** A child generator, so adding a draw in one place leaves the others alone. */
  fork(label: string): Rng {
    let h = 2166136261;
    for (const ch of label) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return new Rng((this.seed ^ h) >>> 0);
  }
}
