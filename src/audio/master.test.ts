import { describe, expect, test } from "bun:test";
import { normalizeMaster, type SongMaster } from "../../core/master.ts";
import { createScore } from "../../core/score.ts";
import {
  gainToDb,
  integratedLoudness,
  measureMix,
  truePeakGain,
} from "./loudness.ts";
import { applyMaster, seekTarget } from "./master.ts";
import { renderScorePcm, StemRenderer } from "./wav.ts";

const RATE = 48_000;

const master = (input: Record<string, unknown>): SongMaster =>
  normalizeMaster(input)!;

function sine(
  frequency: number,
  dbfs: number,
  seconds: number,
  sign = 1,
): readonly [Float64Array, Float64Array] {
  const n = Math.round(seconds * RATE);
  const left = new Float64Array(n);
  const amplitude = 10 ** (dbfs / 20);
  for (let index = 0; index < n; index += 1)
    left[index] =
      amplitude * Math.sin((2 * Math.PI * frequency * index) / RATE);
  return [left, left.map((value) => value * sign)];
}

/** Four bars of seeded kick, hat and bass: peaky, like a real mix. */
function beat(): readonly [Float64Array, Float64Array] {
  const n = 4 * RATE;
  const left = new Float64Array(n);
  const right = new Float64Array(n);
  let seed = 7;
  const random = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648 - 0.5;
  };
  for (let index = 0; index < n; index += 1) {
    const t = (index % (RATE / 2)) / RATE;
    const kick =
      0.8 *
      Math.exp(-t * 18) *
      Math.sin(2 * Math.PI * 55 * t * (1 + Math.exp(-t * 40)));
    const hatT = (index % (RATE / 4)) / RATE;
    const hat = 0.3 * Math.exp(-hatT * 90) * random();
    const bass = 0.15 * Math.sin((2 * Math.PI * 110 * index) / RATE);
    left[index] = kick + hat + bass;
    right[index] = kick - hat * 0.5 + bass;
  }
  return [left, right];
}

function rmsDb(channel: Float64Array, from = 0): number {
  let sum = 0;
  for (let index = from; index < channel.length; index += 1)
    sum += channel[index]! ** 2;
  return 10 * Math.log10(sum / (channel.length - from));
}

describe("song master: bypass", () => {
  test("no master, or an empty one, leaves the mix alone", () => {
    const [left, right] = sine(1000, -20, 1);
    expect(applyMaster(left, right, left.length, RATE, undefined, false)).toBe(
      undefined,
    );
    expect(normalizeMaster({})).toBe(undefined);
  });

  test("a render without a master carries no report", () => {
    const score = createScore({ tempoBpm: 120, bars: 1 });
    expect(renderScorePcm(score).master).toBe(undefined);
  });
});

describe("song master: loudness targets", () => {
  test("a target alone is a static gain, capped at -1 dBTP", () => {
    const [left, right] = sine(1000, -30, 4);
    const out = applyMaster(
      left,
      right,
      left.length,
      RATE,
      master({ target: -14 }),
      true,
    )!;
    expect(out.report.integrated).toBeCloseTo(-14, 1);
    expect(out.report.reached).toBe(true);
    expect(out.report.gainDb).toBeCloseTo(16, 1);
    // A spike leaves no headroom: the gain stops at the safe ceiling.
    left[1000] = 0.5;
    const capped = applyMaster(
      left,
      right,
      left.length,
      RATE,
      master({ target: -14 }),
      true,
    )!;
    expect(capped.report.truePeak).toBeLessThanOrEqual(-1 + 1e-9);
    expect(capped.report.reached).toBe(false);
  });

  for (const target of [-14, -8, -6])
    test(`the limiter drives a mix to ${target} LUFS under its ceiling`, () => {
      const [left, right] = beat();
      const out = applyMaster(
        left,
        right,
        left.length,
        RATE,
        master({ limiter: { ceiling: -1 }, target }),
        true,
      )!;
      expect(Math.abs(out.report.integrated - target)).toBeLessThan(0.5);
      expect(out.report.reached).toBe(true);
      expect(
        gainToDb(truePeakGain(out.left, out.right, true)),
      ).toBeLessThanOrEqual(-1 + 1e-9);
    });

  test("quiet targets turn the mix down", () => {
    const [left, right] = beat();
    const out = applyMaster(
      left,
      right,
      left.length,
      RATE,
      master({ target: -23 }),
      true,
    )!;
    expect(out.report.gainDb).toBeLessThan(0);
    expect(out.report.integrated).toBeCloseTo(-23, 1);
  });

  test("seekTarget converges on a compressive curve", () => {
    // Loudness that gains only half a dB per dB of drive past -10.
    const curve = (gain: number) => {
      const raw = -20 + gain;
      return raw < -10 ? raw : -10 + (raw + 10) / 2;
    };
    const gain = seekTarget(-6, 14, curve);
    expect(Math.abs(curve(gain) - -6)).toBeLessThan(0.05);
  });
});

