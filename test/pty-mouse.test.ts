/**
 * Mouse and the fader drawer end to end in a real PTY: SGR reports click
 * [+], drag the bar, pick an option and press [keep]; header pills and
 * picker rows respond; mouse reporting is off again after exit, and never
 * on with --no-mouse.
 */
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

type SessionTrack = {
  id: string;
  filter?: { cutoff: number; resonance: number; type?: string };
};

async function sessionTracks(cwd: string): Promise<SessionTrack[]> {
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
    const parsed = JSON.parse(text) as {
      composition?: { tracks?: SessionTrack[] };
    };
    if (parsed.composition?.tracks) return parsed.composition.tracks;
  }
  return [];
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

/** SGR press + release at a 0-based cell. */
const click = (x: number, y: number) =>
  `\u001b[<0;${x + 1};${y + 1}M\u001b[<0;${x + 1};${y + 1}m`;
const press = (x: number, y: number) => `\u001b[<0;${x + 1};${y + 1}M`;
const drag = (x: number, y: number) => `\u001b[<32;${x + 1};${y + 1}M`;
const release = (x: number, y: number) => `\u001b[<0;${x + 1};${y + 1}m`;
const wheel = (x: number, y: number, down: boolean) =>
  `\u001b[<${down ? 65 : 64};${x + 1};${y + 1}M`;

type Pty = Awaited<ReturnType<typeof launch>>;

/** Where `needle` is on screen (the first match from row `from`). */
function locate(t: Pty, needle: string, from = 0): { x: number; y: number } {
  const lines = t.vt.lines();
  for (let y = from; y < lines.length; y += 1) {
    const x = lines[y]!.indexOf(needle);
    if (x >= 0) return { x: Array.from(lines[y]!.slice(0, x)).length, y };
  }
  throw new Error(`"${needle}" not on screen\n${t.vt.text()}`);
}

test.skipIf(!supported)(
  "real PTY: a fader drawer driven by the mouse; mouse off after exit",
  async () => {
    const t = await launch(100, 30, {});
    const bass = async () =>
      (await sessionTracks(t.cwd)).find((track) => track.id === "bass");
    try {
      await t.until(() => t.vt.text().includes("STEER"), "prompt");
      for (const mode of ["1000", "1002", "1006"])
        expect(t.vt.mouseModes.has(mode)).toBe(true);

      // A bare `fx filter` opens the drawer on the filter's params.
      await t.send("fx filter");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("[−]"), "drawer");
      expect(t.vt.text()).toContain("cutoff");
      expect(t.vt.text()).toContain("resonance");
      // The piano roll is still visible above it.
      expect(t.vt.lines()[0]).toContain("120 BPM");

      // Click [+] on the cutoff fader: staged, not committed.
      const cutoff = locate(t, "› cutoff");
      const plus = locate(t, "[+]", cutoff.y);
      await t.send(click(plus.x + 1, plus.y));
      await t.until(() => t.vt.text().includes("● staged"), "staged");
      expect((await bass())?.filter).toBeUndefined();

      // Drag the cutoff bar to its right end, then wheel it down one notch.
      const minus = locate(t, "[−]", cutoff.y);
      await t.send(press(minus.x + 6, minus.y));
      await t.send(drag(plus.x + 20, minus.y));
      await t.send(release(plus.x + 20, minus.y));
      await t.until(() => t.vt.text().includes("20000 Hz ←"), "dragged to max");
      await t.send(wheel(minus.x + 10, minus.y, true));
      await t.until(
        () => /cutoff\s+1\d{4} Hz ←/.test(t.vt.text()),
        "wheel down",
      );

      // Pick `hpf` in the type selector.
      const hpf = locate(t, "hpf");
      await t.send(click(hpf.x, hpf.y));
      await t.until(() => /type\s+.*hpf/.test(t.vt.text()), "type row");

      // [keep] commits every staged edit as one step.
      const keep = locate(t, "[keep]");
      await t.send(click(keep.x + 2, keep.y));
      await t.until(() => t.vt.text().includes("kept"), "kept");
      await waitFor(async () => {
        const filter = (await bass())?.filter;
        return (
          filter !== undefined &&
          filter.cutoff > 1000 &&
          filter.cutoff < 20000 &&
          filter.type === "hpf"
        );
      }, "filter in session");
      await t.until(() => !t.vt.text().includes("[−]"), "drawer closed");

      // The header's BPM pill toggles the transport.
      const bpm = locate(t, "120 BPM", 0);
      expect(bpm.y).toBe(0);
      await t.send(click(bpm.x, 0));
      await t.until(() => t.vt.lines()[0]!.includes("▶"), "playing");
      await t.send(click(locate(t, "120 BPM").x, 0));
      await t.until(() => t.vt.lines()[0]!.includes("⏸"), "paused");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
    // Exiting turns every mouse mode off again.
    expect(t.vt.mouseModes.size).toBe(0);
  },
  40_000,
);

