import { describe, expect, test } from "bun:test";
import { createDemo } from "../../../demos/index.ts";
import { scaleOf } from "../genome/theory.ts";
import { judge } from "./critic.ts";
import { checkChart, readChords, readLine, type Chart } from "./format.ts";
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
    // D major has no F major chord: borrowing it would leave the key.
    expect(checkChart(withSection({ chords: "I bIII IV I" })).join()).toMatch(
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
