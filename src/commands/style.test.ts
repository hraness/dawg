import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import { encodeLoop } from "../../core/loop.ts";
import { LEAF_IDS, STYLE_IDS } from "../../core/styles/index.ts";
import { applyStyleCommand, parseStyleCommand } from "./style.ts";

const run = (text: string, score = createScore()) => {
  const command = parseStyleCommand(text);
  if (!command) throw new Error(`did not parse: ${text}`);
  return applyStyleCommand(score, command);
};

describe("style command parsing", () => {
  test("verbs", () => {
    expect(parseStyleCommand("tempo 90")).toBeUndefined();
    expect(parseStyleCommand("/style")).toEqual({ type: "style-families" });
    expect(parseStyleCommand("style list jazz")).toEqual({
      type: "style-list",
      id: "jazz",
    });
    expect(parseStyleCommand("style search maqam")).toEqual({
      type: "style-search",
      query: "maqam",
    });
    expect(parseStyleCommand("style info bebop")).toEqual({
      type: "style-info",
      id: "bebop",
    });
    expect(parseStyleCommand("style again")).toEqual({ type: "style-again" });
  });

  test("bars and seed come from the tail; names may have spaces", () => {
    expect(parseStyleCommand("style bebop 16 3")).toEqual({
      type: "style-apply",
      id: "bebop",
      bars: 16,
      seed: 3,
    });
    expect(parseStyleCommand("style deep house 4")).toEqual({
      type: "style-apply",
      id: "deep house",
      bars: 4,
    });
  });

  test("blend weights, defaults and errors", () => {
    expect(parseStyleCommand("style blend bebop deep-house")).toEqual({
      type: "style-apply",
      id: "bebop",
      blend: { id: "deep-house", weight: 0.5 },
    });
    expect(parseStyleCommand("style blend bebop deep-house 0.25 8 2")).toEqual({
      type: "style-apply",
      id: "bebop",
      blend: { id: "deep-house", weight: 0.25 },
      bars: 8,
      seed: 2,
    });
    expect(parseStyleCommand("style blend bebop deep-house 30%")).toMatchObject(
      { blend: { weight: 0.3 } },
    );
    expect(parseStyleCommand("style blend bebop")?.type).toBe("style-bad");
    expect(parseStyleCommand("style search")?.type).toBe("style-bad");
  });
});

describe("style command results", () => {
  test("browsing reads and never writes", () => {
    for (const text of [
      "style",
      "style list",
      "style list electronic",
      "style list jazz",
      "style search maqam",
      `style info ${STYLE_IDS[0]}`,
      `style info ${LEAF_IDS[0]}`,
    ]) {
      const result = run(text);
      expect(result.ok).toBe(true);
      expect(result.next).toBeUndefined();
      expect(result.message.length).toBeGreaterThan(0);
    }
    expect(run("style info no-such-style-at-all").ok).toBe(false);
    expect(run("style list zzzz").ok).toBe(false);
  });

  test("applying replaces the song, records provenance and is deterministic", () => {
    const a = run("style deep-house 4 7");
    expect(a.ok).toBe(true);
    expect(a.kind).toBe("style.apply");
    expect(a.next!.style).toEqual({ id: "deep-house", seed: 7, bars: 4 });
    expect(a.next!.bars).toBeGreaterThanOrEqual(4);
    expect(a.next!.tracks.length).toBeGreaterThan(0);
    const b = run("style deep-house 4 7");
    expect(encodeLoop(b.next!)).toBe(encodeLoop(a.next!));
    const c = run("style deep-house 4 8");
    expect(encodeLoop(c.next!)).not.toBe(encodeLoop(a.next!));
  });

  test("again takes the next seed of the song's style", () => {
    expect(run("style again").ok).toBe(false);
    const first = run("style bebop 4 1").next!;
    const again = run("style again", first);
    expect(again.next!.style).toEqual({ id: "bebop", seed: 2, bars: 4 });
  });

  test("blend records both styles", () => {
    const result = run("style blend bebop deep-house 0.3 4 5");
    expect(result.ok).toBe(true);
    expect(result.next!.style).toEqual({
      id: "bebop",
      seed: 5,
      bars: 4,
      blend: { id: "deep-house", weight: 0.3 },
    });
  });

  test("bad ids, bars and seeds fail with a message", () => {
    expect(run("style no-such-style").ok).toBe(false);
    expect(run("style bebop 999").ok).toBe(false);
    expect(run("style bebop 4 99999999999").ok).toBe(false);
    expect(run("style blend bebop nope").ok).toBe(false);
  });
});
