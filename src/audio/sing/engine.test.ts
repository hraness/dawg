/**
 * The sing engine (formant.md section 9, tests 4 and 8): pitch through
 * noteHz and tunings, rendered vowels, F1 tuning, aliasing of the glottal
 * source, velocity timbre, determinism, legacy identity, ensemble stereo,
 * throat-mode harmonic choice, the kargyraa sub, the member cap, legato
 * without phase reset, and the cost budgets at 22,050 Hz.
 */
import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { createScore, type TrackScore } from "../../../core/score.ts";
import { resolveTuning, noteHz } from "../../../core/tuning.ts";
import type { TrackSing } from "../../../core/sing.ts";
import { glottal } from "../dsp/glottal.ts";
import {
  Cascade,
  SINGER_FORMANTS,
  tuneToPitch,
  vowelAt,
  type Formant,
  type VoiceType,
} from "../dsp/formant.ts";
import { renderScorePcm } from "../wav.ts";
import {
  aliasDb,
  centroidHz,
  cents,
  harmonicLevels,
  harmonicPeaks,
  median,
  yin,
} from "./analysis.ts";
import { overtoneFor, renderSingTrack, singStereo } from "./engine.ts";
import { budget } from "../../../test/perf.ts";

const hzOf = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const TPB = 480;

type N = Readonly<{
  pitch: number;
  start?: number;
  length?: number;
  velocity?: number;
  vowel?: string;
  cents?: number;
  vibrato?: Readonly<{ rate: number; depth: number }>;
}>;

function score(
  sing: TrackSing | undefined,
  notes: readonly N[],
  extra: Record<string, unknown> = {},
  instrument = "sing",
): TrackScore {
  const beats = Math.max(
    4,
    ...notes.map((n) => (n.start ?? 0) + (n.length ?? 2) + 2),
  );
  return createScore({
    tempoBpm: 120,
    bars: Math.ceil(beats / 4),
    tracks: [
      {
        id: "v",
        name: "v",
        instrument,
        ...(sing ? { sing } : {}),
        ...(extra.track as object | undefined),
      },
    ],
    notes: notes.map((n, i) => ({
      id: `n${i}`,
      trackId: "v",
      startTick: Math.round((n.start ?? 0) * TPB),
      durationTicks: Math.round((n.length ?? 2) * TPB),
      pitch: n.pitch,
      velocity: n.velocity ?? 0.8,
      ...(n.vowel ? { vowel: n.vowel } : {}),
      ...(n.cents ? { cents: n.cents } : {}),
      ...(n.vibrato ? { vibrato: n.vibrato } : {}),
    })),
    ...(extra.song as object | undefined),
  } as never);
}

/** Renders the engine alone (no fx, pan or master): left, right. */
function render(
  s: TrackScore,
  sampleRate = 22_050,
): [Float64Array, Float64Array | undefined] {
  const track = s.tracks[0]!;
  const seconds = (s.bars * 4 * 60) / s.tempoBpm;
  const samples = Math.ceil(seconds * sampleRate);
  const stereo = singStereo(track);
  const dry = new Float64Array(samples);
  const dryR = stereo ? new Float64Array(samples) : undefined;
  const tuning = resolveTuning(s.tuning, track.tuning, s.key);
  renderSingTrack(dry, dryR, s.notes, track, {
    score: s,
    sampleRate,
    samples,
    samplesPerTick: (60 * sampleRate) / (s.tempoBpm * TPB),
    tempoBpm: s.tempoBpm,
    ticksPerBeat: TPB,
    ...(tuning ? { tuning } : {}),
  });
  return [dry, dryR];
}

const still = { vibmod: 0, jitter: 0, shimmer: 0, breath: 0 };

function f0Of(x: Float64Array, sr: number, from: number, to: number): number {
  const track = yin(x.subarray(from * sr, to * sr), sr, 256, 60, 1500);
  return median([...track].filter((hz) => hz > 0));
}

const hash = (x: Float64Array) =>
  createHash("sha256")
    .update(new Uint8Array(x.buffer, x.byteOffset, x.byteLength))
    .digest("hex");

