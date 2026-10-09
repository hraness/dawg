import { afterEach, describe, expect, test } from "bun:test";
import { createScore, updateNote } from "../../core/score.ts";
import { clearAutotuneCache } from "./autotune.ts";
import { trackPitch } from "./dsp/pitch.ts";
import { synthVoice } from "./fixtures/voice.ts";
import { sampleKey, type DecodedSample } from "./samples.ts";
import { renderScorePcm, StemRenderer } from "./wav.ts";

const RATE = 48_000;
const SHA = "d".repeat(64);

afterEach(() => clearAutotuneCache());

/** A sung C4 held 35 cents sharp, no vibrato or drift. */
function sharpVoice(): DecodedSample {
  const voice = synthVoice(
    [{ start: 0.05, dur: 1.2, midi: 60, off: 35, vowel: "a" }],
    { sr: RATE, seed: 11, drift: 0 },
  );
  const mono = Float32Array.from(voice.x);
  return {
    sha256: SHA,
    sampleRate: RATE,
    channels: 1,
    frames: mono.length,
    mono,
  };
}

function render(autotune?: object, offset?: number) {
  const score = createScore({
    tempoBpm: 120,
    bars: 2,
    key: "C major",
    tracks: [
      {
        id: "v",
        name: "vocal",
        instrument: "vocal",
        clips: [
          {
            id: "c1",
            src: "samples/v.wav",
            sha256: SHA,
            startTick: 0,
            ...(offset !== undefined ? { offset } : {}),
          },
        ],
        fx: undefined,
        ...(autotune ? { autotune } : {}),
      },
    ],
    notes: [],
  } as never);
  const pcm = renderScorePcm(score, {
    sampleRate: RATE,
    samples: {
      voices: new Map([[sampleKey("v", "clip:c1"), sharpVoice()]]),
      problems: [],
    },
  }).pcm;
  const left = new Float64Array(pcm.length / 2);
  for (let i = 0; i < left.length; i += 1) left[i] = pcm[2 * i]! / 32768;
  return { pcm, left };
}

/** Median cents off C4 over the steady middle (0.3 s to 0.9 s). */
function centsOffC4(x: Float64Array): number {
  const curve = trackPitch(x, RATE, { voice: "tenor" });
  const cents: number[] = [];
  for (let f = 0; f < curve.f0.length; f += 1) {
    const t = curve.t0 + f * curve.hop;
    const hz = curve.f0[f]!;
    if (t < 0.3 || t > 0.9 || hz <= 0 || curve.prob[f]! < 200) continue;
    cents.push(1200 * Math.log2(hz / 261.6255653005986));
  }
  cents.sort((a, b) => a - b);
  return cents[Math.floor(cents.length / 2)]!;
}

describe("autotune on audio clips", () => {
  test("hard retunes a sharp clip onto C; cold and warm renders match", () => {
    const plain = render();
    expect(centsOffC4(plain.left)).toBeGreaterThan(25);
    const tuned = render({ preset: "hard" });
    expect(Math.abs(centsOffC4(tuned.left))).toBeLessThan(5);
    const warm = render({ preset: "hard" });
    expect(
      Buffer.from(warm.pcm.buffer).equals(Buffer.from(tuned.pcm.buffer)),
    ).toBe(true);
    clearAutotuneCache();
    const cold = render({ preset: "hard" });
    expect(
      Buffer.from(cold.pcm.buffer).equals(Buffer.from(tuned.pcm.buffer)),
    ).toBe(true);
  });

  test("a clip offset still plays the tuned audio in place", () => {
    const tuned = render({ preset: "hard" }, 0.1);
    // the clip starts 0.1 s into the file: the steady middle moves earlier
    expect(Math.abs(centsOffC4(tuned.left))).toBeLessThan(5);
  });

  test("a vocoder fed by a guided clip follows guide note edits when warm", () => {
    const song = (guidePitch: number) =>
      createScore({
        tempoBpm: 120,
        bars: 2,
        key: "C major",
        tracks: [
          {
            id: "v",
            name: "vocal",
            instrument: "vocal",
            muted: true,
            clips: [
              { id: "c1", src: "samples/v.wav", sha256: SHA, startTick: 0 },
            ],
            autotune: { preset: "locked", to: "notes", from: "g" },
          },
          { id: "g", name: "guide", instrument: "piano", muted: true },
          {
            id: "c",
            name: "carrier",
            instrument: "vocoder",
            vocoder: { src: "v" },
          },
        ],
        notes: [
          {
            id: "gn",
            trackId: "g",
            pitch: guidePitch,
            startTick: 0,
            durationTicks: 1920,
            velocity: 0.8,
          },
          {
            id: "cn",
            trackId: "c",
            pitch: 48,
            startTick: 0,
            durationTicks: 1920,
            velocity: 0.8,
          },
        ],
      } as never);
    const options = () => ({
      sampleRate: RATE,
      samples: {
        voices: new Map([[sampleKey("v", "clip:c1"), sharpVoice()]]),
        problems: [],
      },
    });
    const warm = new StemRenderer();
    const first = warm.render(song(60), options());
    const edited = updateNote(song(60), "gn", { pitch: 62 });
    const again = warm.render(edited, options());
    clearAutotuneCache();
    const cold = renderScorePcm(edited, options());
    const same = (a: Int16Array, b: Int16Array) =>
      Buffer.from(a.buffer).equals(Buffer.from(b.buffer));
    expect(same(again.pcm, cold.pcm)).toBe(true);
    expect(same(again.pcm, first.pcm)).toBe(false);
  }, 60_000);
});
