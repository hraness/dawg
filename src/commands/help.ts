/**
 * The command reference, in one place: `/help` renders it in the overlay,
 * `dawg --help` prints it, and the docs mirror it. Music words are bare;
 * app commands take a slash (bare aliases keep working but are listed once,
 * in their canonical form).
 */

export type HelpGroup = "music" | "session" | "window" | "keys";

export type HelpEntry = Readonly<{
  /** Canonical form, e.g. `pan <-1..1>`. */
  command: string;
  /** What it does, short enough for one overlay row. */
  summary: string;
}>;

export type HelpSection = Readonly<{
  group: HelpGroup;
  entries: readonly HelpEntry[];
}>;

export const HELP_SECTIONS: readonly HelpSection[] = [
  {
    group: "music",
    entries: [
      { command: "play", summary: "start the transport" },
      { command: "pause", summary: "stop the transport" },
      { command: "tempo <bpm>", summary: "20–300 BPM" },
      { command: "add <note> at <beat> [for <beats>]", summary: "add C4 at 0" },
      { command: "remove <id>", summary: "delete a note" },
      { command: "move <id> to <beat>", summary: "shift a note" },
      { command: "length <id> <beats>", summary: "resize a note" },
      { command: "velocity <id> <0..1>", summary: "note loudness" },
      { command: "bars <count>", summary: "loop length, 1–256" },
      { command: "extend <count> bars", summary: "lengthen the loop" },
      {
        command: "instrument <name>",
        summary: "sine piano pluck bass saw square triangle wavetable kit",
      },
      { command: "volume <0..1>", summary: "track level" },
      { command: "pan <-1..1>", summary: "left … right" },
      { command: "mute", summary: "silence this track" },
      { command: "unmute", summary: "hear it again" },
      { command: "solo", summary: "only this track" },
      { command: "unsolo", summary: "every track again" },
      { command: "clear", summary: "remove this track's notes" },
      {
        command: "wt <table> | wt <0..1> | wt list",
        summary: "wavetable synth · wt basic · wt wt_digital:2 · wt 0.5",
      },
      {
        command: "wtenv|wtattack|wtdecay|wtrate|wtdepth|warp <n>",
        summary: "scan the table · warpmode bendp",
      },
      {
        command: "fx <effect> <param> <value> | on | off | preset <name>",
        summary: "effects · fx delay mix 0.3 · fx reverb on · fx lists them",
      },
      {
        command: "synth <param> <value> | preset <name>",
        summary: "synth voice · synth lpf 1200 · synth lists every param",
      },
      { command: "filter <hz> [res]", summary: "low-pass · filter off" },
      { command: "delay <beats> [fb] [mix]", summary: "ping-pong · delay off" },
      { command: "reverb <mix> [size]", summary: "room · reverb off" },
      {
        command: "automate <lane> at <beat> <value>",
        summary: "volume pan filter resonance delay-feedback delay-mix wt",
      },
      {
        command: "automate <lane> points <b:v>...",
        summary: "several points · automate pan points 0:-1 4:1",
      },
      {
        command: "automate <lane> remove <beat>",
        summary: "drop one point",
      },
      { command: "clear [<lane>] automation", summary: "drop a lane's points" },
      { command: "track name <text>", summary: "rename this track" },
      { command: "meter <1..16>", summary: "beats per bar" },
      {
        command: "key <tonic> <mode> | none",
        summary: "song key · key A minor · key F# dorian",
      },
      {
        command: "hit <voice> at <beat>",
        summary: "kit tracks · hit kick at 0",
      },
      {
        command: "pattern <voice> <beats...> | every <step>",
        summary: "pattern kick every 1",
      },
      { command: "clear <voice>", summary: "remove one drum voice" },
      {
        command: "euclid <voice> <pulses> [<steps>] [rotate <n>]",
        summary: "generated rhythm · euclid hat 7 16 rotate 2",
      },
      {
        command: "euclid <voice> <field> <value> | off | freeze",
        summary: "repeats pace accent prob swing …",
      },
      { command: "grid <voice> <x.X.>", summary: "explicit steps · X accent" },
      { command: "undo", summary: "step back · Ctrl-Z" },
      { command: "redo", summary: "step forward · Ctrl-Y" },
    ],
  },
  {
    group: "session",
    entries: [
      { command: "/sessions", summary: "list sessions in this workspace" },
      { command: "/resume [<n>|<name>|<id>]", summary: "switch session" },
      { command: "/rename <name>|--auto", summary: "name this session" },
      { command: "/fork [<name>]", summary: "copy into a new session" },
      { command: "/status", summary: "name · revision · digest · storage" },
      { command: "/export <file>", summary: "write track.loop/v1 JSON" },
      { command: "/import <file>", summary: "replace the score from a file" },
      {
        command: "/sample [<path> [as <voice>]]",
        summary: "add a sample voice · list voices",
      },
    ],
  },
  {
    group: "window",
    entries: [
      {
        command: "/track <name>",
        summary: "focus a track, creating it if new",
      },
      { command: "/tracks", summary: "list tracks" },
      { command: "/view focus|all", summary: "one track or every track" },
      { command: "/transcript", summary: "scrollable log · Ctrl-O" },
      { command: "/theme default|high-contrast|mono", summary: "colors" },
      { command: "/motion on|off", summary: "animation" },
      { command: "/model [alias]", summary: "pick a model · cost per prompt" },
      {
        command: "/login [gateway|openrouter|codex|claude]",
        summary: "sign in to a provider",
      },
      {
        command: "/logout [provider]",
        summary: "forget keys and the saved choice",
      },
      { command: "/auth [--check]", summary: "provider and audio status" },
      { command: "/play [on|off]", summary: "keyboard play mode · Ctrl-P" },
      {
        command: "/pattern [name]",
        summary: "drum groove picker · moving previews",
      },
      {
        command: "/kit [name]",
        summary: "drum kit picker · synth kits, then samples",
      },
      {
        command: "/pack list|info|use|add",
        summary: "sample packs · /pack use 909/bd",
      },
      {
        command: "/euclid [voice]",
        summary: "T-1 style rhythm editor · Rhythm in /menu",
      },
      {
        command: "/menu [section]",
        summary: "every setting by hand · Ctrl-K",
      },
      {
        command: "/click on|off|<volume>",
        summary: "metronome · /count-in 0-2 · /grid 1/16",
      },
      {
        command: "/chords auto|manual|off",
        summary: "play-mode chords · /chords for settings",
      },
      {
        command: "/help [topic]",
        summary: "start here · /help all for everything",
      },
    ],
  },
  {
    group: "keys",
    entries: [
      { command: "Enter", summary: "submit" },
      { command: "Shift-Enter", summary: "newline" },
      { command: "Alt-Enter", summary: "queue the request" },
      { command: "Ctrl-Q", summary: "toggle queue mode" },
      { command: "Ctrl-Z / Ctrl-Y", summary: "undo / redo" },
      { command: "Ctrl-O", summary: "transcript" },
      { command: "Esc", summary: "cancel the agent · back one level" },
      { command: "?", summary: "keys for the screen you are on" },
      { command: "Space", summary: "play/pause on an empty prompt" },
      {
        command: "Ctrl-P",
        summary: "play mode · Z/X octave · R record · Q chords",
      },
      {
        command: "Ctrl-K",
        summary: "menu · ←→ adjust · / filter · x reset",
      },
      { command: "Ctrl-C", summary: "exit" },
    ],
  },
];

