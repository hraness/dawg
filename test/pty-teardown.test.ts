/**
 * Leaving the editor always restores the terminal: a teardown step that
 * throws, an uncaught exception and a kill each leave the main screen,
 * plain paste, a visible cursor and no mouse reporting behind.  A rejected
 * fire-and-forget promise (a header click on a read-only project) is
 * reported on the activity strip and repainted over, not printed into the
 * frame.
 */
import { afterAll, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

type Pty = Awaited<ReturnType<typeof launch>>;

const scratch: string[] = [];
afterAll(async () => {
  await Promise.all(
    scratch.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

/** A preload that throws (or rejects) once the trigger file exists. */
async function trigger(kind: "throw" | "reject"): Promise<{
  preload: string;
  fire: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "dawg-crash-"));
  scratch.push(dir);
  const flag = join(dir, "fire");
  const preload = join(dir, "preload.ts");
  const act =
    kind === "throw"
      ? `throw new Error("boom-crash");`
      : `void Promise.reject(new Error("boom-reject"));`;
  await writeFile(
    preload,
    `import { existsSync } from "node:fs";
const timer = setInterval(() => {
  if (!existsSync(${JSON.stringify(flag)})) return;
  clearInterval(timer);
  ${act}
}, 20);
timer.unref();
`,
  );
  return { preload, fire: () => writeFile(flag, "1") };
}

/** After exit: the PTY may still be delivering the last bytes. */
async function expectRestored(t: Pty): Promise<void> {
  await t
    .until(() => !t.vt.altScreen, "main screen", 3000)
    .catch(() => undefined);
  expect(t.vt.altScreen).toBe(false);
  expect(t.vt.bracketedPaste).toBe(false);
  expect([...t.vt.mouseModes]).toEqual([]);
}

async function readOnly(dir: string, on: boolean): Promise<void> {
  const walk = async (path: string): Promise<void> => {
    const { readdir } = await import("node:fs/promises");
    for (const entry of await readdir(path, { withFileTypes: true }))
      if (entry.isDirectory()) await walk(join(path, entry.name));
    await chmod(path, on ? 0o555 : 0o755);
  };
  await walk(join(dir, ".dawg"));
}

test.skipIf(!supported || process.getuid?.() === 0)(
  "real PTY: a teardown step that throws still restores the terminal",
  async () => {
    const t = await launch(80, 24, {});
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      expect(t.vt.altScreen).toBe(true);
      expect(t.vt.bracketedPaste).toBe(true);
      await readOnly(t.cwd, true);
      t.terminal.write("\u0003");
      const code = await t.proc.exited;
      // The failure is still reported (non-zero), from the main screen.
      expect(code).not.toBe(0);
      await expectRestored(t);
    } finally {
      await readOnly(t.cwd, false).catch(() => undefined);
      t.terminal.close();
    }
  },
  30_000,
);

test.skipIf(!supported)(
  "real PTY: an uncaught exception leaves the alternate screen, then exits",
  async () => {
    const crash = await trigger("throw");
    const t = await launch(80, 24, {}, undefined, undefined, [
      "--preload",
      crash.preload,
    ]);
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await crash.fire();
      const code = await t.proc.exited;
      expect(code).toBe(1);
      await expectRestored(t);
      // The stack lands in the shell, on the main screen.
      expect(t.vt.text()).toContain("boom-crash");
    } finally {
      t.terminal.close();
    }
  },
  30_000,
);

test.skipIf(!supported)(
  "real PTY: an unhandled rejection becomes an error card, the editor lives",
  async () => {
    const crash = await trigger("reject");
    const t = await launch(80, 24, {}, undefined, undefined, [
      "--preload",
      crash.preload,
    ]);
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await crash.fire();
      await t.until(
        () => t.vt.text().includes("failed · boom-reject"),
        "rejection card",
      );
      // Still running, still on the alternate screen, nothing printed over
      // the frame by the runtime.
      expect(t.proc.exitCode).toBeNull();
      expect(t.vt.altScreen).toBe(true);
      expect(t.vt.text()).not.toContain("error: boom-reject");
      expect(t.vt.text()).not.toMatch(/^\s*at /m);
      t.terminal.write("\u0003");
      expect(await t.proc.exited).toBe(0);
      await expectRestored(t);
    } finally {
      t.terminal.close();
    }
  },
  30_000,
);

test.skipIf(!supported || process.getuid?.() === 0)(
  "real PTY: a header transport click that fails shows the error card",
  async () => {
    const t = await launch(100, 30, {});
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await t.until(() => t.vt.lines()[0]!.includes("BPM"), "header");
      await readOnly(t.cwd, true);
      const row = t.vt.lines()[0]!;
      const x = Array.from(row.slice(0, row.indexOf("BPM"))).length;
      t.terminal.write(`\u001b[<0;${x + 1};1M\u001b[<0;${x + 1};1m`);
      await t.until(
        () => t.vt.text().includes("transport failed"),
        "transport failed card",
      );
      expect(t.proc.exitCode).toBeNull();
      expect(t.vt.text()).not.toMatch(/^\s*at /m);
      await readOnly(t.cwd, false);
      t.terminal.write("\u0003");
      await t.proc.exited;
      await expectRestored(t);
    } finally {
      await readOnly(t.cwd, false).catch(() => undefined);
      t.terminal.close();
    }
  },
  30_000,
);
