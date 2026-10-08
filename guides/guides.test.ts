/**
 * The guides are user docs in two places (the `/guide` pane and dawg.sh), so
 * each one must parse, fit one pane at 80 columns, and name only commands
 * that exist.
 */
import { describe, expect, test } from "bun:test";
import { HELP_SECTIONS, USAGE } from "../src/commands/help.ts";
import { guideLines, wrapRows } from "../tui/guide.ts";
import { listGuides } from "./index.ts";

/** Rows a guide may take in the pane (80×24 leaves about 20 inside). */
const LINE_BUDGET = 20;
/** The pane's text width at 80 columns: 80 − margins − border − padding. */
const WIDTH = 72;

const guides = listGuides();

/** Every slash word the app accepts, from the help reference and usages. */
const KNOWN = new Set(
  [
    ...HELP_SECTIONS.flatMap((section) =>
      section.entries.map((entry) => entry.command),
    ),
    ...Object.values(USAGE),
  ].flatMap((text) => text.match(/\/[a-z][a-z-]*/g) ?? []),
);

describe("guides", () => {
  test("there are guides, with unique ids and real parents", () => {
    expect(guides.length).toBeGreaterThanOrEqual(15);
    const ids = guides.map((guide) => guide.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const guide of guides)
      if (guide.parent) expect(ids).toContain(guide.parent);
  });

  test("tree order puts each parent before its children", () => {
    const seen = new Set<string>();
    for (const guide of guides) {
      if (guide.parent) expect(seen.has(guide.parent)).toBe(true);
      seen.add(guide.id);
    }
  });

  for (const guide of guides)
    test(`${guide.id} fits one pane at 80 columns`, () => {
      const rows = wrapRows(guideLines(guide.body), WIDTH);
      expect(rows.length).toBeLessThanOrEqual(LINE_BUDGET);
      expect(guide.body).not.toMatch(/^# /m);
    });

  test("every /command a guide names exists", () => {
    const unknown: string[] = [];
    for (const guide of guides)
      for (const span of guide.body.match(/`[^`]+`/g) ?? [])
        for (const word of span.match(/(?<![\w.>/])\/[a-z][a-z-]*/g) ?? [])
          if (!KNOWN.has(word)) unknown.push(`${guide.id}: ${word}`);
    expect(unknown).toEqual([]);
  });

  // Play mode, the menu loop and provider setup are hands-on by nature;
  // every other feature shows what to ask and what to type.
  const HANDS_ON = new Set(["play", "audition", "providers"]);
  test("each feature guide shows both ways in: ask and by hand", () => {
    for (const guide of guides.filter((g) => g.parent)) {
      expect(guide.body).toMatch(/`[^`]+`/);
      if (!HANDS_ON.has(guide.id)) expect(guide.body).toMatch(/^## Ask/m);
    }
  });
});
