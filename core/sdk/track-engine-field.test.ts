import { describe, expect, test } from "bun:test";
import { createScore } from "../score.ts";
import { DawgSdkError, note, sing, song, track, wind } from "./v1.ts";

const scoreOf = (input: Parameters<typeof track>[0]) =>
  createScore(song({ tempo: 120, bars: 1, tracks: [track(input)] }) as never);

describe("track() takes wind: and sing: as fields", () => {
  test("wind: with instrument wind matches instrument: wind(...)", () => {
    const notes = [note(60, 0, 1)];
    const field = scoreOf({
      name: "t",
      instrument: "wind",
      wind: { preset: "trumpet" },
      notes,
    });
    const spec = scoreOf({ name: "t", instrument: wind("trumpet"), notes });
    expect(field.tracks[0]!.instrument).toBe("wind");
    expect(field.tracks[0]).toEqual(spec.tracks[0]!);
    expect((field.tracks[0] as { wind?: unknown }).wind).toBeDefined();
  });

  test("a preset word and params work without instrument", () => {
    const word = scoreOf({ name: "t", wind: "tuba" });
    expect(word.tracks[0]).toEqual(
      scoreOf({ name: "t", instrument: wind("tuba") }).tracks[0]!,
    );
    const params = scoreOf({
      name: "t",
      wind: { preset: "flute", breath: 0.4 } as never,
    });
    expect(params.tracks[0]).toEqual(
      scoreOf({
        name: "t",
        instrument: wind("flute", { breath: 0.4 } as never),
      }).tracks[0]!,
    );
    expect(scoreOf({ name: "t", sing: "choir" }).tracks[0]).toEqual(
      scoreOf({ name: "t", instrument: sing("choir") }).tracks[0]!,
    );
  });

  test("conflicts and bad values throw instead of being dropped", () => {
    expect(() =>
      track({ name: "t", instrument: "piano", wind: "trumpet" }),
    ).toThrow(DawgSdkError);
    expect(() => track({ name: "t", wind: "trumpet", sing: "choir" })).toThrow(
      DawgSdkError,
    );
    expect(() => track({ name: "t", wind: "kazoo" as never })).toThrow(
      DawgSdkError,
    );
    expect(() => track({ name: "t", wind: 3 as never })).toThrow(DawgSdkError);
  });
});
