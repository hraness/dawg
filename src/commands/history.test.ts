import { describe, expect, test } from "bun:test";
import { diffRewind, IDENTITY_REWIND } from "../session/delta.ts";
import {
  addNote,
  applyScoreOperation,
  createScore,
  scoreFromJSON,
} from "../../core/score.ts";
import {
  historyReceipt,
  paneHistoryStep,
  historyTarget,
  REDO_KIND,
  UNDO_KIND,
} from "./history.ts";

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

describe("history receipts", () => {
  test("undo and redo name the musical change", () => {
    const base = createScore({
      tracks: [
        { id: "bass", name: "bass", instrument: "bass" },
        { id: "lead", name: "lead", instrument: "piano" },
      ],
    });
    const added = addNote(base, {
      id: "n",
      trackId: "bass",
      startTick: 0,
      durationTicks: 480,
      pitch: 48,
      velocity: 0.8,
    });
    expect(historyReceipt("undo", added, base, 3)).toBe(
      "undid · −1 note on bass (C3)",
    );
    expect(historyReceipt("redo", base, added, 3)).toBe(
      "redid · +1 note on bass (C3)",
    );
    expect(historyReceipt("undo", base, base, 7)).toBe("undid · rev 7");
  });
});

describe("per-pane undo (design §12.6)", () => {
  /** A two-pane log over real scores; every append is authored. */
  function panes() {
    const events: {
      revision: number;
      kind: string;
      payload: Record<string, unknown>;
      actor: { clientId: string };
      rewind: ReturnType<typeof diffRewind>;
    }[] = [];
    let score = createScore({
      tracks: [
        { id: "bass", name: "bass", instrument: "sine" },
        { id: "drums", name: "drums", instrument: "sine" },
      ],
    });
    const append = (
      clientId: string,
      kind: string,
      next: typeof score,
      payload: Record<string, unknown> = {},
    ) => {
      events.push({
        revision: events.length + 1,
        kind,
        payload,
        actor: { clientId },
        rewind: diffRewind(score.toJSON(), next.toJSON()),
      });
      score = next;
    };
    const volume = (id: string) =>
      score.tracks.find((track) => track.id === id)!.volume;
    return {
      events,
      volume,
      get score() {
        return score;
      },
      set(clientId: string, trackId: string, value: number) {
        append(
          clientId,
          "score.edit",
          applyScoreOperation(score, {
            type: "updateTrack",
            trackId,
            patch: { volume: value },
          }),
        );
      },
      pan(clientId: string, trackId: string, value: number) {
        append(
          clientId,
          "score.edit",
          applyScoreOperation(score, {
            type: "updateTrack",
            trackId,
            patch: { pan: value },
          }),
        );
      },
      step(clientId: string, direction: "undo" | "redo") {
        const step = paneHistoryStep(
          score.toJSON(),
          events,
          direction,
          clientId,
        );
        if (step?.ok)
          append(
            clientId,
            direction === "undo" ? UNDO_KIND : REDO_KIND,
            step.next,
            {
              [direction === "undo" ? "undoneRevision" : "redoneRevision"]:
                step.revision,
              scope: "pane",
            },
          );
        return step;
      },
      all(clientId: string, direction: "undo" | "redo") {
        const target = historyTarget(score.toJSON(), events, direction);
        if (!target) return false;
        append(
          clientId,
          direction === "undo" ? UNDO_KIND : REDO_KIND,
          scoreFromJSON(target.composition),
          {
            [direction === "undo" ? "undoneRevision" : "redoneRevision"]:
              target.revision,
          },
        );
        return true;
      },
    };
  }

  test("A undoes its own edit and keeps B's later, unrelated edit", () => {
    const h = panes();
    h.set("A", "bass", 0.3);
    h.set("B", "drums", 0.6);
    expect(h.step("A", "undo")).toMatchObject({ ok: true, revision: 1 });
    expect(h.volume("bass")).toBe(1);
    expect(h.volume("drums")).toBe(0.6);
    expect(h.step("A", "undo")).toBeUndefined();
    expect(h.step("A", "redo")).toMatchObject({ ok: true });
    expect(h.volume("bass")).toBe(0.3);
    expect(h.volume("drums")).toBe(0.6);
    // B's own stack is untouched by A's steps.
    expect(h.step("B", "undo")).toMatchObject({ ok: true, revision: 2 });
    expect(h.volume("drums")).toBe(1);
    expect(h.volume("bass")).toBe(0.3);
  });

  test("two panes on one track: different properties undo independently", () => {
    const h = panes();
    h.set("A", "bass", 0.3);
    h.pan("B", "bass", -0.4);
    expect(h.step("A", "undo")).toMatchObject({ ok: true });
    const bass = h.score.tracks.find((track) => track.id === "bass")!;
    expect(bass.volume).toBe(1);
    expect(bass.pan).toBe(-0.4);
  });

  test("refuses when another pane changed the same property since", () => {
    const h = panes();
    h.set("A", "bass", 0.3);
    h.set("B", "bass", 0.5);
    const step = h.step("A", "undo");
    expect(step).toMatchObject({
      ok: false,
      reason: "bass volume changed",
      others: ["B"],
    });
    expect(h.volume("bass")).toBe(0.5);
  });

  test("undo all is global and its receipt target is the newest edit", () => {
    const h = panes();
    h.set("A", "bass", 0.3);
    h.set("B", "drums", 0.6);
    expect(h.all("A", "undo")).toBe(true);
    expect(h.volume("drums")).toBe(1);
    expect(h.volume("bass")).toBe(0.3);
    expect(h.all("A", "undo")).toBe(true);
    expect(h.volume("bass")).toBe(1);
    expect(h.all("A", "redo")).toBe(true);
    expect(h.volume("bass")).toBe(0.3);
  });

  test("a pane undo is an edit in the global history", () => {
    const h = panes();
    h.set("A", "bass", 0.3);
    h.set("B", "drums", 0.6);
    h.step("A", "undo");
    expect(h.volume("bass")).toBe(1);
    // undo all steps back the newest event: A's undo.
    expect(h.all("B", "undo")).toBe(true);
    expect(h.volume("bass")).toBe(0.3);
    expect(h.volume("drums")).toBe(0.6);
  });

  test("a single pane sees the same history as undo all", () => {
    const h = panes();
    h.set("A", "bass", 0.3);
    h.set("A", "bass", 0.5);
    h.set("A", "drums", 0.2);
    h.step("A", "undo");
    h.step("A", "undo");
    expect([h.volume("bass"), h.volume("drums")]).toEqual([0.3, 1]);
    h.step("A", "redo");
    expect(h.volume("bass")).toBe(0.5);
    h.set("A", "drums", 0.9);
    expect(h.step("A", "redo")).toBeUndefined();
    h.step("A", "undo");
    h.step("A", "undo");
    h.step("A", "undo");
    expect([h.volume("bass"), h.volume("drums")]).toEqual([1, 1]);
  });
});
