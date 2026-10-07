import { describe, expect, test } from "bun:test";
import { createScore, isTrackAudible } from "../../core/score.ts";
import { applyMusicCommand, parseMusicCommand } from "./music.ts";

const ids = (prefix: string) => (index: number) => `${prefix}${index}`;
const kit = () =>
  createScore({
    bars: 1,
    tracks: [
      { id: "drums", instrument: "kit" },
      { id: "keys", instrument: "piano" },
    ],
  });

describe("music command parser", () => {
  test("parses drum hits and patterns", () => {
    expect(parseMusicCommand("hit kick at 0")).toEqual({
      type: "drum-hits",
      voice: "kick",
      beats: [0],
      velocity: 0.9,
    });
    expect(parseMusicCommand("hit sd 1.5 vel 0.4")).toEqual({
      type: "drum-hits",
      voice: "snare",
      beats: [1.5],
      velocity: 0.4,
    });
    expect(parseMusicCommand("pattern kick 3 0 1 1 2")).toEqual({
      type: "drum-hits",
      voice: "kick",
      beats: [0, 1, 2, 3],
      velocity: 0.9,
    });
    expect(parseMusicCommand("pattern hat every 0.5 from 0.25")).toEqual({
      type: "drum-every",
      voice: "hat",
      step: 0.5,
      from: 0.25,
      velocity: 0.9,
    });
    expect(parseMusicCommand("clear hat")).toEqual({
      type: "drum-clear",
      voice: "hat",
    });
  });

  test("parses effects, filter automation, and solo", () => {
    expect(parseMusicCommand("filter 1200")).toEqual({
      type: "filter",
      cutoff: 1_200,
      resonance: 0,
    });
    expect(parseMusicCommand("lowpass 800 0.5")).toEqual({
      type: "filter",
      cutoff: 800,
      resonance: 0.5,
    });
    expect(parseMusicCommand("filter off")).toEqual({ type: "filter-off" });
    expect(parseMusicCommand("delay 0.375 0.3")).toEqual({
      type: "delay",
      beats: 0.375,
      feedback: 0.3,
      mix: 0.35,
    });
    expect(parseMusicCommand("delay off")).toEqual({ type: "delay-off" });
    expect(parseMusicCommand("automate filter at 0 400")).toEqual({
      type: "effect-automation",
      parameter: "filter",
      beat: 0,
      value: 400,
    });
    expect(parseMusicCommand("clear filter automation")).toEqual({
      type: "effect-automation-clear",
      parameter: "filter",
    });
    expect(parseMusicCommand("automate delay-mix at 2 0.8")).toEqual({
      type: "effect-automation",
      parameter: "delay-mix",
      beat: 2,
      value: 0.8,
    });
    expect(parseMusicCommand("automate delay-feedback at 1 0.6")).toEqual({
      type: "effect-automation",
      parameter: "delay-feedback",
      beat: 1,
      value: 0.6,
    });
    expect(parseMusicCommand("automate res at 0.5 0.9")).toEqual({
      type: "effect-automation",
      parameter: "resonance",
      beat: 0.5,
      value: 0.9,
    });
    expect(parseMusicCommand("clear delay-mix automation")).toEqual({
      type: "effect-automation-clear",
      parameter: "delay-mix",
    });
    expect(parseMusicCommand("reverb 0.4")).toEqual({
      type: "reverb",
      mix: 0.4,
      size: 0.5,
    });
    expect(parseMusicCommand("reverb 0.3 0.9")).toEqual({
      type: "reverb",
      mix: 0.3,
      size: 0.9,
    });
    expect(parseMusicCommand("reverb off")).toEqual({ type: "reverb-off" });
    expect(parseMusicCommand("solo")).toEqual({ type: "solo", solo: true });
    expect(parseMusicCommand("UNSOLO")).toEqual({ type: "solo", solo: false });
  });

  test("rejects out-of-range and unrelated input", () => {
    for (const prompt of [
      "reverb 1.5",
      "reverb 0.5 2",
      "automate delay-feedback at 0 0.95",
      "automate delay-mix at 0 1.5",
      "automate resonance at 0 2",
      "automate wobble at 0 1",
      "clear wobble automation",
      "hit cowbell at 0",
      "hit kick at 0 vel 2",
      "pattern hat every 0.01",
      `pattern kick ${Array.from({ length: 65 }, (_, i) => i).join(" ")}`,
      "filter 5",
      "filter 30000",
      "filter 1000 1.5",
      "delay 8",
      "delay 0.5 0.95",
      "delay 0.5 0.3 2",
      "automate filter at 0 5",
      "clear",
      "clear automation",
      "play",
      "make a beat",
    ])
      expect(parseMusicCommand(prompt)).toBeUndefined();
  });
});

