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
