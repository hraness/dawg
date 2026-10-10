/**
 * The four knobs (tui/knobs.ts): one table of colours, glyphs and meanings,
 * the ↑↓ / ←→ reducer every screen shares, and a strip that keeps every
 * cue under NO_COLOR and the mono theme. Also the header's position labels
 * (design §8.2): bar.beat, the loop range and the pane count.
 */
import { describe, expect, test } from "bun:test";
import {
  firstKnob,
  knobGlyph,
  knobKey,
  KNOBS,
  knobStripText,
  knobStyle,
  nextKnob,
  paintKnobStrip,
  type KnobSlot,
  type KnobSlots,
  type KnobState,
} from "./knobs.ts";
import { paintDrawer } from "./drawer.ts";
import { CellBuffer } from "./screen.ts";
import { displayWidth } from "./text.ts";
import { getTheme, type SemanticRole } from "./theme.ts";
import {
  barBeatLabel,
  footerStatus,
  loopRangeLabel,
  paneLabel,
  type AppView,
} from "./app.ts";

const UP = "\u001b[A";
const DOWN = "\u001b[B";
const RIGHT = "\u001b[C";
const LEFT = "\u001b[D";
const SHIFT_RIGHT = "\u001b[1;2C";

function slot(label: string, value = 0.5): KnobSlot {
  return {
    label,
    text: String(value),
    position: value,
    turn: (direction, coarse) =>
      `${label} ${Math.round((value + direction * (coarse ? 0.25 : 0.05)) * 100) / 100}`,
    reset: `${label} default`,
  };
}

describe("the knob table", () => {
  test("blue moves, green sizes, white shapes, orange level", () => {
    expect(KNOBS.map((k) => [k.colour, k.meaning, k.glyph])).toEqual([
      ["blue", "moves", "●"],
      ["green", "sizes", "▲"],
      ["white", "shapes", "■"],
      ["orange", "level", "◆"],
    ]);
  });

  test("glyphs are distinct and one cell wide, with ASCII stand-ins", () => {
    expect(new Set(KNOBS.map((k) => k.glyph)).size).toBe(4);
    expect(new Set(KNOBS.map((k) => k.ascii)).size).toBe(4);
    for (const knob of KNOBS) {
      expect(displayWidth(knob.glyph)).toBe(1);
      expect(knobGlyph(knob.index, false)).toMatch(/^[\x21-\x7e]$/);
    }
  });

  test("coloured themes give each knob its own hue, used by no other role", () => {
    for (const name of ["default", "high-contrast"] as const) {
      const theme = getTheme(name);
      const hues = KNOBS.map((k) =>
        JSON.stringify(knobStyle(k.index, theme).fg),
      );
      expect(new Set(hues).size, name).toBe(4);
      const others = (Object.keys(theme.roles) as SemanticRole[])
        .filter((role) => !role.startsWith("knob"))
        .map((role) => theme.roles[role].fg)
        .filter(Boolean)
        .map((fg) => JSON.stringify(fg));
      for (const hue of hues)
        expect(others, `${name} ${hue}`).not.toContain(hue);
    }
  });

  test("the mono theme has no hue: the glyph is the only cue", () => {
    const mono = getTheme("mono");
    for (const knob of KNOBS)
      expect(knobStyle(knob.index, mono).fg).toBeUndefined();
  });
});

describe("the knob reducer", () => {
  const slots: KnobSlots = [
    slot("wave"),
    undefined,
    slot("cutoff"),
    slot("mix"),
  ];

  test("↑↓ picks a knob, wrapping and skipping empty slots", () => {
    const state: KnobState = { selected: 0 };
    expect(knobKey(state, slots, DOWN)).toEqual({ type: "handled" });
    expect(state.selected).toBe(2);
    knobKey(state, slots, DOWN);
    expect(state.selected).toBe(3);
    knobKey(state, slots, DOWN);
    expect(state.selected).toBe(0);
    knobKey(state, slots, UP);
    expect(state.selected).toBe(3);
    expect(nextKnob(1, 1, () => false)).toBe(1);
    expect(firstKnob([undefined, undefined, slot("a"), undefined])).toBe(2);
  });

  test("←→ turns, shift turns coarse, x resets, enter opens: each a command", () => {
    const state: KnobState = { selected: 2 };
    expect(knobKey(state, slots, RIGHT)).toEqual({
      type: "run",
      command: "cutoff 0.55",
    });
    expect(knobKey(state, slots, LEFT)).toEqual({
      type: "run",
      command: "cutoff 0.45",
    });
    expect(knobKey(state, slots, SHIFT_RIGHT)).toEqual({
      type: "run",
      command: "cutoff 0.75",
    });
    expect(knobKey(state, slots, "x")).toEqual({
      type: "run",
      command: "cutoff default",
    });
    expect(knobKey(state, slots, "\r")).toEqual({ type: "open", knob: 2 });
    expect(knobKey(state, slots, "q")).toEqual({ type: "pass" });
  });

  test("a selection on an empty slot moves to the first knob", () => {
    const state: KnobState = { selected: 1 };
    knobKey(state, slots, RIGHT);
    expect(state.selected).toBe(0);
  });
});

