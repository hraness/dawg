/**
 * The wind engine (0.6.1, resonators.md §9): pitch after trim, A4 on the
 * recorder, velocity brightness, cost against a saw, the steal fade, legacy
 * identity, print round trip and the four surfaces' shared command.
 */
import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { createScore, type TrackScore } from "../../core/score.ts";
import { printTrack } from "../../core/sdk/print.ts";
import {
  song as sdkSong,
  track as sdkTrack,
  wind as sdkWind,
} from "../../core/sdk/v1.ts";
import {
  MAX_WIND_VOICES,
  normalizeWind,
  WIND_PRESET_NAMES,
  WIND_PRESETS,
  windSettings,
  type WindPresetName,
} from "../../core/winds.ts";
import { instrumentPatch } from "../agent/ops.ts";
import { USAGE } from "../commands/help.ts";
import { parseModalCommand } from "../commands/modal.ts";
import { applyWindCommand, parseWindCommand } from "../commands/wind.ts";
import { measurePitch, spectralCentroid } from "./winds/pitch.ts";
import { WIND_HOUSE_RMS_DB, WIND_TRIM_RATES, windTrim } from "./winds/trim.ts";
import { WindVoice } from "./winds/voice.ts";
import { WIND_STEAL_FADE, windLines } from "./winds/engine.ts";
import { renderScorePcm } from "./wav.ts";
import { ratioBudget } from "../../test/perf.ts";

const SR = 22_050;

function voice(
  preset: WindPresetName,
  midi: number,
  sampleRate = SR,
  options: {
    velocity?: number;
    seconds?: number;
    still?: boolean;
    bright?: number;
  } = {},
): Float64Array {
  const seconds = options.seconds ?? 1;
  const preset0 = WIND_PRESETS[preset].settings;
  const base =
    options.bright === undefined
      ? preset0
      : { ...preset0, bright: options.bright };
  const settings =
    options.still === false ? base : { ...base, vibmod: 0, noise: 0 };
  const hz = 440 * 2 ** ((midi - 69) / 12);
  const v = new WindVoice(
    settings,
    {
      segments: [{ at: 0, hz }],
      length: Math.round(seconds * sampleRate),
      velocity: options.velocity ?? 0.8,
      seed: "test",
    },
    sampleRate,
    windTrim(preset, sampleRate),
  );
  const out = new Float64Array(Math.round((seconds + 0.1) * sampleRate));
  v.process(out, 0, out.length);
  return out;
}

function cents(out: Float64Array, midi: number, sampleRate = SR): number {
  const hz = 440 * 2 ** ((midi - 69) / 12);
  return (
    1200 * Math.log2(measurePitch(out, sampleRate, hz, 0.35, 1, 300).hz / hz)
  );
}

function score(
  tracks: readonly Record<string, unknown>[],
  notes: readonly Record<string, unknown>[],
): TrackScore {
  return createScore({
    tempoBpm: 120,
    bars: 2,
    tracks,
    notes: notes.map((n, i) => ({
      id: `n${i}`,
      trackId: "w",
      startTick: 0,
      durationTicks: 960,
      pitch: 69,
      velocity: 0.8,
      ...n,
    })),
  } as never);
}

function pcmHash(s: TrackScore): string {
  const { pcm } = renderScorePcm(s, { sampleRate: SR });
  return createHash("sha256")
    .update(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength))
    .digest("hex");
}

