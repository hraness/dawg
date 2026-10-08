import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  guideSummary,
  listGuides,
  orderTree,
  parseGuide,
} from "../app/docs/guides";

const fixtures = join(import.meta.dir, "fixtures", "guides");

describe("listGuides", () => {
  test("reads the tree depth first, siblings by order", () => {
    expect(
      listGuides(fixtures).map((guide) => [guide.id, guide.parent]),
    ).toEqual([
      ["getting-started", null],
      ["basics", null],
      ["keys", "basics"],
      ["sessions", "basics"],
    ]);
  });

  test("takes the title from the first heading and drops it from the body", () => {
    const sessions = listGuides(fixtures).find((g) => g.id === "sessions")!;
    expect(sessions.title).toBe("Sessions");
    expect(sessions.body).toBe("Many windows, one song.");
  });

  test("is empty when there is no guides directory", () => {
    expect(listGuides(join(fixtures, "missing"))).toEqual([]);
  });
});

describe("parseGuide", () => {
  test("falls back to the file name for the id", () => {
    expect(parseGuide("# Mixing\n\nLevels.", "mixing").id).toBe("mixing");
  });

  test("rejects a guide without a title", () => {
    expect(() => parseGuide("Just text.", "untitled")).toThrow("no title");
  });

  test("rejects an id that is not a slug", () => {
    expect(() => parseGuide("---\nid: Bad Id\n---\n# X", "x")).toThrow(
      "not a slug",
    );
  });
});

describe("orderTree", () => {
  test("rejects a missing parent chain", () => {
    expect(() =>
      orderTree([
        { id: "a", parent: "b", order: 0, title: "A" },
        { id: "b", parent: "a", order: 0, title: "B" },
      ]),
    ).toThrow("unreachable");
  });
});

test("guideSummary skips headings and tables and strips markup", () => {
  expect(
    guideSummary("## Intro\n\n| a |\n\nType `play` to [start](x.md)."),
  ).toBe("Type play to start.");
});
