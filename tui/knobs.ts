/**
 * The four knobs (design §7, the OP-1's four colour encoders adapted): one
 * table names each knob's colour, shape glyph and meaning, and every screen
 * that shows knobs (the fader drawer's front page, the mixer page, euclid,
 * and later TAPE and PLAY) reads it, so a knob looks and means the same
 * everywhere.
 *
 *   ● blue    moves   position, selection, which
 *   ▲ green   sizes   length, range, amount of steps
 *   ■ white   shapes  tone, time, character
 *   ◆ orange  level   loudness, mix, velocity
 *
 * Colour is never the only cue: each knob has a shape glyph, which is all
 * that is left under NO_COLOR and the mono theme.
 *
 * Keys, the same on every screen: ↑↓ picks a knob (skipping empty slots),
 * ←→ turns it, ⇧←→ turns it coarse, x resets it, enter opens it big.
 * Every turn is a typed command, so the receipt teaches the words.
 *
 * Pure: the reducer returns what to run; the caller runs it.
 */
import type { CellBuffer } from "./screen.ts";
import { displayWidth, truncate } from "./text.ts";
import type { SemanticRole, Style, Theme } from "./theme.ts";
import {
  KEY_COARSE_LEFT,
  KEY_COARSE_RIGHT,
  KEY_DOWN,
  KEY_ENTER,
  KEY_LEFT,
  KEY_RESET,
  KEY_RIGHT,
  KEY_UP,
} from "./grammar.ts";

export type KnobIndex = 0 | 1 | 2 | 3;

export type Knob = Readonly<{
  index: KnobIndex;
  colour: "blue" | "green" | "white" | "orange";
  /** What this knob means on every screen. */
  meaning: "moves" | "sizes" | "shapes" | "level";
  role: Extract<SemanticRole, "knob1" | "knob2" | "knob3" | "knob4">;
  /** Shape glyph (width 1), so colour is never the only cue. */
  glyph: string;
  /** The glyph where the terminal has no Unicode. */
  ascii: string;
}>;

/** The one table: glyphs, colours and meanings of the four knobs. */
export const KNOBS: readonly [Knob, Knob, Knob, Knob] = Object.freeze([
  {
    index: 0,
    colour: "blue",
    meaning: "moves",
    role: "knob1",
    glyph: "●",
    ascii: "o",
  },
  {
    index: 1,
    colour: "green",
    meaning: "sizes",
    role: "knob2",
    glyph: "▲",
    ascii: "^",
  },
  {
    index: 2,
    colour: "white",
    meaning: "shapes",
    role: "knob3",
    glyph: "■",
    ascii: "#",
  },
  {
    index: 3,
    colour: "orange",
    meaning: "level",
    role: "knob4",
    glyph: "◆",
    ascii: "*",
  },
] as const);

export function knobGlyph(index: KnobIndex, unicode: boolean): string {
  const knob = KNOBS[index];
  return unicode ? knob.glyph : knob.ascii;
}

export function knobStyle(index: KnobIndex, theme: Theme): Style {
  return theme.roles[KNOBS[index].role];
}

/** The footer hint of a knob page, the same words on every screen. */
export const KNOB_HINT =
  "↑↓ knob · ←→ turn · ⇧ coarse · x reset · tab more · esc close";

/** One knob slot as a screen shows and turns it. */
export type KnobSlot = Readonly<{
  label: string;
  /** Formatted value: `1200 Hz`, `saw`, `−4.9 dB`. */
  text: string;
  /** 0…1 along the gauge; undefined while off or for a choice. */
  position?: number | undefined;
  /** The command one turn runs, or undefined at the end of the range. */
  turn: (direction: 1 | -1, coarse: boolean) => string | undefined;
  /** The command `x` runs, when the slot has a default. */
  reset?: string | undefined;
}>;

/** Four slots; an undefined one draws as `·` and ↑↓ skips it. */
export type KnobSlots = readonly [
  KnobSlot | undefined,
  KnobSlot | undefined,
  KnobSlot | undefined,
  KnobSlot | undefined,
];

export type KnobState = { selected: KnobIndex };

export type KnobResult =
  | { type: "handled" }
  | { type: "pass" }
  | { type: "run"; command: string }
  | { type: "open"; knob: KnobIndex };

/**
 * The next knob from `from` in `direction`, wrapping blue → green → white →
 * orange and skipping empty slots; `from` itself when every slot is empty.
 */
