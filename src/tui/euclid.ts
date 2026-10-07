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
 * Keys: ↑↓ voice · ←→ (h l + -) nudge · tab / shift-tab (] [) parameter ·
 * digits type a value · enter add/edit · space audition · x off · f freeze ·
 * esc back.
 */
import { HINTS } from "../../tui/grammar.ts";
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

export type EuclidContext = Readonly<{ score: TrackScore; trackId: string }>;

export type EuclidResult =
  | { type: "handled" }
  | { type: "close" }
  /** Run `command`; `audition` names the voice to play once it lands. */
  | { type: "run"; command: string; audition?: string }
  | { type: "audition"; voice: string }
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

const KEY_UP = new Set(["\u001b[A", "\u001bOA", "k"]);
const KEY_DOWN = new Set(["\u001b[B", "\u001bOB", "j"]);
const KEY_LEFT = new Set(["\u001b[D", "\u001bOD", "h", "-", "_"]);
const KEY_RIGHT = new Set(["\u001b[C", "\u001bOC", "l", "+", "="]);
const KEY_NEXT_PARAM = new Set(["\t", "]"]);
const KEY_PREV_PARAM = new Set(["\u001b[Z", "["]);
const KEY_ENTER = new Set(["\r", "\n"]);
const KEY_BACKSPACE = new Set(["\u007f", "\b"]);
const KEY_OFF = new Set(["x", "\u001b[3~"]);

export class EuclidEditor {
  private visible = false;
  private lane = 0;
  private param = 0;
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

  /** Parameter under the cursor. */
  get selectedParam(): string {
    return EUCLID_PARAMS[this.param]!.field;
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
        if (!lane || !/^-?[0-9./tT]+$/.test(text)) return { type: "handled" };
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
    if (value === "\u001b") return { type: "close" };
    if (KEY_UP.has(value) || KEY_DOWN.has(value)) {
      if (lanes.length)
        this.lane =
          (this.lane + (KEY_UP.has(value) ? -1 : 1) + lanes.length) %
          lanes.length;
      return { type: "handled" };
    }
    if (KEY_NEXT_PARAM.has(value) || KEY_PREV_PARAM.has(value)) {
      const direction = KEY_NEXT_PARAM.has(value) ? 1 : -1;
      this.param =
        (this.param + direction + EUCLID_PARAMS.length) % EUCLID_PARAMS.length;
      return { type: "handled" };
    }
    if (!lane) return { type: "handled" };
    if (value === " ") return { type: "audition", voice: lane.voice };
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
    if (/^[0-9]$/.test(value)) {
      this.entry = value;
      return { type: "handled" };
    }
    if (KEY_ENTER.has(value)) {
      if (!lane.row)
        return {
          type: "run",
          command: `euclid ${lane.voice} ${RHYTHM_DEFAULTS.pulses} ${RHYTHM_DEFAULTS.steps}`,
          audition: lane.voice,
        };
      this.entry = "";
      return { type: "handled" };
    }
    if (KEY_OFF.has(value))
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

  view(context: EuclidContext): EuclidView {
    const lanes = this.lanes(context);
    const index = Math.max(0, Math.min(this.lane, lanes.length - 1));
    const param = EUCLID_PARAMS[this.param]!;
    const width = Math.max(5, ...lanes.map((lane) => lane.label.length));
    const items: PickerItem[] = lanes.map((lane, at) => {
      const row = lane.row;
      const shown = row
        ? row.grid !== undefined && GRID_SKIPS.has(param.field)
          ? "grid"
          : formatValue(param.value(row))
        : "—";
      return {
        label: `${lane.label.padEnd(width)} ${ringText(row)}`,
        detail: row
          ? `${rowSummary(row)} · ${param.label} ${shown}`
          : "enter adds E(4,16)",
        value: String(at),
        current: row !== undefined,
      };
    });
    const voice = lanes[index]?.voice ?? "";
    const row = lanes[index]?.row;
    const value = row ? formatValue(param.value(row)) : "—";
    let title = `rhythm › ${context.trackId}${voice ? ` · ${voice}` : ""} · ${param.label} ${value}`;
    if (this.entry !== undefined) title += ` · ${param.label}: ${this.entry}▏`;
    const hint = this.entry !== undefined ? HINTS.typing : HINTS.euclid;
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
