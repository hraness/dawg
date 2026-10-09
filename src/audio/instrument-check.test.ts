import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import { parsePrompt } from "../agent/ops.ts";
import {
  isUnknownInstrument,
  plainSineAdvice,
  plainSineWarnings,
  playsPlainSine,
} from "./instrument-check.ts";

describe("instrument words that play the plain sine", () => {
  test("unknown words and plain-sine legacy words are named", () => {
    for (const word of ["theremin", "xyzzy"])
      expect(plainSineAdvice(word)).toContain("not a dawg instrument");
    // 0.6.1: violin is a resolver word now; stored raw it says how to fix it.
    expect(plainSineAdvice("violin")).toContain("type instrument violin again");
    expect(plainSineAdvice("recorder")).toContain(
      "type instrument recorder again",
    );
    expect(plainSineAdvice("cello")).toContain("bowed cello");
    for (const word of ["cello", "organ", "strings", "lead"])
      expect(plainSineAdvice(word)).toContain("plain sine (kept for old");
    expect(plainSineAdvice("organ")).toContain("synth preset organ");
    expect(plainSineAdvice("pianp")).toContain("did you mean piano?");
  });

  test("voices with a tone of their own are not flagged", () => {
    for (const word of [
      "sine",
      "piano",
      "pluck",
      "bass",
      "ebass",
      "contrabass",
      "saw",
      "supersaw",
      "z_tan",
      "kit",
      "sampler",
      "wavetable",
      "string",
      "grand",
      "epiano",
      "wurli",
      "clav",
      "modal",
      "granular",
    ])
      expect(playsPlainSine(word)).toBe(false);
    // marimba and wind keep their own resonator note.
    expect(plainSineAdvice("marimba")).toBeUndefined();
    expect(plainSineAdvice("wind")).toBeUndefined();
  });

  test("dawg check warns per track; resolver words are known", () => {
    const score = createScore({
      tracks: [
        { id: "v", name: "v", instrument: "kazoo" },
        { id: "p", name: "p", instrument: "piano" },
      ],
    });
    const warnings = plainSineWarnings(score.tracks);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toStartWith('track v: instrument "kazoo"');
    expect(isUnknownInstrument("nylon")).toBe(false);
    expect(isUnknownInstrument("cello")).toBe(false);
    // 0.6.1: violin resolves to the bowed string preset; kazoo is unknown.
    expect(isUnknownInstrument("violin")).toBe(false);
    expect(isUnknownInstrument("kazoo")).toBe(true);
    // The prompt still parses the word; main.ts refuses the unknown one.
    expect(parsePrompt("instrument kazoo")).toMatchObject({
      patch: { instrument: "kazoo" },
    });
  });
});
