#!/usr/bin/env bun
import { randomUUID } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import {
  ensureSession,
  SessionConflictError,
  type SessionRecord,
} from "./session/store.ts";
import { openSessionPort } from "./session/port.ts";
import { compositionDigest, monotonicEpochMs } from "./session/protocol.ts";
import {
  formatSessionLine,
  listSessions,
  printSessions,
} from "./session/list.ts";
import {
  ALL_TRACKS_OPEN_HINT,
  attachTrack,
  forkSession,
  historyEvents,
  namingTarget,
  pickerLines,
  resolveSessionArg,
  SessionLookupError,
  withTrack,
} from "./session/attach.ts";
import { AutoNamer, providerNameGenerator } from "./session/naming.ts";
import { normalizeSessionName } from "./session/meta.ts";
import { parsePrompt } from "./agent/ops.ts";
import { applyMusicCommand, parseMusicCommand } from "./commands/music.ts";
import { applyRhythmCommand, parseRhythmCommand } from "./commands/rhythm.ts";
import {
  applyDrumPattern,
  applySynthKit,
  DRUM_PATTERNS,
  isSynthKitName,
  parsePatternCommand,
  patternLine,
  type PatternCommand,
} from "./commands/drums.ts";
import { kitCatalog } from "./audio/kits.ts";
import { applyEditCommand, parseEditCommand } from "./commands/edit.ts";
import { applyTimeCommand, parseTimeCommand } from "./commands/time.ts";
import {
  barStartTick,
  bpmAtTick,
  hasMeterChanges,
  loopTicksOf,
} from "../core/tempo.ts";
import { applyFxCommand, parseFxCommand } from "./commands/fx.ts";
import { applySynthCommand, parseSynthCommand } from "./commands/synth.ts";
import {
  HELP_TOPICS,
  helpText,
  helpTopicLines,
  nearestCommand,
  typoFix,
  usageHint,
} from "./commands/help.ts";
import { historyTarget, REDO_KIND, UNDO_KIND } from "./commands/history.ts";

import {
  SamplePlacementError,
  addSampleVoice,
  freeVoiceName,
  listSampleVoices,
  parseSampleCommand,
  setSampleControls,
  placeSampleFile,
  samplerTarget,
  voiceNameFrom,
} from "./commands/sample.ts";
import {
  SampleLibrary,
  hasSamplerTracks,
  type SampleBank,
  type SampleProblem,
} from "./audio/samples.ts";
import { drumSnapshotFields, samplerSnapshotFields } from "../tui/drums.ts";
import { highwayLayers } from "../tui/layers.ts";
import { drumVoicePitch, isDrumInstrument } from "../core/drums.ts";
import {
  describeAgentEvent,
  StaleRevisionError,
  type AgentEvent,
  type AgentHost,
} from "./agent/agent.ts";
import {
  isApiSelection,
  providerFingerprint,
  providerLabel,
  runProviderTurn,
  selectProvider,
  type ProviderSelection,
} from "./agent/provider.ts";
import {
  MODEL_CATALOG,
  priceForModel,
  resolveModelChoice,
} from "./agent/models.ts";
import {
  SpendMeter,
  spendLine as formatSpendLine,
  webHostFor,
} from "./agent/usage.ts";
import { configDir } from "./auth/credentials.ts";
import { runAuthCommand, runFirstRunLogin, runTuiLogin } from "./auth/cli.ts";
import {
  modelPickerItems,
  tuiAuthCommand,
  tuiLoginArgs,
  tuiSetModel,
} from "./auth/tui.ts";
import { TransportClock, transportMapFor } from "./audio/clock.ts";
import { AudioEngine } from "./audio/engine.ts";
import {
  DEFAULT_GRID,
  GRIDS,
  PLAY_LEAD_MS,
  PlaySession,
  type LiveEngine,
} from "./tui/play-session.ts";
import { EditMenu, MENU_SECTIONS, type MenuContext } from "./tui/menu.ts";
import {
  Audition,
  SUPERSEDED,
  isChordStageable,
  isStageable,
} from "./tui/audition.ts";
import { EuclidEditor, type EuclidContext } from "./tui/euclid.ts";
import { HINTS, KEYS, keyLines, type KeySection } from "../tui/grammar.ts";
import { renderAudition } from "./audio/audition.ts";
import { renderScorePcm } from "./audio/wav.ts";
import type { PreviewHost } from "./agent/preview-tool.ts";
import { rhythmVoicePitch } from "../core/rhythm.ts";
import {
  applyChordsCommand,
  chordPhrase,
  defaultChordSettings,
  type ChordSettings,
} from "./tui/play-chords.ts";
import {
  cacheLines,
  kitListLines,
  kitTarget,
  packListLines,
  parseKitCommand,
  parsePackCommand,
  useKit,
  useSound,
  type KitCommand,
  type PackCommand,
} from "./commands/pack.ts";
import {
  describeWavetable,
  parseWavetableCommand,
  pickWavetable,
  wavetableListLines,
  wavetableParamEdit,
  type WavetableCommand,
} from "./commands/wavetable.ts";
import {
  ALIASED_PACK,
  DEFAULT_KITS,
  PackError,
  PackStore,
  banksOf,
  packCredits,
  writeCredits,
} from "./audio/packs.ts";
import {
  addNote,
  applyScoreOperation,
  createScore,
  PACK_PREFIX,
  scoreFromJSON,
  SCORE_LIMITS,
  type SampleRef,
  type TrackScore,
  type ScoreOperation,
} from "../core/score.ts";
import { reconcileRhythm } from "../core/rhythm.ts";
import { decodeLoop, encodeLoop } from "../core/loop.ts";
import { scoreToMidi } from "../core/midi.ts";
import type { TrackScoreSnapshot } from "../tui/render.ts";
import { PromptModel } from "../tui/prompt.ts";
import { TerminalInputDecoder } from "../tui/input.ts";
import {
  composeFrame,
  TuiApp,
  type AppView,
  type SyncState,
  type TypesIndicator,
} from "../tui/app.ts";
import { fail, ok, toneOf, warn, type Receipt } from "../tui/activity.ts";
import { systemRunner } from "./auth/runner.ts";
import type { MediaServices } from "./media/types.ts";
import { encodeBuffer } from "../tui/screen.ts";
import { parseThemeName } from "../tui/theme.ts";
import { formatDiagnostic } from "../core/sdk/eval.ts";
import { isProject } from "./project/init.ts";
import { typecheckProject } from "./project/typecheck.ts";
import {
  startProjectSync,
  type ProjectSync,
  type SyncHost,
} from "./project/sync.ts";

/** Whether a bare command parses (no side effects): for typo suggestions. */
function parsesLocally(text: string): boolean {
  return [
    parsePrompt,
    parseMusicCommand,
    parseEditCommand,
    parseRhythmCommand,
    parseFxCommand,
    parseSynthCommand,
    parsePatternCommand,
    parseKitCommand,
    parsePackCommand,
    parseSampleCommand,
    parseWavetableCommand,
    parseTimeCommand,
  ].some((parse) => parse(text) !== undefined);
}

const ESC = "\u001b[";
/** `/sessions` rows shown in the overlay. */
const MAX_LISTED_SESSIONS = 64;

const SUBCOMMANDS = [
  "login",
  "logout",
  "auth",
  "sessions",
  "render",
  "init",
  "check",
];
const VALUE_FLAGS = ["--session", "--track", "--import", "--export", "--theme"];
const FLAGS = [
  ...VALUE_FLAGS,
  "--new",
  "--demo",
  "--help",
  "-h",
  "--version",
  "-v",
  "--reduce-motion",
];
const HELP_TEXT = `dawg · local-first terminal music workstation

Usage:
  dawg [--new] [--session <name|id>] [--track <name>]
  dawg --import <file> --export <file>
  dawg sessions
  dawg render <out.wav|out.mid> [--session <name|id>] [--import <file>]
  dawg init [dir]      project files: song.ts, tracks/<slug>/track.ts, .dawg/sdk
  dawg check           typecheck + evaluate the project; exit 1 on problems
  dawg media doctor|download|stems|analyze|notes|sample|lyrics …  (dawg media --help)
  dawg --version

Usage flags:
  --reduce-motion   static hit/sustain states (also DAWG_REDUCE_MOTION=1)
  --theme <name>    default | high-contrast | mono (NO_COLOR forces mono)

Prompt:
  Enter submit · Shift-Enter newline · Alt-Enter queue · Ctrl-Q toggle queue
  Ctrl-Z undo · Ctrl-Y redo · Ctrl-O transcript · Esc cancel/close · Ctrl-C exit
  Space on an empty prompt toggles playback

Commands (bare music words; app commands take a slash):
${helpText()}

Sign in (the choice is saved and reused until you log out):
  dawg login                   find existing setups and pick a provider
  dawg login gateway|openrouter|codex|claude
  dawg model [alias]           pick a model, with the estimated cost per prompt
  dawg logout [provider] · dawg auth status [--check]
Unrecognized requests go to the agent once a provider is configured
(DAWG_PROVIDER=gateway|openrouter|codex|claude|auto, DAWG_MODEL=<alias>;
DAWG_AI=0 disables the agent).`;
const args = new Set(process.argv.slice(2));
const requestedSession = optionValue("--session");
const explicitTrack = optionValue("--track");
/** The focused track; claimed at startup unless `--track` is given. */
let requestedTrack = explicitTrack ?? "main";
const initialInstrument = isDrumInstrument(requestedTrack) ? "kit" : "sine";
const importPath = optionValue("--import");
const exportPath = optionValue("--export");
if (["login", "logout", "auth", "model"].includes(process.argv[2] ?? ""))
  process.exit(await runAuthCommand(process.argv.slice(2)));
{
  // An unknown DAWG_MODEL is an error, never a silent fallback.
  const fromEnv = process.env.DAWG_MODEL?.trim();
  if (fromEnv && !resolveModelChoice("gateway", fromEnv)) {
    process.stderr.write(
      `dawg: unknown DAWG_MODEL "${fromEnv.slice(0, 40)}"; use one of ${MODEL_CATALOG.map((row) => row.alias).join(", ")} or a vendor/model ID\n`,
    );
    process.exit(2);
  }
}
if (process.argv[2] === "sessions") {
  if (args.has("--help") || args.has("-h"))
    stdout.write(
      "usage: dawg sessions · lists this workspace's sessions, newest first (* marks the current one)\n",
    );
  else await printSessions(process.cwd(), stdout);
  process.exit(0);
}
if (process.argv[2] === "init" || process.argv[2] === "check") {
  const command =
    process.argv[2] === "init"
      ? (await import("./project/init.ts")).runInitCommand
      : (await import("./project/check.ts")).runCheckCommand;
  process.exit(
    await command(process.argv.slice(2), process.cwd(), stdout, process.stderr),
  );
}
if (process.argv[2] === "media") {
  const { runMediaCommand } = await import("./media/cli.ts");
  process.exit(
    await runMediaCommand(
      process.argv.slice(2),
      process.cwd(),
      stdout,
      process.stderr,
    ),
  );
}
if (process.argv[2] === "render") {
  const { runRenderCommand } = await import("./render.ts");
  process.exit(
    await runRenderCommand(
      process.argv.slice(2),
      process.cwd(),
      stdout,
      process.stderr,
    ),
  );
}
if (args.has("--version") || args.has("-v")) {
  stdout.write(`dawg ${await packageVersion()}\n`);
  process.exit(0);
}
if (args.has("--help") || args.has("-h")) {
  stdout.write(`${HELP_TEXT}\n`);
  process.exit(0);
}
// Argument mistakes are rejected here, before `.dawg/` could be created.
{
  const problem = argumentProblem(process.argv.slice(2));
  if (problem) {
    process.stderr.write(`${problem} · dawg --help\n`);
    process.exit(2);
  }
}
const demo =
  args.has("--demo") || process.env.DAWG_DEMO === "1" || !stdin.isTTY;
// First run with no provider (or a saved one that stopped working): the
// sign-in picker, in the shell, before the TUI takes the screen.
if (!demo && process.env.DAWG_AI !== "0" && stdout.isTTY)
  await runFirstRunLogin();

const initial = createScore({
  tracks: [
    { id: requestedTrack, name: requestedTrack, instrument: initialInstrument },
  ],
});
const sessionOptions: { sessionId?: string; setCurrent: boolean } = {
  setCurrent: !requestedSession || args.has("--new"),
};
const selectedSession = args.has("--new")
  ? randomUUID()
  : requestedSession === undefined
    ? undefined
    : await resolveSessionArg(process.cwd(), requestedSession).catch(
        (error: unknown) => {
          if (!(error instanceof SessionLookupError)) throw error;
          process.stderr.write(`${error.message}\n`);
          process.exit(1);
        },
      );
if (selectedSession !== undefined) sessionOptions.sessionId = selectedSession;
/** True when this launch creates `.dawg/`; the strip says so once. */
const freshWorkspace = !(await stat(join(process.cwd(), ".dawg")).then(
  () => true,
  () => false,
));
const session = await ensureSession(initial.toJSON(), sessionOptions);
// dawgd when connected, the file-lock path otherwise (see src/session/port.ts).
let port = await openSessionPort<ReturnType<TrackScore["toJSON"]>>({
  paths: session.paths,
  sessionId: session.record.sessionId,
  label: explicitTrack ?? "window",
  focusedTrackId: explicitTrack ?? null,
  daemon: !demo,
});
let record: SessionRecord<ReturnType<TrackScore["toJSON"]>> =
  port.mode === "daemon" ? await port.load() : session.record;
let score = scoreFromJSON(record.composition);
if (importPath) {
  const imported = decodeLoop(await readLoopFile(importPath));
  score = imported;
  record = await port.append(
    record,
    {
      kind: "score.import",
      payload: { path: importPath },
    },
    score.toJSON(),
  );
}
/** True while the focused track is a reserved draft not yet in the score. */
let draftTrack = false;
let attachNotice = "";
if (!demo) {
  const attached = await attachTrack(port, score, explicitTrack);
  requestedTrack = attached.trackId;
  draftTrack = attached.draft;
  attachNotice = attached.draft
    ? ALL_TRACKS_OPEN_HINT
    : attached.reason === "claimed" && score.tracks.length > 1
      ? `opened · ${requestedTrack}`
      : "";
} else if (explicitTrack === undefined)
  requestedTrack = score.tracks[0]?.id ?? requestedTrack;