describe("the knob strip", () => {
  const slots: KnobSlots = [
    slot("wave"),
    undefined,
    slot("cutoff"),
    slot("mix"),
  ];

  test("plain text marks the selected knob and draws empty slots as ·", () => {
    expect(knobStripText(slots, 2, true)).toBe(
      "● wave 0.5  ▲ ·  ■›cutoff 0.5  ◆ mix 0.5",
    );
    expect(knobStripText(slots, 0, false)).toBe(
      "o>wave 0.5  ^ ·  # cutoff 0.5  * mix 0.5",
    );
  });

  for (const [name, width] of [
    ["80 columns", 76],
    ["wide", 116],
  ] as const)
    test(`paints all four glyphs in their colours at ${name}`, () => {
      const buffer = new CellBuffer(width + 4, 1);
      const theme = getTheme("default");
      const used = paintKnobStrip(buffer, 2, 0, width, slots, 2, {
        theme,
        unicode: true,
      });
      expect(used).toBeGreaterThan(0);
      expect(used).toBeLessThanOrEqual(width);
      const cell = Math.floor(width / 4);
      KNOBS.forEach((knob) => {
        const at = buffer.get(2 + cell * knob.index, 0)!;
        expect(at.ch).toBe(knob.glyph);
        expect(at.style?.fg).toEqual(theme.roles[knob.role].fg);
      });
      // The selected label is reverse video.
      expect(buffer.get(2 + cell * 2 + 2, 0)!.style?.reverse).toBe(true);
    });

  test("mono keeps every glyph, without hue", () => {
    const buffer = new CellBuffer(80, 1);
    paintKnobStrip(buffer, 0, 0, 80, slots, 0, {
      theme: getTheme("mono"),
      unicode: true,
    });
    KNOBS.forEach((knob) => {
      const at = buffer.get(20 * knob.index, 0)!;
      expect(at.ch).toBe(knob.glyph);
      expect(at.style?.fg).toBeUndefined();
    });
  });
});

describe("header position labels", () => {
  test("bar.beat, 1-based, in any meter", () => {
    expect(barBeatLabel(0, 4)).toBe("1.1");
    expect(barBeatLabel(17, 4)).toBe("5.2");
    expect(barBeatLabel(7.99, 4)).toBe("2.4");
    expect(barBeatLabel(6, 3)).toBe("3.1");
    // A meter change: bars start at beats 0, 4, 7.
    expect(barBeatLabel(8, 4, [0, 4, 7])).toBe("3.2");
    expect(barBeatLabel(-1, 4)).toBe("1.1");
  });

  test("the loop range, with an ASCII form", () => {
    expect(loopRangeLabel({ startBar: 4, bars: 2 }, true)).toBe("↻ 5–6");
    expect(loopRangeLabel({ startBar: 0, bars: 1 }, true)).toBe("↻ 1");
    expect(loopRangeLabel({ startBar: 4, bars: 2 }, false)).toBe("loop 5-6");
  });

  test("the pane letter and count", () => {
    expect(paneLabel(3, "B", true)).toBe("B ⧉3");
    expect(paneLabel(2, undefined, false)).toBe("2 panes");
  });

  test("the session name moves to the footer, before the spend", () => {
    const view = { sessionName: "night drive", spend: "$0 session" } as AppView;
    expect(footerStatus(view)).toBe("night drive · $0 session");
    expect(footerStatus({ spend: "$0" } as AppView, "abcdef1234")).toBe(
      "session abcdef12 · $0",
    );
  });
});

describe("the drawer's knob front page", () => {
  const field = (label: string, knob: 0 | 1 | 2 | 3, peers?: string) =>
    ({
      kind: "number",
      label,
      text: "0.5",
      position: 0.5,
      minText: "0",
      maxText: "1",
      knob,
      peers,
    }) as const;
  const view = {
    title: "Mix › bass",
    fields: [
      field("pan", 0),
      field("reverb mix", 1),
      field("filter cutoff", 2, "C"),
      field("volume", 3, "B C●"),
    ],
    focus: 3,
    dirty: false,
    hint: " ↑↓ knob · ←→ turn · esc back · ? keys ",
  };
  for (const width of [80, 120])
    test(`glyphs in knob colours, the selection marked, other panes' letters kept at ${width}`, () => {
      const theme = getTheme("default");
      const buffer = new CellBuffer(width, 24);
      paintDrawer(buffer, { y: 0, height: 24 }, width, view, {
        theme,
        unicode: true,
      });
      const rows = Array.from({ length: 24 }, (_, y) =>
        Array.from(
          { length: width },
          (_, x) => buffer.get(x, y)?.ch ?? " ",
        ).join(""),
      );
      const row = (needle: string) =>
        rows.findIndex((line) => line.includes(needle));
      for (const knob of KNOBS) {
        const y = row(`${knob.glyph}${knob.index === 3 ? "›" : " "}`);
        expect(y, knob.glyph).toBeGreaterThanOrEqual(0);
        const x = rows[y]!.indexOf(knob.glyph);
        expect(buffer.get(x, y)!.style?.fg).toEqual(theme.roles[knob.role].fg);
      }
      expect(rows[row("◆›volume")]).toMatch(/B C●\s*│\s*$/);
      expect(rows[row("■ filter cutoff")]).toMatch(/ C\s*│\s*$/);
    });
});
