import { describe, expect, test } from "bun:test";
import { createScore, type TrackScoreData } from "../../core/score.ts";
import { secondsAtTick, type SongTime } from "../../core/tempo.ts";
import { countInClicks, clicksIn, meterClickGrid } from "./click.ts";
import { TransportClock, transportMapFor } from "./clock.ts";
import { loopFrames, renderScorePcm } from "./wav.ts";
import { ratioBudget } from "../../test/perf.ts";

const RATE = 8_000;

/** One kick per beat on a 2-bar 4/4 loop at 120 BPM. */
function kicks(time?: SongTime, extra: Partial<TrackScoreData> = {}) {
  return createScore({
    tempoBpm: 120,
    bars: 2,
    tracks: [{ id: "k", name: "kick", instrument: "drums" }],
    notes: Array.from({ length: 8 }, (_, i) => ({
      id: `n${i}`,
      trackId: "k",
      pitch: 36,
      startTick: i * 480,
      durationTicks: 240,
      velocity: 0.9,
    })),
    ...(time ? { time } : {}),
    ...extra,
  });
}

/** First sounding frame of each note, rendering one note at a time. */
function onsets(score: ReturnType<typeof createScore>): number[] {
  return score.notes.map((note) => {
    const solo = createScore({
      ...score.toJSON(),
      notes: [note],
    });
    const pcm = renderScorePcm(solo, { sampleRate: RATE }).pcm;
    for (let frame = 0; frame < pcm.length / 2; frame += 1)
      if (pcm[frame * 2] !== 0) return frame;
    return -1;
  });
}

describe("rendering through a tempo map", () => {
  test("a step change moves later notes and lengthens the loop", () => {
    const plain = kicks();
    const slower = kicks({ tempo: [{ tick: 4 * 480, bpm: 60 }] });
    expect(loopFrames(plain, RATE)).toBe(4 * RATE);
    // Bar 1 at 120 (2 s) and bar 2 at 60 (4 s).
    expect(loopFrames(slower, RATE)).toBeCloseTo(6 * RATE, 6);
    const hits = onsets(slower);
    const expected = Array.from({ length: 8 }, (_, i) =>
      Math.floor(secondsAtTick(slower, i * 480) * RATE),
    );
    expect(hits.length).toBe(8);
    hits.forEach((hit, i) =>
      expect(Math.abs(hit - expected[i]!)).toBeLessThanOrEqual(2),
    );
    expect(expected[5]! - expected[4]!).toBe(RATE);
  });

  test("a ritardando spaces beats further apart", () => {
    const rit = kicks({ tempo: [{ tick: 8 * 480, bpm: 60, ramp: "linear" }] });
    const hits = onsets(rit);
    expect(hits.length).toBe(8);
    for (let i = 2; i < hits.length; i += 1)
      expect(hits[i]! - hits[i - 1]!).toBeGreaterThan(
        hits[i - 1]! - hits[i - 2]!,
      );
  });

  test("a fermata holds its beat and delays what follows", () => {
    const held = kicks({ fermatas: [{ tick: 3 * 480, beats: 2 }] });
    const hits = onsets(held);
    // Beat 4 lasts 3 beats (1.5 s), so beat 5 starts at 3 s, not 2 s.
    expect(Math.abs(hits[4]! - 3 * RATE)).toBeLessThanOrEqual(2);
  });

  test("a phased track drifts against the song", () => {
    const score = createScore({
      tempoBpm: 120,
      bars: 1,
      tracks: [
        { id: "a", name: "a", instrument: "drums" },
        {
          id: "b",
          name: "b",
          instrument: "drums",
          time: { phase: 240 },
        },
      ],
      notes: ["a", "b"].map((trackId) => ({
        id: `${trackId}0`,
        trackId,
        pitch: 36,
        startTick: 0,
        durationTicks: 120,
        velocity: 0.9,
      })),
    });
    const hits = onsets(score);
    // Track b's hit lands an eighth (0.25 s) after track a's.
    expect(hits[1]! - hits[0]!).toBe(RATE / 4);
  });
});

describe("transport through a tempo map", () => {
  test("the clock follows the map and wraps each loop pass", () => {
    const score = kicks({ tempo: [{ tick: 4 * 480, bpm: 60 }] });
    const clock = new TransportClock(120);
    clock.follow(score, 0);
    clock.play(0);
    expect(clock.beatAt(2_000)).toBeCloseTo(4, 9);
    expect(clock.beatAt(3_000)).toBeCloseTo(5, 9);
    // One full pass is 6 s; the next pass starts again at 120 BPM.
    expect(clock.beatAt(6_500)).toBeCloseTo(9, 9);
    clock.follow(kicks(), 6_500);
    expect(clock.beatAt(7_000)).toBeCloseTo(10, 9);
  });

  test("a score without time has no transport map", () => {
    expect(transportMapFor(kicks())).toBeUndefined();
    // Meter changes alone keep a constant tempo: no map needed.
    expect(
      transportMapFor(kicks({ meter: [{ bar: 1, beatsPerBar: 3 }] })),
    ).toBeUndefined();
  });
});