test.skipIf(!supported)(
  "real PTY: picker rows click; the wheel scrolls; Esc reverts a staged fader",
  async () => {
    const t = await launch(100, 30, {});
    try {
      await t.until(() => t.vt.text().includes("STEER"), "prompt");
      await t.send("\u000b");
      await t.until(() => t.vt.text().includes("Project"), "menu root");
      // Wheel down moves the cursor; clicking a row selects, again opens.
      await t.send(wheel(10, 5, true));
      const effects = locate(t, "Effects");
      await t.send(click(effects.x, effects.y));
      await t.until(() => t.vt.text().includes("› Effects"), "selected");
      await t.send(click(effects.x, effects.y));
      await t.until(() => t.vt.text().includes("menu › Effects"), "opened");
      const filter = locate(t, "Filter");
      await t.send(click(filter.x, filter.y));
      await t.send(click(filter.x, filter.y));
      await t.until(() => t.vt.text().includes("› Filter"), "filter");
      // Enter on a number row opens its fader; → stages, Esc reverts.
      const cutoff = locate(t, "cutoff");
      await t.send(click(cutoff.x, cutoff.y));
      await t.send(click(cutoff.x, cutoff.y));
      await t.until(() => t.vt.text().includes("[−]"), "drawer");
      await t.send("\u001b[C");
      await t.until(() => t.vt.text().includes("● staged"), "staged");
      await t.send("\u001b");
      await t.until(() => !t.vt.text().includes("● staged"), "reverted");
      await t.until(() => !t.vt.text().includes("[−]"), "drawer closed");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
    expect(t.vt.mouseModes.size).toBe(0);
  },
  30_000,
);

test.skipIf(!supported)(
  "real PTY: SIGTERM turns mouse reporting off",
  async () => {
    const t = await launch(80, 24, {});
    await t.until(() => t.vt.text().includes("STEER"), "prompt");
    expect(t.vt.mouseModes.size).toBe(3);
    t.proc.kill("SIGTERM");
    expect(await t.proc.exited).toBe(143);
    await Bun.sleep(50);
    expect(t.vt.mouseModes.size).toBe(0);
  },
  20_000,
);

test.skipIf(!supported)(
  "real PTY: --no-mouse and DAWG_MOUSE=0 never enable reporting",
  async () => {
    for (const [env, argv] of [
      [{}, ["--track", "bass", "--no-mouse"]],
      [{ DAWG_MOUSE: "0" }, ["--track", "bass"]],
    ] as const) {
      const t = await launch(80, 24, env, [...argv]);
      try {
        await t.until(() => t.vt.text().includes("STEER"), "prompt");
        expect(t.vt.mouseModes.size).toBe(0);
        // Keys still drive the drawer.
        await t.send("volume");
        await t.send("\r");
        await t.until(() => t.vt.text().includes("[−]"), "drawer");
        await t.send("\u001b");
        await t.until(() => !t.vt.text().includes("[−]"), "closed");
      } finally {
        t.terminal.write("\u0003");
        await t.proc.exited;
      }
    }
  },
  30_000,
);
