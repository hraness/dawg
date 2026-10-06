import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { createScore, type TrackInput } from "../../core/score.ts";
import { DRUM_VOICES } from "../../core/drums.ts";
import { renderScoreWav } from "./wav.ts";

const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const render = (tracks: TrackInput[], notes = drumNotes("drums")) =>
  renderScoreWav(createScore({ bars: 1, tracks, notes }), {
    sampleRate: 8_000,
    maxSeconds: 3,
  });

function drumNotes(trackId: string) {
  return DRUM_VOICES.map((info, index) => ({
    id: `${info.voice}-${index}`,
    trackId,
    start: index * 240,
    duration: 120,
    pitch: info.pitch,
    velocity: 0.9,
  }));
}

function energy(wav: Uint8Array, from = 0, to = Infinity): number {
  const pcm = new Int16Array(wav.buffer.slice(44));
  let total = 0;
  for (let i = from; i < Math.min(to, pcm.length); i += 1)
    total += Math.abs(pcm[i]!);
  return total;
}

describe("drum and effect rendering", () => {
  test("drum voices render audibly and deterministically", () => {
    const kit: TrackInput[] = [{ id: "drums", instrument: "kit" }];
    const a = render(kit);
    const b = render(kit);
    expect(digest(a)).toBe(digest(b));
    expect(energy(a)).toBeGreaterThan(0);
    // Each voice is distinct.
    const voices = new Set(
      DRUM_VOICES.map((info) =>
        digest(
          render(kit, [
            {
              id: "x",
              trackId: "drums",
              start: 0,
              duration: 120,
              pitch: info.pitch,
              velocity: 0.9,
            },
          ]),
        ),
      ),
    );
    expect(voices.size).toBe(DRUM_VOICES.length);
  });

  test("filter, delay, and filter automation change output deterministically", () => {
    const dry = digest(render([{ id: "drums", instrument: "kit" }]));
    const filtered: TrackInput[] = [
      {
        id: "drums",
        instrument: "kit",
        filter: { cutoff: 300, resonance: 0.5 },
      },
    ];
    const delayed: TrackInput[] = [
      {
        id: "drums",
        instrument: "kit",
        delay: { beats: 0.375, feedback: 0.5, mix: 0.6 },
      },
    ];
    const automated: TrackInput[] = [
      {
        id: "drums",
        instrument: "kit",
        filterAutomation: [
          { tick: 0, value: 200 },
          { tick: 1_920, value: 12_000 },
        ],
      },
    ];
    const results = [filtered, delayed, automated].map((tracks) => {
      const first = digest(render(tracks));
      expect(digest(render(tracks))).toBe(first);
      return first;
    });
    expect(new Set([dry, ...results]).size).toBe(4);
    // A low cutoff removes energy from noisy hats and snares.
    expect(energy(render(filtered))).toBeLessThan(
      energy(render([{ id: "drums", instrument: "kit" }])),
    );
  });

  test("delay keeps echoes after a single hit and stays bounded", () => {
    const hit = [
      {
        id: "k",
        trackId: "drums",
        start: 0,
        duration: 120,
        pitch: 38,
        velocity: 1,
      },
    ];
    const tracks = (mix: number): TrackInput[] => [
      {
        id: "drums",
        instrument: "kit",
        delay: { beats: 1, feedback: 0.9, mix },
      },
    ];
    // 120 BPM: one beat is 4000 samples at 8 kHz; the snare tail is shorter.
    const wet = render(tracks(1), hit);
    const dry = render(tracks(0), hit);
    expect(energy(wet, 4_000, 6_000)).toBeGreaterThan(
      energy(dry, 4_000, 6_000),
    );
    const pcm = new Int16Array(wet.buffer.slice(44));
    expect(pcm.every((sample) => Math.abs(sample) <= 32_767)).toBe(true);
  });

  test("solo silences unsoloed tracks", () => {
    const keys = {
      id: "n",
      trackId: "keys",
      start: 0,
      duration: 480,
      pitch: 60,
      velocity: 1,
    };
    const both = render(
      [
        { id: "drums", instrument: "kit" },
        { id: "keys", instrument: "piano" },
      ],
      [...drumNotes("drums"), keys],
    );
    const soloed = render(
      [
        { id: "drums", instrument: "kit", solo: true },
        { id: "keys", instrument: "piano" },
      ],
      [...drumNotes("drums"), keys],
    );
    const drumsOnly = render(
      [
        { id: "drums", instrument: "kit" },
        { id: "keys", instrument: "piano", muted: true },
      ],
      [...drumNotes("drums"), keys],
    );
    expect(digest(soloed)).toBe(digest(drumsOnly));
    expect(digest(soloed)).not.toBe(digest(both));
  });
});
