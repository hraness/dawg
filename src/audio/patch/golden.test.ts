/**
 * Lane 3 golden: `convertToPatch` (patchFromTrack) renders bit-identical to
 * the original track for every synth preset and for the modal, string,
 * wind and sampler engines, cold and through the stem cache.
 */
import { describe, expect, test } from "bun:test";
import { convertToPatch } from "../../../core/patch.ts";
import { createScore, type TrackInput } from "../../../core/score.ts";
import { SYNTH_PRESETS } from "../../../core/synth.ts";
import { sampleKey, type DecodedSample, type SampleBank } from "../samples.ts";
import { renderScorePcm, StemRenderer } from "../wav.ts";

const RATE = 16_000;

const NOTES = [
  { id: "n1", pitch: 48, startTick: 0, durationTicks: 360, velocity: 0.9 },
  { id: "n2", pitch: 55, startTick: 240, durationTicks: 480, velocity: 0.6 },
  { id: "n3", pitch: 64, startTick: 960, durationTicks: 240, velocity: 0.75 },
  { id: "n4", pitch: 60, startTick: 1_200, durationTicks: 600, velocity: 1 },
];

function scoreWith(track: Record<string, unknown>) {
  return createScore({
    tempoBpm: 110,
    bars: 1,
    tracks: [{ id: "t", name: "t", ...track } as TrackInput],
    notes: NOTES.map((note) => ({ ...note, trackId: "t" })),
  });
}

function ping(): DecodedSample {
  const mono = new Float32Array(4_000);
  for (let i = 0; i < mono.length; i += 1)
    mono[i] = Math.sin((2 * Math.PI * 330 * i) / RATE) * Math.exp(-i / 900);
  return {
    sha256: "b".repeat(64),
    sampleRate: RATE,
    channels: 1,
    frames: mono.length,
    mono,
  };
}

const BANK: SampleBank = {
  voices: new Map([[sampleKey("t", "c4"), ping()]]),
  problems: [],
};

const CASES: [string, Record<string, unknown>][] = [
  ...Object.entries(SYNTH_PRESETS).map(
    ([name, preset]) =>
      [
        `synth preset ${name}`,
        { instrument: preset.instrument, synth: preset.synth },
      ] as [string, Record<string, unknown>],
  ),
  ["modal kethuk", { instrument: "modal", modal: { preset: "kethuk" } }],
  ["string sitar", { instrument: "string", string: { preset: "sitar" } }],
  ["wind flute", { instrument: "wind", wind: { preset: "flute" } }],
  [
    "sampler",
    {
      instrument: "sampler",
      sampler: {
        mode: "keyed",
        voices: { c4: { src: "ping.wav", root: 60, sha256: "b".repeat(64) } },
      },
    },
  ],
  [
    "pluck with effects",
    {
      instrument: "pluck",
      fx: { distort: { drive: 0.4 } },
      delay: { beats: 0.5, feedback: 0.3, mix: 0.25 },
      reverb: { mix: 0.2, size: 0.4 },
    },
  ],
];

const same = (a: Int16Array, b: Int16Array) => {
  expect(a.length).toBe(b.length);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) diff += 1;
  expect(diff).toBe(0);
};

describe("patchFromTrack golden", () => {
  for (const [label, track] of CASES)
    test(label, () => {
      const original = scoreWith(track);
      const patched = scoreWith(convertToPatch({ ...track } as never));
      expect(patched.tracks[0]!.instrument).toBe("patch");
      const options = { sampleRate: RATE, samples: BANK };
      const a = renderScorePcm(original, options);
      const b = renderScorePcm(patched, options);
      expect(a.pcm.some((v) => Math.abs(v) > 100)).toBe(true);
      same(a.pcm, b.pcm);
      // The stem cache plays the same bytes (cold, then cached).
      const renderer = new StemRenderer();
      const cold = renderer.render(patched, options);
      const warm = renderer.render(patched, options);
      same(cold.pcm, a.pcm);
      same(warm.pcm, a.pcm);
    });
});
