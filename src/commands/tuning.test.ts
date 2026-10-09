import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createScore, scoreFromJSON } from "../../core/score.ts";
import { parsePrompt } from "../agent/ops.ts";
import { nearestCommand } from "./help.ts";
import {
  applyTuningCommand,
  importTuningFile,
  parseTuningCommand,
  scaleLibraryLines,
  tuningLibraryLines,
} from "./tuning.ts";

const score = () =>
  createScore({
    bars: 1,
    tracks: [{ id: "lead", instrument: "saw" }],
  });

const SCL = `! test.scl
!
Test 5-tone scale
 5
!
 200.0
 9/8 a ratio with a comment
 3/2
 1600/1000
 2/1
`;

const KBM = `! test.kbm
5
0
127
60
69
440.0
5
0
1
2
x
4
`;

const files: Record<string, string> = {
  "tunings/test.scl": SCL,
  "tunings/test.kbm": KBM,
};
const read = (path: string) => files[path];

const run = (text: string, base = score()) => {
  const command = parseTuningCommand(text);
  if (!command) throw new Error(`did not parse: ${text}`);
  return applyTuningCommand(base, "lead", command, read);
};

describe("tuning grammar", () => {
  test("parses names, tables, files, reference, root, map and targets", () => {
    expect(parseTuningCommand("tuning")).toEqual({ type: "tuning-show" });
    expect(parseTuningCommand("/tuning list")).toEqual({ type: "tuning-list" });
    expect(parseTuningCommand("tuning 19-edo")).toEqual({
      type: "tuning-set",
      target: "song",
      patch: { name: "19-edo" },
    });
    expect(parseTuningCommand("tuning 22")).toEqual({
      type: "tuning-set",
      target: "song",
      patch: { edo: 22 },
    });
    expect(parseTuningCommand("tuning edo 53")).toMatchObject({
      patch: { edo: 53 },
    });
    expect(parseTuningCommand("tuning ratios 9/8 5/4 3/2 2/1")).toMatchObject({
      patch: { ratios: ["9/8", "5/4", "3/2", "2/1"] },
    });
    expect(
      parseTuningCommand("tuning cents 240 480 720 960 1200"),
    ).toMatchObject({ patch: { cents: [240, 480, 720, 960, 1200] } });
    expect(
      parseTuningCommand("tuning scl tunings/a.scl kbm tunings/a.kbm"),
    ).toMatchObject({ patch: { scl: "tunings/a.scl", kbm: "tunings/a.kbm" } });
    expect(parseTuningCommand("tuning ref 432hz")).toMatchObject({
      patch: { ref: 432 },
    });
    expect(parseTuningCommand("tuning ref off")).toMatchObject({
      patch: { ref: null },
    });
    expect(parseTuningCommand("tuning root D4")).toMatchObject({
      patch: { root: 62 },
    });
    expect(parseTuningCommand("tuning root C")).toMatchObject({
      patch: { root: 60 },
    });
    expect(parseTuningCommand("tuning root Bb")).toMatchObject({
      patch: { root: 70 },
    });
    expect(parseTuningCommand("tuning root auto")).toMatchObject({
      patch: { root: null },
    });
    expect(parseTuningCommand("tuning map nearest")).toMatchObject({
      patch: { map: "nearest" },
    });
    expect(parseTuningCommand("tuning track pelog")).toEqual({
      type: "tuning-set",
      target: "track",
      patch: { name: "pelog" },
    });
    expect(parseTuningCommand("tuning track")).toEqual({
      type: "tuning-show",
    });
    expect(parseTuningCommand("tuning track off")).toEqual({
      type: "tuning-off",
      target: "track",
    });
    expect(parseTuningCommand("tuning off")).toEqual({
      type: "tuning-off",
      target: "song",
    });
    // Not tuning commands, or malformed.
    expect(parseTuningCommand("tuning nonsense-name")).toBeUndefined();
    expect(parseTuningCommand("tuning edo")).toBeUndefined();
    expect(parseTuningCommand("tuning root H9")).toBeUndefined();
    expect(parseTuningCommand("tempo 120")).toBeUndefined();
  });

  test("parses scale commands with and without a tonic", () => {
    expect(parseTuningCommand("scale")).toEqual({ type: "scale-show" });
    expect(parseTuningCommand("scale list")).toEqual({ type: "scale-list" });
    expect(parseTuningCommand("scale D hijaz")).toEqual({
      type: "scale-set",
      key: "D hijaz",
    });
    expect(parseTuningCommand("scale Am")).toEqual({
      type: "scale-set",
      key: "A minor",
    });
    expect(parseTuningCommand("scale yaman")).toEqual({
      type: "scale-set",
      scale: "yaman",
    });
    expect(parseTuningCommand("scale messiaen-3")).toEqual({
      type: "scale-set",
      scale: "messiaen-3",
    });
    expect(parseTuningCommand("scale not-a-scale")).toBeUndefined();
  });

  test("help knows the new verbs", () => {
    expect(nearestCommand("tunign 19-edo")).toBe("tuning");
    expect(nearestCommand("scal D hijaz")).toBe("scale");
  });
});

