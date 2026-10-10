import { describe, expect, test } from "bun:test";
import { MENU_MARK, SECTION_MARKS } from "../guides/marks.ts";
import { crumbSegments, crumbText } from "./crumbs.ts";
import { displayWidth } from "./text.ts";

const text = (
  steps: string[],
  width: number,
  unicode = true,
  extra: { prefix?: string; suffix?: string } = {},
) =>
  crumbSegments({ steps, ...extra }, width, unicode)
    .map((segment) => segment.text)
    .join("");

describe("Ctrl-K breadcrumb", () => {
  test("starts with the guides' Menu mark, then each step", () => {
    expect(MENU_MARK).toBe(SECTION_MARKS.Menu!);
    expect(crumbText({ steps: ["Arrange", "range"] })).toBe(
      "≡ Arrange › range",
    );
    expect(crumbText({ steps: [] })).toBe("≡ menu");
    expect(crumbText({ steps: ["Mix"], prefix: "● ", suffix: " · /gl" })).toBe(
      "● ≡ Mix · /gl",
    );
  });

  test("ASCII under TERM=dumb: = and >", () => {
    expect(crumbText({ steps: ["Arrange", "range"] }, false)).toBe(
      "= Arrange > range",
    );
  });

  test("the mark is its own segment in the loopRule role, never a knob", () => {
    const segments = crumbSegments({ steps: ["Mix", "master"] }, 80);
    expect(segments[0]).toEqual({ text: "≡", kind: "mark", role: "loopRule" });
    expect(segments.at(-1)).toEqual({ text: "master", kind: "here" });
    expect(
      segments.filter((s) => s.kind === "step").map((s) => s.text),
    ).toEqual([" ", "Mix › "]);
  });

  test("folds the middle, then the first step, then truncates the current", () => {
    const steps = ["Effects", "more effects", "duck"];
    expect(text(steps, 80)).toBe("≡ Effects › more effects › duck");
    expect(text(steps, 24)).toBe("≡ Effects › … › duck");
    expect(text(steps, 14)).toBe("≡ … › duck");
    expect(text(["Effects", "a long step name"], 14)).toBe("≡ … › a long…");
    expect(text(steps, 24, false)).toBe("= Effects > ... > duck");
  });

  test("keeps the suffix while the current step has room", () => {
    const steps = ["Mix", "master", "glue"];
    const suffix = " · ♪ solo · B staged 2 · 42 ms";
    const shown = text(steps, 50, true, { suffix, prefix: "● " });
    expect(shown).toBe("● ≡ Mix › … › glue · ♪ solo · B staged 2 · 42 ms");
    expect(displayWidth(shown)).toBeLessThanOrEqual(50);
    // Too narrow for both: the current step keeps a few columns, the
    // suffix truncates.
    const tight = text(steps, 20, true, { suffix });
    expect(tight.startsWith("≡ … › glue")).toBe(true);
    expect(tight.endsWith("…")).toBe(true);
    expect(displayWidth(tight)).toBeLessThanOrEqual(20);
  });

  test("never wider than the room, at every width from the 60-column box", () => {
    const cases = [
      ["Effects", "more effects", "duck"],
      ["Arrange", "sections", "chorus"],
      ["Project", "tempo and meter", "keys time"],
      ["Voice", "clips", "a very long clip name indeed"],
    ];
    for (const steps of cases)
      for (let width = 8; width <= 52; width += 1)
        for (const unicode of [true, false]) {
          const shown = text(steps, width, unicode, { suffix: " · /fil" });
          expect(displayWidth(shown)).toBeLessThanOrEqual(width);
          expect(shown.startsWith(unicode ? "≡ " : "= ")).toBe(true);
        }
  });
});