describe("sing pitch", () => {
  test("A3 sings 220 Hz within 3 cents (48 kHz, still)", () => {
    const sr = 48_000;
    const [y] = render(
      score({ voice: "tenor", ...still }, [{ pitch: 57 }]),
      sr,
    );
    expect(Math.abs(cents(f0Of(y, sr, 0.2, 0.9), 220))).toBeLessThan(3);
  });

  test("19-EDO plus note cents lands on noteHz within 3 cents", () => {
    const sr = 48_000;
    const s = score({ voice: "tenor", ...still }, [{ pitch: 57, cents: 30 }], {
      song: { tuning: { edo: 19 } },
    });
    const want = noteHz(57, 30, resolveTuning(s.tuning, undefined, s.key));
    expect(Math.abs(cents(want, 220))).toBeGreaterThan(20);
    const [y] = render(s, sr);
    expect(Math.abs(cents(f0Of(y, sr, 0.2, 0.9), want))).toBeLessThan(3);
  });
});

describe("sing vowels", () => {
  test("bass G2 vowels land on the table and stay apart", () => {
    const sr = 48_000;
    const f0 = hzOf(43);
    const fits: Record<string, number[]> = {};
    for (const vowel of ["a", "e", "i", "o", "u"]) {
      const [y] = render(
        score({ voice: "bass", ...still }, [
          { pitch: 43, vowel, velocity: 0.6 },
        ]),
        sr,
      );
      const peaks = harmonicPeaks(
        harmonicLevels(y, sr, Math.floor(sr * 0.5), f0, 4000, 16384),
        f0,
      );
      const want = SINGER_FORMANTS.bass[vowel]!;
      fits[vowel] = [0, 1].map((i) =>
        peaks.reduce(
          (b, p) =>
            Math.abs(p - want[i]![0]) < Math.abs(b - want[i]![0]) ? p : b,
          Infinity,
        ),
      );
      const tol1 = vowel === "i" || vowel === "u" ? 0.15 : 0.1;
      const err = fits[vowel]!.map(
        (hz, i) => Math.abs(hz - want[i]![0]) / want[i]![0],
      );
      expect([vowel, err[0]! <= tol1, err[1]! <= 0.1]).toEqual([
        vowel,
        true,
        true,
      ]);
    }
    const names = Object.keys(fits);
    for (let i = 0; i < names.length; i += 1)
      for (let j = i + 1; j < names.length; j += 1) {
        const [a, b] = [fits[names[i]!]!, fits[names[j]!]!];
        const apart =
          Math.abs(a[0]! - b[0]!) / Math.min(a[0]!, b[0]!) >= 0.15 ||
          Math.abs(a[1]! - b[1]!) / Math.min(a[1]!, b[1]!) >= 0.15;
        expect([names[i], names[j], apart]).toEqual([names[i], names[j], true]);
      }
  });

  test("a>u at t = 1 is u", () => {
    expect(vowelAt("tenor", "a>u", 1)).toEqual(
      vowelAt("tenor", "u", 0).map((f) => [...f]),
    );
  });

  test("F1 tuning: soprano u at G5 and i at A5 put f0 near the peak", () => {
    const sr = 22_050;
    const gainDb = (fm: readonly Formant[], hz: number) => {
      let g = 1;
      for (const [f, , bw] of fm) {
        const c = -Math.exp((-2 * Math.PI * bw) / sr);
        const b =
          2 *
          Math.exp((-Math.PI * bw) / sr) *
          Math.cos((2 * Math.PI * Math.min(f, sr * 0.45)) / sr);
        const a = 1 - b - c;
        const w = (2 * Math.PI * hz) / sr;
        g *=
          a /
          Math.hypot(
            1 - b * Math.cos(w) - c * Math.cos(2 * w),
            b * Math.sin(w) + c * Math.sin(2 * w),
          );
      }
      return 20 * Math.log10(g);
    };
    const belowPeak = (fm: readonly Formant[], f0: number) => {
      let peak = -Infinity;
      for (let hz = 50; hz < 6000; hz += 5)
        peak = Math.max(peak, gainDb(fm, hz));
      return gainDb(fm, f0) - peak;
    };
    const u = SINGER_FORMANTS.soprano.u!;
    expect(belowPeak(tuneToPitch(u, hzOf(79), 1), hzOf(79))).toBeGreaterThan(
      -3,
    );
    const i = SINGER_FORMANTS.soprano.i!;
    const gain =
      belowPeak(tuneToPitch(i, hzOf(81), 1), hzOf(81)) - belowPeak(i, hzOf(81));
    expect(gain).toBeGreaterThanOrEqual(15);
    // Below the crossing the table is untouched.
    expect(tuneToPitch(SINGER_FORMANTS.bass.a!, hzOf(43), 1)).toBe(
      SINGER_FORMANTS.bass.a!,
    );
  });
});

