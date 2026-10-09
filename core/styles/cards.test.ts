/**
 * Every style in the registry (quality-08). Family lanes add cards; this
 * file checks them all with no per-card code:
 *
 * - every taxonomy id resolves, generates for 3 seeds at 8 bars and passes
 *   every numeric pattern check in validate.ts;
 * - generation is deterministic (same seed, same score JSON);
 * - every written card (and a fixed sample of inherited leaves) renders a
 *   one-bar excerpt with sound, no NaN and no clipping, and every fifth of
 *   them renders identical bytes a second time.
 */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { renderScorePcm } from "../../src/audio/wav.ts";
import { excerptScore } from "./excerpt.ts";
import { generateStyle } from "./generate.ts";
import { LEAF_IDS, STYLE_CARDS, STYLE_IDS } from "./index.ts";
import { validateGenerated } from "./validate.ts";

const SEEDS = [1, 2, 3];
const BARS = 8;
const RATE = 8_000;
/** Inherited leaves rendered besides the written cards: every Nth leaf. */
const LEAF_SAMPLE_STRIDE = 12;
/**
 * Rendered styles re-rendered for the byte-identity check: every Nth. The
 * render path is deterministic by construction (seeded, offline), so a
 * sample keeps the suite fast with hundreds of cards (about 40 ms each).
 */
const RERENDER_STRIDE = 5;

const renderIds = [
  ...new Set([
    ...STYLE_CARDS.keys(),
    ...LEAF_IDS.filter((_, i) => i % LEAF_SAMPLE_STRIDE === 0),
  ]),
];

const sha = (pcm: Int16Array) =>
  createHash("sha256")
    .update(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength))
    .digest("hex");

describe("style cards: pattern checks", () => {
  test("the registry is not empty", () => {
    expect(STYLE_IDS.length).toBeGreaterThan(500);
    expect(STYLE_CARDS.size).toBeGreaterThan(0);
  });

  test(`every style passes validate for seeds ${SEEDS.join(", ")}`, () => {
    const failures: string[] = [];
    for (const id of STYLE_IDS)
      for (const seed of SEEDS) {
        try {
          const report = validateGenerated(
            generateStyle(id, { seed, bars: BARS }),
          );
          for (const check of report.checks)
            if (!check.ok)
              failures.push(`${id}#${seed} ${check.name}: ${check.detail}`);
        } catch (error) {
          failures.push(`${id}#${seed} threw: ${String(error)}`);
        }
      }
    expect(failures).toEqual([]);
    // Every card, three seeds: the registry grows with each family.
  }, 60_000);

  test("generation is deterministic per seed and varies across seeds", () => {
    const same: string[] = [];
    for (const id of STYLE_CARDS.keys()) {
      const a = JSON.stringify(generateStyle(id, { seed: 7, bars: BARS }).data);
      const b = JSON.stringify(generateStyle(id, { seed: 7, bars: BARS }).data);
      expect(a).toBe(b);
      const c = JSON.stringify(generateStyle(id, { seed: 8, bars: BARS }).data);
      if (a === c) same.push(id);
    }
    expect(same).toEqual([]);
  });
});

describe("style cards: rendered excerpt", () => {
  test(`${renderIds.length} styles sound, never clip; a sample renders identically`, () => {
    const failures: string[] = [];
    for (const [index, id] of renderIds.entries()) {
      const score = excerptScore(generateStyle(id, { seed: 1, bars: BARS }));
      const first = renderScorePcm(score, { sampleRate: RATE }).pcm;
      let peak = 0;
      let full = 0;
      for (const value of first) {
        const x = Math.abs(value);
        if (x > peak) peak = x;
        if (x >= 32_767) full += 1;
      }
      // Int16 output cannot hold NaN; a NaN anywhere in the float mix
      // renders as silence or full scale, which these bounds catch.
      if (peak < 300) failures.push(`${id}: silent (peak ${peak})`);
      if (full > 0) failures.push(`${id}: ${full} clipped samples`);
      if (index % RERENDER_STRIDE !== 0) continue;
      const again = renderScorePcm(score, { sampleRate: RATE }).pcm;
      if (sha(first) !== sha(again)) failures.push(`${id}: bytes differ`);
    }
    expect(failures).toEqual([]);
  }, 300_000);
});
