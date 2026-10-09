import { describe, expect, test } from "bun:test";
import { secondsAtTick } from "./tempo.ts";
import { decodeLoop, encodeLoop } from "./loop.ts";
import { diffScores } from "./diff.ts";
import {
  applyScoreOperation,
  createScore,
  scoreFromJSON,
  ScoreValidationError,
  TrackScore,
} from "./score.ts";
import {
  addSection,
  applySectionChanges,
  arrangedBars,
  arrangedStartBar,
  deleteSection,
  duplicateSection,
  findSection,
  flattenForm,
  formatForm,
  formPositionAt,
  formSegments,
  generateBuild,
  generateDrop,
  generateFill,
  hasArrangement,
  loopSection,
  moveSection,
  parseForm,
  renameSection,
  resetSection,
  sectionScore,
  setSectionMute,
  setSectionVariation,
  shiftSection,
  unmarkSection,
  withForm,
} from "./sections.ts";

function base(): TrackScore {
  return createScore({
    bars: 8,
    tracks: [
      { id: "lead", name: "lead", instrument: "saw" },
      { id: "drums", name: "drums", instrument: "kit" },
    ],
    notes: [
      {
        id: "n1",
        trackId: "lead",
        pitch: 60,
        startTick: 0,
        durationTicks: 480,
        velocity: 0.8,
      },
    ],
  });
}

describe("song sections in the score", () => {
  test("absent sections keep the 0.4 encoding byte-identical", () => {
    const score = base();
    expect(score.sections).toEqual([]);
    expect(score.form).toEqual([]);
    const json = encodeLoop(score);
    expect(json).not.toContain('"sections"');
    expect(json).not.toContain('"form"');
    expect(encodeLoop(decodeLoop(json))).toBe(json);
  });

  test("sections and form round-trip, sorted by bar, names canonical", () => {
    const score = base().withSections(
      [
        { name: "  Chorus ", startBar: 4, bars: 4, mute: ["drums", "drums"] },
        {
          name: "verse",
          startBar: 0,
          bars: 4,
          vary: { lead: { transpose: 12, gain: 1 } },
        },
      ],
      [{ section: "VERSE" }, { section: "chorus", repeat: 2 }],
    );
    expect(score.sections.map((s) => s.name)).toEqual(["verse", "Chorus"]);
    expect(score.sections[1]!.mute).toEqual(["drums"]);
    expect(score.sections[0]!.vary).toEqual({ lead: { transpose: 12 } });
    expect(score.form).toEqual([
      { section: "verse" },
      { section: "Chorus", repeat: 2 },
    ]);
    const again = decodeLoop(encodeLoop(score));
    expect(again.sections).toEqual(score.sections);
    expect(again.form).toEqual(score.form);
    expect(scoreFromJSON(score.toJSON()).sections).toEqual(score.sections);
  });

  test("rejects bad sections and forms", () => {
    const bad =
      (sections: unknown[], form: unknown[] = []) =>
      () =>
        scoreFromJSON({ ...base().toJSON(), sections, form });
    expect(bad([{ name: "", startBar: 0, bars: 1 }])).toThrow(
      ScoreValidationError,
    );
    expect(
      bad([
        { name: "a", startBar: 0, bars: 1 },
        { name: "A", startBar: 1, bars: 1 },
      ]),
    ).toThrow(/duplicate section/);
    expect(bad([{ name: "a", startBar: -1, bars: 1 }])).toThrow(/startBar/);
    expect(bad([{ name: "a", startBar: 0, bars: 0 }])).toThrow(/bars/);
    expect(bad([{ name: "a", startBar: 0, bars: 1 }], ["b"])).toThrow(
      /unknown section/,
    );
    expect(
      bad(
        [{ name: "a", startBar: 0, bars: 1 }],
        [{ section: "a", repeat: 99 }],
      ),
    ).toThrow(/repeat/);
    expect(
      bad([
        { name: "a", startBar: 0, bars: 1, vary: { x: { transpose: 99 } } },
      ]),
    ).toThrow(/transpose/);
  });

  test("setSections is an operation the diff emits and the reducer applies", () => {
    const before = base();
    const after = before.withSections(
      [{ name: "intro", startBar: 0, bars: 2 }],
      ["intro"].map((section) => ({ section })),
    );
    const ops = diffScores(before, after);
    expect(ops).toContainEqual({
      type: "setSections",
      sections: after.sections,
      form: after.form,
    });
    let replay = before;
    for (const op of ops) replay = applyScoreOperation(replay, op);
    expect(encodeLoop(replay)).toBe(encodeLoop(after));
    expect(diffScores(after, after)).toEqual([]);
  });

  test("score edits keep sections", () => {
    const score = base().withSections([
      { name: "intro", startBar: 0, bars: 2 },
    ]);
    expect(score.withTempo(90).sections).toEqual(score.sections);
    expect(score.withBars(4).sections).toEqual(score.sections);
    expect(score.removeNote("n1").sections).toEqual(score.sections);
  });
});

