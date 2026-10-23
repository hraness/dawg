/** The song/sample shelf uses real commands, preserves music and undoes in one step. */
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScore } from "../core/score.ts";
import { ensureSession, loadSession } from "../src/session/store.ts";
import { launch, supported } from "./pty-harness.ts";

test.skipIf(!supported)(
  "real PTY: demo and sample shelves preserve music, focus and single-step undo",
  async () => {
    const cwd = await mkdtemp(join(tmpdir(), "dawg-studio-"));
    const original = createScore({
      tracks: [{ id: "bass", name: "Bass", instrument: "sine" }],
      notes: [
        {
          id: "keep",
          trackId: "bass",
          startTick: 0,
          durationTicks: 120,
          pitch: 48,
          velocity: 0.8,
        },
      ],
    }).toJSON();
    const { paths } = await ensureSession(original, { workspace: cwd });
    const read = () => loadSession<typeof original>(paths);
    const t = await launch(
      80,
      24,
      { NO_COLOR: "1", DAWG_AI: "0" },
      ["--track", "bass"],
      cwd,
    );
    const screen = () => t.vt.text();
    const closeMenu = async () => {
      for (let i = 0; i < 8 && t.state()?.screen === "menu"; i += 1)
        await t.type("\x1b", "close menu");
      expect(t.state()?.screen).not.toBe("menu");
    };
    try {
      await t.until(() => t.state() !== undefined, "ready");
      await t.settle();
      await t.type("/demos\r", "song shelf");
      await t.until(() => screen().includes("Redline"), "demo shelf");
      await t.type("redline", "filter song");
      await t.type("\r", "song actions");
      await t.until(() => screen().includes("load song"), "song actions");
      await closeMenu();
      const before = await read();
      await t.type("demo redline\r", "load demo");
      await t.until(() => t.state()?.screen === "tape", "demo timeline");
      const demo = await read();
      expect(demo.revision).toBe(before.revision + 1);
      expect(demo.composition.bars).toBeGreaterThan(32);
      expect(demo.composition.sections!.length).toBeGreaterThan(3);
      await t.type("\x1a", "undo song");
      expect((await read()).composition).toEqual(before.composition);
      expect(t.state()?.track).toBe("bass");
      await t.type("\x1b", "leave timeline");

      await t.type("/sample library\r", "sample shelf");
      await t.until(() => screen().includes("Hold On"), "sample shelf");
      await t.type("hold on\r", "sample actions");
      await t.until(
        () => screen().includes("preview sound"),
        "sample preview action",
      );
      await closeMenu();
      const untouched = await read();
      await t.type("/sample preview hold-on\r", "silent sample preview");
      expect((await read()).revision).toBe(untouched.revision);
      expect((await read()).composition).toEqual(untouched.composition);
      expect(t.state()?.track).toBe("bass");

      await t.type("/sample use hold-on\r", "load sample");
      const loaded = await read();
      expect(loaded.revision).toBe(untouched.revision + 1);
      expect(loaded.composition.notes).toEqual(untouched.composition.notes);
      const sampleTrack = loaded.composition.tracks!.find(
        (track) => track.id === t.state()?.track,
      )!;
      expect(sampleTrack.id).not.toBe("bass");
      expect(
        Object.values(sampleTrack.sampler!.voices).some((ref) =>
          /^pack:studio\/hold-on(?::|$)/u.test(ref.src),
        ),
      ).toBe(true);
      await t.type("/sample chop 4\r", "chop current sample");
      const chopped = await read();
      expect(chopped.revision).toBe(loaded.revision + 1);
      expect(t.state()?.track).not.toBe(sampleTrack.id);
      expect(
        chopped.composition.notes!.some((note) => note.id === "keep"),
      ).toBe(true);
      const slices = chopped.composition.tracks!.find(
        (track) => track.id === t.state()?.track,
      )!;
      expect(Object.keys(slices.sampler!.voices)).toHaveLength(4);
      expect(
        chopped.composition.notes!.filter((note) => note.trackId === slices.id),
      ).toHaveLength(4);
      await t.type("\x1a", "undo slices");
      expect((await read()).composition).toEqual(loaded.composition);
      await t.type("\x1a", "undo sample");
      expect((await read()).composition).toEqual(untouched.composition);
      expect(t.state()?.track).toBe("bass");
    } finally {
      t.terminal.close();
      t.proc.kill();
      await t.proc.exited;
      await rm(cwd, { recursive: true, force: true });
    }
  },
  45_000,
);
