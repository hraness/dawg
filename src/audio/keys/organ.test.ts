import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { PerformedNote } from "../../../core/expression.ts";
import { resolvedKeys } from "../../../core/keys.ts";
import { createScore, type TrackScore } from "../../../core/score.ts";
import { noteHz as tunedHz, resolveTuning } from "../../../core/tuning.ts";
import { fftInPlace } from "../dsp/fft.ts";
import { engineFor } from "../instruments.ts";
import { LiveSynth } from "../live.ts";
import { renderArrangedPcm } from "../arrange.ts";
import { renderScorePcm } from "../wav.ts";
import { Biquad2 } from "./dsp.ts";
import {
  DRAWBAR_SEMITONES,
  OrganPost,
  PipeVoice,
  TonewheelVoice,
  organVoice,
  renderOrganTrack,
  wheelPitch,
  type OrganNote,
} from "./organ.ts";

const SR = 22050;
const noteHz = (pitch: number) => tunedHz(pitch, undefined, undefined);

function score(
  instrument: string,
  keys: Record<string, number | string> | undefined,
  notes: { pitch: number; start?: number; dur?: number; id?: string }[],
  bars = 1,
): TrackScore {
  return createScore({
    tempoBpm: 120,
    bars,
    tracks: [
      {
        id: "o",
        name: "o",
        instrument,
        ...(keys ? { keys } : {}),
      },
    ],
    notes: notes.map((n, i) => ({
      id: n.id ?? `n${i}`,
      trackId: "o",
      pitch: n.pitch,
      startTick: n.start ?? 0,
      durationTicks: n.dur ?? 96,
      velocity: 0.8,
    })),
  } as Parameters<typeof createScore>[0]);
}

function render(
  song: TrackScore,
  seconds: number,
  tuning?: ReturnType<typeof resolveTuning>,
): [Float64Array, Float64Array] {
  const left = new Float64Array(Math.round(seconds * SR));
  const right = new Float64Array(left.length);
  renderOrganTrack(
    left,
    right,
    song.notes as PerformedNote[],
    song.tracks[0]!,
    {
      score: song,
      sampleRate: SR,
      samples: left.length,
      samplesPerTick: (SR * 60) / (song.tempoBpm * song.ticksPerBeat),
      tempoBpm: song.tempoBpm,
      ticksPerBeat: song.ticksPerBeat,
      ...(tuning ? { tuning } : {}),
    },
  );
  return [left, right];
}

/** Magnitude spectrum (Hann, zero-padded to 2^18). */
function spectrum(signal: Float64Array, from = 0): Float64Array {
  const n = 1 << 18;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const length = Math.min(n, signal.length - from);
  for (let i = 0; i < length; i += 1) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (length - 1));
    re[i] = signal[from + i]! * w;
  }
  fftInPlace(re, im);
  const mag = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k += 1) mag[k] = Math.hypot(re[k]!, im[k]!);
  return mag;
}

const N = 1 << 18;

/** Frequency of the strongest peak within 3% of `hz` (parabolic refine). */
function peakNear(signal: Float64Array, hz: number, from = 0): number {
  const mag = spectrum(signal, from);
  const lo = Math.floor(((hz * 0.97) / SR) * N);
  const hi = Math.ceil(((hz * 1.03) / SR) * N);
  let best = lo;
  for (let k = lo; k <= hi; k += 1) if (mag[k]! > mag[best]!) best = k;
  const a = Math.log(mag[best - 1]!);
  const b = Math.log(mag[best]!);
  const c = Math.log(mag[best + 1]!);
  const offset = (0.5 * (a - c)) / (a - 2 * b + c);
  return ((best + offset) * SR) / N;
}

/** Peak magnitude in dB within 0.5% of `hz`. */
function levelAt(mag: Float64Array, hz: number): number {
  const lo = Math.floor(((hz * 0.995) / SR) * N);
  const hi = Math.ceil(((hz * 1.005) / SR) * N);
  let best = 0;
  for (let k = lo; k <= hi; k += 1) best = Math.max(best, mag[k]!);
  return 20 * Math.log10(best + 1e-300);
}

const cents = (a: number, b: number) => 1200 * Math.log2(a / b);
const sha = (pcm: Int16Array) =>
  createHash("sha256")
    .update(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength))
    .digest("hex");

