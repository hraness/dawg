/**
 * Machine vox (lane V1): consonants in the sing engine. Per class: an /s/
 * frame's energy sits above 4 kHz, an /m/ is a low murmur, a stop leaves a
 * closure gap before its burst, a /w/ glides F2 up into the vowel. Plus
 * determinism, a golden hash, the gate that keeps vowel-only renders as
 * they were, and the cost against the engine.sing budget.
 */
import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { createScore, type TrackScore } from "../../../core/score.ts";
import type { TrackSing } from "../../../core/sing.ts";
import { best, budget } from "../../../test/perf.ts";
import { renderScorePcm } from "../wav.ts";
import { renderSingTrack } from "./engine.ts";
import { Articulation } from "./vox.ts";
import { phrasePhones } from "../../../core/g2p.ts";

const TPB = 480;
const SR = 22_050;

type N = {
  pitch?: number;
  start: number;
  length: number;
  lyric?: string;
  ph?: readonly string[];
};

function score(sing: TrackSing, notes: readonly N[], bars = 2): TrackScore {
  return createScore({
    tempoBpm: 120,
    bars,
    tracks: [{ id: "v", name: "v", instrument: "sing", sing }],
    notes: notes.map((n, i) => ({
      id: `n${i}`,
      trackId: "v",
      startTick: Math.round(n.start * TPB),
      durationTicks: Math.round(n.length * TPB),
      pitch: n.pitch ?? 57,
      velocity: 0.8,
      ...(n.lyric !== undefined ? { lyric: n.lyric } : {}),
      ...(n.ph ? { vox: { ph: n.ph } } : {}),
    })),
  } as never);
}

function render(s: TrackScore): Float64Array {
  const samples = Math.ceil(((s.bars * 4 * 60) / s.tempoBpm) * SR);
  const dry = new Float64Array(samples);
  renderSingTrack(dry, undefined, s.notes, s.tracks[0]!, {
    score: s,
    sampleRate: SR,
    samples,
    samplesPerTick: (60 * SR) / (s.tempoBpm * TPB),
    tempoBpm: s.tempoBpm,
    ticksPerBeat: TPB,
  });
  return dry;
}

const hash = (x: Float64Array) =>
  createHash("sha256")
    .update(new Uint8Array(x.buffer, x.byteOffset, x.byteLength))
    .digest("hex");

/** Power spectrum of a Hann frame (direct DFT; small n). */
function spectrum(x: Float64Array, from: number, n = 512): Float64Array {
  const p = new Float64Array(n / 2);
  for (let k = 1; k < n / 2; k += 1) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i += 1) {
      const v =
        (x[from + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
      re += v * Math.cos((2 * Math.PI * k * i) / n);
      im -= v * Math.sin((2 * Math.PI * k * i) / n);
    }
    p[k] = re * re + im * im;
  }
  return p;
}

const hzOfBin = (k: number, n = 512) => (k * SR) / n;

function centroid(p: Float64Array): number {
  let num = 0;
  let den = 0;
  p.forEach((v, k) => {
    num += v * hzOfBin(k);
    den += v;
  });
  return num / den;
}

function share(p: Float64Array, lo: number, hi: number): number {
  let part = 0;
  let all = 0;
  p.forEach((v, k) => {
    all += v;
    if (hzOfBin(k) >= lo && hzOfBin(k) < hi) part += v;
  });
  return part / all;
}

function rms(x: Float64Array, a: number, b: number): number {
  let s = 0;
  const i0 = Math.round(a * SR);
  const i1 = Math.round(b * SR);
  for (let i = i0; i < i1; i += 1) s += x[i]! ** 2;
  return Math.sqrt(s / (i1 - i0));
}

const ROBOT: TrackSing = { preset: "robot", voice: "tenor" };
const at = (seconds: number) => Math.round(seconds * SR);

