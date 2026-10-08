/**
 * The `master` prompt command: the song master chain (core/master.ts) on the
 * summed mix, and its loudness.
 *
 *   master                                show the chain and target
 *   master <unit>                         list a unit's parameters and presets
 *   master <unit> on|off                  a unit with its defaults, or off
 *   master <unit> reset                   a unit back to its defaults (stays on)
 *   master <unit> preset <name>           load a unit preset
 *   master <unit> <param> <value> […]     set parameters (turns the unit on)
 *   master target <lufs>|<name>|off       integrated loudness target
 *   master <name>                         shorthand for `master target <name>`
 *   master measure                        render and measure the mix
 *   master off                            remove the whole master
 *
 * Units run in a fixed order: eq, glue, tape, width, limiter. A named target
 * (streaming, club, loud, …) also turns the limiter on at that target's
 * ceiling. Each command is one `setMaster` revision and one undo step.
 */
import {
  LOUDNESS_TARGET_NAMES,
  LOUDNESS_TARGETS,
  MASTER_LIMITS,
  MASTER_PRESETS,
  MASTER_SPECS,
  MASTER_UNITS,
  describeMaster,
  isLoudnessTargetName,
  isMasterUnit,
  masterDefaults,
  normalizeMaster,
  type LoudnessTargetName,
  type MasterUnit,
  type SongMaster,
} from "../../core/master.ts";
import { FxValidationError } from "../../core/params.ts";
import { ScoreValidationError, type TrackScore } from "../../core/score.ts";
import type { MixMeasurement } from "../audio/loudness.ts";
import type { MasterReport } from "../audio/master.ts";
import { parseParamValue } from "./fx.ts";

export type MasterCommand =
  | { type: "master-list" }
  | { type: "master-off" }
  | { type: "master-measure" }
  | { type: "master-show"; unit: MasterUnit }
  | { type: "master-unit"; unit: MasterUnit; on: boolean }
  /** Like `fx <effect> reset`: the unit's defaults, kept on. */
  | { type: "master-reset"; unit: MasterUnit }
  | { type: "master-preset"; unit: MasterUnit; preset: string }
  | {
      type: "master-set";
      unit: MasterUnit;
      values: Readonly<Record<string, number | string | boolean>>;
    }
  /** `null` clears the target; a name also sets the limiter's ceiling. */
  | {
      type: "master-target";
      lufs: number | null;
      name?: LoudnessTargetName;
      /** The positive number typed, read as negative LUFS (`14` → -14). */
      flipped?: number;
    };

/** Platform names that mean the `streaming` target. */
const STREAMING_ALIASES = new Set([
  "spotify",
  "youtube",
  "tidal",
  "amazon",
  "deezer",
  "soundcloud",
]);

export function parseMasterCommand(prompt: string): MasterCommand | undefined {
  const words = prompt
    .trim()
    .split(/\s+/)
    .map((word) => word.toLowerCase());
  if (words[0] !== "master" && words[0] !== "/master") return undefined;
  if (prompt.length > 1_024) return undefined;
  const rest = words.slice(1);
  if (rest.length === 0) return { type: "master-list" };
  const head = rest[0]!;
  if (rest.length === 1 && (head === "off" || head === "reset"))
    return { type: "master-off" };
  if (rest.length === 1 && (head === "measure" || head === "meter"))
    return { type: "master-measure" };
  if (rest.length === 1 && isLoudnessTargetName(head)) return target(head);
  // `master spotify` and friends: the streaming target.
  if (rest.length === 1 && STREAMING_ALIASES.has(head))
    return target("streaming");
  // `master on` turns the master on the way most people mean it: the
  // streaming target with its limiter (`master glue on` turns on one unit).
  if (rest.length === 1 && head === "on") return target("streaming");
  // `master -14` is `master target -14`.
  if (rest.length === 1 && /^[-+]?\d+(?:\.\d+)?$/.test(head))
    return target(head);
  if (head === "target" || head === "lufs" || head === "normalize")
    return rest.length === 2 ? target(rest[1]!) : undefined;
  if (!isMasterUnit(head)) return undefined;
  const unit = head;
  if (rest.length === 1) return { type: "master-show", unit };
  if (rest.length === 2 && rest[1] === "reset")
    return { type: "master-reset", unit };
  if (rest.length === 2 && (rest[1] === "on" || rest[1] === "off"))
    return { type: "master-unit", unit, on: rest[1] === "on" };
  // An unknown preset name still parses, so the reply can list the real ones.
  if (rest[1] === "preset")
    return rest.length === 3
      ? { type: "master-preset", unit, preset: rest[2]! }
      : undefined;
  if (rest.length === 2 && isMasterPreset(unit, rest[1]!))
    return { type: "master-preset", unit, preset: rest[1]! };
  const pairs = rest.slice(1);
  if (pairs.length % 2 !== 0) return undefined;
  const values: Record<string, number | string | boolean> = {};
  const params = MASTER_SPECS[unit].params;
  for (let index = 0; index < pairs.length; index += 2) {
    const name = pairs[index]!;
    const spec = Object.prototype.hasOwnProperty.call(params, name)
      ? params[name]
      : undefined;
    if (!spec) return undefined;
    const raw = pairs[index + 1]!;
    // An out-of-range number still parses, so validation can name the range.
    const value =
      parseParamValue(spec, raw) ??
      (/^[-+]?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : undefined);
    if (value === undefined) return undefined;
    values[name] = value;
  }
  return { type: "master-set", unit, values };
}

