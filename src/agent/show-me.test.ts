import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import {
  CommandLines,
  finishHint,
  gestureFor,
  glideValues,
  brokenCommandReceipt,
  isAgentCommand,
  isBrokenCommand,
  keyForPitch,
  menuPathFor,
  NoteScheduler,
  parseShowMe,
  toolCaption,
} from "./show-me.ts";

const score = createScore({
  tracks: [
    { id: "main", instrument: "saw" },
    { id: "drums", instrument: "kit" },
  ],
});

describe("CommandLines", () => {
  test("reports the partial line as it grows and completes on newline", () => {
    const lines = new CommandLines();
    expect(lines.push("tem")).toEqual({ complete: [], partial: "tem" });
    expect(lines.push("po 96\nfx rev")).toEqual({
      complete: ["tempo 96"],
      partial: "fx rev",
    });
    expect(lines.push("erb mix 0.4\n")).toEqual({
      complete: ["fx reverb mix 0.4"],
      partial: "",
    });
    expect(lines.flush()).toBeUndefined();
  });

  test("strips fences, bullets, prompts and backticks; flushes the tail", () => {
    const lines = new CommandLines();
    const { complete } = lines.push(
      "```\n- tempo 90\n$ add C4 at 0\n`volume 0.5`\n1. pan -0.2\n```\n",
    );
    expect(complete).toEqual([
      "tempo 90",
      "add C4 at 0",
      "volume 0.5",
      "pan -0.2",
    ]);
    lines.push("track bass");
    expect(lines.flush()).toBe("/track bass");
  });
});

describe("isAgentCommand", () => {
  test("accepts commands a human types and rejects prose", () => {
    expect(isAgentCommand("tempo 96", score)).toBe(true);
    expect(isAgentCommand("add C4 at 0 for 0.5", score)).toBe(true);
    expect(isAgentCommand("/track bass", score)).toBe(true);
    expect(
      isAgentCommand("Set the tempo to 96 so it feels relaxed.", score),
    ).toBe(false);
    expect(isAgentCommand("", score)).toBe(false);
  });

  test("never runs window-only commands for the agent", () => {
    expect(isAgentCommand("/quit", score)).toBe(false);
    expect(isAgentCommand("/showme off", score)).toBe(false);
  });

  test("keeps agent file paths inside the workspace", () => {
    expect(isAgentCommand("export mix.wav", score)).toBe(true);
    expect(isAgentCommand("export mix/song.mid", score)).toBe(true);
    expect(isAgentCommand("export /tmp/x.wav", score)).toBe(false);
    expect(isAgentCommand("export ../x.wav", score)).toBe(false);
    expect(isAgentCommand("/export ~/.zshrc", score)).toBe(false);
    expect(isAgentCommand("import /etc/passwd", score)).toBe(false);
    expect(isAgentCommand("/sample ../../a.wav as a", score)).toBe(false);
    expect(isAgentCommand("tuning scl /tmp/a.scl", score)).toBe(false);
  });
});

describe("gestures", () => {
  test("a parameter value is a fader slide with the menu path", () => {
    const gesture = gestureFor("fx reverb mix 0.4", { score, trackId: "main" });
    expect(gesture.kind).toBe("fader");
    if (gesture.kind !== "fader") return;
    expect(gesture.param).toBe("fx reverb mix");
    expect(gesture.value).toBe(0.4);
    expect(gesture.caption).toContain("fx reverb mix");
    expect(menuPathFor("fx reverb mix 0.4")).toBe("Ctrl-K › Effects › reverb");
    expect(menuPathFor("volume 0.7")).toBe("Ctrl-K › Mix › volume");
    expect(menuPathFor("tuning just")).toBe("Ctrl-K › Chords and key › tuning");
  });

  test("a note names its play-mode key and octave keys", () => {
    expect(keyForPitch(60, 60)).toEqual({ key: "a", octave: "" });
    expect(keyForPitch(72, 60).octave).toBe("");
    const up = keyForPitch(86, 60);
    expect(up.octave).toMatch(/^x+$/);
    const gesture = gestureFor("add C4 at 1 for 0.5", {
      score,
      trackId: "main",
    });
    expect(gesture.kind).toBe("keys");
    if (gesture.kind !== "keys") return;
    expect(gesture.notes).toHaveLength(1);
    expect(gesture.notes[0]!.start).toBe(1);
    expect(gesture.caption).toMatch(/^playing on keys: /);
    expect(gesture.caption).toContain("ctrl-p play mode");
  });

  test("drum hits and patterns show the drum key mapping", () => {
    const hit = gestureFor("hit kick at 0", { score, trackId: "drums" });
    expect(hit.kind).toBe("keys");
    expect(hit.caption).toContain("(kick)");
    const pattern = gestureFor("pattern hat 0 0.5 1 1.5", {
      score,
      trackId: "drums",
    });
    expect(pattern.kind).toBe("keys");
    if (pattern.kind === "keys") expect(pattern.notes).toHaveLength(4);
    expect(pattern.caption).toContain("×4");
  });

  test("anything else is the typed command", () => {
    expect(gestureFor("tempo 96", { score, trackId: "main" })).toEqual({
      kind: "typed",
      command: "tempo 96",
      caption: "typing tempo 96",
    });
  });

  test("the finish hint names the command and the menu path", () => {
    expect(finishHint([])).toBeUndefined();
    expect(finishHint(["tempo 96", "fx reverb mix 0.4"])).toBe(
      "do it yourself: type fx reverb mix 0.4 (+1 more in ^o log) · or Ctrl-K › Effects › reverb",
    );
  });

  test("/showme levels", () => {
    expect(parseShowMe("ON")).toBe("on");
    expect(parseShowMe("quiet")).toBe("quiet");
    expect(parseShowMe("off")).toBe("off");
    expect(parseShowMe("fast")).toBeUndefined();
  });
});

