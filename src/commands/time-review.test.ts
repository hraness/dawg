/**
 * Regressions from the 0.5 tempo review: meter has one writer, loop-length
 * sites follow the meter map, timed tracks cannot crowd out untimed ones,
 * live notes sound once, and long fermatas stay within what MIDI can write.
 */
import { describe, expect, test } from "bun:test";
import { midiTempoEvents } from "../../core/midi.ts";
import { createScore, ScoreValidationError } from "../../core/score.ts";
import {
  loopTicksOf,
  performedNotes,
  secondsAtTick,
  TIME_LIMITS,
} from "../../core/tempo.ts";
import { compositionBrief } from "../agent/brief.ts";
import { LiveSynth } from "../audio/live.ts";
import { parseEditCommand, applyEditCommand } from "./edit.ts";
import { typoFix, usageHint } from "./help.ts";
import { applyRhythmCommand, parseRhythmCommand } from "./rhythm.ts";
import { applyTimeCommand, parseTimeCommand } from "./time.ts";

const song = () =>
  createScore({
    tempoBpm: 120,
    bars: 4,
    tracks: [
      { id: "a", instrument: "piano" },
      { id: "drums", instrument: "kit" },
    ],
  });
const time = (score: ReturnType<typeof song>, text: string, track = "a") =>
  applyTimeCommand(score, track, parseTimeCommand(text)!);

describe("one writer for the opening meter", () => {
  test("meter 7/8 then meter 3 plays 3/4", () => {
    const seven = time(song(), "meter 7/8");
    expect(seven.ok).toBe(true);
    expect(loopTicksOf(seven.next!)).toBe(4 * 7 * 240);
    const command = parseEditCommand("meter 3");
    expect(command).toBeDefined();
    const three = applyEditCommand(seven.next!, "a", command!);
    expect(three.ok).toBe(true);
    expect(three.next!.time?.meter).toBeUndefined();
    expect(loopTicksOf(three.next!)).toBe(4 * 3 * 480);
  });
});

describe("loop length follows the meter map", () => {
  test("a Euclid row under 7/8 stays inside the song", () => {
    const seven = time(song(), "meter 7/8").next!;
    const filled = applyRhythmCommand(
      seven,
      "drums",
      parseRhythmCommand("euclid kick 3 8")!,
    );
    expect(filled.ok).toBe(true);
    const loop = loopTicksOf(seven);
    const hits = filled.next!.notes.filter((note) => note.trackId === "drums");
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit.startTick).toBeLessThan(loop);
  });

  test("the agent brief carries the resolved meter, loop and time", () => {
    let score = time(song(), "meter 7/8 at bar 2").next!;
    score = time(score, "rit 1 bars to 80").next!;
    score = time(score, "track rate 3/2").next!;
    const brief = JSON.parse(
      compositionBrief({ score, revision: 1, focusedTrackId: "a" }),
    );
    expect(brief.meter).toBe("4/4");
    expect(brief.loopBeats).toBe(loopTicksOf(score) / 480);
    expect(brief.loopBeats).toBe(4 + 3 * 3.5);
    expect(brief.time).toContain("7/8@bar2");
    expect(brief.time).toContain("→80@");
    expect(brief.tracks.find((t: { id: string }) => t.id === "a").time).toEqual(
      { rate: 1.5 },
    );
  });
});

describe("timed tracks and the placement cap", () => {
  test("untimed notes play even when a timed track hits the cap", () => {
    const notes = [];
    for (let index = 0; index < 64; index += 1)
      notes.push({
        id: `t${index}`,
        trackId: "a",
        startTick: index * 30,
        durationTicks: 30,
        pitch: 60,
        velocity: 0.8,
      });
    const score = createScore({
      bars: 64,
      tracks: [
        { id: "a", instrument: "piano", time: { cycle: 1920, rate: 8 } },
        { id: "b", instrument: "piano" },
      ],
      notes: [
        ...notes,
        {
          id: "u",
          trackId: "b",
          startTick: 0,
          durationTicks: 480,
          pitch: 50,
          velocity: 0.8,
        },
      ],
    });
    const placed = performedNotes(score);
    const timed = placed.filter((note) => note.trackId === "a");
    expect(timed.length).toBe(TIME_LIMITS.maxPerformedNotes);
    expect(placed.filter((note) => note.trackId === "b")).toHaveLength(1);
  });
});

