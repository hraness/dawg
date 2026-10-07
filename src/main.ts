#!/usr/bin/env bun
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
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
import { historyTarget, REDO_KIND, UNDO_KIND } from "./commands/history.ts";
import { drumSnapshotFields } from "../tui/drums.ts";
import { drumVoicePitch, isDrumInstrument } from "../core/drums.ts";
import {
  describeAgentEvent,
  StaleRevisionError,
  type AgentEvent,
  type AgentHost,
} from "./agent/agent.ts";
import { type GatewayModel } from "./agent/gateway.ts";
import {
  providerLabel,
  runProviderTurn,
  selectProvider,
  type ProviderSelection,
} from "./agent/provider.ts";
import { runAuthCommand } from "./auth/cli.ts";
import { tuiAuthCommand } from "./auth/tui.ts";
import { TransportClock } from "./audio/clock.ts";
import {
  addNote,
  applyScoreOperation,
  createScore,
  scoreFromJSON,
  SCORE_LIMITS,
  type TrackScore,
  type ScoreOperation,
} from "../core/score.ts";
import { decodeLoop, encodeLoop } from "../core/loop.ts";
import type { TrackScoreSnapshot } from "../tui/render.ts";
import { PromptModel } from "../tui/prompt.ts";
import { TerminalInputDecoder } from "../tui/input.ts";
import {
  composeFrame,
  TuiApp,
  type AppView,
  type SyncState,
} from "../tui/app.ts";
import { receiptTone } from "../tui/activity.ts";
import { encodeBuffer } from "../tui/screen.ts";
import { parseThemeName } from "../tui/theme.ts";

const ESC = "\u001b[";
const HELP_TEXT = `track · local-first terminal music workstation

Usage:
  track [--new] [--session <name|id>] [--track <name>]
  track --import <file> --export <file>
  track sessions
  track render <out.wav> [--session <name|id>] [--import <file>]

Usage flags:
  --reduce-motion   static hit/sustain states (also TRACK_REDUCE_MOTION=1)
  --theme <name>    default | high-contrast | mono (NO_COLOR forces mono)

Prompt:
  Enter submit · Shift-Enter newline · Alt-Enter queue · Ctrl-Q toggle queue
  Ctrl-Z undo · Ctrl-Y redo · Ctrl-O transcript · Esc cancel/close · Ctrl-C exit
  Space on an empty prompt toggles playback

Commands:
  play, pause, tempo <bpm>, instrument <name>, volume <0..1>, pan <-1..1>
  automate <lane> at <beat> <value>, clear automation, mute, clear
    lanes: volume pan filter resonance delay-feedback delay-mix
  undo, redo, solo, unsolo, filter <hz> [res], delay <beats> [fb] [mix]
  reverb <mix> [size], reverb off
  instrument kit, hit <voice> at <beat>, pattern <voice> <beats...>|every <step>
  track <name>, bars <count>, extend <count> bars
  /tracks, /status, /export <file>, /import <file>, /model opus-5.5|sol-6.1
  /sessions, /resume [n|name|id], /rename <name>|--auto, /fork [name]
  /log, /theme default|high-contrast|mono, /motion on|off
  /login [--xcb], /logout, /auth [--check]

Auth:
  track login [--gateway|--key|--xcb] [--budget <dollars>]
  track logout · track auth status [--check]
Unrecognized requests go to the agent once a provider is configured
(TRACK_PROVIDER=gateway|xcb|auto; TRACK_AI=0 disables the agent).`;
const args = new Set(process.argv.slice(2));
const requestedSession = optionValue("--session");
const explicitTrack = optionValue("--track");
/** The focused track; claimed at startup unless `--track` is given. */
let requestedTrack = explicitTrack ?? "main";
const initialInstrument = isDrumInstrument(requestedTrack) ? "kit" : "sine";
const importPath = optionValue("--import");
const exportPath = optionValue("--export");
if (["login", "logout", "auth"].includes(process.argv[2] ?? ""))
  process.exit(await runAuthCommand(process.argv.slice(2)));
