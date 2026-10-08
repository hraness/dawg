import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import {
  barStartTick,
  loopSecondsOf,
  loopTicksOf,
  secondsAtTick,
} from "../../core/tempo.ts";
import { previewRegion, previewScore } from "./preview.ts";

/** 8 bars at 120: a step to 60 and 3/4 from bar 2 (index 1), one note at 5760. */
function stepped() {
  return createScore({
    tempoBpm: 120,
    bars: 8,
    time: {
      tempo: [{ tick: 1920, bpm: 60 }],
      meter: [{ bar: 1, beatsPerBar: 3 }],
    },
    tracks: [{ id: "p", name: "piano", instrument: "piano" }],
    notes: [
      {
        id: "n1",
        trackId: "p",
        pitch: 60,
        startTick: 5760,
        durationTicks: 480,
        velocity: 0.8,
      },
    ],
  });
}

describe("preview follows the song's tempo map and meter", () => {
  test("a meter change moves the region's start tick", () => {
    const score = stepped();
    // Tick 5760 is beat 12: bar 0 is 4 beats, then 3/4 bars start at beats
    // 4, 7, 10, 13, so beat 12 is in bar index 3.
    const region = previewRegion(score, "p", 0);
    expect(region.startBar).toBe(3);
    expect(barStartTick(score, region.startBar)).toBe(10 * 480);
    const preview = previewScore(score, "p")!;
    // The note sits two beats into the region.
    expect(preview.score.notes[0]!.startTick).toBe(2 * 480);
    // Two 3/4 bars.
    expect(loopTicksOf(preview.score)).toBe(6 * 480);
  });

  test("a tempo step before the region changes the loop length", () => {
    const preview = previewScore(stepped(), "p")!;
    expect(preview.score.tempoBpm).toBe(60);
    // Six beats at 60 BPM.
    expect(loopSecondsOf(preview.score)).toBeCloseTo(6, 9);
  });

  test("a ramp through the region keeps ramping from the tempo there", () => {
    const score = createScore({
      tempoBpm: 120,
      bars: 8,
      time: { tempo: [{ tick: 8 * 4 * 480, bpm: 60, ramp: "linear" }] },
      tracks: [{ id: "p", name: "piano", instrument: "piano" }],
      notes: [
        {
          id: "n1",
          trackId: "p",
          pitch: 60,
          startTick: 4 * 4 * 480,
          durationTicks: 480,
          velocity: 0.8,
        },
      ],
    });
    const preview = previewScore(score, "p")!;
    expect(preview.region.startBar).toBe(4);
    expect(preview.score.tempoBpm).toBeCloseTo(90, 9);
    const whole = loopSecondsOf(score);
    // Bars 4–5 of the ramp: the same seconds as in the song.
    const expected =
      secondsAtTick(score, 6 * 1920) - secondsAtTick(score, 4 * 1920);
    expect(loopSecondsOf(preview.score)).toBeCloseTo(expected, 9);
    expect(whole).toBeGreaterThan(expected);
  });
});