describe("song master: units", () => {
  test("eq: a bell boosts its centre by its gain", () => {
    const [left, right] = sine(1000, -20, 0.5);
    const out = applyMaster(
      left,
      right,
      left.length,
      RATE,
      master({ eq: { bell1: 6, bell1freq: 1000, bell1q: 1 } }),
      true,
    )!;
    expect(rmsDb(out.left) - rmsDb(left)).toBeCloseTo(6, 1);
  });

  test("glue: compresses above threshold; mix 0 is dry", () => {
    const [left, right] = sine(1000, -6, 1);
    const glue = {
      threshold: -24,
      ratio: 4,
      attack: 1,
      release: 50,
      auto: false,
    };
    const squeezed = applyMaster(
      left,
      right,
      left.length,
      RATE,
      master({ glue }),
      true,
    )!;
    expect(rmsDb(squeezed.left) - rmsDb(left)).toBeLessThan(-6);
    const dry = applyMaster(
      left,
      right,
      left.length,
      RATE,
      master({ glue: { ...glue, mix: 0 } }),
      true,
    )!;
    expect(rmsDb(dry.left) - rmsDb(left)).toBeCloseTo(0, 6);
  });

  test("glue: auto make-up keeps on/off near level-matched", () => {
    const [left, right] = sine(1000, -6, 1);
    const out = applyMaster(
      left,
      right,
      left.length,
      RATE,
      master({ glue: {} }),
      true,
    )!;
    expect(Math.abs(rmsDb(out.left) - rmsDb(left))).toBeLessThan(3);
  });

  test("tape: quiet parts come up, peaks stay at full scale, no DC", () => {
    const [left, right] = sine(220, -20, 1);
    const out = applyMaster(
      left,
      right,
      left.length,
      RATE,
      master({ tape: { drive: 12, bias: 0.3 } }),
      true,
    )!;
    expect(rmsDb(out.left)).toBeGreaterThan(rmsDb(left) + 3);
    let mean = 0;
    for (const value of out.left) mean += value / out.left.length;
    expect(Math.abs(mean)).toBeLessThan(1e-3);
    const [loud] = sine(220, 0, 1);
    const hot = applyMaster(
      loud,
      loud,
      loud.length,
      RATE,
      master({ tape: { drive: 12 } }),
      true,
    )!;
    let peak = 0;
    for (const value of hot.left) peak = Math.max(peak, Math.abs(value));
    expect(peak).toBeLessThan(1.05);
  });

  for (const mix of [0, 1]) {
    test(`tape at drive 0 and bias 0 is flat to 16 kHz (mix ${mix})`, () => {
      const chain = master({
        tape: { drive: 0, bias: 0, tone: 20_000, mix },
      });
      const gainAt = (frequency: number) => {
        const [left, right] = sine(frequency, -20, 0.5);
        const out = applyMaster(left, right, left.length, RATE, chain, true)!;
        return rmsDb(out.left, 2_400) - rmsDb(left, 2_400);
      };
      const reference = gainAt(1_000);
      for (const frequency of [5_000, 8_000, 12_000, 16_000])
        expect(Math.abs(gainAt(frequency) - reference)).toBeLessThan(0.5);
    });
  }

  test("width: 0 folds to mono; mono bass removes side below the cutoff", () => {
    const [left, right] = beat();
    const mono = applyMaster(
      left,
      right,
      left.length,
      RATE,
      master({ width: { width: 0 } }),
      true,
    )!;
    expect(measureMix(mono.left, mono.right, RATE).correlation).toBeCloseTo(
      1,
      6,
    );
    // 50 Hz entirely in the side channel (left = -right).
    const [bassL, bassR] = sine(50, -12, 1, -1);
    const out = applyMaster(
      bassL,
      bassR,
      bassL.length,
      RATE,
      master({ width: { mono: 150 } }),
      true,
    )!;
    expect(rmsDb(out.left) - rmsDb(bassL)).toBeLessThan(-30);
    // Above the cutoff the side passes at its level.
    const [highL, highR] = sine(2000, -12, 1, -1);
    const kept = applyMaster(
      highL,
      highR,
      highL.length,
      RATE,
      master({ width: { mono: 150 } }),
      true,
    )!;
    expect(rmsDb(kept.left) - rmsDb(highL)).toBeCloseTo(0, 1);
  });

  test("limiter: true peaks stay under the ceiling with heavy drive", () => {
    for (const [left, right] of [beat(), sine(11_000, -3, 0.5)]) {
      const out = applyMaster(
        left,
        right,
        left.length,
        RATE,
        master({
          limiter: { ceiling: -1, gain: 18, release: 20, lookahead: 1 },
        }),
        false,
      )!;
      expect(gainToDb(truePeakGain(out.left, out.right))).toBeLessThanOrEqual(
        -1 + 1e-9,
      );
      expect(integratedLoudness(out.left, out.right, RATE)).toBeGreaterThan(
        integratedLoudness(left, right, RATE),
      );
    }
  });
});

