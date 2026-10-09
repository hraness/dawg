#!/usr/bin/env bun
import { isGuideInstrument, vocalChainPatch } from "../core/clips.ts";
import { isSingWord } from "../core/sing.ts";
import { commandParses } from "./commands/parses.ts";
import {
  isUnknownInstrument,
  plainSineAdvice,
} from "./audio/instrument-check.ts";
import { randomUUID } from "node:crypto";
import { readFileSync, writeSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
import {
  applyExpressionCommand,
  parseExpressionCommand,
} from "./commands/expression.ts";
import {
  applyFxCommand,
  parseFxCommand,
  unknownFxMessage,
} from "./commands/fx.ts";
import {
  applyRigCommand,
  parseRigCommand,
  rigTrackFields,
  rigWordPatch,
} from "./commands/rig.ts";
import {
  applyProgressionCommand,
  parseProgressionCommand,
} from "./commands/progression.ts";
import {
  applyGuitarCommand,
  applyStrumCommand,
  parseGuitarCommand,
  parseStrumCommand,
} from "./commands/strum.ts";
import {
  applyModalCommand,
  modalListLines,
  parseModalCommand,
} from "./commands/modal.ts";
import {
  applyWindCommand,
  parseWindCommand,
  windListLines,
} from "./commands/wind.ts";
import {
  applySingCommand,
  parseSingCommand,
  singListLines,
} from "./commands/sing.ts";
import { applySynthCommand, parseSynthCommand } from "./commands/synth.ts";
import { applyStringCommand, parseStringCommand } from "./commands/string.ts";
import { instrumentPatchForWord, isModalWord } from "../core/resonators.ts";
import {
  applyGranularCommand,
  granularTrackPreset,
  grainSrcHint,
  parseGranularCommand,
} from "./commands/granular.ts";
import {
  applyKeysCommand,
  newPianoTrack,
  parseKeysCommand,
} from "./commands/keys.ts";
import {
  applyTuningCommand,
  importTuningFile,
  parseTuningCommand,
  type TuningCommand,
} from "./commands/tuning.ts";
import {
  applyCalibrationCommand,
  parseCalibrationCommand,
} from "./commands/calibration.ts";
import { TuningError, displayTag, resolveTuning } from "../core/tuning.ts";
import {
  applyMasterCommand,
  measurementLine,
  parseMasterCommand,
} from "./commands/master.ts";
import { applyStyleCommand, parseStyleCommand } from "./commands/style.ts";
import { exportSampleRate, measureScoreOffThread } from "./audio/measure.ts";
import {
  applySectionCommand,
  parseSectionCommand,
} from "./commands/arrange.ts";
import {
  helpMiss,
  helpText,
  helpTitle,
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
import { applyFitCommand, fitVoice, parseFitCommand } from "./commands/fit.ts";
import { applyShiftCommand, parseShiftCommand } from "./commands/shift.ts";
import { parseVocalCommand, runVocalCommand } from "./commands/vocal.ts";
import {
  applyFormantCommand,
  parseFormantCommand,
  parseVowelCommand,
} from "./commands/formant.ts";
import {
  applyLyrics,
  parseClipCommand,
  parseLyricsCommand,
  runClipCommand,
  setClipImportDeps,
} from "./commands/clips.ts";
import { pitchTraceFor } from "./commands/vocal-pitch.ts";
import {
  applyVocoderCommand,
  parseVocoderCommand,
  vocoderListLines,
} from "./commands/vocoder.ts";
import {
  applyAutotuneCommand,
  autotuneListLines,
  parseAutotuneCommand,
} from "./commands/autotune.ts";
import { parseResampleCommand, runResample } from "./commands/resample.ts";
import { suggestFitMode } from "./audio/dsp/onset.ts";
import {
  SampleLibrary,
  hasSamplerTracks,
  sampleKey,
  type SampleBank,
  type SampleProblem,
} from "./audio/samples.ts";
import {
  ANALYSIS_CACHE_BYTES,
  analysisCacheStatus,
  analysisDir,
  pruneAnalysisCache,
} from "./audio/analysis.ts";
import { drumSnapshotFields, samplerSnapshotFields } from "../tui/drums.ts";
import { clipSnapshots, loadClipPeaks } from "../tui/clip-row.ts";
import { highwayLayers } from "../tui/layers.ts";
import { drumVoicePitch, isDrumInstrument } from "../core/drums.ts";
import {
  describeAgentEvent,
  StaleRevisionError,
  type AgentEvent,
  type AgentHost,
} from "./agent/agent.ts";
import { routeDuringTurn } from "./agent/steer.ts";
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
import { configDir, readConfig, writeConfig } from "./auth/credentials.ts";
import type { CommandOutcome } from "./agent/command-agent.ts";
import {
  GLIDE_STEP_MS,
  NoteScheduler,
  finishHint,
  gestureFor,
  glideValues,
  isAgentCommand,
  parseShowMe,
  toolCaption,
  type ShowMeLevel,
} from "./agent/show-me.ts";
import { firstRunCard, runAuthCommand, runTuiLogin } from "./auth/cli.ts";
import { musicalReceipt } from "./session/receipt.ts";
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
import {
  EditMenu,
  MENU_SECTIONS,
  MENU_SHOWN_SECTIONS,
  type MenuContext,
} from "./tui/menu.ts";
import {
  drawerView,
  faderChoose,
  faderKeyPress,
  faderSetPosition,
  faderStep,
  focusIndex,
  type FaderResult,
  type FaderState,
} from "./tui/fader.ts";
import {
  isMouseSequence,
  MOUSE_OFF,
  MOUSE_ON,
  parseMouse,
  type MouseEvent,
} from "../tui/keys.ts";
import {
  Audition,
  SUPERSEDED,
  isChordStageable,
  isStageable,
} from "./tui/audition.ts";
import { EuclidEditor, type EuclidContext } from "./tui/euclid.ts";
import { HINTS, KEYS, keyLines, type KeySection } from "../tui/grammar.ts";
import { renderAudition } from "./audio/audition.ts";
import { exportScore, playbackTime, scoreBeatAt } from "./audio/arrange.ts";
import { formatForm } from "../core/sections.ts";
import type { ArrangeStripView } from "../tui/arrange-strip.ts";
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
  isSamplerInstrument,
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
import {
  ESCAPE_FLUSH_MS,
  INPUT_FLUSH,
  PASTE_FLUSH_MS,
  TerminalInputDecoder,
} from "../tui/input.ts";
import { FrameGate } from "../tui/frame-gate.ts";
import {
  CARD_GLOW_MS,
  composeFrame,
  TuiApp,
  type AppView,
  type LoudnessView,
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
import {
  parseLaunchArgs,
  parseSimpleArgv,
  resolveTrackArg,
} from "./launch-args.ts";
import { RENDER_USAGE } from "./render.ts";
import { typecheckProject } from "./project/typecheck.ts";
import {
  startProjectSync,
  type ProjectSync,
  type SyncHost,
} from "./project/sync.ts";

/** Whether a bare command parses (no side effects): for typo suggestions. */
function parsesLocally(text: string): boolean {
  return commandParses(text, score);
}

const ESC = "\u001b[";
/** `/sessions` rows shown in the overlay. */
const MAX_LISTED_SESSIONS = 64;

/** Wraps a usage line at spaces before `width`, indenting continuations. */
function wrapUsage(text: string, width: number, indent: string): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const prefix = lines.length === 0 ? "  " : indent;
    if (line && prefix.length + line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  lines.push(line);
  return lines.join(`\n${indent}`);
}
const HELP_TEXT = `dawg · local-first terminal music workstation

Usage:
  dawg [--new] [--session <name|id>] [--track <name>]
  dawg --import <file> --export <file>   convert a loop file (no session)
  dawg sessions
  ${wrapUsage(RENDER_USAGE.replace(/^usage: /, ""), 76, "               ")}
  dawg init [dir]      project files: song.ts, tracks/<slug>/track.ts, .dawg/sdk
  dawg check           typecheck + evaluate the project; exit 1 on problems
  dawg <command> --help  usage: sessions render init check media model
  dawg media doctor|download|stems|analyze|notes|sample|lyrics …  (dawg media --help)
  dawg --version

Display options:
  --reduce-motion   static hit/sustain states (also DAWG_REDUCE_MOTION=1)
  --theme <name>    default | high-contrast | mono (NO_COLOR forces mono)
  --no-mouse        keys only; no click/wheel reporting (also DAWG_MOUSE=0)

Prompt:
  Enter submit · Shift-Enter newline · Alt-Enter next · Ctrl-Q now / next
  Ctrl-Z undo · Ctrl-Y redo · Ctrl-O transcript · Esc cancel/close · Ctrl-C exit
  Space on an empty prompt toggles playback

Commands (bare music words; app commands take a slash):
${helpText()}

Agent (optional; the choice is saved and reused until you log out):
  dawg model key               find existing setups and pick a provider
  dawg model key gateway|openrouter|codex|claude
  dawg model [alias]           pick a model, with the estimated cost per prompt
  dawg logout [provider] · dawg auth status [--check]
Unrecognized requests go to the agent once a provider is configured
(DAWG_PROVIDER=gateway|openrouter|codex|claude|auto, DAWG_MODEL=<alias>;
DAWG_AI=0 disables the agent).`;
const args = new Set(process.argv.slice(2));
/** One parse for every launch flag; problems are reported below. */
const launch = parseLaunchArgs(process.argv.slice(2));
const launchArgs = launch.ok ? launch.args : undefined;
const requestedSession = launchArgs?.session;
/** `--track` normalized as `/track` does; matched to an existing track below. */
let explicitTrack = launchArgs?.track?.id;
/** The focused track; claimed at startup unless `--track` is given. */
let requestedTrack = explicitTrack ?? "main";
const initialInstrument = isDrumInstrument(requestedTrack) ? "kit" : "sine";
const importPath = launchArgs?.importPath;
const exportPath = launchArgs?.exportPath;
// `dawg model key [provider]` is the canonical spelling of `dawg login`.
if (process.argv[2] === "model" && process.argv[3] === "key")
  process.exit(await runAuthCommand(["login", ...process.argv.slice(4)]));
if (["login", "logout", "auth", "model"].includes(process.argv[2] ?? ""))
  process.exit(await runAuthCommand(process.argv.slice(2)));
{
  // An unknown DAWG_MODEL is an error, never a silent fallback.
  const fromEnv = process.env.DAWG_MODEL?.trim();
  if (
    fromEnv &&
    !resolveModelChoice("gateway", fromEnv) &&
    !resolveModelChoice("openrouter", fromEnv)
  ) {
    process.stderr.write(
      `dawg: unknown DAWG_MODEL "${fromEnv.slice(0, 40)}"; use one of ${MODEL_CATALOG.map((row) => row.alias).join(", ")} or a vendor/model ID\n`,
    );
    process.exit(2);
  }
}
if (process.argv[2] === "sessions") {
  const usage =
    "usage: dawg sessions · lists this workspace's sessions, newest first (* marks the current one)";
  const parsed = parseSimpleArgv(process.argv.slice(3), 0);
  if (parsed.kind === "error") {
    process.stderr.write(`${parsed.problem} · ${usage}\n`);
    process.exit(2);
  }
  if (parsed.kind === "help") stdout.write(`${usage}\n`);
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
  if (!launch.ok) {
    process.stderr.write(`${launch.problem} · dawg --help\n`);
    process.exit(2);
  }
}
// `--import X --export Y` converts one loop file to another: no session.
if (importPath && exportPath) {
  try {
    const converted = decodeLoop(await readLoopFile(importPath));
    await writeFile(resolve(exportPath), encodeLoop(converted), "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const midi = /\.midi?$/i.test(importPath)
      ? " · MIDI files are not imported; --import takes a .track.json loop"
      : "";
    process.stderr.write(
      `dawg: cannot import ${importPath} · ${reason.split("\n")[0]!.slice(0, 160)}${midi}\n`,
    );
    process.exit(1);
  }
  stdout.write(`converted ${importPath} → ${exportPath}\n`);
  process.exit(0);
}
const demo =
  args.has("--demo") || process.env.DAWG_DEMO === "1" || !stdin.isTTY;
// Music first: the TUI opens directly. The first session with no provider
// (or a saved one that stopped working) gets one card instead of a picker.
const launchCard =
  !demo && process.env.DAWG_AI !== "0" && stdout.isTTY
    ? firstRunCard().catch(() => undefined)
    : undefined;

const initial = createScore({
  tracks: [
    {
      id: requestedTrack,
      name: requestedTrack,
      instrument: initialInstrument,
      // `dawg jangle`: a guitar alias starts with its voice and rig.
      ...rigTrackFields(requestedTrack),
    },
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
// Decode the import before a session exists, so a bad file is one line.
let importedScore: TrackScore | undefined;
if (importPath) {
  try {
    importedScore = decodeLoop(await readLoopFile(importPath));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const midi = /\.midi?$/i.test(importPath)
      ? " · MIDI files are not imported; --import takes a .track.json loop"
      : "";
    process.stderr.write(
      `dawg: cannot import ${importPath} · ${reason.split("\n")[0]!.slice(0, 160)}${midi}\n`,
    );
    process.exit(1);
  }
}
// A demo frame only renders: with no workspace yet (and nothing imported),
// it runs on a throwaway session so the cwd gets no `.dawg/`.
const ephemeralWorkspace =
  demo && freshWorkspace && !importPath && selectedSession === undefined
    ? await mkdtemp(join(tmpdir(), "dawg-demo-"))
    : undefined;
const session = await ensureSession(initial.toJSON(), {
  ...sessionOptions,
  ...(ephemeralWorkspace ? { workspace: ephemeralWorkspace } : {}),
});
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
if (importPath && importedScore) score = importedScore;
// `--track Bass` focuses an existing `bass` (or a track named "Bass").
if (launchArgs?.track) {
  explicitTrack = resolveTrackArg(score.tracks, launchArgs.track);
  requestedTrack = explicitTrack;
}
if (importPath && importedScore) {
  score = importedScore;
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
  theme: launchArgs?.theme ?? parseThemeName(process.env.DAWG_THEME),
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
/** Queue a prompt to run as if typed (set by the interactive loop). */
let runPromptLater: (command: string) => void = () => undefined;
/** The fader drawer's focus and typing, while one is open over the menu. */
let fader: FaderState | undefined;
/** Show-me state (see the show-me section below). */
const showMe: {
  level: ShowMeLevel;
  ghost?: string | undefined;
  caption?: string | undefined;
  commands: string[];
  notes: NoteScheduler;
  clear?: ReturnType<typeof setTimeout> | undefined;
} = {
  level: parseShowMe(process.env.DAWG_SHOWME ?? "") ?? "on",
  commands: [],
  notes: new NoteScheduler(() => score.tempoBpm),
};
if (!process.env.DAWG_SHOWME)
  void readConfig({ dir: configDir() })
    .then((config) => {
      if (config.showMe) showMe.level = config.showMe;
    })
    .catch(() => undefined);
const KEY_UP = "\u001b[A";
const KEY_DOWN = "\u001b[B";
/** The fader bar a left-button drag started on. */
let dragging: { field: number; left: number; width: number } | undefined;
/** The open drawer came from a command, not the menu. */
let faderStandalone = false;
/** Per-field sequence: a drag drops stale stages that would land late. */
const faderSeq = new Map<string, number>();
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
    // A state, not a nag: the first session's card already named /login.
    return width >= 40 ? formatSpendLine({ kind: "offline" }) : "";
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
  if (ephemeralWorkspace) {
    await port.close().catch(() => undefined);
    await rm(ephemeralWorkspace, { recursive: true, force: true });
  }
  process.exit(0);
}

if (exportPath) {
  await writeFile(resolve(exportPath), encodeLoop(score), "utf8");
  if (!stdin.isTTY) process.exit(0);
}

await runInteractive();

async function packageVersion(): Promise<string> {
  const raw = await readFile(
    new URL("../package.json", import.meta.url),
    "utf8",
  );
  return (JSON.parse(raw) as { version?: string }).version ?? "0.0.0";
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
  const focused = value.tracks.find((track) => track.id === requestedTrack);
  const table =
    focused && !isDrumInstrument(focused.instrument)
      ? resolveTuning(value.tuning, focused.tuning, value.key)
      : undefined;
  const notes = value.notes
    .filter((note) => note.trackId === requestedTrack)
    .map((note) => {
      const tag =
        focused && !isDrumInstrument(focused.instrument)
          ? displayTag(table, note.pitch, note.cents)
          : undefined;
      return {
        id: note.id,
        startBeat: note.startTick / value.ticksPerBeat,
        durationBeats: note.durationTicks / value.ticksPerBeat,
        pitch: note.pitch,
        velocity: note.velocity,
        muted: focused?.muted,
        ...(tag?.cents !== undefined ? { cents: tag.cents } : {}),
        ...(tag?.name !== undefined ? { centsFrom: tag.name } : {}),
        ...(note.lyric !== undefined ? { lyric: note.lyric } : {}),
      };
    });
  // 0.7 clips: the clip row; peaks load off the frame path, then redraw.
  const clips = clipSnapshots(value, requestedTrack);
  if (clips)
    void loadClipPeaks(process.cwd(), focused).then((changed) => {
      if (changed) requestFrame();
    });
  return {
    notes,
    ...(clips ? { clips } : {}),
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
    currentBeat: scoreBeatAt(value, beat),
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
    ...(table && table.linear && table.size !== 12
      ? { tuningPeriod: { size: table.size, root: table.root } }
      : {}),
    pitchTrace: pitchTraceFor(requestedTrack, value),
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
    // The highway shows score time: inside the looped section or form pass.
    beat: scoreBeatAt(value, beat),
    arrange: arrangeStripView(value, beat),
    // `opus-5.5 · gateway`, `sonnet · claude`; hidden when offline.
    model:
      providerName && providerName !== "offline" ? providerName : undefined,
    spend: spendLine(),
    agentOffline: providerName === "offline" || process.env.DAWG_AI === "0",
    showMe:
      showMe.ghost || showMe.caption
        ? { ghost: showMe.ghost, caption: showMe.caption }
        : undefined,
    sync: syncState,
    sessionName: record.meta.name,
    windows: windowCount,
    types: typesIndicator,
    play: play?.on ? play.header() : undefined,
    loudness: masterLoudness(value),
  };
}

/**
 * The 48 kHz reading of the mastered song (what `master measure` and the
 * export read), for the score it measured; one measurement at a time, in a
 * worker, started when the loop plays a mastered score it has not read.
 */
let exportMeter:
  { score: TrackScore; view?: LoudnessView; running: boolean } | undefined;

/**
 * The header meter: loudness of the loop the local engine is playing. With
 * a master the engine monitors at its own rate, so the meter shows the
 * export-rate reading once it is in and the monitor's (marked as an
 * estimate) until then.
 */
function masterLoudness(value: TrackScore): LoudnessView | undefined {
  const engine = audio instanceof AudioEngine ? audio : monitorEngine;
  const report = engine?.loudness;
  if (!report) return undefined;
  const ceiling =
    typeof value.master?.limiter?.ceiling === "number"
      ? value.master.limiter.ceiling
      : value.master?.limiter
        ? -1
        : undefined;
  const target =
    typeof value.master?.target === "number" ? value.master.target : undefined;
  const monitor: LoudnessView = {
    integrated: report.integrated,
    truePeak: report.truePeak,
    target,
    ceiling,
  };
  if (!value.master || exportSampleRate(value) === engine.sampleRate)
    return monitor;
  if (exportMeter?.score === value && exportMeter.view) return exportMeter.view;
  if (!exportMeter?.running) {
    const measuring = { score: value, running: true } as NonNullable<
      typeof exportMeter
    >;
    exportMeter = measuring;
    void measureScoreOffThread(value, { projectRoot: process.cwd() })
      .then((measured) => {
        measuring.view = {
          integrated: measured.mix.loudness.integrated,
          truePeak: measured.mix.loudness.truePeak,
          target,
          ceiling,
        };
      })
      .catch(() => undefined)
      .finally(() => {
        measuring.running = false;
      });
  }
  return { ...monitor, estimate: true };
}

/** The arrangement strip over the timeline; absent without sections. */
function arrangeStripView(
  value: TrackScore,
  beat: number,
): ArrangeStripView | undefined {
  if (value.sections.length === 0) return undefined;
  return {
    bars: value.bars,
    sections: value.sections,
    loop: value.loopSection,
    playheadBar: scoreBeatAt(value, beat) / value.beatsPerBar,
    form: value.form.length ? formatForm(value.form) : undefined,
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
  // A receipt that names its own undo key needs no second hint.
  const hint =
    scoreChanged &&
    undoHintsShown < MAX_UNDO_HINTS &&
    !message.endsWith("ctrl-z undo")
      ? message.startsWith("undid")
        ? "ctrl-y redo"
        : "ctrl-z undo"
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

/**
 * Mouse reporting is on unless `--no-mouse` or `DAWG_MOUSE=0` (or a dumb
 * terminal) says otherwise. A terminal without mouse support ignores the
 * modes and every key still works.
 */
function mouseEnabled(): boolean {
  return (
    !process.argv.includes("--no-mouse") &&
    process.env.DAWG_MOUSE !== "0" &&
    process.env.TERM !== "dumb"
  );
}

function mouseOn(): string {
  return mouseEnabled() ? MOUSE_ON : "";
}

/**
 * Mouse off, plain colors, plain paste, cursor shown, main screen.  A
 * function, not a const: `await runInteractive()` runs above this line.
 */
function terminalRestore(): string {
  return `${MOUSE_OFF}${ESC}0m${ESC}?2004l${ESC}?25h${ESC}?1049l`;
}

/** `dawg: <stack>` for a crash printed after leaving the alternate screen. */
function crashText(error: unknown): string {
  const text =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  return `dawg: ${text}\n`;
}

async function runInteractive(): Promise<void> {
  // Every way out (quit, a failing teardown step, a crash, a kill, a stray
  // process.exit) restores the whole terminal, once, synchronously: the
  // shell must not stay on the alternate screen with paste brackets on.
  let terminalRestored = false;
  const restoreTerminal = () => {
    if (terminalRestored) return;
    terminalRestored = true;
    try {
      stdin.setRawMode?.(false);
    } catch {
      // stdin may already be closed.
    }
    try {
      writeSync(1, terminalRestore());
    } catch {
      // The terminal may already be gone (SIGHUP).
    }
  };
  process.once("exit", restoreTerminal);
  // A kill or a closed terminal: restore it, then exit as killed.
  for (const [signal, code] of [
    ["SIGTERM", 143],
    ["SIGHUP", 129],
  ] as const)
    process.once(signal, () => {
      restoreTerminal();
      process.exit(code);
    });
  // An exception nothing caught leaves the editor in an unknown state: leave
  // the alternate screen first, so the stack lands in the shell, then exit.
  const onUncaught = (error: unknown) => {
    restoreTerminal();
    try {
      writeSync(2, crashText(error));
    } catch {
      // Nowhere left to report it.
    }
    process.exit(1);
  };
  // A rejected fire-and-forget promise is one failed action, not a broken
  // editor: report it on the activity strip and repaint over anything the
  // runtime wrote.
  const onRejection = (error: unknown) => {
    if (terminalRestored || screenSuspended) {
      try {
        writeSync(2, crashText(error));
      } catch {
        // Nowhere left to report it.
      }
      return;
    }
    tui.activity.pushError(
      `failed · ${error instanceof Error ? error.message : String(error)}`,
    );
    tui.invalidate();
    requestFrame();
  };
  // Runtime warnings and console output would land on top of the frame; the
  // writer never repaints rows it did not change.  Route them to the
  // transcript instead, and repaint.
  const onWarning = (warning: Error) => {
    if (screenSuspended || terminalRestored) return;
    tui.activity.pushNote(`warning · ${warning.message}`, "error");
    tui.invalidate();
    requestFrame();
  };
  const consoleError = console.error;
  const consoleWarn = console.warn;
  const consoleToTranscript =
    (original: (...data: unknown[]) => void) =>
    (...data: unknown[]) => {
      if (screenSuspended || terminalRestored) return original(...data);
      tui.activity.pushNote(
        data
          .map((item) => (item instanceof Error ? item.message : String(item)))
          .join(" "),
        "error",
      );
      tui.invalidate();
      requestFrame();
    };
  process.on("uncaughtException", onUncaught);
  process.on("unhandledRejection", onRejection);
  process.on("warning", onWarning);
  console.error = consoleToTranscript(consoleError);
  console.warn = consoleToTranscript(consoleWarn);
  stdin.setRawMode?.(true);
  stdin.resume();
  // Alternate screen, hidden cursor, bracketed paste.
  stdout.write(`${ESC}?1049h${ESC}?25l${ESC}?2004h${ESC}2J${mouseOn()}`);
  const inputDecoder = new TerminalInputDecoder();
  const queuedPrompts: string[] = [];
  let processingQueue = false;
  const runPrompt = async (text: string): Promise<void> => {
    const ui = tui.command(text);
    if (ui !== undefined) {
      if (typeof ui === "string") tui.activity.pushCard(ui, { tone: "info" });
      else tui.activity.pushCard(ui.text, { tone: toneOf(ui) });
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
  /** A typed command during an agent turn; leaves the turn's receipt alone. */
  const runLocalBesideAgent = async (text: string): Promise<void> => {
    tui.activity.pushRequest(text);
    const base = baseline();
    try {
      receipt(await submit(text), base);
    } catch (error) {
      tui.activity.pushError(describeError(text, error));
    }
  };
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
  // Builds a frame only when something can have changed (tui/frame-gate.ts):
  // an idle editor no longer rebuilds the whole view 30 times a second.
  const frameGate = new FrameGate();
  const unwatchActivity = tui.activity.subscribe(() => frameGate.markDirty());
  const animating = (): boolean => {
    if (clock.playing || play?.on || auditionLoop?.looping) return true;
    const activity = tui.activity;
    if (activity.spinner || activity.streaming) return true;
    const latest = activity.latest;
    return (
      !tui.ui.reducedMotion &&
      latest !== undefined &&
      Date.now() - latest.atMs < CARD_GLOW_MS
    );
  };
  const tick = (force = false) => {
    if (screenSuspended) return;
    if (
      !frameGate.shouldBuild({
        nowMs: Date.now(),
        force,
        animating: animating(),
        keys: [
          score,
          record.revision,
          record.sessionId,
          record.meta.name,
          syncState,
          windowCount,
          typesIndicator,
          menu.open,
          euclid.open,
          tui.ui.overlay,
        ],
      })
    )
      return;
    followCommitted();
    play?.tick();
    // Values in the menu follow the score as edits land.
    if (menu.open) refreshMenu();
    if (euclid.open) refreshEuclid();
    refreshAuditionPicker();
    // The gate already paces frames; the app's own throttle would drop an
    // approved frame that lands just after a forced one, and the gate would
    // not ask again until the heartbeat.
    tui.render(appView(score, clock.beatAt()), { force: true });
  };
  requestFrame = () => tick(true);
  runPromptLater = (command) => {
    queuedPrompts.unshift(command);
    void drainQueue();
  };
  reportAgentActivity = () => {
    tui.activity.applyAgentEvent({ type: "start", model: providerName });
  };
  agentEventSink = (event) => {
    if (event.type === "usage") return;
    if (event.type === "command-typing") {
      showMeTyping(event.text);
      return;
    }
    if (event.type === "command") return;
    if (event.type === "tool-start") {
      const caption = toolCaption(event.name);
      if (caption) showMeCaption(caption);
    }
    if (event.type === "done" || event.type === "error") showMeFinish();
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
      // Queued before a /fork or /resume swapped the session: stale.
      if (latest.sessionId !== record.sessionId) return;
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
      clock.setTimeMap(transportMapFor(playbackTime(score)));
      clock.sync(beat, playing, atMs, monotonicEpochMs());
    } else if (update.type === "status") {
      syncState = port.sync;
      tui.activity.pushCard(update.message, {
        tone: syncState === "offline" ? "warning" : "info",
      });
    }
  };
  // Each subscription answers only while its port is the live one: /fork and
  // /resume swap the port, and a load the old port started before the swap
  // could otherwise land afterwards and pull the old session's name and
  // score into the new one.
  const subscribeLive = (): (() => void) => {
    const bound = port;
    return bound.subscribe((update) => {
      if (bound === port) onUpdate(update);
    });
  };
  let unsubscribe = subscribeLive();
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
    unsubscribe = subscribeLive();
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
  void launchCard?.then((card) => {
    if (card) tui.activity.pushCard(card.text, { tone: card.tone, once: true });
  });
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
      while (inbox.length === 0) {
        // A partial escape (Alt+[, a cut-off paste) is flushed after a short
        // idle so it never holds back the keys behind it.
        const held = inputDecoder.pending();
        const idle =
          held === "paste"
            ? PASTE_FLUSH_MS
            : held === "escape"
              ? ESCAPE_FLUSH_MS
              : undefined;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const timedOut = await new Promise<boolean>((resolve) => {
          wake = () => resolve(false);
          if (idle !== undefined)
            timeout = setTimeout(() => resolve(true), idle);
        });
        clearTimeout(timeout);
        if (timedOut && inbox.length === 0) {
          wake = undefined;
          yield INPUT_FLUSH;
        }
      }
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
    stdout.write(terminalRestore());
    try {
      return await flow();
    } finally {
      stdout.write(`${ESC}?1049h${ESC}?25l${ESC}?2004h${ESC}2J${mouseOn()}`);
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
      const values =
        text === INPUT_FLUSH
          ? inputDecoder.flush()
          : [
              ...inputDecoder.push(text),
              ...(text === "\u001b" ? inputDecoder.flush() : []),
            ];
      while (values.length) {
        const value = values.shift()!;
        // A mouse report acts on what the last frame painted under it; some
        // become keys (a list row, a wheel notch) and run through below.
        if (typeof value === "string" && isMouseSequence(value)) {
          const event = parseMouse(value);
          if (event) values.unshift(...mouseInput(event));
          tick(true);
          continue;
        }
        // The fader drawer owns every key while it is up.
        if (typeof value === "string" && fader && menu.open) {
          const result = faderKeyPress(
            fader,
            menu.faderFields(menuContext()),
            value,
            faderKeyOptions(),
          );
          if (result.type !== "pass") {
            faderOutcome(result);
            refreshMenu();
            tick(true);
            continue;
          }
        }
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
            else if (result.type === "fader") openFader(result.label);
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
            .catch((error: unknown) => transportFailed(error))
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
          } else if (
            action?.kind === "submit" &&
            action.value &&
            agentTurn &&
            routeDuringTurn(action.value, parsesLocally) === "local"
          ) {
            // A typed command never waits on the agent: it commits its own
            // revision now, and the agent's next call re-reads the score.
            const value = action.value;
            void runLocalBesideAgent(value).finally(() => tick(true));
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
    stdout.off("resize", onResize);
    // The terminal first: a teardown step that throws (a read-only .dawg,
    // a dead engine) must not leave the shell on the alternate screen.
    restoreTerminal();
    stdin.pause();
    console.error = consoleError;
    console.warn = consoleWarn;
    process.off("warning", onWarning);
    unwatchActivity();
    // Each step on its own: one failure does not skip the rest.
    const failures: unknown[] = [];
    const steps: Array<() => unknown> = [
      () => projectSync?.stop(),
      () => namer.dispose(),
      () => unsubscribe(),
      () => play?.exit(),
      () => monitorEngine?.dispose(),
      () => audio.stop(),
      () => port.close(),
    ];
    for (const step of steps) {
      try {
        await step();
      } catch (error) {
        failures.push(error);
      }
    }
    process.off("unhandledRejection", onRejection);
    process.off("uncaughtException", onUncaught);
    if (failures.length > 0) throw failures[0];
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
    // The panel's inner width (tui/app.ts paintText): rows clip there with
    // an ellipsis, the same as every other panel.
    const columns = stdout.columns ?? 80;
    const lines = helpTopicLines(
      topic,
      Math.max(10, columns - (columns >= 60 ? 8 : 4)),
    );
    if (!lines) return fail(helpMiss(topic!));
    tui.openText(helpTitle(topic), lines);
    return ok(topic ? helpTitle(topic) : "help · help all for every command");
  }
  if (/^\/?tracks$/i.test(command)) {
    const problems = await sampleProblems(score);
    const items = score.tracks.map((track) => {
      const voices = track.sampler
        ? Object.keys(track.sampler.voices).length
        : 0;
      const missing = problems.filter(
        (problem) => problem.trackId === track.id && problem.level === "error",
      ).length;
      const samples = track.sampler
        ? ` · ${voices} sample${voices === 1 ? "" : "s"}${missing ? ` · ${missing} missing` : ""}`
        : "";
      return {
        label: track.id,
        value: `/track ${track.id}`,
        detail: `${track.instrument}${samples}${track.muted ? " · muted" : ""}${track.solo ? " · solo" : ""}`,
        current: track.id === requestedTrack,
      };
    });
    // A picker: Enter (or a click) focuses the track; Esc closes.
    tui.openPicker({
      id: "tracks",
      title: "tracks · ● focused",
      items,
      filterable: items.length > 8,
      index: Math.max(
        0,
        items.findIndex((item) => item.current),
      ),
    });
    return ok(`${items.length} track${items.length === 1 ? "" : "s"}`);
  }
  const playCommand = command.match(
    /^\/play(?:\s+(on|off|degrees|in-key|chromatic))?$/i,
  );
  if (playCommand) {
    const wanted = playCommand[1]?.toLowerCase();
    if (wanted === "off" || (wanted === undefined && play?.on))
      return exitPlay();
    if (wanted && wanted !== "on") {
      const message = playSession().toggleDegrees(wanted !== "chromatic");
      if (message.startsWith("scale degrees need")) return fail(message);
      const entered = await enterPlay();
      return entered.ok ? ok(message) : entered;
    }
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
    const result = applyChordsCommand(
      chordSettings,
      chordsCommand[1] ?? "",
      score.tempoBpm,
    );
    return result.ok ? ok(result.message) : fail(result.message);
  }
  const showMeCommand = command.match(/^\/show-?me(?:\s+(\S+))?$/i);
  if (showMeCommand) {
    if (!showMeCommand[1])
      return ok(`show me · ${showMe.level} · /showme on|quiet|off`);
    const level = parseShowMe(showMeCommand[1]);
    if (!level) return fail("usage · /showme on|quiet|off");
    showMe.level = level;
    void writeConfig({ dir: configDir() }, { showMe: level }).catch(
      () => undefined,
    );
    return ok(
      level === "off"
        ? "show me off · the agent edits with tools"
        : level === "quiet"
          ? "show me quiet · the agent types commands, no captions"
          : "show me on · the agent types commands, slides faders, plays keys",
    );
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
  // A bare parameter (`volume`, `pan`, `fx filter`, `fx reverb mix`)
  // opens the fader drawer on it, with its related params stacked below.
  if (/^\/?(?:volume|pan|fx\s+\S+(?:\s+\S+)?)$/i.test(command)) {
    const label = menu.showFader(menuContext(), command);
    if (label) {
      openFader(label, true);
      refreshMenu();
      return ok(`${label} · ←→ adjust · enter keep · esc revert`);
    }
  }
  const menuCommand = command.match(/^\/menu(?:\s+(\S+))?$/i);
  if (menuCommand) {
    const section = menuCommand[1]?.toLowerCase();
    if (section && !(MENU_SECTIONS as readonly string[]).includes(section))
      return fail(`usage · /menu [${MENU_SHOWN_SECTIONS.join("|")}]`);
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
  // `track cloud grain hold`: focus (or create) a track and grain it.
  const grainTrack = command.match(
    /^\/?track\s+([a-z0-9._-]{1,64})\s+(grain\s+.+)$/i,
  );
  if (grainTrack && parseGranularCommand(grainTrack[2]!)) {
    const focused = await focusTrack(grainTrack[1]!.toLowerCase());
    if (requestedTrack !== grainTrack[1]!.toLowerCase()) return focused;
    return submit(grainTrack[2]!);
  }
  // `/track rm <name>` (aliases remove, delete) and `/track move <name>
  // <position>`: the human surface for the removeTrack and moveTrack
  // operations. Removing a track also drops any vocoder src or autotune from
  // that named it; ^z brings everything back.
  const trackEdit = command.match(
    /^\/?track\s+(rm|remove|delete|move)\s+(.{1,64}?)\s*$/i,
  );
  if (trackEdit) {
    const verb = trackEdit[1]!.toLowerCase() === "move" ? "move" : "rm";
    let rest = trackEdit[2]!.trim();
    let position: number | undefined;
    if (verb === "move") {
      const tail = rest.match(/^(.+?)\s+(\d{1,3})$/);
      if (!tail)
        return fail(`usage · /track move <name> <1..${score.tracks.length}>`);
      rest = tail[1]!;
      position = Number(tail[2]);
    }
    const wanted = rest
      .replace(/^["']|["']$/g, "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
    const found = score.tracks.find(
      (track) =>
        track.id.toLowerCase() === wanted ||
        track.id.toLowerCase() === wanted.replace(/ /g, "-") ||
        (track.name ?? "").toLowerCase() === wanted,
    );
    if (!found) return fail(`no track ${rest} · /tracks lists them`);
    if (verb === "move") {
      if (position! < 1 || position! > score.tracks.length)
        return fail(`usage · /track move <name> <1..${score.tracks.length}>`);
      const next = applyScoreOperation(score, {
        type: "moveTrack",
        trackId: found.id,
        index: position! - 1,
      });
      await commitScore(next, "track.move", { trackId: found.id });
      await projectSync?.flushScore();
      return ok(`moved ${found.id} to position ${position}`);
    }
    if (score.tracks.length <= 1)
      return fail("the last track stays · /clear empties it");
    const next = applyScoreOperation(score, {
      type: "removeTrack",
      trackId: found.id,
    });
    const dropped = score.tracks
      .filter((track) => track.id !== found.id)
      .filter((track) => {
        const after = next.tracks.find((t) => t.id === track.id);
        return (
          (track.vocoder?.src !== undefined &&
            after?.vocoder?.src === undefined) ||
          (track.autotune?.from !== undefined &&
            after?.autotune?.from === undefined)
        );
      })
      .map((track) => track.id);
    await commitScore(next, "track.remove", { trackId: found.id });
    await projectSync?.flushScore();
    if (found.id === requestedTrack) await focusTrack(next.tracks[0]!.id);
    return ok(
      `removed ${found.id}${dropped.length ? ` · dropped references on ${dropped.join(", ")}` : ""} · ctrl-z undoes`,
    );
  }
  // `/track piano b`: a name with spaces focuses the track of that name, or
  // creates `piano-b` named "piano b".
  const namedTrack = command.match(/^\/track\s+([a-z0-9._ -]{1,64})$/i);
  if (namedTrack) {
    const name = namedTrack[1]!.trim().replace(/\s+/g, " ");
    const found = score.tracks.find(
      (track) => (track.name ?? track.id).toLowerCase() === name.toLowerCase(),
    );
    return focusTrack(found?.id ?? name.toLowerCase().replace(/ /g, "-"));
  }
  const sample = parseSampleCommand(command);
  if (sample) return sampleCommand(sample);
  const fit = parseFitCommand(command);
  if (fit) return fitCommand(fit);
  const shift = parseShiftCommand(command);
  if (shift) {
    const result = applyShiftCommand(score, requestedTrack, shift);
    if (!result.ok) return fail(result.message);
    await commitScore(result.next, "sample.set", { trackId: requestedTrack });
    await projectSync?.flushScore();
    return ok(result.message);
  }
  const resample = parseResampleCommand(command);
  if (resample) return resampleCommand(resample);
  // 0.7 clips: `/clip` edits and `/lyrics` on the focused track.
  const clipCommand = parseClipCommand(command);
  if (clipCommand) {
    if ("error" in clipCommand) return fail(clipCommand.error);
    const result = await runClipCommand(clipCommand, {
      score,
      trackId: requestedTrack,
      cwd: process.cwd(),
    });
    if (!result.ok) return fail(result.message);
    if (result.next && result.kind) {
      await commitScore(result.next, result.kind, {
        trackId: requestedTrack,
        ...result.payload,
      });
      await projectSync?.flushScore();
    }
    return ok(result.message);
  }
  const lyricsCommand = parseLyricsCommand(command);
  if (lyricsCommand) {
    const result = applyLyrics(score, requestedTrack, lyricsCommand);
    if (!result.ok) return fail(result.message);
    if (result.next && result.kind) {
      await commitScore(result.next, result.kind, {
        trackId: requestedTrack,
        ...result.payload,
      });
      await projectSync?.flushScore();
    }
    return ok(result.message);
  }
  // 0.7 autotune: `/autotune …` (and `/tune <preset>` pointing here).
  // `/vocal autotune …` takes the same path (presets panel, draft, commit).
  const autotune = parseAutotuneCommand(
    command.replace(/^\/?vocal\s+(?=autotune\b)/i, ""),
  );
  if (autotune) {
    if (autotune.type === "autotune-list")
      tui.openText("autotune presets", autotuneListLines());
    if (autotune.type !== "autotune-usage" && autotune.type !== "autotune-list")
      await materializeDraft();
    const result = applyAutotuneCommand(score, requestedTrack, autotune);
    if (result.next && result.kind)
      await commitScore(result.next, result.kind, result.payload);
    return result.ok ? ok(result.message) : fail(result.message);
  }
  // 0.7 Voice: `/vocal <verb>`; lanes register verbs in VOCAL_VERBS.
  setClipImportDeps({
    media: {
      ...mediaServices(),
      signal: new AbortController().signal,
      progress: () => undefined,
    },
  });
  const vocal = parseVocalCommand(command);
  if (vocal) {
    if (vocal.kind === "verb") await materializeDraft();
    const result = await runVocalCommand(vocal, {
      score,
      trackId: requestedTrack,
      cwd: process.cwd(),
    });
    if (!result.ok) return fail(result.message);
    if (result.next && result.kind) {
      await commitScore(result.next, result.kind, {
        trackId: requestedTrack,
        ...result.payload,
      });
      await projectSync?.flushScore();
    }
    // A verb that made or chose another track (a vocoder carrier): focus it.
    if (result.trackId && result.trackId !== requestedTrack) {
      await port.focus(result.trackId);
      requestedTrack = result.trackId;
    }
    return ok(result.message);
  }
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
  const guitar = parseGuitarCommand(command);
  if (guitar) {
    if (guitar.type !== "guitar-show" && guitar.type !== "guitar-hint")
      await materializeDraft();
    const result = applyGuitarCommand(score, requestedTrack, guitar);
    if (result.next && result.kind)
      await commitScore(result.next, result.kind, result.payload);
    return result.ok ? ok(result.message) : fail(result.message);
  }
  const progression = parseProgressionCommand(command);
  if (progression) {
    if (progression.type === "progression") await materializeDraft();
    const result = applyProgressionCommand(
      score,
      requestedTrack,
      progression,
      () => randomUUID().slice(0, 12),
    );
    if (result.next && result.kind)
      await commitScore(result.next, result.kind, result.payload);
    return result.ok ? ok(result.message) : fail(result.message);
  }
  const strum = parseStrumCommand(command);
  if (strum) {
    if (strum.type === "strum") await materializeDraft();
    const result = applyStrumCommand(score, requestedTrack, strum, () =>
      randomUUID().slice(0, 12),
    );
    if (result.next && result.kind)
      await commitScore(result.next, result.kind, result.payload);
    return result.ok ? ok(result.message) : fail(result.message);
  }
  const rig = parseRigCommand(command);
  if (rig) {
    if (rig.type !== "rig-show" && rig.type !== "rig-hint")
      await materializeDraft();
    const result = applyRigCommand(score, requestedTrack, rig);
    if (result.next && result.kind)
      await commitScore(result.next, result.kind, result.payload);
    return result.ok ? ok(result.message) : fail(result.message);
  }
  // 0.7 `/formant` and `/vowel`: short forms of `fx formant|vowel`.
  const formant = parseFormantCommand(command) ?? parseVowelCommand(command);
  if (formant) {
    if (formant.type === "fx") await materializeDraft();
    const result = applyFormantCommand(score, requestedTrack, formant);
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
  const unknownFx = unknownFxMessage(command);
  if (unknownFx) return fail(unknownFx);
  const expression = parseExpressionCommand(command);
  if (expression) {
    if (expression.type !== "show" && expression.type !== "invalid")
      await materializeDraft();
    const result = applyExpressionCommand(score, requestedTrack, expression);
    if (result.next && result.kind)
      await commitScore(result.next, result.kind, result.payload);
    return result.ok ? ok(result.message) : fail(result.message);
  }
  const tuning = parseTuningCommand(command);
  if (tuning) return tuningCommand(tuning);
  const calibration = parseCalibrationCommand(command);
  if (calibration) {
    const result = applyCalibrationCommand(score, calibration);
    if (result.next && result.kind)
      await commitScore(result.next, result.kind, result.payload);
    return result.ok ? ok(result.message) : fail(result.message);
  }
  const keysCommand = parseKeysCommand(command);
  if (keysCommand) {
    const reads =
      keysCommand.type === "keys-list" || keysCommand.type === "keys-presets";
    if (!reads) await materializeDraft();
    const result = applyKeysCommand(score, requestedTrack, keysCommand);
    if (result.next && result.kind)
      await commitScore(result.next, result.kind, result.payload);
    return result.ok ? ok(result.message) : fail(result.message);
  }
  const modal = parseModalCommand(command);
  if (modal) {
    if (modal.type === "modal-list")
      tui.openText("modal presets", modalListLines());
    if (modal.type !== "modal-show" && modal.type !== "modal-list")
      await materializeDraft();
    const result = applyModalCommand(score, requestedTrack, modal);
    if (result.next && result.kind)
      await commitScore(result.next, result.kind, result.payload);
    return result.ok ? ok(result.message) : fail(result.message);
  }
  const vocoderCommand = parseVocoderCommand(command);
  if (vocoderCommand) {
    if (vocoderCommand.type === "vocoder-list")
      tui.openText("vocoder presets", vocoderListLines());
    if (
      vocoderCommand.type !== "vocoder-list" &&
      vocoderCommand.type !== "vocoder-usage"
    )
      await materializeDraft();
    const result = applyVocoderCommand(score, requestedTrack, vocoderCommand);
    if (result.next && result.kind)
      await commitScore(result.next, result.kind, result.payload);
    // `/vocoder` on a vocal makes a carrier track: focus it.
    if (result.trackId && result.trackId !== requestedTrack) {
      await port.focus(result.trackId);
      requestedTrack = result.trackId;
    }
    return result.ok ? ok(result.message) : fail(result.message);
  }
  const windCommand = parseWindCommand(command);
  if (windCommand) {
    if (windCommand.type === "wind-list")
      tui.openText("wind presets", windListLines());
    if (windCommand.type !== "wind-show" && windCommand.type !== "wind-list")
      await materializeDraft();
    const result = applyWindCommand(score, requestedTrack, windCommand);
    if (result.next && result.kind)
      await commitScore(result.next, result.kind, result.payload);
    return result.ok ? ok(result.message) : fail(result.message);
  }
  const singCommand = parseSingCommand(command);
  if (singCommand) {
    if (singCommand.type === "sing-list")
      tui.openText("sing presets", singListLines());
    if (singCommand.type !== "sing-show" && singCommand.type !== "sing-list")
      await materializeDraft();
    const result = applySingCommand(score, requestedTrack, singCommand);
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
  const stringCommand = parseStringCommand(command);
  if (stringCommand) {
    if (
      stringCommand.type !== "string-list" &&
      stringCommand.type !== "string-presets"
    )
      await materializeDraft();
    const result = applyStringCommand(score, requestedTrack, stringCommand);
    if (result.next && result.kind)
      await commitScore(result.next, result.kind, result.payload);
    return result.ok ? ok(result.message) : fail(result.message);
  }
  const grainHint = grainSrcHint(command);
  if (grainHint) return fail(grainHint);
  const grain = parseGranularCommand(command);
  if (grain) {
    if (grain.type !== "grain-list" && grain.type !== "grain-presets")
      await materializeDraft();
    const result = applyGranularCommand(score, requestedTrack, grain);
    if (result.next && result.kind)
      await commitScore(result.next, result.kind, result.payload);
    return result.ok ? ok(result.message) : fail(result.message);
  }
  const styleCommand = parseStyleCommand(command);
  if (styleCommand) {
    const writes =
      styleCommand.type === "style-apply" ||
      styleCommand.type === "style-again";
    if (writes) await materializeDraft();
    const result = applyStyleCommand(score, styleCommand);
    if (result.next && result.kind)
      await commitScore(result.next, result.kind, result.payload);
    if (result.log) tui.activity.pushNote(result.log);
    return result.ok ? ok(result.message) : fail(result.message);
  }
  const masterCommand = parseMasterCommand(command);
  if (masterCommand) {
    if (masterCommand.type === "master-measure")
      return ok(await measureLine(score));
    if (
      masterCommand.type !== "master-list" &&
      masterCommand.type !== "master-show"
    )
      await materializeDraft();
    const result = applyMasterCommand(score, masterCommand);
    if (result.next && result.kind)
      await commitScore(result.next, result.kind, result.payload);
    return result.ok ? ok(result.message) : fail(result.message);
  }
  const arrange = parseSectionCommand(command, score);
  if (arrange) {
    const reads =
      arrange.type === "section-list" ||
      arrange.type === "section-unknown" ||
      arrange.type === "form-show" ||
      arrange.type === "section-jump";
    if (!reads) await materializeDraft();
    const result = applySectionCommand(score, requestedTrack, arrange);
    if (result.next && result.kind)
      await commitScore(result.next, result.kind, result.payload);
    if (result.seekBeat !== undefined) await seekTransport(result.seekBeat);
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
      await writeFile(path, scoreToMidi(exportScore(score)));
      return `exported midi · ${exportCommand[1]}`;
    }
    // Audio comes from the offline renderer, never JSON under an audio name.
    if (/\.(wav|aiff?|flac|mp3|ogg|m4a)$/i.test(path))
      return fail(
        `/export writes .track.json or .mid · render audio with: dawg render ${exportCommand[1]}`,
      );
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
      ? "no agent key · model key adds one · direct commands still work"
      : `agent key · ${providerName}`;
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
  // `/instrument aah` is `instrument aah`; `instrument sing choir` is
  // `instrument choir`.
  const singWord = command.match(/^\/?instrument\s+sing\s+([a-z]+)$/i);
  if (singWord && isSingWord(singWord[1]!.toLowerCase()))
    return submit(`instrument ${singWord[1]!.toLowerCase()}`);
  if (/^\/instrument\s/i.test(command) && parsePrompt(command.slice(1)))
    return submit(command.slice(1));
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
    // A bare `bpm <n>` stays song tempo; on a sampler track say where the
    // sample's own tempo lives (`/bpm`, 0.6 fit).
    const focused = next.tracks.find((t) => t.id === requestedTrack);
    const samplerHint =
      /^\s*bpm\b/i.test(prompt) &&
      focused?.sampler &&
      isSamplerInstrument(focused.instrument)
        ? ` · song tempo · the sample's own tempo is /bpm ${parsed.tempoBpm}`
        : "";
    return `tempo · ${next.tempoBpm} BPM${samplerHint}`;
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
    // An unknown word would store and play a plain sine: say so instead.
    const word = parsed.patch.instrument;
    if (word !== undefined && isUnknownInstrument(word)) {
      const advice = plainSineAdvice(word) ?? "";
      const near = advice.match(/did you mean (\S+)\?/)?.[1];
      return fail(
        `instrument ${truncateForCard(word)} · not a dawg instrument${near ? ` · did you mean ${near}?` : ""} · /menu sounds lists them`,
      );
    }
    // `instrument jangle`: a guitar alias also loads its rig.
    const rigged = parsed.word
      ? {
          ...parsed.patch,
          ...rigWordPatch(
            parsed.word,
            score.tracks.find((t) => t.id === requestedTrack)?.fx,
          ),
        }
      : parsed.patch;
    // `instrument vocal` (0.7): the vocal chain fills unset effects.
    const chain = isGuideInstrument(parsed.patch.instrument)
      ? vocalChainPatch(score.tracks.find((t) => t.id === requestedTrack))
      : {};
    const patch = { ...chain, ...rigged };
    const next = applyScoreOperation(score, {
      type: "updateTrack",
      trackId: requestedTrack,
      patch,
    });
    await commitScore(next, "score.track", {
      trackId: requestedTrack,
      patch,
    });
    // Plain `marimba` keeps the legacy tone; point at the mallet engine.
    if (parsed.patch.instrument === "marimba" && !("modal" in parsed.patch))
      return `track · ${requestedTrack} · marimba (legacy tone) · modal marimba for the mallet engine`;
    // Plain `wind` keeps the legacy tone; point at the wind engine.
    if (parsed.patch.instrument === "wind" && !("wind" in parsed.patch))
      return `track · ${requestedTrack} · wind (legacy tone) · wind flute (or sax, trumpet …) for the wind engine`;
    const sine =
      word !== undefined && !("string" in parsed.patch)
        ? plainSineAdvice(word)
        : undefined;
    if (sine) return `track · ${requestedTrack} · ${sine}`;
    const added = [
      chain.filter ? "hpf 90 Hz" : "",
      chain.fx?.compressor ? "compressor 3:1" : "",
      chain.reverb ? "plate 0.14" : "",
    ].filter(Boolean);
    if (added.length)
      return `track · ${requestedTrack} · vocal · added ${added.join(", ")} · fx … off to remove`;
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
      ...(typeof parsed.patch.cents === "number"
        ? { cents: parsed.patch.cents }
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
      ...(parsed.cents ? { cents: parsed.cents } : {}),
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
  const existing = score.tracks.find((track) => track.id === trackId);
  const exists = existing !== undefined;
  // `track cloud`, `track hold-2`: a new granular track with that preset.
  const grainPreset = granularTrackPreset(trackId);
  if (!exists) {
    const next = applyScoreOperation(score, {
      type: "addTrack",
      track: {
        id: trackId,
        name: trackId,
        instrument: grainPreset
          ? "granular"
          : isDrumInstrument(trackId)
            ? "kit"
            : "sine",
        // `track jangle`, `track gtr-metal`…: a guitar voice and its rig.
        ...rigTrackFields(trackId),
        ...(grainPreset ? { granular: { preset: grainPreset } } : {}),
        // `/track piano` (or grand, felt…) starts on the modelled piano.
        ...newPianoTrack(trackId),
        // `track vibes`: a 0.6 modal word names the track and its preset.
        ...(isModalWord(trackId) ? instrumentPatchForWord(trackId) : {}),
        // `track vocal` (0.7): a clip track with the vocal chain.
        ...(isGuideInstrument(trackId)
          ? { instrument: "vocal", ...vocalChainPatch(undefined) }
          : {}),
      },
    });
    await commitScore(next, "track.create", { trackId });
  }
  await port.focus(trackId);
  requestedTrack = trackId;
  draftTrack = false;
  if (exists && grainPreset && existing.instrument !== "granular")
    return warn(
      `track · ${trackId} is a ${existing.instrument} track · grain ${grainPreset} makes it granular`,
    );
  return ok(
    exists
      ? `track · ${trackId}`
      : grainPreset
        ? `track created · ${trackId} · granular ${grainPreset} · nothing to download`
        : `track created · ${trackId}`,
  );
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

/** `/tuning …` and `/scale …` (src/commands/tuning.ts). */
async function tuningCommand(command: TuningCommand): Promise<Receipt> {
  const projectRoot = process.cwd();
  if (command.type === "tuning-set") {
    // Scala files outside the project are copied into tunings/ first.
    try {
      const patch = { ...command.patch };
      if (patch.scl)
        patch.scl = await importTuningFile(projectRoot, projectRoot, patch.scl);
      if (patch.kbm)
        patch.kbm = await importTuningFile(projectRoot, projectRoot, patch.kbm);
      command = { ...command, patch };
    } catch (error) {
      if (error instanceof TuningError)
        return fail(`tuning · ${error.message}`);
      throw error;
    }
  }
  if (command.type === "tuning-set" || command.type === "tuning-off")
    if (command.target === "track") await materializeDraft();
  const read = (path: string): string | undefined => {
    try {
      return readFileSync(join(projectRoot, path), "utf8");
    } catch {
      return undefined;
    }
  };
  const result = applyTuningCommand(score, requestedTrack, command, read);
  if (result.panel) tui.openText(result.panel.title, result.panel.lines);
  if (result.next && result.kind)
    await commitScore(result.next, result.kind, result.payload);
  return result.ok ? ok(result.message) : fail(result.message);
}

/** `/fitmode`, `/bpm`, `/len` on the focused sampler voice (0.6). */
async function fitCommand(
  command: NonNullable<ReturnType<typeof parseFitCommand>>,
): Promise<Receipt> {
  let suggested: "beats" | "tones" | undefined;
  if (command.control === "fitmode" && command.value === undefined) {
    const target = fitVoice(score, requestedTrack, command.voice);
    if ("error" in target) return fail(target.error);
    const decoded = liveSampleBank?.voices.get(
      sampleKey(requestedTrack, target.voice),
    );
    if (!decoded)
      return warn(
        "fit · the sample is still loading · fitmode repitch|beats|tones",
      );
    suggested = suggestFitMode(decoded.mono, decoded.sampleRate);
  }
  const result = applyFitCommand(score, requestedTrack, command, suggested);
  if (!result.ok) return fail(result.message);
  await commitScore(result.next, "sample.set", { trackId: requestedTrack });
  await projectSync?.flushScore();
  return ok(
    suggested
      ? `${result.message} · suggested from the sound (${suggested === "beats" ? "hits" : "held tones"})`
      : result.message,
  );
}

async function resampleCommand(
  command: NonNullable<ReturnType<typeof parseResampleCommand>>,
): Promise<Receipt> {
  await materializeDraft();
  // The source's own samples must be loaded for the render.
  if (hasSamplerTracks(score)) await sampleProblems(score);
  const result = await runResample({
    projectRoot: process.cwd(),
    score,
    command,
    ...(liveSampleBank ? { samples: liveSampleBank } : {}),
  });
  if (!result.ok) return fail(result.message);
  const problems = (await sampleProblems(result.next)).filter(
    (problem) =>
      problem.trackId === result.trackId && problem.level === "error",
  );
  if (problems.length > 0) return fail(`resample · ${problems[0]!.message}`);
  await commitScore(result.next, "resample", {
    trackId: result.trackId,
    src: result.src,
    sha256: result.sha256,
  });
  await port.focus(result.trackId);
  requestedTrack = result.trackId;
  draftTrack = false;
  await projectSync?.flushScore();
  return ok(result.message);
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
        const c = await pruneAnalysisCache(
          analysisDir(process.cwd()),
          to(ANALYSIS_CACHE_BYTES),
        );
        freed = {
          files: a.removed + b.removed + c.removed,
          bytes: a.freed + b.freed + c.freed,
        };
      }
      const lines = cacheLines({
        packs: await packs().cacheStatus(),
        assets: await library.cacheStatus(),
        analysis: await analysisCacheStatus(process.cwd()),
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
    // The auto-name joins the receipt that earned it, as a quiet suffix.
    if (meta.nameSource === "auto")
      tui.activity.attachNote(`named “${meta.name}” · /rename`);
    else tui.activity.pushCard(`session · ${meta.name}`, { tone: "info" });
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
    showMe: showMe.level,
    chords: stagedChordSettings() ?? session?.chords.settings ?? chordSettings,
    projectRoot: process.cwd(),
  };
}

/** The screen `?` describes, or undefined while `?` is typed text. */
function keysScreen(): readonly KeySection[] | undefined {
  if (euclid.open) return euclid.typing ? undefined : KEYS.euclid;
  if (fader && menu.open)
    return fader.typing !== undefined ? undefined : KEYS.fader;
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
      // The last loop the engine played is the song's when a loop starts.
      masterGainDb: () =>
        score.master?.target === undefined
          ? undefined
          : previewEngine().loudness?.gainDb,
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
    applyChordsCommand(
      settings,
      command.match(CHORDS_COMMAND)![1]!,
      score.tempoBpm,
    );
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
    const result = applyChordsCommand(
      { ...chordSettings },
      chords[1]!,
      base.tempoBpm,
    );
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
    applyChordsCommand(
      chordSettings,
      command.match(CHORDS_COMMAND)![1]!,
      score.tempoBpm,
    );
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
  if (!menu.open) {
    closeFader();
    return;
  }
  if (tui.ui.overlay !== undefined && tui.ui.picker?.id !== "menu") {
    // Another overlay (help, a picker) replaced the menu.
    menu.close();
    leaveAuditionScreen();
    return;
  }
  const context = menuContext();
  if (fader) {
    const fields = menu.faderFields(context);
    if (fields.length === 0) closeFader();
    else
      tui.drawer = drawerView(fader, fields, menu.faderCommitted(context), {
        title: menu.crumbs,
        dirty: context.audition?.dirty ?? false,
        status: context.audition?.status,
      });
  }
  const view = menu.view(context);
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

// ── the fader drawer ─────────────────────────────────────────────────

/** Enter on a number row (or a bare `volume`, `fx filter`): the drawer. */
/**
 * Open the drawer on `label`. `standalone` drawers came from a command or a
 * click, not from inside the menu, so closing one closes the menu too.
 */
function openFader(label: string, standalone = false): void {
  fader = { label };
  faderStandalone = standalone;
  const loop = auditionController();
  if (!loop.dirtyEdits) loop.committedNow(score);
}

function closeFader(): void {
  fader = undefined;
  tui.drawer = undefined;
  if (faderStandalone && menu.open) {
    faderStandalone = false;
    menu.close();
    tui.closePicker();
    stopAuditionLoop();
  }
  faderStandalone = false;
}

function faderKeyOptions(): { dirty: boolean; audition: boolean } {
  return { dirty: auditionLoop?.dirtyEdits ?? false, audition: true };
}

/**
 * Act on a drawer result. A set stages on the audition loop, filed under
 * its field so every nudge replaces the last: the piano roll (and the loop,
 * when it plays) follows at once, and Enter keeps them all as one revision.
 * A setting the loop cannot stage (tempo, loop length) applies directly.
 */
function faderOutcome(result: FaderResult): void {
  if (result.type === "set") {
    if (!stageableNow(result.command)) {
      runPromptLater(result.command);
      return;
    }
    const loop = auditionController();
    if (!loop.dirtyEdits) loop.committedNow(score);
    const seq = (faderSeq.get(result.key) ?? 0) + 1;
    faderSeq.set(result.key, seq);
    void loop
      .stage(result.command, {
        replaceKey: result.key,
        superseded: () => faderSeq.get(result.key) !== seq,
      })
      .then((outcome) => {
        if (!outcome.ok && outcome.message !== SUPERSEDED)
          tui.activity.pushCard(outcome.message, {
            tone: outcome.message.includes("failed") ? "error" : "warning",
          });
        requestFrame();
      });
  } else if (result.type === "keep") {
    closeFader();
    void keepStaged()
      .then((outcome) => receipt(outcome))
      .catch((error) => tui.activity.pushError(describeError("keep", error)))
      .finally(() => requestFrame());
  } else if (result.type === "revert") {
    revertStaged();
    closeFader();
  } else if (result.type === "close") closeFader();
  else if (result.type === "audition") auditionKeyPressed(result.key);
}

// ── the mouse ────────────────────────────────────────────────────────

/**
 * One mouse report, hit-tested against the regions the last frame painted.
 * Acts directly (a fader, the transport) or returns keys to run through the
 * ordinary key path (a list row is Enter, a wheel notch is an arrow).
 */
function mouseInput(event: MouseEvent): string[] {
  const frame = tui.frame;
  if (!frame) return [];
  const target = frame.hits.at(event.x, event.y)?.target;
  if (event.kind === "wheel") {
    const fields = fader && menu.open ? menu.faderFields(menuContext()) : [];
    if (
      fader &&
      target &&
      (target.kind === "fader-bar" ||
        target.kind === "fader-row" ||
        target.kind === "fader-step" ||
        target.kind === "fader-option")
    ) {
      // Wheel up raises the value under the pointer.
      faderOutcome(
        faderStep(
          fader,
          fields[target.field],
          event.delta < 0 ? 1 : -1,
          event.shift ? "coarse" : "normal",
        ),
      );
      refreshMenu();
      return [];
    }
    if (fader) return [];
    if (tui.ui.overlay) return [event.delta < 0 ? KEY_UP : KEY_DOWN];
    return [];
  }
  // A drag keeps moving the fader it started on, even past the bar's ends.
  if (event.kind === "drag" && event.button === "left" && fader && dragging) {
    const fields = menu.faderFields(menuContext());
    faderOutcome(
      faderSetPosition(
        fader,
        fields[dragging.field],
        (event.x - dragging.left) / Math.max(1, dragging.width - 1),
      ),
    );
    refreshMenu();
    return [];
  }
  if (event.kind === "up") {
    dragging = undefined;
    return [];
  }
  if (event.kind !== "down" || event.button !== "left" || !target) return [];
  if (fader && menu.open) {
    const fields = menu.faderFields(menuContext());
    let result: FaderResult | undefined;
    switch (target.kind) {
      case "fader-step":
        result = faderStep(
          fader,
          fields[target.field],
          target.direction,
          event.shift ? "coarse" : "normal",
        );
        break;
      case "fader-bar":
        dragging = target;
        result = faderSetPosition(
          fader,
          fields[target.field],
          (event.x - target.left) / Math.max(1, target.width - 1),
        );
        break;
      case "fader-option":
        result = faderChoose(fader, fields[target.field], target.option);
        break;
      case "fader-row": {
        const field = fields[target.field];
        if (field) {
          fader.label = field.label;
          fader.typing = undefined;
        }
        result = { type: "handled" };
        break;
      }
      case "fader-keep":
        result = auditionLoop?.dirtyEdits
          ? { type: "keep" }
          : { type: "close" };
        break;
      case "fader-revert":
        result = auditionLoop?.dirtyEdits
          ? { type: "revert" }
          : { type: "close" };
        break;
      default:
        break;
    }
    if (result) {
      faderOutcome(result);
      refreshMenu();
      return [];
    }
  }
  switch (target.kind) {
    case "picker-row": {
      const picker = tui.ui.picker;
      if (!picker) return [];
      if (picker.id === "menu" && menu.open) {
        // The first click selects a row; a click on the selected row opens it.
        const again = menu.index === target.index;
        menu.select(menuContext(), target.index);
        refreshMenu();
        return again ? ["\r"] : [];
      }
      const again = picker.index === target.index;
      picker.index = target.index;
      picker.filtering = false;
      return again ? ["\r"] : [];
    }
    case "transport":
      if (tui.ui.overlay) return [];
      void toggleTransport()
        .catch((error: unknown) => transportFailed(error))
        .finally(() => requestFrame());
      return [];
    case "tracks":
      if (tui.ui.overlay) return [];
      runPromptLater("/tracks");
      return [];
    case "model":
      if (tui.ui.overlay) return [];
      runPromptLater("/model");
      return [];
    default:
      return [];
  }
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
          transportFailed(error),
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
    scoreBeat: (beat: number) => scoreBeatAt(score, beat),
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
    // The files belong to one session at a time; another session's window
    // stays detached instead of reprinting over them.
    sessionId: () => record.sessionId,
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

/** Space, the menu and a header click all report a failed toggle the same way. */
function transportFailed(error: unknown): void {
  tui.activity.pushCard(
    `transport failed · ${error instanceof Error ? error.message : String(error)}`,
    { tone: "error" },
  );
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

/** Move the playhead to transport `beat`, playing or not (section jump). */
async function seekTransport(beat: number): Promise<void> {
  if (port.mode === "daemon") {
    await port.transport("seek", { beat });
    return;
  }
  const now = Date.now();
  clock.sync(beat, clock.playing, now, now);
  if (clock.playing) await audio.play(score, clock.beatAt());
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
  // The turn ends on one musical receipt of what it changed.
  const before = score;
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
        if (event.type === "done")
          tui.activity.setTurnReceipt(musicalReceipt(before, score));
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
      reason: "provider unavailable; run `dawg model key`",
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
      tui.activity.pushCard(`agent key stopped working · ${selection.reason}`, {
        tone: "warning",
        hint: "/model key",
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
 * `master measure`: render the song as the loop that plays and measure
 * loudness, peaks and balance at the export rate. The render, master and
 * meter run in a worker (`measureScoreOffThread`), so the header, input and
 * playback keep going on a long loop.
 */
async function measureLine(value: TrackScore): Promise<string> {
  await sampleProblems(value);
  tui.activity.setSpinner("measuring");
  try {
    const measured = await measureScoreOffThread(value, {
      projectRoot: process.cwd(),
    });
    return `master measure · ${measurementLine(measured.mix, measured.master)} · ${measured.sampleRate / 1000} kHz`;
  } finally {
    tui.activity.setSpinner(undefined);
  }
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
    // Off the UI thread, at the export rate (see measureLine).
    measure: async (value, options) => {
      await sampleProblems(value);
      return measureScoreOffThread(value, {
        projectRoot: process.cwd(),
        ...(options?.sampleRate === undefined
          ? {}
          : { sampleRate: options.sampleRate }),
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

// ── show-me ──────────────────────────────────────────────────────────

/**
 * Show-me (docs/show-me.md): with an API provider the agent writes prompt
 * commands, streamed. The line being written is ghost text in the empty
 * prompt bar at the model's own speed; each complete line runs through
 * `submit()`, the path a typed Enter takes, at once. A parameter value
 * glides there over ~150 ms while the loop plays (you hear it), notes and
 * hits sound as they arrive (in time when the stream is ahead of the tempo,
 * as step entry when it is behind), and the caption names the key or fader
 * a person would use. Nothing waits for the turn to end.
 */

function showMeTyping(text: string): void {
  showMe.ghost = text || undefined;
  if (text && showMe.level === "on") showMe.caption = undefined;
  requestFrame();
}

function showMeCaption(text: string | undefined): void {
  if (showMe.level !== "on") return;
  showMe.caption = text;
  if (showMe.clear) clearTimeout(showMe.clear);
  showMe.clear = undefined;
  requestFrame();
}

/** End of a turn: the ghost goes, the caption becomes the do-it-yourself hint. */
function showMeFinish(): void {
  showMe.ghost = undefined;
  showMe.notes.reset();
  const hint = finishHint(showMe.commands);
  showMe.commands = [];
  if (hint && showMe.level === "on") {
    showMeCaption(hint);
    showMe.clear = setTimeout(() => {
      showMe.caption = undefined;
      showMe.clear = undefined;
      requestFrame();
    }, 8_000);
  } else {
    showMe.caption = undefined;
    requestFrame();
  }
}

/**
 * Slide a fader to its new value the way the drawer does: each eased step is
 * the field's own command, staged on a scratch score and played, so the loop
 * moves through the values. Only while the loop plays (otherwise nothing is
 * heard and the glide would only cost time); never longer than ~150 ms.
 */
async function glideFader(param: string, target: number): Promise<void> {
  if (!clock.playing || !stdout.isTTY) return;
  const scratch = new EditMenu();
  const context = { ...menuContext(), score };
  const label = scratch.showFader(context, param);
  if (!label) return;
  const field = scratch
    .faderFields(context)
    .find((candidate) => candidate.label === label);
  scratch.close();
  if (field?.kind !== "number") return;
  const from = field.value ?? field.start ?? target;
  const steps = glideValues(from, target).slice(0, -1);
  for (const value of steps) {
    const staged = await applyStaged(score, field.command(value));
    if (staged.next && clock.playing) void audio.play(staged.next);
    await Bun.sleep(GLIDE_STEP_MS);
  }
}

/** Sound one streamed note on the audition voice (the loop is stopped). */
function soundStreamedNote(
  value: TrackScore,
  trackId: string,
  pitch: number,
  startBeat: number,
): void {
  if (clock.playing) return; // The loop itself plays it.
  const engine = liveEngine();
  if (!engine?.canMonitor) return;
  const tick = Math.round(startBeat * value.ticksPerBeat);
  const note = value.notes.find(
    (candidate) =>
      candidate.trackId === trackId &&
      candidate.pitch === pitch &&
      candidate.startTick === tick,
  );
  if (!note) return;
  try {
    const json = value.toJSON() as unknown as Record<string, unknown>;
    const single = scoreFromJSON({
      ...json,
      notes: [{ ...note, startTick: 0 }],
    });
    const pcm = renderAudition({
      score: single,
      trackId,
      sampleRate: engine.sampleRate,
      ...(liveSampleBank ? { samples: liveSampleBank } : {}),
    });
    if (!pcm) return;
    void engine
      .monitor(true)
      .then(() => engine.noteOn(AUDITION_VOICE, pcm))
      .catch(() => undefined);
  } catch {
    // A note that cannot render is still in the score.
  }
}

/** The command host the show-me agent loop runs lines through. */
function showMeCommandHost(): AgentHost["commands"] {
  return {
    isCommand: (line) => isAgentCommand(line, score),
    async run(line): Promise<CommandOutcome> {
      const gesture = gestureFor(line, { score, trackId: requestedTrack });
      showMeCaption(gesture.caption);
      showMe.commands.push(line);
      if (gesture.kind === "fader" && showMe.level === "on")
        await glideFader(gesture.param, gesture.value);
      const base = baseline();
      tui.activity.pushNote(`agent › ${line}`, "request");
      let result: string | Receipt;
      try {
        result = await submit(line);
      } catch (error) {
        result = fail(describeError(line, error));
      }
      receipt(result, base);
      if (gesture.kind === "keys" && showMe.level === "on") {
        const trackId = requestedTrack;
        const after = score;
        for (const note of gesture.notes) {
          const { atMs } = showMe.notes.schedule(note.start, performance.now());
          const delay = Math.max(0, atMs - performance.now());
          setTimeout(
            () => soundStreamedNote(after, trackId, note.pitch, note.start),
            delay,
          );
        }
      }
      return {
        ok: toneOf(result) !== "error",
        message: typeof result === "string" ? result : result.text,
        baseRevision: base.revision,
        resultRevision: record.revision,
      };
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
    ...(showMe.level !== "off" && stdout.isTTY
      ? { commands: showMeCommandHost() }
      : {}),
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
