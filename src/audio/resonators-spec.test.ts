/**
 * Resonators spec section 9, modal subset (lane A1): pitch, tuning, bends,
 * inharmonicity, decay, ombak, motor, determinism goldens, velocity,
 * level, validation, surfaces and the resolver. Measurements follow the
 * spec: 22.05 kHz unless stated, velocity 0.8, peaks by Goertzel search
 * with a Hann window over 0.02..0.5 s.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { resolveInstrumentWord } from "../../core/instruments.ts";
import {
  instrumentPatchForWord,
  MODAL_PRESET_NAMES,
  MODAL_PRESETS,
  modalSettings,
  normalizeModal,
  type ModalPresetName,
} from "../../core/resonators.ts";
import { createScore, type TrackScore } from "../../core/score.ts";
import { applyModalCommand, parseModalCommand } from "../commands/modal.ts";
import { fft } from "./wavetable.ts";
import { ModalBank, MODE_TABLES, type ModalNote } from "./dsp/modal.ts";
import { renderScorePcm } from "./wav.ts";

const SR = 22_050;

function bank(
  preset: string,
  note: Partial<ModalNote> & { hz: number },
  seconds: number,
  overrides: Record<string, unknown> = {},
  sampleRate = SR,
): Float64Array {
  const settings = modalSettings(normalizeModal({ preset, ...overrides }));
  const voice = new ModalBank(
    settings,
    { velocity: 0.8, start: 0, duration: seconds, seed: "s", ...note },
    sampleRate,
    30,
  );
  const out = new Float64Array(Math.round(seconds * sampleRate));
  voice.process(out, 0, out.length);
  return out;
}

function power(
  x: Float64Array,
  f: number,
  sr: number,
  from = 0,
  to = x.length,
) {
  const w = (2 * Math.PI * f) / sr;
  let re = 0;
  let im = 0;
  const n = to - from;
  for (let i = 0; i < n; i += 1) {
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    re += x[from + i]! * win * Math.cos(w * i);
    im -= x[from + i]! * win * Math.sin(w * i);
  }
  return re * re + im * im;
}

/** Strongest peak within ±`span` (fraction) of `guess`. */
function peakHz(
  x: Float64Array,
  guess: number,
  sr = SR,
  from = 0,
  to = x.length,
  span = 0.02,
): number {
  // Coarse grid first so a neighbouring mode cannot trap the search.
  let best = guess;
  let bestP = -1;
  for (let k = -40; k <= 40; k += 1) {
    const f = guess * (1 + (span * k) / 40);
    const p = power(x, f, sr, from, to);
    if (p > bestP) {
      bestP = p;
      best = f;
    }
  }
  let lo = best * (1 - span / 40);
  let hi = best * (1 + span / 40);
  for (let round = 0; round < 40; round += 1) {
    const a = lo + (hi - lo) / 3;
    const b = hi - (hi - lo) / 3;
    if (power(x, a, sr, from, to) < power(x, b, sr, from, to)) lo = a;
    else hi = b;
  }
  return (lo + hi) / 2;
}

/**
 * Pitch of a note as the spec measures it: chimes by the strike partial
 * (ratio 2, the prototype's `pitchRatio`), split bodies (bowl, gong) by the
 * geometric centre of the twin peaks, anything else by the nearest peak.
 */
