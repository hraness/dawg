import { describe, expect, test } from "bun:test";
import { drumLaneProjection, type TrackScoreSnapshot } from "./highway.ts";
import {
  paintPianoRoll,
  pianoRollFirstBeat,
  type PianoRollOptions,
} from "./piano-roll.ts";
import { CellBuffer, encodeBuffer } from "./screen.ts";
import { getTheme, type TerminalCapabilities } from "./theme.ts";

const ascii: TerminalCapabilities = {
  unicode: false,
  colorDepth: "none",
  attributes: false,
};
const unicode: TerminalCapabilities = {
  unicode: true,
  colorDepth: "truecolor",
};
const score: TrackScoreSnapshot = {
  trackId: "lead",
  trackName: "Lead",
  revision: 7,
  loopBeats: 128,
  notes: [
    { id: "low", startBeat: 0, durationBeats: 2, pitch: 60 },
    { id: "high", startBeat: 4, durationBeats: 3, pitch: 72, pending: true },
  ],
};

function frame(
  width = 80,
  height = 24,
  snapshot = score,
  options: Partial<PianoRollOptions> = {},
) {
  const buffer = new CellBuffer(width, height);
  const layout = paintPianoRoll(
    buffer,
    { x: 0, y: 0, width, height },
    snapshot,
    { theme: getTheme("mono"), capabilities: ascii, firstBeat: 0, ...options },
  );
  return { buffer, layout, lines: buffer.lines() };
}

function laneRow(out: ReturnType<typeof frame>, pitch: number): number {
  const lane = out.layout.projection.laneOf({ startBeat: 0, pitch })!;
  return out.layout.gridY + out.layout.firstLane + out.layout.rows - lane - 1;
}

