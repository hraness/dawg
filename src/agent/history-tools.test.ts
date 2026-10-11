import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createScore, type TrackScore } from "../../core/score.ts";
import { HistoryDb } from "../history/db.ts";
import type {
  CommentContext,
  HistoryHandle,
  HistoryRow,
} from "../history/types.ts";
import {
  executeCall,
  runAgentTurn,
  type AgentHost,
  type AgentTurnResult,
} from "./agent.ts";
import { createGatewayClient } from "./gateway.ts";
import {
  autoCommentText,
  formatHistoryPage,
  historyBriefSection,
  HISTORY_TOOL_LIMITS,
  newTurnLedger,
} from "./history-tools.ts";
import {
  finishChunk,
  scriptedFetch,
  textChunk,
  toolCallChunks,
} from "./sse-fixtures.ts";
import { AGENT_TOOLS } from "./tools.ts";

const SESSION = "s-test";
const CONTEXT: CommentContext = {
  pane: "A",
  view: { screen: "patch" },
  focus: {
    trackId: "bass",
    trackName: "Bass",
    instrument: "bass",
    param: "cutoff",
  },
  playhead: { beat: 32, bar: 9, beatInBar: 1, label: "9.1" },
  loop: { fromBeat: 32, toBeat: 64, label: "9.1–17.1" },
  transport: { playing: true, recording: false, bpm: 120 },
  rev: 10,
};

let dir: string;
let db: HistoryDb;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dawg-agent-history-"));
  db = HistoryDb.open(dir);
});
afterEach(async () => {
  db.close();
  await rm(dir, { recursive: true, force: true });
});

/** A host whose commits land as edit rows, like the session record does. */
function host(initial?: TrackScore) {
  const state = {
    score:
      initial ??
      createScore({
        bars: 16,
        tracks: [
          { id: "bass", name: "Bass", instrument: "bass" },
          { id: "drums", name: "Drums", instrument: "kit" },
        ],
      }),
    revision: 10,
  };
  const history: HistoryHandle = {
    append(event) {
      const row = db.append({
        ...event,
        sessionId: SESSION,
        atRev: state.revision,
      });
      return { id: row.id, done: Promise.resolve(row) };
    },
    query: (filter) => db.query({ sessionId: SESSION, ...filter }),
    context: () => ({ ...CONTEXT, rev: state.revision }),
  };
  const agentHost: AgentHost = {
    snapshot: () => ({
      score: state.score,
      revision: state.revision,
      focusedTrackId: "bass",
      recentOperations: [],
    }),
    commit: (change) => {
      state.score = change.next;
      state.revision += 1;
      db.append({
        sessionId: SESSION,
        kind: "edit",
        rev: state.revision,
        atRev: state.revision - 1,
        actor: { kind: "agent" },
        summary: change.summary,
        ops: change.operations,
      });
      return Promise.resolve({ revision: state.revision });
    },
    history,
  };
  return { state, host: agentHost, history };
}

function client(turns: Parameters<typeof scriptedFetch>[0]) {
  return createGatewayClient({
    apiKey: "k",
    baseUrl: "https://gw.test/v1",
    fetcher: scriptedFetch(turns).fetcher,
  });
}

const addBass = (id: string) =>
  toolCallChunks(0, id, "add_notes", {
    trackId: "bass",
    notes: [{ pitch: 40, start: 0, duration: 1 }],
  });

function comments(): readonly HistoryRow[] {
  return db.query({ sessionId: SESSION, kinds: ["comment"] }).rows;
}

