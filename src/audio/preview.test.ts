import { describe, expect, test } from "bun:test";
import { createScore, type TrackScore } from "../../core/score.ts";
import {
  analyzePcm,
  levelOf,
  defaultPhrase,
  describeSound,
  meterBar,
  phraseRole,
  previewRegion,
  previewScore,
  sliceLane,
} from "./preview.ts";
import { renderScorePcm } from "./wav.ts";

const RATE = 8_000;
const BAR = 1_920;

function song(bars: number, notesAt: number[] = [0, 960]): TrackScore {
  return createScore({
    tempoBpm: 120,
    bars,
    tracks: [
      {
        id: "lead",
        name: "lead",
        instrument: "saw",
        pan: 0.3,
        delay: { beats: 0.5, feedback: 0.3, mix: 0.3 },
        reverb: { mix: 0.3, size: 0.5 },
        filterAutomation: [
          { tick: 0, value: 400 },
          { tick: bars * BAR - 1, value: 4_000 },
        ],
      },
      { id: "bass", name: "bass", instrument: "sine" },
      { id: "kit", name: "kit", instrument: "kit" },
    ],
    notes: [
      ...notesAt.map((startTick, i) => ({
        id: `l${i}`,
        trackId: "lead",
        pitch: 64 + i,
        startTick,
        durationTicks: 480,
        velocity: 0.8,
      })),
      {
        id: "b0",
        trackId: "bass",
        pitch: 40,
        startTick: 0,
        durationTicks: 960,
        velocity: 0.8,
      },
      {
        id: "k0",
        trackId: "kit",
        pitch: 36,
        startTick: 480,
        durationTicks: 120,
        velocity: 1,
      },
    ],
  } as never);
}

describe("loop source", () => {
  test("a short song loops whole; a long one loops 2 bars at the playhead", () => {
    expect(previewRegion(song(4), "lead", 9)).toEqual({ startBar: 0, bars: 4 });
    const long = song(16, [BAR * 6, BAR * 7]);
    // Beat 24 is bar 6, where the lead plays.
    expect(previewRegion(long, "lead", 24)).toEqual({ startBar: 6, bars: 2 });
    // At bar 0 the lead is silent: the region jumps to its first note.
    expect(previewRegion(long, "lead", 0)).toEqual({ startBar: 6, bars: 2 });
    // Past the end clamps to the last two bars.
    expect(previewRegion(song(16, [BAR * 14]), "lead", 999)).toEqual({
      startBar: 14,
      bars: 2,
    });
  });

  test("solo keeps the track only; context keeps the mix; mute is lifted", () => {
    const score = song(2);
    const muted = score.withTracks(
      score.tracks.map((track) =>
        track.id === "lead" ? { ...track, muted: true } : track,
      ),
    );
    const solo = previewScore(muted, "lead")!;
    expect(solo.source).toBe("notes");
    expect(solo.score.tracks.map((track) => track.id)).toEqual(["lead"]);
    expect(solo.score.tracks[0]!.muted).toBe(false);
    expect(solo.score.notes.every((note) => note.trackId === "lead")).toBe(
      true,
    );
    const context = previewScore(muted, "lead", { context: true })!;
    expect(context.score.tracks.map((track) => track.id)).toEqual([
      "lead",
      "bass",
      "kit",
    ]);
    expect(context.score.notes).toHaveLength(score.notes.length);
    expect(previewScore(score, "nope")).toBeUndefined();
  });

  test("a region starts at tick 0 and keeps the lane value at its start", () => {
    const long = song(8, [BAR * 4, BAR * 5]);
    const preview = previewScore(long, "lead", { beat: 16 })!;
    expect(preview.region).toEqual({ startBar: 4, bars: 2 });
    expect(preview.score.bars).toBe(2);
    expect(preview.score.notes.map((note) => note.startTick)).toEqual([0, BAR]);
    const lane = preview.score.tracks[0]!.filterAutomation!;
    expect(lane[0]!.tick).toBe(0);
    expect(lane[0]!.value).toBeGreaterThan(400);
    expect(
      sliceLane(
        [
          { tick: 0, value: 0 },
          { tick: 100, value: 1 },
        ],
        50,
        200,
      ),
    ).toEqual([
      { tick: 0, value: 0.5 },
      { tick: 50, value: 1 },
    ]);
  });
});

describe("default phrase", () => {
  const empty = createScore({
    tempoBpm: 120,
    bars: 2,
    key: "A minor",
    tracks: [
      { id: "pad", name: "pad", instrument: "triangle" },
      { id: "bass", name: "bass", instrument: "sine" },
      { id: "lead", name: "lead", instrument: "square" },
      { id: "kit", name: "kit", instrument: "kit" },
      {
        id: "wt",
        name: "wt",
        instrument: "wavetable",
        wavetable: { table: { src: "builtin:pwm" } },
      },
    ],
  } as never);
  const track = (id: string) => empty.tracks.find((t) => t.id === id)!;

  test("roles follow the instrument", () => {
    expect(phraseRole(track("pad"))).toBe("chord");
    expect(phraseRole(track("bass"))).toBe("riff");
    expect(phraseRole(track("lead"))).toBe("lead");
    expect(phraseRole(track("kit"))).toBe("groove");
    expect(phraseRole(track("wt"))).toBe("drone");
  });

  test("a chord stacks notes, a riff and lead move, a groove hits a kick, a drone holds", () => {
    const starts = (id: string) =>
      defaultPhrase(empty, track(id), 2).map((note) => note.startTick);
    const chord = defaultPhrase(empty, track("pad"), 2);
    expect(chord.filter((note) => note.startTick === 0).length).toBeGreaterThan(
      2,
    );
    expect(new Set(starts("bass")).size).toBeGreaterThan(3);
    expect(new Set(starts("lead")).size).toBeGreaterThan(3);
    const groove = defaultPhrase(empty, track("kit"), 2);
    expect(groove.some((note) => note.pitch === 36)).toBe(true);
    const drone = defaultPhrase(empty, track("wt"), 2);
    expect(drone).toHaveLength(1);
    expect(drone[0]!.durationTicks).toBeGreaterThanOrEqual(2 * BAR - 480);
    // In the song's key: A minor's tonic is A.
    expect(drone[0]!.pitch % 12).toBe(9);
    // Every phrase fits the loop.
    for (const id of ["pad", "bass", "lead", "kit", "wt"])
      for (const note of defaultPhrase(empty, track(id), 2))
        expect(note.startTick).toBeLessThan(2 * BAR);
  });

  test("an empty track previews its phrase", () => {
    const preview = previewScore(empty, "wt")!;
    expect(preview.source).toBe("phrase");
    expect(preview.role).toBe("drone");
    expect(preview.score.notes).toHaveLength(1);
  });
});

