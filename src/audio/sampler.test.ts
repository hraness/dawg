import { describe, expect, test } from "bun:test";
import {
  createScore,
  type NoteInput,
  type SampleRef,
  type TrackInput,
} from "../../core/score.ts";
import { planSamplerVoices, renderSamplerVoices } from "./sampler.ts";
import { sampleKey, type DecodedSample, type SampleBank } from "./samples.ts";
import { renderScorePcm, StemRenderer } from "./wav.ts";

const RATE = 8_000;
/** 120 BPM: one beat is 0.5 s = 4000 frames at 8 kHz; 480 ticks per beat. */
const BEAT = 4_000;

function sample(mono: number[] | Float32Array, sampleRate = RATE, sha = "a") {
  const data = Float32Array.from(mono);
  return {
    sha256: sha.repeat(64).slice(0, 64),
    sampleRate,
    channels: 1,
    frames: data.length,
    mono: data,
  } satisfies DecodedSample;
}

function bank(entries: Record<string, DecodedSample>, track = "s"): SampleBank {
  return {
    voices: new Map(
      Object.entries(entries).map(([voice, s]) => [sampleKey(track, voice), s]),
    ),
    problems: [],
  };
}

function scoreOf(
  voices: Record<string, SampleRef>,
  notes: Omit<NoteInput, "trackId">[],
  options: { mode?: "oneshot" | "keyed"; track?: Partial<TrackInput> } = {},
) {
  return createScore({
    tempoBpm: 120,
    bars: 1,
    tracks: [
      {
        id: "s",
        name: "s",
        instrument: "sampler",
        sampler: { mode: options.mode ?? "oneshot", voices },
        ...options.track,
      },
    ],
    notes: notes.map((note) => ({ ...note, trackId: "s" })),
  });
}

const hit = (id: string, pitch: number, beat: number, beats = 0.25) => ({
  id,
  pitch,
  startTick: Math.round(beat * 480),
  durationTicks: Math.round(beats * 480),
  velocity: 1,
});

/** Mono render of one sampler track through the voice planner. */
function mono(
  score: ReturnType<typeof scoreOf>,
  samples: SampleBank,
  frames = 4 * BEAT,
): Float64Array {
  const track = score.tracks[0]!;
  const timing = { score, sampleRate: RATE };
  const out = new Float64Array(frames);
  renderSamplerVoices(
    out,
    planSamplerVoices(track, score.notes, samples, timing),
    timing,
    () => 1,
  );
  return out;
}

const ramp = (n: number) => Array.from({ length: n }, (_, i) => i / n);
const energy = (pcm: Float64Array, from: number, to: number) => {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += Math.abs(pcm[i]!);
  return sum;
};

