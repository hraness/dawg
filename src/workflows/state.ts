import { createHash } from "node:crypto";

export const WORKFLOW_FORMAT = "dawg.workflow-job/v1";
export const WORKFLOW_LIMITS = Object.freeze({
  recordBytes: 512 * 1024,
  jobs: 128,
  stages: 32,
  sources: 16,
  artifacts: 256,
  readiness: 256,
  ranges: 64,
  artifactBytes: 1024 * 1024 * 1024,
  text: 8_000,
});

export type WorkflowId =
  "original-house" | "reference-study" | "recreate-source";
export type JobStatus =
  "queued" | "running" | "cancelled" | "failed" | "complete";
export type StageStatus =
  "pending" | "running" | "interrupted" | "failed" | "complete";
export type ArtifactKind =
  "score" | "audio" | "vocal" | "analysis" | "reference" | "export" | "other";
export type BeatRange = Readonly<{ from: number; to: number }>;

/** A locator is not a content hash. Ingestion adds sha256 once bytes exist. */
export type SourceIdentity = Readonly<{
  id: string;
  kind: "youtube" | "audio";
  locator: string;
  sha256?: string;
}>;

export type ArtifactInput = Readonly<{
  id: string;
  kind: ArtifactKind;
  path: string;
  sha256: string;
  bytes: number;
  producer: Readonly<{ name: string; version: string; configHash: string }>;
}>;

export type WorkflowArtifact = ArtifactInput &
  Readonly<{
    stageId: string;
    sourceDigest: string;
    acceptedAt: string;
  }>;

export type WorkflowStage = Readonly<{
  id: string;
  title: string;
  dependsOn: readonly string[];
  status: StageStatus;
  attempt: number;
  progress?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}>;

/** Readiness describes committed music, independently of overall job completion. */
export type TrackReadiness = Readonly<{
  trackId: string;
  sectionId?: string;
  writtenRevision: number;
  state: "planned" | "writing" | "waiting-assets" | "ready" | "failed";
  range: BeatRange;
  requiredArtifacts: readonly string[];
  audibleNotes: number;
}>;

/** A receipt from a successful engine buffer commit, not a render request. */
export type BufferedRegion = Readonly<{
  renderId: string;
  writtenRevision: number;
  range: BeatRange;
  trackIds: readonly string[];
  renderedNotes: number;
  missingAssets: readonly string[];
}>;

export type WorkflowJob = Readonly<{
  format: typeof WORKFLOW_FORMAT;
  id: string;
  workflowId: WorkflowId;
  workflowVersion: string;
  profileVersion: string;
  revision: number;
  epoch: number;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  brief: string;
  sources: readonly SourceIdentity[];
  stages: readonly WorkflowStage[];
  artifacts: readonly WorkflowArtifact[];
  readiness: readonly TrackReadiness[];
  writtenRevision: number;
  audibleRevision: number | null;
  /** Human pause/stop/seek increments this; render callbacks must match it. */
  controlRevision: number;
  bufferedRanges: readonly BufferedRegion[];
}>;

export type StageTicket = Readonly<{
  jobId: string;
  stageId: string;
  attempt: number;
  epoch: number;
  writtenRevision: number;
  sourceDigest: string;
}>;

export function parseStageTicket(value: unknown): StageTicket {
  const raw = object(value, "stage ticket");
  return {
    jobId: id(raw.jobId, "job id"),
    stageId: id(raw.stageId, "stage id"),
    attempt: integer(raw.attempt, "stage attempt"),
    epoch: integer(raw.epoch, "job epoch"),
    writtenRevision: integer(raw.writtenRevision, "written revision"),
    sourceDigest: digest(raw.sourceDigest, "source digest"),
  };
}

export class WorkflowValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowValidationError";
  }
}

export class WorkflowConflictError extends Error {
  constructor(
    message = "workflow changed; inspect the latest revision before retrying",
  ) {
    super(message);
    this.name = "WorkflowConflictError";
  }
}

export function fail(message: string): never {
  throw new WorkflowValidationError(message);
}

