import { describe, expect, test } from "bun:test";
import { applyScoreOperations } from "../../core/diff.ts";
import { createScore, type TrackScore } from "../../core/score.ts";
import { AGENT_TOOLS, type ToolContext } from "./tools.ts";

const song = (instrument = "sine") =>
  createScore({ tracks: [{ id: "a", name: "a", instrument }] });

const tool = (name: string) =>
  AGENT_TOOLS.find((entry) => entry.name === name)!;

function context(score: TrackScore): ToolContext {
  return {
    score,
    focusedTrackId: "a",
    revision: 1,
    newNoteId: (trackId, index) => `${trackId}-${index}`,
  };
}

function apply(
  score: TrackScore,
  name: string,
  args: Record<string, unknown>,
): TrackScore {
  const plan = tool(name).plan(args, context(score));
  if (plan.kind !== "score") throw new Error("expected a score plan");
  return applyScoreOperations(score, plan.operations);
}

describe("piano agent tools", () => {
  test("set_instrument piano writes the modelled grand; organ stays a synth", () => {
    const grand = apply(song(), "set_instrument", { instrument: "piano" });
    expect(grand.tracks[0]!.instrument).toBe("grand");
    expect(grand.tracks[0]!.keys).toEqual({ preset: "grand" });
    const upright = apply(song(), "set_instrument", { instrument: "upright" });
    expect(upright.tracks[0]!.instrument).toBe("upright");
    const saw = apply(song(), "set_instrument", { instrument: "saw" });
    expect(saw.tracks[0]!.keys).toBeUndefined();
  });

  test("create_track with a piano word stores keys and preset effects", () => {
    const score = apply(song(), "create_track", {
      id: "p",
      instrument: "lofi",
    });
    const track = score.tracks.find((t) => t.id === "p")!;
    expect(track.instrument).toBe("felt");
    expect(track.keys).toEqual({ preset: "lofi" });
    expect(track.filter?.cutoff).toBe(3500);
  });

  test("set_keys presets, params, null and reset", () => {
    let score = apply(song(), "set_keys", { preset: "honkytonk" });
    expect(score.tracks[0]!.instrument).toBe("honkytonk");
    score = apply(score, "set_keys", {
      params: { hardness: 0.7, body: "upright" },
    });
    expect(score.tracks[0]!.keys).toEqual({
      hardness: 0.7,
      body: "upright",
      preset: "honkytonk",
    });
    score = apply(score, "set_keys", { params: { hardness: null } });
    expect(score.tracks[0]!.keys?.hardness).toBeUndefined();
    score = apply(score, "set_keys", { reset: true });
    expect(score.tracks[0]!.keys).toEqual({});
    expect(() =>
      tool("set_keys").plan({ params: { tuba: 1 } }, context(score)),
    ).toThrow("no parameter");
  });

  test("set_keys on a non-piano track explains", () => {
    expect(() =>
      tool("set_keys").plan({ params: { hardness: 0.5 } }, context(song())),
    ).toThrow();
  });
});

describe("electric keys agent tools", () => {
  test("set_instrument with an electric word loads its preset", () => {
    for (const [word, instrument, preset] of [
      ["epiano", "epiano", "epiano"],
      ["rhodes", "epiano", "epiano"],
      ["suitcase", "epiano", "suitcase"],
      ["wurlitzer", "wurli", "wurli"],
      ["clavinet", "clav", "clav"],
      ["funkclav", "clav", "funkclav"],
    ] as const) {
      const next = apply(song(), "set_instrument", { instrument: word });
      expect(next.tracks[0]!.instrument).toBe(instrument);
      expect(next.tracks[0]!.keys?.preset).toBe(preset);
    }
  });

  test("set_keys sets electric params and refuses another family's", () => {
    const ep = apply(song(), "set_keys", { preset: "epiano" });
    const next = apply(ep, "set_keys", { params: { vibe: 0.6, bark: 0.5 } });
    expect(next.tracks[0]!.keys).toEqual({
      preset: "epiano",
      vibe: 0.6,
      bark: 0.5,
    });
    expect(() =>
      tool("set_keys").plan({ params: { pickup: "neck" } }, context(ep)),
    ).toThrow(/epiano has no pickup/);
    const clav = apply(song(), "set_keys", { preset: "funkclav" });
    expect(
      apply(clav, "set_keys", { params: { pickup: "neck" } }).tracks[0]!.keys!
        .pickup,
    ).toBe("neck");
    const schema = tool("set_keys").parameters as {
      properties: { preset: { enum: string[] } };
    };
    for (const name of ["epiano", "suitcase", "dyno", "wurli", "clav"])
      expect(schema.properties.preset.enum).toContain(name);
  });
});
