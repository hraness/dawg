import { afterAll, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { scriptedRunner, systemRunner } from "../auth/runner.ts";
import { projectOutline } from "../agent/workspace.ts";
import { createScore } from "../../core/score.ts";
import { analyzeAudio, readAnalysis } from "./analyze.ts";
import { doctor, formatDoctor } from "./backend.ts";
import { parseMediaArgv, runMediaCommand } from "./cli.ts";
import { downloadAudio } from "./download.ts";
import { importSample } from "./import.ts";
import { transcribeLyrics } from "./lyrics.ts";
import {
  DRUM_FIXTURE_DIR,
  ffprobeJson,
  runContext,
  stemdeckFetch,
  syntheticWav,
  tempProject,
} from "./media-fixtures.ts";
import { exists, readJson, trackSlug } from "./paths.ts";
import { findMediaTool } from "./registry.ts";
import { readSidecar } from "./sidecar.ts";
import { splitStems } from "./stems.ts";
import { MediaArgumentError } from "./tools.ts";
import type { ToolContext } from "../agent/tools.ts";

const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups) await cleanup();
});

const noFetch = (async () => {
  throw new Error("connection refused");
}) as unknown as typeof fetch;

const toolContext: ToolContext = {
  score: createScore({ tracks: [{ id: "main" }] }),
  focusedTrackId: "main",
  revision: 1,
  newNoteId: (track, index) => `${track}-${index}`,
};

const URL_A = "https://www.youtube.com/watch?v=VpFi3D_EB0c";
const SHORT_WAV = syntheticWav(2, (t) => 0.4 * Math.sin(2 * Math.PI * 220 * t));

async function project() {
  const created = await tempProject();
  cleanups.push(created.cleanup);
  return created;
}

function ytdlp(title: string, duration: number, sizeSeconds = 2) {
  return {
    match: (command: string) => command === "yt-dlp",
    respond: async (
      _command: string,
      args: readonly string[],
      options: {
        onOutput?: (stream: "stdout" | "stderr", chunk: string) => void;
      },
    ) => {
      const template = args[args.indexOf("-o") + 1]!;
      const dir = template.slice(0, template.lastIndexOf("/"));
      options.onOutput?.("stdout", "[download]  42.0% of 3.00MiB at 1MiB/s\n");
      options.onOutput?.("stdout", "[ExtractAudio] Destination: audio.wav\n");
      await Bun.write(
        join(dir, "audio.wav"),
        syntheticWav(sizeSeconds, () => 0.1),
      );
      await Bun.write(
        join(dir, "audio.info.json"),
        JSON.stringify({ title, duration, webpage_url: URL_A }),
      );
      return {};
    },
  };
}

