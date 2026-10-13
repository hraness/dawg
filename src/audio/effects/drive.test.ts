import { expect, test } from "bun:test";
import { createScore } from "../../../core/score.ts";
import { applyDistort } from "./drive.ts";

test("held drive automation is byte-identical to a fixed drive for every curve", () => {
  const sampleRate = 22_050;
  const context = {
    sampleRate,
    tempoBpm: 120,
    samplesPerTick: sampleRate / 960,
  };
  const source = Float64Array.from(
    { length: 8192 },
    (_, index) => 0.4 * Math.sin(index * 0.051) + 0.1 * Math.cos(index * 0.137),
  );
  const curves = [
    "soft",
    "hard",
    "cubic",
    "diode",
    "asym",
    "fold",
    "sinefold",
    "chebyshev",
    "scurve",
    "shape",
  ] as const;
  for (const type of curves) {
    const base = createScore({
      tracks: [
        {
          id: "t",
          instrument: "sine",
          fx: {
            distort: { type, drive: 3.5, tone: 6500, mix: 0.65, postgain: 0.9 },
          },
        },
      ],
    }).tracks[0]!;
    const held = createScore({
      tracks: [
        {
          ...base,
          fxAutomation: {
            "distort-drive": [
              { tick: 0, value: 3.5 },
              { tick: 960, value: 3.5 },
            ],
          },
        },
      ],
    }).tracks[0]!;
    const expected = source.slice();
    const actual = source.slice();
    applyDistort(expected, base, base.fx!.distort!, context);
    applyDistort(actual, held, held.fx!.distort!, context);
    expect(actual).toEqual(expected);
  }
});
