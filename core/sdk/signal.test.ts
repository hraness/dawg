import { describe, expect, test } from "bun:test";
import {
  bakeSignal,
  cosine,
  irand,
  isaw,
  pat,
  perlin,
  rand,
  saw,
  signalAt,
  signalFromData,
  signalSeed,
  sine,
  square,
  tri,
  type PatternSignal,
} from "./v1.ts";

// Strudel's documented formulas (packages/core/signal.mjs, legacy RNG),
// written out here independently of the SDK's implementation.
const mod = (n: number, m: number) => ((n % m) + m) % m;
const strudel = {
  saw: (t: number) => mod(t, 1),
  isaw: (t: number) => 1 - mod(t, 1),
  sine: (t: number) => (Math.sin(Math.PI * 2 * t) + 1) / 2,
  cosine: (t: number) => (Math.sin(Math.PI * 2 * (t + 0.25)) + 1) / 2,
  square: (t: number) => Math.floor(mod(t * 2, 2)),
  // fastcat(saw, isaw): each half squeezes a whole cycle of its signal.
  tri: (t: number) => {
    const c = Math.floor(t);
    const local = (t - c) * 2;
    return local < 1 ? mod(c + local, 1) : 1 - mod(c + local - 1, 1);
  },
  rand: (t: number) => {
    const xorwise = (x: number) => {
      const a = (x << 13) ^ x;
      const b = (a >> 17) ^ a;
      return (b << 5) ^ b;
    };
    const frac = (x: number) => x - Math.trunc(x);
    const seed = xorwise(Math.trunc(frac(t / 300) * 536870912));
    return Math.abs((seed % 536870912) / 536870912);
  },
  perlin: (t: number) => {
    const ta = Math.floor(t);
    const x = t - ta;
    const smoother = 6 * x ** 5 - 15 * x ** 4 + 10 * x ** 3;
    const a = strudel.rand(ta);
    return a + smoother * (strudel.rand(ta + 1) - a);
  },
};

const CYCLES = [0, 0.1, 0.25, 0.4, 0.5, 0.625, 0.75, 0.9, 1, 1.3, 2.75, 7.2];

describe("continuous signals match Strudel", () => {
  const cases: [string, PatternSignal, (t: number) => number][] = [
    ["saw", saw, strudel.saw],
    ["isaw", isaw, strudel.isaw],
    ["sine", sine, strudel.sine],
    ["cosine", cosine, strudel.cosine],
    ["square", square, strudel.square],
    ["tri", tri, strudel.tri],
    ["rand", rand, strudel.rand],
    ["perlin", perlin, strudel.perlin],
  ];
  for (const [name, signal, formula] of cases)
    test(`${name} at fixed cycles`, () => {
      for (const t of CYCLES)
        expect(signalAt(signal, t)).toBeCloseTo(formula(t), 12);
    });

  test("a few values by hand", () => {
    expect(signalAt(sine, 0)).toBeCloseTo(0.5, 12);
    expect(signalAt(sine, 0.25)).toBeCloseTo(1, 12);
    expect(signalAt(cosine, 0)).toBeCloseTo(1, 12);
    expect(signalAt(saw, 0.75)).toBe(0.75);
    expect(signalAt(square, 0.49)).toBe(0);
    expect(signalAt(square, 0.5)).toBe(1);
    expect(signalAt(tri, 0.25)).toBe(0.5);
    expect(signalAt(tri, 0.5)).toBe(1);
  });

  test("irand(n) is trunc(rand · n)", () => {
    for (const t of CYCLES)
      expect(signalAt(irand(8), t)).toBe(Math.trunc(strudel.rand(t) * 8));
  });
});

