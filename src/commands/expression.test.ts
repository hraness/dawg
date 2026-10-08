import { describe, expect, test } from "bun:test";
import {
  createScore,
  scoreFromJSON,
  type TrackScore,
} from "../../core/score.ts";
import { nearestCommand, usageHint } from "./help.ts";
import {
  applyExpressionCommand,
  barPedal,
  parseExpressionCommand,
  parseNoteTarget,
  parseSeconds,
} from "./expression.ts";

const TPB = 480;

const score = () =>
  createScore({
    bars: 2,
    tracks: [{ id: "lead", instrument: "saw" }],
    notes: [0, 1, 2, 3, 4, 5, 6, 7].map((beat) => ({
      id: `n${beat}`,
      trackId: "lead",
      start: beat * TPB,
      duration: TPB,
      pitch: 60 + beat,
      velocity: 0.8,
    })),
  });

const run = (text: string, base: TrackScore = score()) => {
  const command = parseExpressionCommand(text);
  if (!command) throw new Error(`did not parse: ${text}`);
  return applyExpressionCommand(base, "lead", command);
};

const roundTrip = (next: TrackScore | undefined) =>
  scoreFromJSON(JSON.parse(JSON.stringify(next!.toJSON())));

describe("expression grammar", () => {
  test("targets and times", () => {
    expect(parseNoteTarget([])).toEqual({ type: "all" });
    expect(parseNoteTarget(["bar", "2"])).toEqual({
      type: "bars",
      from: 2,
      to: 2,
    });
    expect(parseNoteTarget(["bars", "1-2"])).toEqual({
      type: "bars",
      from: 1,
      to: 2,
    });
    expect(parseNoteTarget(["bars", "2-1"])).toBeUndefined();
    expect(parseNoteTarget(["n1", "n2"])).toEqual({
      type: "ids",
      ids: ["n1", "n2"],
    });
    expect(parseSeconds("60ms")).toBeCloseTo(0.06);
    expect(parseSeconds("0.2")).toBe(0.2);
    expect(parseSeconds("fast")).toBeUndefined();
  });

  test("parses every verb and rejects junk", () => {
    expect(parseExpressionCommand("art stac bar 1")).toEqual({
      type: "articulation",
      articulation: "staccato",
      target: { type: "bars", from: 1, to: 1 },
    });
    expect(parseExpressionCommand("art off")).toMatchObject({
      articulation: null,
    });
    expect(parseExpressionCommand("art wobbly")).toBeUndefined();
    expect(parseExpressionCommand("glide mono")).toEqual({
      type: "track-glide",
      mode: "mono",
    });
    expect(parseExpressionCommand("glide 80ms poly")).toEqual({
      type: "track-glide",
      time: 0.08,
      mode: "poly",
    });
    expect(parseExpressionCommand("glide 0 n3")).toEqual({
      type: "note-glide",
      glide: 0,
      target: { type: "ids", ids: ["n3"] },
    });
    expect(parseExpressionCommand("bend +200")).toMatchObject({
      bend: [
        { at: 0, cents: 0 },
        { at: 1, cents: 200 },
      ],
    });
    expect(parseExpressionCommand("bend 0:-100 0.25:0 bars 1-2")).toMatchObject(
      {
        bend: [
          { at: 0, cents: -100 },
          { at: 0.25, cents: 0 },
        ],
        target: { type: "bars", from: 1, to: 2 },
      },
    );
    expect(parseExpressionCommand("bend 9999")).toBeUndefined();
    expect(parseExpressionCommand("vibrato 5.5hz 30c 0.2s")).toMatchObject({
      vibrato: { rate: 5.5, depth: 30, delay: 0.2 },
    });
    expect(parseExpressionCommand("pedal 0-3.5 4-7.5")).toEqual({
      type: "pedal-spans",
      spans: [
        { from: 0, to: 3.5 },
        { from: 4, to: 7.5 },
      ],
    });
    expect(parseExpressionCommand("pedal half at 2")).toEqual({
      type: "pedal-event",
      state: "half",
      beat: 2,
    });
    expect(parseExpressionCommand("pedal 3-1")).toBeUndefined();
    expect(parseExpressionCommand("velcurve fixed 0.8")).toMatchObject({
      curve: "fixed",
      fixed: 0.8,
    });
    // One unit, 0..1: a MIDI-style 100 is rejected, not silently rescaled.
    expect(parseExpressionCommand("velcurve fixed 100")).toBeUndefined();
    // A bare glide number is ms; a misspelt mode is a typo, not a note id.
    expect(parseExpressionCommand("glide 60")).toEqual({
      type: "track-glide",
      time: 0.06,
    });
    expect(parseExpressionCommand("glide 0.06s")).toEqual({
      type: "track-glide",
      time: 0.06,
    });
    expect(parseExpressionCommand("glide 60ms legatoo")).toBeUndefined();
    // A bare fraction is a seconds-for-ms slip: reject it with the fix.
    const slip = parseExpressionCommand("glide 0.06");
    expect(slip).toMatchObject({ type: "invalid" });
    expect(run("glide 0.06").ok).toBe(false);
    expect(run("glide 0.06").message).toContain("glide 60ms");
    // `glide 0` (any unit) on the track turns glide off.
    for (const text of ["glide 0", "glide 0ms", "glide 0s"])
      expect(parseExpressionCommand(text)).toEqual({
        type: "track-glide",
        time: null,
      });
    expect(parseExpressionCommand("pedal")).toEqual({ type: "pedal-list" });
    expect(parseExpressionCommand("velcurve soft 0.5")).toBeUndefined();
    expect(parseExpressionCommand("humanize 10ms 8% 5% seed 7")).toEqual({
      type: "humanize",
      timing: 10,
      velocity: 8,
      length: 5,
      seed: 7,
    });
    expect(parseExpressionCommand("humanize 999")).toBeUndefined();
    expect(parseExpressionCommand("humanize a lot please")).toBeUndefined();
  });

  test("help knows the verbs for typo suggestions and usage", () => {
    expect(nearestCommand("humanise 10")).toBe("humanize");
    expect(nearestCommand("vibrto 5 20")).toBe("vibrato");
    expect(usageHint("pedal sideways")).toContain("pedal");
    expect(usageHint("velcurve")).toContain("soft");
  });
});

