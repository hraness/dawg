import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { resolveGranular, type TrackGranular } from "../../core/granular.ts";
import { createScore, TrackScore, type Track } from "../../core/score.ts";
import { resetBank, type BankSource } from "./dsp/bank.ts";
import {
  granularVoice,
  quantPitchClasses,
  renderGranularTrack,
  snapSemis,
  synthSource,
} from "./granular.ts";
import { LiveSynth } from "./live.ts";
import { renderScorePcm, StemRenderer } from "./wav.ts";
import { budget } from "../../test/perf.ts";

const SR = 48_000;

function tone(hz: number, seconds: number, sr = SR): Float32Array {
  const x = new Float32Array(Math.round(seconds * sr));
  const w = (2 * Math.PI * hz) / sr;
  for (let i = 0; i < x.length; i += 1) x[i] = 0.5 * Math.sin(w * i);
  return x;
}

/** Goertzel power of `hz` over x[from, from + n). */
function power(x: Float64Array, hz: number, from: number, n: number): number {
  const w = (2 * Math.PI * hz) / SR;
  const c = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i += 1) {
    const s0 = (x[from + i] ?? 0) + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - c * s1 * s2;
}

/** Strongest frequency between lo and hi by a fine Goertzel scan. */
function peakHz(
  x: Float64Array,
  lo: number,
  hi: number,
  from: number,
  n: number,
) {
  let best = lo;
  let bestP = -1;
  for (let hz = lo; hz <= hi; hz += 0.05) {
    const p = power(x, hz, from, n);
    if (p > bestP) {
      bestP = p;
      best = hz;
    }
  }
  return best;
}

const cents = (hz: number, ref: number) => 1200 * Math.log2(hz / ref);

function track(granular: TrackGranular, extra: Partial<Track> = {}): Track {
  return {
    id: "g",
    name: "g",
    instrument: "granular",
    muted: false,
    volume: 1,
    pan: 0,
    volumeAutomation: [],
    panAutomation: [],
    granular,
    ...extra,
  } as unknown as Track;
}

function render(
  t: Track,
  notes: { pitch: number; start: number; beats: number }[],
  seconds: number,
  bpm = 120,
  score?: TrackScore,
): Float64Array {
  const tpb = 480;
  const context = {
    score:
      score ??
      ({ tracks: [t], notes: [], key: undefined } as unknown as TrackScore),
    sampleRate: SR,
    samples: Math.round(seconds * SR),
    samplesPerTick: (SR * 60) / bpm / tpb,
    tempoBpm: bpm,
    ticksPerBeat: tpb,
  } as never;
  const bank = { voices: new Map(), problems: [] } as never;
  const l = new Float64Array(Math.round(seconds * SR));
  const r = new Float64Array(l.length);
  renderGranularTrack(
    l,
    r,
    notes.map((note, i) => ({
      id: `n${i}`,
      trackId: "g",
      startTick: Math.round(note.start * tpb),
      durationTicks: Math.round(note.beats * tpb),
      pitch: note.pitch,
      velocity: 1,
    })) as never,
    t,
    context,
    bank,
  );
  return l;
}

describe("grainplay: sync", () => {
  test("1/16 at 128 BPM: every grain period within 1 ms of 117.19 ms", () => {
    const expected = 60 / 128 / 4;
    const t = track({
      src: "synth:sine",
      grain: 0.01,
      sync: "1/16",
      jitter: 0,
      spray: 0,
      attack: 0,
      window: "hann",
      spread: 0,
    });
    const out = render(t, [{ pitch: 69, start: 0, beats: 8 }], 3.6, 128);
    // Grain centres: the energy centroid of each burst between silences
    // (the window is symmetric, so the centroid is the grain's centre).
    const peaks: number[] = [];
    let sum = 0;
    let weighted = 0;
    let quiet = SR;
    for (let i = 0; i <= out.length; i += 1) {
      const e = i < out.length ? out[i]! ** 2 : 0;
      if (e > 1e-12) {
        sum += e;
        weighted += e * i;
        quiet = 0;
      } else if ((quiet += 1) === Math.round(0.02 * SR) && sum > 0) {
        peaks.push(weighted / sum / SR);
        sum = 0;
        weighted = 0;
      }
    }
    expect(peaks.length).toBeGreaterThan(20);
    // The first grain is shaped by the voice's attack ramp and the last is
    // cut by the render end; skip both.
    for (let i = 2; i < peaks.length - 1; i += 1)
      expect(Math.abs(peaks[i]! - peaks[i - 1]! - expected)).toBeLessThan(
        0.001,
      );
  });
});

