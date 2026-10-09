import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScore, TrackScore, updateTrack } from "../../core/score.ts";
import { printProject } from "../../core/sdk/print.ts";
import { renderArrangedPcm } from "../audio/arrange.ts";
import { resampleScore, scoreSha256 } from "../audio/resample.ts";
import { SampleLibrary } from "../audio/samples.ts";
import { parseResampleCommand, runResample } from "./resample.ts";

const dirs: string[] = [];
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dawg-resample-"));
  dirs.push(dir);
  return dir;
}

function song(): TrackScore {
  return createScore({
    tempoBpm: 120,
    bars: 2,
    tracks: [
      { id: "lead", name: "lead", instrument: "saw", volume: 0.8 },
      { id: "keys", name: "keys", instrument: "piano" },
    ],
    notes: [
      {
        id: "a",
        trackId: "lead",
        pitch: 57,
        velocity: 0.8,
        startTick: 0,
        durationTicks: 480,
      },
      {
        id: "b",
        trackId: "lead",
        pitch: 64,
        velocity: 0.7,
        startTick: 960,
        durationTicks: 720,
      },
      {
        id: "c",
        trackId: "keys",
        pitch: 48,
        velocity: 0.9,
        startTick: 0,
        durationTicks: 1920,
      },
    ],
    sections: [{ name: "verse", startBar: 1, bars: 1 }],
  });
}

function stem(
  score: TrackScore,
  trackId: string,
  samples?: unknown,
): Int16Array {
  const played = resampleScore(score, {
    source: { kind: "track", trackId },
    range: { kind: "song" },
  }).score;
  return renderArrangedPcm(played, {
    loop: false,
    ...(samples ? { samples: samples as never } : {}),
  }).pcm;
}

describe("parseResampleCommand", () => {
  test("sources, ranges and options", () => {
    expect(parseResampleCommand("resample lead")).toEqual({
      source: { kind: "track", trackId: "lead" },
      range: { kind: "song" },
      grain: false,
    });
    expect(parseResampleCommand("/resample orbit 2 bars 3-4 grain")).toEqual({
      source: { kind: "orbit", orbit: 2 },
      range: { kind: "bars", from: 3, to: 4 },
      grain: true,
    });
    expect(
      parseResampleCommand("resample master section chorus 2 as bed"),
    ).toEqual({
      source: { kind: "master" },
      range: { kind: "section", name: "chorus 2" },
      grain: false,
      as: "bed",
    });
    expect(parseResampleCommand("resample lead post")?.post).toBe(true);
    expect(parseResampleCommand("resample")).toBeUndefined();
    expect(parseResampleCommand("resample lead bars x")).toBeUndefined();
    expect(parseResampleCommand("resampler lead")).toBeUndefined();
  });
});