if (args.has("--help") || args.has("-h")) {
  stdout.write(`${HELP_TEXT}\n`);
  process.exit(0);
}
if (process.argv[2] === "sessions") {
  await printSessions(process.cwd(), stdout);
  process.exit(0);
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
const demo =
  args.has("--demo") || process.env.TRACK_DEMO === "1" || !stdin.isTTY;

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
const session = await ensureSession(initial.toJSON(), sessionOptions);
// trackd when connected, the file-lock path otherwise (see src/session/port.ts).
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
      payload: { path: importPath, before: record.composition },
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
let selectedModel: GatewayModel =
  process.env.TRACK_MODEL === "opus-5.5" ? "opus-5.5" : "sol-6.1";
const prompt = new PromptModel({ width: 72, maxVisualRows: 8 });
const tui = new TuiApp({
  io: {
    write: (data) => stdout.write(data),
    columns: () => stdout.columns ?? 80,
    rows: () => stdout.rows ?? 24,
  },
  prompt,
  theme: parseThemeName(optionValue("--theme") ?? process.env.TRACK_THEME),
  reducedMotion:
    args.has("--reduce-motion") || process.env.TRACK_REDUCE_MOTION === "1",
});
let syncState: SyncState = port.sync;
let windowCount = 1;
let announcedName = record.meta.name;
let namer = makeNamer();
/** Re-subscribes the TUI after /fork or /resume replaces `port`. */
let rebindPort: () => void = () => undefined;
/** The in-flight agent turn: Esc aborts it, Enter steers it. */
let agentTurn: { controller: AbortController; steering: string[] } | undefined;
let reportAgentActivity: (text: string) => void = () => undefined;
// Declared before `await runInteractive()` runs, or assigning it is a TDZ error.
let agentEventSink: (event: AgentEvent) => void = () => undefined;
/** Resolved lazily (and again after /login); `undefined` until first needed. */
let provider: Promise<ProviderSelection> | undefined;
let providerName = "";
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
    bpm: value.tempoBpm,
    key: value.key ?? undefined,
    loopBeats: value.bars * value.beatsPerBar,
    beatsPerBar: value.beatsPerBar,
    laneCount: 24,
    currentBeat: beat,
    playing: clock.playing,
    activity,
    ...drumSnapshotFields(
      value.tracks.find((track) => track.id === requestedTrack)?.instrument,
      notes,
    ),
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
    // `opus-5.5 · gateway`, `claude/sonnet · xcb`; hidden when offline.
    model:
      providerName && providerName !== "offline" ? providerName : undefined,
    sync: syncState,
    sessionName: record.meta.name,
    windows: windowCount,
  };
}