describe("download_audio", () => {
  test("yt-dlp path writes <slug>.wav + sidecar and reuses it next time", async () => {
    const { root, downloads } = await project();
    const runner = scriptedRunner(
      [ytdlp("Election Time: Funky Brass!", 183.4)],
      ["yt-dlp", "ffmpeg"],
    );
    const context = runContext(
      { projectRoot: root, trackSlug: "main", fetch: noFetch },
      runner,
    );
    const now = () => new Date("2026-10-06T12:00:00Z");
    const result = await downloadAudio({ url: URL_A }, context, { now });
    expect(result.outputs).toEqual([
      "tracks/main/downloads/election-time-funky-brass.wav",
      "tracks/main/downloads/election-time-funky-brass.json",
    ]);
    expect(context.lines).toContain("yt-dlp 42%");
    // Lines are throttled, so the immediate [ExtractAudio] line is dropped.
    const call = runner.calls.find((entry) => entry.command === "yt-dlp")!;
    expect(call.args).toContain("--max-filesize");
    expect(call.args).toContain("500m");
    expect(call.args).toContain("--no-playlist");
    expect(call.args.at(-1)).toBe(URL_A);
    const sidecar = await readSidecar(
      join(downloads, "election-time-funky-brass.wav"),
    );
    expect(sidecar).toMatchObject({
      title: "Election Time: Funky Brass!",
      durationSeconds: 183.4,
      source: URL_A,
      backend: "yt-dlp",
      downloadedAt: "2026-10-06T12:00:00.000Z",
    });
    expect(sidecar!.sha256).toMatch(/^[0-9a-f]{64}$/);

    const again = await downloadAudio({ url: URL_A }, context, { now });
    expect(again.content.reused).toBe(true);
    expect(
      runner.calls.filter((entry) => entry.command === "yt-dlp"),
    ).toHaveLength(1);

    // The workspace outline (lane B) lists these for the brief.
    const outline = await projectOutline({ root, trackSlug: "main" });
    expect(outline.tree.join("\n")).toContain("election-time-funky-brass.wav");
  });

  test("an explicit name is slugified and collisions get a suffix", async () => {
    const { root } = await project();
    const runner = scriptedRunner(
      [ytdlp("A", 1), ytdlp("B", 1)],
      ["yt-dlp", "ffmpeg"],
    );
    const context = runContext(
      { projectRoot: root, trackSlug: "main", fetch: noFetch },
      runner,
    );
    const first = await downloadAudio(
      { url: URL_A, name: "My Loop (v2)" },
      context,
    );
    expect(first.outputs[0]).toBe("tracks/main/downloads/my-loop-v2.wav");
    const second = await downloadAudio(
      { url: "https://youtu.be/other", name: "My Loop (v2)" },
      context,
    );
    expect(second.outputs[0]).toBe("tracks/main/downloads/my-loop-v2-2.wav");
  });

  test("without yt-dlp or StemDeck the error names the install command", async () => {
    const { root } = await project();
    const context = runContext(
      { projectRoot: root, trackSlug: "main", fetch: noFetch },
      scriptedRunner([], ["ffmpeg"]),
    );
    await expect(downloadAudio({ url: URL_A }, context)).rejects.toThrow(
      /brew install yt-dlp/,
    );
  });

  test("falls back to StemDeck when yt-dlp is missing", async () => {
    const { root } = await project();
    const deck = stemdeckFetch({ stemBytes: SHORT_WAV });
    const runner = scriptedRunner(
      [
        {
          match: (command) => command === "ffmpeg",
          respond: async (_command, args) => {
            await Bun.write(args.at(-1)!, SHORT_WAV);
            return {};
          },
        },
      ],
      ["ffmpeg"],
    );
    const context = runContext(
      {
        projectRoot: root,
        trackSlug: "main",
        fetch: deck.fetcher,
        env: deck.env,
      },
      runner,
    );
    const result = await downloadAudio({ url: URL_A, name: "song" }, context, {
      stemdeck: { pollIntervalMs: 0, sleep: async () => undefined },
    });
    expect(result.outputs[0]).toBe("tracks/main/downloads/song.wav");
    expect(result.outputs).toContain(
      "tracks/main/downloads/song.stems/drums.wav",
    );
    expect(deck.calls).toContain("POST /api/jobs");
    expect(deck.calls).toContain("GET /api/jobs/job1/stems/vocals.wav");
    const sidecar = await readSidecar(
      join(root, "tracks/main/downloads/song.wav"),
    );
    expect(sidecar?.backend).toBe("stemdeck");
    expect(sidecar?.stemdeck).toEqual({
      url: "http://stemdeck.test",
      jobId: "job1",
    });
    expect(
      context.lines.some((line) => line.startsWith("stemdeck separating")),
    ).toBe(true);
  });
});

