import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { CommandRunner, RunOptions } from "../auth/runner.ts";
import { GOLD } from "../../core/distill/hyperpop/chart/gold/index.ts";
import {
  VOCAL_HELPER,
  VOCAL_LIMITS,
  VOCAL_MODEL,
  VocalCancelledError,
  discoverVocalBackend,
  generateVocalBook,
  parseVocalBookSpec,
  vocalBackendSetup,
  vocalBookForChart,
  type VocalBackend,
  type VocalBookSpec,
} from "./index.ts";
import { runVocalHelper } from "./backend.ts";
import { expectedVocalFrames } from "./spec.ts";

const roots: string[] = [];
async function temp() {
  const root = await mkdtemp(join(tmpdir(), "dawg-vocals-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const spec = {
  bpm: 120,
  parts: [
    [
      "line",
      4,
      [
        { syl: "we", beat: 0, len: 0.4, midi: 69 },
        { syl: "keep", beat: 0.5, len: 0.4, midi: 71 },
        { syl: "the", beat: 1, len: 0.4, midi: 69 },
        { syl: "light", beat: 1.5, len: 1.5, midi: 72 },
      ],
    ],
  ],
};
const backend: VocalBackend = {
  python: process.execPath,
  source: "configured",
};
const provenance = {
  python: "3.12.8",
  dependencies: {
    kokoro: "0.9.4",
    misaki: "0.9.4",
    pyworld: "0.3.5",
    numpy: "2.5.4",
    soundfile: "0.14.0",
    torch: "2.14.1",
    spacy: "3.8.7",
    en_core_web_sm: "3.8.0",
  },
  model: VOCAL_MODEL,
};

function wavFor(spec: VocalBookSpec, silent = false): Buffer {
  const frames = expectedVocalFrames(spec);
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24);
  wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(frames * 2, 40);
  if (!silent)
    for (let frame = 0; frame < frames; frame++)
      wav.writeInt16LE(
        Math.round(Math.sin((frame * 2 * Math.PI * 440) / 24000) * 10000),
        44 + frame * 2,
      );
  return wav;
}

function tableFor(spec: VocalBookSpec) {
  let cursor = 0;
  const total = expectedVocalFrames(spec);
  return {
    seconds: Number((total / 24000).toFixed(6)),
    slices: spec.parts.map(([name, beats]) => {
      const begin = cursor;
      cursor += Math.round((((beats + spec.lead) * 60) / spec.bpm) * 24000);
      return {
        name,
        begin: Number((begin / total).toFixed(6)),
        end: Number((cursor / total).toFixed(6)),
      };
    }),
    provenance,
  };
}

function fakeRunner(
  options: {
    silent?: boolean;
    result?: (value: ReturnType<typeof tableFor>) => unknown;
    pause?: (options: RunOptions) => Promise<void>;
  } = {},
) {
  const calls: {
    command: string;
    args: readonly string[];
    options: RunOptions;
  }[] = [];
  const runner: CommandRunner = {
    which: () => undefined,
    async run(command, args, runOptions = {}) {
      calls.push({ command, args, options: runOptions });
      if (options.pause) await options.pause(runOptions);
      if (runOptions.signal?.aborted)
        return { code: 143, stdout: "", stderr: "stopped", killed: true };
      const input = JSON.parse(await readFile(args.at(-2)!, "utf8")) as unknown;
      const parsed = parseVocalBookSpec(input);
      runOptions.onOutput?.(
        "stderr",
        'DAWG_VOCAL_PROGRESS {"stage":"sing","part":"line","completed":0,"total":1}\n',
      );
      await writeFile(args.at(-1)!, wavFor(parsed, options.silent));
      const table = tableFor(parsed);
      return {
        code: 0,
        stdout: JSON.stringify(options.result ? options.result(table) : table),
        stderr: "",
        killed: false,
      };
    },
  };
  return { runner, calls };
}

describe("stock vocal spec", () => {
  test("defaults to bf_emma and a canonical bounded book", () => {
    const parsed = parseVocalBookSpec(spec);
    expect(parsed.voice).toBe("bf_emma");
    expect(parsed.lead).toBe(0.25);
    expect(parsed.lines).toEqual({ line: 4 });
    expect(parseVocalBookSpec(parsed)).toEqual(parsed);
  });

  test("rejects untrusted paths, voice changes, malformed words and note bounds", () => {
    for (const value of [
      null,
      [],
      { ...spec, voice: "another_person" },
      { ...spec, speech: "../../private.wav" },
      { ...spec, bpm: NaN },
      { ...spec, root: Infinity },
      {
        ...spec,
        parts: [["../take", 4, [{ syl: "light", beat: 0, len: 1, midi: 69 }]]],
      },
      {
        ...spec,
        parts: [["line", 4, [{ syl: "~", beat: 0, len: 1, midi: 69 }]]],
      },
      {
        ...spec,
        parts: [["line", 4, [{ syl: "un-", beat: 0, len: 1, midi: 69 }]]],
      },
      {
        ...spec,
        parts: [["line", 4, [{ syl: "light", beat: 3, len: 2, midi: 69 }]]],
      },
      {
        ...spec,
        parts: [
          [
            "line",
            4,
            [{ syl: "light", beat: 0, len: 1, midi: 69, speech: "take.wav" }],
          ],
        ],
      },
      {
        ...spec,
        parts: [
          [
            "line",
            4,
            [{ syl: "light", beat: 0, len: 1, midi: 69 }],
            { voice: "bm_lewis" },
          ],
        ],
      },
      { ...spec, parts: [...spec.parts, ...spec.parts] },
      { ...spec, lines: { missing: 4 } },
      { ...spec, heads: ["missing"] },
      { ...spec, syllables: ["../light"] },
    ])
      expect(() => parseVocalBookSpec(value)).toThrow();
  });

  test("bounds total output before any model or filesystem work", () => {
    const tooLong = Array.from({ length: 8 }, (_, index) => [
      `part-${index}`,
      128,
      [{ syl: "light", beat: 0, len: 1, midi: 69 }],
    ]);
    expect(() => parseVocalBookSpec({ bpm: 40, parts: tooLong })).toThrow(
      /600 seconds/,
    );
  });

  test("adapts chart phrases and original hook words without changing the catalog", () => {
    const chart = {
      ...GOLD[0]!,
      title: "Small Original",
      sections: [
        {
          ...GOLD[0]!.sections[0]!,
          name: "chorus",
          kind: "chorus" as const,
          bars: 2,
          chords: "I V",
          sing: [
            {
              bar: 0,
              rhythm: "x.x.x.x---------",
              notes: "1 2 3 5",
              words: "we hold the light",
            },
          ],
          hook: [],
          chops: [],
        },
      ],
    };
    const book = vocalBookForChart(chart);
    expect(book.voice).toBe("bf_emma");
    expect(book.parts.filter(([name]) => name === "hold")).toHaveLength(1);
    expect(book.syllables).toContain("light");
    expect(book.syllables).not.toContain("hold");
    expect(Object.keys(book.lines)).toHaveLength(1);
    expect(book.heads).toHaveLength(1);
  });
});

describe("backend discovery", () => {
  test("missing backend explains explicit setup and leaves playback independent", async () => {
    const root = await temp();
    const found = await discoverVocalBackend({ cacheDir: root, env: {} });
    expect(found.available).toBe(false);
    expect(found.setup).toContain("--download-models");
    expect(found.setup).toContain("Saved-song playback does not need it");
    expect(await readdir(root)).toEqual([]);
    await expect(
      generateVocalBook({
        projectRoot: root,
        trackSlug: "main",
        spec,
        backendOptions: { cacheDir: root, env: {} },
      }),
    ).rejects.toThrow(/No local vocal-generation/);
    expect(await readdir(root)).toEqual([]);
  });

  test("configured Python wins over the managed cache and rejects relative paths", async () => {
    const root = await temp();
    const found = await discoverVocalBackend({
      python: process.execPath,
      cacheDir: root,
      env: {},
    });
    expect(found.available && found.backend.source).toBe("configured");
    expect(() => vocalBackendSetup({ python: "../python" })).toThrow(
      /absolute path/,
    );
    await expect(discoverVocalBackend({ python: "python3" })).rejects.toThrow(
      /absolute path/,
    );
    const managed = join(root, "python", "bin", "python");
    await mkdir(dirname(managed), { recursive: true });
    await symlink(process.execPath, managed);
    const cached = await discoverVocalBackend({ cacheDir: root, env: {} });
    expect(cached.available && cached.backend.source).toBe("managed");
  });
});

describe("project-local acceptance", () => {
  test("writes an atomic take, hashes provenance and reuses without a backend after restart", async () => {
    const root = await temp();
    const fake = fakeRunner();
    const progress: string[] = [];
    const result = await generateVocalBook({
      projectRoot: root,
      trackSlug: "main",
      id: "original",
      spec,
      backend,
      runner: fake.runner,
      onProgress: (event) => progress.push(event.stage),
    });
    expect(result.reused).toBe(false);
    expect(result.wavPath.startsWith("tracks/main/samples/vocals/")).toBe(true);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.book.entry.src).toBe(result.wavPath);
    expect(result.provenance.model.files).toEqual(VOCAL_MODEL.files);
    expect(progress).toEqual(["prepare", "sing", "accept"]);
    expect((await readdir(dirname(join(root, result.wavPath)))).sort()).toEqual(
      ["book.json", "metadata.json", "spec.json", "take.wav"],
    );
    const call = fake.calls[0]!;
    expect(call.args.slice(0, 3)).toEqual(["-I", VOCAL_HELPER, "--spec"]);
    expect(call.options.maxOutputBytes).toBe(VOCAL_LIMITS.maxOutputBytes);
    expect(call.options.timeoutMs).toBe(VOCAL_LIMITS.timeoutMs);
    expect(call.options.env?.HF_HUB_OFFLINE).toBe("1");
    const restart = await generateVocalBook({
      projectRoot: root,
      trackSlug: "main",
      id: "original",
      spec,
      backendOptions: { python: join(root, "missing-python"), env: {} },
    });
    expect(restart.reused).toBe(true);
    expect(restart.sha256).toBe(result.sha256);
    expect(restart.wavPath).toBe(result.wavPath);
    expect(fake.calls).toHaveLength(1);
  });

  test("keeps accepted takes when a later spec is cancelled and removes only its staging", async () => {
    const root = await temp();
    const first = await generateVocalBook({
      projectRoot: root,
      trackSlug: "main",
      spec,
      backend,
      runner: fakeRunner().runner,
    });
    const controller = new AbortController();
    const blocked = fakeRunner({
      pause: async (options) => {
        expect(options.signal).toBe(controller.signal);
        controller.abort();
      },
    });
    await expect(
      generateVocalBook({
        projectRoot: root,
        trackSlug: "main",
        spec: { ...spec, bpm: 121 },
        backend,
        runner: blocked.runner,
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(VocalCancelledError);
    expect(await readdir(join(root, "tracks/main/samples/vocals"))).toEqual([
      first.takeId,
    ]);
    expect(
      (await readFile(join(root, first.wavPath))).byteLength,
    ).toBeGreaterThan(44);
    const reused = await generateVocalBook({
      projectRoot: root,
      trackSlug: "main",
      spec,
    });
    expect(reused.reused).toBe(true);
  });

  test("cancellation at acceptance preserves the complete reusable take", async () => {
    const root = await temp();
    const controller = new AbortController();
    await expect(
      generateVocalBook({
        projectRoot: root,
        trackSlug: "main",
        spec,
        backend,
        runner: fakeRunner().runner,
        signal: controller.signal,
        onProgress(event) {
          if (event.stage === "accept") controller.abort();
        },
      }),
    ).rejects.toBeInstanceOf(VocalCancelledError);
    const result = await generateVocalBook({
      projectRoot: root,
      trackSlug: "main",
      spec,
    });
    expect(result.reused).toBe(true);
    expect(await readdir(join(root, "tracks/main/samples/vocals"))).toEqual([
      result.takeId,
    ]);
  });

  test("concurrent identical requests converge on one immutable accepted take", async () => {
    const root = await temp();
    const fake = fakeRunner();
    const results = await Promise.all(
      [1, 2].map(() =>
        generateVocalBook({
          projectRoot: root,
          trackSlug: "main",
          spec,
          backend,
          runner: fake.runner,
        }),
      ),
    );
    expect(results[0]!.sha256).toBe(results[1]!.sha256);
    expect(results.filter((result) => result.reused)).toHaveLength(1);
    expect(await readdir(join(root, "tracks/main/samples/vocals"))).toEqual([
      results[0]!.takeId,
    ]);
  });

  test("rejects path traversal, symlink outputs and denied task scope before any helper", async () => {
    const root = await temp();
    const outside = await temp();
    const fake = fakeRunner();
    for (const patch of [
      { trackSlug: "../other" },
      { id: "../../take" },
      { trackSlug: "/tmp" },
    ])
      await expect(
        generateVocalBook({
          projectRoot: root,
          trackSlug: "main",
          spec,
          backend,
          runner: fake.runner,
          ...patch,
        }),
      ).rejects.toThrow();
    await expect(
      generateVocalBook({
        projectRoot: root,
        trackSlug: "main",
        spec,
        backend,
        runner: fake.runner,
        writeScope: () => false,
      }),
    ).rejects.toThrow(/write scope/);
    await symlink(outside, join(root, "tracks"));
    await expect(
      generateVocalBook({
        projectRoot: root,
        trackSlug: "main",
        spec,
        backend,
        runner: fake.runner,
      }),
    ).rejects.toThrow(/without symlinks/);
    expect(fake.calls).toHaveLength(0);
    expect(await readdir(outside)).toEqual([]);
  });

  test("rejects silent, short, unpinned or inconsistent backend output without accepting it", async () => {
    for (const fake of [
      fakeRunner({ silent: true }),
      fakeRunner({
        result: (table) => ({ ...table, seconds: table.seconds + 1 }),
      }),
      fakeRunner({
        result: (table) => ({
          ...table,
          provenance: {
            ...provenance,
            model: { ...VOCAL_MODEL, revision: "main" },
          },
        }),
      }),
      fakeRunner({ result: (table) => ({ ...table, slices: [] }) }),
    ]) {
      const root = await temp();
      await expect(
        generateVocalBook({
          projectRoot: root,
          trackSlug: "main",
          spec,
          backend,
          runner: fake.runner,
        }),
      ).rejects.toThrow();
      expect(await readdir(join(root, "tracks/main/samples/vocals"))).toEqual(
        [],
      );
    }
  });

  test("detects changed accepted audio and never overwrites it", async () => {
    const root = await temp();
    const result = await generateVocalBook({
      projectRoot: root,
      trackSlug: "main",
      spec,
      backend,
      runner: fakeRunner().runner,
    });
    await writeFile(join(root, result.wavPath), "changed");
    const fake = fakeRunner();
    await expect(
      generateVocalBook({
        projectRoot: root,
        trackSlug: "main",
        spec,
        backend,
        runner: fake.runner,
      }),
    ).rejects.toThrow(/audio changed/);
    expect(await readFile(join(root, result.wavPath), "utf8")).toBe("changed");
    expect(fake.calls).toHaveLength(0);
  });
});

describe("bounded process boundary", () => {
  test("missing, failed and malformed backends produce actionable errors", async () => {
    for (const runner of [
      {
        which: () => undefined,
        run: async () => {
          throw new Error("executable missing");
        },
      },
      {
        which: () => undefined,
        run: async () => ({
          code: 1,
          stdout: "",
          stderr: "Missing dependency pyworld",
          killed: false,
        }),
      },
      {
        which: () => undefined,
        run: async () => ({
          code: 0,
          stdout: "not JSON",
          stderr: "",
          killed: false,
        }),
      },
    ])
      await expect(
        runVocalHelper(backend, ["--probe"], { runner }),
      ).rejects.toThrow(/Python|setup|JSON/);
  });

  test("bounds real subprocess output without requiring Python or inference", async () => {
    const root = await temp();
    const executable = join(root, "fake-vocal");
    await writeFile(
      executable,
      `#!${process.execPath}\nprocess.stdout.write("x".repeat(200000));\n`,
    );
    await chmod(executable, 0o700);
    await expect(
      runVocalHelper({ python: executable, source: "configured" }, ["--probe"]),
    ).rejects.toThrow(/invalid JSON/);
  });

  test("cancels and collects a real single helper process", async () => {
    const root = await temp();
    const executable = join(root, "fake-vocal");
    const pidPath = join(root, "pid");
    await writeFile(
      executable,
      `#!${process.execPath}\nawait Bun.write(${JSON.stringify(pidPath)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`,
    );
    await chmod(executable, 0o700);
    const controller = new AbortController();
    const run = runVocalHelper(
      { python: executable, source: "configured" },
      ["--probe"],
      { signal: controller.signal },
    );
    for (
      let tries = 0;
      tries < 100 && !(await Bun.file(pidPath).exists());
      tries++
    )
      await Bun.sleep(5);
    const pid = Number(await readFile(pidPath, "utf8"));
    controller.abort();
    await expect(run).rejects.toBeInstanceOf(VocalCancelledError);
    expect(() => process.kill(pid, 0)).toThrow();
  });

  test("the helper closure resolves inside the package with no contributor path", async () => {
    const helper = await readFile(VOCAL_HELPER, "utf8");
    const sing = await readFile(
      resolve(dirname(VOCAL_HELPER), "sing.py"),
      "utf8",
    );
    expect(helper).toContain('Path(__file__).with_name("sing.py")');
    expect(helper).toContain("local_files_only=not download");
    for (const source of [helper, sing]) {
      expect(source).not.toContain(".plans/");
      expect(source).not.toContain("/Users/");
      expect(source).not.toContain("subprocess");
    }
  });
});
