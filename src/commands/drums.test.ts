import { describe, expect, test } from "bun:test";
import { DRUM_VOICES, parseDrumVoice } from "../../core/drums.ts";
import { expandRow, normalizeRhythmRow } from "../../core/euclid.ts";
import { synthKit } from "../../core/kits.ts";
import { createScore } from "../../core/score.ts";
import { pattern } from "../../core/sdk/v1.ts";
import { renderScorePcm } from "../audio/wav.ts";
import {
  applyDrumPattern,
  applySynthKit,
  DRUM_PATTERNS,
  findPattern,
  isSynthKitName,
  parsePatternCommand,
  patternLine,
} from "./drums.ts";

const empty = (tempoBpm = 120) =>
  createScore({
    tempoBpm,
    bars: 1,
    tracks: [
      { id: "drums", name: "drums", instrument: "kit" },
      { id: "keys", name: "keys", instrument: "piano" },
    ],
  });

describe("pattern library", () => {
  test("has 20-30+ uniquely named, well-formed patterns", () => {
    expect(DRUM_PATTERNS.length).toBeGreaterThanOrEqual(20);
    const names = DRUM_PATTERNS.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    for (const entry of DRUM_PATTERNS) {
      expect(entry.name).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.tags.length).toBeGreaterThan(0);
      expect(entry.tempo.min).toBeLessThanOrEqual(entry.tempo.bpm);
      expect(entry.tempo.bpm).toBeLessThanOrEqual(entry.tempo.max);
      expect(synthKit(entry.kit)?.name).toBe(entry.kit);
      const voices = entry.rows.map((row) => row.voice);
      expect(new Set(voices).size).toBe(voices.length);
      for (const [index, spec] of entry.rows.entries()) {
        const { kind: _kind, ...fields } = spec;
        const row = normalizeRhythmRow(fields, `${entry.name}[${index}]`);
        expect(parseDrumVoice(row.voice)).toBeDefined();
        // Every row plays something in one 4/4 bar.
        expect(
          expandRow(row, { ticksPerBeat: 480, loopTicks: 1920 }).length,
        ).toBeGreaterThan(0);
      }
    }
  });

  test("every pattern applies to a kit track and renders audible audio", () => {
    for (const entry of DRUM_PATTERNS) {
      const result = applyDrumPattern(empty(), "drums", entry.name, "set");
      expect(result.ok).toBe(true);
      const next = result.next!;
      expect(next.tempoBpm).toBe(entry.tempo.bpm);
      const drums = next.tracks.find((track) => track.id === "drums")!;
      expect(drums.rhythm?.map((row) => row.voice)).toEqual(
        entry.rows.map((row) => row.voice),
      );
      const notes = next.notes.filter((note) => note.trackId === "drums");
      expect(notes.length).toBeGreaterThan(0);
      // Every voice of the pattern produced hits.
      const pitches = new Set(notes.map((note) => note.pitch));
      for (const row of entry.rows)
        expect(
          pitches.has(
            DRUM_VOICES.find((v) => v.voice === parseDrumVoice(row.voice))!
              .pitch,
          ),
        ).toBe(true);
      const { pcm } = renderScorePcm(next, { sampleRate: 8_000 });
      let peak = 0;
      for (const value of pcm) peak = Math.max(peak, Math.abs(value));
      expect(peak).toBeGreaterThan(500);
    }
  });

  test("names resolve loosely and the SDK exposes the same rows", () => {
    expect(findPattern("Boom Bap")?.name).toBe("boom-bap");
    expect(findPattern("boom_bap")?.name).toBe("boom-bap");
    expect(findPattern("nope")).toBeUndefined();
    expect(pattern("house")).toBe(findPattern("house")!.rows);
    expect(() => pattern("nope")).toThrow(/unknown drum pattern/);
    expect(patternLine(findPattern("house")!)).toMatch(
      /^house · 118–128 BPM · house, dance/,
    );
  });
});