if (!draftTrack) await ensureFocusedTrack();

const clock = new TransportClock(score.tempoBpm);
let audio = port.player;
/** Session and today's spend, from the usage each response reports. */
const meter = new SpendMeter(configDir());
void meter.load().catch(() => undefined);
const prompt = new PromptModel({ width: 72, maxVisualRows: 8 });
const tui = new TuiApp({
  io: {
    write: (data) => stdout.write(data),
    columns: () => stdout.columns ?? 80,
    rows: () => stdout.rows ?? 24,
  },
  prompt,
  theme: parseThemeName(optionValue("--theme") ?? process.env.DAWG_THEME),
  reducedMotion:
    args.has("--reduce-motion") || process.env.DAWG_REDUCE_MOTION === "1",
});
let syncState: SyncState = port.sync;
let windowCount = 1;
/** Project file sync when `dawg.json` is in the working directory. */
let projectSync: ProjectSync | undefined;
let packStore: PackStore | undefined;
let reportedSampleProblems = "";
let sampleLibrary: SampleLibrary | undefined;
let typesIndicator: TypesIndicator | undefined;
let announcedName = record.meta.name;
let namer = makeNamer();
/** Re-subscribes the TUI after /fork or /resume replaces `port`. */
let rebindPort: () => void = () => undefined;
/** Play mode's controller; kept across entries so settings persist. */
let play: PlaySession | undefined;
/** Chord-mode settings, shared by every track's play session. */
const chordSettings = defaultChordSettings();
/** The hand-editing menu (`/menu`, Ctrl-K), drawn as the picker overlay. */
const menu = new EditMenu();
/** The Euclidean rhythm editor (`/euclid`, Rhythm in `/menu`). */
const euclid = new EuclidEditor();
/** Live voice id for auditions (play-mode voices use small positive ids). */
const AUDITION_VOICE = 0x7fff_0001;
/** A voice to audition once the editor's queued command lands. */
let pendingAudition: string | undefined;
/** The pattern the /pattern picker last previewed. */
let patternPreview: string | undefined;
/** Daemon windows play no loop; play mode monitors through its own engine. */
let monitorEngine: AudioEngine | undefined;
/** The audition loop and staged edits (src/tui/audition.ts), made lazily. */
let auditionLoop: Audition | undefined;
/** Pickers that host the audition loop (Space, `a`, `c`, hover). */
const AUDITION_PICKERS = new Set(["kit", "pattern", "try"]);
const TRY_USAGE =
  "/try <sound command> · /try fx reverb mix 0.6 · /try agent on|off";
/** Whether the agent's preview_sound plays its snippet in this window. */
let agentPreviewPlays = process.env.DAWG_AGENT_PREVIEW !== "off";
const AGENT_PREVIEW_VOICE = 0x7fff_0002;
/**
 * Set while a staged command runs: `commitScore` hands its result here
 * instead of appending, and a remote revision that lands meanwhile waits in
 * `committed` (the window's `score` is the staged base until it finishes).
 */
/** A `/chords …` settings command (staged as window state, not a score edit). */
const CHORDS_COMMAND = /^\/chords\s+(.+)$/i;
/** Whether the chord settings screen was open at the last menu redraw. */
let chordScreenWas = false;
let stageCapture: { next?: TrackScore; committed?: TrackScore } | undefined;
/** Redraw soon (the audition reports renders between frames). */
let requestFrame: () => void = () => undefined;
/** The decoded sampler voices, for play mode's live voices. */
let liveSampleBank: SampleBank | undefined;
/** The in-flight agent turn: Esc aborts it, Enter steers it. */
let agentTurn: { controller: AbortController; steering: string[] } | undefined;
let reportAgentActivity: (text: string) => void = () => undefined;
// Declared before `await runInteractive()` runs, or assigning it is a TDZ error.
let agentEventSink: (event: AgentEvent) => void = () => undefined;
/** Resolved lazily (and again after /login); `undefined` until first needed. */
let provider: Promise<ProviderSelection> | undefined;
let providerStamp = { fingerprint: "", at: 0, offline: false };
let providerName = "";
/** Undo/redo key hints shown so far; only the first few receipts carry one. */
let undoHintsShown = 0;
const MAX_UNDO_HINTS = 3;
let invalidNoticeShown = false;
/** True while /login has handed the terminal to a shell flow. */
let screenSuspended = false;
/** Redraw from outside the input loop (usage arrives asynchronously). */
let tickUi: () => void = () => undefined;
/** Suspend the TUI around an interactive shell flow (set by runInteractive). */
let handoff: <T>(flow: () => Promise<T>) => Promise<T> = (flow) => flow();

/** `$0.12 session · $0.48 today · opus-5.5 · gateway`, sized to the width. */
function spendLine(): string {
  const width = stdout.columns ?? 80;
  if (!providerName || providerName === "offline")
    return width >= 40 ? "no model · dawg login" : "";
  const [model, provider] = providerName.split(" · ");
  return formatSpendLine(
    {
      kind: providerSnapshot?.kind === "xcb" ? "subscription" : "api",
      ...(model ? { model } : {}),
      ...(provider ? { provider } : {}),
      sessionUsd: meter.sessionUsd,
      todayUsd: meter.todayUsd,
    },
    Math.max(0, width - 8),
  );
}
let providerSnapshot: ProviderSelection | undefined;
if (demo) {
  if (score.notes.length === 0) score = seedDemo(score, requestedTrack);
  if (exportPath)
    await writeFile(resolve(exportPath), encodeLoop(score), "utf8");
  renderOnce(
    score,
    clock.beatAt(),
    "demo · press space to play",
    "add C4 at 0 for 1",
    0,
  );
  process.exit(0);
}

if (exportPath) {
  await writeFile(resolve(exportPath), encodeLoop(score), "utf8");
  if (!stdin.isTTY) process.exit(0);
}

await runInteractive();

/** Describes an unknown subcommand or option in `argv`, or undefined. */
function argumentProblem(argv: readonly string[]): string | undefined {
  if (argv[0] && !argv[0].startsWith("-") && !SUBCOMMANDS.includes(argv[0]))
    return `unknown command · ${argv[0]}`;
  if (argv[0] && SUBCOMMANDS.includes(argv[0])) return undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (VALUE_FLAGS.includes(arg)) {
      index += 1;
      continue;
    }
    if (arg.startsWith("-") && !FLAGS.includes(arg))
      return `unknown option · ${arg}`;
    if (!arg.startsWith("-")) return `unknown command · ${arg}`;
  }
  return undefined;
}

