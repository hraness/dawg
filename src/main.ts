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
import { monotonicEpochMs } from "./session/protocol.ts";
import { printSessions } from "./session/list.ts";
import { parsePrompt } from "./agent/ops.ts";
import { applyMusicCommand, parseMusicCommand } from "./commands/music.ts";
import { historyTarget, REDO_KIND, UNDO_KIND } from "./commands/history.ts";
import { drumSnapshotFields } from "../tui/drums.ts";
import { isDrumInstrument } from "../core/drums.ts";
import {
  describeAgentEvent,
  runAgentTurn,
  StaleRevisionError,
  type AgentEvent,
  type AgentHost,
} from "./agent/agent.ts";
import {
  createGatewayClient,
  type GatewayClient,
  type GatewayModel,
} from "./agent/gateway.ts";
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
import {
  detectTerminalCapabilities,
  renderHighway,
  type TrackScoreSnapshot,
} from "../tui/render.ts";
import { PromptModel, type PromptAction } from "../tui/prompt.ts";
import { TerminalInputDecoder } from "../tui/input.ts";

const ESC = "\u001b[";
const HELP_TEXT = `track · local-first terminal music workstation

Usage:
  track [--new] [--session <id>] [--track <name>]
  track --import <file> --export <file>
  track sessions

Prompt:
  Enter submit · Shift-Enter newline · Alt-Enter queue · Ctrl-Q toggle queue
  Space on an empty prompt toggles playback · Ctrl-C exits

Commands:
  play, pause, tempo <bpm>, instrument <name>, volume <0..1>, pan <-1..1>
  automate volume|pan|filter at <beat> <value>, clear automation, mute, clear
  undo, redo, solo, unsolo, filter <hz> [res], delay <beats> [fb] [mix]
  instrument kit, hit <voice> at <beat>, pattern <voice> <beats...>|every <step>
  track <name>, bars <count>, extend <count> bars
  /tracks, /export <file>, /import <file>, /model opus-5.5|sol-6.1

AI is opt-in with TRACK_AI=1 and a local AI_GATEWAY_API_KEY.`;
const args = new Set(process.argv.slice(2));
const requestedSession = optionValue("--session");
const requestedTrack = optionValue("--track") ?? "main";
const initialInstrument = isDrumInstrument(requestedTrack) ? "kit" : "sine";
const importPath = optionValue("--import");
const exportPath = optionValue("--export");
if (args.has("--help") || args.has("-h")) {
  stdout.write(`${HELP_TEXT}\n`);
  process.exit(0);
}
if (process.argv[2] === "sessions") {
  await printSessions(process.cwd(), stdout);
  process.exit(0);
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
const selectedSession = args.has("--new") ? randomUUID() : requestedSession;
if (selectedSession !== undefined) sessionOptions.sessionId = selectedSession;
const session = await ensureSession(initial.toJSON(), sessionOptions);
// trackd when connected, the file-lock path otherwise (see src/session/port.ts).
const port = await openSessionPort<ReturnType<TrackScore["toJSON"]>>({
  paths: session.paths,
  sessionId: session.record.sessionId,
  label: requestedTrack,
  focusedTrackId: requestedTrack,
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
if (!score.tracks.some((track) => track.id === requestedTrack)) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const latest = attempt === 0 ? record : await port.load();
    const latestScore = scoreFromJSON(latest.composition);
    if (latestScore.tracks.some((track) => track.id === requestedTrack)) {
      record = latest;
      score = latestScore;
      break;
    }
    const next = latestScore.withTracks([
      ...latestScore.tracks,
      {
        id: requestedTrack,
        name: requestedTrack,
        instrument: initialInstrument,
      },
    ]);
    try {
      record = await port.append(
        latest,
        { kind: "track.attach", payload: { trackId: requestedTrack } },
        next.toJSON(),
      );
      score = next;
      break;
    } catch (error) {
      if (!(error instanceof SessionConflictError)) throw error;
    }
  }
}

const clock = new TransportClock(score.tempoBpm);
const audio = port.player;
let selectedModel: GatewayModel =
  process.env.TRACK_MODEL === "opus-5.5" ? "opus-5.5" : "sol-6.1";
const prompt = new PromptModel({ width: 72, maxVisualRows: 8 });
/** The in-flight agent turn: Esc aborts it, Enter steers it. */
let agentTurn: { controller: AbortController; steering: string[] } | undefined;
let reportAgentActivity: (text: string) => void = () => undefined;
// Declared before `await runInteractive()` runs, or assigning it is a TDZ error.
let agentEventSink: (event: AgentEvent) => void = () => undefined;
let gatewayClient: GatewayClient | undefined;
if (demo) {
  if (score.notes.length === 0) score = seedDemo(score, requestedTrack);
  if (exportPath)
    await writeFile(resolve(exportPath), encodeLoop(score), "utf8");
  renderOnce(
    score,
    clock.beatAt(),
    "demo · press space to play",
    ["> add C4 at 0 for 1"],
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
  promptLines = ["> "],
  nowMs = Date.now(),
): void {
  const width = Math.max(24, stdout.columns ?? 80);
  prompt.setWidth(Math.max(12, width - 4));
  const capabilities = detectTerminalCapabilities();
  const rows = Math.max(6, (stdout.rows ?? 24) - promptLines.length - 4);
  const highway = renderHighway(snapshot(value, transportBeat, activity), {
    width,
    height: rows,
    clock: () => nowMs,
    capabilities,
  });
  const promptFrame = renderPromptPanel(
    promptLines,
    width,
    capabilities.colorDepth !== "none",
  );
  stdout.write(`${highway}\n${promptFrame}\n`);
}

function renderPromptPanel(
  lines: readonly string[],
  width: number,
  color: boolean,
): string {
  const inner = Math.max(1, width - 2);
  const bg = color ? `${ESC}48;2;27;32;42m${ESC}38;2;225;231;239m` : "";
  const reset = color ? `${ESC}0m` : "";
  const top = `╭─ prompt · enter send · shift-enter newline ${"─".repeat(Math.max(0, inner - 42))}╮`;
  const bottom = `╰${"─".repeat(inner)}╯`;
  const body = lines.map(
    (line) =>
      `│ ${line.slice(0, Math.max(0, inner - 2)).padEnd(Math.max(0, inner - 2))} │`,
  );
  return [top, ...body, bottom]
    .map((line) => `${bg}${line.padEnd(width).slice(0, width)}${reset}`)
    .join("\n");
}

async function runInteractive(): Promise<void> {
  stdin.setRawMode?.(true);
  stdin.resume();
  stdout.write(`${ESC}?25l${ESC}?2004h${ESC}2J`);
  let activity = "ready";
  const inputDecoder = new TerminalInputDecoder();
  const queuedPrompts: string[] = [];
  let processingQueue = false;
  const drainQueue = async (): Promise<void> => {
    if (processingQueue) return;
    processingQueue = true;
    try {
      while (queuedPrompts.length > 0) {
        const nextPrompt = queuedPrompts.shift()!;
        activity = `queued · ${queuedPrompts.length} remaining`;
        activity = await submit(nextPrompt);
      }
    } finally {
      processingQueue = false;
    }
  };
  const tick = () => {
    stdout.write(`${ESC}H`);
    renderOnce(
      score,
      clock.beatAt(),
      `${activity} · rev ${record.revision}`,
      prompt.render("› "),
    );
  };
  let streamed = "";
  reportAgentActivity = (text) => {
    activity = text;
  };
  agentEventSink = (event) => {
    if (event.type === "step") streamed = "";
    if (event.type === "text-delta") {
      streamed = (streamed + event.delta).replace(/\s+/g, " ").slice(-120);
      activity = `… ${streamed.trim()}`;
      return;
    }
    const line = describeAgentEvent(event);
    if (line) activity = line;
  };
  const timer = setInterval(tick, 100);
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
            if (payload.playing) void audio.play(score);
            else audio.stop();
          } else if (typeof payload.playing === "boolean")
            await setTransport(payload.playing ? "play" : "pause");
          else if (payload.action === "play") await setTransport("play");
          else if (payload.action === "pause") await setTransport("pause");
          else if (payload.action === "toggle") await setTransport("toggle");
        }
        activity = `synced · rev ${record.revision}`;
      }
    } catch {
      // An invalid composition is skipped; the next update retries.
    }
  };
  const unsubscribe = port.subscribe((update) => {
    if (update.type === "record") void applyLatest(update.record);
    else if (update.type === "transport") {
      // Every window renders the same hit line from trackd's timestamp.
      const { playing, beat, bpm, atMs } = update.transport;
      clock.setTempo(bpm);
      clock.sync(beat, playing, atMs, monotonicEpochMs());
    } else if (update.type === "status") activity = update.message;
  });
  if (port.status !== "file session") activity = port.status;
  tick();
  try {
    let exiting = false;
    for await (const chunk of stdin) {
      const values = inputDecoder.push(String(chunk));
      for (const value of values) {
        const terminalValue = typeof value === "string" ? value : undefined;
        // The prompt is always focused, so ordinary `q` must remain typeable in
        // requests (for example, "quiet hi-hat"). Ctrl-C is the unambiguous
        // shell exit key; Ctrl-Q is reserved for prompt mode switching.
        if (terminalValue === "\u0003") {
          exiting = true;
          break;
        }
        // Keep the empty-prompt space shortcut for transport, while allowing
        // ordinary spaces once a request is being composed.
        if (terminalValue === " " && prompt.value.length === 0) {
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
              activity = "transport changed in another window";
            else throw error;
          }
          activity = clock.playing ? "playing" : "paused";
        } else {
          const action =
            typeof value === "string"
              ? handleTerminalInput(value)
              : prompt.handle({ type: "paste", text: value.text });
          if (action?.kind === "exit") {
            exiting = true;
            break;
          }
          if (action?.kind === "cancel" && agentTurn) {
            agentTurn.controller.abort();
            activity = "cancelling…";
          } else if (action?.kind === "submit" && action.value && agentTurn) {
            // Enter during a turn steers it; Alt-Enter still queues a follow-up.
            agentTurn.steering.push(action.value);
            activity = "steering · applied at the next step";
          } else if (action?.kind === "submit" && action.value) {
            queuedPrompts.unshift(action.value);
            // Do not await: the input loop must stay live so Esc can cancel.
            void drainQueue();
          } else if (action?.kind === "queue" && action.value) {
            queuedPrompts.push(action.value);
            activity = `queued · ${queuedPrompts.length}`;
            void drainQueue();
          }
        }
        tick();
      }
      if (exiting) break;
    }
  } finally {
    clearInterval(timer);
    unsubscribe();
    audio.stop();
    await port.close();
    stdin.setRawMode?.(false);
    stdin.pause();
    stdout.write(`${ESC}?25h${ESC}?2004l${ESC}0m\n`);
  }
}

