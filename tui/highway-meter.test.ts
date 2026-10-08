import { expect, test } from "bun:test";
import { CellBuffer } from "./screen.ts";
import { paintHighway, type TrackScoreSnapshot } from "./highway.ts";
import { effectiveTheme, type TerminalCapabilities } from "./theme.ts";

const TRUECOLOR: TerminalCapabilities = {
  colorDepth: "truecolor",
  unicode: true,
};
const theme = effectiveTheme("default", TRUECOLOR);

/** Gutter labels (bar numbers) from the bottom of the highway up. */
function barLabels(score: TrackScoreSnapshot): string[] {
  const buffer = new CellBuffer(60, 40, theme.roles.canvas);
  const layout = paintHighway(
    buffer,
    { x: 0, y: 0, width: 60, height: 40 },
    score,
    0,
    { theme, capabilities: TRUECOLOR, lookaheadBeats: 16 },
  );
  const labels: string[] = [];
  for (let y = layout.hitRow - 1; y >= 0; y -= 1) {
    let text = "";
    for (let x = 0; x < layout.gutter - 1; x += 1)
      text += buffer.get(x, y)?.ch ?? " ";
    if (text.trim()) labels.push(text.trim());
  }
  return labels;
}

const note = { startBeat: 0, durationBeats: 1, pitch: 60 };

test("a fixed meter numbers a bar every beatsPerBar beats", () => {
  const labels = barLabels({
    notes: [note],
    beatsPerBar: 4,
    loopBeats: 32,
  });
  expect(labels.slice(0, 3)).toEqual(["2", "3", "4"]);
});

test("meter changes move the bar lines, including half-beat starts", () => {
  // 4/4, then 7/8 (3.5 beats) from bar 2, then 3/4 from bar 4.
  const barBeats = [0, 4, 7.5, 11, 14, 17];
  const labels = barLabels({
    notes: [note],
    beatsPerBar: 4,
    barBeats,
    loopBeats: 20,
  });
  expect(labels.slice(0, 4)).toEqual(["2", "3", "4", "5"]);
});
