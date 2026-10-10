/**
 * Show-me: the agent acts the way a human would, live, as its tokens stream.
 *
 * In command mode the model writes dawg prompt commands, one per line. The
 * prompt bar shows the line being written as ghost text at the model's own
 * speed, and each line runs through the same `submit()` a human's Enter
 * runs the moment it is complete. This module holds the pure parts: the
 * incremental line splitter, which lines count as commands, the caption that
 * names the human gesture (the typed command, the fader, the keys of play
 * mode), the fader glide values and the note scheduler that keeps streamed
 * notes in time or falls back to step entry. Nothing here waits on a clock:
 * callers pass times in, so tests use fake clocks.
 */
import {
  drumVoicePitch,
  isDrumInstrument,
  parseDrumVoice,
} from "../../core/drums.ts";
import type { TrackScore } from "../../core/score.ts";
import { workspaceRelative } from "../commands/grammar.ts";
import { looksLikeProse, nearestCommand, usageHint } from "../commands/help.ts";
import { DEFAULT_KITS } from "../audio/packs.ts";
import { SYNTH_KIT_NAMES } from "../../core/kits.ts";
import { DRUM_PATTERNS, findPattern } from "../../core/sdk/v1.ts";
import { parsePatternCommand } from "../commands/drums.ts";
import { parseEffectName } from "../commands/fx.ts";
import { nearest } from "../commands/nearest.ts";
import { parseKitCommand } from "../commands/pack.ts";
import { commandParses } from "../commands/parses.ts";
import { menuPath } from "../tui/menu.ts";
import { NOTE_KEYS, defaultBaseFor } from "../tui/play-mode.ts";
import { parsePrompt } from "./ops.ts";

/** How much a show-me turn shows: captions and key display, or neither. */
export type ShowMeLevel = "on" | "quiet" | "off";

export const SHOW_ME_LEVELS: readonly ShowMeLevel[] = ["on", "quiet", "off"];

export function parseShowMe(text: string): ShowMeLevel | undefined {
  const word = text.trim().toLowerCase();
  return (SHOW_ME_LEVELS as readonly string[]).includes(word)
    ? (word as ShowMeLevel)
    : undefined;
}

/** Longest command line the splitter accepts; longer lines are prose. */
export const MAX_COMMAND_LINE = 400;

/**
 * Splits a token stream into lines. `push` returns the lines completed by a
 * delta and the partial line still being written (the ghost text). Code
 * fences, list bullets and a leading `$ ` or `> ` are stripped, since small
 * models wrap commands in them.
 */
export class CommandLines {
  private buffer = "";

  push(delta: string): { complete: string[]; partial: string } {
    this.buffer += delta;
    const parts = this.buffer.split(/\r?\n/);
    this.buffer = parts.pop() ?? "";
    if (this.buffer.length > MAX_COMMAND_LINE * 4)
      this.buffer = this.buffer.slice(-MAX_COMMAND_LINE * 4);
    return {
      complete: parts.map(cleanLine).filter((line) => line.length > 0),
      partial: cleanLine(this.buffer),
    };
  }

  /** The last line, when the stream ends without a newline. */
  flush(): string | undefined {
    const line = cleanLine(this.buffer);
    this.buffer = "";
    return line.length > 0 ? line : undefined;
  }
}

