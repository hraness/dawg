import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEMOS, createDemo } from "../../core/demos/index.ts";
import { arrangedSlice } from "../../core/sections.ts";
import { PackStore } from "./packs.ts";
import { SampleLibrary } from "./samples.ts";
import { renderScorePcm } from "./wav.ts";

let directory: string | undefined;
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("all complete demos load offline and render audible finite unclipped peak sections", async () => {
  directory = await mkdtemp(join(tmpdir(), "dawg-demo-audio-"));
  const packs = new PackStore({
    dir: join(directory, "packs"),
    offline: true,
    fetch: async () => {
      throw new Error("demo attempted network access");
    },
  });
  const library = new SampleLibrary({ projectRoot: directory, packs });
  for (const demo of DEMOS) {
    const score = createDemo(demo.id);
    const samples = await library.load(score);
    expect(samples.problems, demo.id).toEqual([]);
    const excerpt = arrangedSlice(score, demo.highlightBar, 1);
    const audio = renderScorePcm(excerpt, {
      sampleRate: 8_000,
      maxSeconds: 3,
      samples,
    });
    let peak = 0,
      energy = 0;
    for (const sample of audio.pcm) {
      peak = Math.max(peak, Math.abs(sample));
      energy += sample * sample;
    }
    expect(audio.nonFinite, demo.id).toBeUndefined();
    expect(peak, demo.id).toBeGreaterThan(1000);
    expect(peak, demo.id).toBeLessThan(32767);
    expect(
      Math.sqrt(energy / audio.pcm.length) / 32768,
      demo.id,
    ).toBeGreaterThan(0.01);
  }
}, 60_000);
