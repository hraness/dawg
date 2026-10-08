import { describe, expect, test } from "bun:test";
import { createScore, scoreFromJSON, ScoreValidationError } from "./score.ts";
import {
  barAt,
  barStartTick,
  beatMarks,
  bpmAtTick,
  clickTicksOf,
  describeSongTime,
  driftRate,
  loopSecondsOf,
  loopTicksOf,
  normalizeSongTime,
  normalizeTrackTime,
  performedNotes,
  secondsAtTick,
  tickAtSeconds,
  timeMapFor,
  withFermata,
  withMeterChange,
  withTempoEvent,
  withTempoRamp,
  withoutFermatas,
  withoutTempoEvents,
  type SongTime,
  type TimeScore,
} from "./tempo.ts";

const TPB = 480;

function timed(time?: SongTime, extra: Partial<TimeScore> = {}): TimeScore {
  return {
    tempoBpm: 120,
    beatsPerBar: 4,
    bars: 4,
    ticksPerBeat: TPB,
    ...(time ? { time } : {}),
    ...extra,
  };
}

describe("tempo map", () => {
  test("without a map, ticks convert at the constant tempo", () => {
    const score = timed();
    expect(timeMapFor(score)).toBeUndefined();
    expect(secondsAtTick(score, 4 * TPB)).toBe(2);
    expect(tickAtSeconds(score, 2)).toBe(4 * TPB);
    expect(loopSecondsOf(score)).toBe(8);
    expect(bpmAtTick(score, 1000)).toBe(120);
  });

  test("a step change applies from its tick", () => {
    const score = timed({ tempo: [{ tick: 4 * TPB, bpm: 60 }] });
    expect(secondsAtTick(score, 4 * TPB)).toBeCloseTo(2, 12);
    expect(secondsAtTick(score, 5 * TPB)).toBeCloseTo(3, 12);
    expect(bpmAtTick(score, 4 * TPB - 1)).toBe(120);
    expect(bpmAtTick(score, 4 * TPB)).toBe(60);
    expect(tickAtSeconds(score, 3)).toBeCloseTo(5 * TPB, 9);
    expect(loopSecondsOf(score)).toBeCloseTo(2 + 12, 9);
  });

  test("a linear ramp integrates 60 / bpm over beats", () => {
    // 120 → 60 over 8 beats: (60 / slope) * ln(1 + slope * 8 / 120).
    const score = timed({
      tempo: [{ tick: 8 * TPB, bpm: 60, ramp: "linear" }],
    });
    const expected = (60 / -7.5) * Math.log(0.5);
    expect(secondsAtTick(score, 8 * TPB)).toBeCloseTo(expected, 9);
    expect(bpmAtTick(score, 4 * TPB)).toBeCloseTo(90, 9);
    expect(bpmAtTick(score, 12 * TPB)).toBe(60);
    // Constant 60 after the ramp.
    expect(secondsAtTick(score, 9 * TPB) - expected).toBeCloseTo(1, 9);
  });

  test("an exponential ramp changes by an equal ratio per beat", () => {
    const score = timed({ tempo: [{ tick: 8 * TPB, bpm: 60, ramp: "exp" }] });
    const k = Math.log(0.5) / 8;
    const expected = (60 / (120 * k)) * (1 - 2);
    expect(secondsAtTick(score, 8 * TPB)).toBeCloseTo(expected, 9);
    expect(bpmAtTick(score, 4 * TPB)).toBeCloseTo(120 / Math.SQRT2, 9);
  });

  test("ticks and seconds round-trip through ramps and holds", () => {
    const score = timed({
      tempo: [
        { tick: 2 * TPB, bpm: 140 },
        { tick: 6 * TPB, bpm: 70, ramp: "exp" },
        { tick: 10 * TPB, bpm: 160, ramp: "linear" },
      ],
      fermatas: [{ tick: 7 * TPB, beats: 2 }],
    });
    for (let tick = 0; tick <= 16 * TPB; tick += 37) {
      if (tick === 7 * TPB) continue;
      expect(tickAtSeconds(score, secondsAtTick(score, tick))).toBeCloseTo(
        tick,
        6,
      );
    }
  });

  test("a fermata holds time at its tick for beats of the tempo there", () => {
    const score = timed({ fermatas: [{ tick: 4 * TPB, beats: 2 }] });
    const map = timeMapFor(score)!;
    expect(map.seconds(4 * TPB)).toBeCloseTo(2, 12);
    expect(map.holdAt(4 * TPB)).toBeCloseTo(1, 12);
    expect(map.seconds(4 * TPB + 1)).toBeCloseTo(3 + 1 / 960, 9);
    // During the hold the score stays on the fermata tick.
    expect(map.tick(2.5)).toBe(4 * TPB);
    expect(loopSecondsOf(score)).toBeCloseTo(9, 9);
  });
});

