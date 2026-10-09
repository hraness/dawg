import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import { helpTopicLines, nearestCommand } from "./help.ts";
import {
  parseVocalCommand,
  runVocalCommand,
  VOCAL_VERBS,
  vocalListLines,
  type VocalVerb,
} from "./vocal.ts";

const ctx = {
  score: createScore(),
  trackId: "lead",
  cwd: "/nonexistent",
};

const demo: VocalVerb = {
  verb: "demo",
  usage: "demo <word>",
  summary: "echo a word",
  lane: "test",
  run: async (args) => ({ ok: true, message: `demo ${args}` }),
};

describe("/vocal umbrella", () => {
  test("parses bare, list and verbs with or without the slash", () => {
    expect(parseVocalCommand("/vocal")).toEqual({ kind: "list" });
    expect(parseVocalCommand("vocal list")).toEqual({ kind: "list" });
    expect(parseVocalCommand("/vocals")).toBeUndefined();
    expect(parseVocalCommand("/vocal nope")).toEqual({
      kind: "unknown",
      word: "nope",
    });
    expect(parseVocalCommand("/vocal demo hi there", [demo])).toEqual({
      kind: "verb",
      verb: demo,
      args: "hi there",
    });
  });

  test("bare /vocal lists the verb table; verbs run; errors are text", async () => {
    expect(VOCAL_VERBS).toEqual([]);
    expect(vocalListLines()).toEqual([
      "vocal: no voice tools yet in this build",
    ]);
    expect(vocalListLines([demo])).toEqual([
      "vocal <verb>:",
      "  /vocal demo <word>  echo a word",
    ]);
    const ran = await runVocalCommand(
      parseVocalCommand("vocal demo hi", [demo])!,
      ctx,
      [demo],
    );
    expect(ran).toEqual({ ok: true, message: "demo hi" });
    const broken: VocalVerb = {
      ...demo,
      run: async () => {
        throw new Error("boom");
      },
    };
    const failed = await runVocalCommand(
      { kind: "verb", verb: broken, args: "" },
      ctx,
    );
    expect(failed).toEqual({ ok: false, message: "vocal demo: boom" });
    const unknown = await runVocalCommand(parseVocalCommand("/vocal x")!, ctx);
    expect(unknown.ok).toBe(false);
  });

  test("/help prints a Voice section and typos find /vocal", () => {
    const lines = helpTopicLines("voice")!;
    expect(lines[0]).toBe("── voice");
    expect(lines.some((line) => line.startsWith("/vocal"))).toBe(true);
    expect(nearestCommand("/vocl")).toBe("/vocal");
  });
});
