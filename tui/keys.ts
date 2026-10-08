/**
 * Map decoded terminal sequences to prompt keys and TUI commands.
 *
 * The prompt is always focused, so printable keys always type.  Control
 * chords carry the global actions:
 *   Ctrl+C quit · Ctrl+Q toggle STEER/QUEUE · Ctrl+Z undo · Ctrl+Y redo
 *   Ctrl+O transcript overlay · Esc closes the overlay
 */

import type { PromptKey } from "./prompt.ts";

export type UiCommand =
  "quit" | "undo" | "redo" | "toggle-log" | "close-overlay" | "redraw";

export type KeyResult =
  | { type: "prompt"; key: PromptKey }
  | { type: "text"; text: string }
  | { type: "ui"; command: UiCommand }
  | { type: "ignore" };

const PROMPT_SEQUENCES: Record<string, string> = {
  "\u001b[13;2u": "SHIFT+ENTER",
  "\u001b[27;2;13~": "SHIFT+ENTER",
  // Many terminals send ESC CR (Alt+Enter) for Shift+Enter when configured;
  // dawg treats Alt+Enter as "queue this prompt".
  "\u001b\r": "ALT+ENTER",
  "\u0011": "CTRL+Q",
  "\u007f": "BACKSPACE",
  "\b": "BACKSPACE",
  "\r": "ENTER",
  "\n": "SHIFT+ENTER",
  "\u001b[A": "UP",
  "\u001bOA": "UP",
  "\u001b[B": "DOWN",
  "\u001bOB": "DOWN",
  "\u001b[C": "RIGHT",
  "\u001bOC": "RIGHT",
  "\u001b[D": "LEFT",
  "\u001bOD": "LEFT",
  "\u001b[H": "HOME",
  "\u001b[1~": "HOME",
  "\u0001": "HOME",
  "\u001b[F": "END",
  "\u001b[4~": "END",
  "\u0005": "END",
  "\u001b[3~": "DELETE",
  "\u001b[1;5D": "CTRL+LEFT",
  "\u001bb": "CTRL+LEFT",
  "\u001b[1;5C": "CTRL+RIGHT",
  "\u001bf": "CTRL+RIGHT",
  "\u001b[1;5H": "CTRL+HOME",
  "\u001b[1;5F": "CTRL+END",
};

const UI_SEQUENCES: Record<string, UiCommand> = {
  "\u0003": "quit",
  "\u001a": "undo",
  "\u0019": "redo",
  "\u000f": "toggle-log",
  "\u000c": "redraw",
};

export function classifyKey(value: string): KeyResult {
  const ui = UI_SEQUENCES[value];
  if (ui) return { type: "ui", command: ui };
  if (value.startsWith("\u001b[200~") && value.endsWith("\u001b[201~"))
    return { type: "prompt", key: { type: "paste", text: value.slice(6, -6) } };
  const key = PROMPT_SEQUENCES[value];
  if (key) return { type: "prompt", key };
  if (value === "\u001b") return { type: "ui", command: "close-overlay" };
  if (value.startsWith("\u001b")) return { type: "ignore" };
  // Strip other C0 controls so stray chords never insert garbage.
  const text = Array.from(value)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join("");
  return text ? { type: "text", text } : { type: "ignore" };
}

export type OverlayKey =
  "up" | "down" | "pgup" | "pgdn" | "home" | "end" | "enter";

const OVERLAY_SEQUENCES: Record<string, OverlayKey> = {
  "\u001b[A": "up",
  "\u001bOA": "up",
  "\u001b[B": "down",
  "\u001bOB": "down",
  "\u001b[5~": "pgup",
  "\u001b[6~": "pgdn",
  "\u001b[H": "home",
  "\u001b[1~": "home",
  "\u001b[F": "end",
  "\u001b[4~": "end",
  "\r": "enter",
};

/** Navigation keys an open overlay (transcript, picker) consumes. */
export function overlayKey(value: string): OverlayKey | undefined {
  return OVERLAY_SEQUENCES[value];
}

// ---------------------------------------------------------------------------
// Mouse (SGR 1006)

/**
 * Mouse reporting: 1000 clicks, 1002 drags with a button held, 1006 the
 * SGR encoding (`ESC [ < b ; x ; y M|m`), which has no 223-column limit and
 * tells a release from a press. Off is the same modes in reverse order.
 */
export const MOUSE_ON = "\u001b[?1000h\u001b[?1002h\u001b[?1006h";
export const MOUSE_OFF = "\u001b[?1006l\u001b[?1002l\u001b[?1000l";

export type MouseButton = "left" | "middle" | "right" | "none";

export interface MouseEvent {
  kind: "down" | "up" | "drag" | "move" | "wheel";
  button: MouseButton;
  /** 0-based cell column and row. */
  x: number;
  y: number;
  /** For `wheel`: -1 up (away from you), 1 down. */
  delta: -1 | 1 | 0;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}

const SGR_MOUSE = /^\u001b\[<(\d{1,4});(\d{1,5});(\d{1,5})([Mm])$/;
const BUTTONS: readonly MouseButton[] = ["left", "middle", "right", "none"];

/** Decode one SGR mouse report; undefined for anything else. */
export function parseMouse(value: string): MouseEvent | undefined {
  const match = SGR_MOUSE.exec(value);
  if (!match) return undefined;
  const code = Number(match[1]);
  const x = Number(match[2]) - 1;
  const y = Number(match[3]) - 1;
  if (x < 0 || y < 0) return undefined;
  const modifiers = {
    shift: (code & 4) !== 0,
    alt: (code & 8) !== 0,
    ctrl: (code & 16) !== 0,
  };
  const button = BUTTONS[code & 3]!;
  if (code & 64) {
    // 64/65 wheel up/down; 66/67 (horizontal wheels) are ignored.
    if ((code & 3) > 1) return undefined;
    return {
      kind: "wheel",
      button: "none",
      x,
      y,
      delta: (code & 1) === 0 ? -1 : 1,
      ...modifiers,
    };
  }
  const motion = (code & 32) !== 0;
  const kind = match[4] === "m"
    ? "up"
    : motion
      ? button === "none"
        ? "move"
        : "drag"
      : "down";
  return { kind, button, x, y, delta: 0, ...modifiers };
}

/** True for any mouse report, SGR or a legacy X10 one (dropped). */
export function isMouseSequence(value: string): boolean {
  return value.startsWith("\u001b[<") || value.startsWith("\u001b[M");
}
