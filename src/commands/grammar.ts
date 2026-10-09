/**
 * The one command grammar (design §3): `[/]verb [noun|target] [args]`, where
 * the slash is optional, synonyms map to the canonical word, and every noun
 * answers `remove|rm|delete` and `list|presets|ls` the same way.
 *
 * The parsers keep their own spellings; this module rewrites a line that no
 * parser took into the spellings they do take (`recover`), so a line that
 * works today runs exactly as before and only a line that failed gets a
 * second reading. `commandParses` (src/commands/parses.ts) and the prompt bar
 * (src/main.ts submit) share it, so an alias that runs also counts as a
 * command for typo fixes, show-me and the agent's command mode.
 */

/** Words that remove a thing: `section rm verse` ≡ `section remove verse`. */
export const REMOVE_WORDS: readonly string[] = ["remove", "rm", "delete"];
/** Words that list a noun's presets: `fx ls` ≡ `fx list` ≡ `fx`. */
export const LIST_WORDS: readonly string[] = ["list", "presets", "ls"];

/** `/formant 3` → `formant 3`; `formant 3` → `/formant 3`. */
export function toggleSlash(line: string): string {
  const text = line.trim();
  return text.startsWith("/") ? text.slice(1) : `/${text}`;
}

/** One leading `/` removed (only one: `//x` stays a slash word). */
export function stripSlash(line: string): string {
  const text = line.trim();
  return text.startsWith("/") ? text.slice(1) : text;
}

/** The first word, slash and case folded (`/FX` → `fx`). */
export function verbOf(line: string): string {
  return (
    stripSlash(line)
      .split(/\s+/)[0]
      ?.toLowerCase() ?? ""
  );
}

/**
 * Canonical forms that are new names for old grammar, rewritten to the
 * spelling the parser takes. Each entry maps a bare line to its rewrite, or
 * undefined when the entry does not apply. Canonical first, old alias kept:
 * `groove house` runs the parser's `/pattern house`.
 */
const REWRITES: readonly ((words: readonly string[]) => string | undefined)[] =
  [
    // groove <name> ≡ /pattern <name>; bare groove opens the browser.
    (w) =>
      w[0] === "groove" || w[0] === "grooves"
        ? ["/pattern", ...w.slice(1)].join(" ")
        : undefined,
    // key ≡ scale for showing and listing (`key A minor` already parses).
    (w) =>
      w[0] === "key" &&
      (w.length === 1 || (w.length === 2 && LIST_WORDS.includes(w[1]!)))
        ? w.length === 1
          ? "scale"
          : "scale list"
        : undefined,
    // chords idiom <name> ≡ chords style <name>.
    (w) =>
      w[0] === "chords" && w[1] === "idiom"
        ? ["chords", "style", ...w.slice(2)].join(" ")
        : undefined,
    // synth filter <hz> ≡ synth lpf <hz> (also lowpass, cutoff).
    (w) =>
      w[0] === "synth" && /^(filter|lowpass|cutoff)$/.test(w[1] ?? "")
        ? ["synth", "lpf", ...w.slice(2)].join(" ")
        : undefined,
    // fx filter cutoff <hz> ≡ fx filter lpf <hz>; fx lowpass ≡ fx filter.
    (w) =>
      w[0] === "fx" && w[1] === "filter" && w[2] === "cutoff"
        ? ["fx", "filter", "lpf", ...w.slice(3)].join(" ")
        : w[0] === "fx" && w[1] === "lowpass"
          ? ["fx", "filter", ...w.slice(2)].join(" ")
          : undefined,
    // lowpass <hz> ≡ filter <hz>.
    (w) =>
      w[0] === "lowpass" ? ["filter", ...w.slice(1)].join(" ") : undefined,
    // genre <id> ≡ style <id>.
    (w) =>
      w[0] === "genre" || w[0] === "genres"
        ? ["style", ...w.slice(1)].join(" ")
        : undefined,
    // bpm <n> ≡ tempo <n> (bare `/bpm` stays a sample's own tempo).
    (w) =>
      w[0] === "bpm" && w.length === 2 && /^\d+(\.\d+)?$/.test(w[1]!)
        ? `tempo ${w[1]}`
        : undefined,
    // render|bounce|wav <file>.wav [stems] ≡ export <file>.wav [stems].
    (w) =>
      /^(render|bounce|wav)$/.test(w[0] ?? "") &&
      /\.wav$/i.test(w[1] ?? "") &&
      (w.length === 2 || (w.length === 3 && w[2] === "stems"))
        ? ["export", ...w.slice(1)].join(" ")
        : undefined,
    // remove|rm|delete note <id> ≡ remove <id>.
    (w) =>
      REMOVE_WORDS.includes(w[0] ?? "") && w[1] === "note" && w.length === 3
        ? `remove ${w[2]}`
        : undefined,
    // rm <id> ≡ remove <id>.
    (w) =>
      w[0] === "rm" && w.length >= 2
        ? ["remove", ...w.slice(1)].join(" ")
        : undefined,
  ];

