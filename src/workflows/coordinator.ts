import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { getWorkflow, HOUSE_PROFILE } from "./catalog.ts";
import { WorkflowStore } from "./store.ts";
import {
  coherentReady,
  fail,
  id,
  integer,
  list,
  parseArtifactInput,
  parseBufferedRegion,
  parseReadiness,
  parseSource,
  parseWorkflowJob,
  readinessKey,
  relativePath,
  sourceDigest,
  string,
  unique,
  WORKFLOW_FORMAT,
  WORKFLOW_LIMITS,
  WorkflowConflictError,
  type ArtifactInput,
  type BeatRange,
  type BufferedRegion,
  type SourceIdentity,
  type StageTicket,
  type TrackReadiness,
  type WorkflowJob,
} from "./state.ts";

export type CreateWorkflow = Readonly<{
  workflowId: string;
  id?: string;
  brief?: string;
  sources?: readonly SourceIdentity[];
  writtenRevision?: number;
}>;

export type StageCompletion = Readonly<{
  artifacts?: readonly ArtifactInput[];
  sources?: readonly SourceIdentity[];
  writtenRevision?: number;
  readiness?: readonly TrackReadiness[];
}>;

export type PresentationTicket = Readonly<{
  jobId: string;
  epoch: number;
  writtenRevision: number;
  controlRevision: number;
}>;

export function capturePresentation(job: WorkflowJob): PresentationTicket {
  return {
    jobId: job.id,
    epoch: job.epoch,
    writtenRevision: job.writtenRevision,
    controlRevision: job.controlRevision,
  };
}

export type WorkflowEvent = Readonly<{
  type:
    | "created"
    | "stage"
    | "cancelled"
    | "resumed"
    | "written"
    | "audible"
    | "control";
  job: WorkflowJob;
  stageId?: string;
}>;

/** The coordinator records musical progress. Audio/transport effects belong to its host. */
export class WorkflowCoordinator {
  readonly store: WorkflowStore;
  private readonly listeners = new Set<(event: WorkflowEvent) => void>();
  private readonly controllers = new Map<
    string,
    { controller: AbortController; ticket: StageTicket }
  >();
  private readonly watchers = new Map<string, () => void>();
  private readonly now: () => string;

  constructor(
    readonly workspace: string,
    options: Readonly<{ now?: () => string }> = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.store = new WorkflowStore(workspace, this.now);
  }

  /** Local committed events; inspect/list also observe other processes' durable writes. */
  subscribe(listener: (event: WorkflowEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(
    type: WorkflowEvent["type"],
    job: WorkflowJob,
    stageId?: string,
  ): WorkflowJob {
    const event: WorkflowEvent = { type, job, ...(stageId ? { stageId } : {}) };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* Observers cannot roll back a durable commit. */
      }
    }
    return job;
  }

  async create(input: CreateWorkflow): Promise<WorkflowJob> {
    const workflow = getWorkflow(input.workflowId);
    const at = this.now();
    const job = await this.store.create({
      format: WORKFLOW_FORMAT,
      id: input.id ?? randomUUID(),
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      profileVersion: HOUSE_PROFILE.version,
      revision: 0,
      epoch: 0,
      status: "queued",
      createdAt: at,
      updatedAt: at,
      brief: input.brief ?? "",
      sources: input.sources ?? [],
      stages: workflow.stages.map((stage) => ({
        ...stage,
        status: "pending",
        attempt: 0,
      })),
      artifacts: [],
      readiness: [],
      writtenRevision: input.writtenRevision ?? 0,
      audibleRevision: null,
      controlRevision: 0,
      bufferedRanges: [],
    });
    return this.emit("created", job);
  }

  async inspect(jobId: string): Promise<WorkflowJob> {
    const job = await this.store.load(jobId);
    if (!job) fail("workflow does not exist");
    return job;
  }

  list(): Promise<readonly WorkflowJob[]> {
    return this.store.list();
  }

  private assertVersion(job: WorkflowJob): void {
    if (
      job.workflowVersion !== getWorkflow(job.workflowId).version ||
      job.profileVersion !== HOUSE_PROFILE.version
    )
      fail(
        "workflow/profile version changed; migrate explicitly before resuming",
      );
  }

  private assertTicket(job: WorkflowJob, ticket: StageTicket): void {
    const stage = job.stages.find((entry) => entry.id === ticket.stageId);
    if (
      job.id !== ticket.jobId ||
      job.epoch !== ticket.epoch ||
      job.writtenRevision !== ticket.writtenRevision ||
      sourceDigest(job.sources) !== ticket.sourceDigest ||
      !stage ||
      stage.status !== "running" ||
      stage.attempt !== ticket.attempt ||
      job.status !== "running"
    )
      throw new WorkflowConflictError(
        "stale workflow result; accepted state was preserved",
      );
  }

