import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initProject, writeAtomic } from "../src/project/init.ts";
import { diffScores } from "./diff.ts";
import { FX_LANES } from "./fx.ts";
import { instrumentForWord, resolveInstrumentWord } from "./instruments.ts";
import {
  KEYS_PARAMS,
  KEYS_PRESETS,
  keysParamName,
  normalizeKeys,
  pianoWrite,
  resolvedKeys,
} from "./keys.ts";
import { createScore, ScoreValidationError, TrackScore } from "./score.ts";
import { evaluateProject } from "./sdk/eval.ts";
import { printProject, printTrack } from "./sdk/print.ts";
import { track as sdkTrack } from "./sdk/v1.ts";

const keyed = createScore({
  tempoBpm: 90,
  bars: 1,
  tracks: [
    {
      id: "piano",
      name: "piano",
      instrument: "grand",
      keys: { preset: "ballad", hardness: 0.35, body: "felt" },
      fxAutomation: {
        "keys-hardness": [
          { tick: 0, value: 0.2 },
          { tick: 960, value: 0.8 },
        ],
      },
    },
    { id: "plain", name: "plain", instrument: "upright", keys: {} },
    { id: "legacy", name: "legacy", instrument: "piano" },
  ],
});

describe("Track.keys", () => {
  test("is optional, stored in KEYS_PARAMS order with the preset last", () => {
    const track = keyed.tracks[0]!;
    expect(Object.keys(track.keys!)).toEqual(["hardness", "body", "preset"]);
    expect(keyed.tracks[1]!.keys).toEqual({});
    expect(keyed.tracks[2]!.keys).toBeUndefined();
    expect(
      JSON.parse(JSON.stringify(keyed.toJSON())).tracks[2],
    ).not.toHaveProperty("keys");
  });

  test("rejects unknown parameters with a suggestion and out-of-range values", () => {
    expect(() => normalizeKeys({ aftersound: 0.2 })).toThrow(
      'did you mean "after"',
    );
    expect(() => normalizeKeys({ hardness: 2 })).toThrow("between 0 and 1");
    expect(() => normalizeKeys({ preset: "nope" })).toThrow("preset");
    expect(() =>
      createScore({
        tracks: [
          { id: "a", name: "a", instrument: "grand", keys: [] as never },
        ],
      }),
    ).toThrow(ScoreValidationError);
  });

  test("resolves grand defaults, family, preset, then overrides", () => {
    const params = resolvedKeys("upright", { preset: "ballad", decay: 2 });
    expect(params.inharm).toBe(2.5); // family
    expect(params.hardness).toBe(0.3); // preset
    expect(params.after).toBe(0.5); // preset
    expect(params.decay).toBe(2); // override
    expect(params.stretch).toBe(1);
    expect(resolvedKeys("honkytonk", {}).unison).toBe(16);
    expect(resolvedKeys("felt", {}).felt).toBe(1);
    expect(resolvedKeys("prepared", {}).prep).toBe(0.6);
  });

  test("automatable params have keys-<param> lanes", () => {
    const lanes = FX_LANES.filter((lane) => lane.effect === "keys").map(
      (lane) => lane.lane,
    );
    expect(lanes).toEqual([
      "keys-hardness",
      "keys-touch",
      "keys-decay",
      "keys-release",
      "keys-knock",
      "keys-noise",
      "keys-felt",
    ]);
    expect(keysParamName("aftersound")).toBe("after");
    expect(keysParamName("vibrato")).toBe("vib");
  });

  test("every preset validates and names its instrument family", () => {
    for (const [name, preset] of Object.entries(KEYS_PRESETS)) {
      expect(normalizeKeys({ preset: name, ...preset.keys })).toBeDefined();
      for (const key of Object.keys(preset.keys))
        expect(KEYS_PARAMS[key]).toBeDefined();
    }
  });
});

