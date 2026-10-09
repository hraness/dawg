import { describe, expect, test } from "bun:test";
import {
  createScore,
  type AudioClip,
  type TrackScoreData,
} from "../../core/score.ts";
import { secondsAtTick } from "../../core/tempo.ts";
import {
  applySectionChanges,
  copyBars,
  deleteBars,
  insertBars,
  sectionScore,
} from "../../core/sections.ts";
import { equalPowerFade, renderClips } from "./clips.ts";
import { renderArrangedPcm } from "./arrange.ts";
import {
  EMPTY_SAMPLE_BANK,
  sampleKey,
  type DecodedSample,
  type SampleBank,
} from "./samples.ts";
import { renderScorePcm } from "./wav.ts";

const RATE = 48_000;
const SHA = "a".repeat(64);

/** A mono 48 kHz buffer of `seconds` at constant `level` (a DC "voice"). */
function dc(seconds: number, level = 0.5): DecodedSample {
  const frames = Math.round(seconds * 48_000);
  return {
    sha256: SHA,
    sampleRate: 48_000,
    channels: 1,
    frames,
    mono: new Float32Array(frames).fill(level),
  };
}

/** A sine at `hz`, for spectral checks. */
function sine(seconds: number, hz: number, level = 0.5): DecodedSample {
  const frames = Math.round(seconds * 48_000);
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1)
    mono[i] = level * Math.sin((2 * Math.PI * hz * i) / 48_000);
  return { sha256: SHA, sampleRate: 48_000, channels: 1, frames, mono };
}

/** A rising sweep (200 Hz up 20 Hz a second): no two points sound alike. */
function sweep(seconds: number, level = 0.5): DecodedSample {
  const frames = Math.round(seconds * 48_000);
  const mono = new Float32Array(frames);
  let phase = 0;
  for (let i = 0; i < frames; i += 1) {
    phase += (2 * Math.PI * (200 + (20 * i) / 48_000)) / 48_000;
    mono[i] = level * Math.sin(phase);
  }
  return { sha256: SHA, sampleRate: 48_000, channels: 1, frames, mono };
}

function bank(audio: DecodedSample, trackId = "v", id = "c1"): SampleBank {
  return {
    voices: new Map([[sampleKey(trackId, `clip:${id}`), audio]]),
    problems: [],
  };
}

function clip(extra: Partial<AudioClip> = {}): AudioClip {
  return {
    id: "c1",
    src: "samples/v.wav",
    sha256: SHA,
    startTick: 0,
    ...extra,
  };
}

function song(
  clips: readonly AudioClip[],
  extra: Partial<TrackScoreData> = {},
) {
  return createScore({
    tempoBpm: 120,
    bars: 4,
    tracks: [
      {
        id: "v",
        name: "vocal",
        instrument: "vocal",
        clips,
        fx: undefined,
      },
    ],
    notes: [],
    ...extra,
  });
}

function left(pcm: Int16Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < pcm.length; i += 2) out.push(pcm[i]!);
  return out;
}

function firstSound(values: readonly number[]): number {
  return values.findIndex((value) => value !== 0);
}