describe("click through meter changes", () => {
  test("7/8 clicks every eighth with one accent per bar", () => {
    const score = kicks({ meter: [{ bar: 0, beatsPerBar: 7, beatUnit: 8 }] });
    const grid = meterClickGrid(() => score);
    const bar = grid(0, 3.5);
    expect(bar.map((mark) => mark.beat)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3]);
    expect(bar.filter((mark) => mark.level === "accent").length).toBe(1);
    // The second loop pass starts on beat 7 (two 7/8 bars).
    expect(grid(7, 7.25)).toEqual([{ beat: 7, level: "accent" }]);
  });

  test("6/8 clicks dotted quarters", () => {
    const score = kicks({ meter: [{ bar: 0, beatsPerBar: 6, beatUnit: 8 }] });
    const beats = meterClickGrid(() => score)(0, 3).map((mark) => mark.beat);
    expect(beats).toEqual([0, 1.5]);
  });

  test("clicksIn places grid clicks inside the block", () => {
    const score = kicks({ meter: [{ bar: 1, beatsPerBar: 3 }] });
    const events = clicksIn(3.5, 4.5, 100, {
      beatsPerBar: 4,
      subdivision: 1,
      grid: meterClickGrid(() => score),
    });
    expect(events).toEqual([{ offset: 50, level: "accent", step: 4 }]);
  });

  test("count-in clicks the meter where recording starts", () => {
    const marks = countInClicks(8, 1, 3.5, 0.5, 0, 10);
    expect(marks.length).toBe(7);
    expect(marks[0]).toEqual({ beat: 4.5, level: "accent" });
  });
});

describe("tempo-synced effects follow the map", () => {
  /** One kick at `tick`, with or without a 1-beat delay (dry kept). */
  function echo(time: SongTime, tick: number, delayed: boolean) {
    return createScore({
      tempoBpm: 120,
      bars: 4,
      time,
      tracks: [
        {
          id: "k",
          name: "kick",
          instrument: "drums",
          ...(delayed ? { delay: { beats: 1, feedback: 0, mix: 1 } } : {}),
        },
      ],
      notes: [
        {
          id: "n",
          trackId: "k",
          pitch: 36,
          startTick: tick,
          durationTicks: 120,
          velocity: 0.9,
        },
      ],
    });
  }

  /** Frames from the dry onset to the echo onset. */
  function echoLag(time: SongTime, tick: number): number {
    const dry = renderScorePcm(echo(time, tick, false), {
      sampleRate: RATE,
    }).pcm;
    const wet = renderScorePcm(echo(time, tick, true), {
      sampleRate: RATE,
    }).pcm;
    let dryOnset = -1;
    let wetOnset = -1;
    for (let frame = 0; frame < dry.length / 2; frame += 1) {
      if (dryOnset < 0 && dry[frame * 2] !== 0) dryOnset = frame;
      if (Math.abs(wet[frame * 2]! - dry[frame * 2]!) > 2) {
        wetOnset = frame;
        break;
      }
    }
    return wetOnset - dryOnset;
  }

  test("an echo lands a beat later after a tempo step", () => {
    const time: SongTime = { tempo: [{ tick: 1920, bpm: 60 }] };
    // One beat at 60 BPM: a second.
    expect(Math.abs(echoLag(time, 1920) - RATE)).toBeLessThanOrEqual(3);
  });

  test("an echo lands a beat later inside a ramp", () => {
    const time: SongTime = {
      tempo: [{ tick: 3840, bpm: 60, ramp: "linear" }],
    };
    const score = echo(time, 960, true);
    const expected =
      (secondsAtTick(score, 1440) - secondsAtTick(score, 960)) * RATE;
    expect(Math.abs(echoLag(time, 960) - expected)).toBeLessThanOrEqual(3);
    // Not the start tempo's half second.
    expect(Math.abs(echoLag(time, 960) - RATE / 2)).toBeGreaterThan(100);
  });

  test("a ramped render stays within a small factor of a plain one", () => {
    const notes = Array.from({ length: 64 }, (_, i) => ({
      id: `n${i}`,
      trackId: "k",
      pitch: 36,
      startTick: i * 240,
      durationTicks: 120,
      velocity: 0.8,
    }));
    const base = {
      tempoBpm: 120,
      bars: 8,
      tracks: [
        {
          id: "k",
          name: "kick",
          instrument: "drums",
          delay: { beats: 0.75, feedback: 0.4, mix: 0.3 },
          volumeAutomation: [
            { tick: 0, value: 0.2 },
            { tick: 15360, value: 1 },
          ],
        },
      ],
      notes,
    };
    const time = (score: ReturnType<typeof createScore>) => {
      const started = performance.now();
      for (let i = 0; i < 3; i += 1)
        renderScorePcm(score, { sampleRate: 22_050 });
      return performance.now() - started;
    };
    const plain = createScore(base);
    const ramped = createScore({
      ...base,
      time: {
        tempo: [
          { tick: 3840, bpm: 140, ramp: "linear" },
          { tick: 7680, bpm: 90, ramp: "exp" },
          { tick: 11520, bpm: 120 },
        ],
      },
    });
    time(plain);
    time(ramped);
    expect(time(ramped)).toBeLessThan(time(plain) * ratioBudget(3) + 50);
  });
});
