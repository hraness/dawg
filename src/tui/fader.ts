/**
 * Fader mode: the keys and mouse gestures of the fader drawer
 * (tui/drawer.ts), as pure functions over a list of fields.
 *
 * A field is a number (with a range, a step function and a formatter taken
 * from the menu row, which in turn takes them from core/params.ts, the fx
 * specs and the automation lanes) or a choice (a segmented selector). Every
 * change is a command: the caller stages it on the audition loop, keyed by
 * field, so repeated nudges replace one staged edit and Enter keeps them
 * all as one revision.
 */
import type { DrawerField, DrawerView } from "../../tui/drawer.ts";

export type FaderNumber = Readonly<{
  kind: "number";
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  step: (value: number, direction: 1 | -1) => number;
  format: (value: number) => string;
  command: (value: number) => string;
  /** Typed text → command; undefined when it does not parse or fit. */
  parse: (text: string) => string | undefined;
  /** The command `0` / `d` runs to put the value back to its default. */
  reset?: string | undefined;
  /** Starting value for a nudge while off. */
  start?: number | undefined;
  off?: string | undefined;
}>;

export type FaderChoice = Readonly<{
  kind: "choice";
  label: string;
  value: string;
  options: readonly string[];
  command: (option: string) => string;
}>;

export type FaderSpec = FaderNumber | FaderChoice;

export interface FaderState {
  /** The focused field, by label (labels survive rebuilds; indexes may not). */
  label: string;
  /** Digits typed for the focused field. */
  typing?: string | undefined;
}

export type FaderResult =
  | { type: "handled" }
  /** Set a field: stage `command`, replacing the field's previous edit. */
  | { type: "set"; command: string; key: string }
  | { type: "keep" }
  | { type: "revert" }
  /** Leave the drawer (nothing staged, or after keep / revert). */
  | { type: "close" }
  | { type: "audition"; key: "loop" | "ab" | "context" }
  | { type: "pass" };

/** The key a field's staged edit is filed under. */
export function faderKey(label: string): string {
  return `fader:${label}`;
}

/** A wide range of positive values reads (and drags) on a log scale. */
function logScale(spec: FaderNumber): boolean {
  return spec.min > 0 && spec.max / spec.min >= 100;
}

/** Where `value` sits along the bar, 0…1. */
export function faderPosition(spec: FaderNumber, value: number): number {
  if (spec.max <= spec.min) return 0;
  const clamped = Math.min(spec.max, Math.max(spec.min, value));
  if (logScale(spec))
    return Math.log(clamped / spec.min) / Math.log(spec.max / spec.min);
  return (clamped - spec.min) / (spec.max - spec.min);
}

/**
 * The value at `position` (0…1), snapped to the field's own step grid: the
 * nearest value its step function can reach from the minimum, so a drag
 * lands on the same values the keys do.
 */
export function faderValueAt(spec: FaderNumber, position: number): number {
  const p = Math.min(1, Math.max(0, position));
  if (p <= 0) return spec.min;
  if (p >= 1) return spec.max;
  const raw = logScale(spec)
    ? spec.min * (spec.max / spec.min) ** p
    : spec.min + p * (spec.max - spec.min);
  return snap(spec, raw);
}

/** The nearest step-reachable value to `raw` (step size near `raw`). */
function snap(spec: FaderNumber, raw: number): number {
  const up = spec.step(raw, 1);
  const down = spec.step(raw, -1);
  // Linear steps round onto the grid; log steps move by a ratio. Either
  // way the step size near `raw` bounds the precision worth keeping.
  const size = Math.max(
    1e-9,
    Math.min(Math.abs(up - raw), Math.abs(raw - down)) ||
      Math.abs(up - down) / 2,
  );
  const decimals = Math.max(0, Math.min(4, Math.ceil(-Math.log10(size))));
  const candidates = [down, up, Number(raw.toFixed(decimals))];
  // Prefer an exact grid value when one is within half a step.
  let best = candidates[2]!;
  for (const candidate of [down, up])
    if (Math.abs(candidate - raw) <= size / 2 + 1e-9) best = candidate;
  return Math.min(spec.max, Math.max(spec.min, best));
}

/** Fine (a tenth of a step), normal, coarse (five steps) or page (twenty). */
export type StepSize = "fine" | "normal" | "coarse" | "page";

export function stepValue(
  spec: FaderNumber,
  direction: 1 | -1,
  size: StepSize = "normal",
): number {
  if (spec.value === undefined) return spec.start ?? spec.min;
  const clamp = (value: number) =>
    Math.min(spec.max, Math.max(spec.min, value));
  if (size === "fine") {
    const next = spec.step(spec.value, direction);
    const delta = (next - spec.value) / 10;
    if (Math.abs(delta) < 1e-9) return spec.value;
    const decimals = Math.max(
      0,
      Math.min(4, Math.ceil(-Math.log10(Math.abs(delta)))),
    );
    return clamp(Number((spec.value + delta).toFixed(decimals)));
  }
  const times = size === "coarse" ? 5 : size === "page" ? 20 : 1;
  let value = spec.value;
  for (let index = 0; index < times; index += 1) {
    const next = clamp(spec.step(value, direction));
    if (Math.abs(next - value) < 1e-12) break;
    value = next;
  }
  return value;
}

