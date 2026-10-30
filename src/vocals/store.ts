import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { VoxBank } from "../../core/demos/hyperpop.ts";
import { parseWav } from "../media/vendor/wav.ts";
import {
  checkVocalCancellation,
  discoverVocalBackend,
  runVocalHelper,
  vocalProgress,
  type VocalBackend,
  type VocalBackendOptions,
  type VocalProcessOptions,
} from "./backend.ts";
import {
  VOCAL_LIMITS,
  VOCAL_MODEL,
  VocalError,
  expectedVocalFrames,
  parseVocalBookSpec,
  record,
  vocalName,
  type VocalBookSpec,
} from "./spec.ts";

export type VocalSlice = Readonly<{ name: string; begin: number; end: number }>;
export type LocalVocalBook = VoxBank &
  Readonly<{
    entry: Readonly<{
      id: string;
      src: string;
      title: string;
      root: number;
      seconds: number;
      bpm: number;
      sha256: string;
      slices: readonly VocalSlice[];
    }>;
  }>;
export type VocalProvenance = Readonly<{
  python: string;
  dependencies: Readonly<Record<string, string>>;
  model: Readonly<{
    repository: string;
    revision: string;
    files: Readonly<{ config: string; weights: string; voice: string }>;
  }>;
}>;
export type AcceptedVocalBook = Readonly<{
  takeId: string;
  specHash: string;
  helperHash: string;
  sha256: string;
  seconds: number;
  wavPath: string;
  specPath: string;
  metadataPath: string;
  bookPath: string;
  slices: readonly VocalSlice[];
  book: LocalVocalBook;
  provenance: VocalProvenance;
  reused: boolean;
}>;
export type GenerateVocalBookOptions = VocalProcessOptions &
  Readonly<{
    projectRoot: string;
    trackSlug: string;
    id?: string;
    spec: unknown;
    backend?: VocalBackend;
    backendOptions?: VocalBackendOptions;
    /** Reuse a verified accepted take only; never discover or start inference. */
    cachedOnly?: boolean;
    /** The host's existing write scope, when generation runs inside an agent task. */
    writeScope?: (projectRelative: string) => boolean;
  }>;

const SHA = /^[a-f0-9]{64}$/;
const FILES = ["take.wav", "spec.json", "metadata.json", "book.json"] as const;
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const posix = (path: string) => path.split(sep).join("/");

/** Walk each component and reject symlinked output directories, even inside the project. */
async function ownedDir(
  root: string,
  components: readonly string[],
  create: boolean,
): Promise<string | undefined> {
  let current = root;
  for (const component of components) {
    current = join(current, component);
    if (create) {
      try {
        await mkdir(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (!create && (error as NodeJS.ErrnoException).code === "ENOENT")
        return undefined;
      throw error;
    }
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new VocalError(
        "Vocal output directories must be project-owned directories without symlinks",
      );
    const checked = await realpath(current);
    if (!checked.startsWith(root + sep))
      throw new VocalError("Vocal output is outside the project");
  }
  return current;
}

async function ownedRead(path: string, maxBytes: number): Promise<Buffer> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes)
    throw new VocalError(
      "A vocal artifact is not a bounded project-owned regular file",
    );
  const bytes = await readFile(path);
  if (bytes.length > maxBytes)
    throw new VocalError("Vocal artifact is too large");
  return bytes;
}

export async function vocalHelperIdentity(): Promise<string> {
  const values = await Promise.all(
    ["book.py", "sing.py", "requirements.txt"].map(async (name) => {
      const bytes = await readFile(
        fileURLToPath(new URL(`./python/${name}`, import.meta.url)),
      );
      return `${name}\0${hash(bytes)}`;
    }),
  );
  return hash(values.join("\n"));
}

function parseJson(bytes: Uint8Array, where: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new VocalError(`${where} contains invalid JSON`);
  }
}

function provenanceOf(value: unknown): VocalProvenance {
  const input = record(value, "vocal provenance");
  if (
    typeof input.python !== "string" ||
    input.python.length > 120 ||
    /[\x00-\x1f]/.test(input.python)
  )
    throw new VocalError("Invalid vocal Python identity");
  const rawDeps = record(input.dependencies, "vocal dependencies");
  const dependencies: Record<string, string> = {};
  if (Object.keys(rawDeps).length > 64)
    throw new VocalError("Too many vocal dependency identities");
  for (const name of Object.keys(rawDeps).sort()) {
    const version = rawDeps[name];
    if (
      !/^[a-z][a-z0-9_-]{0,63}$/.test(name) ||
      typeof version !== "string" ||
      !/^[a-zA-Z0-9.+_-]{1,100}$/.test(version)
    )
      throw new VocalError("Invalid vocal dependency identity");
    dependencies[name] = version;
  }
  for (const required of [
    "kokoro",
    "misaki",
    "pyworld",
    "numpy",
    "soundfile",
    "torch",
    "spacy",
    "en_core_web_sm",
  ])
    if (!dependencies[required])
      throw new VocalError(`Vocal provenance is missing ${required}`);
  const model = record(input.model, "vocal model");
  if (
    model.repository !== VOCAL_MODEL.repository ||
    model.revision !== VOCAL_MODEL.revision
  )
    throw new VocalError(
      "The vocal backend did not use the pinned stock model",
    );
  const files = record(model.files, "vocal model files");
  const modelHash = (name: keyof typeof VOCAL_MODEL.files) => {
    const value = files[name];
    if (typeof value !== "string" || value !== VOCAL_MODEL.files[name])
      throw new VocalError(`Invalid vocal model ${name} identity`);
    return value;
  };
  return {
    python: input.python,
    dependencies,
    model: {
      repository: VOCAL_MODEL.repository,
      revision: VOCAL_MODEL.revision,
      files: {
        config: modelHash("config"),
        weights: modelHash("weights"),
        voice: modelHash("voice"),
      },
    },
  };
}

