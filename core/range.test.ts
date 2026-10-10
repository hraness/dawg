import { describe, expect, test } from "bun:test";
import { diffScores } from "./diff.ts";
import {
  clearRange,
  copyRange,
  extractRange,
  moveRange,
  placeRange,
  rangeOf,
  reverseRange,
  steppedLoop,
} from "./range.ts";
import {
  applyScoreOperation,
  createScore,
  scoreFromJSON,
  ScoreValidationError,
  type TrackScore,
} from "./score.ts";
import { insertBars, joinSection, splitSection } from "./sections.ts";

const BAR = 4 * 480;

/** 8 bars: bass plays one note per bar, drums one on bar 1; verse 1-4, chorus 5-8. */
function song(): TrackScore {
  return createScore({
    bars: 8,
    tracks: [
      {
        id: "bass",
        name: "bass",
        instrument: "saw",
        volumeAutomation: [
          { tick: 0, value: 0.2 },
          { tick: 8 * BAR, value: 1 },
        ],
      },
      { id: "drums", name: "drums", instrument: "kit" },
    ],
    notes: [
      ...Array.from({ length: 8 }, (_, bar) => ({
        id: `b${bar + 1}`,
        trackId: "bass",
        pitch: 40 + bar,
        startTick: bar * BAR,
        durationTicks: 480,
        velocity: 0.8,
      })),
      {
        id: "k1",
        trackId: "drums",
        pitch: 36,
        startTick: 0,
        durationTicks: 120,
        velocity: 0.9,
      },
    ],
    sections: [
      { name: "verse", startBar: 0, bars: 4 },
      { name: "chorus", startBar: 4, bars: 4 },
    ],
  });
}

const pitchesIn = (score: TrackScore, trackId: string, bar: number) =>
  score.notes
    .filter(
      (note) =>
        note.trackId === trackId &&
        note.startTick >= bar * BAR &&
        note.startTick < (bar + 1) * BAR,
    )
    .map((note) => note.pitch)
    .sort();

describe("rangeOf: loop, then section, then bar", () => {
  test("the loop range wins", () => {
    const looped = song().withLoop({ startBar: 4, bars: 2 });
    expect(rangeOf(looped, 0)).toEqual({
      range: { startBar: 4, bars: 2 },
      source: "loop",
    });
  });
  test("else the section under the playhead", () => {
    expect(rangeOf(song(), 5)).toEqual({
      range: { startBar: 4, bars: 4 },
      source: "section",
      section: "chorus",
    });
  });
  test("else the bar", () => {
    const bare = createScore({ bars: 4, tracks: [], notes: [] });
    expect(rangeOf(bare, 2.5)).toEqual({
      range: { startBar: 2, bars: 1 },
      source: "bar",
    });
  });
});

