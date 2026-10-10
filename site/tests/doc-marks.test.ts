import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NOTE_MARKS, RULE_MARK, SECTION_MARKS } from "../../guides/marks.ts";

const app = join(import.meta.dir, "..", "app");

test("the site takes the doc marks from the TUI's table, not a copy", () => {
  const markdown = readFileSync(join(app, "markdown.tsx"), "utf8");
  expect(markdown).toContain('from "../../guides/marks.ts"');
  expect(() => readFileSync(join(app, "doc-marks.ts"))).toThrow();
});

test("every chip role but the plain one has a color in globals.css", () => {
  const css = readFileSync(join(app, "globals.css"), "utf8");
  const roles = new Set(
    [
      ...Object.values(SECTION_MARKS),
      ...Object.values(NOTE_MARKS),
      RULE_MARK,
    ].map((mark) => mark.role),
  );
  // borderFocus (→ Next, ── rules) keeps the default ink-on-paper chip.
  roles.delete("borderFocus");
  for (const role of roles) expect(css).toContain(`.dawg-mark--${role}`);
});