describe("/pattern", () => {
  test("grammar", () => {
    expect(parsePatternCommand("/pattern")).toEqual({ kind: "browse" });
    expect(parsePatternCommand("/patterns")).toEqual({ kind: "browse" });
    expect(parsePatternCommand("/pattern list")).toEqual({ kind: "list" });
    expect(parsePatternCommand("/pattern ls")).toEqual({ kind: "list" });
    expect(parsePatternCommand("/pattern Boom-Bap")).toEqual({
      kind: "apply",
      name: "boom-bap",
      tempo: "auto",
    });
    expect(parsePatternCommand("/pattern house keep-tempo")).toMatchObject({
      tempo: "keep",
    });
    expect(parsePatternCommand("/pattern house tempo")).toMatchObject({
      tempo: "set",
    });
    expect(parsePatternCommand("/pattern house loudly")).toBeUndefined();
    expect(parsePatternCommand("/patternhouse")).toBeUndefined();
    expect(parsePatternCommand("/kit")).toBeUndefined();
  });

  test("tempo modes: auto moves only out of range, keep never, set always", () => {
    const inRange = applyDrumPattern(empty(124), "drums", "house");
    expect(inRange.next!.tempoBpm).toBe(124);
    const auto = applyDrumPattern(empty(90), "drums", "house");
    expect(auto.next!.tempoBpm).toBe(124);
    expect(auto.message).toContain("124 BPM");
    expect(auto.payload).toMatchObject({ pattern: "house", tempoBpm: 124 });
    expect(
      applyDrumPattern(empty(90), "drums", "house", "keep").next!.tempoBpm,
    ).toBe(90);
    expect(
      applyDrumPattern(empty(120), "drums", "house", "set").next!.tempoBpm,
    ).toBe(124);
  });

  test("replaces the track's notes and rows and leaves other tracks", () => {
    let score = createScore({
      ...empty().toJSON(),
      notes: [
        {
          id: "old",
          trackId: "drums",
          pitch: 49,
          startTick: 0,
          durationTicks: 120,
          velocity: 1,
        },
        {
          id: "k",
          trackId: "keys",
          pitch: 60,
          startTick: 0,
          durationTicks: 480,
          velocity: 1,
        },
      ],
    });
    score = applyDrumPattern(score, "drums", "techno").next!;
    expect(score.notes.some((note) => note.id === "old")).toBe(false);
    expect(score.notes.some((note) => note.id === "k")).toBe(true);
    const twice = applyDrumPattern(score, "drums", "boom-bap").next!;
    expect(
      twice.tracks.find((t) => t.id === "drums")!.rhythm?.map((r) => r.voice),
    ).toEqual(findPattern("boom-bap")!.rows.map((row) => row.voice));
  });

  test("creates a kit track, converts an empty melodic one, refuses a melodic one with notes", () => {
    const created = applyDrumPattern(empty(), "beat", "house");
    expect(created.ok).toBe(true);
    expect(
      created.next!.tracks.find((track) => track.id === "beat")?.instrument,
    ).toBe("kit");
    expect(created.message).toContain("try /kit syn909");

    const converted = applyDrumPattern(empty(), "keys", "house");
    expect(
      converted.next!.tracks.find((track) => track.id === "keys")?.instrument,
    ).toBe("kit");

    const busy = createScore({
      ...empty().toJSON(),
      notes: [
        {
          id: "k",
          trackId: "keys",
          pitch: 60,
          startTick: 0,
          durationTicks: 480,
          velocity: 1,
        },
      ],
    });
    const refused = applyDrumPattern(busy, "keys", "house");
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain("melodic track");
    expect(applyDrumPattern(empty(), "drums", "nope").ok).toBe(false);
  });
});

describe("synth kits", () => {
  test("names: synth kits, aliases and default; sample banks stay with /kit", () => {
    expect(isSynthKitName("default")).toBe(true);
    expect(isSynthKitName("syn808")).toBe(true);
    expect(isSynthKitName("Lo-Fi")).toBe(true);
    expect(isSynthKitName("808")).toBe(false);
    expect(isSynthKitName("909")).toBe(false);
  });

  test("sets and clears the kit on a drum track", () => {
    const set = applySynthKit(empty(), "drums", "lofi");
    expect(set.ok).toBe(true);
    expect(set.kind).toBe("score.kit");
    expect(set.next!.tracks[0]!.kit).toBe("lofi");
    const same = applySynthKit(set.next!, "drums", "dusty");
    expect(same.next).toBeUndefined();
    expect(same.message).toContain("already");
    const cleared = applySynthKit(set.next!, "drums", "default");
    expect(cleared.next!.tracks[0]!.kit).toBeUndefined();
    expect(applySynthKit(empty(), "drums", "nope").ok).toBe(false);
    expect(applySynthKit(empty(), "fresh", "trap").next!.tracks.at(-1)).toEqual(
      expect.objectContaining({ id: "fresh", instrument: "kit", kit: "trap" }),
    );
  });

  test("refuses a melodic track with notes", () => {
    const busy = createScore({
      ...empty().toJSON(),
      notes: [
        {
          id: "k",
          trackId: "keys",
          pitch: 60,
          startTick: 0,
          durationTicks: 480,
          velocity: 1,
        },
      ],
    });
    expect(applySynthKit(busy, "keys", "trap").ok).toBe(false);
  });

  test("turns a oneshot sampler kit back into a synth kit, remapping hits and rows", () => {
    // Slots are assigned in name order: bd 36, sd 37, zap 38.
    const sampled = createScore({
      bars: 1,
      tracks: [
        {
          id: "drums",
          name: "drums",
          instrument: "sampler",
          sampler: {
            mode: "oneshot",
            voices: {
              bd: { src: "pack:tidal-drum-machines/RolandTR909_bd:0" },
              sd: { src: "pack:tidal-drum-machines/RolandTR909_sd:0" },
              zap: { src: "pack:tidal-drum-machines/RolandTR909_perc:0" },
            },
          },
        },
      ],
      notes: [36, 37, 38].map((pitch, index) => ({
        id: `n${index}`,
        trackId: "drums",
        pitch,
        startTick: index * 480,
        durationTicks: 120,
        velocity: 1,
      })),
    });
    const result = applySynthKit(sampled, "drums", "syn909");
    expect(result.ok).toBe(true);
    expect(result.message).toContain("1 hits had no synth voice");
    const track = result.next!.tracks[0]!;
    expect(track.instrument).toBe("kit");
    expect(track.sampler).toBeUndefined();
    expect(track.kit).toBe("syn909");
    expect(result.next!.notes.map((note) => note.pitch)).toEqual([36, 38]);
  });
});
