/**
 * Receipts never lie (design §8.6 E6), in a real PTY at 80x24: a refusal
 * reads as a refusal, a status read changes nothing, and what the agent
 * streams lands the same way a typed line does.
 *
 * - `remove n1` with no such note refuses (`✗ no note n1 · notes lists them`).
 * - `instrument sawtoth` refuses with a did-you-mean and stores nothing.
 * - `tempo 900` reads through the one usage template, never a core field name.
 * - An edit in one window never shows the "synced from another window" card:
 *   not for a typed line, not for an agent tool write (which goes through
 *   the port, the path that misfires), not with the daemon on.
 * - Space (transport) and play mode's Space leave the revision unchanged.
 * - A fake-provider turn streaming a bare `pattern house` writes drums, and
 *   the line never glues onto the prose after it.
 *
 * Cases another lane still has to land are listed in RECEIPT_KNOWN_GAPS; the
 * suite fails when a listed case starts passing, so the list only shrinks.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

const ESC = "\u001b";
const CTRL_U = "\u0015";
const CTRL_P = "\u0010";
const OFFLINE = { AI_GATEWAY_API_KEY: "", DAWG_AI: "0" };

type Session = Awaited<ReturnType<typeof launch>>;

/**
 * Cases that still tell a lie, by label. The grammar lane closes the first
 * three (A11 exact instrument words, A12 remove checks, A13 usageError) and
 * bare `pattern` for the agent (A15, with the menu lane's B12 show-me rule);
 * the feel lane closes the transport revision bump (C7).
 */
const RECEIPT_KNOWN_GAPS: readonly string[] = [
  "remove n1",
  "instrument sawtoth",
  "tempo 900",
  "Space",
  "play mode Space",
  "agent pattern house",
  // C12 (feel lane, PR #140): with the daemon on, this window's own write
  // comes back through the port and shows the card.
  "one-window daemon edit",
];

/**
 * Gaps that depend on timing: allowed to lie, not required to. C12 (feel
 * lane, PR #140): an agent tool write can come back through the file
 * watcher after the window records its own revision, which happens on
 * slower machines (CI) and shows the sync card.
 */
const RECEIPT_RACY_GAPS: readonly string[] = ["one-window agent write"];

/** Every case this suite records; a case that throws early still counts. */
const EXPECTED_LABELS: readonly string[] = [
  "remove n1",
  "instrument sawtoth",
  "tempo 900",
  "one-window edit",
  "one-window agent write",
  "one-window daemon edit",
  "Space",
  "play mode Space",
  "agent pattern house",
];

/** The prompt box is drawn: the TUI is up and taking keys. */
function ready(t: Session): boolean {
  return t.vt.lines().some((line) => line.startsWith("╭─"));
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

/** The revision the header shows (`rev 3`). */
function revision(t: Session): number {
  const match = /\brev (\d+)\b/.exec(t.vt.lines()[0] ?? "");
  return match ? Number(match[1]) : -1;
}

async function run(t: Session, line: string): Promise<string> {
  const before = statusLine(t);
  await t.send(`${line}\r`);
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline && statusLine(t) === before) await Bun.sleep(25);
  await Bun.sleep(250);
  return receipt(t);
}

async function reset(t: Session): Promise<void> {
  for (let i = 0; i < 3; i++) await t.send(ESC);
  await t.send(CTRL_U);
  await Bun.sleep(100);
}

async function quit(t: Session): Promise<void> {
  t.terminal.write("\u0003");
  await Promise.race([t.proc.exited, Bun.sleep(5000)]);
  t.proc.kill();
  t.terminal.close();
}

/** The newest saved composition under `.dawg/`. */
async function composition(cwd: string): Promise<Record<string, unknown>> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".json")) found.push(path);
    }
  };
  await walk(join(cwd, ".dawg"));
  for (const path of found) {
    const parsed = JSON.parse(await readFile(path, "utf8")) as {
      composition?: Record<string, unknown>;
    };
    if (parsed.composition && "tracks" in parsed.composition)
      return parsed.composition;
  }
  throw new Error("no session composition");
}