describe("split_stems", () => {
  test("demucs writes six stems into <base>.stems/ with progress", async () => {
    const { root, downloads } = await project();
    await Bun.write(join(downloads, "song.wav"), SHORT_WAV);
    const runner = scriptedRunner(
      [
        {
          match: (command) => command === "demucs",
          respond: async (_command, args, options) => {
            const out = args[args.indexOf("-o") + 1]!;
            options.onOutput?.(
              "stderr",
              " 42%|████      | 10/24 [00:05<00:07]\r",
            );
            for (const name of [
              "vocals",
              "drums",
              "bass",
              "guitar",
              "piano",
              "other",
            ])
              await Bun.write(
                join(out, "htdemucs_6s", `${name}.wav`),
                SHORT_WAV,
              );
            return {};
          },
        },
      ],
      ["demucs"],
    );
    const context = runContext(
      { projectRoot: root, trackSlug: "main", fetch: noFetch },
      runner,
    );
    const result = await splitStems({ file: "song.wav" }, context);
    expect(result.outputs).toHaveLength(6);
    expect(result.outputs).toContain(
      "tracks/main/downloads/song.stems/bass.wav",
    );
    expect(context.lines).toContain("demucs 42%");
    const call = runner.calls.find((entry) => entry.command === "demucs")!;
    expect(call.args.slice(0, 2)).toEqual(["-n", "htdemucs_6s"]);
    expect(call.options.env?.PYTHONUNBUFFERED).toBe("1");
    // Cached on the second call: no demucs run.
    const cached = await splitStems({ file: "song.wav" }, context);
    expect(cached.content.backend).toBe("cache");
    expect(
      runner.calls.filter((entry) => entry.command === "demucs"),
    ).toHaveLength(1);
  });

  test("a download with a source URL goes through StemDeck and records the job", async () => {
    const { root, downloads } = await project();
    await Bun.write(join(downloads, "song.wav"), SHORT_WAV);
    await Bun.write(
      join(downloads, "song.json"),
      JSON.stringify({
        title: "Song",
        source: URL_A,
        backend: "yt-dlp",
        downloadedAt: "x",
      }),
    );
    const beats = JSON.parse(
      await Bun.file(join(DRUM_FIXTURE_DIR, "excerpt.json")).text(),
    ) as Record<string, unknown>;
    const deck = stemdeckFetch({
      stemBytes: SHORT_WAV,
      beats,
      pollsBeforeDone: 2,
    });
    const context = runContext(
      {
        projectRoot: root,
        trackSlug: "main",
        fetch: deck.fetcher,
        env: deck.env,
      },
      scriptedRunner(
        [
          {
            match: (command) => command === "ffprobe",
            result: { stdout: ffprobeJson(2) },
          },
        ],
        ["ffprobe"],
      ),
    );
    const options = {
      stemdeck: { pollIntervalMs: 0, sleep: async () => undefined },
    };
    const result = await splitStems({ file: "song.wav" }, context, options);
    expect(result.content.backend).toBe("stemdeck");
    expect(
      deck.calls.filter((call) => call === "GET /api/jobs/job1"),
    ).toHaveLength(3);
    const sidecar = await readSidecar(join(downloads, "song.wav"));
    expect(sidecar?.stemdeck).toEqual({
      url: "http://stemdeck.test",
      jobId: "job1",
    });

    // Analysis of a stem reuses the parent download's StemDeck beat grid.
    const analysis = await analyzeAudio(
      { file: "song.stems/drums.wav" },
      context,
      options,
    );
    expect(deck.calls).toContain("GET /api/jobs/job1/beats");
    expect((analysis.content.grid as { detector: string }).detector).not.toBe(
      "dawg-fixed-grid",
    );
    expect(analysis.content.bpm as number).toBeGreaterThan(100);
    expect(analysis.content.bpm as number).toBeLessThan(104);
    // A pure 220 Hz sine: the tonic is A, the mode is a coin toss.
    expect(analysis.content.key as string).toMatch(/^a (major|minor)$/);
    const stored = await readAnalysis(
      join(downloads, "song.stems", "drums.wav"),
    );
    expect(stored?.grid?.beats).toHaveLength(17);
  });
});