describe("grainplay: grain-pos automation", () => {
  test("a pos step moves the head within one grain", () => {
    // Source: 300 Hz for the first half, 900 Hz for the second.
    const half = 2 * SR;
    const data = new Float32Array(2 * half);
    data.set(tone(300, 2));
    data.set(tone(900, 2), half);
    const source: BankSource = { id: "two-tone", rate: SR, data };
    const grain = 0.05;
    const settings = resolveGranular({
      grain,
      overlap: 2,
      jitter: 0,
      spray: 0,
      scan: 0,
      spread: 0,
      attack: 0,
    });
    const step = Math.round(1.0 * SR);
    const voice = granularVoice({
      source,
      sr: SR,
      settings,
      baseRate: 1,
      velocity: 1,
      gateFrames: 2 * SR,
      seed: 3,
      lanes: [{ name: "pos", at: (frame) => (frame < step ? 0.1 : 0.75) }],
    });
    const l = new Float64Array(voice.totalFrames);
    const r = new Float64Array(voice.totalFrames);
    voice.process(l, r, 0, voice.totalFrames);
    const win = 480;
    let switched = -1;
    for (let at = 0; at + win < 2 * SR; at += 48)
      if (power(l, 900, at, win) > power(l, 300, at, win)) {
        switched = at + win;
        break;
      }
    expect(switched).toBeGreaterThan(step - 1);
    expect(switched - step).toBeLessThan(grain * SR);
  });

  test("lanes stream identically in 128-frame blocks and one call", () => {
    const source: BankSource = { id: "a", rate: SR, data: tone(220, 4) };
    const init = {
      source,
      sr: SR,
      settings: resolveGranular({ preset: "swarm" }),
      baseRate: 1.5,
      velocity: 0.7,
      gateFrames: SR,
      seed: 9,
      lanes: [
        { name: "pos", at: (f: number) => (f / SR) * 0.5 },
        { name: "grain", at: (f: number) => 0.02 + (f / SR) * 0.1 },
      ],
    };
    const a = granularVoice(init);
    const whole = new Float64Array(a.totalFrames);
    a.process(whole, new Float64Array(a.totalFrames), 0, a.totalFrames);
    const b = granularVoice(init);
    const parts = new Float64Array(b.totalFrames);
    const partsR = new Float64Array(b.totalFrames);
    for (let at = 0; at < b.totalFrames; at += 128)
      b.process(parts, partsR, at, Math.min(128, b.totalFrames - at));
    expect(parts).toEqual(whole);
  });
});

