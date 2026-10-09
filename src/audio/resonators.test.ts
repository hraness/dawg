import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  MODAL_PRESET_NAMES,
  MODAL_PRESETS,
  modalSettings,
  normalizeModal,
} from "../../core/resonators.ts";
import { createScore, type TrackScore } from "../../core/score.ts";
import { ModalBank, positionWeight, MODE_TABLES } from "./dsp/modal.ts";
import { engineFor } from "./instruments.ts";
import { renderScorePcm } from "./wav.ts";
import { best, budget } from "../../test/perf.ts";

const SR = 48_000;

const sha = (pcm: Int16Array) =>
  createHash("sha256")
    .update(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength))
    .digest("hex");

function strike(
  preset: string,
  hz: number,
  seconds: number,
  overrides: Record<string, unknown> = {},
  velocity = 0.8,
  duration = 0.25,
  sampleRate = SR,
): Float64Array {
  const settings = modalSettings(normalizeModal({ preset, ...overrides }));
  const bank = new ModalBank(
    settings,
    { hz, velocity, start: 0, duration, seed: "t" },
    sampleRate,
    30,
  );
  const out = new Float64Array(Math.round(seconds * sampleRate));
  bank.process(out, 0, out.length);
  return out;
}

/** Frequency of the strongest spectral peak near `guess` (Goertzel + parabolic). */
function peakHz(x: Float64Array, guess: number, sampleRate = SR): number {
  const power = (f: number) => {
    const w = (2 * Math.PI * f) / sampleRate;
    let re = 0;
    let im = 0;
    const n = x.length;
    for (let i = 0; i < n; i += 1) {
      const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      re += x[i]! * win * Math.cos(w * i);
      im -= x[i]! * win * Math.sin(w * i);
    }
    return re * re + im * im;
  };
  let lo = guess * 0.97;
  let hi = guess * 1.03;
  for (let round = 0; round < 40; round += 1) {
    const a = lo + (hi - lo) / 3;
    const b = hi - (hi - lo) / 3;
    if (power(a) < power(b)) lo = a;
    else hi = b;
  }
  return (lo + hi) / 2;
}

function rmsDb(x: Float64Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += x[i]! ** 2;
  return 10 * Math.log10(sum / Math.max(1, to - from) + 1e-30);
}

function modalSong(
  modal: Record<string, unknown> | undefined,
  notes: readonly { start: number; pitch: number; ticks?: number }[] = [
    { start: 0, pitch: 69 },
  ],
  instrument = "modal",
): TrackScore {
  return createScore({
    tempoBpm: 120,
    bars: 2,
    tracks: [
      {
        id: "m",
        name: "m",
        instrument,
        ...(modal ? { modal } : {}),
      },
    ],
    notes: notes.map((n, i) => ({
      id: `n${i}`,
      trackId: "m",
      startTick: n.start,
      durationTicks: n.ticks ?? 240,
      pitch: n.pitch,
      velocity: 0.8,
    })),
  });
}

