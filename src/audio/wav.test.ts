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

  test("honors track mute and volume controls", () => {
    const loud = createScore({
      tracks: [{ id: "main", volume: 1 }],
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
    const quiet = loud.withTracks([{ id: "main", volume: 0.25 }]);
    const muted = loud.withTracks([{ id: "main", muted: true }]);
    const pcm = (wav: Uint8Array) => {
      const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
      let energy = 0;
      for (let offset = 44; offset + 1 < wav.byteLength; offset += 2)
        energy += Math.abs(view.getInt16(offset, true));
      return energy;
    };
    expect(
      pcm(renderScoreWav(quiet, { sampleRate: 8_000, maxSeconds: 2 })),
    ).toBeLessThan(
      pcm(renderScoreWav(loud, { sampleRate: 8_000, maxSeconds: 2 })),
    );
    expect(
      pcm(renderScoreWav(muted, { sampleRate: 8_000, maxSeconds: 2 })),
    ).toBe(0);
  });
});
