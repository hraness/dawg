/** A bounded, dependency-free multiline prompt model for the Track TUI. */

import { graphemes, type Grapheme } from "./text.ts";

export type PromptMode = "steer" | "queue";

export interface PromptOptions {
  width: number;
  maxLines?: number;
  maxChars?: number;
  maxVisualRows?: number;
}

export interface PromptState {
  /** Logical text, including newlines. */
  text: string;
  /** Cursor offset in Unicode code points. */
  cursor: number;
  mode: PromptMode;
  /** Retained for natural vertical movement across wrapped rows. */
  desiredColumn: number | null;
}

export interface PromptVisualLine {
  text: string;
  /** Code-point offsets into the logical text. */
  start: number;
  end: number;
  logicalLine: number;
  /** Display width in terminal cells. */
  width: number;
  /** True when the row ends at a soft wrap rather than a newline or EOF. */
  soft: boolean;
}

export type PromptKey = string | { type: "text" | "paste"; text: string };

export type PromptActionKind =
  "edit" | "submit" | "queue" | "cancel" | "exit" | "noop";

export interface PromptAction {
  kind: PromptActionKind;
  state: PromptState;
  /** Submitted text for submit and queue actions. */
  value?: string;
}

const DEFAULTS = { width: 80, maxLines: 32, maxChars: 8_000, maxVisualRows: 8 };

function optionsWithDefaults(options: PromptOptions): Required<PromptOptions> {
  return {
    width: Math.max(1, Math.floor(options.width || DEFAULTS.width)),
    maxLines: Math.max(1, Math.floor(options.maxLines ?? DEFAULTS.maxLines)),
    maxChars: Math.max(1, Math.floor(options.maxChars ?? DEFAULTS.maxChars)),
    maxVisualRows: Math.max(
      1,
      Math.floor(options.maxVisualRows ?? DEFAULTS.maxVisualRows),
    ),
  };
}

function points(value: string): string[] {
  return Array.from(value);
}

function limitText(value: string, options: Required<PromptOptions>): string {
  const chars = points(value).slice(0, options.maxChars);
  const lines = chars.join("").split("\n");
  if (lines.length > options.maxLines)
    return lines.slice(0, options.maxLines).join("\n");
  return lines.join("\n");
}

export function createPromptState(
  text = "",
  mode: PromptMode = "steer",
  options: PromptOptions = DEFAULTS,
): PromptState {
  const bounded = limitText(
    text.replaceAll("\r\n", "\n").replaceAll("\r", "\n"),
    optionsWithDefaults(options),
  );
  return {
    text: bounded,
    cursor: points(bounded).length,
    mode,
    desiredColumn: null,
  };
}

/**
 * Return visual rows with offsets into the logical code-point sequence.
 * Wrapping is grapheme- and width-aware: a wide CJK character or an emoji ZWJ
 * sequence is never split, and rows prefer to break after whitespace.
 */
export function wrapPrompt(
  stateOrText: PromptState | string,
  width: number,
): PromptVisualLine[] {
  const text = typeof stateOrText === "string" ? stateOrText : stateOrText.text;
  const maxWidth = Math.max(1, Math.floor(width));
  const result: PromptVisualLine[] = [];
  let logicalStart = 0;
  let logicalLine = 0;
  const push = (row: Grapheme[], start: number, soft: boolean): void => {
    const last = row[row.length - 1];
    result.push({
      text: row.map((cluster) => cluster.text).join(""),
      start,
      end: last ? last.start + last.length : start,
      logicalLine,
      width: row.reduce((sum, cluster) => sum + cluster.width, 0),
      soft,
    });
  };
  for (const segment of text.split("\n")) {
    const clusters = graphemes(segment).map((cluster) => ({
      ...cluster,
      start: cluster.start + logicalStart,
      width: Math.min(cluster.width, maxWidth),
    }));
    let row: Grapheme[] = [];
    let used = 0;
    let rowStart = logicalStart;
    for (const cluster of clusters) {
      if (used + cluster.width > maxWidth && row.length > 0) {
        // Prefer a word boundary when one exists past the row's first cell.
        let breakAt = row.length;
        for (let index = row.length - 1; index > 0; index -= 1) {
          if (/\s/.test(row[index]!.text)) {
            breakAt = index + 1;
            break;
          }
        }
        if (/\s/.test(cluster.text)) breakAt = row.length;
        const carry = row.slice(breakAt);
        push(row.slice(0, breakAt), rowStart, true);
        row = carry;
        used = carry.reduce((sum, item) => sum + item.width, 0);
        rowStart = carry[0]?.start ?? cluster.start;
      }
      row.push(cluster);
      used += cluster.width;
    }
    push(row, rowStart, false);
    logicalStart += Array.from(segment).length + 1;
    logicalLine += 1;
  }
  return result;
}