describe("agent comments", () => {
  test("an editing turn without comment ends with an #auto comment on its edit", async () => {
    const { host: agentHost } = host();
    const result = await runAgentTurn({
      prompt: "a bass note",
      model: "opus-5.5",
      turnId: "turn-1",
      client: client([
        [...addBass("c1"), finishChunk("tool_calls")],
        [
          textChunk("Added a low E on beat 1 of the bass."),
          finishChunk("stop"),
        ],
      ]),
      host: agentHost,
    });
    expect(result.type).toBe("done");
    const [comment] = comments();
    expect(comment).toBeDefined();
    expect(comment!.sub).toBe("auto");
    expect(comment!.tags).toContain("auto");
    expect(comment!.actor.kind).toBe("agent");
    expect(comment!.body).toBe("Added a low E on beat 1 of the bass.");
    const edit = db.query({ sessionId: SESSION, kinds: ["edit"] }).rows[0]!;
    expect(comment!.parentId).toBe(edit.id);
    expect(comment!.context?.focus?.trackId).toBe("bass");
    expect(comment!.context?.playhead?.label).toBe("9.1");
    expect(comment!.context?.loop?.label).toBe("9.1–17.1");
    expect(comment!.context?.view?.screen).toBe("patch");
    expect(comment!.context?.rev).toBe(11);
    expect(
      comment!.targets.some((t) => t.type === "track" && t.key === "bass"),
    ).toBe(true);
    // The turn row closes the turn, after the comment.
    const turn = db.query({ sessionId: SESSION, kinds: ["turn"] }).rows[0]!;
    expect(turn.id).toBe("turn-1");
    expect(turn.seq).toBeGreaterThan(comment!.seq);
  });

  test("a turn that calls comment gets no fallback; the comment links its edit", async () => {
    const { host: agentHost } = host();
    await runAgentTurn({
      prompt: "a bass note",
      model: "opus-5.5",
      turnId: "turn-2",
      client: client([
        [...addBass("c1"), finishChunk("tool_calls")],
        [
          ...toolCallChunks(0, "c2", "comment", {
            text: "Root on the downbeat to anchor the loop #bass",
          }),
          finishChunk("tool_calls"),
        ],
        [textChunk("done"), finishChunk("stop")],
      ]),
      host: agentHost,
    });
    const rows = comments();
    expect(rows.length).toBe(1);
    expect(rows[0]!.sub).not.toBe("auto");
    expect(rows[0]!.tags).toContain("bass");
    const edit = db.query({ sessionId: SESSION, kinds: ["edit"] }).rows[0]!;
    expect(rows[0]!.parentId).toBe(edit.id);
    expect((rows[0]!.payload as { turnId?: string }).turnId).toBe("turn-2");
  });

  test("a turn that only reads leaves no comment", async () => {
    const { host: agentHost } = host();
    await runAgentTurn({
      prompt: "what is here",
      model: "opus-5.5",
      client: client([[textChunk("Two tracks."), finishChunk("stop")]]),
      host: agentHost,
    });
    expect(comments()).toEqual([]);
  });

  test("a human edit during a read-only call is not credited to the agent", async () => {
    const { state, host: agentHost, history } = host();
    // The human commits while history_query runs: the revision rises but
    // the agent changed nothing, so no #auto comment (design §3.4).
    const query = history.query;
    const moving: AgentHost = {
      ...agentHost,
      history: {
        ...history,
        query: (filter) => {
          state.revision += 1;
          return query(filter);
        },
      },
    };
    const result = await runAgentTurn({
      prompt: "any notes for me?",
      model: "opus-5.5",
      turnId: "t1",
      client: client([
        [
          ...toolCallChunks(0, "q1", "history_query", { kind: ["comment"] }),
          finishChunk("tool_calls"),
        ],
        [textChunk("No comments yet; nothing to change."), finishChunk("stop")],
      ]),
      host: moving,
    });
    expect(result.type).toBe("done");
    expect(state.revision).toBeGreaterThan(10);
    expect(comments()).toEqual([]);
  });

  const childDone: AgentTurnResult = {
    type: "done",
    reason: "stop",
    text: "ok",
    applied: 1,
    rejected: 0,
    revision: 0,
  };

  async function dispatchTurn(childComments: boolean) {
    const { host: agentHost } = host();
    return runAgentTurn({
      prompt: "bass and drums",
      model: "opus-5.5",
      turnId: "turn-d",
      client: client([
        [
          ...toolCallChunks(0, "d1", "dispatch", {
            tasks: [
              { id: "low", prompt: "bass", tracks: ["bass"] },
              { id: "kit", prompt: "drums", tracks: ["drums"] },
            ],
          }),
          finishChunk("tool_calls"),
        ],
        [textChunk("Bass and drums are in."), finishChunk("stop")],
      ]),
      host: {
        ...agentHost,
        subagents: {
          concurrency: 1,
          runTurn: async (input) => {
            const track = input.prompt.includes("subagent low")
              ? "bass"
              : "drums";
            await executeCall(
              {
                id: `${track}-add`,
                name: "add_notes",
                arguments: JSON.stringify({
                  trackId: track,
                  notes: [{ pitch: 40, start: 0, duration: 1 }],
                }),
              },
              {
                tools: AGENT_TOOLS,
                host: input.host,
                newNoteId: (id, _rev, index) => `${id}-${index}`,
                ...(input.turnId ? { turnId: input.turnId } : {}),
              },
            );
            if (childComments)
              await executeCall(
                {
                  id: `${track}-note`,
                  name: "comment",
                  arguments: JSON.stringify({ text: `${track} in #groove` }),
                },
                {
                  tools: AGENT_TOOLS,
                  host: input.host,
                  newNoteId: (id, _rev, index) => `${id}-${index}`,
                  ...(input.turnId ? { turnId: input.turnId } : {}),
                },
              );
            return childDone;
          },
        },
      },
    });
  }

  test("subagent comments suppress the parent's #auto fallback", async () => {
    await dispatchTurn(true);
    const rows = comments();
    expect(rows.length).toBe(2);
    expect(rows.every((row) => row.sub !== "auto")).toBe(true);
    expect(rows.every((row) => row.actor.kind === "subagent")).toBe(true);
  });

  test("subagent edits without comments get one parent #auto comment", async () => {
    await dispatchTurn(false);
    const rows = comments();
    expect(rows.length).toBe(1);
    expect(rows[0]!.sub).toBe("auto");
    expect(rows[0]!.body).toBe("Bass and drums are in.");
  });

  test("autoCommentText clips and falls back to edit summaries", () => {
    const ledger = newTurnLedger();
    expect(autoCommentText(ledger, "hi")).toBeUndefined();
    ledger.edits.push("add 1 note to bass");
    expect(autoCommentText(ledger, "")).toBe("add 1 note to bass");
    const long = autoCommentText(ledger, "x".repeat(1000))!;
    expect(long.length).toBe(HISTORY_TOOL_LIMITS.autoCommentChars);
    ledger.commented = true;
    expect(autoCommentText(ledger, "hi")).toBeUndefined();
  });

  test("comment refuses bad about and empty text", () => {
    const tool = AGENT_TOOLS.find((t) => t.name === "comment")!;
    const ctx = {
      score: createScore({}),
      focusedTrackId: "x",
      revision: 1,
      newNoteId: () => "n",
    };
    expect(() => tool.plan({ text: " " }, ctx)).toThrow("text");
    expect(() => tool.plan({ text: "a", about: "yesterday" }, ctx)).toThrow(
      "about",
    );
  });
});