describe("expression commands", () => {
  test("articulation over a bar range is one revision on those notes", () => {
    const result = run("art staccato bar 2");
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("score.expression");
    expect(result.message).toContain("4 notes");
    const next = roundTrip(result.next);
    const marked = next.notes.filter((note) => note.articulation);
    expect(marked.map((note) => note.id)).toEqual(["n4", "n5", "n6", "n7"]);
    const cleared = run("art off", next);
    expect(cleared.next!.notes.some((note) => note.articulation)).toBe(false);
  });

  test("an empty target fails without a change", () => {
    const result = run("art accent bar 9");
    expect(result.ok).toBe(false);
    expect(result.next).toBeUndefined();
  });

  test("bend, vibrato and note glide land on notes and survive JSON", () => {
    let next = run("bend scoop n1").next!;
    next = run("vibrato 6 25 0.1 n1", next).next!;
    next = run("glide 50 n2", next).next!;
    const loaded = roundTrip(next);
    const n1 = loaded.notes.find((note) => note.id === "n1")!;
    expect(n1.bend).toEqual([
      { at: 0, cents: -100 },
      { at: 0.2, cents: 0 },
    ]);
    expect(n1.vibrato).toEqual({ rate: 6, depth: 25, delay: 0.1 });
    expect(loaded.notes.find((note) => note.id === "n2")!.glide).toBe(0.05);
  });

  test("track glide keeps time and mode independently", () => {
    let next = run("glide mono").next!;
    expect(next.tracks[0]!.glide).toEqual({ time: 0.06, mode: "mono" });
    next = run("glide 120ms", next).next!;
    expect(next.tracks[0]!.glide).toEqual({ time: 0.12, mode: "mono" });
    const off = run("glide off", next);
    expect(off.kind).toBe("score.performance");
    expect(off.next!.tracks[0]!.glide).toBeUndefined();
  });

  test("pedal spans, single events, bar re-pedalling and off", () => {
    let next = run("pedal 0-3.5").next!;
    expect(next.tracks[0]!.pedal).toEqual([
      { tick: 0, state: "down" },
      { tick: 3.5 * TPB, state: "up" },
    ]);
    next = run("pedal half 4", next).next!;
    expect(next.tracks[0]!.pedal).toHaveLength(3);
    expect(run("pedal off", next).next!.tracks[0]!.pedal).toBeUndefined();
    expect(run("pedal 0-99").ok).toBe(false);
    const bars = barPedal(score());
    // Lift at bar 2 and catch a 32nd later; up at the loop end.
    expect(bars).toEqual([
      { tick: 0, state: "down" },
      { tick: 4 * TPB, state: "up" },
      { tick: 4 * TPB + 60, state: "down" },
      { tick: 8 * TPB, state: "up" },
    ]);
  });

  test("velocity curve and humanize are track settings with a stored seed", () => {
    let next = run("velcurve fixed 0.7").next!;
    expect(next.tracks[0]!.velocityCurve).toEqual({
      curve: "fixed",
      fixed: 0.7,
    });
    next = run("velcurve linear", next).next!;
    expect(next.tracks[0]!.velocityCurve).toBeUndefined();
    next = run("humanize 12 6", next).next!;
    expect(next.tracks[0]!.humanize).toEqual({
      timing: 12,
      velocity: 6,
      seed: 1,
    });
    next = run("humanize reseed", next).next!;
    expect(next.tracks[0]!.humanize?.seed).toBe(2);
    next = run("humanize seed 42", next).next!;
    expect(next.tracks[0]!.humanize?.seed).toBe(42);
    next = run("humanize on", next).next!;
    expect(next.tracks[0]!.humanize).toEqual({
      timing: 8,
      velocity: 8,
      seed: 42,
    });
    expect(run("humanize off", next).next!.tracks[0]!.humanize).toBeUndefined();
    expect(run("humanize reseed").ok).toBe(false);
  });

  test("expression summarizes the track", () => {
    const next = run("art accent n0").next!;
    const shown = run("expression", next);
    expect(shown.ok).toBe(true);
    expect(shown.next).toBeUndefined();
    expect(shown.message).toContain("glide off");
    expect(shown.message).toContain("art 1");
  });
});

