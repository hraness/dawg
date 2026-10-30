/**
 * TAPE end to end (op1-ux §6, §8.3): /tape on opens every track across the
 * bars, each gesture echoes and runs its typed range command, the clipboard
 * survives in `.dawg`, the mouse sets the loop, and Esc goes home. Also a
 * multi-pane case: another pane recording on a track shows `C●` in the
 * TAPE gutter.
 */
import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { launch, MAIN, supported } from "./pty-harness.ts";
import { VirtualTerminal } from "./vt.ts";
import { arrangementFixture } from "./arrangement-fixture.ts";
import { ensureSession } from "../src/session/store.ts";

type SessionScore = {
  bars: number;
  revision?: number;
  sections?: { name: string; startBar: number; bars: number }[];
  tracks: { id: string; muted?: boolean }[];
  notes: { trackId: string; startTick: number }[];
  loop?: { startBar: number; bars: number } | null;
  loopSection?: string | null;
};
type SessionEvent = { kind: string };

/** The newest composition record under `.dawg/`, with its events. */
async function session(
  cwd: string,
): Promise<{ score: SessionScore; events: SessionEvent[] } | undefined> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(
      () => [],
    )) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".json")) found.push(path);
    }
  };
  await walk(join(cwd, ".dawg"));
  let best:
    | { revision: number; score: SessionScore; events: SessionEvent[] }
    | undefined;
  for (const path of found) {
    const text = await readFile(path, "utf8").catch(() => "{}");
    if (!text.includes('"composition"')) continue;
    const parsed = JSON.parse(text) as {
      revision?: number;
      composition?: SessionScore & { tracks?: unknown };
      events?: SessionEvent[];
    };
    if (!parsed.composition?.tracks) continue;
    const revision = parsed.revision ?? 0;
    if (!best || revision >= best.revision)
      best = {
        revision,
        score: parsed.composition,
        events: parsed.events ?? [],
      };
  }
  return best;
}

async function waitFor(
  check: () => Promise<boolean>,
  label: string,
  context: () => string = () => "",
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await Bun.sleep(50);
  }
  throw new Error(`timed out waiting for ${label}\n${context()}`);
}

/** SGR mouse: press and release at a 0-based cell. */
const click = (x: number, y: number) =>
  `\u001b[<0;${x + 1};${y + 1}M\u001b[<0;${x + 1};${y + 1}m`;

type Pty = Awaited<ReturnType<typeof launch>>;

/**
 * Click a TAPE footer button (`copy`, `cut`, `paste`, `record`): letters
 * typed on the keyboard go to the prompt, so the gestures are buttons.
 */
async function tapeButton(t: Pty, label: string): Promise<void> {
  const lines = t.vt.lines();
  const y = lines.findIndex(
    (line) => line.includes(" cut ") && line.includes(" paste "),
  );
  expect(y).toBeGreaterThan(0);
  const x = lines[y]!.indexOf(` ${label} `);
  expect(x).toBeGreaterThanOrEqual(0);
  await t.send(click(x + 1, y));
}

