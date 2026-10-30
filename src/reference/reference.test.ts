import { afterEach, describe, expect, test } from "bun:test";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { decodeLoop } from "../../core/loop.ts";
import type { CommandRunner } from "../auth/runner.ts";
import type { MediaRunContext } from "../media/types.ts";
import { projectPath, sha256File } from "../media/paths.ts";
import { VOCAL_MODEL, VocalCancelledError } from "../vocals/spec.ts";
import {
  fitReferenceGrid,
  parseReferenceLyrics,
  prepareReference,
  readPreparedReference,
  recreateReference,
  referenceLyricsFromWhisper,
  referenceSections,
  REFERENCE_HELPER,
  runReferenceCommand,
  type ReferenceMedia,
} from "./index.ts";

const roots: string[] = [];
async function temp() {
  const root = await mkdtemp(join(tmpdir(), "dawg-reference-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
function audio(frames = 96000, rate = 24000): Buffer {
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++)
    wav.writeInt16LE(
      Math.round(Math.sin((frame * 2 * Math.PI * 440) / rate) * 8000),
      44 + frame * 2,
    );
  return wav;
}
const lyrics = [
  {
    start: 0.1,
    end: 3.8,
    text: "we keep the light",
    wordCenters: [0.4, 1.2, 1.8, 2.8],
  },
];

async function fixture() {
  const root = await temp();
  const sourcePath = join(root, "selected-audio.wav");
  await writeFile(sourcePath, audio());
  const calls: {
    command: string;
    args: readonly string[];
    maxOutputBytes?: number;
  }[] = [];
  let abortDuring: "analyze" | "synthesize" | undefined;
  const controller = new AbortController();
  const runner: CommandRunner = {
    which: (command) =>
      ["ffmpeg", "ffprobe", "whisper-cli"].includes(command)
        ? `/fake/${command}`
        : undefined,
    async run(command, args, options = {}) {
      calls.push({ command, args, maxOutputBytes: options.maxOutputBytes });
      if (command === "ffprobe") {
        return {
          code: 0,
          stdout: JSON.stringify({
            format: { duration: "4" },
            streams: [
              { sample_rate: "24000", channels: 1, codec_name: "pcm_s16le" },
            ],
          }),
          stderr: "",
          killed: false,
        };
      } else if (command === "ffmpeg") {
        const rate = Number(args[args.indexOf("-ar") + 1]);
        await writeFile(args.at(-1)!, audio(rate * 4, rate));
      } else if (args.includes("--analyze")) {
        if (abortDuring === "analyze") {
          controller.abort();
          return { code: 143, stdout: "", stderr: "", killed: true };
        }
        const at = args.indexOf("--analyze");
        await writeFile(args[at + 2]!, "fake reference controls");
        await writeFile(
          args[at + 3]!,
          JSON.stringify({
            notes: [
              {
                startSeconds: 0.2,
                endSeconds: 1.2,
                pitch: 69,
                velocity: 0.8,
                confidence: 0.9,
              },
              {
                startSeconds: 1.4,
                endSeconds: 3.5,
                pitch: 72,
                velocity: 0.7,
                confidence: 0.85,
              },
            ],
            blocks: [
              {
                start: 0,
                end: 4,
                features: [0.5, 0.8, 1, ...Array(11).fill(0)],
              },
            ],
          }),
        );
      } else if (args.includes("--synthesize")) {
        if (abortDuring === "synthesize") {
          controller.abort();
          return { code: 143, stdout: "", stderr: "", killed: true };
        }
        const config = JSON.parse(await readFile(args.at(-1)!, "utf8")) as {
          outputDirectory: string;
        };
        for (const name of [
          "stock.wav",
          "comparison-source.wav",
          "comparison-stock.wav",
        ])
          await writeFile(join(config.outputDirectory, name), audio());
        await writeFile(
          join(config.outputDirectory, "report.json"),
          JSON.stringify({
            voice: "bf_emma",
            sampleRate: 24000,
            frames: 96000,
            peak: 0.25,
            provenance: { model: VOCAL_MODEL },
            referenceAudioUsedAsSamples: false,
            finite: true,
            pitchMedianAbsoluteCents: 15,
            wordClarity: { status: "unverified" },
            uncoveredVoicedSeconds: 0.2,
          }),
        );
      } else if (command === "whisper-cli") {
        const out = args[args.indexOf("-of") + 1]!;
        await writeFile(
          `${out}.json`,
          JSON.stringify({
            transcription: [
              {
                offsets: { from: 100, to: 3800 },
                text: " we keep the light",
                tokens: [
                  { text: " we", t_dtw: 40 },
                  { text: " keep", t_dtw: 120 },
                  { text: " the", t_dtw: 180 },
                  { text: " light", t_dtw: 280 },
                ],
              },
            ],
          }),
        );
      } else throw new Error(`Unexpected fake command: ${command}`);
      return { code: 0, stdout: "{}", stderr: "", killed: false };
    },
  };
  const context: MediaRunContext = {
    projectRoot: root,
    trackSlug: "main",
    runner,
    signal: controller.signal,
    progress() {},
  };
  let downloads = 0;
  const media: Partial<ReferenceMedia> = {
    async download() {
      downloads++;
      const path = "tracks/main/downloads/returned-asset.wav";
      await mkdir(dirname(join(root, path)), { recursive: true });
      await copyFile(sourcePath, join(root, path));
      return { summary: "downloaded", outputs: [path], content: { wav: path } };
    },
    async split(args) {
      const folder = join(
        dirname(join(root, args.file)),
        "unusual-stem-location",
      );
      await mkdir(folder);
      const vocal = join(folder, "returned-vocal.wav"),
        other = join(folder, "returned-other.wav");
      await writeFile(vocal, audio());
      await writeFile(other, audio());
      const voices = {
        vocals: projectPath(root, vocal),
        other: projectPath(root, other),
      };
      return {
        summary: "split",
        outputs: Object.values(voices),
        content: { stems: voices },
      };
    },
    async analyze(args) {
      const path = join(
        dirname(join(root, args.file)),
        "returned-analysis.json",
      );
      await writeFile(
        path,
        JSON.stringify({
          bpm: 120,
          grid: { beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4] },
        }),
      );
      const relative = projectPath(root, path);
      return {
        summary: "analyzed",
        outputs: [relative],
        content: { analysis: relative },
      };
    },
  };
  const options = {
    media,
    backend: { python: process.execPath, source: "configured" as const },
  };
  return {
    root,
    sourcePath,
    context,
    controller,
    runner,
    calls,
    media,
    options,
    downloads: () => downloads,
    abortAt: (stage: "analyze" | "synthesize") => {
      abortDuring = stage;
    },
  };
}

describe("reference evidence", () => {
  test("bounds supplied actual lyrics and word centers", () => {
    expect(parseReferenceLyrics(lyrics, 4)[0]!.timing).toBe("supplied");
    for (const value of [
      [],
      [{ ...lyrics[0], start: -1 }],
      [{ ...lyrics[0], end: 30 }],
      [{ ...lyrics[0], text: "\u001b[2J" }],
      [{ ...lyrics[0], wordCenters: [0.2] }],
      [{ ...lyrics[0], wordCenters: [1, 0.9, 2, 3] }],
      [{ ...lyrics[0], speech: "../../voice.wav" }],
    ])
      expect(() => parseReferenceLyrics(value, 4)).toThrow();
  });

  test("distinguishes whisper word anchors from interpolated segment timing", () => {
    const value = {
      transcription: [
        {
          offsets: { from: 100, to: 3800 },
          text: " we keep the light",
          tokens: [
            { text: " we", t_dtw: 40 },
            { text: " keep", t_dtw: 120 },
            { text: " the", t_dtw: 180 },
            { text: " light", t_dtw: 280 },
          ],
        },
      ],
    };
    const anchored = referenceLyricsFromWhisper(value, 4);
    expect(anchored[0]!.wordCenters).toEqual([0.4, 1.2, 1.8, 2.8]);
    expect(anchored[0]!.timing).toBe("whisper-dtw");
    expect(
      referenceLyricsFromWhisper(
        { transcription: [{ ...value.transcription[0], tokens: [] }] },
        4,
      )[0]!.timing,
    ).toBe("segment-interpolation");
  });

  test("keeps tempo drift in observed beats and flags the fixed-tempo approximation", () => {
    const beats = Array.from(
      { length: 100 },
      (_, index) => 0.1 + index * 0.5 + index * index * 0.0002,
    );
    const grid = fitReferenceGrid(beats, 60);
    expect(grid.beats).toEqual(beats);
    expect(grid.linearResidualSeconds).toBeGreaterThan(0.1);
    expect(grid.driftSecondsPerMinute).toBeGreaterThan(1);
    expect(grid.evidence).toContain("unverified");
    expect(() => fitReferenceGrid([0, 1, 0.5], 4)).toThrow(/increase/);
  });

  test("folds repeated feature blocks without inventing chorus/verse labels", () => {
    const a = [0.5, 0.8, 1, ...Array(11).fill(0)],
      b = [0.1, 0.1, 0, 1, ...Array(10).fill(0)];
    const sections = referenceSections(
      [
        { start: 0, end: 4, features: a },
        { start: 4, end: 8, features: b },
        { start: 8, end: 12, features: a },
      ],
      12,
    );
    expect(sections.map((section) => section.label)).toEqual([
      "section-1",
      "section-2",
      "section-1",
    ]);
    expect(sections[2]!.evidence).toContain("unverified");
  });
});

describe("immutable reference preparation", () => {
  test("an allowed external vocal file is admitted before the ordinary preparation pipeline", async () => {
    const setup = await fixture(),
      external = await temp(),
      path = join(external, "permitted.wav");
    await copyFile(setup.sourcePath, path);
    const before = await sha256File(path);
    const context = { ...setup.context, readRoots: [await realpath(external)] };
    const prepared = await prepareReference(
      { file: path, sourceIsVocal: true },
      context,
      setup.options,
    );
    expect(prepared.data.originalSource).toMatch(
      /^tracks\/main\/downloads\/reference-[a-f0-9]{64}\/source\.audio$/,
    );
    expect(prepared.sourceHash).toBe(before);
    expect(prepared.data.import).toBeDefined();
    expect(await sha256File(path)).toBe(before);
    expect(await readdir(external)).toEqual(["permitted.wav"]);
  });

  test("uses already returned separated download stems without separating again", async () => {
    const setup = await fixture();
    const options = {
      ...setup.options,
      media: {
        ...setup.media,
        download: async () => ({
          summary: "downloaded stems",
          outputs: ["selected-audio.wav"],
          content: {
            wav: "selected-audio.wav",
            stems: { vocals: "selected-audio.wav" },
          },
        }),
        split: async () => {
          throw new Error("Should reuse the returned stem");
        },
      },
    };
    const result = await prepareReference(
      { url: "https://youtu.be/abcdefghijk" },
      setup.context,
      options,
    );
    expect(result.isolation).toBe("separated-vocal");
    expect(result.stems.vocals).toContain("/stems/vocals.wav");
  });

  test("local and YouTube routes consume returned artifacts and share the downstream contract", async () => {
    const setup = await fixture();
    const before = await sha256File(setup.sourcePath);
    const local = await prepareReference(
      { file: "selected-audio.wav" },
      setup.context,
      setup.options,
    );
    const remote = await prepareReference(
      { url: "https://youtu.be/abcdefghijk" },
      setup.context,
      setup.options,
    );
    expect(local.isolation).toBe("separated-vocal");
    expect(local.stems.vocals).toContain(
      "unusual-stem-location/returned-vocal.wav",
    );
    expect(remote.sourceHash).toBe(local.sourceHash);
    expect(remote.grid).toEqual(local.grid);
    expect(remote.duration).toBe(local.duration);
    expect(setup.downloads()).toBe(1);
    expect(await sha256File(setup.sourcePath)).toBe(before);
    const reread = await readPreparedReference(
      local.manifestPath,
      setup.context,
    );
    expect(reread.sourceHash).toBe(local.sourceHash);
    const score = decodeLoop(
      await readFile(join(setup.root, local.scorePath), "utf8"),
    );
    expect(score.notes).toHaveLength(2);
    expect(setup.calls.some((call) => call.args[1] === REFERENCE_HELPER)).toBe(
      true,
    );
  });

  test("reuses accepted preparation with no Python and detects modified accepted files", async () => {
    const setup = await fixture();
    const first = await prepareReference(
      { file: "selected-audio.wav", sourceIsVocal: true },
      setup.context,
      setup.options,
    );
    const count = setup.calls.length;
    const reused = await prepareReference(
      { file: "selected-audio.wav", sourceIsVocal: true },
      setup.context,
      { media: setup.media },
    );
    expect(reused.reused).toBe(true);
    expect(setup.calls).toHaveLength(count);
    await writeFile(join(setup.root, first.vocalPath), "changed");
    await expect(
      readPreparedReference(first.manifestPath, setup.context),
    ).rejects.toThrow(/file changed/);
  });

  test("never claims a full mix is isolated when separation returns no vocal", async () => {
    const setup = await fixture();
    await expect(
      prepareReference({ file: "selected-audio.wav" }, setup.context, {
        ...setup.options,
        media: {
          ...setup.media,
          split: async () => ({
            summary: "none",
            outputs: [],
            content: { stems: {} },
          }),
        },
      }),
    ).rejects.toThrow(/not an isolated vocal/);
    expect(await readdir(join(setup.root, "tracks/main/references"))).toEqual(
      [],
    );
  });

  test("rejects escape paths, symlinked outputs, missing tool artifacts and denied task scope", async () => {
    const setup = await fixture();
    await expect(
      prepareReference(
        { file: "../outside.wav" },
        setup.context,
        setup.options,
      ),
    ).rejects.toThrow();
    await expect(
      prepareReference(
        { url: "https://example.org/audio" },
        setup.context,
        setup.options,
      ),
    ).rejects.toThrow(/YouTube/);
    await expect(
      prepareReference(
        { file: "selected-audio.wav", sourceIsVocal: true },
        { ...setup.context, writeScope: () => false },
        setup.options,
      ),
    ).rejects.toThrow(/write scope/);
    await expect(
      prepareReference({ url: "https://youtu.be/abcdefghijk" }, setup.context, {
        ...setup.options,
        media: {
          download: async () => ({
            summary: "bad",
            outputs: [],
            content: { wav: "selected-audio.wav" },
          }),
        },
      }),
    ).rejects.toThrow(/admitted audio/);
    const outside = await temp();
    await mkdir(join(setup.root, "tracks/main"), { recursive: true });
    await symlink(outside, join(setup.root, "tracks/main/references"));
    await expect(
      prepareReference(
        { file: "selected-audio.wav", sourceIsVocal: true },
        setup.context,
        setup.options,
      ),
    ).rejects.toThrow(/without symlinks/);
    expect(await readdir(outside)).toEqual([]);
  });

  test("cancelled preparation cleans only its pending output and preserves source", async () => {
    const setup = await fixture();
    setup.abortAt("analyze");
    const before = await sha256File(setup.sourcePath);
    await expect(
      prepareReference(
        { file: "selected-audio.wav", sourceIsVocal: true },
        setup.context,
        setup.options,
      ),
    ).rejects.toBeInstanceOf(VocalCancelledError);
    expect(await readdir(join(setup.root, "tracks/main/references"))).toEqual(
      [],
    );
    expect(await sha256File(setup.sourcePath)).toBe(before);
  });
});

describe("stock reference recreation", () => {
  test("accepts supplied words, aligned level-matched pair, editable real-audio score and honest quality", async () => {
    const setup = await fixture();
    const prepared = await prepareReference(
      { file: "selected-audio.wav", sourceIsVocal: true },
      setup.context,
      setup.options,
    );
    const result = await recreateReference(
      { prepared: prepared.manifestPath, lyrics },
      setup.context,
      setup.options,
    );
    expect(result.comparison.offsetSeconds).toBe(0);
    expect(result.comparison.frames).toBe(96000);
    expect(result.quality.wordClarity).toEqual({ status: "unverified" });
    const score = decodeLoop(
      await readFile(join(setup.root, result.scorePath), "utf8"),
    );
    const vocal = score.tracks.find((track) => track.id === "stock-vocal")!;
    expect(vocal.clips?.[0]?.src).toBe(result.stockPath);
    expect(vocal.clips?.[0]?.sha256).toBe(result.files["stock.wav"]);
    expect(score.notes).toHaveLength(2);
    expect(
      score.tracks.find((track) => track.id === "reference-melody")?.muted,
    ).toBe(true);
    const reused = await recreateReference(
      { prepared: prepared.manifestPath, lyrics },
      setup.context,
    );
    expect(reused.reused).toBe(true);
    expect(reused.stockPath).toBe(result.stockPath);
    const durableConfig = JSON.parse(
      await readFile(
        join(dirname(join(setup.root, result.manifestPath)), "config.json"),
        "utf8",
      ),
    );
    expect(durableConfig.outputDirectory).not.toContain("pending-");
  });

  test("uses actual cached Whisper text when lyrics are absent, with explicit timing evidence", async () => {
    const setup = await fixture();
    const model = join(setup.root, "ggml-small.en.bin");
    await writeFile(model, "fake-model");
    const prepared = await prepareReference(
      { file: "selected-audio.wav", sourceIsVocal: true },
      setup.context,
      setup.options,
    );
    const result = await recreateReference(
      { prepared: prepared.manifestPath },
      setup.context,
      { ...setup.options, whisperModel: model },
    );
    const captured = JSON.parse(
      await readFile(join(setup.root, result.lyricsPath), "utf8"),
    );
    expect(captured[0].text).toBe("we keep the light");
    expect(captured[0].timing).toBe("whisper-dtw");
    expect(
      setup.calls.find((call) => call.command === "whisper-cli")?.args,
    ).toContain("-ojf");
    const callsBeforeReuse = setup.calls.length;
    const reused = await recreateReference(
      { prepared: prepared.manifestPath },
      {
        ...setup.context,
        env: { DAWG_REFERENCE_PYTHON: join(setup.root, "missing-python") },
        runner: { ...setup.runner, which: () => undefined },
      },
      { whisperModel: model },
    );
    expect(reused.reused).toBe(true);
    expect(setup.calls).toHaveLength(callsBeforeReuse);
    await writeFile(model, "changed-model-identity");
    const fresh = await recreateReference(
      { prepared: prepared.manifestPath },
      setup.context,
      { ...setup.options, whisperModel: model },
    );
    expect(fresh.manifestPath).not.toBe(result.manifestPath);
  });

  test("missing transcription model fails without network and retains accepted preparation", async () => {
    const setup = await fixture();
    const prepared = await prepareReference(
      { file: "selected-audio.wav", sourceIsVocal: true },
      setup.context,
      setup.options,
    );
    await expect(
      recreateReference({ prepared: prepared.manifestPath }, setup.context, {
        ...setup.options,
        whisperModel: join(setup.root, "missing.bin"),
      }),
    ).rejects.toThrow(/No model is downloaded/);
    expect(await readdir(join(setup.root, "tracks/main/references"))).toEqual([
      dirname(prepared.manifestPath).split("/").at(-1)!,
    ]);
  });

  test("cancelled stock synthesis preserves preparation and earlier complete take", async () => {
    const setup = await fixture();
    const prepared = await prepareReference(
      { file: "selected-audio.wav", sourceIsVocal: true },
      setup.context,
      setup.options,
    );
    const first = await recreateReference(
      { prepared: prepared.manifestPath, lyrics },
      setup.context,
      setup.options,
    );
    setup.abortAt("synthesize");
    await expect(
      recreateReference(
        {
          prepared: prepared.manifestPath,
          lyrics: [{ ...lyrics[0], text: "we hold the light" }],
        },
        setup.context,
        setup.options,
      ),
    ).rejects.toBeInstanceOf(VocalCancelledError);
    expect(
      await readdir(join(setup.root, "tracks/main/references")),
    ).toHaveLength(2);
    expect(
      (await readFile(join(setup.root, first.stockPath))).length,
    ).toBeGreaterThan(44);
  });

  test("public helper contains no source identities, private paths or permission records", async () => {
    const source = await readFile(REFERENCE_HELPER, "utf8");
    expect(source).not.toContain("/Users/");
    expect(source).not.toContain(".plans/");
    expect(source).not.toContain("CONFIG =");
    expect(source).toContain("referenceAudioUsedAsSamples");
    expect(source).toContain("wordClarity");
  });
});

test("reference CLI help and argument errors never start inference", async () => {
  let output = "",
    errors = "";
  const stdout = {
      write: (text: string) => {
        output += text;
      },
    },
    stderr = {
      write: (text: string) => {
        errors += text;
      },
    };
  expect(
    await runReferenceCommand(
      ["reference", "--help"],
      "/unused",
      stdout,
      stderr,
    ),
  ).toBe(0);
  expect(output).toContain("reference prepare");
  expect(
    await runReferenceCommand(
      ["reference", "prepare", "audio.wav", "--track", "../escape"],
      "/unused",
      stdout,
      stderr,
    ),
  ).toBe(1);
  expect(errors).toContain("track must name");
});