describe("sampler voices", () => {
  test("oneshot voices map to slots from 36 in name order", () => {
    const s = scoreOf({ snare: { src: "a.wav" }, kick: { src: "b.wav" } }, [
      hit("k", 36, 0),
      hit("s", 37, 1),
      hit("x", 38, 2),
    ]);
    const voices = planSamplerVoices(
      s.tracks[0]!,
      s.notes,
      bank({ kick: sample([1]), snare: sample([1]) }),
      { score: s, sampleRate: RATE },
    );
    expect(voices.map((v) => [v.voice, v.start])).toEqual([
      ["kick", 0],
      ["snare", BEAT],
    ]);
  });

  test("oneshot plays the whole sample regardless of note length", () => {
    const s = scoreOf({ kick: { src: "a.wav" } }, [hit("k", 36, 0, 0.01)]);
    const out = mono(s, bank({ kick: sample(new Array(2_000).fill(0.5)) }));
    expect(out[1_000]).toBeCloseTo(0.35, 6); // 0.5 × SAMPLE_LEVEL 0.7
    expect(out[1_990]!).toBeGreaterThan(0);
    expect(out[2_000]).toBe(0);
    // Anti-click: the first frame starts from silence.
    expect(out[0]).toBe(0);
  });

  test("begin/end select a window; negative speed reverses it", () => {
    const data = ramp(1_000);
    const forward = mono(
      scoreOf({ v: { src: "a.wav", begin: 0.5, end: 0.75 } }, [
        hit("a", 36, 0),
      ]),
      bank({ v: sample(data) }),
    );
    expect(forward[100]! / 0.7).toBeCloseTo(0.6, 6);
    expect(forward[250]).toBe(0);
    const reverse = mono(
      scoreOf({ v: { src: "a.wav", begin: 0.5, end: 0.75, speed: -1 } }, [
        hit("a", 36, 0),
      ]),
      bank({ v: sample(data) }),
    );
    expect(reverse[100]! / 0.7).toBeCloseTo(0.649, 6);
    expect(reverse[250]).toBe(0);
  });

  test("speed and source rate change the playback rate", () => {
    const data = new Array(1_000).fill(0.5);
    const double = mono(
      scoreOf({ v: { src: "a.wav", speed: 2 } }, [hit("a", 36, 0)]),
      bank({ v: sample(data) }),
    );
    expect(double[490]!).toBeGreaterThan(0);
    expect(double[500]).toBe(0);
    // A 16 kHz file at an 8 kHz engine is resampled: half as many frames.
    const resampled = mono(
      scoreOf({ v: { src: "a.wav" } }, [hit("a", 36, 0)]),
      bank({ v: sample(data, 16_000) }),
    );
    expect(resampled[490]!).toBeGreaterThan(0);
    expect(resampled[500]).toBe(0);
  });

  test("loop repeats the window for the note's length, then releases", () => {
    const s = scoreOf({ v: { src: "a.wav", loop: true } }, [
      hit("a", 36, 0, 1),
    ]);
    const out = mono(s, bank({ v: sample(new Array(400).fill(0.5)) }));
    expect(out[3_000]!).toBeCloseTo(0.35, 2);
    expect(energy(out, BEAT + 200, 2 * BEAT)).toBe(0);
  });

  test("a choke group cuts the previous voice with a short fade", () => {
    const long = sample(new Array(3 * BEAT).fill(0.5));
    const voices = {
      open: { src: "a.wav", choke: "hat" },
      closed: { src: "b.wav", choke: "hat" },
    };
    const choked = mono(
      scoreOf(voices, [hit("o", 37, 0), hit("c", 36, 1)]),
      bank({ open: long, closed: sample([0]) }),
    );
    expect(choked[BEAT - 1]!).toBeCloseTo(0.35, 6);
    expect(choked[BEAT + 20]!).toBeGreaterThan(0);
    expect(choked[BEAT + 20]!).toBeLessThan(0.35);
    expect(energy(choked, BEAT + 40, 3 * BEAT)).toBe(0);
    // Without a group the open voice rings on.
    const free = mono(
      scoreOf({ open: { src: "a.wav" }, closed: { src: "b.wav" } }, [
        hit("o", 37, 0),
        hit("c", 36, 1),
      ]),
      bank({ open: long, closed: sample([0]) }),
    );
    expect(free[2 * BEAT]!).toBeCloseTo(0.35, 6);
  });

  test("keyed mode repitches from root and holds for the note", () => {
    const tone = Array.from({ length: 8_000 }, (_, i) =>
      Math.sin((2 * Math.PI * 100 * i) / RATE),
    );
    const s = scoreOf({ v: { src: "a.wav", root: 60 } }, [hit("a", 72, 0, 1)], {
      mode: "keyed",
    });
    const voices = planSamplerVoices(
      s.tracks[0]!,
      s.notes,
      bank({ v: sample(tone) }),
      { score: s, sampleRate: RATE },
    );
    expect(voices[0]!.step).toBeCloseTo(2, 9);
    const out = mono(s, bank({ v: sample(tone) }));
    // An octave up: 200 Hz, so 100 zero-crossing pairs in half a second.
    let crossings = 0;
    for (let i = 1; i < 2_000; i += 1)
      if (out[i - 1]! <= 0 && out[i]! > 0) crossings += 1;
    expect(crossings).toBeGreaterThanOrEqual(49);
    expect(crossings).toBeLessThanOrEqual(51);
    // Held for one beat plus a 10 ms release, not the whole 1 s file.
    expect(energy(out, BEAT + 100, 2 * BEAT)).toBe(0);
  });
});