describe("meter", () => {
  test("meter changes set bar starts and the loop length", () => {
    const score = timed({
      meter: [
        { bar: 1, beatsPerBar: 7, beatUnit: 8 },
        { bar: 3, beatsPerBar: 3 },
      ],
    });
    expect(barStartTick(score, 1)).toBe(4 * TPB);
    expect(barStartTick(score, 2)).toBe(4 * TPB + 3.5 * TPB);
    expect(barStartTick(score, 3)).toBe(11 * TPB);
    expect(loopTicksOf(score)).toBe(14 * TPB);
    expect(loopSecondsOf(score)).toBe(7);
    const position = barAt(score, 9 * TPB);
    expect(position.bar).toBe(2);
    expect(position.offset).toBe(1.5 * TPB);
    expect(`${position.beatsPerBar}/${position.beatUnit}`).toBe("7/8");
  });

  test("clicks count eighths in 7/8 and dotted quarters in 6/8", () => {
    expect(clickTicksOf({ beatsPerBar: 7, beatUnit: 8 }, TPB)).toBe(TPB / 2);
    expect(clickTicksOf({ beatsPerBar: 6, beatUnit: 8 }, TPB)).toBe(1.5 * TPB);
    expect(clickTicksOf({ beatsPerBar: 3, beatUnit: 4 }, TPB)).toBe(TPB);
    const score = timed({ meter: [{ bar: 0, beatsPerBar: 7, beatUnit: 8 }] });
    const marks = beatMarks(score, 0, barStartTick(score, 1));
    expect(marks.length).toBe(7);
    expect(marks.filter((mark) => mark.bar).length).toBe(1);
  });

  test("checkSongTime rejects bars that are not whole ticks", () => {
    expect(() =>
      createScore({
        ticksPerBeat: 3,
        time: { meter: [{ bar: 1, beatsPerBar: 1, beatUnit: 32 }] },
      }),
    ).toThrow(ScoreValidationError);
  });
});

describe("validation", () => {
  test("normalizeSongTime sorts, drops empties and rejects junk", () => {
    expect(normalizeSongTime({})).toBeUndefined();
    expect(normalizeSongTime({ tempo: [] })).toBeUndefined();
    expect(
      normalizeSongTime({
        tempo: [
          { tick: 960, bpm: 90 },
          { tick: 480, bpm: 100, ramp: "exp" },
        ],
        meter: [{ bar: 2, beatsPerBar: 3, beatUnit: 4 }],
      }),
    ).toEqual({
      tempo: [
        { tick: 480, bpm: 100, ramp: "exp" },
        { tick: 960, bpm: 90 },
      ],
      meter: [{ bar: 2, beatsPerBar: 3 }],
    });
    expect(() => normalizeSongTime({ tempo: [{ tick: 0, bpm: 90 }] })).toThrow(
      /tick 0 is tempoBpm/,
    );
    expect(() =>
      normalizeSongTime({ tempo: [{ tick: 10, bpm: 90, ramp: "cubic" }] }),
    ).toThrow(/ramp/);
    expect(() =>
      normalizeSongTime({
        fermatas: [
          { tick: 10, beats: 1 },
          { tick: 10, beats: 2 },
        ],
      }),
    ).toThrow(/two entries/);
    expect(() =>
      normalizeSongTime({ meter: [{ bar: 1, beatsPerBar: 5, beatUnit: 3 }] }),
    ).toThrow(/beatUnit/);
    expect(() => normalizeSongTime({ swing: [] })).toThrow(/unknown field/);
  });

  test("normalizeTrackTime drops defaults", () => {
    expect(normalizeTrackTime({ rate: 1, phase: 0 })).toBeUndefined();
    expect(normalizeTrackTime({ rate: 1.5, cycle: 960 })).toEqual({
      rate: 1.5,
      cycle: 960,
    });
    expect(() => normalizeTrackTime({ rate: 9 })).toThrow(/rate/);
    expect(() => normalizeTrackTime({ phase: 0.5 })).toThrow(/phase/);
  });

  test("scores round-trip time, and 0.4 scores gain no field", () => {
    const plain = createScore({ tempoBpm: 100 });
    expect("time" in plain.toJSON()).toBe(false);
    expect(JSON.stringify(scoreFromJSON(plain.toJSON()))).toBe(
      JSON.stringify(plain),
    );
    const score = createScore({
      tempoBpm: 100,
      time: {
        tempo: [{ tick: 1920, bpm: 80, ramp: "linear" }],
        fermatas: [{ tick: 3840, beats: 3 }],
      },
      tracks: [
        {
          id: "p",
          name: "p",
          instrument: "piano",
          time: { rate: 1.25, cycle: 960 },
        },
      ],
    });
    const back = scoreFromJSON(JSON.parse(JSON.stringify(score)));
    expect(back.time).toEqual(score.time!);
    expect(back.tracks[0]!.time).toEqual({ rate: 1.25, cycle: 960 });
    expect(score.withTime(null).time).toBeUndefined();
  });
});

