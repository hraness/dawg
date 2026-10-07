import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import prettier from "prettier";
import { initProject, writeAtomic } from "../../src/project/init.ts";
import { diffScores } from "../diff.ts";
import { addNote, createScore, TrackScore, updateTrack } from "../score.ts";
import { evaluateProject } from "./eval.ts";
import {
  num,
  printProject,
  printSong,
  printTrack,
  str,
  trackDirectories,
} from "./print.ts";

const rich = createScore({
  tempoBpm: 128,
  key: "A minor",
  bars: 2,
  tracks: [
    {
      id: "bass",
      name: "bass",
      instrument: "bass",
      volume: 0.8,
      pan: -0.25,
      filter: { cutoff: 800, resonance: 0.2 },
      delay: { beats: 0.5, feedback: 0.3, mix: 0.2 },
      reverb: { mix: 0.1, size: 0.5 },
      volumeAutomation: [
        { tick: 0, value: 1 },
        { tick: 1920, value: 0.5 },
      ],
      panAutomation: [{ tick: 0, value: 0 }],
    },
    { id: "kit", name: "Drums 2", instrument: "kit", solo: true },
    { id: "default", name: "default", instrument: "sine", muted: true },
    {
      id: "beat",
      name: "beat",
      instrument: "sampler",
      sampler: {
        mode: "oneshot",
        voices: {
          kick: { src: "tracks/beat/samples/kick.wav" },
          snare: {
            src: "tracks/beat/samples/a-rather-long-snare-sample-file-name.wav",
            gain: 0.5,
            choke: "a",
          },
        },
      },
    },
    {
      id: "vox",
      name: "vox",
      instrument: "sampler",
      sampler: {
        mode: "keyed",
        voices: { vox: { src: "tracks/vox/samples/vox.wav", root: 60 } },
      },
    },
  ],
  notes: [
    ...Array.from({ length: 24 }, (_, i) => ({
      id: `n${i}`,
      trackId: "bass",
      startTick: i * 160,
      durationTicks: 160,
      pitch: 33 + (i % 7),
      velocity: i % 2 ? 0.8 : 0.6,
    })),
    {
      id: "k1",
      trackId: "kit",
      startTick: 0,
      durationTicks: 120,
      pitch: 36,
      velocity: 0.8,
    },
    {
      id: "k2",
      trackId: "kit",
      startTick: 480,
      durationTicks: 120,
      pitch: 38,
      velocity: 0.7,
    },
    {
      id: "k3",
      trackId: "kit",
      startTick: 960,
      durationTicks: 240,
      pitch: 60,
      velocity: 0.8,
    },
    {
      id: "s1",
      trackId: "beat",
      startTick: 0,
      durationTicks: 120,
      pitch: 36,
      velocity: 0.8,
    },
    {
      id: "s2",
      trackId: "beat",
      startTick: 240,
      durationTicks: 240,
      pitch: 37,
      velocity: 0.8,
    },
    {
      id: "v1",
      trackId: "vox",
      startTick: 0,
      durationTicks: 960,
      pitch: 64,
      velocity: 0.8,
    },
  ],
});

async function writeProject(dir: string, score: TrackScore): Promise<void> {
  for (const file of printProject(score).files)
    await writeAtomic(join(dir, file.path), file.text);
}

describe("printer", () => {
  test("output is prettier-stable", async () => {
    for (const file of printProject(rich).files) {
      const formatted = await prettier.format(file.text, {
        parser: "typescript",
      });
      expect(formatted).toBe(file.text);
    }
  });

  test("print(eval(print(x))) is the identity and the evaluation equals the score", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-print-"));
    try {
      await initProject(dir);
      const first = printProject(rich);
      await writeProject(dir, rich);
      const evaluated = await evaluateProject(dir);
      if (!evaluated.ok) throw new Error(JSON.stringify(evaluated.diagnostics));
      // Everything but note ids survives; ids are content hashes.
      const ops = diffScores(rich, evaluated.score).filter(
        (op) => op.type !== "addNote" && op.type !== "removeNote",
      );
      expect(ops).toEqual([]);
      const second = printProject(evaluated.score);
      expect(second.files).toEqual(first.files);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("unchanged tracks reprint byte-for-byte after another track changes", () => {
    const before = printProject(rich);
    const after = printProject(
      updateTrack(
        addNote(rich, {
          id: "extra",
          trackId: "kit",
          startTick: 1440,
          durationTicks: 120,
          pitch: 39,
          velocity: 0.8,
        }),
        "bass",
        { volume: 0.5 },
      ),
    );
    const byPath = new Map(after.files.map((file) => [file.path, file.text]));
    for (const file of before.files) {
      if (
        file.path === "tracks/bass/track.ts" ||
        file.path === "tracks/drums-2/track.ts"
      ) {
        expect(byPath.get(file.path)).not.toBe(file.text);
      } else expect(byPath.get(file.path)).toBe(file.text);
    }
  });

  test("song.ts imports every track with a safe identifier", () => {
    const text = printSong(rich);
    expect(text).toContain(
      'import track_default from "./tracks/default/track.ts";',
    );
    expect(text).toContain('import drums_2 from "./tracks/drums-2/track.ts";');
    expect(text).toContain(
      "tracks: [bass, drums_2, track_default, beat, vox],",
    );
    expect(text).toContain('key: "A minor",');
    expect(text).not.toContain("ticksPerBeat");
  });

  test("tracks print only non-default fields and voice names", () => {
    const kit = printTrack(rich, rich.tracks[1]!);
    expect(kit).toBe(`import { track, note, hit } from "dawg";

export default track({
  id: "kit",
  name: "Drums 2",
  instrument: "kit",
  solo: true,
  notes: [hit("kick", 0), hit("snare", 1, 0.7), note(60, 2, 0.5)],
});
`);
    const beat = printTrack(rich, rich.tracks[3]!);
    expect(beat).toContain('hit("snare", 0.5, 0.8, 0.5)');
    expect(beat).toContain("instrument: sampler({\n    kick:");
    const vox = printTrack(rich, rich.tracks[4]!);
    expect(vox).toContain('{ mode: "keyed" }');
    expect(vox).toContain('note("E4", 0, 2)');
    const plain = printTrack(rich, rich.tracks[2]!);
    expect(plain).toContain("muted: true,");
    expect(plain).toContain("notes: [],");
    expect(plain).not.toContain("volume");
  });

  test("duplicate slugs get numbered directories", () => {
    const score = createScore({
      tracks: [
        { id: "a", name: "Keys" },
        { id: "b", name: "keys" },
        { id: "c", name: "KEYS!" },
      ],
    });
    expect([...trackDirectories(score).values()]).toEqual([
      "keys",
      "keys-2",
      "keys-3",
    ]);
  });

  test("numbers and strings print the way prettier does", () => {
    expect(num(0.5)).toBe("0.5");
    expect(num(1e21)).toBe("1e21");
    expect(num(-3)).toBe("-3");
    expect(str('say "hi"')).toBe(`'say "hi"'`);
    expect(str("it's")).toBe(`"it's"`);
    expect(str("a\nb")).toBe('"a\\nb"');
  });
});