describe("render parity", () => {
  test("in context, a short song's preview renders byte-identical to the song", () => {
    const score = song(2);
    const full = renderScorePcm(score, { sampleRate: RATE, loop: true });
    const preview = previewScore(score, "lead", { context: true })!;
    const heard = renderScorePcm(preview.score, {
      sampleRate: RATE,
      loop: true,
    });
    expect(heard.frames).toBe(full.frames);
    expect(heard.pcm).toEqual(full.pcm);
    expect(full.pcm.some((v) => v !== 0)).toBe(true);
  });

  test("solo renders byte-identical to the song with only that track", () => {
    const score = song(2);
    const alone = createScore({
      ...score.toJSON(),
      tracks: score.tracks.filter((track) => track.id === "lead"),
      notes: score.notes.filter((note) => note.trackId === "lead"),
    } as never);
    const expected = renderScorePcm(alone, { sampleRate: RATE, loop: true });
    const heard = renderScorePcm(previewScore(score, "lead")!.score, {
      sampleRate: RATE,
      loop: true,
    });
    expect(heard.pcm).toEqual(expected.pcm);
  });

  test("a region renders byte-identical to the same bars of the full render", () => {
    // The lead plays only in bars 4-5, so nothing earlier rings into them.
    const score = song(8, [BAR * 4, BAR * 4 + 960, BAR * 5]);
    const alone = createScore({
      ...score.toJSON(),
      tracks: score.tracks.filter((track) => track.id === "lead"),
      notes: score.notes.filter((note) => note.trackId === "lead"),
    } as never);
    const full = renderScorePcm(alone, { sampleRate: RATE });
    const preview = previewScore(score, "lead", { beat: 16 })!;
    expect(preview.region).toEqual({ startBar: 4, bars: 2 });
    const heard = renderScorePcm(preview.score, { sampleRate: RATE });
    const barFrames = RATE * 2; // 4 beats at 120 BPM
    // An unlooped render runs on into the tail; bars 6-7 are silent for
    // the lead, so its tail lines up with the full render's too.
    expect(heard.frames).toBeGreaterThanOrEqual(2 * barFrames);
    const frames = Math.min(heard.frames, full.frames - 4 * barFrames);
    const slice = full.pcm.subarray(
      4 * barFrames * 2,
      (4 * barFrames + frames) * 2,
    );
    expect(heard.pcm.subarray(0, frames * 2)).toEqual(slice);
  });
});

describe("analysis", () => {
  test("silence, a full-scale sine and brightness", () => {
    const silent = analyzePcm(new Int16Array(2_000), RATE);
    expect(silent.peakDb).toBeLessThan(-100);
    expect(silent.centroidHz).toBe(0);
    const tone = (hz: number, amp: number) => {
      const pcm = new Int16Array(RATE * 2);
      for (let i = 0; i < RATE; i += 1) {
        const v = Math.round(
          amp * 32_767 * Math.sin((2 * Math.PI * hz * i) / RATE),
        );
        pcm[i * 2] = v;
        pcm[i * 2 + 1] = v;
      }
      return pcm;
    };
    const low = analyzePcm(tone(200, 1), RATE);
    expect(low.peakDb).toBeCloseTo(0, 1);
    expect(low.rmsDb).toBeCloseTo(-3, 0);
    expect(low.clipped).toBeGreaterThan(0);
    const high = analyzePcm(tone(2_000, 0.25), RATE);
    expect(high.peakDb).toBeCloseTo(-12, 0);
    expect(high.centroidHz).toBeGreaterThan(low.centroidHz * 4);
    expect(describeSound(low)).toContain("dBFS");
  });

  test("the meter fills with level and marks a clip", () => {
    expect(meterBar(-60, 8)).not.toContain("█");
    expect(meterBar(0, 8, true)).toContain("!");
    expect([...meterBar(-6, 8)].length).toBe(8);
  });
});

describe("levelOf", () => {
  test("matches analyzePcm's level fields without the spectrum", () => {
    const pcm = new Int16Array(4_000);
    for (let i = 0; i < pcm.length; i += 1)
      pcm[i] = Math.round(16_000 * Math.sin(i / 7));
    pcm[10] = 32767;
    const full = analyzePcm(pcm, RATE);
    expect(levelOf(pcm)).toEqual({
      rmsDb: full.rmsDb,
      peakDb: full.peakDb,
      clipped: 1,
    });
  });
});