function note(pitch: number, extra: Partial<OrganNote> = {}): OrganNote {
  return {
    pitch,
    hz: noteHz(pitch),
    hzOf: (p) => noteHz(p),
    startSec: 0,
    trackSeed: "organ:t",
    noteSeed: `t:${pitch}`,
    perc: 1,
    ...extra,
  };
}

/** A dry tonewheel: no scanner, drive, rotor or click. */
const DRY = { scanner: "off", drive: 0, rotary: "stop", click: 0 } as const;

describe("organ engines: registry and legacy", () => {
  test("tonewheel, combo and pipe run only with their id AND keys", () => {
    for (const id of ["tonewheel", "combo", "pipe"]) {
      expect(engineFor(score(id, {}, []).tracks[0]!)?.id).toBe(id);
      expect(engineFor(score(id, undefined, []).tracks[0]!)).toBeUndefined();
    }
    // `organ` stays the legacy sine word, never the engine.
    expect(engineFor(score("organ", {}, []).tracks[0]!)).toBeUndefined();
  });

  test("legacy organ renders byte-identically to 0.6.0", () => {
    // Pinned from origin/main 1314ab0 (v0.6.0).
    const legacy = createScore({
      tempoBpm: 120,
      bars: 1,
      tracks: [{ id: "a", name: "a", instrument: "organ" }],
      notes: [60, 64, 67].map((pitch, i) => ({
        id: `n${i}`,
        trackId: "a",
        pitch,
        startTick: i * 48,
        durationTicks: 192,
        velocity: 0.8,
      })),
    });
    expect(sha(renderScorePcm(legacy, { sampleRate: 22050 }).pcm)).toBe(
      "c3458b2a36f71d019c46e9b8dc1305e49fb6f30f44aa41a5783ab2b8a4f244de",
    );
  });

  test("organ renders are deterministic", () => {
    for (const id of ["tonewheel", "combo", "pipe"]) {
      const song = score(id, {}, [
        { pitch: 60 },
        { pitch: 64, start: 48 },
        { pitch: 67, start: 96 },
      ]);
      const one = sha(renderScorePcm(song, { sampleRate: SR }).pcm);
      expect(sha(renderScorePcm(song, { sampleRate: SR }).pcm)).toBe(one);
    }
  });
});