function song(): TrackScore {
  // 8 bars: verse 0-3, chorus 4-7; one lead note and one kick per bar.
  const notes = [];
  for (let bar = 0; bar < 8; bar += 1) {
    notes.push({
      id: `l${bar}`,
      trackId: "lead",
      pitch: 60 + bar,
      startTick: bar * 1920,
      durationTicks: 960,
      velocity: 0.5,
    });
    notes.push({
      id: `k${bar}`,
      trackId: "drums",
      pitch: 36,
      startTick: bar * 1920,
      durationTicks: 120,
      velocity: 0.9,
    });
  }
  return createScore({
    bars: 8,
    tracks: [
      { id: "lead", name: "lead", instrument: "saw" },
      { id: "drums", name: "drums", instrument: "kit" },
    ],
    notes,
    sections: [
      { name: "verse", startBar: 0, bars: 4 },
      { name: "chorus", startBar: 4, bars: 4 },
    ],
  });
}

describe("arrangement core", () => {
  test("form segments, arranged length and playback position", () => {
    const score = withForm(song(), parseForm(song(), "verse chorus*2 verse"));
    expect(formatForm(score.form)).toBe("verse chorus×2 verse");
    const segments = formSegments(score);
    expect(segments.map((s) => [s.section.name, s.startBar, s.pass])).toEqual([
      ["verse", 0, 0],
      ["chorus", 4, 0],
      ["chorus", 8, 1],
      ["verse", 12, 0],
    ]);
    expect(arrangedBars(score)).toBe(16);
    // Beat 36 = arranged bar 9 = second chorus pass, score bar 5.
    const at = formPositionAt(score, 36);
    expect(at.index).toBe(2);
    expect(at.scoreBeat).toBe(20);
    // Wraps at the end of the form.
    expect(formPositionAt(score, 64 + 1).scoreBeat).toBe(1);
    expect(arrangedStartBar(score, findSection(score, "chorus")!)).toBe(4);
  });

  test("parseForm accepts commas, x repeats and reports unknown names", () => {
    const score = song();
    expect(parseForm(score, "Verse, chorus x3")).toEqual([
      { section: "verse" },
      { section: "chorus", repeat: 3 },
    ]);
    expect(parseForm(score, "none")).toEqual([]);
    expect(() => parseForm(score, "verse bridge")).toThrow(
      /no section named bridge/,
    );
  });

  test("straight through, a section's mutes and variations apply to its bars", () => {
    const plain = song();
    expect(applySectionChanges(plain)).toBe(plain);
    let score = setSectionMute(plain, "verse", "drums", true);
    score = setSectionVariation(score, "chorus", "lead", {
      transpose: 12,
      gain: 0.5,
    });
    score = setSectionVariation(score, "chorus", "drums", { transpose: 5 });
    const heard = applySectionChanges(score);
    expect(heard.sections).toEqual([]);
    const kicks = heard.notes.filter((note) => note.trackId === "drums");
    // Verse kicks are muted; drums never transpose.
    expect(kicks.map((note) => note.startTick / 1920)).toEqual([4, 5, 6, 7]);
    expect(kicks.every((note) => note.pitch === 36)).toBe(true);
    const lead = heard.notes.filter((note) => note.trackId === "lead");
    expect(lead[0]!.pitch).toBe(60);
    expect(lead[4]!.pitch).toBe(64 + 12);
    expect(lead[4]!.velocity).toBe(0.25);
    expect(hasArrangement(score)).toBe(true);
    expect(hasArrangement(plain)).toBe(false);
    expect(resetSection(score, "chorus").sections[1]).toEqual({
      name: "chorus",
      startBar: 4,
      bars: 4,
    });
  });

  test("sectionScore crops notes and carries automation across the cut", () => {
    const base = song();
    const swept = new TrackScore({
      ...base.toJSON(),
      notes: [
        ...base.notes,
        {
          id: "long",
          trackId: "lead",
          pitch: 50,
          startTick: 6 * 1920,
          durationTicks: 4 * 1920,
          velocity: 0.5,
        },
      ],
      tracks: base.tracks.map((track) =>
        track.id === "lead"
          ? {
              ...track,
              volumeAutomation: [
                { tick: 0, value: 0 },
                { tick: 8 * 1920, value: 1 },
              ],
            }
          : track,
      ),
    });
    const chorus = sectionScore(swept, findSection(swept, "chorus")!);
    expect(chorus.bars).toBe(4);
    expect(chorus.sections).toEqual([]);
    const long = chorus.notes.find((note) => note.pitch === 50)!;
    expect(long.startTick).toBe(2 * 1920);
    expect(long.durationTicks).toBe(2 * 1920);
    const lane = chorus.tracks.find((t) => t.id === "lead")!.volumeAutomation;
    expect(lane[0]).toEqual({ tick: 0, value: 0.5 });
    expect(lane[lane.length - 1]).toEqual({ tick: 4 * 1920, value: 1 });
  });

  test("duplicate, move and delete ripple the music; rename and unmark keep it", () => {
    const score = song();
    const dup = duplicateSection(score, "verse");
    expect(dup.bars).toBe(12);
    expect(dup.sections.map((s) => [s.name, s.startBar, s.bars])).toEqual([
      ["verse", 0, 4],
      ["verse 2", 4, 4],
      ["chorus", 8, 4],
    ]);
    const leadPitches = (value: TrackScore) =>
      value.notes
        .filter((note) => note.trackId === "lead")
        .sort((a, b) => a.startTick - b.startTick)
        .map((note) => note.pitch);
    expect(leadPitches(dup)).toEqual([
      60, 61, 62, 63, 60, 61, 62, 63, 64, 65, 66, 67,
    ]);
    expect(new Set(dup.notes.map((note) => note.id)).size).toBe(
      dup.notes.length,
    );

    const moved = moveSection(score, "chorus", 0);
    expect(moved.bars).toBe(8);
    expect(moved.sections.map((s) => [s.name, s.startBar])).toEqual([
      ["chorus", 0],
      ["verse", 4],
    ]);
    expect(leadPitches(moved)).toEqual([64, 65, 66, 67, 60, 61, 62, 63]);
    expect(shiftSection(score, "verse", 1).sections[0]!.name).toBe("chorus");

    const formed = withForm(score, parseForm(score, "verse chorus verse"));
    const deleted = deleteSection(formed, "verse");
    expect(deleted.bars).toBe(4);
    expect(deleted.sections).toEqual([
      { name: "chorus", startBar: 0, bars: 4 },
    ]);
    expect(deleted.form).toEqual([{ section: "chorus" }]);
    expect(leadPitches(deleted)).toEqual([64, 65, 66, 67]);

    const renamed = renameSection(formed, "verse", "Verse A");
    expect(renamed.form.map((entry) => entry.section)).toEqual([
      "Verse A",
      "chorus",
      "Verse A",
    ]);
    const unmarked = unmarkSection(formed, "chorus");
    expect(unmarked.notes).toEqual(formed.notes);
    expect(unmarked.form).toEqual([{ section: "verse" }, { section: "verse" }]);
  });

  test("addSection names and places sections after the last one", () => {
    const empty = createScore({ bars: 8 });
    const one = addSection(empty);
    expect(one.sections).toEqual([{ name: "intro", startBar: 0, bars: 8 }]);
    const two = addSection(one, { name: "drop" });
    expect(two.bars).toBe(16);
    expect(two.sections[1]).toEqual({ name: "drop", startBar: 8, bars: 8 });
    expect(() => addSection(two, { name: "Drop" })).toThrow(/exists/);
  });

  test("flattenForm bakes the form into plain bars", () => {
    const score = setSectionMute(
      withForm(song(), parseForm(song(), "chorus verse")),
      "verse",
      "drums",
      true,
    );
    const flat = flattenForm(score);
    expect(flat.bars).toBe(8);
    expect(flat.form).toEqual([]);
    expect(flat.sections.map((s) => [s.name, s.startBar])).toEqual([
      ["chorus", 0],
      ["verse", 4],
    ]);
    const lead = flat.notes
      .filter((note) => note.trackId === "lead")
      .sort((a, b) => a.startTick - b.startTick)
      .map((note) => note.pitch);
    expect(lead).toEqual([64, 65, 66, 67, 60, 61, 62, 63]);
    expect(flat.notes.filter((note) => note.trackId === "drums").length).toBe(
      4,
    );
  });

  test("flattenForm starts every pass from its own automation", () => {
    // A has no filter curve; B ramps 200 Hz to 8 kHz. The second A must
    // play at the static cutoff, not B's last value.
    const ticks = 4 * 480;
    let score = createScore({
      bars: 2,
      tracks: [
        {
          id: "lead",
          name: "lead",
          instrument: "saw",
          filter: { type: "lpf", cutoff: 1000, resonance: 0 },
          filterAutomation: [
            { tick: ticks, value: 200 },
            { tick: 2 * ticks - 1, value: 8000 },
          ],
        },
      ],
    });
    score = addSection(score, { name: "a", startBar: 0, bars: 1 });
    score = addSection(score, { name: "b", startBar: 1, bars: 1 });
    score = withForm(score, parseForm(score, "a b a"));
    const lane = flattenForm(score).tracks[0]!.filterAutomation!;
    const at = (tick: number) => {
      let value = 1000;
      for (const point of lane) if (point.tick <= tick) value = point.value;
      return value;
    };
    expect(at(0)).toBe(1000);
    expect(at(ticks + 10)).toBeLessThan(1000);
    expect(at(2 * ticks)).toBe(1000);
    expect(at(3 * ticks - 1)).toBe(1000);
  });

  test("generators write ordinary tracks and notes, deterministically", () => {
    const score = song();
    const build = generateBuild(score, { section: "verse" });
    expect(build.summary).toMatch(/riser/);
    const ids = build.score.tracks.map((track) => track.id);
    expect(ids).toContain("riser");
    const roll = build.score.notes.filter(
      (note) =>
        note.trackId === "drums" &&
        note.startTick >= 0 &&
        note.startTick < 4 * 1920 &&
        note.pitch !== 36,
    );
    expect(roll.length).toBeGreaterThan(8);
    expect(generateBuild(score, { section: "verse" }).score.toJSON()).toEqual(
      build.score.toJSON(),
    );
    const drop = generateDrop(build.score, { section: "chorus" });
    expect(drop.summary.length).toBeGreaterThan(0);
    expect(drop.score.tracks.map((track) => track.id)).toContain("impact");
    const fill = generateFill(score, { section: "chorus", style: "toms" });
    expect(fill.score.notes.length).toBeGreaterThan(score.notes.length);
    // Every generated score survives a JSON round trip.
    for (const value of [build.score, drop.score, fill.score])
      expect(scoreFromJSON(value.toJSON()).toJSON()).toEqual(value.toJSON());
  });

  test("build into a section stays before its downbeat", () => {
    const score = song();
    const build = generateBuild(score, { into: "chorus", bars: 2 });
    expect(build.summary).toContain("bars 3–4");
    const added = build.score.notes.filter(
      (note) => !score.notes.some((old) => old.id === note.id),
    );
    expect(added.length).toBeGreaterThan(0);
    for (const note of added) {
      expect(note.startTick).toBeGreaterThanOrEqual(2 * 1920);
      expect(note.startTick + note.durationTicks).toBeLessThanOrEqual(4 * 1920);
    }
    // A section with bars: its last bars.
    expect(
      generateBuild(score, { section: "verse", bars: 1 }).summary,
    ).toContain("bars 4–4");
    expect(() => generateBuild(score, { into: "verse" })).toThrow(/bar 1/);
  });

  test("build sweeps cutoff on an octave curve", () => {
    const build = generateBuild(song(), { into: "chorus", bars: 4 });
    const lane = build.score.tracks.find(
      (t) => t.id === "riser",
    )!.filterAutomation!;
    const mid = 2 * 1920;
    let value = 0;
    for (const point of lane) if (point.tick <= mid) value = point.value;
    // Geometric midpoint of 300..12000 is about 1897 Hz, not 6150.
    expect(value).toBeGreaterThan(1500);
    expect(value).toBeLessThan(2300);
  });

  test("builds of different lengths get their own uplifter", () => {
    let score = generateBuild(song(), { into: "chorus", bars: 1 }).score;
    score = generateBuild(score, { section: "chorus" }).score;
    const uplifters = score.tracks.filter((t) => t.id.startsWith("uplifter"));
    expect(uplifters.map((t) => t.id)).toEqual(["uplifter", "uplifter-2"]);
    expect(uplifters[0]!.synth?.pattack).not.toBe(uplifters[1]!.synth?.pattack);
    // A repeat of the first length reuses its track.
    score = generateBuild(score, { section: "verse", bars: 1 }).score;
    expect(
      score.tracks.filter((t) => t.id.startsWith("uplifter")),
    ).toHaveLength(2);
  });

  test("drop defaults to the drop or chorus section and reports clamping", () => {
    const drop = generateDrop(song(), { cut: 99 });
    expect(drop.summary).toContain("bar 5");
    expect(drop.summary).toContain("clamped to 8");
    const bare = createScore({ bars: 4 });
    expect(() => generateDrop(bare)).toThrow(/drop at 17/);
  });

  test("a bare drop lands after the last build when no section matches", () => {
    // A build over the song's last bars: the drop adds the bar it lands on.
    const end = generateBuild(createScore({ bars: 16 }), {}).score;
    const landed = generateDrop(end);
    expect(landed.summary).toContain("drop at bar 17");
    expect(landed.score.bars).toBe(17);
    const built = generateBuild(createScore({ bars: 24 }), {
      startBar: 8,
      bars: 4,
    }).score;
    const drop = generateDrop(built);
    expect(drop.summary).toContain("drop at bar 13");
  });

  test("a drop cut retunes a clipped uplifter so its rise ends at the cut", () => {
    const score = song();
    const built = generateBuild(score, { into: "chorus", bars: 2 }).score;
    const dropped = generateDrop(built, { section: "chorus", cut: 2 }).score;
    const uplifter = dropped.notes.find((note) =>
      note.trackId.startsWith("uplifter"),
    )!;
    const track = dropped.tracks.find((t) => t.id === uplifter.trackId)!;
    // 120 bpm: the 2-bar uplifter (4 s) ends 2 beats (1 s) early, at 3 s.
    expect(uplifter.startTick + uplifter.durationTicks).toBe(4 * 1920 - 960);
    expect(track.synth?.pattack).toBe(3);
    // No uplifter track is left without notes.
    for (const t of dropped.tracks.filter((t) => t.id.startsWith("uplifter")))
      expect(dropped.notes.some((note) => note.trackId === t.id)).toBe(true);
  });

  test("fill <section> leads into it with a tom descent", () => {
    const fill = generateFill(song(), { section: "chorus", beats: 1 });
    expect(fill.summary).toContain("into bar 5");
    const toms = fill.score.notes
      .filter(
        (note) => note.trackId === "drums" && [50, 47, 45].includes(note.pitch),
      )
      .sort((a, b) => a.startTick - b.startTick)
      .map((note) => note.pitch);
    expect(toms[0]).toBe(50);
    expect(toms.at(-1)).toBe(45);
  });

  test("a held note stops where a later section mutes its track", () => {
    const score = createScore({
      bars: 4,
      tracks: [{ id: "pad", name: "pad", instrument: "saw" }],
      notes: [
        {
          id: "p",
          trackId: "pad",
          pitch: 60,
          startTick: 0,
          durationTicks: 4 * 1920,
          velocity: 0.5,
        },
      ],
      sections: [
        { name: "verse", startBar: 0, bars: 2 },
        { name: "chorus", startBar: 2, bars: 2, mute: ["pad"] },
      ],
    });
    const played = applySectionChanges(score);
    expect(played.notes[0]!.durationTicks).toBe(2 * 1920);
  });

  test("loopSection is saved, follows renames and drops with its section", () => {
    const marked = addSection(addSection(base(), { name: "verse", bars: 4 }), {
      name: "chorus",
      bars: 4,
    });
    const score = withForm(marked, parseForm(marked, "verse chorus"));
    const looped = loopSection(score, "CHORUS");
    expect(looped.loopSection).toBe("chorus");
    const json = encodeLoop(looped);
    expect(json).toContain('"loopSection":"chorus"');
    expect(decodeLoop(json).loopSection).toBe("chorus");
    const renamed = renameSection(looped, "chorus", "hook");
    expect(renamed.loopSection).toBe("hook");
    expect(deleteSection(renamed, "hook").loopSection).toBeUndefined();
    expect(loopSection(renamed, undefined).loopSection).toBeUndefined();
    expect(() => loopSection(score, "bridge")).toThrow(ScoreValidationError);
    const op = diffScores(score, looped);
    expect(op.some((entry) => entry.type === "setSections")).toBe(true);
    let applied = score;
    for (const entry of op) applied = applyScoreOperation(applied, entry);
    expect(applied.loopSection).toBe("chorus");
    // Without sections a stray loopSection is dropped, never an error.
    expect(
      scoreFromJSON({ ...base().toJSON(), loopSection: "x" }).loopSection,
    ).toBeUndefined();
  });
});

