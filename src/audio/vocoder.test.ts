/**
 * The vocoder (0.7, vocoder.md §9): the channel bank and talkbox on the
 * synthetic voice fixture, the built-in carrier, the StemRenderer stage and
 * its modulator tap, determinism and the absent-field identity.
 */
import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { createScore, updateTrack, type TrackInput } from "../../core/score.ts";
import { printTrack } from "../../core/sdk/print.ts";
import {
  song as sdkSong,
  track as sdkTrack,
  vocoder as sdkVocoder,
} from "../../core/sdk/v1.ts";
import { melody, synthVoice } from "./fixtures/voice.ts";
import { sampleKey, type DecodedSample, type SampleBank } from "./samples.ts";
import { applySectionChanges } from "../../core/sections.ts";
import { renderArrangedPcm } from "./arrange.ts";
import { renderScorePcm, StemRenderer } from "./wav.ts";
import { mergeChordChanges } from "./vocoder/index.ts";
import { VOCODER_PRESETS } from "../../core/vocoder.ts";

const SR = 22_050;
const VOICE = synthVoice(melody(57), { sr: SR, seed: 7 });

function voiceSample(): DecodedSample {
  const mono = Float32Array.from(VOICE.x);
  return {
    sha256: "v".repeat(64),
    sampleRate: SR,
    channels: 1,
    frames: mono.length,
    mono,
  };
}

function bank(): SampleBank {
  return {
    voices: new Map([[sampleKey("vox", "v"), voiceSample()]]),
    problems: [],
  };
}

/** 120 BPM, 4/4, 4 bars = 8 s: the vocal as one held sampler note. */
function songOf(carrier: Partial<TrackInput> | undefined, notes = true) {
  const tracks: TrackInput[] = [
    {
      id: "vox",
      name: "Vox",
      instrument: "sampler",
      sampler: { mode: "oneshot", voices: { v: { src: "v.wav" } } },
    },
  ];
  if (carrier)
    tracks.push({ id: "pad", name: "Pad", instrument: "vocoder", ...carrier });
  return createScore({
    tempoBpm: 120,
    bars: 4,
    tracks,
    notes: [
      {
        id: "n1",
        trackId: "vox",
        pitch: 36,
        startTick: 0,
        durationTicks: 480 * 16,
        velocity: 1,
      },
      ...(carrier && notes
        ? [45, 52, 57].map((pitch, index) => ({
            id: `c${index}`,
            trackId: "pad",
            pitch,
            startTick: 0,
            durationTicks: 480 * 16,
            velocity: 0.8,
          }))
        : []),
    ],
  });
}

const hash = (pcm: Int16Array) =>
  createHash("sha256").update(pcm).digest("hex");

function rms(pcm: Int16Array): number {
  let sum = 0;
  for (const v of pcm) sum += (v / 32768) ** 2;
  return Math.sqrt(sum / pcm.length);
}

describe("vocoder stage", () => {
  test("a carrier vocoded by the vocal sounds, deterministically", () => {
    const score = songOf({ vocoder: { src: "vox" } });
    const muted = updateTrack(score, "vox", { muted: true });
    const a = renderScorePcm(muted, { sampleRate: SR, samples: bank() });
    const b = renderScorePcm(muted, { sampleRate: SR, samples: bank() });
    expect(hash(a.pcm)).toBe(hash(b.pcm));
    expect(rms(a.pcm)).toBeGreaterThan(0.01);
    console.log("rms", rms(a.pcm));
  }, 60_000);
});

