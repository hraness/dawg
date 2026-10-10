/**
 * The Euclidean rhythm editor (`/euclid`, or Rhythm in `/menu`): one row per
 * voice of the focused track, Torso T-1 style. Each row shows the voice's
 * step ring unrolled as a grid and the selected parameter; arrows nudge it.
 *
 * Like the edit menu (`src/tui/menu.ts`) the editor is pure: rows are
 * rebuilt from the score on every key and a change is returned as the
 * prompt command it stands for (`euclid hat rotate 3`), which the caller
 * runs through the normal prompt path, so every change is one revision and
 * one undo step and the row's detail teaches the command.
 *
 * Keys: ↑↓ knob (● drum ▲ pulses ■ rotate ◆ velocity) · ←→ (h l + -) turn ·
 * tab / shift-tab (] [) every parameter ·
 * digits type a value · enter add/edit · space loop · x off · f freeze ·
 * esc back.
 *
 * Auditioning (src/tui/audition.ts) works as in the menu: `Space` loops the
 * track, and while it plays every change is staged (heard, not committed);
 * `a` flips A/B, `c` solo ↔ in context, Enter keeps the staged changes as
 * one undo step and Esc reverts them.
 */
import {
  HINTS,
  KEY_BACKSPACE,
  KEY_BACKTAB,
  KEY_DOWN,
  KEY_ENTER,
  KEY_LEFT,
  KEY_RESET,
  KEY_RIGHT,
  KEY_TAB,
  KEY_UP,
} from "../../tui/grammar.ts";
import { DRUM_VOICES, isDrumInstrument } from "../../core/drums.ts";
import {
  DIVISIONS,
  RHYTHM_DEFAULTS,
  RHYTHM_LIMITS,
  rowPattern,
  rowSteps,
  rowSummary,
  type RhythmRow,
} from "../../core/euclid.ts";
import {
  isSamplerInstrument,
  type Track,
  type TrackScore,
} from "../../core/score.ts";
import type { PickerItem } from "../../tui/app.ts";
import { auditionKey, type AuditionKey } from "./audition.ts";
import type { MenuAudition } from "./menu.ts";
import { KNOB_MAPS } from "./knob-map.ts";
import { knobGlyph, KNOBS, nextKnob, type KnobIndex } from "../../tui/knobs.ts";

export type EuclidContext = Readonly<{
  /** The score shown: the staged one while auditioning. */
  score: TrackScore;
  trackId: string;
  /** The audition loop, when the window hosts one (as in the menu). */
  audition?: MenuAudition;
}>;

export type EuclidResult =
  | { type: "handled" }
  | { type: "close" }
  /** Run `command`; `audition` names the voice to play once it lands. */
  | { type: "run"; command: string; audition?: string }
  /** Play `voice` once (no audition loop in this window). */
  | { type: "audition"; voice: string }
  /** Space (loop), `a` (A/B) or `c` (context) for the audition loop. */
  | { type: "loop"; key: AuditionKey }
  /** Commit the staged edits as one operation. */
  | { type: "keep" }
  /** Drop the staged edits. */
  | { type: "revert" }
  | { type: "pass" };

export type EuclidView = Readonly<{
  title: string;
  items: PickerItem[];
  index: number;
  hint: string;
}>;

type Param = Readonly<{
  /** Field name in `RhythmRow` and in the `euclid` grammar. */
  field: keyof RhythmRow & string;
  label: string;
  value: (row: RhythmRow) => number | string;
  /** Next value one step in `direction`, or undefined at a limit. */
  step: (row: RhythmRow, direction: 1 | -1) => number | string | undefined;
}>;

const round = (value: number) => Math.round(value * 1000) / 1000;

function linear(
  field: keyof RhythmRow & string,
  fallback: number,
  size: number,
  min: number,
  max: (row: RhythmRow) => number,
) {
  return (row: RhythmRow, direction: 1 | -1) => {
    const current = (row[field] as number | undefined) ?? fallback;
    const next = round(
      Math.min(max(row), Math.max(min, current + size * direction)),
    );
    return next === current ? undefined : next;
  };
}

function cycle(
  field: "division" | "time",
  fallback: (row: RhythmRow) => string,
) {
  return (row: RhythmRow, direction: 1 | -1) => {
    const current = (row[field] as string | undefined) ?? fallback(row);
    const at = DIVISIONS.indexOf(current);
    // Divisions run fastest to slowest; → makes steps longer.
    const next = DIVISIONS[at < 0 ? 0 : at + direction];
    return next === undefined || next === current ? undefined : next;
  };
}

