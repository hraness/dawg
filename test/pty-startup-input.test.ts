import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { closeSync, constants, openSync, writeSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

test.skipIf(!supported)(
  "real PTY: the first command survives a pending startup manifest read",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-startup-input-"));
    const manifest = join(dir, "dawg.json");
    let terminal: Awaited<ReturnType<typeof launch>> | undefined;
    let released = false;
    const releaseManifest = () => {
      if (released) return;
      const writer = openSync(
        manifest,
        constants.O_WRONLY | constants.O_NONBLOCK,
      );
      try {
        writeSync(writer, "{}\n");
      } finally {
        closeSync(writer);
      }
      released = true;
    };
    try {
      // Hold the actual project read after the first frame, without delaying
      // app code or replacing its input stream. Closing the writer yields EOF.
      execFileSync("mkfifo", [manifest]);
      const session = await launch(80, 24, {}, [], dir);
      terminal = session;
      await session.until(() => session.vt.text().includes(" NOW "), "prompt");
      session.terminal.write("style deep-house 8 3\r");
      // Let the resumed stream read the keys while the manifest is still held.
      // Acceptance below waits for state, rather than assuming a render delay.
      await Bun.sleep(200);
      releaseManifest();
      await session.until(
        () => session.state()?.rev === 1,
        "first command after the startup read",
      );
      const state = await session.settle();
      expect(state.rev).toBe(1);
      expect(session.vt.text()).toContain("✓ deep-house");
    } finally {
      try {
        // Release a pending read even when an assertion or launch fails.
        try {
          releaseManifest();
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENXIO") throw error;
        }
      } finally {
        try {
          if (terminal) {
            try {
              if (terminal.proc.exitCode === null)
                terminal.proc.kill("SIGTERM");
              await terminal.proc.exited;
            } finally {
              terminal.terminal.close();
            }
          }
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      }
    }
  },
  20_000,
);
