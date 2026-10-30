import { expect, test } from "bun:test";
import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

for (const [cols, rows] of [
  [60, 16],
  [80, 24],
  [120, 36],
]) {
  test.skipIf(!supported)(
    `navigation returns through modes and preserves draft at ${cols}x${rows}`,
    async () => {
      const t = await launch(cols!, rows!, {});
      try {
        await t.settle();
        await t.type("add C4 at 0\r");
        await t.type("my unfinished draft");
        // Jump runs the explicit /tape on destination without submitting the draft.
        await t.type("\u0007", "open Jump beside draft");
        await t.type("Tape arrangement", "find legacy editor");
        expect((await t.type("\r", "open /tape on")).screen).toBe("tape");
        expect((await t.type("\u0010")).screen).toBe("play");
        expect((await t.type("\u0002")).screen).toBe("tape");
        expect((await t.type("\u0002")).screen).toBe("home");
        expect(t.vt.text()).toContain("my unfinished draft");
        await t.type("\u0007");
        expect(t.state()?.overlay).toBe("picker");
        await t.type("\u001b");
        expect(t.vt.text()).toContain("my unfinished draft");
      } finally {
        t.terminal.write("\u0003");
        await t.proc.exited;
        t.terminal.close();
      }
    },
    20000,
  );
}

test.skipIf(!supported)(
  "help owns fader input and global Jump returns to the drawer",
  async () => {
    const t = await launch(100, 28, {});
    try {
      await t.settle();
      await t.type("add C4 at 0\r");
      await t.type("knobs\r");
      const revision = t.state()!.rev;
      await t.type("?");
      await t.type("\u001b[C");
      expect(t.state()!.rev).toBe(revision);
      await t.type("\u0007");
      expect(t.vt.text().toLowerCase()).toContain("jump");
      await t.type("\u001b");
      await t.type("\u001b");
      expect(t.state()!.overlay).toBe("picker");
      expect(t.state()!.rev).toBe(revision);
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
      t.terminal.close();
    }
  },
  20000,
);

test.skipIf(!supported)(
  "export remains navigable and cancellation leaves no published or temporary WAV",
  async () => {
    const t = await launch(100, 28, {});
    try {
      await t.settle();
      await t.type("/demo glass-garden\r");
      expect(t.state()?.screen).toBe("home");
      expect(t.vt.text()).toContain("Tracks");
      await t.send("/export cancelled.wav\r");
      await t.until(() => t.state()?.busy === true, "export started");
      const before = t.state()!.in;
      await t.send("\u0007");
      await t.until(
        () => (t.state()?.in ?? 0) > before && t.state()?.overlay === "picker",
        "Jump responds during export",
        2500,
      );
      await t.send("\u001b");
      await t.send("\u001b");
      await t.settle("export canceled", 5000);
      expect(
        await access(join(t.cwd, "cancelled.wav")).then(
          () => true,
          () => false,
        ),
      ).toBe(false);
      expect(
        (await readdir(t.cwd)).some((name) => name.startsWith("cancelled.wav")),
      ).toBe(false);
      await t.type("/tempo 117\r");
      expect(t.state()?.busy).toBe(false);
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
      t.terminal.close();
    }
  },
  30000,
);

test.skipIf(!supported)(
  "exit waits for export cleanup and never redraws the restored shell",
  async () => {
    const t = await launch(100, 28, {});
    let output = "";
    const writeFrames = t.vt.writeFrames.bind(t.vt);
    t.vt.writeFrames = (data: string) => {
      output += data;
      writeFrames(data);
    };
    try {
      await t.settle();
      await t.type("/demo glass-garden\r");
      expect(t.state()?.screen).toBe("home");
      expect(t.vt.text()).toContain("Tracks");
      await t.send("/export cancelled.wav\r/export queued.wav\r");
      await t.until(() => t.state()?.busy === true, "export started");
      await t.send("\u0003");
      expect(await t.proc.exited).toBe(0);
      const restore = output.lastIndexOf("\u001b[?1049l");
      expect(restore).toBeGreaterThanOrEqual(0);
      expect(output.slice(restore)).not.toContain("\u001b[?2026h");
      expect(output.slice(restore)).not.toContain("\u001b]7799;");
      const files = await readdir(t.cwd);
      expect(
        files.some(
          (name) =>
            name.startsWith("cancelled.wav") || name.startsWith("queued.wav"),
        ),
      ).toBe(false);
    } finally {
      if (t.proc.exitCode === null) {
        t.terminal.write("\u0003");
        await t.proc.exited;
      }
      t.terminal.close();
    }
  },
  30000,
);
