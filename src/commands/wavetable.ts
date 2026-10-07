/**
 * Wavetable commands (prompt grammar, menu and agent share these):
 *
 *   wt                      show the focused track's table and parameters
 *   wt list                 built-in tables and the uzu-wavetables sets
 *   wt <table>              play a table: basic, pwm, formant, harmonics,
 *                           wt_digital:2 (Strudel's uzu-wavetables), any
 *                           pack:<pack>/<sound>[:<n>], or a project WAV
 *                           (vox.wav, wavetables/vox.wav, tracks/x/…/vox.wav;
 *                           the agent's make_wavetable writes these)
 *   wt <0..1>               position
 *   wtenv|wtattack|wtdecay|wtsustain|wtrelease|wtrate|wtdepth|warp|wtphaserand <n>
 *   warpmode <none|asym|bendp|bendm|bendmp|sync|quant>
 *
 * Any of these turns the focused track into a wavetable track. Parsing is
 * pure; picking a pack table pins it (sha256 + url) through the PackStore.
 */
import {
  BUILTIN_TABLE_PREFIX,
  WARP_MODES,
  WAVETABLE_INSTRUMENT,
  WAVETABLE_PARAMS,
  SCORE_LIMITS,
  isLocalTableSrc,
  isWavetableInstrument,
  normalizeWavetable,
  wavetableOf,
  type ScoreOperation,
  type TrackScore,
  type TrackWavetable,
  type WarpMode,
  type WavetableParam,
} from "../../core/score.ts";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { trackDirectories } from "../../core/sdk/print.ts";
import { resolveReadPath } from "../agent/workspace.ts";
import { PackError, type PackStore } from "../audio/packs.ts";
import {
  BUILTIN_TABLES,
  BUILTIN_TABLE_NAMES,
  wavetableFromWav,
} from "../audio/wavetable.ts";

/** The pack Strudel's `wt_` sounds come from. */
export const WAVETABLE_PACK = "uzu-wavetables";

/**
 * Table names in uzu-wavetables' strudel.json (read 2026-10), for the menu,
 * which cannot wait on a fetch. `wt list` reads the live manifest.
 */
export const UZU_WAVETABLES: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    wt_digital: ["bad_day", "basique", "crickets", "curses", "echoes"],
    wt_vgame: Array.from({ length: 11 }, (_, i) => `vgame${10 + i}`),
  });

export type WavetableCommand =
  | Readonly<{ kind: "show" }>
  | Readonly<{ kind: "list" }>
  | Readonly<{ kind: "table"; table: string }>
  | Readonly<{ kind: "param"; param: WavetableParam; value: number }>
  | Readonly<{ kind: "warpmode"; mode: WarpMode }>
  | Readonly<{ kind: "usage"; message: string }>;

const PARAM_WORDS = Object.keys(WAVETABLE_PARAMS).filter(
  (name) => name !== "wt",
) as WavetableParam[];
const NUMBER = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;