describe("machine vox consonant classes", () => {
  test("fricative: an /s/ frame's energy centroid is above 4 kHz", () => {
    const y = render(score(ROBOT, [{ start: 0, length: 2, lyric: "sss" }]));
    const p = spectrum(y, at(0.4));
    expect(centroid(p)).toBeGreaterThan(4000);
    expect(share(p, 4000, SR / 2)).toBeGreaterThan(0.6);
  });

  test("nasal: an /m/ hum is a low murmur", () => {
    const y = render(score(ROBOT, [{ start: 0, length: 2, lyric: "mmm" }]));
    const p = spectrum(y, at(0.4));
    expect(share(p, 0, 500)).toBeGreaterThan(0.85);
    expect(centroid(p)).toBeLessThan(600);
    // the vowel the same note would sing is brighter
    const v = render(score(ROBOT, [{ start: 0, length: 2, lyric: "ah" }]));
    expect(centroid(spectrum(v, at(0.4)))).toBeGreaterThan(centroid(p) * 1.5);
  });

  test("plosive: a stop closure leaves a silent gap before its burst", () => {
    // "a-" + "pa": the /p/ opens the second note at 0.5 s; its closure
    // (~70 ms) ends the first note's vowel.
    const y = render(
      score(ROBOT, [
        { start: 0, length: 1, lyric: "a-" },
        { start: 1, length: 1, lyric: "pa" },
      ]),
    );
    const vowel = rms(y, 0.2, 0.4);
    // find the quietest 10 ms window in 0.4..0.65 s
    let gap = Infinity;
    let gapAt = 0;
    for (let t = 0.4; t < 0.65; t += 0.005) {
      const r = rms(y, t, t + 0.01);
      if (r < gap) {
        gap = r;
        gapAt = t;
      }
    }
    expect(gap).toBeLessThan(vowel * 0.05);
    // a burst and the next vowel follow the gap
    expect(rms(y, gapAt + 0.04, gapAt + 0.2)).toBeGreaterThan(vowel * 0.3);
    // a vowel-only legato keeps sounding through the same span
    const legato = render(
      score(ROBOT, [
        { start: 0, length: 1, lyric: "a" },
        { start: 1, length: 1, lyric: "a" },
      ]),
    );
    for (let t = 0.4; t < 0.65; t += 0.01)
      expect(rms(legato, t, t + 0.01)).toBeGreaterThan(vowel * 0.3);
  });

  test("approximant: /w/ glides F2 up into the vowel", () => {
    const sylls = phrasePhones([{ lyric: "wa" }]);
    const art = new Articulation(
      [{ at: 0, end: SR, vowel: "a", syllable: sylls[0]! }],
      "tenor",
      SR,
      1,
    );
    const f2 = (t: number) => art.formantsAt(at(t), 1)[1]![0];
    // low F2 in the /w/, rising monotonically through the transition
    expect(f2(0.02)).toBeLessThan(800);
    let last = 0;
    for (let t = 0.05; t <= 0.12; t += 0.01) {
      const v = f2(t);
      expect(v).toBeGreaterThanOrEqual(last - 1e-9);
      last = v;
    }
    expect(f2(0.3)).toBeGreaterThan(1000);
    expect(f2(0.3) - f2(0.02)).toBeGreaterThan(300);
  });

  test("diphthong: /ay/ glides from an open to a front vowel", () => {
    const art = new Articulation(
      [
        {
          at: 0,
          end: SR,
          vowel: "a",
          syllable: phrasePhones([{ lyric: "I" }])[0]!,
        },
      ],
      "tenor",
      SR,
      1,
    );
    const f2 = (t: number) => art.formantsAt(at(t), 1)[1]![0];
    expect(f2(0.95)).toBeGreaterThan(f2(0.3) + 400);
  });
});

