import { expect, test } from "bun:test";
import { GOLD } from "../../core/distill/hyperpop/chart/gold/index.ts";
import { readWorkflowResource } from "../workflows/catalog.ts";
import { CHART_INPUT_LIMITS, parseSongChart } from "./song.ts";

const example = async () =>
  JSON.parse(
    await readWorkflowResource(
      "original-house",
      "examples/original.chart.json",
    ),
  ) as Record<string, unknown>;

test("bounded chart parser accepts the portable example and existing legacy charts", async () => {
  const input = await example();
  expect(JSON.stringify(parseSongChart(input, { house: true }))).toBe(
    JSON.stringify(input),
  );
  for (const chart of GOLD) expect(parseSongChart(chart)).toEqual(chart);
  const parsed = parseSongChart(input);
  expect(parsed).not.toBe(input);
});

test("unknown charts reject malformed required fields, nested values and unbounded material", async () => {
  const chart = await example();
  for (const bpm of [undefined, null, "122", NaN, Infinity, 201])
    expect(() => parseSongChart({ ...chart, bpm })).toThrow("bpm");
  for (const sounds of [
    undefined,
    [],
    {},
    { ...(chart.sounds as object), design: { brightness: "loud" } },
  ])
    expect(() => parseSongChart({ ...chart, sounds })).toThrow("sounds");
  expect(() => parseSongChart({ ...chart, ignored: "extra" })).toThrow(
    "unsupported fields",
  );
  const section = (chart.sections as Record<string, unknown>[])[0]!;
  for (const patch of [
    { bars: 2.5 },
    { play: ["pad", "pad"] },
    { sing: [null] },
    { sing: [{ bar: 0, rhythm: "x".repeat(65), notes: "1" }] },
    {
      moves: [
        {
          move: "stutter",
          bar: 0,
          beat: 0,
          count: 100000,
          step: 1,
          notes: "1",
          word: "hi",
        },
      ],
    },
  ])
    expect(() =>
      parseSongChart({ ...chart, sections: [{ ...section, ...patch }] }),
    ).toThrow("invalid chart");
  expect(() =>
    parseSongChart({
      ...chart,
      sections: Array(CHART_INPUT_LIMITS.sections + 1).fill(section),
    }),
  ).toThrow("sections");
  expect(() =>
    parseSongChart({ ...chart, title: "a".repeat(CHART_INPUT_LIMITS.bytes) }),
  ).toThrow("256 KiB");
});

test("house restrictions apply consistently without preventing explicit legacy parsing", async () => {
  const chart = await example();
  const section = (chart.sections as Record<string, unknown>[])[0]!;
  const legacy = {
    ...chart,
    mode: "dorian",
    bpm: 95,
    sections: [{ ...section, chords: "i IV" }],
  };
  expect(parseSongChart(legacy).mode).toBe("dorian");
  expect(() => parseSongChart(legacy, { house: true })).toThrow(
    "diatonic major",
  );
  const borrowed = {
    ...chart,
    sections: [{ ...section, chords: "I iv bVI bVII" }],
  };
  expect(parseSongChart(borrowed).sections).toHaveLength(1);
  expect(() => parseSongChart(borrowed, { house: true })).toThrow("diatonic");
});

test("stutter move degrees and performer-only semantics are checked before admission", async () => {
  const chart = await example();
  const section = (chart.sections as Record<string, unknown>[])[0]!;
  const move = {
    move: "stutter",
    bar: 0,
    beat: 0,
    count: 1,
    step: 0.25,
    notes: "banana",
    word: "go",
  };
  expect(() =>
    parseSongChart({ ...chart, sections: [{ ...section, moves: [move] }] }),
  ).toThrow("not a degree");
  expect(() =>
    parseSongChart({
      ...chart,
      sections: [{ ...section, moves: [{ ...move, notes: "1garbage" }] }],
    }),
  ).toThrow("not a degree");
  expect(
    parseSongChart({
      ...chart,
      sections: [{ ...section, moves: [{ ...move, notes: "1 3, 5'" }] }],
    }).sections[0]!.moves,
  ).toHaveLength(1);
});