describe("tonewheel", () => {
  test("drawbar wheels follow wheelPitch foldback and noteHz", () => {
    const values = resolvedKeys("tonewheel", { drawbars: "888888888" });
    for (const pitch of [24, 36, 60, 84, 96, 108]) {
      const voice = new TonewheelVoice(note(pitch), values, 44100);
      for (let d = 0; d < 9; d += 1) {
        const wheel = wheelPitch(pitch + DRAWBAR_SEMITONES[d]!);
        expect(voice.wheels[d]).toBe(wheel);
        expect(wheel).toBeGreaterThanOrEqual(24);
        expect(wheel).toBeLessThanOrEqual(114);
        expect(Math.abs(cents(voice.wheelHz[d]!, noteHz(wheel)))).toBeLessThan(
          1e-9,
        );
      }
    }
    // 16' folds up in the bottom octave; 1' folds down at the top.
    expect(wheelPitch(12)).toBe(24);
    expect(wheelPitch(96 + 36)).toBe(108);
  });

  test("8' alone sounds within 1 cent of the key (12-TET and 19-EDO)", () => {
    for (const pitch of [36, 48, 60, 72, 84]) {
      const song = score("tonewheel", { ...DRY, drawbars: "008000000" }, [
        { pitch, dur: 480 * 2 },
      ]);
      const [left] = render(song, 1.2);
      const hz = noteHz(pitch);
      expect(Math.abs(cents(peakNear(left, hz, 2205), hz))).toBeLessThan(1);
    }
    const tuning = resolveTuning({ edo: 19 }, undefined)!;
    for (const pitch of [55, 62, 70, 80]) {
      const song = score("tonewheel", { ...DRY, drawbars: "008000000" }, [
        { pitch, dur: 480 * 2 },
      ]);
      const [left] = render(song, 1.2, tuning);
      const hz = tuning.hz[pitch]!;
      expect(Math.abs(cents(peakNear(left, hz, 2205), hz))).toBeLessThan(1);
    }
  });

  test("gospel: the 1' bar is muted (<= -150 dB) with percussion on", () => {
    const values = resolvedKeys("tonewheel", { preset: "gospel", ...DRY });
    expect(values.perc).toBe("3rd");
    expect(String(values.drawbars).at(-1)).toBe("8");
    const voice = new TonewheelVoice(note(60), values, SR);
    const out = new Float64Array(SR);
    voice.process(out, 0, out.length);
    const mag = spectrum(out, 2205);
    const eight = levelAt(mag, noteHz(60));
    const one = levelAt(mag, noteHz(96));
    expect(one - eight).toBeLessThanOrEqual(-150);
    // And with percussion off the 1' speaks.
    const open = new TonewheelVoice(
      note(60),
      resolvedKeys("tonewheel", { ...values, perc: "off" }),
      SR,
    );
    const out2 = new Float64Array(SR);
    open.process(out2, 0, out2.length);
    const mag2 = spectrum(out2, 2205);
    expect(
      levelAt(mag2, noteHz(96)) - levelAt(mag2, noteHz(60)),
    ).toBeGreaterThan(-10);
  });

  test("percussion: every chord note fires; a legato key joins decayed", () => {
    const keys = {
      ...DRY,
      drawbars: "008000000",
      perc: "3rd",
      percdecay: "fast",
    };
    const third = (pitch: number, song: TrackScore, from = 0) =>
      levelAt(
        spectrum(render(song, 0.6 + from / SR)[0], from),
        noteHz(pitch + 19),
      );
    const chord = score("tonewheel", keys, [
      { pitch: 60 },
      { pitch: 64 },
      { pitch: 67 },
    ]);
    for (const pitch of [60, 64, 67]) {
      const solo = score("tonewheel", keys, [{ pitch }]);
      expect(Math.abs(third(pitch, chord) - third(pitch, solo))).toBeLessThan(
        1,
      );
    }
    // 62 joins 0.5 s into a held 60: its percussion is the decayed tail.
    const legato = score("tonewheel", keys, [
      { pitch: 60, dur: 960 },
      { pitch: 62, start: 480, dur: 480 },
    ]);
    const solo = score("tonewheel", keys, [
      { pitch: 62, start: 480, dur: 480 },
    ]);
    const at = Math.round(0.5 * SR);
    expect(third(62, legato, at) - third(62, solo, at)).toBeLessThan(-30);
  });

  test("click 0 releases with a fade, not a step", () => {
    const values = resolvedKeys("tonewheel", {
      ...DRY,
      drawbars: "008000000",
    });
    const voice = new TonewheelVoice(note(69), values, SR);
    const before = new Float64Array(SR / 2);
    voice.process(before, 0, before.length);
    let steady = 0;
    for (let i = 1; i < before.length; i += 1)
      steady = Math.max(steady, Math.abs(before[i]! - before[i - 1]!));
    voice.noteOff();
    const after = new Float64Array(Math.round(0.01 * SR));
    voice.process(after, 0, after.length);
    let step = Math.abs(after[0]! - before.at(-1)!);
    for (let i = 1; i < after.length; i += 1)
      step = Math.max(step, Math.abs(after[i]! - after[i - 1]!));
    expect(step).toBeLessThanOrEqual(steady * 1.01);
    expect(Math.abs(after.at(-1)!)).toBeLessThan(0.01 * steady * 50);
  });

  test("wheels are phase-locked to song time, not reset per key", () => {
    const values = resolvedKeys("tonewheel", { ...DRY, drawbars: "008000000" });
    const a = new Float64Array(64);
    const b = new Float64Array(64);
    new TonewheelVoice(note(69, { startSec: 1 }), values, SR).process(a, 0, 64);
    new TonewheelVoice(note(69, { startSec: 1.0123 }), values, SR).process(
      b,
      0,
      64,
    );
    // Different start times, different wheel phases (a reset would match).
    let diff = 0;
    for (let i = 32; i < 64; i += 1) diff += Math.abs(a[i]! - b[i]!);
    expect(diff).toBeGreaterThan(1e-3);
  });
});

