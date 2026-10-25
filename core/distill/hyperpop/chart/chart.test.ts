import { describe, expect, test } from "bun:test";
import { createDemo } from "../../../demos/index.ts";
import { scaleOf } from "../genome/theory.ts";
import { judge } from "./critic.ts";
import {
  chartChord,
  checkChart,
  readChords,
  readLine,
  repairLine,
  type Chart,
} from "./format.ts";
import { GOLD } from "./gold/index.ts";
import { performChart, voiceLead } from "./perform.ts";

const D = scaleOf(2, "major");
const first = GOLD[0]!;
const withSection = (patch: Partial<Chart["sections"][number]>): Chart => ({
  ...first,
  sections: [{ ...first.sections[0]!, ...patch }, ...first.sections.slice(1)],
});

describe("chart lines", () => {
  test("a line keeps its written lengths (the performer adds the legato)", () => {
    const notes = readLine(D, { bar: 0, rhythm: "x.x...x---", notes: "1 2 3" });
    expect(notes.map((n) => [n.beat, n.length])).toEqual([
      [0, 0.25],
      [0.5, 0.25],
      [1.5, 1],
    ]);
  });

  test("degrees count from the tonic and ticks move octaves", () => {
    const [a, b, c] = readLine(D, {
      bar: 0,
      rhythm: "x.x.x.",
      notes: "1 5 1'",
    });
    expect([a!.pitch, b!.pitch, c!.pitch]).toEqual([62, 69, 74]);
  });

  test("a rhythm and its degrees must agree", () => {
    expect(() => readLine(D, { bar: 0, rhythm: "x.x.", notes: "1" })).toThrow(
      /2 rhythm notes, 1 degrees/,
    );
  });
});

describe("checkChart", () => {
  test("the gold charts are clean", () => {
    for (const chart of GOLD) expect(checkChart(chart)).toEqual([]);
  });

  test("a section runs at most eight bars", () => {
    expect(checkChart(withSection({ bars: 16 })).join()).toMatch(/16 bars/);
  });

  test("a chord from outside the key cannot be written", () => {
    // Only a handful of color chords borrow; an Eb major chord in D would
    // sound like a new key.
    expect(checkChart(withSection({ chords: "I bII IV I" })).join()).toMatch(
      /not a chord of/,
    );
  });

  test("a chart has one key and nothing in it names another", () => {
    const fields = new Set(
      GOLD.flatMap((c) => c.sections.flatMap(Object.keys)),
    );
    for (const field of fields)
      expect(field).not.toMatch(/key|modul|transpose/i);
  });
});

describe("borrowed chords", () => {
  const triad = (text: string, scale = D) => chartChord(scale, text)?.triad;
  test("a major mode borrows color chords by case or flat", () => {
    expect(triad("iv")).toEqual([7, 10, 2]); // G minor in D major
    expect(triad("bVI")).toEqual([10, 2, 5]);
    expect(triad("bVII")).toEqual([0, 4, 7]);
    expect(triad("II")).toEqual([4, 8, 11]); // V of V
    expect(chartChord(D, "bVIIadd9")?.color).toEqual([2]);
    expect(chartChord(D, "iv")?.degree).toBe(-1);
  });
  test("the mode's own chords read as before", () => {
    expect(triad("IV")).toEqual([7, 11, 2]);
    expect(triad("vi")).toEqual([11, 2, 6]);
    const mixo = scaleOf(8, "mixolydian");
    expect(chartChord(mixo, "VII")?.degree).toBe(6);
  });
  test("nothing reads as a new tonic or a minor-mode borrowing", () => {
    expect(chartChord(D, "i")).toBeUndefined();
    expect(chartChord(D, "bII")).toBeUndefined();
    expect(chartChord(scaleOf(7, "dorian"), "iv")).toBeUndefined();
    expect(checkChart(withSection({ chords: "I i IV V" }))[0]).toMatch(
      /not a chord/,
    );
    expect(checkChart(withSection({ chords: "I iv bVI bVII" }))).toEqual([]);
  });
});

