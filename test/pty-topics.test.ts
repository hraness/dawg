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
  "/menu voice",
  "/menu keys",
  "/menu agent",
  "tempo",
  "formant 3",
  "lyrics",
  // C15 and D (feel and language lanes): the offline prompt still says
  // `dawg login` instead of the model-key card.
  "offline first run",
];

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
 * `guide · Shaping sound › Effects`, `menu › Mix & automation`.
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
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  }, 120_000);

  test("first run welcomes; offline first run offers the model key", async () => {
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
        () => ready(offline) && screen(offline).includes("try: tempo 96"),
        "offline prompt",
      );
      // §8.2: the agent key is `/model key`; login is only a typed alias.
      const text = screen(offline);
      const ok =
        !/\blogin\b|sign.?in/i.test(text) && text.includes("/model key");
      record("offline first run", ok ? text : `✗ ${text}`);
    } finally {
      offline.terminal.write("\u0003");
      await offline.proc.exited;
    }
    // Two launches in a row; CI runners need more than 30 s for both.
  }, 90_000);

  test("/style receipt, bare tempo, formant 3, lyrics offline", async () => {
    const t = await launch(80, 24, OFFLINE, []);
    try {
      await t.until(() => ready(t), "ready");
      const style = await run(t, "/style deep-house");
      expect(receipt(t)).toContain("✓ style deep-house");
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
      t.terminal.write("\u0003");
      await t.proc.exited;
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
    // Once bare tempo works, it opens the fader drawer on the tempo value.
    if (!failing.includes("tempo") && outcomes.has("tempo"))
      expect(outcomes.get("tempo")).toMatch(/tempo[\s\S]*120/);
    // A listed gap that now passes must leave the list.
    const ran = PTY_KNOWN_GAPS.filter((label) => outcomes.has(label));
    expect(ran.filter((label) => !failing.includes(label))).toEqual([]);
  });
});
