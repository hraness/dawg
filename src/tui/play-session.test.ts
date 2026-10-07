import { describe, expect, test } from "bun:test";
import { createScore, type TrackScore } from "../../core/score.ts";
import type { ClickBus } from "../audio/engine.ts";
import type { LiveNotePcm } from "../audio/live.ts";
import {
  PlaySession,
  quantize,
  recordOperations,
  type LiveEngine,
  type PlayHost,
} from "./play-session.ts";

class FakeEngine implements LiveEngine {
  readonly sampleRate = 22_050;
  canMonitor = true;
  lead: number | undefined;
  monitoring = false;
  click: ClickBus | undefined;
  readonly on = new Map<number, LiveNotePcm>();
  readonly off: number[] = [];
  constructor(private readonly now: () => number) {}
  get leadMs(): number {
    return this.lead ?? 200;
  }
  async monitor(on: boolean): Promise<void> {
    this.monitoring = on;
  }
  setLeadMs(ms: number | undefined): void {
    this.lead = ms;
  }
  noteOn(id: number, note: LiveNotePcm): number {
    this.on.set(id, note);
    return this.now() + this.leadMs;
  }
  noteOff(id: number): void {
    this.off.push(id);
  }
  setClick(click: ClickBus | undefined): void {
    this.click = click;
  }
}

function harness(score: TrackScore, trackId = "lead") {
  const state = {
    score,
    now: 0,
    playing: false,
    startMs: 0,
    startBeat: 0,
    commits: [] as { kind: string; payload: Record<string, unknown> }[],
    cards: [] as string[],
  };
  let ids = 0;
  const engine = new FakeEngine(() => state.now);
  const beatMs = () => 60_000 / state.score.tempoBpm;
  const host: PlayHost = {
    score: () => state.score,
    trackId: () => trackId,
    now: () => state.now,
    playing: () => state.playing,
    beatAt: (ms) =>
      state.playing
        ? state.startBeat + (ms - state.startMs) / beatMs()
        : state.startBeat,
    engine: () => engine,
    async commit(next, kind, payload) {
      state.score = next;
      state.commits.push({ kind, payload });
    },
    async startTransport(beat) {
      state.playing = true;
      state.startBeat = beat;
      state.startMs = state.now;
    },
    async stopTransport() {
      state.playing = false;
    },
    card: (text) => state.cards.push(text),
    newNoteId: () => `rec-${++ids}`,
  };
  return { state, engine, host, session: new PlaySession(host) };
}

function leadScore(): TrackScore {
  return createScore({
    tempoBpm: 120,
    bars: 2,
    tracks: [{ id: "lead", name: "keys", instrument: "piano" }],
  });
}

