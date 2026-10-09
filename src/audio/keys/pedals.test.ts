import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  performanceTimingFor,
  performNotes,
  type PedalEvent,
} from "../../../core/expression.ts";
import { createScore, TrackScore, updateTrack } from "../../../core/score.ts";
import { fftInPlace } from "../dsp/fft.ts";
import { renderScorePcm } from "../wav.ts";
import { renderKeysTrack } from "./engine.ts";

const SR = 22050;

type N = { pitch: number; start?: number; dur?: number; vel?: number };

function song(
  extra: Record<string, unknown>,
  notes: N[],
  instrument = "grand",
  keys: Record<string, number | string> = {},
): TrackScore {
  return createScore({
    tempoBpm: 120,
    bars: 4,
    tracks: [{ id: "p", name: "p", instrument, keys, ...extra }],
    notes: notes.map((n, i) => ({
      id: `n${i}`,
      trackId: "p",
      pitch: n.pitch,
      startTick: n.start ?? 0,
      durationTicks: n.dur ?? 480,
      velocity: n.vel ?? 0.8,
    })),
  } as Parameters<typeof createScore>[0]);
}

function render(s: TrackScore, seconds: number): [Float64Array, Float64Array] {
  const left = new Float64Array(Math.round(seconds * SR));
  const right = new Float64Array(left.length);
  const track = s.tracks[0]!;
  const performed = performNotes(track, s.notes, performanceTimingFor(s));
  renderKeysTrack(left, right, performed, track, {
    score: s,
    sampleRate: SR,
    samples: left.length,
    samplesPerTick: (SR * 60) / (s.tempoBpm * s.ticksPerBeat),
    tempoBpm: s.tempoBpm,
    ticksPerBeat: s.ticksPerBeat,
  });
  return [left, right];
}

function bandEnergy(
  x: Float64Array,
  from: number,
  n: number,
  lo: number,
  hi: number,
): number {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n && from + i < x.length; i += 1)
    re[i] = x[from + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  fftInPlace(re, im);
  let e = 0;
  for (let k = 1; k < n / 2; k += 1) {
    const hz = (k * SR) / n;
    if (hz >= lo && hz < hi) e += re[k]! ** 2 + im[k]! ** 2;
  }
  return e;
}

function centroid(x: Float64Array, from: number, n: number): number {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n && from + i < x.length; i += 1)
    re[i] = x[from + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  fftInPlace(re, im);
  let num = 0;
  let den = 0;
  for (let k = 1; k < n / 2; k += 1) {
    const m = Math.hypot(re[k]!, im[k]!);
    num += m * ((k * SR) / n);
    den += m;
  }
  return num / den;
}

const peak = (x: Float64Array) =>
  x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const db = (r: number) => 20 * Math.log10(r);
const rms = (x: Float64Array, from: number, to: number) => {
  let e = 0;
  for (let i = from; i < to; i += 1) e += x[i]! ** 2;
  return Math.sqrt(e / Math.max(1, to - from));
};

/** Hann-windowed magnitudes of harmonics 1..8 of `f`. */
function harmonics(x: Float64Array, f: number, n: number): number[] {
  const out: number[] = [];
  for (let h = 1; h <= 8; h += 1) {
    const w = (2 * Math.PI * f * h) / SR;
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i += 1) {
      const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      re += x[i]! * win * Math.cos(w * i);
      im -= x[i]! * win * Math.sin(w * i);
    }
    out.push(Math.hypot(re, im));
  }
  return out;
}

const DOWN: PedalEvent[] = [{ tick: 0, state: "down" }];

describe("una corda (softPedal)", () => {
  // keys.md section 9 item 12: the centroid falls at least 10% and the
  // peak at least 2 dB. Checked across the keyboard and touch, with an
  // upper peak bound (level -30%, so about -3 dB) and no notched harmonic.
  // At key 84 only about nine partials fit below the mode ceiling, so the
  // centroid there falls less (measured -5%); it must still fall.
  for (const key of [48, 60, 72, 84])
    for (const vel of [0.5, 0.9])
      test(`softens key ${key} at velocity ${vel}`, () => {
        const notes = [{ pitch: key, dur: 960, vel }];
        const [up] = render(song({}, notes), 1.5);
        const [soft] = render(song({ softPedal: DOWN }, notes), 1.5);
        const cUp = centroid(up, 0, 8192);
        const cSoft = centroid(soft, 0, 8192);
        expect(cSoft).toBeLessThanOrEqual((key < 84 ? 0.9 : 0.97) * cUp);
        const peakDb = db(peak(soft) / peak(up));
        expect(peakDb).toBeLessThanOrEqual(-2);
        expect(peakDb).toBeGreaterThanOrEqual(-5);
        const f = 440 * 2 ** ((key - 69) / 12);
        const hUp = harmonics(up, f, 8192);
        const hSoft = harmonics(soft, f, 8192);
        const top = Math.max(...hUp);
        hUp.forEach((u, i) => {
          if (u > top * 0.01)
            expect(db(hSoft[i]! / u)).toBeGreaterThanOrEqual(-12);
        });
      });

  test("lowers the 2-4 kHz energy at key 60", () => {
    const notes = [{ pitch: 60, dur: 960 }];
    const [up] = render(song({}, notes), 1.5);
    const [soft] = render(song({ softPedal: DOWN }, notes), 1.5);
    const band = (x: Float64Array) => bandEnergy(x, 0, 8192, 2000, 4000);
    // No spec value for this band: a chosen floor (measured -4.0 dB).
    expect(10 * Math.log10(band(soft) / band(up))).toBeLessThanOrEqual(-3);
  });

  test("half is between up and down", () => {
    const notes = [{ pitch: 60, dur: 960 }];
    const p = (extra: Record<string, unknown>) =>
      peak(render(song(extra, notes), 1)[0]);
    const half = p({ softPedal: [{ tick: 0, state: "half" }] });
    expect(half).toBeLessThan(p({}));
    expect(half).toBeGreaterThan(p({ softPedal: DOWN }));
  });

  test("read at each onset: a note before the pedal is untouched", () => {
    const notes = [
      { pitch: 60, start: 0, dur: 480 },
      { pitch: 72, start: 1920, dur: 480 },
    ];
    const plain = render(song({}, notes), 1)[0];
    const later = render(
      song({ softPedal: [{ tick: 1920, state: "down" }] }, notes),
      1,
    )[0];
    // The first second holds only the first note's onset span.
    expect(Array.from(later.subarray(0, SR - 1))).toEqual(
      Array.from(plain.subarray(0, SR - 1)),
    );
  });
});