test.skipIf(!supported)(
  "real PTY: dense arrangement controls, track scrolling and drafts survive resize",
  async () => {
    const cwd = await mkdtemp(join(tmpdir(), "dawg-arrangement-"));
    await ensureSession(arrangementFixture().toJSON(), { workspace: cwd });
    const t = await launch(80, 24, {}, ["--track", "layer-1"], cwd);
    const clickText = async (text: string) => {
      const y = t.vt.lines().findIndex((line) => line.includes(text));
      expect(y).toBeGreaterThanOrEqual(0);
      const x = t.vt.lines()[y]!.indexOf(text);
      await t.type(click(x + 1, y), `click ${text}`);
    };
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await t.type("/tape on\r", "tape");
      for (const [cols, rows] of [
        [60, 20],
        [80, 24],
        [120, 36],
        [160, 50],
      ]) {
        t.vt.resize(cols!, rows!);
        t.terminal.resize(cols!, rows!);
        await t.type("/track layer-1\r", "focus first");
        await t.until(() => t.vt.text().includes("1/32"), "track counter");
        await clickText("‹ track");
        await t.until(() => t.vt.text().includes("32/32"), "last track");
        expect(t.vt.text()).toMatch(/32›/u);
        expect(t.vt.text()).toContain("range: Percussion 4");
        await clickText("track ›");
        await t.until(() => t.vt.text().includes("1/32"), "first track");
        await t.type("\u001b[6~", "page down");
        await t.until(() => t.vt.text().includes("9/32"), "ninth track");
        const row = t.vt.lines().findIndex((line) => /9›/u.test(line));
        expect(row).toBeGreaterThan(0);
        await t.type(`\u001b[<65;6;${row + 1}M`, "wheel next track");
        await t.until(
          () => t.vt.text().includes("10/32"),
          "wheel focused tenth",
        );
        await t.type("/unfinished", "command draft");
        await clickText("‹ track");
        await t.until(
          () => t.vt.text().includes("9/32"),
          "draft click focused ninth",
        );
        expect(t.vt.text()).toContain("/unfinished");
        await t.type("\u007f".repeat("/unfinished".length), "clear draft");
        await clickText("scene ›");
        await t.until(() => t.vt.text().includes("Verse 1"), "next scene");
        await clickText("mix");
        await t.until(
          () => t.vt.text().includes("mixer") || t.vt.text().includes("Mixer"),
          "mixer opens",
        );
        for (let n = 0; n < 6 && !t.vt.text().includes(" paste "); n++)
          await t.type("\u001b", "close mixer");
        await t.until(
          () => t.vt.text().includes(" paste "),
          "arrangement returns",
        );
      }
      t.vt.resize(40, 16);
      t.terminal.resize(40, 16);
      await t.until(
        () => t.vt.text().includes("60×16"),
        "minimum-size guidance",
      );
      expect(t.vt.text()).toContain("space play");
      t.vt.resize(80, 24);
      t.terminal.resize(80, 24);
      await t.until(() => t.vt.text().includes("9/32"), "arrangement restored");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
      await rm(cwd, { recursive: true, force: true });
    }
  },
  60_000,
);

