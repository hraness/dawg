import { describe, expect, test } from "bun:test";
import {
  HELP_SECTIONS,
  helpLines,
  helpText,
  helpTopicLines,
  nearestCommand,
  usageHint,
} from "./help.ts";

describe("help reference", () => {
  test("groups music, session, window and keys, each command exactly once", () => {
    expect(HELP_SECTIONS.map((section) => section.group)).toEqual([
      "music",
      "session",
      "window",
      "keys",
    ]);
    const commands = HELP_SECTIONS.flatMap((section) =>
      section.entries.map((entry) => entry.command),
    );
    expect(new Set(commands).size).toBe(commands.length);
    for (const required of [
      "/help [topic]",
      "/transcript",
      "/track <name>",
      "/view focus|all",
      "/theme default|high-contrast|mono",
      "/motion on|off",
      "/tracks",
      "/status",
      "/sessions",
      "/resume [<n>|<name>|<id>]",
      "undo",
      "redo",
    ])
      expect(commands).toContain(required);
    // App commands take a slash; music words are bare.
    for (const section of HELP_SECTIONS)
      for (const entry of section.entries)
        if (section.group === "session" || section.group === "window")
          expect(entry.command.startsWith("/")).toBe(true);
        else if (section.group === "music")
          expect(entry.command.startsWith("/")).toBe(false);
  });

  test("overlay lines carry a heading per group and fit the width", () => {
    const lines = helpLines(72);
    expect(lines.filter((line) => line.startsWith("── "))).toEqual([
      "── music",
      "── session",
      "── window",
      "── keys",
    ]);
    expect(lines.every((line) => line.length <= 72)).toBe(true);
    expect(lines.some((line) => line.startsWith("pan <-1..1>"))).toBe(true);
  });

  test("the CLI block lists the same commands without the key table", () => {
    const text = helpText();
    expect(text).toContain("music:\n  play");
    expect(text).toContain("/resume [<n>|<name>|<id>]");
    expect(text).not.toContain("Ctrl-Z");
  });

  test("near-misses of known verbs get usage; free text gets nothing", () => {
    expect(usageHint("pan 3")).toBe("pan takes -1…1 · pan -0.5");
    expect(usageHint("volume 2")).toBe("volume takes 0…1 · volume 0.8");
    expect(usageHint("add H4 at 0")).toContain("add <note> at <beat>");
    expect(usageHint("/export")).toBe(
      "/export <file> · /export loop.track.json",
    );
    expect(usageHint("/foo")).toBeUndefined();
    expect(usageHint("make it swing")).toBeUndefined();
  });

  test("/help is a short task guide; /help all and /help <group> are the reference", () => {
    const guide = helpTopicLines(undefined, 72)!;
    expect(guide.filter((line) => line.startsWith("── "))).toEqual([
      "── start here",
      "── play notes",
      "── make drums",
      "── shape the sound",
      "── chords",
      "── more",
    ]);
    expect(guide.length).toBeLessThanOrEqual(30);
    expect(guide.every((line) => line.length <= 72)).toBe(true);
    expect(guide.join("\n")).toContain("ctrl-k");
    expect(helpTopicLines("all", 72)).toEqual(helpLines(72));
    expect(helpTopicLines("keys", 72)?.[0]).toBe("── keys");
    expect(helpTopicLines("/Music", 72)?.[0]).toBe("── music");
    expect(helpTopicLines("nope", 72)).toBeUndefined();
  });

  test("typos get the nearest command", () => {
    expect(nearestCommand("/clik on")).toBe("/click");
    expect(nearestCommand("/patern")).toBe("/pattern");
    expect(nearestCommand("/fx delay on")).toBe("fx");
    expect(nearestCommand("/chrods")).toBe("/chords");
    expect(nearestCommand("/zzzzzzz")).toBeUndefined();
  });
});