export function nextKnob(
  from: KnobIndex,
  direction: 1 | -1,
  present: (index: KnobIndex) => boolean,
): KnobIndex {
  for (let step = 1; step <= 4; step += 1) {
    const index = (((from + direction * step) % 4) + 4) % 4;
    if (present(index as KnobIndex)) return index as KnobIndex;
  }
  return from;
}

/** The first non-empty slot, for opening on a page. */
export function firstKnob(slots: KnobSlots): KnobIndex {
  const at = slots.findIndex(Boolean);
  return (at < 0 ? 0 : at) as KnobIndex;
}

/** One key on a knob strip. */
export function knobKey(
  state: KnobState,
  slots: KnobSlots,
  value: string,
): KnobResult {
  if (!slots[state.selected]) state.selected = firstKnob(slots);
  const up = KEY_UP.has(value);
  if (up || KEY_DOWN.has(value)) {
    state.selected = nextKnob(state.selected, up ? -1 : 1, (index) =>
      Boolean(slots[index]),
    );
    return { type: "handled" };
  }
  const slot = slots[state.selected];
  if (!slot) return { type: "pass" };
  const coarseLeft = KEY_COARSE_LEFT.has(value);
  const coarseRight = KEY_COARSE_RIGHT.has(value);
  if (
    coarseLeft ||
    coarseRight ||
    KEY_LEFT.has(value) ||
    KEY_RIGHT.has(value)
  ) {
    const direction = coarseRight || KEY_RIGHT.has(value) ? 1 : -1;
    const command = slot.turn(direction, coarseLeft || coarseRight);
    return command ? { type: "run", command } : { type: "handled" };
  }
  if (KEY_RESET.has(value))
    return slot.reset
      ? { type: "run", command: slot.reset }
      : { type: "handled" };
  if (KEY_ENTER.has(value)) return { type: "open", knob: state.selected };
  return { type: "pass" };
}

/**
 * `●›cutoff 1.2k ▲ q 0.7 ■ type lowpass ◆ mix 0.3`: the strip as plain
 * text, for pickers and receipts. The selected knob carries `›` (`>`).
 */
export function knobStripText(
  slots: KnobSlots,
  selected: KnobIndex,
  unicode: boolean,
): string {
  return slots
    .map((slot, index) => {
      const knob = index as KnobIndex;
      const mark = knob === selected ? (unicode ? "›" : ">") : " ";
      const glyph = knobGlyph(knob, unicode);
      return slot ? `${glyph}${mark}${slot.label} ${slot.text}` : `${glyph} ·`;
    })
    .join("  ");
}

/**
 * Paint a one-row knob strip at (x, y) within `width`: each slot is its
 * glyph in its knob colour, the label, the value and a short gauge. The
 * selected slot's label is reverse video. Returns the cells used.
 */
export function paintKnobStrip(
  buffer: CellBuffer,
  x: number,
  y: number,
  width: number,
  slots: KnobSlots,
  selected: KnobIndex,
  options: { theme: Theme; unicode: boolean; background?: Style },
): number {
  const cell = Math.floor(width / 4);
  if (cell < 6) return 0;
  const background = options.background ?? {};
  const on = (style: Style): Style => ({ ...background, ...style });
  slots.forEach((slot, index) => {
    const knob = index as KnobIndex;
    const left = x + cell * index;
    const style = knobStyle(knob, options.theme);
    buffer.text(left, y, knobGlyph(knob, options.unicode), on(style));
    if (!slot) {
      buffer.text(left + 2, y, "·", on(options.theme.roles.faint));
      return;
    }
    const label = truncate(`${slot.label} ${slot.text}`, cell - 3);
    buffer.text(
      left + 2,
      y,
      label,
      on(
        knob === selected
          ? { ...options.theme.roles.text, reverse: true }
          : options.theme.roles.text,
      ),
    );
    const gauge = cell - 3 - displayWidth(label) - 1;
    if (slot.position !== undefined && gauge >= 3) {
      const filled = Math.round(
        Math.min(1, Math.max(0, slot.position)) * gauge,
      );
      buffer.text(
        left + 3 + displayWidth(label),
        y,
        (options.unicode ? "█" : "=").repeat(filled),
        on(style),
      );
      buffer.text(
        left + 3 + displayWidth(label) + filled,
        y,
        (options.unicode ? "─" : "-").repeat(gauge - filled),
        on(options.theme.roles.faint),
      );
    }
  });
  return cell * 4;
}
