/**
 * Topics and first impressions at 80x24 in a real PTY (design §7 E5): every
 * topic id through /help, /guide and /menu, the first run, the /style
 * receipt, a bare scalar, bare `formant 3` and bare `lyrics` offline. No
 * screen may say "unknown" or "unrecognized".
 *
 * PTY_KNOWN_GAPS is empty; an entry fails the suite once it passes.
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
 * Cases that still print an error, by label. Empty; an entry fails the
 * suite once it passes.
 */
const PTY_KNOWN_GAPS: readonly string[] = [];

/** Every case the suites record; a case that throws early still counts. */
const EXPECTED_LABELS: readonly string[] = [
  ...["help", "guide", "menu"].flatMap((door) =>
    TOPIC_IDS.map((id) => `/${door} ${id}`),
  ),
  "first run",
  "offline first run",
  "/style deep-house",
  "tempo",
  "formant 3",
  "lyrics",
];

/** The prompt box is drawn: the TUI is up and taking keys. */
function ready(t: Session): boolean {
  return t.vt.lines().some((line) => line.startsWith("╭─"));
}

/**
 * The word a door's panel title names for each topic id: `help · effects`,
 * `guide · Shaping sound › Effects`, `≡ Mix`.
 */
function namesTopic(text: string, id: string): boolean {
  const title = text.split("\n")[0]?.toLowerCase() ?? "";
  // §4c: the keys guide's title is "Using dawg".
  const names = id === "keys" ? ["keys", "using dawg"] : [id.slice(0, 5)];
  return title.includes("╭─") && names.some((name) => title.includes(name));
}

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

/**
 * Ctrl-C until the process exits. The first-run picker takes the first
 * Ctrl-C as "skip" and opens the TUI, which needs a second one.
 */
async function stop(t: Session): Promise<void> {
  for (let i = 0; i < 3; i++) {
    t.terminal.write("\u0003");
    const done = await Promise.race([
      t.proc.exited.then(() => true),
      Bun.sleep(1_500).then(() => false),
    ]);
    if (done) return;
  }
  t.proc.kill(9);
  await t.proc.exited;
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
      await t.until(() => ready(t), "ready");
      for (const door of ["help", "guide", "menu"])
        for (const id of TOPIC_IDS) {
          const label = `/${door} ${id}`;
          record(label, await run(t, label));
          await reset(t);
        }
    } finally {
      await stop(t);
    }
  }, 120_000);

  test("first run opens the editor with the model key card; offline too", async () => {
    // C1: no picker on first run; one optional card names `/model key`.
    const online = await launch(80, 24, { AI_GATEWAY_API_KEY: "" }, []);
    try {
      await online.until(
        () => ready(online) && screen(online).includes("/model key"),
        "model key card",
      );
      expect(screen(online)).not.toContain("Welcome to dawg");
      record("first run", screen(online));
    } finally {
      await stop(online);
    }
    const offline = await launch(80, 24, OFFLINE, []);
    try {
      await offline.until(
        () => ready(offline) && screen(offline).includes("try: "),
        "offline prompt",
      );
      // §8.2: the agent key is `/model key`; login is only a typed alias.
      // DAWG_AI=0 turned the agent off on purpose, so nothing nags about
      // it; the online first run above shows the `/model key` card.
      const text = screen(offline);
      const ok = !/\blogin\b|sign.?in/i.test(text);
      record("offline first run", ok ? text : `✗ ${text}`);
    } finally {
      await stop(offline);
    }
    // Two launches in a row; CI runners need more than 30 s for both.
  }, 90_000);

  test("/style receipt, bare tempo, formant 3, lyrics offline", async () => {
    const t = await launch(80, 24, OFFLINE, []);
    try {
      await t.until(() => ready(t), "ready");
      const style = await run(t, "/style deep-house");
      // §6: the receipt names the musical change, not the verb.
      expect(receipt(t)).toContain("✓ deep-house ·");
      // House style: BPM in capitals.
      expect(receipt(t)).toContain("BPM");
      expect(receipt(t)).not.toMatch(/\bbpm\b/);
      record("/style deep-house", style);
      await reset(t);
      for (const line of ["tempo", "formant 3", "lyrics"]) {
        record(line, await run(t, line));
        await reset(t);
      }
    } finally {
      await stop(t);
    }
  }, 60_000);

  test("no case says unknown or unrecognized, except the known gaps", () => {
    const failing = [...outcomes]
      .filter(([, text]) => BAD.test(text) || text.includes("✗ "))
      .map(([label]) => label);
    expect(EXPECTED_LABELS.filter((label) => !outcomes.has(label))).toEqual([]);
    const known = new Set(PTY_KNOWN_GAPS);
    // A door that opens must open its own topic, not a root or general page.
    for (const door of ["help", "guide", "menu"])
      for (const id of TOPIC_IDS) {
        const label = `/${door} ${id}`;
        if (failing.includes(label)) continue;
        expect(namesTopic(outcomes.get(label) ?? "", id), label).toBe(true);
      }
    expect(failing.filter((label) => !known.has(label))).toEqual([]);
    // Bare tempo opens the fader drawer on the tempo value (deep-house,
    // applied just before, sets it).
    if (!failing.includes("tempo") && outcomes.has("tempo"))
      expect(outcomes.get("tempo")).toMatch(/tempo\s+\d+ BPM/);
    // A listed gap that now passes must leave the list.
    const ran = PTY_KNOWN_GAPS.filter((label) => outcomes.has(label));
    expect(ran.filter((label) => !failing.includes(label))).toEqual([]);
  });
});
