import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import { STRING_PRESET_NAMES } from "../../core/strings.ts";
import { parsePrompt } from "../agent/ops.ts";
import { findAgentTool } from "../agent/tools.ts";
import { nearestCommand } from "./help.ts";
import { applyStringCommand, parseStringCommand } from "./string.ts";

const score = () =>
  createScore({
    bars: 1,
    tracks: [
      { id: "gtr", instrument: "pluck" },
      { id: "drums", instrument: "kit", kit: "syn909" },
    ],
  });

const run = (text: string, base = score(), trackId = "gtr") => {
  const command = parseStringCommand(text);
  if (!command) throw new Error(`did not parse: ${text}`);
  return applyStringCommand(base, trackId, command);
};

describe("string grammar", () => {
  test("parses list, presets, preset words, aliases and params", () => {
    expect(parseStringCommand("string")).toEqual({ type: "string-list" });
    expect(parseStringCommand("string presets")).toEqual({
      type: "string-presets",
    });
    expect(parseStringCommand("string reset")).toEqual({
      type: "string-reset",
    });
    expect(parseStringCommand("string off")).toEqual({ type: "string-off" });
    expect(parseStringCommand("string sitar")).toEqual({
      type: "string-preset",
      preset: "sitar",
    });
    expect(parseStringCommand("string preset 12string")).toEqual({
      type: "string-preset",
      preset: "jangle",
    });
    expect(parseStringCommand("string buzz 0.8 ring off")).toEqual({
      type: "string-set",
      values: { buzz: 0.8, ring: null },
    });
  });

  test("rejects unknown words and out-of-range values", () => {
    expect(parseStringCommand("strings")).toBeUndefined();
    expect(parseStringCommand("string zither")).toBeUndefined();
    expect(parseStringCommand("string buzz")).toBeUndefined();
    expect(parseStringCommand("string buzz 7")).toBeUndefined();
    expect(parseStringCommand("string wobble 1")).toBeUndefined();
  });

  test("a typo suggests the string command", () => {
    expect(nearestCommand("strng koto")).toBe("string");
  });
});

describe("string command", () => {
  test("a preset turns the engine on in one step", () => {
    const result = run("string koto");
    expect(result.ok).toBe(true);
    const track = result.next!.tracks.find((t) => t.id === "gtr")!;
    expect(track.instrument).toBe("string");
    expect(track.string).toEqual({ preset: "koto" });
    expect(result.kind).toBe("score.string");
  });

  test("params override the preset and off unsets them", () => {
    const on = run("string sitar").next!;
    const set = run("string buzz 0.5 sym 0.2", on).next!;
    expect(set.tracks[0]!.string).toEqual({
      preset: "sitar",
      buzz: 0.5,
      sym: 0.2,
    });
    const unset = run("string buzz off", set).next!;
    expect(unset.tracks[0]!.string).toEqual({ preset: "sitar", sym: 0.2 });
    const reset = run("string reset", unset).next!;
    expect(reset.tracks[0]!.string).toEqual({ preset: "sitar" });
  });

  test("params on a plain track start from the default preset", () => {
    const next = run("string ring 3").next!;
    expect(next.tracks[0]!.instrument).toBe("string");
    expect(next.tracks[0]!.string).toEqual({ preset: "nylon", ring: 3 });
  });

  test("off restores a legacy pluck voice with no string field", () => {
    const next = run("string off", run("string harp").next!).next!;
    expect(next.tracks[0]!.instrument).toBe("pluck");
    expect(next.tracks[0]!.string).toBeUndefined();
  });

  test("lists presets and refuses drum tracks", () => {
    const list = run("string presets");
    expect(list.ok).toBe(true);
    for (const name of STRING_PRESET_NAMES)
      expect(list.message).toContain(name);
    expect(run("string koto", score(), "drums").ok).toBe(false);
    expect(run("string").message).toContain("off");
  });
});

