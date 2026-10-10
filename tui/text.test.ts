import { expect, test } from "bun:test";
import { displayWidth, graphemes, truncate } from "./text.ts";

test("ASCII takes the fast path with the same answers", () => {
  expect(displayWidth("help · all")).toBe(10);
  expect(displayWidth("instrument <name>")).toBe(17);
  expect(truncate("instrument <name>", 8)).toBe("instrum…");
  expect(truncate("short", 8)).toBe("short");
  expect(truncate("abc", 1)).toBe("…");
  expect(truncate("abc", 0)).toBe("");
  expect(graphemes("ab").map((g) => [g.text, g.start, g.width])).toEqual([
    ["a", 0, 1],
    ["b", 1, 1],
  ]);
});

test("wide, combining and control text still segments by grapheme", () => {
  expect(displayWidth("a界b")).toBe(4);
  expect(truncate("界界界", 4)).toBe("界…");
  expect(graphemes("éx").map((g) => [g.text, g.length])).toEqual([
    ["é", 2],
    ["x", 1],
  ]);
  expect(displayWidth("a\tb")).toBe(3);
  expect(displayWidth("a\u0007b")).toBe(2);
});

test("a repeated string returns the cached segmentation", () => {
  const line = "── sound · instrument <name> · 界";
  expect(graphemes(line)).toBe(graphemes(line));
  // The cache bounds itself rather than growing per distinct string.
  for (let index = 0; index < 5000; index += 1) graphemes(`row ${index} 界`);
  expect(graphemes(line).length).toBe(Array.from(line).length);
});