describe("analyze_audio", () => {
  test("ffprobe + TS tempo/key/peaks, written next to the file", async () => {
    const { root, downloads } = await project();
    await Bun.write(
      join(downloads, "loop.wav"),
      await Bun.file(join(DRUM_FIXTURE_DIR, "drums.wav")).arrayBuffer(),
    );
    const runner = scriptedRunner(
      [
        {
          match: (command) => command === "ffprobe",
          result: { stdout: ffprobeJson(9.9) },
        },
      ],
      ["ffprobe"],
    );
    const context = runContext(
      { projectRoot: root, trackSlug: "main", fetch: noFetch },
      runner,
    );
    const result = await analyzeAudio({ file: "loop.wav" }, context);
    expect(result.outputs).toEqual([
      "tracks/main/downloads/loop.analysis.json",
    ]);
    expect(result.content.durationSeconds).toBe(9.9);
    expect(result.content.sampleRate).toBe(22_050);
    expect(result.content.bpm as number).toBeGreaterThan(95);
    expect(result.content.bpm as number).toBeLessThan(110);
    expect((result.content.peaks as number[]).length).toBe(48);
    const stored = await readAnalysis(join(downloads, "loop.wav"));
    expect(stored?.peaks).toHaveLength(240);
    expect(stored?.grid?.detector).toBe("dawg-fixed-grid");
    expect(context.lines).toEqual([
      "ffprobe",
      "decoding",
      "tempo",
      "key",
      "waveform",
    ]);
  });

  test("files outside the project are refused", async () => {
    const { root } = await project();
    const context = runContext(
      { projectRoot: root, trackSlug: "main", fetch: noFetch },
      scriptedRunner([], ["ffprobe"]),
    );
    await expect(
      analyzeAudio({ file: join(DRUM_FIXTURE_DIR, "drums.wav") }, context),
    ).rejects.toThrow(/outside the project/);
    await expect(
      analyzeAudio({ file: "../etc/passwd" }, context),
    ).rejects.toThrow(/not found|outside/);
  });
});

describe("import_sample", () => {
  test("ffmpeg → 48 kHz samples/<name>.wav and a sampler snippet", async () => {
    const { root, downloads } = await project();
    await Bun.write(join(downloads, "song.wav"), SHORT_WAV);
    const runner = scriptedRunner(
      [
        {
          match: (command) => command === "ffmpeg",
          respond: async (_command, args) => {
            await Bun.write(
              args.at(-1)!,
              syntheticWav(1, (t) => Math.sin(1000 * t), 48_000, 2),
            );
            return {};
          },
        },
      ],
      ["ffmpeg"],
    );
    const context = runContext(
      { projectRoot: root, trackSlug: "main", fetch: noFetch },
      runner,
    );
    const result = await importSample(
      { file: "song.wav", name: "vox", begin: 0.25, end: 0.5, root: "A3" },
      context,
    );
    expect(result.outputs).toEqual(["tracks/main/samples/vox.wav"]);
    expect(await exists(join(root, "tracks/main/samples/vox.wav"))).toBe(true);
    const call = runner.calls.find((entry) => entry.command === "ffmpeg")!;
    expect(call.args).toContain("48000");
    expect(result.content.snippet).toBe(
      'instrument: sampler({ vox: { src: "samples/vox.wav", root: "A3", begin: 0.25, end: 0.5 } }, { mode: "keyed" })',
    );
    const sample = result.content.sample as Record<string, unknown>;
    expect(sample.sampleRate).toBe(48_000);
    expect(sample.channels).toBe(2);
    expect(sample.sha256).toMatch(/^[0-9a-f]{64}$/);
    const plain = await importSample(
      { file: "song.wav", name: "vox" },
      {
        ...context,
        runner: scriptedRunner(
          [
            {
              match: (command) => command === "ffmpeg",
              respond: async (_command, args) => {
                await Bun.write(
                  args.at(-1)!,
                  syntheticWav(1, () => 0, 48_000, 2),
                );
                return {};
              },
            },
          ],
          ["ffmpeg"],
        ),
      },
    );
    expect(plain.content.snippet).toBe(
      'instrument: sampler({ vox: "samples/vox.wav" })',
    );
  });
});

