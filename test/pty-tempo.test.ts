/**
 * Project › Tempo and meter end to end: Ctrl-K, a typed tempo ramp, a nudged
 * meter change and the focused track's rate all land in the session.
 */
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

type Composition = {
  tempoBpm?: number;
  time?: {
    tempo?: { tick: number; bpm: number; ramp?: string }[];
    meter?: { bar: number; beatsPerBar: number; beatUnit?: number }[];
  };
  tracks?: { id: string; time?: { rate?: number } }[];
};

/** The newest composition record under `.dawg/`. */
async function composition(cwd: string): Promise<Composition | undefined> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    // Lock directories and presence files can vanish mid-walk.
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(
      () => [],
    )) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".json")) found.push(path);
    }
  };
  await walk(join(cwd, ".dawg"));
  for (const path of found) {
    const text = await readFile(path, "utf8").catch(() => "{}");
    if (!text.includes('"composition"')) continue;
    const parsed = JSON.parse(text) as { composition?: Composition };
    if (parsed.composition?.tracks) return parsed.composition;
  }
  return undefined;
}

async function waitFor(
  check: () => Promise<boolean>,
  label: string,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await Bun.sleep(50);
  }
  throw new Error(`timed out waiting for ${label}`);
}

test.skipIf(!supported)(
  "real PTY: tempo and meter adds a ramp, a meter change and a track rate",
  async () => {
    const t = await launch(100, 30, {});
    const song = () => composition(t.cwd);
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await t.send("\u000b");
      await t.until(() => t.vt.text().includes("Project"), "menu root");
      await t.send("/project");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("menu › Project"), "project");
      await t.send("/tempo and");
      await t.send("\r");
      await t.until(
        () => t.vt.text().includes("Project › tempo and meter"),
        "tempo and meter",
      );

      // A typed tempo ramp into bar 2.
      await t.send("/add tempo");
      await t.send("\r");
      for (const key of "90 at bar 2 ramp") await t.send(key);
      await t.send("\r");
      await waitFor(async () => {
        const event = (await song())?.time?.tempo?.[0];
        return event?.bpm === 90 && event.ramp === "linear";
      }, "tempo ramp in session");
      await t.until(() => t.vt.text().includes("tempo @ bar 2"), "event row");

      // A 7/8 bar from bar 2, then one more beat with the right arrow.
      await t.send("/add meter");
      await t.send("\r");
      for (const key of "7/8 at bar 2") await t.send(key);
      await t.send("\r");
      await t.until(() => t.vt.text().includes("meter @ bar 2"), "meter row");
      // Committing cleared the filter, so a new one starts right away.
      await t.send("/meter @");
      await t.until(
        () => t.vt.text().includes("› meter 7/8 at bar 2"),
        "meter row focused",
      );
      // Down then up ends the filter on the row; the right arrow nudges it.
      await t.send("\u001b[B");
      await t.send("\u001b[A");
      await t.send("\u001b[C");
      await waitFor(async () => {
        const change = (await song())?.time?.meter?.[0];
        return change?.beatsPerBar === 8 && change.beatUnit === 8;
      }, "meter change in session");

      // The focused track's rate, typed.
      await t.send("\u001b");
      await t.send("/bass time");
      await t.send("\r");
      await t.until(
        () => t.vt.text().includes("tempo and meter › bass time"),
        "track time",
      );
      await t.send("/rate");
      await t.send("\r");
      for (const key of "1.5") await t.send(key);
      await t.send("\r");
      await waitFor(
        async () =>
          ((await song())?.tracks ?? []).some(
            (track) => track.time?.rate === 1.5,
          ),
        "track rate in session",
      );
      expect(t.vt.text()).toContain("1.5×");

      for (let i = 0; i < 8; i++) await t.send("\u001b");
      await t.until(() => !t.vt.text().includes("menu ›"), "menu closed");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  30_000,
);