/**
 * Every other reading of `line`, most likely first: the canonical rewrite,
 * the other slash spelling, and the remove and list word swaps, each with
 * and without the slash. The line itself is not included.
 */
export function candidates(line: string): string[] {
  const text = line.trim().replace(/\s+/g, " ");
  if (!text || text.length > 1_024) return [];
  const bare = stripSlash(text);
  if (!bare || bare.startsWith("/")) return [];
  const words = bare.split(" ");
  const lower = words.map((word) => word.toLowerCase());
  const out: string[] = [];
  const push = (candidate: string | undefined): void => {
    if (candidate === undefined) return;
    for (const form of [candidate, toggleSlash(candidate)])
      if (form !== text && !out.includes(form)) out.push(form);
  };
  for (const rewrite of REWRITES) push(rewrite(lower));
  push(bare);
  // remove|rm|delete in the first three words: try each spelling.
  for (let index = 0; index < Math.min(3, words.length); index += 1) {
    if (!REMOVE_WORDS.includes(lower[index]!)) continue;
    for (const word of REMOVE_WORDS)
      if (word !== lower[index])
        push([...words.slice(0, index), word, ...words.slice(index + 1)].join(" "));
  }
  // <noun> list|presets|ls, or bare <noun>: try every listing spelling.
  const last = lower.at(-1)!;
  if (words.length >= 2 && LIST_WORDS.includes(last)) {
    const head = words.slice(0, -1);
    push(head.join(" "));
    for (const word of LIST_WORDS)
      if (word !== last) push([...head, word].join(" "));
  } else if (words.length === 1)
    for (const word of LIST_WORDS) push(`${words[0]} ${word}`);
  return out;
}

/** The first reading of `line` that `accepts`, or undefined. */
export function recover(
  line: string,
  accepts: (candidate: string) => boolean,
): string | undefined {
  return candidates(line).find(accepts);
}

// ---------------------------------------------------------------------------
// Export and loop: forms the prompt bar runs itself

export type ExportCommand = Readonly<{
  path: string;
  format: "json" | "mid" | "wav";
  stems: boolean;
}>;

export const EXPORT_USAGE =
  "export <file>.track.json|.mid|.wav [stems] · export song.wav · export mix.wav stems";

/**
 * `export song.wav`, `export song.wav stems`, `export loop.track.json`,
 * `export song.mid` (slash optional). Stems are a WAV per track.
 */
export function parseExportCommand(line: string): ExportCommand | undefined {
  const match = line
    .trim()
    .match(/^\/?export\s+(\S+)(?:\s+(stems))?\s*$/i);
  if (!match) return undefined;
  const path = match[1]!;
  const format = /\.wav$/i.test(path)
    ? "wav"
    : /\.midi?$/i.test(path)
      ? "mid"
      : "json";
  const stems = match[2] !== undefined;
  if (stems && format !== "wav") return undefined;
  return { path, format, stems };
}

/**
 * Whether the agent may write `path`: relative, inside the workspace, with
 * no `..` segment and no home or drive prefix.
 */
export function workspaceRelative(path: string): boolean {
  if (!path || path.length > 256) return false;
  if (/^([/\\~]|[a-z]:)/i.test(path)) return false;
  return !path.split(/[/\\]/).some((segment) => segment === "..");
}

export type LoopCommand =
  | Readonly<{ type: "loop-off" }>
  | Readonly<{ type: "loop-bars"; from: number; to: number }>
  | Readonly<{ type: "loop-section"; name: string }>
  | Readonly<{ type: "loop-show" }>;

export const LOOP_USAGE =
  "loop <a>-<b> | <section> | off · loop 1-4 · loop chorus · loop off";

/**
 * `loop 1-4` (bars, 1-based inclusive), `loop 1 4`, `loop chorus`, `loop
 * off`, bare `loop` (what loops now). Slash optional.
 */
