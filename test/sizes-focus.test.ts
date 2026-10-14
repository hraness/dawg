import { expect, test } from "bun:test";
import { focusShown, type Pty } from "./sizes-lib.ts";
import { VirtualTerminal } from "./vt.ts";

function screen(overlay: string | null, row: string): Pty {
  const vt = new VirtualTerminal(80, 24);
  vt.cursorVisible = false;
  vt.write(`\u001b[2;1H${row}`);
  return { vt, state: () => ({ overlay }) } as Pty;
}

test("size focus sees active picker and guide pointers without a prompt cursor", () => {
  expect(focusShown(screen("picker", "  │    › history entry"))).toBe(true);
  expect(focusShown(screen("picker", "  |    > preset"))).toBe(true);
  expect(focusShown(screen("guide", "  │ ›Getting started"))).toBe(true);
});

test("size focus rejects breadcrumbs, unselected rows and background pointers", () => {
  expect(focusShown(screen("picker", "  ╭─ menu › Sound ─╮"))).toBe(false);
  expect(focusShown(screen("picker", "  │      history entry"))).toBe(false);
  expect(focusShown(screen(null, "  │    › history entry"))).toBe(false);
});