async function packageVersion(): Promise<string> {
  const raw = await readFile(
    new URL("../package.json", import.meta.url),
    "utf8",
  );
  return (JSON.parse(raw) as { version?: string }).version ?? "0.0.0";
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

function seedDemo(value: TrackScore, trackId: string): TrackScore {
  const instrument = value.tracks.find(
    (track) => track.id === trackId,
  )?.instrument;
  if (isDrumInstrument(instrument)) return seedDemoDrums(value, trackId);
  return addNote(
    addNote(
      addNote(value, {
        id: "demo-1",
        trackId,
        startTick: 0,
        durationTicks: 240,
        pitch: 60,
        velocity: 0.9,
      }),
      {
        id: "demo-2",
        trackId,
        startTick: 480,
        durationTicks: 480,
        pitch: 64,
        velocity: 0.75,
      },
    ),
    {
      id: "demo-3",
      trackId,
      startTick: 960,
      durationTicks: 240,
      pitch: 67,
      velocity: 0.85,
    },
  );
}

/** A one-bar kick/snare/hat groove for a drum track in demo mode. */
function seedDemoDrums(value: TrackScore, trackId: string): TrackScore {
  const hits: Array<["kick" | "snare" | "hat", number, number]> = [
    ["kick", 0, 0.95],
    ["hat", 0.5, 0.6],
    ["snare", 1, 0.85],
    ["hat", 1.5, 0.6],
    ["kick", 2, 0.9],
    ["hat", 2.5, 0.6],
    ["snare", 3, 0.85],
    ["hat", 3.5, 0.6],
  ];
  return hits.reduce(
    (next, [voice, beat, velocity], index) =>
      addNote(next, {
        id: `demo-${index + 1}`,
        trackId,
        startTick: Math.round(beat * next.ticksPerBeat),
        durationTicks: Math.round(next.ticksPerBeat / 4),
        pitch: drumVoicePitch(voice),
        velocity,
      }),
    value,
  );
}

function snapshot(
  value: TrackScore,
  beat: number,
  activity?: string,
): TrackScoreSnapshot {
  const notes = value.notes
    .filter((note) => note.trackId === requestedTrack)
    .map((note) => ({
      id: note.id,
      startBeat: note.startTick / value.ticksPerBeat,
      durationBeats: note.durationTicks / value.ticksPerBeat,
      pitch: note.pitch,
      velocity: note.velocity,
      muted: value.tracks.find((track) => track.id === requestedTrack)?.muted,
    }));
  return {
    notes,
    trackName:
      value.tracks.find((track) => track.id === requestedTrack)?.name ??
      requestedTrack,
    trackId: requestedTrack,
    sessionId: record.sessionId,
    revision: record.revision,
    bpm: value.time?.tempo
      ? bpmAtTick(value, beat * value.ticksPerBeat)
      : value.tempoBpm,
    key: value.key ?? undefined,
    loopBeats: loopTicksOf(value) / value.ticksPerBeat,
    beatsPerBar: value.beatsPerBar,
    ...(hasMeterChanges(value)
      ? {
          barBeats: Array.from(
            { length: value.bars },
            (_, bar) => barStartTick(value, bar) / value.ticksPerBeat,
          ),
        }
      : {}),
    laneCount: 24,
    currentBeat: beat,
    playing: clock.playing,
    activity,
    ...drumSnapshotFields(
      value.tracks.find((track) => track.id === requestedTrack)?.instrument,
      notes,
    ),
    ...samplerSnapshotFields(
      value.tracks.find((track) => track.id === requestedTrack),
      notes,
    ),
    layers:
      tui.highwayView === "all"
        ? highwayLayers(
            value.tracks,
            value.notes,
            value.ticksPerBeat,
            requestedTrack,
          )
        : undefined,
  };
}

function renderOnce(
  value: TrackScore,
  transportBeat: number,
  activity?: string,
  draft = "",
  nowMs = Date.now(),
): void {
  if (activity) tui.activity.pushCard(activity, { tone: "info" });
  if (draft) tui.input({ type: "paste", text: draft });
  const frame = composeFrame(
    appView(value, transportBeat),
    tui.ui,
    { width: Math.max(24, stdout.columns ?? 80), height: 20 },
    nowMs,
  );
  stdout.write(`${encodeBuffer(frame.buffer, tui.capabilities)}\n`);
}

function appView(value: TrackScore, beat: number): AppView {
  return {
    score: snapshot(value, beat),
    beat,
    // `opus-5.5 · gateway`, `sonnet · claude`; hidden when offline.
    model:
      providerName && providerName !== "offline" ? providerName : undefined,
    spend: spendLine(),
    agentOffline: providerName === "offline" || process.env.DAWG_AI === "0",
    sync: syncState,
    sessionName: record.meta.name,
    windows: windowCount,
    types: typesIndicator,
    play: play?.on ? play.header() : undefined,
  };
}

/** What the strip compares a receipt against: the revision and score before. */
type Baseline = { revision: number; score: TrackScore };
function baseline(): Baseline {
  return { revision: record.revision, score };
}

/**
 * Show a command receipt in the activity strip. The tone comes from the
 * receipt itself (strings fall back to a legacy regex); the revision label
 * appears when the revision moved, and the undo hint only when the score
 * changed in this session (not for forks, resumes or transport).
 */
function receipt(result: string | Receipt, base?: Baseline): void {
  const message = typeof result === "string" ? result : result.text;
  const tone = toneOf(result);
  const changed = base !== undefined && record.revision !== base.revision;
  const scoreChanged =
    changed && record.sessionId !== undefined && score !== base.score;
  if (tone === "error") {
    tui.activity.pushError(message);
    return;
  }
  const hint =
    scoreChanged && undoHintsShown < MAX_UNDO_HINTS
      ? message.startsWith("undid")
        ? "^y redo"
        : "^z undo"
      : undefined;
  if (hint) undoHintsShown += 1;
  tui.activity.pushCard(message, {
    tone,
    baseRevision: changed ? base.revision : undefined,
    resultRevision: changed ? record.revision : undefined,
    hint,
    trackId: requestedTrack,
  });
}

/** One shape for thrown errors: `<what> · <why> · <next step>`. */
function describeError(command: string, error: unknown): string {
  const detail = error as { code?: unknown; path?: unknown } | undefined;
  const message = error instanceof Error ? error.message : String(error);
  if (detail?.code === "ENOENT" && typeof detail.path === "string")
    return `no such file · ${relative(process.cwd(), detail.path)}`;
  const verb = command.trim().split(/\s+/)[0]?.replace(/^\//, "") || "command";
  return `${verb} failed · ${message}`;
}

function truncateForCard(value: string): string {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > 32 ? `${line.slice(0, 31)}…` : line;
}

async function runInteractive(): Promise<void> {
  stdin.setRawMode?.(true);
  stdin.resume();
  // Alternate screen, hidden cursor, bracketed paste.
  stdout.write(`${ESC}?1049h${ESC}?25l${ESC}?2004h${ESC}2J`);
  const inputDecoder = new TerminalInputDecoder();
  const queuedPrompts: string[] = [];
  let processingQueue = false;
  const runPrompt = async (text: string): Promise<void> => {
    const ui = tui.command(text);
    if (ui !== undefined) {
      tui.activity.pushCard(ui, { tone: "info" });
      return;
    }
    tui.activity.pushRequest(text);
    const base = baseline();
    const baseSession = record.sessionId;
    try {
      const message = await submit(text);
      // Agent turns report through agentEventSink; skip a duplicate receipt.
      if (!agentReported) receipt(message, base);
      // Naming runs later on a timer; it never delays the next prompt.
      if (record.sessionId === baseSession)
        namer.noteTurn({
          score,
          prompt: text,
          accepted: record.revision !== base.revision,
        });
    } catch (error) {
      tui.activity.pushError(describeError(text, error));
    } finally {
      agentReported = false;
    }
  };
  let agentReported = false;
  const drainQueue = async (): Promise<void> => {
    if (processingQueue) return;
    processingQueue = true;
    try {
      while (queuedPrompts.length > 0) {
        const nextPrompt = queuedPrompts.shift()!;
        tui.activity.setQueueDepth(queuedPrompts.length);
        await runPrompt(nextPrompt);
        if (pendingAudition && queuedPrompts.length === 0) {
          const voice = pendingAudition;
          pendingAudition = undefined;
          audition(voice);
        }
        tick(true);
      }
    } finally {
      processingQueue = false;
      tui.activity.setQueueDepth(queuedPrompts.length);
    }
  };
  const tick = (force = false) => {
    if (screenSuspended) return;
    followCommitted();
    play?.tick();
    // Values in the menu follow the score as edits land.
    if (menu.open) refreshMenu();
    if (euclid.open) refreshEuclid();
    refreshAuditionPicker();
    tui.render(appView(score, clock.beatAt()), { force });
  };
  requestFrame = () => tick(true);
  reportAgentActivity = () => {
    tui.activity.applyAgentEvent({ type: "start", model: providerName });
  };
  agentEventSink = (event) => {
    if (event.type === "usage") return;
    tui.activity.applyAgentEvent(event);
    if (event.type === "done" || event.type === "error") agentReported = true;
  };
  // ~30 fps cap; the differential writer only emits changed rows.
  let timer = setInterval(tick, tui.frameIntervalMs);
  const onResize = () => {
    tui.invalidate();
    tick(true);
  };
  stdout.on("resize", onResize);
  let applying: Promise<void> = Promise.resolve();
  const applyLatest = (latest: typeof record): Promise<void> =>
    (applying = applying.then(() => applyRecord(latest)));
  const applyRecord = async (latest: typeof record): Promise<void> => {
    try {
      if (latest.revision > record.revision) {
        const previousRevision = record.revision;
        record = latest;
        if (stageCapture)
          stageCapture.committed = scoreFromJSON(record.composition);
        else score = scoreFromJSON(record.composition);
        clock.follow(score);
        if (clock.playing) void audio.play(score);
        // Connected windows follow dawgd's transport frames instead.
        const replay =
          port.mode === "file" ? latest.events.slice(previousRevision) : [];
        for (const event of replay) {
          if (
            event.kind !== "transport" ||
            typeof event.payload !== "object" ||
            event.payload === null
          )
            continue;
          const payload = event.payload as {
            action?: string;
            playing?: boolean;
            beat?: number;
          };
          if (
            typeof payload.playing === "boolean" &&
            typeof payload.beat === "number" &&
            Number.isFinite(payload.beat)
          ) {
            clock.sync(payload.beat, payload.playing, Date.parse(event.at));
            if (payload.playing) void audio.play(score, clock.beatAt());
            else audio.stop();
          } else if (typeof payload.playing === "boolean")
            await setTransport(payload.playing ? "play" : "pause");
          else if (payload.action === "play") await setTransport("play");
          else if (payload.action === "pause") await setTransport("pause");
          else if (payload.action === "toggle") await setTransport("toggle");
        }
        projectSync?.scoreChanged(score);
        tui.activity.pushCard("synced from another window", {
          tone: "info",
          baseRevision: previousRevision,
          resultRevision: record.revision,
        });
      }
    } catch {
      // An invalid composition is skipped; the next update retries.
    }
  };
  const onUpdate: Parameters<typeof port.subscribe>[0] = (update) => {
    if (update.type === "record") {
      void applyLatest(update.record);
      adoptMeta(update.record.meta);
    } else if (update.type === "meta") adoptMeta(update.meta);
    else if (update.type === "presence") windowCount = update.clients.length;
    else if (update.type === "sync") syncState = update.sync;
    else if (update.type === "transport") {
      // Every window renders the same hit line from dawgd's timestamp.
      const { playing, beat, bpm, atMs } = update.transport;
      clock.setTempo(bpm);
      clock.setTimeMap(transportMapFor(score));
      clock.sync(beat, playing, atMs, monotonicEpochMs());
    } else if (update.type === "status") {
      syncState = port.sync;
      tui.activity.pushCard(update.message, {
        tone: syncState === "offline" ? "warning" : "info",
      });
    }
  };
  let unsubscribe = port.subscribe(onUpdate);
  const refreshPresence = () =>
    void port
      .presence()
      .then((clients) => {
        windowCount = Math.max(1, clients.length);
      })
      .catch(() => undefined);
  // File-lock windows have no presence push; poll the heartbeat files.
  const presenceTimer = setInterval(() => {
    if (port.mode === "file") refreshPresence();
  }, 2_000);
  refreshPresence();
  rebindPort = () => {
    unsubscribe();
    syncState = port.sync;
    unsubscribe = port.subscribe(onUpdate);
    refreshPresence();
  };
  if (freshWorkspace)
    tui.activity.pushCard("created .dawg/ · add it to .gitignore", {
      tone: "info",
    });
  if (attachNotice)
    tui.activity.pushCard(attachNotice, {
      tone: "info",
      trackId: requestedTrack,
      hint: draftTrack ? "first edit creates it" : undefined,
    });
  if (port.status !== "file session")
    tui.activity.pushCard(port.status, { tone: "info" });
  if (await isProject(process.cwd()))
    projectSync = startProjectSync(syncHost());
  void currentProvider().then(() => tick(true));
  tickUi = () => tick(true);
  reportSampleProblems(score);
  // Input arrives through a detachable listener (not `for await`), so /login
  // can hand the terminal to an interactive shell flow and take it back.
  const inbox: string[] = [];
  let wake: (() => void) | undefined;
  const onData = (chunk: Buffer | string) => {
    inbox.push(String(chunk));
    wake?.();
  };
  const onEnd = () => {
    inbox.push("\u0000eof");
    wake?.();
  };
  stdin.on("data", onData);
  stdin.on("end", onEnd);
  async function* chunks(): AsyncGenerator<string> {
    for (;;) {
      while (inbox.length === 0)
        await new Promise<void>((resolve) => (wake = resolve));
      wake = undefined;
      const next = inbox.shift()!;
      if (next === "\u0000eof") return;
      yield next;
    }
  }
  handoff = async <T>(flow: () => Promise<T>): Promise<T> => {
    if (screenSuspended) return flow();
    screenSuspended = true;
    clearInterval(timer);
    stdin.off("data", onData);
    stdin.pause();
    stdin.setRawMode?.(false);
    // Leave the alternate screen; restore the cursor and plain paste.
    stdout.write(`${ESC}0m${ESC}?2004l${ESC}?25h${ESC}?1049l`);
    try {
      return await flow();
    } finally {
      stdout.write(`${ESC}?1049h${ESC}?25l${ESC}?2004h${ESC}2J`);
      stdin.setRawMode?.(true);
      stdin.on("data", onData);
      stdin.resume();
      screenSuspended = false;
      timer = setInterval(tick, tui.frameIntervalMs);
      tui.invalidate();
      tick(true);
    }
  };
  tick(true);
  try {
    let exiting = false;
    for await (const text of chunks()) {
      // A read that is exactly ESC is the Esc key, not the start of a sequence.
      const values = [
        ...inputDecoder.push(text),
        ...(text === "\u001b" ? inputDecoder.flush() : []),
      ];
      for (const value of values) {
        // The `?` panel closes on any key (Ctrl-C still quits).
        if (tui.ui.keys && typeof value === "string" && value !== "\u0003") {
          tui.closeKeys();
          tick(true);
          continue;
        }
        if (value === "?" && keysScreen()) {
          showKeys();
          tick(true);
          continue;
        }
        // The rhythm editor owns every key while it is up (Esc backs out).
        if (typeof value === "string" && euclid.open) {
          if (tui.ui.overlay !== "picker" || tui.ui.picker?.id !== "euclid")
            euclid.close();
          else {
            const result = euclid.key(value, euclidContext());
            if (result.type === "close") {
              const back = euclid.returnTo;
              euclid.close();
              tui.closePicker();
              if (back === "menu") openMenu();
              else leaveAuditionScreen();
            } else if (result.type === "run") {
              if (!stageIfAuditioning(result.command)) {
                queuedPrompts.unshift(result.command);
                if (result.audition) pendingAudition = result.audition;
                void drainQueue();
              }
            } else if (result.type === "audition") audition(result.voice);
            else if (result.type === "loop") auditionKeyPressed(result.key);
            else if (result.type === "revert") revertStaged();
            else if (result.type === "keep")
              void keepStaged()
                .then((outcome) => receipt(outcome))
                .catch((error) =>
                  tui.activity.pushError(describeError("keep", error)),
                )
                .finally(() => tick(true));
            if (result.type !== "pass") {
              refreshEuclid();
              tick(true);
              continue;
            }
          }
        }
        // The edit menu owns every key while it is up (Esc backs out).
        if (typeof value === "string" && menu.open) {
          if (tui.ui.overlay !== "picker" || tui.ui.picker?.id !== "menu")
            menu.close();
          else {
            const result = menu.key(value, menuContext());
            if (result.type === "close") {
              tui.closePicker();
              leaveAuditionScreen();
            } else if (result.type === "run") {
              if (!stageIfAuditioning(result.command)) {
                queuedPrompts.unshift(result.command);
                void drainQueue();
              }
            } else if (result.type === "audition")
              auditionKeyPressed(result.key);
            else if (result.type === "revert") revertStaged();
            else if (result.type === "hover")
              hoverItem(result.command, result.key);
            else if (result.type === "unhover")
              void auditionLoop
                ?.unhover(result.key)
                .finally(() => requestFrame());
            else if (result.type === "choose")
              chooseItem(result.command, result.key);
            else if (result.type === "keep")
              void keepStaged()
                .then((outcome) => receipt(outcome))
                .catch((error) =>
                  tui.activity.pushError(describeError("keep", error)),
                )
                .finally(() => tick(true));
            if (result.type !== "pass") {
              refreshMenu();
              tick(true);
              continue;
            }
          }
        }
        // F1 opens the guides from anywhere the prompt has focus.
        if (
          (value === "\u001bOP" || value === "\u001b[11~") &&
          (tui.ui.overlay === undefined || tui.ui.overlay === "guide")
        ) {
          if (tui.ui.overlay === "guide") tui.closeGuide();
          else tui.openGuide();
          tick(true);
          continue;
        }
        // Ctrl-K opens the menu on an empty prompt (in play mode too); with
        // text it keeps its kill-to-end-of-line meaning.
        if (
          value === "\u000b" &&
          prompt.value.length === 0 &&
          tui.ui.overlay === undefined
        ) {
          openMenu();
          tick(true);
          continue;
        }
        if (typeof value === "string" && play?.on && playKey(value)) {
          tick(true);
          continue;
        }
        // Ctrl-P enters play mode. A bare `p` would steal the first letter of
        // `pan`, `pattern`, `play` and every prose request starting with p.
        if (value === "\u0010" && tui.ui.overlay === undefined) {
          void enterPlay()
            .then((outcome) => receipt(outcome))
            .finally(() => tick(true));
          continue;
        }
        // The prompt is always focused, so ordinary `q` must remain typeable in
        // requests (for example, "quiet hi-hat"). Ctrl-C is the unambiguous
        // shell exit key; Ctrl-Q is reserved for prompt mode switching.
        // Keep the empty-prompt space shortcut for transport, while allowing
        // ordinary spaces once a request is being composed.
        if (
          value === " " &&
          prompt.value.length === 0 &&
          !(tui.ui.overlay === "picker" && tui.ui.picker?.audition) &&
          tui.ui.overlay !== "guide"
        ) {
          // Never await a daemon round trip here: the key loop must stay
          // live for Esc, quit and redraws while the toggle is in flight.
          void toggleTransport()
            .catch((error: unknown) => {
              tui.activity.pushCard(
                `transport failed · ${error instanceof Error ? error.message : String(error)}`,
                { tone: "error" },
              );
            })
            .finally(() => tick(true));
        } else {
          const input = tui.input(value);
          const action = input.type === "action" ? input.action : undefined;
          if (input.type === "ui") {
            if (input.command === "quit") exiting = true;
            else if (
              (input.command === "undo" || input.command === "redo") &&
              !agentTurn
            ) {
              const base = baseline();
              const command = input.command;
              void stepHistory(command)
                .then((outcome) => receipt(outcome, base))
                .catch((error: unknown) => {
                  tui.activity.pushCard(
                    `${command} failed · ${error instanceof Error ? error.message : String(error)}`,
                    { tone: "error" },
                  );
                })
                .finally(() => tick(true));
            }
          } else if (input.type === "pick-move") {
            // Moving through a list auditions the row under the cursor on
            // the loop; with the loop off, /pattern plays one bar of it.
            if (auditionLoop?.looping && isStageable(input.value))
              hoverItem(input.value, `picker:${input.picker}`);
            else if (input.picker === "pattern")
              previewPattern(input.value.replace(/^\/pattern\s+/, ""));
          } else if (input.type === "pick-audition") {
            pickerAuditionKey(input.key);
          } else if (input.type === "pick-cancel") {
            if (AUDITION_PICKERS.has(input.picker)) leaveAuditionScreen();
          } else if (input.type === "pick" && input.picker === "try") {
            if (input.value === "keep")
              void keepStaged()
                .then((outcome) => receipt(outcome))
                .catch((error) =>
                  tui.activity.pushError(describeError("keep", error)),
                )
                .finally(() => {
                  stopAuditionLoop();
                  tick(true);
                });
            else leaveAuditionScreen();
          } else if (
            input.type === "pick" &&
            AUDITION_PICKERS.has(input.picker) &&
            auditionLoop?.staging
          ) {
            // Enter in an auditioning list keeps what you hear.
            const loop = auditionLoop;
            const key = `picker:${input.picker}`;
            void (
              isStageable(input.value)
                ? loop.hover(input.value, key)
                : Promise.resolve()
            )
              .then(() => loop.settle(key))
              .then(() => keepStaged())
              .then((outcome) => receipt(outcome))
              .catch((error) =>
                tui.activity.pushError(describeError("keep", error)),
              )
              .finally(() => {
                stopAuditionLoop();
                tick(true);
              });
          } else if (input.type === "pick") {
            // Picker choices run as the command they stand for.
            queuedPrompts.unshift(
              input.picker === "resume"
                ? `/resume ${input.value}`
                : input.value,
            );
            void drainQueue();
          } else if (action?.kind === "exit") exiting = true;
          else if (action?.kind === "cancel" && agentTurn) {
            agentTurn.controller.abort();
            tui.activity.setSpinner("cancelling");
          } else if (action?.kind === "submit" && action.value && agentTurn) {
            // Enter during a turn steers it; Alt-Enter still queues a follow-up.
            agentTurn.steering.push(action.value);
            tui.activity.pushCard(
              `steering · ${truncateForCard(action.value)}`,
              { tone: "agent", hint: "next step" },
            );
          } else if (action?.kind === "submit" && action.value) {
            queuedPrompts.unshift(action.value);
            // Do not await: the input loop must stay live so Esc can cancel.
            void drainQueue();
          } else if (action?.kind === "queue" && action.value) {
            queuedPrompts.push(action.value);
            tui.activity.setQueueDepth(queuedPrompts.length);
            tui.activity.pushCard(`queued · ${truncateForCard(action.value)}`, {
              tone: "info",
            });
            void drainQueue();
          }
        }
        if (exiting) break;
        tick(true);
      }
      if (exiting) break;
    }
  } finally {
    stdin.off("data", onData);
    stdin.off("end", onEnd);
    clearInterval(timer);
    clearInterval(presenceTimer);
    await projectSync?.stop();
    namer.dispose();
    stdout.off("resize", onResize);
    unsubscribe();
    await play?.exit().catch(() => undefined);
    await monitorEngine?.dispose().catch(() => undefined);
    audio.stop();
    await port.close();
    stdin.setRawMode?.(false);
    stdin.pause();
    stdout.write(`${ESC}0m${ESC}?2004l${ESC}?25h${ESC}?1049l`);
  }
}

/** `unknown command /clik · did you mean /click? · /help`. */
function unknownCommand(command: string): string {
  const word = command.split(/\s+/)[0] ?? command;
  const near = nearestCommand(command);
  return near
    ? `unknown command ${word} · did you mean ${near}? · /help`
    : `unknown command ${word} · /help`;
}

async function submit(prompt: string): Promise<string | Receipt> {
  const command = prompt.trim();
  const helpCommand = command.match(/^\/?(?:help|\?)(?:\s+(\S+))?$/i);
  if (helpCommand) {
    const topic = helpCommand[1];
    const lines = helpTopicLines(
      topic,
      Math.max(40, (stdout.columns ?? 80) - 10),
    );
    if (!lines)
      return fail(
        `no help topic ${topic} · /help all · ${HELP_TOPICS.join(" ")}`,
      );
    tui.openText(topic ? `help · ${topic.toLowerCase()}` : "help", lines);
    return ok(
      topic
        ? `help · ${topic.toLowerCase()}`
        : "help · /help all for every command",
    );
  }
  if (/^\/?tracks$/i.test(command)) {
    const problems = await sampleProblems(score);
    const lines = score.tracks.map((track) => {
      const voices = track.sampler
        ? Object.keys(track.sampler.voices).length
        : 0;
      const missing = problems.filter(
        (problem) => problem.trackId === track.id && problem.level === "error",
      ).length;
      const samples = track.sampler
        ? ` · ${voices} sample${voices === 1 ? "" : "s"}${missing ? ` · ${missing} missing` : ""}`
        : "";
      return `${track.id === requestedTrack ? "*" : " "} ${track.id} · ${track.instrument}${samples}${track.muted ? " · muted" : ""}${track.solo ? " · solo" : ""}`;
    });
    tui.openText("tracks · * focused", lines);
    return ok(`${lines.length} track${lines.length === 1 ? "" : "s"}`);
  }
  const playCommand = command.match(/^\/play(?:\s+(on|off))?$/i);
  if (playCommand) {
    const wanted = playCommand[1]?.toLowerCase();
    if (wanted === "off" || (wanted === undefined && play?.on))
      return exitPlay();
    return enterPlay();
  }
  const clickCommand = command.match(/^\/click(?:\s+(.+))?$/i);
  if (clickCommand) {
    const message = playSession().clickCommand(clickCommand[1] ?? "");
    return message.startsWith("usage") || message.startsWith("click volume")
      ? fail(message)
      : ok(message);
  }
  const chordsCommand = command.match(/^\/chords(?:\s+(.+))?$/i);
  if (chordsCommand) {
    const result = applyChordsCommand(chordSettings, chordsCommand[1] ?? "");
    return result.ok ? ok(result.message) : fail(result.message);
  }
  const countIn = command.match(/^\/count-?in\s+([0-2])$/i);
  if (countIn) return ok(playSession().setCountIn(Number(countIn[1])));
  const euclidCommand = command.match(/^\/euclid(?:\s+(\S+))?$/i);
  if (euclidCommand) {
    const from = menu.open ? "menu" : undefined;
    if (menu.open) {
      menu.close();
      tui.closePicker();
    }
    openEuclid(euclidCommand[1]?.toLowerCase(), from);
    return ok("rhythm editor");
  }
  const tryCommand = command.match(/^\/try(?:\s+(.+))?$/i);
  if (tryCommand) return tryPrompt(tryCommand[1]?.trim() ?? "");
  const menuCommand = command.match(/^\/menu(?:\s+(\S+))?$/i);
  if (menuCommand) {
    const section = menuCommand[1]?.toLowerCase();
    if (section && !(MENU_SECTIONS as readonly string[]).includes(section))
      return fail(`/menu [${MENU_SECTIONS.join("|")}]`);
    openMenu(section);
    return ok("menu");
  }
  const gridCommand = command.match(/^\/grid\s+(\S+)$/i);
  if (gridCommand) {
    const message = playSession().setGrid(gridCommand[1]!);
    return message
      ? ok(message)
      : fail("usage: /grid 1/4|1/8|1/8T|1/16|1/16T|1/32");
  }
  if (/^\/status$/i.test(command))
    return ok(
      `status · ${record.meta.name} · rev ${record.revision} · ${compositionDigest(record.composition)} · ${port.mode === "daemon" ? "shared via dawgd" : "saved locally · no daemon"}`,
    );
  if (/^\/?undo$/i.test(command)) return stepHistory("undo");
  if (/^\/?redo$/i.test(command)) return stepHistory("redo");
  const trackCommand = command.match(
    /^\/?(?:add\s+)?track\s+([a-z0-9._-]{1,64})$/i,
  );
  if (trackCommand) return focusTrack(trackCommand[1]!.toLowerCase());
  const sample = parseSampleCommand(command);
  if (sample) return sampleCommand(sample);
  const pack = parsePackCommand(command);
  if (pack) return packCommand(pack);
  const pattern = parsePatternCommand(command);
  if (pattern) return patternCommand(pattern);
  const kit = parseKitCommand(command);
  if (kit) return kitCommand(kit, /^\/kit\s*$/i.test(command.trim()));
  const wavetable = parseWavetableCommand(command);
  if (wavetable) return wavetableCommand(wavetable);
  const sessionReply = await sessionCommand(command);
  if (sessionReply !== undefined) return sessionReply;
  const time = parseTimeCommand(command);
  if (time) {
    if (time.type !== "tempo-map") await materializeDraft();
    const result = applyTimeCommand(score, requestedTrack, time);
    if (result.next && result.kind)
      await commitScore(result.next, result.kind, result.payload);
    return result.ok ? ok(result.message) : fail(result.message);
  }
  const edit = parseEditCommand(command);
  if (edit) {
    await materializeDraft();
    const result = applyEditCommand(score, requestedTrack, edit);
    if (result.next && result.kind)
      await commitScore(result.next, result.kind, result.payload);
    return result.ok ? ok(result.message) : fail(result.message);
  }
  const rhythm = parseRhythmCommand(command);
  if (rhythm) {
    await materializeDraft();
    const result = applyRhythmCommand(score, requestedTrack, rhythm);
    if (result.next && result.kind)
      await commitScore(result.next, result.kind, result.payload);
    return result.ok ? ok(result.message) : fail(result.message);
  }
  const fx = parseFxCommand(command);
  if (fx) {
    if (fx.type !== "fx-list") await materializeDraft();
    // A pack impulse is pinned (sha256 + url) once, as wavetable tables are.
    let pinnedIr: SampleRef | undefined;
    if (fx.type === "fx-ir" && fx.ir?.startsWith(PACK_PREFIX)) {
      try {
        pinnedIr = await packs().pin(fx.ir);
      } catch (error) {
        if (error instanceof PackError)
          return fail(`reverb ir · ${error.message}`);
        throw error;
      }
    }
    const result = applyFxCommand(score, requestedTrack, fx, pinnedIr);
    if (result.next && result.kind)
      await commitScore(result.next, result.kind, result.payload);
    return result.ok ? ok(result.message) : fail(result.message);
  }
  const synth = parseSynthCommand(command);
  if (synth) {
    if (synth.type !== "synth-list") await materializeDraft();
    const result = applySynthCommand(score, requestedTrack, synth);
    if (result.next && result.kind)
      await commitScore(result.next, result.kind, result.payload);
    return result.ok ? ok(result.message) : fail(result.message);
  }
  const music = parseMusicCommand(command);
  if (music) {
    await materializeDraft();
    const result = applyMusicCommand(score, requestedTrack, music, () =>
      randomUUID().slice(0, 12),
    );
    if (result.next && result.kind)
      await commitScore(result.next, result.kind, result.payload);
    return result.ok ? ok(result.message) : fail(result.message);
  }
  const exportCommand = command.match(/^\/?export\s+([^\s]+)$/i);
  if (exportCommand) {
    const path = resolve(exportCommand[1]!);
    if (/\.midi?$/i.test(path)) {
      await writeFile(path, scoreToMidi(score));
      return `exported midi · ${exportCommand[1]}`;
    }
    await writeFile(path, encodeLoop(score), "utf8");
    return `exported · ${exportCommand[1]}`;
  }
  const importCommand = command.match(/^\/?import\s+([^\s]+)$/i);
  if (importCommand) {
    await materializeDraft();
    const imported = decodeLoop(await readLoopFile(importCommand[1]!));
    await commitScore(imported, "score.import", { path: importCommand[1] });
    return `imported · ${importCommand[1]}`;
  }
  const modelMatch = prompt.trim().match(/^\/model(?:\s+(\S+))?\s*$/i);
  if (modelMatch) {
    const selection = await currentProvider();
    if (!modelMatch[1]) {
      if (selection.kind === "offline")
        return `model · none · ${selection.reason}`;
      tui.activity.setSpinner("models");
      try {
        const items = await modelPickerItems(selection);
        if (items.length === 0)
          return `model · ${providerName} · no other models listed`;
        tui.openPicker({
          id: "model",
          title: `model · ${providerName}`,
          items,
          filterable: true,
          index: Math.max(
            0,
            items.findIndex((item) => item.current),
          ),
        });
        return `model · ${providerName} · pick one (or /model <alias>)`;
      } finally {
        tui.activity.setSpinner(undefined);
      }
    }
    const receiptText = await tuiSetModel(modelMatch[1]);
    provider = undefined;
    await currentProvider();
    return receiptText;
  }
  if (/^\/login\b/i.test(prompt.trim())) {
    const parsed = tuiLoginArgs(prompt.trim());
    if (typeof parsed === "string") return `login · ${parsed}`;
    await handoff(() =>
      runTuiLogin(
        parsed.target === "auto" ? "pick" : parsed.target,
        parsed.options,
      ),
    );
    provider = undefined;
    await currentProvider();
    return providerName === "offline"
      ? "login · not signed in · direct commands still work"
      : `signed in · ${providerName}`;
  }
  if (/^\/(logout|auth)\b/i.test(prompt.trim())) {
    tui.activity.setSpinner(prompt.trim().split(/\s+/)[0]!.slice(1));
    try {
      const lines = await tuiAuthCommand(prompt.trim());
      provider = undefined;
      await currentProvider();
      for (const line of lines.slice(0, -1))
        tui.activity.pushCard(line, { tone: authTone(line) });
      return lines.at(-1) ?? "auth · done";
    } finally {
      tui.activity.setSpinner(undefined);
    }
  }
  // `/model` belongs to its own handler above; every other slash word that
  // reached here is unknown or misused, and never a question for the agent.
  if (command.startsWith("/") && !/^\/model\b/i.test(command)) {
    const hint = usageHint(command);
    return fail(
      hint ? `${truncateForCard(command)} · ${hint}` : unknownCommand(command),
    );
  }
  const parsed = parsePrompt(prompt);
  if (!parsed) {
    // A known verb with bad arguments gets usage, not a model call.
    const hint = usageHint(command);
    if (hint) return fail(`${truncateForCard(command)} · ${hint}`);
    // A one-letter slip on a command whose arguments parse stays local.
    const fix = typoFix(command, parsesLocally);
    if (fix) return fail(`${truncateForCard(command)} · did you mean ${fix}?`);
    if (process.env.DAWG_AI === "0")
      return fail(`unrecognized · ${truncateForCard(command)} · /help`);
    await materializeDraft();
    return runAgent(prompt);
  }
  if (parsed.type !== "transport") await materializeDraft();
  if (parsed.type === "transport") {
    await setTransport(parsed.action);
    try {
      record = await port.append(
        record,
        {
          kind: "transport",
          payload: {
            action: parsed.action,
            playing: clock.playing,
            beat: clock.beatAt(),
          },
        },
        score.toJSON(),
      );
    } catch (error) {
      if (error instanceof SessionConflictError)
        return warn("transport changed in another window");
      throw error;
    }
    return parsed.action;
  }
  if (parsed.type === "set-tempo") {
    const next = score.withTempo(parsed.tempoBpm);
    await commitScore(next, "score.tempo", { tempoBpm: parsed.tempoBpm });
    clock.follow(next);
    return `tempo · ${next.tempoBpm} BPM`;
  }
  if (parsed.type === "add-track") return focusTrack(parsed.trackId);
  if (parsed.type === "set-bars" || parsed.type === "extend-bars") {
    const bars =
      parsed.type === "set-bars"
        ? parsed.bars
        : Math.min(SCORE_LIMITS.maxBars, score.bars + parsed.bars);
    const next = applyScoreOperation(score, { type: "setBars", bars });
    await commitScore(next, "score.bars", { bars });
    return `bars · ${bars}`;
  }
  if (parsed.type === "track") {
    const next = applyScoreOperation(score, {
      type: "updateTrack",
      trackId: requestedTrack,
      patch: parsed.patch,
    });
    await commitScore(next, "score.track", {
      trackId: requestedTrack,
      patch: parsed.patch,
    });
    return `track · ${requestedTrack}`;
  }
  if (parsed.type === "automation") {
    const points = parsed.points.map((point) => ({
      tick: Math.max(0, Math.round(point.beat * score.ticksPerBeat)),
      value: point.value,
    }));
    const track = score.tracks.find(
      (candidate) => candidate.id === requestedTrack,
    );
    const current =
      parsed.parameter === "pan"
        ? (track?.panAutomation ?? [])
        : (track?.volumeAutomation ?? []);
    const merged =
      points.length === 0
        ? []
        : Array.from(
            new Map(
              [...current, ...points].map((point) => [point.tick, point]),
            ).values(),
          ).sort((left, right) => left.tick - right.tick);
    const next = applyScoreOperation(score, {
      type: "setAutomation",
      trackId: requestedTrack,
      parameter: parsed.parameter,
      points: merged,
    });
    await commitScore(next, "score.automation", {
      trackId: requestedTrack,
      parameter: parsed.parameter,
      points: merged,
    });
    return `automation · ${parsed.parameter} ${merged.length} point${merged.length === 1 ? "" : "s"}`;
  }
  if (parsed.type === "clear-track") {
    const next = applyScoreOperation(score, {
      type: "clearTrack",
      trackId: requestedTrack,
    });
    await commitScore(next, "score.clear", { trackId: requestedTrack });
    return `cleared · ${requestedTrack}`;
  }
  if (parsed.type === "remove-note") {
    const next = applyScoreOperation(score, {
      type: "removeNote",
      noteId: parsed.noteId,
    });
    await commitScore(next, "score.operation", {
      operation: { type: "removeNote", noteId: parsed.noteId },
    });
    return `removed · ${parsed.noteId}`;
  }
  if (parsed.type === "update-note") {
    const patch = {
      ...(typeof parsed.patch.start === "number"
        ? { startTick: Math.round(parsed.patch.start * score.ticksPerBeat) }
        : {}),
      ...(typeof parsed.patch.duration === "number"
        ? {
            durationTicks: Math.max(
              1,
              Math.round(parsed.patch.duration * score.ticksPerBeat),
            ),
          }
        : {}),
      ...(typeof parsed.patch.pitch === "number"
        ? { pitch: parsed.patch.pitch }
        : {}),
      ...(typeof parsed.patch.velocity === "number"
        ? { velocity: parsed.patch.velocity }
        : {}),
    };
    const next = applyScoreOperation(score, {
      type: "updateNote",
      noteId: parsed.noteId,
      patch,
    });
    await commitScore(next, "score.note", {
      operation: { type: "updateNote", noteId: parsed.noteId, patch },
    });
    return `updated · ${parsed.noteId}`;
  }
  if (parsed.type !== "add-note") return "queued";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const latest = attempt === 0 ? record : await port.load();
    const latestScore = scoreFromJSON(latest.composition);
    const note = {
      id: `${requestedTrack}-${latest.revision + 1}-${randomUUID().slice(0, 6)}`,
      trackId: requestedTrack,
      startTick: Math.round(parsed.start * latestScore.ticksPerBeat),
      durationTicks: Math.max(
        1,
        Math.round(parsed.duration * latestScore.ticksPerBeat),
      ),
      pitch: parsed.pitch,
      velocity: parsed.velocity,
    };
    const operation: ScoreOperation = { type: "addNote", note };
    const next = applyScoreOperation(latestScore, operation);
    try {
      record = await port.append(
        latest,
        {
          kind: "score.operation",
          payload: { operation },
        },
        next.toJSON(),
      );
      score = next;
      if (clock.playing) void audio.play(score);
      return `added ${note.id}`;
    } catch (error) {
      if (!(error instanceof SessionConflictError)) throw error;
    }
  }
  return warn("session busy · retry the note");
}

/**
 * `/track <name>`: focus `trackId` in this window, creating it when it is
 * not in the score yet. A track another live window has focused stays
 * theirs; focus goes through the port so presence is right everywhere.
 */
async function focusTrack(trackId: string): Promise<Receipt> {
  if (trackId === requestedTrack && !draftTrack)
    return warn(`already on ${trackId}`);
  const clients = await port.presence().catch(() => []);
  if (
    clients.some(
      (client) =>
        client.clientId !== port.clientId && client.focusedTrackId === trackId,
    )
  )
    return warn(`${trackId} is open in another window`);
  const exists = score.tracks.some((track) => track.id === trackId);
  if (!exists) {
    const next = applyScoreOperation(score, {
      type: "addTrack",
      track: {
        id: trackId,
        name: trackId,
        instrument: isDrumInstrument(trackId) ? "kit" : "sine",
      },
    });
    await commitScore(next, "track.create", { trackId });
  }
  await port.focus(trackId);
  requestedTrack = trackId;
  draftTrack = false;
  return ok(exists ? `track · ${trackId}` : `track created · ${trackId}`);
}

/** Decode every sampler voice (cached) and return what failed to load. */
async function sampleProblems(
  value: TrackScore,
): Promise<readonly SampleProblem[]> {
  if (!hasSamplerTracks(value)) return [];
  sampleLibrary ??= new SampleLibrary({
    projectRoot: process.cwd(),
    packs: packs(),
  });
  try {
    const bank = await sampleLibrary.load(value);
    liveSampleBank = bank;
    return bank.problems;
  } catch (error) {
    return [
      {
        trackId: "",
        voice: "",
        src: "",
        level: "error",
        message: `samples · ${error instanceof Error ? error.message : String(error)} · check the sample files`,
      },
    ];
  }
}

/** Surface sample load problems once per distinct set, as receipts. */
function reportSampleProblems(value: TrackScore): void {
  if (!hasSamplerTracks(value)) return;
  void sampleProblems(value).then((problems) => {
    const key = problems.map((problem) => problem.message).join("\n");
    if (key === reportedSampleProblems) return;
    reportedSampleProblems = key;
    for (const problem of problems.slice(0, 3))
      tui.activity.pushCard(`sample ${problem.voice} · ${problem.message}`, {
        tone: problem.level === "error" ? "error" : "warning",
        trackId: problem.trackId || undefined,
      });
    if (problems.length > 3)
      tui.activity.pushCard(
        `${problems.length - 3} more sample problems · /tracks`,
        {
          tone: "warning",
        },
      );
    tickUi();
  });
}

async function sampleCommand(
  command: NonNullable<ReturnType<typeof parseSampleCommand>>,
): Promise<Receipt> {
  if (command.kind === "list") {
    const track = score.tracks.find((item) => item.id === requestedTrack);
    const lines = listSampleVoices(track);
    if (lines.length === 0)
      return warn(
        `sample · ${requestedTrack} has no samples · /sample <path> [as <voice>]`,
      );
    tui.openText(`samples · ${requestedTrack}`, lines);
    return ok(`${lines.length} sample${lines.length === 1 ? "" : "s"}`);
  }
  if (command.kind === "set") {
    const result = setSampleControls(
      score,
      requestedTrack,
      command.voice,
      command.values,
    );
    if (!result.ok) return fail(result.message);
    await commitScore(result.next, "sample.set", {
      trackId: requestedTrack,
      voice: command.voice,
    });
    await projectSync?.flushScore();
    return ok(result.message);
  }
  await materializeDraft();
  const trackId = samplerTarget(score, requestedTrack);
  const voice =
    command.voice ?? freeVoiceName(score, trackId, voiceNameFrom(command.path));
  let placed;
  try {
    placed = await placeSampleFile({
      projectRoot: process.cwd(),
      cwd: process.cwd(),
      input: command.path,
      score,
      trackId,
      voice,
    });
  } catch (error) {
    if (error instanceof SamplePlacementError)
      return fail(`sample · ${error.message} · check the path and retry`);
    throw error;
  }
  const result = addSampleVoice(score, trackId, voice, {
    src: placed.src,
    sha256: placed.sha256,
  });
  if (!result.ok) return fail(result.message);
  // Decode before committing so a bad file is a receipt, not a silent voice.
  const problems = (await sampleProblems(result.next)).filter(
    (problem) => problem.trackId === trackId && problem.voice === voice,
  );
  if (problems.some((problem) => problem.level === "error"))
    return fail(`sample · ${problems[0]!.message}`);
  await commitScore(result.next, "sample.add", {
    trackId,
    voice,
    src: placed.src,
  });
  if (trackId !== requestedTrack) {
    await port.focus(trackId);
    requestedTrack = trackId;
    draftTrack = false;
  }
  await projectSync?.flushScore();
  return ok(
    `${result.message}${placed.copied ? ` · copied to ${placed.src}` : ""}`,
  );
}

function packs(): PackStore {
  packStore ??= new PackStore();
  return packStore;
}

/** Keeps CREDITS.md in step with the CC-BY packs the score uses (quietly). */
async function updateCredits(value: TrackScore): Promise<void> {
  const refs = value.tracks.flatMap((track) =>
    Object.values(track.sampler?.voices ?? {}),
  );
  if (!refs.some((ref) => ref.src.startsWith("pack:"))) return;
  // Only a dawg project gets CREDITS.md; a bare session directory does not.
  if (!projectSync) return;
  try {
    await writeCredits(process.cwd(), packCredits(refs, await packs().list()));
  } catch {
    /* credits are best effort; render metadata carries them too */
  }
}

/** Applies a pack edit as one undo step and focuses its track. */
async function commitPackEdit(
  operations: readonly ScoreOperation[],
  trackId: string,
  kind: string,
  payload: Record<string, unknown>,
): Promise<Receipt | undefined> {
  let next = score;
  for (const operation of operations)
    next = applyScoreOperation(next, operation);
  const problems = (await sampleProblems(next)).filter(
    (problem) => problem.trackId === trackId && problem.level === "error",
  );
  if (problems.length > 0) return fail(`sound · ${problems[0]!.message}`);
  await commitScore(next, kind, payload);
  if (stageCapture) return undefined;
  if (trackId !== requestedTrack) {
    await port.focus(trackId);
    requestedTrack = trackId;
    draftTrack = false;
  }
  await projectSync?.flushScore();
  return undefined;
}

async function packCommand(command: PackCommand): Promise<Receipt> {
  try {
    if (command.kind === "usage") return warn(command.message);
    if (command.kind === "list") {
      const lines = packListLines(await packs().list());
      tui.openText("packs", lines);
      return ok(`${lines.length} packs · /pack info <name>`);
    }
    if (command.kind === "cache") {
      const library = (sampleLibrary ??= new SampleLibrary({
        projectRoot: process.cwd(),
        packs: packs(),
      }));
      let freed: { files: number; bytes: number } | undefined;
      if (command.pruneTo !== undefined) {
        const to = (cap: number) =>
          command.pruneTo === "cap" ? cap : (command.pruneTo as number);
        const store = packs();
        const a = await store.pruneCache(to(store.maxFileCacheBytes));
        const b = await library.pruneCache(to(library.maxCacheBytes));
        freed = { files: a.removed + b.removed, bytes: a.freed + b.freed };
      }
      const lines = cacheLines({
        packs: await packs().cacheStatus(),
        assets: await library.cacheStatus(),
        ...(freed ? { freed } : {}),
      });
      tui.openText("cache", lines);
      return ok(lines[0]!);
    }
    if (command.kind === "add") {
      const added = await packs().add(
        command.source,
        command.name ? { name: command.name } : {},
      );
      return ok(
        `pack added · ${added.pack.name} · ${added.sounds} sounds · /pack info ${added.pack.name}`,
      );
    }
    if (command.kind === "info") {
      const info = await packs().info(command.name);
      if (!info)
        return fail(
          `pack · no pack named ${command.name.slice(0, 40)} · /pack list`,
        );
      const manifest = await packs().manifest(info.name);
      const banks = banksOf(manifest);
      const names = [...manifest.sounds.keys()];
      const lines = [
        `${info.name} · ${info.title}`,
        `license · ${info.license}${info.attribution ? ` · ${info.attribution}` : ""}`,
        `manifest · ${info.manifestUrl}`,
        ...(info.homepage ? [`home · ${info.homepage}`] : []),
        `${names.length} sounds${banks.length ? ` · ${banks.length} kits` : ""}`,
        ...(banks.length ? [`kits · ${banks.join(" ")}`] : []),
        ...names.slice(0, 400).map((name) => {
          const sound = manifest.sounds.get(name)!;
          return `${name} · ${sound.kind === "zones" ? `${sound.zones.length} notes (keyed)` : `${sound.files.length} file${sound.files.length === 1 ? "" : "s"}`}`;
        }),
      ];
      tui.openText(`pack · ${info.name}`, lines);
      return ok(
        `${info.name} · ${names.length} sounds · /pack use ${info.name}/<sound>`,
      );
    }
    if (command.kind === "remove") {
      const known = await packs().remove(command.name);
      return known
        ? ok(`pack removed · ${command.name}`)
        : fail(
            `pack · no pack named ${command.name.slice(0, 40)} · /pack list`,
          );
    }
    await materializeDraft();
    const result = await useSound(
      packs(),
      score,
      requestedTrack,
      command.sound,
      {
        ...(command.voice ? { voice: command.voice } : {}),
      },
    );
    const failed = await commitPackEdit(
      result.operations,
      result.trackId,
      "pack.use",
      {
        trackId: result.trackId,
        sound: command.sound,
      },
    );
    return failed ?? ok(`sound · ${result.summary}`);
  } catch (error) {
    if (error instanceof PackError) return fail(`pack · ${error.message}`);
    throw error;
  }
}

async function patternCommand(command: PatternCommand): Promise<Receipt> {
  if (command.kind === "list") {
    tui.openText("patterns", DRUM_PATTERNS.map(patternLine));
    return ok(`patterns · ${DRUM_PATTERNS.length} · /pattern <name>`);
  }
  if (command.kind === "browse") {
    tui.openPicker({
      id: "pattern",
      title: "drum patterns",
      hint: HINTS.audition,
      audition: true,
      items: DRUM_PATTERNS.map((entry) => ({
        label: `${entry.label.padEnd(22)} ${entry.tempo.bpm} BPM · ${entry.tags.join(", ")}`,
        value: `/pattern ${entry.name}`,
      })),
      filterable: true,
      index: 0,
    });
    patternPreview = undefined;
    previewPattern(DRUM_PATTERNS[0]?.name);
    return ok("patterns · ↑/↓ preview · Enter applies on the focused track");
  }
  await materializeDraft();
  const result = applyDrumPattern(
    score,
    requestedTrack,
    command.name,
    command.tempo,
  );
  if (result.next && result.kind)
    await commitScore(result.next, result.kind, result.payload);
  return result.ok ? ok(result.message) : fail(result.message);
}

/**
 * Play one bar of the pattern under the picker cursor, on a scratch copy
 * of the focused track (or a fresh kit track when the focus is melodic).
 * Silent while the loop plays, like the Euclidean editor's audition.
 */
function previewPattern(name: string | undefined): void {
  if (!name || name === patternPreview) return;
  patternPreview = name;
  if (clock.playing) return;
  const entry = DRUM_PATTERNS.find((candidate) => candidate.name === name);
  if (!entry) return;
  let result = applyDrumPattern(score, requestedTrack, entry.name, "set");
  let trackId = requestedTrack;
  if (!result.next) {
    trackId = "pattern-preview";
    result = applyDrumPattern(score, trackId, entry.name, "set");
  }
  if (!result.next) return;
  const engine = liveEngine();
  if (!engine?.canMonitor) return;
  const pcm = renderAudition({
    score: result.next,
    trackId,
    bars: 1,
    sampleRate: engine.sampleRate,
    ...(liveSampleBank ? { samples: liveSampleBank } : {}),
  });
  if (!pcm) return;
  void engine
    .monitor(true)
    .then(() => engine.noteOn(AUDITION_VOICE, pcm))
    .catch(() => undefined);
}

/** `/kit` with no name: one picker with the synth kits and the sample kits. */
function openKitPicker(): Receipt {
  const current = score.tracks.find((track) => track.id === requestedTrack);
  const items = kitCatalog().map((entry) => ({
    label: `${entry.kind === "synth" ? "synth " : "sample"}  ${entry.label.padEnd(18)} ${entry.detail}`,
    value: entry.command,
    current:
      entry.kind === "synth" &&
      isDrumInstrumentTrack(current) &&
      (current?.kit ?? "default") === entry.name,
  }));
  tui.openPicker({
    id: "kit",
    title: "drum kits",
    hint: HINTS.audition,
    audition: true,
    items,
    filterable: true,
    index: Math.max(
      0,
      items.findIndex((item) => item.current),
    ),
  });
  return ok("kits · synth kits work offline · sample kits are fetched once");
}

function isDrumInstrumentTrack(track: { instrument: string } | undefined) {
  return track !== undefined && isDrumInstrument(track.instrument);
}

async function kitCommand(command: KitCommand, bare = false): Promise<Receipt> {
  if (bare) return openKitPicker();
  if (command.kind === "set" && isSynthKitName(command.bank)) {
    await materializeDraft();
    const result = applySynthKit(score, requestedTrack, command.bank);
    if (result.next && result.kind)
      await commitScore(result.next, result.kind, result.payload);
    return result.ok ? ok(result.message) : fail(result.message);
  }
  if (command.kind === "list") {
    const lines = kitCatalog()
      .filter((entry) => entry.kind === "synth")
      .map((entry) => `${entry.name} · synth · ${entry.detail}`);
    lines.push(...kitListLines(await packs().bankAliases(ALIASED_PACK)));
    tui.openText("kits", lines);
    return ok("kits · /kit <name or nickname> on the focused drum track");
  }
  await materializeDraft();
  const trackId = kitTarget(score, requestedTrack);
  if (!trackId)
    return fail(
      `kit · ${requestedTrack} is a melodic track · focus a drum track (/track drums) and retry`,
    );
  try {
    const result = await useKit(packs(), score, trackId, command.bank);
    const failed = await commitPackEdit(
      result.operations,
      trackId,
      "pack.kit",
      {
        trackId,
        bank: command.bank,
      },
    );
    return failed ?? ok(result.summary);
  } catch (error) {
    if (error instanceof PackError) return fail(`kit · ${error.message}`);
    throw error;
  }
}

async function wavetableCommand(command: WavetableCommand): Promise<Receipt> {
  if (command.kind === "usage") return warn(command.message);
  if (command.kind === "show")
    return ok(describeWavetable(score, requestedTrack));
  if (command.kind === "list") {
    tui.openText(
      "wavetables",
      await wavetableListLines(packs(), process.cwd()),
    );
    return ok("wavetables · wt <table> sets the focused track");
  }
  await materializeDraft();
  const trackId = requestedTrack;
  try {
    const edit =
      command.kind === "table"
        ? await pickWavetable(
            packs(),
            score,
            trackId,
            command.table,
            process.cwd(),
          )
        : wavetableParamEdit(score, trackId, command);
    const failed = await commitPackEdit(
      [edit.operation],
      trackId,
      "track.wavetable",
      { trackId, ...command },
    );
    return failed ?? ok(edit.summary);
  } catch (error) {
    if (error instanceof PackError) return fail(`wavetable · ${error.message}`);
    throw error;
  }
}

async function readLoopFile(path: string): Promise<string> {
  const contents = await readFile(resolve(path));
  if (contents.byteLength > 512 * 1024)
    throw new Error("loop import exceeds 512 KiB");
  return contents.toString("utf8");
}

/**
 * Adds the focused track to the score when it is missing (an explicit
 * `--track`, or a draft on its first edit), retrying past concurrent writes.
 */
async function ensureFocusedTrack(): Promise<void> {
  if (score.tracks.some((track) => track.id === requestedTrack)) return;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const latest = attempt === 0 ? record : await port.load();
    const latestScore = scoreFromJSON(latest.composition);
    if (latestScore.tracks.some((track) => track.id === requestedTrack)) {
      record = latest;
      score = latestScore;
      return;
    }
    const next = withTrack(latestScore, requestedTrack);
    try {
      record = await port.append(
        latest,
        { kind: "track.attach", payload: { trackId: requestedTrack } },
        next.toJSON(),
      );
      score = next;
      return;
    } catch (error) {
      if (!(error instanceof SessionConflictError)) throw error;
    }
  }
}