describe("rotary", () => {
  test("fast horn rate 6.7 +/- 0.3 Hz after spin-up from slow", () => {
    const seconds = 10;
    const total = seconds * SR;
    const left = new Float64Array(total);
    const right = new Float64Array(total);
    // A 3 kHz tone goes through the horn only.
    for (let i = 0; i < total; i += 1)
      left[i] = 0.3 * Math.sin((2 * Math.PI * 3000 * i) / SR);
    const post = new OrganPost(
      { scanner: "off", drive: 0, rotary: 1, rotor: true },
      SR,
    );
    post.process(left, right, total, () => 2);
    expect(Math.abs(post.hornHz - 6.7)).toBeLessThanOrEqual(0.3);
    // The measured amplitude modulation of the left mic, last 5 s.
    const block = 64;
    const env: number[] = [];
    for (let i = 5 * SR; i + block <= total; i += block) {
      let sum = 0;
      for (let s = i; s < i + block; s += 1) sum += left[s]! * left[s]!;
      env.push(Math.sqrt(sum / block));
    }
    const mean = env.reduce((a, b) => a + b, 0) / env.length;
    const rate = SR / block;
    let bestHz = 0;
    let best = 0;
    for (let hz = 3; hz <= 10; hz += 0.005) {
      let re = 0;
      let im = 0;
      for (let k = 0; k < env.length; k += 1) {
        const ph = (2 * Math.PI * hz * k) / rate;
        re += (env[k]! - mean) * Math.cos(ph);
        im += (env[k]! - mean) * Math.sin(ph);
      }
      const mag = Math.hypot(re, im);
      if (mag > best) {
        best = mag;
        bestHz = hz;
      }
    }
    expect(Math.abs(bestHz - 6.7)).toBeLessThanOrEqual(0.3);
  });

  test("stop bypasses the rotor (L equals R); slow and fast decorrelate", () => {
    const run = (rotary: string) => {
      const song = score(
        "tonewheel",
        { scanner: "off", drive: 0, click: 0, rotary },
        [{ pitch: 60, dur: 480 }],
      );
      return render(song, 1);
    };
    const [l0, r0] = run("stop");
    expect(l0).toEqual(r0);
    const [l1, r1] = run("fast");
    let diff = 0;
    for (let i = 0; i < l1.length; i += 1) diff += Math.abs(l1[i]! - r1[i]!);
    expect(diff).toBeGreaterThan(1);
  });

  test("the keys-rotary lane spins the rotor up mid-song", () => {
    const song = createScore({
      tempoBpm: 120,
      bars: 2,
      tracks: [
        {
          id: "o",
          name: "o",
          instrument: "tonewheel",
          keys: { rotary: "slow", scanner: "off" },
          fxAutomation: {
            "keys-rotary": [
              { tick: 0, value: 1 },
              { tick: 960, value: 1 },
              { tick: 961, value: 2 },
            ],
          },
        },
      ],
      notes: [
        {
          id: "n0",
          trackId: "o",
          pitch: 72,
          startTick: 0,
          durationTicks: 1920,
          velocity: 0.8,
        },
      ],
    } as Parameters<typeof createScore>[0]);
    const plain = score(
      "tonewheel",
      { rotary: "slow", scanner: "off" },
      [{ pitch: 72, dur: 1920 }],
      2,
    );
    const [a] = render(song, 4);
    const [b] = render(plain, 4);
    // Identical before the lane moves, different after.
    let first = -1;
    for (let i = 0; i < a.length && first < 0; i += 1)
      if (a[i] !== b[i]) first = i;
    // The lane crosses 1.5 (rounds to fast) half a tick before 1 s.
    expect(first).toBeGreaterThan(0.99 * SR);
    let diff = 0;
    for (let i = 1.5 * SR; i < 2 * SR; i += 1) diff += Math.abs(a[i]! - b[i]!);
    expect(diff).toBeGreaterThan(1);
  });
});

