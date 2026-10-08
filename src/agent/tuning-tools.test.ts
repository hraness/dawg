import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  applyScoreOperation,
  createScore,
  type TrackScore,
} from "../../core/score.ts";
import { AGENT_TOOLS, type ScorePlan, type ToolContext } from "./tools.ts";
import { tuningCommandsFor } from "./tuning-tools.ts";
import { compositionBrief } from "./brief.ts";

const tool = (name: string) => AGENT_TOOLS.find((t) => t.name === name)!;

function context(score: TrackScore): ToolContext {
  return {
    score,
    focusedTrackId: "keys",
    revision: 1,
    newNoteId: (trackId, index) => `${trackId}-${index}`,
  };
}

const score = createScore({
  key: "D minor",
  tracks: [
    { id: "keys", instrument: "piano" },
    { id: "bass", instrument: "bass" },
  ],
});

function apply(base: TrackScore, plan: ScorePlan): TrackScore {
  let next = base;
  for (const operation of plan.operations)
    next = applyScoreOperation(next, operation);
  return next;
}

describe("tuning tools", () => {
  test("set_tuning maps arguments to the /tuning grammar", () => {
    expect(tuningCommandsFor({ name: "19-edo", ref: 432 })).toEqual([
      "tuning 19-edo",
      "tuning ref 432",
    ]);
    expect(
      tuningCommandsFor({ target: "track", ratios: ["9/8", "5/4", "2/1"] }),
    ).toEqual(["tuning track ratios 9/8 5/4 2/1"]);
    expect(tuningCommandsFor({ target: "track", off: true })).toEqual([
      "tuning track off",
    ]);
    expect(() => tuningCommandsFor({ name: "just", edo: 19 })).toThrow(
      "give one of",
    );
    expect(() => tuningCommandsFor({})).toThrow("give a tuning");
  });

  test("set_tuning sets the song tuning and a track's own", () => {
    const plan = tool("set_tuning").plan(
      { name: "pelog", root: "D4" },
      context(score),
    );
    expect(plan.kind).toBe("score");
    let next = apply(score, plan as ScorePlan);
    expect(next.tuning?.name).toBe("pelog");
    expect(next.tuning?.root).toBe(62);
    const track = tool("set_tuning").plan(
      { target: "track", trackId: "bass", edo: 31 },
      context(next),
    );
    next = apply(next, track as ScorePlan);
    expect(next.tracks.find((t) => t.id === "bass")?.tuning?.edo).toBe(31);
    expect(() =>
      tool("set_tuning").plan({ name: "no-such-tuning" }, context(score)),
    ).toThrow();
  });

  test("set_tuning reads Scala files from the project", async () => {
    const root = await mkdtemp(join(tmpdir(), "dawg-tuning-tool-"));
    try {
      await mkdir(join(root, "tunings"));
      await writeFile(
        join(root, "tunings", "five.scl"),
        "! five.scl\nfive-note test\n 5\n!\n 200.\n 400.\n 700.\n 900.\n 2/1\n",
      );
      const plan = tool("set_tuning").plan(
        { scl: "tunings/five.scl" },
        context(score),
      );
      expect(plan.kind).toBe("prepare");
      if (plan.kind !== "prepare") return;
      const ready = await plan.run({ workspace: { root } });
      const next = apply(score, ready);
      expect(next.tuning?.scl).toBe("tunings/five.scl");
      const missing = tool("set_tuning").plan(
        { scl: "tunings/none.scl" },
        context(score),
      );
      if (missing.kind !== "prepare") throw new Error("expected prepare");
      await expect(missing.run({ workspace: { root } })).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("set_scale keeps the tonic or takes a new one", () => {
    let next = apply(
      score,
      tool("set_scale").plan({ scale: "hijaz" }, context(score)) as ScorePlan,
    );
    expect(next.key).toBe("D hijaz");
    next = apply(
      next,
      tool("set_scale").plan(
        { tonic: "C", scale: "yaman" },
        context(next),
      ) as ScorePlan,
    );
    expect(next.key).toBe("C yaman");
    expect(() =>
      tool("set_scale").plan({ scale: "nope" }, context(score)),
    ).toThrow();
  });

  test("add_notes carries note cents", () => {
    const plan = tool("add_notes").plan(
      { notes: [{ pitch: "E4", start: 0, duration: 1, cents: -14 }] },
      context(score),
    ) as ScorePlan;
    const next = apply(score, plan);
    expect(next.notes[0]?.cents).toBe(-14);
  });
});

describe("tunings in the agent's view", () => {
  test("update_notes detunes and 0 clears; the brief shows tuning and cents", () => {
    const base = createScore({
      key: "C major",
      tuning: { edo: 19 },
      tracks: [{ id: "keys", instrument: "piano", tuning: { name: "just" } }],
      notes: [
        {
          id: "n1",
          trackId: "keys",
          startTick: 0,
          durationTicks: 480,
          pitch: 64,
          velocity: 0.8,
        },
      ],
    });
    const detuned = apply(
      base,
      tool("update_notes").plan(
        { updates: [{ noteId: "n1", cents: -14 }] },
        context(base),
      ) as ScorePlan,
    );
    expect(detuned.notes[0]!.cents).toBe(-14);
    const brief = JSON.parse(
      compositionBrief({ score: detuned, revision: 1, focusedTrackId: "keys" }),
    ) as {
      tuning: { summary: string; steps: number; linear?: boolean };
      tracks: { tuning?: { summary: string } }[];
      focusedNotes: { columns: string[]; rows: unknown[][] };
    };
    expect(brief.tuning).toEqual({
      summary: "19-edo",
      steps: 19,
      linear: true,
    });
    expect(brief.tracks[0]!.tuning?.summary).toBe("just");
    expect(brief.focusedNotes.columns.at(-1)).toBe("cents");
    expect(brief.focusedNotes.rows[0]!.at(-1)).toBe(-14);
    const cleared = apply(
      detuned,
      tool("update_notes").plan(
        { updates: [{ noteId: "n1", cents: 0 }] },
        context(detuned),
      ) as ScorePlan,
    );
    expect(cleared.notes[0]!.cents).toBeUndefined();
    const plain = JSON.parse(
      compositionBrief({ score: cleared, revision: 1, focusedTrackId: "keys" }),
    ) as { focusedNotes: { columns: string[] } };
    expect(plain.focusedNotes.columns).not.toContain("cents");
  });
});
