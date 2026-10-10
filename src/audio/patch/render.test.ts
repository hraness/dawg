/**
 * Patches in the song render (lane 3): instrument patches, library
 * references, effect patches at the chain stage and post, macro lanes,
 * the stem cache and the side input.
 */
import { describe, expect, test } from "bun:test";
import type { Patch } from "../../../core/patch.ts";
import { createScore, type TrackInput } from "../../../core/score.ts";
import { LiveSynth } from "../live.ts";
import { LoopRenderer } from "../renderer.ts";
import { renderScorePcm, StemRenderer } from "../wav.ts";

const RATE = 16_000;
const options = { sampleRate: RATE };

const SUB: Patch = {
  kind: "patch",
  role: "instrument",
  name: "sub",
  nodes: [
    { id: "env", type: "adsr", params: { attack: 0.005, release: 0.05 } },
    { id: "osc", type: "osc", params: { wave: "saw" } },
    { id: "vcf", type: "svf", params: { cutoff: 1_200, q: 0.3 } },
    { id: "amp", type: "vca", params: { gain: 0 } },
  ],
  cables: [
    { id: "c1", from: "voice.pitch", to: "osc.pitch" },
    { id: "c2", from: "voice.gate", to: "env.gate" },
    { id: "c3", from: "osc.out", to: "vcf.in" },
    { id: "c4", from: "vcf.out", to: "amp.in" },
    { id: "c5", from: "env.out", to: "amp.gain", amount: 0.4 },
    { id: "c6", from: "amp.out", to: "out.audio" },
  ],
  macros: [
    {
      id: "cut",
      label: "Cutoff",
      min: 100,
      max: 8_000,
      default: 1_200,
      curve: "exp",
      to: [{ port: "vcf.cutoff" }],
    },
  ],
};

/** An effect patch: `in.audio` (or `in.side`) through a gain. */
function gainPatch(
  gain: number,
  from: `${string}.${string}` = "in.audio",
  at?: "post",
): Patch {
  return {
    kind: "patch",
    role: "effect",
    name: "gain",
    nodes: [{ id: "g", type: "vca", params: { gain } }],
    cables: [
      { id: "c1", from, to: "g.in" },
      { id: "c2", from: "g.out", to: "out.audio" },
    ],
    macros: [],
    ...(at ? { at } : {}),
  };
}

const NOTES = [
  { id: "n1", pitch: 45, startTick: 0, durationTicks: 480, velocity: 0.9 },
  { id: "n2", pitch: 52, startTick: 960, durationTicks: 480, velocity: 0.7 },
];

function song(
  tracks: Record<string, unknown>[],
  extra: Record<string, unknown> = {},
  shift = 0,
) {
  return createScore({
    tempoBpm: 120,
    bars: 1,
    tracks: tracks as TrackInput[],
    notes: tracks.flatMap((track, t) =>
      NOTES.map((note) => ({
        ...note,
        id: `${note.id}${t}`,
        trackId: track.id as string,
        startTick: note.startTick + t * 240,
        pitch: note.pitch + (t === 0 ? shift : 0),
      })),
    ),
    ...extra,
  });
}