describe("pipe and combo", () => {
  test("pipe pitch within 1 cent of noteHz (12-TET and 19-EDO)", () => {
    const keys = { stops: "flute8", wind: 0, chiff: 0, trem: 0 };
    for (const pitch of [36, 48, 60, 72, 84]) {
      const [left] = render(
        score("pipe", keys, [{ pitch, dur: 480 * 2 }]),
        1.2,
      );
      const hz = noteHz(pitch);
      expect(Math.abs(cents(peakNear(left, hz, 4410), hz))).toBeLessThan(1);
    }
    const tuning = resolveTuning({ edo: 19 }, undefined)!;
    for (const pitch of [55, 62, 70, 80]) {
      const [left] = render(
        score("pipe", keys, [{ pitch, dur: 480 * 2 }]),
        1.2,
        tuning,
      );
      const hz = tuning.hz[pitch]!;
      expect(Math.abs(cents(peakNear(left, hz, 4410), hz))).toBeLessThan(1);
    }
  });

  test("pipe ranks are band-limited below 0.45 sr", () => {
    const values = resolvedKeys("pipe", { stops: "plenum" });
    for (const pitch of [36, 60, 96, 108]) {
      const voice = new PipeVoice(note(pitch), values, SR);
      expect(voice.ranks.length).toBeGreaterThan(0);
      for (const rank of voice.ranks) expect(rank.hz).toBeLessThan(0.45 * SR);
    }
  });

  test("combo 8' sounds within 1 cent with vibrato off", () => {
    for (const pitch of [48, 60, 72]) {
      const [left] = render(
        score("combo", { registers: "08000", vib: 0, vibmod: 0 }, [
          { pitch, dur: 480 * 2 },
        ]),
        1.2,
      );
      const hz = noteHz(pitch);
      expect(Math.abs(cents(peakNear(left, hz, 2205), hz))).toBeLessThan(1);
    }
  });
});

describe("tails and cost", () => {
  test("fold step: every family ends below -60 dB of its peak", () => {
    for (const id of ["tonewheel", "combo", "pipe"]) {
      const song = score(id, {}, [{ pitch: 48, dur: 960 }]);
      const audio = renderScorePcm(song, { sampleRate: SR }).pcm;
      let peak = 0;
      for (const s of audio) peak = Math.max(peak, Math.abs(s));
      const tail = Math.max(
        Math.abs(audio[audio.length - 1]!),
        Math.abs(audio[audio.length - 2]!),
      );
      expect(peak).toBeGreaterThan(1000);
      expect(20 * Math.log10((tail + 1e-9) / peak)).toBeLessThan(-60);
    }
  });

  test("cost <= 16x a saw voice per voice-second", () => {
    const time = (fn: () => void) => {
      fn();
      fn();
      let best = Infinity;
      for (let i = 0; i < 7; i += 1) {
        const t0 = performance.now();
        fn();
        best = Math.min(best, performance.now() - t0);
      }
      return best;
    };
    const out = new Float64Array(SR);
    const sawRun = () => {
      // The keys prototype's reference (as in engine.test.ts): a polyBLEP
      // saw, a biquad lowpass and an envelope, one voice at A1.
      const f = new Biquad2().set("lpf", 4000, 0.7, 0, SR);
      let phase = 0;
      let env = 0;
      const dt = 55 / SR;
      for (let i = 0; i < out.length; i += 1) {
        phase += dt;
        if (phase >= 1) phase -= 1;
        let y = 2 * phase - 1;
        if (phase < dt) {
          const t = phase / dt;
          y -= t + t - t * t - 1;
        } else if (phase > 1 - dt) {
          const t = (phase - 1) / dt;
          y -= t * t + t + t + 1;
        }
        env += (0.8 - env) * 0.003;
        out[i] = f.process(y) * env * 0.3;
      }
    };
    const cases: ["tonewheel" | "combo" | "pipe", Record<string, string>][] = [
      ["tonewheel", { drawbars: "888888888", perc: "3rd" }],
      ["combo", {}],
      ["pipe", { stops: "plenum" }],
    ];
    for (const [family, keys] of cases) {
      const values = resolvedKeys(family, keys);
      const organRun = () => {
        out.fill(0);
        organVoice(family, note(33), values, SR).process(out, 0, out.length);
      };
      // Saw and organ timed back to back, best of three pairs: a load spike
      // on a shared CI runner hits one pair, not the ratio of best times.
      let ratio = Infinity;
      for (let pair = 0; pair < 3; pair += 1)
        ratio = Math.min(ratio, time(organRun) / time(sawRun));
      expect(ratio).toBeLessThanOrEqual(16);
    }
  });
});

