import { describe, expect, test } from "bun:test";
import { USAGE } from "../src/commands/help.ts";
import {
  ALL_HINTS,
  emptyHint,
  pick,
  placeholderHint,
  seedHash,
  SUGGESTED_STYLES,
} from "./hints.ts";
import { STYLE_IDS } from "../core/styles/index.ts";

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
    expect(emptyHint(state, "lead", 80)).toBe(
      "lead · empty · space play · ctrl-p play mode · ctrl-k menu",
    );
    const narrow = emptyHint(state, "lead", 30);
    expect(narrow).toBe("lead · empty · space play");
    expect(emptyHint(state, "lead", 5)).toBe("lead ");
  });

  test("drum, vocal and wide empty lines lead with a way in", () => {
    const state = { seed: "x", agent: true, filled: false };
    expect(emptyHint({ ...state, drums: true }, "kit", 80)).toBe(
      "kit · empty · hit kick at 0 · space play · ctrl-p play mode · ctrl-k menu",
    );
    expect(emptyHint({ ...state, vocal: true }, "vox", 120)).toBe(
      'vox · empty · lyrics "la la" · sing ooh · ctrl-k › Voice · space play · ctrl-p play mode · ctrl-k menu',
    );
    // A vocal lead that does not fit drops before the keys do.
    expect(emptyHint({ ...state, vocal: true }, "vox", 80)).toBe(
      "vox · empty · space play · ctrl-p play mode · ctrl-k menu",
    );
    const wide = emptyHint(state, "lead", 100);
    expect(wide).toMatch(/^lead · empty · try style [a-z-]+ · space play/);
    expect(wide).toBe(emptyHint(state, "lead", 100));
    expect(emptyHint(state, "lead", 99)).not.toContain("try style");
  });

  test("while playing the line says how to stop", () => {
    const state = { seed: "x", filled: false, playing: true };
    expect(emptyHint({ ...state, agent: true }, "lead", 80)).toBe(
      "lead · empty · space stop · type a request",
    );
    expect(emptyHint({ ...state, agent: false }, "lead", 120)).toBe(
      "lead · empty · space stop · ctrl-p play mode",
    );
  });

  test("the empty line and the placeholder never suggest different styles", () => {
    for (let index = 0; index < 200; index += 1) {
      const state = { seed: `s${index}`, agent: false, filled: false };
      const line = emptyHint(state, "keys", 120);
      const prompt = placeholderHint(state);
      const styles = [line, prompt]
        .map((text) => text.match(/\bstyle (?!search)([a-z-]+)/)?.[1])
        .filter(Boolean);
      expect(new Set(styles).size).toBeLessThanOrEqual(1);
      expect(prompt).not.toContain("space plays");
    }
  });

  test("suggested styles have cards", () => {
    for (const id of SUGGESTED_STYLES)
      expect([id, STYLE_IDS.includes(id)]).toEqual([id, true]);
  });

  test("every suggested command is a known verb", () => {
    const known = new Set(Object.keys(USAGE));
    for (const hint of ALL_HINTS) {
      const clauses = hint.replace(/^try:? /, "").split(" · ");
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
