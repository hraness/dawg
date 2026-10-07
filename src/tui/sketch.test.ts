import { describe, expect, test } from "bun:test";

import {
  commandParam,
  envelopeSketch,
  filterSketch,
  positionSketch,
  sketchFor,
} from "./sketch.ts";
import { levelMeter } from "./audition.ts";

describe("row sketches", () => {
  test("the parameter comes from the row's command", () => {
    expect(commandParam("fx filter cutoff 800")).toBe("cutoff");
    expect(commandParam("synth attack 0.1")).toBe("attack");
    expect(commandParam("wt 0.5")).toBe("wt");
    expect(commandParam("volume")).toBeUndefined();
  });

  test("a low-pass falls off at its cutoff, a high-pass rises", () => {
    const low = filterSketch(20);
    expect(low).toHaveLength(16);
    expect(low.startsWith("▅▂▁")).toBe(true);
    expect(filterSketch(20_000).endsWith("▇▅")).toBe(true);
    expect(filterSketch(1000)).not.toBe(filterSketch(4000));
    expect(filterSketch(20_000, true).endsWith("▅")).toBe(true);
    expect(filterSketch(20, true).startsWith("▅▇")).toBe(true);
  });

  test("an envelope rises, holds sustain and releases", () => {
    const plucky = envelopeSketch(0, 0.1, 0, 0.05);
    const swell = envelopeSketch(1, 0.1, 0.8, 1);
    expect(plucky).toHaveLength(16);
    expect(swell[0]).not.toBe("█");
    expect(plucky[0]).toBe("█");
    expect(plucky.at(-1)).toBe("▁");
    expect(swell).not.toBe(plucky);
  });

  test("a position marks its place", () => {
    expect(positionSketch(0)).toBe("●" + "─".repeat(15));
    expect(positionSketch(1)).toBe("─".repeat(15) + "●");
  });

  test("sketchFor picks by parameter and reads sibling stages", () => {
    expect(sketchFor("fx filter cutoff 800", 800, () => undefined)).toBe(
      filterSketch(800),
    );
    expect(sketchFor("synth hpf 200", 200, () => undefined)).toBe(
      filterSketch(200, true),
    );
    const siblings: Record<string, number> = {
      attack: 0.5,
      sustain: 0.2,
      release: 0.3,
    };
    expect(sketchFor("synth decay 0.4", 0.4, (p) => siblings[p])).toBe(
      envelopeSketch(0.5, 0.4, 0.2, 0.3),
    );
    expect(sketchFor("volume 0.8", 0.8, () => undefined)).toBeUndefined();
    expect(sketchFor("fx filter cutoff 800", 800, () => undefined, "hpf")).toBe(
      filterSketch(800, true),
    );
    expect(
      sketchFor("fx filter cutoff 800", 800, () => undefined, "bpf"),
    ).toBeUndefined();
  });
});

describe("level meter", () => {
  test("shows RMS as a bar, the peak in dB and a clip mark", () => {
    const quiet = levelMeter({ rmsDb: -40, peakDb: -20.4, clipped: 0 });
    expect(quiet).toEndWith(" -20 dB");
    const hot = levelMeter({ rmsDb: -3, peakDb: 0, clipped: 12 });
    expect(hot).toContain("!");
    expect(quiet).not.toContain("!");
    expect(levelMeter({ rmsDb: -120, peakDb: -120, clipped: 0 })).toEndWith(
      "-∞ dB",
    );
  });
});