/**
 * `/help` with no topic: a short, task-first guide. Each row is something to
 * type or press, then what it does. The full reference is `/help all` (or one
 * group: `/help music`).
 */
export const HELP_GUIDE: readonly HelpSection[] = [
  {
    group: "start here" as HelpGroup,
    entries: [
      { command: "type a request", summary: "“add a walking bass in A minor”" },
      { command: "ctrl-p", summary: "play notes on the computer keyboard" },
      {
        command: "ctrl-k",
        summary: "menu: every sound, effect, rhythm, chord",
      },
      { command: "?", summary: "keys for the screen you are on" },
      {
        command: "ctrl-z · ctrl-y",
        summary: "undo · redo (every change is one)",
      },
    ],
  },
  {
    group: "play notes" as HelpGroup,
    entries: [
      {
        command: "ctrl-p, a s d f …",
        summary: "piano keys · z x octave · esc leave",
      },
      {
        command: "r, then space",
        summary: "record over the loop (one undo a bar)",
      },
    ],
  },
  {
    group: "make drums" as HelpGroup,
    entries: [
      { command: "/pattern", summary: "pick a groove · moving previews it" },
      { command: "/kit", summary: "pick a drum kit" },
      { command: "/euclid", summary: "rhythm editor: pulses, steps, rotation" },
    ],
  },
  {
    group: "shape the sound" as HelpGroup,
    entries: [
      {
        command: "ctrl-k › Sound",
        summary: "instrument, envelope, filter, wavetable",
      },
      { command: "ctrl-k › Effects", summary: "delay, reverb, distortion …" },
      { command: "fx delay mix 0.3", summary: "the same from the prompt" },
    ],
  },
  {
    group: "chords" as HelpGroup,
    entries: [
      { command: "key A minor", summary: "set the song key" },
      {
        command: "ctrl-p, then q",
        summary: "chord mode: one key plays a chord",
      },
      {
        command: "1–4 · 5–8 · n",
        summary: "chord type · extension · next chord",
      },
    ],
  },
  {
    group: "more" as HelpGroup,
    entries: [
      { command: "/help all", summary: "every command and key" },
      { command: "/help music", summary: "or session, window, keys" },
    ],
  },
];

