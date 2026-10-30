import { expect, test } from "bun:test";
import { createScore, updateTrack } from "../../core/score.ts";
import { sampleKey } from "../audio/samples.ts";
import { audibleEventCount, missingPlaybackAssets } from "./assets.ts";

test("silent missing-clip warnings cannot pass ready admission", () => {
  const score = createScore({
    tracks: [
      {
        id: "voice",
        instrument: "sine",
        clips: [
          {
            id: "line",
            src: "tracks/voice/samples/missing.wav",
            sha256: "a".repeat(64),
            startTick: 0,
            dur: 1,
          },
        ],
      },
    ],
  });
  expect(
    missingPlaybackAssets(score, { voices: new Map(), problems: [] }),
  ).toEqual(["tracks/voice/samples/missing.wav"]);
  expect(
    missingPlaybackAssets(
      updateTrack(score, "voice", { muted: true }),
      undefined,
    ),
  ).toEqual([]);
});

test("ready event receipts count loaded clips and respect solo exclusion", () => {
  const score = createScore({
    tracks: [
      {
        id: "voice",
        instrument: "sine",
        clips: [
          {
            id: "line",
            src: "voice.wav",
            sha256: "a".repeat(64),
            startTick: 0,
            dur: 1,
          },
        ],
      },
      { id: "bass", instrument: "sine" },
    ],
    notes: [
      {
        id: "bass-note",
        trackId: "bass",
        startTick: 0,
        durationTicks: 480,
        pitch: 36,
        velocity: 0.8,
      },
    ],
  });
  const bank = {
    voices: new Map([
      [
        sampleKey("voice", "clip:line"),
        {
          sha256: "a".repeat(64),
          sampleRate: 8,
          channels: 1,
          frames: 8,
          mono: Float32Array.from([0.1, 0.2, 0.1, 0.2, 0.1, 0.2, 0.1, 0.2]),
        },
      ],
    ]),
    problems: [],
  };
  expect(audibleEventCount(score, bank, { from: 0, to: 4 }, ["voice"])).toBe(1);
  expect(
    audibleEventCount(
      updateTrack(score, "bass", { solo: true }),
      bank,
      { from: 0, to: 4 },
      ["voice"],
    ),
  ).toBe(0);
  expect(audibleEventCount(score, bank, { from: 8, to: 12 }, ["voice"])).toBe(
    0,
  );
});
