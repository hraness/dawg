/**
 * Property (d): a random valid score printed as a project, evaluated by the
 * SDK and given back its note ids diffs to nothing, with no operation
 * filtered out. Each case spawns one evaluation, so the default run is
 * small; DAWG_FUZZ=N runs N cases.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adoptNoteIds, diffScores } from "../../core/diff.ts";
import { evaluateProject } from "../../core/sdk/eval.ts";
import { printProject } from "../../core/sdk/print.ts";
import { track, wavetable } from "../../core/sdk/v1.ts";
import { createScore, type TrackScore } from "../../core/score.ts";
import { rowInSync } from "../../core/rhythm.ts";
import { timeWithinSong } from "../../core/tempo.ts";
import { initProject, writeAtomic } from "../../src/project/init.ts";
import { caseCount, mulberry32 } from "./prng.ts";
import { randomScore } from "./random.ts";

async function roundTrip(
  seed: number,
  score: TrackScore,
  printed: TrackScore = score,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "dawg-prop-print-"));
  try {
    await initProject(dir);
    for (const file of printProject(printed).files)
      await writeAtomic(join(dir, file.path), file.text);
    const evaluated = await evaluateProject(dir);
    if (!evaluated.ok)
      throw new Error(
        `seed ${seed}: ${JSON.stringify(evaluated.diagnostics).slice(0, 400)}`,
      );
    const adopted = adoptNoteIds(score, evaluated.score);
    const ops = diffScores(score, adopted);
    if (ops.length) console.error(`print round trip failed at seed ${seed}`);
    expect(ops).toEqual([]);
    expect(printProject(evaluated.score).files).toEqual(
      printProject(printed).files,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * The score as printing defines it: time as the SDK writes it, and only
 * rhythm rows still in sync with their lane (a hand-edited lane prints as
 * plain notes, so its row is gone by design).
 */
function heard(score: TrackScore): TrackScore {
  const timed = score.withTime(timeWithinSong(score) ?? null);
  const data = timed.toJSON();
  return createScore({
    ...data,
    tracks: timed.tracks.map((track) => {
      const rows = (track.rhythm ?? []).filter((row) =>
        rowInSync(timed, track, row),
      );
      const { rhythm: _drop, ...rest } = track;
      return rows.length > 0 ? { ...rest, rhythm: rows } : rest;
    }),
  });
}

describe("songs shorter than their time marks", () => {
  const long = createScore({
    tempoBpm: 120,
    bars: 8,
    time: {
      tempo: [{ tick: 480 * 28, bpm: 90 }],
      meter: [
        { bar: 1, beatsPerBar: 3 },
        { bar: 6, beatsPerBar: 5 },
      ],
      fermatas: [{ tick: 480 * 29, beats: 2 }],
    },
  });

  test("setBars to a shorter song drops the marks past its end", () => {
    const short = long.withBars(2);
    expect(short.time).toEqual({ meter: [{ bar: 1, beatsPerBar: 3 }] });
    expect(long.withBars(12).time).toEqual(long.time);
  });

  test("an older score holding such marks still prints a loadable song", async () => {
    // Before setBars trimmed, a shortened song kept them; the SDK refuses
    // them, so the printer leaves them out.
    const old = createScore({ ...long.toJSON(), bars: 2 });
    expect(old.time?.fermatas).toHaveLength(1);
    await roundTrip(0, heard(old), old);
  });
});

describe("printer gaps found by the round trip", () => {
  test("a ramp landing on the final barline prints at the last tick", async () => {
    const score = createScore({
      tempoBpm: 120,
      beatsPerBar: 2,
      bars: 3,
      time: {
        tempo: [
          { tick: 480, bpm: 30 },
          { tick: 2880, bpm: 200, ramp: "linear" },
        ],
      },
    });
    expect(timeWithinSong(score)?.tempo?.[1]?.tick).toBe(2879);
    await roundTrip(0, heard(score), score);
  });

  test("a wavetable kept after leaving the instrument survives printing", async () => {
    const score = createScore({
      tracks: [
        {
          id: "lead",
          name: "lead",
          instrument: "piano",
          wavetable: { table: { src: "builtin:formant" }, wt: 0.25 },
        },
      ],
    });
    const song = printProject(score).files.find(
      (f) => f.path === "tracks/lead/track.ts",
    )!.text;
    expect(song).toContain("wavetable: wavetable(");
    await roundTrip(0, score);
  });

  test("a wavetable track cannot also keep one", () => {
    expect(() =>
      track({
        name: "lead",
        instrument: wavetable("basic"),
        wavetable: wavetable("pwm"),
      }),
    ).toThrow("sets its table in instrument");
    expect(() =>
      track({ name: "lead", instrument: "saw", wavetable: "basic" as never }),
    ).toThrow("wavetable: takes wavetable(...)");
  });
});

describe("print, evaluate and adopt ids is the identity", () => {
  const cases = caseCount(16);
  test(
    `random scores (${cases} cases)`,
    async () => {
      const seeds = Array.from({ length: cases }, (_, i) => 3_000 + i);
      // Evaluations run as child processes, a few at a time.
      for (let i = 0; i < seeds.length; i += 4)
        await Promise.all(
          seeds
            .slice(i, i + 4)
            .map((seed) =>
              roundTrip(seed, heard(randomScore(mulberry32(seed)))),
            ),
        );
    },
    60_000 + cases * 2_000,
  );
});
