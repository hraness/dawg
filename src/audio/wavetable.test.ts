import { describe, expect, test } from "bun:test";
import {
  createScore,
  scoreFromJSON,
  type TrackScore,
} from "../../core/score.ts";
import { wavBytes, withClm } from "./sample-fixtures.ts";
import { renderScorePcm } from "./wav.ts";
import { LiveSynth } from "./live.ts";
import {
  BUILTIN_TABLE_NAMES,
  DEFAULT_FRAME,
  analyzeFrame,
  builtinWavetable,
  clmFrameLength,
  fft,
  levelFor,
  sliceFrames,
  warpPhase,
  wavetableFromWav,
} from "./wavetable.ts";
import {
  describeWavetable,
  parseWavetableCommand,
  wavetableParamEdit,
  wavetableSource,
} from "../commands/wavetable.ts";

function cycle(length: number, harmonic: number, amplitude = 0.8): number[] {
  return Array.from(
    { length },
    (_, i) => amplitude * Math.sin((2 * Math.PI * harmonic * i) / length),
  );
}

function wavetableScore(
  table: string,
  pitch: number,
  extra: Record<string, unknown> = {},
  automation?: readonly { tick: number; value: number }[],
): TrackScore {
  return createScore({
    tempoBpm: 120,
    bars: 1,
    tracks: [
      {
        id: "lead",
        name: "lead",
        instrument: "wavetable",
        wavetable: { table: { src: `builtin:${table}` }, ...extra },
        ...(automation ? { wtAutomation: automation } : {}),
      },
    ],
    notes: [
      {
        id: "n",
        trackId: "lead",
        pitch,
        startTick: 0,
        durationTicks: 1_920,
        velocity: 1,
      },
    ],
  } as never);
}

/** Power per FFT bin of `length` mono samples starting at `from` (left channel). */
function spectrum(pcm: Int16Array, from: number, length: number): Float64Array {
  const re = new Float64Array(length);
  const im = new Float64Array(length);
  for (let i = 0; i < length; i += 1) {
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / length);
    re[i] = (pcm[(from + i) * 2]! / 32768) * hann;
  }
  fft(re, im);
  const power = new Float64Array(length / 2);
  for (let i = 0; i < length / 2; i += 1)
    power[i] = re[i]! * re[i]! + im[i]! * im[i]!;
  return power;
}

describe("wavetable files", () => {
  test("slices 2048-sample frames, honours clm, and treats odd lengths as one cycle", () => {
    const four = new Float32Array(4 * DEFAULT_FRAME);
    expect(sliceFrames(four)).toHaveLength(4);
    expect(sliceFrames(four, 256)).toHaveLength(32);
    expect(sliceFrames(new Float32Array(600))).toHaveLength(1);
    expect(sliceFrames(new Float32Array(600))[0]).toHaveLength(600);
    expect(() => sliceFrames(new Float32Array(4))).toThrow("too short");
    expect(() => sliceFrames(new Float32Array(10_000))).toThrow(
      "not a wavetable",
    );
  });

  test("decodes a clm-tagged WAV into frames whose spectra match each cycle", () => {
    const frame = 256;
    const data = [...cycle(frame, 1), ...cycle(frame, 3), ...cycle(frame, 7)];
    const bytes = withClm(wavBytes(data, { sampleRate: 44_100 }), frame);
    expect(clmFrameLength(bytes)).toBe(frame);
    const table = wavetableFromWav("t", "sha", bytes);
    expect(table.frames).toBe(3);
    [1, 3, 7].forEach((harmonic, index) => {
      const { re, im } = table.spectrum(index);
      let loudest = 0;
      for (let h = 1; h < re.length; h += 1)
        if (Math.hypot(re[h]!, im[h]!) > Math.hypot(re[loudest]!, im[loudest]!))
          loudest = h;
      expect(loudest).toBe(harmonic);
      expect(Math.hypot(re[harmonic]!, im[harmonic]!)).toBeCloseTo(0.8, 2);
    });
    // Without the chunk the same 768 samples are one single-cycle frame.
    expect(
      wavetableFromWav("t", "sha", wavBytes(data, { sampleRate: 44_100 }))
        .frames,
    ).toBe(1);
  });

  test("analyzeFrame recovers sine and cosine amplitudes", () => {
    const n = 512;
    const frame = Float64Array.from(
      { length: n },
      (_, i) =>
        0.5 * Math.sin((2 * Math.PI * 2 * i) / n) +
        0.25 * Math.cos((2 * Math.PI * 5 * i) / n),
    );
    const { re, im } = analyzeFrame(frame);
    expect(im[2]).toBeCloseTo(0.5, 6);
    expect(re[5]).toBeCloseTo(0.25, 6);
    expect(Math.abs(re[3]!) + Math.abs(im[3]!)).toBeLessThan(1e-9);
  });
});

