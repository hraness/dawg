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
import type { KnobIndex } from "../../tui/knobs.ts";
import {
  KEY_BACKSPACE,
  KEY_BACKTAB,
  KEY_COARSE_LEFT,
  KEY_COARSE_RIGHT,
  KEY_DOWN,
  KEY_END,
  KEY_ENTER,
  KEY_FINE_LEFT,
  KEY_FINE_RIGHT,
  KEY_HOME,
  KEY_LEFT,
  KEY_PAGE_DOWN,
  KEY_PAGE_UP,
  KEY_RESET,
  KEY_RIGHT,
  KEY_TAB,
  KEY_UP,
} from "../../tui/grammar.ts";

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
  /** The command `x` / `d` / Delete runs to put the value back. */
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
  /** The field that just snapped onto a detent: flashes for one frame. */
  flash?: string | undefined;
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

/**
 * Detents: values a fader catches on its way past, so the common resting
 * points are easy to hit by feel. Volume 1 (0 dB), pan 0 (center), whole
 * BPM, mix 0 / 0.5 / 1 and filter cutoffs on the octaves of A (27.5 Hz,
 * 55 Hz … 14080 Hz). Read off the field's command, so every row that runs
 * `volume`, `pan`, `tempo`, `… mix` or a cutoff gets them.
 */
export type Detents = readonly number[] | "integer";

/** How close (as a share of the bar) a value must be to catch a detent. */
export const DETENT_REACH = 0.02;

const A_OCTAVES = Object.freeze(
  Array.from({ length: 10 }, (_, octave) => 27.5 * 2 ** octave),
);

