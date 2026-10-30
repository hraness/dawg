import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { CommandRunner } from "../auth/runner.ts";
import { sha256File } from "../media/paths.ts";
import { VocalCancelledError } from "../vocals/spec.ts";
import {
  importReferenceFile,
  runReferenceCommand,
  type ReferenceImportContext,
} from "./index.ts";
import { prepareReferenceTool } from "./tools.ts";

const roots: string[] = [];
async function temp() {
  const root = await mkdtemp(join(tmpdir(), "dawg-reference-import-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function wave(): Buffer {
  const wav = Buffer.alloc(96044);
  wav.write("RIFF");
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
  wav.writeUInt32LE(96000, 40);
  for (let frame = 0; frame < 48000; frame++)
    wav.writeInt16LE(
      Math.round(Math.sin((frame * 2 * Math.PI * 440) / 24000) * 8000),
      44 + frame * 2,
    );
  return wav;
}

async function fixture() {
  const project = await temp(),
    external = await temp(),
    source = join(external, "chosen.wav");
  await writeFile(source, wave());
  const calls: readonly string[][] = [];
  const mutableCalls = calls as string[][];
  const runner: CommandRunner = {
    which: (name) => (name === "ffprobe" ? "/fake/ffprobe" : undefined),
    async run(command, args) {
      expect(command).toBe("ffprobe");
      mutableCalls.push([...args]);
      return {
        code: 0,
        stdout: JSON.stringify({
          format: { duration: "2" },
          streams: [
            { sample_rate: "24000", channels: 1, codec_name: "pcm_s16le" },
          ],
        }),
        stderr: "",
        killed: false,
      };
    },
  };
  const controller = new AbortController();
  const context: ReferenceImportContext = {
    projectRoot: project,
    trackSlug: "reference",
    runner,
    signal: controller.signal,
    progress() {},
  };
  return {
    project,
    external,
    source,
    context,
    runner,
    calls: mutableCalls,
    controller,
  };
}

describe("external reference admission", () => {
  test("explicit selection copies/hash-accepts read-only audio atomically and reuses immutable bytes", async () => {
    const setup = await fixture();
    await chmod(setup.source, 0o444);
    const before = await lstat(setup.source),
      digest = await sha256File(setup.source);
    const result = await importReferenceFile(setup.source, setup.context, {
      explicitFile: true,
    });
    expect(result.imported).toBe(true);
    expect(result.relative).toBe(
      `tracks/reference/downloads/reference-${digest}/source.audio`,
    );
    expect(await sha256File(result.absolute)).toBe(digest);
    expect(await sha256File(setup.source)).toBe(digest);
    expect((await lstat(setup.source)).mtimeMs).toBe(before.mtimeMs);
    expect(await readdir(setup.external)).toEqual(["chosen.wav"]);
    expect(setup.calls[0]).toContain("-protocol_whitelist");
    expect(setup.calls[0]).toContain("file");
    expect(setup.calls[0]).toContain("-format_whitelist");
    expect(setup.calls[0]).not.toContain(setup.source);
    const reused = await importReferenceFile(setup.source, setup.context, {
      explicitFile: true,
    });
    expect(reused.imported && reused.reused).toBe(true);
    expect(reused.relative).toBe(result.relative);
    expect(setup.calls).toHaveLength(1);
    expect((await readdir(dirname(result.absolute))).sort()).toEqual([
      "import.json",
      "source.audio",
    ]);
  });

  test("project-relative audio keeps its current path and does not require import tools", async () => {
    const setup = await fixture();
    await writeFile(join(setup.project, "local.wav"), wave());
    const result = await importReferenceFile("local.wav", setup.context);
    expect(result.relative).toBe("local.wav");
    expect(result.imported).toBe(false);
    expect(setup.calls).toHaveLength(0);
    expect(await readdir(setup.project)).toEqual(["local.wav"]);
  });

  test("agent calls require existing read-root authority and never infer it from a selected path", async () => {
    const setup = await fixture();
    await expect(
      importReferenceFile(setup.source, setup.context),
    ).rejects.toThrow(/\/agent read-root add/);
    await expect(
      prepareReferenceTool(
        { file: setup.source, sourceIsVocal: true },
        setup.context,
      ),
    ).rejects.toThrow(/\/agent read-root add/);
    await expect(
      prepareReferenceTool(
        { file: setup.source, explicitFile: true },
        setup.context,
      ),
    ).rejects.toThrow(/Supply one file/);
    expect(setup.calls).toHaveLength(0);
    expect(await readdir(setup.project)).toEqual([]);
    const allowed = await importReferenceFile(setup.source, {
      ...setup.context,
      readRoots: [await realpath(setup.external)],
    });
    expect(allowed.imported).toBe(true);
    expect(await readdir(setup.external)).toEqual(["chosen.wav"]);
  });

  test("an allowed read-root symlink cannot authorize a target outside that root", async () => {
    const setup = await fixture(),
      elsewhere = await temp(),
      privateFile = join(elsewhere, "outside.wav");
    await writeFile(privateFile, wave());
    await symlink(privateFile, join(setup.external, "linked.wav"));
    await expect(
      importReferenceFile(join(setup.external, "linked.wav"), {
        ...setup.context,
        readRoots: [await realpath(setup.external)],
      }),
    ).rejects.toThrow(/allowed read roots/);
    expect(setup.calls).toHaveLength(0);
    expect(await readdir(setup.project)).toEqual([]);
  });

  test("refuses directories, oversize files and denied output scope without an import", async () => {
    const setup = await fixture();
    await expect(
      importReferenceFile(setup.external, setup.context, {
        explicitFile: true,
      }),
    ).rejects.toThrow(/regular audio/);
    const large = join(setup.external, "large.wav"),
      handle = await open(large, "wx");
    await handle.truncate(500 * 1024 * 1024 + 1);
    await handle.close();
    await expect(
      importReferenceFile(large, setup.context, { explicitFile: true }),
    ).rejects.toThrow(/500 MiB/);
    await expect(
      importReferenceFile(
        setup.source,
        { ...setup.context, writeScope: () => false },
        { explicitFile: true },
      ),
    ).rejects.toThrow(/write scope/);
    expect(await readdir(setup.project)).toEqual([]);
    expect(setup.calls).toHaveLength(0);
  });

  test("rejects symlinked output directories and preserves a changed accepted import", async () => {
    const setup = await fixture(),
      outside = await temp();
    await mkdir(join(setup.project, "tracks", "reference"), {
      recursive: true,
    });
    await symlink(
      outside,
      join(setup.project, "tracks", "reference", "downloads"),
    );
    await expect(
      importReferenceFile(setup.source, setup.context, { explicitFile: true }),
    ).rejects.toThrow(/without symlinks/);
    expect(await readdir(outside)).toEqual([]);
    await rm(join(setup.project, "tracks", "reference", "downloads"));
    const result = await importReferenceFile(setup.source, setup.context, {
      explicitFile: true,
    });
    await writeFile(result.absolute, "modified");
    await expect(
      importReferenceFile(setup.source, setup.context, { explicitFile: true }),
    ).rejects.toThrow(/accepted reference import changed/);
    expect(await readFile(result.absolute, "utf8")).toBe("modified");
  });

  test("cancel removes pending project files and leaves the original audio intact", async () => {
    const setup = await fixture(),
      digest = await sha256File(setup.source);
    await expect(
      importReferenceFile(
        setup.source,
        {
          ...setup.context,
          progress() {
            setup.controller.abort();
          },
        },
        { explicitFile: true },
      ),
    ).rejects.toBeInstanceOf(VocalCancelledError);
    expect(await sha256File(setup.source)).toBe(digest);
    expect(
      await readdir(join(setup.project, "tracks/reference/downloads")),
    ).toEqual([]);
    expect(await readdir(setup.external)).toEqual(["chosen.wav"]);
  });

  test("invalid probe results never become accepted audio", async () => {
    const setup = await fixture();
    const runner: CommandRunner = {
      ...setup.runner,
      run: async () => ({
        code: 0,
        stdout: JSON.stringify({
          format: { duration: "601" },
          streams: [
            { sample_rate: "24000", channels: 1, codec_name: "pcm_s16le" },
          ],
        }),
        stderr: "",
        killed: false,
      }),
    };
    await expect(
      importReferenceFile(
        setup.source,
        { ...setup.context, runner },
        { explicitFile: true },
      ),
    ).rejects.toThrow(/duration/);
    expect(
      await readdir(join(setup.project, "tracks/reference/downloads")),
    ).toEqual([]);
  });

  test("CLI explicitly authorizes only its named source and optional vocal file", async () => {
    const setup = await fixture();
    let output = "",
      error = "",
      prepared: unknown;
    const result = await runReferenceCommand(
      [
        "reference",
        "prepare",
        setup.source,
        "--vocal",
        setup.source,
        "--isolated",
        "--json",
      ],
      setup.project,
      {
        write: (text) => {
          output += text;
        },
      },
      {
        write: (text) => {
          error += text;
        },
      },
      undefined,
      {
        runner: setup.runner,
        prepare: async (args, context) => {
          prepared = args;
          expect(context.projectRoot).toBe(setup.project);
          return {
            summary: "prepared selected import",
            outputs: [],
            content: {},
          };
        },
      },
    );
    expect(result).toBe(0);
    expect(error).toContain("importing selected reference audio");
    expect(JSON.parse(output).summary).toBe("prepared selected import");
    const args = prepared as {
      file: string;
      vocalFile: string;
      sourceIsVocal: boolean;
    };
    expect(args.file).toMatch(
      /^tracks\/reference\/downloads\/reference-[a-f0-9]{64}\/source\.audio$/,
    );
    expect(args.vocalFile).toBe(args.file);
    expect(args.sourceIsVocal).toBe(true);
    expect(await readdir(setup.external)).toEqual(["chosen.wav"]);
    expect(await readdir(setup.project)).toEqual(["tracks"]);
  });
});