describe("built-in tables", () => {
  test("every built-in is generated offline with normalized gain", () => {
    for (const name of BUILTIN_TABLE_NAMES) {
      const table = builtinWavetable(name)!;
      expect(table.frames).toBeGreaterThan(1);
      let peak = 0;
      const level = table.table(0, 0);
      for (const v of level) peak = Math.max(peak, Math.abs(v * table.gain()));
      expect(peak).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  test("the octave level keeps every harmonic under Nyquist", () => {
    const rate = 44_100;
    for (const hz of [27.5, 110, 440, 1760, 3520, 7040]) {
      const level = levelFor(hz, rate);
      expect((1024 >> level) * hz).toBeLessThanOrEqual(rate / 2);
      if (level > 0)
        expect((1024 >> (level - 1)) * hz).toBeGreaterThan(rate / 2);
    }
    expect(levelFor(30_000, rate)).toBe(-1);
  });

  test("warp maps stay inside one cycle and report their slope", () => {
    for (const mode of [
      "asym",
      "bendp",
      "bendm",
      "bendmp",
      "sync",
      "quant",
    ] as const) {
      const { map, slope } = warpPhase(mode, 0.7);
      expect(slope).toBeGreaterThanOrEqual(1);
      for (let p = 0; p < 1; p += 0.01) {
        const q = map(p);
        expect(q).toBeGreaterThanOrEqual(0);
        expect(q).toBeLessThan(1 + 1e-12);
      }
    }
    expect(warpPhase("bendp", 0).map(0.3)).toBe(0.3);
  });
});

describe("wavetable rendering", () => {
  test("a square at C8 has no energy folded back below Nyquist", () => {
    // C8 ≈ 4186 Hz at 44.1 kHz: only harmonics 1, 3 and 5 fit (5 = 20.9 kHz).
    // A naive square would fold 7 (29.3 kHz) to 14.8 kHz and 9 to 6.4 kHz.
    const rate = 44_100;
    const audio = renderScorePcm(wavetableScore("basic", 108, { wt: 1 }), {
      sampleRate: rate,
    });
    const size = 8192;
    const power = spectrum(audio.pcm, 4_000, size);
    const f0 = 440 * 2 ** ((108 - 69) / 12);
    const bin = (hz: number) => Math.round((hz * size) / rate);
    const near = (hz: number) => {
      let max = 0;
      for (let b = bin(hz) - 3; b <= bin(hz) + 3; b += 1)
        max = Math.max(max, power[b] ?? 0);
      return max;
    };
    const fundamental = near(f0);
    expect(fundamental).toBeGreaterThan(0);
    expect(near(3 * f0) / fundamental).toBeGreaterThan(0.05);
    // Where aliases of harmonics 7, 9, 11, 13 would land.
    for (const harmonic of [7, 9, 11, 13]) {
      let alias = (harmonic * f0) % rate;
      if (alias > rate / 2) alias = rate - alias;
      expect(near(alias) / fundamental).toBeLessThan(1e-4);
    }
  });

  test("position morphs the timbre: wt 0 is a sine, wt 1 has odd harmonics", () => {
    const rate = 22_050;
    const size = 4096;
    const third = (wt: number) => {
      const audio = renderScorePcm(wavetableScore("basic", 57, { wt }), {
        sampleRate: rate,
      });
      const power = spectrum(audio.pcm, 2_000, size);
      const bin = (hz: number) => Math.round((hz * size) / rate);
      const f0 = 220;
      const peak = (hz: number) =>
        Math.max(...[-2, -1, 0, 1, 2].map((d) => power[bin(hz) + d]!));
      return peak(3 * f0) / peak(f0);
    };
    const sine = third(0);
    const square = third(1);
    expect(sine).toBeLessThan(1e-4);
    expect(square).toBeGreaterThan(0.05);
    expect(third(0.5)).toBeGreaterThan(sine);
  });

  test("position automation changes the sound over the note", () => {
    const flat = renderScorePcm(wavetableScore("pwm", 60), {
      sampleRate: 8_000,
    });
    const swept = renderScorePcm(
      wavetableScore("pwm", 60, {}, [
        { tick: 0, value: 0 },
        { tick: 1_920, value: 1 },
      ]),
      { sampleRate: 8_000 },
    );
    const quarter = Math.floor(flat.pcm.length / 8) * 2;
    expect(swept.pcm.subarray(quarter * 3, quarter * 3 + 400)).not.toEqual(
      flat.pcm.subarray(quarter * 3, quarter * 3 + 400),
    );
  });

  test("renders are deterministic, including phase randomness", () => {
    const score = wavetableScore("formant", 48, {
      wt: 0.3,
      wtenv: 0.5,
      wtattack: 0.1,
      wtrate: 2,
      wtdepth: 0.4,
      warp: 0.5,
      warpmode: "bendp",
      wtphaserand: 1,
    });
    const a = renderScorePcm(score, { sampleRate: 8_000 });
    const b = renderScorePcm(scoreFromJSON(score.toJSON()), {
      sampleRate: 8_000,
    });
    expect(a.pcm).toEqual(b.pcm);
    expect(a.pcm.some((v) => v !== 0)).toBe(true);
  });
});

describe("synth voice integration", () => {
  test("synth parameters (attack, unison, lpf) shape a wavetable track", () => {
    const render = (synth?: Record<string, unknown>) => {
      const score = wavetableScore("basic", 57, { wt: 0.66 });
      const track = { ...score.tracks[0]!, ...(synth ? { synth } : {}) };
      return renderScorePcm(
        createScore({ ...score, tracks: [track] } as never),
        { sampleRate: 8_000 },
      ).pcm;
    };
    const plain = render();
    // A slow attack starts quieter.
    const slow = render({ attack: 0.5 });
    const head = (pcm: Int16Array) =>
      pcm.subarray(0, 1_600).reduce((sum, v) => sum + Math.abs(v), 0);
    expect(head(slow)).toBeLessThan(head(plain) / 2);
    // Detuned unison voices and a low-pass change the sound.
    expect(render({ unison: 3, detune: 0.3 })).not.toEqual(plain);
    expect(render({ lpf: 300 })).not.toEqual(plain);
  });
});

describe("live play", () => {
  test("a live key on a wavetable track sounds and follows the position", () => {
    const live = new LiveSynth(8_000);
    const key = (wt: number) =>
      live.render({
        score: wavetableScore("basic", 60, { wt }),
        trackId: "lead",
        pitch: 64,
        velocity: 0.8,
        seconds: 0.3,
      })!;
    const sine = key(0);
    expect(sine.pcm.some((v) => v !== 0)).toBe(true);
    expect(key(1).pcm).not.toEqual(sine.pcm);
  });
});

describe("wavetable score fields", () => {
  test("documents without wavetable fields decode unchanged; settings round-trip", () => {
    const plain = createScore({
      tracks: [{ id: "a", name: "a", instrument: "saw" }],
    });
    expect(JSON.stringify(scoreFromJSON(plain.toJSON()).toJSON())).toBe(
      JSON.stringify(plain.toJSON()),
    );
    expect(JSON.stringify(plain.toJSON())).not.toContain("wavetable");
    const score = wavetableScore("pwm", 60, { wt: 0.25, warpmode: "sync" }, [
      { tick: 0, value: 0.1 },
    ]);
    const again = scoreFromJSON(score.toJSON());
    expect(again.tracks[0]!.wavetable).toEqual(score.tracks[0]!.wavetable);
    expect(again.tracks[0]!.wtAutomation).toEqual([{ tick: 0, value: 0.1 }]);
  });

  test("clamps out-of-range numbers and rejects bad modes and names", () => {
    expect(
      wavetableScore("basic", 60, { wt: 2 }).tracks[0]!.wavetable?.wt,
    ).toBe(1);
    expect(() => wavetableScore("basic", 60, { wt: "x" })).toThrow();
    expect(() => wavetableScore("basic", 60, { warpmode: "bogus" })).toThrow();
    expect(() => wavetableScore("Bad Name", 60)).toThrow();
  });
});

describe("wavetable commands", () => {
  test("parses table, position, params and warp mode", () => {
    expect(parseWavetableCommand("wt")).toEqual({ kind: "show" });
    expect(parseWavetableCommand("/wt list")).toEqual({ kind: "list" });
    expect(parseWavetableCommand("wt 0.5")).toEqual({
      kind: "param",
      param: "wt",
      value: 0.5,
    });
    expect(parseWavetableCommand("wt wt_digital:2")).toEqual({
      kind: "table",
      table: "wt_digital:2",
    });
    expect(parseWavetableCommand("wtenv -0.5")).toEqual({
      kind: "param",
      param: "wtenv",
      value: -0.5,
    });
    expect(parseWavetableCommand("warpmode bendmp")).toEqual({
      kind: "warpmode",
      mode: "bendmp",
    });
    expect(parseWavetableCommand("/warp 7")?.kind).toBe("usage");
    // Prose is left for the agent.
    expect(parseWavetableCommand("warp the bass a bit")).toBeUndefined();
    expect(parseWavetableCommand("make a pad")).toBeUndefined();
  });

  test("maps names to built-ins, the uzu pack and pack refs", () => {
    expect(wavetableSource("basic")).toBe("builtin:basic");
    expect(wavetableSource("wt_vgame:3")).toBe(
      "pack:uzu-wavetables/wt_vgame:3",
    );
    expect(wavetableSource("dirt-samples/wt:1")).toBe("pack:dirt-samples/wt:1");
    expect(wavetableSource("nope")).toBeUndefined();
  });

  test("a parameter edit makes the track a wavetable track", () => {
    const score = createScore({
      tracks: [{ id: "keys", name: "keys", instrument: "piano" }],
    });
    const edit = wavetableParamEdit(score, "keys", {
      kind: "param",
      param: "wt",
      value: 0.4,
    });
    expect(edit.operation).toMatchObject({
      type: "updateTrack",
      patch: { instrument: "wavetable", wavetable: { wt: 0.4 } },
    });
    expect(describeWavetable(score, "keys")).toContain("not a wavetable");
  });
});
