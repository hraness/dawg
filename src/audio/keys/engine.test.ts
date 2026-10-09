import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { PerformedNote } from "../../../core/expression.ts";
import { resolvedKeys } from "../../../core/keys.ts";
import { createScore, type TrackScore } from "../../../core/score.ts";
import { resolveTuning } from "../../../core/tuning.ts";
import { fftInPlace } from "../dsp/fft.ts";
import { engineFor } from "../instruments.ts";
import { LiveSynth } from "../live.ts";
import { renderScorePcm } from "../wav.ts";
import { Biquad2, MODE_CEILING } from "./dsp.ts";
import { KEYS_LIMITS, pianoParamsAt, renderKeysTrack } from "./engine.ts";
import {
  PianoVoice,
  physicalKey,
  pianoB,
  pianoF1,
  pianoPartial,
  stretchCents,
} from "./piano.ts";

const SR = 44100;

function score(
  keys: Record<string, number | string> | undefined,
  notes: {
    pitch: number;
    start?: number;
    dur?: number;
    vel?: number;
    id?: string;
  }[],
  extra: Record<string, unknown> = {},
  bars = 1,
): TrackScore {
  return createScore({
    tempoBpm: 120,
    bars,
    tracks: [
      {
        id: "p",
        name: "p",
        instrument: "grand",
        ...(keys ? { keys } : {}),
        ...extra,
      },
    ],
    notes: notes.map((n, i) => ({
      id: n.id ?? `n${i}`,
      trackId: "p",
      pitch: n.pitch,
      startTick: n.start ?? 0,
      durationTicks: n.dur ?? 96,
      velocity: n.vel ?? 0.8,
    })),
  } as Parameters<typeof createScore>[0]);
}

/** Renders a track directly through the engine (no effects chain). */
function render(
  song: TrackScore,
  seconds: number,
  tuning?: ReturnType<typeof resolveTuning>,
): [Float64Array, Float64Array] {
  const left = new Float64Array(Math.round(seconds * SR));
  const right = new Float64Array(left.length);
  const track = song.tracks[0]!;
  const samplesPerTick = (SR * 60) / (song.tempoBpm * song.ticksPerBeat);
  renderKeysTrack(left, right, song.notes as PerformedNote[], track, {
    score: song,
    sampleRate: SR,
    samples: left.length,
    samplesPerTick,
    tempoBpm: song.tempoBpm,
    ticksPerBeat: song.ticksPerBeat,
    ...(tuning ? { tuning } : {}),
  });
  return [left, right];
}

/** Frequency of the strongest spectral peak near `hz` (parabolic refine). */
function peakNear(signal: Float64Array, hz: number, from = 0): number {
  const n = 1 << 18;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const length = Math.min(n, signal.length - from);
  for (let i = 0; i < length; i += 1) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (length - 1));
    re[i] = signal[from + i]! * w;
  }
  fftInPlace(re, im);
  const mag = (k: number) => Math.hypot(re[k]!, im[k]!);
  const lo = Math.floor(((hz * 0.97) / SR) * n);
  const hi = Math.ceil(((hz * 1.03) / SR) * n);
  let best = lo;
  for (let k = lo; k <= hi; k += 1) if (mag(k) > mag(best)) best = k;
  const a = Math.log(mag(best - 1));
  const b = Math.log(mag(best));
  const c = Math.log(mag(best + 1));
  const offset = (0.5 * (a - c)) / (a - 2 * b + c);
  return ((best + offset) * SR) / n;
}

const cents = (a: number, b: number) => 1200 * Math.log2(a / b);
const sha = (pcm: Int16Array) =>
  createHash("sha256")
    .update(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength))
    .digest("hex");

describe("keys engine: registry", () => {
  test("runs only with a piano family AND keys", () => {
    expect(engineFor(score({}, []).tracks[0]!)?.id).toBe("grand");
    expect(engineFor(score(undefined, []).tracks[0]!)).toBeUndefined();
    const legacy = createScore({
      tempoBpm: 120,
      bars: 1,
      tracks: [{ id: "a", name: "a", instrument: "piano" }],
      notes: [],
    });
    expect(engineFor(legacy.tracks[0]!)).toBeUndefined();
  });
});