const energy = (pcm: Int16Array, from = 0, to = pcm.length) => {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += pcm[i]! * pcm[i]!;
  return sum;
};
const equal = (a: Int16Array, b: Int16Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

describe("instrument patches in the render", () => {
  test("a voice patch sounds, deterministically, as one stem", () => {
    const score = song([
      { id: "p", name: "p", instrument: "patch", patch: SUB },
    ]);
    const a = renderScorePcm(score, options);
    expect(energy(a.pcm)).toBeGreaterThan(0);
    expect(equal(a.pcm, renderScorePcm(score, options).pcm)).toBe(true);
    const renderer = new StemRenderer();
    expect(equal(renderer.render(score, options).pcm, a.pcm)).toBe(true);
    expect(renderer.cache.stems).toBe(1);
    expect(equal(renderer.render(score, options).pcm, a.pcm)).toBe(true);
  });

  test("a macro lane and a reference's macros move the sound", () => {
    const plain = song([
      { id: "p", name: "p", instrument: "patch", patch: SUB },
    ]);
    const swept = song([
      {
        id: "p",
        name: "p",
        instrument: "patch",
        patch: SUB,
        fxAutomation: {
          "patch-cut": [
            { tick: 0, value: 0 },
            { tick: 1_920, value: 1 },
          ],
        },
      },
    ]);
    const base = renderScorePcm(plain, options).pcm;
    expect(equal(base, renderScorePcm(swept, options).pcm)).toBe(false);
    // A library reference plays the same patch; its macros override.
    const ref = (macros?: Record<string, number>) =>
      song(
        [
          {
            id: "p",
            name: "p",
            instrument: "patch",
            patch: { kind: "patch", ref: "sub", ...(macros ? { macros } : {}) },
          },
        ],
        {
          patches: { sub: SUB },
        },
      );
    expect(equal(renderScorePcm(ref(), options).pcm, base)).toBe(true);
    expect(equal(renderScorePcm(ref({ cut: 400 }), options).pcm, base)).toBe(
      false,
    );
  });

  test("editing a library patch re-renders a cached reference", () => {
    const renderer = new StemRenderer();
    const ref = (patch: Patch) =>
      song(
        [
          {
            id: "p",
            name: "p",
            instrument: "patch",
            patch: { kind: "patch", ref: "sub" },
          },
        ],
        {
          patches: { sub: patch },
        },
      );
    const before = renderer.render(ref(SUB), options).pcm;
    const darker: Patch = {
      ...SUB,
      nodes: SUB.nodes.map((node) =>
        node.id === "vcf" ? { ...node, params: { cutoff: 300, q: 0.3 } } : node,
      ),
      macros: [],
    };
    const after = renderer.render(ref(darker), options).pcm;
    expect(equal(before, after)).toBe(false);
    expect(equal(after, renderScorePcm(ref(darker), options).pcm)).toBe(true);
  });
});

describe("effect patches in the render", () => {
  const pluck = { id: "a", name: "a", instrument: "pluck" };

  test("a unity effect patch at the chain stage changes nothing", () => {
    const dry = renderScorePcm(song([pluck]), options).pcm;
    const unity = renderScorePcm(
      song([{ ...pluck, fxPatch: [gainPatch(1)] }]),
      options,
    ).pcm;
    expect(equal(dry, unity)).toBe(true);
  });

  test("an effect patch runs after distort, and post after the chain", () => {
    const fx = { distort: { drive: 0.8 } };
    const chain = renderScorePcm(
      song([{ ...pluck, fx, fxPatch: [gainPatch(0.25)] }]),
      options,
    ).pcm;
    const post = renderScorePcm(
      song([{ ...pluck, fx, fxPatch: [gainPatch(0.25, "in.audio", "post")] }]),
      options,
    ).pcm;
    const full = renderScorePcm(song([{ ...pluck, fx }]), options).pcm;
    // Post is a plain gain on the finished pair; at the chain stage the
    // gain lands between distort and pan, so it is quieter by about as much.
    expect(energy(post)).toBeLessThan(energy(full) * 0.08);
    expect(energy(chain)).toBeLessThan(energy(full) * 0.08);
    // A cached render keeps the effect patches.
    const renderer = new StemRenderer();
    const score = song([{ ...pluck, fx, fxPatch: [gainPatch(0.25)] }]);
    renderer.render(score, options);
    expect(equal(renderer.render(score, options).pcm, chain)).toBe(true);
  });

  test("the side input reads another track's dry voice", () => {
    // `b` plays its own notes, but its effect patch passes only the side.
    const a = { id: "a", name: "a", instrument: "saw", muted: true };
    const b = {
      id: "b",
      name: "b",
      instrument: "pluck",
      fxPatch: [{ ...gainPatch(1, "in.side"), side: "a" }],
    };
    const keyed = renderScorePcm(song([a, b]), options).pcm;
    const unkeyed = renderScorePcm(
      song([a, { ...b, fxPatch: [gainPatch(1, "in.side")] }]),
      options,
    ).pcm;
    // `a`'s first note sounds from the start; without a side it is silence.
    expect(energy(keyed, 0, 2_000)).toBeGreaterThan(0);
    expect(energy(unkeyed)).toBe(0);
    // The cached render keys on the side track's notes.
    const renderer = new StemRenderer();
    renderer.render(song([a, b]), options);
    const shifted = song([a, b], {}, 7);
    expect(
      equal(
        renderer.render(shifted, options).pcm,
        renderScorePcm(shifted, options).pcm,
      ),
    ).toBe(true);
  });
});

describe("patches on the worker and live paths", () => {
  const refScore = () =>
    song(
      [
        {
          id: "p",
          name: "p",
          instrument: "patch",
          patch: { kind: "patch", ref: "sub", macros: { cut: 2_000 } },
          fxPatch: [gainPatch(0.8)],
        },
      ],
      { patches: { sub: SUB } },
    );

  test("the loop worker renders a patch song byte-identical to the calling thread", async () => {
    const worker = new LoopRenderer({ sampleRate: RATE });
    try {
      expect(worker.offThread).toBe(true);
      const expected = renderScorePcm(refScore(), {
        sampleRate: RATE,
        loop: true,
      });
      const render = await worker.render(refScore());
      expect(equal(render.pcm, expected.pcm)).toBe(true);
    } finally {
      worker.dispose();
    }
  });

  test("a live key plays a library patch, windowed, as a prefix of the full note", () => {
    const synth = new LiveSynth(RATE);
    const request = {
      score: refScore(),
      trackId: "p",
      pitch: 45,
      velocity: 0.9,
      seconds: 3,
    };
    const first = synth.render(request)!;
    expect(first.partial).toBe(true);
    const full = synth.render({ ...request, full: true })!;
    expect(full.partial).toBeUndefined();
    expect(energy(full.pcm)).toBeGreaterThan(0);
    expect(equal(full.pcm.subarray(0, first.pcm.length), first.pcm)).toBe(true);
    // Editing the library patch changes the key: no stale cached note.
    const edited = song(
      [
        {
          id: "p",
          name: "p",
          instrument: "patch",
          patch: { kind: "patch", ref: "sub", macros: { cut: 300 } },
          fxPatch: [gainPatch(0.8)],
        },
      ],
      { patches: { sub: SUB } },
    );
    const other = synth.render({ ...request, score: edited, full: true })!;
    expect(equal(other.pcm, full.pcm)).toBe(false);
  });
});