/** Own preset names only: `constructor` and friends are not presets. */
export function isMasterPreset(unit: MasterUnit, name: string): boolean {
  return Object.hasOwn(MASTER_PRESETS[unit], name);
}

function target(word: string): MasterCommand | undefined {
  if (word === "off" || word === "none")
    return { type: "master-target", lufs: null };
  if (isLoudnessTargetName(word))
    return {
      type: "master-target",
      lufs: LOUDNESS_TARGETS[word].lufs,
      name: word,
    };
  if (!/^[-+]?\d+(?:\.\d+)?$/.test(word)) return undefined;
  // `target 14` means -14 LUFS: loudness targets are always negative, and
  // the reply says so. Out of range still parses, so the reply names it.
  const value = Number(word);
  return value > 0
    ? { type: "master-target", lufs: -value, flipped: value }
    : { type: "master-target", lufs: -Math.abs(value) };
}

export type MasterResult = Readonly<{
  ok: boolean;
  message: string;
  next?: TrackScore;
  kind?: string;
  payload?: Record<string, unknown>;
}>;

/** The master after one command, before validation. */
export function nextMaster(
  master: SongMaster | undefined,
  command: MasterCommand,
): Record<string, unknown> | undefined {
  const draft: Record<string, unknown> = { ...master };
  switch (command.type) {
    case "master-list":
    case "master-measure":
    case "master-show":
      return master;
    case "master-reset":
      draft[command.unit] = masterDefaults(command.unit);
      return draft;
    case "master-off":
      return undefined;
    case "master-unit":
      if (command.on) draft[command.unit] ??= masterDefaults(command.unit);
      else delete draft[command.unit];
      return draft;
    case "master-preset":
      if (!isMasterPreset(command.unit, command.preset)) return master;
      draft[command.unit] = {
        ...masterDefaults(command.unit),
        ...MASTER_PRESETS[command.unit][command.preset],
      };
      return draft;
    case "master-set":
      draft[command.unit] = {
        ...(master?.[command.unit] ?? masterDefaults(command.unit)),
        ...command.values,
      };
      return draft;
    case "master-target":
      if (command.lufs === null) delete draft.target;
      else draft.target = command.lufs;
      if (command.name) {
        const named: { ceiling: number; limiter?: string } =
          LOUDNESS_TARGETS[command.name];
        draft.limiter = {
          ...(master?.limiter ?? masterDefaults("limiter")),
          ...(named.limiter ? MASTER_PRESETS.limiter[named.limiter] : {}),
          ceiling: named.ceiling,
        };
      }
      return draft;
  }
}

export function applyMasterCommand(
  score: TrackScore,
  command: MasterCommand,
): MasterResult {
  if (command.type === "master-list")
    return { ok: true, message: masterSummary(score.master) };
  if (command.type === "master-measure")
    return { ok: false, message: "master measure needs a render" };
  if (command.type === "master-show")
    return { ok: true, message: unitSummary(command.unit, score.master) };
  if (
    command.type === "master-preset" &&
    !isMasterPreset(command.unit, command.preset)
  )
    return {
      ok: false,
      message: `master ${command.unit} · no preset ${command.preset} · presets ${Object.keys(MASTER_PRESETS[command.unit]).join(" ")}`,
    };
  let next: TrackScore;
  try {
    const master = normalizeMaster(nextMaster(score.master, command)) ?? null;
    next = score.withMaster(master);
  } catch (error) {
    if (
      error instanceof ScoreValidationError ||
      error instanceof FxValidationError
    )
      return {
        ok: false,
        message: `master · ${error.message.replace(/^master\s+/, "")}`,
      };
    throw error;
  }
  if (sameMaster(score.master, next.master))
    return { ok: true, message: masterSummary(score.master) };
  const parts = [`master · ${describeMaster(next.master)}`];
  if (command.type === "master-target" && command.flipped !== undefined)
    parts.push(`read ${command.flipped} as ${-command.flipped} LUFS`);
  if (
    next.master?.target !== undefined &&
    !next.master.limiter &&
    next.master.target > -16
  )
    parts.push(
      `no limiter: the gain stops at ${MASTER_LIMITS.safeCeiling} dBTP · master limiter on pushes harder`,
    );
  return {
    ok: true,
    message: parts.join(" · "),
    next,
    kind: "score.master",
    payload: { master: next.master ?? null },
  };
}

