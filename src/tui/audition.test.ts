import { describe, expect, test } from "bun:test";
import { createScore, type TrackScore } from "../../core/score.ts";
import {
  Audition,
  auditionKey,
  isStageable,
  type AuditionHost,
  type StageResult,
} from "./audition.ts";
import { applyMasterCommand, parseMasterCommand } from "../commands/master.ts";

function base(): TrackScore {
  return createScore({
    tempoBpm: 120,
    bars: 2,
    tracks: [
      { id: "lead", name: "lead", instrument: "saw", pan: 0 },
      { id: "bass", name: "bass", instrument: "sine" },
    ],
    notes: [
      {
        id: "n",
        trackId: "lead",
        pitch: 60,
        startTick: 0,
        durationTicks: 480,
        velocity: 0.8,
      },
    ],
  } as never);
}

/**
 * `pan <track> <value>` and `vol <track> <value>` edit a track; a command on
 * a missing track fails, like a real command would.
 */
function applyFake(score: TrackScore, command: string): StageResult {
  const master = parseMasterCommand(command);
  if (master) return applyMasterCommand(score, master);
  const [field, trackId, raw] = command.split(" ");
  const value = Number(raw);
  if (!score.tracks.some((track) => track.id === trackId))
    return { ok: false, message: `no track ${trackId}` };
  const key = field === "vol" ? "volume" : "pan";
  return {
    ok: true,
    message: command,
    next: score.withTracks(
      score.tracks.map((track) =>
        track.id === trackId ? { ...track, [key]: value } : track,
      ),
    ),
  };
}

function harness(score = base(), debounceMs = 40) {
  const clock = { ms: 0 };
  const played: TrackScore[] = [];
  const timers: { at: number; run: () => void }[] = [];
  let stops = 0;
  let renderMs = 0;
  const host: AuditionHost = {
    apply: async (from, command) => applyFake(from, command),
    play: async (preview) => {
      if (renderMs > 0) await Bun.sleep(5);
      clock.ms += renderMs;
      played.push(preview);
    },
    stop: () => void (stops += 1),
    leadMs: () => 60,
    now: () => clock.ms,
    setTimer: (run, ms) => {
      const timer = { at: clock.ms + ms, run };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      const index = timers.indexOf(handle as (typeof timers)[number]);
      if (index >= 0) timers.splice(index, 1);
    },
  };
  const audition = new Audition(host, score, "lead", { debounceMs });
  /** Advance the clock, firing due timers, and let renders settle. */
  const advance = async (ms: number) => {
    clock.ms += ms;
    for (const timer of [...timers])
      if (timer.at <= clock.ms) {
        timers.splice(timers.indexOf(timer), 1);
        timer.run();
      }
    await audition.settled();
    await Bun.sleep(0);
  };
  const pan = (score: TrackScore | undefined) =>
    score?.tracks.find((track) => track.id === "lead")?.pan;
  return {
    audition,
    clock,
    played,
    advance,
    pan,
    stops: () => stops,
    setRenderMs: (ms: number) => void (renderMs = ms),
  };
}

describe("audition loop", () => {
  test("Space starts the track solo; c switches to the mix; Space stops", async () => {
    const h = harness();
    expect(h.audition.staging).toBe(false);
    h.audition.start();
    await h.advance(0);
    expect(h.audition.looping).toBe(true);
    expect(h.played).toHaveLength(1);
    expect(h.played[0]!.tracks.map((track) => track.id)).toEqual(["lead"]);
    h.audition.toggleContext();
    await h.advance(50);
    expect(h.played.at(-1)!.tracks.map((track) => track.id)).toEqual([
      "lead",
      "bass",
    ]);
    expect(h.audition.status()).toContain("in context");
    h.audition.toggle();
    expect(h.audition.looping).toBe(false);
    expect(h.stops()).toBe(1);
    expect(h.audition.status()).toBeUndefined();
  });

  test("an empty track plays its default phrase", async () => {
    const h = harness();
    h.audition.focus("bass");
    h.audition.start();
    await h.advance(0);
    expect(h.audition.lastPreview?.source).toBe("phrase");
    expect(h.audition.lastPreview?.role).toBe("riff");
  });
});