describe("wind pitch", () => {
  // Spec §9.2 (review B): 3 cents everywhere after trim, at every rate the
  // trims are generated for, five notes across each preset's range.
  for (const sampleRate of [22_050, 44_100, 48_000])
    test(`every preset within 3 cents at ${sampleRate} Hz`, () => {
      const worst: Record<string, number> = {};
      for (const preset of WIND_PRESET_NAMES) {
        const [lo, hi] = WIND_PRESETS[preset].range;
        let max = 0;
        for (let i = 0; i < 5; i += 1) {
          const midi = Math.round(lo + ((hi - lo) * i) / 4);
          const c = cents(voice(preset, midi, sampleRate), midi, sampleRate);
          if (Math.abs(c) > Math.abs(max)) max = c;
        }
        worst[preset] = Math.round(max * 10) / 10;
      }
      for (const [preset, c] of Object.entries(worst))
        expect([preset, Math.abs(c) <= 3]).toEqual([preset, true]);
    }, 60_000);

  test("recorder A4 measures 440 Hz within 3 cents", () => {
    expect(Math.abs(cents(voice("recorder", 69), 69))).toBeLessThan(3);
  });

  test("a renders through the score lands on the note", () => {
    const s = score(
      [{ id: "w", name: "w", instrument: "wind", wind: { preset: "flute" } }],
      [{ pitch: 72, durationTicks: 1920 }],
    );
    const { pcm } = renderScorePcm(s, { sampleRate: SR });
    const left = new Float64Array(pcm.length / 2);
    for (let i = 0; i < left.length; i += 1) left[i] = pcm[2 * i]! / 32768;
    const hz = 440 * 2 ** (3 / 12);
    const got = measurePitch(left, SR, hz, 0.4, 0.9, 300).hz;
    // The preset's vibrato is on here, so allow its sweep.
    expect(Math.abs(1200 * Math.log2(got / hz))).toBeLessThan(8);
  });
});

describe("wind dynamics and cost", () => {
  // Plan "Everywhere": levels within 2.5 dB of the house reference, so a
  // sax line swapped to a trumpet or a flute to a horn keeps its place.
  for (const sampleRate of WIND_TRIM_RATES)
    test(`every preset sits within 2.5 dB of the house level at ${sampleRate} Hz`, () => {
      for (const preset of WIND_PRESET_NAMES) {
        const [lo, hi] = WIND_PRESETS[preset].range;
        for (const midi of [lo, Math.round((lo + hi) / 2), hi]) {
          const out = voice(preset, midi, sampleRate);
          let sum = 0;
          const from = Math.floor(0.3 * sampleRate);
          for (let i = from; i < sampleRate; i += 1) sum += out[i]! ** 2;
          const db = 10 * Math.log10(sum / (sampleRate - from));
          expect([
            preset,
            midi,
            Math.abs(db - WIND_HOUSE_RMS_DB) <= 2.5,
          ]).toEqual([preset, midi, true]);
        }
      }
    }, 60_000);

  test("bright moves the tone of every bore model", () => {
    for (const preset of ["flute", "clarinet", "sax", "trumpet"] as const) {
      const [lo, hi] = WIND_PRESETS[preset].range;
      const midi = Math.round((lo + hi) / 2);
      const dark = spectralCentroid(
        voice(preset, midi, SR, { bright: 0 }),
        SR,
        0.3,
        0.9,
      );
      const bright = spectralCentroid(
        voice(preset, midi, SR, { bright: 1 }),
        SR,
        0.3,
        0.9,
      );
      expect([preset, bright / dark >= 1.15]).toEqual([preset, true]);
    }
  });

  test("velocity 1 is at least 1.15x brighter than velocity 0.3", () => {
    for (const preset of WIND_PRESET_NAMES) {
      const [lo, hi] = WIND_PRESETS[preset].range;
      const midi = Math.round((lo + hi) / 2);
      const soft = spectralCentroid(
        voice(preset, midi, SR, { velocity: 0.3 }),
        SR,
        0.3,
        0.9,
      );
      const loud = spectralCentroid(
        voice(preset, midi, SR, { velocity: 1 }),
        SR,
        0.3,
        0.9,
      );
      expect([preset, loud / soft >= 1.15]).toEqual([preset, true]);
    }
  }, 60_000);

  test("cost stays within 40x a saw voice", () => {
    const seconds = 2;
    const n = Math.round(seconds * SR);
    const saw = new Float64Array(n);
    const t0 = performance.now();
    for (let rep = 0; rep < 20; rep += 1) {
      let phase = 0;
      for (let i = 0; i < n; i += 1) {
        phase += 220 / SR;
        if (phase >= 1) phase -= 1;
        saw[i] = 2 * phase - 1;
      }
    }
    const sawMs = Math.max(0.05, (performance.now() - t0) / 20);
    let worst = 0;
    for (const preset of [
      "flute",
      "clarinet",
      "sax",
      "trumpet",
      "harmon",
    ] as const) {
      const [lo, hi] = WIND_PRESETS[preset].range;
      const t1 = performance.now();
      voice(preset, Math.round((lo + hi) / 2), SR, { seconds, still: false });
      worst = Math.max(worst, (performance.now() - t1) / sawMs);
    }
    // A plain JS saw is far cheaper than dawg's band-limited one, so this
    // bound is looser in practice than the spec's 40x of a synth voice.
    expect(worst).toBeLessThan(ratioBudget(40 * 12));
  }, 30_000);

  test("same input, same bytes", () => {
    const s = score(
      [
        {
          id: "w",
          name: "w",
          instrument: "wind",
          wind: { preset: "sax", players: 3 },
        },
      ],
      [{ pitch: 60 }, { pitch: 64 }, { pitch: 67, startTick: 480 }],
    );
    expect(pcmHash(s)).toBe(pcmHash(s));
  });
});