const LEFT = new Set(["\u001b[D", "\u001bOD", "h", "-", "_"]);
const RIGHT = new Set(["\u001b[C", "\u001bOC", "l", "+", "="]);
const COARSE_LEFT = new Set(["\u001b[1;2D", "{"]);
const COARSE_RIGHT = new Set(["\u001b[1;2C", "}"]);
const FINE_LEFT = new Set(["\u001b[1;3D", "\u001b[1;5D", "\u001bb", "["]);
const FINE_RIGHT = new Set(["\u001b[1;3C", "\u001b[1;5C", "\u001bf", "]"]);
const UP = new Set(["\u001b[A", "\u001bOA", "k", "\u001b[Z"]);
const DOWN = new Set(["\u001b[B", "\u001bOB", "j", "\t"]);
const PAGE_UP = "\u001b[5~";
const PAGE_DOWN = "\u001b[6~";
const HOME = new Set(["\u001b[H", "\u001bOH", "\u001b[1~"]);
const END = new Set(["\u001b[F", "\u001bOF", "\u001b[4~"]);
const ENTER = new Set(["\r", "\n"]);
const BACKSPACE = new Set(["\u007f", "\b"]);

export interface FaderKeyOptions {
  /** Edits are staged (Enter keeps, Esc reverts). */
  dirty: boolean;
  /** The window hosts the audition loop (space, a, c). */
  audition: boolean;
}

/** Index of the focused field (the first when its label is gone). */
export function focusIndex(
  state: FaderState,
  fields: readonly FaderSpec[],
): number {
  return Math.max(
    0,
    fields.findIndex((field) => field.label === state.label),
  );
}

function setNumber(spec: FaderNumber, value: number): FaderResult {
  if (spec.value !== undefined && Math.abs(value - spec.value) < 1e-9)
    return { type: "handled" };
  return {
    type: "set",
    command: spec.command(value),
    key: faderKey(spec.label),
  };
}

function setChoice(spec: FaderChoice, index: number): FaderResult {
  const option =
    spec.options[Math.min(spec.options.length - 1, Math.max(0, index))];
  if (option === undefined || option === spec.value) return { type: "handled" };
  return {
    type: "set",
    command: spec.command(option),
    key: faderKey(spec.label),
  };
}

/** One key in fader mode. Mutates `state` (focus, typing). */
export function faderKeyPress(
  state: FaderState,
  fields: readonly FaderSpec[],
  value: string,
  options: FaderKeyOptions,
): FaderResult {
  if (fields.length === 0) return { type: "close" };
  // Ctrl-C, Ctrl-L and `?` (the keys panel) belong to the app.
  if (value === "\u0003" || value === "\u000c") return { type: "pass" };
  if (value === "?" && state.typing === undefined) return { type: "pass" };
  const index = focusIndex(state, fields);
  const field = fields[index]!;
  state.label = field.label;
  if (state.typing !== undefined) {
    if (value === "\u001b") {
      state.typing = undefined;
      return { type: "handled" };
    }
    if (BACKSPACE.has(value)) {
      state.typing = state.typing.slice(0, -1);
      if (!state.typing) state.typing = undefined;
      return { type: "handled" };
    }
    if (ENTER.has(value) || value === "\t") {
      const text = state.typing;
      state.typing = undefined;
      const command = field.kind === "number" ? field.parse(text) : undefined;
      return command
        ? { type: "set", command, key: faderKey(field.label) }
        : { type: "handled" };
    }
    if (/^[0-9.\-]$/.test(value)) {
      state.typing = (state.typing + value).slice(0, 16);
      return { type: "handled" };
    }
    return { type: "handled" };
  }
  if (value === "\u001b")
    return options.dirty ? { type: "revert" } : { type: "close" };
  if (ENTER.has(value))
    return options.dirty ? { type: "keep" } : { type: "close" };
  const move = UP.has(value) ? -1 : DOWN.has(value) ? 1 : 0;
  if (move) {
    state.label = fields[(index + move + fields.length) % fields.length]!.label;
    return { type: "handled" };
  }
  if (options.audition) {
    if (value === " ") return { type: "audition", key: "loop" };
    if (value === "a") return { type: "audition", key: "ab" };
    if (value === "c") return { type: "audition", key: "context" };
  }
  if (field.kind === "choice") {
    const at = Math.max(0, field.options.indexOf(field.value));
    if (LEFT.has(value) || FINE_LEFT.has(value) || COARSE_LEFT.has(value))
      return setChoice(field, at - 1);
    if (RIGHT.has(value) || FINE_RIGHT.has(value) || COARSE_RIGHT.has(value))
      return setChoice(field, at + 1);
    if (HOME.has(value) || value === PAGE_DOWN) return setChoice(field, 0);
    if (END.has(value) || value === PAGE_UP)
      return setChoice(field, field.options.length - 1);
    // 1…9 picks an option by number.
    if (/^[1-9]$/.test(value)) return setChoice(field, Number(value) - 1);
    return { type: "handled" };
  }
  const step = (direction: 1 | -1, size: StepSize) =>
    setNumber(field, stepValue(field, direction, size));
  if (LEFT.has(value)) return step(-1, "normal");
  if (RIGHT.has(value)) return step(1, "normal");
  if (COARSE_LEFT.has(value)) return step(-1, "coarse");
  if (COARSE_RIGHT.has(value)) return step(1, "coarse");
  if (FINE_LEFT.has(value)) return step(-1, "fine");
  if (FINE_RIGHT.has(value)) return step(1, "fine");
  if (value === PAGE_UP) return step(1, "page");
  if (value === PAGE_DOWN) return step(-1, "page");
  if (HOME.has(value)) return setNumber(field, field.min);
  if (END.has(value)) return setNumber(field, field.max);
  if (value === "0" || value === "d") {
    const reset =
      field.reset ??
      (field.start !== undefined ? field.command(field.start) : undefined);
    return reset && field.value !== undefined
      ? { type: "set", command: reset, key: faderKey(field.label) }
      : { type: "handled" };
  }
  if (/^[1-9.]$/.test(value)) {
    state.typing = value === "." ? "0." : value;
    return { type: "handled" };
  }
  return { type: "handled" };
}

