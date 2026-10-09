import { describe, expect, test } from "bun:test";
import { createScore, updateTrack, type TrackScore } from "../../core/score.ts";
import { applyEditCommand, parseEditCommand } from "./edit.ts";
import { nearestCommand } from "./help.ts";
import { applyKeysCommand, newPianoTrack, parseKeysCommand } from "./keys.ts";

function song(instrument = "sine"): TrackScore {
  return createScore({
    tracks: [{ id: "p", name: "p", instrument }],
  });
}

function run(score: TrackScore, prompt: string) {
  const command = parseKeysCommand(prompt);
  expect(command).toBeDefined();
  return applyKeysCommand(score, "p", command!);
}

describe("keys command", () => {
  test("piano is a new write of the modelled grand", () => {
    for (const prompt of [
      "piano",
      "instrument piano",
      "sound grand",
      "grand",
    ]) {
      const result = run(song(), prompt);
      expect(result.ok).toBe(true);
      const track = result.next!.tracks[0]!;
      expect(track.instrument).toBe("grand");
      expect(track.keys).toEqual({ preset: "grand" });
    }
  });

  test("organ and other words are not keys commands", () => {
    expect(parseKeysCommand("organ")).toBeUndefined();
    expect(parseKeysCommand("instrument organ")).toBeUndefined();
    expect(parseKeysCommand("instrument saw")).toBeUndefined();
    expect(parseKeysCommand("piano roll")).toBeUndefined();
    expect(parseKeysCommand("keys hardness")).toBeUndefined();
    expect(parseKeysCommand("keys nope 1")).toBeUndefined();
  });

  test("presets bring their effects", () => {
    const lofi = run(song(), "piano lofi").next!.tracks[0]!;
    expect(lofi.instrument).toBe("felt");
    expect(lofi.keys).toEqual({ preset: "lofi" });
    expect(lofi.filter?.cutoff).toBe(3500);
    expect(lofi.fx?.crush).toBeDefined();
    const ballad = run(song(), "piano ballad").next!.tracks[0]!;
    expect(ballad.instrument).toBe("grand");
    expect(ballad.reverb?.mix).toBe(0.25);
  });

  test("switching presets or resetting drops the old preset's effects", () => {
    let score = run(song(), "piano lofi").next!;
    score = run(score, "piano grand").next!;
    let track = score.tracks[0]!;
    expect(track.keys).toEqual({ preset: "grand" });
    expect(track.filter).toBeUndefined();
    expect(track.fx?.crush).toBeUndefined();
    score = run(run(song(), "piano ballad").next!, "keys reset").next!;
    expect(score.tracks[0]!.reverb).toBeUndefined();
    expect(score.tracks[0]!.keys).toEqual({});
    // An effect the user edited after the preset stays.
    score = run(song(), "piano lofi").next!;
    score = updateTrack(score, "p", {
      filter: { cutoff: 900, resonance: 0.1 },
    });
    score = run(score, "piano grand").next!;
    track = score.tracks[0]!;
    expect(track.filter?.cutoff).toBe(900);
    expect(track.fx?.crush).toBeUndefined();
  });

  test("keys on the keys synth names both ways out", () => {
    const result = run(song("keys"), "keys decay 1.5");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("keys synth");
    expect(result.message).toContain("synth decay");
    expect(result.message).toContain("type piano");
  });

  test("bare lofi stays out (drum kit and crush preset); piano lofi works", () => {
    expect(parseKeysCommand("lofi")).toBeUndefined();
    expect(run(song(), "piano lofi").ok).toBe(true);
  });

  test("a new track named piano starts on the modelled grand", () => {
    expect(newPianoTrack("piano")).toMatchObject({
      instrument: "grand",
      keys: { preset: "grand" },
    });
    expect(newPianoTrack("ballad").reverb).toBeDefined();
    expect(newPianoTrack("lofi")).toEqual({});
    expect(newPianoTrack("bass")).toEqual({});
  });

  test("params set, unset and reset", () => {
    let score = run(song(), "upright").next!;
    score = run(score, "keys hardness 0.3 decay 1.5").next!;
    expect(score.tracks[0]!.keys).toEqual({
      hardness: 0.3,
      decay: 1.5,
      preset: "upright",
    });
    score = run(score, "keys hardness off").next!;
    expect(score.tracks[0]!.keys).toEqual({ decay: 1.5, preset: "upright" });
    score = run(score, "keys reset").next!;
    expect(score.tracks[0]!.keys).toEqual({});
    expect(score.tracks[0]!.instrument).toBe("upright");
    expect(run(score, "keys body felt").next!.tracks[0]!.keys).toEqual({
      body: "felt",
    });
  });

  test("keys on a legacy piano track explains instead of rewriting it", () => {
    const legacy = song("piano");
    const result = run(legacy, "keys hardness 0.4");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("type piano first");
    expect(run(legacy, "keys").message).toContain("for the modelled piano");
  });

  test("out-of-range values do not parse", () => {
    expect(parseKeysCommand("keys hardness 4")).toBeUndefined();
    expect(parseKeysCommand("keys body tuba")).toBeUndefined();
  });

  test("keys-<param> lanes parse and store through automate", () => {
    const score = run(song(), "piano").next!;
    const command = parseEditCommand(
      "automate keys-hardness points 0:0.2 4:0.9",
    );
    expect(command).toBeDefined();
    const result = applyEditCommand(score, "p", command!);
    expect(result.ok).toBe(true);
    expect(
      result.next!.tracks[0]!.fxAutomation?.["keys-hardness"],
    ).toHaveLength(2);
    expect(
      parseEditCommand("automate keys-hardness points 0:3"),
    ).toBeUndefined();
  });

  test("piano and keys are registered for typo suggestions", () => {
    expect(nearestCommand("pinao felt")).toBe("piano");
    expect(nearestCommand("kees hardness 0.3")).toBe("keys");
  });
});
