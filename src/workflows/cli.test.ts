import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWorkflowCommand, type WorkflowCliOptions } from "./cli.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "dawg-workflow-cli-"));
  roots.push(path);
  return path;
}
async function command(
  workspace: string,
  argv: string[],
  options: WorkflowCliOptions = {},
) {
  let stdout = "";
  let stderr = "";
  const code = await runWorkflowCommand(
    ["workflow", ...argv],
    workspace,
    {
      write: (text) => {
        stdout += text;
      },
    },
    {
      write: (text) => {
        stderr += text;
      },
    },
    options,
  );
  return { code, stdout, stderr };
}

describe("workflow CLI", () => {
  test("help/catalog/read resolve installed resources without creating project state", async () => {
    const workspace = await root();
    expect((await command(workspace, ["--help"])).code).toBe(0);
    expect(
      JSON.parse((await command(workspace, ["list"])).stdout),
    ).toHaveLength(3);
    const read = await command(workspace, [
      "read",
      "recreate-source",
      "--json",
    ]);
    expect(JSON.parse(read.stdout).text).toContain("actual lyrics");
    expect(await readdir(workspace)).toEqual([]);
    const invalid = await command(workspace, [
      "start",
      "original-house",
      "--unknown",
    ]);
    expect(invalid.code).not.toBe(0);
    expect(await readdir(workspace)).toEqual([]);
  });

  test("selected job lifecycle is durable and machine-readable without hidden generation", async () => {
    const workspace = await root();
    const created = await command(workspace, [
      "start",
      "original-house",
      "--id",
      "song",
      "--brief",
      "A song about a paper boat",
    ]);
    expect(created.code).toBe(0);
    expect(created.stderr).toContain("queued");
    expect(JSON.parse(created.stdout).status).toBe("queued");
    const status = await command(workspace, ["status", "song", "--json"]);
    expect(status.stderr).toBe("");
    expect(JSON.parse(status.stdout).presentationTicket.writtenRevision).toBe(
      0,
    );
    expect(
      JSON.parse(
        (await command(workspace, ["cancel", "song", "--json"])).stdout,
      ).status,
    ).toBe("cancelled");
    expect(
      JSON.parse(
        (await command(workspace, ["resume", "song", "--json"])).stdout,
      ).status,
    ).toBe("queued");
    expect(
      (await command(workspace, ["start", "recreate-source"])).stderr,
    ).toContain("needs --source");
    const source = await command(workspace, [
      "start",
      "recreate-source",
      "--id",
      "cover",
      "--source",
      "https://youtu.be/example",
      "--json",
    ]);
    expect(source.code).toBe(0);
    expect(source.stderr).toBe("");
    expect(JSON.parse(source.stdout).sources[0].locator).toBe(
      "https://youtu.be/example",
    );
    expect(
      JSON.parse((await command(workspace, ["status"])).stdout),
    ).toHaveLength(2);
  });

  test("an injected driver reports real stages and cancellation remains explicit", async () => {
    const workspace = await root();
    let starts = 0;
    const result = await command(
      workspace,
      ["start", "original-house", "--id", "driven"],
      {
        start: async (job, signal, progress) => {
          signal.throwIfAborted();
          starts++;
          progress("Writing the hook");
          return job;
        },
      },
    );
    expect(result.code).toBe(0);
    expect(starts).toBe(1);
    expect(result.stderr).toContain("Writing the hook");
    const aborted = await command(
      workspace,
      ["start", "original-house", "--id", "aborted"],
      { signal: AbortSignal.abort(new DOMException("stopped", "AbortError")) },
    );
    expect(aborted.code).toBe(130);
    expect(aborted.stdout).toBe("");
    expect(
      JSON.parse((await command(workspace, ["status"])).stdout).some(
        (job: { id: string }) => job.id === "aborted",
      ),
    ).toBe(false);
  });
});
