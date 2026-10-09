import { describe, expect, test } from "bun:test";
import { createScore, updateTrack, type TrackScore } from "../../core/score.ts";
import { applyEditCommand, parseEditCommand } from "./edit.ts";
import { nearestCommand } from "./help.ts";
import { applyKeysCommand, newPianoTrack, parseKeysCommand } from "./keys.ts";

function song(instrument = "sine"): TrackScore {
  return createScore({
    tracks: [{ id: "p", name: "p", instrument }],
  });
}

function run(score: TrackScore, prompt: string) {
  const command = parseKeysCommand(prompt);
  expect(command).toBeDefined();
  return applyKeysCommand(score, "p", command!);
}

describe("keys command", () => {
  test("piano is a new write of the modelled grand", () => {
    for (const prompt of [
      "piano",
      "instrument piano",
      "sound grand",
      "grand",
    ]) {
      const result = run(song(), prompt);
      expect(result.ok).toBe(true);
      const track = result.next!.tracks[0]!;
      expect(track.instrument).toBe("grand");
      expect(track.keys).toEqual({ preset: "grand" });
    }
  });

  test("organ and other words are not keys commands", () => {
    expect(parseKeysCommand("organ")).toBeUndefined();
    expect(parseKeysCommand("instrument organ")).toBeUndefined();
    expect(parseKeysCommand("instrument saw")).toBeUndefined();
    expect(parseKeysCommand("piano roll")).toBeUndefined();
    expect(parseKeysCommand("keys hardness")).toBeUndefined();
    expect(parseKeysCommand("keys nope 1")).toBeUndefined();
  });

  test("presets bring their effects", () => {
    const lofi = run(song(), "piano lofi").next!.tracks[0]!;
    expect(lofi.instrument).toBe("felt");
    expect(lofi.keys).toEqual({ preset: "lofi" });
    expect(lofi.filter?.cutoff).toBe(3500);
    expect(lofi.fx?.crush).toBeDefined();
    const ballad = run(song(), "piano ballad").next!.tracks[0]!;
    expect(ballad.instrument).toBe("grand");
    expect(ballad.reverb?.mix).toBe(0.25);
  });

  test("switching presets or resetting drops the old preset's effects", () => {
    let score = run(song(), "piano lofi").next!;
    score = run(score, "piano grand").next!;
    let track = score.tracks[0]!;
    expect(track.keys).toEqual({ preset: "grand" });
    expect(track.filter).toBeUndefined();
    expect(track.fx?.crush).toBeUndefined();
    score = run(run(song(), "piano ballad").next!, "keys reset").next!;
    expect(score.tracks[0]!.reverb).toBeUndefined();
    expect(score.tracks[0]!.keys).toEqual({});
    // An effect the user edited after the preset stays.
    score = run(song(), "piano lofi").next!;
    score = updateTrack(score, "p", {
      filter: { cutoff: 900, resonance: 0.1 },
    });
    score = run(score, "piano grand").next!;
    track = score.tracks[0]!;
    expect(track.filter?.cutoff).toBe(900);
    expect(track.fx?.crush).toBeUndefined();
  });

  test("keys on the keys synth names both ways out", () => {
    const result = run(song("keys"), "keys decay 1.5");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("keys synth");
    expect(result.message).toContain("synth decay");
    expect(result.message).toContain("type piano");
  });

  test("bare lofi stays out (drum kit and crush preset); piano lofi works", () => {
    expect(parseKeysCommand("lofi")).toBeUndefined();
    expect(run(song(), "piano lofi").ok).toBe(true);
  });

  test("a new track named piano starts on the modelled grand", () => {
    expect(newPianoTrack("piano")).toMatchObject({
      instrument: "grand",
      keys: { preset: "grand" },
    });
    expect(newPianoTrack("ballad").reverb).toBeDefined();
    expect(newPianoTrack("lofi")).toEqual({});
    expect(newPianoTrack("bass")).toEqual({});
  });

  test("params set, unset and reset", () => {
    let score = run(song(), "upright").next!;
    score = run(score, "keys hardness 0.3 decay 1.5").next!;
    expect(score.tracks[0]!.keys).toEqual({
      hardness: 0.3,
      decay: 1.5,
      preset: "upright",
    });
    score = run(score, "keys hardness off").next!;
    expect(score.tracks[0]!.keys).toEqual({ decay: 1.5, preset: "upright" });
    score = run(score, "keys reset").next!;
    expect(score.tracks[0]!.keys).toEqual({});
    expect(score.tracks[0]!.instrument).toBe("upright");
    expect(run(score, "keys body felt").next!.tracks[0]!.keys).toEqual({
      body: "felt",
    });
  });

  test("keys on a legacy piano track explains instead of rewriting it", () => {
    const legacy = song("piano");
    const result = run(legacy, "keys hardness 0.4");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("type piano first");
    expect(run(legacy, "keys").message).toContain(
      "epiano wurli clav or tonewheel combo pipe for modelled keys",
    );
  });

  test("out-of-range values do not parse", () => {
    expect(parseKeysCommand("keys hardness 4")).toBeUndefined();
    expect(parseKeysCommand("keys body tuba")).toBeUndefined();
  });

  test("keys-<param> lanes parse and store through automate", () => {
    const score = run(song(), "piano").next!;
    const command = parseEditCommand(
      "automate keys-hardness points 0:0.2 4:0.9",
    );
    expect(command).toBeDefined();
    const result = applyEditCommand(score, "p", command!);
    expect(result.ok).toBe(true);
    expect(
      result.next!.tracks[0]!.fxAutomation?.["keys-hardness"],
    ).toHaveLength(2);
    expect(
      parseEditCommand("automate keys-hardness points 0:3"),
    ).toBeUndefined();
  });

  test("piano and keys are registered for typo suggestions", () => {
    expect(nearestCommand("pinao felt")).toBe("piano");
    expect(nearestCommand("kees hardness 0.3")).toBe("keys");
  });
});