function boundaryBefore(text: string, cursor: number): number {
  let previous = 0;
  for (const cluster of graphemes(text)) {
    if (cluster.start >= cursor) break;
    previous = cluster.start;
  }
  return previous;
}

function boundaryAfter(text: string, cursor: number): number {
  for (const cluster of graphemes(text)) {
    const end = cluster.start + cluster.length;
    if (end > cursor) return end;
  }
  return points(text).length;
}

/** Display column of a code-point offset within a visual row. */
function columnOf(line: PromptVisualLine, cursor: number): number {
  let column = 0;
  for (const cluster of graphemes(line.text)) {
    if (line.start + cluster.start >= cursor) break;
    column += cluster.width;
  }
  return column;
}

/** Code-point offset nearest to (not past) a display column in a row. */
function offsetAt(line: PromptVisualLine, column: number): number {
  let used = 0;
  for (const cluster of graphemes(line.text)) {
    if (used + cluster.width > column) return line.start + cluster.start;
    used += cluster.width;
  }
  // A soft-wrapped row's end belongs to the next row; stay before its last
  // trailing space so vertical movement never jumps rows unexpectedly.
  return line.soft ? Math.max(line.start, line.end - 1) : line.end;
}

function normalized(
  state: PromptState,
  options: Required<PromptOptions>,
): PromptState {
  const text = limitText(state.text, options);
  const cursor = Math.max(
    0,
    Math.min(points(text).length, Math.floor(state.cursor)),
  );
  return { text, cursor, mode: state.mode, desiredColumn: state.desiredColumn };
}

function visualCursor(
  state: PromptState,
  options: Required<PromptOptions>,
): { row: number; column: number; lines: PromptVisualLine[] } {
  const lines = wrapPrompt(state, options.width);
  let row = lines.length - 1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const inside = line.soft
      ? state.cursor >= line.start && state.cursor < line.end
      : state.cursor >= line.start && state.cursor <= line.end;
    if (inside) {
      row = index;
      break;
    }
  }
  const line = lines[row]!;
  return { row, column: columnOf(line, state.cursor), lines };
}

function stateWithCursor(
  state: PromptState,
  cursor: number,
  desiredColumn: number | null = null,
): PromptState {
  return { text: state.text, cursor, mode: state.mode, desiredColumn };
}

function textAction(
  state: PromptState,
  key: string,
  options: Required<PromptOptions>,
): PromptAction {
  const chars = points(state.text);
  const before = chars.slice(0, state.cursor);
  const after = chars.slice(state.cursor);
  const inserted = key.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const combined = limitText(
    [...before, ...points(inserted), ...after].join(""),
    options,
  );
  const cursor = Math.min(
    before.length + points(inserted).length,
    points(combined).length,
  );
  const changed = combined !== state.text || cursor !== state.cursor;
  return {
    kind: changed ? "edit" : "noop",
    state: stateWithCursor({ ...state, text: combined }, cursor),
  };
}

function moveWord(state: PromptState, direction: -1 | 1): PromptState {
  const chars = points(state.text);
  let cursor = state.cursor;
  if (direction < 0) {
    while (cursor > 0 && /\s/.test(chars[cursor - 1]!)) cursor -= 1;
    while (cursor > 0 && !/\s/.test(chars[cursor - 1]!)) cursor -= 1;
  } else {
    while (cursor < chars.length && /\s/.test(chars[cursor]!)) cursor += 1;
    while (cursor < chars.length && !/\s/.test(chars[cursor]!)) cursor += 1;
  }
  return stateWithCursor(state, cursor);
}

function editAtCursor(
  state: PromptState,
  operation: (
    chars: string[],
    cursor: number,
  ) => { chars: string[]; cursor: number },
): PromptState {
  const result = operation(points(state.text), state.cursor);
  return stateWithCursor(
    { ...state, text: result.chars.join("") },
    result.cursor,
  );
}

function submit(state: PromptState, kind: "submit" | "queue"): PromptAction {
  const value = state.text;
  if (value.trim().length === 0) return { kind: "noop", state };
  return { kind, state: createPromptState("", state.mode), value };
}