describe("song master: determinism and loops", () => {
  test("the same mix masters to the same samples", () => {
    const [left, right] = beat();
    const chain = master({
      eq: { low: 2, high: 1.5 },
      glue: { threshold: -20, ratio: 4 },
      tape: { drive: 6 },
      width: { width: 1.2, mono: 120 },
      limiter: { ceiling: -0.3 },
      target: -8,
    });
    const a = applyMaster(left, right, left.length, RATE, chain, true)!;
    const b = applyMaster(left, right, left.length, RATE, chain, true)!;
    expect(Buffer.from(a.left.buffer).equals(Buffer.from(b.left.buffer))).toBe(
      true,
    );
    expect(a.report).toEqual(b.report);
  });

  test("a loop is in steady state from its first sample", () => {
    // 1 kHz repeats every 48 samples at 48 kHz.
    const [left, right] = sine(1000, -12, 0.25);
    const chain = master({ eq: { low: 6, bell1: -4, bell1freq: 900 } });
    const loop = applyMaster(left, right, left.length, RATE, chain, true)!;
    const once = applyMaster(left, right, left.length, RATE, chain, false)!;
    expect(Math.abs(loop.left[0]! - loop.left[48]!)).toBeLessThan(1e-9);
    expect(Math.abs(once.left[0]! - once.left[48]!)).toBeGreaterThan(1e-6);
  });

  test("a song with a master renders mastered, with a report", () => {
    const score = createScore({
      tempoBpm: 120,
      bars: 1,
      tracks: [{ id: "a", name: "a", instrument: "saw" }],
      notes: [
        {
          id: "n",
          trackId: "a",
          pitch: 48,
          startTick: 0,
          durationTicks: 960,
          velocity: 0.5,
        },
      ],
    });
    const plain = renderScorePcm(score, { loop: true });
    const loud = renderScorePcm(
      score.withMaster({ limiter: { ceiling: -1 }, target: -9 } as SongMaster),
      { loop: true },
    );
    expect(loud.master?.reached).toBe(true);
    expect(loud.frames).toBe(plain.frames);
    expect(
      Buffer.from(loud.pcm.buffer).equals(Buffer.from(plain.pcm.buffer)),
    ).toBe(false);
  });
});

describe("song master: loop seam", () => {
  /** Half a second of quiet pad with a loud click in its last 2 ms. */
  function seamMix(): readonly [Float64Array, Float64Array] {
    const n = RATE / 2;
    const left = new Float64Array(n);
    for (let index = 0; index < n; index += 1)
      left[index] = 0.1 * Math.sin((2 * Math.PI * 220 * index) / RATE);
    for (let index = n - 96; index < n; index += 1)
      left[index] = index % 2 === 0 ? 0.95 : -0.95;
    return [left, left.slice()];
  }
  const doubled = (channel: Float64Array) => {
    const out = new Float64Array(channel.length * 2);
    out.set(channel);
    out.set(channel, channel.length);
    return out;
  };
  const maxDiff = (a: Float64Array, b: Float64Array) => {
    let worst = 0;
    for (let index = 0; index < a.length; index += 1)
      worst = Math.max(worst, Math.abs(a[index]! - b[index]!));
    return worst;
  };

  test("glue and limiter are periodic across the wrap", () => {
    const [left, right] = seamMix();
    const n = left.length;
    const chain = master({
      glue: { threshold: -30, ratio: 6 },
      limiter: { ceiling: -1, gain: 12 },
    });
    const once = applyMaster(left, right, n, RATE, chain, true)!;
    const twice = applyMaster(
      doubled(left),
      doubled(right),
      2 * n,
      RATE,
      chain,
      true,
    )!;
    expect(maxDiff(once.left, twice.left.subarray(0, n))).toBeLessThan(1e-6);
    expect(maxDiff(once.left, twice.left.subarray(n))).toBeLessThan(1e-6);
    expect(gainToDb(truePeakGain(once.left, once.right, true))).toBeLessThan(
      -1 + 0.1,
    );
  });

  test("with a target the true peak stays under the ceiling across the wrap", () => {
    const [left, right] = seamMix();
    const n = left.length;
    const chain = master({
      glue: { threshold: -30, ratio: 6 },
      limiter: { ceiling: -1 },
      target: -8,
    });
    const out = applyMaster(left, right, n, RATE, chain, true)!;
    expect(gainToDb(truePeakGain(out.left, out.right, true))).toBeLessThan(
      -1 + 0.1,
    );
    // The first lookahead window after the seam matches a doubled pass at
    // the same drive.
    const twice = applyMaster(
      doubled(left),
      doubled(right),
      2 * n,
      RATE,
      master({
        glue: { threshold: -30, ratio: 6 },
        limiter: { ceiling: -1, gain: out.report.gainDb },
      }),
      true,
    )!;
    const window = Math.round(RATE * 0.005);
    expect(
      maxDiff(out.left.subarray(0, window), twice.left.subarray(n, n + window)),
    ).toBeLessThan(1e-3);
  });
});