describe("transcribe_lyrics", () => {
  test("announces the model download, then runs whisper-cli and writes json + txt", async () => {
    const { root, downloads } = await project();
    const home = join(root, "home");
    await Bun.write(join(downloads, "vocals.wav"), SHORT_WAV);
    const modelBytes = new Uint8Array(1024).fill(7);
    const fetched: string[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      fetched.push(url);
      if (url.endsWith("/ggml-base.en.bin"))
        return new Response(new Blob([modelBytes as BlobPart]), {
          status: 200,
          headers: { "content-length": String(modelBytes.byteLength) },
        });
      return new Response("nope", { status: 404 });
    }) as typeof fetch;
    const runner = scriptedRunner(
      [
        {
          match: (command) => command === "ffmpeg",
          respond: async (_command, args) => {
            await Bun.write(
              args.at(-1)!,
              syntheticWav(1, () => 0, 16_000),
            );
            return {};
          },
        },
        {
          match: (command) => command === "whisper-cli",
          respond: async (_command, args) => {
            const outBase = args[args.indexOf("-of") + 1]!;
            await Bun.write(
              `${outBase}.json`,
              JSON.stringify({
                transcription: [
                  { offsets: { from: 0, to: 1200 }, text: " Hello there" },
                  { offsets: { from: 1200, to: 2000 }, text: " general" },
                ],
              }),
            );
            return {};
          },
        },
      ],
      ["ffmpeg", "whisper-cli"],
    );
    const context = runContext(
      { projectRoot: root, trackSlug: "main", fetch: fetcher, homeDir: home },
      runner,
    );
    const result = await transcribeLyrics({ file: "vocals.wav" }, context);
    expect(fetched).toEqual([
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
    ]);
    const announced = context.lines.find((line) =>
      line.startsWith("downloading ggml-base.en.bin"),
    );
    expect(announced).toContain("141.1 MiB");
    expect(announced).toContain(join(home, ".cache", "dawg", "whisper"));
    expect(
      await exists(join(home, ".cache/dawg/whisper/ggml-base.en.bin")),
    ).toBe(true);
    const whisper = runner.calls.find(
      (entry) => entry.command === "whisper-cli",
    )!;
    expect(whisper.args.slice(0, 2)).toEqual([
      "-m",
      join(home, ".cache/dawg/whisper/ggml-base.en.bin"),
    ]);
    expect(whisper.args).toContain("-oj");
    expect(result.outputs).toEqual([
      "tracks/main/downloads/vocals.lyrics.json",
      "tracks/main/downloads/vocals.lyrics.txt",
    ]);
    expect(result.content.segments).toBe(2);
    expect(result.content.preview).toBe("Hello there\ngeneral");
    const stored = (await readJson(join(downloads, "vocals.lyrics.json"))) as {
      segments: { start: number; end: number; text: string }[];
    };
    expect(stored.segments[0]).toEqual({
      start: 0,
      end: 1.2,
      text: "Hello there",
    });

    // Second run: the model is cached, no fetch.
    await transcribeLyrics(
      { file: "vocals.wav" },
      {
        ...context,
        runner: scriptedRunner(
          [
            {
              match: (command) => command === "ffmpeg",
              respond: async (_command, args) => {
                await Bun.write(
                  args.at(-1)!,
                  syntheticWav(1, () => 0, 16_000),
                );
                return {};
              },
            },
            {
              match: (command) => command === "whisper-cli",
              respond: async (_command, args) => {
                await Bun.write(
                  `${args[args.indexOf("-of") + 1]!}.json`,
                  JSON.stringify({ transcription: [] }),
                );
                return {};
              },
            },
          ],
          ["ffmpeg", "whisper-cli"],
        ),
      },
    );
    expect(fetched).toHaveLength(1);
  });
});