describe("sampler tracks in the renderer", () => {
  const voices = { kick: { src: "a.wav" } };
  const samples = bank({ kick: sample(new Array(400).fill(0.8)) });

  test("hits are audible at their positions and silent elsewhere", () => {
    const s = scoreOf(voices, [hit("a", 36, 0), hit("b", 36, 2)]);
    const audio = renderScorePcm(s, { sampleRate: RATE, samples });
    const at = (frame: number) => Math.abs(audio.pcm[frame * 2]!);
    expect(at(200)).toBeGreaterThan(1_000);
    expect(at(2 * BEAT + 200)).toBeGreaterThan(1_000);
    expect(at(BEAT)).toBe(0);
    // Without decoded samples the track is silent, never a crash.
    const silent = renderScorePcm(s, { sampleRate: RATE });
    expect(silent.pcm.every((value) => value === 0)).toBe(true);
  });

  test("volume, pan and effects apply like any track", () => {
    const base = scoreOf(voices, [hit("a", 36, 0)]);
    const left = scoreOf(voices, [hit("a", 36, 0)], {
      track: { pan: -1, volume: 0.5 },
    });
    const a = renderScorePcm(base, { sampleRate: RATE, samples }).pcm;
    const b = renderScorePcm(left, { sampleRate: RATE, samples }).pcm;
    expect(Math.abs(b[400]!)).toBeGreaterThan(0);
    expect(b[401]).toBe(0);
    expect(Math.abs(b[400]!)).toBeLessThan(Math.abs(a[400]!) * 1.5);
    const wet = scoreOf(voices, [hit("a", 36, 0)], {
      track: { reverb: { mix: 0.5, size: 0.5 } },
    });
    const c = renderScorePcm(wet, { sampleRate: RATE, samples }).pcm;
    expect(Math.abs(c[(BEAT / 2) * 2]!)).toBeGreaterThan(0);
  });

  test("renders are deterministic and the stem cache keys on sample content", () => {
    const s = scoreOf(voices, [hit("a", 36, 0), hit("b", 36, 1.5)]);
    const cold = renderScorePcm(s, { sampleRate: RATE, loop: true, samples });
    const stems = new StemRenderer();
    const warm1 = stems.render(s, { sampleRate: RATE, loop: true, samples });
    const warm2 = stems.render(s, { sampleRate: RATE, loop: true, samples });
    expect(warm1.pcm).toEqual(cold.pcm);
    expect(warm2.pcm).toEqual(cold.pcm);
    // Same score, replaced file: the stem re-renders.
    const replaced = bank({
      kick: sample(new Array(400).fill(0.2), RATE, "b"),
    });
    const after = stems.render(s, {
      sampleRate: RATE,
      loop: true,
      samples: replaced,
    });
    expect(after.pcm).toEqual(
      renderScorePcm(s, { sampleRate: RATE, loop: true, samples: replaced })
        .pcm,
    );
    expect(after.pcm).not.toEqual(cold.pcm);
  });
});

