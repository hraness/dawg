/**
 * Regression tests for the agent's isolation rules (design §6.1, §6.2,
 * §7.4): the untrusted-turn rule covers trusted exec and dispatched
 * children, a child's audio outputs stay in its task scope, and dispatch
 * scopes are disjoint by glob, not by string.
 */
import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScore, type TrackScore } from "../../core/score.ts";
import { systemRunner } from "../auth/runner.ts";
import { encodeWav24, makePcm } from "../audio/chop/pcm.ts";
import {
  executeCall,
  type AgentHost,
  type CallOutcome,
  type TurnState,
} from "./agent.ts";
import {
  buildScopes,
  CommitQueue,
  globsOverlap,
  parseTasks,
  runSubagents,
  scopedHost,
  SpendMeter,
  SubagentScopeError,
} from "./subagents.ts";
import { AGENT_TOOLS } from "./tools.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function score(): TrackScore {
  return createScore({
    tracks: [
      { id: "bass", name: "Bass" },
      { id: "drums", name: "Drums" },
    ],
  });
}

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "dawg-isolation-"));
  dirs.push(root);
  for (const dir of ["tracks/bass", "tracks/drums", "samples", "lib"])
    mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(
    join(root, "samples", "x.wav"),
    encodeWav24(makePcm(8000, 1, 8000)),
  );
  return root;
}

function host(root: string, value: TrackScore = score()): AgentHost {
  return {
    snapshot: () => ({
      score: value,
      revision: 1,
      focusedTrackId: "bass",
      recentOperations: [],
    }),
    commit: () => Promise.resolve({ revision: 2 }),
    workspace: { root, readRoots: [] },
    media: { runner: systemRunner },
  };
}

function call(
  target: AgentHost,
  name: string,
  args: Record<string, unknown>,
  turnState: TurnState = { untrusted: false },
): Promise<CallOutcome> {
  return executeCall(
    { id: `c-${name}`, name, arguments: JSON.stringify(args) },
    {
      tools: AGENT_TOOLS,
      host: target,
      newNoteId: (track) => `${track}-x`,
      turnState,
    },
  );
}

function diagnostic(outcome: CallOutcome): string {
  return outcome.ok ? "" : outcome.diagnostic;
}

function trustShell(root: string) {
  mkdirSync(join(root, ".dawg"), { recursive: true });
  writeFileSync(
    join(root, ".dawg", "agent.json"),
    JSON.stringify({ shell: true }),
  );
}

const shellWrite = ["sh", "-c", "echo 'export const pwned = 1' > lib/evil.ts"];

describe("untrusted turns and trusted exec", () => {
  test("trusted shell runs when the turn is clean", async () => {
    const root = project();
    trustShell(root);
    const outcome = await call(host(root), "exec", { argv: shellWrite });
    expect(outcome.ok).toBe(true);
    expect(existsSync(join(root, "lib/evil.ts"))).toBe(true);
  });

  test("after untrusted content, trusted shell is refused like code writes", async () => {
    const root = project();
    trustShell(root);
    const tainted: TurnState = { untrusted: true };
    const write = await call(
      host(root),
      "write_file",
      { path: "lib/a.ts", content: "x" },
      tainted,
    );
    expect(diagnostic(write)).toContain("untrusted content seen this turn");
    const exec = await call(host(root), "exec", { argv: shellWrite }, tainted);
    expect(exec.ok).toBe(false);
    expect(diagnostic(exec)).toContain("untrusted content seen this turn");
    expect(existsSync(join(root, "lib/evil.ts"))).toBe(false);
  });
});