export function parseLoopCommand(line: string): LoopCommand | undefined {
  const words = stripSlash(line).trim().split(/\s+/);
  if (words[0]?.toLowerCase() !== "loop") return undefined;
  const rest = words.slice(1);
  if (rest.length === 0) return { type: "loop-show" };
  if (rest.length === 1 && /^(off|none|song)$/i.test(rest[0]!))
    return { type: "loop-off" };
  const range = rest.join(" ").match(/^(\d{1,4})\s*(?:-|\.\.|–|\s)\s*(\d{1,4})$/u);
  if (range) {
    const from = Number(range[1]);
    const to = Number(range[2]);
    return from >= 1 && to >= from ? { type: "loop-bars", from, to } : undefined;
  }
  if (rest.length === 1 && /^\d{1,4}$/.test(rest[0]!)) {
    const bar = Number(rest[0]);
    return bar >= 1 ? { type: "loop-bars", from: bar, to: bar } : undefined;
  }
  const name = rest.join(" ");
  return /^[\p{L}\p{N}][\p{L}\p{N} _'.-]{0,31}$/u.test(name)
    ? { type: "loop-section", name }
    : undefined;
}

/** `track remove|rm|delete <name>` and `track move <name> <n>`. */
export function parseTrackEdit(
  line: string,
): Readonly<{ verb: "rm" | "move"; rest: string }> | undefined {
  const match = line
    .trim()
    .match(/^\/?track\s+(rm|remove|delete|move)\s+(.{1,64}?)\s*$/i);
  if (!match) return undefined;
  return {
    verb: match[1]!.toLowerCase() === "move" ? "move" : "rm",
    rest: match[2]!,
  };
}

// ---------------------------------------------------------------------------
// Window verbs and the agent boundary

/**
 * Window verbs whose argument is free text: bare they print this hint and do
 * nothing, so `rename` alone (or a sentence starting with it, offline) never
 * renames or forks a session by accident.
 */
export const FREE_TEXT_HINTS: Readonly<Record<string, string>> = {
  rename: "rename · /rename <name> names this session · /rename --auto",
  fork: "fork · /fork [<name>] copies this session",
  resume: "resume · /resume [<n>|<name>] · /sessions lists them",
  login: "login · /login [gateway|openrouter|codex|claude] adds an agent",
};

/**
 * Window verbs that run the same with or without the slash. The prompt bar
 * retries the other spelling of these when the typed one is not handled.
 */
export const WINDOW_VERBS: ReadonlySet<string> = new Set([
  "help",
  "guide",
  "guides",
  "menu",
  "tracks",
  "track",
  "undo",
  "redo",
  "export",
  "import",
  "status",
  "theme",
  "motion",
  "showme",
  "model",
  "sessions",
  "logout",
  "auth",
  "quit",
  "exit",
  "view",
  "transcript",
  "log",
  "click",
  "count-in",
  "grid",
  "try",
  "sample",
  "samples",
  "len",
  "fitmode",
  "euclid",
  "style",
  "styles",
  "calibration",
]);

/** `✗ no agent · …`: what prose gets when no provider is signed in. */
export const NO_AGENT = "no agent · try style deep-house · /login adds one";

/**
 * Command words that are also everyday English: a sentence starting with
 * one (`add a walking bass`, `build tension`) is a request for the agent.
 * Every other known verb is grammar only and never reaches the agent.
 */
export const EVERYDAY_VERBS: ReadonlySet<string> = new Set([
  "add",
  "put",
  "move",
  "make",
  "build",
  "drop",
  "fill",
  "form",
  "play",
  "remove",
  "delete",
  "clear",
  "extend",
  "length",
  "try",
  "help",
  "sing",
  "pan",
  "track",
  "chords",
  "key",
  "scale",
  "style",
  "view",
  "log",
  "bend",
  "glide",
  "fade",
  "shift",
  "loop",
  "groove",
  "hit",
  "export",
  "import",
  "rename",
  "fork",
  "resume",
  "login",
]);

/**
 * `✗ <line> · <usage> · did you mean <x>?`: one card for a known verb whose
 * arguments did not parse, the same for slash and bare input.
 */
export function usageCard(
  line: string,
  usage: string,
  near?: string,
): string {
  return near ? `${line} · ${usage} · did you mean ${near}?` : `${line} · ${usage}`;
}
