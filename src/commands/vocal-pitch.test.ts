import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
  setDefaultTimeout,
} from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScore, TrackScore } from "../../core/score.ts";
import { secondsAtTick } from "../../core/tempo.ts";
import { clearAnalysisMemory } from "../audio/analysis.ts";
import { melody, synthVoice } from "../audio/fixtures/voice.ts";
import { wavBytes } from "../audio/sample-fixtures.ts";
import {
  analyzeTrackPitch,
  clearPitchSummaries,
  pitchSummary,
  pitchTraceFor,
  pitchTracePoints,
  MAX_TRACE_POINTS,
  hzName,
  keyOfNotes,
  parsePitchArgs,
  pitchReportLines,
} from "./vocal-pitch.ts";
import { parseVocalCommand, runVocalCommand } from "./vocal.ts";

// Analysis tests run whole voices; shared CI runners need more than 5 s.
setDefaultTimeout(30_000);

const SR = 48_000;
const song = melody(60);
let root = "";
let sha = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "dawg-vocal-pitch-"));
  const v = synthVoice(song, { sr: SR, seed: 5 });
  const bytes = wavBytes(
    Float32Array.from(v.x, (x) => x * 0.7),
    {
      sampleRate: SR,
      encoding: "float32",
    },
  );
  sha = createHash("sha256").update(bytes).digest("hex");
  await mkdir(join(root, "tracks", "vox", "samples"), { recursive: true });
  await writeFile(join(root, "tracks", "vox", "samples", "lead.wav"), bytes);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function clipScore(): TrackScore {
  return createScore({
    bars: 8,
    tracks: [
      {
        id: "vox",
        instrument: "sine",
        clips: [
          {
            id: "lead",
            src: "tracks/vox/samples/lead.wav",
            sha256: sha,
            startTick: 1920,
          },
        ],
      },
    ],
  } as never);
}

const run = (score: TrackScore, line: string) =>
  runVocalCommand(parseVocalCommand(line)!, {
    score,
    trackId: "vox",
    cwd: root,
  });