  private controllerKey(ticket: StageTicket): string {
    return `${ticket.jobId}/${ticket.epoch}/${ticket.stageId}/${ticket.attempt}`;
  }

  signal(ticket: StageTicket): AbortSignal {
    const controller = this.controllers.get(this.controllerKey(ticket));
    if (!controller)
      return AbortSignal.abort(
        new WorkflowConflictError(
          "stage is no longer owned by this coordinator",
        ),
      );
    return controller.controller.signal;
  }

  private abortOwned(jobId: string): void {
    for (const [key, { controller }] of this.controllers)
      if (key.startsWith(`${jobId}/`)) {
        controller.abort(
          new DOMException("Workflow interrupted", "AbortError"),
        );
        this.controllers.delete(key);
      }
    this.watchers.get(jobId)?.();
    this.watchers.delete(jobId);
  }

  private async watchOwned(jobId: string): Promise<void> {
    if (this.watchers.has(jobId)) return;
    const close = await this.store.watch(
      jobId,
      (job) => {
        for (const [key, owned] of this.controllers)
          if (owned.ticket.jobId === jobId) {
            try {
              this.assertTicket(job, owned.ticket);
            } catch (error) {
              owned.controller.abort(error);
              this.controllers.delete(key);
            }
          }
        if (
          ![...this.controllers.values()].some(
            (owned) => owned.ticket.jobId === jobId,
          )
        ) {
          this.watchers.get(jobId)?.();
          this.watchers.delete(jobId);
        }
      },
      () => this.abortOwned(jobId),
    );
    this.watchers.set(jobId, close);
  }

  async startStage(jobId: string, stageId: string): Promise<StageTicket> {
    id(stageId, "stage id");
    const current = await this.inspect(jobId);
    this.assertVersion(current);
    if (
      current.status === "cancelled" ||
      current.status === "failed" ||
      current.status === "complete"
    )
      fail("resume the workflow before starting a stage");
    const stage = current.stages.find((entry) => entry.id === stageId);
    if (!stage) fail("workflow has no such stage");
    if (stage.status === "running" || stage.status === "complete")
      fail("stage is already running or complete");
    if (
      stage.dependsOn.some(
        (dependency) =>
          current.stages.find((entry) => entry.id === dependency)?.status !==
          "complete",
      )
    )
      fail("stage dependencies are not complete");
    const next = await this.store.update(jobId, current.revision, (job) => ({
      ...job,
      status: "running",
      stages: job.stages.map((entry) =>
        entry.id === stageId
          ? {
              ...entry,
              status: "running",
              attempt: entry.attempt + 1,
              startedAt: this.now(),
              finishedAt: undefined,
              progress: undefined,
              error: undefined,
            }
          : entry,
      ),
    }));
    const ticket: StageTicket = {
      jobId,
      stageId,
      attempt: stage.attempt + 1,
      epoch: next.epoch,
      writtenRevision: next.writtenRevision,
      sourceDigest: sourceDigest(next.sources),
    };
    this.controllers.set(this.controllerKey(ticket), {
      controller: new AbortController(),
      ticket,
    });
    await this.watchOwned(jobId);
    this.emit("stage", next, stageId);
    return ticket;
  }

  async progress(ticket: StageTicket, message: string): Promise<WorkflowJob> {
    string(message, "stage progress");
    const current = await this.inspect(ticket.jobId);
    this.assertTicket(current, ticket);
    const next = await this.store.update(
      current.id,
      current.revision,
      (job) => {
        this.assertTicket(job, ticket);
        return {
          ...job,
          stages: job.stages.map((stage) =>
            stage.id === ticket.stageId
              ? { ...stage, progress: message }
              : stage,
          ),
        };
      },
    );
    return this.emit("stage", next, ticket.stageId);
  }