function cleanLine(line: string): string {
  const trimmed = line.trim();
  if (/^```/.test(trimmed)) return "";
  return trimmed
    .replace(/^(?:[-*]\s+|\$\s+|>\s+|\d+[.)]\s+)/, "")
    .replace(/^`(.*)`$/, "$1")
    .trim()
    .replace(/^track(?=\s)/i, "/track");
}

/**
 * Prompt-bar commands the agent may not run: they open windows, sign in,
 * quit or change this window's settings, none of which edits the song.
 */
const WINDOW_ONLY =
  /^\/(?:help|guide|menu|play|login|logout|auth|model|quit|exit|sessions?|new|showme|status|undo|redo|tracks|euclid|try|record|grid|count-?in|click|chords|theme|motion|view|transcript)\b/i;

/**
 * Whether a complete line is a command the agent runs: one a human could
 * type into the prompt bar that edits the song. Anything else is the
 * model's prose (its short reply).
 */
export function isAgentCommand(line: string, score: TrackScore): boolean {
  if (line.length === 0 || line.length > MAX_COMMAND_LINE) return false;
  if (WINDOW_ONLY.test(line)) return false;
  if (!agentPathsAllowed(line)) return false;
  if (/^\/?track\s+[a-z0-9._ -]{1,64}$/i.test(line)) return true;
  // `pattern housee`, `kit 8088`: parses, but names nothing in the library.
  if (catalogMiss(line) !== undefined) return false;
  return commandParses(line, score);
}

/** Kit names show-me knows offline: the synth kits and `/kit` short names. */
const KIT_NAMES: readonly string[] = [
  ...SYNTH_KIT_NAMES,
  ...Object.keys(DEFAULT_KITS),
];

/**
 * The corrected line when `pattern <name>` or `kit <name>` names nothing
 * dawg has but is near a name it does (`pattern housee` → `pattern
 * house`); `""` for a pattern name with no near match; undefined for any
 * other line. A kit name far from every short name may be a pack bank, so
 * it is left to the prompt bar.
 */
export function catalogMiss(line: string): string | undefined {
  const pattern = parsePatternCommand(line);
  if (pattern?.kind === "apply") {
    if (findPattern(pattern.name)) return undefined;
    const near = nearest(
      pattern.name,
      DRUM_PATTERNS.map((entry) => entry.name),
    );
    return near ? withName(line, near) : "";
  }
  const kit = parseKitCommand(line);
  if (kit?.kind === "set" && /^[a-z0-9]+$/i.test(kit.bank)) {
    const bank = kit.bank.toLowerCase();
    if (KIT_NAMES.includes(bank)) return undefined;
    const near = nearest(bank, KIT_NAMES);
    return near ? withName(line, near) : undefined;
  }
  return undefined;
}

/** `line` with its second word (the pattern or kit name) replaced. */
function withName(line: string, name: string): string {
  const words = line.trim().split(/\s+/);
  words[1] = name;
  return words.join(" ");
}

/** Verbs whose arguments name files on disk. */
const PATH_VERBS = /^\/?(?:export|import|sample|tuning)\s+(.*)$/i;

/**
 * Whether every file the line names stays inside the workspace: the agent
 * may not export over, import or load a path that is absolute, under home
 * or climbs out with `..`. A typed command keeps absolute paths.
 */
export function agentPathsAllowed(line: string): boolean {
  const args = line.trim().match(PATH_VERBS)?.[1];
  if (args === undefined) return true;
  return args
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .every((token) => workspaceRelative(token));
}

/**
 * A line the agent meant as a command that does not parse: a slash word,
 * or a lowercase line led by a known verb (or a near typo of one) that is
 * not a sentence. Show-me runs nothing for it and shows a red receipt
 * (brokenCommandReceipt) instead of letting it pass as prose.
 */
export function isBrokenCommand(line: string, score: TrackScore): boolean {
  if (line.length === 0 || line.length > MAX_COMMAND_LINE) return false;
  if (isAgentCommand(line, score) || WINDOW_ONLY.test(line)) return false;
  if (catalogMiss(line) !== undefined) return true;
  if (line.startsWith("/")) return /^\/[a-z]/i.test(line);
  if (!/^[a-z]/.test(line) || /[.!?:]$/.test(line)) return false;
  if (looksLikeProse(line) && !usageHint(line)) return false;
  return usageHint(line) !== undefined || nearestCommand(line) !== undefined;
}

/**
 * The red receipt for a broken agent command: what failed, the usage or
 * the nearest command when there is one. Never prose.
 */
export function brokenCommandReceipt(line: string): string {
  const miss = catalogMiss(line);
  if (miss !== undefined)
    return `✗ ${line} · ${miss ? `did you mean ${miss}?` : "no such pattern · pattern list"}`;
  const usage = usageHint(line);
  const verb = nearestCommand(line);
  // `patern house` → `pattern house`: the fixed verb with its arguments.
  const nearer = verb
    ? [verb, ...line.trim().split(/\s+/).slice(1)].join(" ")
    : undefined;
  const hint = usage ?? (nearer ? `did you mean ${nearer}?` : undefined);
  return `✗ ${line}${hint ? ` · ${hint}` : " · not a dawg command"}`;
}

/** One key of the qwerty play keyboard and how to reach its octave. */
export type KeyPress = Readonly<{
  /** The note key (`a`, `w`, `;`), lower case. */
  key: string;
  /** Octave keys pressed first: `z` down, `x` up, repeated. */
  octave: string;
}>;

const KEY_BY_OFFSET = new Map<number, string>(
  Object.entries(NOTE_KEYS)
    .sort((a, b) => a[1] - b[1])
    .reverse()
    .map(([key, offset]) => [offset, key] as const),
);

/**
 * The play-mode key for `pitch` on a keyboard whose base C is `base`: the
 * home row first, moving octaves (Z/X) only when the note is off the keys.
 */
export function keyForPitch(pitch: number, base: number): KeyPress {
  for (let shift = 0; shift <= 10; shift += 1)
    for (const octaves of shift === 0 ? [0] : [shift, -shift]) {
      const key = KEY_BY_OFFSET.get(pitch - base - octaves * 12);
      if (key)
        return {
          key,
          octave:
            octaves === 0
              ? ""
              : (octaves > 0 ? "x" : "z").repeat(Math.abs(octaves)),
        };
    }
  return { key: "a", octave: "" };
}

/** The GM pitch of a drum voice word (`kick`, `hat`), when it is one. */
export function drumPitch(voice: string): number | undefined {
  const parsed = parseDrumVoice(voice.toLowerCase());
  return parsed === undefined ? undefined : drumVoicePitch(parsed);
}

export type Gesture =
  | Readonly<{ kind: "typed"; command: string; caption: string }>
  | Readonly<{
      kind: "fader";
      command: string;
      caption: string;
      /** The bare parameter the fader drawer opens on (`fx reverb mix`). */
      param: string;
      value: number;
    }>
  | Readonly<{
      kind: "keys";
      command: string;
      caption: string;
      notes: readonly Readonly<{
        pitch: number;
        start: number;
        duration: number;
        press: KeyPress;
      }>[];
    }>;

const FADER_COMMAND =
  /^\/?(volume|pan|fx\s+[a-z][\w-]*\s+[a-z][\w-]*)\s+(-?\d+(?:\.\d+)?)$/i;

/**
 * The human gesture for a command: a fader slide for a parameter value, the
 * play-mode keys for notes and drum hits, otherwise the typed command.
 */
export function gestureFor(
  command: string,
  context: Readonly<{ score: TrackScore; trackId: string }>,
): Gesture {
  const fader = command.match(FADER_COMMAND);
  if (fader) {
    const param = fader[1]!.toLowerCase().replace(/\s+/g, " ");
    const value = Number(fader[2]);
    return {
      kind: "fader",
      command,
      param,
      value,
      caption: `fader · ${param} → ${fader[2]} · or type ${command}`,
    };
  }
  const track = context.score.tracks.find(
    (candidate) => candidate.id === context.trackId,
  );
  const drums = isDrumInstrument(track?.instrument);
  const hit = command.match(/^\/?hit\s+([a-z]+)\s+at\s+(\d+(?:\.\d+)?)$/i);
  if (hit) {
    const pitch = drumPitch(hit[1]!);
    if (pitch !== undefined) {
      const press = keyForPitch(pitch, 36);
      return {
        kind: "keys",
        command,
        caption: `playing on keys: ${press.key.toUpperCase()} (${hit[1]!.toLowerCase()}) · ctrl-p play mode · or type ${command}`,
        notes: [{ pitch, start: Number(hit[2]), duration: 0.25, press }],
      };
    }
  }
  const pattern = command.match(/^\/?pattern\s+([a-z]+)\s+([\d.\s]+)$/i);
  if (pattern) {
    const pitch = drumPitch(pattern[1]!);
    const beats = pattern[2]!
      .trim()
      .split(/\s+/)
      .map(Number)
      .filter((beat) => Number.isFinite(beat));
    if (pitch !== undefined && beats.length > 0) {
      const press = keyForPitch(pitch, 36);
      return {
        kind: "keys",
        command,
        caption: `playing on keys: ${press.key.toUpperCase()} ×${beats.length} (${pattern[1]!.toLowerCase()}) · ctrl-p play mode · or type ${command}`,
        notes: beats.map((start) => ({ pitch, start, duration: 0.25, press })),
      };
    }
  }
  const parsed = parsePrompt(command);
  if (parsed?.type === "add-note") {
    const base = drums ? 36 : defaultBaseFor(track?.instrument);
    const press = keyForPitch(parsed.pitch, base);
    const octave = press.octave
      ? `, octave ${press.octave.toUpperCase().split("").join(" ")}`
      : "";
    return {
      kind: "keys",
      command,
      caption: `playing on keys: ${press.key.toUpperCase()}${octave} · ctrl-p play mode · or type ${command}`,
      notes: [
        {
          pitch: parsed.pitch,
          start: parsed.start,
          duration: parsed.duration,
          press,
        },
      ],
    };
  }
  return { kind: "typed", command, caption: `typing ${command}` };
}

/** Where each command's setting lives in Ctrl-K, as a `/menu` id. */
const MENU_HOME: Readonly<Record<string, string>> = {
  synth: "sound",
  sound: "sound",
  tempo: "tempo",
  bpm: "tempo",
  meter: "tempo",
  euclid: "rhythm",
  groove: "patterns",
  pattern: "patterns",
  kit: "kits",
  master: "master",
  automate: "automation",
  section: "arrange",
  form: "arrange",
  style: "style",
  tuning: "tuning",
  key: "chords",
  chords: "chords",
  sing: "voice",
  lyrics: "voice",
  autotune: "voice",
  vocode: "voice",
  export: "export",
  model: "agent",
  showme: "agent",
};

/**
 * The menu path a command's setting also lives at, for the finish hint:
 * `Ctrl-K › Effects › reverb`, from the menu's live labels (menuPath).
 */
export function menuPathFor(command: string): string | undefined {
  const words = command.replace(/^\//, "").toLowerCase().split(/\s+/);
  const verb = words[0] ?? "";
  if (verb === "volume" || verb === "pan") {
    const mix = menuPath("mix");
    return mix && `${mix} › ${verb}`;
  }
  if (verb === "fx" && words[1]) {
    // The row's live label and real place (`more effects › phaser`, the
    // formant shift under Voice); Effects when nothing names it.
    const id =
      words[1] === "rig"
        ? "guitar rig"
        : (parseEffectName(words[1]) ?? words[1]);
    return menuPath(id) ?? menuPath("effects");
  }
  const home = MENU_HOME[verb];
  return home ? menuPath(home) : undefined;
}

/** Glide length for a fader: short enough to never stall a turn. */
export const GLIDE_MS = 150;
/** Step between glide values: each step re-renders the loop, so not faster. */
export const GLIDE_STEP_MS = 30;

/**
 * Eased intermediate values from `from` to `to` (exclusive of `from`,
 * ending exactly on `to`), one per `stepMs` over `ms`.
 */
export function glideValues(
  from: number,
  to: number,
  ms = GLIDE_MS,
  stepMs = GLIDE_STEP_MS,
): number[] {
  if (!Number.isFinite(from) || from === to) return [to];
  const steps = Math.max(1, Math.round(ms / stepMs));
  const values: number[] = [];
  for (let index = 1; index < steps; index += 1) {
    const t = index / steps;
    const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    values.push(Number((from + (to - from) * eased).toFixed(4)));
  }
  values.push(to);
  return values;
}

/**
 * When each streamed note sounds. The first note anchors a clock at its
 * arrival; a note at beat `b` is due `b` beats later at the tempo. A note
 * that arrives before it is due waits for its place on the grid (the stream
 * runs ahead: stay in time); one that arrives late plays at once (the stream
 * is slower than the tempo: step entry). The score never waits on this.
 */
export class NoteScheduler {
  private anchor: { atMs: number; beat: number } | undefined;
  private lastDueMs = -Infinity;

  constructor(private readonly tempoBpm: () => number) {}

  /** Monotonic ms at which the note should sound, and how it is shown. */
  schedule(
    beat: number,
    nowMs: number,
  ): { atMs: number; mode: "in-time" | "step" } {
    const msPerBeat = 60_000 / Math.max(1, this.tempoBpm());
    if (!this.anchor || beat < this.anchor.beat) {
      this.anchor = { atMs: nowMs, beat };
      this.lastDueMs = nowMs;
      return { atMs: nowMs, mode: "in-time" };
    }
    const due = this.anchor.atMs + (beat - this.anchor.beat) * msPerBeat;
    if (due >= nowMs) {
      this.lastDueMs = Math.max(this.lastDueMs, due);
      return { atMs: due, mode: "in-time" };
    }
    // Late: re-anchor so the notes after it keep their spacing from here.
    this.anchor = { atMs: nowMs, beat };
    this.lastDueMs = nowMs;
    return { atMs: nowMs, mode: "step" };
  }

  reset(): void {
    this.anchor = undefined;
    this.lastDueMs = -Infinity;
  }
}

/** The finish hint: how to do the turn's last gesture by hand. */
export function finishHint(commands: readonly string[]): string | undefined {
  const last = commands.at(-1);
  if (!last) return undefined;
  const menu = menuPathFor(last);
  const count = commands.length;
  return `do it yourself: type ${last}${count > 1 ? ` (+${count - 1} more in ^o log)` : ""}${menu ? ` · or ${menu}` : ""}`;
}

/** `dawg media` verbs by agent tool: the CLI a person runs for the same job. */
const MEDIA_VERB: Readonly<Record<string, string>> = {
  download_audio: "download",
  split_stems: "stems",
  analyze_audio: "analyze",
  transcribe_notes: "notes",
  import_sample: "sample",
  transcribe_lyrics: "lyrics",
  make_wavetable: "wavetable",
};

/**
 * The caption for a JSON tool the command language cannot express: names
 * the manual route (`dawg media stems`, the project files) when one exists.
 */
export function toolCaption(name: string): string | undefined {
  const verb = MEDIA_VERB[name];
  if (verb) return `media · or run dawg media ${verb} in a shell`;
  if (/^(?:write_file|edit_file)$/.test(name))
    return "editing a project file · song.ts and tracks/ are yours to edit";
  if (/^(?:web_search|fetch_url)$/.test(name)) return "searching the web";
  return undefined;
}
