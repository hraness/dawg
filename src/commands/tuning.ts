/**
 * `/tuning` and `/scale`: song and track tuning, and the scale library.
 *
 *   tuning                          the song and focused track tuning
 *   tuning list                     the library, by family
 *   tuning <name>                   a library tuning (19-edo, just, pelog…)
 *   tuning edo <n>                  n equal steps per octave
 *   tuning ratios 9/8 5/4 … 2/1     just ratios (the last is the period)
 *   tuning cents 204 386 … 1200     cents (the last is the period)
 *   tuning scl <file> [kbm <file>]  a Scala scale (and keyboard map)
 *   tuning kbm <file>|off           a Scala keyboard map
 *   tuning ref <hz>|off             12-TET A4 in Hz that fixes the root (440)
 *   tuning root <note>|auto         the key of degree 0
 *   tuning map linear|nearest       one key per step, or nearest of 12 keys
 *   tuning off                      back to 12-TET
 *   tuning track …                  the same for the focused track
 *                                   (`tuning track off` follows the song)
 *   scale                           the song key
 *   scale list                      the scale library
 *   scale <name>                    keep the tonic, change the scale
 *   scale <tonic> <name>            set the song key (`scale D hijaz`)
 *
 * Scala files live in the project: a path outside it is copied into
 * `tunings/` first (`importTuningFile`).
 */
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  MODE_NAMES,
  SCALES,
  SCALE_NAMES,
  keyName,
  keyUsesFlats,
  noteName,
  parseKey,
  scaleSteps,
  type Key,
  type ScaleInfo,
} from "../../core/chords.ts";
import { midiToPitch, pitchToMidi } from "../../core/pitch.ts";
import {
  applyScoreOperation,
  type TrackScore,
  type Tuning,
} from "../../core/score.ts";
import {
  TUNING_PRESETS,
  TuningError,
  describeTuning,
  normalizeTuning,
  readTuningFiles,
  tuningPreset,
  tuningTable,
  type TuningMap,
} from "../../core/tuning.ts";

export type TuningTarget = "song" | "track";

/** Fields one `/tuning` command changes; `null` clears a field. */
export type TuningPatch = Readonly<{
  name?: string;
  edo?: number;
  ratios?: readonly string[];
  cents?: readonly number[];
  scl?: string;
  kbm?: string | null;
  ref?: number | null;
  root?: number | null;
  map?: TuningMap;
}>;

export type TuningCommand =
  | { type: "tuning-show" }
  | { type: "tuning-list" }
  | { type: "tuning-off"; target: TuningTarget }
  | { type: "tuning-set"; target: TuningTarget; patch: TuningPatch }
  | { type: "scale-show" }
  | { type: "scale-list" }
  /** `key` is a whole key (`D hijaz`); `scale` keeps the song's tonic. */
  | { type: "scale-set"; key?: string; scale?: string };

export type TuningResult = Readonly<{
  ok: boolean;
  message: string;
  next?: TrackScore;
  kind?: string;
  payload?: Record<string, unknown>;
  /** A text panel to open (`tuning list`, `scale list`). */
  panel?: Readonly<{ title: string; lines: readonly string[] }>;
}>;

/** Reads a project file's text, or undefined when it is missing. */
export type ProjectRead = (path: string) => string | undefined;

const TABLE_FIELDS = ["name", "edo", "ratios", "cents", "scl"] as const;