  async completeStage(
    ticket: StageTicket,
    completion: StageCompletion = {},
  ): Promise<WorkflowJob> {
    const current = await this.inspect(ticket.jobId);
    this.assertTicket(current, ticket);
    const additions = list(
      completion.artifacts ?? [],
      WORKFLOW_LIMITS.artifacts,
      "stage artifacts",
      parseArtifactInput,
    );
    unique(
      additions.map((artifact) => artifact.id),
      "stage artifacts",
    );
    for (const artifact of additions)
      await verifyArtifact(this.workspace, artifact);
    const sources =
      completion.sources === undefined
        ? current.sources
        : list(
            completion.sources,
            WORKFLOW_LIMITS.sources,
            "sources",
            parseSource,
          );
    for (const source of current.sources) {
      const next = sources.find((entry) => entry.id === source.id);
      if (
        !next ||
        next.kind !== source.kind ||
        next.locator !== source.locator ||
        (source.sha256 !== undefined && next.sha256 !== source.sha256)
      )
        fail(
          "source identity cannot be rebound; create a new workflow for another input",
        );
    }
    const writtenRevision =
      completion.writtenRevision ?? current.writtenRevision;
    integer(writtenRevision, "written revision");
    if (writtenRevision < current.writtenRevision)
      throw new WorkflowConflictError("written revision cannot go backwards");
    const readiness = list(
      completion.readiness ?? [],
      WORKFLOW_LIMITS.readiness,
      "readiness",
      parseReadiness,
    );
    if (readiness.some((entry) => entry.writtenRevision !== writtenRevision))
      fail("readiness revisions do not match");
    const inputs = sourceDigest(sources);
    const identityChanged =
      inputs !== ticket.sourceDigest ||
      writtenRevision !== ticket.writtenRevision;
    const at = this.now();
    const assemble = (job: WorkflowJob): WorkflowJob => {
      this.assertTicket(job, ticket);
      const artifacts = [...job.artifacts];
      for (const input of additions) {
        const existing = artifacts.find((artifact) => artifact.id === input.id);
        if (existing) {
          const {
            stageId: _stage,
            sourceDigest: _source,
            acceptedAt: _at,
            ...identity
          } = existing;
          if (
            JSON.stringify(identity) !== JSON.stringify(input) ||
            existing.sourceDigest !== inputs
          )
            fail(
              "accepted artifact identity is immutable; write a new take under a new id and path",
            );
        } else {
          if (
            artifacts.some(
              (artifact) =>
                artifact.path === input.path &&
                artifact.sha256 !== input.sha256,
            )
          )
            fail(
              "an accepted artifact path cannot be overwritten by another take",
            );
          artifacts.push({
            ...input,
            stageId: ticket.stageId,
            sourceDigest: inputs,
            acceptedAt: at,
          });
        }
      }
      const stages = job.stages.map((stage) =>
        stage.id === ticket.stageId
          ? {
              ...stage,
              status: "complete" as const,
              progress: undefined,
              error: undefined,
              finishedAt: at,
            }
          : identityChanged && stage.status === "running"
            ? { ...stage, status: "interrupted" as const, progress: undefined }
            : stage,
      );
      return parseWorkflowJob({
        ...job,
        sources,
        artifacts,
        stages,
        writtenRevision,
        epoch: job.epoch + (identityChanged ? 1 : 0),
        status: stages.every((stage) => stage.status === "complete")
          ? "complete"
          : "running",
        readiness: mergeReadiness(
          identityChanged
            ? invalidateReadiness(job.readiness, writtenRevision)
            : job.readiness,
          readiness,
        ),
      });
    };
    const proposed = assemble(current);
    await verifyReadyArtifacts(this.workspace, proposed);
    const next = await this.store.update(
      current.id,
      current.revision,
      assemble,
    );
    this.controllers.delete(this.controllerKey(ticket));
    if (identityChanged) this.abortOwned(current.id);
    else if (
      ![...this.controllers.values()].some(
        (owned) => owned.ticket.jobId === current.id,
      )
    ) {
      this.watchers.get(current.id)?.();
      this.watchers.delete(current.id);
    }
    return this.emit("stage", next, ticket.stageId);
  }

  async failStage(ticket: StageTicket, message: string): Promise<WorkflowJob> {
    string(message, "stage error", 2_000);
    const current = await this.inspect(ticket.jobId);
    this.assertTicket(current, ticket);
    const next = await this.store.update(
      current.id,
      current.revision,
      (job) => {
        this.assertTicket(job, ticket);
        return {
          ...job,
          epoch: job.epoch + 1,
          status: "failed",
          stages: job.stages.map((stage) =>
            stage.id === ticket.stageId
              ? {
                  ...stage,
                  status: "failed",
                  error: message,
                  progress: undefined,
                  finishedAt: this.now(),
                }
              : stage.status === "running"
                ? { ...stage, status: "interrupted", progress: undefined }
                : stage,
          ),
        };
      },
    );
    this.abortOwned(current.id);
    return this.emit("stage", next, ticket.stageId);
  }

