import { describe, expect, test } from "bun:test";
import { createDemo } from "./index.ts";

const BAR = 1920;
const TPB = 480;
const score = createDemo("low-tide");
const notes = (id: string) => score.notes.filter((n) => n.trackId === id);
const bar = (tick: number) => Math.floor(tick / BAR);

describe("Low Tide", () => {
  test("the kick leaves the dub room for four bars after it has entered", () => {
    const kicks = notes("kick").map((n) => bar(n.startTick));
    expect(kicks.some((b) => b < 24)).toBe(true);
    expect(kicks.some((b) => b >= 24 && b < 28)).toBe(false);
    expect(kicks.some((b) => b === 28)).toBe(true);
  });

  test("the muted horn answers only in the voice's rests through the verses", () => {
    const reply = score.tracks.find((t) => t.id === "reply");
    expect(reply?.wind?.preset).toBe("harmon");
    const verse = (b: number) => (b >= 8 && b < 16) || (b >= 32 && b < 40);
    const sung = notes("vocal").filter((n) => verse(bar(n.startTick)));
    const blown = notes("reply").filter((n) => verse(bar(n.startTick)));
    expect(sung.length).toBeGreaterThan(30);
    expect(blown.length).toBeGreaterThan(24);
    for (const n of sung) expect(bar(n.startTick) % 2).toBe(0);
    for (const n of blown) expect(bar(n.startTick) % 2).toBe(1);
  });

  test("the refrain's first line stutters its last syllable", () => {
    for (const start of [16, 40]) {
      const cuts = notes("vocal").filter(
        (n) =>
          bar(n.startTick) === start &&
          n.lyric === "_" &&
          n.durationTicks <= TPB / 8,
      );
      expect(cuts.length).toBeGreaterThanOrEqual(4);
    }
  });

  test("the strings hold a 4-3 over each cadence and let it down to B", () => {
    for (const cadence of [22, 46, 50]) {
      const edge = cadence * BAR;
      const held = notes("strings").find(
        (n) =>
          n.pitch === 72 &&
          n.startTick < edge &&
          n.startTick + n.durationTicks >= edge + 2 * TPB - 40,
      );
      expect(held).toBeDefined();
      const fall = notes("strings").find(
        (n) => n.pitch === 71 && Math.abs(n.startTick - (edge + 2 * TPB)) <= 20,
      );
      expect(fall).toBeDefined();
    }
  });

  test("the drum bed is crushed and sweeps down into the last refrain", () => {
    const drums = score.tracks.find((t) => t.id === "drums");
    expect(drums?.fx?.crush?.bits).toBe(9);
    const lane = drums?.fxAutomation?.["crush-bits"] ?? [];
    expect(lane.some((p) => p.value <= 4)).toBe(true);
    expect(lane.some((p) => p.tick === 40 * BAR && p.value === 9)).toBe(true);
  });

  test("the bass walks down by half steps under the second verse", () => {
    const roots = [32, 33, 34, 35, 36].map(
      (b) => notes("bass").find((n) => n.startTick === b * BAR)?.pitch,
    );
    expect(roots).toEqual([36, 47, 46, 45, 44]);
  });
});