for (const [cols, rows] of [
  [80, 24],
  [120, 32],
] as const)
  test.skipIf(!supported)(
    `real PTY: TAPE gestures echo range commands at ${cols}x${rows}`,
    async () => {
      const t = await launch(cols, rows, cols === 80 ? {} : { NO_COLOR: "1" });
      try {
        await t.until(() => t.vt.text().includes(" NOW "), "prompt");
        await t.send("bars 8\r");
        await t.send("add C4 at 0\r");
        await t.send("add E4 at 4\r");
        await t.send("section verse 1-4\r");
        await t.send("section chorus 5-8\r");
        await t.send("track drums\r");
        await t.send("track bass\r");
        // Every queued line has run before opening TAPE: notes land before the
        // sections, and bass is focused from launch, so neither the session
        // file nor the header says the sections and `track bass` ran.
        await t.settle("seven lines applied");
        expect((await session(t.cwd))?.score.notes.length).toBe(2);
        expect(t.vt.lines()[0]).toMatch(/· bass\b/);

        // Explicit legacy TAPE retains its manual editing footer.
        await t.type("/tape on\r", "tape opened");
        await t.until(() => t.vt.text().includes("range: bass"), "tape");
        const text = t.vt.text();
        expect(text).toContain("▼");
        expect(text).toContain("verse");
        expect(text).toContain("›bass");
        expect(text).toContain(" paste ");
        expect(text).toContain("playhead");
        expect(text).toContain("type a command");

        // Letters type into the prompt, TAPE stays up, and backspace
        // edits the draft instead of clearing bars.
        await t.send("cx");
        await t.until(
          () => t.vt.lines().some((line) => /› cx\b/u.test(line)),
          "letters type into the prompt",
        );
        expect(t.vt.text()).toContain("range: bass");
        await t.send("\u007f\u007f\u007f");
        await t.until(
          () => t.vt.text().includes("type a command"),
          "draft cleared",
        );
        await Bun.sleep(150);
        expect((await session(t.cwd))?.score.notes.length).toBe(2);

        // `\` loops the section under the playhead, again turns the loop
        // off, and a third time loops it back (each echoed as typed).
        expect(text).not.toContain("(loop)");
        const looped = async () => (await session(t.cwd))?.score.loopSection;
        await t.send("\\");
        await t.until(
          () => t.vt.text().includes("loop verse"),
          "echo: loop verse",
        );
        await waitFor(async () => (await looped()) === "verse", "verse loops");
        await t.until(() => t.vt.text().includes("(loop)"), "loop range");
        await t.send("\\");
        await t.until(() => t.vt.text().includes("loop off"), "echo: loop off");
        await waitFor(
          async () => !(await looped()),
          "loop off",
          () => t.vt.text(),
        );
        await t.until(
          () => !t.vt.text().includes("(loop)"),
          "range not looped",
        );
        await Bun.sleep(900); // let the previous echo fade
        await t.send("\\");
        await t.until(() => t.vt.text().includes("(loop)"), "loop range again");
        expect(t.vt.lines().some((line) => line.includes("]"))).toBe(true);

        // The copy button copies the loop range and fills the clipboard chip.
        await tapeButton(t, "copy");
        await t.until(
          () => t.vt.text().includes("copy bass 1-4"),
          "echo: copy",
        );
        await t.until(
          () => t.vt.text().includes("clipboard: bass · 4 bars"),
          "clipboard chip",
          8000,
        );
        const clipDir = join(t.cwd, ".dawg", "clipboard");
        await waitFor(
          async () => (await readdir(clipDir)).length === 1,
          "clipboard file",
        );

        // Cut, then paste at the chorus: one move, the source bars empty.
        await tapeButton(t, "cut");
        await waitFor(
          async () => (await session(t.cwd))?.score.notes.length === 0,
          "cut clears",
          () => t.vt.text(),
        );
        await t.send(".");
        await t.until(() => t.vt.text().includes("jump chorus"), "echo: jump");
        await t.until(() => t.vt.text().includes("5.1"), "jump to the chorus");
        await tapeButton(t, "paste");
        await t.until(
          () => t.vt.text().includes("move bass 1-4 to 5"),
          "echo: the paste after a cut folds into a move",
        );
        await waitFor(
          async () => {
            const notes = (await session(t.cwd))?.score.notes ?? [];
            return (
              notes.length === 2 &&
              notes.every((note) => note.startTick >= 4 * 1920)
            );
          },
          "notes moved to bar 5",
          () => t.vt.text(),
        );

        // `?` lists the TAPE keys.
        await t.send("?");
        await t.until(
          () => t.vt.text().includes("tape · every track"),
          "tape keys",
        );
        await t.send("\u001b");
        await t.until(
          () => !t.vt.text().includes("tape · every track"),
          "keys closed",
        );

        // A drag on the ruler sets the loop over the dragged bars.
        const rulerY = t.vt
          .lines()
          .findIndex((line) => line.startsWith(" bar"));
        expect(rulerY).toBeGreaterThan(0);
        // The timeline starts at its first note cell, after the adaptive
        // track labels and M/S/automation/effect indicators.
        const left = t.vt
          .lines()
          .find((line) => line.includes("›bass"))!
          .search(/[┊▁▂▃▄▅▆▇█│]/u);
        expect(left).toBeGreaterThan(9);
        const cellsPerBar = 4; // beat zoom in 4/4
        const at = (bar: number) => left + bar * cellsPerBar;
        t.terminal.write(`\u001b[<0;${at(1) + 1};${rulerY + 1}M`);
        await Bun.sleep(40);
        t.terminal.write(`\u001b[<32;${at(2) + 1};${rulerY + 1}M`);
        await Bun.sleep(40);
        t.terminal.write(`\u001b[<0;${at(2) + 1};${rulerY + 1}m`);
        await t.until(
          () => t.vt.text().includes("loop 2-3"),
          "echo: drag loop",
        );
        await waitFor(
          async () => {
            const loop = (await session(t.cwd))?.score.loop;
            return loop?.startBar === 1 && loop.bars === 2;
          },
          "loop 2-3 from the drag",
          () => t.vt.text(),
        );

        // A click on a row focuses that track (echoed as `track …`).
        const rowY = t.vt.lines().findIndex((line) => /^ \d.drums/.test(line));
        expect(rowY).toBeGreaterThan(0);
        await t.send(click(20, rowY));
        await t.until(() => t.vt.text().includes("›drums"), "row focus");

        // Esc returns to the default observer; manual TAPE controls are gone.
        await t.send("\u001b");
        await t.until(() => !t.vt.text().includes("range: "), "home");
        expect(t.vt.text()).not.toMatch(/\bcut\b.*\bpaste\b/);
        expect(t.vt.text()).not.toContain("clipboard:");
      } finally {
        t.proc.kill();
      }
    },
    60_000,
  );