describe("keys engine: pitch", () => {
  test("partial 1 within 1 cent of the key at stretch 0", () => {
    for (const pitch of [45, 57, 69, 81]) {
      const song = score({ stretch: 0 }, [{ pitch, dur: 480 }]);
      const [left] = render(song, 3);
      const hz = 440 * 2 ** ((pitch - 69) / 12);
      const measured = peakNear(left, hz, Math.round(0.1 * SR));
      expect(Math.abs(cents(measured, hz))).toBeLessThan(1);
    }
  });

  test("default stretch: octave partial 2 of A3 vs partial 1 of A4 beats < 1 Hz", () => {
    const values = resolvedKeys("grand", {});
    const p = pianoParamsAt(score({}, []).tracks[0]!, values, 0);
    expect(p.stretch).toBe(1);
    for (const low of [45, 57, 69]) {
      const f1Low = pianoF1(440 * 2 ** ((low - 69) / 12), p);
      const f1High = pianoF1(440 * 2 ** ((low + 12 - 69) / 12), p);
      // Partial 2 of the low note after Bank: n f1 sqrt(1+Bn^2)/sqrt(1+B).
      const second = pianoPartial(f1Low, pianoB(low, p.inharm), 2);
      expect(Math.abs(second - f1High)).toBeLessThan(1);
    }
    // The stretch widens the treble octaves (Railsback), never narrows them.
    expect(stretchCents(96, p.inharm)).toBeGreaterThan(
      stretchCents(84, p.inharm),
    );
  });

  test("19-EDO: keys follow the table, octave stretch keeps the period", () => {
    const tuning = resolveTuning({ edo: 19 }, undefined)!;
    const song = score({ stretch: 0 }, [{ pitch: 70, dur: 480 }]);
    const [left] = render(song, 3, tuning);
    const hz = tuning.hz[70]!;
    expect(Math.abs(cents(hz, 440 * 2 ** (1 / 12)))).toBeGreaterThan(5);
    const measured = peakNear(left, hz, Math.round(0.1 * SR));
    expect(Math.abs(cents(measured, hz))).toBeLessThan(1);
  });

  test("19-EDO: physical B from the sounding frequency, octave beat < 1 Hz", () => {
    const tuning = resolveTuning({ edo: 19 }, undefined)!;
    const p = pianoParamsAt(
      score({}, []).tracks[0]!,
      resolvedKeys("grand", {}),
      0,
    );
    // 41 -> 60 is one 19-EDO octave (C3 -> C4).
    const f1Low = pianoF1(tuning.hz[41]!, p);
    const f1High = pianoF1(tuning.hz[60]!, p);
    const b = pianoB(physicalKey(tuning.hz[41]!), p.inharm);
    expect(Math.abs(pianoPartial(f1Low, b, 2) - f1High)).toBeLessThan(1);
    // Key 89 sounds near 754 Hz (F#5): a damped key, not an F6.
    expect(physicalKey(tuning.hz[89]!)).toBeLessThan(80);
    expect(physicalKey(440)).toBe(69);
  });

  test("19-EDO: a degree near 750 Hz is damped on key-off", () => {
    const tuning = resolveTuning({ edo: 19 }, undefined)!;
    const rms = (dur: number) => {
      const [left] = render(score({}, [{ pitch: 89, dur }]), 2, tuning);
      let sum = 0;
      const a = Math.round(1.2 * SR);
      const b = Math.round(1.8 * SR);
      for (let i = a; i < b; i += 1) sum += left[i]! ** 2;
      return Math.sqrt(sum / (b - a));
    };
    expect(20 * Math.log10(rms(48) / rms(960))).toBeLessThan(-30);
  });

  test("an unmapped degree is silent", () => {
    // A table that maps only every other key (a .kbm with gaps).
    const hz = new Float64Array(128);
    for (let k = 0; k < 128; k += 2) hz[k] = 440 * 2 ** ((k - 69) / 12);
    const table = { hz, size: 12, period: 1200, root: 60, linear: false };
    const unmapped = [...table.hz.keys()].find((k) => !(table.hz[k]! > 0));
    expect(unmapped).toBeDefined();
    const song = score({}, [{ pitch: unmapped! }]);
    const [left, right] = render(song, 1, table as never);
    expect(left.every((x) => x === 0)).toBe(true);
    expect(right.every((x) => x === 0)).toBe(true);
  });
});