describe("doctor", () => {
  test("reports each binary with its install command and never installs", async () => {
    const runner = scriptedRunner(
      [
        {
          match: (command, args) => command === "uv" && args[1] === "list",
          result: { stdout: "demucs v4.0.1\n- demucs\n" },
        },
      ],
      ["ffmpeg", "ffprobe", "uv"],
    );
    const report = await doctor({
      runner,
      fetch: noFetch,
      env: {},
    });
    expect(report.backend.kind).toBe("direct");
    const byName = Object.fromEntries(
      report.tools.map((tool) => [tool.name, tool]),
    );
    expect(byName["yt-dlp"]!.available).toBe(false);
    expect(byName["yt-dlp"]!.install).toBe(
      "brew install yt-dlp ffmpeg whisper-cpp",
    );
    expect(byName["demucs"]!.available).toBe(true);
    expect(byName["demucs"]!.command).toEqual(["uv", "tool", "run", "demucs"]);
    expect(byName["basic-pitch"]!.available).toBe(false);
    expect(byName["basic-pitch"]!.install).toBe("uv tool install basic-pitch");
    expect(byName["uv"]!.install).toContain("astral.sh/uv/install.sh");
    const lines = formatDoctor(report);
    expect(lines[0]).toBe(
      "· no StemDeck at http://127.0.0.1:8000 (set DAWG_STEMDECK_URL); using local binaries",
    );
    expect(
      lines.some((line) => /✗ yt-dlp/.test(line) && /brew install/.test(line)),
    ).toBe(true);
    expect(lines.some((line) => /✓ demucs/.test(line))).toBe(true);
    expect(runner.calls.every((call) => !call.args.includes("install"))).toBe(
      true,
    );
  });

  test("a StemDeck health reply selects the stemdeck backend", async () => {
    const deck = stemdeckFetch({ stemBytes: SHORT_WAV });
    const report = await doctor({
      runner: scriptedRunner([], []),
      fetch: deck.fetcher,
      env: deck.env,
    });
    expect(report.backend.kind).toBe("stemdeck");
    expect(formatDoctor(report)[0]).toContain("http://stemdeck.test");
  });
});

describe("tool plans", () => {
  test("validate arguments from unknown before anything runs", () => {
    const plan = (name: string, args: Record<string, unknown>) =>
      findMediaTool(name)!.plan(args, toolContext);
    expect(() =>
      plan("download_audio", { url: "https://example.com/v" }),
    ).toThrow(/YouTube/);
    expect(() => plan("download_audio", { url: 42 })).toThrow(
      MediaArgumentError,
    );
    expect(() =>
      plan("import_sample", { file: "a.wav", name: "Kick!" }),
    ).toThrow(/identifier/);
    expect(() =>
      plan("import_sample", {
        file: "a.wav",
        name: "kick",
        begin: 0.5,
        end: 0.2,
      }),
    ).toThrow(/end/);
    expect(() =>
      plan("import_sample", { file: "a.wav", name: "kick", root: "H9" }),
    ).toThrow(/note name/);
    expect(() =>
      plan("transcribe_notes", { file: "a.wav", kind: "flute" }),
    ).toThrow(/kind must be/);
    expect(() =>
      plan("transcribe_notes", { file: "a.wav", from: 3, to: 1 }),
    ).toThrow(/greater/);
    expect(() => plan("split_stems", {})).toThrow(/file/);
    const ok = plan("download_audio", {
      url: "https://youtu.be/abc",
      name: "My Song",
    });
    expect(ok.kind).toBe("media");
    expect(ok.summary).toBe("download my-song");
    const notes = plan("transcribe_notes", {
      file: "x.stems/drums.wav",
      kind: "drums",
      from: 0,
      to: 8,
    });
    expect(notes.summary).toBe("transcribe drums from x.stems/drums.wav");
  });

  test("every media tool has a JSON schema and a distinct name", () => {
    const names = [
      "download_audio",
      "split_stems",
      "analyze_audio",
      "transcribe_notes",
      "import_sample",
      "transcribe_lyrics",
    ];
    for (const name of names) {
      const tool = findMediaTool(name)!;
      expect(tool.parameters.type).toBe("object");
      expect(tool.parameters.additionalProperties).toBe(false);
      expect(tool.description.length).toBeGreaterThan(40);
    }
  });
});

