/**
 * Records the home page hero demo from dawg's real terminal UI.
 *
 * Nothing here draws a frame by hand. The script drives the same code a dawg
 * window runs: the `TuiApp` renderer and its `ScreenWriter` diffing, the
 * activity feed's agent-event adapter, the agent's typed tools (`plan()`
 * validates every argument exactly as it does for a model's tool call), and
 * the score operations that commit each accepted call. The clock is fake, as
 * in `test/tui.test.ts`, so every run writes the same bytes.
 *
 * The output is an asciinema v2 cast: a header line, then one
 * `[seconds, "o", bytes]` event per rendered frame.
 *
 *   bun scripts/record-demo.ts           write public/demo/highway.cast
 *   bun scripts/record-demo.ts --check   fail if the checked-in cast is stale
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  applyScoreOperation,
  createScore,
  type TrackScore,
} from "../../core/score.ts";
import { findAgentTool, type ToolContext } from "../../src/agent/tools.ts";
import { drumSnapshotFields } from "../../tui/drums.ts";
import type { TrackScoreSnapshot } from "../../tui/highway.ts";
import { highwayLayers } from "../../tui/layers.ts";
import { TuiApp } from "../../tui/app.ts";
import type { TerminalCapabilities } from "../../tui/theme.ts";

export const COLS = 80;
export const ROWS = 24;
const FPS = 15;
const STEP_MS = 1000 / FPS;
const MODEL = "opus-5.5 · gateway";

const capabilities: TerminalCapabilities = {
  colorDepth: "truecolor",
  unicode: true,
};

interface Recorder {
  events: [number, string][];
  now: number;
}

function record(): string {
  const rec: Recorder = { events: [], now: 0 };
  const io = {
    write(data: string) {
      rec.events.push([Math.round(rec.now) / 1000, data]);
    },
    columns: () => COLS,
    rows: () => ROWS,
  };
  const app = new TuiApp({
    io,
    capabilities,
    clock: () => 10_000 + rec.now,
    reducedMotion: false,
  });

  let score: TrackScore = createScore({
    tempoBpm: 96,
    key: "Am",
    bars: 2,
    tracks: [{ id: "bass", name: "bass", instrument: "bass" }],
  });
  const focused = "bass";
  let revision = 1;
  let sessionName = "untitled";
  let playing = false;
  let playStartedAt = 0;
  const pausedBeat = 0;

  const beatNow = (): number => {
    const loop = score.bars * score.beatsPerBar;
    if (!playing) return pausedBeat;
    const elapsed = (rec.now - playStartedAt) / 1000;
    return (pausedBeat + (elapsed * score.tempoBpm) / 60) % loop;
  };

  const snapshot = (): TrackScoreSnapshot => {
    const value = score;
    const track = value.tracks.find((t) => t.id === focused);
    const notes = value.notes
      .filter((note) => note.trackId === focused)
      .map((note) => ({
        id: note.id,
        startBeat: note.startTick / value.ticksPerBeat,
        durationBeats: note.durationTicks / value.ticksPerBeat,
        pitch: note.pitch,
        velocity: note.velocity,
      }));
    return {
      notes,
      trackName: track?.name ?? focused,
      trackId: focused,
      sessionId: "5c1e0a7d-dawg",
      revision,
      bpm: value.tempoBpm,
      key: value.key ?? undefined,
      loopBeats: value.bars * value.beatsPerBar,
      beatsPerBar: value.beatsPerBar,
      laneCount: 24,
      currentBeat: beatNow(),
      playing,
      ...drumSnapshotFields(track?.instrument, notes),
      layers: highwayLayers(
        value.tracks,
        value.notes,
        value.ticksPerBeat,
        focused,
      ),
    };
  };

  const frame = (force = false) => {
    app.render(
      {
        score: snapshot(),
        beat: beatNow(),
        model: MODEL,
        sync: "synced",
        sessionName,
      },
      { force },
    );
  };

  const wait = (ms: number) => {
    const end = rec.now + ms;
    while (rec.now + STEP_MS <= end) {
      rec.now += STEP_MS;
      frame();
    }
    rec.now = end;
  };

  const type = (text: string, perChar = 55) => {
    for (const ch of Array.from(text)) {
      app.input(ch);
      wait(perChar);
    }
  };

  const submit = () => {
    const result = app.input("\r");
    if (
      result.type !== "action" ||
      result.action.kind !== "submit" ||
      !result.action.value
    ) {
      throw new Error("demo prompt did not submit");
    }
    return result.action.value;
  };

  /** One tool call, validated by the agent's real tool and committed as a revision. */
  const tool = (name: string, args: Record<string, unknown>, thinkMs = 700) => {
    app.activity.applyAgentEvent({ type: "tool-start", name });
    wait(thinkMs);
    const definition = findAgentTool(name);
    if (definition === undefined) throw new Error(`unknown tool ${name}`);
    const context: ToolContext = {
      score,
      focusedTrackId: focused,
      revision,
      newNoteId: (trackId, index) => `${trackId}-r${revision}-${index}`,
    };
    const plan = definition.plan(args, context);
    if (plan.kind !== "score")
      throw new Error(`demo tool ${name} is not a score edit`);
    for (const operation of plan.operations)
      score = applyScoreOperation(score, operation);
    const base = revision;
    revision += 1;
    app.activity.applyAgentEvent({
      type: "tool-applied",
      summary: plan.summary,
      name,
      baseRevision: base,
      resultRevision: revision,
      trackId: plan.trackId,
    });
    wait(450);
  };

  const stream = (text: string) => {
    for (const word of text.split(/(?<= )/u)) {
      app.activity.applyAgentEvent({ type: "text-delta", delta: word });
      wait(70);
    }
  };

  // Scene 1: an empty bass track, the prompt waiting.
  frame(true);
  wait(900);
  type("dusty minor groove at 96, drums and a bass line");
  wait(350);
  const first = submit();
  app.activity.applyAgentEvent({ type: "start", prompt: first, model: MODEL });
  wait(900);

  tool("create_track", { id: "drums", instrument: "kit" });
  tool("add_drums", {
    trackId: "drums",
    hits: [
      { voice: "kick", beat: 0, velocity: 0.95 },
      { voice: "kick", beat: 2.5, velocity: 0.8 },
      { voice: "snare", beat: 1, velocity: 0.85 },
      { voice: "snare", beat: 3, velocity: 0.85 },
      { voice: "kick", beat: 4, velocity: 0.95 },
      { voice: "kick", beat: 6.5, velocity: 0.8 },
      { voice: "snare", beat: 5, velocity: 0.85 },
      { voice: "snare", beat: 7, velocity: 0.85 },
    ],
    patterns: [{ voice: "hat", every: 0.5, velocity: 0.5 }],
  });
  tool("add_notes", {
    trackId: "bass",
    notes: [
      { pitch: "A2", start: 0, duration: 0.75, velocity: 0.95 },
      { pitch: "A2", start: 1, duration: 0.25, velocity: 0.6 },
      { pitch: "C3", start: 1.5, duration: 0.5, velocity: 0.75 },
      { pitch: "E3", start: 2.5, duration: 1, velocity: 0.85 },
      { pitch: "G2", start: 4, duration: 0.75, velocity: 0.9 },
      { pitch: "G2", start: 5, duration: 0.25, velocity: 0.6 },
      { pitch: "D3", start: 5.5, duration: 0.5, velocity: 0.7 },
      { pitch: "E3", start: 6.5, duration: 1.25, velocity: 0.8 },
    ],
  });
  stream(
    "Kick on one with a pushed and-of-three, snare on the backbeat, hats on the eighths. ",
  );
  app.activity.applyAgentEvent({
    type: "done",
    summary: "groove in Am: kick, snare, hats, 8-note bass line",
  });
  wait(300);

  // Space on an empty prompt plays; every window follows the same transport.
  playing = true;
  playStartedAt = rec.now;
  wait(2200);
  sessionName = "dusty basement funk";
  wait(2600);

  // Scene 2: a second request while the loop keeps playing.
  type("bring in some keys with a little reverb", 50);
  wait(300);
  const second = submit();
  app.activity.applyAgentEvent({ type: "start", prompt: second, model: MODEL });
  wait(700);
  tool("create_track", { id: "keys", instrument: "piano" });
  tool("add_notes", {
    trackId: "keys",
    notes: [
      { pitch: "A3", start: 0, duration: 2, velocity: 0.55 },
      { pitch: "C4", start: 0, duration: 2, velocity: 0.5 },
      { pitch: "E4", start: 0, duration: 2, velocity: 0.5 },
      { pitch: "G3", start: 4, duration: 2, velocity: 0.55 },
      { pitch: "B3", start: 4, duration: 2, velocity: 0.5 },
      { pitch: "D4", start: 4, duration: 2, velocity: 0.5 },
    ],
  });
  tool("set_effects", { trackId: "keys", reverb: { mix: 0.3, size: 0.7 } });
  app.activity.applyAgentEvent({
    type: "done",
    summary: "Am7 and G pads on keys, reverb 0.3",
  });
  wait(5200);

  const header = JSON.stringify({
    version: 2,
    width: COLS,
    height: ROWS,
    timestamp: 0,
    title: "dawg: highway demo",
    env: { TERM: "xterm-256color" },
  });
  return (
    [
      header,
      ...rec.events.map((event) => JSON.stringify([event[0], "o", event[1]])),
    ].join("\n") + "\n"
  );
}

const target = resolve(import.meta.dir, "../public/demo/highway.cast");

if (import.meta.main) {
  const cast = record();
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(target, "utf8");
    } catch {
      // A missing cast is stale too.
    }
    if (current !== cast) {
      console.error(
        "public/demo/highway.cast is stale; run `bun run demo` in site/.",
      );
      process.exit(1);
    }
    console.log("highway.cast is current");
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, cast);
    console.log(
      `wrote ${target} (${cast.length} bytes, ${cast.split("\n").length - 2} frames)`,
    );
  }
}