describe("sing source", () => {
  test("the band-limited glottal source aliases at most -40 dB", () => {
    for (const sr of [22_050, 48_000])
      for (const f0 of [220, 523.25, 880, 1174.66]) {
        const voice: VoiceType = "soprano";
        const out = new Float64Array(Math.ceil(1.2 * sr));
        const c = new Cascade();
        c.set(SINGER_FORMANTS[voice].i!, 1, sr);
        let phase = 0;
        const inc = f0 / sr;
        for (let k = 0; k < out.length; k += 1) {
          phase += inc;
          if (phase >= 1) phase -= 1;
          out[k] = c.process(glottal(phase, 0.5, inc));
        }
        const db = aliasDb(out, sr, f0);
        expect([sr, f0, db <= -40]).toEqual([sr, f0, true]);
      }
  });

  test("velocity brightens at equal loudness", () => {
    const sr = 22_050;
    const at = (velocity: number) => {
      const [y] = render(
        score({ voice: "tenor", ...still, breath: 0.1 }, [
          { pitch: 57, velocity, vowel: "a" },
        ]),
        sr,
      );
      return centroidHz(y, sr, Math.floor(sr * 0.3));
    };
    expect(at(1)).toBeGreaterThan(at(0.3));
  });
});

describe("sing determinism and identity", () => {
  const melody: N[] = [
    { pitch: 57, start: 0, length: 1 },
    { pitch: 60, start: 1, length: 1 },
    { pitch: 64, start: 2, length: 2 },
  ];

  test("two renders are identical and the note id seeds the scatter", () => {
    const s = score({ preset: "choir" }, melody);
    const [a] = render(s);
    const [b] = render(s);
    expect(hash(a)).toBe(hash(b));
    const moved = createScore({
      ...s.toJSON(),
      notes: s.notes.map((n) => ({ ...n, id: `${n.id}x` })),
    } as never);
    expect(hash(render(moved)[0])).not.toBe(hash(a));
  });

  test("instrument sing without the field renders like the legacy tone", () => {
    const pcm = (s: TrackScore) =>
      hash(
        new Float64Array(
          Int16Array.from(renderScorePcm(s, { sampleRate: 22_050 }).pcm),
        ),
      );
    const bare = score(undefined, melody, {}, "sing");
    const fallback = score(undefined, melody, {}, "sine");
    expect(pcm(bare)).toBe(pcm(fallback));
  });

  test("voices 6 is stereo, voices 1 is mono", () => {
    const [l6, r6] = render(score({ voices: 6 }, melody));
    expect(r6).toBeDefined();
    let diff = 0;
    for (let i = 0; i < l6.length; i += 1) diff += Math.abs(l6[i]! - r6![i]!);
    expect(diff).toBeGreaterThan(0);
    const [, r1] = render(score({ voices: 1 }, melody));
    expect(r1).toBeUndefined();
  });

  test("the choir hash is pinned", () => {
    const s = score({ preset: "choir" }, [
      { pitch: 60, start: 0, length: 4 },
      { pitch: 64, start: 0, length: 4 },
      { pitch: 67, start: 0, length: 4 },
    ]);
    const [l, r] = render(s);
    // Quantised to 1e-4 (about -80 dB) before hashing: libm's exp and cos
    // differ by an ulp between platforms (CI's x64 Linux, arm64 macOS), and
    // that must not move the pin; any real change to the voice does.
    const coarse = (x: Float64Array) =>
      Float64Array.from(x, (value) => Math.round(value * 1e4) + 0); // + 0: no -0
    expect(hash(coarse(l)).slice(0, 16) + hash(coarse(r!)).slice(0, 16)).toBe(
      "ab59ec46478e7fc57c1a7ccb3b5ec5e3",
    );
  });
});