const division = (row: RhythmRow) => row.division ?? RHYTHM_DEFAULTS.division;

/** The editable parameters, in T-1 order (Shape, then Groove). */
export const EUCLID_PARAMS: readonly Param[] = Object.freeze([
  {
    field: "pulses",
    label: "pulses",
    value: (row) => row.pulses ?? RHYTHM_DEFAULTS.pulses,
    step: linear("pulses", RHYTHM_DEFAULTS.pulses, 1, 0, rowSteps),
  },
  {
    field: "steps",
    label: "steps",
    value: rowSteps,
    step: (row, direction) => {
      const next = Math.min(
        RHYTHM_LIMITS.maxSteps,
        Math.max(1, rowSteps(row) + direction),
      );
      return next === rowSteps(row) ? undefined : next;
    },
  },
  {
    field: "rotate",
    label: "rotate",
    value: (row) => row.rotate ?? 0,
    step: (row, direction) => {
      // Rotation wraps around the ring, so it stays in 0..steps-1.
      const steps = rowSteps(row);
      if (steps <= 1) return undefined;
      const current = (((row.rotate ?? 0) % steps) + steps) % steps;
      return (current + direction + steps) % steps;
    },
  },
  {
    field: "division",
    label: "division",
    value: division,
    step: cycle("division", division),
  },
  {
    field: "repeats",
    label: "repeats",
    value: (row) => row.repeats ?? 0,
    step: linear("repeats", 0, 1, 0, () => RHYTHM_LIMITS.maxRepeats),
  },
  {
    field: "time",
    label: "time",
    value: (row) => row.time ?? division(row),
    step: cycle("time", division),
  },
  {
    field: "pace",
    label: "pace",
    value: (row) => row.pace ?? 0,
    step: linear("pace", 0, 0.1, -1, () => 1),
  },
  {
    field: "ramp",
    label: "ramp",
    value: (row) => row.ramp ?? 0,
    step: linear("ramp", 0, 0.1, -1, () => 1),
  },
  {
    field: "velocity",
    label: "velocity",
    value: (row) => row.velocity ?? RHYTHM_DEFAULTS.velocity,
    step: linear("velocity", RHYTHM_DEFAULTS.velocity, 0.05, 0, () => 1),
  },
  {
    field: "accent",
    label: "accent",
    value: (row) => row.accent ?? 0,
    step: linear("accent", 0, 0.1, 0, () => 1),
  },
  {
    field: "accents",
    label: "accents",
    value: (row) => row.accents ?? 1,
    step: linear(
      "accents",
      1,
      1,
      0,
      (row) => row.pulses ?? RHYTHM_DEFAULTS.pulses,
    ),
  },
  {
    field: "gate",
    label: "gate",
    value: (row) => row.gate ?? 1,
    step: linear(
      "gate",
      1,
      0.25,
      RHYTHM_LIMITS.minGate,
      () => RHYTHM_LIMITS.maxGate,
    ),
  },
  {
    field: "probability",
    label: "probability",
    value: (row) => row.probability ?? 1,
    step: linear("probability", 1, 0.05, 0, () => 1),
  },
  {
    field: "seed",
    label: "seed",
    value: (row) => row.seed ?? 0,
    step: linear("seed", 0, 1, 0, () => RHYTHM_LIMITS.maxSeed),
  },
  {
    field: "swing",
    label: "swing",
    value: (row) => row.swing ?? 0,
    step: linear(
      "swing",
      0,
      0.05,
      -RHYTHM_LIMITS.maxSwing,
      () => RHYTHM_LIMITS.maxSwing,
    ),
  },
  {
    field: "nudge",
    label: "nudge",
    value: (row) => row.nudge ?? 0,
    step: linear(
      "nudge",
      0,
      0.05,
      -RHYTHM_LIMITS.maxNudge,
      () => RHYTHM_LIMITS.maxNudge,
    ),
  },
]);

/** Parameters a grid row has (its steps are explicit). */
const GRID_SKIPS = new Set(["pulses", "steps", "rotate"]);

type Lane = Readonly<{ voice: string; label: string; row?: RhythmRow }>;

