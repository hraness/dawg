import { describe, expect, test } from "bun:test";
import {
  INSTRUMENT_WORDS,
  LEGACY_WORDS,
  instrumentForWord,
  resolveInstrumentWord,
} from "./instruments.ts";
import { AVAILABLE_INSTRUMENTS } from "../src/audio/wav.ts";

describe("instrument words", () => {
  test("legacy words always resolve to themselves", () => {
    for (const word of LEGACY_WORDS) {
      expect(resolveInstrumentWord(word)).toEqual({ instrument: word });
      expect(instrumentForWord(word)).toBe(word);
    }
  });

  test("no row claims a legacy word, and words are unique", () => {
    const words = INSTRUMENT_WORDS.map((row) => row.word);
    for (const word of words) expect(LEGACY_WORDS).not.toContain(word);
    expect(new Set(words).size).toBe(words.length);
  });

  test("every word dawg already knows keeps its meaning", () => {
    for (const word of AVAILABLE_INSTRUMENTS) {
      const resolved = resolveInstrumentWord(word);
      if (resolved) expect(resolved.instrument).toBe(word);
      expect(instrumentForWord(word)).toBe(word);
    }
  });

  test("unknown words resolve to nothing and pass through unchanged", () => {
    expect(resolveInstrumentWord("not-an-instrument")).toBeUndefined();
    expect(instrumentForWord("not-an-instrument")).toBe("not-an-instrument");
    // Case is not folded: a stored "Piano" stays what it was.
    expect(resolveInstrumentWord("Piano")).toBeUndefined();
  });
});
