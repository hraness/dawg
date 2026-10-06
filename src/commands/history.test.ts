import { describe, expect, test } from "bun:test";
import { historyTarget, REDO_KIND, UNDO_KIND } from "./history.ts";

type Event = { revision: number; kind: string; payload: unknown };

/** Simulate the session log: each append records the state it replaced. */
function harness() {
  const events: Event[] = [];
  let state = "s0";
  const append = (kind: string, next: string, extra = {}) => {
    events.push({
      revision: events.length + 1,
      kind,
      payload: { ...extra, before: state },
    });
    state = next;
  };
  return {
    events,
    get state() {
      return state;
    },
    edit: (next: string) => append("score.note", next),
    step: (direction: "undo" | "redo") => {
      const target = historyTarget(events, direction);
      if (!target) return false;
      append(
        direction === "undo" ? UNDO_KIND : REDO_KIND,
        target.composition as string,
      );
      return true;
    },
  };
}

describe("undo/redo history", () => {
  test("undo then redo restores states in order", () => {
    const h = harness();
    h.edit("s1");
    h.edit("s2");
    expect(h.step("redo")).toBe(false);
    expect(h.step("undo")).toBe(true);
    expect(h.state).toBe("s1");
    expect(h.step("undo")).toBe(true);
    expect(h.state).toBe("s0");
    expect(h.step("undo")).toBe(false);
    expect(h.step("redo")).toBe(true);
    expect(h.state).toBe("s1");
    expect(h.step("redo")).toBe(true);
    expect(h.state).toBe("s2");
    expect(h.step("redo")).toBe(false);
    expect(h.step("undo")).toBe(true);
    expect(h.state).toBe("s1");
  });

  test("a new edit clears the redo stack", () => {
    const h = harness();
    h.edit("s1");
    h.edit("s2");
    h.step("undo");
    h.edit("s3");
    expect(h.step("redo")).toBe(false);
    h.step("undo");
    expect(h.state).toBe("s1");
  });

  test("events without before are ignored", () => {
    const h = harness();
    h.edit("s1");
    h.events.push({
      revision: 99,
      kind: "transport",
      payload: { action: "play" },
    });
    expect(historyTarget(h.events, "undo")).toEqual({
      revision: 1,
      composition: "s0",
    });
  });

  test("legacy undo events without a redo stack still undo once", () => {
    const events: Event[] = [
      { revision: 1, kind: "score.note", payload: { before: "a" } },
      { revision: 2, kind: "score.note", payload: { before: "b" } },
      { revision: 3, kind: UNDO_KIND, payload: { before: "c" } },
    ];
    expect(historyTarget(events, "undo")?.composition).toBe("a");
    expect(historyTarget(events, "redo")?.composition).toBe("c");
  });
});