describe("horizontal piano roll", () => {
  for (const [width, height] of [
    [80, 24],
    [120, 40],
  ] as const) {
    test(`time spans horizontally and pitch rises vertically at ${width}x${height}`, () => {
      const out = frame(width, height, score, { columnsPerBeat: 2 });
      const low = laneRow(out, 60),
        high = laneRow(out, 72);
      expect(high).toBeLessThan(low);
      expect(out.buffer.get(out.layout.gridX, low)?.ch).toBe("o");
      expect(out.buffer.get(out.layout.gridX + 3, low)?.ch).toBe("=");
      expect(out.buffer.get(out.layout.gridX + 8, high)?.ch).toBe("o");
      expect(out.buffer.get(out.layout.gridX + 13, high)?.ch).toBe("=");
      expect(out.lines[low]).toContain("C4");
      expect(out.lines[high]).toContain("C5");
      expect(out.lines).toHaveLength(height);
      expect(out.lines.every((line) => line.length === width)).toBe(true);
    });
  }

  test("a note crossing both viewport edges retains its full visible sustain", () => {
    const out = frame(
      80,
      24,
      { notes: [{ startBeat: 0, durationBeats: 96, pitch: 60 }] },
      { firstBeat: 12, columnsPerBeat: 2 },
    );
    const row = laneRow(out, 60);
    expect(out.buffer.get(out.layout.gridX, row)?.ch).toBe("<");
    expect(
      out.buffer.get(out.layout.gridX + out.layout.columns - 1, row)?.ch,
    ).toBe(">");
    expect(out.lines[row]!.slice(out.layout.gridX + 1, -1)).toMatch(/^=+$/);
  });

  test("pending written notes remain distinct from actual old audible notes", () => {
    const out = frame(80, 24, score, {
      audibleRevision: 5,
      audibleNotes: [{ startBeat: 2, durationBeats: 1, pitch: 60 }],
    });
    expect(out.lines[1]).toContain("written r7 | audible r5");
    expect(out.buffer.get(out.layout.gridX, laneRow(out, 60))?.ch).toBe("o");
    expect(out.buffer.get(out.layout.gridX + 8, laneRow(out, 60))?.ch).toBe(
      "#",
    );
    expect(
      out.buffer.get(out.layout.gridX + 8, laneRow(out, 60))?.style,
    ).not.toEqual(out.buffer.get(out.layout.gridX, laneRow(out, 60))?.style);
  });

  test("unknown audio is not inferred ready from the existence of notes", () => {
    const unknown = frame();
    expect(unknown.lines[1]).toContain("audio unknown");
    expect(
      unknown.buffer.get(unknown.layout.gridX, laneRow(unknown, 60))?.ch,
    ).toBe("o");
    const absent = frame(80, 24, score, {
      audibleRevision: null,
      status: "Waiting for vocal asset",
    });
    expect(absent.lines[1]).toContain("not yet audible");
    expect(absent.lines[1]).toContain("Waiting for vocal asset");
  });

  test("only the matching audible revision uses solid notes; explicit pending wins", () => {
    const out = frame(80, 24, score, { audibleRevision: 7 });
    expect(out.buffer.get(out.layout.gridX, laneRow(out, 60))?.ch).toBe("#");
    expect(out.buffer.get(out.layout.gridX + 16, laneRow(out, 72))?.ch).toBe(
      "o",
    );
  });

  test("kit and sample projections retain named lanes in declared order", () => {
    const out = frame(80, 24, {
      notes: [
        { startBeat: 1, lane: 0 },
        { startBeat: 2, lane: 1 },
      ],
      projection: drumLaneProjection(["kick", "vocal chop", "closed hat"]),
    });
    expect(out.lines[out.layout.gridY]).toContain("kick");
    expect(out.lines[out.layout.gridY + 1]).toContain("vocal chop");
    expect(out.buffer.get(out.layout.gridX + 4, out.layout.gridY)?.ch).toBe(
      "o",
    );
    expect(out.buffer.get(out.layout.gridX + 8, out.layout.gridY + 1)?.ch).toBe(
      "o",
    );
  });

  test("writing follows horizontally across a resize; explicit inspection stays put", () => {
    for (const width of [80, 120, 37]) {
      const out = frame(width, 24, score, {
        firstBeat: undefined,
        beat: 0,
        writingBeat: 100,
      });
      expect(out.layout.firstBeat).toBeGreaterThan(0);
      expect(out.layout.firstBeat).toBeLessThanOrEqual(100);
      expect(out.layout.endBeat).toBeGreaterThan(100);
      const at =
        out.layout.gridX +
        Math.floor((100 - out.layout.firstBeat) * out.layout.columnsPerBeat);
      expect(out.buffer.get(at, out.layout.rulerY)?.ch).toBe("w");
    }
    expect(
      pianoRollFirstBeat(score, 60, { firstBeat: 12, writingBeat: 100 }),
    ).toBe(12);
    expect(pianoRollFirstBeat(score, 60, { firstBeat: -4 })).toBe(0);
    expect(pianoRollFirstBeat(score, 60, { firstBeat: Infinity })).toBe(0);
    expect(
      pianoRollFirstBeat(score, 60, { writingBeat: 128 }) + 15,
    ).toBeGreaterThan(128);
  });

  test("playhead and writing cursor keep note bodies and stay distinct in mono", () => {
    const out = frame(80, 24, score, { beat: 1, writingBeat: 5 });
    expect(out.buffer.get(out.layout.gridX + 4, out.layout.rulerY)?.ch).toBe(
      "v",
    );
    expect(out.buffer.get(out.layout.gridX + 20, out.layout.rulerY)?.ch).toBe(
      "w",
    );
    expect(out.buffer.get(out.layout.gridX + 4, laneRow(out, 60))?.ch).toBe(
      "=",
    );
    expect(
      out.buffer.get(out.layout.gridX + 4, laneRow(out, 60))?.style?.reverse,
    ).toBe(true);
  });

  test("lyrics, audio spans and sections share the time axis without claiming asset readiness", () => {
    const out = frame(
      80,
      24,
      {
        trackName: "Voice",
        vocal: true,
        notes: [{ startBeat: 1, durationBeats: 2, pitch: 60, lyric: "hello" }],
        clips: [
          { id: "take1", startBeat: 0, durationBeats: 8, text: "verse take" },
        ],
      },
      {
        sections: [{ name: "verse", startBeat: 0, durationBeats: 8 }],
        status: "Vocal rendering",
      },
    );
    expect(out.lines[2]).toContain("verse");
    expect(out.lines[out.layout.lyricY!]).toContain("hello");
    expect(out.lines[out.layout.clipY!]).toContain("[verse take");
    expect(out.lines[1]).toContain("audio unknown | Vocal rendering");
  });

  test("meter changes label actual bar boundaries", () => {
    const out = frame(
      80,
      24,
      { notes: [], barBeats: [0, 3, 6, 10], loopBeats: 14 },
      { columnsPerBeat: 2 },
    );
    expect(out.buffer.get(out.layout.gridX + 6, out.layout.rulerY)?.ch).toBe(
      "2",
    );
    expect(out.buffer.get(out.layout.gridX + 12, out.layout.rulerY)?.ch).toBe(
      "3",
    );
    expect(out.buffer.get(out.layout.gridX + 20, out.layout.rulerY)?.ch).toBe(
      "4",
    );
  });

  test("ASCII/no-color works with non-ASCII names and the unicode variant retains the theme", () => {
    const mono = frame(
      80,
      24,
      { ...score, trackName: "Voix été 🎵" },
      { pinned: true },
    );
    const encoded = encodeBuffer(mono.buffer, ascii);
    expect(encoded).not.toContain("\x1b");
    expect(/^[\x20-\x7e\n]*$/.test(encoded)).toBe(true);
    expect(mono.lines[0]).toContain("PINNED");
    const color = frame(80, 24, score, {
      theme: getTheme("default"),
      capabilities: unicode,
    });
    expect(color.lines.join("\n")).toContain("○");
    expect(
      color.buffer.get(color.layout.gridX, laneRow(color, 60))?.style?.fg,
    ).toBeDefined();
  });

  test("painter clips to its panel and handles tiny terminal sizes", () => {
    const buffer = new CellBuffer(80, 24);
    buffer.fill(0, 0, 80, 24, {}, "X");
    paintPianoRoll(buffer, { x: 3, y: 2, width: 42, height: 12 }, score, {
      theme: getTheme("mono"),
      capabilities: ascii,
    });
    for (let y = 0; y < 24; y++)
      for (let x = 0; x < 80; x++)
        if (x < 3 || x >= 45 || y < 2 || y >= 14)
          expect(buffer.get(x, y)?.ch).toBe("X");
    for (const [width, height] of [
      [0, 0],
      [1, 1],
      [18, 5],
    ])
      expect(() => frame(width, height)).not.toThrow();
  });

  test("empty and malformed display notes do not mutate snapshots or hang a frame", () => {
    const empty = frame(80, 24, { notes: [] });
    expect(empty.lines.join("\n")).toContain("Waiting for notes");
    const snapshot = {
      notes: [
        { startBeat: NaN, pitch: 60 },
        { startBeat: 0, durationBeats: 1e30, pitch: 60 },
      ],
    };
    const before = JSON.stringify(snapshot);
    expect(() => frame(80, 24, snapshot)).not.toThrow();
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