/** Parses `/tuning …` or `/scale …` (slash optional), else undefined. */
export function parseTuningCommand(prompt: string): TuningCommand | undefined {
  if (prompt.length > 2_048) return undefined;
  const words = prompt.trim().replace(/^\//, "").split(/\s+/);
  const verb = words[0]?.toLowerCase();
  if (verb === "scale" || verb === "scales") return parseScale(words.slice(1));
  if (verb !== "tuning" && verb !== "tune" && verb !== "tunings")
    return undefined;
  let rest = words.slice(1);
  if (rest.length === 0) return { type: "tuning-show" };
  if (rest.length === 1 && /^(list|ls)$/i.test(rest[0]!))
    return { type: "tuning-list" };
  let target: TuningTarget = "song";
  if (rest[0]!.toLowerCase() === "track") {
    target = "track";
    rest = rest.slice(1);
    if (rest.length === 0) return { type: "tuning-show" };
  } else if (rest[0]!.toLowerCase() === "song") {
    rest = rest.slice(1);
    if (rest.length === 0) return { type: "tuning-show" };
  }
  const head = rest[0]!.toLowerCase();
  const args = rest.slice(1);
  if (rest.length === 1 && /^(off|none|reset|clear|default)$/.test(head))
    return { type: "tuning-off", target };
  const set = (patch: TuningPatch): TuningCommand => ({
    type: "tuning-set",
    target,
    patch,
  });
  switch (head) {
    case "edo":
    case "tet":
    case "et": {
      const edo = Number(args[0]);
      return args.length === 1 && Number.isInteger(edo)
        ? set({ edo })
        : undefined;
    }
    case "ratios":
    case "ratio":
    case "ji":
      return args.length > 0 ? set({ ratios: args }) : undefined;
    case "cents": {
      const cents = args.map(Number);
      return args.length > 0 && cents.every(Number.isFinite)
        ? set({ cents })
        : undefined;
    }
    case "scl":
    case "scala": {
      if (args.length === 1) return set({ scl: args[0]! });
      if (args.length === 3 && args[1]!.toLowerCase() === "kbm")
        return set({ scl: args[0]!, kbm: args[2]! });
      return undefined;
    }
    case "kbm":
    case "keymap":
      if (args.length !== 1) return undefined;
      return set({ kbm: isOff(args[0]!) ? null : args[0]! });
    case "ref":
    case "a4":
    case "pitch": {
      if (args.length !== 1) return undefined;
      if (isOff(args[0]!)) return set({ ref: null });
      const ref = Number(args[0]!.replace(/hz$/i, ""));
      return Number.isFinite(ref) ? set({ ref }) : undefined;
    }
    case "root": {
      if (args.length !== 1) return undefined;
      if (isOff(args[0]!) || args[0]!.toLowerCase() === "auto")
        return set({ root: null });
      const root = rootKey(args[0]!);
      return root === undefined ? undefined : set({ root });
    }
    case "map":
      return args.length === 1 &&
        (args[0] === "linear" || args[0] === "nearest")
        ? set({ map: args[0] })
        : undefined;
  }
  // Library names first (`19-edo`, `pelog`), then `/tuning 22edo` or `22`.
  const name = rest.join(" ");
  if (tuningPreset(name)) return set({ name });
  const edo = name.match(/^(\d{1,3})(?:[- ]?(?:edo|tet|et))?$/i);
  return edo ? set({ edo: Number(edo[1]) }) : undefined;
}

function parseScale(words: readonly string[]): TuningCommand | undefined {
  if (words.length === 0) return { type: "scale-show" };
  if (words.length === 1 && /^(list|ls)$/i.test(words[0]!))
    return { type: "scale-list" };
  const text = words.join(" ");
  const key = parseKey(text);
  if (key && /^[a-g](#|b|♯|♭)?m?$/i.test(words[0]!))
    return { type: "scale-set", key: keyName(key) };
  return parseKey(`C ${text}`) ? { type: "scale-set", scale: text } : undefined;
}

function isOff(word: string): boolean {
  return /^(off|none|clear|default)$/i.test(word);
}

/** `D4`, `eb3` or a MIDI number 0..127. */
function rootKey(text: string): number | undefined {
  if (/^\d{1,3}$/.test(text)) {
    const key = Number(text);
    return key <= 127 ? key : undefined;
  }
  try {
    const key = pitchToMidi(text);
    return Number.isInteger(key) && key >= 0 && key <= 127 ? key : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Applies a parsed command to `score`. `trackId` is the focused track
 * (`tuning track …`); `read` loads `.scl`/`.kbm` project files.
 */
export function applyTuningCommand(
  score: TrackScore,
  trackId: string,
  command: TuningCommand,
  read: ProjectRead,
): TuningResult {
  switch (command.type) {
    case "tuning-show":
      return { ok: true, message: tuningSummary(score, trackId) };
    case "tuning-list":
      return {
        ok: true,
        message: `${TUNING_PRESETS.length} tunings · tuning <name>`,
        panel: { title: "tunings", lines: tuningLibraryLines() },
      };
    case "scale-show":
      return { ok: true, message: scaleSummary(score.key) };
    case "scale-list":
      return {
        ok: true,
        message: `${MODE_NAMES.length + SCALE_NAMES.length} scales · scale <tonic> <name>`,
        panel: { title: "scales", lines: scaleLibraryLines() },
      };
    case "scale-set":
      return setScale(score, command);
    case "tuning-off":
      return command.target === "song"
        ? songTuning(score, null)
        : trackTuning(score, trackId, null);
    case "tuning-set": {
      const current =
        command.target === "song"
          ? score.tuning
          : score.tracks.find((track) => track.id === trackId)?.tuning;
      if (command.target === "track" && !hasTrack(score, trackId))
        return { ok: false, message: `no track · ${trackId}` };
      const where =
        command.target === "song" ? "song tuning" : `track ${trackId} tuning`;
      let tuning: Tuning | undefined;
      try {
        tuning = mergeTuning(current, command.patch, read, where);
      } catch (error) {
        if (error instanceof TuningError)
          return { ok: false, message: `tuning · ${error.message}` };
        throw error;
      }
      return command.target === "song"
        ? songTuning(score, tuning ?? null)
        : trackTuning(score, trackId, tuning ?? null);
    }
  }
}

/**
 * The tuning after `patch`: a new table replaces the old one and keeps the
 * reference, root, map and keyboard map; Scala files are read again so the
 * project files stay the source of truth.
 */
export function mergeTuning(
  current: Tuning | undefined,
  patch: TuningPatch,
  read: ProjectRead,
  where: string,
): Tuning | undefined {
  const plain: Record<string, unknown> = { ...(current ?? {}) };
  // Resolved fields come back from the files below.
  if (plain.scl !== undefined) {
    delete plain.cents;
    delete plain.ratios;
  }
  delete plain.keymap;
  if (TABLE_FIELDS.some((field) => patch[field] !== undefined))
    for (const field of TABLE_FIELDS) delete plain[field];
  for (const [field, value] of Object.entries(patch)) {
    if (value === null) delete plain[field];
    else plain[field] = value;
  }
  // A keyboard map sets its own reference and root.
  if (patch.kbm) {
    delete plain.ref;
    delete plain.root;
    delete plain.map;
  }
  if ((patch.ref != null || patch.root != null || patch.map) && plain.kbm)
    throw new TuningError(
      `${where}: the keyboard map ${String(plain.kbm)} sets the reference and root (tuning kbm off first)`,
    );
  if (Object.keys(plain).length === 0) return undefined;
  return normalizeTuning(readTuningFiles(plain, read, where), where);
}

function hasTrack(score: TrackScore, trackId: string): boolean {
  return score.tracks.some((track) => track.id === trackId);
}

function songTuning(score: TrackScore, tuning: Tuning | null): TuningResult {
  return {
    ok: true,
    message: `tuning · ${describeTuning(tuning ?? undefined)}`,
    next: applyScoreOperation(score, { type: "setTuning", tuning }),
    kind: "score.tuning",
    payload: { tuning },
  };
}

function trackTuning(
  score: TrackScore,
  trackId: string,
  tuning: Tuning | null,
): TuningResult {
  if (!hasTrack(score, trackId))
    return { ok: false, message: `no track · ${trackId}` };
  return {
    ok: true,
    message: `tuning · ${trackId} · ${tuning ? describeTuning(tuning) : "follows the song"}`,
    next: applyScoreOperation(score, {
      type: "updateTrack",
      trackId,
      patch: { tuning },
    }),
    kind: "score.track",
    payload: { trackId, patch: { tuning } },
  };
}

function setScale(
  score: TrackScore,
  command: Extract<TuningCommand, { type: "scale-set" }>,
): TuningResult {
  let key = command.key ? parseKey(command.key) : undefined;
  if (!key && command.scale) {
    const current = parseKey(score.key ?? undefined);
    const tonic = current
      ? noteName(current.tonic, keyUsesFlats(current))
      : "C";
    key = parseKey(`${tonic} ${command.scale}`);
  }
  if (!key)
    return {
      ok: false,
      message: `scale · unknown scale ${command.scale ?? command.key ?? ""}`,
    };
  const name = keyName(key);
  const info: ScaleInfo | undefined = key.scale ? SCALES[key.scale] : undefined;
  const hint =
    info?.intonation || info?.steps.some((step) => !Number.isInteger(step))
      ? ` · tuning ${key.scale} for its intonation`
      : "";
  return {
    ok: true,
    message: `${scaleSummary(name)}${hint}`,
    next: applyScoreOperation(score, { type: "setKey", key: name }),
    kind: "score.key",
    payload: { key: name },
  };
}

/** `tuning · song 19-edo · lead follows the song`. */
export function tuningSummary(score: TrackScore, trackId: string): string {
  const track = score.tracks.find((item) => item.id === trackId);
  const song = `song ${describeTuning(score.tuning)}`;
  if (!track) return `tuning · ${song}`;
  const own = track.tuning ? describeTuning(track.tuning) : "follows the song";
  return `tuning · ${song} · ${trackId} ${own}`;
}

/** `scale · D bayati · 0 1.5 3 5 7 8 10`. */
export function scaleSummary(key: string | null | undefined): string {
  const parsed = parseKey(key ?? undefined);
  if (!parsed) return "scale · none (C major assumed) · scale <tonic> <name>";
  return `scale · ${keyName(parsed)} · ${scaleSteps(parsed).map(formatStep).join(" ")}`;
}

function formatStep(step: number): string {
  return Number.isInteger(step) ? String(step) : step.toFixed(1);
}

/** One line per library tuning, grouped by family. */
export function tuningLibraryLines(): string[] {
  const lines: string[] = [];
  let family = "";
  for (const preset of TUNING_PRESETS) {
    if (preset.family !== family) {
      family = preset.family;
      if (lines.length > 0) lines.push("");
      lines.push(family);
    }
    const steps = preset.cents.length;
    lines.push(
      `  ${preset.name.padEnd(18)} ${String(steps).padStart(2)} steps · ${preset.about}${preset.approximate ? " (approximate)" : ""}`,
    );
  }
  return lines;
}

/** One line per mode and library scale, grouped by family. */
export function scaleLibraryLines(): string[] {
  const lines = ["modes"];
  for (const mode of MODE_NAMES)
    lines.push(
      `  ${mode.padEnd(18)} ${stepsText(scaleSteps({ tonic: 0, mode } as Key))}`,
    );
  let family = "";
  for (const name of SCALE_NAMES) {
    const info: ScaleInfo = SCALES[name];
    if (info.family !== family) {
      family = info.family;
      lines.push("", family);
    }
    lines.push(`  ${name.padEnd(18)} ${stepsText(info.steps)}`);
  }
  return lines;
}

function stepsText(steps: readonly number[]): string {
  return steps.map(formatStep).join(" ");
}

/** The cents of a tuning's degrees 1..n, for the menu and `/tuning`. */
export function tuningStepsText(tuning: Tuning | undefined): string {
  const table = tuning ? tuningTable(tuning) : undefined;
  if (!table) return "100 200 … 1200";
  const shown = table
    .slice(0, 12)
    .map((cents) => cents.toFixed(1).replace(/\.0$/, ""));
  return table.length > 12 ? `${shown.join(" ")} …` : shown.join(" ");
}

/** The root key as a name (`D4`), for messages. */
export function rootName(root: number | undefined): string {
  return root === undefined ? "auto" : midiToPitch(root);
}

/**
 * Makes a `.scl`/`.kbm` path the user typed into a project path: a file
 * inside `projectRoot` keeps its relative path; one outside is copied into
 * `tunings/` (a numbered name when a different file has the name already).
 */
export async function importTuningFile(
  projectRoot: string,
  cwd: string,
  input: string,
): Promise<string> {
  const extension = input.toLowerCase().endsWith(".kbm") ? ".kbm" : ".scl";
  if (!input.toLowerCase().endsWith(extension))
    throw new TuningError(`${input} must be a ${extension} file`);
  const absolute = isAbsolute(input) ? input : resolve(cwd, input);
  const inside = relative(projectRoot, absolute);
  if (inside && !inside.startsWith("..") && !isAbsolute(inside))
    return inside.split(sep).join("/");
  let text: string;
  try {
    text = await readFile(absolute, "utf8");
  } catch {
    throw new TuningError(`${input} not found`);
  }
  await mkdir(join(projectRoot, "tunings"), { recursive: true });
  const stem = basename(absolute, extension).replace(/[^A-Za-z0-9._-]+/g, "-");
  for (let index = 1; index < 1_000; index++) {
    const name = `${stem}${index === 1 ? "" : `-${index}`}${extension}`;
    const target = join(projectRoot, "tunings", name);
    const existing = await stat(target).catch(() => undefined);
    if (existing) {
      const same = await readFile(target, "utf8").catch(() => undefined);
      if (same !== text) continue;
    } else await copyFile(absolute, target);
    return `tunings/${name}`;
  }
  throw new TuningError(`too many tunings named ${stem}`);
}
