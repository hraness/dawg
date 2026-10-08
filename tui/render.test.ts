import { expect, test } from "bun:test";
import {
  detectTerminalCapabilities,
  renderHighway,
  semanticColor,
  stripAnsi,
  type TrackScoreSnapshot,
} from "./render";

const score: TrackScoreSnapshot = {
  trackName: "bass",
  sessionId: "7F3A",
  revision: 42,
  bpm: 120,
  key: "Am",
  playing: true,
  transportBeat: 0,
  transportStartedAtMs: 0,
  notes: [
    { id: "hit", startBeat: 1, pitch: 64 },
    { id: "sustain", startBeat: 3, pitch: 80, durationBeats: 2 },
    { id: "pending", startBeat: 5, pitch: 40, pending: true },
  ],
};

test("capability fallbacks keep semantic colors deterministic", () => {
  expect(detectTerminalCapabilities({ TERM: "dumb" })).toEqual({
    colorDepth: "none",
    unicode: false,
    attributes: false,
  });
  expect(
    semanticColor("hit", "x", { colorDepth: "none", unicode: false }),
  ).toBe("x");
  expect(
    semanticColor("hit", "x", { colorDepth: "truecolor", unicode: true }),
  ).toContain("38;2;");
});

test("highway renders a bounded frame and hit line", () => {
  const frame = renderHighway(score, {
    width: 64,
    height: 14,
    clock: () => 0,
    capabilities: { colorDepth: "none", unicode: false },
  });
  const rows = frame.split("\n");
  expect(rows).toHaveLength(14);
  expect(rows.every((row) => stripAnsi(row).length === 64)).toBe(true);
  expect(frame).toContain("bass");
  expect(frame).toContain("-");
});

test("injected clock changes a hit flash while reduced motion freezes it", () => {
  const at0 = renderHighway(
    { ...score, transportBeat: 1 },
    {
      width: 64,
      height: 12,
      clock: () => 0,
      capabilities: { colorDepth: "none", unicode: false },
    },
  );
  const at100 = renderHighway(
    { ...score, transportBeat: 1 },
    {
      width: 64,
      height: 12,
      clock: () => 100,
      capabilities: { colorDepth: "none", unicode: false },
    },
  );
  expect(at0).not.toBe(at100);
  const frozenScore = { ...score, transportBeat: 1, playing: false };
  const frozen0 = renderHighway(frozenScore, {
    width: 64,
    height: 12,
    clock: () => 0,
    reducedMotion: true,
    capabilities: { colorDepth: "none", unicode: false },
  });
  const frozen100 = renderHighway(frozenScore, {
    width: 64,
    height: 12,
    clock: () => 100,
    reducedMotion: true,
    capabilities: { colorDepth: "none", unicode: false },
  });
  expect(frozen0).toBe(frozen100);
});

test("small viewports show a resize hint instead of clipping the highway", () => {
  const frame = renderHighway(score, {
    width: 18,
    height: 5,
    capabilities: { colorDepth: "none", unicode: false },
    clock: () => 0,
  });
  expect(frame).toContain("resize terminal");
});

test("detuned notes carry a compact cents tag while approaching", () => {
  const frame = stripAnsi(
    renderHighway(
      {
        ...score,
        notes: [
          { id: "flat", startBeat: 1, pitch: 64, cents: -14 },
          { id: "even", startBeat: 2, pitch: 67 },
        ],
      },
      {
        width: 64,
        height: 14,
        clock: () => 0,
        capabilities: { colorDepth: "none", unicode: true },
      },
    ),
  );
  expect(frame).toContain("−14");
  expect(frame).not.toContain("+0");
});

test("a 19-EDO track tags the pitch it is measured from and labels periods", () => {
  const frame = stripAnsi(
    renderHighway(
      {
        ...score,
        tuningPeriod: { size: 19, root: 60 },
        notes: [
          { id: "d", startBeat: 1, pitch: 64, cents: -47, centsFrom: "D" },
          { id: "c", startBeat: 2, pitch: 79, centsFrom: "C" },
        ],
      },
      {
        width: 64,
        height: 14,
        clock: () => 0,
        capabilities: { colorDepth: "none", unicode: true },
      },
    ),
  );
  expect(frame).toContain("D−47");
  // Key 79 is the 19-EDO octave above C4: labelled C5, not G5.
  expect(frame).toContain("C5");
  expect(frame).not.toContain("C6");
});
