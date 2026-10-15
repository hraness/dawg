import { describe, expect, test } from "bun:test";
import { generateStyle } from "./generate.ts";

/** One role's notes from a 16-bar song at a fixed seed. */
function roleNotes(id: string, role: string) {
  const { plan, data } = generateStyle(id, { seed: 7, bars: 16 });
  const notes = (data.notes ?? []).filter(
    (note) => plan.noteRoles.get(note.id) === role,
  );
  return { plan, notes };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe("style feel: how the generated parts are played", () => {
  test("played comping varies its touch and sits off the grid", () => {
    for (const id of ["neo-soul", "jazz", "motown"]) {
      const { plan, notes } = roleNotes(id, "chords");
      expect(notes.length).toBeGreaterThan(20);
      const levels = new Set(
        notes.map((note) => Math.round((note.velocity ?? 0) * 127)),
      );
      expect(levels.size).toBeGreaterThan(10);
      const onGrid = notes.filter(
        (note) => (note.startTick ?? 0) % plan.stepTicks === 0,
      ).length;
      expect(onGrid / notes.length).toBeLessThan(0.5);
    }
  });

  test("sequenced comping (no timing humanise) stays on the grid", () => {
    for (const id of ["techno", "deep-house"]) {
      const { plan, notes } = roleNotes(id, "chords");
      expect(notes.length).toBeGreaterThan(0);
      for (const note of notes)
        expect((note.startTick ?? 0) % plan.stepTicks).toBe(0);
    }
  });

  test("ghost snares sit well under the backbeat", () => {
    // Recorded drummers play ghosts at about 25-50 of 127 against a
    // 100-115 backbeat. Pooled over styles and seeds so card tuning that
    // moves a single ghost cannot break it.
    const backbeat: number[] = [];
    const ghosts: number[] = [];
    for (const id of ["funk", "neo-soul", "motown", "blues", "indie-rock"])
      for (const seed of [1, 2, 3, 7]) {
        const { plan, data } = generateStyle(id, { seed, bars: 16 });
        const beat = plan.barTicks / plan.beatsPerBar;
        for (const note of data.notes ?? []) {
          if (plan.noteRoles.get(note.id) !== "snare") continue;
          const inBar = (note.startTick ?? 0) % plan.barTicks;
          // The last beat of a bar can hold a fill, which builds instead.
          if (inBar > plan.barTicks - beat * 1.1) continue;
          const beats = inBar / beat;
          const onBeat = Math.abs(beats - Math.round(beats)) < 0.15;
          (onBeat ? backbeat : ghosts).push(note.velocity ?? 0);
        }
      }
    expect(backbeat.length).toBeGreaterThan(40);
    expect(ghosts.length).toBeGreaterThan(4);
    expect(mean(ghosts)).toBeLessThan(mean(backbeat) * 0.5);
  });
});