function handleTerminalInput(value: string): PromptAction | undefined {
  if (value === "\u001b[13;2u" || value === "\u001b[27;2;13~")
    return prompt.handle("SHIFT+ENTER");
  if (value === "\u001b\r") return prompt.handle("ALT+ENTER");
  if (value.startsWith("\u001b[200~") && value.endsWith("\u001b[201~")) {
    return prompt.handle({ type: "paste", text: value.slice(6, -6) });
  }
  if (value === "\u0011") return prompt.handle("CTRL+Q");
  if (value === "\u007f") return prompt.handle("BACKSPACE");
  if (value === "\r" || value === "\n") return prompt.handle("ENTER");
  if (value === "\u001b[A") return prompt.handle("UP");
  if (value === "\u001b[B") return prompt.handle("DOWN");
  if (value === "\u001b[C") return prompt.handle("RIGHT");
  if (value === "\u001b[D") return prompt.handle("LEFT");
  if (value === "\u001b[H" || value === "\u001b[1~")
    return prompt.handle("HOME");
  if (value === "\u001b[F" || value === "\u001b[4~")
    return prompt.handle("END");
  if (value === "\u001b[3~") return prompt.handle("DELETE");
  if (value === "\u001b[1;5D") return prompt.handle("CTRL+LEFT");
  if (value === "\u001b[1;5C") return prompt.handle("CTRL+RIGHT");
  if (value === "\u001b") return prompt.handle("ESC");
  if (value.startsWith("\u001b")) return undefined;
  let action: PromptAction | undefined;
  for (const character of Array.from(value)) action = prompt.handle(character);
  return action;
}