describe("voiceLead", () => {
  test("four voices under the ceiling that hold the root and the third", () => {
    const [I, IV] = readChords(D, {
      ...first.sections[0]!,
      bars: 1,
      chords: "I-IV",
    });
    const a = voiceLead(I!, 50, 72);
    const b = voiceLead(IV!, 50, 72, a);
    for (const v of [a, b]) {
      expect(v).toHaveLength(4);
      expect(Math.max(...v)).toBeLessThanOrEqual(72);
    }
    expect(a.map((p) => p % 12)).toContain(2);
    expect(a.map((p) => p % 12)).toContain(6);
    // I to IV keeps the shared tonic and moves the rest by steps.
    const moved = a.reduce((n, p, k) => n + Math.abs(b[k]! - p), 0);
    expect(moved).toBeLessThanOrEqual(6);
  });
});

describe("the gold songs", () => {
  test("each clears every critic gate the demos set", () => {
    for (const chart of GOLD) {
      const { score } = performChart(chart);
      const { problems } = judge(score.toJSON());
      expect({ title: chart.title, problems }).toEqual({
        title: chart.title,
        problems: [],
      });
    }
  });

  test("each stays under the score's note cap", () => {
    for (const chart of GOLD)
      expect(
        performChart(chart).score.toJSON().notes?.length,
      ).toBeLessThanOrEqual(4000);
  });

  test("performing is deterministic", () => {
    const a = JSON.stringify(performChart(first).score.toJSON());
    expect(JSON.stringify(performChart(first).score.toJSON())).toBe(a);
  });

  test("the critic passes Candy Fault", () => {
    expect(judge(createDemo("candy-fault").toJSON()).problems).toEqual([]);
  });
});

describe("repairLine", () => {
  test("small count mismatches are fixed in code", () => {
    const pad = repairLine({
      bar: 0,
      rhythm: "x.x.x.x.",
      notes: "1 2 3 4",
      words: "glit- ter thumbs",
    });
    expect(pad.words).toBe("glit- ter thumbs _");
    const split = repairLine({
      bar: 0,
      rhythm: "x.x---",
      notes: "1 3",
      words: "ty- ping dots",
    });
    expect(split.rhythm).toBe("x.x-x-");
    expect(split.notes).toBe("1 3 3");
    expect(readLine(D, split)).toHaveLength(3);
    const degrees = repairLine({ bar: 0, rhythm: "x.x.x.", notes: "1 2" });
    expect(degrees.notes).toBe("1 2 2");
  });
  test("a large mismatch is left for the writer", () => {
    const line = { bar: 0, rhythm: "xxxxxxxx", notes: "1 2", words: "a b" };
    expect(repairLine(line)).toEqual(line);
  });
});

describe("vocal books", () => {
  const chart = GOLD[0]!;
  const bare = performChart(chart);
  // A shipped book with none of this chart's lines: it can only chop.
  const book = { sample: "redline-vox", root: 69, syllables: ["go", "hey"] };
  const tracks = (p: ReturnType<typeof performChart>) =>
    (p.score.toJSON().tracks ?? []).map((t) => t.id);
  const count = (p: ReturnType<typeof performChart>, id: string) =>
    (p.score.toJSON().notes ?? []).filter((n) => n.trackId === id).length;

  test("each sung line is named by its notes and lasts whole bars", () => {
    expect(bare.phrases.length).toBeGreaterThan(0);
    for (const p of bare.phrases) {
      expect(p.key).toMatch(/^l_[0-9a-f]{8}$/);
      expect(p.beats % 4).toBe(0);
      expect(p.notes.length).toBeGreaterThan(0);
    }
  });

  test("a book chops its words and sings only the lines it holds", () => {
    const sung = performChart(chart, book);
    expect(count(sung, "bchops")).toBeGreaterThan(0);
    expect(count(sung, "bvox")).toBe(0);
    expect(sung.score.toJSON().notes?.length).toBeLessThanOrEqual(4000);
  });

  test("without a book nothing is sung from one", () => {
    for (const id of ["bvox", "bdbl", "bchops", "vlead", "vgrain"])
      expect(tracks(bare)).not.toContain(id);
  });
});
