/**
 * Topics and first impressions at 80x24 in a real PTY (design §7 E5): every
 * topic id through /help, /guide and /menu, the first run, the /style
 * receipt, a bare scalar, bare `formant 3` and bare `lyrics` offline. No
 * screen may say "unknown" or "unrecognized".
 *
 * Cases another lane still has to land are listed in PTY_KNOWN_GAPS; the
 * suite fails when a listed case starts passing, so the list only shrinks.
 */
import { describe, expect, test } from "bun:test";
import { TOPIC_IDS } from "./consistency-lib.ts";
import { launch, supported } from "./pty-harness.ts";

const ESC = "\u001b";
const CTRL_U = "\u0015";
const OFFLINE = { AI_GATEWAY_API_KEY: "", DAWG_AI: "0" };

type Session = Awaited<ReturnType<typeof launch>>;

/** Words a working door never prints. */
const BAD = /\bunknown\b|\bunrecognized\b|no help topic|no guide named/i;

/**
 * Cases that still print an error, as the label each case uses. The
 * language lane (D1, D3: help and guide pages per id), the menu lane (B1)
 * and the grammar lane (A2, bare scalars and voice verbs) close them.
 */
const PTY_KNOWN_GAPS: readonly string[] = [
  "/help sound",
  "/help effects",
  "/help rhythm",
  "/help mix",
  "/help project",
  "/help agent",
  "/guide voice",
  "/guide arrange",
  "/guide agent",
  "/menu voice",
  "/menu keys",
  "/menu agent",
  "tempo",
  "formant 3",
  "lyrics",
];

/** The status line and any open panel: what the person reads after Enter. */
function screen(t: Session): string {
  return t.vt.text();
}

/** The status line: receipts, newest first, above the prompt box. */
function statusLine(t: Session): string {
  const lines = t.vt.lines();
  const box = lines.findIndex((line) => line.startsWith("╭"));
  return (lines[box - 1] ?? "").trim();
}

/** The newest receipt alone (older ones trail it, three spaces apart). */
function receipt(t: Session): string {
  return statusLine(t).split(/\s{3,}/)[0] ?? "";
}

/** An open help, guide or menu panel, framed top to bottom. */
function panel(t: Session): string {
  const lines = t.vt.lines();
  const top = lines.findIndex((line) => /^\s*╭─ /.test(line));
  if (top < 0) return "";
  const bottom = lines.findIndex((line, i) => i > top && /^\s*╰/.test(line));
  return lines.slice(top, bottom + 1).join("\n");
}

/**
 * Type a line and return what answers it: the panel it opened and the
 * newest receipt.
 */
async function run(t: Session, line: string): Promise<string> {
  const before = statusLine(t);
  await t.send(`${line}\r`);
  // The same error twice can leave a truncated status line unchanged, so
  // wait for a change but settle either way.
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline && statusLine(t) === before) await Bun.sleep(25);
  await Bun.sleep(250);
  return `${panel(t)}\n${receipt(t)}`;
}

async function reset(t: Session): Promise<void> {
  for (let i = 0; i < 3; i++) await t.send(ESC);
  await t.send(CTRL_U);
  await Bun.sleep(100);
}

const outcomes = new Map<string, string>();

function record(label: string, text: string): void {
  if (process.env.PTY_DUMP) console.log("=== " + label + "\n" + text);
  outcomes.set(label, text);
}

describe.skipIf(!supported)("real PTY at 80x24: topics and first run", () => {
  test("every topic id opens in /help, /guide and /menu", async () => {
    const t = await launch(80, 24, OFFLINE, []);
    try {
      await t.until(() => screen(t).includes("dawg login"), "ready");
      for (const door of ["help", "guide", "menu"])
        for (const id of TOPIC_IDS) {
          const label = `/${door} ${id}`;
          record(label, await run(t, label));
          await reset(t);
        }
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  }, 120_000);

  test("first run offers sign-in, offline first run hints dawg login", async () => {
    const online = await launch(80, 24, { AI_GATEWAY_API_KEY: "" }, []);
    try {
      await online.until(
        () => screen(online).includes("Welcome to dawg"),
        "welcome",
      );
      expect(screen(online)).toContain("Esc to skip");
      record("first run", screen(online));
    } finally {
      online.terminal.write("\u0003");
      await online.proc.exited;
    }
    const offline = await launch(80, 24, OFFLINE, []);
    try {
      await offline.until(
        () => screen(offline).includes("no model · dawg login"),
        "offline prompt",
      );
      expect(screen(offline)).toContain("try: tempo 96");
      record("offline first run", screen(offline));
    } finally {
      offline.terminal.write("\u0003");
      await offline.proc.exited;
    }
  }, 30_000);

  test("/style receipt, bare tempo, formant 3, lyrics offline", async () => {
    const t = await launch(80, 24, OFFLINE, []);
    try {
      await t.until(() => screen(t).includes("dawg login"), "ready");
      const style = await run(t, "/style deep-house");
      expect(receipt(t)).toContain("✓ style deep-house");
      expect(receipt(t)).toContain("bpm");
      record("/style deep-house", style);
      await reset(t);
      for (const line of ["tempo", "formant 3", "lyrics"]) {
        record(line, await run(t, line));
        await reset(t);
      }
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  }, 60_000);

  test("no case says unknown or unrecognized, except the known gaps", () => {
    const failing = [...outcomes]
      .filter(([, text]) => BAD.test(text) || text.includes("✗ "))
      .map(([label]) => label);
    const known = new Set(PTY_KNOWN_GAPS);
    expect(failing.filter((label) => !known.has(label))).toEqual([]);
    // Once bare tempo works, it opens the fader drawer on the tempo value.
    if (!failing.includes("tempo") && outcomes.has("tempo"))
      expect(outcomes.get("tempo")).toMatch(/tempo[\s\S]*120/);
    // A listed gap that now passes must leave the list.
    const ran = PTY_KNOWN_GAPS.filter((label) => outcomes.has(label));
    expect(ran.filter((label) => !failing.includes(label))).toEqual([]);
  });
});
