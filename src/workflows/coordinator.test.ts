import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  capturePresentation,
  WorkflowCoordinator,
  type WorkflowEvent,
} from "./coordinator.ts";
import {
  coherentReady,
  WorkflowConflictError,
  type ArtifactInput,
  type BufferedRegion,
  type TrackReadiness,
} from "./state.ts";

const directories: string[] = [];
const coordinators: WorkflowCoordinator[] = [];
async function fixture(): Promise<WorkflowCoordinator> {
  const root = await mkdtemp(join(tmpdir(), "dawg-workflow-"));
  directories.push(root);
  const coordinator = new WorkflowCoordinator(root);
  coordinators.push(coordinator);
  return coordinator;
}
afterEach(async () => {
  coordinators.splice(0).forEach((coordinator) => coordinator.dispose());
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
const ready = (revision = 1): TrackReadiness => ({
  trackId: "keys",
  sectionId: "verse",
  writtenRevision: revision,
  state: "ready",
  range: { from: 0, to: 16 },
  requiredArtifacts: [],
  audibleNotes: 8,
});
const region = (revision = 1): BufferedRegion => ({
  renderId: `render-${revision}`,
  writtenRevision: revision,
  range: { from: 0, to: 16 },
  trackIds: ["keys"],
  renderedNotes: 8,
  missingAssets: [],
});
async function asset(
  coordinator: WorkflowCoordinator,
  path = "tracks/vocals/samples/take.wav",
): Promise<ArtifactInput> {
  const bytes = Buffer.from("owned fake backend output");
  await mkdir(join(coordinator.workspace, "tracks/vocals/samples"), {
    recursive: true,
  });
  await writeFile(join(coordinator.workspace, path), bytes);
  return {
    id: "take-1",
    kind: "vocal",
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    producer: {
      name: "fake-vocal",
      version: "1.0.0",
      configHash: "c".repeat(64),
    },
  };
}

describe("workflow coordinator", () => {
  test("persists fake stages, emits committed progress and resumes only unfinished work", async () => {
    const coordinator = await fixture();
    const events: WorkflowEvent[] = [];
    coordinator.subscribe((event) => events.push(event));
    coordinator.subscribe(() => {
      throw new Error("observer failed");
    });
    const job = await coordinator.create({
      workflowId: "original-house",
      id: "song",
      brief: "A bright song about a paper boat",
    });
    const artifact = await asset(coordinator);
    await coordinator.runStage(job.id, "plan", async ({ progress }) => {
      await progress("Writing the hook");
      return { artifacts: [artifact] };
    });
    const ticket = await coordinator.startStage(job.id, "compose");
    expect(coordinator.signal(ticket).aborted).toBe(false);
    await coordinator.cancel(job.id);
    expect(coordinator.signal(ticket).aborted).toBe(true);
    await expect(coordinator.completeStage(ticket)).rejects.toBeInstanceOf(
      WorkflowConflictError,
    );
    const reopened = new WorkflowCoordinator(coordinator.workspace);
    coordinators.push(reopened);
    const resumed = await reopened.resume(job.id);
    expect(resumed.status).toBe("queued");
    expect(resumed.stages.find((stage) => stage.id === "plan")?.status).toBe(
      "complete",
    );
    expect(resumed.stages.find((stage) => stage.id === "compose")?.status).toBe(
      "pending",
    );
    expect(resumed.artifacts[0]?.sha256).toBe(artifact.sha256);
    await expect(reopened.startStage(job.id, "plan")).rejects.toThrow(
      "already",
    );
    expect(events.map((event) => event.type)).toContain("cancelled");
    expect((await reopened.inspect(job.id)).revision).toBeGreaterThan(
      job.revision,
    );
  });

  test("written/audible versions and human controls reject stale asynchronous results", async () => {
    const coordinator = await fixture();
    const job = await coordinator.create({ workflowId: "original-house" });
    const stage = await coordinator.startStage(job.id, "plan");
    await coordinator.recordWritten(job.id, 1, [ready()]);
    await expect(coordinator.completeStage(stage)).rejects.toThrow("stale");
    let current = await coordinator.inspect(job.id);
    expect(current.audibleRevision).toBeNull();
    const beforePause = capturePresentation(current);
    await coordinator.recordControl(job.id);
    await expect(
      coordinator.publishAudible(beforePause, region()),
    ).rejects.toThrow("human controls");
    current = await coordinator.inspect(job.id);
    await coordinator.publishAudible(capturePresentation(current), region());
    const next = await coordinator.recordWritten(job.id, 2);
    expect(next.writtenRevision).toBe(2);
    expect(next.audibleRevision).toBe(1);
    expect(next.bufferedRanges[0]?.writtenRevision).toBe(1);
    expect(coherentReady(next, region(2))).toBe(false);
    await expect(
      coordinator.publishAudible(capturePresentation(next), region(2)),
    ).rejects.toThrow("coherently ready");
    await coordinator.setReadiness(job.id, 2, [ready(2)]);
    const prepared = await coordinator.inspect(job.id);
    const accepted = await coordinator.publishAudible(
      capturePresentation(prepared),
      region(2),
    );
    expect(accepted.audibleRevision).toBe(2);
    expect(accepted.bufferedRanges).toHaveLength(1);
  });

  test("missing, corrupted and outside assets cannot become audible", async () => {
    const coordinator = await fixture();
    const job = await coordinator.create({ workflowId: "original-house" });
    const ticket = await coordinator.startStage(job.id, "plan");
    const artifact = await asset(coordinator);
    await expect(
      coordinator.completeStage(ticket, {
        artifacts: [{ ...artifact, sha256: "0".repeat(64) }],
      }),
    ).rejects.toThrow("hash changed");
    await coordinator.completeStage(ticket, {
      artifacts: [artifact],
      writtenRevision: 1,
    });
    const vocalReady: TrackReadiness = {
      ...ready(),
      requiredArtifacts: [artifact.id],
    };
    await coordinator.setReadiness(job.id, 1, [vocalReady]);
    const current = await coordinator.inspect(job.id);
    await rm(join(coordinator.workspace, artifact.path));
    await expect(
      coordinator.publishAudible(capturePresentation(current), region()),
    ).rejects.toThrow("missing workflow artifact");
    await expect(coordinator.resume(job.id)).rejects.toThrow(
      "missing workflow artifact",
    );
    const outside = await mkdtemp(join(tmpdir(), "dawg-outside-"));
    directories.push(outside);
    await writeFile(join(outside, "out.wav"), "owned fake backend output");
    await symlink(
      join(outside, "out.wav"),
      join(coordinator.workspace, artifact.path),
    );
    await expect(
      coordinator.setReadiness(job.id, 1, [vocalReady]),
    ).rejects.toThrow("escapes");
  });

  test("cancel aborts an owned fake backend and retains completed stages", async () => {
    const coordinator = await fixture();
    const job = await coordinator.create({ workflowId: "reference-study" });
    let began!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    const running = coordinator.runStage(
      job.id,
      "ingest",
      async ({ signal }) => {
        began();
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        );
        return {};
      },
    );
    await started;
    await coordinator.cancel(job.id);
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    expect((await coordinator.inspect(job.id)).status).toBe("cancelled");
  });

  test("dependency, failure, cancellation epoch and source guards remain explicit", async () => {
    const coordinator = await fixture();
    const source = {
      id: "source",
      kind: "youtube" as const,
      locator: "https://youtu.be/example",
    };
    const job = await coordinator.create({
      workflowId: "recreate-source",
      sources: [source],
    });
    await expect(coordinator.startStage(job.id, "vocals")).rejects.toThrow(
      "dependencies",
    );
    const first = await coordinator.startStage(job.id, "ingest");
    await coordinator.failStage(first, "download unavailable");
    await expect(coordinator.startStage(job.id, "ingest")).rejects.toThrow(
      "resume",
    );
    await coordinator.resume(job.id);
    const second = await coordinator.startStage(job.id, "ingest");
    await coordinator.completeStage(second, {
      sources: [{ ...source, sha256: "a".repeat(64) }],
    });
    await expect(coordinator.completeStage(first)).rejects.toThrow("stale");
    const old = capturePresentation(await coordinator.inspect(job.id));
    await coordinator.cancel(job.id);
    await coordinator.resume(job.id);
    await expect(
      coordinator.publishAudible(old, { ...region(0) }),
    ).rejects.toThrow("stale");
  });

  test("a cancel from another coordinator aborts the actual owner's stage signal", async () => {
    const owner = await fixture();
    const job = await owner.create({ workflowId: "original-house" });
    const ticket = await owner.startStage(job.id, "plan");
    const signal = owner.signal(ticket);
    const observed = new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
    const other = new WorkflowCoordinator(owner.workspace);
    coordinators.push(other);
    await other.cancel(job.id);
    await observed;
    expect(signal.aborted).toBe(true);
    await expect(owner.completeStage(ticket)).rejects.toThrow("stale");
  });
});