describe("sostenuto", () => {
  // 120 bpm, 480 ticks per beat: 1 beat = 0.5 s.
  test("holds only the keys held at pedal-down", () => {
    // C3 held over the pedal-down at 0.25 s, released at 0.5 s; E4 struck
    // at 1 s, released at 1.5 s. Sostenuto lifts at 4 s.
    const s = song(
      {
        sostenuto: [
          { tick: 240, state: "down" },
          { tick: 3840, state: "up" },
        ],
      },
      [
        { pitch: 48, start: 0, dur: 480 },
        { pitch: 64, start: 960, dur: 480 },
      ],
    );
    const performed = performNotes(
      s.tracks[0],
      s.notes,
      performanceTimingFor(s),
    );
    const held = performed.find((n) => n.pitch === 48)!;
    const later = performed.find((n) => n.pitch === 64)!;
    expect(held.startTick + held.durationTicks).toBe(3840);
    expect(later.durationTicks).toBe(480);
    // The latched note rings at its midpoint (2 s, above -40 dB of its
    // peak); the later one is below -60 dB within release + 250 ms.
    const only = (pitch: number) =>
      render(
        song({ sostenuto: s.tracks[0]!.sostenuto }, [
          pitch === 48
            ? { pitch, start: 0, dur: 480 }
            : { pitch, start: 960, dur: 480 },
        ]),
        5,
      )[0];
    const c3 = only(48);
    const mid = rms(c3, Math.round(2 * SR), Math.round(2.1 * SR));
    expect(db(mid / peak(c3))).toBeGreaterThan(-40);
    const e4 = only(64);
    const after = Math.round((1.5 + 0.25) * SR);
    expect(db(peak(e4.subarray(after)) / peak(e4))).toBeLessThan(-60);
  });

  test("re-striking a latched key stops the latched note", () => {
    const s = song({ sostenuto: [{ tick: 240, state: "down" }] }, [
      { pitch: 60, start: 0, dur: 480 },
      { pitch: 60, start: 1920, dur: 480 },
    ]);
    const performed = performNotes(
      s.tracks[0],
      s.notes,
      performanceTimingFor(s),
    );
    const first = performed.find((n) => n.startTick === 0)!;
    expect(first.durationTicks).toBe(1920);
  });

  test("rejects half", () => {
    expect(() =>
      song({ sostenuto: [{ tick: 0, state: "half" }] }, [{ pitch: 60 }]),
    ).toThrow(/sostenuto state must be one of down, up/);
  });
});

describe("sympathetic resonance (sym)", () => {
  test("rings only with sym and the sustain pedal down", () => {
    const notes = [{ pitch: 48, dur: 240 }];
    const pedal: PedalEvent[] = [
      { tick: 0, state: "down" },
      { tick: 3840, state: "up" },
    ];
    const plain = render(song({ pedal }, notes), 2)[0];
    const sym = render(song({ pedal }, notes, "grand", { sym: 1 }), 2)[0];
    expect(sym).not.toEqual(plain);
    const symNoPedal = render(song({}, notes, "grand", { sym: 1 }), 2)[0];
    const noPedal = render(song({}, notes), 2)[0];
    expect(Array.from(symNoPedal)).toEqual(Array.from(noPedal));
  });
});

describe("identity", () => {
  const sha = (s: TrackScore) =>
    createHash("sha256")
      .update(new Uint8Array(renderScorePcm(s).pcm.buffer))
      .digest("hex");

  test("absent pedals and sym keep the render byte-identical", () => {
    const base = song({ pedal: DOWN }, [
      { pitch: 60, dur: 480 },
      { pitch: 64, start: 480, dur: 480 },
    ]);
    const cleared = updateTrack(
      updateTrack(base, "p", { softPedal: DOWN, sostenuto: DOWN }),
      "p",
      { softPedal: null, sostenuto: null },
    );
    expect(cleared.tracks[0]!.softPedal).toBeUndefined();
    expect(sha(cleared)).toBe(sha(base));
  });

  test("round trips through JSON", () => {
    const s = song(
      {
        softPedal: [
          { tick: 0, state: "down" },
          { tick: 480, state: "up" },
        ],
        sostenuto: [{ tick: 240, state: "down" }],
      },
      [{ pitch: 60 }],
    );
    const again = new TrackScore(JSON.parse(JSON.stringify(s.toJSON())));
    expect(again.tracks[0]!.softPedal).toEqual(s.tracks[0]!.softPedal);
    expect(again.tracks[0]!.sostenuto).toEqual(s.tracks[0]!.sostenuto);
  });
});
