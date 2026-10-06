import { expect, test } from "bun:test";
import { drumSnapshotFields } from "./drums.ts";
import { renderHighway, stripAnsi } from "./render.ts";

test("drum tracks stream by voice lane with a legend", () => {
  const notes = [
    { startBeat: 0, pitch: 36 },
    { startBeat: 0, pitch: 46 },
  ];
  expect(drumSnapshotFields("piano", notes)).toEqual({});
  const fields = drumSnapshotFields("kit", notes);
  expect(fields.laneCount).toBe(7);
  expect(fields.notes?.map((note) => note.lane)).toEqual([0, 6]);
  const frame = stripAnsi(
    renderHighway(
      { notes: [], transportBeat: 4, playing: false, ...fields },
      {
        width: 72,
        height: 14,
        clock: () => 0,
        capabilities: { colorDepth: "none", unicode: false },
      },
    ),
  );
  expect(frame).toContain("kick");
  expect(frame).toContain("snare");
  expect(frame).toContain("open");
});