describe("meter map", () => {
  const metered = (meter: unknown[], bars: number, beats: number) =>
    createScore({
      bars,
      time: { meter },
      tracks: [{ id: "lead", instrument: "saw" }],
      notes: Array.from({ length: beats }, (_, beat) => ({
        id: `n${beat}`,
        trackId: "lead",
        start: beat * TPB,
        duration: TPB / 2,
        pitch: 60,
        velocity: 0.8,
      })),
    } as Parameters<typeof createScore>[0]);

  test("bar targets follow meter changes", () => {
    const base = metered([{ bar: 0, beatsPerBar: 3 }], 3, 9);
    const result = run("art staccato bar 2", base);
    expect(result.ok).toBe(true);
    const marked = result
      .next!.notes.filter((note) => note.articulation === "staccato")
      .map((note) => note.startTick / TPB);
    expect(marked).toEqual([3, 4, 5]);
  });

  test("pedal bars re-pedals on the real downbeats", () => {
    const base = metered([{ bar: 0, beatsPerBar: 3 }], 3, 9);
    const result = run("pedal bars", base);
    expect(result.ok).toBe(true);
    const pedal = result.next!.tracks[0]!.pedal!;
    const ups = pedal
      .filter((event) => event.state === "up")
      .map((event) => event.tick / TPB);
    expect(ups).toEqual([3, 6, 9]);
    expect(Math.max(...pedal.map((event) => event.tick))).toBe(9 * TPB);
  });

  test("a pedal event at the last beat of a song lengthened by 5/4 is valid", () => {
    const base = metered([{ bar: 1, beatsPerBar: 5 }], 2, 9);
    const result = run("pedal down 8.5", base);
    expect(result.ok).toBe(true);
    expect(run("pedal down 9.5", base).ok).toBe(false);
  });
});