/** `bars` bars of the vocal every 4 bars against a held carrier chord. */
function longSong(
  bars: number,
  carrier: Partial<TrackInput>,
  extra: TrackInput[] = [],
) {
  const ticks = 480 * 4;
  return createScore({
    tempoBpm: 120,
    bars,
    tracks: [
      {
        id: "vox",
        name: "Vox",
        instrument: "sampler",
        muted: true,
        sampler: { mode: "oneshot", voices: { v: { src: "v.wav" } } },
      },
      { id: "pad", name: "Pad", instrument: "vocoder", ...carrier },
      ...extra,
    ],
    notes: [
      ...Array.from({ length: Math.ceil(bars / 4) }, (_, k) => ({
        id: `v${k}`,
        trackId: "vox",
        pitch: 36,
        startTick: k * 4 * ticks,
        durationTicks: 4 * ticks,
        velocity: 1,
      })),
      // Re-struck every 4 bars: a chord held across windows restarts there
      // with a new phase (arrange.ts), which is not the vocoder's doing.
      ...Array.from({ length: Math.ceil(bars / 4) }, (_, k) =>
        [45, 52, 57].map((pitch, index) => ({
          id: `c${k}-${index}`,
          trackId: "pad",
          pitch: pitch + (k % 2 ? 2 : 0),
          startTick: k * 4 * ticks,
          durationTicks: 4 * ticks,
          velocity: 0.8,
        })),
      ).flat(),
    ],
  });
}

