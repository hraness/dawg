/**
 * q08: a non-finite sample from any DSP must not silence the mix. NaN
 * written into an Int16Array stores 0, and a NaN fed to a reverb's feedback
 * poisons its whole tail. The renderer zeroes non-finite samples where a
 * stem's source and chain leave them, and reports which track made them.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { createScore, type TrackScore } from "../../core/score.ts";
import {
  registerEngine,
  unregisterEngine,
  type InstrumentEngine,
} from "./instruments.ts";
import { renderScorePcm, StemRenderer } from "./wav.ts";
import { renderArrangedPcm } from "./arrange.ts";

const RATE = 22_050;
let poison = Number.NaN;

/** A 0.25 DC level per note, with one poisoned sample 10 ms in. */
const nanEngine: InstrumentEngine = {
  id: "nantone",
  field: "filter",
  render(dry, _dryR, notes, _track, context) {
    for (const note of notes) {
      const start = Math.round(note.startTick * context.samplesPerTick);
      const end = Math.min(
        dry.length,
        Math.round(
          (note.startTick + note.durationTicks) * context.samplesPerTick,
        ),
      );
      for (let i = start; i < end; i += 1) dry[i]! += 0.25;
      dry[start + Math.round(0.01 * context.sampleRate)] = poison;
    }
  },
  tailSeconds: () => 0.5,
  stereo: () => false,
};

function song(extra: Record<string, unknown> = {}): TrackScore {
  return createScore({
    tempoBpm: 120,
    bars: 1,
    tracks: [
      {
        id: "bad",
        name: "bad",
        instrument: "nantone",
        filter: { cutoff: 18000, resonance: 0 },
        ...extra,
      },
      { id: "ok", name: "ok", instrument: "sine" },
    ],
    notes: [
      {
        id: "n1",
        trackId: "bad",
        pitch: 60,
        startTick: 0,
        durationTicks: 384,
        velocity: 0.8,
      },
      {
        id: "n2",
        trackId: "ok",
        pitch: 69,
        startTick: 0,
        durationTicks: 384,
        velocity: 0.8,
      },
    ],
  } as never);
}

const nonzeroAfter = (pcm: Int16Array, frame: number) => {
  let count = 0;
  for (let i = frame * 2; i < pcm.length; i += 1) if (pcm[i] !== 0) count += 1;
  return count;
};

afterEach(() => {
  unregisterEngine("nantone");
  poison = Number.NaN;
});

describe("non-finite samples (q08)", () => {
  for (const value of [Number.NaN, Infinity, -Infinity])
    for (const fx of [
      {},
      { reverb: { mix: 0.4, size: 0.6 } },
      { delay: { beats: 0.5, mix: 0.4, feedback: 0.6 } },
      { master: true },
    ]) {
      const label = `${value} through ${Object.keys(fx)[0] ?? "dry"}`;
      test(`${label} is zeroed and reported`, () => {
        registerEngine(nanEngine);
        poison = value;
        const { master, ...trackFx } = fx as Record<string, unknown>;
        const base = song(trackFx);
        const score = master
          ? createScore({
              ...base.toJSON(),
              master: { target: -14 },
            } as never)
          : base;
        const out = renderScorePcm(score, { sampleRate: RATE });
        // The note and the other track keep sounding past the bad sample.
        const after = Math.round(0.05 * RATE);
        expect(nonzeroAfter(out.pcm, after)).toBeGreaterThan(RATE / 2);
        expect(out.nonFinite).toEqual({ samples: 1, tracks: ["bad"] });
      });
    }

  test("a clean render carries no report, and the report survives the stem cache", () => {
    registerEngine(nanEngine);
    poison = 0.25;
    expect(renderScorePcm(song(), { sampleRate: RATE }).nonFinite).toBe(
      undefined,
    );
    poison = Number.NaN;
    const stems = new StemRenderer();
    const first = stems.render(song(), { sampleRate: RATE });
    const second = stems.render(song(), { sampleRate: RATE });
    expect(first.nonFinite).toEqual({ samples: 1, tracks: ["bad"] });
    expect(second.nonFinite).toEqual(first.nonFinite);
  });

  test("a cached reverb stem (the room split) is scrubbed too", () => {
    registerEngine(nanEngine);
    const stems = new StemRenderer();
    const wet = (mix: number) => song({ reverb: { mix, size: 0.6 } });
    for (const mix of [0.4, 0.2]) {
      const out = stems.render(wet(mix), { sampleRate: RATE });
      expect(nonzeroAfter(out.pcm, Math.round(0.05 * RATE))).toBeGreaterThan(
        RATE / 2,
      );
      expect(out.nonFinite).toEqual({ samples: 1, tracks: ["bad"] });
    }
  });

  test("an arranged (export) render carries the report", () => {
    registerEngine(nanEngine);
    const out = renderArrangedPcm(song(), { sampleRate: RATE });
    expect(out.nonFinite?.tracks).toEqual(["bad"]);
    expect(out.nonFinite!.samples).toBeGreaterThanOrEqual(1);
  });
});
