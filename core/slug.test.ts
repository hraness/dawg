import { describe, expect, test } from "bun:test";
import { MAX_TRACK_SLUG_LENGTH, trackSlug } from "./slug.ts";

describe("trackSlug", () => {
  test("lowercases and joins runs of separators with one dash", () => {
    expect(trackSlug("bass")).toBe("bass");
    expect(trackSlug("keys 2")).toBe("keys-2");
    expect(trackSlug("  Lead / Synth!! ")).toBe("lead-synth");
    expect(trackSlug("Épée")).toBe("epee");
  });

  test("never yields an empty or over-long name", () => {
    expect(trackSlug("")).toBe("track");
    expect(trackSlug("///")).toBe("track");
    expect(trackSlug("../../etc")).toBe("etc");
    const long = trackSlug(`${"a".repeat(70)}-b`);
    expect(long.length).toBeLessThanOrEqual(MAX_TRACK_SLUG_LENGTH);
    expect(long.endsWith("-")).toBe(false);
  });
});
