import { describe, expect, test } from "bun:test";
import {
  applyScoreOperation,
  createScore,
  type TrackScore,
} from "../../core/score.ts";
import { PREVIEWABLE_TOOLS } from "./preview-tool.ts";
import { AGENT_TOOLS, type ScorePlan, type ToolContext } from "./tools.ts";

const tool = AGENT_TOOLS.find((t) => t.name === "fit_sample")!;

const score = createScore({
  tempoBpm: 128,
  bars: 4,
  tracks: [
    {
      id: "brk",
      instrument: "sampler",
      sampler: {
        mode: "oneshot",
        voices: { amen: { src: "tracks/brk/samples/amen.wav" } },
      },
    },
  ],
});

const context = (value: TrackScore): ToolContext => ({
  score: value,
  focusedTrackId: "brk",
  revision: 1,
  newNoteId: (trackId, index) => `${trackId}-${index}`,
});

describe("fit_sample", () => {
  test("sets bpm and fitmode on a voice in one call, then unsets", () => {
    const plan = tool.plan(
      { voice: "amen", bpm: 174, fitmode: "beats" },
      context(score),
    ) as ScorePlan;
    let next = score;
    for (const op of plan.operations) next = applyScoreOperation(next, op);
    expect(next.tracks[0]!.sampler!.voices.amen).toEqual({
      src: "tracks/brk/samples/amen.wav",
      bpm: 174,
      fitmode: "beats",
    });
    expect(plan.summary).toContain("fit");
    const off = tool.plan(
      { voice: "amen", bpm: null, fitmode: null },
      context(next),
    ) as ScorePlan;
    for (const op of off.operations) next = applyScoreOperation(next, op);
    expect(next.tracks[0]!.sampler!.voices.amen).toEqual({
      src: "tracks/brk/samples/amen.wav",
    });
  });

  test("refuses empty calls, tones without a tempo, and is previewable", () => {
    expect(() => tool.plan({ voice: "amen" }, context(score))).toThrow(
      /bpm, len or fitmode/,
    );
    expect(() =>
      tool.plan({ voice: "amen", fitmode: "tones" }, context(score)),
    ).toThrow(/needs bpm, len or fit/);
    expect(() => tool.plan({ voice: "nope", len: 8 }, context(score))).toThrow(
      /no voice/,
    );
    expect(PREVIEWABLE_TOOLS).toContain("fit_sample");
  });
});