/** One lane per drum voice (or sampler voice), plus pitch rows on melodic tracks. */
export function euclidLanes(track: Track): Lane[] {
  const rows = new Map((track.rhythm ?? []).map((row) => [row.voice, row]));
  const lanes: Lane[] = [];
  const seen = new Set<string>();
  const add = (voice: string, label: string) => {
    seen.add(voice);
    const row = rows.get(voice);
    lanes.push(row ? { voice, label, row } : { voice, label });
  };
  if (
    isSamplerInstrument(track.instrument) &&
    track.sampler?.mode === "oneshot"
  )
    for (const voice of Object.keys(track.sampler.voices).sort())
      add(voice, voice);
  else if (isDrumInstrument(track.instrument))
    for (const info of DRUM_VOICES) add(info.voice, info.label);
  for (const row of track.rhythm ?? [])
    if (!seen.has(row.voice)) add(row.voice, row.voice);
  return lanes;
}

/** `x...x...` with accents as `X`, rests as `·`. */
export function ringText(row: RhythmRow | undefined): string {
  if (!row) return "·".repeat(RHYTHM_DEFAULTS.steps);
  const pattern = rowPattern(row);
  const grid = row.grid;
  return pattern
    .map((on, index) => (on ? (grid?.[index] === "X" ? "X" : "x") : "·"))
    .join("");
}

/**
 * The four knobs (KNOB_MAPS.euclid): blue `drum` picks the row, the others
 * name EUCLID_PARAMS fields.
 */
const EUCLID_KNOBS = KNOB_MAPS.euclid!;

/** After the strip, the knob keys, then the way out; fitHint drops the knob keys first. */
const KNOB_KEYS = "↑↓ knob · ←→ turn · esc back · ? keys";

/** The knob that turns `param`, if one does. */
function knobOfParam(param: number): KnobIndex | undefined {
  const at = EUCLID_KNOBS.indexOf(EUCLID_PARAMS[param]!.field);
  return at < 0 ? undefined : (at as KnobIndex);
}

/** EUCLID_PARAMS index a knob turns; undefined for the drum knob. */
function paramOfKnob(knob: KnobIndex): number | undefined {
  const field = EUCLID_KNOBS[knob];
  const at = EUCLID_PARAMS.findIndex((param) => param.field === field);
  return at < 0 ? undefined : at;
}

/** Tab ] next field, shift-tab [ previous (the brackets are the old keys). */
const isNextField = (value: string) => KEY_TAB.has(value) || value === "]";
const isPrevField = (value: string) => KEY_BACKTAB.has(value) || value === "[";

export class EuclidEditor {
  private visible = false;
  private lane = 0;
  private param = 0;
  /** True while the blue knob (which drum) has focus, not a field. */
  private onDrum = true;
  private entry: string | undefined;
  /** Where Esc returns to (`menu` when opened from `/menu`). */
  private origin: string | undefined;

  get open(): boolean {
    return this.visible;
  }

  /** Where the editor was opened from, for Esc to return there. */
  /** True while a value is being typed. */
  get typing(): boolean {
    return this.entry !== undefined;
  }

  get returnTo(): string | undefined {
    return this.origin;
  }

  show(context: EuclidContext, voice?: string, origin?: string): void {
    this.visible = true;
    this.entry = undefined;
    this.origin = origin;
    const lanes = this.lanes(context);
    const at = voice ? lanes.findIndex((lane) => lane.voice === voice) : -1;
    // Opened on a named drum, the green knob (pulses) has focus; otherwise
    // the blue one, to pick the drum.
    this.onDrum = at < 0;
    if (!this.onDrum) this.param = paramOfKnob(1) ?? 0;
    if (at >= 0) this.lane = at;
    else {
      // Land on the first voice that already has a row.
      const first = lanes.findIndex((lane) => lane.row);
      this.lane = Math.max(0, Math.min(this.lane, lanes.length - 1), first);
      if (first >= 0) this.lane = first;
    }
  }

  close(): void {
    this.visible = false;
    this.entry = undefined;
  }

  private lanes(context: EuclidContext): Lane[] {
    const track = context.score.tracks.find((t) => t.id === context.trackId);
    return track ? euclidLanes(track) : [];
  }

