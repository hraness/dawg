import { describe, expect, test } from "bun:test";
import { assignLyrics, autoSyllabify } from "./lyrics.ts";

describe("autoSyllabify", () => {
  test.each([
    ["something", "some thing"],
    ["forever", "for ev er"],
    ["little", "lit tle"],
    ["table", "ta ble"],
    ["apple", "ap ple"],
    ["singing", "sing ing"],
    ["never", "nev er"],
    ["baby", "ba by"],
    ["tonight", "to night"],
    ["children", "chil dren"],
    ["together", "to geth er"],
    ["mother", "moth er"],
    ["nothing", "noth ing"],
    ["tickle", "tick le"],
    ["lovely", "love ly"],
    ["gonna", "gon na"],
    ["time", "time"],
    ["world", "world"],
  ])("%s -> %s", (word, syllables) => {
    expect(autoSyllabify(word).join(" ")).toBe(syllables);
  });

  test("keeps the word's own case", () => {
    expect(autoSyllabify("Forever")).toEqual(["For", "ev", "er"]);
  });
});

describe("assignLyrics", () => {
  test("a chord takes one token on its top note; the rest hold", () => {
    const { lyrics } = assignLyrics("hold me", [
      { id: "a", startTick: 0, pitch: 60 },
      { id: "b", startTick: 0, pitch: 64 },
      { id: "c", startTick: 480, pitch: 62 },
    ]);
    expect(Object.fromEntries(lyrics)).toEqual({ b: "hold", a: "_", c: "me" });
  });

  test("hyphens override the guess", () => {
    const notes = [0, 1, 2].map((i) => ({
      id: `n${i}`,
      startTick: i * 480,
      pitch: 60,
    }));
    const { lyrics, split } = assignLyrics("so-meth ing", notes);
    expect([...lyrics.values()]).toEqual(["so", "meth", "ing"]);
    expect(split).toEqual([]);
  });
});
