import type { ActionContext, AgentTool, ToolPlan } from "../agent/tools.ts";
import { ToolArgumentError } from "../agent/tool-error.ts";
import {
  getWorkflow,
  HOUSE_PROFILE,
  listWorkflows,
  readWorkflowResource,
} from "./catalog.ts";
import {
  capturePresentation,
  type PresentationTicket,
  type StageCompletion,
  WorkflowCoordinator,
} from "./coordinator.ts";
import {
  coherentReady,
  enumeration,
  id,
  integer,
  list,
  object,
  parseArtifactInput,
  parseRange,
  parseReadiness,
  parseSource,
  parseStageTicket,
  string,
  WORKFLOW_LIMITS,
  WorkflowConflictError,
  WorkflowValidationError,
  type BeatRange,
  type BufferedRegion,
  type WorkflowJob,
} from "./state.ts";

export type PreviewRequest = Readonly<{
  ticket: PresentationTicket;
  range: BeatRange;
  trackIds: readonly string[];
}>;
/** Root hosts inject this on AgentHost and forward it into ActionContext. */
export type WorkflowHost = Readonly<{
  coordinator: WorkflowCoordinator;
  /** Explicit request: resolve only after the host committed a real engine buffer. */
  requestPreview?: (
    request: PreviewRequest,
    signal?: AbortSignal,
  ) => Promise<BufferedRegion>;
  /** Optional fresh score revision guard for asynchronous written-state tools. */
  scoreRevision?: () => number;
}>;

const PAGE_BYTES = 8 * 1024;
const jobIdSchema = { type: "string", maxLength: 64 };
const workflowIdSchema = {
  type: "string",
  enum: ["original-house", "reference-study", "recreate-source"],
};
const rangeSchema = {
  type: "object",
  properties: {
    from: { type: "number", minimum: 0 },
    to: { type: "number", minimum: 0 },
  },
  required: ["from", "to"],
  additionalProperties: false,
};
const ticketSchema = {
  type: "object",
  properties: {
    jobId: jobIdSchema,
    stageId: jobIdSchema,
    attempt: { type: "integer", minimum: 0 },
    epoch: { type: "integer", minimum: 0 },
    writtenRevision: { type: "integer", minimum: 0 },
    sourceDigest: { type: "string", minLength: 64, maxLength: 64 },
  },
  required: [
    "jobId",
    "stageId",
    "attempt",
    "epoch",
    "writtenRevision",
    "sourceDigest",
  ],
  additionalProperties: false,
};
const sourcesSchema = {
  type: "array",
  maxItems: WORKFLOW_LIMITS.sources,
  items: {
    type: "object",
    properties: {
      id: jobIdSchema,
      kind: { type: "string", enum: ["youtube", "audio"] },
      locator: { type: "string", maxLength: 2048 },
      sha256: { type: "string", minLength: 64, maxLength: 64 },
    },
    required: ["id", "kind", "locator"],
    additionalProperties: false,
  },
};
const readinessSchema = {
  type: "array",
  maxItems: WORKFLOW_LIMITS.readiness,
  items: {
    type: "object",
    properties: {
      trackId: jobIdSchema,
      sectionId: jobIdSchema,
      writtenRevision: { type: "integer", minimum: 0 },
      state: {
        type: "string",
        enum: ["planned", "writing", "waiting-assets", "ready", "failed"],
      },
      range: rangeSchema,
      requiredArtifacts: {
        type: "array",
        maxItems: WORKFLOW_LIMITS.artifacts,
        items: jobIdSchema,
      },
      audibleNotes: { type: "integer", minimum: 0, maximum: 100_000 },
    },
    required: [
      "trackId",
      "writtenRevision",
      "state",
      "range",
      "requiredArtifacts",
      "audibleNotes",
    ],
    additionalProperties: false,
  },
};

function needHost(action: ActionContext): WorkflowHost {
  const host = (action as ActionContext & { workflows?: WorkflowHost })
    .workflows;
  if (!host)
    throw new ToolArgumentError("workflow runtime is unavailable in this host");
  return host;
}

function boundary<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof WorkflowValidationError)
      throw new ToolArgumentError(error.message);
    throw error;
  }
}

function actionPlan(
  summary: string,
  run: (context: ActionContext) => Promise<unknown>,
  mutated = false,
): ToolPlan {
  return {
    kind: "action",
    summary,
    async run(context) {
      context.signal?.throwIfAborted();
      try {
        const value = await run(context);
        const content =
          typeof value === "string" ? value : JSON.stringify(value);
        if (Buffer.byteLength(content) > PAGE_BYTES)
          throw new ToolArgumentError(
            "workflow result is too large; use workflow_inspect with a narrower view",
          );
        return { content, summary, mutated };
      } catch (error) {
        if (
          error instanceof WorkflowValidationError ||
          error instanceof WorkflowConflictError
        )
          throw new ToolArgumentError(error.message);
        throw error;
      }
    },
  };
}