describe("history_query", () => {
  async function query(args: Record<string, unknown>, score: TrackScore) {
    const { history } = host(score);
    const tool = AGENT_TOOLS.find((t) => t.name === "history_query")!;
    const plan = tool.plan(args, {
      score,
      focusedTrackId: "bass",
      revision: 1,
      newNoteId: () => "n",
    });
    if (plan.kind !== "action") throw new Error(plan.kind);
    return (await plan.run({ history })).content;
  }

  test("filters by track name, kind and tag; pages with before", async () => {
    const score = createScore({
      tracks: [
        { id: "bass", name: "Low End", instrument: "bass" },
        { id: "drums", name: "Drums", instrument: "kit" },
      ],
    });
    for (let index = 0; index < 30; index += 1)
      db.append({
        sessionId: SESSION,
        kind: index % 3 === 0 ? "comment" : "edit",
        atRev: index,
        ...(index % 3 === 0 ? {} : { rev: index + 1 }),
        actor: { kind: index % 3 === 0 ? "human" : "agent" },
        summary: `row ${index}`,
        targets: [
          {
            type: "track",
            key: index % 2 ? "bass" : "drums",
            trackId: index % 2 ? "bass" : "drums",
          },
        ],
        tags: index === 3 ? ["love"] : [],
      });
    const first = await query({}, score);
    expect(first.split("\n").length).toBe(HISTORY_TOOL_LIMITS.defaultRows + 1);
    expect(first).toContain("row 29");
    const next = Number(/next: before=(\d+)/.exec(first)![1]);
    const second = await query({ before: next }, score);
    expect(second).toContain("row 0");
    expect(second).not.toContain("row 29");
    const lowEnd = await query({ track: "low end", kind: ["comment"] }, score);
    for (const line of lowEnd.split("\n").filter((l) => !l.startsWith("next")))
      expect(line).toMatch(/row (3|9|15|21|27)\b/);
    expect(await query({ tag: "#love" }, score)).toContain("row 3");
    expect(await query({ grep: "zzqx" }, score)).toBe("no history rows match");
  });

  test("show returns one row in full; bad args fail fast", async () => {
    const score = createScore({});
    const row = db.append({
      sessionId: SESSION,
      kind: "comment",
      atRev: 1,
      actor: { kind: "human" },
      summary: "love this part",
      body: "love this part",
      context: CONTEXT,
    });
    const detail = await query({ show: String(row.seq) }, score);
    expect(detail).toContain("love this part");
    expect(detail).toContain("9.1");
    await expect(query({ show: "999999" }, score)).rejects.toThrow(
      "no history row",
    );
    await expect(query({ bars: "nine" }, score)).rejects.toThrow("bars");
    await expect(query({ kind: ["nope"] }, score)).rejects.toThrow("kind");
  });

  test("history off: a clear error, not a crash", async () => {
    const tool = AGENT_TOOLS.find((t) => t.name === "history_query")!;
    const plan = tool.plan(
      {},
      {
        score: createScore({}),
        focusedTrackId: "x",
        revision: 1,
        newNoteId: () => "n",
      },
    );
    if (plan.kind !== "action") throw new Error(plan.kind);
    await expect(plan.run({})).rejects.toThrow("history is off");
  });

  test("every page stays within 6 KiB", () => {
    const score = createScore({});
    const rows = Array.from({ length: 100 }, (_, index) =>
      db.append({
        sessionId: SESSION,
        kind: "comment",
        atRev: index,
        actor: { kind: "human" },
        summary: "y".repeat(500),
      }),
    ).reverse();
    const page = formatHistoryPage(rows, undefined, score);
    expect(Buffer.byteLength(page)).toBeLessThanOrEqual(
      HISTORY_TOOL_LIMITS.maxResultBytes,
    );
    expect(page).toMatch(/next: before=\d+$/);
  });
});

describe("brief section", () => {
  test("names the live context and the human's newest comments within budget", () => {
    const { history } = host();
    db.append({
      sessionId: SESSION,
      kind: "comment",
      atRev: 1,
      actor: { kind: "human" },
      summary: "the chorus bass is perfect",
    });
    const text = historyBriefSection(history)!;
    expect(text).toContain("focus Bass/cutoff");
    expect(text).toContain("playhead 9.1");
    expect(text).toContain("chorus bass is perfect");
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(
      HISTORY_TOOL_LIMITS.briefBytes,
    );
    expect(historyBriefSection(undefined)).toBeUndefined();
  });
});