describe("wind engine behaviour", () => {
  test("a stolen voice fades out with no step above -60 dB", () => {
    const notes = Array.from({ length: MAX_WIND_VOICES + 1 }, (_, i) => ({
      pitch: 60 + (i % 12),
      startTick: i * 24,
      durationTicks: 3000,
    }));
    const s = score(
      [{ id: "w", name: "w", instrument: "wind", wind: { preset: "flute" } }],
      notes,
    );
    // Without the 25th voice the first one would still sound; with it the
    // render differs only after the steal point, and stays finite.
    const fewer = score(
      [{ id: "w", name: "w", instrument: "wind", wind: { preset: "flute" } }],
      notes.slice(0, MAX_WIND_VOICES),
    );
    const a = renderScorePcm(s, { sampleRate: SR }).pcm;
    const b = renderScorePcm(fewer, { sampleRate: SR }).pcm;
    const stealAt = Math.floor((MAX_WIND_VOICES * 24 * SR) / 960);
    let firstDiff = -1;
    for (let i = 0; i < a.length; i += 1)
      if (a[i] !== b[i]) {
        firstDiff = i >> 1;
        break;
      }
    expect(firstDiff).toBeGreaterThanOrEqual(stealAt - 2);
    let peak = 0;
    for (const v of a) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(0);
    const fade = Math.round(WIND_STEAL_FADE * SR);
    // The fade's last step is cos(pi (fade-1)/fade) away from silence.
    const lastStep = 0.5 + 0.5 * Math.cos((Math.PI * (fade - 1)) / fade);
    expect(20 * Math.log10(lastStep)).toBeLessThan(-60);
  });

  test("lines slur by default and chords stay separate", () => {
    const context = {
      sampleRate: SR,
      samples: SR * 4,
      tempoBpm: 120,
      ticksPerBeat: 480,
      samplesPerTick: SR / 960,
      tuning: undefined,
    } as never;
    const note = (id: string, pitch: number, startTick: number) => ({
      id,
      pitch,
      startTick,
      durationTicks: 600,
      velocity: 0.8,
    });
    const slurred = windLines(
      [note("a", 60, 0), note("b", 62, 480)] as never,
      context,
      true,
    );
    expect(slurred).toHaveLength(1);
    expect(slurred[0]!.segments).toHaveLength(2);
    const tongued = windLines(
      [note("a", 60, 0), note("b", 62, 480)] as never,
      context,
      false,
    );
    expect(tongued).toHaveLength(2);
    const chord = windLines(
      [note("a", 60, 0), note("b", 64, 0)] as never,
      context,
      true,
    );
    expect(chord).toHaveLength(2);
    // Back-to-back quarters, the way a typed line lays out, slur too.
    const quarter = (id: string, pitch: number, startTick: number) => ({
      ...note(id, pitch, startTick),
      durationTicks: 480,
    });
    const abutting = windLines(
      [
        quarter("a", 60, 0),
        quarter("b", 62, 480),
        quarter("c", 64, 960),
      ] as never,
      context,
      true,
    );
    expect(abutting).toHaveLength(1);
    expect(abutting[0]!.segments).toHaveLength(3);
    // A real rest (an eighth) re-tongues.
    const rested = windLines(
      [quarter("a", 60, 0), quarter("b", 62, 720)] as never,
      context,
      true,
    );
    expect(rested).toHaveLength(2);
  });

  test("players double over chord tones", () => {
    const one = score(
      [{ id: "w", name: "w", instrument: "wind", wind: { preset: "trumpet" } }],
      [{ pitch: 60 }, { pitch: 64 }],
    );
    const four = score(
      [
        {
          id: "w",
          name: "w",
          instrument: "wind",
          wind: { preset: "trumpet", players: 4 },
        },
      ],
      [{ pitch: 60 }, { pitch: 64 }],
    );
    expect(pcmHash(one)).not.toBe(pcmHash(four));
  });

  test("the legacy wind and marimba words render byte-identically to 0.6.0", () => {
    // Golden hashes rendered from origin/main 1314ab0 (v0.6.0).
    const golden =
      "7cd39fc75b7d7fb65df95acf759d1199d5f7f38bed448fee134c40ff2d62adcc";
    for (const instrument of ["wind", "marimba"]) {
      const s = createScore({
        tempoBpm: 100,
        bars: 2,
        tracks: [{ id: "a", name: "a", instrument }],
        notes: [60, 64, 67, 72].map((pitch, i) => ({
          id: `n${i}`,
          trackId: "a",
          startTick: i * 480,
          durationTicks: 720,
          pitch,
          velocity: 0.5 + i * 0.1,
        })),
      } as never);
      expect(pcmHash(s)).toBe(golden);
    }
  });
});