describe("electric keys commands", () => {
  test("family words load their presets", () => {
    for (const [prompt, instrument, preset] of [
      ["epiano", "epiano", "epiano"],
      ["rhodes", "epiano", "epiano"],
      ["suitcase", "epiano", "suitcase"],
      ["dyno", "epiano", "dyno"],
      ["wurli", "wurli", "wurli"],
      ["wurlitzer", "wurli", "wurli"],
      ["clav", "clav", "clav"],
      ["clavinet", "clav", "clav"],
      ["funkclav", "clav", "funkclav"],
      ["instrument rhodes", "epiano", "epiano"],
      ["epiano preset suitcase", "epiano", "suitcase"],
      ["clav preset funkclav", "clav", "funkclav"],
    ] as const) {
      const result = run(song(), prompt);
      expect(result.ok).toBe(true);
      const track = result.next!.tracks[0]!;
      expect(track.instrument).toBe(instrument);
      expect(track.keys?.preset).toBe(preset);
    }
  });

  test("a family word with parameters becomes that family first", () => {
    const result = run(song("sine"), "epiano vibe 0.6 bark 0.5");
    expect(result.ok).toBe(true);
    const track = result.next!.tracks[0]!;
    expect(track.instrument).toBe("epiano");
    expect(track.keys).toEqual({ preset: "epiano", vibe: 0.6, bark: 0.5 });
    const clav = run(song(), "clav pickup bridge mute 0.4");
    expect(clav.next!.tracks[0]!.keys).toEqual({
      preset: "clav",
      pickup: "bridge",
      mute: 0.4,
    });
  });

  test("a parameter from another family is refused with the family's list", () => {
    const grand = run(song(), "grand").next!;
    const result = run(grand, "keys vibe 0.5");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("grand has no vibe");
    const clav = run(song(), "clav").next!;
    expect(run(clav, "keys felt 0.5").ok).toBe(false);
    expect(parseKeysCommand("epiano preset funkclav")).toBeUndefined();
  });

  test("a family's preset list names only its presets", () => {
    expect(run(song(), "epiano preset").message).toBe(
      "epiano presets · epiano suitcase dyno",
    );
    expect(run(song(), "clav preset").message).toBe(
      "clav presets · clav funkclav",
    );
    expect(run(song(), "keys preset").message).toContain("grand ballad");
  });

  test("electric words are registered for typo suggestions", () => {
    expect(nearestCommand("wurly")).toBe("wurli");
    expect(nearestCommand("epaino vibe 0.5")).toBe("epiano");
  });
});