/** A draft track becomes real on the window's first edit. */
async function materializeDraft(): Promise<void> {
  if (!draftTrack) return;
  await ensureFocusedTrack();
  draftTrack = false;
}

function adoptMeta(meta: typeof record.meta): void {
  if (meta.version < record.meta.version) return;
  record = { ...record, meta };
  if (meta.name !== announcedName) {
    announcedName = meta.name;
    tui.activity.pushCard(
      meta.nameSource === "auto"
        ? `${meta.name} (auto-named) · rename with /rename <name>`
        : `session · ${meta.name}`,
      { tone: "info" },
    );
  }
}

function makeNamer(): AutoNamer {
  return new AutoNamer({
    target: namingTarget(
      process.cwd(),
      () => ({ port, record }),
      (meta) => adoptMeta(meta),
    ),
    // DAWG_AI=0 keeps naming local; an offline provider falls back too.
    generator:
      process.env.DAWG_AI === "0"
        ? undefined
        : providerNameGenerator(currentProvider),
  });
}

/** `/sessions`, `/resume`, `/rename`, `/fork`; undefined when not one. */
async function sessionCommand(
  command: string,
): Promise<string | Receipt | undefined> {
  const match = command.match(/^\/(sessions|resume|rename|fork)(?:\s+(.*))?$/i);
  if (!match) return undefined;
  const verb = match[1]!.toLowerCase();
  const arg = (match[2] ?? "").trim();
  const workspace = process.cwd();
  if (verb === "rename") {
    if (!arg)
      return record.meta.nameSource === "auto"
        ? `${record.meta.name} (auto-named) · rename with /rename <name>`
        : `${record.meta.name} (named by you) · /rename --auto to auto-name`;
    if (arg === "--auto") {
      const result = await port.updateMeta({
        nameSource: "auto",
        namedFingerprint: null,
        namedStructure: null,
      });
      adoptMeta(result.meta);
      namer.request(score);
      return "auto-naming on";
    }
    const name = normalizeSessionName(arg);
    // Unconditional: the latest user rename wins over any in-flight auto-name.
    const result = await port.updateMeta({ name, nameSource: "user" });
    announcedName = result.meta.name;
    adoptMeta(result.meta);
    return `renamed · ${result.meta.name}`;
  }
  const sessions = await listSessions(workspace);
  if (verb === "resume" && !arg) {
    const readable = sessions.filter((session) => !session.error).slice(0, 64);
    if (readable.length === 0) return warn("no sessions to resume");
    const current = readable.findIndex(
      (session) => session.sessionId === record.sessionId,
    );
    tui.openPicker({
      id: "resume",
      title: "resume a session",
      items: readable.map((session) => ({
        label: `${session.sessionId === record.sessionId ? "* " : "  "}${formatSessionLine(session, sessions)}`,
        value: session.sessionId,
      })),
      index: Math.max(0, current),
    });
    return "resume · 1-9 shown · /resume <name|id>";
  }
  if (verb === "sessions") {
    const lines = pickerLines(
      sessions,
      record.sessionId,
      (session) => formatSessionLine(session, sessions),
      MAX_LISTED_SESSIONS,
    );
    tui.openText("sessions · * current · /resume <n>", lines);
    return ok(`${lines.length} session${lines.length === 1 ? "" : "s"}`);
  }
  if (agentTurn) return warn("agent busy · finish or Esc first");
  if (verb === "fork") {
    const forked = await forkSession(workspace, record, arg || undefined);
    await switchSession(forked.sessionId);
    return `forked · ${forked.meta.name}`;
  }
  const readable = sessions.filter((session) => !session.error);
  // Any list index works, not only the digits the picker binds.
  const index = /^\d+$/.test(arg) ? Number(arg) - 1 : -1;
  let sessionId = readable[index]?.sessionId;
  if (sessionId === undefined)
    try {
      sessionId = await resolveSessionArg(workspace, arg, sessions);
    } catch (error) {
      if (!(error instanceof SessionLookupError)) throw error;
      return fail(error.message.replace(" · dawg sessions", " · /sessions"));
    }
  if (sessionId === record.sessionId)
    return warn(`already in ${record.meta.name}`);
  await switchSession(sessionId);
  return `resumed · ${record.meta.name} · ${requestedTrack}${draftTrack ? " (new)" : ""}`;
}