describe("editing helpers", () => {
  test("tempo events add, replace and remove", () => {
    let time = withTempoEvent(undefined, { tick: 960, bpm: 90 });
    time = withTempoEvent(time, { tick: 960, bpm: 95 });
    time = withTempoEvent(time, { tick: 1920, bpm: 140, ramp: "exp" });
    expect(time?.tempo).toEqual([
      { tick: 960, bpm: 95 },
      { tick: 1920, bpm: 140, ramp: "exp" },
    ]);
    expect(withoutTempoEvents(time, 0, 1000)?.tempo).toEqual([
      { tick: 1920, bpm: 140, ramp: "exp" },
    ]);
    expect(withoutTempoEvents(time, 0, 5000)).toBeUndefined();
  });

  test("a ritardando pins the current tempo and ramps to the target", () => {
    const score = timed();
    const time = withTempoRamp(score, 8 * TPB, 16 * TPB, 80);
    expect(time?.tempo).toEqual([
      { tick: 8 * TPB, bpm: 120 },
      { tick: 16 * TPB, bpm: 80, ramp: "linear" },
    ]);
    const inside = withTempoRamp(timed(time), 12 * TPB, 14 * TPB, 60, "exp");
    // The earlier ramp keeps its shape up to the new pin; its end stays.
    expect(inside?.tempo).toEqual([
      { tick: 8 * TPB, bpm: 120 },
      { tick: 12 * TPB, bpm: 100, ramp: "linear" },
      { tick: 14 * TPB, bpm: 60, ramp: "exp" },
      { tick: 16 * TPB, bpm: 80, ramp: "linear" },
    ]);
  });

  test("fermatas and meter changes add and remove", () => {
    let time = withFermata(undefined, { tick: 100, beats: 2 });
    time = withMeterChange(time, 2, { beatsPerBar: 5, beatUnit: 8 });
    expect(time).toEqual({
      meter: [{ bar: 2, beatsPerBar: 5, beatUnit: 8 }],
      fermatas: [{ tick: 100, beats: 2 }],
    });
    time = withoutFermatas(time, 0, 200);
    time = withMeterChange(time, 2, null);
    expect(time).toBeUndefined();
  });

  test("describeSongTime lists every mark", () => {
    expect(
      describeSongTime(
        timed({
          tempo: [{ tick: 960, bpm: 90, ramp: "linear" }],
          meter: [{ bar: 1, beatsPerBar: 7, beatUnit: 8 }],
          fermatas: [{ tick: 1440, beats: 2 }],
        }),
      ),
    ).toBe("→90@2 7/8@bar2 𝄐2@3");
  });
});

describe("track time", () => {
  const note = (id: string, startTick: number) => ({
    id,
    trackId: "b",
    startTick,
    durationTicks: 240,
    pitch: 60,
  });

  test("tracks without time keep the score's notes", () => {
    const notes = [note("a", 0)];
    const score = { ...timed(), tracks: [{ id: "b" }], notes };
    expect(performedNotes(score)).toBe(notes);
  });

  test("a drifting twin gains one cycle per loop and realigns", () => {
    const loop = 2 * 4 * TPB;
    const rate = driftRate(loop, 2 * TPB, 1);
    expect(rate).toBe(1.25);
    const score = {
      ...timed(undefined, { bars: 2 }),
      tracks: [{ id: "b", time: { rate, cycle: 2 * TPB } }],
      notes: [note("a", 0), note("c", TPB)],
    };
    const placed = performedNotes(score);
    expect(placed.filter((n) => n.id === "a").map((n) => n.startTick)).toEqual([
      0, 768, 1536, 2304, 3072,
    ]);
    expect(placed[0]!.durationTicks).toBe(240 / 1.25);
  });

  test("phase shifts the pattern later and wraps it into the loop", () => {
    const score = {
      ...timed(undefined, { bars: 1 }),
      tracks: [{ id: "b", time: { phase: 240, cycle: 960 } }],
      notes: [note("a", 720)],
    };
    expect(performedNotes(score).map((n) => n.startTick)).toEqual([0, 960]);
  });

  test("a 3-beat cycle over 4/4 is polymeter", () => {
    const score = {
      ...timed(undefined, { bars: 3 }),
      tracks: [{ id: "b", time: { cycle: 3 * TPB } }],
      notes: [note("a", 0), note("late", 4 * TPB)],
    };
    // Notes past the cycle do not play; the cycle repeats four times.
    expect(performedNotes(score).map((n) => n.startTick)).toEqual([
      0,
      3 * TPB,
      6 * TPB,
      9 * TPB,
    ]);
  });
});
