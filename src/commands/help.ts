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
        summary: "sine piano pluck bass saw square triangle kit",
      },
      { command: "volume <0..1>", summary: "track level" },
      { command: "pan <-1..1>", summary: "left … right" },
      { command: "mute", summary: "silence this track" },
      { command: "unmute", summary: "hear it again" },
      { command: "solo", summary: "only this track" },
      { command: "unsolo", summary: "every track again" },
      { command: "clear", summary: "remove this track's notes" },
      { command: "filter <hz> [res]", summary: "low-pass · filter off" },
      { command: "delay <beats> [fb] [mix]", summary: "ping-pong · delay off" },
      { command: "reverb <mix> [size]", summary: "room · reverb off" },
      {
        command: "automate <lane> at <beat> <value>",
        summary: "volume pan filter resonance delay-feedback delay-mix",
      },
      { command: "clear [<lane>] automation", summary: "drop a lane's points" },
      {
        command: "hit <voice> at <beat>",
        summary: "kit tracks · hit kick at 0",
      },
      {
        command: "pattern <voice> <beats...> | every <step>",
        summary: "pattern kick every 1",
      },
      { command: "clear <voice>", summary: "remove one drum voice" },
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
      { command: "/help", summary: "this list · ?" },
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
      { command: "Esc", summary: "cancel the agent · close an overlay" },
      { command: "Space", summary: "play/pause on an empty prompt" },
      { command: "Ctrl-C", summary: "exit" },
    ],
  },
];

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
    "instrument <name> · sine piano pluck bass saw square triangle kit",
  volume: "volume takes 0…1 · volume 0.8",
  vol: "volume takes 0…1 · volume 0.8",
  pan: "pan takes -1…1 · pan -0.5",
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
  sample: "/sample <path> [as <voice>] · /sample kick.wav as kick",
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
  help: "/help",
};

/**
 * A usage hint when `command` starts with a known verb but did not parse
 * (`pan 3`, `volume 2`, `add H4 at 0`, `/export` with no file); undefined for
 * free text that should go to the agent.
 */
export function usageHint(command: string): string | undefined {
  const verb = command.trim().toLowerCase().replace(/^\//, "").split(/\s+/)[0];
  return verb ? USAGE[verb] : undefined;
}