/** Topics `/help <topic>` takes, besides `all`. */
export const HELP_TOPICS = ["music", "session", "window", "keys"] as const;

/**
 * Rows for `/help [topic]`: the guide with no topic, the full reference for
 * `all`, one group for its name; undefined for an unknown topic.
 */
export function helpTopicLines(
  topic: string | undefined,
  width = 80,
): string[] | undefined {
  const name = topic?.trim().toLowerCase().replace(/^\//, "");
  if (!name) return sectionLines(HELP_GUIDE, width, 20);
  if (name === "all" || name === "commands" || name === "reference")
    return helpLines(width);
  const group = HELP_SECTIONS.find((section) => section.group === name);
  return group ? sectionLines([group], width) : undefined;
}

function sectionLines(
  sections: readonly HelpSection[],
  width: number,
  fixedColumn?: number,
): string[] {
  const lines: string[] = [];
  const column =
    fixedColumn ??
    Math.min(
      40,
      Math.max(
        ...sections.flatMap((s) => s.entries.map((e) => e.command.length)),
      ) + 2,
    );
  for (const section of sections) {
    if (lines.length > 0) lines.push("");
    lines.push(`── ${section.group}`);
    for (const entry of section.entries) {
      const pad = Math.max(1, column - entry.command.length);
      lines.push(
        `${entry.command}${" ".repeat(pad)}${entry.summary}`.slice(0, width),
      );
    }
  }
  return lines;
}

/** Overlay rows: a heading per group, then `command  summary` lines. */
export function helpLines(width = 80): string[] {
  const lines: string[] = [];
  const column = Math.min(
    40,
    Math.max(
      ...HELP_SECTIONS.flatMap((s) => s.entries.map((e) => e.command.length)),
    ) + 2,
  );
  for (const section of HELP_SECTIONS) {
    if (lines.length > 0) lines.push("");
    lines.push(`── ${section.group}`);
    for (const entry of section.entries) {
      const pad = Math.max(1, column - entry.command.length);
      lines.push(
        `${entry.command}${" ".repeat(pad)}${entry.summary}`.slice(0, width),
      );
    }
  }
  return lines;
}

/** The `Commands:` block of `dawg --help`. */
export function helpText(): string {
  return HELP_SECTIONS.filter((section) => section.group !== "keys")
    .map(
      (section) =>
        `${section.group}:\n${section.entries
          .map((entry) => `  ${entry.command}`)
          .join("\n")}`,
    )
    .join("\n");
}

/** Usage for a known verb, shown instead of sending a near-miss to the agent. */
const USAGE: Readonly<Record<string, string>> = {
  click: "/click on|off|<volume> · /click 50%",
  "count-in": "/count-in 0|1|2",
  chords:
    "/chords auto|manual|off · voicing <n> · spread · bass · perform · rate · octaves · sevenths · preset · style",
  key: "key <tonic> <mode> | none · key A minor",
  grid: "/grid 1/4|1/8|1/8T|1/16|1/16T|1/32",
  tempo: "tempo takes 20…300 · tempo 120",
  bpm: "tempo takes 20…300 · tempo 120",
  add: "add <note> at <beat> [for <beats>] · add C4 at 0",
  put: "add <note> at <beat> [for <beats>] · add C4 at 0",
  remove: "remove <id> · ids show in the transcript",
  delete: "remove <id> · ids show in the transcript",
  move: "move <id> to <beat>",
  length: "length <id> <beats>",
  velocity: "velocity <id> <0..1>",
  vel: "velocity <id> <0..1>",
  bars: "bars takes 1…256 · bars 8",
  extend: "extend <count> bars · extend 4 bars",
  instrument:
    "instrument <name> · sine piano pluck bass saw square triangle wavetable kit · synth: sawtooth supersaw pulse white pink z_square…",
  volume: "volume takes 0…1 · volume 0.8",
  vol: "volume takes 0…1 · volume 0.8",
  pan: "pan takes -1…1 · pan -0.5",
  wt: "wt <table> | wt <0..1> | wt list · wt basic · wt wt_digital:2",
  wavetable: "wt <table> | wt <0..1> | wt list · wt basic · wt wt_digital:2",
  warpmode: "warpmode none|asym|bendp|bendm|bendmp|sync|quant",
  filter: "filter <hz> [res] · filter 800 0.3 · filter off",
  delay: "delay <beats> [fb] [mix] · delay 0.75 0.4 0.3 · delay off",
  reverb: "reverb <mix> [size] · reverb 0.3 0.6 · reverb off",
  automate: "automate <lane> at <beat> <value> · automate volume at 0 0.5",
  automation: "automate <lane> at <beat> <value> · automate volume at 0 0.5",
  hit: "hit <voice> at <beat> · hit kick at 0",
  pattern: "pattern <voice> <beats...> | every <step> · pattern kick every 1",
  clear: "clear · clear <voice> · clear [<lane>] automation",
  track: "/track <name> · /track drums",
  tracks: "/tracks",
  sessions: "/sessions",
  resume: "/resume [<n>|<name>|<id>]",
  rename: "/rename <name> | --auto",
  fork: "/fork [<name>]",
  status: "/status",
  export: "/export <file> · /export loop.track.json",
  import: "/import <file> · /import loop.track.json",
  sample:
    "/sample <path> [as <voice>] · /sample set <voice> <control> <value>… · /sample set brk fit on clip 1",
  samples: "/sample · lists the focused track's voices",
  view: "/view focus | all",
  transcript: "/transcript",
  log: "/transcript",
  theme: "/theme default | high-contrast | mono",
  motion: "/motion on | off",
  model: "/model [alias | vendor/model]",
  login: "/login [gateway | openrouter | codex | claude]",
  logout: "/logout [provider]",
  auth: "/auth [--check]",
  help: "/help [topic] · /help all · /help music|session|window|keys",
  fx: "fx <effect> <param> <value> | on | off | preset <name> · fx delay mix 0.3",
  synth: "synth <param> <value> | preset <name> · synth lpf 1200",
  pack: "/pack list | info <name> | use <pack>/<sound> | add <url>",
  kit: "/kit [name] · /kit syn909",
  euclid: "/euclid [voice] · euclid hat 7 16",
  menu: "/menu [sound|effects|rhythm|chords|mix|project]",
  play: "/play [on|off] · Ctrl-P",
  meter: "meter <1..16> · meter 3",
  undo: "undo · Ctrl-Z",
  redo: "redo · Ctrl-Y",
};

/** Verbs a typo can be matched against, slash or bare as they are typed. */
const KNOWN_VERBS: readonly string[] = [
  ...new Set(
    [
      ...HELP_SECTIONS.flatMap((section) =>
        section.group === "keys"
          ? []
          : section.entries.map((entry) => entry.command.split(/[\s|[]/)[0]!),
      ),
      ...Object.values(USAGE).map((usage) => usage.split(/[\s|[]/)[0]!),
    ].filter((verb) => /^\/?[a-z][\w-]*$/i.test(verb)),
  ),
];

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j]!;
      row[j] = Math.min(
        row[j]! + 1,
        row[j - 1]! + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = current;
    }
  }
  return row[b.length]!;
}

