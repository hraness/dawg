import { lstat, mkdir, readFile, readdir, realpath } from "node:fs/promises";
import { unwatchFile, watchFile } from "node:fs";
import { join, sep } from "node:path";
import { durableWrite } from "../fs/durable.ts";
import { acquireSessionLock } from "../session/lock.ts";
import {
  id,
  parseWorkflowJob,
  WORKFLOW_LIMITS,
  WorkflowConflictError,
  WorkflowValidationError,
  type WorkflowJob,
} from "./state.ts";

/** Atomic project-local records; disk revision checks run under the session lock. */
export class WorkflowStore {
  constructor(
    readonly workspace: string,
    private readonly now = () => new Date().toISOString(),
  ) {}

  private async root(): Promise<string> {
    const workspace = await realpath(this.workspace);
    let path = workspace;
    for (const part of [".dawg", "workflows", "jobs"]) {
      path = join(path, part);
      await mkdir(path, { recursive: true });
      const resolved = await realpath(path);
      if (!resolved.startsWith(workspace + sep))
        throw new WorkflowValidationError("workflow state escapes the project");
      path = resolved;
    }
    return path;
  }

  async load(jobId: string): Promise<WorkflowJob | undefined> {
    id(jobId, "job id");
    return this.read(join(await this.root(), `${jobId}.json`), jobId);
  }

  private async read(
    path: string,
    jobId: string,
  ): Promise<WorkflowJob | undefined> {
    let contents: string;
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.size > WORKFLOW_LIMITS.recordBytes)
        throw new WorkflowValidationError(
          "workflow record exceeds its byte limit",
        );
      contents = await readFile(path, "utf8");
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
    let value: unknown;
    try {
      value = JSON.parse(contents);
    } catch {
      throw new WorkflowValidationError(
        "workflow record is invalid JSON; existing data was preserved",
      );
    }
    const record = parseWorkflowJob(value);
    if (record.id !== jobId)
      throw new WorkflowValidationError(
        "workflow record identity does not match its file",
      );
    return record;
  }

  async list(): Promise<readonly WorkflowJob[]> {
    const root = await this.root();
    const files = (await readdir(root))
      .filter((file) => file.endsWith(".json"))
      .sort();
    if (files.length > WORKFLOW_LIMITS.jobs)
      throw new WorkflowValidationError(
        "too many workflow jobs; archive finished jobs before creating more",
      );
    const jobs: WorkflowJob[] = [];
    for (const file of files) {
      const jobId = id(file.slice(0, -5), "job filename");
      const job = await this.read(join(root, file), jobId);
      if (job) jobs.push(job);
    }
    return jobs;
  }

  /** Portable revision observation, including hosts where directory events are unavailable. */
  async watch(
    jobId: string,
    listener: (job: WorkflowJob) => void,
    onError: (error: unknown) => void = () => {},
  ): Promise<() => void> {
    id(jobId, "job id");
    const root = await this.root();
    let closed = false;
    let revision = -1;
    let reading = Promise.resolve();
    const refresh = () => {
      reading = reading
        .then(async () => {
          if (closed) return;
          const job = await this.read(join(root, `${jobId}.json`), jobId);
          if (!closed && job && job.revision > revision) {
            revision = job.revision;
            listener(job);
          }
        })
        .catch((error) => {
          if (!closed) onError(error);
        });
    };
    const path = join(root, `${jobId}.json`);
    // A single unreferenced stat watcher per observed job also catches atomic renames.
    // Directory fs.watch events are unavailable in some supported sandboxed terminals.
    const statListener = () => refresh();
    watchFile(path, { persistent: false, interval: 100 }, statListener);
    refresh();
    return () => {
      closed = true;
      unwatchFile(path, statListener);
    };
  }

  async create(value: unknown): Promise<WorkflowJob> {
    const job = parseWorkflowJob(value);
    if (job.revision !== 0)
      throw new WorkflowValidationError(
        "new workflow must start at revision zero",
      );
    const root = await this.root();
    const release = await acquireSessionLock(join(root, ".create.lock"));
    try {
      const path = join(root, `${job.id}.json`);
      if (await this.read(path, job.id))
        throw new WorkflowConflictError("workflow id already exists");
      if (
        (await readdir(root)).filter((file) => file.endsWith(".json")).length >=
        WORKFLOW_LIMITS.jobs
      )
        throw new WorkflowValidationError("workflow job limit reached");
      await durableWrite(path, `${JSON.stringify(job)}\n`, { mode: 0o600 });
      return job;
    } finally {
      await release();
    }
  }

  async update(
    jobId: string,
    expectedRevision: number,
    change: (job: WorkflowJob) => WorkflowJob,
  ): Promise<WorkflowJob> {
    id(jobId, "job id");
    const root = await this.root();
    const release = await acquireSessionLock(join(root, `${jobId}.lock`));
    try {
      const path = join(root, `${jobId}.json`);
      const current = await this.read(path, jobId);
      if (!current)
        throw new WorkflowValidationError("workflow does not exist");
      if (current.revision !== expectedRevision)
        throw new WorkflowConflictError();
      const proposed = change(current);
      if (
        proposed.id !== current.id ||
        proposed.workflowId !== current.workflowId ||
        proposed.workflowVersion !== current.workflowVersion ||
        proposed.profileVersion !== current.profileVersion ||
        proposed.createdAt !== current.createdAt
      )
        throw new WorkflowValidationError("workflow identity cannot change");
      const next = parseWorkflowJob({
        ...proposed,
        revision: current.revision + 1,
        updatedAt: this.now(),
      });
      await durableWrite(path, `${JSON.stringify(next)}\n`, { mode: 0o600 });
      return next;
    } finally {
      await release();
    }
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