function pitchOf(
  name: string,
  x: Float64Array,
  hz: number,
  sr = SR,
  from = Math.round(0.02 * sr),
  to = x.length,
): number {
  if (name === "chimes") return peakHz(x, hz * 2, sr, from, to, 0.005) / 2;
  const split =
    MODE_TABLES[MODAL_PRESETS[name as ModalPresetName].settings.body].split;
  // An ombak twin pair (gangsa) sounds hz -+ ombak/2: the pitch is their
  // geometric centre.
  const ombak = MODAL_PRESETS[name as ModalPresetName].settings.ombak;
  if (ombak > 0) {
    const lo = peakHz(x, hz - ombak / 2, sr, from, to, ombak / 4 / hz);
    const hi = peakHz(x, hz + ombak / 2, sr, from, to, ombak / 4 / hz);
    return (
      Math.sqrt(lo * hi) * (hz / Math.sqrt((hz - ombak / 2) * (hz + ombak / 2)))
    );
  }
  if (split) {
    const lo = peakHz(x, hz * (1 - split / 2), sr, from, to, split / 4);
    const hi = peakHz(x, hz * (1 + split / 2), sr, from, to, split / 4);
    return Math.sqrt(lo * hi) / Math.sqrt((1 - split / 2) * (1 + split / 2));
  }
  return peakHz(x, hz, sr, from, to, 0.005);
}

const cents = (hz: number, target: number) => 1200 * Math.log2(hz / target);
const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

function rmsDb(x: Float64Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += x[i]! ** 2;
  return 10 * Math.log10(sum / Math.max(1, to - from) + 1e-30);
}

/** RMS envelope in `hop`-sample frames. */
function envelope(x: Float64Array, hop: number): Float64Array {
  const frames = Math.floor(x.length / hop);
  const env = new Float64Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    for (let i = f * hop; i < (f + 1) * hop; i += 1) sum += x[i]! ** 2;
    env[f] = Math.sqrt(sum / hop);
  }
  return env;
}

/** Modulation rate and depth of an envelope after removing its decay trend. */
function modulation(
  x: Float64Array,
  lo: number,
  hi: number,
  sr = SR,
): { hz: number; depth: number } {
  const hop = 64;
  const env = envelope(x, hop);
  const skip = Math.round((0.15 * sr) / hop);
  const log = Array.from(env.subarray(skip), (v) => Math.log(v + 1e-12));
  const n = log.length;
  const mean = log.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (i - n / 2) * (log[i]! - mean);
    sxx += (i - n / 2) ** 2;
  }
  const slope = sxy / sxx;
  const flat = new Float64Array(n);
  for (let i = 0; i < n; i += 1)
    flat[i] = Math.exp(log[i]! - mean - slope * (i - n / 2));
  const fr = sr / hop;
  let hz = lo;
  let best = -1;
  for (let f = lo; f <= hi; f += 0.02) {
    const p = power(flat, f, fr);
    if (p > best) {
      best = p;
      hz = f;
    }
  }
  let max = 0;
  let min = Infinity;
  for (const v of flat) {
    max = Math.max(max, v);
    min = Math.min(min, v);
  }
  return { hz, depth: (max - min) / (max + min) };
}

function song(
  track: Record<string, unknown>,
  notes: readonly Record<string, unknown>[],
  extra: Record<string, unknown> = {},
): TrackScore {
  return createScore({
    tempoBpm: 120,
    bars: 2,
    ...extra,
    tracks: [{ id: "m", name: "m", instrument: "modal", ...track }],
    notes: notes.map((n, i) => ({
      id: `n${i}`,
      trackId: "m",
      startTick: 0,
      durationTicks: 480,
      pitch: 69,
      velocity: 0.8,
      ...n,
    })),
  } as never);
}

function mono(score: TrackScore, sampleRate = SR): Float64Array {
  const { pcm } = renderScorePcm(score, { sampleRate });
  const out = new Float64Array(pcm.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = pcm[2 * i]! / 32768;
  return out;
}

const sha = (pcm: Int16Array) =>
  createHash("sha256")
    .update(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength))
    .digest("hex");

/** Five MIDI notes spread over a preset's range. */
function across(name: ModalPresetName): number[] {
  const [low, high] = MODAL_PRESETS[name].range;
  return [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(low + f * (high - low)));
}

