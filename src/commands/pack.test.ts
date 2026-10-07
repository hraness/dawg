import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import {
  kitTarget,
  normalizeSoundRef,
  parseKitCommand,
  parsePackCommand,
  voiceNameForSound,
} from "./pack.ts";

describe("/pack and /kit parsing", () => {
  test("pack verbs", () => {
    expect(parsePackCommand("/pack")).toEqual({ kind: "list" });
    expect(parsePackCommand("/pack list")).toEqual({ kind: "list" });
    expect(parsePackCommand("/pack add github:user/repo as mine")).toEqual({
      kind: "add",
      source: "github:user/repo",
      name: "mine",
    });
    expect(parsePackCommand("/pack info vcsl")).toEqual({
      kind: "info",
      name: "vcsl",
    });
    expect(parsePackCommand("/pack remove x")).toEqual({
      kind: "remove",
      name: "x",
    });
    expect(parsePackCommand("/pack use dirt-samples/bd:3 as boom")).toEqual({
      kind: "use",
      sound: "dirt-samples/bd:3",
      voice: "boom",
    });
    expect(parsePackCommand("/pack add")?.kind).toBe("usage");
    expect(parsePackCommand("/packer")).toBeUndefined();
  });

  test("kit", () => {
    expect(parseKitCommand("/kit")).toEqual({ kind: "set", bank: "909" });
    expect(parseKitCommand("/kit RolandTR808")).toEqual({
      kind: "set",
      bank: "RolandTR808",
    });
    expect(parseKitCommand("/kit list")).toEqual({ kind: "list" });
  });

  test("refs and voice names", () => {
    expect(normalizeSoundRef("vcsl/bongo:2")).toBe("pack:vcsl/bongo:2");
    expect(normalizeSoundRef("nope")).toBeUndefined();
    expect(voiceNameForSound("RolandTR909_bd", 0)).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  test("/kit leaves a melodic track with notes alone", () => {
    const score = createScore({
      tracks: [{ id: "bass", name: "bass", instrument: "bass" }],
      notes: [
        {
          id: "n1",
          trackId: "bass",
          pitch: 40,
          startTick: 0,
          durationTicks: 96,
          velocity: 0.8,
        },
      ],
    });
    expect(kitTarget(score, "bass")).toBeUndefined();
    expect(kitTarget(score, "drums")).toBe("drums");
  });
});