/** Leaves the current session and attaches this window to `sessionId`. */
async function switchSession(sessionId: string): Promise<void> {
  // Play mode belongs to the old session's engine and track.
  await play?.exit();
  play = undefined;
  if (clock.playing) await setTransport("pause");
  namer.dispose();
  await port.close();
  const next = await ensureSession(initial.toJSON(), {
    sessionId,
    setCurrent: true,
  });
  port = await openSessionPort<ReturnType<TrackScore["toJSON"]>>({
    paths: next.paths,
    sessionId,
    label: "window",
    focusedTrackId: null,
  });
  audio = port.player;
  record = port.mode === "daemon" ? await port.load() : next.record;
  score = scoreFromJSON(record.composition);
  clock.follow(score);
  const attached = await attachTrack(port, score, undefined);
  requestedTrack = attached.trackId;
  draftTrack = attached.draft;
  announcedName = record.meta.name;
  namer = makeNamer();
  rebindPort();
  if (attached.draft)
    tui.activity.pushCard(ALL_TRACKS_OPEN_HINT, {
      tone: "info",
      trackId: requestedTrack,
    });
}

function liveEngine(): LiveEngine | undefined {
  return previewEngine();
}

/** The engine this window hears itself through (its own in daemon mode). */
function previewEngine(): AudioEngine {
  if (audio instanceof AudioEngine) return audio;
  monitorEngine ??= new AudioEngine({ projectRoot: process.cwd() });
  return monitorEngine;
}