describe("organ commands (f061-organ)", () => {
  test("tonewheel, combo and pipe verbs store the engine; organ stays legacy", () => {
    expect(parseKeysCommand("organ")).toBeUndefined();
    for (const [prompt, instrument, preset] of [
      ["tonewheel", "tonewheel", "tonewheel"],
      ["hammond", "tonewheel", "tonewheel"],
      ["b3", "tonewheel", "tonewheel"],
      ["gospel", "tonewheel", "gospel"],
      ["combo", "combo", "combo"],
      ["farfisa", "combo", "combo"],
      ["vox", "combo", "vox"],
      ["pipe", "pipe", "pipe"],
      ["church", "pipe", "pipe"],
      ["flutes", "pipe", "flutes"],
      ["instrument hammond", "tonewheel", "tonewheel"],
    ] as const) {
      const result = run(song(), prompt);
      expect(result.ok).toBe(true);
      const track = result.next!.tracks[0]!;
      expect(track.instrument).toBe(instrument);
      expect(track.keys?.preset).toBe(preset);
    }
  });

  test("drawbars, registers and stops shorthand", () => {
    const tw = run(song(), "tonewheel 888800008").next!.tracks[0]!;
    expect(tw.keys).toEqual({ drawbars: "888800008", preset: "tonewheel" });
    const combo = run(song(), "combo 08880").next!.tracks[0]!;
    expect(combo.keys?.registers).toBe("08880");
    const pipe = run(song(), "pipe principal8,octave4 mixture").next!
      .tracks[0]!;
    expect(pipe.keys?.stops).toBe("principal8 octave4 mixture");
    expect(parseKeysCommand("tonewheel 8888")).toBeUndefined();
    expect(parseKeysCommand("tonewheel 999999999")).toBeUndefined();
    expect(parseKeysCommand("pipe kazoo8")).toBeUndefined();
    expect(parseKeysCommand("hammond gospel")).toEqual({
      type: "keys-preset",
      preset: "gospel",
    });
  });

  test("keys rows and rotary on an organ track", () => {
    let score = run(song(), "tonewheel").next!;
    score = run(score, "keys drawbars 808000000 perc 3rd").next!;
    expect(score.tracks[0]!.keys).toMatchObject({
      drawbars: "808000000",
      perc: "3rd",
    });
    score = run(score, "rotary fast").next!;
    expect(score.tracks[0]!.keys?.rotary).toBe("fast");
    expect(parseKeysCommand("rotary warp")).toBeUndefined();
    score = run(score, "keys drawbars off").next!;
    expect(score.tracks[0]!.keys?.drawbars).toBeUndefined();
    const pipe = run(
      run(song(), "pipe").next!,
      "keys stops flute8 flute4 trem 0.4",
    ).next!.tracks[0]!;
    expect(pipe.keys).toMatchObject({ stops: "flute8 flute4", trem: 0.4 });
    const bad = run(score, "keys drawbars 12");
    expect(bad.ok).toBe(false);
    // rotary on a non-keys track names the way in.
    expect(run(song(), "rotary slow").ok).toBe(false);
  });

  test("/help knows the organ words", () => {
    expect(nearestCommand("tonewhel")).toBe("tonewheel");
    expect(nearestCommand("rotry")).toBe("rotary");
  });
});

describe("organ commands (review fixes)", () => {
  function one(instrument: string, keys?: Record<string, string>) {
    return createScore({
      tracks: [{ id: "o", name: "o", instrument, ...(keys ? { keys } : {}) }],
    } as Parameters<typeof createScore>[0]);
  }
  const run = (song: ReturnType<typeof one>, text: string) =>
    applyKeysCommand(song, "o", parseKeysCommand(text)!);

  test("rows from another family are refused with the families that read them", () => {
    const pipe = run(one("pipe"), "rotary fast");
    expect(pipe.ok).toBe(false);
    expect(pipe.message).toContain("pipe has no rotary (tonewheel/combo row)");
    expect(run(one("grand"), "keys drawbars 888000000").ok).toBe(false);
    expect(run(one("tonewheel"), "keys stops plenum").ok).toBe(false);
    expect(run(one("combo"), "keys hardness 0.5").ok).toBe(false);
    expect(run(one("tonewheel"), "rotary fast").ok).toBe(true);
  });

  test("keys on an organ lists the organ rows", () => {
    const listed = run(one("tonewheel"), "keys");
    expect(listed.message).toContain("basics drawbars perc");
    expect(listed.message).not.toContain("hardness");
  });

  test("a legacy organ track is pointed at tonewheel", () => {
    expect(run(one("organ"), "keys").message).toContain("type tonewheel");
    expect(run(one("organ"), "rotary fast").message).toContain(
      "type tonewheel",
    );
  });

  test("organ verbs take more rows and the combo voice", () => {
    expect(parseKeysCommand("tonewheel 888800008 perc 3rd")).toEqual({
      type: "keys-preset",
      preset: "tonewheel",
      values: { drawbars: "888800008", perc: "3rd" },
    });
    expect(parseKeysCommand("combo flute")).toEqual({
      type: "keys-preset",
      preset: "combo",
      values: { voice: "flute" },
    });
    const done = run(one("grand"), "tonewheel 888800008 perc 3rd");
    expect(done.ok).toBe(true);
    const track = done.next!.tracks[0]!;
    expect(track.instrument).toBe("tonewheel");
    expect(track.keys?.perc).toBe("3rd");
  });

  test("rotary fast at <beat> writes a keys-rotary point", () => {
    const done = run(one("tonewheel"), "rotary fast at 16");
    expect(done.ok).toBe(true);
    const points = done.next!.tracks[0]!.fxAutomation?.["keys-rotary"];
    expect(points).toEqual([{ tick: 16 * 480, value: 2 }]);
    expect(parseKeysCommand("rotary fast at x")).toBeUndefined();
  });
});
