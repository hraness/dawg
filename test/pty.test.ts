/**
 * End-to-end keyboard replay against the real `dawg` binary in a PTY.
 *
 * Bun 1.3's `Bun.spawn({ terminal })` allocates a pseudo-terminal, so this
 * exercises raw mode, bracketed paste, the alternate screen, resize, and the
 * differential writer exactly as a user's terminal would.  Output is fed into
 * the virtual terminal in test/vt.ts and asserted as visible text.
 */
import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

async function launch(
  cols: number,
  rows: number,
  env: Record<string, string>,
  argv: string[] = ["--track", "bass"],
  dir?: string,
) {
  const cwd = dir ?? (await mkdtemp(join(tmpdir(), "dawg-pty-")));
  if (!dir) dirs.push(cwd);
  const vt = new VirtualTerminal(cols, rows);
  const decoder = new TextDecoder();
  const proc = Bun.spawn([process.execPath, MAIN, ...argv], {
    cwd,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: cwd,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      DAWG_DAEMON: "0",
      DAWG_AUDIO: "0",
      // A configured (fake) provider: the agent prompt and NOW pill show,
      // and the first-run sign-in picker stays out of the way.
      AI_GATEWAY_API_KEY: "vck_ptytest0000000000000000",
      DAWG_CREDENTIAL_STORE: "file",
      DAWG_CONFIG_DIR: join(cwd, ".config", "dawg"),
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
  return { proc, terminal, vt, until, send, cwd };
}

test.skipIf(!supported)(
  "real PTY: type while playing, newline, paste, queue, undo, resize, quit",
  async () => {
    const t = await launch(80, 24, {});
    await t.until(() => t.vt.text().includes(" NOW "), "prompt");
    expect(t.vt.lines()[0]).toContain("bass");
    // Alternate screen + bracketed paste were enabled.
    expect(t.vt.altScreen).toBe(true);
    expect(t.vt.bracketedPaste).toBe(true);

    // Space on an empty prompt starts playback.
    await t.send(" ");
    await t.until(() => t.vt.lines()[0]!.includes("▶"), "playing");

    // A real edit, so undo has something to revert. Play/pause is not an
    // edit, so the first edit is still rev 0→1.
    await t.send("add C3 at 0 for 2\r");
    await t.until(() => t.vt.text().includes("rev 0→1"), "receipt");
    expect(t.vt.text()).toContain("ctrl-z undo");

    // Typing while playing, Shift+Enter (CSI u), bracketed paste.
    await t.send("make it");
    await t.send("\u001b[13;2u");
    await t.send("\u001b[200~swing harder\u001b[201~");
    await t.until(() => t.vt.text().includes("swing harder"), "paste");
    const lines = t.vt.lines();
    const first = lines.findIndex((line) => line.includes("› make it"));
    expect(first).toBeGreaterThan(0);
    expect(lines[first + 1]).toContain("swing harder");

    // Ctrl+Q switches the pill to NEXT.
    await t.send("\u0011");
    await t.until(() => t.vt.text().includes(" NEXT "), "next pill");
    await t.send("\u0011");
    await t.until(() => t.vt.text().includes(" NOW "), "now pill");

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
    expect(t.vt.text()).toContain("undid · −1 note on bass (C3)");

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
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
    await Bun.sleep(100);
    expect(
      mono.vt.cells.flat().every((cell) => !cell.style.fg && !cell.style.bg),
    ).toBe(true);
    expect(
      color.vt.cells.flat().some((cell) => cell.style.bg !== undefined),
    ).toBe(true);
    const box = (vt: VirtualTerminal) =>
      vt.lines().findIndex((line) => line.includes(" NOW "));
    expect(box(mono.vt)).toBe(box(color.vt));
    for (const t of [color, mono]) {
      t.terminal.write("\u0003");
      await t.proc.exited;
      t.terminal.close();
    }
  },
  20_000,
);

test.skipIf(!supported)(
  "real PTY: /rename, /fork, /sessions and auto-claimed tracks",
  async () => {
    const t = await launch(100, 30, {});
    await t.until(() => t.vt.text().includes(" NOW "), "prompt");
    await t.send("/rename night drive\r");
    await t.until(
      () => t.vt.text().includes("renamed · night drive"),
      "rename",
    );
    expect(t.vt.lines()[0]).toContain("night drive");
    await t.send("/fork\r");
    await t.until(() => t.vt.text().includes("forked · night drive 2"), "fork");
    await t.until(() => t.vt.lines()[0]!.includes("night drive 2"), "header");
    await t.send("/sessions\r");
    await t.until(() => t.vt.text().includes("2 sessions"), "sessions");
    await t.send("\u0003");
    expect(await t.proc.exited).toBe(0);
    t.terminal.close();

    // Plain `dawg` resumes the fork and claims its only track; a second
    // window on the same session gets a draft track.
    const one = await launch(100, 30, {}, [], t.cwd);
    await one.until(() => one.vt.text().includes(" NOW "), "first window");
    expect(one.vt.lines()[0]).toContain("night drive 2");
    expect(one.vt.lines()[0]).toContain("bass");
    const two = await launch(
      100,
      30,
      {},
      ["--session", "night drive 2"],
      t.cwd,
    );
    await two.until(
      () => two.vt.text().includes("all tracks open"),
      "draft hint",
    );
    expect(two.vt.lines()[0]).toContain("track-2");
    for (const w of [one, two]) {
      w.terminal.write("\u0003");
      expect(await w.proc.exited).toBe(0);
      w.terminal.close();
    }
  },
  30_000,
);

test.skipIf(!supported)(
  "real PTY: /track focuses, failures are red, /help is an overlay, slash typos stay local",
  async () => {
    const t = await launch(100, 30, {}, []);
    await t.until(() => t.vt.text().includes(" NOW "), "prompt");
    expect(t.vt.text()).toContain("created .dawg/ · add it to .gitignore");
    expect(t.vt.text()).toMatch(
      /main · empty · [^\n]* · ctrl-p play · ctrl-k menu/,
    );

    // A drum command on a melodic track is a failure, drawn in the error role.
    await t.send("pattern kick 0 1\r");
    await t.until(
      () => t.vt.text().includes("✗ main is not a drum track"),
      "drum failure",
    );

    // The quickstart path: bare `track drums` creates and focuses the track.
    await t.send("track drums\r");
    await t.until(() => t.vt.text().includes("track created · drums"), "track");
    await t.until(() => t.vt.lines()[0]!.includes("drums"), "focus");
    expect(t.vt.text()).toContain("ctrl-z undo");
    await t.send("pattern kick 0 1 2 3\r");
    await t.until(() => t.vt.text().includes("✓ +4 kick hits"), "hits");
    await t.send("pattern kick 0\r");
    await t.until(() => t.vt.text().includes("✗ kick already there"), "no-op");

    // Unknown slash words and near-misses never leave the process.
    await t.send("/foo\r");
    await t.until(
      () => t.vt.text().includes("unknown command /foo · /help"),
      "unknown",
    );
    await t.send("/clik on\r");
    await t.until(
      () => t.vt.text().includes("did you mean /click?"),
      "nearest command",
    );
    await t.send("pan 3\r");
    await t.until(() => t.vt.text().includes("pan takes -1…1"), "usage");
    await t.send("/export\r");
    await t.until(() => t.vt.text().includes("export <file>"), "export usage");
    await t.send("/export song.wav\r");
    await t.until(
      () => t.vt.text().includes("render audio with: dawg render song.wav"),
      "export audio refused",
    );
    await t.send("/import nope.json\r");
    await t.until(
      () => t.vt.text().includes("no such file · nope.json"),
      "enoent",
    );

    // /help opens start-here and the ten topics; /help all is everything.
    await t.send("/help\r");
    await t.until(() => t.vt.text().includes("── start here"), "help guide");
    expect(t.vt.text()).toContain("ctrl-k");
    expect(t.vt.text()).toContain("esc back");
    await t.send("\u001b");
    await t.until(() => !t.vt.text().includes("── start here"), "guide closed");
    await t.send("/help all\r");
    await t.until(() => t.vt.text().includes("── sound"), "help overlay");
    await t.send("\u001b[F"); // End: the last page holds the keys
    await t.until(() => t.vt.text().includes("chord mode"), "help end");
    await t.send("\u001b");
    await t.until(() => !t.vt.text().includes("chord mode"), "help all closed");
    // An old topic id still opens: session is now project.
    await t.send("/help session\r");
    await t.until(
      () => t.vt.text().includes("╭─ help · project"),
      "help project",
    );
    await t.send("\u001b");
    await t.until(
      () => !t.vt.text().includes("╭─ help · project"),
      "help closed",
    );
    await t.send("/status\r");
    await t.until(
      () => t.vt.text().includes("saved locally · no daemon"),
      "status",
    );
    await t.send("/rename\r");
    await t.until(
      () => t.vt.text().includes("(auto-named) · rename with /rename <name>"),
      "rename hint",
    );

    // A second window claims `main`; drums stays with the first window.
    const two = await launch(100, 30, {}, [], t.cwd);
    await two.until(() => two.vt.text().includes(" NOW "), "second window");
    expect(two.vt.lines()[0]).toContain("main");
    await two.send("/track drums\r");
    await two.until(
      () => two.vt.text().includes("drums is open in another window"),
      "claimed elsewhere",
    );
    expect(two.vt.lines()[0]).toContain("main");
    await two.send("/track drums\r");
    await Bun.sleep(100);
    for (const w of [two, t]) {
      w.terminal.write("\u0003");
      expect(await w.proc.exited).toBe(0);
      w.terminal.close();
    }
  },
  30_000,
);

test.skipIf(!supported)(
  "real PTY: spend line under the prompt, /model opens the picker offline",
  async () => {
    const dead = "http://127.0.0.1:9";
    const t = await launch(
      100,
      30,
      {
        AI_GATEWAY_BASE_URL: `${dead}/v1`,
        DAWG_MODELS_DEV_URL: `${dead}/api.json`,
      },
      [],
    );
    await t.until(() => t.vt.text().includes(" NOW "), "prompt");
    await t.until(
      () => /\$0 session · \$0 today · opus-5\.5 · gateway/.test(t.vt.text()),
      "spend line",
    );
    await t.send("/model\r");
    await t.until(() => t.vt.text().includes("Claude Sonnet 5.5"), "picker");
    expect(t.vt.text()).toContain("Claude Opus 5.5");
    // `/` filters the list, as in every picker.
    await t.send("/haiku-4");
    await t.until(() => !t.vt.text().includes("Claude Sonnet 5.5"), "filter");
    expect(t.vt.text()).toContain("Claude Haiku 4.5");
    expect(t.vt.text()).not.toContain("Claude Haiku 5.5");
    await t.send("\r");
    await t.until(() => t.vt.text().includes("haiku-4.5 · gateway"), "saved");
    await t.send("\u0003");
    await Promise.race([t.proc.exited, Bun.sleep(5000)]);
    t.proc.kill();
    t.terminal.close();
  },
  20_000,
);

test.skipIf(!supported)(
  "real PTY: the first run opens the TUI with one optional /login card",
  async () => {
    const t = await launch(80, 24, { AI_GATEWAY_API_KEY: "" }, []);
    await t.until(
      () => t.vt.text().includes("/model key adds an agent · optional"),
      "first-run card",
    );
    // Straight into the editor: no picker, the alternate screen is up.
    expect(t.vt.altScreen).toBe(true);
    expect(t.vt.text()).not.toContain("Welcome to dawg");
    expect(t.vt.text()).not.toContain("Esc to skip");
    t.terminal.write("\u0003");
    expect(await t.proc.exited).toBe(0);
    t.terminal.close();
    // Session two stays quiet: the card was shown once.
    const two = await launch(80, 24, { AI_GATEWAY_API_KEY: "" }, [], t.cwd);
    await two.until(() => two.vt.text().includes("commands only"), "second");
    await Bun.sleep(300);
    expect(two.vt.text()).not.toContain("/model key adds an agent");
    two.terminal.write("\u0003");
    expect(await two.proc.exited).toBe(0);
    two.terminal.close();
  },
  20_000,
);

test.skipIf(!supported)(
  "real PTY: no provider shows the offline spend line and hides NOW",
  async () => {
    const t = await launch(
      100,
      30,
      { AI_GATEWAY_API_KEY: "", DAWG_AI: "0" },
      [],
    );
    await t.until(() => t.vt.text().includes("commands only"), "offline state");
    // No sign-in nag in the header: the first session's card names /login.
    expect(t.vt.text()).not.toContain("dawg login");
    expect(t.vt.text()).not.toContain(" NOW ");
    // Commands only: the empty state and placeholder never ask for prose.
    expect(t.vt.text()).not.toContain("type a request");
    expect(t.vt.text()).not.toContain("describe a");
    expect(t.vt.text()).toContain("try: ");
    // A sentence that starts with a command verb is a request, not a usage
    // error: offline it says "unrecognized", never the add syntax.
    await t.send("add a walking bass in A minor\r");
    await t.until(
      () => t.vt.text().includes("unrecognized · add a walking bass"),
      "prose reaches the agent path",
    );
    expect(t.vt.text()).not.toContain("add <note> at <beat>");
    // A one-letter slip whose arguments parse is caught locally.
    await t.send("tempoo 90\r");
    await t.until(
      () => t.vt.text().includes("tempoo 90 · did you mean tempo 90?"),
      "typo suggestion",
    );
    await t.send("\u0003");
    await Promise.race([t.proc.exited, Bun.sleep(5000)]);
    t.proc.kill();
    t.terminal.close();
  },
);

test.skipIf(!supported)(
  "real PTY: /login leaves the alternate screen, runs the flow, then redraws",
  async () => {
    const t = await launch(
      100,
      30,
      {
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
        XCB_BIN: "/nonexistent/xcb",
        AI_GATEWAY_BASE_URL: "http://127.0.0.1:9/v1",
      },
      [],
    );
    await t.until(() => t.vt.text().includes(" NOW "), "prompt");
    expect(t.vt.altScreen).toBe(true);
    await t.send("/login\r");
    await t.until(() => !t.vt.altScreen, "left the alternate screen");
    await t.until(
      () => t.vt.text().includes("found AI_GATEWAY_API_KEY"),
      "picker on the main screen",
    );
    await t.until(() => /\[Y\/n\]|Enter/.test(t.vt.text()), "a prompt");
    await t.send("\r");
    await t.until(() => t.vt.altScreen, "back on the alternate screen");
    await t.until(() => t.vt.text().includes(" NOW "), "redrawn TUI");
    await t.send("\u0003");
    await Promise.race([t.proc.exited, Bun.sleep(5000)]);
    t.proc.kill();
    t.terminal.close();
  },
  20_000,
);

test.skipIf(!supported)(
  "real PTY: strum and guitar commands, then Effects > Shoegaze in the menu",
  async () => {
    const t = await launch(110, 34, { AI_GATEWAY_API_KEY: "", DAWG_AI: "0" }, [
      "--track",
      "gtr",
    ]);
    await t.until(() => t.vt.text().includes("commands only"), "ready");
    await t.send("guitar capo 2\r");
    await t.until(
      () => t.vt.text().includes("guitar · standard · capo 2"),
      "capo",
    );
    await t.send("strum G D Em C folk\r");
    await t.until(
      () => t.vt.text().includes("strum · G D Em C · folk"),
      "strum",
    );
    await t.send("strumm\r");
    await t.until(() => t.vt.text().includes("did you mean"), "typo hint");
    await t.send("rig shoegaze\r");
    await t.until(() => t.vt.text().includes("rig shoegaze ·"), "rig");
    await t.send("/menu effects\r");
    await t.until(() => t.vt.text().includes("Shoegaze"), "effects menu");
    expect(t.vt.text()).toContain("wobble, bloom, double");
    await t.send("\u001b");
    await t.send("\u001b");
    await t.send("\u0003");
    await Promise.race([t.proc.exited, Bun.sleep(5000)]);
    t.proc.kill();
    t.terminal.close();
  },
  20_000,
);