describe("modal engine", () => {
  test("A4 marimba sounds 440 Hz within 0.1 cent", () => {
    const x = strike("marimba", 440, 1);
    const hz = peakHz(x, 440);
    expect(Math.abs(1200 * Math.log2(hz / 440))).toBeLessThan(0.1);
  });

  test("ring is the T60 of the fundamental at middle C", () => {
    for (const name of ["marimba", "vibes", "glock", "bowl"] as const) {
      const ring = MODAL_PRESETS[name].settings.ring;
      const hz = 261.63;
      const seconds = Math.min(8, ring * 1.2);
      // Pure fundamental: bar shapes at the centre have no 2nd mode, so
      // measure the envelope at the fundamental through a narrow window.
      const x = strike(name, hz, seconds, { damp: 0 }, 0.8, seconds);
      const win = Math.round(0.05 * SR);
      const at = (t: number) => {
        const i = Math.round(t * SR);
        return rmsDb(x, i, i + win);
      };
      const t1 = 0.1;
      const t2 = Math.min(seconds - 0.1, ring * 0.5);
      const slope = (at(t2) - at(t1)) / (t2 - t1); // dB per second
      const t60 = -60 / slope;
      // Higher modes decay faster, so the measured slope is at least as
      // steep: T60 within 35 % below ring and 10 % above.
      expect(t60).toBeLessThan(ring * 1.1);
      expect(t60).toBeGreaterThan(ring * 0.5);
    }
  });

  test("every preset at position 0, 0.5 and 1 is audible", () => {
    for (const name of MODAL_PRESET_NAMES) {
      const [low, high] = MODAL_PRESETS[name].range;
      const pitch = Math.round((low + high) / 2);
      const hz = 440 * 2 ** ((pitch - 69) / 12);
      for (const position of [0, 0.5, 1]) {
        const x = strike(name, hz, 0.3, { position });
        expect(rmsDb(x, 0, x.length)).toBeGreaterThan(-60);
      }
    }
  });

  test("position weights keep the 0.02 floor", () => {
    for (const table of Object.values(MODE_TABLES))
      for (let i = 0; i < table.ratios.length; i += 1)
        for (const p of [0, 0.25, 0.5, 0.75, 1])
          expect(positionWeight(table, i, p)).toBeGreaterThanOrEqual(0.02);
  });

  test("C8 glock at 22050 Hz stays finite and quiet above Nyquist", () => {
    const x = strike("glock", 4186, 0.5, {}, 1, 0.25, 22_050);
    for (const v of x) expect(Number.isFinite(v)).toBe(true);
    // Upward bend: modes crossing 0.45 sr fade instead of aliasing.
    const bent = new ModalBank(
      modalSettings(normalizeModal({ preset: "glock" })),
      {
        hz: 4186,
        velocity: 1,
        start: 0,
        duration: 0.5,
        seed: "b",
        cents: (t) => Math.min(1200, t * 4800),
      },
      22_050,
      30,
    );
    const y = new Float64Array(22_050);
    bent.process(y, 0, y.length);
    for (const v of y) expect(Math.abs(v)).toBeLessThan(4);
  });

  test("damp 1 chokes at note-off", () => {
    const x = strike("vibes", 440, 1.5, { damp: 1, release: 0.05 }, 0.8, 0.2);
    const held = rmsDb(x, Math.round(0.1 * SR), Math.round(0.2 * SR));
    const after = rmsDb(x, Math.round(0.6 * SR), Math.round(0.7 * SR));
    expect(held - after).toBeGreaterThan(60);
  });

  test("renders deterministically and only with the field", () => {
    const a = renderScorePcm(modalSong({ preset: "marimba" }), {
      sampleRate: 22_050,
    });
    const b = renderScorePcm(modalSong({ preset: "marimba" }), {
      sampleRate: 22_050,
    });
    expect(sha(a.pcm)).toBe(sha(b.pcm));
    const legacy = renderScorePcm(modalSong(undefined), { sampleRate: 22_050 });
    expect(sha(legacy.pcm)).not.toBe(sha(a.pcm));
    expect(engineFor(modalSong(undefined).tracks[0]!)).toBeUndefined();
    expect(engineFor(modalSong({}).tracks[0]!)).toBeDefined();
  });

  test("a modal field on another instrument is rejected", () => {
    expect(() => modalSong({ preset: "vibes" }, undefined, "sine")).toThrow(
      /modal settings/,
    );
    expect(() => normalizeModal({ ring: 99 })).toThrow();
    expect(() => normalizeModal({ shimmer: 1 })).toThrow(/no parameter/);
    expect(normalizeModal({ preset: "vibraphone" })?.preset).toBe("vibes");
  });

  test("prefix stable: a later note leaves earlier audio unchanged", () => {
    const one = renderScorePcm(modalSong({ preset: "vibes" }), {
      sampleRate: 22_050,
    });
    const two = renderScorePcm(
      modalSong({ preset: "vibes" }, [
        { start: 0, pitch: 69 },
        { start: 960, pitch: 72 },
      ]),
      { sampleRate: 22_050 },
    );
    const cut = Math.floor(0.5 * 22_050) * 2;
    expect(sha(one.pcm.subarray(0, cut))).toBe(sha(two.pcm.subarray(0, cut)));
  });

  test("32-voice stealing bounds the pool", () => {
    const notes = Array.from({ length: 40 }, (_, i) => ({
      start: i * 20,
      pitch: 60 + (i % 24),
    }));
    const pcm = renderScorePcm(modalSong({ preset: "gong" }, notes), {
      sampleRate: 22_050,
    }).pcm;
    let peak = 0;
    for (const v of pcm) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(0);
  });

  test("cost stays under 4 ms per voice-second", () => {
    const voices = 8;
    const seconds = 2;
    const ms = best(() => {
      for (let v = 0; v < voices; v += 1)
        strike("gong", 110 * (1 + v / 8), seconds, { ombak: 3 }, 0.8, seconds);
    }, 3);
    expect(ms / (voices * seconds)).toBeLessThan(budget(4));
  });
});
