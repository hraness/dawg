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

  test("renders piecewise-linear volume automation", () => {
    const steady = createScore({
      ticksPerBeat: 480,
      tracks: [{ id: "main", volume: 1 }],
      notes: [
        {
          id: "a",
          trackId: "main",
          start: 0,
          durationTicks: 960,
          pitch: 60,
          velocity: 1,
        },
      ],
    });
    const fading = steady.withTracks([
      {
        id: "main",
        volume: 1,
        volumeAutomation: [
          { tick: 0, value: 1 },
          { tick: 960, value: 0 },
        ],
      },
    ]);
    const pcm = (wav: Uint8Array) => {
      const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
      let energy = 0;
      for (let offset = 44; offset + 1 < wav.byteLength; offset += 2)
        energy += Math.abs(view.getInt16(offset, true));
      return energy;
    };
    expect(
      pcm(renderScoreWav(fading, { sampleRate: 8_000, maxSeconds: 2 })),
    ).toBeLessThan(
      pcm(renderScoreWav(steady, { sampleRate: 8_000, maxSeconds: 2 })),
    );
  });

  test("renders piecewise-linear pan automation without changing the WAV contract", () => {
    const steady = createScore({
      ticksPerBeat: 480,
      tracks: [{ id: "main", volume: 1, pan: 0 }],
      notes: [
        {
          id: "a",
          trackId: "main",
          start: 0,
          durationTicks: 960,
          pitch: 60,
          velocity: 1,
        },
      ],
    });
    const automated = steady.withTracks([
      {
        id: "main",
        volume: 1,
        pan: 0,
        panAutomation: [
          { tick: 0, value: 0 },
          { tick: 960, value: 1 },
        ],
      },
    ]);
    expect(
      renderScoreWav(automated, { sampleRate: 8_000, maxSeconds: 2 }),
    ).not.toEqual(renderScoreWav(steady, { sampleRate: 8_000, maxSeconds: 2 }));
    const header = new DataView(
      renderScoreWav(automated, { sampleRate: 8_000, maxSeconds: 2 }).buffer,
    );
    expect(header.getUint16(22, true)).toBe(1);
  });
});
