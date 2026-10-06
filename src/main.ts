#!/usr/bin/env bun
import { randomUUID } from "node:crypto";
import { stdin, stdout } from "node:process";
import {
  appendSessionEvent,
  ensureSession,
  loadSession,
  SessionConflictError,
  type SessionRecord,
} from "./session/store.ts";
import { parsePrompt } from "./agent/ops.ts";
import { planComposition } from "./agent/planner.ts";
import type { GatewayModel } from "./agent/gateway.ts";
import { TransportClock } from "./audio/clock.ts";
import { LoopPlayer } from "./audio/player.ts";
import {
  addNote,
  applyScoreOperation,
  createScore,
  scoreFromJSON,
  type TrackScore,
  type ScoreOperation,
  type NoteInput,
} from "../core/score.ts";
import {
  detectTerminalCapabilities,
  renderHighway,
  type TrackScoreSnapshot,
} from "../tui/render.ts";
import { PromptModel, type PromptAction } from "../tui/prompt.ts";

const ESC = "\u001b[";
const args = new Set(process.argv.slice(2));
const requestedSession = optionValue("--session");
const requestedTrack = optionValue("--track") ?? "main";
const demo =
  args.has("--demo") || process.env.TRACK_DEMO === "1" || !stdin.isTTY;

const initial = createScore({
  tracks: [{ id: requestedTrack, name: requestedTrack, instrument: "sine" }],
});
const sessionOptions: { sessionId?: string; setCurrent: boolean } = {
  setCurrent: !requestedSession || args.has("--new"),
};
const selectedSession = args.has("--new") ? randomUUID() : requestedSession;
if (selectedSession !== undefined) sessionOptions.sessionId = selectedSession;
const session = await ensureSession(initial.toJSON(), sessionOptions);
let record: SessionRecord<ReturnType<TrackScore["toJSON"]>> = session.record;
let score = scoreFromJSON(record.composition);
if (!score.tracks.some((track) => track.id === requestedTrack)) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const latest =
      attempt === 0
        ? record
        : await loadSession<typeof record.composition>(session.paths);
    const latestScore = scoreFromJSON(latest.composition);
    if (latestScore.tracks.some((track) => track.id === requestedTrack)) {
      record = latest;
      score = latestScore;
      break;
    }
    const next = latestScore.withTracks([
      ...latestScore.tracks,
      { id: requestedTrack, name: requestedTrack, instrument: "sine" },
    ]);
    try {
      record = await appendSessionEvent(
        session.paths,
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
const audio = new LoopPlayer(`${session.paths.record}.audio.lock`);
let selectedModel: GatewayModel =
  process.env.TRACK_MODEL === "opus-5.5" ? "opus-5.5" : "sol-6.1";
const prompt = new PromptModel({ width: 72, maxVisualRows: 8 });
if (demo) {
  if (score.notes.length === 0) score = seedDemo(score, requestedTrack);
  renderOnce(score, clock.beatAt(), "demo · press space to play", [
    "> add C4 at 0 for 1",
  ]);
  process.exit(0);
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
  return {
    notes: value.notes
      .filter((note) => note.trackId === requestedTrack)
      .map((note) => ({
        id: note.id,
        startBeat: note.startTick / value.ticksPerBeat,
        durationBeats: note.durationTicks / value.ticksPerBeat,
        pitch: note.pitch,
        velocity: note.velocity,
      })),
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
  };
}

function renderOnce(
  value: TrackScore,
  transportBeat: number,
  activity?: string,
  promptLines = ["> "],
): void {
  const width = Math.max(24, stdout.columns ?? 80);
  prompt.setWidth(Math.max(12, width - 4));
  const capabilities = detectTerminalCapabilities();
  const rows = Math.max(6, (stdout.rows ?? 24) - promptLines.length - 4);
  const highway = renderHighway(snapshot(value, transportBeat, activity), {
    width,
    height: rows,
    clock: () => 0,
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
  let syncing = false;
  const tick = () => {
    stdout.write(`${ESC}H`);
    renderOnce(
      score,
      clock.beatAt(),
      `${activity} · rev ${record.revision}`,
      prompt.render("› "),
    );
  };
  const timer = setInterval(tick, 100);
  const sync = async (): Promise<void> => {
    if (syncing) return;
    syncing = true;
    try {
      const latest = await loadSession<typeof record.composition>(
        session.paths,
      );
      if (latest.revision > record.revision) {
        const previousRevision = record.revision;
        record = latest;
        score = scoreFromJSON(record.composition);
        if (clock.playing) void audio.play(score);
        for (const event of latest.events.slice(previousRevision)) {
          if (
            event.kind !== "transport" ||
            typeof event.payload !== "object" ||
            event.payload === null
          )
            continue;
          const payload = event.payload as {
            action?: string;
            playing?: boolean;
          };
          if (typeof payload.playing === "boolean")
            await setTransport(payload.playing ? "play" : "pause");
          else if (payload.action === "play") await setTransport("play");
          else if (payload.action === "pause") await setTransport("pause");
          else if (payload.action === "toggle") await setTransport("toggle");
        }
        activity = `synced · rev ${record.revision}`;
      }
    } catch {
      // A partially written or concurrently replaced snapshot is retried next tick.
    } finally {
      syncing = false;
    }
  };
  const syncTimer = setInterval(() => {
    void sync();
  }, 200);
  tick();
  try {
    for await (const chunk of stdin) {
      const value = String(chunk);
      // The prompt is always focused, so ordinary `q` must remain typeable in
      // requests (for example, "quiet hi-hat"). Ctrl-C is the unambiguous
      // shell exit key; Ctrl-Q is reserved for prompt mode switching.
      if (value === "\u0003") break;
      // Keep the empty-prompt space shortcut for transport, while allowing
      // ordinary spaces once a request is being composed.
      if (value === " " && prompt.value.length === 0) {
        await setTransport("toggle");
        try {
          record = await appendSessionEvent(
            session.paths,
            record,
            {
              kind: "transport",
              payload: { action: "toggle", playing: clock.playing },
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
        const action = handleTerminalInput(value);
        if (action?.kind === "exit") break;
        if (
          (action?.kind === "submit" || action?.kind === "queue") &&
          action.value
        ) {
          activity = await submit(action.value);
        }
      }
      tick();
    }
  } finally {
    clearInterval(timer);
    clearInterval(syncTimer);
    audio.stop();
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
  if (value === "\u001b") return prompt.handle("ESC");
  if (value.startsWith("\u001b")) return undefined;
  let action: PromptAction | undefined;
  for (const character of Array.from(value)) action = prompt.handle(character);
  return action;
}

async function submit(prompt: string): Promise<string> {
  const modelCommand = prompt.trim().match(/^\/model\s+(opus-5\.5|sol-6\.1)$/i);
  if (modelCommand) {
    selectedModel = modelCommand[1]!.toLowerCase() as GatewayModel;
    return `model · ${selectedModel}`;
  }
  const parsed = parsePrompt(prompt);
  if (!parsed) {
    if (process.env.TRACK_AI !== "1") return `unrecognized request: ${prompt}`;
    try {
      const plan = await planComposition({
        prompt,
        score,
        trackId: requestedTrack,
        model: selectedModel,
      });
      if (plan.operations.length === 0)
        return plan.explanation ?? "agent made no changes";
      const next = applyAgentPlan(score, plan.operations);
      record = await appendSessionEvent(
        session.paths,
        record,
        { kind: "agent.plan", payload: plan },
        next.toJSON(),
      );
      score = next;
      if (clock.playing) void audio.play(score);
      return (
        plan.explanation ??
        `applied ${plan.operations.length} agent operation${plan.operations.length === 1 ? "" : "s"}`
      );
    } catch (error) {
      return `agent error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  if (parsed.type === "transport") {
    await setTransport(parsed.action);
    try {
      record = await appendSessionEvent(
        session.paths,
        record,
        {
          kind: "transport",
          payload: { action: parsed.action, playing: clock.playing },
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
  if (parsed.type !== "add-note") return "queued";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const latest =
      attempt === 0
        ? record
        : await loadSession<typeof record.composition>(session.paths);
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
      record = await appendSessionEvent(
        session.paths,
        latest,
        { kind: "score.operation", payload: operation },
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

async function setTransport(
  action: "play" | "pause" | "toggle",
): Promise<void> {
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

function applyAgentPlan(
  value: TrackScore,
  operations: readonly ScoreOperation[],
): TrackScore {
  let next = value;
  for (const operation of operations) {
    if (operation.type === "removeNote") {
      next = applyScoreOperation(next, operation);
      continue;
    }
    const note = operation.note;
    const start = "start" in note ? note.start : undefined;
    const duration = "duration" in note ? note.duration : undefined;
    const normalized: NoteInput = {
      ...note,
      trackId: note.trackId || requestedTrack,
      ...(typeof start === "number"
        ? { startTick: Math.round(start * next.ticksPerBeat) }
        : {}),
      ...(typeof duration === "number"
        ? {
            durationTicks: Math.max(
              1,
              Math.round(duration * next.ticksPerBeat),
            ),
          }
        : {}),
    };
    next = applyScoreOperation(next, { type: "addNote", note: normalized });
  }
  return next;
}
