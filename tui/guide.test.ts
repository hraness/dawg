import { describe, expect, test } from "bun:test";
import type { Guide } from "../guides/index.ts";
import { GuideBrowser, guideLines, paginate, wrapRows } from "./guide.ts";

const UP = "\u001b[A";
const DOWN = "\u001b[B";
const RIGHT = "\u001b[C";
const LEFT = "\u001b[D";
const ESC = "\u001b";
const ENTER = "\r";

const guide = (
  id: string,
  order: number,
  parent?: string,
  body = `## Ask\n- about ${id}`,
): Guide => ({
  id,
  title: id[0]!.toUpperCase() + id.slice(1),
  parent,
  order,
  body,
});

const GUIDES = [
  guide("start", 1),
  guide("music", 2, undefined, "Writing music."),
  guide("notes", 1, "music"),
  guide("chords", 2, "music", "## Ask\n- a sad progression in A minor"),
  guide("keys", 3),
];

const titles = (browser: GuideBrowser) =>
  browser.view(70, 20).rows.map((row) => row.text.trim());

describe("guide browser", () => {
  test("starts collapsed; → expands, → again opens, ← backs out", () => {
    const b = new GuideBrowser(GUIDES);
    expect(titles(b)).toEqual(["Start", "▸ Music", "Keys"]);
    b.key(DOWN);
    expect(b.selected).toBe("music");
    b.key(RIGHT);
    expect(titles(b)).toEqual(["Start", "▾ Music", "Notes", "Chords", "Keys"]);
    b.key(RIGHT);
    expect(b.page).toBe("music");
    expect(b.view(70, 20).title).toBe("guide · Music");
    b.key(LEFT);
    expect(b.page).toBeUndefined();
    b.key(DOWN);
    b.key(DOWN);
    expect(b.selected).toBe("chords");
    b.key(ENTER);
    expect(b.view(70, 20).title).toBe("guide · Music › Chords");
    b.key(ESC);
    // ← on a child goes to its parent, then collapses it.
    b.key(LEFT);
    expect(b.selected).toBe("music");
    b.key(LEFT);
    expect(titles(b)).toEqual(["Start", "▸ Music", "Keys"]);
    expect(b.key(ESC)).toBe("close");
  });

  test("j k move and clamp at the ends", () => {
    const b = new GuideBrowser(GUIDES);
    b.key(UP);
    expect(b.selected).toBe("start");
    b.key("j");
    b.key("j");
    b.key("j");
    expect(b.selected).toBe("keys");
    b.key("k");
    expect(b.selected).toBe("music");
  });

  test("/ filters by title and text, keeps parents, Esc clears first", () => {
    const b = new GuideBrowser(GUIDES);
    b.key("/");
    expect(b.typing).toBe(true);
    for (const c of "minor") b.key(c);
    const view = b.view(70, 20);
    expect(view.rows[0]!.text).toBe("/ minor_");
    expect(view.rows.slice(1).map((r) => r.text.trim())).toEqual([
      "▾ Music",
      "Chords",
    ]);
    b.key(DOWN);
    expect(b.typing).toBe(false);
    expect(b.selected).toBe("chords");
    b.key(ESC);
    expect(b.query).toBe("");
    expect(b.key(ESC)).toBe("close");
  });

  test("open() jumps to a guide by id or title, expanding its parents", () => {
    const b = new GuideBrowser(GUIDES);
    expect(b.open("chords")).toBe(true);
    expect(b.page).toBe("chords");
    expect(b.expanded.has("music")).toBe(true);
    expect(b.open("nothing-here")).toBe(false);
  });

  test("a long page scrolls and clamps", () => {
    const body = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const b = new GuideBrowser([guide("long", 1, undefined, body)], "long");
    expect(b.view(70, 10).rows[0]!.text).toBe("line 0");
    b.key(DOWN);
    expect(b.view(70, 10).rows[0]!.text).toBe("line 1");
    b.key("\u001b[F");
    expect(b.view(70, 10).rows[0]!.text).toBe("line 20");
  });
});

