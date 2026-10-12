import { describe, expect, test } from "bun:test";
import { DEMOS, createDemo } from "../../core/demos/index.ts";
import { createScore, scoreFromJSON } from "../../core/score.ts";
import { DEMO_TOOLS } from "./demo-tools.ts";
import {
  AGENT_TOOLS,
  type ActionContext,
  type AgentTool,
  type ToolContext,
} from "./tools.ts";
import {
  executeCall,
  StaleRevisionError,
  type AgentCommit,
  type AgentHost,
} from "./agent.ts";

const tool = (name: string) =>
  DEMO_TOOLS.find((entry) => entry.name === name)! as AgentTool;
const context = (): ToolContext => ({
  score: createScore(),
  focusedTrackId: "lead",
  revision: 1,
  newNoteId: (track, index) => `${track}-${index}`,
});

describe("agent demo songs", () => {
  test("registered discovery is read-only and includes production notes", async () => {
    for (const name of ["list_demos", "load_demo"])
      expect(AGENT_TOOLS.some((entry) => entry.name === name)).toBe(true);
    const plan = tool("list_demos").plan({}, context());
    if (plan.kind !== "action") throw new Error("expected read-only discovery");
    const result = JSON.parse((await plan.run({} as ActionContext)).content);
    expect(result.demos).toHaveLength(11);
    expect(result.demos[0].mixNotes.length).toBeGreaterThan(0);
    expect(() => tool("list_demos").plan({ query: 7 }, context())).toThrow();
    expect(() =>
      tool("load_demo").plan({ id: "missing" }, context()),
    ).toThrow();
    expect(() =>
      tool("load_demo").plan({ id: DEMOS[0]!.id, nope: true }, context()),
    ).toThrow();
  });

  test("every full song is a canonical validated replacement without expensive operation replay", () => {
    for (const demo of DEMOS) {
      const ctx = context();
      const plan = tool("load_demo").plan({ id: demo.id }, ctx);
      if (plan.kind !== "replace")
        throw new Error("expected one replacement plan");
      const next = scoreFromJSON(plan.next.toJSON());
      expect(next.toJSON()).toEqual(createDemo(demo.id).toJSON());
    }
  }, 30_000);

  test("foreign resolution loads the exact library score through a guarded replacement", async () => {
    let score = createScore({ ticksPerBeat: 960 });
    let revision = 7;
    const commits: AgentCommit[] = [];
    const host: AgentHost = {
      snapshot: () => ({
        score,
        revision,
        focusedTrackId: "lead",
        recentOperations: [],
      }),
      async commit(change) {
        if (change.baseRevision !== revision)
          throw new StaleRevisionError(change.baseRevision, revision);
        commits.push(change);
        score = change.next;
        return { revision: ++revision };
      },
    };
    const result = await executeCall(
      {
        id: "load",
        name: "load_demo",
        arguments: JSON.stringify({ id: "signal-bloom" }),
      },
      {
        host,
        tools: DEMO_TOOLS,
        newNoteId: (track, rev, index) => `${track}-${rev}-${index}`,
      },
    );
    expect(result.ok).toBe(true);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      replace: true,
      operations: [],
      baseRevision: 7,
    });
    expect(score.toJSON()).toEqual(createDemo("signal-bloom").toJSON());
  });

  test("a concurrent revision rejects replacement before reaching even a permissive host", async () => {
    const score = createScore({ ticksPerBeat: 960 });
    let reads = 0;
    let commits = 0;
    const result = await executeCall(
      {
        id: "load",
        name: "load_demo",
        arguments: JSON.stringify({ id: "signal-bloom" }),
      },
      {
        host: {
          snapshot: () => ({
            score,
            revision: ++reads === 1 ? 7 : 8,
            focusedTrackId: "lead",
            recentOperations: [],
          }),
          async commit() {
            commits += 1;
            return { revision: 9 };
          },
        },
        tools: DEMO_TOOLS,
        newNoteId: (track, rev, index) => `${track}-${rev}-${index}`,
      },
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain("stale revision");
    expect(commits).toBe(0);
    expect(score.ticksPerBeat).toBe(960);
  });
});
