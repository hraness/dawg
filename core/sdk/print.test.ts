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
      reverb: {
        mix: 0.1,
        size: 0.5,
        ir: {
          src: "pack:dirt-samples/bev:0",
          sha256: "a".repeat(64),
          url: "https://raw.githubusercontent.com/tidalcycles/dirt-samples/master/bev/00_BEV.wav",
        },
      },
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
        voices: {
          vox: { src: "tracks/vox/samples/vox.wav", root: 60 },
          // Strudel sample controls (SDK 1.13.0).
          pad: {
            src: "tracks/vox/samples/pad.wav",
            root: 48,
            speed: 0.5,
            loop: true,
            loopBegin: 0.2,
            loopEnd: 0.8,
            clip: 1.5,
            unit: "c",
            fit: false,
            accelerate: -0.5,
            squiz: 2,
          },
        },
      },
    },
    {
      id: "lead",
      name: "lead",
      instrument: "saw",
      filter: { cutoff: 300, resonance: 0.1, type: "hpf", ftype: "24db" },
      delay: { beats: 0.75, feedback: 0.35, mix: 0.25, pingpong: true },
      reverb: {
        mix: 0.3,
        size: 0.6,
        fade: 3,
        predelay: 0.02,
        ir: { src: "hall" },
      },
      fx: {
        chorus: {},
        distort: { drive: 3, type: "fold" },
        autofilter: { shape: "random", sync: 0.25 },
        orbit: { orbit: 4 },
        duck: { orbit: 3, depth: 0.7 },
      },
      synth: { attack: 0.01, lpf: 1200, lpenv: 2, fm: 1.5, partials: [1, 0.5] },
      fxAutomation: {
        "synth-lpf": [
          { tick: 0, value: 600 },
          { tick: 1920, value: 3000 },
        ],
        "autofilter-cutoff": [
          { tick: 0, value: 400 },
          { tick: 1920, value: 4000 },
        ],
        "reverb-mix": [{ tick: 0, value: 0.2 }],
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

const tables = createScore({
  tempoBpm: 110,
  bars: 1,
  tracks: [
    {
      id: "pad",
      name: "pad",
      instrument: "wavetable",
      wavetable: {
        table: { src: "builtin:formant" },
        wt: 0.25,
        wtenv: -0.5,
        warp: 0.3,
        warpmode: "bendmp",
      },
      wtAutomation: [
        { tick: 0, value: 0.25 },
        { tick: 960, value: 0.75 },
      ],
    },
    {
      id: "lead",
      name: "lead",
      instrument: "wavetable",
      wavetable: {
        table: {
          src: "pack:uzu-wavetables/wt_digital:2",
          sha256: "b".repeat(64),
          url: "https://example.com/wt_digital/c.wav",
        },
        wtphaserand: 1,
      },
    },
  ],
  notes: [
    {
      id: "n1",
      trackId: "pad",
      startTick: 0,
      durationTicks: 960,
      pitch: 48,
      velocity: 0.7,
    },
  ],
} as never);

describe("wavetable tracks", () => {
  test("print as wavetable(...) and survive print → eval unchanged", async () => {
    const pad = printTrack(tables, tables.tracks[0]!);
    expect(pad).toContain('import { track, note, wavetable } from "dawg";');
    expect(pad).toContain('instrument: wavetable("formant", {');
    expect(pad).toContain("wt: [");
    const lead = printTrack(tables, tables.tracks[1]!);
    expect(lead).toContain("pack:uzu-wavetables/wt_digital:2");
    expect(lead).toContain("b".repeat(64));
    for (const file of printProject(tables).files)
      expect(await prettier.format(file.text, { parser: "typescript" })).toBe(
        file.text,
      );
    const dir = await mkdtemp(join(tmpdir(), "dawg-print-wt-"));
    try {
      await initProject(dir);
      await writeProject(dir, tables);
      const evaluated = await evaluateProject(dir);
      if (!evaluated.ok) throw new Error(JSON.stringify(evaluated.diagnostics));
      const ops = diffScores(tables, evaluated.score).filter(
        (op) => op.type !== "addNote" && op.type !== "removeNote",
      );
      expect(ops).toEqual([]);
      expect(evaluated.score.tracks[0]!.wavetable).toEqual(
        tables.tracks[0]!.wavetable,
      );
      expect(printProject(evaluated.score).files).toEqual(
        printProject(tables).files,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("printer", () => {
  test("effects print their set fields and non-default fx params", () => {
    const lead = printTrack(rich, rich.tracks.at(-1)!);
    expect(lead).toContain(
      '  filter: { cutoff: 300, resonance: 0.1, type: "hpf", ftype: "24db" },',
    );
    expect(lead).toContain(
      '  fx: {\n    autofilter: { sync: 0.25, shape: "random" },',
    );
    expect(lead).toContain("    chorus: {},");
    expect(lead).toContain('    distort: { drive: 3, type: "fold" },');
    expect(lead).toContain("    orbit: { orbit: 4 },");
    expect(lead).toContain("    duck: { orbit: 3, depth: 0.7 },");
    expect(lead).toContain('      "autofilter-cutoff": [');
    expect(lead).toContain('      "reverb-mix": [[0, 0.2]],');
    expect(lead).toContain(
      "  synth: { attack: 0.01, lpf: 1200, lpenv: 2, fm: 1.5, partials: [1, 0.5] },",
    );
    expect(lead).toContain('      "synth-lpf": [');
  });

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
      "tracks: [bass, drums_2, track_default, beat, vox, lead],",
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