describe("keys engine: alias and cost", () => {
  test("a bend above the ceiling mutes modes: alias <= -100 dB", () => {
    // C8 with partials near Nyquist, bent up two octaves.
    const song = score({ stretch: 0 }, [{ pitch: 108, dur: 480, vel: 1 }]);
    const track = song.tracks[0]!;
    const values = resolvedKeys("grand", track.keys);
    const p = pianoParamsAt(track, values, 0);
    const voice = new PianoVoice(
      {
        pitch: 108,
        hz: 4186,
        velocity: 1,
        trackSeed: 1,
        noteSeed: "bend",
      },
      p,
      SR,
    );
    const out = new Float64Array(SR);
    voice.process(out, 0, 2048);
    voice.setCents(2400);
    const tail = new Float64Array(SR);
    voice.process(tail, 0, SR);
    // 4186 * 4 = 16.7 kHz < 0.45 sr, so partial 1 still sounds; every
    // partial above 0.45 sr is muted, so nothing folds below 16 kHz.
    const n = 1 << 15;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i += 1)
      re[i] =
        tail[4096 + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
    fftInPlace(re, im);
    let peak = 0;
    let alias = 0;
    for (let k = 1; k < n / 2; k += 1) {
      const hz = (k * SR) / n;
      const m = Math.hypot(re[k]!, im[k]!);
      peak = Math.max(peak, m);
      if (hz > 200 && hz < 15000) alias = Math.max(alias, m);
    }
    expect(20 * Math.log10(alias / peak)).toBeLessThanOrEqual(-100);
    expect(MODE_CEILING).toBe(0.45);
  });

  test("cost <= 16x a saw voice per voice-second", () => {
    const seconds = 2;
    const song = score({}, [{ pitch: 33, dur: 480 * 4 }], {}, 2);
    const time = (fn: () => void) => {
      fn();
      const t0 = performance.now();
      for (let i = 0; i < 3; i += 1) fn();
      return (performance.now() - t0) / 3;
    };
    const piano = time(() => render(song, seconds));
    const out = new Float64Array(seconds * SR);
    const saw = time(() => {
      // The prototype's reference: a polyBLEP saw, a biquad lowpass and an
      // envelope, one voice at A2.
      const f = new Biquad2().set("lpf", 4000, 0.7, 0, SR);
      const dt = 110 / SR;
      let phase = 0;
      let env = 0;
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
    });
    // Floor the saw at 0.5 ms so timer noise cannot fail a fast machine.
    expect(piano).toBeLessThanOrEqual(16 * Math.max(saw, 0.5));
  });
});