// Ctrl-← → switch Spaces on macOS, so scenes step on Alt-← → (and the
// ESC b / ESC f that Option-as-Meta terminals send).
test.skipIf(!supported)(
  "real PTY: alt-← → step scenes from an empty prompt",
  async () => {
    const cwd = await mkdtemp(join(tmpdir(), "dawg-scenes-"));
    await ensureSession(arrangementFixture().toJSON(), { workspace: cwd });
    const t = await launch(120, 32, {}, ["--track", "layer-1"], cwd);
    const head = () => t.vt.lines()[0] ?? "";
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      expect(t.vt.text()).toContain("Next section");
      await t.until(() => head().includes(" 1.1 "), "at bar 1");
      await t.send("\u001b[1;3C");
      await t.until(() => !head().includes(" 1.1 "), "next scene");
      await t.send("\u001bb");
      await t.until(() => head().includes(" 1.1 "), "previous scene");
      await t.send("\u001bf");
      await t.until(() => !head().includes(" 1.1 "), "next scene (meta)");
      // With text in the prompt, Alt-← moves by word and leaves the scene.
      await t.send("\u001bb");
      await t.until(() => head().includes(" 1.1 "), "back to bar 1");
      await t.send("ab");
      await t.until(() => t.vt.text().includes("› ab"), "typed");
      await t.send("\u001b[1;3D");
      await t.send("x");
      await t.until(() => t.vt.text().includes("› xab"), "word move");
      expect(head()).toContain(" 1.1 ");
      // TAPE takes Alt-← → for scenes too.
      await t.send("\u001b[F\u007f\u007f\u007f");
      await t.until(() => !t.vt.text().includes("› xab"), "cleared");
      await t.send("/tape on\r");
      await t.until(() => t.vt.text().includes("range: "), "tape");
      await t.send("\u001b[1;3C");
      await t.until(() => !head().includes(" 1.1 "), "next scene on TAPE");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
      await rm(cwd, { recursive: true, force: true });
    }
  },
  60_000,
);

// Colour and NO_COLOR: the ghost is a glyph, never only a dim colour.
for (const env of [{}, { NO_COLOR: "1" }] as Record<string, string>[])
  test.skipIf(!supported)(
    `real PTY: a form draws unrolled, repeats ghosted ░${"NO_COLOR" in env ? " (NO_COLOR)" : ""}`,
    async () => {
      const t = await launch(80, 24, env);
      try {
        await t.until(() => t.vt.text().includes(" NOW "), "prompt");
        await t.send("bars 8\r");
        await t.send("add C4 at 16\r");
        await t.send("section verse 1-4\r");
        await t.send("section chorus 5-8\r");
        await t.send("form verse chorus*2\r");
        // "chorus" is on screen from the section line already: wait for the
        // queued lines to run, not for a word.
        await t.settle("form set");
        await t.type("/tape on\r", "tape opened");
        await t.until(() => t.vt.text().includes("range: "), "tape");
        const ghost = "░";
        const sect = () =>
          t.vt.lines().find((line) => line.startsWith(" sect")) ?? "";
        await t.until(() => sect().includes("chorus ×2"), "pass label");
        expect(sect()).toContain(`${ghost}chorus`);
        // At the chorus the range line says an edit lands on both passes.
        await t.send(".");
        await t.until(
          () => t.vt.text().includes("edits chorus (plays 2×)"),
          "edits chorus (plays 2×)",
        );
      } finally {
        t.proc.kill();
      }
    },
    60_000,
  );