describe("Strudel sample controls", () => {
  const flat = (n: number, value = 0.5) => new Array(n).fill(value);

  test("clip (legato) cuts a oneshot at the note length times the factor", () => {
    const whole = mono(
      scoreOf({ v: { src: "a.wav" } }, [hit("a", 36, 0, 0.25)]),
      bank({ v: sample(flat(3_000)) }),
    );
    const clipped = mono(
      scoreOf({ v: { src: "a.wav", clip: 1 } }, [hit("a", 36, 0, 0.25)]),
      bank({ v: sample(flat(3_000)) }),
    );
    // A quarter beat is 1000 frames; the release fade is 80 frames at 8 kHz.
    expect(whole[2_000]!).toBeGreaterThan(0);
    expect(clipped[900]!).toBeGreaterThan(0);
    expect(energy(clipped, 1_100, 3_000)).toBe(0);
    const doubled = mono(
      scoreOf({ v: { src: "a.wav", clip: 2 } }, [hit("a", 36, 0, 0.25)]),
      bank({ v: sample(flat(3_000)) }),
    );
    expect(doubled[1_900]!).toBeGreaterThan(0);
    expect(energy(doubled, 2_100, 3_000)).toBe(0);
  });

  test("fit stretches the window to the note; unit c to bars; unit s to seconds", () => {
    const data = flat(1_000);
    const fit = mono(
      scoreOf({ v: { src: "a.wav", fit: true } }, [hit("a", 36, 0, 1)]),
      bank({ v: sample(data) }),
    );
    expect(fit[BEAT - 50]!).toBeGreaterThan(0);
    expect(fit[BEAT + 10]).toBe(0);
    // unit c, speed 1: one bar (4 beats) per window.
    const bar = mono(
      scoreOf({ v: { src: "a.wav", unit: "c" } }, [hit("a", 36, 0)]),
      bank({ v: sample(data) }),
      5 * BEAT,
    );
    expect(bar[4 * BEAT - 50]!).toBeGreaterThan(0);
    expect(bar[4 * BEAT + 10]).toBe(0);
    // unit s, speed 0.25: the window lasts a quarter second (2000 frames).
    const secs = mono(
      scoreOf({ v: { src: "a.wav", unit: "s", speed: 0.25 } }, [
        hit("a", 36, 0),
      ]),
      bank({ v: sample(data) }),
    );
    expect(secs[1_950]!).toBeGreaterThan(0);
    expect(secs[2_010]).toBe(0);
  });

  test("loopBegin/loopEnd loop only that part of the window", () => {
    // First half 0.2, second half 0.8: looping the second half never
    // returns to 0.2 after the first pass.
    const data = [...flat(500, 0.2), ...flat(500, 0.8)];
    const out = mono(
      scoreOf({ v: { src: "a.wav", loop: true, loopBegin: 0.5 } }, [
        hit("a", 36, 0, 1),
      ]),
      bank({ v: sample(data) }),
    );
    expect(out[100]!).toBeCloseTo(0.2 * 0.7, 2);
    for (const frame of [1_200, 2_100, 3_300])
      expect(out[frame]!).toBeCloseTo(0.8 * 0.7, 2);
  });

  test("accelerate ramps the rate; squiz raises pitch", () => {
    const data = flat(4_000);
    const plain = mono(
      scoreOf({ v: { src: "a.wav" } }, [hit("a", 36, 0)]),
      bank({ v: sample(data) }),
    );
    const faster = mono(
      scoreOf({ v: { src: "a.wav", accelerate: 1 } }, [hit("a", 36, 0)]),
      bank({ v: sample(data) }),
    );
    const last = (pcm: Float64Array) => {
      let at = 0;
      for (let i = 0; i < pcm.length; i += 1) if (pcm[i] !== 0) at = i;
      return at;
    };
    expect(last(faster)).toBeLessThan(last(plain) * 0.9);
    // A 100 Hz sine squizzed by 2 has twice as many zero crossings.
    const sine = Array.from({ length: 4_000 }, (_, i) =>
      Math.sin((2 * Math.PI * 100 * i) / RATE),
    );
    const crossings = (pcm: Float64Array, to: number) => {
      let count = 0;
      for (let i = 101; i < to; i += 1)
        if (Math.sign(pcm[i]!) !== Math.sign(pcm[i - 1]!)) count += 1;
      return count;
    };
    const base = mono(
      scoreOf({ v: { src: "a.wav" } }, [hit("a", 36, 0)]),
      bank({ v: sample(sine) }),
    );
    const squizzed = mono(
      scoreOf({ v: { src: "a.wav", squiz: 2 } }, [hit("a", 36, 0)]),
      bank({ v: sample(sine) }),
    );
    expect(crossings(squizzed, 1_900)).toBeGreaterThan(
      crossings(base, 1_900) * 1.7,
    );
  });

  test("new controls render byte-identically cold and cached", () => {
    const voices = {
      a: {
        src: "a.wav",
        clip: 0.5,
        accelerate: -0.3,
        squiz: 1.5,
        loop: true,
        loopBegin: 0.25,
        unit: "c" as const,
        speed: 2,
      },
    };
    const s = scoreOf(voices, [hit("a", 36, 0, 1), hit("b", 36, 2, 0.5)]);
    const samples = bank({
      a: sample(Array.from({ length: 2_000 }, (_, i) => Math.sin(i / 7))),
    });
    const cold = renderScorePcm(s, { sampleRate: RATE, loop: true, samples });
    const stems = new StemRenderer();
    stems.render(s, { sampleRate: RATE, loop: true, samples });
    const warm = stems.render(s, { sampleRate: RATE, loop: true, samples });
    expect(warm.pcm).toEqual(cold.pcm);
    // unit c depends on bar length: a meter change re-renders the stem.
    const threeFour = createScore({ ...s.toJSON(), beatsPerBar: 3 });
    const meter = stems.render(threeFour, {
      sampleRate: RATE,
      loop: true,
      samples,
    });
    expect(meter.pcm).toEqual(
      renderScorePcm(threeFour, { sampleRate: RATE, loop: true, samples }).pcm,
    );
  });
});