describe("grainplay: mono, quant, pedal", () => {
  const plain = {
    src: "synth:sine",
    grain: 0.1,
    overlap: 1,
    window: "tukey",
    jitter: 0,
    spray: 0,
    spread: 0,
    veltone: 0,
  } as const;

  test("mono: a legato note retargets the one voice within 1 cent", () => {
    // root 64: the retargeted E4 reads at rate 1, matching scan 1, so
    // grains join in phase and the spectrum has one sharp peak.
    const t = track({ ...plain, mono: true, scan: 1, root: 64 });
    const out = render(
      t,
      [
        { pitch: 57, start: 0, beats: 2.1 },
        { pitch: 64, start: 2, beats: 2 },
      ],
      2.5,
    );
    const e4 = 440 * 2 ** (-5 / 12);
    const hz = peakHz(out, e4 - 4, e4 + 4, Math.round(1.4 * SR), 24_000);
    // Same reading as a fresh E4 on its own (the synth source's own
    // detune is not this test's business).
    const solo = render(t, [{ pitch: 64, start: 0, beats: 4 }], 2.5);
    const ref = peakHz(solo, e4 - 4, e4 + 4, Math.round(1.4 * SR), 24_000);
    expect(Math.abs(cents(hz, ref))).toBeLessThan(1);
    // No second voice: nothing left at A3 once retargeted.
    const at = Math.round(1.4 * SR);
    // One voice: the retargeted cloud is as loud as a fresh E4, within 3 dB.
    const rms = (x: Float64Array) => {
      let e = 0;
      for (let i = at; i < at + 24_000; i += 1) e += x[i]! ** 2;
      return e;
    };
    expect(Math.abs(10 * Math.log10(rms(out) / rms(solo)))).toBeLessThan(3);
  });

  test("quant scale: a +1 st grain pitch lands on the C major scale", () => {
    const classes = quantPitchClasses(
      { key: "C major", tracks: [], notes: [] } as unknown as TrackScore,
      "scale",
    )(0);
    expect(classes).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(snapSemis(60, 1, classes)).toBe(0); // C# -> C (tie keeps lower)
    expect(snapSemis(64, 1.6, classes)).toBe(1); // 65.6 -> F, not G
    expect(snapSemis(60, 0.4, classes)).toBe(0);
  });

  test("quant chord: the other tracks' sounding pitch classes", () => {
    const score = {
      tracks: [{ id: "g", granular: {} }, { id: "p" }],
      notes: [
        { trackId: "p", pitch: 62, startTick: 0, durationTicks: 960 },
        { trackId: "p", pitch: 65, startTick: 0, durationTicks: 960 },
        { trackId: "g", pitch: 61, startTick: 0, durationTicks: 960 },
      ],
    } as unknown as TrackScore;
    const at = quantPitchClasses(score, "chord");
    expect(at(10)).toEqual([2, 5]);
    expect(at(2000)).toHaveLength(12); // nothing sounds: no key, chromatic
  });

  test("quant renders: a +1 st pitch in C major plays at C, within 1 cent", () => {
    const t = track({ ...plain, pitch: 1, quant: "scale", scan: 1, root: 60 });
    const score = { key: "C major", tracks: [t], notes: [] } as never;
    const out = render(t, [{ pitch: 60, start: 0, beats: 2 }], 1.2, 120, score);
    const c4 = 440 * 2 ** (-9 / 12);
    const hz = peakHz(out, c4 - 4, c4 + 4, Math.round(0.3 * SR), 24_000);
    expect(Math.abs(cents(hz, c4))).toBeLessThan(1);
  });

  test("pedal: the head holds while the sustain pedal is down", () => {
    const half = 2 * SR;
    const data = new Float32Array(2 * half);
    data.set(tone(300, 2));
    data.set(tone(900, 2), half);
    const source: BankSource = { id: "two-tone-p", rate: SR, data };
    const settings = resolveGranular({ ...plain, scan: 1, src: undefined });
    const run = (held?: (f: number) => boolean) => {
      const v = granularVoice({
        source,
        sr: SR,
        settings: { ...settings, pos: 0.3 },
        baseRate: 1,
        velocity: 1,
        gateFrames: 3 * SR,
        seed: 1,
        ...(held ? { held } : {}),
      });
      const l = new Float64Array(v.totalFrames);
      v.process(l, new Float64Array(v.totalFrames), 0, v.totalFrames);
      return l;
    };
    // Unheld, the head scans from 1.2 s into the 900 Hz half by ~1 s.
    const free = run();
    const at = Math.round(1.5 * SR);
    expect(power(free, 900, at, 4800)).toBeGreaterThan(
      power(free, 300, at, 4800),
    );
    const held = run(() => true);
    expect(power(held, 300, at, 4800)).toBeGreaterThan(
      power(held, 900, at, 4800),
    );
  });
});

describe("grainplay: backward compatibility", () => {
  test("absent fields and off values render byte-identically", () => {
    const base = (granular: TrackGranular) =>
      new TrackScore({
        version: 2,
        tempoBpm: 120,
        bars: 1,
        beatsPerBar: 4,
        ticksPerBeat: 480,
        tracks: [
          {
            id: "g",
            name: "g",
            instrument: "granular",
            muted: false,
            volume: 0.8,
            pan: 0,
            granular,
          },
        ],
        notes: [60, 67].map((pitch, i) => ({
          id: `n${i}`,
          trackId: "g",
          startTick: i * 240,
          durationTicks: 960,
          pitch,
          velocity: 0.8,
        })),
      } as never);
    const sha = (score: TrackScore) =>
      createHash("sha256")
        .update(
          new Uint8Array(
            renderScorePcm(score, { sampleRate: 22_050 }).pcm.buffer,
          ),
        )
        .digest("hex");
    const a = sha(base({ preset: "swarm" }));
    const b = sha(
      base({
        preset: "swarm",
        sync: "off",
        quant: "off",
        mono: false,
        pedal: false,
      }),
    );
    expect(b).toBe(a);
  });
});

describe("grainplay: live cost", () => {
  test("cold note-on with sync, quant, pedal and a lane: first block under 10 ms", () => {
    resetBank();
    const source = synthSource("pad", 60, SR);
    const settings = resolveGranular({
      preset: "cloud",
      sync: "1/16",
      quant: "scale",
      pedal: true,
    });
    const period = (SR * 60) / 128 / 4;
    const started = performance.now();
    const voice = granularVoice({
      source,
      sr: SR,
      settings,
      baseRate: 4,
      velocity: 1,
      gateFrames: SR,
      seed: 3,
      grid: (k) => k * period,
      quant: (semis) => Math.round(semis),
      held: () => false,
      lanes: [{ name: "pos", at: (frame) => frame / SR / 4 }],
    });
    const l = new Float64Array(128);
    const r = new Float64Array(128);
    voice.process(l, r, 0, 128);
    expect(performance.now() - started).toBeLessThan(budget(10));
  });
});

