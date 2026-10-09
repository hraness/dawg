import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import prettier from "prettier";
import { initProject, writeAtomic } from "../../src/project/init.ts";
import { diffScores } from "../diff.ts";
import { createScore, TrackScore } from "../score.ts";
import { evaluateProject } from "./eval.ts";
import { printProject, printTrack } from "./print.ts";
import { granular, note, sampler, song, track } from "./v1.ts";

const grained = createScore({
  tempoBpm: 90,
  bars: 1,
  tracks: [
    {
      id: "pad",
      name: "pad",
      instrument: "granular",
      granular: { preset: "cloud" },
    },
    {
      id: "glass",
      name: "glass",
      instrument: "granular",
      granular: { src: "synth:bell@72", preset: "hold", scan: 0.1, seed: 7 },
    },
    {
      id: "vox",
      name: "vox",
      instrument: "granular",
      granular: {
        src: { src: "tracks/vox/samples/ah.wav", root: 57 },
        grain: 0.12,
        freeze: true,
        window: "tukey",
      },
      sampler: {
        mode: "keyed",
        voices: { ah: { src: "tracks/vox/samples/ah.wav", root: 57 } },
      },
    },
    {
      id: "kept",
      name: "kept",
      instrument: "pad",
      granular: { preset: "dust", gain: 0.5 },
    },
    { id: "bare", name: "bare", instrument: "granular" },
  ],
  notes: [
    {
      id: "n1",
      trackId: "pad",
      startTick: 0,
      durationTicks: 960,
      pitch: 60,
      velocity: 0.8,
    },
    {
      id: "n2",
      trackId: "vox",
      startTick: 0,
      durationTicks: 960,
      pitch: 57,
      velocity: 0.8,
    },
  ],
} as never);

async function writeProject(dir: string, score: TrackScore): Promise<void> {
  for (const file of printProject(score).files)
    await writeAtomic(join(dir, file.path), file.text);
}

describe("granular in the SDK", () => {
  test("granular(), the granular field and words store Track.granular", () => {
    const tracks = [
      track({
        name: "a",
        instrument: granular("cloud", { scan: 0.1 }),
        notes: [note("C4", 0)],
      }),
      track({
        name: "b",
        instrument: granular({ src: "synth:bell@72", grain: 0.08 }),
        notes: [],
      }),
      track({ name: "c", instrument: "granular", notes: [] }),
      track({ name: "d", instrument: "cloud", notes: [] }),
      track({
        name: "e",
        instrument: "granular",
        granular: { preset: "swarm" },
        notes: [],
      }),
      track({
        name: "f",
        instrument: granular("hold", { src: "samples/choir.wav", root: "A3" }),
        notes: [],
      }),
      track({ name: "g", instrument: "pad", notes: [] }),
    ];
    const result = song({ tempo: 100, bars: 1, tracks });
    expect(result.tracks.map((t) => [t.instrument, t.granular])).toEqual([
      ["granular", { preset: "cloud", scan: 0.1 }],
      ["granular", { src: "synth:bell@72", grain: 0.08 }],
      // The bare word is one step to a good sound: the cloud preset.
      ["granular", { preset: "cloud" }],
      ["granular", { preset: "cloud" }],
      ["granular", { preset: "swarm" }],
      [
        "granular",
        {
          preset: "hold",
          src: { src: "tracks/f/samples/choir.wav" },
          root: 57,
        },
      ],
      ["pad", undefined],
    ]);
    expect(() => createScore(result as never)).not.toThrow();
  });

  test("a kept sampler needs a granular instrument", () => {
    const voices = sampler({ ah: "samples/ah.wav" }, { mode: "keyed" });
    const kept = track({
      name: "v",
      instrument: granular({ src: "samples/ah.wav" }),
      sampler: voices,
      notes: [],
    });
    expect(kept.instrument).toBe("granular");
    expect(kept.sampler?.voices.ah?.src).toBe("tracks/v/samples/ah.wav");
    expect(() =>
      track({ name: "w", instrument: "pad", sampler: voices, notes: [] }),
    ).toThrow(/granular/);
  });

  test("dawg rejects unknown presets, params and sources", () => {
    const bad = (value: unknown) =>
      createScore({
        tracks: [
          { id: "a", name: "a", instrument: "granular", granular: value },
        ],
      } as never);
    expect(() => bad({ preset: "fog" })).toThrow(/preset/);
    expect(() => bad({ grain: 1e9 })).toThrow(/grain/);
    expect(() => bad({ src: "synth:nope" })).toThrow(/synth/);
    expect(() => bad({ wobble: 1 })).toThrow(/wobble/);
  });
});

describe("granular in the printer", () => {
  test("prints granular() with its overrides", () => {
    expect(printTrack(grained, grained.tracks[0]!)).toContain(
      'instrument: granular("cloud"),',
    );
    const glass = printTrack(grained, grained.tracks[1]!);
    expect(glass).toContain(
      'instrument: granular("hold", { src: "synth:bell@72", seed: 7, scan: 0.1 }),',
    );
    expect(glass).toContain("import { track, granular }");
    const vox = printTrack(grained, grained.tracks[2]!);
    expect(vox).toContain("instrument: granular({");
    expect(vox).toContain("sampler: sampler(");
    expect(printTrack(grained, grained.tracks[3]!)).toContain(
      'granular: { preset: "dust", gain: 0.5 }',
    );
    expect(printTrack(grained, grained.tracks[4]!)).toContain(
      "instrument: granular(),",
    );
  });

  test("output is prettier-stable", async () => {
    for (const file of printProject(grained).files)
      expect(await prettier.format(file.text, { parser: "typescript" })).toBe(
        file.text,
      );
  });

  test("print → eval → print is the identity", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-print-granular-"));
    try {
      await initProject(dir);
      await writeProject(dir, grained);
      const evaluated = await evaluateProject(dir);
      if (!evaluated.ok) throw new Error(JSON.stringify(evaluated.diagnostics));
      const ops = diffScores(grained, evaluated.score).filter(
        (op) => op.type !== "addNote" && op.type !== "removeNote",
      );
      expect(ops).toEqual([]);
      expect(evaluated.score.tracks.map((t) => t.granular)).toEqual(
        grained.tracks.map((t) => t.granular),
      );
      expect(printProject(evaluated.score).files).toEqual(
        printProject(grained).files,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
