import { describe, expect, test } from "bun:test";
import { diffRewind, IDENTITY_REWIND } from "../session/delta.ts";
import { historyTarget, REDO_KIND, UNDO_KIND } from "./history.ts";

type Event = {
  revision: number;
  kind: string;
  rewind?: ReturnType<typeof diffRewind>;
};

/** Simulate the session log: each append records how to rewind it. */
function harness() {
  const events: Event[] = [];
  let state: unknown = "s0";
  const append = (kind: string, next: unknown) => {
    events.push({
      revision: events.length + 1,
      kind,
      rewind: diffRewind(state, next),
    });
    state = next;
  };
  return {
    events,
    get state() {
      return state;
    },
    edit: (next: unknown) => append("score.note", next),
    step: (direction: "undo" | "redo") => {
      const target = historyTarget(state, events, direction);
      if (!target) return false;
      append(direction === "undo" ? UNDO_KIND : REDO_KIND, target.composition);
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

  test("events that did not change the composition are ignored", () => {
    const h = harness();
    h.edit("s1");
    h.events.push({ revision: 2, kind: "transport", rewind: IDENTITY_REWIND });
    h.events.push({
      revision: 3,
      kind: "transport",
      rewind: diffRewind("s1", "s1"),
    });
    expect(historyTarget(h.state, h.events, "undo")).toEqual({
      revision: 1,
      composition: "s0",
    });
  });

  test("structured compositions rewind through nested edits", () => {
    const h = harness();
    const base = { tempoBpm: 120, notes: [{ id: "a", pitch: 60 }] };
    h.edit(base);
    h.edit({ ...base, notes: [...base.notes, { id: "b", pitch: 64 }] });
    h.edit({ tempoBpm: 90, notes: [{ id: "b", pitch: 64 }] });
    expect(h.step("undo")).toBe(true);
    expect(h.state).toEqual({
      tempoBpm: 120,
      notes: [
        { id: "a", pitch: 60 },
        { id: "b", pitch: 64 },
      ],
    });
    expect(h.step("undo")).toBe(true);
    expect(h.state).toEqual(base);
    expect(h.step("redo")).toBe(true);
    expect(h.step("redo")).toBe(true);
    expect(h.state).toEqual({ tempoBpm: 90, notes: [{ id: "b", pitch: 64 }] });
  });

  test("a compacted edit ends the reachable history", () => {
    const events: Event[] = [
      { revision: 1, kind: "score.note" },
      { revision: 2, kind: "score.note", rewind: diffRewind("b", "c") },
      { revision: 3, kind: UNDO_KIND, rewind: diffRewind("c", "b") },
    ];
    // The undo at rev 3 popped rev 2; rev 1 has no rewind, so nothing is left.
    expect(historyTarget("b", events, "undo")).toBeUndefined();
    expect(historyTarget("b", events, "redo")?.composition).toBe("c");
  });
});