function slicesFor(spec: VocalBookSpec): VocalSlice[] {
  const total = expectedVocalFrames(spec);
  let cursor = 0;
  return spec.parts.map(([name, beats]) => {
    const start = cursor;
    cursor += Math.round((((beats + spec.lead) * 60) / spec.bpm) * 24000);
    return {
      name,
      begin: Number((start / total).toFixed(6)),
      end: Number((cursor / total).toFixed(6)),
    };
  });
}

function validateAudio(bytes: Uint8Array, spec: VocalBookSpec): void {
  const wav = parseWav(bytes, {
    maximumBytes: VOCAL_LIMITS.maxWavBytes,
    maximumDurationSeconds: VOCAL_LIMITS.maxSeconds,
    maximumChannels: 1,
  });
  if (
    wav.sampleRate !== 24000 ||
    wav.channels !== 1 ||
    wav.encoding !== "pcm16" ||
    wav.sampleCount !== expectedVocalFrames(spec)
  )
    throw new VocalError(
      "Vocal backend output must be complete 24 kHz mono PCM16 audio at the requested duration",
    );
  let peak = 0;
  for (let frame = 0; frame < wav.sampleCount; frame++)
    peak = Math.max(peak, Math.abs(wav.sample(frame, 0)));
  if (peak < 0.0001 || peak > 0.501)
    throw new VocalError(
      "Vocal backend output is silent or exceeds the stock vocal peak ceiling",
    );
}

type Identity = Readonly<{
  takeId: string;
  specHash: string;
  helperHash: string;
  dir: string;
  relDir: string;
  spec: VocalBookSpec;
}>;
function accepted(
  identity: Identity,
  sha256: string,
  provenance: VocalProvenance,
  reused: boolean,
): AcceptedVocalBook {
  const { spec, takeId, specHash, helperHash, relDir } = identity;
  const wavPath = `${relDir}/take.wav`;
  const seconds = expectedVocalFrames(spec) / 24000;
  const slices = slicesFor(spec);
  return {
    takeId,
    specHash,
    helperHash,
    sha256,
    seconds,
    slices,
    provenance,
    reused,
    wavPath,
    specPath: `${relDir}/spec.json`,
    metadataPath: `${relDir}/metadata.json`,
    bookPath: `${relDir}/book.json`,
    book: {
      sample: takeId,
      root: spec.root,
      syllables: spec.syllables,
      lines: spec.lines,
      heads: spec.heads,
      entry: {
        id: takeId,
        src: wavPath,
        title: "Stock bf_emma vocal book",
        root: spec.root,
        bpm: spec.bpm,
        seconds,
        sha256,
        slices,
      },
    },
  };
}