async function submit(prompt: string): Promise<string> {
  const command = prompt.trim();
  if (/^\/?help$|^\/?\?$/.test(command.toLowerCase()))
    return "commands · play pause tempo <bpm> instrument <name> volume <0..1> pan <-1..1> automate volume|pan|filter at <beat> <value> clear automation track <name> bars <count> extend <count> bars mute solo unsolo filter <hz> [res] delay <beats> [fb] [mix] hit <voice> at <beat> pattern <voice> <beats...>|every <step> clear <voice> clear undo redo export <file> import <file>";
  if (/^\/?tracks?$/i.test(command))
    return score.tracks
      .map(
        (track) =>
          `${track.id}${track.muted ? " [muted]" : ""}${track.solo ? " [solo]" : ""} · ${track.instrument}`,
      )
      .join("  ");
  if (/^\/?undo$/i.test(command)) return stepHistory("undo");
  if (/^\/?redo$/i.test(command)) return stepHistory("redo");
  const music = parseMusicCommand(command);
  if (music) {
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
    const imported = decodeLoop(await readLoopFile(importCommand[1]!));
    await commitScore(imported, "score.import", { path: importCommand[1] });
    return `imported · ${importCommand[1]}`;
  }
  const modelCommand = prompt.trim().match(/^\/model\s+(opus-5\.5|sol-6\.1)$/i);
  if (modelCommand) {
    selectedModel = modelCommand[1]!.toLowerCase() as GatewayModel;
    return `model · ${selectedModel}`;
  }
  const parsed = parsePrompt(prompt);
  if (!parsed) {
    if (process.env.TRACK_AI !== "1") return `unrecognized request: ${prompt}`;
    return runAgent(prompt);
  }
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
    await audio.play(score);
  } else if (action === "pause") {
    clock.pause();
    audio.stop();
  } else if (clock.playing) {
    clock.pause();
    audio.stop();
  } else {
    clock.play();
    await audio.play(score);
  }
}

/**
 * Run one streaming tool-calling turn. Each validated tool call commits its
 * own revision through `agentHost`, so cancelling keeps every accepted change
 * and never leaves a half-applied call.
 */
async function runAgent(text: string): Promise<string> {
  if (agentTurn) return "agent busy";
  gatewayClient ??= createGatewayClient();
  const turn = { controller: new AbortController(), steering: [] as string[] };
  agentTurn = turn;
  reportAgentActivity(`${selectedModel} · thinking…`);
  try {
    const result = await runAgentTurn({
      prompt: text,
      model: selectedModel,
      client: gatewayClient,
      host: agentHost(turn),
      signal: turn.controller.signal,
      onEvent: (event) => agentEventSink(event),
    });
    return describeAgentEvent(result) ?? "agent finished";
  } finally {
    if (agentTurn === turn) agentTurn = undefined;
  }
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
