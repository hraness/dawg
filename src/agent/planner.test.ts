import { describe, expect, test } from "bun:test";
import { parseCompositionPlan, validateAgentOperation } from "./planner.ts";
import {
  applyScoreOperation,
  createScore,
  type NoteInput,
} from "../../core/score.ts";

describe("composition planner", () => {
  test("accepts bounded fenced JSON and rejects prose", () => {
    const plan = parseCompositionPlan(
      '```json\n{"operations":[{"type":"addNote","note":{"id":"x","trackId":"main","start":0,"duration":1,"pitch":60,"velocity":0.8}}]}\n```',
    );
    expect(plan.operations).toHaveLength(1);
    expect(() => parseCompositionPlan("make it funky")).toThrow("valid JSON");
  });

  test("accepts bounded score control operations", () => {
    const plan = parseCompositionPlan(
      JSON.stringify({
        operations: [
          { type: "setTempo", tempoBpm: 128 },
          { type: "setBars", bars: 8 },
          { type: "addTrack", track: { id: "bass", instrument: "bass" } },
          {
            type: "updateTrack",
            trackId: "main",
            patch: { instrument: "piano", volume: 0.8 },
          },
          { type: "clearTrack", trackId: "main" },
          {
            type: "setAutomation",
            trackId: "main",
            parameter: "volume",
            points: [{ tick: 0, value: 0.25 }],
          },
          {
            type: "setAutomation",
            trackId: "main",
            parameter: "pan",
            points: [{ tick: 480, value: -0.5 }],
          },
        ],
      }),
    );
    expect(plan.operations).toHaveLength(7);
    expect(plan.operations[0]).toEqual({ type: "setTempo", tempoBpm: 128 });
    expect(plan.operations[5]).toEqual({
      type: "setAutomation",
      trackId: "main",
      parameter: "volume",
      points: [{ tick: 0, value: 0.25 }],
    });
    expect(plan.operations[6]).toEqual({
      type: "setAutomation",
      trackId: "main",
      parameter: "pan",
      points: [{ tick: 480, value: -0.5 }],
    });
  });

  test("rejects out-of-range pan automation and malformed tracks", () => {
    expect(() =>
      parseCompositionPlan(
        JSON.stringify({
          operations: [
            {
              type: "setAutomation",
              trackId: "main",
              parameter: "pan",
              points: [{ tick: 0, value: -1.1 }],
            },
          ],
        }),
      ),
    ).toThrow("agent automation point is invalid");
    expect(() =>
      parseCompositionPlan(
        JSON.stringify({
          operations: [{ type: "addTrack", track: { id: "bad" } }],
        }),
      ),
    ).not.toThrow();
  });
});

describe("agent operation validator", () => {
  test("add and update preserve expressive and vocal metadata through score validation", () => {
    const base = createScore({
      tracks: [{ id: "voice", name: "Voice", instrument: "sine" }],
    });
    const metadata = {
      articulation: "legato",
      glide: 0.08,
      bend: [
        { at: 0, cents: 0 },
        { at: 1, cents: 200 },
      ],
      vibrato: { rate: 5, depth: 0.15 },
      humanize: { velocity: 0.05 },
      drift: 0.2,
      cents: -12,
      lyric: "hold",
      vowel: "a",
      vox: { breath: 0.2 },
    };
    const note = {
      id: "sung",
      trackId: "voice",
      startTick: 0,
      durationTicks: 240,
      pitch: 60,
      velocity: 0.7,
    };
    const added = applyScoreOperation(
      base,
      validateAgentOperation({
        type: "addNote",
        note: { ...note, ...metadata, ignored: true },
      }),
    );
    const expected = createScore({
      ...base.toJSON(),
      notes: [{ ...note, ...metadata } as NoteInput],
    });
    expect(added.toJSON()).toEqual(expected.toJSON());
    const plain = applyScoreOperation(
      base,
      validateAgentOperation({ type: "addNote", note }),
    );
    const updated = applyScoreOperation(
      plain,
      validateAgentOperation({
        type: "updateNote",
        noteId: note.id,
        patch: metadata,
      }),
    );
    expect(updated.toJSON()).toEqual(expected.toJSON());
    const cleared = applyScoreOperation(
      updated,
      validateAgentOperation({
        type: "updateNote",
        noteId: note.id,
        patch: Object.fromEntries(
          Object.keys(metadata).map((key) => [key, null]),
        ),
      }),
    );
    expect(cleared.toJSON()).toEqual(plain.toJSON());
    for (const invalid of [
      { glide: -1 },
      { bend: [{ at: 0, cents: Infinity }] },
      { cents: "loud" },
      { lyric: "two words" },
      { vowel: "invalid" },
      { vox: { command: "unsafe" } },
    ]) {
      expect(() =>
        applyScoreOperation(
          base,
          validateAgentOperation({
            type: "addNote",
            note: { ...note, ...invalid },
          }),
        ),
      ).toThrow();
      expect(() =>
        applyScoreOperation(
          plain,
          validateAgentOperation({
            type: "updateNote",
            noteId: note.id,
            patch: invalid,
          }),
        ),
      ).toThrow();
    }
  });
  test("rejects unsupported and malformed operations", () => {
    expect(() => validateAgentOperation({ type: "dropTable" })).toThrow(
      "unsupported",
    );
    expect(() => validateAgentOperation(null)).toThrow("malformed");
    expect(validateAgentOperation({ type: "setBars", bars: 4 })).toEqual({
      type: "setBars",
      bars: 4,
    });
  });
});
