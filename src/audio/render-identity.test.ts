/**
 * Render byte-identity: sha256 of renders and exports for a fixed corpus,
 * recorded before playback-side changes (stem-cache staging, the swap
 * crossfade, latency work). Renders and exports are deterministic; any
 * change to these digests is a change to how songs sound and needs a
 * deliberate update.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createScore, updateTrack, type TrackScore } from "../../core/score.ts";
import { song } from "./fixtures/latency-song.ts";
import { previewScore } from "./preview.ts";
import { renderScorePcm, renderScoreWav, StemRenderer } from "./wav.ts";

const sha = (bytes: ArrayBufferView) =>
  createHash("sha256")
    .update(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    .digest("hex")
    .slice(0, 16);

/** Orbit bus, ducking, ir reverb, filter automation: the shared paths. */
function busy(): TrackScore {
  return createScore({
    tempoBpm: 100,
    bars: 1,
    tracks: [
      {
        id: "a",
        name: "a",
        instrument: "pluck",
        delay: { beats: 0.75, feedback: 0.4, mix: 0.3, pingpong: true },
        reverb: { mix: 0.3, size: 0.6 },
        fx: { orbit: { orbit: 2, shared: true } },
      },
      {
        id: "b",
        name: "b",
        instrument: "saw",
        reverb: { mix: 0.4, size: 0.5, ir: { src: "builtin:room" } },
        filterAutomation: [
          { tick: 0, value: 300 },
          { tick: 1_900, value: 5_000 },
        ],
      },
      {
        id: "k",
        name: "k",
        instrument: "kit",
        fx: { duck: { orbit: 2, depth: 1, attack: 0.3 } },
      },
    ],
    notes: [
      {
        id: "n",
        trackId: "a",
        pitch: 60,
        startTick: 0,
        durationTicks: 240,
        velocity: 0.8,
      },
      {
        id: "m",
        trackId: "b",
        pitch: 43,
        startTick: 480,
        durationTicks: 960,
        velocity: 0.8,
      },
      {
        id: "k1",
        trackId: "k",
        pitch: 36,
        startTick: 0,
        durationTicks: 120,
        velocity: 1,
      },
      {
        id: "k2",
        trackId: "k",
        pitch: 36,
        startTick: 960,
        durationTicks: 120,
        velocity: 1,
      },
    ],
  } as never);
}

describe("render byte-identity", () => {
  test("loop renders, exports and cached re-renders match the recorded digests", () => {
    const digests: Record<string, string> = {};
    for (const [name, score] of [
      ["song", song()],
      ["busy", busy()],
    ] as const) {
      digests[`${name} loop`] = sha(
        renderScorePcm(score, { sampleRate: 22_050, loop: true }).pcm,
      );
      digests[`${name} wav`] = sha(
        renderScoreWav(score, { sampleRate: 22_050 }),
      );
    }
    // A cached renderer re-rendering one edited track (the audition path).
    const renderer = new StemRenderer();
    let score = song();
    renderer.render(previewScore(score, "pad", { context: true })!.score, {
      sampleRate: 22_050,
      loop: true,
    });
    score = updateTrack(score, "pad", {
      reverb: { mix: 0.5, size: 0.6 },
    } as never);
    digests["song cached edit"] = sha(
      renderer.render(previewScore(score, "pad", { context: true })!.score, {
        sampleRate: 22_050,
        loop: true,
      }).pcm,
    );
    expect(digests).toEqual(EXPECTED);
  });

  test("cached reverb tails re-mix to the same bytes as a cold render", () => {
    const options = { sampleRate: 22_050, loop: true } as const;
    const renderer = new StemRenderer();
    const edits: [string, Record<string, unknown>][] = [
      ["pad", { reverb: { mix: 0.2, size: 0.6 } }],
      ["pad", { reverb: { mix: 0.7, size: 0.6 } }],
      [
        "pad",
        { reverb: { mix: 0.7, size: 0.9, predelay: 0.02, lowpass: 3_000 } },
      ],
      [
        "pad",
        { reverb: { mix: 0.1, size: 0.9, predelay: 0.02, lowpass: 3_000 } },
      ],
      [
        "pad",
        {
          reverb: { mix: 0.1, size: 0.9 },
          fxAutomation: {
            "reverb-mix": [
              { tick: 0, value: 0 },
              { tick: 3_000, value: 0.9 },
            ],
          },
        },
      ],
      ["pad", { reverb: { mix: 0.4, size: 0.5, ir: { src: "builtin:room" } } }],
      ["pad", { reverb: { mix: 0.8, size: 0.5, ir: { src: "builtin:room" } } }],
      ["pad", { reverb: { mix: 0, size: 0.5 } }],
      ["pad", { reverb: { mix: 0.3, size: 0.5 } }],
    ];
    let score = song();
    renderer.render(score, options);
    for (const [trackId, patch] of edits) {
      score = updateTrack(score, trackId, patch as never);
      const cached = renderer.render(score, options).pcm;
      const cold = renderScorePcm(score, options).pcm;
      expect(sha(cached)).toBe(sha(cold));
    }
  });
});