describe("forms in linear order", () => {
  test("flatten to the linear score, with held notes intact", () => {
    const base = createScore({
      bars: 8,
      tracks: [{ id: "pad", name: "pad", instrument: "sine" }],
      notes: [
        {
          // pushed an eighth ahead of the chorus downbeat, tied over it
          id: "push",
          trackId: "pad",
          pitch: 60,
          startTick: 4 * 1920 - 240,
          durationTicks: 2160,
          velocity: 0.7,
        },
      ],
    }).withSections(
      [
        { name: "verse", startBar: 0, bars: 4 },
        { name: "chorus", startBar: 4, bars: 4 },
      ],
      [],
    );
    const flat = flattenForm(withForm(base, parseForm(base, "verse chorus")));
    expect(
      flat.notes.map((note) => [note.startTick, note.durationTicks]),
    ).toEqual(base.notes.map((note) => [note.startTick, note.durationTicks]));
  });
});

describe("a form keeps tempo ramps that cross section boundaries", () => {
  test("a form in song order times exactly like the song", () => {
    const ticks = 4 * 480;
    // 96 bpm gliding linearly to 60 over bars 0..6, then 60 to the end.
    const song = createScore({
      bars: 8,
      tempoBpm: 96,
      tracks: [{ id: "lead", name: "lead", instrument: "sine" }],
      notes: [],
    })
      .withTime({ tempo: [{ tick: 6 * ticks, bpm: 60, ramp: "linear" }] })
      .withSections(
        [
          { name: "a", startBar: 0, bars: 2 },
          { name: "b", startBar: 2, bars: 3 },
          { name: "c", startBar: 5, bars: 3 },
        ],
        [],
      );
    const formed = withForm(song, parseForm(song, "a b c"));
    const flat = flattenForm(formed);
    for (const bar of [1, 2, 3, 5, 6, 8])
      expect(secondsAtTick(flat, bar * ticks)).toBeCloseTo(
        secondsAtTick(song, bar * ticks),
        2,
      );
  });
});