describe("throat mode", () => {
  test("khoomei D3 picks octave-folded harmonics 20 dB over neighbours", () => {
    const sr = 22_050;
    const drone = 50;
    const droneHz = hzOf(drone);
    const melody = [62, 64, 66, 69, 71];
    const [y] = render(
      score(
        { preset: "khoomei", drone, overtone: 0.9, vibmod: 0, breath: 0.05 },
        melody.map((pitch, i) => ({ pitch, start: 0.6 + i, length: 1 })),
      ),
      sr,
    );
    const picked = new Set<number>();
    melody.forEach((pitch, i) => {
      const want = overtoneFor(hzOf(pitch), droneHz, 6, 10);
      picked.add(want);
      const centre = Math.floor((0.6 + i + 0.6) * 0.5 * sr);
      const lv = harmonicLevels(y, sr, centre, droneHz, droneHz * 14.5, 8192);
      let strongest = 5;
      for (let h = 5; h <= 13; h += 1)
        if (lv[h - 1]! > lv[strongest - 1]!) strongest = h;
      const prominence = lv[want - 1]! - Math.max(lv[want - 2]!, lv[want]!);
      expect([pitch, strongest, prominence >= 20]).toEqual([pitch, want, true]);
    });
    expect(picked.size).toBeGreaterThanOrEqual(3);
  });

  test("sygyt G3 whistles between 1 and 2.9 kHz", () => {
    const droneHz = hzOf(55);
    for (const pitch of [74, 79, 81]) {
      const want = overtoneFor(hzOf(pitch), droneHz, 9, 12);
      expect(want * droneHz).toBeGreaterThan(1000);
      expect(want * droneHz).toBeLessThan(2900);
    }
  });

  test("the kargyraa sub sits an octave below", () => {
    const sr = 22_050;
    const subDb = (sub: number) => {
      const drone = 45;
      const f0 = hzOf(drone);
      const [y] = render(
        score(
          {
            preset: "kargyraa",
            sub,
            vibmod: 0,
            jitter: 0,
            shimmer: 0,
            breath: 0,
            overtone: 0,
          },
          [{ pitch: 69, start: 0, length: 3 }],
        ),
        sr,
      );
      const lv = harmonicLevels(
        y,
        sr,
        Math.floor(sr * 1),
        f0 / 2,
        f0 * 1.2,
        16384,
      );
      return lv[0]! - lv[1]!;
    };
    const on = subDb(0.8);
    expect(on).toBeGreaterThanOrEqual(-18);
    expect(on).toBeLessThanOrEqual(-6);
    expect(subDb(0)).toBeLessThan(-40);
  });
});

describe("sing limits and legato", () => {
  test("notes past the cap drop members without throwing and stay finite", () => {
    const notes: N[] = [];
    for (let i = 0; i < 24; i += 1) notes.push({ pitch: 48 + i, length: 4 });
    const [l, r] = render(score({ voices: 8 }, notes));
    let peak = 0;
    for (const x of [l, r!])
      for (const v of x) {
        expect(Number.isFinite(v)).toBe(true);
        peak = Math.max(peak, Math.abs(v));
      }
    expect(peak).toBeLessThanOrEqual(4);
  });

  test("legato notes with glide do not reset the glottal phase", () => {
    const sr = 22_050;
    const [y] = render(
      score(
        { voice: "tenor", ...still },
        [
          { pitch: 57, start: 0, length: 1 },
          { pitch: 59, start: 1, length: 1 },
          { pitch: 60, start: 2, length: 1 },
        ],
        { track: { glide: 0.05 } },
      ),
      sr,
    );
    let jump = 0;
    for (const beat of [1, 2]) {
      const at = Math.round(beat * 0.5 * sr);
      for (let k = at - 64; k < at + 64; k += 1)
        jump = Math.max(jump, Math.abs(y[k + 1]! - y[k]!));
    }
    let typical = 0;
    for (let k = sr * 0.2; k < sr * 0.4; k += 1)
      typical = Math.max(typical, Math.abs(y[k + 1]! - y[k]!));
    expect(jump).toBeLessThanOrEqual(Math.max(0.2, typical * 1.5));
  });
});