  async cancel(jobId: string, expectedEpoch?: number): Promise<WorkflowJob> {
    if (expectedEpoch !== undefined)
      integer(expectedEpoch, "expected job epoch");
    const current = await this.inspect(jobId);
    if (expectedEpoch !== undefined && current.epoch !== expectedEpoch)
      throw new WorkflowConflictError(
        "stale cancellation; current workflow was preserved",
      );
    if (current.status === "cancelled" || current.status === "complete")
      return current;
    const next = await this.store.update(jobId, current.revision, (job) => ({
      ...job,
      status: "cancelled",
      epoch: job.epoch + 1,
      stages: interruptStages(job),
    }));
    this.abortOwned(jobId);
    return this.emit("cancelled", next);
  }

  /** Explicit takeover invalidates old attempts; completed stages/assets are retained. */
  async resume(jobId: string): Promise<WorkflowJob> {
    const current = await this.inspect(jobId);
    this.assertVersion(current);
    if (current.status === "complete") return current;
    for (const artifact of current.artifacts)
      await verifyArtifact(this.workspace, artifact);
    const next = await this.store.update(jobId, current.revision, (job) => ({
      ...job,
      status: "queued",
      epoch: job.epoch + 1,
      stages: job.stages.map((stage) =>
        stage.status === "complete"
          ? stage
          : {
              ...stage,
              status: "pending",
              progress: undefined,
              error: undefined,
              startedAt: undefined,
              finishedAt: undefined,
            },
      ),
    }));
    this.abortOwned(jobId);
    return this.emit("resumed", next);
  }

  async recordWritten(
    jobId: string,
    writtenRevision: number,
    readiness: readonly TrackReadiness[] = [],
  ): Promise<WorkflowJob> {
    integer(writtenRevision, "written revision");
    const entries = list(
      readiness,
      WORKFLOW_LIMITS.readiness,
      "readiness",
      parseReadiness,
    );
    if (entries.some((entry) => entry.writtenRevision !== writtenRevision))
      fail("readiness revisions do not match");
    const current = await this.inspect(jobId);
    if (writtenRevision <= current.writtenRevision)
      throw new WorkflowConflictError("written revision must advance");
    const proposed = parseWorkflowJob({
      ...current,
      writtenRevision,
      epoch: current.epoch + 1,
      stages: interruptStages(current),
      readiness: mergeReadiness(
        invalidateReadiness(current.readiness, writtenRevision),
        entries,
      ),
    });
    await verifyReadyArtifacts(this.workspace, proposed);
    const next = await this.store.update(
      jobId,
      current.revision,
      () => proposed,
    );
    this.abortOwned(jobId);
    return this.emit("written", next);
  }

  /** Human transport actions invalidate pending presentation without cancelling composition. */
  async recordControl(jobId: string): Promise<WorkflowJob> {
    const current = await this.inspect(jobId);
    const next = await this.store.update(jobId, current.revision, (job) => ({
      ...job,
      controlRevision: job.controlRevision + 1,
    }));
    return this.emit("control", next);
  }

  async setReadiness(
    jobId: string,
    writtenRevision: number,
    readiness: readonly TrackReadiness[],
  ): Promise<WorkflowJob> {
    const current = await this.inspect(jobId);
    if (writtenRevision !== current.writtenRevision)
      throw new WorkflowConflictError(
        "readiness is for a stale written revision",
      );
    const entries = list(
      readiness,
      WORKFLOW_LIMITS.readiness,
      "readiness",
      parseReadiness,
    );
    if (entries.some((entry) => entry.writtenRevision !== writtenRevision))
      fail("readiness revisions do not match");
    const proposed = parseWorkflowJob({
      ...current,
      readiness: mergeReadiness(current.readiness, entries),
    });
    await verifyReadyArtifacts(this.workspace, proposed);
    const next = await this.store.update(
      jobId,
      current.revision,
      () => proposed,
    );
    return this.emit("written", next);
  }

  /** Call only after the host successfully committed this exact nonempty render. */
  async publishAudible(
    ticket: PresentationTicket,
    value: BufferedRegion,
  ): Promise<WorkflowJob> {
    const region = parseBufferedRegion(value);
    const current = await this.inspect(ticket.jobId);
    const assert = (job: WorkflowJob) => {
      if (
        job.status === "cancelled" ||
        job.epoch !== ticket.epoch ||
        job.writtenRevision !== ticket.writtenRevision ||
        job.controlRevision !== ticket.controlRevision ||
        region.writtenRevision !== ticket.writtenRevision
      )
        throw new WorkflowConflictError(
          "stale audible publication; current music and human controls were preserved",
        );
      if (!coherentReady(job, region)) fail("region is not coherently ready");
    };
    assert(current);
    await verifyReadyArtifacts(
      this.workspace,
      current,
      region.range,
      region.trackIds,
    );
    const next = await this.store.update(
      current.id,
      current.revision,
      (job) => {
        assert(job);
        const bufferedRanges =
          job.audibleRevision === region.writtenRevision
            ? [
                ...job.bufferedRanges.filter(
                  (old) => old.renderId !== region.renderId,
                ),
                region,
              ]
            : [region];
        return {
          ...job,
          audibleRevision: region.writtenRevision,
          bufferedRanges: bufferedRanges.slice(-WORKFLOW_LIMITS.ranges),
        };
      },
    );
    return this.emit("audible", next);
  }