describe("dispatch children", () => {
  test("a child's audio outputs stay inside its task scope", async () => {
    const root = project();
    const base = host(root);
    const scopes = buildScopes(
      parseTasks([{ id: "b", prompt: "x", tracks: ["bass"] }]),
      base.snapshot().score,
    );
    const child = scopedHost(base, scopes.get("b")!, "b", new CommitQueue());
    const escape = await call(child, "audio", {
      op: "fade",
      input: "samples/x.wav",
      fadeIn: "0.1s",
      output: "tracks/drums/samples/evil.wav",
    });
    expect(escape.ok).toBe(false);
    expect(diagnostic(escape)).toContain("outside the write scope");
    expect(existsSync(join(root, "tracks/drums/samples/evil.wav"))).toBe(false);
    expect(existsSync(join(root, "tracks/drums/samples/evil.chop.json"))).toBe(
      false,
    );
    const inside = await call(child, "audio", {
      op: "fade",
      input: "samples/x.wav",
      fadeIn: "0.1s",
      output: "tracks/bass/samples/ok.wav",
    });
    expect(inside.ok).toBe(true);
    expect(existsSync(join(root, "tracks/bass/samples/ok.wav"))).toBe(true);
    // Media writers that do not check each output stay with the parent.
    const analyze = await call(child, "analyze_audio", {
      file: "samples/x.wav",
    });
    expect(diagnostic(analyze)).toContain("not available in a dispatch task");
  });

  test("children dispatched after untrusted content start untrusted", async () => {
    const root = project();
    const outcomes: CallOutcome[] = [];
    const parent: AgentHost = {
      ...host(root),
      subagents: {
        concurrency: 1,
        runTurn: async (input) => {
          // A fresh turn, as every runner creates one.
          outcomes.push(
            await call(input.host, "write_file", {
              path: "lib/a.ts",
              content: "export const relayed = 1;\n",
            }),
          );
          return {
            type: "done",
            reason: "stop",
            text: "ok",
            applied: 0,
            rejected: 1,
            revision: 1,
          };
        },
      },
    };
    const dispatch = await call(
      parent,
      "dispatch",
      {
        tasks: [
          { id: "a", prompt: "write lib", tracks: [], files: ["lib/**"] },
        ],
      },
      { untrusted: true },
    );
    expect(dispatch.ok).toBe(true);
    expect(diagnostic(outcomes[0]!)).toContain(
      "untrusted content seen this turn",
    );
    expect(existsSync(join(root, "lib/a.ts"))).toBe(false);

    // The same task from a clean parent writes.
    outcomes.length = 0;
    await runSubagents(
      parseTasks([
        { id: "a", prompt: "write lib", tracks: [], files: ["lib/**"] },
      ]),
      {
        host: parent,
        runTurn: parent.subagents!.runTurn,
        toolNames: ["write_file"],
        concurrency: 1,
        signal: new AbortController().signal,
        spend: new SpendMeter(),
        callId: "p1",
      },
    );
    expect(outcomes[0]!.ok).toBe(true);
    expect(existsSync(join(root, "lib/a.ts"))).toBe(true);
  });
});

describe("dispatch scopes are disjoint by glob", () => {
  const refused = (tasks: unknown[]) =>
    expect(() => buildScopes(parseTasks(tasks), score())).toThrow(
      SubagentScopeError,
    );

  test("overlapping globs are refused", () => {
    refused([
      { id: "a", prompt: "x", tracks: ["Bass"] },
      { id: "b", prompt: "x", tracks: [], files: ["tracks/**"] },
    ]);
    refused([
      { id: "a", prompt: "x", tracks: [], global: true },
      { id: "b", prompt: "x", tracks: [], files: ["./song.ts"] },
    ]);
    refused([
      { id: "a", prompt: "x", tracks: [], files: ["lib/**"] },
      { id: "b", prompt: "x", tracks: [], files: ["lib/a.ts"] },
    ]);
    refused([
      { id: "a", prompt: "x", tracks: [], files: ["Samples/*.wav"] },
      { id: "b", prompt: "x", tracks: [], files: ["samples/kick.wav"] },
    ]);
  });

  test("disjoint globs still pass, normalized", () => {
    const scopes = buildScopes(
      parseTasks([
        { id: "a", prompt: "x", tracks: ["Bass"], files: ["./lib/a.ts"] },
        { id: "b", prompt: "x", tracks: ["Drums"], files: ["lib/b.ts"] },
        { id: "c", prompt: "x", tracks: [], files: ["samples/kick*.wav"] },
        { id: "d", prompt: "x", tracks: [], files: ["samples/snare*.wav"] },
      ]),
      score(),
    );
    expect(scopes.get("a")!.fileGlobs).toEqual(["tracks/bass/**", "lib/a.ts"]);
  });

  test("globsOverlap", () => {
    expect(globsOverlap("tracks/bass/**", "tracks/bassline/**")).toBe(false);
    expect(globsOverlap("lib/a", "lib/a.ts")).toBe(false);
    expect(globsOverlap("lib", "lib/a.ts")).toBe(true);
    expect(globsOverlap("lib/*.ts", "lib/x.ts")).toBe(true);
    expect(globsOverlap("notes/**", "song.ts")).toBe(false);
  });
});
