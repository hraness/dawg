import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { encodeWav } from "../audio/wav.ts";
import { estimateKey as namingEstimateKey } from "../session/naming.ts";
import { estimateKey } from "../../core/key.ts";
import { DRUM_FIXTURE_DIR } from "./media-fixtures.ts";
import {
  BASIC_PITCH_STEM_PARAMETERS,
  basicPitchOutputBase,
  basicPitchParameterArguments,
  parseBasicPitchNoteCsv,
} from "./vendor/basic-pitch.ts";
import {
  beatToSeconds,
  fixedBeatGrid,
  gridMedianBpm,
  parseBeatGrid,
  secondsToBeat,
} from "./vendor/grid.ts";
import { normalizeServiceBaseUrl, validateYoutubeUrl } from "./vendor/util.ts";
import { parseWav, WavFormatError } from "./vendor/wav.ts";

const encoder = new TextEncoder();

describe("validateYoutubeUrl", () => {
  test("accepts YouTube hosts and strips credentials and fragments", () => {
    expect(validateYoutubeUrl("https://youtu.be/abc123")).toBe(
      "https://youtu.be/abc123",
    );
    expect(
      validateYoutubeUrl("https://user:pw@www.youtube.com/watch?v=x#t=1"),
    ).toBe("https://www.youtube.com/watch?v=x");
    expect(validateYoutubeUrl("https://music.youtube.com/watch?v=x")).toContain(
      "music.youtube.com",
    );
  });

  test("rejects other hosts, schemes and relative input", () => {
    expect(() => validateYoutubeUrl("https://example.com/watch?v=x")).toThrow(
      /not YouTube/,
    );
    expect(() => validateYoutubeUrl("ftp://youtube.com/x")).toThrow(/HTTP/);
    expect(() => validateYoutubeUrl("youtube.com/watch?v=x")).toThrow(
      /absolute/,
    );
    expect(() =>
      validateYoutubeUrl("https://youtube.com.evil.example/watch"),
    ).toThrow(/not YouTube/);
  });

  test("service base URL must be http(s) and mentions the env var", () => {
    expect(normalizeServiceBaseUrl("http://127.0.0.1:8000/").href).toBe(
      "http://127.0.0.1:8000/",
    );
    expect(() => normalizeServiceBaseUrl("file:///tmp")).toThrow(
      /DAWG_STEMDECK_URL/,
    );
  });
});

describe("basic-pitch CSV", () => {
  test("parses note events and skips # comment lines", () => {
    const csv = [
      "# soundfish fixture",
      "# second comment",
      "start_time_s,end_time_s,pitch_midi,velocity,confidence",
      "0.000,0.500,45,80,0.9",
      "1.000,1.250,47,100,",
      ",,,,",
    ].join("\n");
    const notes = parseBasicPitchNoteCsv(encoder.encode(csv));
    expect(notes.map((note) => note.pitch)).toEqual([45, 47]);
    expect(notes[0]!.startSeconds).toBe(0);
    expect(notes[0]!.endSeconds).toBe(0.5);
    expect(notes[0]!.velocity).toBeGreaterThan(0);
    expect(notes[0]!.velocity).toBeLessThanOrEqual(1);
    expect(notes[0]!.confidence).toBe(0.9);
    expect(notes[1]!.confidence).toBeUndefined();
  });

  test("per-stem parameters become CLI flags and output names match", () => {
    const flags = basicPitchParameterArguments(
      BASIC_PITCH_STEM_PARAMETERS.bass,
    );
    expect(flags).toContain("--onset-threshold");
    expect(flags).toContain("--minimum-frequency");
    expect(
      basicPitchParameterArguments(BASIC_PITCH_STEM_PARAMETERS.piano),
    ).not.toContain("--minimum-frequency");
    expect(basicPitchOutputBase("bass.wav")).toBe("bass_basic_pitch");
  });
});

describe("wav parsing", () => {
  test("round-trips encodeWav output", () => {
    const pcm = new Int16Array([0, 16_384, -16_384, 32_767]);
    const parsed = parseWav(encodeWav(pcm, 8_000, 2));
    expect(parsed.sampleRate).toBe(8_000);
    expect(parsed.channels).toBe(2);
    expect(parsed.sampleCount).toBe(2);
    expect(parsed.sample(0, 1)).toBeCloseTo(0.5, 3);
    expect(parsed.sample(1, 0)).toBeCloseTo(-0.5, 3);
  });

  test("rejects non-RIFF bytes and oversized files", () => {
    expect(() => parseWav(encoder.encode("not a wav file at all"))).toThrow(
      WavFormatError,
    );
    const bytes = encodeWav(new Int16Array(4_000), 8_000);
    expect(() => parseWav(bytes, { maximumBytes: 100 })).toThrow(
      WavFormatError,
    );
  });
});

describe("beat grids", () => {
  test("parses the StemDeck fixture grid", async () => {
    const bytes = new Uint8Array(
      await Bun.file(join(DRUM_FIXTURE_DIR, "excerpt.json")).arrayBuffer(),
    );
    const grid = parseBeatGrid(bytes);
    expect(grid.beats).toHaveLength(17);
    expect(grid.bars[0]).toEqual({ beat: 0, beatsPerBar: 4 });
    expect(gridMedianBpm(grid)).toBeGreaterThan(100);
    expect(gridMedianBpm(grid)).toBeLessThan(104);
  });

  test("fixed grids map seconds and beats both ways", () => {
    const grid = fixedBeatGrid(120, 4, 0.25);
    expect(grid.beats[0]).toBe(0.25);
    expect(grid.bars.map((bar) => bar.beat)).toEqual([0, 4]);
    expect(secondsToBeat(grid, 1.25)).toBeCloseTo(2, 6);
    expect(beatToSeconds(grid, 2)).toBeCloseTo(1.25, 6);
    // Past the last beat it extrapolates at the median interval.
    expect(secondsToBeat(grid, 10.25)).toBeCloseTo(20, 6);
  });
});

describe("estimateKey", () => {
  test("lives in core and is still re-exported by session/naming", () => {
    expect(namingEstimateKey).toBe(estimateKey);
    const histogram = new Array<number>(12).fill(0);
    for (const pc of [0, 2, 4, 5, 7, 9, 11]) histogram[pc] = 1;
    histogram[0] = 3;
    histogram[7] = 2;
    expect(estimateKey(histogram)).toBe("c major");
    expect(estimateKey([1, 2, 3])).toBeNull();
    expect(estimateKey(new Array<number>(12).fill(0))).toBeNull();
  });
});