/** The play session for the focused track (re-made when focus moves). */
function menuContext(): MenuContext {
  const session = play;
  const loop = auditionController();
  loop.focus(requestedTrack);
  return {
    score: loop.staging ? loop.score : score,
    audition: {
      looping: loop.looping,
      dirty: loop.dirtyEdits,
      committed: score,
      hint: loop.hint(),
      status: loop.status(),
      stageable: stageableNow,
      committedChords: chordSettings,
    },
    trackId: requestedTrack,
    playing: clock.playing,
    grid: session?.grid ?? DEFAULT_GRID,
    grids: GRIDS.map((grid) => grid.label),
    clickOn: session?.clickOn ?? false,
    countInBars: session?.countInBars ?? 1,
    chords: stagedChordSettings() ?? session?.chords.settings ?? chordSettings,
    projectRoot: process.cwd(),
  };
}

/** The screen `?` describes, or undefined while `?` is typed text. */
function keysScreen(): readonly KeySection[] | undefined {
  if (euclid.open) return euclid.typing ? undefined : KEYS.euclid;
  if (menu.open) return menu.typing ? undefined : KEYS.menu;
  const overlay = tui.ui.overlay;
  if (overlay === "picker")
    return tui.pickerTyping
      ? undefined
      : AUDITION_PICKERS.has(tui.ui.picker?.id ?? "")
        ? KEYS.audition
        : KEYS.list;
  if (overlay === "text") return KEYS.text;
  if (overlay === "log") return KEYS.log;
  if (overlay === "guide") return tui.guideTyping ? undefined : KEYS.guide;
  if (prompt.value.length > 0) return undefined;
  if (play?.on)
    return play.chords.on ? [...KEYS.play, ...KEYS.chords] : KEYS.play;
  return KEYS.prompt;
}

function showKeys(): void {
  const sections = keysScreen();
  if (!sections) return;
  const lines = keyLines(sections);
  // Play mode's secondary state lives here instead of the header.
  if (play?.on && !tui.ui.overlay && !menu.open)
    lines.unshift(...play.details(), "");
  tui.showKeys("keys", lines);
}

function openMenu(section?: string): void {
  menu.show(menuContext(), section);
  refreshMenu();
}

function euclidContext(): EuclidContext {
  const loop = auditionController();
  loop.focus(requestedTrack);
  return {
    score: loop.staging ? loop.score : score,
    trackId: requestedTrack,
    audition: {
      looping: loop.looping,
      dirty: loop.dirtyEdits,
      committed: score,
      hint: loop.hint(),
      status: loop.status(),
    },
  };
}

function openEuclid(voice?: string, origin?: string): void {
  euclid.show(euclidContext(), voice, origin);
  refreshEuclid();
}

