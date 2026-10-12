import { expect, test } from "bun:test";
import { displayWidth, graphemes, truncate, wrapWords } from "./text.ts";

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

test("word wrapping preserves labels, full tokens, blank rows and graphemes", () => {
  expect(wrapWords("kick  909", 20)).toEqual(["kick  909"]);
  expect(wrapWords("dry drums and warm bass", 10)).toEqual([
    "dry drums",
    "and warm",
    "bass",
  ]);
  expect(wrapWords("", 10)).toEqual([""]);
  const long = "é界é界é界";
  const lines = wrapWords(long, 4);
  expect(lines.join("")).toBe(long);
  for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(4);
});