describe("applying tuning commands", () => {
  test("a library tuning sets the song tuning and survives JSON", () => {
    const result = run("tuning 19-edo");
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("score.tuning");
    expect(result.next!.tuning).toEqual({ name: "19-edo" });
    const back = scoreFromJSON(JSON.parse(JSON.stringify(result.next)));
    expect(back.tuning).toEqual({ name: "19-edo" });
  });

  test("ref and root keep the table; a new table keeps ref and root", () => {
    let next = run("tuning just").next!;
    next = run("tuning ref 432", next).next!;
    next = run("tuning root D4", next).next!;
    expect(next.tuning).toEqual({ name: "just", ref: 432, root: 62 });
    next = run("tuning edo 31", next).next!;
    expect(next.tuning).toEqual({ edo: 31, ref: 432, root: 62 });
    next = run("tuning ref off", next).next!;
    expect(next.tuning).toEqual({ edo: 31, root: 62 });
    expect(run("tuning off", next).next!.tuning).toBeUndefined();
  });

  test("a reference alone tunes 12-TET to it", () => {
    const next = run("tuning ref 415").next!;
    expect(next.tuning).toEqual({ ref: 415 });
  });

  test("Scala files load from the project and the table is resolved", () => {
    const next = run("tuning scl tunings/test.scl").next!;
    expect(next.tuning?.scl).toBe("tunings/test.scl");
    expect(next.tuning?.cents?.length).toBe(5);
    const mapped = run("tuning kbm tunings/test.kbm", next).next!;
    expect(mapped.tuning?.kbm).toBe("tunings/test.kbm");
    expect(mapped.tuning?.keymap?.refHz).toBe(440);
    // A keyboard map sets its own reference.
    const refused = run("tuning ref 432", mapped);
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain("kbm off");
    const unmapped = run("tuning kbm off", mapped).next!;
    expect(unmapped.tuning?.kbm).toBeUndefined();
    expect(unmapped.tuning?.keymap).toBeUndefined();
  });

  test("a missing or invalid Scala file fails with the path", () => {
    const missing = run("tuning scl tunings/nope.scl");
    expect(missing.ok).toBe(false);
    expect(missing.message).toContain("tunings/nope.scl");
    files["tunings/bad.scl"] = "bad\n3\n100.0\n";
    const bad = run("tuning scl tunings/bad.scl");
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain("tunings/bad.scl");
  });

  test("track tuning overrides and track off follows the song", () => {
    const tuned = run("tuning track pelog");
    expect(tuned.kind).toBe("score.track");
    const track = tuned.next!.tracks.find((item) => item.id === "lead")!;
    expect(track.tuning).toEqual({ name: "pelog" });
    expect(tuned.message).toContain("lead");
    const cleared = run("tuning track off", tuned.next!).next!;
    expect(
      cleared.tracks.find((item) => item.id === "lead")!.tuning,
    ).toBeUndefined();
    const shown = run("tuning", tuned.next!);
    expect(shown.message).toContain("song 12-tet (default)");
    expect(shown.message).toContain("lead pelog");
  });

  test("out-of-range values fail without a change", () => {
    const result = run("tuning edo 9999");
    expect(result.ok).toBe(false);
    expect(result.next).toBeUndefined();
    expect(run("tuning ref 5").ok).toBe(false);
  });

  test("scale keeps the tonic or sets the whole key", () => {
    const base = scoreFromJSON({ ...score().toJSON(), key: "D minor" });
    const kept = run("scale bayati", base);
    expect(kept.next!.key).toBe("D bayati");
    expect(kept.message).toContain("tuning bayati");
    const whole = run("scale E phrygian", base);
    expect(whole.next!.key).toBe("E phrygian");
    expect(run("scale", whole.next!).message).toBe(
      "scale · E phrygian · 0 1 3 5 7 8 10",
    );
    expect(run("scale yaman").next!.key).toBe("C yaman");
  });

  test("the library panels list every tuning and scale", () => {
    const tunings = tuningLibraryLines().join("\n");
    for (const name of ["19-edo", "pelog", "slendro", "well-tuned-piano"])
      expect(tunings).toContain(name);
    expect(tunings).toContain("(approximate)");
    const scales = scaleLibraryLines().join("\n");
    for (const name of ["dorian", "hijaz", "yaman", "messiaen-7"])
      expect(scales).toContain(name);
    const listed = run("tuning list");
    expect(listed.panel?.title).toBe("tunings");
  });
});

