import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScore, type TrackScore } from "../core/score.ts";
import { encodeWav } from "../src/audio/wav.ts";
import { clearClipPeaks, clipSnapshots, loadClipPeaks } from "./clip-row.ts";
import { paintHighway, type TrackScoreSnapshot } from "./highway.ts";
import { CellBuffer } from "./screen.ts";
import { effectiveTheme, type TerminalCapabilities } from "./theme.ts";

const CAPS: TerminalCapabilities = { colorDepth: "truecolor", unicode: true };
const theme = effectiveTheme("default", CAPS);
const SHA = "a".repeat(64);

function score(): TrackScore {
  return createScore({
    tempoBpm: 120,
    bars: 4,
    tracks: [
      {
        id: "vox",
        name: "vox",
        instrument: "vocal",
        takes: [
          {
            name: "t2",
            src: "tracks/vox/samples/a.wav",
            sha256: SHA,
            startTick: 0,
            offset: 0,
            latency: 0,
            inTick: 0,
            outTick: 1920,
          },
        ],
        clips: [
          {
            id: "a",
            src: "tracks/vox/samples/a.wav",
            sha256: SHA,
            startTick: 0,
            dur: 1,
          },
          {
            id: "b",
            src: "tracks/vox/samples/a.wav",
            sha256: SHA,
            startTick: 960,
            dur: 1,
            take: "t2",
            text: "hello",
          },
        ],
      },
    ],
    notes: [
      {
        id: "n1",
        trackId: "vox",
        startTick: 0,
        durationTicks: 480,
        pitch: 60,
        velocity: 0.8,
        lyric: "la",
      },
    ],
  } as never);
}

function paint(snapshot: TrackScoreSnapshot): string[] {
  const buffer = new CellBuffer(60, 30, theme.roles.canvas);
  paintHighway(buffer, { x: 0, y: 0, width: 60, height: 30 }, snapshot, 0, {
    theme,
    capabilities: CAPS,
    lookaheadBeats: 8,
  });
  const rows: string[] = [];
  for (let y = 0; y < 30; y += 1) {
    let text = "";
    for (let x = 0; x < 60; x += 1) text += buffer.get(x, y)?.ch ?? " ";
    rows.push(text);
  }
  return rows;
}

afterEach(() => clearClipPeaks());

describe("highway clip row", () => {
  test("clips land on the tempo map; a clip starting at another's end is a seam", () => {
    const clips = clipSnapshots(score(), "vox")!;
    expect(clips.map((c) => c.id)).toEqual(["a", "b"]);
    // 120 bpm: 1 s is 2 beats; b starts at tick 960 (beat 2) = a's end.
    expect(clips[0]!.startBeat).toBe(0);
    expect(clips[0]!.durationBeats).toBeCloseTo(2, 6);
    expect(clips[1]!.startBeat).toBe(2);
    expect(clips[1]!.seam).toBe(true);
    expect(clips[0]!.seam).toBeUndefined();
    expect(clipSnapshots(score(), "nope")).toBeUndefined();
  });

  test("peaks load from the file and follow the clip window", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-cliprow-"));
    try {
      await mkdir(join(dir, "tracks/vox/samples"), { recursive: true });
      // 2 s ramp: quiet first second, loud second second.
      const rate = 8000;
      const data = new Int16Array(rate * 2);
      for (let i = 0; i < data.length; i += 1)
        data[i] = Math.round(
          Math.sin(i * 0.3) * (i < rate ? 0.1 : 0.9) * 32767,
        );
      await writeFile(
        join(dir, "tracks/vox/samples/a.wav"),
        encodeWav(data, rate),
      );
      const value = score();
      expect(await loadClipPeaks(dir, value.tracks[0])).toBe(true);
      expect(await loadClipPeaks(dir, value.tracks[0])).toBe(false);
      const [a] = clipSnapshots(value, "vox")!;
      const peaks = a!.peaks!;
      expect(peaks.length).toBeGreaterThan(10);
      expect(Math.max(...peaks)).toBeLessThan(0.2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("paints clip blocks, labels, seams and note lyrics", () => {
    const rows = paint({
      notes: [{ startBeat: 1, durationBeats: 1, pitch: 60, lyric: "la" }],
      clips: clipSnapshots(score(), "vox"),
      loopBeats: 16,
      playing: false,
    });
    const text = rows.join("\n");
    expect(rows.some((row) => /[░▒▓█▏]$/.test(row))).toBe(true);
    expect(text).toContain("b t2 · hello");
    expect(rows.some((row) => row.endsWith("┄"))).toBe(true);
    expect(text).toContain("la");
  });
});