function maxDiff(a: Int16Array, b: Int16Array, count = a.length) {
  let most = 0;
  for (let i = 0; i < count; i += 1)
    most = Math.max(most, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  return most;
}

describe("vocoder identity, windows and cache (tests 1-3, 15)", () => {
  test("1: vocoder {} without src is byte-identical to no field", () => {
    const plain = songOf(undefined);
    const withPad = (vocoder: object | undefined) =>
      createScore({
        ...plain.toJSON(),
        tracks: [
          ...plain.tracks,
          {
            id: "lead",
            name: "Lead",
            instrument: "supersaw",
            ...(vocoder ? { vocoder } : {}),
          },
        ],
        notes: [
          ...plain.notes,
          {
            id: "l1",
            trackId: "lead",
            pitch: 57,
            startTick: 0,
            durationTicks: 1920,
            velocity: 0.8,
          },
        ],
      } as never);
    const a = renderScorePcm(withPad(undefined), {
      sampleRate: SR,
      samples: bank(),
    });
    const b = renderScorePcm(withPad({}), { sampleRate: SR, samples: bank() });
    expect(hash(b.pcm)).toBe(hash(a.pcm));
  }, 60_000);

  test("2: fresh and warm renderers agree byte for byte", () => {
    const score = updateTrack(
      songOf({ vocoder: { src: "vox", preset: "choir" } }),
      "vox",
      { muted: true },
    );
    const cold = renderScorePcm(score, { sampleRate: SR, samples: bank() });
    const warm = new StemRenderer();
    warm.render(score, { sampleRate: SR, samples: bank() });
    const again = warm.render(score, { sampleRate: SR, samples: bank() });
    expect(hash(again.pcm)).toBe(hash(cold.pcm));
  }, 60_000);

  test("2: a warm renderer follows source volume edits like a cold one", () => {
    const options = { sampleRate: SR, samples: bank() };
    const score = updateTrack(songOf({ vocoder: { src: "vox" } }), "vox", {
      muted: true,
    });
    const warm = new StemRenderer();
    const first = warm.render(score, options);
    for (const edit of [
      { volume: 0.2 },
      {
        volumeAutomation: [
          { tick: 0, value: 1 },
          { tick: 480 * 8, value: 0.1 },
        ],
      },
    ]) {
      const edited = updateTrack(score, "vox", edit as never);
      const again = warm.render(edited, options);
      const cold = renderScorePcm(edited, options);
      expect(hash(again.pcm)).toBe(hash(cold.pcm));
      // The tap is unity gain: a muted source's volume never moves the carrier.
      expect(hash(cold.pcm)).toBe(hash(first.pcm));
    }
  }, 60_000);

  test("3: a windowed 56 s render equals one pass", () => {
    const rate = 8000;
    for (const vocoder of [
      { src: "vox", unvoiced: 0.5 },
      { src: "vox", preset: "talkbox", unvoiced: 0.5 },
      { src: "vox", preset: "choir", carrier: "supersaw", gate: -50 },
      { src: "vox", follow: "drone", carrier: "supersaw" },
    ] as const) {
      const score = longSong(28, { vocoder });
      const audio = renderArrangedPcm(score, {
        sampleRate: rate,
        samples: bank(),
      });
      const single = renderScorePcm(applySectionChanges(score), {
        sampleRate: rate,
        samples: bank(),
        maxSeconds: 70,
      });
      expect(audio.frames).toBe(single.frames);
      expect(maxDiff(audio.pcm, single.pcm)).toBeLessThanOrEqual(2);
    }
  }, 120_000);

  test("15: the cache re-renders the carrier only when its tap changes", () => {
    const options = { sampleRate: SR, samples: bank() };
    // The source carries a reverb and a delay from the start: adding one
    // lengthens the render's tail, which re-renders every stem.
    const base = updateTrack(songOf({ vocoder: { src: "vox" } }), "vox", {
      reverb: { mix: 0.2, size: 0.5 },
      delay: { beats: 0.5, feedback: 0.3, mix: 0.2 },
    });
    const renderer = new StemRenderer();
    const stems = () =>
      (renderer as unknown as { stems: Map<string, { left: Float64Array }> })
        .stems;
    const first = renderer.render(base, options);
    const pad = stems().get("pad")!.left;
    const same = (edit: Parameters<typeof updateTrack>[2], id = "vox") => {
      const out = renderer.render(updateTrack(base, id, edit), options);
      const kept = stems().get("pad")!.left === pad;
      renderer.render(base, options);
      return { kept, out };
    };
    // Post-tap edits on the source keep the carrier's stem.
    expect(same({ pan: 0.5 }).kept).toBe(true);
    // (Edits that keep the render length: a longer tail resizes every stem.)
    const reverb = same({ reverb: { mix: 0.4, size: 0.5 } });
    expect(reverb.out.frames).toBe(first.frames);
    expect(reverb.kept).toBe(true);
    const delay = same({ delay: { beats: 0.5, feedback: 0.3, mix: 0.4 } });
    expect(delay.out.frames).toBe(first.frames);
    expect(delay.kept).toBe(true);
    expect(same({ fx: { chorus: {} } } as never).kept).toBe(true);
    // Muting the source keeps the carrier and its bytes.
    const muted = same({ muted: true });
    expect(muted.kept).toBe(true);
    // Tap edits (gain, a pre-pan effect) re-render the carrier.
    expect(same({ fx: { distort: {} } } as never).kept).toBe(false);
    expect(
      same({
        sampler: {
          mode: "oneshot",
          gain: 0.5,
          voices: { v: { src: "v.wav" } },
        },
      } as never).kept,
    ).toBe(false);
    // A carrier edit re-renders the carrier but not the source.
    const vox = stems().get("vox")!.left;
    expect(same({ vocoder: { src: "vox", mix: 0.5 } }, "pad").kept).toBe(false);
    expect(stems().get("vox")!.left).toBe(vox);
    expect(first.frames).toBeGreaterThan(0);
  }, 60_000);

  test("15: muting the source never changes the carrier's bytes", () => {
    const options = { sampleRate: SR, samples: bank() };
    const base = songOf({ vocoder: { src: "vox" } });
    const solo = (score: typeof base) =>
      renderScorePcm(updateTrack(score, "pad", { solo: true }), options);
    const a = solo(base);
    const b = solo(updateTrack(base, "vox", { muted: true }));
    expect(hash(b.pcm)).toBe(hash(a.pcm));
  }, 60_000);
});

describe("vocoder SDK and printer", () => {
  test("vocoder() as instrument and field, slug src resolution", () => {
    const back = sdkSong({
      tempo: 120,
      bars: 1,
      tracks: [
        sdkTrack({ id: "t-vox", name: "Lead Vox", notes: [] }),
        sdkTrack({
          id: "t-voc",
          name: "voc",
          instrument: sdkVocoder("talkbox", { src: "lead-vox", formant: 2 }),
          notes: [],
        }),
        sdkTrack({
          id: "t-lead",
          name: "lead",
          instrument: "supersaw",
          vocoder: sdkVocoder({ src: "t-vox", bands: 24 }),
          notes: [],
        }),
        sdkTrack({
          id: "t-bare",
          name: "bare",
          instrument: "vocoder",
          notes: [],
        }),
      ],
    });
    const voc = back.tracks.find((t) => t.id === "t-voc")!;
    expect([voc.instrument, voc.vocoder]).toEqual([
      "vocoder",
      { preset: "talkbox", src: "t-vox", formant: 2 },
    ]);
    const lead = back.tracks.find((t) => t.id === "t-lead")!;
    expect([lead.instrument, lead.vocoder]).toEqual([
      "supersaw",
      { src: "t-vox", bands: 24 },
    ]);
    const bare = back.tracks.find((t) => t.id === "t-bare")!;
    expect([bare.instrument, bare.vocoder]).toEqual(["vocoder", {}]);
    const score = createScore(back as never);
    expect(printTrack(score, score.tracks[1]!)).toContain(
      'instrument: vocoder("talkbox", { src: "lead-vox", formant: 2 }),',
    );
    const printedLead = printTrack(score, score.tracks[2]!);
    expect(printedLead).toContain('instrument: "supersaw",');
    expect(printedLead).toContain(
      'vocoder: vocoder({ src: "lead-vox", bands: 24 }),',
    );
    expect(printedLead).toContain('import { track, vocoder } from "dawg";');
    expect(printTrack(score, score.tracks[3]!)).toContain(
      'instrument: "vocoder",',
    );
  }, 60_000);

  test("slug errors: none, ambiguous, self", () => {
    const make = (src: string, extra: string[] = []) =>
      sdkSong({
        tempo: 120,
        bars: 1,
        tracks: [
          ...extra.map((name, i) => sdkTrack({ id: `x${i}`, name, notes: [] })),
          sdkTrack({
            id: "c",
            name: "carrier",
            instrument: sdkVocoder({ src }),
            notes: [],
          }),
        ],
      });
    expect(() => make("nobody")).toThrow(/names no track/);
    expect(() => make("vox", ["Vox", "vox"])).toThrow(/matches 2 tracks/);
    expect(() => make("carrier")).toThrow(/cannot vocode itself/);
    expect(() => sdkVocoder({ bands: 99 })).toThrow(/bands/);
    expect(() => sdkVocoder("nope" as never)).toThrow(/preset/);
  }, 60_000);
});

describe("chord-following carrier", () => {
  test("a staccato bass under a held chord never chops the carrier", () => {
    const rate = 16_000;
    const build = (bass: boolean) =>
      createScore({
        tempoBpm: 120,
        bars: 2,
        tracks: [
          { id: "keys", name: "keys", instrument: "epiano" },
          { id: "bass", name: "bass", instrument: "sine" },
          {
            id: "pad",
            name: "pad",
            instrument: "vocoder",
            solo: true,
            vocoder: { preset: "choir", follow: "chords", mix: 0 },
          },
        ],
        notes: [
          ...[57, 60, 64].map((pitch, i) => ({
            id: `k${i}`,
            trackId: "keys",
            pitch,
            startTick: 0,
            durationTicks: 480 * 8,
            velocity: 0.8,
          })),
          ...(bass
            ? Array.from({ length: 16 }, (_, i) => ({
                id: `b${i}`,
                trackId: "bass",
                pitch: 45,
                startTick: i * 240,
                durationTicks: 90,
                velocity: 0.9,
              }))
            : []),
        ],
      } as never);
    const dips = (bass: boolean) => {
      const { pcm } = renderScorePcm(build(bass), { sampleRate: rate });
      const frame = Math.round(0.002 * rate) * 2;
      const levels: number[] = [];
      // The held chord's interior, 0.2 s in to 3.8 s (the chord ends at 4 s).
      for (let at = 0.2 * rate * 2; at + frame < 3.8 * rate * 2; at += frame) {
        let sum = 0;
        for (let i = at; i < at + frame; i += 1) sum += (pcm[i]! / 32768) ** 2;
        levels.push(10 * Math.log10(sum / frame + 1e-12));
      }
      const median = [...levels].sort((a, b) => a - b)[levels.length >> 1]!;
      return median - Math.min(...levels);
    };
    // Before the merge the bass re-struck the pad: a 17 dB dip at 2 ms.
    const held = dips(false);
    const staccato = dips(true);
    expect(staccato).toBeLessThan(held + 1);
    expect(staccato).toBeLessThan(10);
  }, 60_000);

  test("mergeChordChanges joins equal sets and holds short silences", () => {
    const merged = mergeChordChanges(
      [
        { start: 0, end: 100, pcs: [0, 4, 9] },
        { start: 100, end: 200, pcs: [0, 4, 9] },
        { start: 200, end: 230, pcs: [] },
        { start: 230, end: 400, pcs: [0, 4, 9] },
        { start: 400, end: 900, pcs: [] },
        { start: 900, end: 1000, pcs: [2, 5, 9] },
      ],
      50,
    );
    expect(merged).toEqual([
      { start: 0, end: 400, pcs: [0, 4, 9] },
      { start: 400, end: 900, pcs: [] },
      { start: 900, end: 1000, pcs: [2, 5, 9] },
    ]);
  }, 60_000);
});

describe("preset levels", () => {
  test("every preset lands within a 3 dB spread on the fixture", () => {
    const levels: Record<string, number> = {};
    for (const preset of Object.keys(VOCODER_PRESETS)) {
      const score = updateTrack(
        songOf({ vocoder: { src: "vox", preset: preset as never } }),
        "vox",
        { muted: true },
      );
      const { pcm } = renderScorePcm(score, {
        sampleRate: SR,
        samples: bank(),
      });
      levels[preset] = 20 * Math.log10(rms(pcm));
    }
    const values = Object.values(levels);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThan(3);
    // lofi's narrow layout is made up by its preset gain.
    const others = values.filter((_, i) => Object.keys(levels)[i] !== "lofi");
    const median = others.sort((a, b) => a - b)[others.length >> 1]!;
    expect(Math.abs(levels.lofi! - median)).toBeLessThan(3);
  }, 60_000);
});

describe("vocoder over audio clips (0.7 clips lane)", () => {
  function clipSong(startTick: number) {
    return createScore({
      tempoBpm: 120,
      bars: 4,
      tracks: [
        {
          id: "vox",
          name: "Vox",
          instrument: "vocal",
          muted: true,
          clips: [
            {
              id: "c1",
              src: "samples/v.wav",
              sha256: "a".repeat(64),
              startTick,
            },
          ],
        },
        {
          id: "pad",
          name: "Pad",
          instrument: "vocoder",
          vocoder: { src: "vox" },
        },
      ],
      notes: [45, 52, 57].map((pitch, index) => ({
        id: `c${index}`,
        trackId: "pad",
        pitch,
        startTick: 0,
        durationTicks: 480 * 16,
        velocity: 0.8,
      })),
    });
  }
  const clipBank = (): SampleBank => ({
    voices: new Map([[sampleKey("vox", "clip:c1"), voiceSample()]]),
    problems: [],
  });

  test("a vocal track's clip modulates the carrier, and moving it changes the stem", () => {
    const a = renderScorePcm(clipSong(0), {
      sampleRate: SR,
      samples: clipBank(),
    });
    expect(rms(a.pcm)).toBeGreaterThan(0.01);
    const silent = renderScorePcm(clipSong(0), {
      sampleRate: SR,
      samples: { voices: new Map(), problems: [] },
    });
    expect(rms(silent.pcm)).toBeLessThan(rms(a.pcm) / 4);
    const stems = new StemRenderer();
    const first = hash(
      stems.render(clipSong(0), { sampleRate: SR, samples: clipBank() }).pcm,
    );
    const moved = hash(
      stems.render(clipSong(480 * 4), { sampleRate: SR, samples: clipBank() })
        .pcm,
    );
    expect(moved).not.toBe(first);
    expect(first).toBe(hash(a.pcm));
  }, 60_000);
});