describe("copy", () => {
  test("overwrites the destination on one track", () => {
    const next = copyRange(song(), ["bass"], { startBar: 4, bars: 2 }, 6);
    expect(pitchesIn(next, "bass", 6)).toEqual([44]);
    expect(pitchesIn(next, "bass", 7)).toEqual([45]);
    expect(next.bars).toBe(8);
    expect(next.tempoBpm).toBe(song().tempoBpm);
  });
  test("x3 tiles and grows the song", () => {
    const next = copyRange(song(), ["bass"], { startBar: 4, bars: 2 }, 6, {
      times: 3,
    });
    expect(next.bars).toBe(12);
    for (const bar of [6, 8, 10])
      expect(pitchesIn(next, "bass", bar)).toEqual([44]);
    for (const bar of [7, 9, 11])
      expect(pitchesIn(next, "bass", bar)).toEqual([45]);
  });
  test("merge overdubs", () => {
    const next = copyRange(song(), ["bass"], { startBar: 0, bars: 1 }, 1, {
      mode: "merge",
    });
    expect(pitchesIn(next, "bass", 1)).toEqual([40, 41]);
  });
  test("insert grows the bars and shifts sections, notes and automation", () => {
    const next = copyRange(song(), undefined, { startBar: 0, bars: 2 }, 4, {
      mode: "insert",
    });
    expect(next.bars).toBe(10);
    expect(next.sections.find((s) => s.name === "chorus")?.startBar).toBe(6);
    expect(pitchesIn(next, "bass", 4)).toEqual([40]);
    expect(pitchesIn(next, "drums", 4)).toEqual([36]);
    expect(pitchesIn(next, "bass", 6)).toEqual([44]);
    const lane = next.tracks[0]!.volumeAutomation!;
    expect(lane[lane.length - 1]).toEqual({ tick: 10 * BAR, value: 1 });
  });
  test("insert moves later clips, earlier ones stay", () => {
    const clip = (id: string, bar: number) => ({
      id,
      src: "tracks/bass/samples/hit.wav",
      sha256: "a".repeat(64),
      startTick: bar * BAR,
      dur: 0.5,
    });
    const withClips = applyScoreOperation(song(), {
      type: "setClips",
      trackId: "bass",
      clips: [clip("early", 1), clip("late", 5)],
    });
    const next = insertBars(withClips, 3, 2);
    expect(next.tracks[0]!.clips?.map((c) => c.startTick / BAR)).toEqual([
      1, 7,
    ]);
  });
  test("insert moves later tempo points", () => {
    const timed = applyScoreOperation(song(), {
      type: "setTime",
      time: { tempo: [{ tick: 6 * BAR, bpm: 90 }] },
    } as never);
    const next = copyRange(timed, ["bass"], { startBar: 0, bars: 1 }, 2, {
      mode: "insert",
    });
    expect(next.time?.tempo?.map((point) => point.tick)).toEqual([7 * BAR]);
  });
  test("a paste into another meter is refused", () => {
    const plain = song().withSections([], []);
    const mixed = applyScoreOperation(plain, {
      type: "setTime",
      time: { meter: [{ bar: 6, beatsPerBar: 7, beatUnit: 8 }] },
    } as never);
    expect(() =>
      copyRange(mixed, ["bass"], { startBar: 0, bars: 1 }, 6),
    ).toThrow("clipboard is 4/4 · bar 7 is 7/8");
  });
  test("one-track clipboard pastes onto the target track", () => {
    const clip = extractRange(song(), ["bass"], { startBar: 1, bars: 1 });
    const next = placeRange(song(), clip, 3, { target: "drums" });
    expect(pitchesIn(next, "drums", 3)).toEqual([41]);
    expect(pitchesIn(next, "bass", 3)).toEqual([43]);
  });
  test("note ids stay unique", () => {
    const next = copyRange(song(), undefined, { startBar: 0, bars: 4 }, 4, {
      times: 2,
    });
    const ids = next.notes.map((note) => note.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("move, clear, reverse", () => {
  test("move leaves the source silent", () => {
    const next = moveRange(song(), ["bass"], { startBar: 0, bars: 1 }, 2);
    expect(pitchesIn(next, "bass", 0)).toEqual([]);
    expect(pitchesIn(next, "bass", 2)).toEqual([40]);
    expect(pitchesIn(next, "drums", 0)).toEqual([36]);
  });
  test("move all insert ripples", () => {
    const next = moveRange(song(), undefined, { startBar: 6, bars: 2 }, 0, {
      insert: true,
    });
    expect(next.bars).toBe(8);
    expect(pitchesIn(next, "bass", 0)).toEqual([46]);
    expect(pitchesIn(next, "bass", 2)).toEqual([40]);
  });
  test("clear leaves the bars and trims a held note", () => {
    const held = createScore({
      bars: 4,
      tracks: [{ id: "pad", name: "pad", instrument: "saw" }],
      notes: [
        {
          id: "p",
          trackId: "pad",
          pitch: 60,
          startTick: 0,
          durationTicks: 3 * BAR,
          velocity: 0.5,
        },
      ],
    });
    const next = clearRange(held, ["pad"], { startBar: 1, bars: 1 });
    expect(next.bars).toBe(4);
    expect(next.notes[0]!.durationTicks).toBe(BAR);
  });
  test("reverse mirrors notes in range", () => {
    const next = reverseRange(song(), ["bass"], { startBar: 0, bars: 2 });
    expect(pitchesIn(next, "bass", 0)).toEqual([41]);
    expect(pitchesIn(next, "bass", 1)).toEqual([40]);
    const first = next.notes.find((note) => note.id === "b2")!;
    expect(first.startTick).toBe(BAR - 480);
  });
});

describe("score.loop", () => {
  test("creates no section and round-trips", () => {
    const looped = song().withLoop({ startBar: 4, bars: 2 });
    expect(looped.sections.map((s) => s.name)).toEqual(["verse", "chorus"]);
    expect(scoreFromJSON(looped.toJSON()).loop).toEqual({
      startBar: 4,
      bars: 2,
    });
  });
  test("one loop at a time", () => {
    const looped = song().withLoop({ startBar: 1, bars: 1 });
    const section = looped.withSections(looped.sections, looped.form, "chorus");
    expect(section.loop).toBeUndefined();
    expect(
      section.withLoop({ startBar: 0, bars: 1 }).loopSection,
    ).toBeUndefined();
  });
  test("diffs as one setLoop op", () => {
    const looped = song().withLoop({ startBar: 4, bars: 2 });
    expect(diffScores(song(), looped)).toEqual([
      { type: "setLoop", loop: { startBar: 4, bars: 2 } },
    ]);
  });
  test("rejects a bad range", () => {
    expect(() => song().withLoop({ startBar: -1, bars: 2 })).toThrow(
      ScoreValidationError,
    );
  });
  test("migrates the f07 hidden loop section", () => {
    const json = {
      ...song().toJSON(),
      sections: [...song().sections, { name: "loop", startBar: 2, bars: 2 }],
      loopSection: "loop",
    };
    const loaded = scoreFromJSON(json);
    expect(loaded.loop).toEqual({ startBar: 2, bars: 2 });
    expect(loaded.sections.map((s) => s.name)).toEqual(["verse", "chorus"]);
  });
  test("insertBars moves it", () => {
    const looped = song().withLoop({ startBar: 4, bars: 2 });
    expect(insertBars(looped, 2, 3).loop).toEqual({ startBar: 7, bars: 2 });
  });
  test("loop next steps by its length", () => {
    expect(steppedLoop(song(), { startBar: 4, bars: 2 }, 1)).toEqual({
      startBar: 6,
      bars: 2,
    });
    expect(steppedLoop(song(), { startBar: 0, bars: 2 }, -1)).toBeUndefined();
  });
});

describe("split and join", () => {
  test("split makes <name> 2 and the form plays both halves", () => {
    const formed = song().withSections(song().sections, [
      { section: "verse", repeat: 2 },
      { section: "chorus" },
    ]);
    const next = splitSection(formed, "verse", 2);
    expect(next.sections.map((s) => [s.name, s.startBar, s.bars])).toEqual([
      ["verse", 0, 2],
      ["verse 2", 2, 2],
      ["chorus", 4, 4],
    ]);
    expect(next.form.map((entry) => entry.section)).toEqual([
      "verse",
      "verse 2",
      "verse",
      "verse 2",
      "chorus",
    ]);
  });
  test("join undoes split", () => {
    const next = joinSection(splitSection(song(), "verse", 2), "verse");
    expect(next.sections).toEqual(song().sections);
  });
  test("join refuses when mutes differ", () => {
    const split = splitSection(song(), "verse", 2);
    const muted = split.withSections(
      split.sections.map((s) =>
        s.name === "verse 2" ? { ...s, mute: ["drums"] } : s,
      ),
      split.form,
    );
    expect(() => joinSection(muted, "verse")).toThrow(
      "mute or vary differently",
    );
    expect(joinSection(muted, "verse", { force: true }).sections[0]!.bars).toBe(
      4,
    );
  });
});
