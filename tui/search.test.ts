import { describe, expect, test } from "bun:test";
import { fuzzyScore } from "./search.ts";

describe("shared fuzzy command search", () => {
  test("ranks exact names, prefixes, word starts, substrings and subsequences", () => {
    const names = [
      "sample volume",
      "volume",
      "volume trim",
      "envelope",
      "overdrive volume",
    ];
    const rank = (query: string) =>
      names
        .map((name, at) => ({ name, at, score: fuzzyScore(query, name) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score || a.at - b.at)
        .map(({ name }) => name);
    expect(rank("volume").slice(0, 2)).toEqual(["volume", "volume trim"]);
    expect(fuzzyScore("filter", "lowpass filter")).toBeGreaterThan(
      fuzzyScore("filter", "prefilter"),
    );
    expect(fuzzyScore("filter", "prefilter")).toBeGreaterThan(
      fuzzyScore("fltr", "filter"),
    );
    expect(fuzzyScore("dphs", "deep house")).toBeGreaterThan(0);
    expect(fuzzyScore("xyz", "deep house")).toBe(0);
  });

  test("requires every query word but accepts reversed words and descriptive tags", () => {
    expect(
      fuzzyScore("minor warm", "Warm keys", "minor chord pad"),
    ).toBeGreaterThan(0);
    expect(
      fuzzyScore("warm minor", "Warm keys", "minor chord pad"),
    ).toBeGreaterThan(0);
    expect(fuzzyScore("warm zebra", "Warm keys", "minor chord pad")).toBe(0);
    expect(fuzzyScore("bass", "Bass")).toBeGreaterThan(
      fuzzyScore("bass", "Pattern", "bass"),
    );
  });

  test("normalizes case, accents and whitespace while keeping empty catalogs stable", () => {
    expect(fuzzyScore("  CAFE  ", "Café")).toBe(fuzzyScore("cafe", "cafe"));
    expect(fuzzyScore("", "anything")).toBe(1);
    expect(fuzzyScore("   ", "")).toBe(1);
    expect(fuzzyScore("notes", "")).toBe(0);
    expect(fuzzyScore("調", "調律")).toBeGreaterThan(0);
  });

  test("a catalog-sized search is deterministic and prefers compact names", () => {
    const query = "fm bell";
    const names = Array.from(
      { length: 1000 },
      (_, i) => `preset ${i} FM bell pad`,
    );
    const first = names.map((name) => fuzzyScore(query, name));
    expect(names.map((name) => fuzzyScore(query, name))).toEqual(first);
    expect(first.every((score) => Number.isFinite(score) && score > 0)).toBe(
      true,
    );
    expect(fuzzyScore(query, "FM bell")).toBeGreaterThan(Math.max(...first));
  });
});