test.skipIf(!supported)(
  "real PTY: TAPE buttons tile, insert, mute and undo; tab focuses",
  async () => {
    const t = await launch(80, 24, {});
    const now = async () => (await session(t.cwd))!.score;
    const bassNotes = async () =>
      (await now()).notes
        .filter((note) => note.trackId === "bass")
        .map((note) => note.startTick / 1920)
        .sort((a, b) => a - b);
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      for (const line of [
        "bars 8",
        "track drums",
        "track bass",
        "add C4 at 0",
        "section verse 1-4",
      ])
        await t.send(`${line}\r`);
      // `section verse` runs after the note: wait for the whole queue.
      await t.settle("five lines applied");
      expect(await bassNotes()).toEqual([0]);
      await t.type("/tape on\r", "tape opened");
      await t.until(() => t.vt.text().includes("range: bass"), "tape");

      // Loop the verse, shrink it to one bar with `[`, and copy it.
      await t.send("\\");
      await t.until(() => t.vt.text().includes("(loop)"), "loop");
      for (let i = 0; i < 3; i += 1) {
        await t.send("[");
        await Bun.sleep(150);
      }
      await t.until(
        () =>
          t.vt.text().includes("bars 1 (loop)") ||
          t.vt.text().includes("bar 1 (loop)"),
        "one-bar loop",
      );
      await tapeButton(t, "copy");
      await t.until(
        () => t.vt.text().includes("clipboard: bass · 1 bar"),
        "chip",
      );

      // `v v` tiles: each paste lands after the last one.
      await t.send("\\"); // loop off, so the range is the bar under the head
      await t.until(() => !t.vt.text().includes("(loop)"), "loop off");
      // shift-→ turns the playhead knob a bar: `jump 2`.
      await t.send("\u001b[1;2C");
      await t.until(() => t.vt.text().includes("jump 2"), "echo: jump 2");
      await t.until(() => /playhead 2\.1/.test(t.vt.text()), "at bar 2");
      // Back to back, as fast as a person clicks: the second paste lands
      // past the first even before its `jump` has run.
      await tapeButton(t, "paste");
      await tapeButton(t, "paste");
      await waitFor(
        async () => (await bassNotes()).join() === "0,1,2",
        "v v tiles bars 2 and 3",
        () => t.vt.text(),
      );

      // ctrl-z undoes one gesture: the last tile only.
      await t.send("\u001a");
      await waitFor(
        async () => (await bassNotes()).join() === "0,1",
        "undo one tile",
        () => t.vt.text(),
      );

      // Insert: bars after the playhead slide right.
      await tapeButton(t, "insert");
      await t.until(() => t.vt.text().includes(" insert"), "echo: insert");
      await waitFor(
        async () => (await now()).bars === 9,
        "insert grows the song",
        () => t.vt.text(),
      );

      // The M badge on the drums row mutes drums, not the focused bass.
      const header = t.vt.lines().find((line) => line.includes("MSAF"))!;
      const badgeX = header.indexOf("MSAF");
      const drumsY = t.vt.lines().findIndex((line) => /^ \d.drums/.test(line));
      expect(badgeX).toBeGreaterThan(0);
      expect(drumsY).toBeGreaterThan(0);
      await t.send(click(badgeX, drumsY));
      await waitFor(
        async () =>
          (await now()).tracks.find((track) => track.id === "drums")?.muted ===
          true,
        "drums muted",
      );
      expect(
        (await now()).tracks.find((track) => track.id === "bass")?.muted,
      ).not.toBe(true);
      // The same badge unmutes drums again.
      await t.send(click(badgeX, drumsY));
      await waitFor(
        async () =>
          (await now()).tracks.find((track) => track.id === "drums")?.muted !==
          true,
        "drums unmuted",
      );
      // Tab moves the focus; a digit types into the prompt instead.
      await t.send("\t");
      await t.until(() => t.vt.text().includes("›drums"), "tab focuses drums");
      await t.send("2");
      await t.until(
        () => t.vt.lines().some((line) => /› 2\b/u.test(line)),
        "digit types",
      );
      expect(t.vt.text()).toContain("›drums");
    } finally {
      t.proc.kill();
    }
  },
  60_000,
);

// --- Multi-pane: the TAPE gutter marks other panes (§12.7). ---------------

const workspaces: string[] = [];
type Pane = {
  proc: ReturnType<typeof Bun.spawn>;
  terminal: { write(data: string): void; close(): void };
  vt: VirtualTerminal;
};
const panes: Pane[] = [];

