import { describe, expect, test } from "bun:test";
import {
  createScore,
  type NoteInput,
  type TrackInput,
  type TrackScoreData,
} from "../../core/score.ts";
import { LiveSynth } from "./live.ts";
import { planSamplerVoices } from "./sampler.ts";
import { sampleKey, type DecodedSample, type SampleBank } from "./samples.ts";
import { renderScorePcm, StemRenderer } from "./wav.ts";

const RATE = 8_000;

function song(
  track: Partial<TrackInput>,
  notes: Partial<NoteInput>[],
  extra: Partial<TrackScoreData> = {},
) {
  return createScore({
    tempoBpm: 120,
    bars: 1,
    ...extra,
    tracks: [{ id: "t", name: "lead", instrument: "sine", ...track }],
    notes: notes.map((note, index) => ({
      id: `n${index}`,
      trackId: "t",
      startTick: 0,
      durationTicks: 480,
      pitch: 60,
      velocity: 0.8,
      ...note,
    })),
  });
}

const pcm = (score: ReturnType<typeof song>) =>
  renderScorePcm(score, { sampleRate: RATE }).pcm;

describe("tuned rendering", () => {
  // 24-EDO rooted on C4: key 61 is one quarter tone above C4, which is
  // exactly C4 with +50 cents in 12-TET, so the two render byte-identically.
  for (const instrument of ["sine", "supersaw", "wavetable"]) {
    test(`a song tuning retunes ${instrument} notes`, () => {
      const tuned = pcm(
        song({ instrument }, [{ pitch: 61 }], { tuning: { edo: 24 } }),
      );
      const cents = pcm(song({ instrument }, [{ pitch: 60, cents: 50 }]));
      expect(tuned).toEqual(cents);
      expect(tuned).not.toEqual(pcm(song({ instrument }, [{ pitch: 61 }])));
    });
  }

  test("a track tuning applies without a song tuning", () => {
    expect(pcm(song({ tuning: { edo: 24 } }, [{ pitch: 62 }]))).toEqual(
      pcm(song({}, [{ pitch: 61 }])),
    );
  });

  test("the root defaults to the song key's tonic", () => {
    // In D, 24-EDO is rooted on D4 (62): key 63 is D4 + 50 cents.
    expect(
      pcm(song({}, [{ pitch: 63 }], { tuning: { edo: 24 }, key: "D minor" })),
    ).toEqual(pcm(song({}, [{ pitch: 62, cents: 50 }], { key: "D minor" })));
  });

  test("the reference pitch moves A4", () => {
    const at432 = pcm(song({}, [{ pitch: 69 }], { tuning: { ref: 432 } }));
    expect(at432).not.toEqual(pcm(song({}, [{ pitch: 69 }])));
  });

  test("keys tuned above the audible range are silent", () => {
    for (const tuning of [{ edo: 1 }, { cents: [9600] }]) {
      const out = pcm(
        song({ instrument: "saw" }, [{ pitch: 127 }], { tuning }),
      );
      expect(out.every((sample) => sample === 0)).toBe(true);
    }
  });

  test("keys a keyboard mapping leaves unmapped are silent", () => {
    const keymap = {
      size: 12,
      first: 0,
      last: 127,
      middle: 60,
      refKey: 69,
      refHz: 440,
      octave: 12,
      map: [0, null, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    };
    const silent = pcm(
      song({}, [{ pitch: 61 }], {
        tuning: { edo: 12, kbm: "a.kbm", keymap },
      }),
    );
    expect(silent.every((value) => value === 0)).toBe(true);
  });

  test("drum kit hits ignore the tuning", () => {
    const kit = (extra: Partial<TrackScoreData>) =>
      pcm(song({ instrument: "drums" }, [{ pitch: 36 }], extra));
    expect(kit({ tuning: { edo: 24 } })).toEqual(kit({}));
  });

  test("the stem cache re-renders when the song tuning changes", () => {
    const cached = new StemRenderer();
    const options = { sampleRate: RATE };
    const plain = song({}, [{ pitch: 61 }]);
    const tuned = song({}, [{ pitch: 61 }], { tuning: { edo: 24 } });
    const rooted = song({}, [{ pitch: 61 }], {
      tuning: { edo: 24 },
      key: "D",
    });
    expect(cached.render(plain, options).pcm).toEqual(pcm(plain));
    expect(cached.render(tuned, options).pcm).toEqual(pcm(tuned));
    expect(cached.render(rooted, options).pcm).toEqual(pcm(rooted));
  });

  test("played notes follow the song tuning", () => {
    const live = new LiveSynth(RATE);
    const note = (score: ReturnType<typeof song>) =>
      live.render({
        score,
        trackId: "t",
        pitch: 61,
        velocity: 0.8,
        seconds: 0.25,
      })!.pcm;
    const plain = Int16Array.from(note(song({}, [])));
    const tuned = Int16Array.from(note(song({}, [], { tuning: { edo: 24 } })));
    expect(tuned).not.toEqual(plain);
    expect(Int16Array.from(note(song({}, [])))).toEqual(plain);
  });
});

describe("tuned samplers", () => {
  const sample: DecodedSample = {
    sha256: "a".repeat(64),
    sampleRate: RATE,
    channels: 1,
    frames: 400,
    mono: new Float32Array(400).fill(0.5),
  };
  const bank: SampleBank = {
    voices: new Map([
      [sampleKey("t", "a"), sample],
      [sampleKey("t", "b"), sample],
    ]),
    problems: [],
  };
  const steps = (
    mode: "keyed" | "oneshot",
    notes: Partial<NoteInput>[],
    extra: Partial<TrackScoreData> = {},
  ) => {
    const score = song(
      {
        instrument: "sampler",
        sampler: {
          mode,
          voices:
            mode === "keyed"
              ? { a: { src: "a.wav", root: 60 } }
              : { a: { src: "a.wav" }, b: { src: "b.wav" } },
        },
      },
      notes,
      extra,
    );
    return planSamplerVoices(score.tracks[0]!, score.notes, bank, {
      score,
      sampleRate: RATE,
    }).map((voice) => voice.step);
  };

  test("keyed voices repitch to the tuned key", () => {
    const [step] = steps("keyed", [{ pitch: 61 }], { tuning: { edo: 24 } });
    expect(step).toBeCloseTo(2 ** (50 / 1200), 12);
  });

  test("note cents repitch keyed and one-shot voices", () => {
    expect(steps("keyed", [{ pitch: 60, cents: -100 }])[0]).toBeCloseTo(
      2 ** (-100 / 1200),
      12,
    );
    expect(steps("oneshot", [{ pitch: 36, cents: 1200 }])[0]).toBeCloseTo(
      2,
      12,
    );
  });

  test("one-shot slots ignore the tuning", () => {
    expect(steps("oneshot", [{ pitch: 37 }], { tuning: { edo: 24 } })).toEqual(
      steps("oneshot", [{ pitch: 37 }]),
    );
  });
});
