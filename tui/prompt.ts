/** A bounded, dependency-free multiline prompt model for the Track TUI. */

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
  start: number;
  end: number;
  logicalLine: number;
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

/** Return visual rows with offsets into the logical code-point sequence. */
export function wrapPrompt(
  stateOrText: PromptState | string,
  width: number,
): PromptVisualLine[] {
  const text = typeof stateOrText === "string" ? stateOrText : stateOrText.text;
  const maxWidth = Math.max(1, Math.floor(width));
  const chars = points(text);
  const result: PromptVisualLine[] = [];
  let logicalStart = 0;
  let logicalLine = 0;
  const logical = text.split("\n");
  for (const segment of logical) {
    const segmentChars = points(segment);
    if (segmentChars.length === 0)
      result.push({
        text: "",
        start: logicalStart,
        end: logicalStart,
        logicalLine,
      });
    else {
      for (let offset = 0; offset < segmentChars.length; offset += maxWidth) {
        const end = Math.min(segmentChars.length, offset + maxWidth);
        result.push({
          text: segmentChars.slice(offset, end).join(""),
          start: logicalStart + offset,
          end: logicalStart + end,
          logicalLine,
        });
      }
    }
    logicalStart += segmentChars.length + 1;
    logicalLine += 1;
  }
  // `split` always creates one row, but this protects callers that pass odd
  // string-like state adapters and makes the function's contract explicit.
  if (result.length === 0)
    result.push({
      text: "",
      start: chars.length,
      end: chars.length,
      logicalLine: 0,
    });
  return result;
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
    if (state.cursor >= line.start && state.cursor <= line.end) {
      row = index;
      break;
    }
  }
  const line = lines[row]!;
  return {
    row,
    column: Math.max(
      0,
      Math.min(points(line.text).length, state.cursor - line.start),
    ),
    lines,
  };
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
      return submit(state, "submit");
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
        state: stateWithCursor(state, Math.max(0, state.cursor - 1)),
      };
    case "RIGHT":
      return {
        kind: "edit",
        state: stateWithCursor(
          state,
          Math.min(points(state.text).length, state.cursor + 1),
        ),
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
          lines[row]!.end,
          points(lines[row]!.text).length,
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
        state: stateWithCursor(
          state,
          target.start + Math.min(desired, points(target.text).length),
          desired,
        ),
      };
    }
    case "DOWN": {
      const current = visualCursor(state, options);
      const targetRow = Math.min(current.lines.length - 1, current.row + 1);
      const desired = state.desiredColumn ?? current.column;
      const target = current.lines[targetRow]!;
      return {
        kind: "edit",
        state: stateWithCursor(
          state,
          target.start + Math.min(desired, points(target.text).length),
          desired,
        ),
      };
    }
    case "BACKSPACE": {
      if (state.cursor === 0) return { kind: "noop", state };
      return {
        kind: "edit",
        state: editAtCursor(state, (chars, cursor) => ({
          chars: [...chars.slice(0, cursor - 1), ...chars.slice(cursor)],
          cursor: cursor - 1,
        })),
      };
    }
    case "DELETE": {
      const chars = points(state.text);
      if (state.cursor >= chars.length) return { kind: "noop", state };
      return {
        kind: "edit",
        state: editAtCursor(state, (all, cursor) => ({
          chars: [...all.slice(0, cursor), ...all.slice(cursor + 1)],
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

/** Render wrapped rows, keeping the cursor visible and scrolling only the editor. */
export function renderPrompt(
  stateInput: PromptState,
  optionsInput: PromptRenderOptions,
): string[] {
  const options = optionsWithDefaults(optionsInput);
  const state = normalized(stateInput, options);
  const prefix = optionsInput.prefix ?? "> ";
  const cursorGlyph = optionsInput.cursorGlyph ?? "▌";
  const lines = wrapPrompt(state, options.width);
  const cursor = visualCursor(state, options);
  const first = Math.min(
    Math.max(0, cursor.row - options.maxVisualRows + 1),
    Math.max(0, lines.length - options.maxVisualRows),
  );
  const visible = lines.slice(first, first + options.maxVisualRows);
  return visible.map((line, index) => {
    const absolute = first + index;
    const lineChars = points(line.text);
    const text =
      absolute === cursor.row
        ? `${lineChars.slice(0, cursor.column).join("")}${cursorGlyph}${lineChars.slice(cursor.column).join("")}`
        : line.text;
    return `${absolute === first ? prefix : "  "}${text}`;
  });
}

/** Mutable convenience wrapper for a TUI event loop. */
export class PromptModel {
  private state: PromptState;
  private options: Required<PromptOptions>;

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
  public setWidth(width: number): void {
    this.options = optionsWithDefaults({ ...this.options, width });
  }
  public handle(key: PromptKey): PromptAction {
    const action = applyPromptKey(this.state, key, this.options);
    this.state = action.state;
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
