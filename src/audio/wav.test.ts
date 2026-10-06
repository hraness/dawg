import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import { renderScoreWav } from "./wav.ts";

describe("score WAV renderer", () => {
  test("emits a bounded PCM WAV with audible note data", () => {
    const score = createScore({
      tracks: [{ id: "main" }],
      notes: [
        {
          id: "a",
          trackId: "main",
          start: 0,
          duration: 1,
          pitch: 60,
          velocity: 1,
        },
      ],
    });
    const wav = renderScoreWav(score, { sampleRate: 8_000, maxSeconds: 2 });
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe("WAVE");
    expect(wav.length).toBeGreaterThan(44);
    expect(wav.some((byte, index) => index > 44 && byte !== 0)).toBe(true);
  });
});
