import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import { renderAudition } from "./audition.ts";

describe("renderAudition", () => {
  test("auditions are pre-master: a song master does not change them", () => {
    const plain = createScore({
      tempoBpm: 120,
      bars: 1,
      tracks: [{ id: "lead", name: "lead", instrument: "saw" }],
      notes: [
        {
          id: "n",
          trackId: "lead",
          pitch: 60,
          startTick: 0,
          durationTicks: 480,
          velocity: 0.8,
        },
      ],
    } as never);
    const mastered = plain.withMaster({
      target: -6,
      glue: { ratio: 4 },
      limiter: { ceiling: -1 },
    });
    expect(mastered.master?.target).toBe(-6);
    const a = renderAudition({
      score: plain,
      trackId: "lead",
      sampleRate: 22_050,
    })!;
    const b = renderAudition({
      score: mastered,
      trackId: "lead",
      sampleRate: 22_050,
    })!;
    expect(b.frames).toBe(a.frames);
    expect(Buffer.from(b.pcm.buffer).equals(Buffer.from(a.pcm.buffer))).toBe(
      true,
    );
  });
});