describe("grainplay: review fixes", () => {
  const plain = {
    src: "synth:sine",
    grain: 0.05,
    jitter: 0,
    spray: 0,
    attack: 0,
    window: "hann",
    spread: 0,
  } as const;
  const firstSound = (out: Float64Array) => {
    for (let i = 0; i < out.length; i += 1)
      if (Math.abs(out[i]!) > 1e-6) return i;
    return -1;
  };

  // The unsynced onset of the same note is the reference.
  const onset = (sync: "1/4" | "1/1", start: number, beats: number) => {
    const synced = render(
      track({ ...plain, sync, release: 0.01 }),
      [{ pitch: 69, start, beats }],
      1.5,
    );
    const free = render(
      track({ ...plain, release: 0.01 }),
      [{ pitch: 69, start, beats }],
      1.5,
    );
    return firstSound(synced) - firstSound(free);
  };

  test("sync: an off-grid note sounds at note-on", () => {
    expect(
      firstSound(render(track(plain), [{ pitch: 69, start: 0, beats: 2 }], 1)),
    ).toBeGreaterThanOrEqual(0);
    // 7 ticks after the grid line, within one control block (32 frames).
    expect(Math.abs(onset("1/4", 7 / 480, 2))).toBeLessThan(32);
  });

  test("sync 1/1: a short note still sounds", () => {
    expect(Math.abs(onset("1/1", 0.5, 0.25))).toBeLessThan(32);
  });

  test("quant chord leaves out resampled and one-shot sampler tracks", () => {
    const score = {
      tracks: [
        { id: "g", granular: {} },
        { id: "p" },
        {
          id: "rs",
          instrument: "sampler",
          sampler: {
            mode: "keyed",
            voices: { a: { src: "x.wav", from: { source: "master" } } },
          },
        },
        {
          id: "hits",
          instrument: "sampler",
          sampler: { mode: "oneshot", voices: { a: { src: "y.wav" } } },
        },
        { id: "m", muted: true },
      ],
      notes: [
        { trackId: "p", pitch: 57, startTick: 0, durationTicks: 960 },
        { trackId: "p", pitch: 60, startTick: 0, durationTicks: 960 },
        { trackId: "p", pitch: 64, startTick: 0, durationTicks: 960 },
        { trackId: "rs", pitch: 62, startTick: 0, durationTicks: 960 },
        { trackId: "hits", pitch: 37, startTick: 0, durationTicks: 960 },
        { trackId: "m", pitch: 66, startTick: 0, durationTicks: 960 },
      ],
    } as unknown as TrackScore;
    expect(quantPitchClasses(score, "chord")(10)).toEqual([0, 4, 9]);
  });

  test("quant chord: a cached stem follows another track's chord edit", () => {
    const g = track({ ...plain, pitch: 1, quant: "chord", root: 60 });
    const song = (pitch: number) =>
      createScore({
        tempoBpm: 120,
        bars: 1,
        tracks: [
          g as never,
          { id: "p", name: "p", instrument: "piano", muted: false },
        ],
        notes: [
          {
            id: "a",
            trackId: "g",
            pitch: 60,
            velocity: 1,
            startTick: 0,
            durationTicks: 960,
          },
          {
            id: "b",
            trackId: "p",
            pitch,
            velocity: 0.01,
            startTick: 0,
            durationTicks: 1920,
          },
        ],
      });
    const options = { sampleRate: 22_050 };
    const stems = new StemRenderer();
    stems.render(song(62), options);
    const cached = stems.render(song(65), options);
    const cold = new StemRenderer().render(song(65), options);
    expect(Buffer.from(cached.pcm).equals(Buffer.from(cold.pcm))).toBe(true);
  });

  test("quant chord: a live note snaps like the offline render", () => {
    const g = track({ ...plain, pitch: 1, quant: "chord", scan: 1, root: 60 });
    const score = createScore({
      tempoBpm: 120,
      bars: 2,
      tracks: [g as never, { id: "p", name: "p", instrument: "piano" }],
      notes: [
        {
          id: "b",
          trackId: "p",
          pitch: 65,
          velocity: 0.5,
          startTick: 0,
          durationTicks: 3840,
        },
      ],
    });
    const live = new LiveSynth(SR).render({
      score,
      trackId: "g",
      pitch: 60,
      velocity: 1,
      seconds: 1,
      tick: 960,
    })!;
    const mono = new Float64Array(live.frames);
    for (let i = 0; i < live.frames; i += 1) mono[i] = live.pcm[i * 2]!;
    // C + 1 st snaps to F (the only class sounding), not C#.
    const f4 = 440 * 2 ** (-4 / 12);
    const cs = 440 * 2 ** (-8 / 12);
    const at = Math.round(0.3 * SR);
    expect(power(mono, f4, at, 9600)).toBeGreaterThan(
      100 * power(mono, cs, at, 9600),
    );
  });
});