export function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label} must be an object`);
  return value as Record<string, unknown>;
}

export function string(
  value: unknown,
  label: string,
  max = 160,
  empty = false,
): string {
  if (
    typeof value !== "string" ||
    (!empty && !value.trim()) ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  )
    fail(`${label} must be bounded text`);
  return value;
}

export function id(value: unknown, label = "id"): string {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value)
  )
    fail(`${label} is not a safe identifier`);
  return value;
}

export function integer(
  value: unknown,
  label: string,
  max = 2 ** 31 - 1,
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > max
  )
    fail(`${label} must be a bounded nonnegative integer`);
  return value as number;
}

export function enumeration<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (!allowed.includes(value as T)) fail(`${label} is not supported`);
  return value as T;
}

export function list<T>(
  value: unknown,
  max: number,
  label: string,
  parse: (item: unknown) => T,
): T[] {
  if (!Array.isArray(value) || value.length > max)
    fail(`${label} must be a bounded array`);
  return value.map(parse);
}

export function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length)
    fail(`${label} contains duplicate identifiers`);
}

export function digest(value: unknown, label = "sha256"): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    fail(`${label} must be a SHA-256 digest`);
  return value;
}

export function version(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(value))
    fail(`${label} must be a stable semantic version`);
  return value;
}

export function relativePath(value: unknown): string {
  const path = string(value, "artifact path", 512);
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    /^[a-z]:/i.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..") ||
    path.split("/")[0] === ".dawg"
  )
    fail("artifact path must stay in project files outside .dawg");
  return path;
}

function timestamp(value: unknown, label: string): string {
  const text = string(value, label, 32);
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(text) ||
    !Number.isFinite(Date.parse(text)) ||
    new Date(text).toISOString() !== text
  )
    fail(`${label} must be an ISO timestamp`);
  return text;
}

export function parseRange(value: unknown): BeatRange {
  const raw = object(value, "range");
  const from = raw.from;
  const to = raw.to;
  if (
    typeof from !== "number" ||
    typeof to !== "number" ||
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from < 0 ||
    to <= from ||
    to > 1_000_000
  )
    fail("range must be a finite nonempty beat interval");
  return { from, to };
}

export function parseSource(value: unknown): SourceIdentity {
  const raw = object(value, "source");
  const kind = enumeration(
    raw.kind,
    ["youtube", "audio"] as const,
    "source kind",
  );
  const locator = string(raw.locator, "source locator", 2048);
  if (kind === "audio") relativePath(locator);
  else {
    let url: URL;
    try {
      url = new URL(locator);
    } catch {
      fail("source must be a YouTube URL");
    }
    if (
      url!.protocol !== "https:" ||
      url!.username ||
      url!.password ||
      !["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(
        url!.hostname,
      )
    )
      fail("source must be a credential-free YouTube URL");
  }
  return {
    id: id(raw.id, "source id"),
    kind,
    locator,
    ...(raw.sha256 === undefined ? {} : { sha256: digest(raw.sha256) }),
  };
}

export function sourceDigest(sources: readonly SourceIdentity[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        [...sources]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((s) => [s.id, s.kind, s.locator, s.sha256 ?? null]),
      ),
    )
    .digest("hex");
}

export function parseArtifactInput(value: unknown): ArtifactInput {
  const raw = object(value, "artifact");
  const producer = object(raw.producer, "producer");
  return {
    id: id(raw.id, "artifact id"),
    kind: enumeration(
      raw.kind,
      [
        "score",
        "audio",
        "vocal",
        "analysis",
        "reference",
        "export",
        "other",
      ] as const,
      "artifact kind",
    ),
    path: relativePath(raw.path),
    sha256: digest(raw.sha256),
    bytes: integer(raw.bytes, "artifact bytes", WORKFLOW_LIMITS.artifactBytes),
    producer: {
      name: id(producer.name, "producer name"),
      version: string(producer.version, "producer version", 80),
      configHash: digest(producer.configHash, "producer configHash"),
    },
  };
}

export function parseReadiness(value: unknown): TrackReadiness {
  const raw = object(value, "readiness");
  const requiredArtifacts = list(
    raw.requiredArtifacts,
    WORKFLOW_LIMITS.artifacts,
    "required artifacts",
    (v) => id(v),
  );
  unique(requiredArtifacts, "required artifacts");
  return {
    trackId: id(raw.trackId, "track id"),
    ...(raw.sectionId === undefined
      ? {}
      : { sectionId: id(raw.sectionId, "section id") }),
    writtenRevision: integer(raw.writtenRevision, "readiness revision"),
    state: enumeration(
      raw.state,
      ["planned", "writing", "waiting-assets", "ready", "failed"] as const,
      "readiness state",
    ),
    range: parseRange(raw.range),
    requiredArtifacts,
    audibleNotes: integer(raw.audibleNotes, "audible notes", 100_000),
  };
}

export function parseBufferedRegion(value: unknown): BufferedRegion {
  const raw = object(value, "buffered region");
  const trackIds = list(
    raw.trackIds,
    WORKFLOW_LIMITS.readiness,
    "buffered tracks",
    (v) => id(v),
  );
  unique(trackIds, "buffered tracks");
  const missingAssets = list(
    raw.missingAssets,
    WORKFLOW_LIMITS.artifacts,
    "missing assets",
    (v) => string(v, "missing asset", 512),
  );
  const renderedNotes = integer(raw.renderedNotes, "rendered notes", 100_000);
  if (!trackIds.length || !renderedNotes || missingAssets.length)
    fail(
      "audible publication requires nonempty rendered music with no missing assets",
    );
  return {
    renderId: id(raw.renderId, "render id"),
    writtenRevision: integer(raw.writtenRevision, "buffer revision"),
    range: parseRange(raw.range),
    trackIds,
    renderedNotes,
    missingAssets,
  };
}

export function parseWorkflowJob(value: unknown): WorkflowJob {
  const raw = object(value, "workflow job");
  if (raw.format !== WORKFLOW_FORMAT) fail("unsupported workflow job format");
  const stages = list(
    raw.stages,
    WORKFLOW_LIMITS.stages,
    "stages",
    (value): WorkflowStage => {
      const stage = object(value, "stage");
      const dependsOn = list(
        stage.dependsOn,
        WORKFLOW_LIMITS.stages,
        "stage dependencies",
        (v) => id(v),
      );
      unique(dependsOn, "stage dependencies");
      return {
        id: id(stage.id, "stage id"),
        title: string(stage.title, "stage title"),
        dependsOn,
        status: enumeration(
          stage.status,
          ["pending", "running", "interrupted", "failed", "complete"] as const,
          "stage status",
        ),
        attempt: integer(stage.attempt, "stage attempt"),
        ...(stage.progress === undefined
          ? {}
          : { progress: string(stage.progress, "stage progress") }),
        ...(stage.error === undefined
          ? {}
          : { error: string(stage.error, "stage error", 2_000) }),
        ...(stage.startedAt === undefined
          ? {}
          : { startedAt: timestamp(stage.startedAt, "stage startedAt") }),
        ...(stage.finishedAt === undefined
          ? {}
          : { finishedAt: timestamp(stage.finishedAt, "stage finishedAt") }),
      };
    },
  );
  if (!stages.length) fail("a workflow needs at least one stage");
  unique(
    stages.map((s) => s.id),
    "stages",
  );
  const known = new Set<string>();
  for (const stage of stages) {
    if (stage.dependsOn.some((dep) => !known.has(dep)))
      fail("stage dependencies must name preceding stages");
    if (stage.status === "running" && (stage.attempt === 0 || !stage.startedAt))
      fail("running stage needs an attempt and start time");
    if (
      (stage.status === "running" || stage.status === "complete") &&
      stage.dependsOn.some(
        (dep) =>
          stages.find((entry) => entry.id === dep)?.status !== "complete",
      )
    )
      fail("active stage dependencies are not complete");
    known.add(stage.id);
  }
  const sources = list(
    raw.sources,
    WORKFLOW_LIMITS.sources,
    "sources",
    parseSource,
  );
  unique(
    sources.map((s) => s.id),
    "sources",
  );
  const artifacts = list(
    raw.artifacts,
    WORKFLOW_LIMITS.artifacts,
    "artifacts",
    (value): WorkflowArtifact => {
      const artifact = object(value, "artifact");
      const stageId = id(artifact.stageId, "artifact stage id");
      if (!known.has(stageId)) fail("artifact stage is missing");
      return {
        ...parseArtifactInput(artifact),
        stageId,
        sourceDigest: digest(artifact.sourceDigest, "source digest"),
        acceptedAt: timestamp(artifact.acceptedAt, "artifact acceptedAt"),
      };
    },
  );
  unique(
    artifacts.map((a) => a.id),
    "artifacts",
  );
  const readiness = list(
    raw.readiness,
    WORKFLOW_LIMITS.readiness,
    "readiness",
    parseReadiness,
  );
  unique(readiness.map(readinessKey), "readiness");
  const writtenRevision = integer(raw.writtenRevision, "written revision");
  const audibleRevision =
    raw.audibleRevision === null
      ? null
      : integer(raw.audibleRevision, "audible revision");
  if (audibleRevision !== null && audibleRevision > writtenRevision)
    fail("audible revision cannot exceed written revision");
  const accepted = new Map(artifacts.map((a) => [a.id, a]));
  const inputs = sourceDigest(sources);
  for (const entry of readiness) {
    if (entry.writtenRevision > writtenRevision)
      fail("readiness cannot exceed the written revision");
    if (
      entry.state === "ready" &&
      entry.requiredArtifacts.some(
        (a) => accepted.get(a)?.sourceDigest !== inputs,
      )
    )
      fail("ready track has missing or stale artifacts");
  }
  const bufferedRanges = list(
    raw.bufferedRanges,
    WORKFLOW_LIMITS.ranges,
    "buffered ranges",
    parseBufferedRegion,
  );
  if (bufferedRanges.some((range) => range.writtenRevision !== audibleRevision))
    fail("buffered ranges must describe the audible revision");
  if ((audibleRevision === null) !== (bufferedRanges.length === 0))
    fail("audible revision requires a committed buffered range");
  const status = enumeration(
    raw.status,
    ["queued", "running", "cancelled", "failed", "complete"] as const,
    "job status",
  );
  if (status === "complete" && stages.some((s) => s.status !== "complete"))
    fail("complete job has unfinished stages");
  if (
    (status === "cancelled" || status === "complete") &&
    stages.some((s) => s.status === "running")
  )
    fail("inactive job has a running stage");
  const job: WorkflowJob = {
    format: WORKFLOW_FORMAT,
    id: id(raw.id, "job id"),
    workflowId: enumeration(
      raw.workflowId,
      ["original-house", "reference-study", "recreate-source"] as const,
      "workflow id",
    ),
    workflowVersion: version(raw.workflowVersion, "workflow version"),
    profileVersion: version(raw.profileVersion, "profile version"),
    revision: integer(raw.revision, "job revision"),
    epoch: integer(raw.epoch, "job epoch"),
    status,
    createdAt: timestamp(raw.createdAt, "createdAt"),
    updatedAt: timestamp(raw.updatedAt, "updatedAt"),
    brief: string(raw.brief, "brief", WORKFLOW_LIMITS.text, true),
    sources,
    stages,
    artifacts,
    readiness,
    writtenRevision,
    audibleRevision,
    controlRevision: integer(raw.controlRevision, "control revision"),
    bufferedRanges,
  };
  if (Buffer.byteLength(JSON.stringify(job)) > WORKFLOW_LIMITS.recordBytes)
    fail("workflow job exceeds its byte limit");
  return freeze(job);
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export function readinessKey(
  entry: Pick<TrackReadiness, "trackId" | "sectionId">,
): string {
  return `${entry.trackId}/${entry.sectionId ?? ""}`;
}

/** Pure metadata check. Only publishAudible may acknowledge an actual engine commit. */
export function coherentReady(
  job: WorkflowJob,
  region: Pick<BufferedRegion, "range" | "trackIds">,
): boolean {
  return (
    region.trackIds.length > 0 &&
    region.trackIds.every((trackId) =>
      job.readiness.some(
        (entry) =>
          entry.trackId === trackId &&
          entry.writtenRevision === job.writtenRevision &&
          entry.state === "ready" &&
          entry.audibleNotes > 0 &&
          entry.range.from <= region.range.from &&
          entry.range.to >= region.range.to,
      ),
    )
  );
}