describe("staging", () => {
  test("edits stage on the loop without touching the committed score", async () => {
    const h = harness();
    const committed = h.audition.committed;
    h.audition.start();
    await h.advance(0);
    await h.audition.stage("pan lead 0.5");
    await h.advance(50);
    await h.audition.stage("vol lead 0.4");
    await h.advance(50);
    expect(h.audition.committed).toBe(committed);
    expect(h.pan(h.audition.committed)).toBe(0);
    expect(h.pan(h.audition.score)).toBe(0.5);
    expect(h.audition.commands).toEqual(["pan lead 0.5", "vol lead 0.4"]);
    expect(h.audition.dirtyEdits).toBe(true);
    expect(h.audition.status()).toContain("B staged 2");
    expect(h.pan(h.played.at(-1))).toBe(0.5);
  });

  test("a failed command is not staged", async () => {
    const h = harness();
    h.audition.start();
    const result = await h.audition.stage("pan ghost 1");
    expect(result.ok).toBe(false);
    expect(h.audition.dirtyEdits).toBe(false);
  });

  test("A/B flips between the committed and staged sound", async () => {
    const h = harness();
    h.audition.start();
    await h.advance(0);
    // Nothing staged: A/B stays on B.
    h.audition.toggleAB();
    expect(h.audition.showing).toBe("B");
    await h.audition.stage("pan lead 0.5");
    await h.advance(50);
    h.audition.toggleAB();
    await h.advance(50);
    expect(h.audition.showing).toBe("A");
    expect(h.pan(h.audition.sounding)).toBe(0);
    expect(h.pan(h.played.at(-1))).toBe(0);
    expect(h.audition.status()).toContain("A committed");
    h.audition.toggleAB();
    await h.advance(50);
    expect(h.pan(h.played.at(-1))).toBe(0.5);
    // A new edit always plays B.
    h.audition.toggleAB();
    await h.audition.stage("pan lead 0.7");
    expect(h.audition.showing).toBe("B");
  });

  test("keep takes every staged edit as one score; nothing stays staged", async () => {
    const h = harness();
    h.audition.start();
    for (const value of [0.1, 0.2, 0.3])
      await h.audition.stage(`pan lead ${value}`);
    const taken = h.audition.take()!;
    expect(taken.commands).toHaveLength(3);
    expect(h.pan(taken.score)).toBe(0.3);
    expect(h.audition.dirtyEdits).toBe(false);
    h.audition.committedNow(taken.score);
    expect(h.audition.committed).toBe(taken.score);
    expect(h.audition.take()).toBeUndefined();
  });

  test("revert drops staged edits and the loop plays the committed sound", async () => {
    const h = harness();
    h.audition.start();
    await h.advance(0);
    await h.audition.stage("pan lead 0.9");
    await h.advance(50);
    h.audition.revert();
    await h.advance(50);
    expect(h.audition.dirtyEdits).toBe(false);
    expect(h.audition.score).toBe(h.audition.committed);
    expect(h.pan(h.played.at(-1))).toBe(0);
  });

  test("hovering a picker replaces its previous hover instead of stacking", async () => {
    const h = harness();
    h.audition.start();
    await h.audition.stage("vol lead 0.5");
    await h.audition.stage("pan lead 0.1", { replaceKey: "picker" });
    await h.audition.stage("pan lead 0.2", { replaceKey: "picker" });
    await h.audition.stage("pan lead 0.3", { replaceKey: "picker" });
    expect(h.audition.commands).toEqual(["vol lead 0.5", "pan lead 0.3"]);
    expect(h.pan(h.audition.score)).toBe(0.3);
  });

  test("moving fast through a list plays only the latest hover", async () => {
    const h = harness();
    h.audition.start();
    const results = await Promise.all([
      h.audition.hover("pan lead 0.1", "picker:kit"),
      h.audition.hover("pan lead 0.2", "picker:kit"),
      h.audition.hover("pan lead 0.3", "picker:kit"),
    ]);
    expect(results.map((result) => result.message)).toEqual([
      "superseded",
      "superseded",
      "pan lead 0.3",
    ]);
    expect(h.audition.commands).toEqual(["pan lead 0.3"]);
  });

  test("a slow hover (a pack fetch) overtaken mid-flight is dropped", async () => {
    const h = harness();
    let release: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => (release = resolve));
    const host = (h.audition as unknown as { host: AuditionHost }).host;
    const apply = host.apply;
    host.apply = async (from, command) => {
      if (command === "pan lead 0.9") await slow;
      return apply(from, command);
    };
    h.audition.start();
    const first = h.audition.hover("pan lead 0.9", "picker:kit");
    h.clock.ms += 300;
    expect(h.audition.fetching).toBe(true);
    const second = h.audition.hover("pan lead 0.4", "picker:kit");
    release();
    expect((await first).message).toBe("superseded");
    expect((await second).ok).toBe(true);
    expect(h.audition.commands).toEqual(["pan lead 0.4"]);
    expect(h.audition.fetching).toBe(false);
  });

  test("leaving a list drops its hover; choosing keeps it", async () => {
    const h = harness();
    h.audition.start();
    await h.audition.stage("vol lead 0.5");
    await h.audition.hover("pan lead 0.2", "menu:kits");
    await h.audition.unhover("menu:kits");
    expect(h.audition.commands).toEqual(["vol lead 0.5"]);
    expect(h.pan(h.audition.score)).toBe(0);
    await h.audition.hover("pan lead 0.7", "menu:kits");
    h.audition.settle("menu:kits");
    // A later hover in the same list stacks on the chosen one.
    await h.audition.hover("vol lead 0.9", "menu:kits");
    await h.audition.unhover("menu:kits");
    expect(h.audition.commands).toEqual(["vol lead 0.5", "pan lead 0.7"]);
  });

  test("another window's edit rebases the staged diff; a vanished target drops it", async () => {
    const h = harness();
    h.audition.start();
    await h.audition.stage("pan lead 0.5");
    // Another window changes the lead's volume and the bass's pan.
    const remote = applyFake(
      applyFake(base(), "vol lead 0.2").next!,
      "pan bass -1",
    ).next!;
    const result = await h.audition.rebase(remote);
    expect(result.dropped).toEqual([]);
    expect(h.audition.committed).toBe(remote);
    const staged = h.audition.score;
    expect(h.pan(staged)).toBe(0.5);
    expect(staged.tracks.find((t) => t.id === "lead")?.volume).toBe(0.2);
    expect(staged.tracks.find((t) => t.id === "bass")?.pan).toBe(-1);
    // Then the lead is deleted elsewhere: its staged edit cannot apply.
    const gone = remote.withTracks(
      remote.tracks.filter((t) => t.id !== "lead"),
    );
    const after = await h.audition.rebase(gone);
    expect(after.dropped).toEqual(["pan lead 0.5"]);
    expect(h.audition.dirtyEdits).toBe(false);
    expect(h.audition.score).toBe(gone);
  });
});