export function detentsFor(spec: FaderNumber): Detents | undefined {
  const probe = spec.value ?? spec.start ?? spec.min;
  const command = spec.command(probe).replace(/\s+\S+$/, "");
  const words = command.split(/\s+/);
  const verb = words[0]?.replace(/^\//, "");
  if (verb === "tempo" && words.length === 1) return "integer";
  if (words.includes("volume")) return [1];
  if (words.includes("pan")) return [0];
  if (words.at(-1) === "mix") return [0, 0.5, 1];
  if (/^(cutoff|lpf|hpf)$/.test(words.at(-1) ?? "")) return A_OCTAVES;
  return undefined;
}

/** The detents of `spec` that fall inside its range. */
function detentList(spec: FaderNumber, detents: Detents): number[] {
  if (detents === "integer") return [];
  return detents.filter((d) => d >= spec.min - 1e-9 && d <= spec.max + 1e-9);
}

/**
 * `value` caught by a detent, or undefined when none is in reach. With
 * `from` (a key step) a detent also catches a step that jumps over it or
 * lands near it while moving toward it, so leaving a detent never sticks.
 */
export function detentSnap(
  spec: FaderNumber,
  value: number,
  from?: number,
): number | undefined {
  const detents = detentsFor(spec);
  if (!detents) return undefined;
  if (detents === "integer") {
    const whole = Math.min(spec.max, Math.max(spec.min, Math.round(value)));
    return Math.abs(whole - value) < 1e-9 ? undefined : whole;
  }
  const at = (v: number) => faderPosition(spec, v);
  let best: number | undefined;
  for (const detent of detentList(spec, detents)) {
    // Landing on a detent exactly counts as a catch (it flashes) unless
    // the value was already there.
    if (Math.abs(detent - value) < 1e-9)
      return from !== undefined && Math.abs(detent - from) > 1e-9
        ? detent
        : undefined;
    const near = Math.abs(at(value) - at(detent)) <= DETENT_REACH;
    let caught = near;
    if (from !== undefined) {
      const toward = Math.sign(detent - from) === Math.sign(value - from);
      const crossed =
        (from < detent && detent < value) || (value < detent && detent < from);
      caught = Math.abs(detent - from) > 1e-9 && (crossed || (near && toward));
    }
    if (
      caught &&
      (best === undefined ||
        Math.abs(at(detent) - at(from ?? value)) <
          Math.abs(at(best) - at(from ?? value)))
    )
      best = detent;
  }
  return best;
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

/** ↑ and shift-tab: the previous param; ↓ and tab: the next. */
const isUp = (value: string) => KEY_UP.has(value) || KEY_BACKTAB.has(value);
const isDown = (value: string) => KEY_DOWN.has(value) || KEY_TAB.has(value);

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

/**
 * Set `value`, caught by a detent unless the step is fine. `from` is the
 * value a key step left (undefined for a drag or a click on the bar).
 */
function setSnapped(
  state: FaderState,
  spec: FaderNumber,
  value: number,
  from: number | undefined,
  size: StepSize | "drag",
): FaderResult {
  const snapped =
    size === "fine"
      ? undefined
      : size === "drag"
        ? (detentSnap(spec, value) ??
          (spec.value !== undefined &&
          detentSnap(spec, value, spec.value) === value
            ? value
            : undefined))
        : detentSnap(spec, value, from);
  const result = setNumber(spec, snapped ?? value);
  if (snapped !== undefined && result.type === "set") state.flash = spec.label;
  return result;
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
    if (KEY_BACKSPACE.has(value)) {
      state.typing = state.typing.slice(0, -1);
      if (!state.typing) state.typing = undefined;
      return { type: "handled" };
    }
    if (KEY_ENTER.has(value) || KEY_TAB.has(value)) {
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
  if (KEY_ENTER.has(value))
    return options.dirty ? { type: "keep" } : { type: "close" };
  const move = isUp(value) ? -1 : isDown(value) ? 1 : 0;
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
    if (
      KEY_LEFT.has(value) ||
      KEY_FINE_LEFT.has(value) ||
      KEY_COARSE_LEFT.has(value)
    )
      return setChoice(field, at - 1);
    if (
      KEY_RIGHT.has(value) ||
      KEY_FINE_RIGHT.has(value) ||
      KEY_COARSE_RIGHT.has(value)
    )
      return setChoice(field, at + 1);
    if (KEY_HOME.has(value) || KEY_PAGE_DOWN.has(value))
      return setChoice(field, 0);
    if (KEY_END.has(value) || KEY_PAGE_UP.has(value))
      return setChoice(field, field.options.length - 1);
    // 1…9 picks an option by number.
    if (/^[1-9]$/.test(value)) return setChoice(field, Number(value) - 1);
    return { type: "handled" };
  }
  const step = (direction: 1 | -1, size: StepSize) =>
    setSnapped(
      state,
      field,
      stepValue(field, direction, size),
      field.value,
      size,
    );
  if (KEY_LEFT.has(value)) return step(-1, "normal");
  if (KEY_RIGHT.has(value)) return step(1, "normal");
  if (KEY_COARSE_LEFT.has(value)) return step(-1, "coarse");
  if (KEY_COARSE_RIGHT.has(value)) return step(1, "coarse");
  if (KEY_FINE_LEFT.has(value)) return step(-1, "fine");
  if (KEY_FINE_RIGHT.has(value)) return step(1, "fine");
  if (KEY_PAGE_UP.has(value)) return step(1, "page");
  if (KEY_PAGE_DOWN.has(value)) return step(-1, "page");
  if (KEY_HOME.has(value)) return setNumber(field, field.min);
  if (KEY_END.has(value)) return setNumber(field, field.max);
  // x, d and Delete put the value back; 0-9 and . start typing.
  if (KEY_RESET.has(value)) {
    const reset =
      field.reset ??
      (field.start !== undefined ? field.command(field.start) : undefined);
    return reset && field.value !== undefined
      ? { type: "set", command: reset, key: faderKey(field.label) }
      : { type: "handled" };
  }
  if (/^[0-9.]$/.test(value)) {
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
  return setSnapped(
    state,
    field,
    faderValueAt(field, position),
    undefined,
    "drag",
  );
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
  return setSnapped(
    state,
    field,
    stepValue(field, direction, size),
    field.value,
    size,
  );
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

/**
 * Most important first: fitHint trims the middle from the right, so at 80
 * columns the coarse and fine steps go before `enter keep` or `x reset`.
 */
export const FADER_HINT =
  "←→ adjust · enter keep · x reset · 0-9 type · ↑↓ param · ⇧←→ coarse · [ ] fine · esc revert";

/**
 * The hint for a field the loop cannot stage (tempo, meter, loop length):
 * each step is a new revision, so there is nothing to keep or revert.
 */
/** The knob front page (design §8.6): the four knobs, then Tab for all. */
export const KNOB_FADER_HINT =
  "↑↓ knob · ←→ turn · tab all · enter keep · ⇧ coarse · x reset · esc revert";

/** Every param behind Tab: Tab goes back to the four knobs. */
export const ALL_FADER_HINT =
  "←→ adjust · ↑↓ param · tab knobs · enter keep · ⇧ coarse · x reset · esc revert";

export const FADER_HINT_AT_ONCE =
  "←→ adjust · applies at once · x reset · 0-9 type · ↑↓ param · ⇧←→ coarse · [ ] fine · esc back";

/** The value a field's next step starts from (for checking what it runs). */
export function faderCommand(field: FaderSpec): string {
  if (field.kind === "choice") return field.command(field.value);
  return field.command(field.value ?? field.start ?? field.min);
}

/** The drawer's paint model for `fields` (staged) beside `committed`. */
export function drawerView(
  state: FaderState,
  fields: readonly FaderSpec[],
  committed: readonly FaderSpec[],
  options: {
    title: string;
    dirty: boolean;
    /** How many edits are staged (defaults to 1 while dirty). */
    staged?: number | undefined;
    status?: string | undefined;
    hint?: string;
    /** The focused field applies at once (cannot stage on the loop). */
    atOnce?: boolean | undefined;
    /** The drawer has a knob page: which side of Tab is up. */
    knobs?: "knobs" | "all" | undefined;
  },
): DrawerView {
  const before = new Map(committed.map((field) => [field.label, field]));
  // A detent flash lasts one view: consume it here.
  const flash = state.flash;
  state.flash = undefined;
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
        knob: knobOf(field),
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
      knob: knobOf(field),
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
      ...(flash === field.label && field.value !== undefined
        ? { flash: detentLabel(field, field.value) }
        : {}),
    };
  });
  const staged = options.staged ?? (options.dirty ? 1 : 0);
  return {
    title: options.title,
    fields: drawn,
    focus: focusIndex(state, fields),
    typing: state.typing,
    dirty: options.dirty,
    badge: options.dirty ? stagedBadge(staged) : undefined,
    status: options.status,
    hint:
      options.hint ??
      (options.knobs
        ? (options.knobs === "knobs" ? KNOB_FADER_HINT : ALL_FADER_HINT)
            .replace(
              "enter keep",
              options.atOnce ? "applies at once" : "enter keep",
            )
            .replace("esc revert", options.atOnce ? "esc back" : "esc revert")
        : options.atOnce
          ? FADER_HINT_AT_ONCE
          : FADER_HINT),
  };
}

/** A knob field's knob (0 blue … 3 orange); plain rows have none. */
function knobOf(field: FaderSpec): KnobIndex | undefined {
  const knob = (field as FaderSpec & { knob?: KnobIndex }).knob;
  return knob;
}

/** `A/B: 1 change staged · enter keep · esc revert`. */
export function stagedBadge(count: number): string {
  const n = Math.max(1, count);
  return `A/B: ${n} change${n === 1 ? "" : "s"} staged · enter keep · esc revert`;
}

/** The faint word a detent flashes: `0 dB`, `center`, or the value. */
export function detentLabel(spec: FaderNumber, value: number): string {
  const text = spec.format(value);
  // Volume formats as `1 · 0.0 dB`; the flash names the detent itself.
  const db = /(-?[\d.]+) dB$/.exec(text);
  if (db && Number(db[1]) === 0) return "0 dB";
  return text;
}