describe("modal spec §9", () => {
  test("1. every preset measures within 0.5 cent at 22.05 and 48 kHz", () => {
    for (const sr of [22_050, 48_000])
      for (const name of MODAL_PRESET_NAMES)
        for (const midi of across(name)) {
          const hz = midiHz(midi);
          if (hz > 0.4 * sr) continue;
          const x = bank(name, { hz }, 0.5, { strikebend: 0, ombak: 0 }, sr);
          const from = Math.round(0.02 * sr);
          const measured = pitchOf(name, x, hz, sr, from, x.length);
          expect(Math.abs(cents(measured, hz))).toBeLessThan(0.5);
        }
  }, 60_000);

  test("3. A4 follows a tuning table that maps it to 433.4 Hz within 0.1 cent", () => {
    // 24-EDO with A4 an exact step: ref 433.4 moves every key by the ratio.
    const x = mono(
      song({ modal: { preset: "marimba" } }, [{ pitch: 69 }], {
        tuning: { edo: 12, ref: 433.4 },
      }),
    );
    const hz = peakHz(
      x,
      433.4,
      SR,
      Math.round(0.02 * SR),
      Math.round(0.5 * SR),
    );
    expect(Math.abs(cents(hz, 433.4))).toBeLessThan(0.1);
  });

  test("4. note cents: 13.69 cents flat lands within 1 cent for every preset", () => {
    for (const name of MODAL_PRESET_NAMES) {
      const [low, high] = MODAL_PRESETS[name].range;
      const midi = Math.round((low + high) / 2);
      const x = mono(
        song({ modal: { preset: name, strikebend: 0 } }, [
          { pitch: midi, cents: -13.69 },
        ]),
      );
      const target = midiHz(midi) * 2 ** (-13.69 / 1200);
      const hz = pitchOf(
        name,
        x,
        target,
        SR,
        Math.round(0.02 * SR),
        Math.round(0.5 * SR),
      );
      expect(Math.abs(cents(hz, target))).toBeLessThan(1);
    }
  });

  test("5. a +200 cent bend lands within 1 cent for every preset", () => {
    for (const name of MODAL_PRESET_NAMES) {
      const [low, high] = MODAL_PRESETS[name].range;
      const hz = midiHz(Math.round((low + high) / 2));
      const x = bank(
        name,
        { hz, cents: (t) => Math.min(200, (t / 0.3) * 200) },
        0.8,
        // A long ring keeps short presets (xylophone) measurable after the
        // ramp; ring changes decay only, never tuning.
        { strikebend: 0, ombak: 0, ring: 8 },
      );
      const target = hz * 2 ** (200 / 1200);
      const got = pitchOf(name, x, target, SR, Math.round(0.35 * SR), x.length);
      expect(Math.abs(cents(got, target))).toBeLessThan(1);
    }
  });

  test("6. inharmonic partials sit at the measured ratios", () => {
    const cases: [ModalPresetName, number, number, number][] = [
      ["marimba", 220, 3.99, 0.005],
      ["xylophone", 440, 3.0, 0.005],
      ["glock", 880, 2.756, 0.005],
      ["kalimba", 330, 6.1, 0.005],
    ];
    for (const [name, f0, ratio, tol] of cases) {
      const x = bank(name, { hz: f0 }, 0.5, { position: 0.1, hardness: 1 });
      const got = peakHz(
        x,
        f0 * ratio,
        SR,
        Math.round(0.02 * SR),
        x.length,
        0.02,
      );
      expect(Math.abs(got / f0 / ratio - 1)).toBeLessThan(tol);
    }
    // Timpani: (1,1) → (2,1) is a fifth (1.5×) within 1 %.
    const f = 110;
    const x = bank("timpani", { hz: f }, 0.6, { strikebend: 0, position: 0.6 });
    const got = peakHz(x, f * 1.5, SR, Math.round(0.05 * SR), x.length, 0.03);
    expect(Math.abs(got / f / 1.5 - 1)).toBeLessThan(0.01);
  });

  test("7. gong rings 10 s; damped vibes choke, the pedal lets them ring", () => {
    const slope = (x: Float64Array, t1: number, t2: number) => {
      const w = Math.round(0.05 * SR);
      const a = rmsDb(x, Math.round(t1 * SR), Math.round(t1 * SR) + w);
      const b = rmsDb(x, Math.round(t2 * SR), Math.round(t2 * SR) + w);
      return (b - a) / (t2 - t1);
    };
    const gong = bank("gong", { hz: 65.4 }, 6);
    expect(-60 / slope(gong, 1, 5.5)).toBeGreaterThanOrEqual(10);

    const tick = 22_050 / (2 * 480); // samples per tick at 120 BPM
    const note = [{ pitch: 69, durationTicks: 240 }];
    const off = Math.round(240 * tick);
    const choke = mono(
      song({ modal: { preset: "vibes", damp: 1, motordepth: 0 } }, note),
    );
    const held = rmsDb(choke, off - 2205, off);
    const release = 0.15 + 0.05;
    const after = rmsDb(
      choke,
      off + Math.round(release * SR),
      off + Math.round(release * SR) + 1102,
    );
    expect(held - after).toBeGreaterThan(60);

    const pedalled = mono(
      song(
        {
          modal: { preset: "vibes", damp: 1, motordepth: 0 },
          pedal: [{ tick: 0, state: "down" }],
        },
        note,
      ),
    );
    const free = mono(
      song({ modal: { preset: "vibes", damp: 0, motordepth: 0 } }, note),
    );
    const late = Math.round(1.2 * SR);
    expect(
      Math.abs(
        rmsDb(pedalled, late, late + 2205) - rmsDb(free, late, late + 2205),
      ),
    ).toBeLessThan(1);
  });

  test("8. ombak 7 Hz beats at 7 Hz ± 0.3", () => {
    const x = bank("gong", { hz: 440 }, 2.5, { ombak: 7, ring: 10 });
    expect(Math.abs(modulation(x, 3, 12).hz - 7)).toBeLessThan(0.3);
  });

  test("9. vibes motor 5.5 Hz depth 0.45, phase locked to song time", () => {
    const x = bank("vibes", { hz: 440 }, 2.5, {
      motor: 5.5,
      motordepth: 0.45,
      damp: 0,
    });
    const m = modulation(x, 3, 9);
    expect(Math.abs(m.hz - 5.5)).toBeLessThan(0.2);
    expect(m.depth).toBeGreaterThan(0.35);
    expect(m.depth).toBeLessThan(0.55);
    // The same note struck at two song times differs only by the motor
    // phase: a strike at t and one at t + 1/5.5 s are identical.
    const a = bank("vibes", { hz: 440, start: 1 }, 0.5, { damp: 0 });
    const b = bank("vibes", { hz: 440, start: 1 + 1 / 5.5 }, 0.5, { damp: 0 });
    for (let i = 0; i < a.length; i += 97) expect(b[i]!).toBeCloseTo(a[i]!, 6);
  });

  test("10. golden hashes for six presets at 22.05 kHz", () => {
    const golden: Record<string, string> = {};
    for (const name of [
      "marimba",
      "vibes",
      "glock",
      "mbira",
      "gong",
      "timpani",
    ] as const) {
      const score = song({ modal: { preset: name } }, [
        {
          pitch: Math.round(
            (MODAL_PRESETS[name].range[0] + MODAL_PRESETS[name].range[1]) / 2,
          ),
        },
        { pitch: MODAL_PRESETS[name].range[0] + 7, startTick: 480 },
      ]);
      const a = sha(renderScorePcm(score, { sampleRate: SR }).pcm);
      expect(sha(renderScorePcm(score, { sampleRate: SR }).pcm)).toBe(a);
      golden[name] = a.slice(0, 16);
    }
    expect(golden).toMatchSnapshot();
  });

  test("12. velocity brightens (centroid ×1.15) and louder (peak ×2.5)", () => {
    // Magnitude-weighted spectral centroid of the first 250 ms (the
    // prototype's measurement) under a falling half-Hann window, so the
    // attack, where mallet hardness lives, weighs most.
    const centroid = (x: Float64Array) => {
      const length = Math.round(0.25 * SR);
      let size = 1;
      while (size < length * 4) size *= 2;
      const re = new Float64Array(size);
      const im = new Float64Array(size);
      for (let i = 0; i < length; i += 1)
        re[i] = x[i]! * (0.5 + 0.5 * Math.cos((Math.PI * (i + 0.5)) / length));
      fft(re, im);
      let num = 0;
      let den = 0;
      for (let k = 1; k < size / 2; k += 1) {
        const m = Math.hypot(re[k]!, im[k]!);
        num += k * m;
        den += m;
      }
      return ((num / den) * SR) / size;
    };
    const peak = (x: Float64Array) =>
      x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    for (const name of MODAL_PRESET_NAMES) {
      const [low, high] = MODAL_PRESETS[name].range;
      const hz = midiHz(Math.round((low + high) / 2));
      const soft = bank(name, { hz, velocity: 0.3 }, 0.3);
      const hard = bank(name, { hz, velocity: 1 }, 0.3);
      expect(centroid(hard) / centroid(soft)).toBeGreaterThanOrEqual(1.15);
      expect(peak(hard) / peak(soft)).toBeGreaterThanOrEqual(2.5);
    }
  });

  test("13. levels: -12..-3 dBFS at 0.8, no clip in a 6-note chord at 1.0", () => {
    for (const name of MODAL_PRESET_NAMES) {
      const [low, high] = MODAL_PRESETS[name].range;
      const mid = Math.round((low + high) / 2);
      const one = mono(song({ modal: { preset: name } }, [{ pitch: mid }]));
      const peak = one.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      const db = 20 * Math.log10(peak);
      expect(db).toBeGreaterThan(-12);
      expect(db).toBeLessThan(-3);
      const chord = [0, 4, 7, 12, 16, 19].map((d) => ({
        pitch: Math.min(high, mid - 7 + d),
        velocity: 1,
      }));
      const { pcm } = renderScorePcm(song({ modal: { preset: name } }, chord), {
        sampleRate: SR,
      });
      let clipped = 0;
      for (const v of pcm) if (Math.abs(v) >= 32767) clipped += 1;
      expect(clipped).toBe(0);
    }
  });

  test("14. cost: at most 40 saw voices per modal voice; first block under 2 ms", () => {
    const notes = [0, 3, 7, 10, 14, 17, 21, 24].map((d) => ({
      pitch: 48 + d,
      durationTicks: 1920,
    }));
    const time = (track: Record<string, unknown>) => {
      const score = song(track, notes);
      renderScorePcm(score, { sampleRate: SR });
      let best = Infinity;
      for (let i = 0; i < 3; i += 1) {
        const t0 = performance.now();
        renderScorePcm(score, { sampleRate: SR });
        best = Math.min(best, performance.now() - t0);
      }
      return best;
    };
    const saw = time({ instrument: "saw" });
    for (const name of MODAL_PRESET_NAMES) {
      const ms = time({ modal: { preset: name } });
      expect(ms / saw).toBeLessThan(40);
    }
    const voice = new ModalBank(
      modalSettings(normalizeModal({ preset: "gong" })),
      { hz: 110, velocity: 0.8, start: 0, duration: 1, seed: "b" },
      SR,
      30,
    );
    const block = new Float64Array(128);
    const t0 = performance.now();
    voice.process(block, 0, 128);
    expect(performance.now() - t0).toBeLessThan(2);
  }, 60_000);

  test("15. identity: legacy words keep their tone; an empty modal field is the default preset", () => {
    const legacy = song({ instrument: "marimba" }, [{}]);
    expect(legacy.tracks[0]!.modal).toBeUndefined();
    const empty = song({ modal: {} }, [{}]);
    const marimba = song({ modal: { preset: "marimba" } }, [{}]);
    expect(sha(renderScorePcm(empty, { sampleRate: SR }).pcm)).toBe(
      sha(renderScorePcm(marimba, { sampleRate: SR }).pcm),
    );
    expect(sha(renderScorePcm(legacy, { sampleRate: SR }).pcm)).not.toBe(
      sha(renderScorePcm(marimba, { sampleRate: SR }).pcm),
    );
  });

  test("17. validation names the field and the range", () => {
    expect(() => normalizeModal({ hardness: 1.5 })).toThrow(/hardness.*0.*1/);
    expect(() => normalizeModal({ frobnicate: 1 })).toThrow(/frobnicate/);
    expect(() => normalizeModal({ mallet: "spoon" })).toThrow(/mallet/);
    expect(() => normalizeModal({ preset: "harp" })).toThrow(/preset/);
  });

  test("18. surfaces: a preset word makes a modal track; modal motor 4 sets it", () => {
    expect(instrumentPatchForWord("vibes")).toEqual({
      instrument: "modal",
      modal: { preset: "vibes" },
    });
    // The legacy word keeps the legacy voice (brief: byte-identical).
    expect(instrumentPatchForWord("marimba")).toEqual({
      instrument: "marimba",
    });
    const start = createScore({
      tracks: [{ id: "k", name: "k", instrument: "piano" }],
      notes: [],
    });
    const run = (score: TrackScore, text: string) => {
      const result = applyModalCommand(score, "k", parseModalCommand(text)!);
      if (!result.ok || !result.next) throw new Error(result.message);
      return result.next;
    };
    const next = run(run(start, "modal marimba"), "modal motor 4");
    expect(next.tracks[0]!.instrument).toBe("modal");
    expect(next.tracks[0]!.modal).toEqual({ preset: "marimba", motor: 4 });
    expect(run(next, "modal motor off").tracks[0]!.modal).toEqual({
      preset: "marimba",
    });
  });

  test("19. resolver: vibraphone → vibes, gongageng → gong, bell stays the synth", () => {
    expect(instrumentPatchForWord("vibraphone").modal?.preset).toBe("vibes");
    expect(instrumentPatchForWord("glockenspiel").modal?.preset).toBe("glock");
    expect(instrumentPatchForWord("tubular").modal?.preset).toBe("chimes");
    expect(instrumentPatchForWord("thumbpiano").modal?.preset).toBe("kalimba");
    expect(instrumentPatchForWord("gongageng").modal?.preset).toBe("gong");
    expect(resolveInstrumentWord("bell")?.instrument).not.toBe("modal");
    expect(instrumentPatchForWord("bell")).toEqual({ instrument: "bell" });
  });

  test("20. 64 simultaneous marimba notes stay deterministic", () => {
    const notes = Array.from({ length: 64 }, (_, i) => ({
      pitch: 45 + (i % 48),
      velocity: 0.5,
    }));
    const score = song({ modal: { preset: "marimba" } }, notes);
    const a = renderScorePcm(score, { sampleRate: SR }).pcm;
    expect(sha(renderScorePcm(score, { sampleRate: SR }).pcm)).toBe(sha(a));
    let peak = 0;
    for (const v of a) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(0);
  });

  test("28. a ghost note (velocity 0.3) sits 4..16 dB under a normal one", () => {
    for (const name of ["marimba", "vibes", "xylophone"] as const) {
      const loud = bank(name, { hz: 440, velocity: 0.8 }, 0.3);
      const ghost = bank(name, { hz: 440, velocity: 0.3 }, 0.3);
      const drop = rmsDb(loud, 0, loud.length) - rmsDb(ghost, 0, ghost.length);
      expect(drop).toBeGreaterThan(4);
      expect(drop).toBeLessThan(16);
    }
  });
});
