import { describe, expect, test } from "bun:test";
import { USAGE } from "../src/commands/help.ts";
import {
  ALL_HINTS,
  emptyHint,
  pick,
  placeholderHint,
  seedHash,
} from "./hints.ts";

describe("seeded hints", () => {
  test("a fixed seed gives fixed text", () => {
    expect(seedHash("7F3A")).toBe(seedHash("7F3A"));
    const state = { seed: "7F3A", agent: true, filled: false };
    expect(placeholderHint(state)).toBe(placeholderHint({ ...state }));
    expect(emptyHint(state, "lead", 80)).toBe(emptyHint(state, "lead", 80));
    expect(pick(["a", "b", "c"], "seed-1")).toBe(
      pick(["a", "b", "c"], "seed-1"),
    );
  });

  test("different sessions read different hints", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 40; index += 1)
      seen.add(
        placeholderHint({ seed: `s${index}`, agent: true, filled: true }),
      );
    expect(seen.size).toBeGreaterThan(2);
  });

  test("commands-only sessions never invite prose", () => {
    for (let index = 0; index < 40; index += 1) {
      const seed = `s${index}`;
      for (const filled of [false, true])
        for (const drums of [false, true]) {
          const state = { seed, agent: false, filled, drums };
          expect(placeholderHint(state)).toStartWith("try: ");
          const empty = emptyHint(state, "lead", 80);
          expect(empty).not.toContain("type a");
          expect(empty).not.toContain("ask");
        }
    }
  });

  test("agent sessions invite a request; queue mode says so", () => {
    expect(
      placeholderHint({ seed: "x", agent: true, filled: false }),
    ).toStartWith("describe a song");
    expect(
      placeholderHint({ seed: "x", agent: true, filled: true }),
    ).toStartWith("describe a change");
    expect(
      placeholderHint({ seed: "x", agent: true, filled: true, queue: true }),
    ).toContain("queue");
  });

  test("the empty line shortens to fit", () => {
    const state = { seed: "x", agent: true, filled: false };
    expect(emptyHint(state, "lead", 80).length).toBeLessThanOrEqual(80);
    const narrow = emptyHint(state, "lead", 30);
    expect(narrow.length).toBeLessThanOrEqual(30);
    expect(narrow).toStartWith("lead · empty");
    expect(emptyHint(state, "lead", 5)).toBe("lead ");
  });

  test("every suggested command is a known verb", () => {
    const known = new Set(Object.keys(USAGE));
    for (const hint of ALL_HINTS) {
      const clauses = hint.replace(/^try: /, "").split(" · ");
      for (const clause of clauses) {
        if (/^(ctrl|space|then|ask|say|type|describe|queue)\b/.test(clause))
          continue;
        const verb = clause.replace(/^\//, "").split(" ")[0]!;
        expect({ hint, verb, known: known.has(verb) }).toEqual({
          hint,
          verb,
          known: true,
        });
      }
    }
  });
});
