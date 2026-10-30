import { expect, test } from "bun:test";
import type { Chart } from "../../core/distill/hyperpop/chart/format.ts";
import { performChart } from "../../core/distill/hyperpop/chart/perform.ts";
import {
  vocalTrack,
  doubleTrack,
  chopTrack,
  stutterTrack,
  voiceLeadTrack,
  grainTrack,
} from "../../core/demos/hyperpop.ts";
import { vocalBookForChart } from "../vocals/chart.ts";
import { readWorkflowResource } from "../workflows/catalog.ts";
import { instrumentalChart } from "./song.ts";

test("stock realization preserves every authored note and lower verse register", async () => {
  const chart = JSON.parse(
    await readWorkflowResource(
      "original-house",
      "examples/original.chart.json",
    ),
  ) as Chart;
  const performed = performChart(chart);
  const spec = vocalBookForChart(chart);
  for (const phrase of performed.phrases) {
    const part = spec.parts.find(([name]) => name === phrase.key)!;
    expect(part[2].map((note) => note.midi)).toEqual(
      phrase.notes.map((note) => note[1]),
    );
    expect(part[2].map((note) => note.syl)).toEqual(
      phrase.notes.map((note) => note[3]),
    );
  }
  expect(spec.root).toBeGreaterThanOrEqual(54);
  expect(spec.root).toBeLessThanOrEqual(66);
});

test("performer resolves all sampled vocal layers from a local immutable book", async () => {
  const chart = JSON.parse(
    await readWorkflowResource(
      "original-house",
      "examples/original.chart.json",
    ),
  ) as Chart;
  const spec = vocalBookForChart(chart);
  const src = "tracks/voice/samples/vocals/take/take.wav";
  const book = {
    sample: "local-take",
    root: spec.root,
    syllables: spec.syllables,
    lines: spec.lines,
    heads: spec.heads,
    entry: {
      src,
      sha256: "a".repeat(64),
      slices: spec.parts.map(([name], i) => ({
        name,
        begin: i / spec.parts.length,
        end: (i + 1) / spec.parts.length,
      })),
    },
  };
  const score = performChart(chart, book).score;
  // Shared legacy-demo helpers must preserve normalized-stock conditioning.
  // A stronger makeup or a second layer trim can overload or mask a new take.
  const lead = score.tracks.find((track) => track.id === "bvox")!;
  expect(lead.fx?.compressor?.makeup).toBe(8);
  expect(lead.fx?.eq?.low).toBe(0);
  expect(lead.delay?.feedback).toBe(0.42);
  expect(lead.reverb?.fade).toBe(2.2);
  expect(lead.fx?.postgain?.gain).toBe(1.1);
  expect(score.master?.glue?.ratio).toBe(1.5);
  expect(score.master?.tape).toBeUndefined();
  expect(score.master?.width?.width).toBe(1);
  expect(score.master?.limiter?.gain).toBe(0);
  expect(
    score.tracks.find((track) => track.id === "snare")?.fx?.eq,
  ).toBeUndefined();
  expect(score.tracks.find((track) => track.id === "hats")?.fx?.eq?.high).toBe(
    8,
  );
  for (const track of [
    doubleTrack(book, 0.5),
    chopTrack(book, 0.5),
    stutterTrack(book, 0.5),
    voiceLeadTrack(book, 0.5),
    grainTrack(book, 0.5),
  ])
    expect(track.volume).toBe(0.5);
  const refs = [
    vocalTrack(book, 0.5),
    doubleTrack(book, 0.2),
    chopTrack(book, 0.2),
    stutterTrack(book, 0.2),
    voiceLeadTrack(book, 0.2),
    grainTrack(book, 0.2),
  ].flatMap((track) =>
    track.sampler
      ? Object.values(track.sampler.voices)
      : track.granular && typeof track.granular.src === "object"
        ? [track.granular.src]
        : [],
  );
  expect(refs.length).toBeGreaterThan(5);
  expect(
    refs.every((ref) => ref.src === src && ref.sha256 === "a".repeat(64)),
  ).toBe(true);
  expect(score.notes.some((note) => note.trackId === "bvox")).toBe(true);
  expect(
    instrumentalChart(chart)
      .tracks.filter((track) => track.instrument === "vocal")
      .every((track) => track.muted),
  ).toBe(true);
});
