/** Read one authorized audio file and atomically admit immutable project bytes. */
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  open,
  realpath,
  rename,
  rm,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import { resolveReadPath } from "../agent/workspace.ts";
import { resolveInput, sha256File } from "../media/paths.ts";
import { runHelper } from "../media/process.ts";
import type { MediaRunContext } from "../media/types.ts";
import { checkVocalCancellation } from "../vocals/backend.ts";
import { numberIn, record } from "../vocals/spec.ts";
import { REFERENCE_LIMITS, ReferenceError } from "./analysis.ts";
import {
  projectRelative,
  readReferenceJson,
  referenceDirectory,
} from "./store.ts";

export type ReferenceImportContext = MediaRunContext &
  Readonly<{ readRoots?: readonly string[] }>;
export type ReferenceInput = Readonly<{
  absolute: string;
  relative: string;
  size: number;
}> &
  (
    | Readonly<{ imported: false }>
    | Readonly<{
        imported: true;
        sha256: string;
        metadataPath: string;
        reused: boolean;
      }>
  );

const AUDIO_FORMATS = "wav,aiff,mp3,flac,ogg,mov,matroska,webm,aac,ac3";

async function probeImport(
  path: string,
  context: MediaRunContext,
): Promise<{ duration: number; codec: string }> {
  if (!context.runner.which("ffprobe"))
    throw new ReferenceError(
      "Install ffmpeg (including ffprobe) to import external reference audio",
    );
  const result = await runHelper(
    context,
    [
      "ffprobe",
      "-v",
      "error",
      "-protocol_whitelist",
      "file",
      "-format_whitelist",
      AUDIO_FORMATS,
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      "-select_streams",
      "a:0",
      path,
    ],
    { timeoutMs: 60_000 },
  );
  let raw: unknown;
  try {
    raw = JSON.parse(result.stdout);
  } catch {
    throw new ReferenceError(
      "ffprobe did not recognize a supported self-contained audio file",
    );
  }
  const body = record(raw, "imported audio probe"),
    format = record(body.format, "imported audio format");
  if (!Array.isArray(body.streams) || body.streams.length < 1)
    throw new ReferenceError("The selected file contains no audio stream");
  const stream = record(body.streams[0], "imported audio stream");
  const duration = numberIn(
    Number(format.duration ?? stream.duration),
    0.01,
    REFERENCE_LIMITS.maxSeconds,
    "imported audio duration",
  );
  numberIn(
    Number(stream.sample_rate),
    8000,
    192000,
    "imported audio sample rate",
  );
  numberIn(stream.channels, 1, 8, "imported audio channels");
  if (
    typeof stream.codec_name !== "string" ||
    !/^[a-zA-Z0-9_]{1,64}$/.test(stream.codec_name)
  )
    throw new ReferenceError("The selected audio codec is not recognized");
  return { duration, codec: stream.codec_name };
}

async function digestHandle(
  source: FileHandle,
  context: MediaRunContext,
  target?: FileHandle,
): Promise<{ sha256: string; bytes: number }> {
  const digest = createHash("sha256"),
    buffer = Buffer.alloc(1024 * 1024);
  let bytes = 0;
  for (;;) {
    checkVocalCancellation(context.signal);
    const read = await source.read(buffer, 0, buffer.length, bytes);
    if (!read.bytesRead) break;
    const chunk = buffer.subarray(0, read.bytesRead);
    bytes += chunk.byteLength;
    if (bytes > REFERENCE_LIMITS.maxInputBytes)
      throw new ReferenceError(
        "The selected audio file exceeds the 500 MiB import budget",
      );
    digest.update(chunk);
    if (target) {
      let offset = 0;
      while (offset < chunk.byteLength) {
        const written = await target.write(
          chunk,
          offset,
          chunk.byteLength - offset,
        );
        if (!written.bytesWritten)
          throw new ReferenceError(
            "Could not complete the project audio import",
          );
        offset += written.bytesWritten;
      }
    }
  }
  checkVocalCancellation(context.signal);
  return { sha256: digest.digest("hex"), bytes };
}

/**
 * Project paths keep the existing resolver. Agent imports need an existing
 * read root. `explicitFile` is only for a human's named CLI file argument;
 * no agent parameter or saved permission grants that authority.
 */
