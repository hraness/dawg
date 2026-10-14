import { expect, test } from "bun:test";
import { createScore, updateNote } from "../../core/score.ts";
import { renderArranged, renderArrangedPcm } from "./arrange.ts";
import { WindowCache, windowCacheKey } from "./window-cache.ts";
import { StemRenderer } from "./wav.ts";

const audio = (value: number) => ({
  pcm: new Int16Array([value, value, value, value]),
  frames: 2,
  channels: 2 as const,
  sampleRate: 8000,
});

test("window LRU owns transferred and mutated PCM and enforces its byte budget", () => {
  const cache = new WindowCache(16);
  const source = audio(1);
  cache.set("one", source);
  source.pcm.fill(9);
  cache.set("two", audio(2));
  const first = cache.get("one")!;
  expect(first.pcm[0]).toBe(1);
  structuredClone(first.pcm, { transfer: [first.pcm.buffer] });
  cache.set("three", audio(3));
  expect(cache.get("two")).toBeUndefined();
  expect(cache.get("one")!.pcm[0]).toBe(1);
  expect(cache.bytes).toBe(16);
  cache.set("large", { ...audio(4), pcm: new Int16Array(9) });
  expect(cache.bytes).toBe(16);
  cache.clear();
  expect(cache.bytes).toBe(0);
});

test("raw window identities include foreign tracks, seed offsets, assets, rate and guides", () => {
  const song = createScore({
    tracks: [
      { id: "a", instrument: "sine", name: "A" },
      { id: "b", instrument: "kit", name: "B" },
    ],
  });
  const base = { sampleRate: 8000, maxSeconds: 20 };
  const key = windowCacheKey(song, base);
  for (const options of [
    { ...base, sampleRate: 16000 },
    { ...base, guide: true },
    { ...base, seedTick: 1 },
    { ...base, seedSeconds: 1 },
    { ...base, loop: true },
    { ...base, maxSeconds: 21 },
  ])
    expect(windowCacheKey(song, options)).not.toBe(key);
  const changed = createScore({
    ...song.toJSON(),
    tracks: song.tracks.map((t) => (t.id === "b" ? { ...t, pan: 0.5 } : t)),
  });
  expect(windowCacheKey(changed, base)).not.toBe(key);
  const bank = (sha256: string) => ({
    voices: new Map([
      [
        "a:kick",
        {
          sha256,
          sampleRate: 8000,
          channels: 1,
          frames: 1,
          mono: new Float32Array(1),
        },
      ],
    ]),
    problems: [],
  });
  expect(windowCacheKey(song, { ...base, samples: bank("a") })).not.toBe(
    windowCacheKey(song, { ...base, samples: bank("b") }),
  );
});

test("localized long-song edits reuse windows with exact PCM and master reports", () => {
  const song = createScore({
    tempoBpm: 120,
    bars: 32,
    master: { target: -18 },
    tracks: [{ id: "a", instrument: "sine", name: "A" }],
    notes: [0, 8, 16, 24, 31].map((bar) => ({
      id: `n${bar}`,
      trackId: "a",
      pitch: 60 + (bar % 8),
      startTick: bar * 1920,
      durationTicks: 960,
      velocity: 0.4,
    })),
  });
  const cache = new WindowCache(16 * 1024 * 1024);
  const renderer = new StemRenderer({ maxCacheBytes: 0 });
  renderArranged(renderer, song, {
    sampleRate: 8000,
    loop: true,
    windowCache: cache,
  });
  const changed = updateNote(song, "n31", { pitch: 72 });
  const cached = renderArranged(renderer, changed, {
    sampleRate: 8000,
    loop: true,
    windowCache: cache,
  });
  const reference = renderArrangedPcm(changed, {
    sampleRate: 8000,
    loop: true,
  });
  expect(cache.hits).toBeGreaterThan(0);
  expect(cached.pcm).toEqual(reference.pcm);
  expect(cached.master).toEqual(reference.master);
});