async function loadAccepted(
  identity: Identity,
): Promise<AcceptedVocalBook | undefined> {
  let info;
  try {
    info = await lstat(identity.dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new VocalError(
      "The accepted vocal take is not a project-owned directory",
    );
  const raw = record(
    parseJson(
      await ownedRead(
        join(identity.dir, "metadata.json"),
        VOCAL_LIMITS.maxSpecBytes,
      ),
      "Vocal metadata",
    ),
    "vocal metadata",
  );
  if (
    raw.version !== 1 ||
    raw.takeId !== identity.takeId ||
    raw.specHash !== identity.specHash ||
    raw.helperHash !== identity.helperHash ||
    typeof raw.sha256 !== "string" ||
    !SHA.test(raw.sha256)
  )
    throw new VocalError(
      "Accepted vocal metadata does not match the requested take; preserve it and generate a new spec or id",
    );
  const savedSpec = await ownedRead(
    join(identity.dir, "spec.json"),
    VOCAL_LIMITS.maxSpecBytes,
  );
  if (savedSpec.toString("utf8") !== `${JSON.stringify(identity.spec)}\n`)
    throw new VocalError("Accepted vocal spec changed; the take was preserved");
  const wav = await ownedRead(
    join(identity.dir, "take.wav"),
    VOCAL_LIMITS.maxWavBytes,
  );
  if (hash(wav) !== raw.sha256)
    throw new VocalError(
      "Accepted vocal audio changed; the take was preserved",
    );
  validateAudio(wav, identity.spec);
  const result = accepted(
    identity,
    raw.sha256,
    provenanceOf(raw.provenance),
    true,
  );
  const book = parseJson(
    await ownedRead(join(identity.dir, "book.json"), VOCAL_LIMITS.maxSpecBytes),
    "Vocal book",
  );
  if (JSON.stringify(book) !== JSON.stringify(result.book))
    throw new VocalError("Accepted vocal book changed; the take was preserved");
  return result;
}

/**
 * Generate once and accept an immutable directory atomically. Identical saved
 * requests reuse their verified WAV before inspecting Python or model caches.
 */
export async function generateVocalBook(
  options: GenerateVocalBookOptions,
): Promise<AcceptedVocalBook> {
  checkVocalCancellation(options.signal);
  const spec = parseVocalBookSpec(options.spec);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(options.trackSlug))
    throw new VocalError("trackSlug must name one project track directory");
  const id = vocalName(options.id ?? "stock-vocal", "vocal id");
  const root = await realpath(options.projectRoot);
  const specHash = hash(JSON.stringify(spec));
  const helperHash = await vocalHelperIdentity();
  const requestHash = hash(
    JSON.stringify({ version: 1, specHash, helperHash, model: VOCAL_MODEL }),
  );
  const takeId = `${id}-${requestHash}`;
  const components = ["tracks", options.trackSlug, "samples", "vocals"];
  const dir = join(root, ...components, takeId);
  const relDir = posix(relative(root, dir));
  for (const file of FILES)
    if (options.writeScope && !options.writeScope(`${relDir}/${file}`))
      throw new VocalError(
        "Vocal output is outside this task's project write scope",
      );
  const identity = { takeId, specHash, helperHash, dir, relDir, spec };
  const existingParent = await ownedDir(root, components, false);
  const cached = existingParent ? await loadAccepted(identity) : undefined;
  checkVocalCancellation(options.signal);
  if (cached) {
    vocalProgress(options.onProgress, { stage: "cached" });
    return cached;
  }
  if (options.cachedOnly)
    throw new VocalError(
      "No accepted vocal take matches this chart; run sing_chart with the same file and name first",
    );
  let backend = options.backend;
  if (!backend) {
    const found = await discoverVocalBackend(options.backendOptions);
    if (!found.available)
      throw new VocalError(`${found.reason}\n${found.setup}`);
    backend = found.backend;
  }
  checkVocalCancellation(options.signal);
  const parent = (await ownedDir(root, components, true))!;
  const staging = await ownedDir(
    root,
    [...components, `.pending-${randomUUID()}`],
    true,
  );
  if (!staging)
    throw new VocalError("Could not create vocal staging directory");
  try {
    vocalProgress(options.onProgress, { stage: "prepare" });
    const specPath = join(staging, "spec.json");
    const wavPath = join(staging, "take.wav");
    await writeFile(specPath, `${JSON.stringify(spec)}\n`, { flag: "wx" });
    const raw = record(
      await runVocalHelper(backend, ["--spec", specPath, wavPath], options),
      "vocal result",
    );
    checkVocalCancellation(options.signal);
    const provenance = provenanceOf(raw.provenance);
    const bytes = await ownedRead(wavPath, VOCAL_LIMITS.maxWavBytes);
    validateAudio(bytes, spec);
    const result = accepted(identity, hash(bytes), provenance, false);
    if (
      typeof raw.seconds !== "number" ||
      Math.abs(raw.seconds - result.seconds) > 0.0001 ||
      JSON.stringify(raw.slices) !== JSON.stringify(result.slices)
    )
      throw new VocalError(
        "Vocal backend returned inconsistent duration or slice boundaries",
      );
    await writeFile(
      join(staging, "book.json"),
      `${JSON.stringify(result.book)}\n`,
      { flag: "wx" },
    );
    await writeFile(
      join(staging, "metadata.json"),
      `${JSON.stringify({ version: 1, takeId, specHash, helperHash, sha256: result.sha256, acceptedAt: new Date().toISOString(), provenance })}\n`,
      { flag: "wx" },
    );
    checkVocalCancellation(options.signal);
    // Recheck ownership immediately before the only publication operation.
    await ownedDir(root, components, false);
    if ((await realpath(parent)) !== parent)
      throw new VocalError("Vocal output ownership changed during generation");
    try {
      await rename(staging, dir);
    } catch (error) {
      if (
        !["EEXIST", "ENOTEMPTY"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        throw error;
      const winner = await loadAccepted(identity);
      if (!winner) throw error;
      vocalProgress(options.onProgress, { stage: "cached" });
      return winner;
    }
    vocalProgress(options.onProgress, { stage: "accept" });
    checkVocalCancellation(options.signal);
    return result;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