/** Apply one terminal key or a text/paste event. */
export function applyPromptKey(
  stateInput: PromptState,
  keyInput: PromptKey,
  optionsInput: PromptOptions,
): PromptAction {
  const options = optionsWithDefaults(optionsInput);
  const state = normalized(stateInput, options);
  if (typeof keyInput === "object")
    return textAction(state, keyInput.text, options);
  if (
    keyInput.length > 1 &&
    !keyInput.includes("+") &&
    ![
      "ENTER",
      "BACKSPACE",
      "DELETE",
      "LEFT",
      "RIGHT",
      "UP",
      "DOWN",
      "HOME",
      "END",
      "ESC",
      "TAB",
    ].includes(keyInput)
  ) {
    return textAction(state, keyInput, options);
  }
  switch (keyInput.toUpperCase()) {
    case "ENTER":
      // The mode pill decides what Enter does: STEER runs now, QUEUE waits.
      return submit(state, state.mode === "queue" ? "queue" : "submit");
    case "ALT+ENTER":
      return submit(state, "queue");
    case "SHIFT+ENTER":
    case "CTRL+J":
    case "NEWLINE":
      return textAction(state, "\n", options);
    case "ESC":
      return { kind: "cancel", state: createPromptState("", state.mode) };
    case "CTRL+C":
      return { kind: "exit", state };
    case "CTRL+Q":
      return {
        kind: "edit",
        state: { ...state, mode: state.mode === "steer" ? "queue" : "steer" },
      };
    case "LEFT":
      return {
        kind: "edit",
        state: stateWithCursor(state, boundaryBefore(state.text, state.cursor)),
      };
    case "RIGHT":
      return {
        kind: "edit",
        state: stateWithCursor(state, boundaryAfter(state.text, state.cursor)),
      };
    case "ALT+LEFT":
    case "CTRL+LEFT":
      return { kind: "edit", state: moveWord(state, -1) };
    case "ALT+RIGHT":
    case "CTRL+RIGHT":
      return { kind: "edit", state: moveWord(state, 1) };
    case "HOME": {
      const { lines, row } = visualCursor(state, options);
      return {
        kind: "edit",
        state: stateWithCursor(state, lines[row]!.start, 0),
      };
    }
    case "END": {
      const { lines, row } = visualCursor(state, options);
      return {
        kind: "edit",
        state: stateWithCursor(
          state,
          offsetAt(lines[row]!, Number.POSITIVE_INFINITY),
          lines[row]!.width,
        ),
      };
    }
    case "CTRL+HOME":
      return { kind: "edit", state: stateWithCursor(state, 0, 0) };
    case "CTRL+END":
      return {
        kind: "edit",
        state: stateWithCursor(state, points(state.text).length, null),
      };
    case "UP": {
      const current = visualCursor(state, options);
      const targetRow = Math.max(0, current.row - 1);
      const desired = state.desiredColumn ?? current.column;
      const target = current.lines[targetRow]!;
      return {
        kind: "edit",
        state: stateWithCursor(state, offsetAt(target, desired), desired),
      };
    }
    case "DOWN": {
      const current = visualCursor(state, options);
      const targetRow = Math.min(current.lines.length - 1, current.row + 1);
      const desired = state.desiredColumn ?? current.column;
      const target = current.lines[targetRow]!;
      return {
        kind: "edit",
        state: stateWithCursor(state, offsetAt(target, desired), desired),
      };
    }
    case "BACKSPACE": {
      if (state.cursor === 0) return { kind: "noop", state };
      return {
        kind: "edit",
        state: editAtCursor(state, (chars, cursor) => {
          const from = boundaryBefore(state.text, cursor);
          return {
            chars: [...chars.slice(0, from), ...chars.slice(cursor)],
            cursor: from,
          };
        }),
      };
    }
    case "DELETE": {
      const chars = points(state.text);
      if (state.cursor >= chars.length) return { kind: "noop", state };
      return {
        kind: "edit",
        state: editAtCursor(state, (all, cursor) => ({
          chars: [
            ...all.slice(0, cursor),
            ...all.slice(boundaryAfter(state.text, cursor)),
          ],
          cursor,
        })),
      };
    }
    case "CTRL+A":
      return { kind: "edit", state: stateWithCursor(state, 0, 0) };
    case "CTRL+E":
      return {
        kind: "edit",
        state: stateWithCursor(state, points(state.text).length, null),
      };
    case "CTRL+U":
      return {
        kind: "edit",
        state: stateWithCursor(
          { ...state, text: points(state.text).slice(state.cursor).join("") },
          0,
          0,
        ),
      };
    case "CTRL+K":
      return {
        kind: "edit",
        state: stateWithCursor(
          {
            ...state,
            text: points(state.text).slice(0, state.cursor).join(""),
          },
          state.cursor,
          null,
        ),
      };
    case "CTRL+W": {
      const start = moveWord(state, -1).cursor;
      return {
        kind: "edit",
        state: stateWithCursor(
          {
            ...state,
            text: `${points(state.text).slice(0, start).join("")}${points(state.text).slice(state.cursor).join("")}`,
          },
          start,
        ),
      };
    }
    default:
      return textAction(state, keyInput, options);
  }
}