export async function importReferenceFile(
  file: unknown,
  context: ReferenceImportContext,
  options: Readonly<{ explicitFile?: boolean }> = {},
): Promise<ReferenceInput> {
  if (
    typeof file !== "string" ||
    !file ||
    file.length > 1024 ||
    /[\x00-\x1f\x7f]/.test(file)
  )
    throw new ReferenceError("file must name one bounded local audio path");
  checkVocalCancellation(context.signal);
  try {
    const local = await resolveInput(context, file);
    return { ...local, imported: false };
  } catch {
    /* An external selection is admitted only by the checks below. */
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(context.trackSlug))
    throw new ReferenceError("Invalid reference import track");
  const root = await realpath(context.projectRoot),
    selected = isAbsolute(file)
      ? resolve(file)
      : resolve(context.projectRoot, file);
  let sourcePath: string;
  if (options.explicitFile === true) {
    try {
      sourcePath = await realpath(selected);
    } catch {
      throw new ReferenceError("The selected audio file is unavailable");
    }
  } else {
    if ((context.readRoots?.length ?? 0) > 16)
      throw new ReferenceError("Too many workspace read roots");
    try {
      const allowed = await resolveReadPath(
        { root, trackSlug: context.trackSlug, readRoots: context.readRoots },
        selected,
        "reference file",
      );
      sourcePath = allowed.real;
    } catch {
      throw new ReferenceError(
        "This reference file is outside the project and its allowed read roots. The human can add its folder with /agent read-root add <folder>, or explicitly import the file with dawg reference prepare <file>.",
      );
    }
  }
  const info = await lstat(sourcePath);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size < 1 ||
    info.size > REFERENCE_LIMITS.maxInputBytes
  )
    throw new ReferenceError("Select a regular audio file of at most 500 MiB");
  // Nonblocking avoids opening a substituted FIFO; NOFOLLOW rejects a file
  // changed to a symlink between canonical resolution and this exact read.
  const source = await open(
    sourcePath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = await source.stat();
    if (
      !before.isFile() ||
      before.dev !== info.dev ||
      before.ino !== info.ino ||
      before.size !== info.size
    )
      throw new ReferenceError("The selected audio file changed before import");
    const identity = await digestHandle(source, context);
    const hashed = await source.stat();
    if (
      identity.bytes !== before.size ||
      before.size !== hashed.size ||
      before.mtimeMs !== hashed.mtimeMs ||
      before.ctimeMs !== hashed.ctimeMs
    )
      throw new ReferenceError(
        "The source audio changed while its identity was read; retry the import",
      );
    const components = ["tracks", context.trackSlug, "downloads"];
    const parent = join(root, ...components),
      dir = join(parent, `reference-${identity.sha256}`),
      relativeDir = projectRelative(root, dir);
    const sourceRelative = `${relativeDir}/source.audio`,
      metadataPath = `${relativeDir}/import.json`;
    for (const path of [sourceRelative, metadataPath])
      if (context.writeScope && !context.writeScope(path))
        throw new ReferenceError(
          "Reference import is outside this task's project write scope",
        );
    const load = async (): Promise<ReferenceInput | undefined> => {
      let current;
      try {
        current = await lstat(dir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return undefined;
        throw error;
      }
      if (!current.isDirectory() || current.isSymbolicLink())
        throw new ReferenceError(
          "The immutable reference import directory changed",
        );
      await referenceDirectory(root, [
        ...components,
        `reference-${identity.sha256}`,
      ]);
      const metadata = record(
        await readReferenceJson(join(dir, "import.json")),
        "reference import identity",
      );
      const path = join(dir, "source.audio"),
        admitted = await lstat(path);
      if (
        metadata.version !== 1 ||
        metadata.sha256 !== identity.sha256 ||
        metadata.bytes !== identity.bytes ||
        !admitted.isFile() ||
        admitted.isSymbolicLink() ||
        admitted.size !== identity.bytes ||
        (await sha256File(path)) !== identity.sha256
      )
        throw new ReferenceError(
          "The accepted reference import changed; it was preserved",
        );
      return {
        absolute: path,
        relative: sourceRelative,
        size: admitted.size,
        imported: true,
        sha256: identity.sha256,
        metadataPath,
        reused: true,
      };
    };
    await referenceDirectory(root, components);
    const cached = await load();
    if (cached) {
      checkVocalCancellation(context.signal);
      return cached;
    }
    await referenceDirectory(root, components, true);
    const stage = (await referenceDirectory(
      root,
      [...components, `pending-reference-${randomUUID()}`],
      true,
    ))!;
    try {
      context.progress("importing selected reference audio into the project");
      const target = await open(join(stage, "source.audio"), "wx", 0o600);
      let copied;
      try {
        copied = await digestHandle(source, context, target);
        await target.sync();
      } finally {
        await target.close();
      }
      const after = await source.stat();
      if (
        copied.sha256 !== identity.sha256 ||
        copied.bytes !== identity.bytes ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs
      )
        throw new ReferenceError(
          "The source audio changed during import; no result was accepted",
        );
      const probe = await probeImport(join(stage, "source.audio"), context);
      checkVocalCancellation(context.signal);
      await writeFile(
        join(stage, "import.json"),
        `${JSON.stringify({ version: 1, sha256: identity.sha256, bytes: identity.bytes, originalName: basename(file).slice(0, 255), duration: probe.duration, codec: probe.codec })}\n`,
        { flag: "wx", mode: 0o600 },
      );
      await referenceDirectory(root, components);
      checkVocalCancellation(context.signal);
      try {
        await rename(stage, dir);
      } catch (error) {
        if (
          !["EEXIST", "ENOTEMPTY"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw error;
        const winner = await load();
        if (!winner) throw error;
        return winner;
      }
      return {
        absolute: join(dir, "source.audio"),
        relative: sourceRelative,
        size: identity.bytes,
        imported: true,
        sha256: identity.sha256,
        metadataPath,
        reused: false,
      };
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  } finally {
    await source.close();
  }
}