  async runStage(
    jobId: string,
    stageId: string,
    work: (
      context: Readonly<{
        ticket: StageTicket;
        signal: AbortSignal;
        progress: (message: string) => Promise<WorkflowJob>;
      }>,
    ) => Promise<StageCompletion>,
  ): Promise<WorkflowJob> {
    const ticket = await this.startStage(jobId, stageId);
    const signal = this.signal(ticket);
    try {
      const result = await work({
        ticket,
        signal,
        progress: (message) => this.progress(ticket, message),
      });
      signal.throwIfAborted();
      return await this.completeStage(ticket, result);
    } catch (error) {
      if (!(error instanceof WorkflowConflictError) && !signal.aborted)
        await this.failStage(
          ticket,
          error instanceof Error
            ? error.message.slice(0, 2_000)
            : "workflow stage failed",
        ).catch(() => undefined);
      throw error;
    }
  }

  /** Gracefully relinquish local callbacks; durable running stages await explicit resume. */
  dispose(): void {
    for (const { controller } of this.controllers.values())
      controller.abort(new DOMException("Coordinator closed", "AbortError"));
    this.controllers.clear();
    for (const close of this.watchers.values()) close();
    this.watchers.clear();
    this.listeners.clear();
  }
}

function interruptStages(job: WorkflowJob): WorkflowJob["stages"] {
  return job.stages.map((stage) =>
    stage.status === "running"
      ? { ...stage, status: "interrupted", progress: undefined }
      : stage,
  );
}

function invalidateReadiness(
  entries: readonly TrackReadiness[],
  revision: number,
): readonly TrackReadiness[] {
  return entries.map((entry) => ({
    ...entry,
    writtenRevision: revision,
    state: "planned",
  }));
}

function mergeReadiness(
  current: readonly TrackReadiness[],
  additions: readonly TrackReadiness[],
): readonly TrackReadiness[] {
  unique(additions.map(readinessKey), "readiness updates");
  const entries = new Map(current.map((entry) => [readinessKey(entry), entry]));
  for (const entry of additions) entries.set(readinessKey(entry), entry);
  return [...entries.values()];
}

/** Verifies actual bytes and containment; callers cannot admit an invented asset hash. */
export async function verifyArtifact(
  workspace: string,
  artifact: ArtifactInput,
): Promise<void> {
  const input = parseArtifactInput(artifact);
  const root = await realpath(workspace);
  const path = await realpath(resolve(root, relativePath(input.path))).catch(
    () => fail(`missing workflow artifact: ${input.path}`),
  );
  if (
    !path.startsWith(root + sep) ||
    path.startsWith(resolve(root, ".dawg") + sep)
  )
    fail("workflow artifact escapes project files");
  const info = await stat(path);
  if (
    !info.isFile() ||
    info.size !== input.bytes ||
    info.size > WORKFLOW_LIMITS.artifactBytes ||
    info.size === 0
  )
    fail(`workflow artifact size changed: ${input.path}`);
  const actual = await hashFile(path);
  if (actual !== input.sha256)
    fail(`workflow artifact hash changed: ${input.path}`);
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function verifyReadyArtifacts(
  workspace: string,
  job: WorkflowJob,
  range?: BeatRange,
  trackIds?: readonly string[],
): Promise<void> {
  const needed = new Set(
    job.readiness
      .filter(
        (entry) =>
          entry.state === "ready" &&
          (!trackIds || trackIds.includes(entry.trackId)) &&
          (!range ||
            (entry.range.from <= range.from && entry.range.to >= range.to)),
      )
      .flatMap((entry) => entry.requiredArtifacts),
  );
  for (const artifactId of needed) {
    const artifact = job.artifacts.find((entry) => entry.id === artifactId);
    if (!artifact) fail("ready track has an unaccepted artifact");
    await verifyArtifact(workspace, artifact);
  }
}
