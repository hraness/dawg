/**
 * Resizing in a real PTY: drag-resize bursts (dozens of SIGWINCHes) while
 * playing, mid-menu, mid-show-me, on the drawer and on TAPE, through the
 * too-small screen and back. Each burst coalesces into a few full repaints
 * (never one per event), the settled frame has no stale cells, wraps or
 * scrolls, and the screen's state (playback, menu path, selected knob, TAPE
 * range, the streaming agent reply) is exactly what it was.
 */
import { afterAll, expect, test } from "bun:test";
import { launch, supported } from "./pty-harness.ts";
import { agentEnv, SCENARIOS, stopGateway } from "./sizes-lib.ts";

afterAll(stopGateway);

type Pty = Awaited<ReturnType<typeof launch>>;

/** One drag: `steps` sizes from `from` to `to`, a SIGWINCH every `gapMs`. */
async function drag(
  t: Pty,
  from: readonly [number, number],
  to: readonly [number, number],
  steps = 24,
  gapMs = 6,
): Promise<void> {
  for (let i = 1; i <= steps; i += 1) {
    const cols = Math.round(from[0] + ((to[0] - from[0]) * i) / steps);
    const rows = Math.round(from[1] + ((to[1] - from[1]) * i) / steps);
    t.vt.resize(cols, rows);
    t.terminal.resize(cols, rows);
    await Bun.sleep(gapMs);
  }
}

/** Wait for the settled frame: a repaint after the last resize, then quiet. */
async function settle(t: Pty, clearsBefore: number): Promise<void> {
  await t.until(() => t.vt.clears > clearsBefore, "repaint after resize");
  let bytes = t.vt.bytes;
  let quiet = Date.now();
  const deadline = Date.now() + 3000;
  while (Date.now() - quiet < 150 && Date.now() < deadline) {
    await Bun.sleep(20);
    if (t.vt.bytes !== bytes) {
      bytes = t.vt.bytes;
      quiet = Date.now();
    }
  }
}

function expectClean(t: Pty, cols: number, rows: number): void {
  expect(t.proc.exitCode).toBeNull();
  expect(t.vt.wrapsSinceClear).toBe(0);
  expect(t.vt.scrollsSinceClear).toBe(0);
  expect(t.vt.cells.length).toBe(rows);
  expect(t.vt.cells.every((row) => row.length === cols)).toBe(true);
  const lines = t.vt.lines();
  expect(lines[0]!.trim().length).toBeGreaterThan(0);
  expect(lines[rows - 1]!.trim().length).toBeGreaterThan(0);
  expect(t.vt.text()).not.toContain("too small");
}

/** Shrink below the minimum, back up, and out wide: three drags. */
async function shake(t: Pty, start: readonly [number, number]) {
  const clears = t.vt.clears;
  await drag(t, start, [34, 10]);
  await drag(t, [34, 10], [200, 60]);
  await drag(t, [200, 60], [96, 28]);
  // 72 SIGWINCHes in ~0.5 s: the frame gate (33 ms) coalesces them.
  const repaints = t.vt.clears - clears;
  await settle(t, clears + repaints - 1);
  return { events: 72, repaints: t.vt.clears - clears };
}

async function open(name: string, env: Record<string, string> = {}) {
  const scenario = SCENARIOS.find((s) => s.name === name)!;
  const t = await launch(100, 30, {
    ...(scenario.agent ? agentEnv(400) : {}),
    ...env,
  });
  await scenario.open(t);
  return t;
}

test.skipIf(!supported)(
  "real PTY: drag-resize while playing coalesces, keeps playing, repaints clean",
  async () => {
    const t = await open("home-playing");
    try {
      const { events, repaints } = await shake(t, [100, 30]);
      expect(repaints).toBeGreaterThan(0);
      expect(repaints).toBeLessThan(events / 2);
      expectClean(t, 96, 28);
      expect(t.vt.lines()[0]).toContain("▶");
      // Space still stops: keys reach the real UI again.
      await t.send(" ");
      await t.until(() => t.vt.lines()[0]!.includes("⏸"), "stopped");
    } finally {
      t.proc.kill();
    }
  },
  30_000,
);

test.skipIf(!supported)(
  "real PTY: the menu path survives resizing through the too-small screen",
  async () => {
    const t = await open("menu-depth");
    try {
      await shake(t, [100, 30]);
      expectClean(t, 96, 28);
      expect(t.vt.text()).toContain("glue");
      // Esc steps back one level: the path under it is intact.
      await t.send("\u001b");
      await t.until(() => t.vt.text().includes("≡ Mix"), "back to Mix");
    } finally {
      t.proc.kill();
    }
  },
  30_000,
);

test.skipIf(!supported)(
  "real PTY: the selected knob and the drawer page survive resizing",
  async () => {
    const t = await open("drawer-knobs");
    try {
      const selected = () =>
        t.vt
          .lines()
          .find((line) => /›\s*\w/.test(line))
          ?.match(/›\s*(\w+)/)?.[1];
      const before = selected();
      expect(before).toBeDefined();
      await shake(t, [100, 30]);
      expectClean(t, 96, 28);
      expect(selected()).toBe(before);
    } finally {
      t.proc.kill();
    }
  },
  30_000,
);

test.skipIf(!supported)(
  "real PTY: TAPE keeps its range and playhead view across resizes",
  async () => {
    const t = await open("tape");
    try {
      const range = () =>
        t.vt
          .lines()
          .find((line) => line.includes("range: "))
          ?.match(/range: \S+/)?.[0];
      const before = range();
      expect(before).toBeDefined();
      await shake(t, [100, 30]);
      expectClean(t, 96, 28);
      expect(range()).toBe(before);
    } finally {
      t.proc.kill();
    }
  },
  30_000,
);

test.skipIf(!supported)(
  "real PTY: a show-me stream survives resizing mid-reply and still applies",
  async () => {
    const t = await open("showme-stream");
    try {
      await shake(t, [100, 30]);
      expect(t.proc.exitCode).toBeNull();
      // The reply finishes and its edits land: the agent card and tempo.
      await t.until(
        () => t.vt.text().includes("96 BPM"),
        "reply applied",
        20_000,
      );
      await Bun.sleep(200);
      expect(t.vt.wrapsSinceClear).toBe(0);
      expect(t.vt.scrollsSinceClear).toBe(0);
      expect(t.vt.cells.every((row) => row.length === 96)).toBe(true);
    } finally {
      t.proc.kill();
    }
  },
  40_000,
);