describe("set_string agent tool", () => {
  const tool = findAgentTool("set_string")!;
  const context = {
    score: score(),
    focusedTrackId: "gtr",
    revision: 1,
    newNoteId: (_trackId: string, index: number) => `n${index}`,
  };

  test("preset and params land in one updateTrack", () => {
    const plan = tool.plan(
      { preset: "sitar", params: { buzz: 0.6, sym: 0.4 } },
      context,
    );
    expect(plan.kind).toBe("score");
    if (plan.kind !== "score") return;
    expect(plan.operations).toEqual([
      {
        type: "updateTrack",
        trackId: "gtr",
        patch: {
          instrument: "string",
          string: { preset: "sitar", buzz: 0.6, sym: 0.4 },
        },
      },
    ]);
  });

  test("off clears the field; bad names explain themselves", () => {
    const on = run("string koto").next!;
    const plan = tool.plan({ off: true }, { ...context, score: on });
    if (plan.kind !== "score") throw new Error("expected a score plan");
    expect(plan.operations[0]).toMatchObject({
      patch: { instrument: "pluck", string: null },
    });
    expect(() => tool.plan({ preset: "zither" }, context)).toThrow(
      /string presets/,
    );
    expect(() => tool.plan({ params: { wobble: 1 } }, context)).toThrow(
      /no parameter wobble/,
    );
    expect(() => tool.plan({}, context)).toThrow(/needs preset/);
  });
});

describe("instrument words reach the string engine", () => {
  const context = {
    score: score(),
    focusedTrackId: "gtr",
    revision: 1,
    newNoteId: (_trackId: string, index: number) => `n${index}`,
  };

  test("`instrument nylon` writes the string preset", () => {
    expect(parsePrompt("instrument nylon")).toEqual({
      type: "track",
      patch: { instrument: "string", string: { preset: "nylon" } },
    });
    expect(parsePrompt("sound koto")).toEqual({
      type: "track",
      patch: { instrument: "string", string: { preset: "koto" } },
    });
    // Legacy words keep their voice and write no string field.
    expect(parsePrompt("instrument sitar")).toEqual({
      type: "track",
      patch: { instrument: "sitar" },
    });
  });

  test("set_instrument and create_track accept string words", () => {
    const plan = findAgentTool("set_instrument")!.plan(
      { instrument: "nylon" },
      context,
    );
    expect(plan.kind === "score" && plan.operations).toEqual([
      {
        type: "updateTrack",
        trackId: "gtr",
        patch: { instrument: "string", string: { preset: "nylon" } },
      },
    ]);
    const bare = findAgentTool("set_instrument")!.plan(
      { instrument: "string" },
      context,
    );
    expect(bare.kind === "score" && bare.operations).toEqual([
      {
        type: "updateTrack",
        trackId: "gtr",
        patch: { instrument: "string", string: { preset: "nylon" } },
      },
    ]);
    const created = findAgentTool("create_track")!.plan(
      { id: "harp", instrument: "harp" },
      context,
    );
    expect(created.kind === "score" && created.operations).toEqual([
      {
        type: "addTrack",
        track: {
          id: "harp",
          name: "harp",
          instrument: "string",
          string: { preset: "harp" },
        },
      },
    ]);
    expect(() =>
      findAgentTool("set_instrument")!.plan({ instrument: "kazoo" }, context),
    ).toThrow(/instrument must be one of/);
  });
});

describe("bowed verb (0.6.1)", () => {
  test("bowed plays cello; bowed <preset> only takes bowed presets", () => {
    expect(parseStringCommand("bowed")).toEqual({
      type: "string-preset",
      preset: "cello",
    });
    expect(parseStringCommand("bowed violins")).toEqual({
      type: "string-preset",
      preset: "violins",
    });
    expect(parseStringCommand("bowed kemence")).toEqual({
      type: "string-preset",
      preset: "kamancheh",
    });
    expect(parseStringCommand("bowed sitar")).toBeUndefined();
    expect(parseStringCommand("bowed presets")).toEqual({
      type: "string-presets",
      bowed: true,
    });
    expect(parseStringCommand("bowed pressure 0.7 sord 1")).toEqual({
      type: "string-set",
      values: { pressure: 0.7, sord: 1 },
    });
  });

  test("bowed violin stores a string track with the violin preset", () => {
    const result = run("bowed violin");
    expect(result.ok).toBe(true);
    const track = result.next!.tracks.find((t) => t.id === "gtr")!;
    expect(track.instrument).toBe("string");
    expect(track.string).toEqual({ preset: "violin" });
    const listed = run("bowed presets");
    expect(listed.message).toStartWith("bowed presets · violin");
    expect(listed.message).not.toContain("nylon");
  });

  test("bowed is a known verb for typo suggestions", () => {
    expect(nearestCommand("bowd violin")).toBe("bowed");
  });
});
