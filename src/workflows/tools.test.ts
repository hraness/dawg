import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScore } from "../../core/score.ts";
import type { ActionContext, AgentTool, ToolContext } from "../agent/tools.ts";
import { WorkflowCoordinator } from "./coordinator.ts";
import { WORKFLOW_TOOLS, type WorkflowHost } from "./tools.ts";
import type { TrackReadiness } from "./state.ts";

const roots: string[] = [];
const owners: WorkflowCoordinator[] = [];
afterEach(async () => {
  owners.splice(0).forEach((owner) => owner.dispose());
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function host(): Promise<WorkflowHost> {
  const root = await mkdtemp(join(tmpdir(), "dawg-workflow-tools-"));
  roots.push(root);
  const coordinator = new WorkflowCoordinator(root);
  owners.push(coordinator);
  return { coordinator };
}
const context = (revision = 0): ToolContext => ({
  score: createScore({ tempoBpm: 120, bars: 4, tracks: [] }),
  focusedTrackId: "keys",
  revision,
  newNoteId: () => "note",
});
const tool = (name: string): AgentTool =>
  WORKFLOW_TOOLS.find((entry) => entry.name === name)!;
async function run(
  name: string,
  args: Record<string, unknown>,
  workflows?: WorkflowHost,
  revision = 0,
) {
  const plan = tool(name).plan(args, context(revision));
  if (plan.kind !== "action")
    throw new Error("workflow tool must use existing action plan");
  return plan.run({ ...(workflows ? { workflows } : {}) } as ActionContext);
}
const ready: TrackReadiness = {
  trackId: "keys",
  writtenRevision: 1,
  state: "ready",
  range: { from: 0, to: 16 },
  requiredArtifacts: [],
  audibleNotes: 4,
};

describe("workflow state tools", () => {
  test("catalog/resources work without a host and create has no hidden execution", async () => {
    const catalog = JSON.parse((await run("workflow_catalog", {})).content);
    expect(catalog.workflows).toHaveLength(3);
    const instructions = JSON.parse(
      (await run("workflow_catalog", { workflowId: "original-house" })).content,
    );
    expect(instructions.text).toContain("Write an original");
    await expect(
      run("workflow_create", { workflowId: "original-house" }),
    ).rejects.toThrow("runtime is unavailable");
    const workflows = await host();
    const created = JSON.parse(
      (
        await run(
          "workflow_create",
          {
            workflowId: "original-house",
            id: "song",
            brief: "An original bright hook",
          },
          workflows,
        )
      ).content,
    );
    expect(created.status).toBe("queued");
    expect(
      created.stages.every(
        (entry: { status: string }) => entry.status === "pending",
      ),
    ).toBe(true);
    expect(
      (await workflows.coordinator.inspect("song")).audibleRevision,
    ).toBeNull();
    expect(() =>
      tool("workflow_catalog").plan(
        { workflowId: "original-house", resource: "../../package.json" },
        context(),
      ),
    ).not.toThrow();
    await expect(
      run("workflow_catalog", {
        workflowId: "original-house",
        resource: "../../package.json",
      }),
    ).rejects.toThrow("not part");
  });

  test("stage tickets drive progress/complete/fail and explicit resume", async () => {
    const workflows = await host();
    await run(
      "workflow_create",
      { workflowId: "original-house", id: "song" },
      workflows,
    );
    const ticket = JSON.parse(
      (
        await run(
          "workflow_stage",
          { action: "start", jobId: "song", stageId: "plan" },
          workflows,
        )
      ).content,
    );
    await run(
      "workflow_stage",
      { action: "progress", ticket, message: "Writing the hook" },
      workflows,
    );
    await run("workflow_stage", { action: "complete", ticket }, workflows);
    const compose = JSON.parse(
      (
        await run(
          "workflow_stage",
          { action: "start", jobId: "song", stageId: "compose" },
          workflows,
        )
      ).content,
    );
    await run(
      "workflow_stage",
      { action: "fail", ticket: compose, message: "backend unavailable" },
      workflows,
    );
    const failed = JSON.parse(
      (await run("workflow_inspect", { jobId: "song" }, workflows)).content,
    );
    expect(failed.status).toBe("failed");
    const resumed = JSON.parse(
      (await run("workflow_resume", { jobId: "song" }, workflows)).content,
    );
    expect(
      resumed.stages.find((entry: { id: string }) => entry.id === "plan")
        .status,
    ).toBe("complete");
    await expect(
      run("workflow_stage", { action: "complete", ticket: compose }, workflows),
    ).rejects.toThrow("stale");
    await run("workflow_cancel", { jobId: "song" }, workflows);
    expect((await workflows.coordinator.inspect("song")).status).toBe(
      "cancelled",
    );
  });

  test("written progress must match committed score and preview needs actual host PCM", async () => {
    const workflows = await host();
    await workflows.coordinator.create({
      workflowId: "original-house",
      id: "song",
    });
    await expect(
      run(
        "workflow_written",
        { jobId: "song", writtenRevision: 99 },
        workflows,
        1,
      ),
    ).rejects.toThrow("committed score");
    await run(
      "workflow_written",
      { jobId: "song", writtenRevision: 1, readiness: [ready] },
      { ...workflows, scoreRevision: () => 1 },
      1,
    );
    const args = {
      jobId: "song",
      range: { from: 0, to: 16 },
      trackIds: ["keys"],
    };
    await expect(run("workflow_preview", args, workflows)).rejects.toThrow(
      "no real PCM bridge",
    );
    let previews = 0;
    const previewHost: WorkflowHost = {
      ...workflows,
      requestPreview: async ({ ticket, range, trackIds }) => {
        previews++;
        return {
          renderId: "buffer-1",
          writtenRevision: ticket.writtenRevision,
          range,
          trackIds,
          renderedNotes: 4,
          missingAssets: [],
        };
      },
    };
    const result = JSON.parse(
      (await run("workflow_preview", args, previewHost)).content,
    );
    expect(previews).toBe(1);
    expect(result.audibleRevision).toBe(1);
    await expect(
      run("workflow_preview", args, {
        ...workflows,
        requestPreview: async ({ ticket, range, trackIds }) => {
          await workflows.coordinator.recordControl("song");
          return {
            renderId: "late",
            writtenRevision: ticket.writtenRevision,
            range,
            trackIds,
            renderedNotes: 4,
            missingAssets: [],
          };
        },
      }),
    ).rejects.toThrow("human controls");
    expect(
      (await workflows.coordinator.inspect("song")).bufferedRanges[0]?.renderId,
    ).toBe("buffer-1");
  });
});