function refreshEuclid(): void {
  if (!euclid.open) return;
  if (tui.ui.overlay !== undefined && tui.ui.picker?.id !== "euclid") {
    euclid.close();
    return;
  }
  const view = euclid.view(euclidContext());
  tui.openPicker({
    id: "euclid",
    title: view.title,
    items: view.items,
    index: view.index,
    hint: view.hint,
  });
}

/**
 * Play one bar of `voice` on the focused track over silence. While the loop
 * is playing the edit is already audible, so nothing extra sounds.
 */
function audition(voice: string): void {
  if (clock.playing) return;
  const track = score.tracks.find(
    (candidate) => candidate.id === requestedTrack,
  );
  if (!track) return;
  const pitch = rhythmVoicePitch(track, voice);
  if (pitch === undefined) return;
  const engine = liveEngine();
  if (!engine?.canMonitor) return;
  const pcm = renderAudition({
    score,
    trackId: track.id,
    pitches: new Set([pitch]),
    bars: 1,
    sampleRate: engine.sampleRate,
    ...(liveSampleBank ? { samples: liveSampleBank } : {}),
  });
  if (!pcm) return;
  void engine
    .monitor(true)
    .then(() => engine.noteOn(AUDITION_VOICE, pcm))
    .catch(() => undefined);
}

/**
 * The window's audition controller. Its loop plays through the ordinary
 * engine (the render worker and stem cache), so a preview sounds exactly
 * like the same bars of the song; staged commands run through `submit`
 * with `commitScore` captured, so a staged edit is made by the same code
 * as a committed one.
 */
function auditionController(): Audition {
  auditionLoop ??= new Audition(
    {
      apply: applyStaged,
      play: (preview) => previewEngine().play(preview),
      stop() {
        const engine = previewEngine();
        engine.stop();
        if (!play?.on) engine.setLeadMs(undefined);
      },
      leadMs: () => previewEngine().leadMs,
      now: () => performance.now(),
      beat: () => clock.beatAt(),
      setTimer: (callback, ms) => setTimeout(callback, ms),
      clearTimer: (handle) => clearTimeout(handle as Timer),
      changed: () => requestFrame(),
      level: () => previewEngine().level,
      // The chord settings screen loops a progression with its settings.
      phrase: (showing) => {
        if (!chordScreenOpen()) return undefined;
        const settings =
          showing === "A"
            ? chordSettings
            : (stagedChordSettings() ?? chordSettings);
        return (base, track, bars) => chordPhrase(settings, base, track, bars);
      },
    },
    score,
    requestedTrack,
  );
  return auditionLoop;
}

/** True while the menu's Chords section (`/menu chords`) is open. */
function chordScreenOpen(): boolean {
  return menu.open && menu.section === "chords";
}

/** What stages while auditioning on the screen open now. */
function stageableNow(command: string): boolean {
  return (
    isStageable(command) || (chordScreenOpen() && isChordStageable(command))
  );
}

/**
 * The chord settings with the staged `/chords …` commands applied, or
 * undefined while none are staged. Chord settings are window state (not in
 * the score), so the staged ones are derived from the staged commands.
 */
function stagedChordSettings(): ChordSettings | undefined {
  const commands = auditionLoop?.dirtyEdits ? auditionLoop.commands : [];
  const chords = commands.filter((command) => CHORDS_COMMAND.test(command));
  if (chords.length === 0) return undefined;
  const settings = { ...chordSettings };
  for (const command of chords)
    applyChordsCommand(settings, command.match(CHORDS_COMMAND)![1]!);
  return settings;
}

/** Re-render the loop when the chord screen opens or closes. */
function noteChordScreen(): void {
  const now = chordScreenOpen();
  if (now === chordScreenWas) return;
  chordScreenWas = now;
  auditionLoop?.request();
}

/**
 * Warm the pack cache for a staged command before it runs, so a lazy fetch
 * (a sample kit, a pack sound or table) happens outside the capture and the
 * window's score is swapped only for the instant the command takes.
 */
async function prefetchStaged(
  base: TrackScore,
  command: string,
): Promise<void> {
  try {
    const kit = parseKitCommand(command);
    if (kit?.kind === "set" && !isSynthKitName(kit.bank)) {
      const trackId = kitTarget(base, requestedTrack);
      if (trackId) await useKit(packs(), base, trackId, kit.bank);
      return;
    }
    const pack = parsePackCommand(command);
    if (pack?.kind === "use") {
      await useSound(packs(), base, requestedTrack, pack.sound, {
        ...(pack.voice ? { voice: pack.voice } : {}),
      });
      return;
    }
    const wavetable = parseWavetableCommand(command);
    if (wavetable?.kind === "table")
      await pickWavetable(
        packs(),
        base,
        requestedTrack,
        wavetable.table,
        process.cwd(),
      );
  } catch {
    // The command itself reports the failure.
  }
}

/** Apply one prompt command to `base` without committing (see stageCapture). */
async function applyStaged(
  base: TrackScore,
  command: string,
): Promise<{ next?: TrackScore; ok: boolean; message: string }> {
  const chords = command.trim().match(CHORDS_COMMAND);
  if (chords) {
    // Window state: checked on a copy; kept settings apply on Enter.
    const result = applyChordsCommand({ ...chordSettings }, chords[1]!);
    return { next: base, ok: result.ok, message: result.message };
  }
  await prefetchStaged(base, command);
  // Staged commands run one at a time, between queued prompts.
  while (stageCapture) await Bun.sleep(1);
  const committed = score;
  stageCapture = {};
  score = base;
  try {
    const result = await submit(command);
    const text = typeof result === "string" ? result : result.text;
    const good = toneOf(result) !== "error";
    return { next: stageCapture.next, ok: good, message: text };
  } catch (error) {
    return { ok: false, message: describeError(command, error) };
  } finally {
    score = stageCapture?.committed ?? committed;
    stageCapture = undefined;
  }
}

/** Keep the controller on the committed score (remote edits, undo, agent). */
function followCommitted(): void {
  const loop = auditionLoop;
  if (!loop || stageCapture || loop.committed === score) return;
  if (!loop.dirtyEdits) {
    loop.committedNow(score);
    return;
  }
  void loop.rebase(score).then(({ dropped }) => {
    tui.activity.pushCard(
      dropped.length
        ? `score changed · dropped staged ${dropped.join(", ")}`
        : "score changed · staged edits re-applied on top",
      { tone: "warning" },
    );
    requestFrame();
  });
}

async function startAuditionLoop(): Promise<void> {
  const loop = auditionController();
  await materializeDraft();
  loop.committedNow(score);
  loop.focus(requestedTrack);
  // One sound at a time: the song stops while the loop plays.
  if (clock.playing) await setTransport("pause");
  previewEngine().setLeadMs(PLAY_LEAD_MS);
  loop.start();
}

function stopAuditionLoop(): void {
  auditionLoop?.stop();
}

/** A menu or picker audition key: Space, `a` (A/B) or `c` (context). */
function auditionKeyPressed(
  key: "loop" | "ab" | "context",
): Promise<void> | undefined {
  const loop = auditionController();
  if (key === "loop") {
    if (loop.looping) stopAuditionLoop();
    else return startAuditionLoop().finally(() => requestFrame());
  } else if (key === "ab") {
    if (!loop.dirtyEdits) {
      tui.activity.pushCard("A/B · nothing staged yet · ←→ to change a value", {
        tone: "info",
      });
      return;
    }
    loop.toggleAB();
  } else loop.toggleContext();
  return undefined;
}

/** An auditioning picker's title carries the loop status (`♪ solo · B`). */
function refreshAuditionPicker(): void {
  const picker = tui.ui.picker as
    (NonNullable<typeof tui.ui.picker> & { baseTitle?: string }) | undefined;
  if (tui.ui.overlay !== "picker" || !picker?.audition) return;
  // Kept on the picker so a filter's copy of it keeps the plain title too.
  const base = (picker.baseTitle ??= picker.title);
  const status = auditionLoop?.status();
  const dirty = auditionLoop?.dirtyEdits ? "● " : "";
  picker.title = status ? `${dirty}${base} · ${status}` : base;
}

/**
 * `/try <command>`: hear a sound command on the audition loop before it
 * lands. A small picker offers keep (one undo step) or revert; Space, `a`
 * and `c` work as in the menu.
 */
async function tryPrompt(command: string): Promise<Receipt> {
  if (!command) return fail(TRY_USAGE);
  const agentToggle = command.match(/^agent\s+(on|off)$/i);
  if (agentToggle) {
    agentPreviewPlays = agentToggle[1]!.toLowerCase() === "on";
    return ok(
      `try · agent previews ${agentPreviewPlays ? "play once here" : "stay silent (numbers only)"}`,
    );
  }
  if (!isStageable(command))
    return fail(`try · only sound changes can be tried · ${TRY_USAGE}`);
  if (menu.open || euclid.open)
    return fail("try · close the open screen first");
  const loop = auditionController();
  if (!loop.looping) await startAuditionLoop();
  const result = await loop.stage(command);
  if (!result.ok) {
    if (!loop.dirtyEdits) stopAuditionLoop();
    return fail(`try · ${result.message}`);
  }
  tui.openPicker({
    id: "try",
    title: `try · ${command.slice(0, 48)}`,
    hint: HINTS.audition,
    audition: true,
    items: [
      { label: "keep", value: "keep", detail: "commit it · one undo step" },
      { label: "revert", value: "revert", detail: "drop it" },
    ],
  });
  return ok(`trying · ${command} · a A/B · enter keep · esc revert`);
}

/** Audition a list's highlighted item in place of its previous hover. */
function hoverItem(command: string, key: string): void {
  const loop = auditionLoop;
  if (!loop?.looping) return;
  requestFrame();
  void loop.hover(command, key).then((result) => {
    if (!result.ok && result.message !== SUPERSEDED)
      tui.activity.pushCard(result.message, { tone: "warning" });
    requestFrame();
  });
}

/** Enter on a list item while auditioning: it stays staged for good. */
function chooseItem(command: string, key: string): void {
  const loop = auditionLoop;
  if (!loop) return;
  void loop
    .hover(command, key)
    .then((result) => {
      if (!result.ok && result.message !== SUPERSEDED)
        tui.activity.pushCard(result.message, { tone: "warning" });
      loop.settle(key);
    })
    .finally(() => requestFrame());
}

/** Space, `a` or `c` in a picker: starting the loop hovers the cursor row. */
function pickerAuditionKey(key: "loop" | "ab" | "context"): void {
  const started = auditionKeyPressed(key);
  if (!started) return;
  const picker = tui.ui.picker;
  const item = picker?.items[picker.index];
  if (!picker || !item || !isStageable(item.value)) return;
  void started.then(() => {
    const now = tui.ui.picker;
    const current = now?.id === picker.id ? now.items[now.index] : undefined;
    if (current && isStageable(current.value))
      hoverItem(current.value, `picker:${picker.id}`);
  });
}

/** Stage a menu command while auditioning; undefined when it should run. */
function stageIfAuditioning(command: string): boolean {
  const loop = auditionLoop;
  if (!loop?.staging || !stageableNow(command)) return false;
  void loop.stage(command).then((result) => {
    if (!result.ok)
      tui.activity.pushCard(result.message, {
        tone: result.message.includes("failed") ? "error" : "warning",
      });
    requestFrame();
  });
  return true;
}

/** Enter: every staged edit becomes ONE revision (one undo step). */
async function keepStaged(): Promise<Receipt> {
  const loop = auditionLoop;
  await loop?.settled();
  const taken = loop?.take();
  if (!loop || !taken) return warn("nothing staged");
  await materializeDraft();
  // Chord settings are window state: they apply here, outside the revision.
  const chordCommands = taken.commands.filter((command) =>
    CHORDS_COMMAND.test(command),
  );
  for (const command of chordCommands)
    applyChordsCommand(chordSettings, command.match(CHORDS_COMMAND)![1]!);
  const scoreCommands = taken.commands.filter(
    (command) => !CHORDS_COMMAND.test(command),
  );
  let next = taken.score;
  for (let attempt = 0; scoreCommands.length && next !== score; attempt += 1) {
    try {
      await commitScore(next, "preview.commit", {
        trackId: loop.trackId,
        commands: scoreCommands,
      });
      break;
    } catch (error) {
      if (!(error instanceof SessionConflictError) || attempt > 0) throw error;
      // Another window committed first: replay the staged commands on it.
      record = await port.load();
      score = scoreFromJSON(record.composition);
      next = score;
      for (const command of scoreCommands) {
        const result = await applyStaged(next, command);
        if (result.next) next = result.next;
      }
    }
  }
  loop.committedNow(score);
  await projectSync?.flushScore();
  const kept = `kept ${taken.commands.length} change${taken.commands.length === 1 ? "" : "s"}`;
  return ok(
    scoreCommands.length
      ? `${kept} · one undo step`
      : `${kept} · chord settings (window state, no revision)`,
  );
}

function revertStaged(): void {
  const loop = auditionLoop;
  if (!loop?.dirtyEdits) return;
  const count = loop.commands.length;
  loop.revert();
  tui.activity.pushCard(
    `reverted ${count} staged change${count === 1 ? "" : "s"}`,
    { tone: "info" },
  );
}

/** Leaving an auditioning screen stops the loop and drops staged edits. */
function leaveAuditionScreen(): void {
  if (auditionLoop?.dirtyEdits) revertStaged();
  stopAuditionLoop();
}

function refreshMenu(): void {
  noteChordScreen();
  if (!menu.open) return;
  if (tui.ui.overlay !== undefined && tui.ui.picker?.id !== "menu") {
    // Another overlay (help, a picker) replaced the menu.
    menu.close();
    leaveAuditionScreen();
    return;
  }
  const view = menu.view(menuContext());
  tui.openPicker({
    id: "menu",
    title: view.title,
    items: view.items.length
      ? view.items
      : [{ label: "no matches", value: "none" }],
    index: view.index,
    hint: view.hint,
    note: view.note,
  });
}

function playSession(): PlaySession {
  if (play && play.track === requestedTrack) return play;
  const previous = play;
  play = new PlaySession(playHost(), {
    clickOn: previous?.clickOn,
    clickVolume: previous?.clickVolume,
    chords: chordSettings,
  });
  if (previous) {
    play.countInBars = previous.countInBars;
    play.grid = previous.grid;
  }
  return play;
}