  /** Voice under the cursor. */
  selectedVoice(context: EuclidContext): string | undefined {
    const lanes = this.lanes(context);
    return lanes[Math.min(this.lane, lanes.length - 1)]?.voice;
  }

  /** Parameter under the cursor (`drum` on the blue knob). */
  get selectedParam(): string {
    return this.onDrum ? "drum" : EUCLID_PARAMS[this.param]!.field;
  }

  /** The knob with focus; undefined on a field no knob turns. */
  get selectedKnob(): KnobIndex | undefined {
    return this.onDrum ? 0 : knobOfParam(this.param);
  }

  key(value: string, context: EuclidContext): EuclidResult {
    if (!this.visible) return { type: "pass" };
    if (value === "\u0003" || value === "\u000c") return { type: "pass" };
    const lanes = this.lanes(context);
    if (lanes.length > 0) this.lane = Math.min(this.lane, lanes.length - 1);
    const lane = lanes[this.lane];
    const param = EUCLID_PARAMS[this.param]!;
    if (this.entry !== undefined) {
      if (value === "\u001b") {
        this.entry = undefined;
        return { type: "handled" };
      }
      if (KEY_BACKSPACE.has(value)) {
        this.entry = this.entry.slice(0, -1);
        return { type: "handled" };
      }
      if (KEY_ENTER.has(value)) {
        const text = this.entry.trim();
        this.entry = undefined;
        if (this.onDrum || !lane || !/^-?[0-9./tT]+$/.test(text))
          return { type: "handled" };
        return {
          type: "run",
          command: `euclid ${lane.voice} ${param.field} ${text}`,
          audition: lane.voice,
        };
      }
      if (/^[0-9./tT-]$/.test(value))
        this.entry = (this.entry + value).slice(0, 12);
      return { type: "handled" };
    }
    const audition = context.audition;
    if (value === "\u001b")
      return audition?.dirty ? { type: "revert" } : { type: "close" };
    const loopKey = audition ? auditionKey(value) : undefined;
    if (loopKey) return { type: "loop", key: loopKey };
    // ↑↓ pick a knob (design §8.7); from a field no knob turns, ↑ lands
    // on orange and ↓ on blue.
    if (KEY_UP.has(value) || KEY_DOWN.has(value)) {
      const up = KEY_UP.has(value);
      const from = this.selectedKnob;
      const knob =
        from === undefined
          ? up
            ? 3
            : 0
          : nextKnob(from, up ? -1 : 1, (index) =>
              index === 0 ? true : paramOfKnob(index) !== undefined,
            );
      this.onDrum = knob === 0;
      if (!this.onDrum) this.param = paramOfKnob(knob) ?? this.param;
      return { type: "handled" };
    }
    // Tab walks every field (the full list behind the knobs).
    if (isNextField(value) || isPrevField(value)) {
      const direction = isNextField(value) ? 1 : -1;
      if (this.onDrum) {
        this.onDrum = false;
        this.param = direction > 0 ? 0 : EUCLID_PARAMS.length - 1;
      } else
        this.param =
          (this.param + direction + EUCLID_PARAMS.length) %
          EUCLID_PARAMS.length;
      return { type: "handled" };
    }
    if (!lane) return { type: "handled" };
    if (value === " ") return { type: "audition", voice: lane.voice };
    if (this.onDrum && (KEY_LEFT.has(value) || KEY_RIGHT.has(value))) {
      // The blue knob turns which drum row has focus.
      if (lanes.length)
        this.lane =
          (this.lane + (KEY_RIGHT.has(value) ? 1 : -1) + lanes.length) %
          lanes.length;
      return { type: "handled" };
    }
    if (KEY_LEFT.has(value) || KEY_RIGHT.has(value)) {
      const direction = KEY_RIGHT.has(value) ? 1 : -1;
      const row: RhythmRow = lane.row ?? { voice: lane.voice };
      if (row.grid !== undefined && GRID_SKIPS.has(param.field)) {
        // A nudge on a grid row's shape turns it back into E(pulses, steps).
        const pulses = [...row.grid].filter((c) => c !== ".").length;
        return {
          type: "run",
          command: `euclid ${lane.voice} ${pulses} ${row.grid.length}`,
          audition: lane.voice,
        };
      }
      const next = param.step(row, direction);
      if (next === undefined) return { type: "handled" };
      return {
        type: "run",
        command: `euclid ${lane.voice} ${param.field} ${next}`,
        audition: lane.voice,
      };
    }
    if (/^[0-9]$/.test(value) && !this.onDrum) {
      this.entry = value;
      return { type: "handled" };
    }
    if (KEY_ENTER.has(value)) {
      if (audition?.dirty) return { type: "keep" };
      if (!lane.row)
        return {
          type: "run",
          command: `euclid ${lane.voice} ${RHYTHM_DEFAULTS.pulses} ${RHYTHM_DEFAULTS.steps}`,
          audition: lane.voice,
        };
      if (!this.onDrum) this.entry = "";
      return { type: "handled" };
    }
    if (KEY_RESET.has(value))
      return lane.row
        ? { type: "run", command: `euclid ${lane.voice} off` }
        : { type: "handled" };
    if (value === "f")
      return lane.row
        ? { type: "run", command: `euclid ${lane.voice} freeze` }
        : { type: "handled" };
    // Swallow other printable keys so nothing leaks into the prompt.
    return { type: "handled" };
  }

