import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDemo } from "../core/demos/index.ts";
import { createScore } from "../core/score.ts";
import { ensureSession, loadSession } from "../src/session/store.ts";
import { launch, supported } from "./pty-harness.ts";

test.skipIf(!supported)(
  "real PTY: loading a demo closes the shelf and shows its arrangement from home or TAPE",
  async () => {
    const t = await launch(60, 20, {}, []);
    const tracks = createDemo("glass-garden").tracks.length;
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "initial prompt");
      for (const input of ["keyboard", "mouse"] as const) {
        await t.type("/demos\r", "demo shelf");
        await t.type("sigblm", "fuzzy demo search");
        await t.until(
          () => t.vt.text().includes("Glass Garden"),
          "matching demo",
        );
        await t.type("\r", "open demo actions");
        await t.until(() => t.vt.text().includes("load song"), "load action");
        if (input === "keyboard") await t.type("\r", "load song");
        else {
          const y = t.vt
            .lines()
            .findIndex((line) => line.includes("load song"));
          const x = t.vt.lines()[y]!.indexOf("load song") + 1;
          await t.type(
            `\u001b[<0;${x + 1};${y + 1}M\u001b[<0;${x + 1};${y + 1}m`,
            "click load song",
          );
        }
        await t.until(
          () => t.vt.text().includes(`1/${tracks}`),
          "visible arrangement",
        );
        expect(t.vt.text()).toContain(" paste ");
        expect(t.vt.text()).not.toContain("song notes");
        expect(t.vt.wrapsSinceClear).toBe(0);
        expect(t.vt.scrollsSinceClear).toBe(0);
      }
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  30_000,
);

test.skipIf(!supported)(
  "real PTY: wide sample picker blocks sidecar command clicks and keeps selection actionable",
  async () => {
    const t = await launch(160, 46, { DAWG_AI: "0" }, []);
    const click = async (x: number, y: number) =>
      t.type(
        `\u001b[<0;${x + 1};${y + 1}M\u001b[<0;${x + 1};${y + 1}m`,
        "click target",
      );
    try {
      await t.until(() => t.state() !== undefined, "ready");
      await t.type("/demo glass-garden\r", "load demo");
      await t.until(() => t.state()?.screen === "tape", "arrangement");
      await t.type("/sample library\r", "sample shelf");
      await t.type("glas", "fuzzy query");
      await t.until(
        () =>
          t.state()?.overlay === "picker" && t.vt.text().includes("· /glas"),
        "filtered shelf",
      );
      const focus = t.state()?.track;
      const backgroundY = t.vt
        .lines()
        .findIndex((line) => line.indexOf("Glass") > 100);
      expect(backgroundY).toBeGreaterThan(0);
      await click(t.vt.lines()[backgroundY]!.indexOf("Glass") + 1, backgroundY);
      expect(t.state()?.screen).toBe("tape");
      expect(t.state()?.overlay).toBe("picker");
      expect(t.state()?.track).toBe(focus);
      const backgroundMixY = t.vt
        .lines()
        .findIndex((line) => line.indexOf(" mix ", 100) > 100);
      expect(backgroundMixY).toBeGreaterThan(0);
      await click(
        t.vt.lines()[backgroundMixY]!.indexOf(" mix ", 100) + 2,
        backgroundMixY,
      );
      expect(t.vt.text()).toContain("sample library · /glas");
      expect(t.state()?.overlay).toBe("picker");
      const menuY = t.vt
        .lines()
        .findIndex(
          (line) => line.includes("Glass") && line.indexOf("Glass") < 100,
        );
      expect(menuY).toBeGreaterThan(0);
      await click(t.vt.lines()[menuY]!.indexOf("Glass") + 1, menuY);
      await t.until(
        () =>
          t.vt.text().includes("preview sound") &&
          t.vt.text().includes("chop into 8"),
        "sample actions",
      );
      expect(t.state()?.overlay).toBe("picker");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  15_000,
);

test.skipIf(!supported)(
  "real PTY: agent demo replacement preserves exact timing, pauses, focuses and undoes once",
  async () => {
    const cwd = await mkdtemp(join(tmpdir(), "dawg-agent-demo-"));
    const original = createScore({
      ticksPerBeat: 960,
      tracks: [{ id: "bass", instrument: "sine" }],
      notes: [
        {
          id: "keep",
          trackId: "bass",
          pitch: 48,
          startTick: 31,
          durationTicks: 241,
          velocity: 0.8,
        },
      ],
    }).toJSON();
    const { paths } = await ensureSession(original, { workspace: cwd });
    let calls = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        if (!new URL(request.url).pathname.endsWith("/chat/completions"))
          return new Response("not found", { status: 404 });
        await request.json();
        const first = calls++ === 0;
        const delta = first
          ? {
              tool_calls: [
                {
                  index: 0,
                  id: "load_demo",
                  type: "function",
                  function: {
                    name: "load_demo",
                    arguments: JSON.stringify({ id: "glass-garden" }),
                  },
                },
              ],
            }
          : { content: "Loaded the demo." };
        const sse =
          [
            { choices: [{ index: 0, delta }] },
            {
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: first ? "tool_calls" : "stop",
                },
              ],
            },
          ]
            .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
            .join("") + "data: [DONE]\n\n";
        return new Response(sse, {
          headers: { "content-type": "text/event-stream" },
        });
      },
    });
    const origin = `http://127.0.0.1:${server.port}`;
    const t = await launch(
      80,
      24,
      {
        AI_GATEWAY_BASE_URL: `${origin}/v1`,
        DAWG_MODELS_DEV_URL: `${origin}/api.json`,
      },
      ["--track", "scratch"],
      cwd,
    );
    try {
      await t.until(() => t.state() !== undefined, "ready");
      await t.settle();
      await t.type(" ", "play initial song");
      expect(t.vt.lines()[0]).toContain("▶");
      const before = await loadSession<typeof original>(paths);
      await t.type(
        "please load Glass Garden from the demo library\r",
        "agent load",
      );
      await t.until(
        () => t.state()?.screen === "tape" && !t.state()?.busy,
        "agent arrangement",
        10_000,
      );
      const after = await loadSession<typeof original>(paths);
      expect(after.composition).toEqual(createDemo("glass-garden").toJSON());
      expect(after.revision).toBe(before.revision + 1);
      expect(t.state()?.track).toBe(createDemo("glass-garden").tracks[0]!.id);
      expect(t.vt.lines()[0]).not.toContain("▶");
      expect(t.vt.text()).toContain(" paste ");
      expect(t.state()?.overlay).toBeNull();
      await t.type("\u001a", "undo demo");
      expect((await loadSession(paths)).composition).toEqual(
        before.composition,
      );
      expect(t.state()?.track).toBe("bass");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
      server.stop(true);
      await rm(cwd, { recursive: true, force: true });
    }
  },
  30_000,
);