describe("audio clip rendering", () => {
  test("no clips: the bank is not consulted and output is silent", () => {
    const pcm = renderScorePcm(song([]), {
      sampleRate: RATE,
      samples: EMPTY_SAMPLE_BANK,
    }).pcm;
    expect(pcm.every((value) => value === 0)).toBe(true);
  });

  test("a clip at bar 3 under a tempo ramp starts within 1 sample of the map", () => {
    const tempo = {
      time: {
        tempo: [{ tick: 4 * 480 * 2, bpm: 80, ramp: "linear" as const }],
      },
    };
    const at = 2 * 4 * 480; // bar 3, 0-based bar 2
    const score = song([clip({ startTick: at, fadeInTime: 0 })], tempo);
    const pcm = renderScorePcm(score, {
      sampleRate: RATE,
      samples: bank(dc(1)),
    }).pcm;
    const expected = secondsAtTick(score, at) * RATE;
    expect(Math.abs(firstSound(left(pcm)) - expected)).toBeLessThanOrEqual(1);
  });

  test("a missing clip renders silence", () => {
    const pcm = renderScorePcm(song([clip()]), {
      sampleRate: RATE,
      samples: EMPTY_SAMPLE_BANK,
    }).pcm;
    expect(pcm.every((value) => value === 0)).toBe(true);
  });

  test("fades are equal-power: the midpoint is -3 dB", () => {
    expect(equalPowerFade(0.5)).toBeCloseTo(Math.SQRT1_2, 9);
    expect(equalPowerFade(0) ** 2 + equalPowerFade(1) ** 2).toBe(1);
    // In and out crossfade at constant power.
    for (const x of [0.1, 0.3, 0.7])
      expect(equalPowerFade(x) ** 2 + equalPowerFade(1 - x) ** 2).toBeCloseTo(
        1,
        9,
      );
  });

  test("gain, dur and offset cut and scale the audio", () => {
    const full = left(
      renderScorePcm(song([clip({ fadeInTime: 0, fadeTime: 0 })]), {
        sampleRate: RATE,
        samples: bank(dc(1)),
      }).pcm,
    );
    const half = left(
      renderScorePcm(
        song([clip({ fadeInTime: 0, fadeTime: 0, gain: 0.5, dur: 0.25 })]),
        { sampleRate: RATE, samples: bank(dc(1)) },
      ).pcm,
    );
    const at = RATE / 10;
    expect(full[at]).not.toBe(0);
    expect(Math.abs(half[at]! / full[at]! - 0.5)).toBeLessThan(0.01);
    // Silent after dur (with chain tails allowed to be tiny).
    expect(Math.abs(half[Math.round(0.3 * RATE)]!)).toBeLessThan(
      Math.abs(full[at]!) * 0.05,
    );
  });

  test("reverse plays the file backwards", () => {
    // A ramp from 0 to 1: reversed, the start is loud.
    const frames = 48_000;
    const ramp: DecodedSample = {
      ...dc(1),
      mono: Float32Array.from({ length: frames }, (_, i) => (0.5 * i) / frames),
    };
    const fwd = left(
      renderScorePcm(song([clip({ fadeInTime: 0 })]), {
        sampleRate: RATE,
        samples: bank(ramp),
      }).pcm,
    );
    const rev = left(
      renderScorePcm(song([clip({ fadeInTime: 0, rev: true })]), {
        sampleRate: RATE,
        samples: bank(ramp),
      }).pcm,
    );
    const early = Math.round(0.1 * RATE);
    expect(Math.abs(rev[early]!)).toBeGreaterThan(Math.abs(fwd[early]!) * 3);
  });

  test("reverse is the exact mirror: out[i] = src[n - 1 - i]", () => {
    const frames = 4_800;
    const src: DecodedSample = {
      ...dc(0.1),
      frames,
      mono: Float32Array.from({ length: frames }, (_, i) => Math.sin(i * 0.37)),
    };
    const score = song([clip({ fadeInTime: 0, fadeTime: 0, rev: true })]);
    const out = new Float64Array(frames + 10);
    renderClips(
      out,
      score.tracks[0]!,
      { sampleRate: RATE, samples: out.length, samplesPerTick: RATE / 960 },
      bank(src),
      () => 1,
    );
    let err = 0;
    for (let i = 0; i < frames; i += 1)
      err = Math.max(err, Math.abs(out[i]! - src.mono[frames - 1 - i]!));
    expect(err).toBeLessThan(1e-6);
  });

  test("renders are deterministic", () => {
    const score = song([clip({ startTick: 480 })]);
    const a = renderScorePcm(score, {
      sampleRate: RATE,
      samples: bank(sine(1, 220)),
    });
    const b = renderScorePcm(score, {
      sampleRate: RATE,
      samples: bank(sine(1, 220)),
    });
    expect(Buffer.from(a.pcm.buffer).equals(Buffer.from(b.pcm.buffer))).toBe(
      true,
    );
  });

  test("a section mute silences a clip there and cuts one crossing in", () => {
    const score = song([clip({ startTick: 0, fadeInTime: 0, fadeTime: 0 })], {
      sections: [
        { name: "a", startBar: 0, bars: 1 },
        { name: "b", startBar: 1, bars: 3, mute: ["v"] },
      ],
    });
    // The clip is 3 s long; bar 1 ends at 2 s.
    const changed = applySectionChanges(score);
    const cut = changed.tracks[0]!.clips![0]!;
    expect(cut.dur).toBeCloseTo(2, 6);
    expect(cut.fadeTime).toBeCloseTo(0.005, 9);
    const pcm = left(
      renderArrangedPcm(score, { sampleRate: RATE, samples: bank(dc(3)) }).pcm,
    );
    expect(pcm[Math.round(1 * RATE)]).not.toBe(0);
    expect(Math.abs(pcm[Math.round(2.5 * RATE)]!)).toBeLessThan(2);
    // The muted section on its own has no clip.
    expect(sectionScore(score, score.sections[1]!).tracks[0]!.clips).toBe(
      undefined,
    );
  });

  test("a windowed form render equals the full render", () => {
    const score = song(
      [
        clip({ startTick: 480, fadeInTime: 0.01, fadeTime: 0.02 }),
        { ...clip({ id: "c2", startTick: 4 * 480 * 2 + 240 }) },
      ],
      {
        sections: [
          { name: "a", startBar: 0, bars: 2 },
          { name: "b", startBar: 2, bars: 2 },
        ],
        form: [{ section: "a" }, { section: "b" }],
      },
    );
    const voices = new Map([
      [sampleKey("v", "clip:c1"), sine(3, 330)],
      [sampleKey("v", "clip:c2"), sine(2, 440)],
    ]);
    const samples: SampleBank = { voices, problems: [] };
    const whole = renderArrangedPcm(score, { sampleRate: RATE, samples });
    const windowed = renderArrangedPcm(score, {
      sampleRate: RATE,
      samples,
      maxSeconds: 1.5,
    });
    expect(windowed.frames).toBe(whole.frames);
    let worst = 0;
    for (let i = 0; i < whole.pcm.length; i += 1)
      worst = Math.max(worst, Math.abs(whole.pcm[i]! - windowed.pcm[i]!));
    expect(worst).toBeLessThanOrEqual(1);
  });

  // Slicing must use the file's real end: a reversed clip's cut moves its
  // offset from that end, and a clip with no `dur` has no other.
  for (const rev of [false, true])
    for (const dur of [undefined, 9])
      test(`a section mute cuts a clip as it plays (rev ${rev}, dur ${dur ?? "unset"})`, () => {
        const one = clip({ fadeInTime: 0, fadeTime: 0, rev, dur });
        const muted = song([one], {
          sections: [
            { name: "a", startBar: 0, bars: 1 },
            { name: "b", startBar: 1, bars: 3, mute: ["v"] },
          ],
        });
        const samples = bank(sweep(10));
        const plain = left(
          renderArrangedPcm(song([one]), { sampleRate: RATE, samples }).pcm,
        );
        const cut = left(
          renderArrangedPcm(muted, { sampleRate: RATE, samples }).pcm,
        );
        // Bar 1 ends at 2 s; the cut's 5 ms fade starts just before.
        const edge = Math.round(1.99 * RATE);
        let worst = 0;
        for (let i = 0; i < edge; i += 1)
          worst = Math.max(worst, Math.abs(plain[i]! - cut[i]!));
        expect(worst).toBeLessThanOrEqual(1);
        expect(
          Math.max(...plain.slice(RATE, RATE + 480).map(Math.abs)),
        ).toBeGreaterThan(1000);
        expect(Math.abs(cut[Math.round(2.5 * RATE)]!)).toBeLessThan(2);
      });

  for (const rev of [false, true])
    for (const dur of [undefined, 48])
      test(`a song over 45 s renders the same in windows (rev ${rev}, dur ${dur ?? "unset"})`, () => {
        // 25 bars at 120 bpm is 50 s, so the arranged render uses windows.
        const score = song([clip({ startTick: 480, rev, dur })], { bars: 25 });
        const samples = bank(sweep(49));
        const windowed = renderArrangedPcm(score, {
          sampleRate: RATE,
          samples,
        });
        const whole = renderArrangedPcm(score, {
          sampleRate: RATE,
          samples,
          maxSeconds: 60,
        });
        // The single pass and the windows may round the tail a frame apart.
        expect(Math.abs(windowed.frames - whole.frames)).toBeLessThanOrEqual(1);
        const shared = Math.min(whole.pcm.length, windowed.pcm.length);
        let worst = 0;
        for (let i = 0; i < shared; i += 1)
          worst = Math.max(worst, Math.abs(whole.pcm[i]! - windowed.pcm[i]!));
        expect(worst).toBeLessThanOrEqual(1);
        // And it sounds throughout, not zeros past the first window.
        const l = left(whole.pcm);
        for (const at of [5, 20, 40])
          expect(
            Math.max(...l.slice(at * RATE, at * RATE + 480).map(Math.abs)),
          ).toBeGreaterThan(1000);
      });

  test("other instruments: clips sound and notes still play", () => {
    const score = createScore({
      tempoBpm: 120,
      bars: 1,
      tracks: [{ id: "v", name: "keys", instrument: "sine", clips: [clip()] }],
      notes: [
        {
          id: "n",
          trackId: "v",
          pitch: 69,
          startTick: 0,
          durationTicks: 480,
          velocity: 0.8,
        },
      ],
    });
    const both = left(
      renderScorePcm(score, { sampleRate: RATE, samples: bank(dc(1, 0.2)) })
        .pcm,
    );
    const notesOnly = left(
      renderScorePcm(score, { sampleRate: RATE, samples: EMPTY_SAMPLE_BANK })
        .pcm,
    );
    expect(both).not.toEqual(notesOnly);
    expect(notesOnly.some((value) => value !== 0)).toBe(true);
  });

  test("vocal without clips keeps an older project's tone", () => {
    const score = createScore({
      tempoBpm: 120,
      bars: 1,
      tracks: [{ id: "v", name: "vocal", instrument: "vocal" }],
      notes: [
        {
          id: "n",
          trackId: "v",
          pitch: 60,
          startTick: 0,
          durationTicks: 480,
          velocity: 0.8,
        },
      ],
    });
    const pcm = renderScorePcm(score, { sampleRate: RATE }).pcm;
    expect(pcm.some((value) => value !== 0)).toBe(true);
  });

  test("vocal guide notes are silent in a render", () => {
    const score = createScore({
      tempoBpm: 120,
      bars: 1,
      tracks: [
        {
          id: "v",
          name: "vocal",
          instrument: "vocal",
          clips: [clip({ mute: true })],
        },
      ],
      notes: [
        {
          id: "n",
          trackId: "v",
          pitch: 60,
          startTick: 0,
          durationTicks: 480,
          velocity: 0.8,
        },
      ],
    });
    const pcm = renderScorePcm(score, { sampleRate: RATE }).pcm;
    expect(pcm.every((value) => value === 0)).toBe(true);
    // The live loop's guide sine: soft (well under a plain sine note).
    const guided = renderScorePcm(score, {
      sampleRate: RATE,
      loop: true,
      guide: true,
    }).pcm;
    const peak = (values: ArrayLike<number>) => {
      let max = 0;
      for (let i = 0; i < values.length; i += 1)
        max = Math.max(max, Math.abs(values[i]!));
      return max;
    };
    const sine = renderScorePcm(
      createScore({
        ...score.toJSON(),
        tracks: [{ id: "v", name: "vocal", instrument: "sine" }],
      } as never),
      { sampleRate: RATE, loop: true },
    ).pcm;
    expect(peak(guided)).toBeGreaterThan(0);
    expect(peak(guided)).toBeLessThan(peak(sine) * 0.4);
  });
});

describe("bar edits move clips with the music", () => {
  const bar = 4 * 480;
  test("insert, delete and copy bars shift clips like notes", () => {
    const score = song([
      clip({ startTick: bar }),
      clip({ id: "c2", startTick: 2 * bar }),
    ]);
    const inserted = insertBars(score, 1, 1);
    expect(inserted.tracks[0]!.clips!.map((c) => c.startTick)).toEqual([
      2 * bar,
      3 * bar,
    ]);
    const deleted = deleteBars(score, 1, 1);
    expect(deleted.tracks[0]!.clips!.map((c) => [c.id, c.startTick])).toEqual([
      ["c2", bar],
    ]);
    const copied = copyBars(score, 1, 1, 3);
    const clips = copied.tracks[0]!.clips!;
    expect(clips.map((c) => c.startTick)).toEqual([bar, 2 * bar, 3 * bar]);
    expect(new Set(clips.map((c) => c.id)).size).toBe(3);
  });
});