describe("note cents in the prompt grammar", () => {
  test("cents <id> <±c> updates one note; 0 clears it", () => {
    expect(parsePrompt("cents n3 -14")).toEqual({
      type: "update-note",
      noteId: "n3",
      patch: { cents: -14 },
    });
    expect(parsePrompt("detune lead-2 +50c")).toEqual({
      type: "update-note",
      noteId: "lead-2",
      patch: { cents: 50 },
    });
    expect(parsePrompt("cents n3 2000")).toBeUndefined();
  });

  test("add takes an E4-14c pitch", () => {
    expect(parsePrompt("add E4-14c at 2")).toEqual({
      type: "add-note",
      pitch: 64,
      start: 2,
      duration: 1,
      velocity: 0.8,
      cents: -14,
    });
    expect(parsePrompt("add C4 at 0")).toEqual({
      type: "add-note",
      pitch: 60,
      start: 0,
      duration: 1,
      velocity: 0.8,
    });
  });
});

describe("importing Scala files", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0))
      await rm(dir, { recursive: true, force: true });
  });

  test("a file inside the project keeps its path; outside is copied", async () => {
    const project = await mkdtemp(join(tmpdir(), "dawg-tuning-project-"));
    const outside = await mkdtemp(join(tmpdir(), "dawg-tuning-outside-"));
    dirs.push(project, outside);
    await writeFile(join(project, "mine.scl"), SCL);
    expect(await importTuningFile(project, project, "mine.scl")).toBe(
      "mine.scl",
    );
    await writeFile(join(outside, "far away.scl"), SCL);
    const copied = await importTuningFile(
      project,
      project,
      join(outside, "far away.scl"),
    );
    expect(copied).toBe("tunings/far-away.scl");
    expect(await readFile(join(project, copied), "utf8")).toBe(SCL);
    // The same file again reuses the copy; a different one gets a number.
    expect(
      await importTuningFile(project, project, join(outside, "far away.scl")),
    ).toBe(copied);
    await writeFile(join(outside, "far away.scl"), `${SCL}\n`);
    expect(
      await importTuningFile(project, project, join(outside, "far away.scl")),
    ).toBe("tunings/far-away-2.scl");
    await expect(
      importTuningFile(project, project, join(outside, "missing.scl")),
    ).rejects.toThrow("not found");
  });
});
