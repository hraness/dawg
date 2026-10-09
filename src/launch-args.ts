/**
 * The `dawg [options]` launch grammar and the small argv contract the plain
 * subcommands share. Pure: no I/O, so every mistake is rejected before
 * `.dawg/` (or any project file) could be written.
 */
export { parseSimpleArgv, type SimpleArgv } from "./argv.ts";
import { parseThemeName, THEME_NAMES, type ThemeName } from "../tui/theme.ts";

/** Subcommands that parse their own argv; the launch grammar skips them. */
export const SUBCOMMANDS: readonly string[] = [
  "login",
  "logout",
  "auth",
  "model",
  "sessions",
  "render",
  "init",
  "check",
  "media",
];
export const VALUE_FLAGS = [
  "--session",
  "--track",
  "--import",
  "--export",
  "--theme",
] as const;
export type ValueFlag = (typeof VALUE_FLAGS)[number];
export const BOOLEAN_FLAGS: readonly string[] = [
  "--new",
  "--demo",
  "--help",
  "-h",
  "--version",
  "-v",
  "--reduce-motion",
  "--no-mouse",
];

/** A `--track` value resolved to the id `/track` would use. */
export type TrackArg = { id: string; name: string };

export type LaunchArgs = {
  subcommand: string | undefined;
  flags: ReadonlySet<string>;
  session: string | undefined;
  track: TrackArg | undefined;
  importPath: string | undefined;
  exportPath: string | undefined;
  theme: ThemeName | undefined;
};

export type LaunchParse =
  { ok: true; args: LaunchArgs } | { ok: false; problem: string };

const TRACK_NAME = /^[a-z0-9._ -]{1,64}$/i;

/**
 * `--track Bass Guitar` → id `bass-guitar`, name `bass guitar`: the rule
 * `/track` applies (letters, digits, `.`, `_`, `-` and spaces, at most 64),
 * lowercased with runs of spaces collapsed. Undefined when invalid.
 */
export function normalizeTrackArg(value: string): TrackArg | undefined {
  const name = value.trim().replace(/\s+/g, " ").toLowerCase();
  if (!TRACK_NAME.test(name)) return undefined;
  // `.` and `..` are path segments, never track ids.
  if (/^\.+$/.test(name)) return undefined;
  return { id: name.replace(/ /g, "-"), name };
}

/** The existing track `arg` names (by id or name), else `arg.id`. */
export function resolveTrackArg(
  tracks: readonly { id: string; name?: string | undefined }[],
  arg: TrackArg,
): string {
  const found =
    tracks.find((track) => track.id === arg.id) ??
    tracks.find((track) => track.id.toLowerCase() === arg.id) ??
    tracks.find((track) => (track.name ?? track.id).toLowerCase() === arg.name);
  return found?.id ?? arg.id;
}

/**
 * Parses `dawg [options]`. A subcommand as the first word ends parsing (the
 * subcommand owns the rest). Value flags need a value that does not start
 * with `-`; each may be given once; `--track` and `--theme` are validated
 * here so a bad value is one line and exit 2, never a stack trace.
 */
export function parseLaunchArgs(argv: readonly string[]): LaunchParse {
  const flags = new Set<string>();
  const values = new Map<ValueFlag, string>();
  const first = argv[0];
  if (first !== undefined && !first.startsWith("-")) {
    if (SUBCOMMANDS.includes(first))
      return { ok: true, args: emptyArgs(first, flags) };
    return { ok: false, problem: `unknown command · ${clip(first)}` };
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if ((VALUE_FLAGS as readonly string[]).includes(arg)) {
      const flag = arg as ValueFlag;
      const value = argv[index + 1];
      if (value === undefined || value.length === 0 || value.startsWith("-"))
        return { ok: false, problem: `${flag} needs a value` };
      if (values.has(flag))
        return { ok: false, problem: `${flag} given twice` };
      values.set(flag, value);
      index += 1;
      continue;
    }
    if (BOOLEAN_FLAGS.includes(arg)) {
      flags.add(arg);
      continue;
    }
    if (arg.startsWith("-"))
      return { ok: false, problem: `unknown option · ${clip(arg)}` };
    return { ok: false, problem: `unknown command · ${clip(arg)}` };
  }
  let track: TrackArg | undefined;
  const trackValue = values.get("--track");
  if (trackValue !== undefined) {
    track = normalizeTrackArg(trackValue);
    if (!track) return { ok: false, problem: "invalid track name" };
  }
  let theme: ThemeName | undefined;
  const themeValue = values.get("--theme");
  if (themeValue !== undefined) {
    theme = parseThemeName(themeValue);
    if (!theme)
      return {
        ok: false,
        problem: `unknown theme ${clip(themeValue)} · ${THEME_NAMES.join(" | ")}`,
      };
  }
  return {
    ok: true,
    args: {
      subcommand: undefined,
      flags,
      session: values.get("--session"),
      track,
      importPath: values.get("--import"),
      exportPath: values.get("--export"),
      theme,
    },
  };
}

function emptyArgs(subcommand: string, flags: Set<string>): LaunchArgs {
  return {
    subcommand,
    flags,
    session: undefined,
    track: undefined,
    importPath: undefined,
    exportPath: undefined,
    theme: undefined,
  };
}

function clip(value: string): string {
  return value.length > 40 ? `${value.slice(0, 40)}…` : value;
}
