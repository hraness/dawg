import { describe, expect, test } from "bun:test";
import { parseKey, scaleSteps } from "../../../core/chords.ts";
import { INSTRUMENT_WORDS } from "../../../core/instruments.ts";
import { createScore, type TrackScore } from "../../../core/score.ts";
import { STRING_ENGINE } from "./engine.ts";
import { symKeys } from "./body.ts";
import { render, SR } from "./measure.test-helpers.ts";
import { renderScorePcm, StemRenderer } from "../wav.ts";
import { LiveSynth } from "../live.ts";

const pcs = (keys: readonly { key: number }[], root: number) =>
  [...new Set(keys.map((k) => (((k.key - root) % 12) + 12) % 12))].sort(
    (a, b) => a - b,
  );

describe("strings review fixes", () => {
  test("taraf follows the raga's own scale (C bhairav: Ni 11, no 10)", () => {
    const key = parseKey("C bhairav")!;
    const keys = symKeys("scale", 48, scaleSteps(key));
    const classes = pcs(keys, 48);
    expect(classes).toContain(11);
    expect(classes).not.toContain(10);
    expect(classes).toEqual([0, 1, 4, 5, 7, 8, 11]);
    // C major keeps its pre-fix strings exactly.
    const major = symKeys("scale", 48, scaleSteps(parseKey("C major")!));
    expect(major.map((k) => k.key)).toEqual([
      48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67,
    ]);
    expect(major.every((k) => k.cents === 0)).toBe(true);
  });

  test("a maqam key keeps its quarter tone on the sympathetic strings", () => {
    const key = parseKey("D bayati")!;
    const keys = symKeys("scale", 50, scaleSteps(key));
    expect(keys.some((k) => Math.abs(Math.abs(k.cents) - 50) < 1)).toBe(true);
  });

  test("drone: Sa-Pa-Sa, else Ma or Ni when the raga leaves out Pa", () => {
    const sa = 48;
    const drone = (name: string) =>
      symKeys("drone", sa, scaleSteps(parseKey(name)!)).map((k) => k.key);
    expect(drone("C major")).toEqual([36, 43, 48]);
    const marwa = drone("C marwa");
    expect(marwa).not.toContain(43);
    expect(marwa[0]).toBe(36);
    expect(marwa[2]).toBe(48);
  });

  test("a key change re-renders a string stem (no stale sympathetic key)", () => {
    const make = (key: string): TrackScore =>
      createScore({
        bars: 1,
        key,
        tracks: [
          {
            id: "s",
            name: "s",
            instrument: "string",
            string: { preset: "sitar", sym: 1 },
          },
        ],
        notes: [
          {
            id: "n",
            trackId: "s",
            pitch: 62,
            velocity: 0.8,
            startTick: 0,
            durationTicks: 480,
          },
        ],
      } as never);
    const renderer = new StemRenderer();
    const first = renderer.render(make("C major"), { sampleRate: SR }).pcm;
    const second = renderer.render(make("F# minor"), { sampleRate: SR }).pcm;
    const fresh = renderScorePcm(make("F# minor"), { sampleRate: SR }).pcm;
    expect(Buffer.from(second.buffer).equals(Buffer.from(fresh.buffer))).toBe(
      true,
    );
    expect(Buffer.from(second.buffer).equals(Buffer.from(first.buffer))).toBe(
      false,
    );
  });

  test("a live string note follows the song key", () => {
    const make = (key: string): TrackScore =>
      createScore({
        bars: 1,
        key,
        tracks: [
          {
            id: "s",
            name: "s",
            instrument: "string",
            string: { preset: "sitar", sym: 1 },
          },
        ],
      } as never);
    const live = new LiveSynth(SR);
    const note = (score: TrackScore) =>
      live.render({
        score,
        trackId: "s",
        pitch: 62,
        velocity: 0.8,
        seconds: 0.5,
      } as never)!.pcm;
    const a = note(make("C major"));
    const b = note(make("F# minor"));
    expect(live.cached).toBe(2);
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(false);
  });

  test("the preset table digest joins the stem key", () => {
    const digests = STRING_ENGINE.assetDigests?.({} as never, {} as never);
    expect(digests?.[0]).toMatch(/^strings:[0-9a-f]{8}$/);
  });

  test("voice cap: a releasing chord does not shield newer ringing ones", () => {
    // Three held notes, cap 1: the third must release the second too.
    const string = {
      preset: "santur",
      voices: 1,
      release: 0.02,
      unison: 1,
      sym: 0,
      body: "none",
      oct: 0,
    };
    const notes = [
      { pitch: 60, start: 0, seconds: 4 },
      { pitch: 64, start: 0.4, seconds: 4 },
      { pitch: 67, start: 0.8, seconds: 4 },
    ];
    const all = render(string, notes, 2);
    // The same notes, each released by hand when the next one starts.
    const last = render(
      string,
      notes.map((n, i) => (i < 2 ? { ...n, seconds: 0.4 } : n)),
      2,
    );
    const from = Math.round(1.2 * SR);
    const to = Math.round(1.8 * SR);
    let diff = 0;
    let ref = 0;
    for (let i = from; i < to; i += 1) {
      diff += (all[i]! - last[i]!) ** 2;
      ref += last[i]! ** 2;
    }
    expect(diff / ref).toBeLessThan(1e-3);
  });
});

describe("instrument words", () => {
  test("resolver words are unique", () => {
    const words = INSTRUMENT_WORDS.map((row) => row.word);
    expect(new Set(words).size).toBe(words.length);
  });
});
