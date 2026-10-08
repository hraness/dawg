import { describe, expect, test } from "bun:test";
import { createScore, type TrackScore } from "../../core/score.ts";
import { findSection } from "../../core/sections.ts";
import { nearestCommand, typoFix, usageHint } from "./help.ts";
import {
  applySectionCommand,
  parseSectionCommand,
  type SectionCommand,
} from "./arrange.ts";

function song(bars = 16): TrackScore {
  const notes = Array.from({ length: bars }, (_, bar) => ({
    id: `n${bar}`,
    trackId: "lead",
    pitch: 60 + (bar % 5),
    startTick: bar * 4 * 480,
    durationTicks: 960,
    velocity: 0.8,
  }));
  return createScore({
    bars,
    tempoBpm: 120,
    tracks: [
      { id: "lead", name: "lead", instrument: "saw" },
      { id: "drums", name: "drums", instrument: "kit" },
    ],
    notes,
  });
}

function run(
  score: TrackScore,
  text: string,
): ReturnType<typeof applySectionCommand> {
  const command = parseSectionCommand(text, score);
  if (!command) throw new Error(`did not parse: ${text}`);
  return applySectionCommand(score, "lead", command);
}

function apply(score: TrackScore, ...texts: string[]): TrackScore {
  let next = score;
  for (const text of texts) {
    const result = run(next, text);
    if (!result.ok) throw new Error(`${text}: ${result.message}`);
    next = result.next ?? next;
  }
  return next;
}

describe("section commands parse", () => {
  const score = apply(song(), "section verse 1-8", "section chorus 9-16");

  test("marking bars is 1-based and inclusive", () => {
    expect(parseSectionCommand("section intro 1-4", score)).toEqual({
      type: "section-mark",
      name: "intro",
      startBar: 0,
      bars: 4,
    });
    expect(parseSectionCommand("section chorus 2 9..12", score)).toEqual({
      type: "section-mark",
      name: "chorus 2",
      startBar: 8,
      bars: 4,
    });
    expect(parseSectionCommand("section", score)).toEqual({
      type: "section-list",
    });
  });

  test("subcommands resolve section names, including spaced ones", () => {
    const spaced = apply(score, "section chorus 2 9-12");
    expect(parseSectionCommand("section loop chorus 2", spaced)).toEqual({
      type: "section-loop",
      name: "chorus 2",
    });
    expect(parseSectionCommand("section loop off", spaced)).toEqual({
      type: "section-loop",
    });
    expect(
      parseSectionCommand("section move verse after chorus", score),
    ).toEqual({
      type: "section-move",
      name: "verse",
      to: { after: "chorus" },
    });
    expect(parseSectionCommand("section rename verse to A", score)).toEqual({
      type: "section-rename",
      name: "verse",
      to: "A",
    });
    expect(
      parseSectionCommand("section vary chorus +12 gain 1.2", score),
    ).toEqual({
      type: "section-vary",
      name: "chorus",
      transpose: 12,
      gain: 1.2,
    });
  });

  test("generators take a section, a bar range or nothing", () => {
    expect(parseSectionCommand("build", score)).toEqual({
      type: "build",
      options: {},
    });
    expect(parseSectionCommand("build verse riser roll", score)).toEqual({
      type: "build",
      options: {
        section: "verse",
        riser: true,
        roll: true,
        sweep: false,
        uplifter: false,
      },
    });
    expect(parseSectionCommand("build 5-8", score)).toEqual({
      type: "build",
      options: { startBar: 4, bars: 4 },
    });
    expect(parseSectionCommand("drop chorus cut 2 no impact", score)).toEqual({
      type: "drop",
      options: { section: "chorus", cut: 2, impact: false },
    });
    expect(parseSectionCommand("fill verse toms 2 beats", score)).toEqual({
      type: "fill",
      options: { section: "verse", style: "toms", beats: 2 },
    });
  });

  test("prose still reaches the agent", () => {
    for (const prose of [
      "build a bigger chorus",
      "drop the bass an octave",
      "fill in the gaps with hats",
      "section off the verse please",
    ])
      expect(parseSectionCommand(prose, score)).toBeUndefined();
  });

  test("mark, into and names that are not bar ranges", () => {
    expect(parseSectionCommand("section mark verse 1-8", score)).toEqual({
      type: "section-mark",
      name: "verse",
      startBar: 0,
      bars: 8,
    });
    expect(parseSectionCommand("section add 1-4", score)).toBeUndefined();
    expect(parseSectionCommand("build into chorus 2 bars", score)).toEqual({
      type: "build",
      options: { into: "chorus", bars: 2 },
    });
    expect(run(score, "build into chorus").message).toContain("bars 5–8");
  });

  test("everyday words after build, drop, fill and form go to the agent", () => {
    for (const prose of [
      "build tension",
      "drop bass",
      "build up",
      "form a catchy hook",
    ]) {
      expect(parseSectionCommand(prose, score)).toBeUndefined();
      expect(usageHint(prose)).toBeUndefined();
    }
    expect(usageHint("build 99x")).toContain("build");
    expect(parseSectionCommand("form verse chrous", score)).toEqual({
      type: "form-set",
      text: "verse chrous",
    });
  });

  test("/help knows the verbs", () => {
    expect(nearestCommand("sectoin")).toBe("section");
    expect(nearestCommand("buidl")).toBe("build");
    expect(usageHint("section verse")).toContain("section");
    expect(
      typoFix("forn verse chorus", (text) =>
        Boolean(parseSectionCommand(text, score)),
      ),
    ).toBe("form verse chorus");
  });
});

