import { describe, expect, test } from "bun:test";
import {
  gainToDb,
  integratedLoudness,
  measureLoudness,
  measureMix,
  pcmChannels,
  truePeakGain,
} from "./loudness.ts";

const RATE = 48_000;

/** Stereo 1 kHz tone, phase-continuous across `[dBFS, seconds]` parts. */
function tone(parts: readonly (readonly [number, number])[], rate = RATE) {
  const total = parts.reduce((sum, [, seconds]) => sum + seconds, 0);
  const n = Math.round(total * rate);
  const left = new Float64Array(n);
  let index = 0;
  let elapsed = 0;
  for (const [dbfs, seconds] of parts) {
    elapsed += seconds;
    const stop = Math.round(elapsed * rate);
    const amplitude = 10 ** (dbfs / 20);
    for (; index < stop; index += 1)
      left[index] = amplitude * Math.sin((2 * Math.PI * 1000 * index) / rate);
  }
  return [left, Float64Array.from(left)] as const;
}

function sine(frequency: number, amplitude: number, degrees: number) {
  const left = new Float64Array(RATE);
  for (let index = 0; index < RATE; index += 1)
    left[index] =
      amplitude *
      Math.sin(
        (2 * Math.PI * frequency * index) / RATE + (degrees * Math.PI) / 180,
      );
  return [left, Float64Array.from(left)] as const;
}

function repeat(
  parts: readonly (readonly [number, number])[],
  times: number,
): (readonly [number, number])[] {
  return Array.from({ length: times }, () => parts).flat();
}

describe("loudness: EBU Tech 3341 minimum requirements", () => {
  test("cases 1 and 2: a steady tone reads its level in M, S and I", () => {
    for (const level of [-23, -33]) {
      const [left, right] = tone([[level, 20]]);
      const measured = measureLoudness(left, right, RATE);
      expect(measured.integrated).toBeCloseTo(level, 1);
      expect(Math.abs(measured.momentaryMax - level)).toBeLessThan(0.1);
      expect(Math.abs(measured.shortTermMax - level)).toBeLessThan(0.1);
    }
  });

  test("cases 3 to 5: gating ignores quiet passages", () => {
    const cases: (readonly [number, number])[][] = [
      [
        [-36, 10],
        [-23, 60],
        [-36, 10],
      ],
      [
        [-72, 10],
        [-36, 10],
        [-23, 60],
        [-36, 10],
        [-72, 10],
      ],
      [
        [-26, 20],
        [-20, 20.1],
        [-26, 20],
      ],
    ];
    for (const parts of cases) {
      const [left, right] = tone(parts);
      expect(
        Math.abs(integratedLoudness(left, right, RATE) - -23),
      ).toBeLessThan(0.1);
    }
  });

  test("case 9: short-term loudness holds -23 after 3 s", () => {
    const [left, right] = tone(
      repeat(
        [
          [-20, 1.34],
          [-30, 1.66],
        ],
        20,
      ),
    );
    const { shortTerm, step } = measureLoudness(left, right, RATE, {
      truePeak: false,
    });
    const settled = [...shortTerm].slice(Math.round(3 / step) - 1);
    expect(settled.length).toBeGreaterThan(500);
    for (const value of settled)
      expect(Math.abs(value - -23)).toBeLessThan(0.1);
  });

  test("case 12: momentary loudness holds -23 after 1 s", () => {
    const [left, right] = tone(
      repeat(
        [
          [-20, 0.18],
          [-30, 0.22],
        ],
        25,
      ),
    );
    const { momentary, step } = measureLoudness(left, right, RATE, {
      truePeak: false,
    });
    const settled = [...momentary].slice(Math.round(1 / step) - 1);
    expect(settled.length).toBeGreaterThan(80);
    for (const value of settled)
      expect(Math.abs(value - -23)).toBeLessThan(0.1);
  });

  // Cases 10 and 13: a burst at -23 dBFS (3 s for S, 0.4 s for M) after
  // i x 20 ms of silence and before 1 s of silence; every offset must read
  // max -23 +/- 0.1, which a 100 ms update grid misses.
  for (const [name, seconds, key] of [
    ["case 10: max short-term", 3, "shortTermMax"],
    ["case 13: max momentary", 0.4, "momentaryMax"],
  ] as const)
    test(`${name} reads -23 at every 20 ms offset`, () => {
      for (let i = 1; i <= 20; i += 1) {
        const [left, right] = tone([
          [-200, i * 0.02],
          [-23, seconds],
          [-200, 1],
        ]);
        const measured = measureLoudness(left, right, RATE, {
          truePeak: false,
        });
        expect(Math.abs(measured[key] - -23)).toBeLessThan(0.1);
      }
    });

  // Modelled on cases 11 and 14: sequential bursts at shifting offsets in
  // one file; the maximum is the loudest burst wherever it falls.
  for (const [name, seconds, key] of [
    ["case 11: max short-term", 3, "shortTermMax"],
    ["case 14: max momentary", 0.4, "momentaryMax"],
  ] as const)
    test(`${name} finds the loudest of sequential bursts`, () => {
      const parts: (readonly [number, number])[] = [];
      for (let i = 1; i <= 20; i += 1)
        parts.push([-200, 0.5 + i * 0.013], [i === 13 ? -23 : -33, seconds]);
      parts.push([-200, 1]);
      const [left, right] = tone(parts);
      const measured = measureLoudness(left, right, RATE, { truePeak: false });
      expect(Math.abs(measured[key] - -23)).toBeLessThan(0.1);
    });

  test("cases 15 to 19: true peak within +0.2 / -0.4 dB", () => {
    const cases = [
      [RATE / 4, 0.5, 0, -6],
      [RATE / 4, 0.5, 45, -6],
      [RATE / 6, 0.5, 60, -6],
      [RATE / 8, 0.5, 67.5, -6],
      [RATE / 4, 1.41, 45, 3],
    ] as const;
    for (const [frequency, amplitude, degrees, expected] of cases) {
      const [left, right] = sine(frequency, amplitude, degrees);
      // A loop measures the steady tone, as the standard's long files do.
      const peak = gainToDb(truePeakGain(left, right, true));
      expect(peak).toBeGreaterThanOrEqual(expected - 0.4);
      expect(peak).toBeLessThanOrEqual(expected + 0.2);
    }
  });

  test("a sample-peak meter would fail case 16", () => {
    const [left] = sine(RATE / 4, 0.5, 45);
    let peak = 0;
    for (const value of left) peak = Math.max(peak, Math.abs(value));
    expect(gainToDb(peak)).toBeCloseTo(-9.03, 1);
  });

  test("K-weighting holds at 44.1 kHz too", () => {
    const [left, right] = tone([[-23, 20]], 44_100);
    expect(integratedLoudness(left, right, 44_100)).toBeCloseTo(-23, 1);
  });
});

