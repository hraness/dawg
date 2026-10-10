/**
 * The shared key grammar end to end at 80×24: every picker, editor and menu
 * shows a one-line key footer that fits, `?` opens the keys for that screen,
 * `/` filters, and Esc steps back one level (the filter first).
 */
import { expect, test } from "bun:test";
import { launch, supported } from "./pty-harness.ts";

const ESC = "\u001b";
const COLS = 80;

type Session = Awaited<ReturnType<typeof launch>>;

/** The screen's footer: the last line naming `esc`, within 80 columns. */
function footer(t: Session): string {
  const lines = t.vt.lines();
  const line = [...lines]
    .reverse()
    .find((row) => /esc (back|leave|clear)/.test(row));
  expect(line).toBeDefined();
  return line!;
}

function expectFits(t: Session): void {
  const line = footer(t);
  expect(line).toContain("? keys");
  expect(line).not.toContain("…");
  expect([...line].length).toBeLessThanOrEqual(COLS);
}

/** `?` opens the keys panel; any key closes it and the screen is back. */
async function expectKeysPanel(
  t: Session,
  marker: string,
  screen: string,
): Promise<void> {
  await t.send("?");
  await t.until(() => t.vt.text().includes(marker), `keys for ${screen}`);
  await t.send(ESC);
  await t.until(() => !t.vt.text().includes(marker), `${screen} keys closed`);
  await t.until(() => t.vt.text().includes(screen), `${screen} still open`);
}

/** `/` starts a filter; the first Esc clears it, keeping the screen. */
async function expectFilter(
  t: Session,
  query: string,
  screen: string,
): Promise<void> {
  await t.send(`/${query}`);
  await t.until(() => t.vt.text().includes(`/${query}`), `${screen} filter`);
  expect(footer(t)).toContain("esc clear");
  await t.send(ESC);
  await t.until(
    () => !t.vt.text().includes(`/${query}`),
    `${screen} filter cleared`,
  );
  expect(t.vt.text()).toContain(screen);
}

async function closeWithEsc(t: Session, screen: string): Promise<void> {
  await t.send(ESC);
  // The footer goes with the screen; the prompt shows none.
  await t.until(
    () => !/esc (back|clear)/.test(t.vt.text()),
    `${screen} closed`,
  );
  await t.until(() => t.vt.text().includes(" NOW "), "prompt back");
}

test.skipIf(!supported)(
  "real PTY: one key grammar across the pickers at 80 columns",
  async () => {
    const t = await launch(COLS, 24, {}, ["--track", "drums"]);
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await t.send("instrument kit\r");
      await t.until(() => t.vt.text().includes("rev 0→1"), "kit track");

      // Menu: footer, ?, / filter, Esc out level by level.
      await t.send("\u000b");
      await t.until(() => t.vt.text().includes("menu"), "menu");
      expectFits(t);
      await expectKeysPanel(t, "open a section", "menu");
      await expectFilter(t, "rhy", "menu");
      await closeWithEsc(t, "menu ·");

      // /pattern, /kit and /model are lists with the same keys.
      for (const [command, title, query] of [
        ["/pattern", "drum patterns", "boom"],
        ["/kit", "kits", "808"],
        ["/model", "Claude Opus", "haiku"],
      ] as const) {
        await t.send(`${command}\r`);
        // The list and its footer can land in separate frames under load.
        await t.until(
          () =>
            t.vt.text().includes(title) &&
            /esc (back|leave|clear)/.test(t.vt.text()),
          command,
        );
        expectFits(t);
        await expectKeysPanel(t, "filter (type, then enter or esc)", title);
        await expectFilter(t, query, title);
        await closeWithEsc(t, title);
      }

      // /euclid: an editor, same footer and panel.
      await t.send("/euclid\r");
      await t.until(() => t.vt.text().includes("rhythm ›"), "euclid");
      expectFits(t);
      await expectKeysPanel(t, "freeze into plain hits", "rhythm ›");
      await closeWithEsc(t, "rhythm ›");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  60_000,
);

test.skipIf(!supported)(
  "real PTY: prompt ? and the empty-project hint at 80 columns",
  async () => {
    const t = await launch(COLS, 24, {});
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      // An empty prompt shows `?`'s panel; typed text keeps the character.
      await t.send("?");
      await t.until(() => t.vt.text().includes("start here"), "prompt keys");
      expect(t.vt.text()).toContain("ctrl-p");
      expect(t.vt.text()).toContain("ctrl-k");
      await t.send(ESC);
      await t.until(() => !t.vt.text().includes("start here"), "closed");
      await t.send("why?");
      await t.until(() => t.vt.text().includes("why?"), "typed ?");
      for (const line of t.vt.lines())
        expect([...line].length).toBeLessThanOrEqual(COLS);
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  20_000,
);

test.skipIf(!supported)(
  "real PTY: play mode header and chord legend fit 80 columns",
  async () => {
    const t = await launch(COLS, 24, {}, ["--track", "keys"]);
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      // A new `instrument piano` stores the modelled grand (0.6 keys).
      await t.send("instrument piano\r");
      await t.until(() => t.vt.text().includes("keys · grand"), "piano");
      await t.send("\u0010");
      await t.until(() => t.vt.text().includes("PLAY"), "play");
      expect(t.vt.text()).toContain("? keys");
      const header = t.vt.lines().find((line) => line.includes("PLAY"))!;
      expect(header).not.toContain("…");
      await t.send("?");
      await t.until(
        () => t.vt.text().includes("letters are piano keys"),
        "play keys",
      );
      await t.send(ESC);
      await t.until(
        () => !t.vt.text().includes("letters are piano keys"),
        "play keys closed",
      );
      expect(t.vt.text()).toContain("PLAY");
      await t.send(ESC);
      await t.until(() => !t.vt.text().includes("PLAY "), "left play");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  20_000,
);

test.skipIf(!supported)(
  "real PTY: /guide tree, F1, keys panel and filter at 80 columns",
  async () => {
    const t = await launch(COLS, 24, {});
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await t.send("/guide\r");
      await t.until(() => t.vt.text().includes("Getting started"), "guides");
      expectFits(t);
      await expectKeysPanel(t, "expand a section", "Using dawg");
      await t.send("/euclid");
      await t.until(() => t.vt.text().includes("/ euclid"), "guide filter");
      expect(t.vt.text()).toContain("Rhythm and drums");
      expect(t.vt.text()).not.toContain("Getting started");
      await t.send(ESC);
      await t.until(() => t.vt.text().includes("Getting started"), "cleared");
      // Home ↓ → expands Using dawg; ↓ Enter opens its first guide.
      await t.send("\u001b[H");
      await t.send("\u001b[B");
      await t.send("\u001b[C");
      await t.until(() => t.vt.text().includes("Play mode"), "expanded");
      await t.send("\u001b[B");
      await t.send("\r");
      await t.until(
        () => t.vt.text().includes("Using dawg › Menu and audition loop"),
        "guide page",
      );
      for (const line of t.vt.lines())
        expect([...line].length).toBeLessThanOrEqual(COLS);
      await t.send(ESC);
      await closeWithEsc(t, "guide");
      // F1 toggles the same pane.
      await t.send("\u001bOP");
      await t.until(() => t.vt.text().includes("Getting started"), "F1");
      await t.send("\u001bOP");
      await t.until(() => !t.vt.text().includes("Getting started"), "F1 off");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  30_000,
);
