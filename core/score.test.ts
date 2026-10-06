import { describe, expect, test } from "bun:test";
import {
  decodeLoop,
  encodeLoop,
  encodeLoopDocument,
  LOOP_FORMAT,
} from "./loop.ts";
import {
  SCORE_LIMITS,
  ScoreValidationError,
  TrackScore,
  addTrack,
  addNote,
  applyScoreOperation,
  createScore,
  removeNote,
  scoreFromJSON,
  updateNote,
  updateTrack,
  clearTrack,
  setVolumeAutomation,
  setPanAutomation,
} from "./score.ts";

describe("TrackScore", () => {
  test("creates a bounded immutable score and sorts notes deterministically", () => {
    const score = createScore({ tracks: [{ id: "bass", instrument: "sine" }] });
    const withNotes = addNote(
      addNote(score, {
        id: "late",
        trackId: "bass",
        startTick: 960,
        durationTicks: 240,
        pitch: 36,
        velocity: 0.7,
      }),
      {
        id: "early",
        trackId: "bass",
        start: 0,
        duration: 480,
        pitch: 40,
        velocity: 1,
      },
    );
    expect(withNotes.notes.map((note) => note.id)).toEqual(["early", "late"]);
    expect(Object.isFrozen(withNotes)).toBe(true);
    expect(Object.isFrozen(withNotes.notes)).toBe(true);
    expect(withNotes.notes[0]).toEqual({
      id: "early",
      trackId: "bass",
      startTick: 0,
      durationTicks: 480,
      pitch: 40,
      velocity: 1,
    });
  });

  test("removeNote is immutable and idempotent for an absent id", () => {
    const score = createScore().addNote({
      id: "a",
      trackId: "main",
      startTick: 0,
      durationTicks: 1,
      pitch: 60,
      velocity: 0.5,
    });
    const removed = removeNote(score, "a");
    expect(removed.notes).toHaveLength(0);
    expect(removeNote(removed, "missing")).toBe(removed);
    expect(score.notes).toHaveLength(1);
  });

  test("rejects malformed and over-budget notes", () => {
    const score = createScore();
    expect(() =>
      score.addNote({
        id: "bad",
        trackId: "main",
        startTick: -1,
        durationTicks: 1,
        pitch: 60,
        velocity: 1,
      }),
    ).toThrow(ScoreValidationError);
    expect(() =>
      score.addNote({
        id: "bad",
        trackId: "main",
        startTick: 0,
        durationTicks: 1,
        pitch: 128,
        velocity: 1,
      }),
    ).toThrow(ScoreValidationError);
    const notes = Array.from({ length: SCORE_LIMITS.maxNotes }, (_, index) => ({
      id: `n${index}`,
      trackId: "main",
      startTick: index,
      durationTicks: 1,
      pitch: 60,
      velocity: 0.5,
    }));
    const full = createScore({ notes });
    expect(() =>
      full.addNote({
        id: "overflow",
        trackId: "main",
        startTick: 0,
        durationTicks: 1,
        pitch: 60,
        velocity: 0.5,
      }),
    ).toThrow("more than");
  });

  test("round-trips track.loop/v1 JSON and rejects foreign versions", () => {
    const score = createScore({
      tempoBpm: 128,
      bars: 8,
      key: "Am",
      tracks: [
        {
          id: "lead",
          name: "Lead",
          instrument: "saw",
          volumeAutomation: [
            { tick: 1_920, value: 0.2 },
            { tick: 0, value: 0.8 },
          ],
          panAutomation: [
            { tick: 1_920, value: 1 },
            { tick: 0, value: -1 },
          ],
        },
      ],
    }).addNote({
      id: "n1",
      trackId: "lead",
      startTick: 0,
      durationTicks: 240,
      pitch: 69,
      velocity: 0.8,
    });
    const encoded = encodeLoop(score);
    expect(encoded).toContain(`"format":"${LOOP_FORMAT}"`);
    expect(decodeLoop(encoded)).toEqual(score);
    expect(decodeLoop(encodeLoopDocument(score))).toEqual(score);
    expect(() =>
      decodeLoop(encoded.replace("track.loop/v1", "track.loop/v2")),
    ).toThrow("unsupported loop format");
    expect(() => decodeLoop("{")).toThrow("invalid track.loop/v1 JSON");
  });

  test("parses unknown JSON only through the bounded decoder", () => {
    expect(scoreFromJSON({ version: 1, notes: [] })).toBeInstanceOf(TrackScore);
    expect(() =>
      scoreFromJSON({
        notes: [
          {
            id: "x",
            trackId: "main",
            startTick: 0,
            durationTicks: 1,
            pitch: 60,
            velocity: 2,
          },
        ],
      }),
    ).toThrow(ScoreValidationError);
    expect(() => scoreFromJSON("not an object")).toThrow(ScoreValidationError);
  });

  test("supports bounded tempo, note, and track mutations", () => {
    const score = createScore({
      tracks: [{ id: "lead", instrument: "sine" }],
      notes: [
        {
          id: "n",
          trackId: "lead",
          start: 0,
          duration: 120,
          pitch: 60,
          velocity: 0.5,
        },
      ],
    });
    const edited = updateNote(score.withTempo(140), "n", {
      pitch: 64,
      velocity: 0.8,
    });
    const controlled = updateTrack(edited, "lead", {
      instrument: "piano",
      volume: 0.7,
      pan: -0.5,
      muted: true,
    });
    expect(controlled.tempoBpm).toBe(140);
    expect(controlled.notes[0]).toMatchObject({ pitch: 64, velocity: 0.8 });
    expect(controlled.tracks[0]).toMatchObject({
      instrument: "piano",
      volume: 0.7,
      pan: -0.5,
      muted: true,
    });
    expect(clearTrack(controlled, "lead").notes).toHaveLength(0);
  });

  test("normalizes bounded volume automation while preserving old tracks", () => {
    const score = createScore({ tracks: [{ id: "lead" }] });
    expect(score.tracks[0]?.volumeAutomation).toEqual([]);
    const automated = setVolumeAutomation(score, "lead", [
      { tick: 960, value: 0.8 },
      { tick: 0, value: 0.2 },
    ]);
    expect(automated.tracks[0]?.volumeAutomation).toEqual([
      { tick: 0, value: 0.2 },
      { tick: 960, value: 0.8 },
    ]);
    expect(() =>
      setVolumeAutomation(score, "lead", [
        { tick: 0, value: 0.2 },
        { tick: 0, value: 0.8 },
      ]),
    ).toThrow("cannot share a tick");
  });

  test("normalizes independent bounded pan automation", () => {
    const score = createScore({ tracks: [{ id: "lead" }] });
    expect(score.tracks[0]?.panAutomation).toEqual([]);
    const automated = applyScoreOperation(score, {
      type: "setAutomation",
      trackId: "lead",
      parameter: "pan",
      points: [
        { tick: 960, value: 1 },
        { tick: 0, value: -1 },
      ],
    });
    expect(automated.tracks[0]?.panAutomation).toEqual([
      { tick: 0, value: -1 },
      { tick: 960, value: 1 },
    ]);
    expect(automated.tracks[0]?.volumeAutomation).toEqual([]);
    expect(Object.isFrozen(automated.tracks[0]?.panAutomation)).toBe(true);
    for (const value of [-1.1, 1.1, Number.NaN]) {
      expect(() =>
        setPanAutomation(score, "lead", [{ tick: 0, value }]),
      ).toThrow("between -1 and 1");
    }
    expect(() =>
      setPanAutomation(score, "lead", [
        { tick: 0, value: -1 },
        { tick: 0, value: 1 },
      ]),
    ).toThrow("cannot share a tick");
    expect(() =>
      setPanAutomation(
        score,
        "lead",
        Array.from(
          { length: SCORE_LIMITS.maxAutomationPoints + 1 },
          (_, tick) => ({
            tick,
            value: 0,
          }),
        ),
      ),
    ).toThrow("at most");
  });

  test("adds tracks immutably and enforces IDs and track budgets", () => {
    const score = createScore({ tracks: [{ id: "main" }] });
    const expanded = applyScoreOperation(score, {
      type: "addTrack",
      track: { id: "bass", instrument: "bass" },
    });
    expect(score.tracks).toHaveLength(1);
    expect(expanded.tracks).toHaveLength(2);
    expect(expanded.tracks[1]).toMatchObject({
      id: "bass",
      name: "bass",
      instrument: "bass",
      panAutomation: [],
    });
    expect(() => addTrack(expanded, { id: "bass" })).toThrow("already exists");
    expect(() => addTrack(score, { id: "" })).toThrow("track id");
    const full = createScore({
      tracks: Array.from({ length: SCORE_LIMITS.maxTracks }, (_, index) => ({
        id: `track-${index}`,
      })),
    });
    expect(() => addTrack(full, { id: "extra" })).toThrow("more than");
  });

  test("resizes loop bounds without deleting score data", () => {
    const score = createScore({
      tracks: [{ id: "main", panAutomation: [{ tick: 4_000, value: 1 }] }],
      notes: [
        {
          id: "late",
          trackId: "main",
          start: 4_000,
          duration: 480,
          pitch: 60,
          velocity: 1,
        },
      ],
    });
    const longer = applyScoreOperation(score, { type: "setBars", bars: 8 });
    expect(longer.bars).toBe(8);
    expect(score.bars).toBe(4);
    const shorter = longer.withBars(1);
    expect(shorter.notes).toEqual(score.notes);
    expect(shorter.tracks).toEqual(score.tracks);
    expect(shorter.withBars(8)).toEqual(longer);
    for (const bars of [0, 1.5, SCORE_LIMITS.maxBars + 1, Number.NaN])
      expect(() => score.withBars(bars)).toThrow("bars must be an integer");
  });
});
