import { describe, expect, test } from "bun:test";
import {
  LYRIC_ZOOM_HINT,
  lyricStrip,
  paintHighway,
  type NoteSnapshot,
  type TrackScoreSnapshot,
} from "./highway.ts";
import { CellBuffer } from "./screen.ts";
import { effectiveTheme, type TerminalCapabilities } from "./theme.ts";

const UNICODE: TerminalCapabilities = { colorDepth: "none", unicode: true };
const ASCII: TerminalCapabilities = { colorDepth: "none", unicode: false };

function frame(snapshot: TrackScoreSnapshot, caps: TerminalCapabilities) {
  const theme = effectiveTheme("mono", caps);
  const buffer = new CellBuffer(80, 24, theme.roles.canvas);
  const layout = paintHighway(
    buffer,
    { x: 0, y: 0, width: 80, height: 24 },
    snapshot,
    0,
    { theme, capabilities: caps, lookaheadBeats: 8 },
  );
  const rows: string[] = [];
  for (let y = 0; y < 24; y += 1) {
    let text = "";
    for (let x = 0; x < 80; x += 1) text += buffer.get(x, y)?.ch ?? " ";
    rows.push(text.trimEnd());
  }
  return { rows, layout };
}

const words: NoteSnapshot[] = [
  { startBeat: 0, durationBeats: 2, pitch: 60, lyric: "hel-" },
  { startBeat: 2, durationBeats: 2, pitch: 62, lyric: "lo" },
  { startBeat: 4, durationBeats: 1, pitch: 64, lyric: "_" },
  { startBeat: 5, durationBeats: 2, pitch: 65, lyric: "world" },
];

describe("lyric strip", () => {
  for (const [name, caps, hold] of [
    ["unicode", UNICODE, "‿"],
    ["ascii", ASCII, "_"],
  ] as const)
    test(`one row under the hit line at 80x24 (${name}, NO_COLOR mono)`, () => {
      const { rows, layout } = frame(
        { notes: words, loopBeats: 16, playing: false },
        caps,
      );
      const strip = rows[layout.hitRow + 1]!;
      expect(strip).toContain("hel-");
      expect(strip).toContain("lo");
      expect(strip).toContain(hold);
      expect(strip).toContain("world");
      expect(strip.indexOf("hel-")).toBeLessThan(strip.indexOf("lo"));
      expect(strip.indexOf("lo")).toBeLessThan(strip.indexOf("world"));
      // No inline lyric tags beside the heads any more.
      for (const row of rows.slice(0, layout.hitRow))
        expect(row).not.toContain("world");
      if (caps.unicode === false)
        for (const row of rows) expect(/^[\x20-\x7e]*$/.test(row)).toBe(true);
    });

  test("no strip row without lyrics", () => {
    const plain = words.map(({ lyric: _lyric, ...note }) => note);
    const a = frame({ notes: plain, loopBeats: 16, playing: false }, UNICODE);
    const b = frame({ notes: words, loopBeats: 16, playing: false }, UNICODE);
    expect(a.rows[a.layout.hitRow + 1]).not.toBe(b.rows[b.layout.hitRow + 1]);
    expect(a.rows[a.layout.hitRow + 1]).not.toMatch(/[a-z]/);
  });

  test("cuts to the note width minus one and drops a trailing dash", () => {
    const at = { beat: 0, loop: undefined, width: 40, colsPerBeat: 4 };
    const { cells } = lyricStrip(
      [
        { startBeat: 0, durationBeats: 1, lyric: "beautiful" },
        { startBeat: 1, durationBeats: 1, lyric: "won-" },
        { startBeat: 2, durationBeats: 4, lyric: "der-" },
        { startBeat: 6, durationBeats: 1, lyric: "ful" },
      ],
      { ...at, ascii: false },
    );
    expect(cells.map((c) => [c.x, c.text])).toEqual([
      [0, "be…"],
      [4, "won"],
      [8, "der-"],
      [24, "ful"],
    ]);
    const ascii = lyricStrip(
      [{ startBeat: 0, durationBeats: 1, lyric: "beautiful" }],
      { ...at, ascii: true },
    );
    expect(ascii.cells[0]!.text).toBe("be.");
  });

  test("a chord sings its top note; the now syllable is marked", () => {
    const { cells } = lyricStrip(
      [
        { startBeat: 0, durationBeats: 2, pitch: 55, lyric: "_" },
        { startBeat: 0, durationBeats: 2, pitch: 67, lyric: "ah" },
      ],
      { beat: 0.5, loop: undefined, width: 20, colsPerBeat: 2, ascii: false },
    );
    expect(cells).toEqual([{ x: 0, text: "ah", now: true, muted: false }]);
  });

  test("too dense: word-initial syllables only and a zoom hint", () => {
    const notes: NoteSnapshot[] = [];
    for (let i = 0; i < 40; i += 1)
      notes.push({
        startBeat: i / 4,
        durationBeats: 0.25,
        lyric: i % 2 === 0 ? "ba-" : "na",
      });
    const out = lyricStrip(notes, {
      beat: 0,
      loop: undefined,
      width: 40,
      colsPerBeat: 4,
      ascii: false,
    });
    expect(out.dense).toBe(true);
    expect(out.cells.some((c) => c.text === "na")).toBe(false);
    expect(out.cells.at(-1)!.text).toBe(LYRIC_ZOOM_HINT);
  });
});