type Track = { id: string; instrument?: unknown; notes?: unknown[] };

/** Each case: its label and whether the screen told the truth. */
const outcomes = new Map<string, boolean>();

function record(label: string, ok: boolean, text: string): void {
  if (process.env.PTY_DUMP) console.log(`=== ${label} ${ok}\n${text}`);
  outcomes.set(label, ok);
}

// A streaming gateway for the agent case: one scripted reply per request.
let server: ReturnType<typeof Bun.serve> | undefined;
let origin = "";
/** One scripted reply: text parts, or a tool call the agent runs. */
type Reply = string[] | { tool: string; args: Record<string, unknown> };
let replies: Reply[] = [];

function chunk(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`;
}

function toolChunk(name: string, args: Record<string, unknown>): string {
  const call = {
    index: 0,
    id: `call_${name}`,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [call] } }] })}\n\n`;
}

beforeAll(() => {
  if (!supported) return;
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      if (!new URL(request.url).pathname.endsWith("/chat/completions"))
        return new Response("nope", { status: 404 });
      await request.json();
      const reply = replies.shift() ?? ["Done."];
      const [content, reason] = Array.isArray(reply)
        ? [reply.map(chunk).join(""), "stop"]
        : [toolChunk(reply.tool, reply.args), "tool_calls"];
      const body =
        content +
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: reason }] })}\n\ndata: [DONE]\n\n`;
      return new Response(body, {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  origin = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server?.stop(true);
});

describe.skipIf(!supported)("real PTY at 80x24: receipts never lie", () => {
  test("refusals refuse: remove, instrument, tempo", async () => {
    const t = await launch(80, 24, OFFLINE, ["--track", "bass"]);
    try {
      await t.until(() => ready(t), "ready");

      const removed = await run(t, "remove n1");
      record(
        "remove n1",
        removed.startsWith("✗") && /no note n1/.test(removed),
        removed,
      );
      await reset(t);

      const instrument = await run(t, "instrument sawtoth");
      const tracks = (await composition(t.cwd).catch(() => ({ tracks: [] })))
        .tracks as Track[];
      const stored = tracks.some((track) =>
        JSON.stringify(track.instrument ?? "").includes("sawtoth"),
      );
      record(
        "instrument sawtoth",
        instrument.startsWith("✗") &&
          /did you mean sawtooth/.test(instrument) &&
          !stored,
        instrument,
      );
      await reset(t);

      const tempo = await run(t, "tempo 900");
      record(
        "tempo 900",
        tempo.startsWith("✗") &&
          /tempo takes 20…300 BPM/.test(tempo) &&
          !/tempoBpm/.test(tempo),
        tempo,
      );
      // Whatever the wording, the tempo did not move.
      expect(t.vt.lines()[0]).toContain("120 BPM");
    } finally {
      await quit(t);
    }
  }, 30_000);

  test("one window: an edit never shows the sync card", async () => {
    const t = await launch(80, 24, OFFLINE, ["--track", "bass"]);
    try {
      await t.until(() => ready(t), "ready");
      await run(t, "add C4 at 0 for 1");
      await run(t, "tempo 96");
      // The watcher would land well inside this window.
      await Bun.sleep(1_500);
      const text = t.vt.text();
      record("one-window edit", !/synced/i.test(text), text);
      expect(revision(t)).toBe(2);
    } finally {
      await quit(t);
    }
  }, 30_000);

  test("one window: an agent tool write never shows the sync card", async () => {
    replies = [{ tool: "set_tempo", args: { bpm: 96 } }, ["Tempo is 96."]];
    const t = await launch(
      80,
      24,
      {
        AI_GATEWAY_BASE_URL: `${origin}/v1`,
        DAWG_MODELS_DEV_URL: `${origin}/api.json`,
      },
      ["--track", "bass"],
    );
    try {
      await t.until(() => ready(t), "prompt");
      await t.send("slow it to 96\r");
      await t.until(
        () => t.vt.lines()[0]?.includes("96") ?? false,
        "tempo",
        10_000,
      );
      await Bun.sleep(1_500);
      const text = t.vt.text();
      record("one-window agent write", !/synced/i.test(text), text);
    } finally {
      await quit(t);
    }
  }, 30_000);

  test("one window, daemon on: an edit never shows the sync card", async () => {
    const t = await launch(80, 24, { ...OFFLINE, DAWG_DAEMON: "1" }, [
      "--track",
      "bass",
    ]);
    try {
      await t.until(() => ready(t), "ready", 10_000);
      await run(t, "add C4 at 0 for 1");
      await run(t, "tempo 96");
      await Bun.sleep(1_500);
      const text = t.vt.text();
      record("one-window daemon edit", !/synced/i.test(text), text);
    } finally {
      await quit(t);
    }
  }, 30_000);

  test("Space and play mode change no revision", async () => {
    const t = await launch(80, 24, OFFLINE, ["--track", "bass"]);
    try {
      await t.until(() => ready(t), "ready");
      await run(t, "add C4 at 0 for 1");
      const rev = revision(t);
      expect(rev).toBe(1);
      // Transport: Space on an empty prompt plays, again pauses.
      await t.send(" ");
      await Bun.sleep(300);
      await t.send(" ");
      await Bun.sleep(300);
      await reset(t);
      record("Space", revision(t) === rev, t.vt.text());
      // Play mode: Space starts and stops the transport without recording.
      await t.send(CTRL_P);
      await t.until(() => t.vt.text().includes("PLAY"), "play mode");
      await t.send(" ");
      await Bun.sleep(300);
      await t.send(" ");
      await Bun.sleep(300);
      await t.send(ESC);
      await t.until(() => !t.vt.text().includes("PLAY"), "left play mode");
      await Bun.sleep(300);
      record("play mode Space", revision(t) === rev, t.vt.text());
    } finally {
      await quit(t);
    }
  }, 30_000);

  test("agent: a streamed bare pattern writes drums, prose stays apart", async () => {
    replies = [["pattern house\n", "Four on the floor with offbeat hats."]];
    const t = await launch(
      80,
      24,
      {
        AI_GATEWAY_BASE_URL: `${origin}/v1`,
        DAWG_MODELS_DEV_URL: `${origin}/api.json`,
      },
      ["--track", "drums"],
    );
    try {
      await t.until(() => ready(t), "prompt");
      await t.send("give me a house beat\r");
      await t.until(
        () => t.vt.text().includes("Four on the floor"),
        "reply prose",
        10_000,
      );
      await Bun.sleep(500);
      const text = t.vt.text();
      const tracks = (await composition(t.cwd).catch(() => ({ tracks: [] })))
        .tracks as Track[];
      const drums = tracks.find((track) => track.id === "drums");
      const wrote = (drums?.notes?.length ?? 0) > 0;
      const glued = /house\s*Four/.test(text.replace(/\n/g, ""));
      record("agent pattern house", wrote && !glued, text);
    } finally {
      await quit(t);
    }
  }, 30_000);

  test("every receipt tells the truth, except the known gaps", () => {
    // A case that threw before recording would hide its gap; none may.
    expect(EXPECTED_LABELS.filter((label) => !outcomes.has(label))).toEqual([]);
    const lying = [...outcomes].filter(([, ok]) => !ok).map(([label]) => label);
    const known = new Set([...RECEIPT_KNOWN_GAPS, ...RECEIPT_RACY_GAPS]);
    expect(lying.filter((label) => !known.has(label))).toEqual([]);
    // A listed gap that now passes must leave the list.
    const ran = RECEIPT_KNOWN_GAPS.filter((label) => outcomes.has(label));
    expect(ran.filter((label) => !lying.includes(label))).toEqual([]);
  });
});