describe("machine vox rendering", () => {
  const phrase = [
    { start: 0, length: 0.5, lyric: "hel-" },
    { start: 0.5, length: 0.5, lyric: "lo", pitch: 60 },
    { start: 1, length: 1, lyric: "_", pitch: 62 },
    { start: 2, length: 1, lyric: "world", pitch: 59 },
    { start: 3, length: 1, lyric: "stops", pitch: 57 },
  ];

  test("two runs are identical; the golden hash holds", () => {
    const a = render(score(ROBOT, phrase));
    const b = render(score(ROBOT, phrase));
    expect(hash(a)).toBe(hash(b));
    for (const v of a) expect(Number.isFinite(v)).toBe(true);
    expect(hash(a)).toMatchSnapshot();
    expect(hash(render(score({ preset: "speak" }, phrase)))).toMatchSnapshot();
  });

  test("articulate 0 sings vowels only: no consonant sounds", () => {
    const off = render(score({ preset: "robot", articulate: 0 }, phrase));
    const on = render(score(ROBOT, phrase));
    expect(hash(on)).not.toBe(hash(off));
    // the /s/ of "stops" at 1.5 s: hiss with articulation, none without
    const hiss = (y: Float64Array) =>
      share(spectrum(y, at(1.52)), 4000, SR / 2);
    expect(hiss(on)).toBeGreaterThan(0.5);
    expect(hiss(off)).toBeLessThan(0.1);
  });

  test("a note's vox.ph replaces letter-to-sound", () => {
    const said = (lyric: string, ph?: readonly string[]) =>
      hash(
        render(
          score(ROBOT, [{ start: 0, length: 2, lyric, ...(ph ? { ph } : {}) }]),
        ),
      );
    // "sun" spelled out by hand renders exactly as the rules read it
    expect(said("sun", ["s", "ah", "n"])).toBe(said("sun"));
    // and a different phone list changes what is sung
    expect(said("sun", ["m", "ah", "n"])).toBe(said("mun"));
    expect(said("sun", ["m", "ah", "n"])).not.toBe(said("sun"));
  });

  test("an articulating line without lyrics sings as before", () => {
    const plain = [
      { start: 0, length: 2 },
      { start: 2, length: 2, pitch: 60 },
    ];
    expect(hash(render(score(ROBOT, plain)))).toBe(
      hash(render(score({ ...ROBOT, articulate: 0 }, plain))),
    );
  });

  test("a sung phrase stays within the engine.sing cost", () => {
    const long = score(
      ROBOT,
      Array.from({ length: 16 }, (_, i) => ({
        start: i * 0.5,
        length: 0.5,
        pitch: 57 + (i % 5),
        lyric: [
          "sing-",
          "ing",
          "the",
          "stars",
          "shine",
          "bright",
          "to-",
          "night",
        ][i % 8],
      })),
      2,
    );
    const plain = score(
      { preset: "robot", articulate: 0 },
      Array.from({ length: 16 }, (_, i) => ({
        start: i * 0.5,
        length: 0.5,
        pitch: 57 + (i % 5),
      })),
      2,
    );
    const time = (s: TrackScore) => best(() => render(s), 3);
    const seconds = 4;
    const voxMs = time(long) / seconds;
    // the same 2.5 ms per audio-second budget as one plain voice, with a
    // quarter more for the noise branch and the nasal zero
    expect(voxMs).toBeLessThanOrEqual(budget(2.5 * 1.25));
    expect(time(plain)).toBeGreaterThan(0);
  }, 30_000);

  test("presets without articulate render consonant lyrics as before V1", () => {
    // sha256 of the full mix rendered by origin/main 33ef2a7 (before lane V1)
    const want: Record<string, string> = {
      aah: "1cd348595c519a31c1076be1f6c7587413aeb4ef53034f4cf5529ec857c35aa3",
      choir: "78bc6d69f970c15831f3b3768222e3d0fe15a30883f7f41ef29cd0d4320e89ab",
    };
    const lyrics = ["hel-", "lo", "_", "world", "sing", "the", "stars", "a"];
    for (const preset of Object.keys(want)) {
      const s = createScore({
        tempoBpm: 120,
        bars: 3,
        tracks: [{ id: "v", name: "v", instrument: "sing", sing: { preset } }],
        notes: lyrics.map((lyric, i) => ({
          id: `n${i}`,
          trackId: "v",
          startTick: i * 480,
          durationTicks: 480,
          pitch: 57 + (i % 3),
          velocity: 0.8,
          lyric,
        })),
      } as never);
      const pcm = renderScorePcm(s, { sampleRate: SR }).pcm;
      const got = createHash("sha256")
        .update(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength))
        .digest("hex");
      expect(got).toBe(want[preset]!);
    }
  });
});
