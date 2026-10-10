import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { guideScreens, splitIntro } from "../app/docs/guide-screens";
import { listGuides } from "../app/docs/guides";
import { screensDirectory } from "../app/screens/screen";

describe("guideScreens", () => {
  const ids = new Set(listGuides().map((guide) => guide.id));

  test("names only guides that exist", () => {
    expect(Object.keys(guideScreens).filter((id) => !ids.has(id))).toEqual([]);
  });

  test("names only committed screens", () => {
    const missing = Object.values(guideScreens)
      .flat()
      .filter((id) => !existsSync(join(screensDirectory, `${id}.json`)));
    expect(missing).toEqual([]);
  });
});

describe("splitIntro", () => {
  test("splits before the first heading", () => {
    expect(splitIntro("Lead.\n\n## Ask\n\n- x")).toEqual({
      intro: "Lead.\n",
      rest: "## Ask\n\n- x",
    });
  });

  test("keeps a body with no heading whole", () => {
    expect(splitIntro("Only text.")).toEqual({ intro: "Only text.", rest: "" });
  });
});
