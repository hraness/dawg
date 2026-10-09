import { describe, expect, test } from "bun:test";
import { addTrack, createScore } from "../../core/score.ts";
import { progression } from "../../core/sdk/v1.ts";
import { commandParses } from "./parses.ts";
import {
  applyProgressionCommand,
  parseProgressionCommand,
} from "./progression.ts";

const base = () =>
  addTrack(createScore({ tempoBpm: 96, key: "A minor", bars: 2 }), {
    id: "keys",
    name: "keys",
    instrument: "piano",
  });
const ids = (index: number) => `p${index}`;

describe("progression command", () => {
  test("parses chords, each, at, bass and the prog alias", () => {
    expect(parseProgressionCommand("progression i7 IV7 each 8")).toEqual({
      type: "progression",
      options: { chords: ["i7", "IV7"], each: 8 },
    });
    expect(parseProgressionCommand("/prog Am7 D9 at 4 bass")).toEqual({
      type: "progression",
      options: { chords: ["Am7", "D9"], at: 4, bass: true },
    });
    expect(parseProgressionCommand("progression")?.type).toBe(
      "progression-hint",
    );
    expect(parseProgressionCommand("progress report")).toBeUndefined();
    expect(commandParses("progression i7 IV7 each 8", base())).toBe(true);
  });

  test("writes sustained block chords that match the SDK", () => {
    const score = base();
    const command = parseProgressionCommand(
      "progression i7 IV7 i7 IV7 each 8",
    )!;
    const result = applyProgressionCommand(score, "keys", command, ids);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Am7 D7 Am7 D7");
    expect(result.message).toContain("song now 8 bars");
    const notes = result.next!.notes;
    const sdk = progression("i7 IV7 i7 IV7", { key: "A minor", each: 8 });
    const tpb = score.ticksPerBeat;
    const key = (n: { pitch: number; start: number; length: number }) =>
      `${n.pitch}@${n.start}+${n.length}`;
    expect(
      notes
        .map((n) =>
          key({
            pitch: n.pitch,
            start: n.startTick / tpb,
            length: n.durationTicks / tpb,
          }),
        )
        .sort(),
    ).toEqual(sdk.map((n) => key(n)).sort());
    // Each chord holds its whole span.
    expect(notes.every((n) => n.durationTicks === 8 * tpb)).toBe(true);
  });

  test("bass adds a root under each chord; bad chords say so", () => {
    const score = base();
    const withBass = applyProgressionCommand(
      score,
      "keys",
      parseProgressionCommand("progression i iv bass")!,
      ids,
    );
    const plain = applyProgressionCommand(
      score,
      "keys",
      parseProgressionCommand("progression i iv")!,
      ids,
    );
    expect(withBass.next!.notes.length).toBe(plain.next!.notes.length + 2);
    const bad = applyProgressionCommand(
      score,
      "keys",
      parseProgressionCommand("progression Q9")!,
      ids,
    );
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain("unknown chord");
  });
});