describe("runResample", () => {
  test("the file's sha256 is stable across runs and recorded with provenance", async () => {
    const score = song();
    const command = parseResampleCommand("resample lead")!;
    const one = await project();
    const two = await project();
    const a = await runResample({ projectRoot: one, score, command });
    const b = await runResample({ projectRoot: two, score, command });
    if (!a.ok || !b.ok) throw new Error("resample failed");
    expect(a.sha256).toBe(b.sha256);
    const bytes = await readFile(join(one, a.src));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(a.sha256);
    expect(a.src).toBe("tracks/lead-rs/samples/lead.wav");
    const voice = Object.values(
      a.next.tracks.find((t) => t.id === "lead-rs")!.sampler!.voices,
    )[0]!;
    expect(voice.sha256).toBe(a.sha256);
    expect(voice.from).toEqual({
      source: "track:lead",
      score: scoreSha256(score),
    });
    // The source is untouched; the new track has one note.
    expect(a.next.tracks.find((t) => t.id === "lead")).toEqual(
      score.tracks.find((t) => t.id === "lead")!,
    );
    expect(a.next.notes.filter((n) => n.trackId === "lead-rs")).toHaveLength(1);
  });

  test("the resampled sampler track renders within -60 dB of the source stem", async () => {
    const score = song();
    const dir = await project();
    const result = await runResample({
      projectRoot: dir,
      score,
      command: parseResampleCommand("resample lead")!,
    });
    if (!result.ok) throw new Error(result.message);
    const bank = await new SampleLibrary({ projectRoot: dir }).load(
      result.next,
    );
    expect(bank.problems.filter((p) => p.level === "error")).toEqual([]);
    const source = stem(score, "lead");
    const copy = stem(result.next, result.trackId, bank);
    let peak = 0;
    let error = 0;
    for (let i = 0; i < source.length; i += 1) {
      peak = Math.max(peak, Math.abs(source[i]!));
      error = Math.max(error, Math.abs(source[i]! - (copy[i] ?? 0)));
    }
    expect(peak).toBeGreaterThan(1000);
    expect(20 * Math.log10(error / peak)).toBeLessThan(-60);
  });

  test("a panned source keeps its stereo image within -60 dB", async () => {
    const base = song();
    const score = new TrackScore({
      ...base.toJSON(),
      tracks: base.tracks.map((t) =>
        t.id === "lead" ? { ...t, pan: -0.8 } : t,
      ),
    } as never);
    const dir = await project();
    const result = await runResample({
      projectRoot: dir,
      score,
      command: parseResampleCommand("resample lead")!,
    });
    if (!result.ok) throw new Error(result.message);
    const bank = await new SampleLibrary({ projectRoot: dir }).load(
      result.next,
    );
    const source = stem(score, "lead");
    const copy = stem(result.next, result.trackId, bank);
    const peaks = [0, 0];
    let peak = 0;
    let error = 0;
    for (let i = 0; i < source.length; i += 1) {
      peaks[i % 2] = Math.max(peaks[i % 2]!, Math.abs(copy[i] ?? 0));
      peak = Math.max(peak, Math.abs(source[i]!));
      error = Math.max(error, Math.abs(source[i]! - (copy[i] ?? 0)));
    }
    // Left well over right, as the source.
    expect(peaks[0]! / peaks[1]!).toBeGreaterThan(4);
    expect(20 * Math.log10(error / peak)).toBeLessThan(-60);
  });

  test("a note held across the range start renders as in the song", async () => {
    const score = createScore({
      tempoBpm: 120,
      bars: 6,
      tracks: [{ id: "pad", name: "pad", instrument: "saw", volume: 0.8 }],
      notes: [
        {
          id: "d",
          trackId: "pad",
          pitch: 52,
          velocity: 0.8,
          startTick: 1920,
          durationTicks: 1920 * 5,
        },
      ],
    });
    const dir = await project();
    const result = await runResample({
      projectRoot: dir,
      score,
      command: parseResampleCommand("resample pad bars 5-6")!,
    });
    if (!result.ok) throw new Error(result.message);
    const bank = await new SampleLibrary({ projectRoot: dir }).load(
      result.next,
    );
    const source = stem(score, "pad");
    const copy = stem(result.next, result.trackId, bank);
    // Bar 5 starts 8 s in at 120 BPM; the sampler's 1 ms anti-click fade-in
    // is the only difference at the cut, so compare from 2 ms on.
    const from = Math.round(8.002 * 22_050) * 2;
    const to = Math.min(source.length, copy.length, 12 * 22_050 * 2);
    let peak = 0;
    let error = 0;
    for (let i = from; i < to; i += 1) {
      peak = Math.max(peak, Math.abs(source[i]!));
      error = Math.max(error, Math.abs(source[i]! - copy[i]!));
    }
    expect(peak).toBeGreaterThan(1000);
    expect(20 * Math.log10(error / peak)).toBeLessThan(-60);
  });

  test("section and bars ranges place the note and record the range", async () => {
    const score = song();
    const dir = await project();
    const result = await runResample({
      projectRoot: dir,
      score,
      command: parseResampleCommand("resample keys section verse grain")!,
    });
    if (!result.ok) throw new Error(result.message);
    const track = result.next.tracks.find((t) => t.id === "keys-grain")!;
    expect(track.instrument).toBe("granular");
    const src = track.granular!.src as { from?: unknown; sha256?: string };
    expect(src.sha256).toBe(result.sha256);
    expect(src.from).toMatchObject({ source: "track:keys", section: "verse" });
    const note = result.next.notes.find((n) => n.trackId === "keys-grain")!;
    expect(note.startTick).toBe(1920);
    expect(note.durationTicks).toBe(1920);
    expect(note.pitch).toBe(60);
    const bars = await runResample({
      projectRoot: dir,
      score,
      command: parseResampleCommand("resample orbit 1 bars 2-2")!,
    });
    if (!bars.ok) throw new Error(bars.message);
    const ref = Object.values(
      bars.next.tracks.find((t) => t.id === bars.trackId)!.sampler!.voices,
    )[0]!;
    expect(ref.from?.bars).toEqual([2, 2]);
    // Printed and re-read, the provenance survives.
    const files = printProject(bars.next);
    expect(JSON.stringify(files)).toContain("orbit:1");
  });

  test("errors are receipts", async () => {
    const dir = await project();
    const missing = await runResample({
      projectRoot: dir,
      score: song(),
      command: parseResampleCommand("resample nope")!,
    });
    expect(missing.ok).toBe(false);
    const bars = await runResample({
      projectRoot: dir,
      score: song(),
      command: parseResampleCommand("resample lead bars 2-9")!,
    });
    expect(bars.ok).toBe(false);
  });
});

