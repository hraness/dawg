import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import { LiveFullRenderer, LiveSynth } from "./live.ts";
import {
  LiveSampleTransfer,
  liveSamplesFromData,
  liveTrackSamples,
} from "./live-samples.ts";
import { sampleKey, type DecodedSample, type SampleBank } from "./samples.ts";
import { builtinWavetable } from "./wavetable.ts";

const decoded = (id: string, value = 0.2): DecodedSample => ({
  sha256: id,
  sampleRate: 8000,
  channels: 1,
  frames: 800,
  mono: new Float32Array(800).fill(value),
});

describe("live worker sample transfer", () => {
  test("dispatch includes only this track's voices, granular source, table and IR", () => {
    const wanted = decoded("wanted");
    const other = decoded("other");
    const table = builtinWavetable("basic")!;
    const bank: SampleBank = {
      voices: new Map([
        [sampleKey("keys", "c4"), wanted],
        [sampleKey("keys", "granular:src"), wanted],
        [sampleKey("keys-other", "c4"), other],
      ]),
      problems: [],
      wavetables: new Map([
        ["keys", table],
        ["other", table],
      ]),
      irs: new Map([
        ["keys", wanted],
        ["other", other],
      ]),
    };
    const transfer = new LiveSampleTransfer();
    const message = transfer.forTrack(bank, "keys");
    expect([...message.samples!.voices.keys()]).toEqual([
      sampleKey("keys", "c4"),
      sampleKey("keys", "granular:src"),
    ]);
    expect([...message.samples!.wavetables!.keys()]).toEqual(["keys"]);
    expect([...message.samples!.irs!.keys()]).toEqual(["keys"]);
    const revived = liveSamplesFromData(structuredClone(message.samples!));
    expect(revived.wavetables!.get("keys")!.spectrum(0)).toEqual(
      table.spectrum(0),
    );
    expect(revived.voices.get(sampleKey("keys", "c4"))!.mono).toEqual(
      wanted.mono,
    );
    expect(transfer.forTrack(bank, "keys")).toEqual({
      sampleVersion: message.sampleVersion,
    });
    expect(transfer.forTrack(bank, "other").sampleVersion).toBe(
      message.sampleVersion + 1,
    );
    expect(transfer.forTrack(undefined, "other")).toEqual({
      sampleVersion: message.sampleVersion + 2,
    });
    expect(transfer.forTrack(bank, "keys").samples).toBeDefined();
    expect(transfer.forTrack({ ...bank }, "keys").samples).toBeDefined();
    expect(liveTrackSamples(bank, "missing").voices.size).toBe(0);
  });

  test("real worker retains samples across notes, refreshes changed banks and clears missing banks", async () => {
    const score = createScore({
      tracks: [
        {
          id: "keys",
          name: "Keys",
          instrument: "sampler",
          sampler: {
            mode: "keyed",
            voices: { c4: { src: "tracks/keys/c4.wav", root: 60 } },
          },
        },
      ],
    });
    const bank: SampleBank = {
      voices: new Map([[sampleKey("keys", "c4"), decoded("first")]]),
      problems: [],
    };
    const changed: SampleBank = {
      voices: new Map([[sampleKey("keys", "c4"), decoded("second", 0.4)]]),
      problems: [],
    };
    const renderer = new LiveFullRenderer();
    const synth = new LiveSynth(8000);
    try {
      for (const [pitch, samples] of [
        [60, bank],
        [60, bank],
        [60, changed],
        [60, undefined],
        [60, bank],
      ] as const) {
        const request = {
          score,
          trackId: "keys",
          pitch,
          velocity: 0.8,
          seconds: 0.1,
          samples,
        };
        const expected = new LiveSynth(8000).render({
          ...request,
          full: true,
        })!;
        const actual = await renderer.full(synth, request);
        expect(actual?.pcm).toEqual(expected.pcm);
        expect(actual?.frames).toBe(expected.frames);
      }
    } finally {
      renderer.close();
    }
  });

  test("same-pitch wavetable and IR replacements invalidate local and worker PCM", async () => {
    const wave = createScore({
      tracks: [
        {
          id: "wave",
          name: "Wave",
          instrument: "wavetable",
          wavetable: { table: { src: "tracks/wave/local.wav" } },
        },
      ],
    });
    const tableBank: SampleBank = {
      voices: new Map(),
      problems: [],
      wavetables: new Map([["wave", builtinWavetable("basic")!]]),
    };
    const tableChanged: SampleBank = {
      ...tableBank,
      wavetables: new Map([["wave", builtinWavetable("pwm")!]]),
    };
    const reverbed = createScore({
      tracks: [
        {
          id: "wave",
          name: "Wave",
          instrument: "saw",
          reverb: { mix: 0.7, size: 0.5, ir: { src: "tracks/wave/ir.wav" } },
        },
      ],
    });
    const irBank: SampleBank = {
      voices: new Map(),
      problems: [],
      irs: new Map([["wave", decoded("ir-a")]]),
    };
    const irChanged: SampleBank = {
      ...irBank,
      irs: new Map([
        [
          "wave",
          {
            ...decoded("ir-b"),
            mono: Float32Array.from(
              { length: 800 },
              (_, i) => Math.sin(i / 10) * Math.exp(-i / 100),
            ),
          },
        ],
      ]),
    };
    for (const [score, first, changed] of [
      [wave, tableBank, tableChanged],
      [reverbed, irBank, irChanged],
    ] as const) {
      const renderer = new LiveFullRenderer();
      const synth = new LiveSynth(8000);
      const local = new LiveSynth(8000);
      try {
        for (const samples of [first, first, changed, undefined, first]) {
          const request = {
            score,
            trackId: "wave",
            pitch: 60,
            velocity: 0.8,
            seconds: 0.125,
            samples,
          };
          const expected = new LiveSynth(8000).render({
            ...request,
            full: true,
          })!;
          expect(local.render({ ...request, full: true })?.pcm).toEqual(
            expected.pcm,
          );
          const actual = await renderer.full(synth, request);
          expect(actual?.pcm).toEqual(expected.pcm);
          expect(synth.render(request)?.pcm).toEqual(expected.pcm);
        }
      } finally {
        renderer.close();
      }
    }
  });
});
