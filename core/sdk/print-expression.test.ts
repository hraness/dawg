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
import { hit, note, seq, song, track } from "./v1.ts";

const expressive = createScore({
  tempoBpm: 96,
  bars: 2,
  tracks: [
    {
      id: "lead",
      name: "lead",
      instrument: "saw",
      glide: { time: 0.08, mode: "legato" },
      pedal: [
        { tick: 0, state: "down" },
        { tick: 1920, state: "up" },
        { tick: 2400, state: "half" },
      ],
      velocityCurve: { curve: "soft" },
      humanize: { timing: 8, velocity: 5, seed: 7 },
    },
    {
      id: "keys",
      name: "keys",
      instrument: "piano",
      glide: { time: 0.12, mode: "poly" },
      pedal: [{ tick: 0, state: "down" }],
      softPedal: [
        { tick: 0, state: "half" },
        { tick: 960, state: "up" },
      ],
      sostenuto: [{ tick: 480, state: "down" }],
      velocityCurve: { curve: "fixed", fixed: 0.6 },
    },
    {
      id: "organ",
      name: "organ",
      instrument: "organ",
      velocityCurve: { curve: "fixed" },
      humanize: { length: 10, seed: 0 },
    },
    { id: "kit", name: "kit", instrument: "kit" },
  ],
  notes: [
    {
      id: "a",
      trackId: "lead",
      startTick: 0,
      durationTicks: 480,
      pitch: 60,
      velocity: 0.8,
      articulation: "staccato",
    },
    {
      id: "b",
      trackId: "lead",
      startTick: 480,
      durationTicks: 480,
      pitch: 62,
      velocity: 0.8,
      glide: 0.05,
      bend: [
        { at: 0, cents: -200 },
        { at: 0.25, cents: 0 },
      ],
    },
    {
      id: "c",
      trackId: "lead",
      startTick: 960,
      durationTicks: 960,
      pitch: 64,
      velocity: 0.55,
      articulation: "tenuto",
      glide: 0.1,
      bend: [{ at: 0.5, cents: 100 }],
      vibrato: { rate: 5.5, depth: 30, delay: 0.2 },
    },
    {
      id: "d",
      trackId: "keys",
      startTick: 0,
      durationTicks: 1920,
      pitch: 48,
      velocity: 0.7,
      vibrato: { rate: 4, depth: 10 },
      humanize: { timing: 12, velocity: 4 },
    },
    {
      id: "e",
      trackId: "kit",
      startTick: 240,
      durationTicks: 120,
      pitch: 42,
      velocity: 0.3,
      articulation: "ghost",
    },
    {
      id: "f",
      trackId: "kit",
      startTick: 0,
      durationTicks: 120,
      pitch: 36,
      velocity: 0.8,
      articulation: "accent",
    },
  ],
} as never);

async function writeProject(dir: string, score: TrackScore): Promise<void> {
  for (const file of printProject(score).files)
    await writeAtomic(join(dir, file.path), file.text);
}