/** A click or drag on a field's bar at `position` (0…1). */
export function faderSetPosition(
  state: FaderState,
  field: FaderSpec | undefined,
  position: number,
): FaderResult {
  if (!field) return { type: "handled" };
  state.label = field.label;
  state.typing = undefined;
  if (field.kind === "choice")
    return setChoice(
      field,
      Math.round(position * Math.max(0, field.options.length - 1)),
    );
  return setNumber(field, faderValueAt(field, position));
}

/** A [−] / [+] click or a wheel notch on a field. */
export function faderStep(
  state: FaderState,
  field: FaderSpec | undefined,
  direction: 1 | -1,
  size: StepSize = "normal",
): FaderResult {
  if (!field) return { type: "handled" };
  state.label = field.label;
  state.typing = undefined;
  if (field.kind === "choice") {
    const at = Math.max(0, field.options.indexOf(field.value));
    return setChoice(field, at + direction);
  }
  return setNumber(field, stepValue(field, direction, size));
}

/** A click on one option of a choice field. */
export function faderChoose(
  state: FaderState,
  field: FaderSpec | undefined,
  option: number,
): FaderResult {
  if (!field || field.kind !== "choice") return { type: "handled" };
  state.label = field.label;
  state.typing = undefined;
  return setChoice(field, option);
}

const HINT =
  "←→ adjust · ⇧←→ coarse · [ ] fine · ↑↓ param · 0-9 type · d default · enter keep · esc revert";

/** The drawer's paint model for `fields` (staged) beside `committed`. */
export function drawerView(
  state: FaderState,
  fields: readonly FaderSpec[],
  committed: readonly FaderSpec[],
  options: {
    title: string;
    dirty: boolean;
    status?: string | undefined;
    hint?: string;
  },
): DrawerView {
  const before = new Map(committed.map((field) => [field.label, field]));
  const drawn: DrawerField[] = fields.map((field) => {
    const was = before.get(field.label);
    if (field.kind === "choice") {
      const index = Math.max(0, field.options.indexOf(field.value));
      const committedIndex =
        was?.kind === "choice" && was.value !== field.value
          ? field.options.indexOf(was.value)
          : undefined;
      return {
        kind: "choice",
        label: field.label,
        options: field.options,
        index,
        committedIndex:
          committedIndex !== undefined && committedIndex >= 0
            ? committedIndex
            : undefined,
      };
    }
    const text =
      field.value === undefined
        ? (field.off ?? "off")
        : field.format(field.value);
    const wasText =
      was?.kind === "number"
        ? was.value === undefined
          ? (was.off ?? "off")
          : was.format(was.value)
        : undefined;
    const changed = wasText !== undefined && wasText !== text;
    return {
      kind: "number",
      label: field.label,
      text,
      committed: changed ? wasText : undefined,
      position:
        field.value === undefined
          ? undefined
          : faderPosition(field, field.value),
      committedPosition:
        changed && was?.kind === "number" && was.value !== undefined
          ? faderPosition(field, was.value)
          : undefined,
      minText: field.format(field.min),
      maxText: field.format(field.max),
    };
  });
  return {
    title: options.title,
    fields: drawn,
    focus: focusIndex(state, fields),
    typing: state.typing,
    dirty: options.dirty,
    status: options.status,
    hint: options.hint ?? HINT,
  };
}