describe("keys engine: tails and determinism", () => {
  test("every voice ends inside the 8 s window with a taper", () => {
    const song = score({}, [{ pitch: 21, dur: 96, vel: 1 }], {
      pedal: [{ tick: 0, state: "down" }],
    });
    const [left] = render(song, 10);
    const end = Math.round((0.5 + KEYS_LIMITS.tailSeconds) * SR);
    // Only the body EQ's decaying state remains past the window.
    let after = 0;
    for (let i = end; i < left.length; i += 1)
      after = Math.max(after, Math.abs(left[i]!));
    expect(after).toBeLessThan(1e-9);
    // The last 10 ms before the end is far below the note's peak.
    let peak = 0;
    for (const x of left) peak = Math.max(peak, Math.abs(x));
    let late = 0;
    for (let i = end - Math.round(0.01 * SR); i < end; i += 1)
      late = Math.max(late, Math.abs(left[i]!));
    expect(late / peak).toBeLessThan(1e-3);
  });

  test("byte-identical renders; legacy piano unchanged by the engine", () => {
    const song = score({ preset: "grand" }, [
      { pitch: 60 },
      { pitch: 64, start: 48 },
      { pitch: 67, start: 96 },
    ]);
    const one = sha(renderScorePcm(song, { sampleRate: 22050 }).pcm);
    expect(sha(renderScorePcm(song, { sampleRate: 22050 }).pcm)).toBe(one);
    const legacy = createScore({
      tempoBpm: 120,
      bars: 1,
      tracks: [{ id: "a", name: "a", instrument: "piano" }],
      notes: [
        {
          id: "n",
          trackId: "a",
          pitch: 60,
          startTick: 0,
          durationTicks: 96,
          velocity: 0.8,
        },
      ],
    });
    expect(engineFor(legacy.tracks[0]!)).toBeUndefined();
    expect(sha(renderScorePcm(legacy, { sampleRate: 22050 }).pcm)).not.toBe(
      one,
    );
  });

  test("stealing caps polyphony at 64 voices: the oldest goes", () => {
    const notes = Array.from({ length: 65 }, (_, i) => ({
      id: `n${i}`,
      pitch: 36 + (i % 60),
      start: i * 2,
      dur: 960,
    }));
    const [all] = render(score({}, notes), 1.5);
    const [without] = render(score({}, notes.slice(1)), 1.5);
    expect(all.every((x) => Number.isFinite(x))).toBe(true);
    // After the 65th onset and the 5 ms steal fade the first voice is gone.
    const tps = (SR * 60) / (120 * score({}, []).ticksPerBeat);
    const from = Math.ceil(128 * tps + 0.01 * SR);
    let peak = 0;
    let diff = 0;
    for (let i = from; i < all.length; i += 1) {
      peak = Math.max(peak, Math.abs(without[i]!));
      diff = Math.max(diff, Math.abs(all[i]! - without[i]!));
    }
    expect(peak).toBeGreaterThan(0);
    expect(20 * Math.log10(diff / peak)).toBeLessThan(-80);
  });

  test("stealing takes the oldest released voice before an older held one", () => {
    // n0 is held throughout; n1 starts later but is released early.
    const notes = [
      { id: "n0", pitch: 40, start: 0, dur: 960 },
      { id: "n1", pitch: 41, start: 2, dur: 4 },
      ...Array.from({ length: 63 }, (_, i) => ({
        id: `m${i}`,
        pitch: 42 + (i % 50),
        start: 20 + i * 2,
        dur: 960,
      })),
    ];
    const [all] = render(score({}, notes), 1.5);
    const [noReleased] = render(
      score(
        {},
        notes.filter((n) => n.id !== "n1"),
      ),
      1.5,
    );
    const [noHeld] = render(
      score(
        {},
        notes.filter((n) => n.id !== "n0"),
      ),
      1.5,
    );
    const tps = (SR * 60) / (120 * score({}, []).ticksPerBeat);
    const from = Math.ceil((20 + 62 * 2) * tps + 0.01 * SR);
    let peak = 0;
    let released = 0;
    let held = 0;
    for (let i = from; i < all.length; i += 1) {
      peak = Math.max(peak, Math.abs(noReleased[i]!));
      released = Math.max(released, Math.abs(all[i]! - noReleased[i]!));
      held = Math.max(held, Math.abs(all[i]! - noHeld[i]!));
    }
    // The released n1 was stolen; the held n0 still sounds.
    expect(20 * Math.log10(released / peak)).toBeLessThan(-80);
    expect(20 * Math.log10(held / peak)).toBeGreaterThan(-60);
  });

  test("live notes carry the damper as their release; F6 up rings on", () => {
    const live = (pitch: number, keys: Record<string, number> = {}) =>
      new LiveSynth(22050).render({
        score: score(keys, [{ pitch }]),
        trackId: "p",
        pitch,
        velocity: 0.8,
        seconds: 0.2,
      })!;
    const c4 = live(60, { release: 1 });
    expect(c4.pcm.some((x) => x !== 0)).toBe(true);
    expect(c4.releaseSeconds!).toBeGreaterThan(0);
    expect(c4.releaseSeconds!).toBeLessThan(1);
    // Lower keys damp more slowly; a longer `release` lengthens the fade.
    expect(live(36).releaseSeconds!).toBeGreaterThan(c4.releaseSeconds!);
    expect(live(60, { release: 3 }).releaseSeconds!).toBeGreaterThan(
      c4.releaseSeconds!,
    );
    // No dampers from F6 (89) up: the note rings through the window.
    expect(live(90).releaseSeconds!).toBe(KEYS_LIMITS.tailSeconds);
  });
});