describe("song master: target search", () => {
  const sawScore = (velocity: number, target: number) =>
    createScore({
      tempoBpm: 120,
      bars: 1,
      tracks: [{ id: "a", name: "a", instrument: "saw" }],
      notes: [
        {
          id: "n",
          trackId: "a",
          pitch: 48,
          startTick: 0,
          durationTicks: 960,
          velocity,
        },
      ],
    }).withMaster({ limiter: { ceiling: -1 }, target } as SongMaster);

  for (const target of [-10, -11]) {
    test(`a ${target} LUFS render does not depend on what rendered before`, () => {
      const options = { sampleRate: RATE, loop: true } as const;
      const fresh = new StemRenderer().render(sawScore(0.5, target), options);
      const renderer = new StemRenderer();
      renderer.render(sawScore(0.15, target), options);
      const after = renderer.render(sawScore(0.5, target), options);
      expect(after.master).toEqual(fresh.master!);
      expect(Buffer.from(after.pcm).equals(Buffer.from(fresh.pcm))).toBe(true);
    });
  }

  test("a reachable target is met from a guess on the limiter plateau", () => {
    const [left, right] = beat();
    const chain = master({ limiter: { ceiling: -1 }, target: -9 });
    const out = applyMaster(left, right, left.length, RATE, chain, true)!;
    expect(out.report.reached).toBe(true);
    const curve = (gain: number) => {
      const fixed = master({ limiter: { ceiling: -1, gain } });
      return applyMaster(left, right, left.length, RATE, fixed, true)!.report
        .integrated;
    };
    for (const guess of [16, 18, 20]) {
      const gain = seekTarget(-9, guess, curve);
      expect(Math.abs(curve(gain) - -9)).toBeLessThan(0.1);
    }
  });

  test("an unreachable target stops on the plateau in a few runs", () => {
    const [left, right] = beat();
    const chain = master({ limiter: { ceiling: -1 }, target: -3 });
    const out = applyMaster(left, right, left.length, RATE, chain, true)!;
    expect(out.report.reached).toBe(false);
    expect(out.report.runs!).toBeLessThanOrEqual(6);
  });

  test("a curve that flattens out stops early with the loudest run", () => {
    let runs = 0;
    const curve = (gain: number) => {
      runs += 1;
      return -20 + 10 * (1 - Math.exp(-gain / 4));
    };
    const gain = seekTarget(-5, 5, curve);
    expect(runs).toBeLessThanOrEqual(6);
    expect(curve(gain)).toBeGreaterThan(-10.3);
  });
});

describe("song master: EQ near Nyquist", () => {
  test("the air preset at 22,050 Hz stays finite and lifts the top octave", () => {
    const rate = 22_050;
    const gainAt = (frequency: number) => {
      const n = rate;
      const left = new Float64Array(n);
      for (let index = 0; index < n; index += 1)
        left[index] = 0.2 * Math.sin((2 * Math.PI * frequency * index) / rate);
      const chain = master({ eq: { high: 6, highfreq: 12_000 } });
      const out = applyMaster(left, left.slice(), n, rate, chain, false)!;
      expect(out.left.every(Number.isFinite)).toBe(true);
      return rmsDb(out.left, rate / 2) - rmsDb(left, rate / 2);
    };
    expect(gainAt(10_500)).toBeGreaterThan(3);
    expect(gainAt(10_500)).toBeLessThan(6.5);
    expect(Math.abs(gainAt(200))).toBeLessThan(0.5);
  });
});