afterAll(async () => {
  for (const p of panes) {
    p.proc.kill("SIGKILL");
    p.terminal.close();
  }
  // Pane daemons: kill any left by a failed run before removing the dir.
  for (const dir of workspaces) {
    const sessions = join(dir, ".dawg", "sessions");
    for (const name of await readdir(sessions).catch(() => [] as string[])) {
      if (!name.endsWith(".daemon.lock")) continue;
      try {
        const owner = JSON.parse(
          await readFile(join(sessions, name, "owner"), "utf8"),
        ) as { pid?: unknown };
        if (typeof owner.pid === "number") process.kill(owner.pid, "SIGKILL");
      } catch {
        // gone
      }
    }
    await rm(dir, { recursive: true, force: true });
  }
});

function openPane(dir: string, argv: string[]): Pane {
  const cols = 100;
  const rows = 28;
  const vt = new VirtualTerminal(cols, rows);
  const decoder = new TextDecoder();
  const proc = Bun.spawn([process.execPath, MAIN, ...argv], {
    cwd: dir,
    env: {
      PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: dir,
      TERM: "xterm-256color",
      NO_COLOR: "1",
      DAWG_AUDIO: "0",
      DAWG_AI: "0",
      DAWG_PROVIDER: "gateway",
      DAWG_CREDENTIAL_STORE: "file",
      DAWG_CONFIG_DIR: join(dir, ".config"),
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
    },
    terminal: {
      cols,
      rows,
      data(_terminal: unknown, data: Uint8Array) {
        vt.writeFrames(decoder.decode(data, { stream: true }));
      },
    },
  } as Parameters<typeof Bun.spawn>[1]);
  const pane = {
    proc,
    terminal: (proc as unknown as { terminal: Pane["terminal"] }).terminal,
    vt,
  };
  panes.push(pane);
  return pane;
}

async function until(
  predicate: () => boolean,
  label: string,
  context: () => string,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for ${label}\n${context()}`);
    await Bun.sleep(25);
  }
}

test.skipIf(!supported)(
  "real PTY panes: a recording pane shows C● in the TAPE gutter",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-tape-panes-"));
    workspaces.push(dir);
    const a = openPane(dir, ["--new", "--track", "bass"]);
    await until(
      () => /rev \d+/.test(a.vt.lines()[0] ?? ""),
      "A ready",
      () => a.vt.text(),
    );
    a.terminal.write("pattern kick every 1\r");
    await Bun.sleep(100);
    a.terminal.write("track bass\r");
    await Bun.sleep(100);
    const b = openPane(dir, ["pane", "home", "bass"]);
    await until(
      () => /rev \d+/.test(b.vt.lines()[0] ?? ""),
      "B ready",
      () => b.vt.text(),
    );
    const c = openPane(dir, ["pane", "play", "drums"]);
    await until(
      () => c.vt.text().includes("PLAY"),
      "C in play mode",
      () => c.vt.text(),
    );
    const both = () => `--- A\n${a.vt.text()}\n--- C\n${c.vt.text()}`;

    // A on TAPE: B sits on bass, C on drums.
    a.terminal.write("/tape on\r");
    await until(() => a.vt.text().includes("range: "), "A on tape", both);
    const row = (name: string) =>
      a.vt.lines().find((line) => new RegExp(`^ \\d.${name}`).test(line)) ?? "";
    await until(
      () => /\sB\s*$/.test(row("bass")) && /\sC\s*$/.test(row("drums")),
      "pane letters in the gutter",
      () => a.vt.text(),
    );

    // C records: its letter gains the red dot (`●`, kept under NO_COLOR).
    c.terminal.write("r");
    await until(() => c.vt.text().includes("rec armed"), "C armed", both);
    c.terminal.write(" ");
    await until(() => c.vt.text().includes("REC"), "C recording", both);
    await until(() => /\sC●\s*$/.test(row("drums")), "C● on drums", both);
    c.terminal.write(" ");
    await until(
      () => !/C●/.test(row("drums")),
      "C● clears after the take",
      both,
    );

    for (const p of [a, b, c]) {
      p.terminal.write("\u0003");
      await Promise.race([p.proc.exited, Bun.sleep(5_000)]);
    }
  },
  90_000,
);