export function workflowSummary(job: WorkflowJob) {
  return {
    id: job.id,
    workflowId: job.workflowId,
    workflowVersion: job.workflowVersion,
    profileVersion: job.profileVersion,
    revision: job.revision,
    epoch: job.epoch,
    status: job.status,
    writtenRevision: job.writtenRevision,
    audibleRevision: job.audibleRevision,
    controlRevision: job.controlRevision,
    stages: job.stages.map(({ id, status, attempt }) => ({
      id,
      status,
      attempt,
    })),
    artifacts: job.artifacts.length,
    readiness: job.readiness.length,
    bufferedRanges: job.bufferedRanges.length,
    presentationTicket: capturePresentation(job),
  };
}

function paged(
  items: readonly unknown[],
  cursor: number,
): { items: unknown[]; nextCursor: number | null; total: number } {
  const page: unknown[] = [];
  for (let index = cursor; index < items.length && page.length < 16; index++) {
    if (
      Buffer.byteLength(JSON.stringify([...page, items[index]])) >
      PAGE_BYTES - 512
    )
      break;
    page.push(items[index]);
  }
  return {
    items: page,
    nextCursor:
      cursor + page.length < items.length ? cursor + page.length : null,
    total: items.length,
  };
}

const catalog: AgentTool = {
  name: "workflow_catalog",
  description:
    "List bundled versioned song workflows, or read one workflow's portable instructions/resources. Reading never starts generation.",
  parameters: {
    type: "object",
    properties: {
      workflowId: workflowIdSchema,
      resource: { type: "string", maxLength: 160 },
      cursor: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
  },
  plan(args) {
    return boundary(() => {
      if (args.workflowId === undefined) {
        if (args.resource !== undefined || args.cursor !== undefined)
          throw new ToolArgumentError(
            "choose a workflow before reading a resource",
          );
        return actionPlan("workflow catalog", async () => ({
          profile: HOUSE_PROFILE,
          workflows: listWorkflows(),
        }));
      }
      const workflowId = getWorkflow(
        string(args.workflowId, "workflow id", 64),
      ).id;
      const resource =
        args.resource === undefined
          ? undefined
          : string(args.resource, "resource", 160);
      const cursor =
        args.cursor === undefined
          ? 0
          : integer(args.cursor, "resource cursor", 32 * 1024);
      return actionPlan(`workflow instructions ${workflowId}`, async () => {
        const body = await readWorkflowResource(workflowId, resource);
        const text = body.slice(cursor, cursor + 4_000);
        return {
          workflowId,
          resource: resource ?? getWorkflow(workflowId).instructions,
          text,
          nextCursor:
            cursor + text.length < body.length ? cursor + text.length : null,
        };
      });
    });
  },
};

const create: AgentTool = {
  name: "workflow_create",
  description:
    "Create only the selected durable project-local workflow. Returns a queued job; it does not run models, edit a score or start playback.",
  parameters: {
    type: "object",
    properties: {
      workflowId: workflowIdSchema,
      id: jobIdSchema,
      brief: { type: "string", maxLength: WORKFLOW_LIMITS.text },
      sources: sourcesSchema,
    },
    required: ["workflowId"],
    additionalProperties: false,
  },
  plan(args) {
    return boundary(() => {
      const workflowId = getWorkflow(
        string(args.workflowId, "workflow id", 64),
      ).id;
      const jobId = args.id === undefined ? undefined : id(args.id, "job id");
      const brief =
        args.brief === undefined
          ? ""
          : string(args.brief, "brief", WORKFLOW_LIMITS.text, true);
      const sources = list(
        args.sources ?? [],
        WORKFLOW_LIMITS.sources,
        "sources",
        parseSource,
      );
      return actionPlan(
        `create ${workflowId}`,
        async (context) =>
          workflowSummary(
            await needHost(context).coordinator.create({
              workflowId,
              id: jobId,
              brief,
              sources,
            }),
          ),
        true,
      );
    });
  },
};

const inspect: AgentTool = {
  name: "workflow_inspect",
  description:
    "Read durable workflow progress without a TUI. No jobId lists jobs; summary includes written/audible revisions and a presentation ticket. Page stages, artifacts, readiness, sources or buffered ranges with view/cursor.",
  parameters: {
    type: "object",
    properties: {
      jobId: jobIdSchema,
      view: {
        type: "string",
        enum: [
          "summary",
          "stages",
          "artifacts",
          "readiness",
          "sources",
          "bufferedRanges",
        ],
      },
      cursor: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
  },
  plan(args) {
    return boundary(() => {
      const jobId =
        args.jobId === undefined ? undefined : id(args.jobId, "job id");
      const view = enumeration(
        args.view ?? "summary",
        [
          "summary",
          "stages",
          "artifacts",
          "readiness",
          "sources",
          "bufferedRanges",
        ] as const,
        "workflow view",
      );
      const cursor = integer(
        args.cursor ?? 0,
        "cursor",
        WORKFLOW_LIMITS.artifacts,
      );
      return actionPlan("inspect workflow", async (context) => {
        const coordinator = needHost(context).coordinator;
        if (!jobId)
          return paged((await coordinator.list()).map(workflowSummary), cursor);
        const job = await coordinator.inspect(jobId);
        return view === "summary"
          ? workflowSummary(job)
          : {
              id: job.id,
              revision: job.revision,
              view,
              ...paged(job[view], cursor),
            };
      });
    });
  },
};

const stageTool: AgentTool = {
  name: "workflow_stage",
  description:
    "Start, report progress, complete or fail one declared workflow stage. Start returns an attempt/source/score ticket; all later actions require that exact ticket. Completion verifies project artifact hashes and never starts playback.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["start", "progress", "complete", "fail"],
      },
      jobId: jobIdSchema,
      stageId: jobIdSchema,
      ticket: ticketSchema,
      message: { type: "string", maxLength: 2_000 },
      completion: {
        type: "object",
        properties: {
          artifacts: {
            type: "array",
            maxItems: WORKFLOW_LIMITS.artifacts,
            items: { type: "object" },
          },
          sources: sourcesSchema,
          writtenRevision: { type: "integer", minimum: 0 },
          readiness: readinessSchema,
        },
        additionalProperties: false,
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  plan(args) {
    return boundary(() => {
      const action = enumeration(
        args.action,
        ["start", "progress", "complete", "fail"] as const,
        "stage action",
      );
      if (action === "start") {
        const jobId = id(args.jobId, "job id");
        const stageId = id(args.stageId, "stage id");
        if (args.ticket !== undefined || args.completion !== undefined)
          throw new ToolArgumentError(
            "start takes jobId and stageId, not a previous result",
          );
        return actionPlan(
          `start ${stageId}`,
          async (context) =>
            needHost(context).coordinator.startStage(jobId, stageId),
          true,
        );
      }
      const ticket = parseStageTicket(args.ticket);
      if (args.jobId !== undefined && args.jobId !== ticket.jobId)
        throw new ToolArgumentError("jobId disagrees with ticket");
      if (args.stageId !== undefined && args.stageId !== ticket.stageId)
        throw new ToolArgumentError("stageId disagrees with ticket");
      if (action === "complete") {
        const raw =
          args.completion === undefined
            ? {}
            : object(args.completion, "completion");
        const completion: StageCompletion = {
          ...(raw.artifacts === undefined
            ? {}
            : {
                artifacts: list(
                  raw.artifacts,
                  WORKFLOW_LIMITS.artifacts,
                  "artifacts",
                  parseArtifactInput,
                ),
              }),
          ...(raw.sources === undefined
            ? {}
            : {
                sources: list(
                  raw.sources,
                  WORKFLOW_LIMITS.sources,
                  "sources",
                  parseSource,
                ),
              }),
          ...(raw.writtenRevision === undefined
            ? {}
            : {
                writtenRevision: integer(
                  raw.writtenRevision,
                  "written revision",
                ),
              }),
          ...(raw.readiness === undefined
            ? {}
            : {
                readiness: list(
                  raw.readiness,
                  WORKFLOW_LIMITS.readiness,
                  "readiness",
                  parseReadiness,
                ),
              }),
        };
        return actionPlan(
          `complete ${ticket.stageId}`,
          async (context) =>
            workflowSummary(
              await needHost(context).coordinator.completeStage(
                ticket,
                completion,
              ),
            ),
          true,
        );
      }
      const message = string(
        args.message,
        "stage message",
        action === "progress" ? 160 : 2_000,
      );
      return actionPlan(
        `${action} ${ticket.stageId}`,
        async (context) =>
          workflowSummary(
            await (action === "progress"
              ? needHost(context).coordinator.progress(ticket, message)
              : needHost(context).coordinator.failStage(ticket, message)),
          ),
        true,
      );
    });
  },
};

function jobAction(name: "cancel" | "resume" | "control"): AgentTool {
  return {
    name: `workflow_${name}`,
    description:
      name === "cancel"
        ? "Cancel the selected job and abort owned work; keep accepted artifacts and ready audio."
        : name === "resume"
          ? "Explicitly resume the selected job: verify saved artifacts, keep completed stages and reset interrupted attempts. No inference starts automatically."
          : "Record an explicit human transport action (pause, stop or seek), invalidating earlier preview tickets without cancelling composition. Never call to undo the person's decision.",
    parameters: {
      type: "object",
      properties: { jobId: jobIdSchema },
      required: ["jobId"],
      additionalProperties: false,
    },
    plan(args) {
      return boundary(() => {
        const jobId = id(args.jobId, "job id");
        return actionPlan(
          `${name} workflow`,
          async (context) => {
            const coordinator = needHost(context).coordinator;
            return workflowSummary(
              await (name === "control"
                ? coordinator.recordControl(jobId)
                : coordinator[name](jobId)),
            );
          },
          true,
        );
      });
    },
  };
}

const written: AgentTool = {
  name: "workflow_written",
  description:
    "Record a score revision that the host already committed, plus bounded track/section readiness. This does not edit the score or claim the new revision is audible; it invalidates older async results.",
  parameters: {
    type: "object",
    properties: {
      jobId: jobIdSchema,
      writtenRevision: { type: "integer", minimum: 0 },
      readiness: readinessSchema,
    },
    required: ["jobId", "writtenRevision"],
    additionalProperties: false,
  },
  plan(args, context) {
    return boundary(() => {
      const jobId = id(args.jobId, "job id");
      const revision = integer(args.writtenRevision, "written revision");
      if (revision !== context.revision)
        throw new ToolArgumentError(
          "written revision must match the host's committed score revision",
        );
      const readiness = list(
        args.readiness ?? [],
        WORKFLOW_LIMITS.readiness,
        "readiness",
        parseReadiness,
      );
      return actionPlan(
        "record written music",
        async (action) => {
          const host = needHost(action);
          if (host.scoreRevision && host.scoreRevision() !== revision)
            throw new ToolArgumentError(
              "score changed before written progress could be recorded",
            );
          return workflowSummary(
            await host.coordinator.recordWritten(jobId, revision, readiness),
          );
        },
        true,
      );
    });
  },
};

const preview: AgentTool = {
  name: "workflow_preview",
  description:
    "Explicitly request a coherent ready region from the host's real audio engine and record its successful buffer receipt. Missing PCM support fails clearly. This tool does not decide autoplay or override pause/stop/seek.",
  parameters: {
    type: "object",
    properties: {
      jobId: jobIdSchema,
      range: rangeSchema,
      trackIds: {
        type: "array",
        minItems: 1,
        maxItems: WORKFLOW_LIMITS.readiness,
        items: jobIdSchema,
      },
    },
    required: ["jobId", "range", "trackIds"],
    additionalProperties: false,
  },
  plan(args) {
    return boundary(() => {
      const jobId = id(args.jobId, "job id");
      const range = parseRange(args.range);
      const trackIds = list(
        args.trackIds,
        WORKFLOW_LIMITS.readiness,
        "preview tracks",
        (value) => id(value),
      );
      if (!trackIds.length || new Set(trackIds).size !== trackIds.length)
        throw new ToolArgumentError("preview needs distinct nonempty trackIds");
      return actionPlan(
        "prepare ready preview",
        async (context) => {
          const host = needHost(context);
          if (!host.requestPreview)
            throw new ToolArgumentError(
              "ready preview is unavailable: this host has no real PCM bridge",
            );
          const job = await host.coordinator.inspect(jobId);
          if (!coherentReady(job, { range, trackIds }))
            throw new ToolArgumentError(
              "requested preview region is not coherently ready",
            );
          const ticket = capturePresentation(job);
          const region = await host.requestPreview(
            { ticket, range, trackIds },
            context.signal,
          );
          context.signal?.throwIfAborted();
          if (
            region.range.from !== range.from ||
            region.range.to !== range.to ||
            JSON.stringify(region.trackIds) !== JSON.stringify(trackIds)
          )
            throw new ToolArgumentError(
              "preview host returned a different region",
            );
          return workflowSummary(
            await host.coordinator.publishAudible(ticket, region),
          );
        },
        true,
      );
    });
  },
};

export const WORKFLOW_TOOLS: readonly AgentTool[] = Object.freeze([
  catalog,
  create,
  inspect,
  stageTool,
  jobAction("cancel"),
  jobAction("resume"),
  written,
  jobAction("control"),
  preview,
]);