export interface PromptRenderOptions extends PromptOptions {
  prefix?: string;
  cursorGlyph?: string;
}

export interface PromptLayout {
  /** Visible rows after internal scrolling. */
  rows: PromptVisualLine[];
  /** Index of the first visible row within all wrapped rows. */
  first: number;
  /** Total wrapped rows before scrolling. */
  total: number;
  /** Cursor row relative to `rows`, and its display column. */
  cursorRow: number;
  cursorColumn: number;
}

/** Wrap and scroll the prompt so the cursor row is always visible. */
export function layoutPrompt(
  stateInput: PromptState,
  optionsInput: PromptOptions,
): PromptLayout {
  const options = optionsWithDefaults(optionsInput);
  const state = normalized(stateInput, options);
  const cursor = visualCursor(state, options);
  const lines = cursor.lines;
  const first = Math.min(
    Math.max(0, cursor.row - options.maxVisualRows + 1),
    Math.max(0, lines.length - options.maxVisualRows),
  );
  return {
    rows: lines.slice(first, first + options.maxVisualRows),
    first,
    total: lines.length,
    cursorRow: cursor.row - first,
    cursorColumn: cursor.column,
  };
}

/** Render wrapped rows, keeping the cursor visible and scrolling only the editor. */
export function renderPrompt(
  stateInput: PromptState,
  optionsInput: PromptRenderOptions,
): string[] {
  const prefix = optionsInput.prefix ?? "> ";
  const cursorGlyph = optionsInput.cursorGlyph ?? "▌";
  const state = normalized(stateInput, optionsWithDefaults(optionsInput));
  const layout = layoutPrompt(state, optionsInput);
  return layout.rows.map((line, index) => {
    const lineChars = points(line.text);
    const split = Math.max(0, state.cursor - line.start);
    const text =
      index === layout.cursorRow
        ? `${lineChars.slice(0, split).join("")}${cursorGlyph}${lineChars.slice(split).join("")}`
        : line.text;
    return `${index === 0 ? prefix : "  "}${text}`;
  });
}

/** Mutable convenience wrapper for a TUI event loop. */
export class PromptModel {
  private state: PromptState;
  private options: Required<PromptOptions>;
  private history: string[] = [];
  private historyIndex = -1;
  private draftBeforeHistory = "";

  public constructor(options: PromptOptions, initial = "") {
    this.options = optionsWithDefaults(options);
    this.state = createPromptState(initial, "steer", this.options);
  }

  public get value(): string {
    return this.state.text;
  }
  public get snapshot(): PromptState {
    return { ...this.state };
  }
  public get width(): number {
    return this.options.width;
  }
  public layout(maxVisualRows = this.options.maxVisualRows): PromptLayout {
    return layoutPrompt(this.state, { ...this.options, maxVisualRows });
  }
  /** Number of wrapped rows the current draft needs at the current width. */
  public get wrappedRows(): number {
    return wrapPrompt(this.state, this.options.width).length;
  }
  public setWidth(width: number): void {
    this.options = optionsWithDefaults({ ...this.options, width });
  }
  public handle(key: PromptKey): PromptAction {
    if (typeof key === "string" && (key === "UP" || key === "DOWN")) {
      const atBoundary = this.state.cursor === points(this.state.text).length;
      if (atBoundary && (this.history.length > 0 || this.historyIndex >= 0)) {
        if (key === "UP") {
          if (this.historyIndex < 0) this.draftBeforeHistory = this.state.text;
          this.historyIndex = Math.min(
            this.history.length - 1,
            this.historyIndex + 1,
          );
        } else if (this.historyIndex >= 0) {
          this.historyIndex -= 1;
        }
        const recalled =
          this.historyIndex < 0
            ? this.draftBeforeHistory
            : (this.history[this.history.length - 1 - this.historyIndex] ?? "");
        this.state = createPromptState(recalled, this.state.mode, this.options);
        return { kind: "edit", state: this.state };
      }
    }
    const action = applyPromptKey(this.state, key, this.options);
    this.state = action.state;
    if (action.kind === "submit" || action.kind === "queue") {
      const value = action.value?.trim();
      if (value) {
        this.history = [
          ...this.history.filter((entry) => entry !== value),
          value,
        ].slice(-100);
      }
      this.historyIndex = -1;
      this.draftBeforeHistory = "";
    }
    return action;
  }
  public render(prefix?: string): string[] {
    const options: PromptRenderOptions =
      prefix === undefined ? { ...this.options } : { ...this.options, prefix };
    return renderPrompt(this.state, options);
  }
}

export const handlePromptKey = applyPromptKey;
export const createPromptEditor = (
  options: PromptOptions,
  initial = "",
): PromptModel => new PromptModel(options, initial);
export const PromptEditor = PromptModel;
