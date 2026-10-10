import { expect, test } from "bun:test";

import * as tui from "../../guides/index.ts";
import * as site from "../app/doc-marks";

test("the site's doc marks match the TUI's (guides/index.ts)", () => {
  expect(site.SECTION_MARKS).toEqual(tui.SECTION_MARKS);
  expect(site.RULE_MARK).toEqual(tui.RULE_MARK);
  expect(site.NOTE_MARKS).toEqual(tui.NOTE_MARKS);
  expect(site.CODE_ROLE).toBe(tui.CODE_ROLE);
});
