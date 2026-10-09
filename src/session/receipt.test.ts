import { describe, expect, test } from "bun:test";
import {
  addNote,
  createScore,
  updateTrack,
  type TrackScore,
} from "../../core/score.ts";
import { musicalReceipt } from "./receipt.ts";

function base(): TrackScore {
  return createScore({
    tempoBpm: 120,
    tracks: [
      { id: "bass", name: "bass", instrument: "bass" },
      { id: "drums", name: "drums", instrument: "kit" },
    ],
  });
}

describe("musical receipt", () => {
  test("tempo, notes with pitches and reverb in one line", () => {
    const before = base();
    let after = before.withTempo(96);
    after = addNote(after, {
      id: "n1",
      trackId: "bass",
      startTick: 0,
      durationTicks: 480,
      pitch: 60,
      velocity: 0.8,
    });
    after = addNote(after, {
      id: "n2",
      trackId: "bass",
      startTick: 480,
      durationTicks: 480,
      pitch: 64,
      velocity: 0.8,
    });
    after = updateTrack(after, "bass", { reverb: { mix: 0.4, size: 0.5 } });
    expect(musicalReceipt(before, after)).toBe(
      "96 BPM · +2 notes on bass (C4 E4) · bass reverb 0.4",
    );
  });

  test("drum notes are named by voice", () => {
    const before = base();
    const after = addNote(before, {
      id: "k",
      trackId: "drums",
      startTick: 0,
      durationTicks: 120,
      pitch: 36,
      velocity: 0.8,
    });
    expect(musicalReceipt(before, after)).toMatch(
      /^\+1 note on drums \(\w+\)$/,
    );
  });

  test("no change is empty, a single track omits its name", () => {
    const one = createScore({
      tracks: [{ id: "lead", name: "lead", instrument: "piano" }],
    });
    expect(musicalReceipt(one, one)).toBe("");
    const after = updateTrack(one, "lead", { volume: 0.5 });
    expect(musicalReceipt(one, after)).toBe("volume 0.5");
  });

  test("many parts collapse to +N more", () => {
    const before = base();
    let after = before.withTempo(100).withKey("A minor").withBars(8);
    after = updateTrack(after, "bass", { volume: 0.3 });
    after = updateTrack(after, "drums", { pan: -0.5 });
    after = addNote(after, {
      id: "n",
      trackId: "bass",
      startTick: 0,
      durationTicks: 480,
      pitch: 45,
      velocity: 0.8,
    });
    const text = musicalReceipt(before, after);
    expect(text.split(" · ")).toHaveLength(5);
    expect(text).toEndWith("+2 more");
  });
});