describe("transforms follow Strudel's definitions", () => {
  test("range, rangex, slow, fast, early, late", () => {
    for (const t of CYCLES) {
      expect(signalAt(sine.range(200, 800), t)).toBeCloseTo(
        strudel.sine(t) * 600 + 200,
        9,
      );
      const lo = Math.log(100);
      expect(signalAt(saw.rangex(100, 10000), t)).toBeCloseTo(
        Math.exp(strudel.saw(t) * (Math.log(10000) - lo) + lo),
        6,
      );
      expect(signalAt(sine.slow(4), t)).toBeCloseTo(strudel.sine(t / 4), 12);
      expect(signalAt(sine.fast(2), t)).toBeCloseTo(strudel.sine(t * 2), 12);
      expect(signalAt(saw.early(0.25), t)).toBeCloseTo(
        strudel.saw(t + 0.25),
        12,
      );
      expect(signalAt(saw.late(0.25), t)).toBeCloseTo(
        strudel.saw(t - 0.25),
        12,
      );
    }
  });

  test("segment samples each segment at its start; add and mul combine", () => {
    expect(signalAt(saw.segment(4), 0.3)).toBe(0.25);
    expect(signalAt(saw.segment(4), 0.99)).toBe(0.75);
    expect(signalAt(saw.add(0.5), 0.25)).toBe(0.75);
    expect(signalAt(saw.mul(2), 0.25)).toBe(0.5);
    expect(signalAt(saw.add(sine), 0.25)).toBeCloseTo(1.25, 12);
    // A range on top of a sum maps the sum.
    expect(signalAt(saw.add(0.5).range(0, 10), 0.25)).toBeCloseTo(7.5, 12);
  });

  test("every(n, f) applies f on bars 0, n, 2n, …", () => {
    const s = saw.every(2, (x) => x.fast(2));
    expect(signalAt(s, 0.25)).toBe(0.5);
    expect(signalAt(s, 1.25)).toBe(0.25);
    expect(signalAt(s, 2.25)).toBe(0.5);
  });

  test("pat() reads mini-notation as stepped numbers", () => {
    const p = pat("0 0.5 1");
    expect([0, 0.34, 0.67, 1.1].map((t) => signalAt(p, t))).toEqual([
      0, 0.5, 1, 0,
    ]);
    const alt = pat("<1 2> [3 4]");
    expect([0, 0.5, 0.75, 1, 1.5].map((t) => signalAt(alt, t))).toEqual([
      1, 3, 4, 2, 3,
    ]);
    expect(signalAt(pat("1*2 5"), 0.3)).toBe(1);
    expect(signalAt(pat("1!2 5"), 0.5)).toBe(1);
    expect(signalAt(pat("1!2 5"), 0.7)).toBe(5);
    expect(() => pat("0 [1")).toThrow();
  });
});

describe("seeded randomness", () => {
  test("a seed shifts rand in time, as Strudel's legacy randSeed", () => {
    for (const t of CYCLES) {
      expect(signalAt(rand, t, 7)).toBe(strudel.rand(t + 7));
      expect(signalAt(rand, t, 7)).toBe(signalAt(rand, t, 7));
    }
  });

  test("a track's seed is stable and differs between tracks", () => {
    expect(signalSeed("bass")).toBe(signalSeed("bass"));
    expect(signalSeed("bass")).not.toBe(signalSeed("keys"));
    expect(Number.isInteger(signalSeed("bass"))).toBe(true);
    expect(signalSeed("bass")).toBeGreaterThanOrEqual(0);
    expect(signalSeed("bass")).toBeLessThan(300);
    const lane = (id: string) =>
      bakeSignal(rand, { bars: 2, ticksPerBar: 1920, seed: signalSeed(id) });
    expect(lane("bass")).toEqual(lane("bass"));
    expect(lane("bass")).not.toEqual(lane("keys"));
  });
});

describe("signals are plain data", () => {
  test("a signal survives JSON and rebuilds to the same values", () => {
    const s = sine
      .range(300, 2400)
      .slow(4)
      .add(pat("0 100"))
      .every(2, (x) => x.fast(2));
    const back = signalFromData(JSON.parse(JSON.stringify(s)));
    expect(JSON.stringify(back)).toBe(JSON.stringify(s));
    for (const t of CYCLES) expect(signalAt(back, t)).toBe(signalAt(s, t));
  });

  test("bakeSignal ramps continuous signals and steps stepped ones", () => {
    const ramp = bakeSignal(saw, { bars: 1, ticksPerBar: 1600, seed: 0 });
    expect(ramp.length).toBe(16);
    expect(ramp[1]).toEqual({ tick: 100, value: 0.0625 });
    const steps = bakeSignal(pat("0 1"), {
      bars: 1,
      ticksPerBar: 1600,
      seed: 0,
    });
    expect(steps).toEqual([
      { tick: 0, value: 0 },
      { tick: 799, value: 0 },
      { tick: 800, value: 1 },
    ]);
  });
});