describe("sing cost at 22,050 Hz", () => {
  const best = (fn: () => void, reps = 3) => {
    let ms = Infinity;
    for (let r = 0; r < reps; r += 1) {
      const t0 = performance.now();
      fn();
      ms = Math.min(ms, performance.now() - t0);
    }
    return ms;
  };

  test("one voice and a 6x4 choir stay within budget", () => {
    const one = score({ voice: "tenor" }, [{ pitch: 57, length: 8 }]);
    const choir = score({ preset: "choir", voices: 6 }, [
      { pitch: 60, length: 8 },
      { pitch: 64, length: 8 },
      { pitch: 67, length: 8 },
      { pitch: 71, length: 8 },
    ]);
    const seconds = (one.bars * 4 * 60) / one.tempoBpm;
    // The spec's budgets are 2.5 and 40 ms per audio-second on the
    // reference host.
    const x1 = best(() => render(one)) / seconds;
    const x6 = best(() => render(choir)) / seconds;
    expect(x1).toBeLessThanOrEqual(budget(2.5));
    expect(x6).toBeLessThanOrEqual(budget(40));
  }, 30_000);
});

describe("sing performance", () => {
  // The full render path, so performNotes sets each note's performance.
  const mixed = (s: TrackScore): [Float64Array] => {
    const pcm = renderScorePcm(s, { sampleRate: 22_050 }).pcm;
    const left = new Float64Array(pcm.length / 2);
    for (let i = 0; i < left.length; i += 1) left[i] = pcm[i * 2]! / 32768;
    return [left];
  };
  const spread = (x: Float64Array, sr: number) => {
    const track = [...yin(x.subarray(1 * sr, 1.8 * sr), sr, 256, 60, 1500)]
      .filter((hz) => hz > 0)
      .map((hz) => 1200 * Math.log2(hz / 220));
    return Math.max(...track) - Math.min(...track);
  };

  test("a note's own vibrato replaces the voice's, never stacks", () => {
    const sing = { ...still, vibmod: 1, vibdelay: 0 };
    const [voiced] = mixed(score(sing, [{ pitch: 57, length: 4 }]));
    const [own] = mixed(
      score(sing, [{ pitch: 57, length: 4, vibrato: { rate: 5, depth: 10 } }]),
    );
    expect(spread(voiced, 22_050)).toBeGreaterThan(120);
    expect(spread(own, 22_050)).toBeLessThan(40);
  });

  test("half pedal fades the voice instead of holding it", () => {
    const rms = (x: Float64Array, from: number, to: number) => {
      let sum = 0;
      for (let i = from; i < to; i += 1) sum += x[i]! ** 2;
      return Math.sqrt(sum / (to - from));
    };
    const notes = [{ pitch: 57, length: 1 }];
    const [full] = mixed(
      score(still, notes, { track: { pedal: [{ tick: 0, state: "down" }] } }),
    );
    const [half] = mixed(
      score(still, notes, { track: { pedal: [{ tick: 0, state: "half" }] } }),
    );
    const late = [Math.round(1.6 * 22_050), Math.round(1.9 * 22_050)] as const;
    expect(rms(full, ...late)).toBeGreaterThan(0.01);
    expect(rms(half, ...late)).toBeLessThan(rms(full, ...late) * 0.5);
  });
});

describe("sing with the 0.7 formant effect", () => {
  test("fx formant reshapes a sung choir after the engine, deterministically", () => {
    const pcm = (s: TrackScore) =>
      Int16Array.from(renderScorePcm(s, { sampleRate: 22_050 }).pcm);
    const notes = [{ pitch: 57 }, { pitch: 60, start: 2 }];
    const plain = pcm(score({ preset: "choir" }, notes));
    const deep = (shift: number) =>
      pcm(
        score({ preset: "choir" }, notes, {
          track: { fx: { formant: { shift, mix: 1 } } },
        }),
      );
    const a = deep(-4);
    expect(a.length).toBe(plain.length);
    expect(a.some((value, index) => value !== plain[index])).toBe(true);
    expect(a.some((value) => value !== 0)).toBe(true);
    expect(hash(new Float64Array(deep(-4)))).toBe(hash(new Float64Array(a)));
  });
});