describe("PlaySession", () => {
  test("enter drops the lead and monitors; exit restores", async () => {
    const { session, engine } = harness(leadScore());
    await session.enter();
    expect(engine.lead).toBe(60);
    expect(engine.monitoring).toBe(true);
    await session.exit();
    expect(engine.lead).toBeUndefined();
    expect(engine.monitoring).toBe(false);
  });

  test("a note key sounds through the engine at the play lead", async () => {
    const { session, engine } = harness(leadScore());
    await session.enter();
    expect(session.press("a")).toEqual({ type: "handled" });
    expect(engine.on.size).toBe(1);
    expect(session.lastLatencyMs).toBe(60);
    expect(session.press("q")).toEqual({ type: "unmapped" });
    expect(session.press("\u001b")).toEqual({
      type: "command",
      command: "exit",
    });
  });

  test("records quantized notes once the playhead leaves the bar", async () => {
    const { session, state } = harness(leadScore());
    await session.enter();
    session.press("r");
    expect(session.armed).toBe(true);
    session.press(" "); // the caller handles space
    expect(session.startWithCountIn()).toBe(true);
    // One bar count-in at 120 BPM = 2 s.
    expect(session.header().countIn).toBe("count-in 4");
    state.now = 2_000;
    session.tick();
    expect(state.playing).toBe(true);
    expect(session.recording).toBe(true);
    // Beat 1.05 → quantized to 1 on the 1/16 grid.
    state.now = 2_000 + 525;
    session.tick();
    session.press("a");
    state.now = 2_000 + 1_000;
    session.tick();
    expect(state.commits).toHaveLength(0);
    // Into bar 2: bar 1 commits as one undo entry.
    state.now = 2_000 + 2_010;
    session.tick();
    await session.stopRecording();
    expect(state.commits).toHaveLength(1);
    expect(state.commits[0]!.kind).toBe("score.record");
    const notes = state.score.notes.filter((note) => note.trackId === "lead");
    expect(notes).toHaveLength(1);
    expect(notes[0]!.startTick).toBe(state.score.ticksPerBeat);
    expect(notes[0]!.pitch).toBe(48);
    expect(notes[0]!.durationTicks).toBe(state.score.ticksPerBeat / 4);
    expect(state.cards.at(-1)).toContain("recorded 1 note");
  });

  test("nothing records while the transport is stopped (free play)", async () => {
    const { session, state } = harness(leadScore());
    await session.enter();
    session.press("r");
    session.press("a");
    session.press("s");
    await session.stopRecording();
    expect(state.commits).toHaveLength(0);
  });

  test("count-in 0 starts at once; the click follows the count-in", async () => {
    const { session, state, engine } = harness(leadScore());
    await session.enter();
    session.press("r");
    session.setCountIn(2);
    session.startWithCountIn();
    expect(engine.click).toBeDefined();
    // Two bars of 4 beats before beat 0.
    expect(session.clickBeatAt(0)).toBe(-8);
    expect(session.clickBeatAt(500)).toBe(-7);
    state.now = 4_000;
    session.tick();
    expect(state.playing).toBe(true);
    // Click off and no count-in: silent.
    expect(session.clickBeatAt(4_500)).toBeUndefined();
    session.press("m");
    expect(session.clickBeatAt(4_500)).toBe(1);
  });

  test("/click parses on, off and volume", () => {
    const { session } = harness(leadScore());
    expect(session.clickCommand("on")).toBe("click on · 60%");
    expect(session.clickCommand("40%")).toBe("click on · 40%");
    expect(session.clickCommand("off")).toBe("click off");
    expect(session.clickCommand("loud")).toContain("usage");
  });

  test("header shows range, velocity, record and click", async () => {
    const { session } = harness(leadScore());
    await session.enter();
    session.press("x");
    session.press("v");
    session.press("r");
    const header = session.header();
    expect(header.range).toBe("C4–F5");
    expect(header.velocity).toBe(116);
    expect(header.armed).toBe(true);
    expect(header.recording).toBe(false);
    expect(header.keys).toHaveLength(18);
    expect(header.keys[0]!.label).toBe("C4");
    expect(header.keys[1]!.label).toBe("C#");
  });

  test("bass tracks sit an octave low", () => {
    const { session } = harness(
      createScore({
        tracks: [{ id: "lead", name: "b", instrument: "bass" }],
      }),
    );
    expect(session.keyboard.range).toBe("C2–F3");
  });
});

describe("recordOperations", () => {
  test("wraps into the loop, skips duplicates, replaces bars", () => {
    const tpb = leadScore().ticksPerBeat;
    let id = 0;
    const ops = recordOperations(
      createScore({
        bars: 2,
        tracks: [{ id: "lead", name: "keys", instrument: "piano" }],
        notes: [
          {
            id: "old",
            trackId: "lead",
            startTick: 4 * tpb,
            durationTicks: tpb,
            pitch: 60,
            velocity: 0.8,
          },
        ],
      }),
      {
        trackId: "lead",
        notes: [
          { pitch: 62, velocity: 64, beat: 8 + 4.1, beats: 1.1 },
          { pitch: 62, velocity: 64, beat: 4.12, beats: 0.2 },
        ],
        grid: 0.25,
        eraseBars: [1],
        newId: () => `n${++id}`,
      },
    );
    expect(ops[0]).toEqual({ type: "removeNote", noteId: "old" });
    const adds = ops.filter((op) => op.type === "addNote");
    // Beat 12.1 wraps to 4.0 in an 8-beat loop; the second is the same step.
    expect(adds).toHaveLength(1);
    expect(adds[0]!.type === "addNote" && adds[0]!.note.startTick).toBe(
      4 * tpb,
    );
    expect(adds[0]!.type === "addNote" && adds[0]!.note.durationTicks).toBe(
      tpb,
    );
  });

  test("quantize snaps to the nearest step", () => {
    expect(quantize(1.13, 0.25)).toBe(1.25);
    expect(quantize(1.12, 0.25)).toBe(1);
  });
});