/** Show a command receipt in the activity strip with a tone and undo hint. */
function receipt(message: string, baseRevision?: number): void {
  const tone = receiptTone(message);
  const changed =
    baseRevision !== undefined && record.revision !== baseRevision;
  if (tone === "error") tui.activity.pushError(message);
  else
    tui.activity.pushCard(message, {
      tone,
      baseRevision: changed ? baseRevision : undefined,
      resultRevision: changed ? record.revision : undefined,
      hint: changed
        ? message.startsWith("undid")
          ? "^y redo"
          : "^z undo"
        : undefined,
      trackId: requestedTrack,
    });
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
    const base = record.revision;
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
          accepted: record.revision !== base,
        });
    } catch (error) {
      tui.activity.pushError(
        `error · ${error instanceof Error ? error.message : String(error)}`,
      );
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
        tick(true);
      }
    } finally {
      processingQueue = false;
      tui.activity.setQueueDepth(queuedPrompts.length);
    }
  };
  const tick = (force = false) => {
    tui.render(appView(score, clock.beatAt()), { force });
  };
  reportAgentActivity = () => {
    tui.activity.applyAgentEvent({ type: "start", model: providerName });
  };
  agentEventSink = (event) => {
    tui.activity.applyAgentEvent(event);
    if (event.type === "done" || event.type === "error") agentReported = true;
  };
  // ~30 fps cap; the differential writer only emits changed rows.
  const timer = setInterval(tick, tui.frameIntervalMs);
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
        score = scoreFromJSON(record.composition);
        clock.setTempo(score.tempoBpm);
        if (clock.playing) void audio.play(score);
        // Connected windows follow trackd's transport frames instead.
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
      // Every window renders the same hit line from trackd's timestamp.
      const { playing, beat, bpm, atMs } = update.transport;
      clock.setTempo(bpm);
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
  if (attachNotice)
    tui.activity.pushCard(attachNotice, {
      tone: "info",
      trackId: requestedTrack,
      hint: draftTrack ? "first edit creates it" : undefined,
    });
  if (port.status !== "file session")
    tui.activity.pushCard(port.status, { tone: "info" });
  void currentProvider().then(() => tick(true));
  tick(true);
  try {
    let exiting = false;
    for await (const chunk of stdin) {
      const text = String(chunk);
      // A read that is exactly ESC is the Esc key, not the start of a sequence.
      const values = [
        ...inputDecoder.push(text),
        ...(text === "\u001b" ? inputDecoder.flush() : []),
      ];
      for (const value of values) {
        // The prompt is always focused, so ordinary `q` must remain typeable in
        // requests (for example, "quiet hi-hat"). Ctrl-C is the unambiguous
        // shell exit key; Ctrl-Q is reserved for prompt mode switching.
        // Keep the empty-prompt space shortcut for transport, while allowing
        // ordinary spaces once a request is being composed.
        if (value === " " && prompt.value.length === 0) {
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
        } else {
          const input = tui.input(value);
          const action = input.type === "action" ? input.action : undefined;
          if (input.type === "ui") {
            if (input.command === "quit") exiting = true;
            else if (
              (input.command === "undo" || input.command === "redo") &&
              !agentTurn
            ) {
              const base = record.revision;
              receipt(await stepHistory(input.command), base);
            }
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
    clearInterval(timer);
    clearInterval(presenceTimer);
    namer.dispose();
    stdout.off("resize", onResize);
    unsubscribe();
    audio.stop();
    await port.close();
    stdin.setRawMode?.(false);
    stdin.pause();
    stdout.write(`${ESC}0m${ESC}?2004l${ESC}?25h${ESC}?1049l`);
  }
}

async function submit(prompt: string): Promise<string> {
  const command = prompt.trim();
  if (/^\/?help$|^\/?\?$/.test(command.toLowerCase()))
    return "commands · play pause tempo <bpm> instrument <name> volume <0..1> pan <-1..1> automate volume|pan|filter|resonance|delay-feedback|delay-mix at <beat> <value> clear automation track <name> bars <count> extend <count> bars mute solo unsolo filter <hz> [res] delay <beats> [fb] [mix] reverb <mix> [size] hit <voice> at <beat> pattern <voice> <beats...>|every <step> clear <voice> clear undo redo export <file> import <file>";
  if (/^\/?tracks?$/i.test(command))
    return score.tracks
      .map(
        (track) =>
          `${track.id}${track.muted ? " [muted]" : ""}${track.solo ? " [solo]" : ""} · ${track.instrument}`,
      )
      .join("  ");
  if (/^\/status$/i.test(command))
    return `status · ${record.meta.name} · rev ${record.revision} · ${compositionDigest(record.composition)} · ${port.mode}`;
  if (/^\/?undo$/i.test(command)) return stepHistory("undo");
  if (/^\/?redo$/i.test(command)) return stepHistory("redo");
  const sessionReply = await sessionCommand(command);
  if (sessionReply !== undefined) return sessionReply;
  const music = parseMusicCommand(command);
  if (music) {
    await materializeDraft();
    const result = applyMusicCommand(score, requestedTrack, music, () =>
      randomUUID().slice(0, 12),
    );
    if (result.next && result.kind)
      await commitScore(result.next, result.kind, result.payload);
    return result.message;
  }
  const exportCommand = command.match(/^\/?export\s+([^\s]+)$/i);
  if (exportCommand) {
    const path = resolve(exportCommand[1]!);
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
  const modelCommand = prompt.trim().match(/^\/model\s+(opus-5\.5|sol-6\.1)$/i);
  if (modelCommand) {
    selectedModel = modelCommand[1]!.toLowerCase() as GatewayModel;
    if (provider) void currentProvider();
    return `model · ${selectedModel}`;
  }
  if (/^\/(login|logout|auth)\b/i.test(prompt.trim())) {
    tui.activity.setSpinner(prompt.trim().split(/\s+/)[0]!.slice(1));
    try {
      const lines = await tuiAuthCommand(prompt.trim(), selectedModel);
      provider = undefined;
      await currentProvider();
      for (const line of lines.slice(0, -1))
        tui.activity.pushCard(line, { tone: authTone(line) });
      return lines.at(-1) ?? "auth · done";
    } finally {
      tui.activity.setSpinner(undefined);
    }
  }
  const parsed = parsePrompt(prompt);
  if (!parsed) {
    if (process.env.TRACK_AI === "0") return `unrecognized request: ${prompt}`;
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
        return "transport changed in another window";
      throw error;
    }
    return parsed.action;
  }
  if (parsed.type === "set-tempo") {
    const next = score.withTempo(parsed.tempoBpm);
    await commitScore(next, "score.tempo", { tempoBpm: parsed.tempoBpm });
    clock.setTempo?.(next.tempoBpm);
    return `tempo · ${next.tempoBpm} BPM`;
  }
  if (parsed.type === "add-track") {
    if (score.tracks.some((track) => track.id === parsed.trackId))
      return `track exists · ${parsed.trackId}`;
    const next = applyScoreOperation(score, {
      type: "addTrack",
      track: {
        id: parsed.trackId,
        name: parsed.trackId,
        instrument: isDrumInstrument(parsed.trackId) ? "kit" : "sine",
      },
    });
    await commitScore(next, "track.create", { trackId: parsed.trackId });
    return `track created · ${parsed.trackId}`;
  }
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
          payload: { operation, before: latest.composition },
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
  return "session busy; retry the note";
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
    tui.activity.pushCard(`session · ${meta.name}`, { tone: "info" });
  }
}

function makeNamer(): AutoNamer {
  return new AutoNamer({
    target: namingTarget(
      process.cwd(),
      () => ({ port, record }),
      (meta) => adoptMeta(meta),
    ),
    // TRACK_AI=0 keeps naming local; an offline provider falls back too.
    generator:
      process.env.TRACK_AI === "0"
        ? undefined
        : providerNameGenerator(currentProvider),
  });
}

/** `/sessions`, `/resume`, `/rename`, `/fork`; undefined when not one. */
async function sessionCommand(command: string): Promise<string | undefined> {
  const match = command.match(/^\/(sessions|resume|rename|fork)(?:\s+(.*))?$/i);
  if (!match) return undefined;
  const verb = match[1]!.toLowerCase();
  const arg = (match[2] ?? "").trim();
  const workspace = process.cwd();
  if (verb === "rename") {
    if (!arg)
      return `session · ${record.meta.name} (${record.meta.nameSource}) · /rename <name> | --auto`;
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
  if (verb === "sessions" || (verb === "resume" && !arg)) {
    const lines = pickerLines(sessions, record.sessionId, (session) =>
      formatSessionLine(session, sessions),
    );
    for (const line of lines) tui.activity.pushCard(line, { tone: "info" });
    return verb === "resume"
      ? "resume · /resume <n|name|id>"
      : `${lines.length} sessions`;
  }
  if (agentTurn) return "agent busy; finish or Esc first";
  if (verb === "fork") {
    const forked = await forkSession(workspace, record, arg || undefined);
    await switchSession(forked.sessionId);
    return `forked · ${forked.meta.name}`;
  }
  const readable = sessions.filter((session) => !session.error);
  const index = /^[1-9]$/.test(arg) ? Number(arg) - 1 : -1;
  const sessionId =
    readable[index]?.sessionId ??
    (await resolveSessionArg(workspace, arg, sessions));
  if (!sessions.some((session) => session.sessionId === sessionId))
    return `no session named "${arg}"`;
  if (sessionId === record.sessionId) return `already in ${record.meta.name}`;
  await switchSession(sessionId);
  return `resumed · ${record.meta.name} · ${requestedTrack}${draftTrack ? " (new)" : ""}`;
}

/** Leaves the current session and attaches this window to `sessionId`. */
async function switchSession(sessionId: string): Promise<void> {
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
  clock.setTempo(score.tempoBpm);
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

async function commitScore(
  next: TrackScore,
  kind: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  if (next === score) return;
  record = await port.append(
    record,
    { kind, payload: { ...payload, before: record.composition } },
    next.toJSON(),
  );
  score = next;
  if (clock.playing) void audio.play(score);
}

async function stepHistory(direction: "undo" | "redo"): Promise<string> {
  const latest = await port.load();
  const target = historyTarget(latest.events, direction);
  if (!target) return `nothing to ${direction}`;
  try {
    const restored = scoreFromJSON(target.composition);
    record = await port.append(
      latest,
      {
        kind: direction === "undo" ? UNDO_KIND : REDO_KIND,
        payload: {
          [direction === "undo" ? "undoneRevision" : "redoneRevision"]:
            target.revision,
          before: latest.composition,
        },
      },
      restored.toJSON(),
    );
    score = restored;
    if (clock.playing) void audio.play(score);
    return `${direction === "undo" ? "undid" : "redid"} · rev ${target.revision}`;
  } catch (error) {
    if (error instanceof SessionConflictError)
      return `session changed; retry ${direction}`;
    return `${direction} error · ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function setTransport(
  action: "play" | "pause" | "toggle",
): Promise<void> {
  if (port.mode === "daemon") {
    // trackd owns the only transport; its broadcast updates `clock`.
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
async function runAgent(text: string): Promise<string> {
  if (agentTurn) return "agent busy";
  const selection = await currentProvider();
  if (selection.kind === "offline")
    return `unrecognized request · ${selection.reason}`;
  const turn = { controller: new AbortController(), steering: [] as string[] };
  agentTurn = turn;
  reportAgentActivity(`${providerName} · thinking…`);
  try {
    const result = await runProviderTurn({
      selection,
      prompt: text,
      model: selectedModel,
      host: agentHost(turn),
      signal: turn.controller.signal,
      onEvent: (event) => agentEventSink(event),
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

function currentProvider(): Promise<ProviderSelection> {
  provider ??= selectProvider().catch((): ProviderSelection => ({
    kind: "offline",
    choice: "auto",
    reason: "provider unavailable; run `track login`",
  }));
  return provider.then((selection) => {
    providerName = providerLabel(selection, selectedModel);
    return selection;
  });
}

function agentHost(turn: { steering: string[] }): AgentHost {
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
    async commit(change) {
      if (change.baseRevision !== record.revision)
        throw new StaleRevisionError(change.baseRevision, record.revision);
      try {
        await commitScore(change.next, "agent.tool", {
          tool: change.toolName,
          callId: change.callId,
          summary: change.summary,
          operations: change.operations,
        });
      } catch (error) {
        if (error instanceof SessionConflictError)
          throw new StaleRevisionError(
            change.baseRevision,
            record.revision + 1,
          );
        throw error;
      }
      if (change.operations.some((operation) => operation.type === "setTempo"))
        clock.setTempo(score.tempoBpm);
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
  };
}