async function enterPlay(): Promise<Receipt> {
  if (play?.on) return ok(`play · ${play.track} · esc leaves`);
  await materializeDraft();
  const session = playSession();
  await session.enter();
  if (hasSamplerTracks(score)) void sampleProblems(score);
  return ok(
    `play · ${session.track} · ${session.keyboard.range} · ? keys · esc leaves`,
  );
}

async function exitPlay(): Promise<Receipt> {
  if (!play?.on) return ok("play mode is off");
  await play.exit();
  return ok("play off");
}

/**
 * One key in play mode. True when play mode consumed it; false sends it on
 * to the normal bindings (overlays, a command being typed, Ctrl-C, arrows).
 */
function playKey(value: string): boolean {
  const session = play;
  if (!session?.on) return false;
  if (tui.ui.overlay !== undefined) return false;
  // `/play off`, `/click 50%`: once a command is being typed, keys are text.
  if (prompt.value.length > 0) return false;
  if (value === "/") return false;
  if (value === "\u0003") return false;
  const result = session.press(value);
  if (result.type === "handled") return true;
  if (result.type === "command") {
    if (result.command === "exit")
      void exitPlay().then((outcome) => receipt(outcome));
    else if (result.command === "transport") {
      if (!session.startWithCountIn())
        void toggleTransport().catch((error: unknown) =>
          tui.activity.pushError(
            `transport failed · ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    } else if (result.command === "menu") return false;
    return true;
  }
  // Unmapped: printable keys are swallowed so a stray letter never lands in
  // the prompt; control keys (Enter, arrows, Ctrl-Z) keep their bindings.
  return value.length === 1 && value >= " " && value !== "\u007f";
}

function playHost() {
  return {
    score: () => score,
    trackId: () => requestedTrack,
    now: () => performance.now(),
    playing: () => clock.playing,
    beatAt: (ms: number) => clock.beatAt(ms),
    engine: liveEngine,
    samples: () => liveSampleBank,
    async commit(
      next: TrackScore,
      kind: string,
      payload: Record<string, unknown>,
    ): Promise<void> {
      const operations = (payload.operations ?? []) as ScoreOperation[];
      let target = next;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          record = await port.appendOperations(
            record,
            { kind, payload },
            operations,
            target.toJSON(),
          );
          score = scoreFromJSON(record.composition);
          if (clock.playing) void audio.play(score);
          projectSync?.scoreChanged(score);
          return;
        } catch (error) {
          if (!(error instanceof SessionConflictError)) throw error;
          record = await port.load();
          score = scoreFromJSON(record.composition);
          target = operations.reduce(
            (value, operation) => applyScoreOperation(value, operation),
            score,
          );
        }
      }
      throw new Error("session busy");
    },
    async startTransport(beat: number): Promise<void> {
      if (port.mode === "daemon") {
        await port.transport("play", { beat });
        return;
      }
      clock.sync(beat, false);
      await setTransport("play");
    },
    async stopTransport(): Promise<void> {
      await setTransport("pause");
    },
    card(text: string, tone: "info" | "success" | "warning" | "error") {
      if (tone === "error") tui.activity.pushError(text);
      else
        tui.activity.pushCard(text, {
          tone,
          trackId: requestedTrack,
          resultRevision: tone === "success" ? record.revision : undefined,
        });
    },
    newNoteId: () => randomUUID().slice(0, 12),
  };
}

async function commitScore(
  next: TrackScore,
  kind: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  if (next === score) return;
  // Rhythm rows regenerate after a loop resize and freeze when their lane
  // is hand-edited, so rows and notes never disagree.
  next = reconcileRhythm(score, next);
  const retimed = timingChanged(score, next);
  if (stageCapture) {
    // A staged edit: the audition plays it; nothing is written yet.
    stageCapture.next = next;
    score = next;
    if (retimed) clock.follow(score);
    return;
  }
  record = await port.append(record, { kind, payload }, next.toJSON());
  score = next;
  if (retimed) clock.follow(score);
  if (clock.playing) void audio.play(score);
  projectSync?.scoreChanged(score);
  reportSampleProblems(score);
  void updateCredits(score);
}

/** True when the transport clock must follow `next` (tempo, meter, loop). */
function timingChanged(previous: TrackScore, next: TrackScore): boolean {
  return (
    previous.time !== next.time ||
    previous.tempoBpm !== next.tempoBpm ||
    previous.beatsPerBar !== next.beatsPerBar ||
    previous.bars !== next.bars
  );
}

/** The window's side of the project file sync (see src/project/sync.ts). */
function syncHost(): SyncHost {
  return {
    project: process.cwd(),
    current: () => score,
    async commit(plan, summary) {
      const baseRevision = record.revision;
      record = await port.appendOperations(
        record,
        {
          kind: "files.apply",
          payload: { summary },
        },
        plan.operations,
        plan.next.toJSON(),
      );
      score = scoreFromJSON(record.composition);
      clock.follow(score);
      if (clock.playing) void audio.play(score);
      reportSampleProblems(score);
      void baseRevision;
      return score;
    },
    card(text, tone, hint) {
      if (tone === "error") tui.activity.pushError(text);
      else
        tui.activity.pushCard(text, {
          tone,
          hint,
          resultRevision: tone === "success" ? record.revision : undefined,
        });
    },
    types(state) {
      typesIndicator = state;
    },
  };
}

async function stepHistory(direction: "undo" | "redo"): Promise<Receipt> {
  const latest = await port.load();
  // A fork's undo continues into its parent's history past the fork point.
  const target = historyTarget(
    latest.composition,
    await historyEvents(process.cwd(), latest),
    direction,
  );
  if (!target) return warn(`nothing to ${direction}`);
  try {
    const restored = scoreFromJSON(target.composition);
    record = await port.append(
      latest,
      {
        kind: direction === "undo" ? UNDO_KIND : REDO_KIND,
        payload: {
          [direction === "undo" ? "undoneRevision" : "redoneRevision"]:
            target.revision,
        },
      },
      restored.toJSON(),
    );
    score = restored;
    if (clock.playing) void audio.play(score);
    return ok(
      `${direction === "undo" ? "undid" : "redid"} · rev ${target.revision}`,
    );
  } catch (error) {
    if (error instanceof SessionConflictError)
      return warn(`session changed · retry ${direction}`);
    return fail(
      `${direction} failed · ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** The space-bar toggle: flip the transport, then record it for other windows. */
async function toggleTransport(): Promise<void> {
  await setTransport("toggle");
  try {
    record = await port.append(
      record,
      {
        kind: "transport",
        payload: {
          action: "toggle",
          playing: clock.playing,
          beat: clock.beatAt(),
        },
      },
      score.toJSON(),
    );
  } catch (error) {
    if (error instanceof SessionConflictError)
      tui.activity.pushCard("transport changed in another window", {
        tone: "warning",
      });
    else throw error;
  }
}

async function setTransport(
  action: "play" | "pause" | "toggle",
): Promise<void> {
  // One sound at a time: starting the song stops an audition loop.
  if (action !== "pause" && auditionLoop?.looping) stopAuditionLoop();
  if (port.mode === "daemon") {
    // dawgd owns the only transport; its broadcast updates `clock`.
    await port.transport(action);
    return;
  }
  if (action === "play") {
    clock.play();
    await audio.play(score, clock.beatAt());
  } else if (action === "pause") {
    clock.pause();
    audio.stop();
  } else if (clock.playing) {
    clock.pause();
    audio.stop();
  } else {
    clock.play();
    await audio.play(score, clock.beatAt());
  }
}

/**
 * Run one streaming tool-calling turn. Each validated tool call commits its
 * own revision through `agentHost`, so cancelling keeps every accepted change
 * and never leaves a half-applied call.
 */
async function runAgent(text: string): Promise<string | Receipt> {
  if (agentTurn) return warn("agent busy · Esc cancels");
  const selection = await currentProvider();
  if (selection.kind === "offline")
    return fail(
      `unrecognized · ${truncateForCard(text)} · ${selection.reason}`,
    );
  const turn = { controller: new AbortController(), steering: [] as string[] };
  agentTurn = turn;
  reportAgentActivity(`${providerName} · thinking…`);
  // xcb admits a pending account on its first call, which takes longer.
  let admitting = selection.kind === "xcb" && selection.admissionPending;
  if (admitting) tui.activity.setSpinner("admitting account…");
  try {
    const result = await runProviderTurn({
      selection,
      prompt: text,
      host: agentHost(turn, selection),
      signal: turn.controller.signal,
      onEvent: (event) => {
        if (admitting && event.type === "step" && event.step <= 1) return;
        if (admitting) {
          admitting = false;
          provider = undefined; // Re-read capabilities: now admitted.
        }
        if (event.type === "usage") {
          // Subscriptions are included; API responses are priced once.
          if (isApiSelection(selection)) {
            const { type: _type, ...usage } = event;
            void priceForModel(selection.kind, selection.modelId, {
              configDir: configDir(),
              apiKey: selection.apiKey,
            })
              .catch(() => undefined)
              .then((price) => {
                meter.add(usage, price);
                tickUi();
              });
          }
          return;
        }
        agentEventSink(event);
      },
    });
    return describeAgentEvent(result) ?? "agent finished";
  } finally {
    if (agentTurn === turn) agentTurn = undefined;
  }
}

function authTone(line: string): "success" | "warning" | "info" {
  if (line.startsWith("✓")) return "success";
  if (/^(✗|\?)|not |no |could not|failed/i.test(line)) return "warning";
  return "info";
}

/**
 * The cached provider, re-resolved when `~/.config/dawg` config or
 * credentials change (two stats per call) and, while offline, at most every
 * 30 s so an account admitted elsewhere is picked up without a restart.
 */
function currentProvider(): Promise<ProviderSelection> {
  const fingerprint = providerFingerprint();
  const stale =
    fingerprint !== providerStamp.fingerprint ||
    (providerStamp.offline && Date.now() - providerStamp.at > 30_000);
  if (provider && stale) provider = undefined;
  if (!provider) {
    providerStamp = { fingerprint, at: Date.now(), offline: false };
    provider = selectProvider().catch((): ProviderSelection => ({
      kind: "offline",
      choice: "auto",
      reason: "provider unavailable; run `dawg login`",
    }));
  }
  return provider.then((selection) => {
    providerSnapshot = selection;
    providerName = providerLabel(selection);
    if (
      selection.kind === "offline" &&
      selection.invalidSaved &&
      !invalidNoticeShown
    ) {
      invalidNoticeShown = true;
      tui.activity.pushCard(`sign-in stopped working · ${selection.reason}`, {
        tone: "warning",
        hint: "/login",
      });
    }
    providerStamp.offline = selection.kind === "offline";
    return selection;
  });
}

/** Media tools write under the workspace's `tracks/<slug>/downloads/`. */
function mediaServices(): MediaServices {
  return { runner: systemRunner, env: process.env };
}

/**
 * How the agent's preview_sound renders (with this window's decoded
 * samples, at the engine's rate) and plays: once, over silence, unless the
 * song or the audition loop is already sounding or `/try agent off`.
 */
function agentPreviewHost(): PreviewHost {
  return {
    render: async (value) => {
      await sampleProblems(value);
      return renderScorePcm(value, {
        sampleRate: previewEngine().sampleRate,
        ...(liveSampleBank ? { samples: liveSampleBank } : {}),
      });
    },
    play: async (rendered) => {
      if (!agentPreviewPlays || clock.playing || auditionLoop?.looping)
        return false;
      const engine = liveEngine();
      if (!engine?.canMonitor || rendered.frames === 0) return false;
      try {
        await engine.monitor(true);
        engine.noteOn(AGENT_PREVIEW_VOICE, {
          pcm: rendered.pcm,
          frames: rendered.frames,
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}

function agentHost(
  turn: { steering: string[] },
  selection: ProviderSelection,
): AgentHost {
  return {
    snapshot: () => ({
      score,
      revision: record.revision,
      focusedTrackId: requestedTrack,
      recentOperations: record.events.slice(-8).map((event) => {
        const payload = event.payload as { summary?: unknown } | null;
        return typeof payload?.summary === "string"
          ? `${event.kind}: ${payload.summary}`
          : event.kind;
      }),
    }),
    media: mediaServices(),
    preview: agentPreviewHost(),
    async commit(change) {
      // dawgd rebases operation intents onto newer revisions when nothing
      // they touch changed; the file port keeps the strict base check.
      if (port.mode !== "daemon" && change.baseRevision !== record.revision)
        throw new StaleRevisionError(change.baseRevision, record.revision);
      try {
        record = await port.appendOperations(
          { ...record, revision: change.baseRevision },
          {
            kind: "agent.tool",
            payload: {
              tool: change.toolName,
              callId: change.callId,
              summary: change.summary,
              operations: change.operations,
            },
          },
          change.operations,
          change.next.toJSON(),
        );
        // A rebased commit lands on a newer score than `change.next`.
        score = scoreFromJSON(record.composition);
        if (clock.playing) void audio.play(score);
      } catch (error) {
        if (error instanceof SessionConflictError)
          throw new StaleRevisionError(
            change.baseRevision,
            record.revision + 1,
          );
        throw error;
      }
      if (
        change.operations.some(
          (operation) =>
            operation.type === "setTempo" || operation.type === "setTime",
        )
      )
        clock.follow(score);
      return { revision: record.revision };
    },
    async transport(action) {
      await setTransport(action);
      try {
        record = await port.append(
          record,
          {
            kind: "transport",
            payload: { action, playing: clock.playing, beat: clock.beatAt() },
          },
          score.toJSON(),
        );
      } catch (error) {
        if (!(error instanceof SessionConflictError)) throw error;
      }
    },
    takeSteering: () => turn.steering.splice(0),
    workspace: { root: process.cwd() },
    // A written project source is applied before the tool result returns,
    // so the model reads the outcome and any type errors in the same step.
    async onWorkspaceWrite(path) {
      if (!projectSync || !/\.ts$/.test(path)) return;
      const outcome = await projectSync.checkFiles();
      const types = await typecheckProject(process.cwd());
      const errors = types.diagnostics.slice(0, 8).map(formatDiagnostic);
      return [
        outcome,
        types.ok ? "types ✓" : `types ✗ ${types.diagnostics.length}`,
        ...errors,
      ].join("\n");
    },
    // web_search uses the turn's own gateway or OpenRouter key; billed
    // searches go to the spend meter and daily ledger.
    web: webHostFor(
      isApiSelection(selection) ? selection : { kind: selection.kind },
      meter,
      tickUi,
    ),
  };
}
