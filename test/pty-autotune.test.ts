/**
 * 0.7 autotune in the real binary: `/autotune`, the `/tune` hint, the
 * `/vocal autotune` alias and Sound > Voice > Autotune in the ctrl-k menu.
 * Same PTY setup as test/pty.test.ts (Bun.spawn with a terminal).
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

test.skipIf(!supported)(
  "real PTY: /autotune, /tune hint, /vocal autotune, Sound > Voice > Autotune",
  async () => {
    const cwd = await mkdtemp(join(tmpdir(), "dawg-pty-autotune-"));
    dirs.push(cwd);
    const vt = new VirtualTerminal(110, 34);
    const decoder = new TextDecoder();
    const proc = Bun.spawn([process.execPath, MAIN, "--track", "vox"], {
      cwd,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: cwd,
        TERM: "xterm-256color",
        DAWG_DAEMON: "0",
        DAWG_AUDIO: "0",
        DAWG_AI: "0",
        DAWG_CREDENTIAL_STORE: "file",
        DAWG_CONFIG_DIR: join(cwd, ".config", "dawg"),
      },
      terminal: {
        cols: 110,
        rows: 34,
        data(_terminal: unknown, data: Uint8Array) {
          vt.write(decoder.decode(data, { stream: true }));
        },
      },
    } as Parameters<typeof Bun.spawn>[1]);
    const terminal = (
      proc as unknown as { terminal: { write(d: string): void; close(): void } }
    ).terminal;
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
    try {
      await until(() => vt.text().includes("commands only"), "ready");
      await send("/autotune hard\r");
      await until(() => vt.text().includes("autotune · hard"), "autotune set");
      await send("/tune hard\r");
      await until(
        () => vt.text().includes("for pitch correction use /autotune hard"),
        "tune hint",
      );
      await send("/vocal autotune gentle speed 60\r");
      await until(
        () => vt.text().includes("autotune · gentle · speed 60 ms"),
        "vocal alias",
      );
      await send("/autotne\r");
      await until(
        () => vt.text().includes("did you mean /autotune"),
        "typo hint",
      );
      await send("/menu sound\r");
      await until(() => vt.text().includes("Voice"), "Sound > Voice");
      // Filter to the Voice group and open it, then Autotune.
      await send("/voice");
      await send("\r");
      await until(() => vt.text().includes("Autotune"), "Voice > Autotune");
      // Clips, Lyrics and Pitch sit above it: filter to Autotune, then open.
      await send("/autotune");
      await send("\r");
      await until(
        () => vt.text().includes("Preset") && vt.text().includes("Flex"),
        "autotune rows",
      );
      expect(vt.text()).toContain("gentle");
      await send("\u001b");
      await send("\u001b");
      await send("\u001b");
    } finally {
      terminal.write("\u0003");
      await Promise.race([proc.exited, Bun.sleep(5000)]);
      proc.kill();
      terminal.close();
    }
  },
  25_000,
);
