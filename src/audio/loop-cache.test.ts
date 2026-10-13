import { expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import { LoopCache, loopCacheKey } from "./loop-cache.ts";
import type { SampleBank } from "./samples.ts";
import { Wavetable } from "./wavetable.ts";

test("finished loops have a one-entry byte cap and independent PCM ownership", () => {
  const cache = new LoopCache(8);
  const audio = {
    pcm: new Int16Array([1, 2, 3, 4]),
    frames: 2,
    sampleRate: 8000,
    channels: 2 as const,
  };
  cache.set("one", audio);
  audio.pcm[0] = 99;
  const first = cache.get("one")!;
  expect(first.pcm[0]).toBe(1);
  first.pcm[1] = 99;
  expect(cache.get("one")!.pcm[1]).toBe(2);
  expect(cache.bytes).toBe(8);
  cache.clear();
  expect(cache.bytes).toBe(0);
  expect(cache.get("one")).toBeUndefined();
  cache.set("two", audio);
  expect(cache.get("one")).toBeUndefined();
  expect(cache.bytes).toBe(8);
  cache.set("large", { ...audio, pcm: new Int16Array(5) });
  expect(cache.bytes).toBe(0);
  expect(cache.get("large")).toBeUndefined();
  const disabled = new LoopCache(0);
  disabled.set("one", audio);
  expect(disabled.get("one")).toBeUndefined();
});

test("loop keys include the complete score, rate and currently loaded asset identities", () => {
  const score = createScore();
  const sample = (sha256: string) => ({
    sha256,
    sampleRate: 8000,
    channels: 1,
    frames: 1,
    mono: new Float32Array([0.25]),
  });
  const banks: SampleBank[] = [
    { voices: new Map(), problems: [] },
    { voices: new Map([["track:kick", sample("a")]]), problems: [] },
    { voices: new Map([["track:kick", sample("b")]]), problems: [] },
    { voices: new Map(), problems: [], irs: new Map([["track", sample("a")]]) },
    { voices: new Map(), problems: [], irs: new Map([["track", sample("b")]]) },
    {
      voices: new Map(),
      problems: [],
      wavetables: new Map([
        [
          "track",
          new Wavetable("a", "a", 1, () => ({
            re: new Float64Array(2048),
            im: new Float64Array(2048),
          })),
        ],
      ]),
    },
    {
      voices: new Map(),
      problems: [],
      wavetables: new Map([
        [
          "track",
          new Wavetable("a", "b", 1, () => ({
            re: new Float64Array(2048),
            im: new Float64Array(2048),
          })),
        ],
      ]),
    },
  ];
  expect(
    new Set(banks.map((bank) => loopCacheKey(score, 8000, bank))).size,
  ).toBe(banks.length);
  expect(loopCacheKey(score, 8000)).not.toBe(loopCacheKey(score, 22050));
  expect(loopCacheKey(score, 8000)).not.toBe(
    loopCacheKey(createScore({ tempoBpm: 90 }), 8000),
  );
});