function sameMaster(a: SongMaster | undefined, b: SongMaster | undefined) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** `master · off · units eq glue …` or the chain with its target. */
export function masterSummary(master: SongMaster | undefined): string {
  if (!master)
    return `master · off · units ${MASTER_UNITS.join(" ")} · targets ${LOUDNESS_TARGET_NAMES.join(" ")}`;
  return `master · ${describeMaster(master)}`;
}

/**
 * One unit for `master <unit>`: on or off, then every parameter with its
 * current (or default) value, unit and range, then the presets.
 */
export function unitSummary(unit: MasterUnit, master?: SongMaster): string {
  const values = master?.[unit];
  const params = Object.entries(MASTER_SPECS[unit].params).map(
    ([name, spec]) => {
      const value = values?.[name] ?? spec.default;
      if (spec.kind === "number")
        return `${name} ${formatValue(value)}${spec.unit ? ` ${spec.unit}` : ""} (${formatValue(spec.min)}..${formatValue(spec.max)})`;
      if (spec.kind === "enum")
        return `${name} ${String(value)} (${spec.values.join("|")})`;
      return `${name} ${value ? "on" : "off"} (on|off)`;
    },
  );
  return [
    `master ${unit} · ${values ? "on" : "off"}`,
    ...params,
    `presets ${Object.keys(MASTER_PRESETS[unit]).join(" ")}`,
  ].join(" · ");
}

function formatValue(value: number | string | boolean): string {
  return typeof value === "number"
    ? String(Math.round(value * 100) / 100)
    : String(value);
}

const fixed = (value: number, digits = 1) =>
  Number.isFinite(value) ? value.toFixed(digits) : "-∞";

/** `-14.0 LUFS · -1.0 dBTP`: the compact meter. */
export function loudnessLine(
  loudness: Readonly<{
    integrated: number;
    truePeak: number;
    target?: number;
    reached?: boolean;
  }>,
): string {
  const line = `${fixed(loudness.integrated)} LUFS · ${fixed(loudness.truePeak)} dBTP`;
  if (loudness.target === undefined) return line;
  return loudness.reached
    ? `${line} · target ${fixed(loudness.target)} reached`
    : `${line} · target ${fixed(loudness.target)} missed`;
}

/**
 * One line for `master measure` and `dawg render`: loudness, range, peaks,
 * the target outcome, then balance and stereo.
 */
export function measurementLine(
  mix: MixMeasurement,
  report?: MasterReport,
): string {
  const { loudness } = mix;
  const parts = [
    `${fixed(loudness.integrated)} LUFS`,
    `momentary max ${fixed(loudness.momentaryMax)}`,
    `short-term max ${fixed(loudness.shortTermMax)}`,
    `LRA ${fixed(loudness.range)} LU`,
    `${fixed(loudness.truePeak)} dBTP`,
    `PLR ${fixed(mix.plr)}`,
  ];
  if (report?.target !== undefined && !Number.isFinite(report.integrated))
    parts.push(`target ${fixed(report.target)} not applied · silent`);
  else if (report?.target !== undefined)
    parts.push(
      report.reached
        ? `target ${fixed(report.target)} reached`
        : `target ${fixed(report.target)} missed by ${fixed(Math.abs(report.target - report.integrated))} LU${report.integrated < report.target ? " (add master tape or a faster limiter release)" : ""}`,
    );
  const bands = Object.entries(mix.bands)
    .map(([name, db]) => `${name} ${fixed(db, 0)}`)
    .join(" ");
  parts.push(`bands ${bands} dB`);
  parts.push(`correlation ${fixed(mix.correlation, 2)}`);
  return parts.join(" · ");
}
