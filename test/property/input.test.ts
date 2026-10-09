import { describe, expect, test } from "bun:test";
import {
  MAX_PASTE_CHARS,
  TerminalInputDecoder,
  type TerminalInputEvent,
} from "../../tui/input.ts";
import { forAllSeeds, type Rng } from "./prng.ts";

const cases = Number(process.env.DAWG_FUZZ) || 400;

/** One key or report, as a terminal sends it. */
const KEYS: readonly ((rng: Rng) => string)[] = [
  (rng) => rng.pick(["a", "q", "Z", "7", " ", "é", "🎹", "\r", "\u007f"]),
  (rng) => `\u001b[${rng.pick(["A", "B", "C", "D", "H", "F", "Z"])}`,
  (rng) => `\u001b[${rng.int(1, 24)};${rng.int(1, 8)}${rng.pick(["~", "A"])}`,
  (rng) =>
    `\u001b[<${rng.int(0, 66)};${rng.int(1, 200)};${rng.int(1, 60)}${rng.pick(["M", "m"])}`,
  (rng) =>
    `\u001b[M${String.fromCharCode(rng.int(32, 99), rng.int(33, 120), rng.int(33, 60))}`,
  (rng) => `\u001bO${rng.pick(["A", "B", "C", "D", "H", "F", "P", "S"])}`,
  (rng) =>
    `\u001b[200~${rng.pick(["", "x", "two\nlines", "\u001b[A"])}\u001b[201~`,
  (rng) => `\u001b${rng.pick(["\u001a", "\r", "\u0003"])}`,
  (rng) => `\u001b${rng.pick(["x", "b", "f", "."])}`,
];

function decodeAll(chunks: readonly string[]): TerminalInputEvent[] {
  const decoder = new TerminalInputDecoder();
  return chunks.flatMap((chunk) => decoder.push(chunk)).concat(decoder.flush());
}

function randomInput(rng: Rng): string {
  return Array.from({ length: rng.int(1, 8) }, () => rng.pick(KEYS)(rng)).join(
    "",
  );
}

describe("terminal input decoding is split-invariant", () => {
  test("any split of a key stream decodes like the whole stream", () => {
    forAllSeeds(3_000, cases, (rng) => {
      const input = randomInput(rng);
      const whole = decodeAll([input]);
      const units = Array.from(input);
      // Cut at one, then several, code-point boundaries.
      for (let i = 0; i < 4; i += 1) {
        const cuts = [
          ...new Set(
            Array.from({ length: rng.int(1, 3) }, () =>
              rng.int(1, units.length),
            ),
          ),
        ].sort((x, y) => x - y);
        const chunks: string[] = [];
        let at = 0;
        for (const cut of [...cuts, units.length]) {
          chunks.push(units.slice(at, cut).join(""));
          at = cut;
        }
        expect(decodeAll(chunks)).toEqual(whole);
      }
    });
  });

  test("an SS3 arrow split after ESC O is still the arrow", () => {
    const decoder = new TerminalInputDecoder();
    expect(decoder.push("\u001bO")).toEqual([]);
    expect(decoder.push("B")).toEqual(["\u001bOB"]);
  });

  test("Alt+[ and Alt+O flush as one key and never eat the next", () => {
    for (const prefix of ["\u001b[", "\u001bO"]) {
      const decoder = new TerminalInputDecoder();
      expect(decoder.push(prefix)).toEqual([]);
      expect(decoder.pending()).toBe("escape");
      expect(decoder.flush()).toEqual([prefix]);
      expect(decoder.push("q")).toEqual(["q"]);
    }
    // Typed fast enough to share a read, Alt+[ then a non-CSI byte.
    expect(new TerminalInputDecoder().push("\u001b[é")).toEqual([
      "\u001b[",
      "é",
    ]);
  });

  test("a cut-off bracketed paste flushes instead of freezing input", () => {
    const decoder = new TerminalInputDecoder();
    expect(decoder.push("\u001b[200~half a pa")).toEqual([]);
    expect(decoder.pending()).toBe("paste");
    expect(decoder.flush()).toEqual([{ type: "paste", text: "half a pa" }]);
    expect(decoder.push("q")).toEqual(["q"]);
  });

  test("an oversized paste is emitted rather than buffered forever", () => {
    const decoder = new TerminalInputDecoder();
    const events = decoder.push(`\u001b[200~${"x".repeat(MAX_PASTE_CHARS)}`);
    expect(events).toHaveLength(1);
    expect(decoder.pending()).toBeUndefined();
  });
});