/** Patch fixtures (lane 3): a voice patch, an effect patch and a macro lane. */
function patched(): TrackScore {
  return createScore({
    tempoBpm: 100,
    bars: 1,
    tracks: [
      {
        id: "p",
        name: "p",
        instrument: "patch",
        reverb: { mix: 0.25, size: 0.5 },
        patch: {
          kind: "patch",
          role: "instrument",
          name: "pluck",
          nodes: [
            {
              id: "env",
              type: "adsr",
              params: { attack: 0.002, decay: 0.2, sustain: 0.2 },
            },
            { id: "osc", type: "osc", params: { wave: "square" } },
            { id: "lfo", type: "lfo", params: { rate: 3, depth: 1 } },
            {
              id: "span",
              type: "scale",
              params: { inmin: -1, inmax: 1, min: 300, max: 1_500 },
            },
            { id: "vcf", type: "svf", params: { cutoff: 20, q: 0.4 } },
            { id: "amp", type: "vca", params: { gain: 0 } },
          ],
          cables: [
            { id: "c1", from: "voice.pitch", to: "osc.pitch" },
            { id: "c2", from: "voice.gate", to: "env.gate" },
            { id: "c3", from: "osc.out", to: "vcf.in" },
            { id: "c4", from: "lfo.out", to: "span.in" },
            { id: "c8", from: "span.out", to: "vcf.cutoff" },
            { id: "c5", from: "vcf.out", to: "amp.in" },
            { id: "c6", from: "env.out", to: "amp.gain", amount: 0.5 },
            { id: "c7", from: "amp.out", to: "out.audio" },
          ],
          macros: [
            {
              id: "res",
              min: 0,
              max: 1,
              default: 0.4,
              to: [{ port: "vcf.q" }],
            },
          ],
        },
        fxAutomation: {
          "patch-res": [
            { tick: 0, value: 0.1 },
            { tick: 1_800, value: 0.9 },
          ],
        },
        fxPatch: [
          {
            kind: "patch",
            role: "effect",
            name: "drive",
            nodes: [{ id: "g", type: "vca", params: { gain: 1.5 } }],
            cables: [
              { id: "c1", from: "in.audio", to: "g.in" },
              { id: "c2", from: "g.out", to: "out.audio" },
            ],
            macros: [],
          },
        ],
      },
    ],
    notes: [0, 1, 2, 3, 4, 5].map((i) => ({
      id: `p${i}`,
      trackId: "p",
      pitch: 48 + ((i * 5) % 12),
      startTick: i * 300,
      durationTicks: 200,
      velocity: 0.7 + i * 0.05,
    })),
  } as never);
}

describe("patch render byte-identity", () => {
  test("patch fixtures render the recorded bytes, cold and cached", () => {
    const options = { sampleRate: 22_050, loop: true } as const;
    const cold = sha(renderScorePcm(patched(), options).pcm);
    const renderer = new StemRenderer();
    renderer.render(patched(), options);
    expect(sha(renderer.render(patched(), options).pcm)).toBe(cold);
    expect({
      "patch loop": cold,
      "patch wav": sha(renderScoreWav(patched(), { sampleRate: 22_050 })),
    }).toEqual(PATCH_EXPECTED);
  });
});

/** Recorded on the lane 3 patch renderer. */
const PATCH_EXPECTED = {
  "patch loop": "3d81f4a3ada19083",
  "patch wav": "160e21877a5b37ab",
};

/** Recorded on 0.4.0's renderer (origin/main 45094a6). */
const EXPECTED: Record<string, string> = {
  "busy loop": "553df4fc83006158",
  "busy wav": "d084c81d011397ee",
  "song cached edit": "f19cb1e763697b54",
  "song loop": "216a12871d92d052",
  "song wav": "3b9398ab4d1bf7af",
};