describe("/vocal pitch", () => {
  test("parses targets, voice ranges and as", () => {
    expect(parsePitchArgs("")).toEqual({});
    expect(parsePitchArgs("lead soprano as guide")).toEqual({
      target: "lead",
      voice: "soprano",
      as: "guide",
    });
    expect(parsePitchArgs("voice tenor")).toEqual({ voice: "tenor" });
    expect(parsePitchArgs("Voice Tenor")).toEqual({ voice: "tenor" });
    expect(parsePitchArgs("voice")).toEqual({ kind: "voice" });
    expect(parsePitchArgs("Voice")).toEqual({ kind: "voice" });
    expect(parsePitchArgs("voice stem")).toEqual({
      kind: "voice",
      target: "stem",
    });
    expect(parsePitchArgs("clip lead BASS")).toEqual({
      kind: "clip",
      target: "lead",
      voice: "bass",
    });
    expect(parsePitchArgs("range kazoo")).toContain("range is one of");
    expect(parsePitchArgs("lead kazoo")).toContain(
      "usage: [clip|voice] [<name>] [auto|bass|tenor|alto|soprano]",
    );
    expect(hzName(440)).toBe("A4");
    expect(hzName(440 * 2 ** (12 / 1200))).toBe("A4 +12c");
  });

  test("reports key, median and range of the focused clip", async () => {
    clearAnalysisMemory();
    const report = await analyzeTrackPitch(clipScore(), "vox", root);
    expect(report.target.label).toBe("clip lead");
    expect(report.key).toBe("c major");
    // the melody spans C4..A4, sung up to 44 c off
    expect(report.low).toBeGreaterThan(250);
    expect(report.high).toBeLessThan(460);
    expect(report.notes.map((n) => n.midi).slice(0, 4)).toEqual([
      60, 62, 64, 67,
    ]);
    const lines = pitchReportLines(report);
    expect(lines[0]).toStartWith("vox · clip lead");
    expect(lines[1]).toBe("key · c major");
    // the curve went to the project's analysis cache
    expect((await readdir(join(root, ".dawg", "analysis"))).length).toBe(1);
    const result = await run(clipScore(), "/vocal pitch");
    expect(result.ok).toBe(true);
    expect(result.next).toBeUndefined();
    expect(result.message).toContain("key · c major");
  });

  test("cold and warm caches give the same report", async () => {
    clearAnalysisMemory();
    await rm(join(root, ".dawg", "analysis"), { recursive: true, force: true });
    const cold = await analyzeTrackPitch(clipScore(), "vox", root);
    clearAnalysisMemory();
    const disk = await analyzeTrackPitch(clipScore(), "vox", root);
    const memory = await analyzeTrackPitch(clipScore(), "vox", root);
    for (const warm of [disk, memory]) {
      expect(Buffer.from(warm.curve.f0.buffer)).toEqual(
        Buffer.from(cold.curve.f0.buffer),
      );
      expect(pitchReportLines(warm)).toEqual(pitchReportLines(cold));
    }
  }, 30_000);

  test("/vocal notes adds a guide track placed through the tempo map", async () => {
    const score = clipScore();
    const result = await run(score, "/vocal notes");
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("pitch.notes");
    const next = result.next!;
    expect(next.tracks.map((t) => t.id)).toEqual(["vox", "vox-notes"]);
    const notes = next.notes.filter((n) => n.trackId === "vox-notes");
    // every sung note in order; the only extras are the short tails of the
    // two sung falls (250 and 400 cents), a semitone under their note
    const clipStart = secondsAtTick(score, 1920);
    let k = 0;
    for (const note of notes) {
      const at = secondsAtTick(next, note.startTick) - clipStart;
      const sung = song[k];
      if (
        sung &&
        note.pitch === sung.midi &&
        Math.abs(at - sung.start) < 0.08
      ) {
        k += 1;
        continue;
      }
      const before = song[k - 1]!;
      expect(before.fall).toBeGreaterThan(0);
      expect(note.pitch).toBe(before.midi - 1);
      expect(
        secondsAtTick(next, note.startTick + note.durationTicks) -
          clipStart -
          at,
      ).toBeLessThan(0.3);
    }
    expect(k).toBe(song.length);
    // a second run picks a free id
    const again = await run(next, "/vocal notes");
    expect(again.next!.tracks.at(-1)!.id).toBe("vox-notes-2");
  });

  test("guide notes land where renderClips plays the clip (track time, take nudge, reverse)", async () => {
    const base = clipScore().toJSON() as never as {
      tracks: Record<string, unknown>[];
    };
    const take = {
      name: "t1",
      src: "tracks/vox/samples/lead.wav",
      sha256: sha,
      startTick: 1920,
      offset: 0,
      latency: 0,
      nudge: 100,
      inTick: 0,
      outTick: 1920,
    };
    const track = base.tracks[0]!;
    const clip = (track.clips as Record<string, unknown>[])[0]!;
    const score = createScore({
      ...base,
      tracks: [
        {
          ...track,
          time: { rate: 2 },
          takes: [take],
          clips: [{ ...clip, take: "t1" }],
        },
      ],
    } as never);
    const result = await run(score, "/vocal notes");
    const notes = result.next!.notes.filter((n) => n.trackId === "vox-notes");
    // rate 2 plays the clip at song tick 960; the take nudges it 100 ms late
    const start = secondsAtTick(score, 960) + 0.1;
    const first = notes[0]!;
    expect(first.pitch).toBe(song[0]!.midi);
    expect(
      Math.abs(secondsAtTick(score, first.startTick) - start - song[0]!.start),
    ).toBeLessThan(0.08);
    // reversed: the last sung note comes first, and ticks stay ordered
    const reversed = createScore({
      ...base,
      tracks: [{ ...track, clips: [{ ...clip, rev: true }] }],
    } as never);
    const rev = await run(reversed, "/vocal notes");
    const revNotes = rev.next!.notes.filter((n) => n.trackId === "vox-notes");
    const last = song.at(-1)!;
    expect(revNotes.some((n) => n.pitch === last.midi)).toBe(true);
    for (const note of revNotes) expect(note.durationTicks).toBeGreaterThan(0);
    const sorted = [...revNotes].sort((a, b) => a.startTick - b.startTick);
    expect(sorted[0]!.pitch).toBe(last.midi);
  });

  test("a long take's trace covers the whole window within MAX_TRACE_POINTS", async () => {
    const report = await analyzeTrackPitch(clipScore(), "vox", root);
    const frames = Math.round(600 / report.curve.hop);
    const f0 = new Float32Array(frames).fill(261.63);
    const long = {
      ...report,
      curve: { ...report.curve, t0: 0, f0 },
      from: 0,
      to: 600,
    };
    const points = pitchTracePoints(clipScore(), long);
    expect(points.length).toBeLessThanOrEqual(MAX_TRACE_POINTS);
    expect(points.length).toBeGreaterThan(MAX_TRACE_POINTS * 0.9);
    const beatsPerSecond = clipScore().tempoBpm / 60;
    expect(points.at(-1)!.beat).toBeGreaterThan(4 + 599 * beatsPerSecond);
  });

  test("trace on keeps beat-placed points for the highway; off drops them", async () => {
    clearPitchSummaries();
    const score = clipScore();
    const on = await run(score, "/vocal pitch trace on");
    expect(on.ok).toBe(true);
    expect(on.message).toContain("trace · on");
    const points = pitchTraceFor("vox")!;
    expect(points.length).toBeGreaterThan(100);
    // the clip starts at beat 4 (tick 1920); the first note at 0.2 s in
    const beatsPerSecond = score.tempoBpm / 60;
    expect(points[0]!.beat).toBeCloseTo(4 + 0.2 * beatsPerSecond, 0);
    expect(Math.round(points[5]!.pitch)).toBe(60);
    expect(pitchSummary("vox")?.key).toBe("c major");
    // moving the clip or changing tempo re-places the trace
    const moved = new TrackScore({
      ...score.toJSON(),
      tempoBpm: 90,
      tracks: score.tracks.map((t) => ({
        ...t,
        clips: t.clips!.map((c) => ({ ...c, startTick: 3840 })),
      })),
    } as never);
    const replaced = pitchTraceFor("vox", moved)!;
    expect(replaced.length).toBe(points.length);
    expect(replaced[0]!.beat).toBeCloseTo(8 + 0.2 * (90 / 60), 0);
    expect(pitchTraceFor("vox", moved)).toBe(replaced);
    expect(pitchTraceFor("vox", score)![0]!.beat).toBeCloseTo(
      points[0]!.beat,
      6,
    );
    // a plain /vocal pitch keeps the trace on and refreshes it
    await run(score, "/vocal pitch");
    expect(pitchTraceFor("vox")?.length).toBe(points.length);
    const off = await run(score, "/vocal pitch trace off");
    expect(off.ok).toBe(true);
    expect(pitchTraceFor("vox")).toBeUndefined();
    expect(pitchSummary("vox")?.key).toBe("c major");
  });

  test("clear errors without audio or with a wrong target", async () => {
    const empty = createScore({ tracks: [{ id: "vox", instrument: "sine" }] });
    const none = await run(empty, "/vocal pitch");
    expect(none.ok).toBe(false);
    expect(none.message).toContain("no audio clip or sample voice");
    const wrong = await run(clipScore(), "/vocal pitch chorus");
    expect(wrong.ok).toBe(false);
    expect(wrong.message).toContain("try clip lead");
    const cased = await run(clipScore(), "/vocal pitch Clip LEAD");
    expect(cased.ok).toBe(true);
    const noVoice = await run(clipScore(), "/vocal pitch voice");
    expect(noVoice.ok).toBe(false);
    expect(noVoice.message).toContain("has no voice");
  });
});

test("key: a G-major line that dwells on B still reads as G major", () => {
  // The bach-chorale soprano as /vocal notes recovers it: B is the longest
  // pitch class, so the profile alone says b minor.
  const rows: [number, number][] = [
    [67, 0.8],
    [69, 0.8],
    [71, 2.4],
    [69, 0.8],
    [67, 0.8],
    [69, 0.8],
    [71, 2.0],
    [74, 1.2],
    [71, 1.6],
    [69, 0.8],
    [67, 0.8],
  ];
  let t = 0;
  const notes = rows.map(([midi, d]) => {
    const note = { midi, start: t, end: t + d };
    t += d;
    return note as unknown as Parameters<typeof keyOfNotes>[0][number];
  });
  expect(keyOfNotes(notes)).toBe("g major");
});