describe("fader glide", () => {
  test("eases through intermediate values and ends on the target", () => {
    const values = glideValues(0.1, 0.5);
    expect(values.at(-1)).toBe(0.5);
    expect(values.length).toBe(5);
    for (let index = 1; index < values.length; index += 1)
      expect(values[index]!).toBeGreaterThan(values[index - 1]!);
    // Audio-safe: ≤ 200 ms total at the default step.
    expect(values.length * 30).toBeLessThanOrEqual(200);
  });

  test("no glide when the value does not move", () => {
    expect(glideValues(0.5, 0.5)).toEqual([0.5]);
    expect(glideValues(Number.NaN, 0.5)).toEqual([0.5]);
  });
});

describe("NoteScheduler (fake clock)", () => {
  test("a stream ahead of the tempo stays on the grid", () => {
    const scheduler = new NoteScheduler(() => 120); // 500 ms per beat
    expect(scheduler.schedule(0, 1_000)).toEqual({
      atMs: 1_000,
      mode: "in-time",
    });
    // Arrives 10 ms later but is due one beat after the first.
    expect(scheduler.schedule(1, 1_010)).toEqual({
      atMs: 1_500,
      mode: "in-time",
    });
    expect(scheduler.schedule(1.5, 1_020)).toEqual({
      atMs: 1_750,
      mode: "in-time",
    });
  });

  test("a stream slower than the tempo is step entry, never stalled", () => {
    const scheduler = new NoteScheduler(() => 120);
    scheduler.schedule(0, 0);
    // Beat 1 was due at 500 ms; it arrives at 2 s and plays at once.
    expect(scheduler.schedule(1, 2_000)).toEqual({ atMs: 2_000, mode: "step" });
    // The next keeps its spacing from the new anchor.
    expect(scheduler.schedule(2, 2_100)).toEqual({
      atMs: 2_500,
      mode: "in-time",
    });
  });

  test("an earlier beat starts a new phrase; reset clears", () => {
    const scheduler = new NoteScheduler(() => 60);
    scheduler.schedule(4, 0);
    expect(scheduler.schedule(0, 100)).toEqual({ atMs: 100, mode: "in-time" });
    scheduler.reset();
    expect(scheduler.schedule(8, 300)).toEqual({ atMs: 300, mode: "in-time" });
  });
});

describe("toolCaption", () => {
  test("media tools name the dawg media verb", () => {
    expect(toolCaption("split_stems")).toContain("dawg media stems");
    expect(toolCaption("download_audio")).toContain("dawg media download");
    expect(toolCaption("edit_file")).toContain("song.ts");
    expect(toolCaption("explain")).toBeUndefined();
  });
});

describe("broken agent commands", () => {
  test("a bare pattern or kit line is a command", () => {
    expect(isAgentCommand("pattern house", score)).toBe(true);
    expect(isAgentCommand("kit 808", score)).toBe(true);
  });

  test("a command-looking line that fails to parse is a red receipt", () => {
    expect(isBrokenCommand("/tempp 120", score)).toBe(true);
    expect(isBrokenCommand("tempp 120", score)).toBe(true);
    expect(isBrokenCommand("pan 3", score)).toBe(true);
    const receipt = brokenCommandReceipt("tempp 120");
    expect(receipt.startsWith("✗ tempp 120 · ")).toBe(true);
    expect(receipt).toContain("did you mean tempo 120?");
    expect(brokenCommandReceipt("pan 3")).toContain("pan");
  });

  test("an unknown pattern or kit name is a red receipt with the nearest", () => {
    expect(isAgentCommand("pattern housee", score)).toBe(false);
    expect(isBrokenCommand("pattern housee", score)).toBe(true);
    expect(brokenCommandReceipt("pattern housee")).toBe(
      "✗ pattern housee · did you mean pattern house?",
    );
    expect(brokenCommandReceipt("patern house")).toBe(
      "✗ patern house · did you mean pattern house?",
    );
    expect(brokenCommandReceipt("kit 8o8")).toBe(
      "✗ kit 8o8 · did you mean kit 808?",
    );
    expect(brokenCommandReceipt("pattern zzzzqq")).toContain("pattern list");
    // A pack bank name is left to the prompt bar.
    expect(isAgentCommand("kit RolandTR909", score)).toBe(true);
    expect(isAgentCommand("pattern house keep", score)).toBe(true);
  });

  test("prose and working commands are not broken commands", () => {
    expect(isBrokenCommand("Added a walking bass in A minor.", score)).toBe(
      false,
    );
    expect(isBrokenCommand("tempo 120", score)).toBe(false);
    expect(isBrokenCommand("sounds good, more reverb next", score)).toBe(false);
  });
});