describe("music command reducer", () => {
  test("adds drum hits once per tick on a kit track", () => {
    const one = applyMusicCommand(
      kit(),
      "drums",
      parseMusicCommand("pattern kick 0 1 2 3")!,
      ids("k"),
    );
    expect(one.ok).toBe(true);
    expect(one.message).toBe("+4 kick hits");
    expect(one.kind).toBe("score.drums");
    expect(one.next!.notes.map((note) => note.pitch)).toEqual([36, 36, 36, 36]);
    const again = applyMusicCommand(
      one.next!,
      "drums",
      parseMusicCommand("hit kick at 2")!,
      ids("x"),
    );
    expect(again.next).toBeUndefined();
    // A no-op is a failure the strip must not paint green.
    expect(again.ok).toBe(false);
    expect(again.message).toBe("kick already there");
    const hats = applyMusicCommand(
      one.next!,
      "drums",
      parseMusicCommand("pattern hat every 0.5")!,
      ids("h"),
    );
    expect(hats.next!.notes.filter((note) => note.pitch === 42)).toHaveLength(
      8,
    );
    const cleared = applyMusicCommand(
      hats.next!,
      "drums",
      parseMusicCommand("clear hat")!,
      ids("c"),
    );
    expect(cleared.next!.notes).toHaveLength(4);
  });

  test("drum commands require a kit instrument", () => {
    const result = applyMusicCommand(
      kit(),
      "keys",
      parseMusicCommand("hit kick at 0")!,
      ids("k"),
    );
    expect(result.next).toBeUndefined();
    expect(result.ok).toBe(false);
    expect(result.message).toContain("instrument kit");
  });

  test("sets effects, merges filter automation, and solos", () => {
    let score = kit();
    for (const prompt of [
      "filter 1200 0.2",
      "delay 0.75 0.4 0.5",
      "automate filter at 1 2000",
      "automate filter at 0 400",
      "automate filter at 1 3000",
      "solo",
    ])
      score = applyMusicCommand(
        score,
        "drums",
        parseMusicCommand(prompt)!,
        ids("n"),
      ).next!;
    const track = score.tracks.find((candidate) => candidate.id === "drums")!;
    expect(track.filter).toEqual({ cutoff: 1_200, resonance: 0.2 });
    expect(track.delay).toEqual({ beats: 0.75, feedback: 0.4, mix: 0.5 });
    expect(track.filterAutomation).toEqual([
      { tick: 0, value: 400 },
      { tick: score.ticksPerBeat, value: 3_000 },
    ]);
    expect(isTrackAudible(score, "drums")).toBe(true);
    expect(isTrackAudible(score, "keys")).toBe(false);
    for (const prompt of ["filter off", "delay off", "unsolo"])
      score = applyMusicCommand(
        score,
        "drums",
        parseMusicCommand(prompt)!,
        ids("n"),
      ).next!;
    const reset = score.tracks.find((candidate) => candidate.id === "drums")!;
    expect(reset.filter).toBeUndefined();
    expect(reset.delay).toBeUndefined();
    expect(isTrackAudible(score, "keys")).toBe(true);
  });

  test("sets reverb and the delay and resonance automation lanes", () => {
    let score = createScore({ tracks: [{ id: "keys" }] });
    for (const prompt of [
      "reverb 0.4 0.8",
      "automate delay-mix at 0 0.1",
      "automate delay-mix at 2 0.9",
      "automate delay-feedback at 1 0.7",
      "automate resonance at 0 0.6",
    ]) {
      const result = applyMusicCommand(
        score,
        "keys",
        parseMusicCommand(prompt)!,
        ids("n"),
      );
      expect(result.next).toBeDefined();
      score = result.next!;
    }
    let track = score.tracks[0]!;
    expect(track.reverb).toEqual({ mix: 0.4, size: 0.8 });
    expect(track.delayMixAutomation).toEqual([
      { tick: 0, value: 0.1 },
      { tick: 2 * score.ticksPerBeat, value: 0.9 },
    ]);
    expect(track.delayFeedbackAutomation).toEqual([
      { tick: score.ticksPerBeat, value: 0.7 },
    ]);
    expect(track.resonanceAutomation).toEqual([{ tick: 0, value: 0.6 }]);
    for (const prompt of ["reverb off", "clear delay-mix automation"])
      score = applyMusicCommand(
        score,
        "keys",
        parseMusicCommand(prompt)!,
        ids("n"),
      ).next!;
    track = score.tracks[0]!;
    expect(track.reverb).toBeUndefined();
    expect(track.delayMixAutomation).toBeUndefined();
    // Round-trips through the persisted JSON shape.
    expect(createScore(score.toJSON()).tracks[0]).toEqual(track);
  });
});