describe("guide text", () => {
  test("headings carry a mark, bullets a dot, code spans a range", () => {
    expect(guideLines("## Ask\n\n- `key A minor` then q")).toEqual([
      { text: "✦ Ask", heading: true, mark: { length: 1, role: "agent" } },
      { text: "• key A minor then q", code: [[2, 13]] },
    ]);
    expect(guideLines("## Mouse")[0]!.text).toBe("── Mouse");
    expect(guideLines("- Tip: try `undo`")[0]).toEqual({
      text: "✓ Tip: try undo",
      mark: { length: 1, role: "success" },
      code: [[11, 15]],
    });
    expect(guideLines("- Careful: loud")[0]!.text).toBe("! Careful: loud");
  });

  test("without Unicode the marks are ASCII and backticks stay", () => {
    const rows = guideLines("## Ask\n## Keys\n## Mouse\n- `undo`", false);
    expect(rows.map((r) => r.text)).toEqual([
      "* Ask",
      "^ Keys",
      "-- Mouse",
      "- `undo`",
    ]);
    expect(rows[3]!.code).toBeUndefined();
  });

  test("long bullets wrap under their text and code ranges follow", () => {
    const rows = wrapRows([{ text: "• one two three four five" }], 14);
    expect(rows.map((r) => r.text)).toEqual([
      "• one two",
      "  three four",
      "  five",
    ]);
    const [a, b] = wrapRows(
      [{ text: "• say hello world now", code: [[6, 17]] }],
      12,
    );
    expect(a).toEqual({ text: "• say hello", code: [[6, 11]] });
    expect(b).toEqual({ text: "  world now", code: [[2, 7]] });
  });

  test("pages pack whole sections and never split one", () => {
    const body = ["intro", "## A", "a1", "a2", "## B", "b1", "## C", "c1"];
    const pages = paginate(guideLines(body.join("\n")), 6);
    expect(pages.map((p) => p.map((r) => r.text))).toEqual([
      ["intro", "", "── A", "a1", "a2"],
      ["── B", "b1", "", "── C", "c1"],
    ]);
  });
});

describe("guide pages", () => {
  const sections = (n: number) =>
    Array.from({ length: n }, (_, i) => `## S${i}\nrow ${i}\nrow ${i}b`).join(
      "\n",
    );
  test("n and p turn pages, then step to the next and previous guide", () => {
    const b = new GuideBrowser(
      [
        guide("one", 1, undefined, sections(4)),
        guide("two", 2, undefined, "x"),
      ],
      "one",
    );
    expect(b.view(70, 7).title).toBe("guide · One · 1/2");
    expect(b.view(70, 7).hint).toContain("n next");
    b.key("n");
    expect(b.view(70, 7).title).toBe("guide · One · 2/2");
    expect(b.view(70, 7).hint).toContain("n next: Two");
    b.key("n");
    expect(b.page).toBe("two");
    expect(b.view(70, 7).title).toBe("guide · Two");
    b.key("p");
    expect(b.page).toBe("one");
    expect(b.view(70, 7).title).toBe("guide · One · 2/2");
    b.key("\u001b[C");
    expect(b.page).toBe("two");
  });
});

test("a page scrolled to its end stays pinned there across a resize", () => {
  const body = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n\n");
  const b = new GuideBrowser([guide("long", 1, undefined, body)], "long");
  b.view(70, 30);
  b.key("\u001b[F", 28); // End
  const last = (rows: readonly { text: string }[]) =>
    rows
      .filter((row) => row.text.trim())
      .at(-1)
      ?.text.trim();
  expect(last(b.view(70, 30).rows)).toBe("line 39");
  // Shorter and taller: the end stays in view, nothing past it.
  expect(last(b.view(70, 8).rows)).toBe("line 39");
  expect(last(b.view(70, 60).rows)).toBe("line 39");
  // Up from the end unpins: the next resize keeps the top line instead.
  b.key(UP, 8);
  const top = b.view(70, 8).scroll;
  expect(b.view(70, 7).scroll).toBe(top);
});
