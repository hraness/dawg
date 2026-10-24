import { describe, expect, test } from "bun:test";
import {
  compileSheet,
  critique,
  DEMO_SOURCES,
  extractSheet,
  generateSong,
  messages,
  parseReply,
  sheetSchema,
  validateSheet,
  type SongSheet,
} from "./index.ts";
import { createDemo } from "../../demos/index.ts";
import { voiceProgression } from "./compile.ts";
import { candySheet } from "./extract.ts";
import { chordClasses, degreePitch, parseKey } from "./sheet.ts";

const roundTrip = (sheet: SongSheet): unknown =>
  JSON.parse(JSON.stringify(sheet));
const demoSheets = () => DEMO_SOURCES.map((source) => extractSheet(source));

describe("hyperpop song sheets", () => {
  test("degrees and numerals follow the key", () => {
    const fm = parseKey("F minor")!;
    expect(fm.label).toBe("Fm");
    expect([1, 3, 5, 8, 0].map((d) => degreePitch(fm, d))).toEqual([
      65, 68, 72, 77, 63,
    ]);
    const a = parseKey("A major")!;
    expect(degreePitch(a, 1)).toBe(69);
    // vi in A major is F# minor with its seventh.
    expect(chordClasses(a, 6)).toEqual([6, 9, 1, 4]);
    expect(parseKey("H minor")).toBeUndefined();
  });

  test("progressions voice near each other, never a semitone apart", () => {
    const key = parseKey("D minor")!;
    const chords = voiceProgression(key, ["i", "VI", "III", "VII"]);
    for (const chord of chords) {
      expect(chord.bass).toBeGreaterThanOrEqual(36);
      expect(chord.bass).toBeLessThanOrEqual(47);
      for (const tone of chord.tones) expect(tone).toBeGreaterThanOrEqual(53);
      const sorted = [...chord.tones].sort((x, y) => x - y);
      for (let i = 1; i < sorted.length; i++)
        expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThan(1);
    }
    // A first inversion puts the 3rd in the bass: V6 in E major is B/D#.
    const [inverted] = voiceProgression(parseKey("E major")!, ["V6"]);
    expect(inverted!.bass % 12).toBe(3);
  });

  test("the Candy Fault sheet plays the demo back", () => {
    const checked = validateSheet(roundTrip(candySheet().sheet));
    if (!checked.ok) throw new Error(checked.errors.join("\n"));
    const score = compileSheet(checked.sheet);
    const demo = createDemo("candy-fault").toJSON() as unknown as Readonly<{
      bars: number;
      notes: readonly { trackId: string }[];
    }>;
    expect(score.bars).toBe(demo.bars);
    const count = (notes: readonly { trackId: string }[]) => {
      const out: Record<string, number> = {};
      for (const n of notes) out[n.trackId] = (out[n.trackId] ?? 0) + 1;
      return out;
    };
    const want = count(demo.notes);
    const got = count(score.notes);
    // The drums, 808 and arps are the demo's own; the topline, harmony and
    // answers are derived from the chords, so they land within a tenth.
    for (const id of ["kick", "snap", "hats", "sub", "arp", "arp2"])
      expect(got[id]).toBe(want[id]);
    for (const [id, n] of Object.entries(want))
      expect(Math.abs((got[id] ?? 0) - n)).toBeLessThanOrEqual(
        Math.ceil(n * 0.12),
      );
    // No key change: every pitched note stays in E major.
    const scale = new Set([4, 6, 8, 9, 11, 1, 3]);
    for (const note of score.notes)
      if (
        ["vocal", "harm", "high", "keys", "arp", "arp2"].includes(note.trackId)
      )
        expect(scale.has(note.pitch % 12)).toBe(true);
  });

  test("a candy sheet moved to another key stays in that key", () => {
    const moved = { ...candySheet().sheet, key: "A major", title: "Moved" };
    const checked = validateSheet(roundTrip(moved));
    if (!checked.ok) throw new Error(checked.errors.join("\n"));
    const score = compileSheet(checked.sheet);
    const scale = new Set([9, 11, 1, 2, 4, 6, 8]);
    for (const note of score.notes)
      if (
        ["vocal", "harm", "keys", "chords", "arp", "hook"].includes(
          note.trackId,
        )
      )
        expect(scale.has(note.pitch % 12)).toBe(true);
  });

  test("every demo distills to a sheet that validates, scores well and renders", () => {
    for (const { sheet, notes } of demoSheets()) {
      expect(notes.filter((n) => !n.includes("thirds"))).toEqual([]);
      const checked = validateSheet(roundTrip(sheet));
      if (!checked.ok) throw new Error(checked.errors.join("\n"));
      expect(checked.warnings).toEqual([]);
      expect(critique(checked.sheet).score).toBeGreaterThanOrEqual(90);
      const score = compileSheet(checked.sheet);
      expect(score.bars).toBe(sheet.sections.reduce((n, s) => n + s.bars, 0));
      const ids = new Set(score.tracks.map((t) => t.id));
      if (sheet.palette === "candy") {
        for (const id of ["vocal", "harm", "high", "hook", "arp", "kick"])
          expect(ids.has(id)).toBe(true);
        continue;
      }
      for (const id of ["sing", "harm", "chops", "stut", "kick", "sub"])
        expect(ids.has(id)).toBe(true);
      expect(ids.has("voc")).toBe(sheet.palette === "night");
      // No recorded words: the synth singer leads a generated song.
      expect(
        score.notes.some((n) => n.trackId === "vox" || n.trackId === "dbl"),
      ).toBe(false);
      expect(
        score.notes.filter((n) => n.trackId === "sing").length,
      ).toBeGreaterThan(50);
    }
  });

  test("a sheet moved to another key stays in that key", () => {
    const { sheet } = extractSheet(DEMO_SOURCES[0]!);
    const moved = { ...sheet, key: "D minor" };
    const checked = validateSheet(roundTrip(moved));
    if (!checked.ok) throw new Error(checked.errors.join("\n"));
    const score = compileSheet(checked.sheet);
    const scale = new Set([2, 4, 5, 7, 9, 10, 0]);
    for (const note of score.notes)
      if (["sing", "harm", "pad", "stabs", "sub"].includes(note.trackId))
        expect(scale.has(note.pitch % 12)).toBe(true);
    // The voice bank's fixed syllables are retuned, never past the sampler's reach.
    for (const note of score.notes.filter((n) => n.trackId === "stut"))
      expect(Math.abs(note.cents ?? 0)).toBeLessThanOrEqual(1200);
  });

  test("a candy sheet missing parts of the form still compiles", () => {
    const base = candySheet().sheet;
    const variants: SongSheet[] = [
      { ...base, hooks: {} },
      {
        ...base,
        sections: base.sections.filter(
          (s) => s.kind !== "bridge" && s.kind !== "break",
        ),
      },
      {
        ...base,
        sections: base.sections.filter(
          (s, i) => s.kind !== "chorus" || i === 3,
        ),
      },
      {
        ...base,
        key: "D minor",
        progressions: {
          ...base.progressions,
          verse: ["i", "VI", "III", "VII"],
          chorus: ["i", "VI", "III", "VII"],
          bridge: ["i", "v6", "VI", "III"],
        },
      },
    ];
    for (const variant of variants) {
      const checked = validateSheet(roundTrip(variant));
      if (!checked.ok) throw new Error(checked.errors.join("\n"));
      const score = compileSheet(checked.sheet);
      expect(score.notes.length).toBeGreaterThan(1000);
    }
  });

  test("validation answers with fixes, and repairs what it can", () => {
    expect(validateSheet(null).ok).toBe(false);
    const bad = validateSheet({
      bpm: 300,
      key: "Q",
      palette: "x",
      progressions: {},
      lines: {},
      sections: [],
    });
    if (bad.ok) throw new Error("expected errors");
    expect(bad.errors.some((e) => e.startsWith("bpm:"))).toBe(true);
    expect(bad.errors.some((e) => e.startsWith("key:"))).toBe(true);
    const { sheet } = extractSheet(DEMO_SOURCES[0]!);
    const raw = roundTrip(sheet) as Record<string, any>;
    raw.progressions.verse = ["i", "ii"];
    const dim = validateSheet(raw);
    expect(dim.ok).toBe(false);
    if (!dim.ok) expect(dim.errors.join(" ")).toContain("diminished");
    const repaired = roundTrip(sheet) as Record<string, any>;
    repaired.sections[3].lines = [
      "ch1",
      "ch2",
      null,
      null,
      "nope",
      null,
      null,
      null,
    ];
    repaired.sections[3].riff = "missing";
    repaired.sections[8].lead = ["hook", "ghost"];
    repaired.lines.v1 = [...repaired.lines.v1, [9, 5, 1, "late"], "junk"];
    const fixed = validateSheet(repaired);
    if (!fixed.ok) throw new Error(fixed.errors.join("\n"));
    expect(fixed.warnings.length).toBeGreaterThanOrEqual(4);
    expect(fixed.sheet.sections[3]!.lines).toEqual([
      "ch1",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(fixed.sheet.sections[8]!.lead).toEqual(["hook"]);
    expect(() => compileSheet(fixed.sheet)).not.toThrow();
    // A layer played with no pattern takes the usual one for its section.
    const bare = roundTrip(sheet) as Record<string, any>;
    bare.sections[1].play = [...bare.sections[1].play, "arp"];
    delete bare.sections[1].arp;
    const filled = validateSheet(bare);
    if (!filled.ok) throw new Error(filled.errors.join("\n"));
    expect(filled.sheet.sections[1]!.arp).toBe("skip");
  });

  test("the critic flags what the owner disliked", () => {
    const { sheet } = extractSheet(DEMO_SOURCES[0]!);
    const noDrops = {
      ...sheet,
      sections: sheet.sections.filter((s) => s.kind !== "post"),
    };
    const review = critique(noDrops);
    expect(review.score).toBeLessThan(90);
    expect(review.notes[0]).toContain("drops");
    const flat = {
      ...sheet,
      lines: Object.fromEntries(
        Object.entries(sheet.lines).map(([part, line]) => [
          part,
          line!.map(([b, , l, syl]) => [b, 2, l, syl] as const),
        ]),
      ),
    } as SongSheet;
    expect(critique(flat).notes.join(" ")).toContain("clash a semitone");
  });

  test("the schema and prompt cover the sheet", () => {
    const schema = sheetSchema() as { required: string[] };
    expect(schema.required).toContain("sections");
    expect(JSON.stringify(schema)).not.toContain('"items":false');
    const chat = messages("a song about rain");
    expect(chat[0]!.role).toBe("system");
    expect(chat.at(-1)!.content).toContain("a song about rain");
    expect(chat.filter((m) => m.role === "assistant")).toHaveLength(
      DEMO_SOURCES.length,
    );
    const retry = messages("x", { sheet: "{}", notes: ["fix the drop"] });
    expect(retry.at(-1)!.content).toContain("fix the drop");
  });

  test("generate retries with notes and keeps the best sheet", async () => {
    const good = JSON.stringify(extractSheet(DEMO_SOURCES[1]!).sheet);
    const seen: string[] = [];
    const replies = ["not json", "```json\n" + good + "\n```"];
    const song = await generateSong(
      "a glassy one",
      async (chat) => {
        seen.push(chat.at(-1)!.content);
        return replies.shift()!;
      },
      { rounds: 3 },
    );
    expect(song.rounds).toHaveLength(2);
    expect(song.rounds[0]!.ok).toBe(false);
    expect(seen[1]).toContain("not a JSON sheet");
    expect(song.sheet.title).toBe("Glass Garden");
    expect(song.score.bars).toBeGreaterThan(60);
    expect(parseReply('x {"a":1} y')).toEqual({ a: 1 });
    await expect(
      generateSong("x", async () => "nope", { rounds: 2 }),
    ).rejects.toThrow("no valid sheet");
  });
});
