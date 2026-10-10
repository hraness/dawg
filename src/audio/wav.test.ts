import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import { engineFor, registerEngine, unregisterEngine } from "./instruments.ts";
import { renderScorePcm, renderScoreWav, StemRenderer } from "./wav.ts";

describe("score WAV renderer", () => {
  test("emits a bounded PCM WAV with audible note data", () => {
    const score = createScore({
      tracks: [{ id: "main" }],
      notes: [
        {
          id: "a",
          trackId: "main",
          start: 0,
          duration: 1,
          pitch: 60,
          velocity: 1,
        },
      ],
    });
    const wav = renderScoreWav(score, { sampleRate: 8_000, maxSeconds: 2 });
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe("WAVE");
    expect(wav.length).toBeGreaterThan(44);
    expect(wav.some((byte, index) => index > 44 && byte !== 0)).toBe(true);
  });

  test("honors track mute and volume controls", () => {
    const loud = createScore({
      tracks: [{ id: "main", volume: 1 }],
      notes: [
        {
          id: "a",
          trackId: "main",
          start: 0,
          duration: 1,
          pitch: 60,
          velocity: 1,
        },
      ],
    });
    const quiet = loud.withTracks([{ id: "main", volume: 0.25 }]);
    const muted = loud.withTracks([{ id: "main", muted: true }]);
    const pcm = (wav: Uint8Array) => {
      const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
      let energy = 0;
      for (let offset = 44; offset + 1 < wav.byteLength; offset += 2)
        energy += Math.abs(view.getInt16(offset, true));
      return energy;
    };
    expect(
      pcm(renderScoreWav(quiet, { sampleRate: 8_000, maxSeconds: 2 })),
    ).toBeLessThan(
      pcm(renderScoreWav(loud, { sampleRate: 8_000, maxSeconds: 2 })),
    );
    expect(
      pcm(renderScoreWav(muted, { sampleRate: 8_000, maxSeconds: 2 })),
    ).toBe(0);
  });

  test("renders piecewise-linear volume automation", () => {
    const steady = createScore({
      ticksPerBeat: 480,
      tracks: [{ id: "main", volume: 1 }],
      notes: [
        {
          id: "a",
          trackId: "main",
          start: 0,
          durationTicks: 960,
          pitch: 60,
          velocity: 1,
        },
      ],
    });
    const fading = steady.withTracks([
      {
        id: "main",
        volume: 1,
        volumeAutomation: [
          { tick: 0, value: 1 },
          { tick: 960, value: 0 },
        ],
      },
    ]);
    const pcm = (wav: Uint8Array) => {
      const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
      let energy = 0;
      for (let offset = 44; offset + 1 < wav.byteLength; offset += 2)
        energy += Math.abs(view.getInt16(offset, true));
      return energy;
    };
    expect(
      pcm(renderScoreWav(fading, { sampleRate: 8_000, maxSeconds: 2 })),
    ).toBeLessThan(
      pcm(renderScoreWav(steady, { sampleRate: 8_000, maxSeconds: 2 })),
    );
  });

  test("renders piecewise-linear pan automation into the stereo field", () => {
    const steady = createScore({
      ticksPerBeat: 480,
      tracks: [{ id: "main", volume: 1, pan: 0 }],
      notes: [
        {
          id: "a",
          trackId: "main",
          start: 0,
          durationTicks: 960,
          pitch: 60,
          velocity: 1,
        },
      ],
    });
    const automated = steady.withTracks([
      {
        id: "main",
        volume: 1,
        pan: 0,
        panAutomation: [
          { tick: 0, value: 0 },
          { tick: 960, value: 1 },
        ],
      },
    ]);
    expect(
      renderScoreWav(automated, { sampleRate: 8_000, maxSeconds: 2 }),
    ).not.toEqual(renderScoreWav(steady, { sampleRate: 8_000, maxSeconds: 2 }));
    const header = new DataView(
      renderScoreWav(automated, { sampleRate: 8_000, maxSeconds: 2 }).buffer,
    );
    expect(header.getUint16(22, true)).toBe(2);
    expect(header.getUint32(28, true)).toBe(8_000 * 4);
    expect(header.getUint16(32, true)).toBe(4);
  });

  test("cached stems render byte-identical to a cold render", () => {
    const instruments = ["kit", "sine", "saw", "bass", "piano", "square"];
    const base = {
      tempoBpm: 120,
      bars: 2,
      tracks: instruments.map((instrument, t) => ({
        id: `t${t}`,
        name: instrument,
        instrument,
        pan: (t - 2) / 3,
        volume: 0.9,
        ...(t % 2 ? { filter: { cutoff: 3000, resonance: 0.4 } } : {}),
        ...(t % 3 === 0
          ? { delay: { beats: 0.5, feedback: 0.4, mix: 0.3 } }
          : {}),
        ...(t === 1 ? { reverb: { mix: 0.3, size: 0.5 } } : {}),
      })),
      notes: instruments.flatMap((_, t) =>
        Array.from({ length: 8 }, (_, i) => ({
          id: `t${t}-${i}`,
          trackId: `t${t}`,
          pitch: t === 0 ? 36 + (i % 3) : 48 + ((i * 5 + t) % 12),
          startTick: i * 480,
          durationTicks: 360,
          velocity: 0.8,
        })),
      ),
    };
    const options = { sampleRate: 8_000, loop: true } as const;
    const cold = (data: typeof base) =>
      renderScorePcm(createScore(data), options).pcm;
    const cached = new StemRenderer();
    const warm = (data: typeof base) =>
      cached.render(createScore(data), options).pcm;
    expect(warm(base)).toEqual(cold(base));
    expect(cached.cache.stems).toBe(instruments.length);
    // One note edit, a mute, a solo, a track setting and a tempo change each
    // match a cold render exactly, re-rendering only what they touched.
    const edited = {
      ...base,
      notes: base.notes.map((note, i) =>
        i === 10 ? { ...note, pitch: note.pitch + 3 } : note,
      ),
    };
    expect(warm(edited)).toEqual(cold(edited));
    const muted = {
      ...edited,
      tracks: edited.tracks.map((track, t) =>
        t === 2 ? { ...track, muted: true } : track,
      ),
    };
    expect(warm(muted)).toEqual(cold(muted));
    const soloed = {
      ...muted,
      tracks: muted.tracks.map((track, t) =>
        t === 4 ? { ...track, solo: true } : track,
      ),
    };
    expect(warm(soloed)).toEqual(cold(soloed));
    const panned = {
      ...edited,
      tracks: edited.tracks.map((track, t) =>
        t === 3 ? { ...track, pan: 0.8 } : track,
      ),
    };
    expect(warm(panned)).toEqual(cold(panned));
    const faster = { ...panned, tempoBpm: 140 };
    expect(warm(faster)).toEqual(cold(faster));
    // Toggling back to a cached state and removing a track stay exact.
    expect(warm(panned)).toEqual(cold(panned));
    const fewer = {
      ...panned,
      tracks: panned.tracks.slice(1),
      notes: panned.notes.filter((note) => note.trackId !== "t0"),
    };
    expect(warm(fewer)).toEqual(cold(fewer));
    expect(cached.cache.stems).toBe(instruments.length - 1);
    // One-shot exports take the same path.
    expect(
      cached.render(createScore(fewer), { sampleRate: 8_000 }).pcm,
    ).toEqual(renderScorePcm(createScore(fewer), { sampleRate: 8_000 }).pcm);
  });

  test("changing one patch macro re-renders only that stem", () => {
    const patch = {
      kind: "patch",
      role: "instrument",
      name: "tone",
      nodes: [
        { id: "osc", type: "osc", params: { wave: "saw", level: 0.3 } },
        { id: "vcf", type: "svf", params: { cutoff: 800 } },
      ],
      cables: [
        { id: "c1", from: "voice.pitch", to: "osc.pitch" },
        { id: "c2", from: "osc.out", to: "vcf.in" },
        { id: "c3", from: "vcf.out", to: "out.audio" },
      ],
      macros: [
        {
          id: "cut",
          min: 100,
          max: 5_000,
          default: 800,
          to: [{ port: "vcf.cutoff" }],
        },
      ],
    };
    const data = (cut: number) => ({
      tempoBpm: 120,
      patches: { tone: patch },
      bars: 1,
      tracks: ["a", "b", "c"].map((id) => ({
        id,
        name: id,
        instrument: "patch",
        patch: {
          kind: "patch",
          ref: "tone",
          ...(id === "b" ? { macros: { cut } } : {}),
        },
      })),
      notes: ["a", "b", "c"].map((trackId, i) => ({
        id: `n${i}`,
        trackId,
        pitch: 48 + i * 4,
        startTick: i * 240,
        durationTicks: 480,
        velocity: 0.8,
      })),
    });
    try {
      const options = { sampleRate: 8_000, loop: true } as const;
      const cached = new StemRenderer();
      const first = cached.render(createScore(data(800) as never), options);
      expect(cached.rendered).toEqual(["a", "b", "c"]);
      const moved = createScore(data(2_400) as never);
      const second = cached.render(moved, options);
      expect(cached.rendered).toEqual(["b"]);
      expect(second.pcm).not.toEqual(first.pcm);
      expect(second.pcm).toEqual(renderScorePcm(moved, options).pcm);
    } finally {
    }
  });

  test("the stem cache stays within its byte budget", () => {
    const data = {
      tempoBpm: 120,
      bars: 1,
      tracks: ["a", "b", "c"].map((id) => ({
        id,
        name: id,
        instrument: "sine",
      })),
      notes: ["a", "b", "c"].map((id) => ({
        id: `${id}1`,
        trackId: id,
        pitch: 60,
        startTick: 0,
        durationTicks: 480,
        velocity: 0.8,
      })),
    };
    const score = createScore(data);
    const options = { sampleRate: 8_000, loop: true } as const;
    const oneStem = new StemRenderer().render(score, options);
    const unbounded = new StemRenderer();
    unbounded.render(score, options);
    const perStem = unbounded.cache.bytes / 3;
    const small = new StemRenderer({ maxCacheBytes: perStem * 2 });
    expect(small.render(score, options).pcm).toEqual(oneStem.pcm);
    expect(small.cache.stems).toBeLessThanOrEqual(2);
    expect(small.cache.bytes).toBeLessThanOrEqual(perStem * 2);
    expect(small.render(score, options).pcm).toEqual(oneStem.pcm);
  });
});