describe("rendering", () => {
  test("a burst of nudges renders on the trailing edge, once", async () => {
    const h = harness();
    h.audition.start();
    await h.advance(0);
    const before = h.audition.renders;
    // Ten repeats 10 ms apart, like a held arrow key.
    for (let i = 1; i <= 10; i += 1) {
      await h.audition.stage(`pan lead ${i / 10}`);
      await h.advance(10);
    }
    await h.advance(100);
    // Inside the 40 ms window repeats coalesce: far fewer renders than keys.
    expect(h.audition.renders - before).toBeLessThanOrEqual(3);
    expect(h.pan(h.played.at(-1))).toBe(1);
  });

  test("a key while a render runs coalesces into one follow-up render", async () => {
    const h = harness(base(), 0);
    h.setRenderMs(30);
    h.audition.start();
    const first = h.audition.stage("pan lead 0.1");
    const second = h.audition.stage("pan lead 0.2");
    const third = h.audition.stage("pan lead 0.3");
    await Promise.all([first, second, third]);
    await Bun.sleep(30);
    expect(h.pan(h.played.at(-1))).toBe(0.3);
    // The start render, then one follow-up for all three keys.
    expect(h.audition.renders).toBe(2);
  });

  test("latency is key to scheduled audio: render time plus the lead", async () => {
    const h = harness(base(), 0);
    h.setRenderMs(12);
    h.audition.start();
    await h.advance(0);
    await Bun.sleep(10);
    await h.audition.stage("pan lead 0.4");
    await Bun.sleep(10);
    expect(h.audition.lastLatencyMs).toBe(72);
    expect(h.audition.status()).toContain("72 ms");
  });

  test("the loop stays off until Space: staging alone renders nothing", async () => {
    const h = harness();
    await h.audition.stage("pan lead 0.4");
    expect(h.played).toHaveLength(0);
    expect(h.audition.staging).toBe(true);
  });
});