describe("dawg media CLI", () => {
  test("parses verbs, positionals, numeric flags and --track", () => {
    const parsed = parseMediaArgv([
      "notes",
      "song.stems/bass.wav",
      "--kind",
      "bass",
      "--from",
      "1.5",
      "--to",
      "9",
      "--track",
      "Bass Line",
    ]);
    expect(parsed.verb).toBe("notes");
    expect(parsed.args).toEqual({
      file: "song.stems/bass.wav",
      kind: "bass",
      from: 1.5,
      to: 9,
    });
    expect(parsed.track).toBe("Bass Line");
    expect(trackSlug(parsed.track)).toBe("bass-line");
    expect(
      parseMediaArgv(["sample", "a.wav", "kick", "--begin", "0.1"]).args,
    ).toEqual({
      file: "a.wav",
      name: "kick",
      begin: 0.1,
    });
    expect(() => parseMediaArgv(["download", "a", "b"])).toThrow(/unexpected/);
    expect(() => parseMediaArgv(["notes", "a.wav", "--from", "x"])).toThrow(
      /number/,
    );
  });

  test("runs doctor and analyze, with exit codes for misuse and failures", async () => {
    const { root, downloads } = await project();
    await Bun.write(join(downloads, "loop.wav"), SHORT_WAV);
    const out = {
      text: "",
      write(chunk: string) {
        this.text += chunk;
      },
    };
    const err = {
      text: "",
      write(chunk: string) {
        this.text += chunk;
      },
    };
    const runner = scriptedRunner(
      [
        {
          match: (command) => command === "ffprobe",
          result: { stdout: ffprobeJson(2) },
        },
      ],
      ["ffprobe"],
    );
    const options = { runner, fetch: noFetch };
    expect(await runMediaCommand(["media"], root, out, err, options)).toBe(2);
    expect(out.text).toContain("dawg media doctor");
    out.text = "";
    expect(
      await runMediaCommand(
        ["media", "doctor", "--json"],
        root,
        out,
        err,
        options,
      ),
    ).toBe(0);
    expect(
      (JSON.parse(out.text) as { backend: { kind: string } }).backend.kind,
    ).toBe("direct");
    out.text = "";
    expect(
      await runMediaCommand(
        ["media", "analyze", "loop.wav"],
        root,
        out,
        err,
        options,
      ),
    ).toBe(0);
    expect((JSON.parse(out.text) as { analysis: string }).analysis).toBe(
      "tracks/main/downloads/loop.analysis.json",
    );
    expect(err.text).toContain("· ffprobe");
    expect(err.text).toContain("✓ analyzed");
    expect(
      await runMediaCommand(
        ["media", "analyze", "missing.wav"],
        root,
        out,
        err,
        options,
      ),
    ).toBe(1);
    expect(err.text).toContain("missing.wav was not found");
    expect(
      await runMediaCommand(["media", "bogus"], root, out, err, options),
    ).toBe(2);
    expect(
      await runMediaCommand(
        ["media", "download", "https://example.com/x"],
        root,
        out,
        err,
        options,
      ),
    ).toBe(1);
    expect(err.text).toContain("not YouTube");
  });
});

describe("runner output tap", () => {
  test("onOutput sees stdout and stderr chunks as they arrive", async () => {
    const seen: string[] = [];
    const result = await systemRunner.run(
      "sh",
      ["-c", "printf out; printf err 1>&2"],
      {
        timeoutMs: 5_000,
        onOutput: (stream, chunk) => seen.push(`${stream}:${chunk}`),
      },
    );
    expect(result.code).toBe(0);
    expect(seen).toContain("stdout:out");
    expect(seen).toContain("stderr:err");
  });
});

const live = process.env.DAWG_LIVE_MEDIA === "1" ? test : test.skip;
describe("live media smoke (DAWG_LIVE_MEDIA=1)", () => {
  live(
    "ffprobe + analysis on a generated wav through the real runner",
    async () => {
      const { root, downloads } = await project();
      await mkdir(downloads, { recursive: true });
      await Bun.write(
        join(downloads, "click.wav"),
        syntheticWav(6, (t) => ((t * 2) % 1 < 0.02 ? 0.9 : 0), 44_100),
      );
      const context = runContext(
        { projectRoot: root, trackSlug: "main", fetch: noFetch },
        systemRunner,
      );
      const result = await analyzeAudio({ file: "click.wav" }, context);
      expect(result.content.durationSeconds).toBe(6);
      expect(result.content.sampleRate).toBe(44_100);
      expect(result.content.codec).toBe("pcm_s16le");
      expect(result.content.bpm as number).toBeGreaterThan(118);
      expect(result.content.bpm as number).toBeLessThan(122);
    },
  );
});