describe("live notes on a timed track", () => {
  test("a held key sounds once, as on an untimed track", () => {
    const make = (timed: boolean) =>
      createScore({
        tempoBpm: 120,
        bars: 1,
        tracks: [
          {
            id: "lead",
            instrument: "piano",
            ...(timed ? { time: { cycle: 480, rate: 2 } } : {}),
          },
        ],
      });
    const request = { trackId: "lead", pitch: 60, velocity: 0.8, seconds: 1 };
    const plain = new LiveSynth(8_000).render({
      ...request,
      score: make(false),
    });
    const timed = new LiveSynth(8_000).render({
      ...request,
      score: make(true),
    });
    expect(timed!.frames).toBe(plain!.frames);
    expect(
      Buffer.from(timed!.pcm.buffer).equals(Buffer.from(plain!.pcm.buffer)),
    );
  });

  test("the tempo at the played tick sets the note length", () => {
    const score = time(
      createScore({
        tempoBpm: 120,
        bars: 4,
        tracks: [{ id: "lead", instrument: "piano" }],
      }),
      "tempo 60 at bar 3",
      "lead",
    ).next!;
    const synth = new LiveSynth(8_000);
    const request = { score, trackId: "lead", pitch: 60, velocity: 0.8 };
    const early = synth.render({ ...request, seconds: 0.5, tick: 0 })!;
    const late = synth.render({ ...request, seconds: 0.5, tick: 4000 })!;
    // Same held seconds: both render about half a second plus release.
    expect(Math.abs(early.frames - late.frames)).toBeLessThan(800);
    expect(synth.cached).toBe(2);
  });
});

describe("long fermatas and MIDI", () => {
  test("a hold past the SMF tempo limit is refused", () => {
    expect(() =>
      createScore({
        tempoBpm: 120,
        time: { fermatas: [{ tick: 1920, beats: 40 }] },
      }),
    ).toThrow(ScoreValidationError);
    expect(() =>
      createScore({
        tempoBpm: 20,
        time: { fermatas: [{ tick: 1920, beats: 64 }] },
      }),
    ).toThrow(/MIDI tempo limit/);
    const refused = time(song(), "fermata at 4 40");
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain("16.777");
  });

  test("the longest allowed hold keeps MIDI and WAV on the same seconds", () => {
    const score = createScore({
      tempoBpm: 120,
      bars: 4,
      time: { fermatas: [{ tick: 1920, beats: 32 }] },
    });
    const tempos = midiTempoEvents(score);
    const end = loopTicksOf(score);
    let seconds = 0;
    for (let i = 0; i < tempos.length; i += 1) {
      const from = tempos[i]!.tick;
      const to = Math.min(end, tempos[i + 1]?.tick ?? end);
      if (to > from)
        seconds += ((to - from) / 480) * (tempos[i]!.usPerQuarter / 1e6);
    }
    expect(seconds).toBeCloseTo(secondsAtTick(score, end), 4);
    expect(secondsAtTick(score, end)).toBeCloseTo(24, 6);
  });
});

describe("command help for the time verbs", () => {
  test("a one-letter slip on a time verb gets a local suggestion", () => {
    const parses = (text: string) => parseTimeCommand(text) !== undefined;
    expect(typoFix("ritt 4 bars to 80", parses)).toBe("rit 4 bars to 80");
  });

  test("an out-of-range track rate names the range", () => {
    const result = time(song(), "track rate 10");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("0.125..8");
    expect(usageHint("track")).toContain("track rate");
  });

  test("tempo map lists positions as the commands take them", () => {
    let score = time(song(), "tempo 90 at bar 3").next!;
    score = time(score, "fermata at 13 1").next!;
    const map = time(score, "tempo map");
    expect(map.message).toContain("=90 bar 3");
    expect(map.message).toContain("𝄐1 beat 13");
  });
});