describe("keys and commands", () => {
  test("Space, a and c are the audition keys", () => {
    expect(auditionKey(" ")).toBe("loop");
    expect(auditionKey("a")).toBe("ab");
    expect(auditionKey("c")).toBe("context");
    expect(auditionKey("x")).toBeUndefined();
  });

  test("sound commands stage; transport, notes and listings do not", () => {
    for (const command of [
      "fx reverb mix 0.6",
      "/fx delay feedback 0.4",
      "synth cutoff 1200",
      "wt preset pwm",
      "kit 808",
      "vol 0.5",
      "pattern four-on-floor",
      "/pack use gm/gm_acoustic_bass",
      "pedal bars",
      "sustain off",
      "humanize 10 8 5",
      "humanize reseed",
      "vel-curve soft",
      "master glue ratio 4",
      "master target club",
    ])
      expect(isStageable(command)).toBe(true);
    for (const command of [
      "play",
      "tempo 100",
      "add a bassline",
      "fx",
      "fx list",
      "kit list",
      "pack info gm",
      "pedal",
      "humanize",
      "humanize show",
      "master measure",
      "undo",
    ])
      expect(isStageable(command)).toBe(false);
  });
});

describe("staged master edits", () => {
  test("B carries the staged master and plays the full mix; A does not", async () => {
    const h = harness();
    h.audition.start();
    await h.advance(0);
    expect(h.played.at(-1)!.tracks.map((track) => track.id)).toEqual(["lead"]);
    const result = await h.audition.stage("master glue preset pump");
    expect(result.ok).toBe(true);
    await h.advance(50);
    const b = h.played.at(-1)!;
    expect(b.master?.glue).toBeDefined();
    expect(b.tracks.map((track) => track.id)).toEqual(["lead", "bass"]);
    expect(h.audition.status()).toContain("in context");
    h.audition.toggleAB();
    await h.advance(50);
    const a = h.played.at(-1)!;
    expect(a.master).toBeUndefined();
    expect(JSON.stringify(a.toJSON())).not.toBe(JSON.stringify(b.toJSON()));
  });

  test("a bare `master <unit>` only shows the unit and does not stage", () => {
    expect(isStageable("master eq")).toBe(false);
    expect(isStageable("/master limiter")).toBe(false);
    expect(isStageable("master eq on")).toBe(true);
  });
});

describe("phrase hook", () => {
  test("the loop plays the host's phrase for A or B in place of the track's notes", async () => {
    const h = harness();
    const asked: ("A" | "B")[] = [];
    const host = (h.audition as unknown as { host: AuditionHost }).host;
    host.phrase = (showing) => {
      asked.push(showing);
      return (_score, track) => [
        {
          id: "p",
          trackId: track.id,
          pitch: showing === "A" ? 48 : 50,
          startTick: 0,
          durationTicks: 240,
          velocity: 0.8,
        },
      ];
    };
    h.audition.start();
    await h.advance(0);
    const pitches = () => h.played.at(-1)!.notes.map((note) => note.pitch);
    // Nothing staged: the committed (A) phrase plays.
    expect(asked.at(-1)).toBe("A");
    expect(pitches()).toEqual([48]);
    await h.audition.stage("pan lead 0.5");
    await h.advance(100);
    expect(asked.at(-1)).toBe("B");
    expect(pitches()).toEqual([50]);
    h.audition.toggleAB();
    await h.advance(100);
    expect(asked.at(-1)).toBe("A");
    expect(pitches()).toEqual([48]);
  });

  test("euclid commands stage like other sound edits", () => {
    expect(isStageable("euclid kick pulses 5")).toBe(true);
    expect(isStageable("euclid hat freeze")).toBe(true);
    expect(isStageable("/chords voicing 1")).toBe(false);
  });
});
