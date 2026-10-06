/**
 * End-to-end keyboard replay against the real `track` binary in a PTY.
 *
 * Bun 1.3's `Bun.spawn({ terminal })` allocates a pseudo-terminal, so this
 * exercises raw mode, bracketed paste, the alternate screen, resize, and the
 * differential writer exactly as a user's terminal would.  Output is fed into
 * the virtual terminal in test/vt.ts and asserted as visible text.
 */
import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { VirtualTerminal } from "./vt.ts";

const MAIN = resolve(import.meta.dir, "../src/main.ts");
const supported =
  process.platform !== "win32" &&
  typeof (Bun as unknown as { Terminal?: unknown }).Terminal === "function";

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(
    dirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

interface PtyTerminal {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

async function launch(cols: number, rows: number, env: Record<string, string>) {
  const cwd = await mkdtemp(join(tmpdir(), "track-pty-"));
  dirs.push(cwd);
  const vt = new VirtualTerminal(cols, rows);
  const decoder = new TextDecoder();
  const proc = Bun.spawn([process.execPath, MAIN, "--track", "bass"], {
    cwd,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: cwd,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      TRACK_DAEMON: "0",
      TRACK_AUDIO: "0",
      ...env,
    },
    terminal: {
      cols,
      rows,
      data(_terminal: unknown, data: Uint8Array) {
        vt.write(decoder.decode(data, { stream: true }));
      },
    },
  } as Parameters<typeof Bun.spawn>[1]);
  const terminal = (proc as unknown as { terminal: PtyTerminal }).terminal;
  const until = async (predicate: () => boolean, label: string) => {
    const deadline = Date.now() + 5000;
    while (!predicate()) {
      if (Date.now() > deadline)
        throw new Error(`timed out waiting for ${label}\n${vt.text()}`);
      await Bun.sleep(20);
    }
  };
  const send = async (data: string) => {
    terminal.write(data);
    await Bun.sleep(60);
  };
  return { proc, terminal, vt, until, send };
}

test.skipIf(!supported)(
  "real PTY: type while playing, newline, paste, queue, undo, resize, quit",
  async () => {
    const t = await launch(80, 24, {});
    await t.until(() => t.vt.text().includes("STEER"), "prompt");
    expect(t.vt.lines()[0]).toContain("bass");
    // Alternate screen + bracketed paste were enabled.
    expect(t.vt.altScreen).toBe(true);
    expect(t.vt.bracketedPaste).toBe(true);

    // Space on an empty prompt starts playback.
    await t.send(" ");
    await t.until(() => t.vt.lines()[0]!.includes("▶"), "playing");

    // A real edit, so undo has something to revert.
    await t.send("add C3 at 0 for 2\r");
    await t.until(() => t.vt.text().includes("rev 1→2"), "receipt");
    expect(t.vt.text()).toContain("^z undo");

    // Typing while playing, Shift+Enter (CSI u), bracketed paste.
    await t.send("make it");
    await t.send("\u001b[13;2u");
    await t.send("\u001b[200~swing harder\u001b[201~");
    await t.until(() => t.vt.text().includes("swing harder"), "paste");
    const lines = t.vt.lines();
    const first = lines.findIndex((line) => line.includes("› make it"));
    expect(first).toBeGreaterThan(0);
    expect(lines[first + 1]).toContain("swing harder");

    // Ctrl+Q switches the pill to QUEUE.
    await t.send("\u0011");
    await t.until(() => t.vt.text().includes("QUEUE"), "queue pill");
    await t.send("\u0011");
    await t.until(() => t.vt.text().includes("STEER"), "steer pill");

    // Resize keeps the draft and reflows.
    t.terminal.resize(40, 20);
    t.vt.resize(40, 20);
    await Bun.sleep(150);
    await t.send("\u000c"); // Ctrl+L forces a full redraw
    await t.until(() => t.vt.text().includes("swing"), "draft after resize");
    expect(t.vt.cells.every((row) => row.length === 40)).toBe(true);

    // Clear the draft (Esc), then undo with Ctrl+Z.
    await t.send("\u001b");
    await Bun.sleep(80);
    await t.send("\u001a");
    await t.until(() => t.vt.text().includes("undid"), "undo receipt");

    // Ctrl+O opens the transcript with the request we sent.
    await t.send("\u000f");
    await t.until(() => t.vt.text().includes("transcript"), "transcript");
    expect(t.vt.text()).toContain("add C3 at 0 for 2");
    await t.send("\u001b");

    // Ctrl+C exits and restores the primary screen.
    await t.send("\u0003");
    const code = await Promise.race([
      t.proc.exited,
      Bun.sleep(5000).then(() => "timeout"),
    ]);
    expect(code).toBe(0);
    expect(t.vt.altScreen).toBe(false);
    expect(t.vt.cursorVisible).toBe(true);
    t.terminal.close();
  },
  20_000,
);

test.skipIf(!supported)(
  "real PTY: NO_COLOR renders without color and the same layout",
  async () => {
    const color = await launch(80, 24, {});
    const mono = await launch(80, 24, { NO_COLOR: "1" });
    for (const t of [color, mono])
      await t.until(() => t.vt.text().includes("STEER"), "prompt");
    await Bun.sleep(100);
    expect(
      mono.vt.cells.flat().every((cell) => !cell.style.fg && !cell.style.bg),
    ).toBe(true);
    expect(
      color.vt.cells.flat().some((cell) => cell.style.bg !== undefined),
    ).toBe(true);
    const box = (vt: VirtualTerminal) =>
      vt.lines().findIndex((line) => line.includes("STEER"));
    expect(box(mono.vt)).toBe(box(color.vt));
    for (const t of [color, mono]) {
      t.terminal.write("\u0003");
      await t.proc.exited;
      t.terminal.close();
    }
  },
  20_000,
);
