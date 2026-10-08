import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import {
  bpmAtTick,
  loopTicksOf,
  performedNotes,
  secondsAtTick,
} from "../../core/tempo.ts";
import { usageHint } from "./help.ts";
import { applyTimeCommand, parseTimeCommand } from "./time.ts";

const song = () =>
  createScore({
    tempoBpm: 120,
    bars: 8,
    tracks: [
      { id: "a", instrument: "piano" },
      { id: "b", instrument: "piano" },
    ],
  });

describe("time grammar", () => {
  test("leaves the start tempo and plain meter to their own parsers", () => {
    expect(parseTimeCommand("tempo 90")).toBeUndefined();
    expect(parseTimeCommand("bpm 90")).toBeUndefined();
    expect(parseTimeCommand("meter 3")).toBeUndefined();
    expect(parseTimeCommand("track drums")).toBeUndefined();
    expect(parseTimeCommand("track name lead")).toBeUndefined();
  });

  test("parses tempo changes at beats and bars, with ramps", () => {
    expect(parseTimeCommand("tempo 90 at 16")).toEqual({
      type: "tempo-at",
      bpm: 90,
      at: { beat: 16 },
    });
    expect(parseTimeCommand("Tempo 140 at bar 9 ramp")).toEqual({
      type: "tempo-at",
      bpm: 140,
      at: { bar: 9 },
      ramp: "linear",
    });
    expect(parseTimeCommand("bpm 70 at beat 4 exp")).toEqual({
      type: "tempo-at",
      bpm: 70,
      at: { beat: 4 },
      ramp: "exp",
    });
    expect(parseTimeCommand("tempo remove bar 3")).toEqual({
      type: "tempo-remove",
      at: { bar: 3 },
    });
    expect(parseTimeCommand("tempo clear")).toEqual({ type: "tempo-clear" });
    expect(parseTimeCommand("tempo map")).toEqual({ type: "tempo-map" });
    expect(parseTimeCommand("tempo 900 at 4")).toBeUndefined();
    expect(parseTimeCommand("tempo 90 at bar 0")).toBeUndefined();
    expect(parseTimeCommand("tempo 90 at 4 wobble")).toBeUndefined();
  });

  test("parses rit and accel with defaults", () => {
    expect(parseTimeCommand("rit")).toEqual({
      type: "gradual",
      direction: "rit",
      length: 2,
      unit: "bars",
      curve: "linear",
    });
    expect(parseTimeCommand("ritardando 4 bars to 80")).toEqual({
      type: "gradual",
      direction: "rit",
      length: 4,
      unit: "bars",
      bpm: 80,
      curve: "linear",
    });
    expect(parseTimeCommand("accel 8 beats to 174 at bar 3 exp")).toEqual({
      type: "gradual",
      direction: "accel",
      length: 8,
      unit: "beats",
      bpm: 174,
      at: { bar: 3 },
      curve: "exp",
    });
    expect(parseTimeCommand("rall 1 bar from 12")?.type).toBe("gradual");
    expect(parseTimeCommand("rit 1.5 bars")).toBeUndefined();
    expect(parseTimeCommand("rit to 9000")).toBeUndefined();
  });

  test("parses fermatas and meter changes", () => {
    expect(parseTimeCommand("fermata")).toEqual({ type: "fermata", beats: 2 });
    expect(parseTimeCommand("fermata at 31 3")).toEqual({
      type: "fermata",
      at: { beat: 31 },
      beats: 3,
    });
    expect(parseTimeCommand("fermata at bar 4 for 1 beat")).toEqual({
      type: "fermata",
      at: { bar: 4 },
      beats: 1,
    });
    expect(parseTimeCommand("fermata at end 4")).toEqual({
      type: "fermata",
      beats: 4,
    });
    expect(parseTimeCommand("fermata remove 31")).toEqual({
      type: "fermata-remove",
      at: { beat: 31 },
    });
    expect(parseTimeCommand("fermata end")).toEqual({
      type: "fermata",
      beats: 2,
    });
    expect(parseTimeCommand("fermata bar 4 3")).toEqual({
      type: "fermata",
      at: { bar: 4 },
      beats: 3,
    });
    expect(parseTimeCommand("fermata 999")).toBeUndefined();
    expect(parseTimeCommand("meter 7/8 at bar 5")).toEqual({
      type: "meter-at",
      beatsPerBar: 7,
      beatUnit: 8,
      bar: 5,
    });
    expect(parseTimeCommand("meter 6/8")).toEqual({
      type: "meter-at",
      beatsPerBar: 6,
      beatUnit: 8,
    });
    expect(parseTimeCommand("meter 3 at bar 2")).toEqual({
      type: "meter-at",
      beatsPerBar: 3,
      beatUnit: 4,
      bar: 2,
    });
    expect(parseTimeCommand("meter remove bar 5")).toEqual({
      type: "meter-remove",
      bar: 5,
    });
    expect(parseTimeCommand("meter 7/7")).toBeUndefined();
    expect(parseTimeCommand("meter 7/8 at bar 0")).toBeUndefined();
  });

  test("parses track rate, phase, cycle and phasing", () => {
    expect(parseTimeCommand("track rate 1.5")).toEqual({
      type: "track-time",
      field: "rate",
      value: 1.5,
    });
    expect(parseTimeCommand("track rate 3/2")).toEqual({
      type: "track-time",
      field: "rate",
      value: 1.5,
    });
    expect(parseTimeCommand("track rate 2x")).toEqual({
      type: "track-time",
      field: "rate",
      value: 2,
    });
    expect(parseTimeCommand("track phase -0.5")).toEqual({
      type: "track-time",
      field: "phase",
      value: -0.5,
    });
    expect(parseTimeCommand("track cycle off")).toEqual({
      type: "track-time",
      field: "cycle",
      value: null,
    });
    expect(parseTimeCommand("track phasing 3 over 96 cycles 1")).toEqual({
      type: "track-phasing",
      cycle: 3,
      over: 96,
      cycles: 1,
    });
    expect(parseTimeCommand("track time off")).toEqual({
      type: "track-time-off",
    });
    expect(parseTimeCommand("track rate 20")).toMatchObject({ value: 20 });
    expect(parseTimeCommand("track phase 1/2")).toBeUndefined();
    expect(parseTimeCommand("track cycle 0")).toBeUndefined();
  });
});