describe("piano word rules", () => {
  test("stored and resolved piano stays the legacy tone; organ stays synth", () => {
    expect(resolveInstrumentWord("piano")).toEqual({ instrument: "piano" });
    expect(instrumentForWord("organ")).toBe("organ");
    expect(instrumentForWord("keys")).toBe("keys");
    expect(new TrackScore(keyed.toJSON()).tracks[2]!.instrument).toBe("piano");
  });

  test("grand and the preset words resolve to keys rows", () => {
    expect(resolveInstrumentWord("grand")).toEqual({
      instrument: "grand",
      field: "keys",
      preset: "grand",
    });
    expect(instrumentForWord("lofi")).toBe("felt");
    expect(instrumentForWord("ballad")).toBe("grand");
    expect(instrumentForWord("honkytonk")).toBe("honkytonk");
  });

  test("a new write of piano stores grand with keys", () => {
    expect(pianoWrite("piano")).toMatchObject({
      instrument: "grand",
      keys: { preset: "grand" },
    });
    expect(pianoWrite("Grand")?.instrument).toBe("grand");
    expect(pianoWrite("lofi")?.fx?.crush).toEqual({ bits: 10 });
    expect(pianoWrite("organ")).toBeUndefined();
    expect(pianoWrite("saw")).toBeUndefined();
  });
});

describe("SDK and printer", () => {
  test("SDK preset words bring the prompt's preset effects", () => {
    for (const word of Object.keys(KEYS_PRESETS)) {
      const spec = sdkTrack({ name: "p", instrument: word });
      const write = pianoWrite(word)!;
      expect(spec.filter ?? undefined).toEqual(
        write.filter ? { ...write.filter } : undefined,
      );
      expect(spec.reverb ?? undefined).toEqual(
        write.reverb ? { ...write.reverb } : undefined,
      );
      expect(spec.fx ?? undefined).toEqual(
        write.fx ? { ...write.fx } : undefined,
      );
    }
    // Explicit effects win; a printed family with keys adds nothing.
    const own = sdkTrack({
      name: "p",
      instrument: "lofi",
      filter: { cutoff: 900 },
      fx: { crush: { bits: 4 } },
    });
    expect(own.filter?.cutoff).toBe(900);
    expect(own.fx?.crush).toEqual({ bits: 4 });
    expect(
      sdkTrack({ name: "p", instrument: "felt", keys: {} }).reverb,
    ).toBeNull();
  });

  test("prints keys and survives print → eval unchanged", async () => {
    const text = printTrack(keyed, keyed.tracks[0]!);
    expect(text).toContain('instrument: "grand"');
    expect(text).toContain(
      'keys: { hardness: 0.35, body: "felt", preset: "ballad" }',
    );
    expect(printTrack(keyed, keyed.tracks[1]!)).toContain("keys: {}");
    expect(printTrack(keyed, keyed.tracks[2]!)).not.toContain("keys");
    const dir = await mkdtemp(join(tmpdir(), "dawg-keys-"));
    try {
      await initProject(dir);
      for (const file of printProject(keyed).files)
        await writeAtomic(join(dir, file.path), file.text);
      const evaluated = await evaluateProject(dir);
      if (!evaluated.ok) throw new Error(JSON.stringify(evaluated.diagnostics));
      expect(diffScores(keyed, evaluated.score)).toEqual([]);
      expect(printProject(evaluated.score).files).toEqual(
        printProject(keyed).files,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('track({ instrument: "grand" }) alone plays the modelled grand', async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-keys-sdk-"));
    try {
      await initProject(dir);
      await writeAtomic(
        join(dir, "song.ts"),
        [
          'import { song } from "dawg";',
          'import { track, note } from "dawg";',
          "export default song({",
          "  tempo: 100,",
          "  bars: 1,",
          "  tracks: [",
          '    track({ name: "a", instrument: "grand", notes: [note("C4", 0, 1)] }),',
          '    track({ name: "b", instrument: "lofi", keys: { hardness: 0.2 } }),',
          '    track({ name: "c", instrument: "piano" }),',
          "  ],",
          "});",
          "",
        ].join("\n"),
      );
      const evaluated = await evaluateProject(dir);
      if (!evaluated.ok) throw new Error(JSON.stringify(evaluated.diagnostics));
      const [a, b, c] = evaluated.score.tracks;
      expect(a!.instrument).toBe("grand");
      expect(a!.keys).toEqual({ preset: "grand" });
      expect(b!.instrument).toBe("felt");
      expect(b!.keys).toEqual({ hardness: 0.2, preset: "lofi" });
      // The preset word brings the same effects as `piano lofi`.
      expect(b!.filter).toMatchObject({ cutoff: 3500, resonance: 0.1 });
      expect(b!.fx?.crush).toMatchObject({ bits: 10 });
      expect(c!.instrument).toBe("piano");
      expect(c!.keys).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
