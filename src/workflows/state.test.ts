import { describe, expect, test } from "bun:test";
import {
  parseWorkflowJob,
  parseSource,
  relativePath,
  sourceDigest,
  WORKFLOW_FORMAT,
  WORKFLOW_LIMITS,
  type WorkflowJob,
} from "./state.ts";

export function jobFixture(): WorkflowJob {
  return parseWorkflowJob({
    format: WORKFLOW_FORMAT,
    id: "example",
    workflowId: "original-house",
    workflowVersion: "1.0.0",
    profileVersion: "1.0.0",
    revision: 0,
    epoch: 0,
    status: "queued",
    createdAt: "2026-10-30T00:00:00.000Z",
    updatedAt: "2026-10-30T00:00:00.000Z",
    brief: "A bright song about a paper boat",
    sources: [],
    stages: [
      {
        id: "plan",
        title: "Write the song",
        dependsOn: [],
        status: "pending",
        attempt: 0,
      },
    ],
    artifacts: [],
    readiness: [],
    writtenRevision: 0,
    audibleRevision: null,
    controlRevision: 0,
    bufferedRanges: [],
  });
}

describe("workflow record boundary", () => {
  test("roundtrips a deeply immutable bounded versioned record", () => {
    const job = jobFixture();
    expect(parseWorkflowJob(JSON.parse(JSON.stringify(job)))).toEqual(job);
    expect(Object.isFrozen(job.stages[0])).toBe(true);
    for (const patch of [
      { format: "dawg.workflow-job/v9" },
      { id: "../../other" },
      { revision: -1 },
      { brief: "x".repeat(WORKFLOW_LIMITS.text + 1) },
      { workflowVersion: "latest" },
      { stages: Array(WORKFLOW_LIMITS.stages + 1).fill(job.stages[0]) },
      { audibleRevision: 1 },
    ])
      expect(() => parseWorkflowJob({ ...job, ...patch })).toThrow();
  });

  test("rejects dependency cycles, duplicates and invented ready assets", () => {
    const job = jobFixture();
    expect(() =>
      parseWorkflowJob({
        ...job,
        stages: [{ ...job.stages[0], dependsOn: ["plan"] }],
      }),
    ).toThrow("preceding");
    expect(() =>
      parseWorkflowJob({ ...job, stages: [job.stages[0], job.stages[0]] }),
    ).toThrow("duplicate");
    expect(() =>
      parseWorkflowJob({
        ...job,
        readiness: [
          {
            trackId: "vocals",
            writtenRevision: 0,
            state: "ready",
            range: { from: 0, to: 16 },
            requiredArtifacts: ["imagined-take"],
            audibleNotes: 8,
          },
        ],
      }),
    ).toThrow("missing or stale");
    expect(() =>
      parseWorkflowJob({
        ...job,
        bufferedRanges: [
          {
            renderId: "buffer",
            writtenRevision: 0,
            range: { from: 0, to: 16 },
            trackIds: ["vocals"],
            renderedNotes: 8,
            missingAssets: ["take.wav"],
          },
        ],
        audibleRevision: 0,
      }),
    ).toThrow("no missing assets");
  });

  test("source identity separates locators and content hashes", () => {
    const source = parseSource({
      id: "source",
      kind: "audio",
      locator: "tracks/source/downloads/source.wav",
    });
    expect(source.sha256).toBeUndefined();
    expect(sourceDigest([source])).not.toBe(
      sourceDigest([{ ...source, sha256: "a".repeat(64) }]),
    );
    for (const path of [
      "../escape",
      "/tmp/out",
      "C:/out",
      "track\\out",
      ".dawg/jobs/state.json",
      "tracks//out",
      "tracks/./out",
    ])
      expect(() => relativePath(path)).toThrow();
    expect(() =>
      parseSource({
        id: "source",
        kind: "youtube",
        locator: "https://user:secret@youtube.com/watch?v=abc",
      }),
    ).toThrow();
    expect(() =>
      parseSource({
        id: "source",
        kind: "youtube",
        locator: "https://example.com/",
      }),
    ).toThrow();
  });
});
