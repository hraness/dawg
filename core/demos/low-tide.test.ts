import { describe, expect, test } from "bun:test";
import { createDemo } from "./index.ts";

const BAR = 1920;
const TPB = 480;
const score = createDemo("low-tide");
const notes = (id: string) => score.notes.filter((n) => n.trackId === id);
const bar = (tick: number) => Math.floor(tick / BAR);
const beat = (tick: number) => (tick % BAR) / TPB;

describe("Low Tide", () => {
  test("the kick leaves the dub room for four bars after it has entered", () => {
    const kicks = notes("kick").map((n) => bar(n.startTick));
    expect(kicks.some((b) => b < 24)).toBe(true);
    expect(kicks.some((b) => b >= 24 && b < 28)).toBe(false);
    expect(kicks.some((b) => b === 28)).toBe(true);
  });

  test("the muted horn answers only where the voice rests through the verses", () => {
    const reply = score.tracks.find((t) => t.id === "reply");
    expect(reply?.wind?.preset).toBe("harmon");
    const verse = (b: number) => (b >= 8 && b < 16) || (b >= 32 && b < 40);
    const sung = notes("vocal").filter((n) => verse(bar(n.startTick)));
    const blown = notes("reply").filter((n) => verse(bar(n.startTick)));
    expect(sung.length).toBeGreaterThan(30);
    expect(blown.length).toBeGreaterThan(24);
    // The voice owns the even bars and the horn the odd ones; either may
    // pick up from the last half beat of the other's bar, and the horn may
    // land on the voice's downbeat as long as it is gone before the voice.
    const pickup = (n: { startTick: number }) => beat(n.startTick) >= 3.5;
    const landing = (n: { startTick: number; durationTicks: number }) =>
      n.startTick % BAR === 0 && n.durationTicks <= TPB / 2;
    for (const n of sung)
      expect(bar(n.startTick) % 2 === 0 || pickup(n)).toBe(true);
    for (const n of blown)
      expect(bar(n.startTick) % 2 === 1 || pickup(n) || landing(n)).toBe(true);
    // No sung syllable starts while the horn is sounding.
    for (const h of blown)
      for (const v of sung)
        expect(
          v.startTick >= h.startTick &&
            v.startTick < h.startTick + h.durationTicks,
        ).toBe(false);
    // The pickups exist: "I" before bar 12 and the horn's F5 before bar 39.
    expect(sung.some((n) => bar(n.startTick) === 11 && pickup(n))).toBe(true);
    expect(
      blown.some((n) => bar(n.startTick) === 38 && pickup(n) && n.pitch === 77),
    ).toBe(true);
  });

  test("the refrain sings the title four times and stutters its first line", () => {
    const tides = notes("vocal").filter(
      (n) =>
        n.lyric === "tide" && bar(n.startTick) >= 16 && bar(n.startTick) < 24,
    );
    expect(tides.length).toBe(4);
    // The second hook is a third up and reaches C5 inside the first refrain.
    expect(tides.some((n) => bar(n.startTick) === 20 && n.pitch === 68)).toBe(
      true,
    );
    expect(
      notes("vocal").some(
        (n) => bar(n.startTick) === 20 && n.pitch === 72 && n.lyric === "low",
      ),
    ).toBe(true);
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

  test("the Rhodes leaves the third to the singer at every cadence", () => {
    const keys = score.tracks.find((t) => t.id === "keys");
    for (const cadence of [14, 22, 38, 46]) {
      const two = cadence * BAR + 2 * TPB;
      // No B3 or C4 from the Rhodes is still written past beat two...
      const ringing = notes("keys").filter(
        (n) =>
          (n.pitch === 59 || n.pitch === 60) &&
          n.startTick < two + 10 &&
          n.startTick + n.durationTicks > two + 10,
      );
      expect(ringing).toHaveLength(0);
      // ...and the pedal lifts there so the released note stops.
      expect(
        keys?.pedal?.some(
          (p) => p.state === "up" && p.tick <= two && p.tick >= two - 60,
        ),
      ).toBe(true);
    }
    // The voice lands B3 on "turns" at the two sung cadences.
    for (const cadence of [22, 46])
      expect(
        notes("vocal").some(
          (n) =>
            n.lyric === "turns" &&
            n.pitch === 59 &&
            n.startTick === cadence * BAR + 2 * TPB,
        ),
      ).toBe(true);
  });

  test("the drum bed is crushed and sweeps down into the last refrain", () => {
    const drums = score.tracks.find((t) => t.id === "drums");
    expect(drums?.fx?.crush?.bits).toBe(9);
    const lane = drums?.fxAutomation?.["crush-bits"] ?? [];
    expect(lane.some((p) => p.value <= 4)).toBe(true);
    expect(lane.some((p) => p.tick === 40 * BAR && p.value === 9)).toBe(true);
  });

  test("the ratchet fill stays in C harmonic minor", () => {
    const scale = new Set([0, 2, 3, 5, 7, 8, 11]);
    const knocks = notes("tape").filter((n) => bar(n.startTick) === 39);
    expect(knocks.length).toBe(8);
    for (const n of knocks) expect(scale.has(n.pitch % 12)).toBe(true);
  });

  test("the bass walks down by half steps from C3 under the second verse", () => {
    const roots = [32, 33, 34, 35, 36].map(
      (b) => notes("bass").find((n) => n.startTick === b * BAR)?.pitch,
    );
    expect(roots).toEqual([48, 47, 46, 45, 44]);
  });

  test("the song ends on a last exchange between horn and vibes", () => {
    expect(score.sections.at(-1)).toMatchObject({ startBar: 52, bars: 2 });
    expect(
      notes("reply").some((n) => n.startTick === 52 * BAR && n.pitch === 72),
    ).toBe(true);
    const tag = notes("vibes")
      .filter((n) => bar(n.startTick) === 53)
      .map((n) => n.pitch);
    expect(tag).toEqual([79, 75, 74, 72]);
    for (const n of score.notes)
      expect(n.startTick + n.durationTicks).toBeLessThanOrEqual(54 * BAR);
  });
});
