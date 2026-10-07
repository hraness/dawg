import { describe, expect, test } from "bun:test";
import { decodeLoopDocument } from "../loop.ts";
import { trackSlug } from "../slug.ts";
import {
  DawgSdkError,
  every,
  hit,
  hits,
  midi,
  note,
  sampler,
  seq,
  slices,
  slugify,
  song,
  track,
  voiceSlots,
} from "./v1.ts";

describe("sdk v1 builders", () => {
  test("note converts names, defaults length and velocity, and freezes", () => {
    const n = note("A1", 0);
    expect(n).toEqual({
      kind: "note",
      pitch: 33,
      start: 0,
      length: 1,
      velocity: 0.8,
    });
    expect(Object.isFrozen(n)).toBe(true);
    expect(note(64, 1.5, 0.5, 0.6).pitch).toBe(64);
    expect(() => note("H1", 0)).toThrow(DawgSdkError);
    expect(() => note("C4", -1)).toThrow(/≥ 0/);
    expect(() => note("C4", 0, 0)).toThrow(/> 0/);
    expect(() => note("C4", 0, 1, 2)).toThrow(/between 0 and 1/);
    expect(midi("Bb2")).toBe(46);
  });

  test("seq steps through a pattern with rests", () => {
    const notes = seq("E2 . G2 - A2", { from: 4, step: 0.5 });
    expect(notes.map((n) => [n.pitch, n.start, n.length])).toEqual([
      [40, 4, 0.5],
      [43, 5, 0.5],
      [45, 6, 0.5],
    ]);
    expect(seq(["C4", 62], { len: 2 }).map((n) => n.length)).toEqual([2, 2]);
    expect(() => seq("")).toThrow(DawgSdkError);
  });

  test("every and hits produce beat grids", () => {
    expect(every(1, { until: 4 })).toEqual([0, 1, 2, 3]);
    expect(every(0.5, { from: 0.25, until: 2 })).toEqual([
      0.25, 0.75, 1.25, 1.75,
    ]);
    expect(every(4).length).toBe(4);
    expect(every(0.1, { until: 0.3 })).toEqual([0, 0.1, 0.2]);
    const h = hits("hat", every(0.5, { until: 1 }), 0.5);
    expect(h.map((x) => [x.voice, x.start, x.velocity, x.length])).toEqual([
      ["hat", 0, 0.5, 0.25],
      ["hat", 0.5, 0.5, 0.25],
    ]);
    expect(() => every(0.0001)).toThrow(/4096/);
  });

  test("track resolves kit hits to GM pitches and rejects unknown voices", () => {
    const t = track({
      name: "Drums",
      instrument: "kit",
      notes: [hit("kick", 0), hit("oh", 1)],
    });
    expect(t.id).toBe("drums");
    expect(t.notes.map((n) => n.pitch)).toEqual([36, 46]);
    expect(() =>
      track({ name: "d", instrument: "kit", notes: [hit("cowbell", 0)] }),
    ).toThrow(/unknown drum voice/);
    expect(() =>
      track({ name: "s", instrument: "sine", notes: [hit("kick", 0)] }),
    ).toThrow(/needs instrument "kit"/);
  });

  test("sampler voices get slots in name order and paths localize to the track", () => {
    const s = sampler({
      snare: "samples/sd.wav",
      kick: { src: "./samples/bd.wav", gain: 0.5 },
    });
    expect(Object.keys(s.voices)).toEqual(["kick", "snare"]);
    expect([...voiceSlots(s)]).toEqual([
      ["kick", 36],
      ["snare", 37],
    ]);
    const t = track({ name: "Beat", instrument: s, notes: [hit("snare", 1)] });
    expect(t.instrument).toBe("sampler");
    expect(t.sampler?.voices.kick?.src).toBe("tracks/beat/samples/bd.wav");
    expect(t.sampler?.voices.snare?.src).toBe("tracks/beat/samples/sd.wav");
    expect(t.notes[0]?.pitch).toBe(37);
    expect(() =>
      track({ name: "b", instrument: s, notes: [hit("clap", 0)] }),
    ).toThrow(/unknown sampler voice "clap" \(kick snare\)/);
    expect(() => track({ name: "b", instrument: "sampler" })).toThrow(
      /sampler\(\{/,
    );
    expect(() => sampler({})).toThrow(DawgSdkError);
    expect(() => sampler({ "no spaces": "x.wav" })).toThrow(DawgSdkError);
    const keyed = sampler(
      { vox: { src: "samples/vox.wav", root: "C4" } },
      { mode: "keyed" },
    );
    expect(keyed.voices.vox?.root).toBe(60);
    expect(voiceSlots(keyed).size).toBe(0);
  });

  test("pack sounds keep their pinned src, sha256, url and license", () => {
    const sha = "a".repeat(64);
    const s = sampler({
      kick: {
        src: "pack:tidal-drum-machines/RolandTR909_bd",
        sha256: sha,
        url: "https://example.com/909/bd.wav",
        license: "none stated",
      },
      hat: "pack:vcsl/hihat:2",
    });
    const t = track({ name: "Beat", instrument: s });
    expect(t.sampler?.voices.kick).toEqual({
      src: "pack:tidal-drum-machines/RolandTR909_bd",
      sha256: sha,
      url: "https://example.com/909/bd.wav",
      license: "none stated",
    });
    expect(t.sampler?.voices.hat?.src).toBe("pack:vcsl/hihat:2");
  });

  test("slices divides a file into equal voices", () => {
    const v = slices("samples/break.wav", 4, "brk");
    expect(Object.keys(v)).toEqual(["brk0", "brk1", "brk2", "brk3"]);
    expect(v.brk1).toEqual({ src: "samples/break.wav", begin: 0.25, end: 0.5 });
    expect(v.brk3?.end).toBe(1);
    expect(() => slices("x.wav", 0)).toThrow(DawgSdkError);
  });

  test("song converts beats to ticks, hashes note ids, and decodes as track.loop/v1", () => {
    const bass = track({
      name: "bass",
      instrument: "bass",
      volume: 0.8,
      filter: { cutoff: 800 },
      automation: {
        volume: [
          [0, 1],
          [4, 0.5],
        ],
      },
      notes: [note("A1", 0, 1), note("A1", 1.5, 1 / 3)],
    });
    const s = song({
      tempo: 128,
      meter: [3, 4],
      bars: 2,
      key: "A minor",
      tracks: [bass],
    });
    expect(s.format).toBe("track.loop/v1");
    expect(s.beatsPerBar).toBe(3);
    expect(s.notes.map((n) => [n.startTick, n.durationTicks])).toEqual([
      [0, 480],
      [720, 160],
    ]);
    expect(s.tracks[0]?.filter).toEqual({ cutoff: 800, resonance: 0 });
    expect(s.tracks[0]?.volumeAutomation).toEqual([
      { tick: 0, value: 1 },
      { tick: 1920, value: 0.5 },
    ]);
    expect(s.notes.every((n) => /^n-[0-9a-f]{16}$/.test(n.id))).toBe(true);
    const again = song({
      tempo: 128,
      meter: [3, 4],
      bars: 2,
      key: "A minor",
      tracks: [bass],
    });
    expect(again).toEqual(s);
    const decoded = decodeLoopDocument(JSON.parse(JSON.stringify(s)));
    expect(decoded.notes.length).toBe(2);
    expect(Object.isFrozen(s)).toBe(true);
  });

  test("identical notes get distinct ids and duplicate track ids are rejected", () => {
    const t = track({ name: "x", notes: [note("C4", 0), note("C4", 0)] });
    const s = song({ tracks: [t] });
    expect(new Set(s.notes.map((n) => n.id)).size).toBe(2);
    expect(() => song({ tracks: [t, t] })).toThrow(/two tracks with id/);
    expect(() => song({ tracks: [{} as never] })).toThrow(/track\(\)/);
    expect(() => song({ ticksPerBeat: 0, tracks: [] })).toThrow(DawgSdkError);
  });

  test("slugify makes directory names", () => {
    expect(slugify("Keys 2")).toBe("keys-2");
    expect(slugify("  Drums!! ")).toBe("drums");
    expect(slugify("***")).toBe("track");
    for (const name of [
      "Keys 2",
      "Café Bass",
      "--x--",
      "a".repeat(63) + " b",
      "",
      "Ünder Wörld",
    ])
      expect(slugify(name)).toBe(trackSlug(name));
  });
});