describe("expression in the printer", () => {
  test("notes, hits and tracks print their expression", () => {
    const lead = printTrack(expressive, expressive.tracks[0]!);
    expect(lead).toContain('note("C4", 0, 1, 0.8, { art: "staccato" })');
    expect(lead).toContain("glide: 0.08,");
    expect(lead).toContain('[0, "down"],');
    expect(lead).toContain('velocityCurve: "soft",');
    expect(lead).toContain("humanize: { timing: 8, velocity: 5, seed: 7 },");
    expect(lead).toContain("bend: [\n");
    expect(lead).toContain("vibrato: { rate: 5.5, depth: 30, delay: 0.2 },");
    const keys = printTrack(expressive, expressive.tracks[1]!);
    expect(keys).toContain("humanize: { timing: 12, velocity: 4 },");
    expect(keys).toContain('glide: { time: 0.12, mode: "poly" },');
    expect(keys).toContain('pedal: [[0, "down"]],');
    expect(keys).toContain("softPedal: [\n");
    expect(keys).toContain('sostenuto: [[1, "down"]],');
    expect(lead).not.toContain("softPedal");
    expect(keys).toContain('velocityCurve: { curve: "fixed", fixed: 0.6 },');
    const organ = printTrack(expressive, expressive.tracks[2]!);
    expect(organ).toContain('velocityCurve: "fixed",');
    expect(organ).toContain("humanize: { length: 10, seed: 0 },");
    const kit = printTrack(expressive, expressive.tracks[3]!);
    expect(kit).toContain('hit("hat", 0.5, 0.3, 0.25, { art: "ghost" })');
    expect(kit).toContain('hit("kick", 0, 0.8, 0.25, { art: "accent" })');
  });

  test("output is prettier-stable", async () => {
    for (const file of printProject(expressive).files)
      expect(await prettier.format(file.text, { parser: "typescript" })).toBe(
        file.text,
      );
  });

  test("print → eval keeps every expression field and reprints identically", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-print-expr-"));
    try {
      await initProject(dir);
      await writeProject(dir, expressive);
      const evaluated = await evaluateProject(dir);
      if (!evaluated.ok) throw new Error(JSON.stringify(evaluated.diagnostics));
      const ops = diffScores(expressive, evaluated.score).filter(
        (op) => op.type !== "addNote" && op.type !== "removeNote",
      );
      expect(ops).toEqual([]);
      const strip = (score: TrackScore) =>
        score.notes.map(({ id: _id, ...rest }) => JSON.stringify(rest)).sort();
      expect(strip(evaluated.score)).toEqual(strip(expressive));
      expect(evaluated.score.tracks).toEqual(expressive.tracks);
      expect(printProject(evaluated.score).files).toEqual(
        printProject(expressive).files,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("expression in the SDK", () => {
  test("note(), seq(), hit() and track() carry expression into the song", () => {
    const lead = track({
      name: "lead",
      instrument: "saw",
      glide: 0.07,
      pedal: [
        [0, "down"],
        [4, "up"],
      ],
      velocityCurve: "hard",
      humanize: { timing: 12 },
      notes: [
        note("C4", 0, 1, 0.8, { art: "legato", glide: 0.04 }),
        note("E4", 1, 1, 0.8, {
          bend: [
            [0.5, 50],
            [0, -100],
          ],
          vibrato: { rate: 6, depth: 25 },
        }),
        note("G4", 2, 1, 0.8, { humanize: {} }),
        note("A4", 3, 1, 0.8, { humanize: { timing: 20, length: 0 } }),
      ],
    });
    const kit = track({
      name: "kit",
      instrument: "kit",
      notes: [hit("hat", 0.5, 0.3, 0.25, { articulation: "ghost" })],
    });
    const data = song({ tempo: 120, bars: 2, tracks: [lead, kit] });
    const score = new TrackScore(data as never);
    const leadTrack = score.tracks.find((t) => t.name === "lead")!;
    expect(leadTrack.glide).toEqual({ time: 0.07, mode: "legato" });
    expect(leadTrack.pedal).toEqual([
      { tick: 0, state: "down" },
      { tick: 4 * score.ticksPerBeat, state: "up" },
    ]);
    expect(leadTrack.velocityCurve).toEqual({ curve: "hard" });
    expect(leadTrack.humanize).toEqual({ timing: 12, seed: 1 });
    const notes = score.notes
      .filter((n) => n.trackId === leadTrack.id)
      .sort((a, b) => a.pitch - b.pitch);
    expect(notes[0]!.articulation).toBe("legato");
    expect(notes[0]!.glide).toBe(0.04);
    // Bend points sort by position.
    expect(notes[1]!.bend).toEqual([
      { at: 0, cents: -100 },
      { at: 0.5, cents: 50 },
    ]);
    expect(notes[1]!.vibrato).toEqual({ rate: 6, depth: 25 });
    expect(notes[2]!.articulation).toBeUndefined();
    expect(notes[2]!.humanize).toEqual({});
    expect(notes[3]!.humanize).toEqual({ timing: 20 });
    const hat = score.notes.find((n) => n.pitch === 42)!;
    expect(hat.articulation).toBe("ghost");
  });

  test("plain notes keep their ids when expression is added", () => {
    const plain = song({
      tempo: 120,
      tracks: [track({ name: "a", notes: [note("C4", 0)] })],
    });
    const styled = song({
      tempo: 120,
      tracks: [
        track({ name: "a", notes: [note("C4", 0, 1, 0.8, { art: "accent" })] }),
      ],
    });
    const ids = (data: unknown) =>
      new TrackScore(data as never).notes.map((n) => n.id);
    expect(ids(styled)).toEqual(ids(plain));
  });

  test("bad expression is rejected with a clear message", () => {
    expect(() => note("C4", 0, 1, 0.8, { art: "loud" } as never)).toThrow(
      /articulation/,
    );
    expect(() => note("C4", 0, 1, 0.8, { glide: -1 })).toThrow(/glide/);
    expect(() => note("C4", 0, 1, 0.8, { wobble: 1 } as never)).toThrow(
      /unknown field/,
    );
    expect(() =>
      track({ name: "x", pedal: [[0, "sideways"]] as never }),
    ).toThrow(/pedal/);
    expect(() =>
      track({ name: "x", sostenuto: [[0, "half"]] as never }),
    ).toThrow(/sostenuto/);
    expect(() => track({ name: "x", velocityCurve: "spicy" as never })).toThrow(
      /velocityCurve/,
    );
    expect(() =>
      track({ name: "x", glide: { mode: "drift" } as never }),
    ).toThrow(/glide mode/);
  });
});