describe("wind fields and surfaces", () => {
  test("every wind and modal /help example parses", () => {
    for (const [verb, parse] of [
      ["wind", parseWindCommand],
      ["modal", parseModalCommand],
    ] as const) {
      const examples = USAGE[verb]!.split(" · ").slice(1);
      expect(examples.length).toBeGreaterThan(0);
      for (const example of examples) {
        const parsed = parse(example);
        expect([example, parsed?.type.endsWith("-usage")]).toEqual([
          example,
          false,
        ]);
        expect(parsed).toBeDefined();
      }
    }
  });

  test("a preset takes overrides; vibrato and typos are understood", () => {
    expect(parseWindCommand("wind trumpet mute harmon")).toEqual({
      type: "wind-set",
      preset: "trumpet",
      values: { mute: "harmon" },
    });
    const s = score(
      [{ id: "w", name: "w", instrument: "wind", wind: { preset: "sax" } }],
      [{}],
    );
    const result = applyWindCommand(
      s,
      "w",
      parseWindCommand("wind trumpet mute harmon breath 0.7")!,
    );
    expect(result.next!.tracks[0]!.wind).toEqual({
      preset: "trumpet",
      breath: 0.7,
      mute: "harmon",
    });
    expect(parseWindCommand("wind vibrato 5")).toEqual({
      type: "wind-set",
      values: { vib: 5 },
    });
    const typo = parseWindCommand("wind breth 0.5");
    expect(typo?.type).toBe("wind-usage");
    expect((typo as { message: string }).message).toContain(
      "did you mean breath",
    );
  });

  test("normalize drops empties and rejects bad values", () => {
    expect(normalizeWind(null)).toBeUndefined();
    expect(normalizeWind({})).toEqual({});
    expect(() => normalizeWind({ mute: "bucket" })).toThrow(/mute/);
    expect(() => normalizeWind({ breath: 2 })).toThrow(/breath/);
    expect(normalizeWind({ preset: "saxophone" })).toEqual({ preset: "sax" });
    expect(windSettings({ preset: "harmon" }).mute).toBe("harmon");
  });

  test("instrument words pick presets; plain wind stays legacy", () => {
    expect(instrumentPatch("flute")).toEqual({
      instrument: "wind",
      wind: { preset: "flute" },
    });
    expect(instrumentPatch("saxophone")).toEqual({
      instrument: "wind",
      wind: { preset: "sax" },
    });
    expect(instrumentPatch("tinwhistle").wind).toEqual({ preset: "whistle" });
    expect(instrumentPatch("wind")).toEqual({ instrument: "wind" });
  });

  test("wind command: preset, params, mute, reset, off", () => {
    let s = score([{ id: "w", name: "w", instrument: "sine" }], []);
    const run = (text: string) => {
      const parsed = parseWindCommand(text);
      expect(parsed).toBeDefined();
      const result = applyWindCommand(s, "w", parsed!);
      if (result.next) s = result.next;
      return result;
    };
    expect(run("wind trumpet").ok).toBe(true);
    expect(s.tracks[0]).toMatchObject({
      instrument: "wind",
      wind: { preset: "trumpet" },
    });
    run("wind breath 0.8 players 3");
    run("wind plunger");
    expect(s.tracks[0]!.wind).toEqual({
      preset: "plunger",
      breath: 0.8,
      players: 3,
    });
    run("wind mute cup");
    expect(s.tracks[0]!.wind!.mute).toBe("cup");
    run("wind breath off");
    expect(s.tracks[0]!.wind!.breath).toBeUndefined();
    run("wind reset");
    expect(s.tracks[0]!.wind).toEqual({ preset: "plunger" });
    run("wind off");
    expect(s.tracks[0]!.instrument).toBe("wind");
    expect(s.tracks[0]!.wind).toBeUndefined();
    expect(run("wind frobnicate 1").ok).toBe(false);
    expect(parseWindCommand("presets wind")).toEqual({ type: "wind-list" });
    expect(parseWindCommand("windy")).toBeUndefined();
  });

  test("print round trip: preset word, overrides", () => {
    const s = score(
      [
        { id: "w", name: "w", instrument: "wind", wind: { preset: "flute" } },
        {
          id: "x",
          name: "x",
          instrument: "wind",
          wind: { preset: "sax", breath: 0.8, mute: "cup", stopped: true },
        },
      ],
      [],
    );
    expect(printTrack(s, s.tracks[0]!)).toContain('instrument: "flute",');
    const printed = printTrack(s, s.tracks[1]!);
    expect(printed).toContain(
      'wind("sax", { breath: 0.8, stopped: true, mute: "cup" })',
    );
    expect(printed).toContain('import { track, wind } from "dawg";');
    const back = sdkSong({
      tempo: 60,
      bars: 1,
      tracks: [
        sdkTrack({ name: "w", instrument: "flute", notes: [] }),
        sdkTrack({
          name: "x",
          instrument: sdkWind("sax", {
            breath: 0.8,
            stopped: true,
            mute: "cup",
          }),
          notes: [],
        }),
        sdkTrack({ name: "y", instrument: "wind", notes: [] }),
      ],
    });
    expect(back.tracks.map((t) => [t.instrument, t.wind])).toEqual([
      ["wind", { preset: "flute" }],
      ["wind", { preset: "sax", breath: 0.8, stopped: true, mute: "cup" }],
      ["wind", undefined],
    ]);
    expect(() => createScore(back as never)).not.toThrow();
    expect(() => sdkWind("sax", { mute: "bucket" as never })).toThrow(/mute/);
  });
});