  /**
   * The knob strip for the hint row: `●›kick ▲ pulses 4 ■ rotate 0 ◆ velocity
   * 0.8`, the focused knob marked `›`. Glyphs carry which knob is which.
   */
  private strip(drum: string | undefined, row: RhythmRow | undefined): string {
    const focused = this.selectedKnob;
    return KNOBS.map((knob) => {
      const mark = knob.index === focused ? "›" : " ";
      if (knob.index === 0) return `${knob.glyph}${mark}${drum ?? "·"}`;
      const at = paramOfKnob(knob.index);
      if (at === undefined) return `${knob.glyph} ·`;
      const param = EUCLID_PARAMS[at]!;
      const shown = row ? formatValue(param.value(row)) : "—";
      return `${knob.glyph}${mark}${param.label} ${shown}`;
    }).join(" ");
  }

  view(context: EuclidContext): EuclidView {
    const lanes = this.lanes(context);
    const index = Math.max(0, Math.min(this.lane, lanes.length - 1));
    const param = EUCLID_PARAMS[this.param]!;
    const width = Math.max(5, ...lanes.map((lane) => lane.label.length));
    const audition = context.audition;
    // Changed rows show `staged ← committed`, as in the menu.
    const before = new Map<string, string>();
    if (audition?.dirty)
      for (const lane of this.lanes({ ...context, score: audition.committed }))
        before.set(lane.voice, lane.row ? rowSummary(lane.row) : "off");
    const items: PickerItem[] = lanes.map((lane, at) => {
      const row = lane.row;
      const shown = row
        ? row.grid !== undefined && GRID_SKIPS.has(param.field)
          ? "grid"
          : formatValue(param.value(row))
        : "—";
      const now = row ? rowSummary(row) : "off";
      const was = before.get(lane.voice);
      const changed = was !== undefined && was !== now ? ` ← ${was}` : "";
      return {
        label: `${lane.label.padEnd(width)} ${ringText(row)}`,
        detail: row
          ? `${now}${changed} · ${param.label} ${shown}`
          : changed
            ? `off${changed}`
            : "enter adds E(4,16)",
        value: String(at),
        current: row !== undefined,
      };
    });
    const voice = lanes[index]?.voice ?? "";
    const row = lanes[index]?.row;
    const value = row ? formatValue(param.value(row)) : "—";
    const focus = this.onDrum
      ? `${knobGlyph(0, true)} drum`
      : `${param.label} ${value}`;
    let title = `rhythm › ${context.trackId}${voice ? ` · ${voice}` : ""} · ${focus}`;
    if (this.entry !== undefined) title += ` · ${param.label}: ${this.entry}▏`;
    if (audition?.dirty) title = `● ${title}`;
    if (audition?.status && this.entry === undefined)
      title += ` · ${audition.status}`;
    const hint =
      this.entry !== undefined
        ? HINTS.typing
        : audition && (audition.looping || audition.dirty)
          ? audition.hint
          : `${this.strip(lanes[index]?.label.trim(), row)} · ${KNOB_KEYS}`;
    return {
      title,
      items: items.length
        ? items
        : [
            {
              label: "no voices · instrument kit makes a drum track",
              value: "none",
            },
          ],
      index,
      hint,
    };
  }
}

function formatValue(value: number | string): string {
  return typeof value === "number" ? String(round(value)) : value;
}
