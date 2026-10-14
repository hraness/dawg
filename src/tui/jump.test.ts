import { expect, test } from "bun:test";
import { BUNDLED_SAMPLES } from "../../core/bundled-samples.ts";
import { INSTRUMENT_WORDS } from "../../core/instruments.ts";
import { createScore } from "../../core/score.ts";
import { PRESETS } from "../../core/presets/index.ts";
import { accepts } from "../../test/consistency-lib.ts";
import { fuzzyScore } from "../../tui/search.ts";
import { jumpItems, parseJumpChoice } from "./jump.ts";
import type { MenuContext } from "./menu.ts";

function context(instrument = "saw"): MenuContext {
  return {
    score: createScore({
      bars: 8,
      tracks: [{ id: "lead", name: "Lead", instrument }],
      sections: [
        { name: "Opening", startBar: 0, bars: 4 },
        { name: "Big chorus", startBar: 4, bars: 4 },
      ],
      notes: [],
    }),
    trackId: "lead",
    playing: false,
    grid: "1/16",
    grids: ["1/8", "1/16"],
    clickOn: false,
    countInBars: 1,
  };
}

test("Jump indexes named scenes and uses their stored name without shell quoting", () => {
  const ctx = context();
  const items = jumpItems(ctx);
  const scene = items.find((item) => item.label === "Scene · Big chorus")!;
  expect(parseJumpChoice(scene.value)).toEqual({
    kind: "navigate",
    command: "/section jump Big chorus",
  });
  expect(scene.detail).toContain("bars 5–8");
  expect(accepts(parseJumpChoice(scene.value)!.command, ctx.score)).toBe(true);
});

test("Jump's authoritative sound catalogs prepare commands and never execute them", () => {
  const items = jumpItems(context());
  const commands = new Set(
    items.map((item) => parseJumpChoice(item.value)?.command),
  );
  for (const row of INSTRUMENT_WORDS)
    expect(commands.has(`/instrument ${row.word}`)).toBe(true);
  for (const sample of BUNDLED_SAMPLES)
    expect(commands.has(`/sample use ${sample.id}`)).toBe(true);
  for (const preset of PRESETS)
    expect(commands.has(`/preset ${preset.name}`)).toBe(true);
  for (const item of items.filter((row) =>
    /^(Sound|Sample|Preset|Parameter) ·/u.test(row.label),
  )) {
    expect(parseJumpChoice(item.value)?.kind).toBe("insert");
    expect(item.detail).toContain("insert");
  }
});

test("parameter search reuses current menu values, breadcrumbs and help vocabulary", () => {
  const ctx = context();
  const before = JSON.stringify(ctx);
  const items = jumpItems(ctx);
  expect(JSON.stringify(ctx)).toBe(before);
  const parameters = items.filter((item) =>
    item.label.startsWith("Parameter ·"),
  );
  expect(parameters.length).toBeGreaterThan(100);
  expect(parameters.length).toBeLessThanOrEqual(768);
  const attack = parameters.find((item) =>
    parseJumpChoice(item.value)?.command.startsWith("synth attack "),
  );
  expect(attack).toBeDefined();
  expect(attack!.label).toContain("Sound ›");
  expect(fuzzyScore("attack", attack!.label, attack!.detail)).toBeGreaterThan(
    0,
  );
  const cutoff = parameters.find((item) =>
    parseJumpChoice(item.value)?.command.startsWith("fx filter cutoff "),
  );
  expect(cutoff).toBeDefined();
  expect(new Set(parameters.map((item) => item.value)).size).toBe(
    parameters.length,
  );
});

for (const instrument of [
  "saw",
  "piano",
  "kit",
  "organ",
  "vocal",
  "strings",
  "wavetable",
]) {
  test(`${instrument}: every Jump parameter command is accepted by its current score`, () => {
    const ctx = context(instrument);
    const items = jumpItems(ctx);
    for (const item of items.filter((row) =>
      row.label.startsWith("Parameter ·"),
    )) {
      const choice = parseJumpChoice(item.value)!;
      expect(
        accepts(choice.command, ctx.score),
        `${item.label}: ${choice.command}`,
      ).toBe(true);
    }
  });
}