describe("time commands", () => {
  const apply = (score: ReturnType<typeof song>, text: string, track = "a") =>
    applyTimeCommand(score, track, parseTimeCommand(text)!);

  test("tempo changes write the song time map; beat 0 sets the start tempo", () => {
    const start = apply(song(), "tempo 100 at 0");
    expect(start.ok).toBe(true);
    expect(start.kind).toBe("score.tempo");
    expect(start.next!.tempoBpm).toBe(100);
    expect(start.next!.time).toBeUndefined();

    const step = apply(song(), "tempo 90 at bar 5");
    expect(step.message).toBe("tempo · 90 BPM at bar 5");
    expect(step.kind).toBe("score.time");
    expect(step.next!.time).toEqual({ tempo: [{ tick: 16 * 480, bpm: 90 }] });

    const ramp = apply(step.next!, "tempo 60 at bar 7 ramp");
    expect(ramp.next!.time!.tempo).toEqual([
      { tick: 16 * 480, bpm: 90 },
      { tick: 24 * 480, bpm: 60, ramp: "linear" },
    ]);
    expect(apply(song(), "tempo 90 at bar 9").ok).toBe(false);

    const removed = apply(ramp.next!, "tempo remove bar 7");
    expect(removed.next!.time!.tempo).toEqual([{ tick: 16 * 480, bpm: 90 }]);
    expect(apply(song(), "tempo remove 4").ok).toBe(false);
    const cleared = apply(ramp.next!, "tempo clear");
    expect(cleared.next!.time).toBeUndefined();
    expect(apply(ramp.next!, "tempo map").message).toContain("tempo map");
  });

  test("rit over the last bars defaults to 75%; accel to 133%", () => {
    const score = song();
    const rit = apply(score, "rit");
    expect(rit.ok).toBe(true);
    expect(rit.message).toBe("rit · 120 → 90 BPM over 2 bars from bar 7");
    const end = loopTicksOf(rit.next!);
    expect(bpmAtTick(rit.next!, end)).toBeCloseTo(90, 6);
    expect(bpmAtTick(rit.next!, 24 * 480)).toBeCloseTo(120, 6);
    // The ritardando makes the song longer than at a steady 120.
    expect(secondsAtTick(rit.next!, end)).toBeGreaterThan(16);

    const accel = apply(score, "accel 4 bars at bar 1");
    expect(accel.message).toBe(
      "accel · 120 → 159.6 BPM over 4 bars from bar 1",
    );
    const targeted = apply(score, "rit 4 bars to 80 at bar 3");
    expect(bpmAtTick(targeted.next!, 24 * 480)).toBeCloseTo(80, 6);
    expect(apply(score, "rit to 140").ok).toBe(false);
    expect(apply(score, "accel to 100").ok).toBe(false);
    expect(apply(score, "rit 2 bars at bar 9").ok).toBe(false);
  });

  test("fermatas default to the last beat and lengthen the song", () => {
    const score = song();
    const fermata = apply(score, "fermata");
    expect(fermata.message).toBe("fermata · +2 beats at beat 31");
    expect(fermata.next!.time).toEqual({
      fermatas: [{ tick: 31 * 480, beats: 2 }],
    });
    expect(
      secondsAtTick(fermata.next!, loopTicksOf(fermata.next!)),
    ).toBeCloseTo(17, 6);
    const removed = apply(fermata.next!, "fermata remove 31");
    expect(removed.next!.time).toBeUndefined();
    expect(apply(score, "fermata remove 31").ok).toBe(false);
  });

  test("meter changes land on bar lines and the loop follows them", () => {
    const score = song();
    const seven = apply(score, "meter 7/8 at bar 5");
    expect(seven.message).toBe("meter · 7/8 from bar 5");
    expect(seven.next!.time).toEqual({
      meter: [{ bar: 4, beatsPerBar: 7, beatUnit: 8 }],
    });
    // Four 4/4 bars then four 7/8 bars.
    expect(loopTicksOf(seven.next!)).toBe(16 * 480 + 4 * 7 * 240);
    expect(apply(score, "meter 3/4 at bar 9").ok).toBe(false);
    const whole = apply(seven.next!, "meter 3/4");
    expect(whole.kind).toBe("score.meter");
    expect(whole.next!.beatsPerBar).toBe(3);
    expect(whole.next!.time!.meter).toEqual([
      { bar: 4, beatsPerBar: 7, beatUnit: 8 },
    ]);
    const removed = apply(seven.next!, "meter remove bar 5");
    expect(removed.next!.time).toBeUndefined();
    expect(apply(score, "meter remove bar 5").ok).toBe(false);
    const sixEight = apply(score, "meter 6/8");
    expect(sixEight.next!.time).toEqual({
      meter: [{ bar: 0, beatsPerBar: 6, beatUnit: 8 }],
    });
  });

  test("track time sets the focused track only", () => {
    const score = song();
    const rate = apply(score, "track rate 3/2", "b");
    expect(rate.kind).toBe("track.time");
    expect(rate.message).toBe("b · rate 1.5×");
    expect(rate.next!.tracks.find((t) => t.id === "b")!.time).toEqual({
      rate: 1.5,
    });
    expect(rate.next!.tracks.find((t) => t.id === "a")!.time).toBeUndefined();

    const phase = apply(rate.next!, "track phase 0.5", "b");
    expect(phase.next!.tracks.find((t) => t.id === "b")!.time).toEqual({
      rate: 1.5,
      phase: 240,
    });
    const off = apply(phase.next!, "track rate off", "b");
    expect(off.next!.tracks.find((t) => t.id === "b")!.time).toEqual({
      phase: 240,
    });
    const reset = apply(off.next!, "track time off", "b");
    expect(reset.next!.tracks.find((t) => t.id === "b")!.time).toBeUndefined();
    expect(apply(score, "track rate 2", "nope").ok).toBe(false);
  });

  test("track phasing picks the rate that gains one cycle per loop", () => {
    const score = song();
    // 32 beats of 4-beat cycles: the drifting track plays one cycle more.
    const phasing = apply(score, "track phasing 4", "b");
    expect(phasing.ok).toBe(true);
    const time = phasing.next!.tracks.find((t) => t.id === "b")!.time!;
    expect(time.cycle).toBe(4 * 480);
    expect(time.rate).toBeCloseTo((8 + 1) / 8, 9);
    const slow = apply(score, "track phasing 4 over 16 cycles -1", "b");
    expect(slow.next!.tracks.find((t) => t.id === "b")!.time!.rate).toBeCloseTo(
      3 / 4,
      9,
    );
  });

  test("a tempo and tempo primo step back after a rit", () => {
    expect(parseTimeCommand("a tempo")).toEqual({
      type: "tempo-return",
      primo: false,
    });
    expect(parseTimeCommand("tempo primo at bar 7")).toEqual({
      type: "tempo-return",
      primo: true,
      at: { bar: 7 },
    });
    let score = createScore({ tempoBpm: 120, bars: 8 });
    score = applyTimeCommand(score, "", {
      type: "tempo-at",
      bpm: 100,
      at: { bar: 3 },
    }).next!;
    score = applyTimeCommand(
      score,
      "",
      parseTimeCommand("rit 2 bars to 80 at bar 4")!,
    ).next!;
    const back = applyTimeCommand(score, "", parseTimeCommand("a tempo")!);
    expect(back.ok).toBe(true);
    expect(back.message).toBe("a tempo · 100 BPM at bar 7");
    expect(back.next!.time!.tempo!.at(-1)).toEqual({
      tick: 6 * 1920,
      bpm: 100,
    });
    const primo = applyTimeCommand(
      score,
      "",
      parseTimeCommand("tempo primo at bar 8")!,
    );
    expect(primo.message).toBe("tempo primo · 120 BPM at bar 8");
    const none = applyTimeCommand(
      createScore({ bars: 4 }),
      "",
      parseTimeCommand("a tempo")!,
    );
    expect(none.ok).toBe(false);
  });

  test("track phasing with hold or drift steps like Piano Phase", () => {
    expect(parseTimeCommand("track phasing 3 hold 8 drift 2")).toEqual({
      type: "track-phasing",
      cycle: 3,
      cycles: 1,
      hold: 8,
      drift: 2,
    });
    expect(parseTimeCommand("track phasing 3 over 48 hold 8")).toBeUndefined();
    const score = createScore({
      bars: 4,
      tracks: [{ id: "b", instrument: "piano", time: { rate: 1.5 } }],
    });
    const result = applyTimeCommand(score, "b", {
      type: "track-phasing",
      cycle: 3,
      cycles: 1,
      hold: 4,
    });
    expect(result.ok).toBe(true);
    expect(result.next!.tracks[0]!.time).toEqual({
      cycle: 1440,
      steps: { shift: 120, hold: 4, drift: 2 },
    });
    expect(result.message).toContain("hold 4, drift 2");
  });

  test("track phasing refuses spans that cannot realign every loop", () => {
    const score = song(); // 8 bars of 4/4, 32 beats
    // A 3-beat cycle does not fit 32 beats: the drift would reset mid-cycle.
    const odd = apply(score, "track phasing 3", "b");
    expect(odd.ok).toBe(false);
    expect(odd.message).toContain("bars 9");
    // Longer than the loop: the wrap resets the drift before it realigns.
    const long = apply(score, "track phasing 4 over 48", "b");
    expect(long.ok).toBe(false);
    expect(long.message).toContain("bars 12");
    const ragged = apply(score, "track phasing 3 over 16", "b");
    expect(ragged.ok).toBe(false);
    expect(ragged.message).toContain("whole number");
  });

  test("a phased pair lines up at every loop start and after `over`", () => {
    const base = createScore({
      tempoBpm: 120,
      bars: 4,
      tracks: [
        { id: "a", instrument: "piano" },
        { id: "b", instrument: "piano" },
      ],
      notes: ["a", "b"].map((trackId) => ({
        id: `${trackId}0`,
        trackId,
        pitch: 60,
        startTick: 0,
        durationTicks: 240,
        velocity: 0.8,
      })),
    });
    const phased = apply(base, "track phasing 2 over 8", "b").next!;
    const starts = (id: string) =>
      performedNotes(phased)
        .filter((note) => note.trackId === id)
        .map((note) => note.startTick);
    const b = new Set(starts("b").map((tick) => Math.round(tick)));
    // The loop (16 beats) holds two spans of 8: aligned at 0 and beat 8.
    expect(b.has(0)).toBe(true);
    expect(b.has(8 * 480)).toBe(true);
  });
});

test("usage hints cover the new verbs", () => {
  expect(usageHint("rit sideways")).toContain("rit 4 bars to 80");
  expect(usageHint("fermata now")).toContain("fermata at 31 2");
  expect(usageHint("meter 7/7")).toContain("meter 7/8");
});
