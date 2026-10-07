import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initProject, writeAtomic } from "../../src/project/init.ts";
import { evaluateProject, formatDiagnostic, parseChildOutput } from "./eval.ts";

let dir = "";

const BASS = `import { track, note, seq } from "dawg";

export default track({
  name: "bass",
  instrument: "bass",
  notes: [note("A1", 0, 1), ...seq("E2 G2 A2", { from: 4, step: 0.5 })],
});
`;
const SONG = `import { song } from "dawg";
import bass from "./tracks/bass/track.ts";

export default song({ tempo: 120, meter: [4, 4], bars: 4, tracks: [bass] });
`;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "dawg-eval-"));
  await initProject(dir);
  await writeAtomic(join(dir, "tracks/bass/track.ts"), BASS);
  await writeAtomic(join(dir, "song.ts"), SONG);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("evaluateProject", () => {
  test("evaluates song.ts in a subprocess into a validated score", async () => {
    const result = await evaluateProject(dir);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.score.tracks.map((t) => t.id)).toEqual(["bass"]);
    expect(result.score.notes.map((n) => n.startTick)).toEqual([
      0, 1920, 2160, 2400,
    ]);
    expect(result.ms).toBeLessThan(5_000);
  });

  test("reports a thrown SDK error with file and line", async () => {
    await writeAtomic(
      join(dir, "tracks/bass/track.ts"),
      BASS.replace('note("A1", 0, 1)', 'note("H1", 0, 1)'),
    );
    try {
      const result = await evaluateProject(dir);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      const [first] = result.diagnostics;
      expect(first?.file).toBe("tracks/bass/track.ts");
      expect(first?.line).toBe(6);
      expect(first?.message).toContain("H1");
      expect(formatDiagnostic(first!)).toMatch(
        /^tracks\/bass\/track\.ts:6:\d+ pitch/,
      );
    } finally {
      await writeAtomic(join(dir, "tracks/bass/track.ts"), BASS);
    }
  });

  test("a track using chord() and progression() from the vendored SDK evaluates", async () => {
    await writeAtomic(
      join(dir, "tracks/bass/track.ts"),
      `import { track, chord, progression } from "dawg";\nexport default track({ name: "bass", instrument: "piano", notes: [...progression("ii7 V7 Imaj7", { key: "C major" }), ...chord("Am", 12, 4)] });\n`,
    );
    try {
      const result = await evaluateProject(dir);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const pitches = result.score.notes
        .filter((n) => n.startTick === 0)
        .map((n) => n.pitch)
        .sort((a, b) => a - b);
      expect(pitches).toEqual([62, 65, 69, 72]);
      expect(result.score.notes.length).toBe(15);
    } finally {
      await writeAtomic(join(dir, "tracks/bass/track.ts"), BASS);
    }
  });

  test("reports a syntax error with its position", async () => {
    await writeAtomic(
      join(dir, "tracks/bass/track.ts"),
      BASS.replace("});", "}"),
    );
    try {
      const result = await evaluateProject(dir);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.diagnostics[0]?.file).toBe("tracks/bass/track.ts");
      expect(result.diagnostics[0]?.line).toBeNumber();
    } finally {
      await writeAtomic(join(dir, "tracks/bass/track.ts"), BASS);
    }
  });

  test("a song that never finishes is killed at the timeout", async () => {
    await writeAtomic(
      join(dir, "song.ts"),
      `for (;;) {}\nexport default {};\n`,
    );
    try {
      const result = await evaluateProject(dir, { timeoutMs: 500 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.diagnostics[0]?.message).toContain("timed out");
    } finally {
      await writeAtomic(join(dir, "song.ts"), SONG);
    }
  });

  test("the child sees a scrubbed environment and cannot reach the parent's", async () => {
    process.env.DAWG_EVAL_SECRET = "leak";
    await writeAtomic(
      join(dir, "song.ts"),
      `export default { format: "track.loop/v1", version: 1, tempoBpm: 120, beatsPerBar: 4, bars: 4, ticksPerBeat: 480, key: process.env.DAWG_EVAL_SECRET ?? null, tracks: [], notes: [] };\n`,
    );
    try {
      const result = await evaluateProject(dir);
      delete process.env.DAWG_EVAL_SECRET;
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      expect(result.score.key).toBeNull();
    } finally {
      await writeAtomic(join(dir, "song.ts"), SONG);
    }
  });

  test("parseChildOutput validates from unknown", () => {
    expect(parseChildOutput("nope").ok).toBe(false);
    expect(parseChildOutput('{"ok":true,"score":{"format":"x"}}').ok).toBe(
      false,
    );
    const failed = parseChildOutput(
      '{"ok":false,"error":{"message":"boom","file":"song.ts","line":3}}',
    );
    expect(failed.ok).toBe(false);
    if (!failed.ok)
      expect(failed.diagnostics[0]).toEqual({
        message: "boom",
        file: "song.ts",
        line: 3,
      });
    const weird = parseChildOutput('{"ok":false,"error":{"line":"3"}}');
    if (!weird.ok)
      expect(weird.diagnostics[0]).toEqual({ message: "song.ts threw" });
  });
});