describe("loudness: EBU Tech 3342 loudness range", () => {
  const cases: [number, (readonly [number, number])[]][] = [
    [
      10,
      [
        [-20, 20],
        [-30, 20],
      ],
    ],
    [
      5,
      [
        [-20, 20],
        [-15, 20],
      ],
    ],
    [
      20,
      [
        [-40, 20],
        [-20, 20],
      ],
    ],
    [
      15,
      [
        [-50, 20],
        [-35, 20],
        [-20, 20],
        [-35, 20],
        [-50, 20],
      ],
    ],
  ];
  for (const [index, [expected, parts]] of cases.entries())
    test(`case ${index + 1}: LRA ${expected} LU within 1 LU`, () => {
      const [left, right] = tone(parts);
      const { range } = measureLoudness(left, right, RATE, { truePeak: false });
      expect(Math.abs(range - expected)).toBeLessThan(1);
    });
});

describe("loudness: loops and mixes", () => {
  test("a loop is measured as if it played forever", () => {
    // 0.25 s is shorter than a momentary block; as a loop it still reads.
    const [left, right] = tone([[-23, 0.25]]);
    expect(integratedLoudness(left, right, RATE)).toBe(-Infinity);
    expect(integratedLoudness(left, right, RATE, true)).toBeCloseTo(-23, 1);
  });

  test("silence is -Infinity and gated, not NaN", () => {
    const silent = new Float64Array(RATE);
    const measured = measureLoudness(silent, silent, RATE);
    expect(measured.integrated).toBe(-Infinity);
    expect(measured.truePeak).toBe(-Infinity);
    expect(measured.range).toBe(0);
  });

  test("measureMix reports bands, correlation and side level", () => {
    const [left, right] = tone([[-20, 2]]);
    const mono = measureMix(left, right, RATE);
    expect(mono.correlation).toBeCloseTo(1, 3);
    expect(mono.sideDb).toBe(-Infinity);
    const loudest = Object.entries(mono.bands).sort((a, b) => b[1] - a[1])[0]!;
    expect(loudest[0]).toBe("low-mid");
    expect(mono.plr).toBeCloseTo(
      mono.loudness.truePeak - mono.loudness.integrated,
      6,
    );
    const inverted = right.map((value) => -value);
    expect(measureMix(left, inverted, RATE).correlation).toBeCloseTo(-1, 3);
  });

  test("pcmChannels de-interleaves 16-bit PCM", () => {
    const [left, right] = pcmChannels(Int16Array.from([32767, -32767, 0, 1]));
    expect([...left]).toEqual([1, 0]);
    expect(right[0]).toBe(-1);
  });
});
