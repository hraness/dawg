import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initProject, writeAtomic } from "../../src/project/init.ts";
import { SING_PRESET_NAMES } from "../sing.ts";
import { createScore, TrackScore } from "../score.ts";
import { applySingCommand, parseSingCommand } from "../../src/commands/sing.ts";
import { renderScorePcm } from "../../src/audio/wav.ts";
import { evaluateProject } from "./eval.ts";
import { printProject, printTrack } from "./print.ts";
import { note, sing, song, track } from "./v1.ts";

const sung = createScore({
  tempoBpm: 90,
  bars: 1,
  tracks: [
    ...SING_PRESET_NAMES.map((preset) => ({
      id: `s-${preset}`,
      name: `s-${preset}`,
      instrument: "sing",
      sing: { preset },
    })),
    {
      id: "drone",
      name: "drone",
      instrument: "sing",
      sing: { preset: "drone", drone: 45, overtone: 0.4 },
    },
    {
      id: "lead",
      name: "lead",
      instrument: "sing",
      sing: { voice: "soprano", vowel: "e", harmonics: [6, 12] },
    },
  ],
  notes: [
    {
      id: "n1",
      trackId: "lead",
      startTick: 0,
      durationTicks: 960,
      pitch: 72,
      velocity: 0.8,
      vowel: "a>u",
    },
    {
      id: "n2",
      trackId: "s-choir",
      startTick: 0,
      durationTicks: 960,
      pitch: 60,
      velocity: 0.8,
    },
  ],
} as never);

async function writeProject(dir: string, score: TrackScore): Promise<void> {
  for (const file of printProject(score).files)
    await writeAtomic(join(dir, file.path), file.text);
}

describe("sing in the SDK", () => {
  test("sing(), the bare words and vowel notes store Track.sing", () => {
    const result = song({
      tempo: 100,
      bars: 1,
      tracks: [
        track({
          name: "a",
          instrument: sing("choir", { voices: 4 }),
          notes: [note("C4", 0, 1, 0.8, { vowel: "a>o" })],
        }),
        track({ name: "b", instrument: "khoomei", notes: [] }),
        track({
          name: "c",
          instrument: sing({ drone: "D3", vowel: "o" }),
          notes: [],
        }),
        track({ name: "d", instrument: sing(), notes: [] }),
      ],
    });
    expect(result.tracks.map((t) => [t.instrument, t.sing])).toEqual([
      ["sing", { preset: "choir", voices: 4 }],
      ["sing", { preset: "khoomei" }],
      ["sing", { vowel: "o", drone: 50 }],
      ["sing", {}],
    ]);
    expect(result.notes?.[0]).toMatchObject({ vowel: "a>o" });
    expect(() => createScore(result as never)).not.toThrow();
    expect(() => sing("opera" as never)).toThrow(/opera/);
  });
});

describe("sing in the printer", () => {
  test("a bare preset prints the instrument word", () => {
    expect(
      printTrack(
        sung,
        sung.tracks.find((t) => t.id === "s-choir")!,
      ),
    ).toContain('instrument: "choir",');
  });

  test("the drone prints as a note name", () => {
    const text = printTrack(
      sung,
      sung.tracks.find((t) => t.id === "drone")!,
    );
    expect(text).toContain('sing("drone", { drone: "A2", overtone: 0.4 })');
  });

  test("every preset, a drone and a vowel morph round-trip", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-print-sing-"));
    try {
      await initProject(dir);
      await writeProject(dir, sung);
      const evaluated = await evaluateProject(dir);
      if (!evaluated.ok) throw new Error(JSON.stringify(evaluated.diagnostics));
      expect(evaluated.score.tracks.map((t) => [t.instrument, t.sing])).toEqual(
        sung.tracks.map((t) => [t.instrument, t.sing]),
      );
      expect(evaluated.score.notes.find((n) => n.pitch === 72)?.vowel).toBe(
        "a>u",
      );
      expect(printProject(evaluated.score).files).toEqual(
        printProject(sung).files,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("sing off survives a save and reload as the same plain voice", async () => {
    const on = sung;
    const off = applySingCommand(on, "lead", parseSingCommand("sing off")!);
    expect(off.ok).toBe(true);
    const track = off.next!.tracks.find((t) => t.id === "lead")!;
    expect(track.sing).toBeUndefined();
    expect(track.instrument).not.toBe("sing");
    expect(
      applySingCommand(off.next!, "lead", parseSingCommand("sing")!).message,
    ).toContain("plays sine");
    const dir = await mkdtemp(join(tmpdir(), "dawg-print-sing-off-"));
    try {
      await initProject(dir);
      await writeProject(dir, off.next!);
      const evaluated = await evaluateProject(dir);
      if (!evaluated.ok) throw new Error(JSON.stringify(evaluated.diagnostics));
      const back = evaluated.score.tracks.find((t) => t.id === "lead")!;
      expect(back.sing).toBeUndefined();
      expect(back.instrument).toBe(track.instrument);
      const pcm = (score: TrackScore) =>
        renderScorePcm(
          new TrackScore({
            ...score,
            tracks: score.tracks.filter((t) => t.id === "lead"),
            notes: score.notes.filter((n) => n.trackId === "lead"),
          }),
          { sampleRate: 22_050 },
        ).pcm;
      expect(Array.from(pcm(evaluated.score))).toEqual(
        Array.from(pcm(off.next!)),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a field-less sing track says it is off", () => {
    const bare = createScore({
      tempoBpm: 90,
      bars: 1,
      tracks: [{ id: "v", name: "v", instrument: "sing" }],
      notes: [],
    } as never);
    expect(applySingCommand(bare, "v", parseSingCommand("sing")!).message).toBe(
      `sing · off · sing <preset> turns it on (${SING_PRESET_NAMES.join(" ")})`,
    );
  });
});