describe("live play", () => {
  test("8 s organ keys render inside the 60 ms lead; rotor shared", () => {
    for (const [instrument, keys] of [
      ["tonewheel", { preset: "gospel" }],
      ["combo", {}],
      ["pipe", { preset: "pipe" }],
    ] as const) {
      const song = score(instrument, keys, []);
      const times: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        const t0 = performance.now();
        new LiveSynth(22050).render({
          score: song,
          trackId: "o",
          pitch: 36 + i,
          velocity: 0.8,
          seconds: 8,
          tick: i * 100,
        });
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      expect(times[1]!).toBeLessThan(60);
    }
    // 48 kHz: an organ key renders a short first window, then the rest in
    // the background, so note-on stays well inside the lead.
    for (const [instrument, keys] of [
      ["tonewheel", { preset: "gospel" }],
      ["pipe", { preset: "pipe", stops: "full" }],
    ] as const) {
      const song = score(instrument, keys, []);
      const synth = new LiveSynth(48_000);
      const times: number[] = [];
      for (let i = 0; i < 20; i += 1) {
        const t0 = performance.now();
        synth.render({
          score: song,
          trackId: "o",
          pitch: 36 + i,
          velocity: 0.8,
          seconds: 8,
          tick: i * 97,
        });
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      // Inside the 60 ms lead at p95 (locally ~10 ms; a shared CI runner
      // measured 34-40 ms against an earlier 30 ms bound).
      expect(times[Math.floor(times.length * 0.95)]!).toBeLessThan(60);
    }
    // The same key at two song ticks: the free-running wheels and rotor
    // differ (not a restarted copy); at one tick it is identical.
    const song = score("tonewheel", { rotary: "fast" }, []);
    const synth = new LiveSynth(22050);
    const at = (tick: number) =>
      synth.render({
        score: song,
        trackId: "o",
        pitch: 60,
        velocity: 0.8,
        seconds: 0.5,
        tick,
      })!.pcm;
    expect(sha(at(480))).toBe(sha(at(480)));
    expect(sha(at(480))).not.toBe(sha(at(500)));
    expect(
      synth.render({
        score: song,
        trackId: "o",
        pitch: 60,
        velocity: 0.8,
        seconds: 0.5,
        tick: 480,
      })!.releaseSeconds,
    ).toBeGreaterThan(0);
  });
});

describe("arranged windows", () => {
  /** A held-chord song over 30 s with a tempo change (windowed export). */
  function long(
    instrument: string,
    keys: Record<string, string | number>,
    lane = false,
  ): TrackScore {
    const bars = 26;
    const notes = [];
    for (let bar = 0; bar < bars; bar += 1)
      for (const [j, pitch] of [48, 60].entries())
        notes.push({
          id: `n${bar}-${j}`,
          trackId: "o",
          pitch: pitch + (bar % 3),
          startTick: bar * 1920,
          durationTicks: 1920,
          velocity: 0.5,
        });
    return createScore({
      tempoBpm: 120,
      bars,
      tracks: [
        {
          id: "o",
          name: "o",
          instrument,
          keys,
          volume: 0.5,
          ...(lane
            ? {
                fxAutomation: {
                  "keys-rotary": [
                    { tick: 0, value: 1 },
                    { tick: 8 * 1920, value: 2 },
                    { tick: 14 * 1920, value: 0 },
                    { tick: 18 * 1920, value: 2 },
                  ],
                },
              }
            : {}),
        },
      ],
      notes,
    } as Parameters<typeof createScore>[0]).withTime({
      tempo: [{ tick: 5 * 1920, bpm: 100 }],
    });
  }

  /** Worst per-second error of `a` against `b`, in dB of `b`'s RMS. */
  function worstDb(a: Int16Array, b: Int16Array, rate: number): number {
    const step = rate * 2;
    let worst = -Infinity;
    for (let at = 0; at + step <= Math.min(a.length, b.length); at += step) {
      let e = 0;
      let r = 0;
      for (let i = at; i < at + step; i += 1) {
        e += (a[i]! - b[i]!) ** 2;
        r += b[i]! ** 2;
      }
      if (r > 0) worst = Math.max(worst, 10 * Math.log10(e / r + 1e-30));
    }
    return worst;
  }

  for (const [instrument, keys, lane] of [
    ["tonewheel", { preset: "gospel" }, false],
    ["combo", {}, false],
    ["pipe", { preset: "pipe" }, false],
    ["tonewheel", { rotary: "slow" }, true],
  ] as const)
    test(`${instrument}${lane ? " + rotary lane" : ""}: windows match one pass`, () => {
      const song = long(instrument, keys, lane);
      const rate = 22050;
      const one = renderScorePcm(song, { sampleRate: rate, maxSeconds: 60 });
      const windowed = renderArrangedPcm(song, { sampleRate: rate });
      expect(windowed.frames).toBeGreaterThan(30 * rate);
      // Before the fix the wheels decorrelated at the first seam (+1..+3 dB).
      // The modelled grand, which carries no song-clock state, measures
      // about -21 dB here; organs must do at least as well.
      expect(worstDb(windowed.pcm, one.pcm, rate)).toBeLessThan(-25);
    }, 60_000);
});

describe("tuning and level", () => {
  test("19-EDO: footages are octaves of the table, not key counts", () => {
    const tuning = resolveTuning({ edo: 19 }, undefined)!;
    const f8 = tuning.hz[60]!;
    for (const [bars, octave] of [
      ["800000000", -1],
      ["000800000", 1],
      ["000008000", 2],
    ] as const) {
      const song = score("tonewheel", { ...DRY, drawbars: bars }, [
        { pitch: 60, dur: 480 * 2 },
      ]);
      const [left] = render(song, 1.2, tuning);
      const want = f8 * 2 ** octave;
      expect(Math.abs(cents(peakNear(left, want, 2205), want))).toBeLessThan(1);
    }
    // Pipe octave ranks too.
    const [left] = render(
      score("pipe", { stops: "octave4", wind: 0, chiff: 0, trem: 0 }, [
        { pitch: 60, dur: 960 },
      ]),
      1.2,
      tuning,
    );
    expect(Math.abs(cents(peakNear(left, 2 * f8, 4410), 2 * f8))).toBeLessThan(
      1,
    );
  });

  test("pipe mutations are pure: the cornet tierce sits on 5·f1", () => {
    const values = resolvedKeys("pipe", { stops: "cornet", wind: 0 });
    const voice = new PipeVoice(note(60), values, SR);
    const f1 = noteHz(60);
    const tierce = voice.ranks.find((r) => Math.abs(cents(r.hz, 5 * f1)) < 30);
    expect(tierce).toBeDefined();
    expect(Math.abs(cents(tierce!.hz, 5 * f1))).toBeLessThan(0.5);
    const quint = voice.ranks.find((r) => Math.abs(cents(r.hz, 3 * f1)) < 30)!;
    expect(Math.abs(cents(quint.hz, 3 * f1))).toBeLessThan(0.5);
  });

  test("drive changes timbre at a steady loudness", () => {
    const rms = (drive: number) => {
      const song = score(
        "tonewheel",
        { ...DRY, drawbars: "008000000", drive },
        [{ pitch: 60, dur: 960 }],
      );
      const [left] = render(song, 0.8);
      let sum = 0;
      for (let i = 2205; i < 13230; i += 1) sum += left[i]! ** 2;
      return 10 * Math.log10(sum / (13230 - 2205));
    };
    const base = rms(0);
    for (const drive of [0.35, 1])
      expect(Math.abs(rms(drive) - base)).toBeLessThan(1.5);
  });

  test("organ presets sit within 5 dB; a 4-note chord stays under -1 dBFS", () => {
    const levels: number[] = [];
    for (const [preset, family] of [
      ["tonewheel", "tonewheel"],
      ["gospel", "tonewheel"],
      ["jazzorgan", "tonewheel"],
      ["combo", "combo"],
      ["vox", "combo"],
      ["pipe", "pipe"],
      ["flutes", "pipe"],
      ["cornet", "pipe"],
      ["reeds", "pipe"],
      ["celeste", "pipe"],
    ] as const) {
      const [left] = render(
        score(family, { preset }, [{ pitch: 60, dur: 960 }]),
        0.8,
      );
      let sum = 0;
      for (let i = 2205; i < 13230; i += 1) sum += left[i]! ** 2;
      levels.push(10 * Math.log10(sum / (13230 - 2205)));
      const [l, r] = render(
        score(
          family,
          { preset },
          [48, 55, 60, 64].map((pitch) => ({ pitch, dur: 960 })),
        ),
        0.8,
      );
      let peak = 0;
      for (let i = 0; i < l.length; i += 1)
        peak = Math.max(peak, Math.abs(l[i]!), Math.abs(r[i]!));
      expect(20 * Math.log10(peak)).toBeLessThan(-1);
    }
    expect(Math.max(...levels) - Math.min(...levels)).toBeLessThan(5);
  });
});