describe("section commands apply", () => {
  test("mark, list, add, rename and delete", () => {
    let score = apply(song(), "section verse 1-8", "section chorus 9-16");
    expect(score.sections.map((s) => [s.name, s.startBar, s.bars])).toEqual([
      ["verse", 0, 8],
      ["chorus", 8, 8],
    ]);
    expect(run(score, "section").message).toContain("verse bars 1–8");
    score = apply(score, "section add outro 4");
    expect(score.bars).toBe(20);
    expect(findSection(score, "outro")).toMatchObject({
      startBar: 16,
      bars: 4,
    });
    score = apply(score, "section rename outro to tag");
    expect(findSection(score, "tag")).toBeDefined();
    score = apply(score, "section delete tag");
    expect(score.bars).toBe(16);
    expect(findSection(score, "tag")).toBeUndefined();
  });

  test("duplicate and move carry the music", () => {
    let score = apply(song(8), "section A 1-4", "section B 5-8");
    score = apply(score, "section dup A");
    expect(score.bars).toBe(12);
    const copy = score.sections.find((s) => s.name !== "A" && s.name !== "B")!;
    expect(copy.startBar).toBe(4);
    // The copy's first bar repeats A's first bar.
    const at = (bar: number) =>
      score.notes.find((note) => note.startTick === bar * 4 * 480)?.pitch;
    expect(at(4)).toBe(at(0));
    score = apply(score, "section move B before A");
    expect(findSection(score, "B")?.startBar).toBe(0);
    expect(findSection(score, "A")?.startBar).toBe(4);
  });

  test("mutes and variations name tracks or default to the focused one", () => {
    let score = apply(
      song(),
      "section chorus 9-16",
      "section mute chorus drums",
    );
    expect(findSection(score, "chorus")?.mute).toEqual(["drums"]);
    score = apply(score, "section vary chorus +12");
    expect(findSection(score, "chorus")?.vary).toEqual({
      lead: { transpose: 12 },
    });
    expect(run(score, "section mute chorus nobody").ok).toBe(false);
    score = apply(score, "section reset chorus");
    expect(findSection(score, "chorus")?.mute).toBeUndefined();
    expect(findSection(score, "chorus")?.vary).toBeUndefined();
  });

  test("form, loop and jump", () => {
    let score = apply(song(), "section A 1-8", "section B 9-16");
    score = apply(score, "form A A B A");
    expect(score.form.map((entry) => entry.section)).toEqual([
      "A",
      "A",
      "B",
      "A",
    ]);
    expect(run(score, "form").message).toContain("32 bars");
    // B starts at bar 17 of the arranged song.
    expect(run(score, "section jump B").seekBeat).toBe(16 * 4);
    score = apply(score, "section loop B");
    expect(score.loopSection).toBe("B");
    const jump = run(score, "section jump A");
    expect(jump.seekBeat).toBe(0);
    expect(jump.next?.loopSection).toBe("A");
    score = apply(score, "section loop off", "form bake");
    expect(score.bars).toBe(32);
    expect(score.form).toEqual([]);
    expect(score.loopSection).toBeUndefined();
  });

  test("errors are messages, not exceptions", () => {
    const score = apply(song(), "section A 1-8");
    const bad = run(score, "form A C");
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain("no section named C");
  });

  test("generators add their tracks", () => {
    let score = apply(song(), "section build 5-8", "section drop 9-16");
    score = apply(score, "build build", "drop drop", "fill build");
    const ids = score.tracks.map((track) => track.id);
    expect(ids).toContain("riser");
    expect(ids).toContain("impact");
    expect(run(score, "build").kind).toBe("score.build");
  });
});

test("every command type is covered by the parser", () => {
  const types = new Set<SectionCommand["type"]>();
  const score = apply(song(), "section A 1-8", "section B 9-16");
  for (const text of [
    "section",
    "section C 1-2",
    "section add",
    "section dup A",
    "section move A right",
    "section rename A B2",
    "section delete A",
    "section unmark A",
    "section mute A",
    "section vary A -5",
    "section reset A",
    "section loop A",
    "section jump A",
    "form",
    "form A B",
    "form bake",
    "build",
    "drop",
    "fill",
  ])
    types.add(parseSectionCommand(text, score)!.type);
  expect(types.size).toBe(19);
});

describe("misspelled section names stay local", () => {
  const score = apply(
    song(),
    "section intro 1-4",
    "section verse 5-8",
    "section chorus 9-12",
  );
  test.each([
    "section loop chrous",
    "/section jump chorsu",
    "section mute chrous lead",
    "section vary chrous lead +12",
    "section dup chrous",
    "section move chrous to 13",
    "section rename chrous to hook",
    "section delete chrous",
    "section unmark chrous",
    "section reset chrous",
  ])("%s answers with the sections and a suggestion", (text) => {
    const command = parseSectionCommand(text, score);
    expect(command?.type).toBe("section-unknown");
    const result = run(score, text);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("no section named");
    expect(result.message).toContain("sections: intro, verse, chorus");
    expect(result.message).toContain("did you mean chorus?");
    expect(result.next).toBeUndefined();
  });

  test("with no sections it says how to mark one", () => {
    expect(run(song(), "section loop chorus").message).toContain(
      "section verse 1-8",
    );
  });

  test("build then a bare drop lands after the build", () => {
    const built = apply(song(), "build");
    const result = run(built, "drop");
    expect(result.ok).toBe(true);
    expect(result.message).toContain("bar 17");
  });
});