describe("resample grain", () => {
  /** Strongest frequency of the left channel over [from, from + n). */
  function peak(pcm: Int16Array, sr: number, from: number, n: number) {
    const goertzel = (hz: number): number => {
      const c = 2 * Math.cos((2 * Math.PI * hz) / sr);
      let s1 = 0;
      let s2 = 0;
      for (let i = 0; i < n; i += 1) {
        const s0 = (pcm[(from + i) * 2] ?? 0) + c * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      return s1 * s1 + s2 * s2 - c * s1 * s2;
    };
    let best = 0;
    let bestP = -1;
    for (let hz = 200; hz <= 240; hz += 0.02) {
      const p = goertzel(hz);
      if (p > bestP) {
        bestP = p;
        best = hz;
      }
    }
    return best;
  }

  test("the granular track plays the source at its pitch within 1 cent", async () => {
    const score = createScore({
      tempoBpm: 120,
      bars: 2,
      tracks: [{ id: "lead", name: "lead", instrument: "sine" }],
      notes: [
        {
          id: "a",
          trackId: "lead",
          pitch: 57,
          velocity: 0.8,
          startTick: 0,
          durationTicks: 3840,
        },
      ],
    });
    const dir = await project();
    const result = await runResample({
      projectRoot: dir,
      score,
      command: parseResampleCommand("resample lead grain")!,
    });
    if (!result.ok) throw new Error(result.message);
    const track = result.next.tracks.find((t) => t.id === result.trackId)!;
    expect(track.instrument).toBe("granular");
    expect(track.granular?.preset).toBe("cloud");
    const render = async (extra: Record<string, unknown>) => {
      const next = updateTrack(result.next, result.trackId, {
        granular: { ...track.granular!, ...extra },
      } as never);
      const bank = await new SampleLibrary({ projectRoot: dir }).load(next);
      const played = resampleScore(next, {
        source: { kind: "track", trackId: result.trackId },
        range: { kind: "song" },
      }).score;
      return renderArrangedPcm(played, { loop: false, samples: bank as never });
    };
    // Spec 9 test 5's configuration: a phase-continuous overlap-1 Tukey
    // stream (a dense cloud has no single stable spectral peak).
    const coherent = await render({
      grain: 0.1,
      overlap: 1,
      jitter: 0,
      spray: 0,
      scan: 1,
      window: "tukey",
      spread: 0,
    });
    const sr = coherent.sampleRate;
    const hz = peak(coherent.pcm, sr, sr, sr * 2);
    expect(Math.abs(1200 * Math.log2(hz / 220))).toBeLessThan(1);
    // The default cloud stays centred on the source (grain scatter smears it).
    const cloud = await render({});
    const smeared = peak(cloud.pcm, sr, sr, sr * 2);
    expect(Math.abs(1200 * Math.log2(smeared / 220))).toBeLessThan(25);
  });
});
