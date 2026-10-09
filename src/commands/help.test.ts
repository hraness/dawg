import { describe, expect, test } from "bun:test";
import {
  HELP_SECTIONS,
  looksLikeProse,
  helpLines,
  helpText,
  helpTopicLines,
  editDistance,
  nearestCommand,
  typoFix,
  usageHint,
} from "./help.ts";

describe("help reference", () => {
  test("groups music, session, window and keys, each command exactly once", () => {
    expect(HELP_SECTIONS.map((section) => section.group)).toEqual([
      "music",
      "session",
      "window",
      "voice",
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
        if (
          section.group === "session" ||
          section.group === "window" ||
          section.group === "voice"
        )
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
      "── voice",
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
      "── shape the performance",
      "── chords",
      "── song structure",
      "── more",
    ]);
    expect(guide.length).toBeLessThanOrEqual(34);
    expect(guide.every((line) => line.length <= 72)).toBe(true);
    expect(guide.join("\n")).toContain("ctrl-k");
    expect(helpTopicLines("all", 72)).toEqual(helpLines(72));
    expect(helpTopicLines("keys", 72)?.[0]).toBe("── keys");
    expect(helpTopicLines("/Music", 72)?.[0]).toBe("── music");
    expect(helpTopicLines("nope", 72)).toBeUndefined();
    const arrange = helpTopicLines("arrange", 72)!;
    expect(arrange[0]).toBe("── arrange");
    for (const verb of ["section", "form", "build", "drop", "fill"])
      expect(arrange.some((line) => line.startsWith(`${verb} `))).toBe(true);
    expect(arrange.every((line) => line.length <= 72)).toBe(true);
  });

  test("typos get the nearest command", () => {
    expect(nearestCommand("/clik on")).toBe("/click");
    expect(nearestCommand("/patern")).toBe("/pattern");
    expect(nearestCommand("/fx delay on")).toBe("fx");
    expect(nearestCommand("/chrods")).toBe("/chords");
    expect(nearestCommand("/zzzzzzz")).toBeUndefined();
  });

  test("an adjacent swap is one edit, even in short words", () => {
    expect(nearestCommand("/hlep")).toBe("/help");
    expect(nearestCommand("/meun")).toBe("/menu");
    expect(nearestCommand("/plya")).toBe("/play");
    expect(nearestCommand("/sesions")).toBe("/sessions");
    expect(editDistance("hlep", "help")).toBe(1);
    expect(editDistance("ca", "abc")).toBe(3);
  });

  test("property: editDistance is a symmetric, bounded edit count", () => {
    let state = 0x5eed;
    const next = () => {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      return state / 4294967296;
    };
    const word = () =>
      Array.from(
        { length: Math.floor(next() * 7) },
        () => "abcde"[Math.floor(next() * 5)],
      ).join("");
    for (let run = 0; run < 2000; run += 1) {
      const a = word();
      const b = word();
      const d = editDistance(a, b);
      expect(d).toBe(editDistance(b, a));
      expect(d === 0).toBe(a === b);
      expect(d).toBeGreaterThanOrEqual(Math.abs(a.length - b.length));
      expect(d).toBeLessThanOrEqual(Math.max(a.length, b.length));
      if (a.length >= 2) {
        const i = Math.floor(next() * (a.length - 1));
        const swapped = `${a.slice(0, i)}${a[i + 1]}${a[i]}${a.slice(i + 2)}`;
        expect(editDistance(a, swapped)).toBe(swapped === a ? 0 : 1);
      }
    }
  });
});

test("a sentence starting with a command verb is a request, not a usage error", () => {
  for (const text of [
    "add a walking bass in A minor",
    "pan the hats left",
    "remove the busy hats",
  ]) {
    expect(looksLikeProse(text)).toBe(true);
    expect(usageHint(text)).toBeUndefined();
  }
  for (const text of ["pan 3", "add H4 at 0", "volume loud", "/export"])
    expect(looksLikeProse(text)).toBe(false);
  expect(usageHint("pan 3")).toBe("pan takes -1…1 · pan -0.5");
  expect(usageHint("/export")).toBeDefined();
});

test("a one-letter slip on a command whose arguments parse is suggested", () => {
  const parses = (text: string) => /^(tempo \d+|pan -?[\d.]+)$/.test(text);
  expect(typoFix("tempoo 90", parses)).toBe("tempo 90");
  expect(typoFix("pann -0.5", parses)).toBe("pan -0.5");
  // Prose after a near-verb, slash words and far words still go on.
  expect(typoFix("tempoo the song up", parses)).toBeUndefined();
  expect(typoFix("/tempoo 90", parses)).toBeUndefined();
  expect(typoFix("tmpooo 90", parses)).toBeUndefined();
  expect(typoFix("tempo 90", parses)).toBeUndefined();
});

test("grain is a known verb: a slip suggests it and usage names it", () => {
  const parses = (text: string) => /^grain \S+/.test(text);
  expect(typoFix("graen cloud", parses)).toBe("grain cloud");
  expect(usageHint("grain")).toContain("grain cloud");
});
