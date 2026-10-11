/**
 * A dispatch child's commit reaches history as the subagent's edit, not the
 * parent agent's: the host's session event keeps the task id and the parent
 * dispatch call (design §6.1), and the history row's actor is the subagent.
 */
import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import { sessionEventRow } from "../history/record.ts";
import type { SessionEvent } from "../session/store.ts";
import { agentCommitEvent, type AgentCommit } from "./agent.ts";

const score = createScore();
const change = (extra: Partial<AgentCommit> = {}): AgentCommit => ({
  next: score,
  operations: [],
  baseRevision: 3,
  toolName: "add_notes",
  callId: "call_1",
  summary: "[drums] +4 drums notes",
  ...extra,
});

function row(c: AgentCommit) {
  const made = agentCommitEvent(c);
  const event: SessionEvent = {
    id: "ev1",
    revision: 4,
    kind: made.kind,
    payload: made.payload,
    at: new Date(0).toISOString(),
    actor: { actorId: "a_parent", clientId: "c1" },
  };
  return sessionEventRow("s1", event, undefined, undefined, "local");
}

describe("subagent commits in history", () => {
  test("a child's commit is recorded as the subagent, with its task and parent call", () => {
    const made = agentCommitEvent(
      change({ subagent: "drums", parentCallId: "call_0" }),
    );
    expect(made.payload).toMatchObject({
      tool: "add_notes",
      subagent: "drums",
      task: "drums",
      parentCallId: "call_0",
    });
    const r = row(change({ subagent: "drums", parentCallId: "call_0" }));
    expect(r.actor.kind).toBe("subagent");
    expect(r.actor.actorId).toBe("drums");
  });

  test("the parent agent's own commit stays the agent's", () => {
    const made = agentCommitEvent(change({ summary: "+1 note" }));
    expect(made.payload).not.toHaveProperty("subagent");
    expect(made.payload).not.toHaveProperty("parentCallId");
    const r = row(change({ summary: "+1 note" }));
    expect(r.actor.kind).toBe("agent");
    expect(r.actor.actorId).toBe("a_parent");
  });
});