export function parseWavetableCommand(
  command: string,
): WavetableCommand | undefined {
  const parsed = parseWords(command.trim().replace(/^\//, ""));
  // Without a slash, only well-formed commands are ours; anything else
  // ("warp the bass up") is a prompt for the agent.
  if (parsed?.kind === "usage" && !command.trim().startsWith("/"))
    return undefined;
  return parsed;
}

function parseWords(text: string): WavetableCommand | undefined {
  const words = text.split(/\s+/);
  const head = words[0]!.toLowerCase();
  if (head === "wavetable" || head === "wt") {
    if (words.length === 1) return { kind: "show" };
    if (words.length !== 2)
      return { kind: "usage", message: "wt <table> | wt <0..1> | wt list" };
    const arg = words[1]!;
    if (/^(list|ls)$/i.test(arg)) return { kind: "list" };
    if (NUMBER.test(arg)) {
      const value = Number(arg);
      if (value < 0 || value > 1)
        return { kind: "usage", message: "wt position is 0..1" };
      return { kind: "param", param: "wt", value };
    }
    return { kind: "table", table: arg };
  }
  if (head === "warpmode") {
    const mode = words[1]?.toLowerCase();
    if (words.length !== 2 || !WARP_MODES.includes(mode as WarpMode))
      return {
        kind: "usage",
        message: `warpmode ${WARP_MODES.join("|")}`,
      };
    return { kind: "warpmode", mode: mode as WarpMode };
  }
  if ((PARAM_WORDS as string[]).includes(head)) {
    const param = head as WavetableParam;
    const [min, max] = WAVETABLE_PARAMS[param];
    if (words.length !== 2 || !NUMBER.test(words[1]!))
      return { kind: "usage", message: `${param} <${min}..${max}>` };
    const value = Number(words[1]);
    if (value < min || value > max)
      return { kind: "usage", message: `${param} is ${min}..${max}` };
    return { kind: "param", param, value };
  }
  return undefined;
}

/**
 * `basic` → builtin, `wt_digital:2`/`wt_digital` → the uzu pack, `x/y[:n]`
 * or `pack:x/y[:n]` → that pack sound. Undefined when malformed.
 */
export function wavetableSource(name: string): string | undefined {
  const value = name.trim();
  const lower = value.toLowerCase();
  if (lower.startsWith(BUILTIN_TABLE_PREFIX))
    return BUILTIN_TABLES[lower.slice(BUILTIN_TABLE_PREFIX.length)]
      ? lower
      : undefined;
  if (BUILTIN_TABLES[lower]) return `${BUILTIN_TABLE_PREFIX}${lower}`;
  if (/^wt_[a-z0-9_]+(?::[0-9]+)?$/i.test(value))
    return `pack:${WAVETABLE_PACK}/${value}`;
  if (
    /^(?:pack:)?[a-z0-9._-]+\/[A-Za-z0-9._-]+(?::[A-Za-z0-9._-]+)?$/.test(value)
  )
    return value.startsWith("pack:") ? value : `pack:${value}`;
  return undefined;
}

/** One operation that sets the track's wavetable (and makes it a wavetable track). */
export function wavetableOperation(
  score: TrackScore,
  trackId: string,
  next: TrackWavetable,
): ScoreOperation {
  const wavetable = normalizeWavetable(next)!;
  if (!score.tracks.some((track) => track.id === trackId))
    return {
      type: "addTrack",
      track: {
        id: trackId,
        name: trackId,
        instrument: WAVETABLE_INSTRUMENT,
        wavetable,
      },
    };
  return {
    type: "updateTrack",
    trackId,
    patch: { instrument: WAVETABLE_INSTRUMENT, wavetable },
  };
}

function current(score: TrackScore, trackId: string): TrackWavetable {
  const track = score.tracks.find((item) => item.id === trackId);
  return track ? wavetableOf(track) : wavetableOf({} as never);
}

/** Pure parameter edit; the receipt line and the operation. */
export function wavetableParamEdit(
  score: TrackScore,
  trackId: string,
  command: Extract<WavetableCommand, { kind: "param" | "warpmode" }>,
): { operation: ScoreOperation; summary: string } {
  const base = current(score, trackId);
  const next: Record<string, unknown> = { ...base };
  let summary: string;
  if (command.kind === "warpmode") {
    next.warpmode = command.mode;
    summary = `warpmode · ${command.mode}`;
  } else {
    next[command.param] = command.value;
    summary = `${command.param} · ${formatNumber(command.value)}`;
  }
  return {
    operation: wavetableOperation(score, trackId, next as TrackWavetable),
    summary,
  };
}

/** Directory project tables live in, under a track's directory. */
export const LOCAL_TABLE_DIR = "wavetables";
/** Most project tables `wt list` and the menu show. */
const MAX_LISTED_TABLES = 200;

/**
 * Project wavetables: `tracks/<dir>/wavetables/*.wav`, sorted. Sync and
 * bounded, so the menu can call it while it builds.
 */
export function listLocalWavetables(projectRoot: string | undefined): string[] {
  if (!projectRoot) return [];
  const out: string[] = [];
  let dirs: string[];
  try {
    dirs = readdirSync(join(projectRoot, "tracks")).sort();
  } catch {
    return [];
  }
  for (const dir of dirs) {
    if (dir.startsWith(".")) continue;
    let files: string[];
    try {
      files = readdirSync(join(projectRoot, "tracks", dir, LOCAL_TABLE_DIR));
    } catch {
      continue;
    }
    for (const file of files.sort())
      if (/\.wav$/i.test(file) && !file.startsWith("."))
        out.push(`tracks/${dir}/${LOCAL_TABLE_DIR}/${file}`);
    if (out.length >= MAX_LISTED_TABLES) break;
  }
  return out.slice(0, MAX_LISTED_TABLES);
}

/** True when a `wt` argument names a project WAV rather than a table name. */
export function isLocalTableName(name: string): boolean {
  return /\.wav$/i.test(name.trim()) && !name.trim().startsWith("pack:");
}

/**
 * The project path for a local table argument: `tracks/…` as is, otherwise
 * relative to the track's directory (`vox.wav` → its `wavetables/vox.wav`),
 * falling back to the only project table with that file name.
 */
export function localTablePath(
  score: TrackScore,
  trackId: string,
  name: string,
  projectRoot?: string,
): string {
  const bare = name.trim().replace(/^\.\//, "");
  if (bare.startsWith("tracks/")) return bare;
  const dir = trackDirectories(score).get(trackId) ?? trackId;
  const own = `tracks/${dir}/${bare.includes("/") ? bare : `${LOCAL_TABLE_DIR}/${bare}`}`;
  if (bare.includes("/")) return own;
  const all = listLocalWavetables(projectRoot);
  if (all.includes(own)) return own;
  const matches = all.filter((path) => path.endsWith(`/${bare}`));
  return matches.length === 1 ? matches[0]! : own;
}

/** Resolves and pins a table name; pack tables are fetched once to pin them. */
export async function pickWavetable(
  store: PackStore,
  score: TrackScore,
  trackId: string,
  name: string,
  projectRoot?: string,
): Promise<{ operation: ScoreOperation; summary: string }> {
  if (isLocalTableName(name)) {
    if (!projectRoot)
      throw new PackError("project tables need an open project");
    const src = localTablePath(score, trackId, name, projectRoot);
    let sha256: string;
    try {
      const resolved = await resolveReadPath(
        { root: projectRoot, trackSlug: "" },
        src,
        "wavetable",
      );
      const info = await stat(resolved.real);
      if (!info.isFile()) throw new Error("not a file");
      if (info.size > SCORE_LIMITS.maxSampleFileBytes)
        throw new Error("over the 50 MiB file limit");
      const bytes = new Uint8Array(await readFile(resolved.real));
      wavetableFromWav(src, "check", bytes);
      sha256 = createHash("sha256").update(bytes).digest("hex");
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      throw new PackError(
        `${src.slice(0, 80)} · ${why.slice(0, 120)} · wt list shows the project's tables`,
      );
    }
    const base = current(score, trackId);
    return {
      operation: wavetableOperation(score, trackId, {
        ...base,
        table: { src, sha256 },
      }),
      summary: `wavetable · ${describeTable(src)}`,
    };
  }
  const src = wavetableSource(name);
  if (!src)
    throw new PackError(
      `${name.slice(0, 40)} is not a table · wt list shows ${BUILTIN_TABLE_NAMES.join(", ")} and the wt_ sets`,
    );
  const base = current(score, trackId);
  const table = src.startsWith(BUILTIN_TABLE_PREFIX)
    ? { src }
    : await store.pin(src);
  return {
    operation: wavetableOperation(score, trackId, { ...base, table }),
    summary: `wavetable · ${describeTable(table.src)}`,
  };
}

export function describeTable(src: string): string {
  if (src.startsWith(BUILTIN_TABLE_PREFIX)) {
    const name = src.slice(BUILTIN_TABLE_PREFIX.length);
    return `${name} (${BUILTIN_TABLES[name]?.title ?? "built-in"})`;
  }
  if (isLocalTableSrc(src)) return `${src.split("/").pop()} (project)`;
  return src.replace(`pack:${WAVETABLE_PACK}/`, "");
}

/** `wt` reply: table and the parameters that differ from default. */
export function describeWavetable(score: TrackScore, trackId: string): string {
  const track = score.tracks.find((item) => item.id === trackId);
  if (!track || !isWavetableInstrument(track.instrument))
    return `${trackId} is not a wavetable track · wt basic makes it one`;
  const settings = wavetableOf(track);
  const params = (Object.keys(WAVETABLE_PARAMS) as WavetableParam[])
    .filter((name) => settings[name] !== undefined)
    .map((name) => `${name} ${formatNumber(settings[name]!)}`);
  if (settings.warpmode) params.push(`warpmode ${settings.warpmode}`);
  return `wavetable · ${describeTable(settings.table.src)}${params.length ? ` · ${params.join(" · ")}` : ""}`;
}

/** Lines for `wt list`: built-ins, then each uzu set with its table count. */
export async function wavetableListLines(
  store: PackStore | undefined,
  projectRoot?: string,
): Promise<string[]> {
  const lines = ["built-in (offline):"];
  for (const name of BUILTIN_TABLE_NAMES)
    lines.push(`  ${name.padEnd(10)} ${BUILTIN_TABLES[name]!.title}`);
  const local = listLocalWavetables(projectRoot);
  lines.push("", "project (tracks/<slug>/wavetables/, made by the agent):");
  if (local.length === 0)
    lines.push(
      "  none yet · ask the agent to make_wavetable from any audio file",
    );
  for (const path of local) lines.push(`  wt ${path}`);
  lines.push("", `${WAVETABLE_PACK} (Strudel wt_ sounds, fetched on use):`);
  try {
    if (!store) throw new PackError("offline");
    const manifest = await store.manifest(WAVETABLE_PACK);
    for (const [sound, entry] of manifest.sounds) {
      if (!sound.startsWith("wt_") || entry.kind !== "list") continue;
      const count = entry.files.length;
      lines.push(
        `  ${sound.padEnd(12)} ${count} tables · wt ${sound}:0 … ${sound}:${count - 1}`,
      );
    }
  } catch {
    lines.push(
      "  wt_digital, wt_vgame · wt wt_digital:0 (needs the network once)",
    );
  }
  return lines;
}

function formatNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}