/**
 * The known command nearest to the first word of `command` (`/clik` →
 * `/click`, `/fx` → `fx`), or undefined when nothing is close.
 */
export function nearestCommand(command: string): string | undefined {
  const word = command.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const bare = word.replace(/^\//, "");
  if (!bare) return undefined;
  let best: { verb: string; distance: number; score: number } | undefined;
  for (const verb of KNOWN_VERBS) {
    const distance = editDistance(bare, verb.replace(/^\//, ""));
    if (distance === 0 && verb === word) continue;
    // Ties go to the form typed: `/patern` → `/pattern`, not `pattern`.
    const sameForm = verb.startsWith("/") === word.startsWith("/");
    const score = distance * 2 + (sameForm ? 0 : 1);
    if (!best || score < best.score) best = { verb, distance, score };
  }
  const limit = bare.length <= 4 ? 1 : 2;
  return best && best.distance <= limit ? best.verb : undefined;
}

/**
 * `tempoo 90` → `tempo 90`: the first word one edit from a bare command
 * whose arguments then parse (`parses` decides). Slash words and inputs
 * whose rest is not that command's arguments (prose) return undefined.
 */
export function typoFix(
  command: string,
  parses: (candidate: string) => boolean,
): string | undefined {
  const text = command.trim();
  if (!text || text.startsWith("/")) return undefined;
  const [first, ...rest] = text.split(/\s+/);
  const word = first!.toLowerCase();
  for (const verb of KNOWN_VERBS) {
    if (verb.startsWith("/") || verb === word) continue;
    if (editDistance(word, verb) !== 1) continue;
    const candidate = [verb, ...rest].join(" ");
    if (parses(candidate)) return candidate;
  }
  return undefined;
}

/**
 * True for a sentence that merely starts with a command verb (`add a walking
 * bass in A minor`, `pan the hats left`): three or more words and no number
 * or note name with an octave. Those are requests for the agent, not
 * malformed commands. Slash words are never prose.
 */
export function looksLikeProse(command: string): boolean {
  const text = command.trim();
  if (text.startsWith("/")) return false;
  const words = text.split(/\s+/);
  return words.length >= 3 && !/\d/.test(text);
}

/**
 * A usage hint when `command` starts with a known verb but did not parse
 * (`pan 3`, `volume 2`, `add H4 at 0`, `/export` with no file); undefined for
 * free text that should go to the agent.
 */
export function usageHint(command: string): string | undefined {
  if (looksLikeProse(command)) return undefined;
  const verb = command.trim().toLowerCase().replace(/^\//, "").split(/\s+/)[0];
  return verb ? USAGE[verb] : undefined;
}
